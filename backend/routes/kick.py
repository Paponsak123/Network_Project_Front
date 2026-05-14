"""
Routes for the "kick" feature (ARP spoofing based device disconnect).
Replaces the previous thin wrapper around start_kick/stop_kick.

The route layer:
  - Validates and normalises input (IP/MAC) via Pydantic
  - Maps service-level ValueError → HTTP 400 (bad input)
  - Maps unexpected exceptions → HTTP 500 with a logged stack trace
  - Returns the richer status dict produced by the service so the UI can show
    interface / gateway / "is this kick actually working?".
"""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth_middleware import get_current_user
from services.arp_spoof import (
    get_active_kicks,
    normalize_mac,
    start_kick,
    stop_kick,
    validate_ip,
)

logger = logging.getLogger(__name__)
router = APIRouter(redirect_slashes=False)


# --- input models ----------------------------------------------------------
class KickRequest(BaseModel):
    ip: str = Field(..., min_length=7, max_length=15)
    mac: str = Field(..., min_length=11, max_length=17)
    mode: str = Field("kick", pattern="^(kick|redirect)$")

    @field_validator("ip")
    @classmethod
    def _ip_must_be_valid(cls, v: str) -> str:
        out = validate_ip(v)
        if not out:
            raise ValueError("Invalid IPv4 address")
        return out

    @field_validator("mac")
    @classmethod
    def _mac_must_be_valid(cls, v: str) -> str:
        out = normalize_mac(v)
        if not out:
            raise ValueError("Invalid MAC address")
        return out


class StopKickRequest(BaseModel):
    ip: str = Field(..., min_length=7, max_length=15)

    @field_validator("ip")
    @classmethod
    def _ip_must_be_valid(cls, v: str) -> str:
        out = validate_ip(v)
        if not out:
            raise ValueError("Invalid IPv4 address")
        return out


# --- routes ----------------------------------------------------------------
@router.post("")
def kick_device(body: KickRequest, current_user: dict = Depends(get_current_user)):
    """Start ARP spoofing to disconnect a device from the network."""
    try:
        status = start_kick(body.ip, body.mac, mode=body.mode)
    except ValueError as e:
        # Input/preflight problem — user can fix this.
        raise HTTPException(status_code=400, detail={"message": str(e)})
    except Exception as e:
        logger.exception("kick failed for %s/%s", body.ip, body.mac)
        raise HTTPException(status_code=500, detail={"message": f"Internal error: {e}"})

    return {
        "message": f"Kicked {body.ip} ({body.mac}) from the network.",
        **status,
    }


@router.post("/stop")
def release_device(body: StopKickRequest, current_user: dict = Depends(get_current_user)):
    """Stop ARP spoofing and restore connection for a device."""
    try:
        status = stop_kick(body.ip)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})
    except Exception as e:
        logger.exception("stop_kick failed for %s", body.ip)
        raise HTTPException(status_code=500, detail={"message": f"Internal error: {e}"})

    if not status.get("stopped"):
        # Not really an error — caller asked us to stop something that wasn't running.
        return {"message": f"No active kick for {body.ip}.", **status}

    return {"message": f"Released {body.ip}.", **status}


@router.get("/active")
def active_kicks(current_user: dict = Depends(get_current_user)):
    """Get list of currently active kicks with effectiveness info."""
    return get_active_kicks()
