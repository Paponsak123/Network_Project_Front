"""
Auth routes — register, login, update profile.
Replaces: routes/authRoutes.js + controllers/authController.js
"""
import os
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth_middleware import get_current_user, _get_jwt_secret
from database import get_db
from helpers import serialize_doc

logger = logging.getLogger(__name__)

router = APIRouter()

# JWT lifetime — keep in one place so we don't drift between login & profile update.
TOKEN_TTL_HOURS = 24


# ---------- Pydantic models ----------
class RegisterIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)

    @field_validator("username")
    @classmethod
    def _strip_username(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Username cannot be empty.")
        return v


class LoginIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class ProfileIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)

    @field_validator("username")
    @classmethod
    def _strip_username(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Username cannot be empty.")
        return v


# ---------- Helpers ----------
def _issue_token(user_id: str, username: str) -> str:
    return jwt.encode(
        {
            "id": user_id,
            "username": username,
            "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
        },
        _get_jwt_secret(),
        algorithm="HS256",
    )


async def _hash_password(password: str) -> bytes:
    # bcrypt is CPU-bound — push it off the event loop.
    return await asyncio.to_thread(
        bcrypt.hashpw, password.encode("utf-8"), bcrypt.gensalt(rounds=10)
    )


async def _verify_password(password: str, hashed: str) -> bool:
    try:
        return await asyncio.to_thread(
            bcrypt.checkpw, password.encode("utf-8"), hashed.encode("utf-8")
        )
    except (ValueError, TypeError):
        # Corrupt hash in DB shouldn't crash the request.
        logger.warning("Stored password hash is malformed")
        return False


# ---------- POST /api/auth/register ----------
@router.post("/register")
async def register(body: RegisterIn):
    db = get_db()
    username = body.username

    try:
        existing = db.users.find_one({"username": username})
    except Exception:
        logger.exception("DB error during register lookup")
        raise HTTPException(status_code=503, detail={"message": "Database unavailable, please try again."})

    if existing:
        raise HTTPException(status_code=409, detail={"message": "Username already exists."})

    try:
        hashed = await _hash_password(body.password)
    except Exception:
        logger.exception("Password hashing failed")
        raise HTTPException(status_code=500, detail={"message": "Could not create account."})

    now = datetime.now(timezone.utc)
    try:
        result = db.users.insert_one({
            "username": username,
            "password": hashed.decode("utf-8"),
            "createdAt": now,
            "updatedAt": now,
        })
    except Exception:
        logger.exception("DB error during register insert")
        raise HTTPException(status_code=503, detail={"message": "Database unavailable, please try again."})

    return {
        "message": "User registered successfully. You can now login.",
        "user": {"id": str(result.inserted_id), "username": username},
    }


# ---------- POST /api/auth/login ----------
@router.post("/login")
async def login(body: LoginIn):
    db = get_db()

    try:
        user = db.users.find_one({"username": body.username})
    except Exception:
        logger.exception("DB error during login lookup")
        raise HTTPException(status_code=503, detail={"message": "Database unavailable, please try again."})

    if not user or "password" not in user:
        raise HTTPException(status_code=401, detail={"message": "Invalid credentials."})

    if not await _verify_password(body.password, user["password"]):
        raise HTTPException(status_code=401, detail={"message": "Invalid credentials."})

    try:
        token = _issue_token(str(user["_id"]), user["username"])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Token issuance failed")
        raise HTTPException(status_code=500, detail={"message": "Could not complete login."})

    return {
        "message": "Login successful.",
        "token": token,
        "user": {"id": str(user["_id"]), "username": user["username"]},
    }


# ---------- PUT /api/auth/profile ----------
@router.put("/profile")
async def update_username(body: ProfileIn, current_user: dict = Depends(get_current_user)):
    db = get_db()
    new_username = body.username
    user_id = current_user.get("id")

    if not user_id:
        raise HTTPException(status_code=401, detail={"message": "Invalid session."})

    try:
        user_oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail={"message": "Invalid user id."})

    try:
        existing = db.users.find_one({"username": new_username})
    except Exception:
        logger.exception("DB error during profile lookup")
        raise HTTPException(status_code=503, detail={"message": "Database unavailable, please try again."})

    if existing and str(existing["_id"]) != user_id:
        raise HTTPException(status_code=409, detail={"message": "Username already taken."})

    try:
        db.users.update_one(
            {"_id": user_oid},
            {"$set": {"username": new_username, "updatedAt": datetime.now(timezone.utc)}},
        )
    except Exception:
        logger.exception("DB error during profile update")
        raise HTTPException(status_code=503, detail={"message": "Database unavailable, please try again."})

    try:
        token = _issue_token(user_id, new_username)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Token re-issuance failed")
        raise HTTPException(status_code=500, detail={"message": "Could not refresh session."})

    return {
        "message": "Username updated successfully.",
        "token": token,
        "user": {"id": user_id, "username": new_username},
    }
