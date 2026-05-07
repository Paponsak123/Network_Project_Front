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
    client = MongoClient(mongo_uri, tlsCAFile=certifi.where())
    # get_default_database() reads the DB name from the URI (e.g. 'network_scanner')
    db = client.get_default_database()

    # Drop old unique index on 'mac' if it exists (same as index.js startup logic)
    try:
        db.devices.drop_index("mac_1")
        print('✅ Automatically dropped old unique index on "mac" field.')
    except Exception:
        pass

    # Create compound unique index: same MAC can exist for different owners
    db.devices.create_index([("owner", 1), ("mac", 1)], unique=True)

    print("✅ Connected to MongoDB")
    return db


def get_db():
    """Return the current database instance."""
    return db


def close():
    """Close the MongoDB connection."""
    if client:
        client.close()
