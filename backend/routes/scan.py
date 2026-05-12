import asyncio
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from pymongo import ReturnDocument
from slowapi import Limiter
from slowapi.util import get_remote_address

from auth_middleware import get_current_user
from database import get_db
from helpers import serialize_doc
from services.network import perform_full_scan

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# ---------- Models ----------
class DeviceSnapshot(BaseModel):
    ip: str
    mac: str
    vendor: str
    deviceType: str
    status: str
    ports: List[int]

class ScanResponse(BaseModel):
    message: str
    scanId: str
    totalDevices: int
    devices: List[dict]

# ---------- POST /api/scan ----------
@router.post("/", response_model=ScanResponse)
@limiter.limit("8/minute")
async def trigger_scan(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    """Trigger a network scan. Rate limited to 1 per minute."""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)

    try:
        # ✅ Performance: Run blocking scan in a thread pool
        discovered = await asyncio.to_thread(perform_full_scan)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")

    if not discovered:
        return {
            "message": "Scan complete. No devices discovered.",
            "scanId": "",
            "totalDevices": 0,
            "devices": []
        }

    # Upsert each device (keyed by MAC + owner)
    saved_devices = []
    for device in discovered:
        doc = db.devices.find_one_and_update(
            {"mac": device["mac"], "owner": ObjectId(user_id)},
            {"$set": {
                "ip": device["ip"],
                "vendor": device["vendor"],
                "deviceType": device["deviceType"],
                "status": device["status"],
                "ports": device["ports"],
                "lastSeen": device["lastSeen"],
                "updatedAt": now,
            },
            "$setOnInsert": {
                "customName": "",
                "createdAt": now,
            }},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        saved_devices.append(serialize_doc(doc))

    # Build snapshots for scan history
    snapshots = [{
        "ip": d["ip"], "mac": d["mac"], "vendor": d["vendor"],
        "deviceType": d["deviceType"], "status": d["status"], "ports": d["ports"],
    } for d in saved_devices]

    # Save scan record
    scan_doc = {
        "scannedBy": ObjectId(user_id),
        "scanTime": now,
        "totalDevices": len(snapshots),
        "devices": snapshots,
        "createdAt": now,
        "updatedAt": now,
    }
    result = db.scans.insert_one(scan_doc)

    return {
        "message": "Scan complete.",
        "scanId": str(result.inserted_id),
        "totalDevices": len(snapshots),
        "devices": saved_devices,
    }


# ---------- GET /api/scan/history ----------
@router.get("/history")
async def get_scan_history(
    page: int = 1,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    """Get scan history with pagination."""
    user_id = current_user["id"]
    skip = (page - 1) * limit

    pipeline = [
        {"$match": {"scannedBy": ObjectId(user_id)}},
        {"$lookup": {
            "from": "users",
            "localField": "scannedBy",
            "foreignField": "_id",
            "as": "scannedByUser",
        }},
        {"$sort": {"scanTime": -1}},
        {"$skip": skip},
        {"$limit": limit},
    ]

    scans = list(db.scans.aggregate(pipeline))

    result = []
    for scan in scans:
        s = serialize_doc(scan)
        if s.get("scannedByUser") and len(s["scannedByUser"]) > 0:
            s["scannedBy"] = {
                "_id": s["scannedByUser"][0]["_id"],
                "username": s["scannedByUser"][0]["username"],
            }
        del s["scannedByUser"]
        result.append(s)

    return result


# ---------- GET /api/scan/latest ----------
@router.get("/latest")
async def get_latest_scan(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    user_id = current_user["id"]

    latest_scan = db.scans.find_one(
        {"scannedBy": ObjectId(user_id)},
        sort=[("scanTime", -1)]
    )

    if not latest_scan:
        return {"devices": [], "scanTime": None, "totalDevices": 0}

    s = serialize_doc(latest_scan)
    return {
        "devices": s.get("devices", []),
        "scanTime": s.get("scanTime"),
        "totalDevices": s.get("totalDevices", 0)
    }