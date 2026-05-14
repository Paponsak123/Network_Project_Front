"""
MongoDB connection module.
Replaces: dbconfig/mongo.js + mongoose connection in index.js
"""
import os
import certifi
from pymongo import MongoClient

client: MongoClient = None
db = None


def connect():
    """Connect to MongoDB and return the database instance."""
    global client, db
    mongo_uri = os.getenv("MONGO_URI")
    if not mongo_uri:
        raise RuntimeError("MONGO_URI environment variable is not set.")

    # serverSelectionTimeoutMS: fail fast (10s) instead of the default 30s so the
    # container doesn't hang on startup when Atlas is momentarily unreachable.
    client = MongoClient(mongo_uri, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=10_000)
    # get_default_database() reads the DB name from the URI (e.g. 'network_scanner')
    db = client.get_default_database()

    # Drop old unique index on 'mac' if it exists (same as index.js startup logic)
    try:
        db.devices.drop_index("mac_1")
        print('✅ Automatically dropped old unique index on "mac" field.')
    except Exception:
        pass

    # Create compound unique index: same MAC can exist for different owners.
    # Wrapped in try/except so a transient Atlas hiccup doesn't crash startup —
    # the index will be created on the next successful restart.
    try:
        db.devices.create_index([("owner", 1), ("mac", 1)], unique=True)
        print("✅ Connected to MongoDB")
    except Exception as e:
        print(f"⚠️  Warning: Could not create device index: {e}")
        print("   The app will still start; the index will be retried on next restart.")

    return db


def get_db():
    """Return the current database instance.

    Raises HTTP 503 (instead of letting callers crash with AttributeError)
    when the MongoDB connection was never established or has been lost.
    """
    if db is None:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail={"message": "Database unavailable. Please try again later."},
        )
    return db


def close():
    """Close the MongoDB connection."""
    if client:
        client.close()
