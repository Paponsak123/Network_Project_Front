"""
Passive fingerprint sniffer.

This module captures DHCP, mDNS, NBNS, SSDP and LLMNR traffic on the local
network and writes per-MAC signals into the shared cache (Redis-backed,
in-memory fallback). The fingerprint *engine* (services/fingerprint_engine)
later reads these signals and combines them with active probes to produce a
confidence-scored device profile.

Design notes:
  - The sniffer runs in a background thread. Packet parsing is intentionally
    cheap (we only extract a handful of fields). Heavy work happens in the
    engine when `/api/devices/{id}/fingerprint` is called.
  - To avoid hammering Redis on bursty mDNS traffic, parsed signals are
    pushed to a bounded queue and flushed in batches of up to 256 every
    200 ms.
  - Only one process should own the sniffer at a time. We acquire a
    distributed lock ("sniffer-leader") via the cache module before
    starting; if a worker crashes the lock TTL expires (60 s) and another
    worker picks up.

Backwards compatibility:
  - The legacy `_update_device_info` helper that writes flat fields to the
    `devices` collection is preserved so previously-deployed code paths keep
    working. New code should consume signals via the cache module.
"""

from __future__ import annotations

import logging
import queue
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from scapy.all import DHCP, DNS, DNSQR, DNSRR, IP, UDP, Raw, conf, sniff  # type: ignore

from database import get_db
from services.cache import get_cache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SNIFF_FILTER = (
    "udp and ("
    "port 67 or port 68 "          # DHCP
    "or port 5353 "                # mDNS
    "or port 137 "                 # NBNS
    "or port 1900 "                # SSDP
    "or port 5355 "                # LLMNR
    ")"
)

QUEUE_MAXSIZE = 10_000
FLUSH_BATCH = 256
FLUSH_INTERVAL_SEC = 0.2
SNIFFER_LOCK_NAME = "sniffer-leader"
SNIFFER_LOCK_TTL_SEC = 60
SNIFFER_LOCK_REFRESH_SEC = 30

_MAC_RE = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")

# DHCP option name → param-request-list signature for OS family hint.
# Source-of-truth-ish: well-known fingerprints from fingerbank-like projects.
_DHCP_PARAM_HINTS: list[tuple[str, list[int], str]] = [
    ("Apple iOS/macOS",     [1, 121, 3, 6, 15, 119, 252],            "Apple"),
    ("Apple iOS/macOS",     [1, 3, 6, 15, 119, 252],                 "Apple"),
    ("Android",             [1, 3, 6, 15, 26, 28, 51, 58, 59, 43],  "Google"),
    ("Android",             [1, 33, 3, 6, 12, 15, 28, 42, 51, 121], "Google"),
    ("Windows 10/11",       [1, 3, 6, 15, 31, 33, 43, 44, 46, 47, 121, 249, 252], "Microsoft"),
    ("Windows",             [15, 3, 6, 44, 46, 47, 31, 33, 121, 249, 43], "Microsoft"),
    ("Linux",               [1, 28, 2, 3, 15, 6, 119, 12, 44, 47, 26, 121, 42], "Linux"),
]

# DHCP vendor_class_id substring → (os_family, brand_or_None)
_DHCP_VCI_HINTS: dict[str, tuple[str, Optional[str]]] = {
    "msft":           ("Windows", "Microsoft"),
    "android-dhcp":   ("Android", "Google"),
    "dhcpcd":         ("Linux",   None),
    "udhcp":          ("Linux",   None),
    "iphone":         ("iOS",     "Apple"),
    "ipad":           ("iPadOS",  "Apple"),
    "macbook":        ("macOS",   "Apple"),
}

# mDNS service-type substring → (brand, device_type)
_MDNS_SERVICE_HINTS: list[tuple[str, str, Optional[str]]] = [
    ("_apple-mobdev2", "Apple",   "Phone/Tablet"),
    ("_companion-link","Apple",   "Phone/Tablet"),
    ("_airplay",       "Apple",   "Media"),
    ("_raop",          "Apple",   "Media"),
    ("_homekit",       "Apple",   "Smart Home"),
    ("_googlecast",    "Google",  "Media"),
    ("_google",        "Google",  None),
    ("_androidtvremote","Google", "Media"),
    ("_xiaomi",        "Xiaomi",  None),
    ("_miio",          "Xiaomi",  "Smart Home"),
    ("_samsung",       "Samsung", None),
    ("_printer",       None,      "Printer"),
    ("_ipp",           None,      "Printer"),
    ("_workstation",   None,      "Computer"),
    ("_smb",           None,      "Computer"),
    ("_ssh",           None,      "Computer"),
]

