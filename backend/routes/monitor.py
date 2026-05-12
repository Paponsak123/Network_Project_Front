from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from auth_middleware import get_current_user
from services.monitor import start_monitoring, stop_monitoring, get_connections

router = APIRouter()

class MonitorRequest(BaseModel):
    ip: str
    mac: str

class ConnectionInfo(BaseModel):
    host: str
    time: float

@router.post("/start")
async def start_monitor(body: MonitorRequest, current_user: dict = Depends(get_current_user)):
    """Start capturing traffic connections for a specific device."""
    try:
        start_monitoring(body.ip, body.mac)
        return {"message": f"Monitoring started for {body.ip}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stop")
async def stop_monitor(body: MonitorRequest, current_user: dict = Depends(get_current_user)):
    """Stop capturing traffic connections."""
    stop_monitoring(body.ip)
    return {"message": f"Monitoring stopped for {body.ip}"}

@router.get("/{ip}", response_model=List[ConnectionInfo])
async def get_device_activity(ip: str, current_user: dict = Depends(get_current_user)):
    """Fetch recent connections for the device."""
    return get_connections(ip)
