"""
Peer-to-peer transfer routes.

This module provides:
  - WS  /api/transfer/ws        signalling channel (auth via ?token=JWT)
  - GET /api/transfer/peers     currently-connected peers (REST)
  - GET /api/transfer/lan       ScanDer instances discovered via mDNS on LAN

The websocket protocol is intentionally tiny:

    client → server          server → client
    ---------------          ---------------
    hello {capabilities}     registered {peer_id, self}
    list                     peers {peers: [...]}
    signal {to, payload}     signal {from, payload}     (forwarded)
    text   {to, body}        text   {from, body}        (forwarded)
    ping                     pong

The server also emits unsolicited:
    peer-joined {peer}
    peer-left   {peer_id}
    error       {message}

All file/voice/etc. content travels over a WebRTC data channel established
between the two peers using SDP/ICE exchanged via `signal` envelopes. The
backend never sees the content.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from auth_middleware import get_current_user
from services.mdns_advertiser import browse_active_peers, is_available as mdns_available
from services.peer_registry import MAX_PEER_MESSAGE_BYTES, get_registry

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _decode_jwt_or_close_token(token: Optional[str]) -> Optional[dict]:
    """Same decoding as auth_middleware but suitable for WS query-param auth."""
    if not token:
        return None
    secret = os.getenv("JWT_SECRET")
    if not secret:
        return None
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _client_ip(ws: WebSocket) -> Optional[str]:
    try:
        if ws.client and ws.client.host:
            return ws.client.host
    except Exception:
        pass
    # Behind a proxy?
    fwd = ws.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return None


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------
@router.get("/peers")
def list_peers(current_user: dict = Depends(get_current_user)):
    """List currently-connected signalling peers (other than the caller)."""
    reg = get_registry()
    return {
        "count": reg.count(),
        "peers": reg.list_public(),
    }


@router.get("/lan")
def list_lan(current_user: dict = Depends(get_current_user)):
    """Discover other ScanDer instances on the LAN via mDNS."""
    if not mdns_available():
        return {"available": False, "peers": []}
    peers = browse_active_peers(timeout=1.5)
    return {"available": True, "peers": peers}


# ---------------------------------------------------------------------------
# WebSocket signalling
# ---------------------------------------------------------------------------
@router.websocket("/ws")
async def transfer_ws(
    websocket: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    user = _decode_jwt_or_close_token(token)
    if not user or "id" not in user:
        # 4401 — application-defined "auth failed"
        await websocket.close(code=4401)
        return

    await websocket.accept()
    reg = get_registry()
    ip = _client_ip(websocket)

    # Wait for the client's hello — limited time so we don't hold idle sockets.
    try:
        hello = await websocket.receive_json()
    except (WebSocketDisconnect, ValueError):
        try:
            await websocket.close(code=4400)
        except Exception:
            pass
        return

    if not isinstance(hello, dict) or hello.get("type") != "hello":
        await websocket.send_json({"type": "error", "message": "First message must be {type:'hello'}"})
        await websocket.close(code=4400)
        return

    username = user.get("username") or hello.get("username") or "anonymous"
    caps = hello.get("capabilities")
    if not isinstance(caps, list):
        caps = ["text", "file"]
    caps = [c for c in caps if isinstance(c, str) and len(c) < 32][:8]

    peer = await reg.register(
        websocket=websocket,
        user_id=str(user["id"]),
        username=username,
        ip=ip,
        capabilities=caps,
    )

    # Tell the client who they are + initial peer list.
    try:
        await websocket.send_json({
            "type": "registered",
            "peer_id": peer.peer_id,
            "self": peer.public_dict(),
            "peers": reg.list_public(exclude=peer.peer_id),
        })
    except Exception:
        await reg.unregister(peer.peer_id)
        return

    # Main receive loop.
    try:
        while True:
            try:
                msg = await websocket.receive_json()
            except ValueError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            if not isinstance(msg, dict):
                continue

            mtype = msg.get("type")

            if mtype == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if mtype == "list":
                await websocket.send_json({
                    "type": "peers",
                    "peers": reg.list_public(exclude=peer.peer_id),
                })
                continue

            if mtype == "signal":
                to = msg.get("to")
                payload = msg.get("payload")
                if not isinstance(to, str) or payload is None:
                    await websocket.send_json({"type": "error", "message": "signal needs `to` and `payload`"})
                    continue
                # Cheap size guard on the envelope.
                try:
                    if len(str(payload)) > MAX_PEER_MESSAGE_BYTES:
                        await websocket.send_json({"type": "error", "message": "payload too large"})
                        continue
                except Exception:
                    pass
                ok = await reg.route_signal(peer, to, payload)
                if not ok:
                    await websocket.send_json({"type": "error", "message": f"peer {to} not found"})
                continue

            if mtype == "text":
                to = msg.get("to")
                body = msg.get("body")
                if not isinstance(to, str) or not isinstance(body, str):
                    await websocket.send_json({"type": "error", "message": "text needs `to` and `body`"})
                    continue
                ok = await reg.relay_text(peer, to, body)
                if not ok:
                    await websocket.send_json({"type": "error", "message": "text relay failed"})
                continue

            await websocket.send_json({"type": "error", "message": f"unknown type {mtype!r}"})

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("transfer ws crashed for peer %s", peer.peer_id)
    finally:
        await reg.unregister(peer.peer_id)