_HOSTNAME_HINTS: list[tuple[re.Pattern, dict]] = [
    (re.compile(r"^iphone",                re.I), {"os_family": "Apple",     "device_type": "Phone/Tablet", "brand": "Apple"}),
    (re.compile(r"^ipad",                  re.I), {"os_family": "Apple",     "device_type": "Phone/Tablet", "brand": "Apple"}),
    (re.compile(r"^(macbook|imac|mac)",    re.I), {"os_family": "Apple",     "device_type": "Computer",     "brand": "Apple"}),
    (re.compile(r"^android",               re.I), {"os_family": "Android",   "device_type": "Phone/Tablet"}),
    (re.compile(r"^samsung",               re.I), {"os_family": "Android",   "device_type": "Phone/Tablet", "brand": "Samsung"}),
    (re.compile(r"^(redmi|mi-|xiaomi)",    re.I), {"os_family": "Android",   "device_type": "Phone/Tablet", "brand": "Xiaomi"}),
    (re.compile(r"^pixel",                 re.I), {"os_family": "Android",   "device_type": "Phone/Tablet", "brand": "Google"}),
    (re.compile(r"^(desktop|laptop|win)",  re.I), {"os_family": "Windows",   "device_type": "Computer",     "brand": "Microsoft"}),
    (re.compile(r"^(ubuntu|debian|arch|fedora)", re.I), {"os_family": "Linux", "device_type": "Computer"}),
]

# ---------------------------------------------------------------------------
# Module state
# ---------------------------------------------------------------------------
_signal_queue: "queue.Queue[tuple[str, str, dict]]" = queue.Queue(maxsize=QUEUE_MAXSIZE)
_started = False
_started_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalise_mac(mac: str) -> Optional[str]:
    if not isinstance(mac, str):
        return None
    cleaned = mac.strip().lower().replace("-", ":")
    if _MAC_RE.match(cleaned):
        return cleaned
    return None


# ---------------------------------------------------------------------------
# Legacy DB writer (kept for backwards compat — engine no longer uses this)
# ---------------------------------------------------------------------------
def _update_device_info(mac: str, info: dict) -> None:
    try:
        db = get_db()
        if db is not None:
            db.devices.update_one({"mac": mac.lower()}, {"$set": info}, upsert=False)
    except Exception as e:
        logger.debug("legacy _update_device_info failed for %s: %s", mac, e)


# ---------------------------------------------------------------------------
# Packet parsers — each returns (source, payload) or None.
# All parsers must be cheap and exception-safe.
# ---------------------------------------------------------------------------
def _parse_dhcp(pkt: Any) -> Optional[tuple[str, dict]]:
    if not pkt.haslayer(DHCP):
        return None
    payload: dict[str, Any] = {}
    try:
        for opt in pkt[DHCP].options:
            if not isinstance(opt, tuple) or len(opt) < 2:
                continue
            key, val = opt[0], opt[1]
            if key == "hostname":
                hostname = val.decode("utf-8", "ignore") if isinstance(val, (bytes, bytearray)) else str(val)
                payload["hostname"] = hostname.strip()
            elif key == "vendor_class_id":
                vci = val.decode("utf-8", "ignore") if isinstance(val, (bytes, bytearray)) else str(val)
                payload["vendor_class_id"] = vci.strip()
            elif key == "client_id":
                cid = val.hex() if isinstance(val, (bytes, bytearray)) else str(val)
                payload["client_id"] = cid
            elif key == "param_req_list":
                if isinstance(val, (bytes, bytearray)):
                    payload["param_req_list"] = list(val)
                elif isinstance(val, (list, tuple)):
                    payload["param_req_list"] = [int(x) for x in val if isinstance(x, int)]
                else:
                    payload["param_req_list"] = [int(x) for x in str(val).split(",") if x.strip().isdigit()]
            elif key == "message-type":
                payload["message_type"] = int(val) if isinstance(val, int) else val
    except Exception as e:
        logger.debug("dhcp parse error: %s", e)
        return None
    if not payload:
        return None
    return ("dhcp", payload)


