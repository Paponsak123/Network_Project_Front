"""
Fingerprint engine.

Reads passive signals (from cache, populated by services.fingerprint) and
active probe results (from services.active_probes) and produces a single
confidence-scored device profile.

Scoring model (informal):
  - Each signal produces one or more Indicators of the form
      (source, attribute, value, weight, raw)
    where attribute is one of: device_type / os / os_family / vendor / brand / hostname.
  - For each attribute we accumulate weight per candidate value.
  - The winning value is the candidate with max accumulated weight.
  - Reported confidence for an attribute = min(100, top_weight * 50)
    (so two strong signals agreeing → 100%; one medium signal → ~40%).
  - Overall confidence = mean of the per-attribute confidences for the
    attributes we managed to fill.
  - Indicator weights are decayed by age (seen_at) so stale DHCP signatures
    don't drown out fresh mDNS bursts.

The engine does NOT call out to the network. All side effects are kept in
services/active_probes — this module is a pure data combiner.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from services.cache import get_cache
from services.fingerprint import (
    dhcp_param_hints,
    dhcp_vci_hints,
    hostname_hints,
    mdns_service_hints,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------
@dataclass
class Indicator:
    source: str
    attribute: str
    value: str
    weight: float
    raw: Optional[str] = None
    seen_at: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FingerprintResult:
    device_type: Optional[str] = None
    os: Optional[str] = None
    os_family: Optional[str] = None
    vendor: Optional[str] = None
    brand: Optional[str] = None
    hostname: Optional[str] = None
    confidence: int = 0
    indicators: list[Indicator] = field(default_factory=list)
    discovery_methods: list[str] = field(default_factory=list)
    raw_signals: dict = field(default_factory=dict)
    per_attribute_confidence: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "device_type": self.device_type,
            "os": self.os,
            "os_family": self.os_family,
            "vendor": self.vendor,
            "brand": self.brand,
            "hostname": self.hostname,
            "confidence": self.confidence,
            "indicators": [i.to_dict() for i in self.indicators],
            "discovery_methods": self.discovery_methods,
            "raw_signals": self.raw_signals,
            "per_attribute_confidence": self.per_attribute_confidence,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _time_decay(seen_at: Optional[str], now: Optional[datetime] = None) -> float:
    """Returns a 0..1 multiplier based on how recently we saw this signal."""
    if not seen_at:
        return 0.7
    parsed = _parse_iso(seen_at)
    if not parsed:
        return 0.7
    now = now or datetime.now(timezone.utc)
    age_h = (now - parsed).total_seconds() / 3600
    if age_h < 1:
        return 1.0
    if age_h < 12:
        return 0.5
    if age_h < 24:
        return 0.2
    return 0.0


_RANDOM_MAC_PREFIX_BITS = {"2", "6", "a", "e"}


def _is_locally_administered(mac: str) -> bool:
    """Apple-style 'private wifi address' detection — locally administered bit set."""
    if not mac or len(mac) < 2:
        return False
    return mac[1].lower() in _RANDOM_MAC_PREFIX_BITS


# ---------------------------------------------------------------------------
# Signal interpreters — produce a list[Indicator] from a parsed payload
# ---------------------------------------------------------------------------
def _from_dhcp(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("seen_at")

    hostname = payload.get("hostname")
    if hostname:
        out.append(Indicator("dhcp", "hostname", hostname, 0.85, raw=hostname, seen_at=seen))

    vci = (payload.get("vendor_class_id") or "").lower()
    if vci:
        for needle, (os_family, brand) in dhcp_vci_hints().items():
            if needle in vci:
                out.append(Indicator("dhcp_vci", "os_family", os_family, 0.90, raw=vci, seen_at=seen))
                if brand:
                    out.append(Indicator("dhcp_vci", "brand", brand, 0.85, raw=vci, seen_at=seen))
                break

    req_list = payload.get("param_req_list") or []
    if isinstance(req_list, list) and req_list:
        # Score = (intersection / max(len(target), 4))
        best: Optional[tuple[float, str, str]] = None
        for os_name, ref, brand in dhcp_param_hints():
            common = len(set(req_list) & set(ref))
            denom = max(len(ref), 4)
            ratio = common / denom
            if ratio >= 0.5 and (best is None or ratio > best[0]):
                best = (ratio, os_name, brand)
        if best:
            ratio, os_name, brand = best
            weight = 0.45 + 0.35 * ratio   # 0.62..0.80
            out.append(Indicator("dhcp_param", "os", os_name, weight, raw=str(req_list), seen_at=seen))
            if brand:
                out.append(Indicator("dhcp_param", "brand", brand, 0.4 + 0.3 * ratio, raw=str(req_list), seen_at=seen))

    return out


def _from_mdns(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("seen_at")
    services: list[str] = payload.get("services") or []
    names: list[str] = payload.get("names") or []

    for service in services:
        s = service.lower()
        for needle, brand, dev_type in mdns_service_hints():
            if needle in s:
                if brand:
                    out.append(Indicator("mdns", "brand", brand, 0.85, raw=service, seen_at=seen))
                if dev_type:
                    out.append(Indicator("mdns", "device_type", dev_type, 0.80, raw=service, seen_at=seen))
                break

    # Names often include hostname.local
    for nm in names:
        local = nm.split(".")[0]
        if local and local.lower() not in ("local", "in-addr"):
            out.append(Indicator("mdns_name", "hostname", local, 0.6, raw=nm, seen_at=seen))

    return out


def _from_nbns(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("seen_at")
    name = payload.get("name") or payload.get("host")
    workgroup = payload.get("workgroup")
    if name:
        out.append(Indicator("nbns", "hostname", name, 0.7, raw=name, seen_at=seen))
        out.append(Indicator("nbns", "os_family", "Windows", 0.65, raw=name, seen_at=seen))
    if workgroup:
        out.append(Indicator("nbns", "os_family", "Windows", 0.70, raw=workgroup, seen_at=seen))
    return out


def _from_ssdp(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("seen_at") or payload.get("probed_at")
    server = (payload.get("server") or "").lower()
    if server:
        if "microsoft" in server or "windows" in server:
            out.append(Indicator("ssdp", "os_family", "Windows", 0.8, raw=server, seen_at=seen))
        elif "linux" in server:
            out.append(Indicator("ssdp", "os_family", "Linux", 0.8, raw=server, seen_at=seen))
        if "samsung" in server:
            out.append(Indicator("ssdp", "brand", "Samsung", 0.85, raw=server, seen_at=seen))
        if "sony" in server:
            out.append(Indicator("ssdp", "brand", "Sony", 0.85, raw=server, seen_at=seen))
        if "lg" in server:
            out.append(Indicator("ssdp", "brand", "LG", 0.85, raw=server, seen_at=seen))
        if "router" in server or "openwrt" in server:
            out.append(Indicator("ssdp", "device_type", "Router", 0.75, raw=server, seen_at=seen))
    return out


def _from_llmnr(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("seen_at")
    names = payload.get("names") or []
    if names:
        out.append(Indicator("llmnr", "os_family", "Windows", 0.55, raw=",".join(names), seen_at=seen))
    return out


def _from_ttl(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("probed_at")
    initial = payload.get("initial_ttl")
    if initial == 64:
        out.append(Indicator("ttl", "os_family", "Unix-like", 0.30, raw="initial_ttl=64", seen_at=seen))
    elif initial == 128:
        out.append(Indicator("ttl", "os_family", "Windows", 0.30, raw="initial_ttl=128", seen_at=seen))
    elif initial == 255:
        out.append(Indicator("ttl", "device_type", "Network Gear", 0.4, raw="initial_ttl=255", seen_at=seen))
    return out


def _from_http(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("probed_at")
    server = (payload.get("server") or "").lower()
    if not server:
        return out
    if any(x in server for x in ("apache", "nginx", "lighttpd", "openresty")):
        out.append(Indicator("http", "device_type", "Computer/Server", 0.5, raw=server, seen_at=seen))
        out.append(Indicator("http", "os_family", "Linux", 0.4, raw=server, seen_at=seen))
    if "iis" in server or "microsoft" in server:
        out.append(Indicator("http", "os_family", "Windows", 0.7, raw=server, seen_at=seen))
    if any(x in server for x in ("tp-link", "asus", "huawei", "mikrotik", "tenda", "dlink", "netgear", "openwrt", "lwip", "httpd/1.0")):
        out.append(Indicator("http", "device_type", "Router", 0.8, raw=server, seen_at=seen))
    if "tplink" in server or "tp-link" in server:
        out.append(Indicator("http", "brand", "TP-Link", 0.85, raw=server, seen_at=seen))
    return out


def _from_nmap_os(payload: dict) -> list[Indicator]:
    out: list[Indicator] = []
    seen = payload.get("probed_at")
    os_str = (payload.get("os") or "").lower()
    if not os_str:
        return out

    if "windows" in os_str:
        out.append(Indicator("nmap_os", "os_family", "Windows", 0.85, raw=os_str, seen_at=seen))
    elif "ios" in os_str or "iphone" in os_str or "ipad" in os_str:
        out.append(Indicator("nmap_os", "brand", "Apple", 0.85, raw=os_str, seen_at=seen))
        out.append(Indicator("nmap_os", "os_family", "iOS", 0.85, raw=os_str, seen_at=seen))
    elif "mac os" in os_str or "macos" in os_str or "darwin" in os_str:
        out.append(Indicator("nmap_os", "brand", "Apple", 0.80, raw=os_str, seen_at=seen))
        out.append(Indicator("nmap_os", "os_family", "macOS", 0.80, raw=os_str, seen_at=seen))
    elif "android" in os_str:
        out.append(Indicator("nmap_os", "os_family", "Android", 0.80, raw=os_str, seen_at=seen))
    elif "linux" in os_str:
        out.append(Indicator("nmap_os", "os_family", "Linux", 0.75, raw=os_str, seen_at=seen))

    out.append(Indicator("nmap_os", "os", payload.get("os", ""), 0.80, raw=os_str, seen_at=seen))
    return out

def _from_hostname(hostname: str, source: str = "hostname") -> list[Indicator]:
    out: list[Indicator] = []
    for pattern, info in hostname_hints():
        if pattern.search(hostname):
            for attr, value in info.items():
                out.append(Indicator(source, attr, value, 0.45, raw=hostname))
            break
    return out


def _from_device_record(device: dict) -> list[Indicator]:
    """Pull vendor/OUI + open-port heuristics from the existing devices doc."""
    out: list[Indicator] = []
    vendor = device.get("vendor")
    if vendor and vendor not in ("Unknown", "Randomized MAC (Privacy)"):
        out.append(Indicator("oui", "vendor", vendor, 0.5, raw=vendor))
        v = vendor.lower()
        if "apple" in v:
            out.append(Indicator("oui", "brand", "Apple", 0.55, raw=vendor))
        elif "samsung" in v:
            out.append(Indicator("oui", "brand", "Samsung", 0.55, raw=vendor))
        elif "xiaomi" in v:
            out.append(Indicator("oui", "brand", "Xiaomi", 0.55, raw=vendor))
        elif "google" in v:
            out.append(Indicator("oui", "brand", "Google", 0.55, raw=vendor))
        elif any(x in v for x in ("tp-link", "asus", "huawei", "mikrotik", "tenda", "d-link", "netgear")):
            out.append(Indicator("oui", "device_type", "Router", 0.5, raw=vendor))

    ports = device.get("ports") or []
    if isinstance(ports, list):
        if 62078 in ports:
            out.append(Indicator("ports", "brand", "Apple", 0.75, raw="tcp/62078 (iPhone sync)"))
            out.append(Indicator("ports", "device_type", "Phone/Tablet", 0.6, raw="tcp/62078"))
        if 5353 in ports:
            out.append(Indicator("ports", "os_family", "Apple/Linux", 0.2, raw="tcp/5353 (mdns)"))
        if any(p in ports for p in (135, 139, 445, 3389)):
            out.append(Indicator("ports", "os_family", "Windows", 0.7, raw="tcp/SMB or RDP"))
        if any(p in ports for p in (80, 443, 8080)) and not any(p in ports for p in (135, 22)):
            out.append(Indicator("ports", "device_type", "Embedded/Smart", 0.25, raw="http-only host"))
        if 9100 in ports:
            out.append(Indicator("ports", "device_type", "Printer", 0.85, raw="tcp/9100"))
        if 22 in ports:
            out.append(Indicator("ports", "os_family", "Unix-like", 0.45, raw="tcp/22"))

    return out


# ---------------------------------------------------------------------------
# Combine indicators into a decision per attribute
# ---------------------------------------------------------------------------
def _aggregate(indicators: list[Indicator]) -> tuple[dict, dict]:
    """Return ({attr: chosen_value}, {attr: confidence_int})."""
    now = datetime.now(timezone.utc)
    buckets: dict[str, dict[str, float]] = {}

    for ind in indicators:
        weight = ind.weight * _time_decay(ind.seen_at, now)
        if weight <= 0:
            continue
        attr_bucket = buckets.setdefault(ind.attribute, {})
        attr_bucket[ind.value] = attr_bucket.get(ind.value, 0.0) + weight

    chosen: dict[str, str] = {}
    confidence: dict[str, int] = {}
    for attr, values in buckets.items():
        if not values:
            continue
        top_value, top_weight = max(values.items(), key=lambda kv: kv[1])
        chosen[attr] = top_value
        # Two strong signals (weight ~1.0) agreeing → ~100%; one medium → ~40%.
        confidence[attr] = max(0, min(100, int(top_weight * 50)))
    return chosen, confidence


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def fingerprint(device: dict, active_probes: Optional[dict] = None) -> FingerprintResult:
    """
    Combine passive cache + active probe data + device record into a
    FingerprintResult. Side-effect free — caller decides whether to persist.
    """
    mac = (device.get("mac") or "").lower()
    cache = get_cache()
    passive = cache.get_passive_signals(mac) if mac else {}

    indicators: list[Indicator] = []
    discovery_methods: list[str] = []
    raw_signals: dict = {"passive": passive, "active": dict(active_probes or {})}

    # Device-record-derived signals
    rec_inds = _from_device_record(device)
    if rec_inds:
        indicators.extend(rec_inds)
        discovery_methods.append("oui_and_ports")

    # Passive signals
    for source, payload in passive.items():
        if not isinstance(payload, dict) or source == "meta":
            continue
        fn = {
            "dhcp":  _from_dhcp,
            "mdns":  _from_mdns,
            "nbns":  _from_nbns,
            "ssdp":  _from_ssdp,
            "llmnr": _from_llmnr,
        }.get(source)
        if fn:
            new = fn(payload)
            if new:
                indicators.extend(new)
                discovery_methods.append(f"passive_{source}")

    # Active probes
    for source, payload in (active_probes or {}).items():
        if not isinstance(payload, dict):
            continue
        fn = {
              "ttl":     _from_ttl,
              "http":    _from_http,
              "nbns":    _from_nbns,
              "ssdp":    _from_ssdp,
              "nmap_os": _from_nmap_os,  # ← ADD
            }.get(source)
        if fn:
            new = fn(payload)
            if new:
                indicators.extend(new)
                discovery_methods.append(f"active_{source}")

    # Hostname pattern matching (use the best hostname we can find)
    hostname_candidates: list[str] = []
    for ind in indicators:
        if ind.attribute == "hostname" and ind.value:
            hostname_candidates.append(ind.value)
    explicit_host = device.get("hostname")
    if explicit_host:
        hostname_candidates.append(explicit_host)

    for hn in hostname_candidates:
        indicators.extend(_from_hostname(hn))
        break  # one pass is enough

    # Random-MAC awareness: down-weight OUI vendor when MAC is locally-administered.
    if _is_locally_administered(mac):
        for ind in indicators:
            if ind.source == "oui":
                ind.weight *= 0.2  # OUI is essentially meaningless for randomized MACs
        indicators.append(Indicator(
            "mac_analysis", "vendor", "Randomized MAC (Privacy)",
            0.4, raw=mac,
        ))

    # Aggregate
    chosen, confidence = _aggregate(indicators)

    # If we got an os_family but no os, alias the family as the os.
    if "os_family" in chosen and "os" not in chosen:
        chosen["os"] = chosen["os_family"]
        confidence["os"] = confidence.get("os_family", 0)

    # Overall confidence = mean over the attributes we filled.
    if confidence:
        overall = int(round(sum(confidence.values()) / len(confidence)))
    else:
        overall = 0

    # Deduplicate discovery methods, preserve order.
    seen = set()
    discovery_methods = [m for m in discovery_methods if not (m in seen or seen.add(m))]

    return FingerprintResult(
        device_type=chosen.get("device_type"),
        os=chosen.get("os"),
        os_family=chosen.get("os_family"),
        vendor=chosen.get("vendor") or device.get("vendor"),
        brand=chosen.get("brand"),
        hostname=chosen.get("hostname") or device.get("hostname"),
        confidence=overall,
        indicators=indicators,
        discovery_methods=discovery_methods,
        raw_signals=raw_signals,
        per_attribute_confidence=confidence,
    )
