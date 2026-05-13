"""
Redis-backed cache for fingerprint signals.

Why it exists separately from fingerprint.py / fingerprint_engine.py:
  - Decouples storage from the sniffer / engine — we can swap Redis for
    something else later by reimplementing this class only.
  - Centralises namespacing, TTLs, serialisation and the in-memory fallback.

Resilience:
  - On startup we ping Redis. If it's unreachable we silently fall back to an
    in-memory dict so the fingerprint pipeline still works (degraded — no
    cross-worker sharing or persistence).
  - When a Redis call fails mid-flight we log a warning, set mode='memory',
    and let the operation succeed against the in-memory store. A background
    thread retries the connection every 30 s and flips back to 'redis' when
    it succeeds.

Key schema (with namespace prefix, default "scander"):
  {ns}:fp:passive:{mac}            HASH   per-source JSON, EXPIRE 24h sliding
  {ns}:fp:active:{mac}:{source}    STRING JSON, EXPIRE 5m (default)
  {ns}:fp:idx:client_id:{cid}      SET    of macs, EXPIRE 24h
  {ns}:fp:idx:hostname:{name}      SET    of macs, EXPIRE 24h
  {ns}:fp:lock:{name}              STRING NX-lock, caller-defined TTL
"""

from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator, Optional

try:
    import redis as _redis  # type: ignore
    from redis.exceptions import RedisError, ConnectionError as RedisConnectionError  # type: ignore
    _REDIS_AVAILABLE = True
except Exception:  # pragma: no cover
    _redis = None
    RedisError = Exception  # type: ignore
    RedisConnectionError = Exception  # type: ignore
    _REDIS_AVAILABLE = False

logger = logging.getLogger(__name__)

