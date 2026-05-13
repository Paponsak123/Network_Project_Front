"""
Active fingerprint probes.
"""

from __future__ import annotations

import logging
import platform
import re
import socket
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from services.cache import get_cache

logger = logging.getLogger(__name__)

PROBE_TTL_SEC = 300
HTTP_PORTS = (80, 8080, 443, 8000)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# TTL probe
# ---------------------------------------------------------------------------
def probe_ttl(ip: str, timeout: float = 1.0) -> dict:
    out = ""
    try:
        sys = platform.system()
        if sys == "Linux":
            args = ["ping", "-c", "1", "-W", str(max(1, int(timeout))), ip]
        elif sys == "Darwin":
            args = ["ping", "-c", "1", "-t", str(max(1, int(timeout))), ip]
        else:
            args = ["ping", "-n", "1", "-w", str(int(timeout * 1000)), ip]
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout + 1.0)
        out = r.stdout
    except Exception as e:
        return {"error": str(e)}

    m = re.search(r"ttl[=\s]+(\d+)", out, re.IGNORECASE)
    if not m:
        return {"error": "no ttl in reply"}
    ttl = int(m.group(1))

    if ttl > 128:
        initial = 255
        guess = "network gear"
    elif ttl > 64:
        initial = 128
        guess = "Windows"
    elif ttl > 32:
        initial = 64
        guess = "Unix-like (Linux/macOS/iOS/Android)"
    else:
        initial = ttl
        guess = "unknown"
    return {"ttl": ttl, "initial_ttl": initial, "guess": guess}


