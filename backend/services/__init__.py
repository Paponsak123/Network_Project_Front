# services package
"""
Service layer initialisation.

Importing this package exposes the module-level cache singleton so any
route/service can do:

    from services import cache, get_cache

without knowing the internal structure of services.cache.
"""

from services.cache import FingerprintCache, get_cache

__all__ = ["FingerprintCache", "get_cache"]
