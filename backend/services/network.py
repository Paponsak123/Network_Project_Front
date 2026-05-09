"""
Network scanning service.
Replaces: services/networkService.js
"""
import re
import socket
import subprocess
from datetime import datetime


def exec_command(command, timeout=30):
    """Execute a shell command and return stdout."""
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout
    except Exception as e:
        print(f"Error running command: {e}")
        return ""


def get_local_subnet():
    """Auto-detect the local IP and return the /24 subnet (e.g. 192.168.1.0/24)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    finally:
        s.close()
    prefix = ".".join(local_ip.split(".")[:3])
    return f"{prefix}.0/24"


def is_valid_device(ip, mac):
    """Filter out broadcast and multicast IP/MAC addresses."""
    # บล็อก Broadcast IP 
    if ip.endswith(".255") or ip == "255.255.255.255": 
        return False
    # บล็อก Multicast IP 
    if ip.startswith("224.") or ip.startswith("239."):
        return False
    # บล็อก Broadcast MAC 
    if mac == "ff:ff:ff:ff:ff:ff":
        return False
    # บล็อก Multicast MAC 
    if mac.startswith("01:00:5e") or mac.startswith("33:33:"):
        return False
    return True


def discover_devices():
    """Use both arp -a (cache) and nmap (active) to discover all devices."""
    devices_by_ip = {}

    # 1. ARP Cache (Finds sleeping/cached devices)
    arp_output = exec_command("arp -a")
    for line in arp_output.split("\n"):
        ip_match = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line)
        mac_match = re.search(r"([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})", line)
        if ip_match and mac_match:
            ip = ip_match.group(1)
            mac = mac_match.group(1).lower()
            # Normalize mac (e.g. 0:a:b:c:d:e to 00:0a:0b:0c:0d:0e)
            mac_parts = mac.split(":")
            mac = ":".join([p.zfill(2) for p in mac_parts])
            
            if is_valid_device(ip, mac):
                devices_by_ip[ip] = mac

    # 2. Nmap Active Scan (Finds newly connected devices)
    subnet = get_local_subnet()
    print(f"🔍 Scanning subnet: {subnet}")
    nmap_output = exec_command(f"nmap -sn -n {subnet}", timeout=60)
    current_ip = None

    for line in nmap_output.split("\n"):
        ip_match = re.search(r"Nmap scan report for\s+.*?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", line)
        if ip_match:
            current_ip = ip_match.group(1)
            continue

        mac_match = re.search(r"MAC Address:\s+([0-9A-Fa-f:]{17})", line)
        if mac_match and current_ip:
            mac = mac_match.group(1).lower()
            if is_valid_device(current_ip, mac):
                devices_by_ip[current_ip] = mac
            current_ip = None

    # Return combined list
    return [{"ip": ip, "mac": mac} for ip, mac in devices_by_ip.items()]


def scan_device(ip):
    """Run nmap on a single IP to discover open ports."""
    try:
        output = exec_command(f"nmap -Pn -n --top-ports 1000 --host-timeout 15s --max-retries 1 {ip}", timeout=45)
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
        print(f"Error scanning {ip}: {e}")
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
    """Look up MAC vendor. Falls back to 'Unknown' or 'Randomized MAC'."""
    try:
        from mac_vendor_lookup import MacLookup
        lookup = MacLookup()
        vendor = lookup.lookup(mac)
        if vendor:
            return vendor
    except Exception:
        pass

    if is_randomized_mac(mac):
        return "Randomized MAC (Privacy)"
    return "Unknown"


def perform_full_scan():
    """Full scan pipeline: ARP discovery → nmap scan → merge results."""
    arp_devices = discover_devices()

    scan_results = []
    for device in arp_devices:
        scan_results.append(scan_device(device["ip"]))

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
            "deviceType": "Unknown",
            "status": nmap_result["status"],
            "ports": nmap_result["ports"],
            "lastSeen": datetime.utcnow(),
        })

    return merged
