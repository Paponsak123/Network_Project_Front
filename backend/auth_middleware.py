"""
JWT authentication dependency for FastAPI.
Replaces: middlewares/authMiddleware.js
"""
import os
import jwt
from fastapi import Request, HTTPException


def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("authorization", "")

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"message": "Access denied. No token provided."})

    token = auth_header.split(" ")[1]

    try:
        decoded = jwt.decode(token, os.getenv("JWT_SECRET"), algorithms=["HS256"])
        return decoded
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail={"message": "Token has expired."})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail={"message": "Invalid or expired token."})
