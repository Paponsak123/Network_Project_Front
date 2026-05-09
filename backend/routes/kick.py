"""
Kick routes — ARP spoof to disconnect/reconnect devices.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_middleware import get_current_user
from services.arp_spoof import start_spoof, stop_spoof, get_active_spoofs

router = APIRouter()


class KickRequest(BaseModel):
    ip: str
    mac: str


class StopKickRequest(BaseModel):
    ip: str


# ---------- POST /api/kick/ ----------
@router.post("/")
def kick_device(body: KickRequest, current_user: dict = Depends(get_current_user)):
    """Start ARP spoofing to disconnect a device from the network."""
    success = start_spoof(body.ip, body.mac)
    if not success:
        raise HTTPException(status_code=409, detail={"message": f"{body.ip} is already being kicked."})
    return {"message": f"🚫 Kicked {body.ip} ({body.mac}) from the network.", "ip": body.ip}


# ---------- POST /api/kick/stop ----------
@router.post("/stop")
def stop_kick(body: StopKickRequest, current_user: dict = Depends(get_current_user)):
    """Stop ARP spoofing and restore normal network for the device."""
    success = stop_spoof(body.ip)
    if not success:
        raise HTTPException(status_code=404, detail={"message": f"{body.ip} is not being kicked."})
    return {"message": f"✅ Released {body.ip} back to the network.", "ip": body.ip}


# ---------- GET /api/kick/active ----------
@router.get("/active")
def list_active_kicks(current_user: dict = Depends(get_current_user)):
    """List all devices currently being kicked."""
    return get_active_spoofs()
