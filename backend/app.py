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
    """Startup: connect to MongoDB. Shutdown: close connection + restore ARP."""
    import asyncio
    from database import connect, close
    from services.monitor import set_main_loop
    from services.fingerprint import start_fingerprinting
    from services.arp_spoof import stop_all_kicks

    set_main_loop(asyncio.get_running_loop())
    start_fingerprinting()
    connect()
    try:
        yield
    finally:
        # Always restore ARP state before going away — otherwise targets are
        # left disconnected after a server restart.
        try:
            restored = stop_all_kicks()
            if restored:
                logging.getLogger(__name__).info(
                    "Restored ARP for %d active kicks on shutdown", restored
                )
        except Exception:
            logging.getLogger(__name__).exception("Failed to restore ARP on shutdown")
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
