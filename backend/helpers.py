"""
Helper utilities for serialising MongoDB documents to JSON-safe dicts.
"""
from bson import ObjectId
from datetime import datetime


def serialize_doc(doc):
    """
    Recursively convert a pymongo document dict so that:
      - ObjectId  → str
      - datetime  → ISO-8601 string
      - nested dicts / lists are handled too
    """
    if doc is None:
        return None
    result = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, list):
            result[key] = [
                serialize_doc(item) if isinstance(item, dict) else item
                for item in value
            ]
        elif isinstance(value, dict):
            result[key] = serialize_doc(value)
        else:
            result[key] = value
    return result
