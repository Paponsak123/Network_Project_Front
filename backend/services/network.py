"""
Network scanning service.
Replaces: services/networkService.js
"""
import os
import platform
import re
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


def parse_arp_output(output):
    """Parse arp -a output to extract IP and MAC addresses."""
    devices = []
    lines = output.strip().split("\n")
    plat = platform.system().lower()

    # Mac/Linux regex
    unix_regex = re.compile(r"\(([^)]+)\)\s+at\s+([0-9a-fA-F:]{17})")
    # Windows regex
    win_regex = re.compile(
        r"^\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+"
        r"([0-9a-fA-F]{2}-[0-9a-fA-F]{2}-[0-9a-fA-F]{2}-"
        r"[0-9a-fA-F]{2}-[0-9a-fA-F]{2}-[0-9a-fA-F]{2})"
    )

    arp_regex = win_regex if plat == "windows" else unix_regex

    for line in lines:
        match = arp_regex.search(line)
        if match:
            ip = match.group(1)
            if ip.endswith(".255"):
                continue
            mac = match.group(2).lower().replace("-", ":")
            if mac == "ff:ff:ff:ff:ff:ff":
                continue
            devices.append({"ip": ip, "mac": mac})

    return devices


def discover_devices():
    """Run arp -a to discover devices on the local network."""
    output = exec_command("arp -a")
    return parse_arp_output(output)


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
