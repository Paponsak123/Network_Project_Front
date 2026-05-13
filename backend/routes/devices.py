"""
Device routes — list devices, update custom name, run fingerprint, inspect raw signals.

The fingerprint endpoint now uses the multi-source engine (DHCP + mDNS +
NBNS + SSDP + LLMNR + active probes + heuristics + confidence scoring) and
writes a structured `fingerprint` sub-document into MongoDB. Legacy flat
fields (`os`, `brand`, `hostname`) are still mirrored for backwards
compatibility with the existing UI.
"""
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from auth_middleware import get_current_user
from database import get_db
from helpers import serialize_doc
from services.active_probes import run_all_probes
from services.cache import get_cache
from services.fingerprint_engine import fingerprint as run_fingerprint

router = APIRouter()


# ---------- GET /api/devices ----------
@router.get("/")
def get_all_devices(current_user: dict = Depends(get_current_user)):
    db = get_db()
    devices = list(
        db.devices.find({"owner": ObjectId(current_user["id"])}).sort("lastSeen", -1)
    )
    return [serialize_doc(d) for d in devices]


# ---------- PUT /api/devices/{device_id} ----------
@router.put("/{device_id}")
def update_device_name(device_id: str, request_body: dict, current_user: dict = Depends(get_current_user)):
    db = get_db()
    custom_name = request_body.get("customName")

    if custom_name is None:
        raise HTTPException(status_code=400, detail={"message": "customName is required."})

    try:
        oid = ObjectId(device_id)
    except Exception:
        raise HTTPException(status_code=400, detail={"message": "Invalid device id."})

    device = db.devices.find_one_and_update(
        {"_id": oid, "owner": ObjectId(current_user["id"])},
        {"$set": {"customName": custom_name, "updatedAt": datetime.now(timezone.utc)}},
        return_document=True,
    )

    if not device:
        raise HTTPException(status_code=404, detail={"message": "Device not found."})

    return {"message": "Device name updated.", "device": serialize_doc(device)}


# ---------- POST /api/devices/{device_id}/fingerprint ----------
@router.post("/{device_id}/fingerprint")
def fingerprint_device(
    device_id: str,
    refresh: bool = Query(False, description="Force re-running active probes (bypass 5 min cache)"),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    try:
        oid = ObjectId(device_id)
    except Exception:
        raise HTTPException(status_code=400, detail={"message": "Invalid device id."})

    device = db.devices.find_one({"_id": oid, "owner": ObjectId(current_user["id"])})
    if not device:
        raise HTTPException(status_code=404, detail={"message": "Device not found."})

    # Active probes (TTL/HTTP/NBNS/SSDP) — cached for 5 min unless `refresh=1`.
    try:
        probes = run_all_probes(device.get("ip", ""), device.get("mac", ""), force=refresh)
    except Exception:
        probes = {}

    result = run_fingerprint(device, active_probes=probes)
    now = datetime.now(timezone.utc)

    # Persist: structured result + raw_signals snapshot + legacy flat mirrors.
    update_fields = {
        "fingerprint": result.to_dict(),
        "raw_signals": result.raw_signals,
        "lastFingerprintedAt": now,
        "updatedAt": now,
    }
    if result.os:
        update_fields["os"] = result.os
    if result.brand:
        update_fields["brand"] = result.brand
    if result.hostname:
        update_fields["hostname"] = result.hostname
    if result.device_type:
        update_fields["deviceType"] = result.device_type

    db.devices.update_one({"_id": oid}, {"$set": update_fields})

    return result.to_dict()


# ---------- GET /api/devices/{device_id}/signals ----------
@router.get("/{device_id}/signals")
def get_device_signals(device_id: str, current_user: dict = Depends(get_current_user)):
    """
    Inspect the raw cache for a device — useful for debugging / power-user
    UIs. Returns passive signals (from the sniffer), active probe cache, and
    any cross-MAC correlations.
    """
    db = get_db()
    try:
        oid = ObjectId(device_id)
    except Exception:
        raise HTTPException(status_code=400, detail={"message": "Invalid device id."})

    device = db.devices.find_one({"_id": oid, "owner": ObjectId(current_user["id"])})
    if not device:
        raise HTTPException(status_code=404, detail={"message": "Device not found."})

    mac = (device.get("mac") or "").lower()
    cache = get_cache()
    passive = cache.get_passive_signals(mac) if mac else {}

    active = {}
    for src in ("ttl", "http", "nbns", "ssdp"):
        a = cache.get_active_probe(mac, src)
        if a is not None:
            active[src] = a

    # Cross-MAC: any other macs we've seen with the same hostname/client_id?
    related: dict[str, list[str]] = {}
    host = (passive.get("dhcp") or {}).get("hostname") if isinstance(passive.get("dhcp"), dict) else None
    if host:
        macs = sorted(m for m in cache.macs_for_hostname(host) if m != mac)
        if macs:
            related["by_hostname"] = macs
    cid = (passive.get("dhcp") or {}).get("client_id") if isinstance(passive.get("dhcp"), dict) else None
    if cid:
        macs = sorted(m for m in cache.macs_for_client_id(cid) if m != mac)
        if macs:
            related["by_client_id"] = macs

    return {
        "mac": mac,
        "cache_mode": cache.mode,
        "cache_healthy": cache.healthy(),
        "passive": passive,
        "active": active,
        "related_macs": related,
        "stored_fingerprint": device.get("fingerprint"),
        "stored_raw_signals": device.get("raw_signals"),
        "last_fingerprinted_at": serialize_doc({"x": device.get("lastFingerprintedAt")})["x"] if device.get("lastFingerprintedAt") else None,
    }
