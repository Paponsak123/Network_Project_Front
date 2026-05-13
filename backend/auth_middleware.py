"""
JWT authentication dependency for FastAPI.
Replaces: middlewares/authMiddleware.js
"""
import os
import logging

import jwt
from fastapi import Request, HTTPException

logger = logging.getLogger(__name__)


def _get_jwt_secret() -> str:
    """Fetch JWT_SECRET at call-time so missing env doesn't crash imports,
    but fails fast and clearly when a request actually needs it."""
    secret = os.getenv("JWT_SECRET")
    if not secret:
        logger.error("JWT_SECRET environment variable is not set")
        raise HTTPException(
            status_code=500,
            detail={"message": "Server misconfiguration: JWT secret missing."},
        )
    return secret


def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("authorization") or ""

    # Defensive parsing — handles "Bearer", "Bearer ", extra spaces, missing token, etc.
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=401,
            detail={"message": "Access denied. No token provided."},
        )

    token = parts[1].strip()

    try:
        decoded = jwt.decode(token, _get_jwt_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail={"message": "Token has expired."})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail={"message": "Invalid or expired token."})
    except HTTPException:
        raise
    except Exception:
        # Last-resort safety net — never leak internal error to caller.
        logger.exception("Unexpected error while decoding JWT")
        raise HTTPException(status_code=401, detail={"message": "Invalid or expired token."})

    if not isinstance(decoded, dict) or "id" not in decoded:
        raise HTTPException(status_code=401, detail={"message": "Malformed token payload."})

    return decoded