# ---------------------------------------------------------------------------
# HTTP / HTTPS banner
# ---------------------------------------------------------------------------
def probe_http_banner(ip: str, timeout: float = 1.5) -> dict:
    result: dict = {}
    for port in HTTP_PORTS:
        try:
            with socket.create_connection((ip, port), timeout=timeout) as s:
                s.settimeout(timeout)
                s.sendall(
                    f"HEAD / HTTP/1.0\r\nHost: {ip}\r\nUser-Agent: ScanDer/1.0\r\nConnection: close\r\n\r\n".encode()
                )
                data = b""
                while len(data) < 4096:
                    chunk = s.recv(1024)
                    if not chunk:
                        break
                    data += chunk
        except (socket.timeout, ConnectionRefusedError, OSError):
            continue

        try:
            text = data.decode("iso-8859-1", "ignore")
        except Exception:
            continue

        status_match = re.match(r"HTTP/\d\.\d\s+(\d+)", text)
        server_match = re.search(r"^server:\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)
        powered_by   = re.search(r"^x-powered-by:\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)

        if status_match or server_match:
            entry = {
                "port": port,
                "status": int(status_match.group(1)) if status_match else None,
                "server": server_match.group(1).strip() if server_match else None,
                "x_powered_by": powered_by.group(1).strip() if powered_by else None,
            }
            result = entry
            if entry["server"]:
                break
    return result


# ---------------------------------------------------------------------------
# NBNS Node Status
# ---------------------------------------------------------------------------
def probe_nbns(ip: str, timeout: float = 1.0) -> dict:
    query = (
        b"\x12\x34"
        b"\x00\x00"
        b"\x00\x01"
        b"\x00\x00\x00\x00\x00\x00"
        b"\x20"
        b"CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        b"\x00"
        b"\x00\x21"
        b"\x00\x01"
    )

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(timeout)
        s.sendto(query, (ip, 137))
        data, _ = s.recvfrom(4096)
        s.close()
    except (socket.timeout, OSError) as e:
        return {"error": str(e)}

    try:
        if len(data) < 57:
            return {"error": "short reply"}
        num_names = data[56]
        offset = 57
        names: list[dict] = []
        for _ in range(min(num_names, 32)):
            if offset + 18 > len(data):
                break
            raw_name = data[offset:offset + 15].decode("ascii", "ignore").strip()
            suffix = data[offset + 15]
            flags = int.from_bytes(data[offset + 16:offset + 18], "big")
            offset += 18
            names.append({"name": raw_name, "suffix": suffix, "flags": flags})

        host  = next((n["name"] for n in names if n["suffix"] == 0x00 and not (n["flags"] & 0x8000)), None)
        group = next((n["name"] for n in names if n["suffix"] == 0x00 and (n["flags"] & 0x8000)), None)

        return {"host": host, "workgroup": group, "names": names}
    except Exception as e:
        return {"error": f"parse: {e}"}


# ---------------------------------------------------------------------------
# SSDP M-SEARCH
# ---------------------------------------------------------------------------
_SSDP_REQUEST = (
    "M-SEARCH * HTTP/1.1\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    'MAN: "ssdp:discover"\r\n'
    "MX: 1\r\n"
    "ST: ssdp:all\r\n"
    "\r\n"
).encode("ascii")


def probe_ssdp(ip: str, timeout: float = 2.0) -> dict:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(timeout)
        s.sendto(_SSDP_REQUEST, (ip, 1900))
        data, _ = s.recvfrom(4096)
        s.close()
    except (socket.timeout, OSError) as e:
        return {"error": str(e)}

    try:
        text = data.decode("utf-8", "ignore")
    except Exception:
        return {"error": "decode"}

    out: dict[str, str] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        k = k.strip().lower()
        v = v.strip()
        if k in ("server", "usn", "st", "location"):
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# mDNS probe
# ---------------------------------------------------------------------------
def probe_mdns(ip: str, timeout: float = 2.0) -> dict:
    query = (
        b"\x00\x00"
        b"\x00\x00"
        b"\x00\x01"
        b"\x00\x00\x00\x00\x00\x00"
        b"\x09_services\x07_dns-sd\x04_udp\x05local\x00"
        b"\x00\x0c"
        b"\x00\x01"
    )

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(timeout)
        s.sendto(query, (ip, 5353))
        data, _ = s.recvfrom(4096)
        s.close()
    except (socket.timeout, OSError) as e:
        return {"error": str(e)}

    try:
        text = data.decode("utf-8", "ignore")
        services = re.findall(r"(_[a-zA-Z0-9\-]+\._(?:tcp|udp))", text)
        names = re.findall(r"([a-zA-Z0-9\-]+)\.local", text)
        return {
            "services": list(set(services)),
            "names": list(set(names)),
        }
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# nmap OS probe
# ---------------------------------------------------------------------------
def probe_nmap_os(ip: str, timeout: float = 30.0) -> dict:
    try:
        r = subprocess.run(
            ["sudo", "nmap", "-O", "-sV", "-Pn", "--osscan-limit",
             "--max-os-tries", "1", "--host-timeout", "20s", ip],
            capture_output=True, text=True, timeout=timeout
        )
        out = r.stdout
    except Exception as e:
        return {"error": str(e)}

    result = {}

    os_match = re.search(r"OS details:\s+(.+)", out)
    if os_match:
        result["os"] = os_match.group(1).strip()

    if not result.get("os"):
        guess = re.search(r"Aggressive OS guesses:\s+([^,\n]+)", out)
        if guess:
            result["os"] = guess.group(1).strip()

    services = re.findall(r"\d+/tcp\s+open\s+\S+\s+(.+)", out)
    if services:
        result["services"] = [s.strip() for s in services[:5]]

    return result


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------
def run_all_probes(ip: str, mac: str, force: bool = False, timeout: float = 30.0) -> dict:
    cache = get_cache()
    sources = ["ttl", "http", "nbns", "ssdp", "mdns", "nmap_os"]
    out: dict[str, dict] = {}
    to_run = []

    if not force:
        for src in sources:
            cached = cache.get_active_probe(mac, src)
            if cached is not None:
                out[src] = cached

    src_fn = {
        "ttl":     lambda: probe_ttl(ip),
        "http":    lambda: probe_http_banner(ip),
        "nbns":    lambda: probe_nbns(ip),
        "ssdp":    lambda: probe_ssdp(ip),
        "mdns":    lambda: probe_mdns(ip),
        "nmap_os": lambda: probe_nmap_os(ip),
    }

    for src in sources:
        if src not in out:
            to_run.append((src, src_fn[src]))

    if not to_run:
        return out

    with ThreadPoolExecutor(max_workers=len(to_run)) as ex:
        futures = {ex.submit(fn): src for src, fn in to_run}
        for fut in as_completed(futures, timeout=timeout):
            src = futures[fut]
            try:
                result = fut.result() or {}
            except Exception as e:
                result = {"error": str(e)}
            result["probed_at"] = _now_iso()
            out[src] = result
            try:
                cache.cache_active_probe(mac, src, result, ttl=PROBE_TTL_SEC)
            except Exception:
                pass

    return out