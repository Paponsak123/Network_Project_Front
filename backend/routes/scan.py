"""
Scan routes — trigger scan, get history.
Replaces: routes/scanRoutes.js + controllers/scanController.js
"""
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends
from pymongo import ReturnDocument

from auth_middleware import get_current_user
from database import get_db
from helpers import serialize_doc
from services.network import perform_full_scan

router = APIRouter()


# ---------- POST /api/scan ----------
@router.post("/")
def trigger_scan(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = current_user["id"]

    discovered = perform_full_scan()

    # Safety filter
    discovered = [
        d for d in discovered
        if not d["ip"].endswith(".255") and d["mac"] != "ff:ff:ff:ff:ff:ff"
    ]

    if len(discovered) == 0:
        return {"message": "Scan complete. No devices discovered.", "totalDevices": 0, "devices": []}

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
                "updatedAt": datetime.now(timezone.utc),
            },
            "$setOnInsert": {
                "customName": "",
                "createdAt": datetime.now(timezone.utc),
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
        "scanTime": datetime.now(timezone.utc),
        "totalDevices": len(snapshots),
        "devices": snapshots,
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc),
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
def get_scan_history(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = current_user["id"]

    pipeline = [
        {"$match": {"scannedBy": ObjectId(user_id)}},
        {"$lookup": {
            "from": "users",
            "localField": "scannedBy",
            "foreignField": "_id",
            "as": "scannedByUser",
        }},
        {"$sort": {"scanTime": -1}},
    ]

    scans = list(db.scans.aggregate(pipeline))

    result = []
    for scan in scans:
        s = serialize_doc(scan)
        # Populate scannedBy with username (like Mongoose .populate)
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
def get_latest_scan(current_user: dict = Depends(get_current_user)):
    db = get_db()
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