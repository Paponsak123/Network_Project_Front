"""
mDNS / DNS-SD advertisement for ScanDer instances.

Each running backend registers a `_scander._tcp.local.` service so that
other ScanDer instances on the same LAN can discover it via Bonjour /
Avahi without any signalling server. The advertised TXT record carries the
HTTP base URL and a short capability list:

    api=http://192.168.1.10:8000
    ws=ws://192.168.1.10:8000/api/transfer/ws
    caps=text,file

Discovery is also exposed via `browse_active_peers()` — returns the
currently-visible ScanDer services on the LAN as a list of dicts.

If `zeroconf` is not installed (or fails to bind to a multicast socket —
common in containers without host networking), advertise() and browse()
both fail silently and return None / []. The WebSocket signalling channel
still works without mDNS — this is purely a "make-it-easier-to-find-each-
other" feature.
"""

from __future__ import annotations

import logging
import socket
from typing import Optional

logger = logging.getLogger(__name__)

SERVICE_TYPE = "_scander._tcp.local."

try:
    from zeroconf import IPVersion, ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf  # type: ignore
    _ZC_AVAILABLE = True
except Exception as e:  # pragma: no cover
    _ZC_AVAILABLE = False
    _ZC_IMPORT_ERROR = e
    Zeroconf = None  # type: ignore
    ServiceInfo = None  # type: ignore
    ServiceBrowser = None  # type: ignore
    ServiceListener = object  # type: ignore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _primary_lan_ip() -> Optional[str]:
    """Best-guess IPv4 address that other LAN devices can reach us on."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Advertiser
# ---------------------------------------------------------------------------
class _Advertiser:
    def __init__(self) -> None:
        self._zc: Optional["Zeroconf"] = None
        self._info: Optional["ServiceInfo"] = None
        self._instance_name: Optional[str] = None

    def start(self, instance_name: str, port: int, ip: Optional[str] = None) -> bool:
        if not _ZC_AVAILABLE:
            logger.info("zeroconf not installed (%s) — mDNS disabled", _ZC_IMPORT_ERROR)
            return False
        if self._zc is not None:
            return True

        ip = ip or _primary_lan_ip()
        if not ip:
            logger.warning("could not determine LAN IP — mDNS advertisement skipped")
            return False

        safe_name = instance_name.replace(" ", "-")[:32] or "scander"
        full_name = f"{safe_name}.{SERVICE_TYPE}"
        try:
            zc = Zeroconf(ip_version=IPVersion.V4Only)
            info = ServiceInfo(
                SERVICE_TYPE,
                full_name,
                addresses=[socket.inet_aton(ip)],
                port=int(port),
                properties={
                    b"api":  f"http://{ip}:{port}".encode("utf-8"),
                    b"ws":   f"ws://{ip}:{port}/api/transfer/ws".encode("utf-8"),
                    b"caps": b"text,file",
                    b"ver":  b"1",
                },
                server=f"{safe_name}.local.",
            )
            zc.register_service(info, allow_name_change=True)
            self._zc = zc
            self._info = info
            self._instance_name = safe_name
            logger.info("mDNS advertised: %s on %s:%s", full_name, ip, port)
            return True
        except Exception as e:
            logger.warning("zeroconf register_service failed: %s", e)
            return False

    def stop(self) -> None:
        if self._zc is None:
            return
        try:
            if self._info is not None:
                self._zc.unregister_service(self._info)
            self._zc.close()
            logger.info("mDNS advertisement stopped")
        except Exception as e:
            logger.warning("mDNS stop error: %s", e)
        finally:
            self._zc = None
            self._info = None

    def browse(self, timeout: float = 1.5) -> list[dict]:
        """One-shot browse — returns peers seen within `timeout` seconds."""
        if not _ZC_AVAILABLE:
            return []
        own_zc_created = False
        zc = self._zc
        if zc is None:
            try:
                zc = Zeroconf(ip_version=IPVersion.V4Only)
                own_zc_created = True
            except Exception:
                return []

        peers: dict[str, dict] = {}

        class _Listener:  # zeroconf duck-types this
            def add_service(self, zeroconf, type_, name):
                try:
                    info = zeroconf.get_service_info(type_, name, timeout=int(timeout * 1000))
                    if not info:
                        return
                    addrs = []
                    for a in info.addresses or []:
                        try:
                            addrs.append(socket.inet_ntoa(a))
                        except Exception:
                            pass
                    props = {}
                    for k, v in (info.properties or {}).items():
                        try:
                            ks = k.decode("utf-8", "ignore") if isinstance(k, (bytes, bytearray)) else str(k)
                            vs = v.decode("utf-8", "ignore") if isinstance(v, (bytes, bytearray)) else str(v)
                            props[ks] = vs
                        except Exception:
                            pass
                    peers[name] = {
                        "name": name,
                        "host": info.server,
                        "addresses": addrs,
                        "port": info.port,
                        "properties": props,
                    }
                except Exception as e:
                    logger.debug("zc add_service error: %s", e)

            def remove_service(self, *_a, **_kw):  # required by API
                pass

            def update_service(self, *_a, **_kw):  # required by API
                pass

        try:
            ServiceBrowser(zc, SERVICE_TYPE, listener=_Listener())  # type: ignore
            import time as _t
            _t.sleep(timeout)
        finally:
            if own_zc_created and zc is not None:
                try:
                    zc.close()
                except Exception:
                    pass

        # Drop our own advertisement from results when possible.
        if self._instance_name:
            peers = {k: v for k, v in peers.items() if self._instance_name not in k}
        return list(peers.values())


_advertiser = _Advertiser()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def start_advertising(instance_name: str = "scander", port: int = 8000, ip: Optional[str] = None) -> bool:
    return _advertiser.start(instance_name, port, ip)


def stop_advertising() -> None:
    _advertiser.stop()


def browse_active_peers(timeout: float = 1.5) -> list[dict]:
    return _advertiser.browse(timeout=timeout)


def is_available() -> bool:
    return _ZC_AVAILABLE