PASSIVE_TTL_SEC = 24 * 3600
ACTIVE_DEFAULT_TTL_SEC = 300
INDEX_TTL_SEC = 24 * 3600
RECONNECT_INTERVAL_SEC = 30.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FingerprintCache:
    def __init__(self, url: str, namespace: str = "scander"):
        self._url = url
        self._ns = namespace.rstrip(":") or "scander"
        self._mode = "memory"
        self._r: Optional[Any] = None
        # In-memory fallback structures (also used while Redis is reconnecting).
        self._mem_passive: dict[str, dict[str, str]] = {}
        self._mem_active: dict[str, tuple[str, float]] = {}   # full_key → (json, expires_at)
        self._mem_idx: dict[str, set[str]] = {}
        self._mem_lock = threading.RLock()
        self._reconnect_started = False

        if _REDIS_AVAILABLE:
            try:
                self._r = _redis.Redis.from_url(
                    url,
                    decode_responses=True,
                    socket_timeout=2,
                    socket_connect_timeout=2,
                    health_check_interval=30,
                )
                self._r.ping()
                self._mode = "redis"
                logger.info("FingerprintCache: connected to Redis at %s", url)
            except Exception as e:
                logger.warning(
                    "FingerprintCache: Redis unavailable (%s); using in-memory fallback", e
                )
                self._r = None
                self._mode = "memory"
        else:
            logger.warning(
                "FingerprintCache: redis-py not importable; using in-memory fallback"
            )

        self._start_reconnect_loop()

    # ------------------------------------------------------------------
    # Health / connection
    # ------------------------------------------------------------------
    def healthy(self) -> bool:
        if self._mode == "redis" and self._r is not None:
            try:
                return bool(self._r.ping())
            except RedisError:
                return False
        return False

    @property
    def mode(self) -> str:
        return self._mode

    def _start_reconnect_loop(self) -> None:
        if self._reconnect_started or not _REDIS_AVAILABLE:
            return
        self._reconnect_started = True

        def loop() -> None:
            while True:
                time.sleep(RECONNECT_INTERVAL_SEC)
                if self._mode == "redis":
                    continue
                try:
                    r = _redis.Redis.from_url(self._url, decode_responses=True, socket_timeout=2)
                    r.ping()
                    self._r = r
                    self._mode = "redis"
                    logger.info("FingerprintCache: Redis reconnected")
                except Exception:
                    pass

        threading.Thread(target=loop, daemon=True, name="redis-reconnect").start()

    def _degrade(self, reason: str) -> None:
        if self._mode != "memory":
            logger.warning("FingerprintCache: degrading to memory mode (%s)", reason)
            self._mode = "memory"

    # ------------------------------------------------------------------
    # Key helpers
    # ------------------------------------------------------------------
    def _k_passive(self, mac: str) -> str:
        return f"{self._ns}:fp:passive:{mac.lower()}"

    def _k_active(self, mac: str, source: str) -> str:
        return f"{self._ns}:fp:active:{mac.lower()}:{source}"

    def _k_idx_client_id(self, cid: str) -> str:
        return f"{self._ns}:fp:idx:client_id:{cid}"

    def _k_idx_hostname(self, name: str) -> str:
        return f"{self._ns}:fp:idx:hostname:{name.lower()}"

    def _k_lock(self, name: str) -> str:
        return f"{self._ns}:fp:lock:{name}"

    # ------------------------------------------------------------------
    # Passive signals (sniffer writes here)
    # ------------------------------------------------------------------
    def add_passive_signal(self, mac: str, source: str, payload: dict) -> None:
        """
        Merge a freshly-sniffed signal for (mac, source). Existing payload for
        the same source is preserved as an `_history` array (capped at 5) so we
        keep recent variants without unbounded growth.
        """
        if not mac or not source:
            return
        payload = dict(payload)
        payload.setdefault("seen_at", _now_iso())

        key = self._k_passive(mac)

        if self._mode == "redis" and self._r is not None:
            try:
                existing = self._r.hget(key, source)
                merged = self._merge_payload(existing, payload, source)
                pipe = self._r.pipeline()
                pipe.hset(key, source, json.dumps(merged))
                pipe.hset(key, "meta", json.dumps({
                    "first_seen": json.loads(self._r.hget(key, "meta") or '{"first_seen":null}').get("first_seen") or payload["seen_at"],
                    "last_updated": payload["seen_at"],
                }))
                pipe.expire(key, PASSIVE_TTL_SEC)
                pipe.execute()
                return
            except RedisError as e:
                self._degrade(f"add_passive_signal: {e}")

        # in-memory fallback
        with self._mem_lock:
            entry = self._mem_passive.setdefault(mac.lower(), {})
            merged = self._merge_payload(entry.get(source), payload, source)
            entry[source] = json.dumps(merged)
            meta = json.loads(entry.get("meta") or '{}')
            entry["meta"] = json.dumps({
                "first_seen": meta.get("first_seen") or payload["seen_at"],
                "last_updated": payload["seen_at"],
            })

    @staticmethod
    def _merge_payload(existing_json: Optional[str], new_payload: dict, source: str) -> dict:
        """
        Merge strategy:
          - mdns / ssdp / nbns hostnames are list-like — append new entries (capped 5)
          - other sources overwrite scalar fields, but preserve _history
        """
        try:
            old = json.loads(existing_json) if existing_json else {}
        except Exception:
            old = {}

        merged = {**old, **new_payload}
        history = list(old.get("_history") or [])
        if old:
            # Snapshot the previous payload (without _history field to avoid bloat).
            snapshot = {k: v for k, v in old.items() if k != "_history"}
            if snapshot and snapshot != new_payload:
                history.append(snapshot)
                history = history[-5:]
        if history:
            merged["_history"] = history
        return merged

    def get_passive_signals(self, mac: str) -> dict:
        """Return all sources merged into a single dict; {} if nothing cached."""
        key = self._k_passive(mac)
        raw: dict[str, str] = {}

        if self._mode == "redis" and self._r is not None:
            try:
                raw = self._r.hgetall(key) or {}
            except RedisError as e:
                self._degrade(f"get_passive_signals: {e}")

        if not raw:
            with self._mem_lock:
                raw = dict(self._mem_passive.get(mac.lower(), {}))

        out: dict = {}
        for source, val in raw.items():
            try:
                out[source] = json.loads(val)
            except Exception:
                out[source] = val
        return out

    # ------------------------------------------------------------------
    # Active probe results (short TTL)
    # ------------------------------------------------------------------
    def cache_active_probe(self, mac: str, source: str, result: dict, ttl: int = ACTIVE_DEFAULT_TTL_SEC) -> None:
        if not mac or not source:
            return
        payload = dict(result)
        payload.setdefault("probed_at", _now_iso())
        key = self._k_active(mac, source)

        if self._mode == "redis" and self._r is not None:
            try:
                self._r.set(key, json.dumps(payload), ex=ttl)
                return
            except RedisError as e:
                self._degrade(f"cache_active_probe: {e}")

        with self._mem_lock:
            self._mem_active[key] = (json.dumps(payload), time.time() + ttl)

    def get_active_probe(self, mac: str, source: str) -> Optional[dict]:
        key = self._k_active(mac, source)
        raw: Optional[str] = None

        if self._mode == "redis" and self._r is not None:
            try:
                raw = self._r.get(key)
            except RedisError as e:
                self._degrade(f"get_active_probe: {e}")

        if raw is None:
            with self._mem_lock:
                tup = self._mem_active.get(key)
                if tup:
                    val, expires = tup
                    if expires > time.time():
                        raw = val
                    else:
                        self._mem_active.pop(key, None)

        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Secondary indexes (for cross-MAC correlation)
    # ------------------------------------------------------------------
    def index_client_id(self, client_id: str, mac: str) -> None:
        if not client_id or not mac:
            return
        key = self._k_idx_client_id(client_id)
        if self._mode == "redis" and self._r is not None:
            try:
                pipe = self._r.pipeline()
                pipe.sadd(key, mac.lower())
                pipe.expire(key, INDEX_TTL_SEC)
                pipe.execute()
                return
            except RedisError as e:
                self._degrade(f"index_client_id: {e}")
        with self._mem_lock:
            self._mem_idx.setdefault(key, set()).add(mac.lower())

    def macs_for_client_id(self, client_id: str) -> set[str]:
        return self._read_index(self._k_idx_client_id(client_id))

    def index_hostname(self, hostname: str, mac: str) -> None:
        if not hostname or not mac:
            return
        key = self._k_idx_hostname(hostname)
        if self._mode == "redis" and self._r is not None:
            try:
                pipe = self._r.pipeline()
                pipe.sadd(key, mac.lower())
                pipe.expire(key, INDEX_TTL_SEC)
                pipe.execute()
                return
            except RedisError as e:
                self._degrade(f"index_hostname: {e}")
        with self._mem_lock:
            self._mem_idx.setdefault(key, set()).add(mac.lower())

    def macs_for_hostname(self, hostname: str) -> set[str]:
        return self._read_index(self._k_idx_hostname(hostname))

    def _read_index(self, key: str) -> set[str]:
        if self._mode == "redis" and self._r is not None:
            try:
                return set(self._r.smembers(key) or [])
            except RedisError as e:
                self._degrade(f"_read_index: {e}")
        with self._mem_lock:
            return set(self._mem_idx.get(key, set()))

    # ------------------------------------------------------------------
    # Locks (sniffer election etc.)
    # ------------------------------------------------------------------
    @contextmanager
    def lock(self, name: str, ttl_sec: int = 60) -> Iterator[bool]:
        """
        Try-acquire a Redis lock. Yields True if we got it, False otherwise.
        In memory fallback this is a process-local lock dict; works for a
        single process which is exactly what we want for the sniffer.
        """
        key = self._k_lock(name)
        acquired = False
        if self._mode == "redis" and self._r is not None:
            try:
                acquired = bool(self._r.set(key, "1", ex=ttl_sec, nx=True))
            except RedisError as e:
                self._degrade(f"lock acquire: {e}")
        if not acquired and self._mode == "memory":
            with self._mem_lock:
                if key not in self._mem_idx.get("__locks__", set()):
                    self._mem_idx.setdefault("__locks__", set()).add(key)
                    acquired = True
        try:
            yield acquired
        finally:
            if acquired:
                if self._mode == "redis" and self._r is not None:
                    try:
                        self._r.delete(key)
                    except RedisError:
                        pass
                with self._mem_lock:
                    self._mem_idx.get("__locks__", set()).discard(key)

    def refresh_lock(self, name: str, ttl_sec: int = 60) -> bool:
        """Extend the TTL of a lock we already hold."""
        key = self._k_lock(name)
        if self._mode == "redis" and self._r is not None:
            try:
                return bool(self._r.expire(key, ttl_sec))
            except RedisError as e:
                self._degrade(f"refresh_lock: {e}")
        return True  # in-memory locks don't expire

    # ------------------------------------------------------------------
    # Maintenance / persistence
    # ------------------------------------------------------------------
    def iter_macs_with_passive_signals(self) -> Iterator[str]:
        """SCAN the passive key namespace (Redis) or walk the dict (memory)."""
        prefix = f"{self._ns}:fp:passive:"
        if self._mode == "redis" and self._r is not None:
            try:
                for raw_key in self._r.scan_iter(match=f"{prefix}*", count=200):
                    yield raw_key[len(prefix):]
                return
            except RedisError as e:
                self._degrade(f"scan: {e}")
        with self._mem_lock:
            for mac in list(self._mem_passive.keys()):
                yield mac

    def seed_from_dict(self, mac: str, signals: dict) -> None:
        """Used at startup to warm cache from MongoDB raw_signals."""
        if not mac or not isinstance(signals, dict):
            return
        for source, payload in signals.items():
            if not isinstance(payload, dict) or source == "meta":
                continue
            self.add_passive_signal(mac, source, payload)


# ---------------------------------------------------------------------------
# Module-level singleton (initialised by callers from env)
# ---------------------------------------------------------------------------
_cache: Optional[FingerprintCache] = None
_cache_lock = threading.Lock()


def get_cache() -> FingerprintCache:
    global _cache
    with _cache_lock:
        if _cache is None:
            import os
            url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
            ns = os.getenv("REDIS_NAMESPACE", "scander")
            _cache = FingerprintCache(url=url, namespace=ns)
        return _cache