def _parse_mdns(pkt: Any) -> Optional[tuple[str, dict]]:
    if not (pkt.haslayer(UDP) and pkt[UDP].dport == 5353 or (pkt.haslayer(UDP) and pkt[UDP].sport == 5353)):
        return None
    if not pkt.haslayer(DNS):
        return None
    payload: dict[str, Any] = {"services": [], "names": []}
    try:
        # Queries
        if pkt[DNS].qd is not None:
            qd = pkt[DNS].qd
            # Scapy chains DNSQR records via .qdcount / iteration.
            while qd is not None:
                name = getattr(qd, "qname", None)
                if name:
                    s = name.decode("utf-8", "ignore") if isinstance(name, (bytes, bytearray)) else str(name)
                    s = s.rstrip(".")
                    if s:
                        payload["names"].append(s)
                qd = getattr(qd, "payload", None)
                if not isinstance(qd, DNSQR):
                    break

        # Answers (more reliable than queries for service discovery)
        an = pkt[DNS].an
        ar = pkt[DNS].ar
        for rr in (an, ar):
            cur = rr
            while cur is not None and isinstance(cur, (DNSRR,)):
                try:
                    name = cur.rrname.decode("utf-8", "ignore") if isinstance(cur.rrname, (bytes, bytearray)) else str(cur.rrname)
                    name = name.rstrip(".")
                    if "_tcp" in name or "_udp" in name:
                        payload["services"].append(name)
                    elif name:
                        payload["names"].append(name)
                except Exception:
                    pass
                cur = getattr(cur, "payload", None)
    except Exception as e:
        logger.debug("mdns parse error: %s", e)

    # Dedup
    payload["services"] = list(dict.fromkeys(payload["services"]))[:10]
    payload["names"] = list(dict.fromkeys(payload["names"]))[:10]
    if not payload["services"] and not payload["names"]:
        return None
    return ("mdns", payload)


def _parse_nbns(pkt: Any) -> Optional[tuple[str, dict]]:
    if not (pkt.haslayer(UDP) and (pkt[UDP].dport == 137 or pkt[UDP].sport == 137)):
        return None
    # NBNS name is an encoded NetBIOS name in the DNS-style payload. We do a
    # lightweight extraction without pulling in impacket.
    try:
        raw = bytes(pkt[UDP].payload)
        # First 12 bytes are the NBNS header; name starts at offset 12.
        if len(raw) < 13:
            return None
        # Encoded length byte is first.
        enc_len = raw[12]
        if enc_len != 0x20:  # NetBIOS names are always 16 bytes → encoded as 32 bytes
            return None
        encoded = raw[13:13 + 32]
        if len(encoded) < 32:
            return None
        decoded = bytearray()
        for i in range(0, 32, 2):
            hi = encoded[i] - 0x41
            lo = encoded[i + 1] - 0x41
            decoded.append(((hi & 0xF) << 4) | (lo & 0xF))
        name = decoded.rstrip(b"\x00 ").decode("ascii", "ignore").strip()
        if not name:
            return None
        return ("nbns", {"name": name})
    except Exception:
        return None


def _parse_ssdp(pkt: Any) -> Optional[tuple[str, dict]]:
    if not (pkt.haslayer(UDP) and (pkt[UDP].dport == 1900 or pkt[UDP].sport == 1900)):
        return None
    if not pkt.haslayer(Raw):
        return None
    try:
        data = bytes(pkt[Raw].load).decode("utf-8", "ignore")
    except Exception:
        return None
    payload: dict[str, Any] = {}
    for line in data.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if key in ("server", "user-agent", "nt", "usn", "location"):
            payload[key] = value
    if not payload:
        return None
    return ("ssdp", payload)


def _parse_llmnr(pkt: Any) -> Optional[tuple[str, dict]]:
    if not (pkt.haslayer(UDP) and (pkt[UDP].dport == 5355 or pkt[UDP].sport == 5355)):
        return None
    if not pkt.haslayer(DNS):
        return None
    names: list[str] = []
    try:
        qd = pkt[DNS].qd
        if qd is not None:
            name = qd.qname.decode("utf-8", "ignore") if isinstance(qd.qname, (bytes, bytearray)) else str(qd.qname)
            name = name.rstrip(".")
            if name:
                names.append(name)
    except Exception:
        pass
    if not names:
        return None
    return ("llmnr", {"names": names})


_PARSERS = (_parse_dhcp, _parse_mdns, _parse_nbns, _parse_ssdp, _parse_llmnr)


