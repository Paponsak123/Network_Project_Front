"""
WebSocket peer registry for peer-to-peer transfer signalling.

Each user who connects gets a `peer_id` (random uuid). The registry routes
signalling envelopes between peers without inspecting their content — the
actual data channel (WebRTC) is established directly between the two
clients. The backend only sees:

  - hello / registration messages
  - peer list requests
  - opaque "signal" envelopes (forwarded by peer_id)
  - optional plain text relays (for the simple chat fallback)

Memory model:
  All state lives in this process. For a single-worker FastAPI deployment
  (which is what we recommend for ScanDer — see fingerprint.py for why) this
  is correct. If we later scale to multiple workers, a Redis pub/sub layer
  could replace `_broadcast` without changing the public API.

Concurrency:
  WebSocket is async — every public method here is async too, and uses a
  single asyncio.Lock to protect the peers dict during register/unregister.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# A safety cap so a runaway client can't fill memory with garbage.
MAX_PEER_MESSAGE_BYTES = 64 * 1024  # 64 KB per signaling envelope
KEEPALIVE_INTERVAL_SEC = 25.0


@dataclass
class Peer:
    peer_id: str
    user_id: str
    username: str
    ip: Optional[str]
    websocket: WebSocket
    joined_at: float = field(default_factory=time.time)
    capabilities: list[str] = field(default_factory=lambda: ["text", "file"])

    def public_dict(self) -> dict:
        """Information shared with other peers (no websocket, no secrets)."""
        return {
            "peer_id": self.peer_id,
            "user_id": self.user_id,
            "username": self.username,
            "ip": self.ip,
            "joined_at": self.joined_at,
            "capabilities": self.capabilities,
        }


class PeerRegistry:
    def __init__(self) -> None:
        self._peers: dict[str, Peer] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    async def register(
        self,
        websocket: WebSocket,
        user_id: str,
        username: str,
        ip: Optional[str] = None,
        capabilities: Optional[list[str]] = None,
    ) -> Peer:
        peer = Peer(
            peer_id=str(uuid.uuid4()),
            user_id=str(user_id),
            username=username or "anonymous",
            ip=ip,
            websocket=websocket,
            capabilities=capabilities or ["text", "file"],
        )
        async with self._lock:
            self._peers[peer.peer_id] = peer
        logger.info("peer registered: %s (%s, ip=%s)", peer.peer_id, peer.username, peer.ip)

        # Announce to everyone else.
        await self._broadcast(
            {"type": "peer-joined", "peer": peer.public_dict()},
            exclude=peer.peer_id,
        )
        return peer

    async def unregister(self, peer_id: str) -> None:
        peer: Optional[Peer] = None
        async with self._lock:
            peer = self._peers.pop(peer_id, None)
        if not peer:
            return
        logger.info("peer unregistered: %s (%s)", peer_id, peer.username)
        await self._broadcast(
            {"type": "peer-left", "peer_id": peer_id},
            exclude=peer_id,
        )

    # ------------------------------------------------------------------
    # Querying
    # ------------------------------------------------------------------
    def list_public(self, exclude: Optional[str] = None) -> list[dict]:
        """List of peers safe to expose externally. Sync — reads only."""
        return [
            p.public_dict()
            for pid, p in self._peers.items()
            if pid != exclude
        ]

    def get(self, peer_id: str) -> Optional[Peer]:
        return self._peers.get(peer_id)

    def count(self) -> int:
        return len(self._peers)

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------
    async def route_signal(self, sender: Peer, to_peer_id: str, payload: Any) -> bool:
        """
        Forward an opaque signaling envelope (WebRTC SDP/ICE, etc.) from
        `sender` to `to_peer_id`. Returns True on success, False if the
        target doesn't exist or its socket is dead.
        """
        target = self._peers.get(to_peer_id)
        if not target:
            return False
        envelope = {
            "type": "signal",
            "from": sender.peer_id,
            "from_username": sender.username,
            "payload": payload,
        }
        return await self._safe_send(target, envelope)

    async def relay_text(self, sender: Peer, to_peer_id: str, body: str) -> bool:
        """
        Plain-text relay (small chat fallback when WebRTC isn't established).
        File transfers should NOT use this path — they should go through
        signal() to set up a WebRTC data channel.
        """
        if len(body.encode("utf-8")) > MAX_PEER_MESSAGE_BYTES:
            return False
        target = self._peers.get(to_peer_id)
        if not target:
            return False
        return await self._safe_send(target, {
            "type": "text",
            "from": sender.peer_id,
            "from_username": sender.username,
            "body": body,
        })

    async def send_to(self, peer_id: str, message: dict) -> bool:
        target = self._peers.get(peer_id)
        if not target:
            return False
        return await self._safe_send(target, message)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _broadcast(self, message: dict, exclude: Optional[str] = None) -> None:
        peers = list(self._peers.values())
        for peer in peers:
            if exclude and peer.peer_id == exclude:
                continue
            await self._safe_send(peer, message)

    async def _safe_send(self, peer: Peer, message: dict) -> bool:
        try:
            await peer.websocket.send_json(message)
            return True
        except Exception as e:
            # Socket is gone — schedule cleanup but don't block this call.
            logger.warning("send to %s failed (%s); unregistering", peer.peer_id, e)
            try:
                await self.unregister(peer.peer_id)
            except Exception:
                pass
            return False


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
_registry: Optional[PeerRegistry] = None


def get_registry() -> PeerRegistry:
    global _registry
    if _registry is None:
        _registry = PeerRegistry()
    return _registry
