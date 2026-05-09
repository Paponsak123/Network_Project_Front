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


def discover_devices():
    """Use nmap -sn to actively discover all devices on the local network."""
    subnet = get_local_subnet()
    print(f"🔍 Scanning subnet: {subnet}")
    output = exec_command(f"nmap -sn {subnet}", timeout=60)

    devices = []
    lines = output.split("\n")
    current_ip = None

    for line in lines:
        ip_match = re.search(r"Nmap scan report for\s+\S*\s*\(?(\d+\.\d+\.\d+\.\d+)\)?", line)
        if ip_match:
            current_ip = ip_match.group(1)
            continue

        mac_match = re.search(r"MAC Address:\s+([0-9A-Fa-f:]{17})", line)
        if mac_match and current_ip:
            mac = mac_match.group(1).lower()
            if not current_ip.endswith(".255") and mac != "ff:ff:ff:ff:ff:ff":
                devices.append({"ip": current_ip, "mac": mac})
            current_ip = None

    return devices


def scan_device(ip):
    """Run nmap on a single IP to discover open ports."""
    try:
        output = exec_command(f"nmap -Pn --top-ports 1000 {ip}")
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
