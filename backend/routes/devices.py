"""
Device routes — list devices, update custom name.
Replaces: routes/deviceRoutes.js + controllers/deviceController.js
"""
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends

from auth_middleware import get_current_user
from database import get_db
from helpers import serialize_doc

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
        return {"message": "customName is required."}, 400

    device = db.devices.find_one_and_update(
        {"_id": ObjectId(device_id), "owner": ObjectId(current_user["id"])},
        {"$set": {"customName": custom_name, "updatedAt": datetime.now(timezone.utc)}},
        return_document=True,
    )

    if not device:
        return {"message": "Device not found."}, 404

    return {"message": "Device name updated.", "device": serialize_doc(device)}


# ---------- POST /api/devices/{device_id}/fingerprint ----------
from services.network import detect_os

@router.post("/{device_id}/fingerprint")
def fingerprint_device(device_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    device = db.devices.find_one({"_id": ObjectId(device_id), "owner": ObjectId(current_user["id"])})
    
    if not device:
        return {"message": "Device not found."}, 404
        
    # Perform active OS detection
    os_details = detect_os(device["ip"])
    
    # Update DB
    db.devices.update_one(
        {"_id": ObjectId(device_id)},
        {"$set": {"os": os_details, "updatedAt": datetime.now(timezone.utc)}}
    )
    
    return {"message": "Fingerprinting complete.", "os": os_details}
