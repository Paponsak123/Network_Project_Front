"""
Wi-Fi route — get the current Wi-Fi SSID.
"""
from fastapi import APIRouter

from services.wifi import get_current_ssid

router = APIRouter()


# ---------- GET /api/wifi/ssid ----------
@router.get("/ssid")
def wifi_ssid():
    """Get the SSID of the currently connected Wi-Fi network."""
    return get_current_ssid()
