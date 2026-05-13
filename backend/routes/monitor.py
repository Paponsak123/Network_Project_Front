from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from services.monitor import start_monitor, stop_monitor, get_history, manager
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/start")
async def start_monitoring(target: dict):
    target_ip = target.get("ip")
    target_mac = target.get("mac")
    if not target_ip or not target_mac:
        raise HTTPException(status_code=400, detail="IP and MAC are required")
    
    try:
        start_monitor(target_ip, target_mac)
        return {"status": "success", "message": f"Monitoring started for {target_ip}"}
    except Exception as e:
        logger.error(f"Error starting monitor: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stop")
async def stop_monitoring(target: dict):
    target_ip = target.get("ip")
    if not target_ip:
        raise HTTPException(status_code=400, detail="IP is required")
    
    try:
        stop_monitor(target_ip)
        return {"status": "success", "message": f"Monitoring stopped for {target_ip}"}
    except Exception as e:
        logger.error(f"Error stopping monitor: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{target_ip}")
async def get_monitor_history(target_ip: str):
    try:
        history = get_history(target_ip)
        return history
    except Exception as e:
        logger.error(f"Error getting history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- [ NEW: WebSocket Endpoint ] ---
@router.websocket("/ws/{target_ip}")
async def websocket_monitor(websocket: WebSocket, target_ip: str):
    print(f"📡 DEBUG: Incoming WebSocket request for device: {target_ip}")
    await manager.connect(websocket, target_ip)
    logger.info(f"🔌 WebSocket connected: {target_ip}")
    
    # ส่งข้อมูลชุดแรกให้ทันทีที่ต่อสายสำเร็จ (ป้องกัน Error ในการ Serialize)
    try:
        initial_data = get_history(target_ip)
        await websocket.send_json({"type": "initial", "data": initial_data})
    except Exception as e:
        logger.error(f"❌ Failed to send initial data: {e}")
    
    try:
        while True:
            # คอยฟังเผื่อ Client ส่งอะไรมา (หรือแค่รอให้สายยังเปิดอยู่)
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, target_ip)
        logger.info(f"❌ WebSocket disconnected: {target_ip}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, target_ip)