# ---------------------------------------------------------------------------
# Sniffer + flush
# ---------------------------------------------------------------------------
def _sniffer_callback(pkt: Any) -> None:
    try:
        mac = _normalise_mac(getattr(pkt, "src", "") or "")
        if not mac:
            return
        for parser in _PARSERS:
            try:
                parsed = parser(pkt)
            except Exception:
                parsed = None
            if parsed is None:
                continue
            source, payload = parsed
            payload["seen_at"] = _now_iso()
            try:
                _signal_queue.put_nowait((mac, source, payload))
            except queue.Full:
                # Drop on overflow — better to lose a packet than back up.
                logger.debug("signal queue full, dropping %s/%s", mac, source)
    except Exception:
        logger.debug("sniffer callback error", exc_info=True)


def _flush_loop() -> None:
    cache = get_cache()
    while True:
        batch: list[tuple[str, str, dict]] = []
        try:
            batch.append(_signal_queue.get(timeout=FLUSH_INTERVAL_SEC))
        except queue.Empty:
            continue
        while len(batch) < FLUSH_BATCH:
            try:
                batch.append(_signal_queue.get_nowait())
            except queue.Empty:
                break

        for mac, source, payload in batch:
            try:
                cache.add_passive_signal(mac, source, payload)
                # Maintain secondary indexes for cross-MAC correlation.
                if source == "dhcp":
                    cid = payload.get("client_id")
                    if cid:
                        cache.index_client_id(cid, mac)
                    host = payload.get("hostname")
                    if host:
                        cache.index_hostname(host, mac)
                elif source == "nbns":
                    name = payload.get("name")
                    if name:
                        cache.index_hostname(name, mac)
            except Exception:
                logger.debug("flush write failed", exc_info=True)


def _lock_refresh_loop() -> None:
    cache = get_cache()
    while True:
        time.sleep(SNIFFER_LOCK_REFRESH_SEC)
        cache.refresh_lock(SNIFFER_LOCK_NAME, ttl_sec=SNIFFER_LOCK_TTL_SEC)


def _sniffer_thread() -> None:
    iface = conf.iface
    logger.info("fingerprint sniffer starting on %s (filter: %s)", iface, SNIFF_FILTER)
    try:
        sniff(iface=iface, filter=SNIFF_FILTER, prn=_sniffer_callback, store=0)
    except Exception as e:
        logger.error("sniffer crashed: %s", e, exc_info=True)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def start_fingerprinting() -> Optional[threading.Thread]:
    """
    Start the passive fingerprint pipeline if (and only if) this process
    wins the sniffer lock. Returns the sniffer thread on success, None if
    another worker already owns the lock.

    This function is safe to call multiple times; subsequent calls return
    immediately.
    """
    global _started
    with _started_lock:
        if _started:
            return None
        cache = get_cache()
        # Acquire lock manually — we want to hold it for the lifetime of the
        # process, not just a `with` block.
        acquired = False
        if cache.mode == "redis" and cache._r is not None:
            try:
                acquired = bool(cache._r.set(
                    cache._k_lock(SNIFFER_LOCK_NAME),
                    "1",
                    ex=SNIFFER_LOCK_TTL_SEC,
                    nx=True,
                ))
            except Exception:
                acquired = True  # fallback: try to start anyway
        else:
            acquired = True  # in-memory mode is per-process so always start

        if not acquired:
            logger.info("Another worker owns the sniffer lock — skipping local sniffer.")
            return None

        # Background workers
        threading.Thread(target=_flush_loop, daemon=True, name="fp-flush").start()
        threading.Thread(target=_lock_refresh_loop, daemon=True, name="fp-lock-refresh").start()
        t = threading.Thread(target=_sniffer_thread, daemon=True, name="fp-sniffer")
        t.start()
        _started = True
        return t


# ---------------------------------------------------------------------------
# Convenience hints exported for the engine
# ---------------------------------------------------------------------------
def dhcp_param_hints() -> list[tuple[str, list[int], str]]:
    return list(_DHCP_PARAM_HINTS)


def dhcp_vci_hints() -> dict[str, tuple[str, Optional[str]]]:
    return dict(_DHCP_VCI_HINTS)


def mdns_service_hints() -> list[tuple[str, Optional[str], Optional[str]]]:
    return list(_MDNS_SERVICE_HINTS)


def hostname_hints() -> list[tuple[re.Pattern, dict]]:
    return list(_HOSTNAME_HINTS)
