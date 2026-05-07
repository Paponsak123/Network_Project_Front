"""
Auth routes — register, login, update profile.
Replaces: routes/authRoutes.js + controllers/authController.js
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, Request

from auth_middleware import get_current_user
from database import get_db
from helpers import serialize_doc

router = APIRouter()


# ---------- POST /api/auth/register ----------
@router.post("/register")
def register(request_body: dict, request: Request):
    db = get_db()
    username = request_body.get("username", "")
    password = request_body.get("password", "")

    if not username or not password or len(password) < 8:
        return {"message": "Username and password (min 8 chars) are required."}, 400

    existing = db.users.find_one({"username": username})
    if existing:
        return {"message": "Username already exists."}, 409

    salt = bcrypt.gensalt(rounds=10)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)

    now = datetime.now(timezone.utc)
    result = db.users.insert_one({
        "username": username,
        "password": hashed.decode("utf-8"),
        "createdAt": now,
        "updatedAt": now,
    })

    return {
        "message": "User registered successfully. You can now login.",
        "user": {"id": str(result.inserted_id), "username": username},
    }


# ---------- POST /api/auth/login ----------
@router.post("/login")
def login(request_body: dict):
    db = get_db()
    username = request_body.get("username", "")
    password = request_body.get("password", "")

    if not username or not password:
        return {"message": "Username and password are required."}, 400

    user = db.users.find_one({"username": username})
    if not user:
        return {"message": "Invalid credentials."}, 401

    if not bcrypt.checkpw(password.encode("utf-8"), user["password"].encode("utf-8")):
        return {"message": "Invalid credentials."}, 401

    token = jwt.encode(
        {
            "id": str(user["_id"]),
            "username": user["username"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        },
        os.getenv("JWT_SECRET"),
        algorithm="HS256",
    )

    return {
        "message": "Login successful.",
        "token": token,
        "user": {"id": str(user["_id"]), "username": user["username"]},
    }


# ---------- PUT /api/auth/profile ----------
@router.put("/profile")
def update_username(request_body: dict, current_user: dict = Depends(get_current_user)):
    db = get_db()
    new_username = request_body.get("username", "").strip()
    user_id = current_user["id"]

    if not new_username:
        return {"message": "Username cannot be empty."}, 400

    existing = db.users.find_one({"username": new_username})
    if existing and str(existing["_id"]) != user_id:
        return {"message": "Username already taken."}, 409

    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"username": new_username, "updatedAt": datetime.now(timezone.utc)}},
    )

    token = jwt.encode(
        {
            "id": user_id,
            "username": new_username,
            "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        },
        os.getenv("JWT_SECRET"),
        algorithm="HS256",
    )

    return {
        "message": "Username updated successfully.",
        "token": token,
        "user": {"id": user_id, "username": new_username},
    }
