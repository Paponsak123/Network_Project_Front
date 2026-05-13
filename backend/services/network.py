"""
Network scanning service.
Replaces: services/networkService.js
"""
import re
import socket
import subprocess
import logging
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from mac_vendor_lookup import MacLookup

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global MacLookup instance
_mac_lookup = MacLookup()

def exec_command(command_list, timeout=30):
    """Execute a shell command securely and return stdout."""
    try:
        # ✅ Security: Avoid shell=True
        result = subprocess.run(
            command_list, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout
    except Exception as e:
        logger.error("Error running command %s: %s", command_list, e)
        return ""


def get_local_subnet() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()

        if local_ip.startswith("127."):
            return "192.168.1.0/24"  # last resort fallback

        prefix = ".".join(local_ip.split(".")[:3])
        return f"{prefix}.0/24"  # ✅ Uses actual IP, works for hotspot too
    except OSError:
        return "192.168.1.0/24"


def is_valid_device(ip, mac):
    """Filter out broadcast and multicast IP/MAC addresses."""
    if ip.endswith(".255") or ip == "255.255.255.255": 
        return False
    if ip.startswith("224.") or ip.startswith("239."):
        return False
    if mac == "ff:ff:ff:ff:ff:ff":
        return False
    if mac.startswith("01:00:5e") or mac.startswith("33:33:"):
        return False
    return True


def discover_devices():
    """Use both arp -a (cache) and nmap (active) to discover all devices."""
    devices_by_ip = {}

    import platform

    # ===== DEBUG: ดูจำนวน ARP entries ก่อน flush =====
    arp_before = exec_command(["arp", "-a"])
    before_count = len([line for line in arp_before.splitlines() if line.strip()])
    print(f"[DEBUG] ARP entries before flush: {before_count}", flush=True)

    # ===== Flush ARP / Neighbor cache =====
    if platform.system() == "Darwin":  # macOS
        exec_command(["sudo", "arp", "-da"])
    else:  # Linux
        exec_command(["sudo", "ip", "neigh", "flush", "all"])

    # ===== DEBUG: ดูจำนวน ARP entries หลัง flush =====
    arp_after = exec_command(["arp", "-a"])
    after_count = len([line for line in arp_after.splitlines() if line.strip()])
    print(f"[DEBUG] ARP entries after flush: {after_count}", flush=True)

    if after_count < before_count:
        print("[DEBUG] ARP cache flushed successfully.", flush=True)
    else:
        print("[DEBUG] Cache may have been immediately repopulated.", flush=True)

    # 1. ARP Cache
    arp_output = exec_command(["arp", "-a"])
    for line in arp_output.split("\n"):
        ip_match = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line)
        mac_match = re.search(r"([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})", line)
        if ip_match and mac_match:
            ip = ip_match.group(1)
            mac = mac_match.group(1).lower()
            mac_parts = mac.split(":")
            mac = ":".join([p.zfill(2) for p in mac_parts])
            
            if is_valid_device(ip, mac):
                devices_by_ip[ip] = mac

    # 2. Nmap Active Scan
    subnet = get_local_subnet()
    logger.info("🔍 Scanning subnet: %s", subnet)
    # ✅ Security: command as list
    nmap_output = exec_command(["nmap", "-sn", "-n", subnet], timeout=60)
    current_ip = None

    for line in nmap_output.split("\n"):
        # ✅ Improved Regex to handle hostnames
        ip_match = re.search(
            r"Nmap scan report for\s+(?:\S+\s+)?\(?(\d{1,3}(?:\.\d{1,3}){3})\)?", line
        )
        if ip_match:
            current_ip = ip_match.group(1)
            continue

        mac_match = re.search(r"MAC Address:\s+([0-9A-Fa-f:]{17})", line)
        if mac_match and current_ip:
            mac = mac_match.group(1).lower()
            if is_valid_device(current_ip, mac):
                devices_by_ip[current_ip] = mac
            current_ip = None

    return [{"ip": ip, "mac": mac} for ip, mac in devices_by_ip.items()]


def detect_os(ip):
    """Use nmap -O to try and detect the operating system."""
    try:
        # ✅ Needs sudo for OS detection
        output = exec_command([
            "sudo", "nmap", "-O", "-Pn", "--osscan-limit", "--max-os-tries", "1", ip
        ], timeout=60)
        
        match = re.search(r"OS details:\s+(.+)", output)
        if match:
            return match.group(1)
        
        if "Aggressive OS guesses" in output:
            guess_match = re.search(r"Aggressive OS guesses:\s+([^,]+)", output)
            if guess_match:
                return guess_match.group(1)
            
        return "Unknown OS"
    except Exception as e:
        logger.warning("OS Detection error for %s: %s", ip, e)
        return "Unknown OS"


def scan_device(ip):
    """Run nmap on a single IP to discover open ports."""
    try:
        # ✅ Security: command as list
        output = exec_command([
            "nmap", "-Pn", "-n", "--top-ports", "1000", 
            "--host-timeout", "15s", "--max-retries", "1", ip
        ], timeout=45)
        
        lines = output.split("\n")
        status = "offline"
        ports = []

        for line in lines:
            if "Host is up" in line:
                status = "online"
            port_match = re.match(r"^(\d+)/tcp\s+open\s+(.+)$", line)
            if port_match:
                ports.append(int(port_match.group(1)))

        return {"ip": ip, "status": status, "ports": ports}
    except Exception as e:
        logger.warning("Error scanning %s: %s", ip, e)
        return {"ip": ip, "status": "offline", "ports": []}


def is_randomized_mac(mac):
    """Check if a MAC address is locally administered (randomized)."""
    if not mac:
        return False
    first_octet = mac.split(":")[0]
    if len(first_octet) < 2:
        return False
    second_char = first_octet[1].upper()
    return second_char in ["2", "6", "A", "E"]


def get_vendor(mac):
    """Look up MAC vendor using global instance."""
    try:
        return _mac_lookup.lookup(mac)
    except Exception:
        pass

    if is_randomized_mac(mac):
        return "Randomized MAC (Privacy)"
    return "Unknown"


def guess_device_type(ports: list, vendor: str) -> str:
    """Heuristic to guess device type based on open ports and vendor."""
    port_set = set(ports)
    if 80 in port_set or 443 in port_set:
        return "Router/Server"
    if 9100 in port_set:
        return "Printer"
    if 554 in port_set:
        return "IP Camera"
    
    vendor_lower = vendor.lower()
    if "apple" in vendor_lower:
        return "Apple Device"
    if "samsung" in vendor_lower or "google" in vendor_lower:
        return "Mobile/TV"
    
    return "Unknown"


def perform_full_scan():
    """Full scan pipeline with parallel execution."""
    arp_devices = discover_devices()
    now = datetime.now(timezone.utc)

    # ✅ Performance: Sequential -> Parallel
    scan_results = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(scan_device, d["ip"]): d for d in arp_devices}
        for future in as_completed(futures):
            scan_results.append(future.result())

    merged = []
    for arp_device in arp_devices:
        nmap_result = next(
            (r for r in scan_results if r["ip"] == arp_device["ip"]),
            {"status": "offline", "ports": []},
        )
        vendor_name = get_vendor(arp_device["mac"])

        merged.append({
            "ip": arp_device["ip"],
            "mac": arp_device["mac"],
            "vendor": vendor_name,
            "deviceType": guess_device_type(nmap_result["ports"], vendor_name),
            "status": nmap_result["status"],
            "ports": nmap_result["ports"],
            "lastSeen": now,
        })

    return merged

