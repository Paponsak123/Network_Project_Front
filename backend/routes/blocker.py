import re
from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import urlparse

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo import ReturnDocument

from auth_middleware import get_current_user
from database import get_db
from helpers import serialize_doc
from services.hosts_manager import apply_hosts

router = APIRouter()

# ---------- Models ----------
class DomainInput(BaseModel):
    url: str

class BlockedDomainResponse(BaseModel):
    id: str
    domain: str
    url: str
    active: bool
    createdAt: datetime
    updatedAt: datetime

# ---------- Helper to update system hosts ----------
def refresh_system_hosts(db, user_id: str):
    """Fetch active domains for the user and apply them to /etc/hosts."""
    # We only apply blocks for the currently logged-in user, 
    # but since /etc/hosts is system-wide, we assume single-user macOS or primary admin usage.
    active_docs = list(db.blocked_domains.find({"owner": ObjectId(user_id), "active": True}))
    active_domains = [doc["domain"] for doc in active_docs]
    
    success = apply_hosts(active_domains)
    if not success:
        print("Warning: Failed to apply hosts file changes.")

# ---------- Extract Domain ----------
def extract_domain(url: str) -> str:
    """Extract clean domain from URL."""
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    
    parsed = urlparse(url)
    domain = parsed.netloc

    # Remove port if present
    if ':' in domain:
        domain = domain.split(':')[0]
    
    # Remove 'www.' prefix for base domain storage
    if domain.startswith('www.'):
        domain = domain[4:]
        
    return domain.lower()

# ---------- GET /api/blocker/ ----------
@router.get("/")
async def get_blocked_domains(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    """Get all blocked domains for the user."""
    user_id = current_user["id"]
    docs = list(db.blocked_domains.find({"owner": ObjectId(user_id)}).sort("createdAt", -1))
    
    return [serialize_doc(doc) for doc in docs]

# ---------- POST /api/blocker/ ----------
@router.post("/")
async def add_blocked_domain(
    data: DomainInput,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    """Add a new domain to block."""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)
    
    domain = extract_domain(data.url)
    if not domain:
        raise HTTPException(status_code=400, detail="Invalid URL format")

    # Upsert or Insert
    doc = db.blocked_domains.find_one_and_update(
        {"domain": domain, "owner": ObjectId(user_id)},
        {"$set": {
            "url": data.url,
            "active": True,
            "updatedAt": now
        },
        "$setOnInsert": {
            "createdAt": now
        }},
        upsert=True,
        return_document=ReturnDocument.AFTER
    )
    
    refresh_system_hosts(db, user_id)
    return serialize_doc(doc)

# ---------- PUT /api/blocker/{id} ----------
@router.put("/{id}")
async def toggle_blocked_domain(
    id: str,
    active: bool,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    """Toggle a domain's blocked status."""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)
    
    doc = db.blocked_domains.find_one_and_update(
        {"_id": ObjectId(id), "owner": ObjectId(user_id)},
        {"$set": {
            "active": active,
            "updatedAt": now
        }},
        return_document=ReturnDocument.AFTER
    )
    
    if not doc:
        raise HTTPException(status_code=404, detail="Domain not found")
        
    refresh_system_hosts(db, user_id)
    return serialize_doc(doc)

# ---------- DELETE /api/blocker/{id} ----------
@router.delete("/{id}")
async def delete_blocked_domain(
    id: str,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    """Delete a blocked domain."""
    user_id = current_user["id"]
    
    result = db.blocked_domains.delete_one({"_id": ObjectId(id), "owner": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Domain not found")
        
    refresh_system_hosts(db, user_id)
    return {"message": "Domain deleted successfully"}
