import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

load_dotenv()

from database import connect, close
from routes import auth, scan, devices, kick, monitor

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: connect MongoDB, warm fingerprint cache, start sniffer + flush.
    Shutdown: stop kicks, flush cache to DB, close connection."""
    import asyncio
    import threading
    import time
    from datetime import datetime, timezone
    from database import connect, close, get_db
    from services.monitor import set_main_loop
    from services.fingerprint import start_fingerprinting
    from services.arp_spoof import stop_all_kicks
    from services.cache import get_cache

    log = logging.getLogger(__name__)

    set_main_loop(asyncio.get_running_loop())
    connect()

    # Initialise the cache (loads Redis client or falls back to in-memory).
    cache = get_cache()
    log.info("FingerprintCache mode=%s", cache.mode)

    # Warm cache from MongoDB.raw_signals so we don't lose context on restart.
    try:
        db = get_db()
        if db is not None:
            seeded = 0
            for dev in db.devices.find({"raw_signals": {"$exists": True}}, {"mac": 1, "raw_signals": 1}):
                mac = (dev.get("mac") or "").lower()
                signals = dev.get("raw_signals") or {}
                passive = signals.get("passive") if isinstance(signals, dict) else None
                if mac and isinstance(passive, dict):
                    cache.seed_from_dict(mac, passive)
                    seeded += 1
            if seeded:
                log.info("Warmed fingerprint cache from %d device records", seeded)
    except Exception:
        log.exception("Cache warm-load failed (non-fatal)")

    # Sniffer (only the worker that wins the Redis lock will actually start).
    start_fingerprinting()

    # Background flush: every 60s persist freshly-seen signals to MongoDB so
    # restarts (and Redis flushes) don't lose long-term context.
    flush_stop = threading.Event()

    def _flush_to_db() -> None:
        while not flush_stop.is_set():
            flush_stop.wait(60.0)
            if flush_stop.is_set():
                return
            try:
                db = get_db()
                if db is None:
                    continue
                now = datetime.now(timezone.utc)
                count = 0
                for mac in cache.iter_macs_with_passive_signals():
                    passive = cache.get_passive_signals(mac)
                    if not passive:
                        continue
                    db.devices.update_one(
                        {"mac": mac.lower()},
                        {"$set": {
                            "raw_signals.passive": passive,
                            "raw_signals.snapshot_at": now,
                        }},
                        upsert=False,
                    )
                    count += 1
                if count:
                    log.debug("Flushed signals for %d MACs to MongoDB", count)
            except Exception:
                log.exception("Background flush failed")

    threading.Thread(target=_flush_to_db, daemon=True, name="fp-db-flush").start()

    try:
        yield
    finally:
        flush_stop.set()
        # Always restore ARP state before going away — otherwise targets are
        # left disconnected after a server restart.
        try:
            restored = stop_all_kicks()
            if restored:
                log.info("Restored ARP for %d active kicks on shutdown", restored)
        except Exception:
            log.exception("Failed to restore ARP on shutdown")
        # Final flush attempt so we don't lose the last 60s of signals.
        try:
            db = get_db()
            if db is not None:
                now = datetime.now(timezone.utc)
                for mac in cache.iter_macs_with_passive_signals():
                    passive = cache.get_passive_signals(mac)
                    if passive:
                        db.devices.update_one(
                            {"mac": mac.lower()},
                            {"$set": {"raw_signals.passive": passive, "raw_signals.snapshot_at": now}},
                            upsert=False,
                        )
        except Exception:
            log.exception("Final flush failed")
        close()


app = FastAPI(
    title="Network Scanner API",
    description="API documentation for the Network Scanner web application.",
    version="1.0.0",
    docs_url="/api-docs",
    lifespan=lifespan,
)

# ✅ Rate Limiting State & Exception Handler
from routes.scan import limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(scan.router, prefix="/api/scan", tags=["Scan"])
app.include_router(devices.router, prefix="/api/devices", tags=["Devices"])
app.include_router(kick.router, prefix="/api/kick", tags=["Kick"])
app.include_router(monitor.router, prefix="/api/monitor", tags=["Monitor"])



@app.get("/")
def health_check():
    return {"message": "Network Scanner API is running."}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ["PORT"])
    print(f"🚀 Main API running on http://localhost:{port}")
    print(f"📄 Swagger docs at http://localhost:{port}/api-docs")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
