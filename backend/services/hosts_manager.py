"""
macOS Hosts file manager for Website Blocking.
"""
import os
import subprocess
import logging

logger = logging.getLogger(__name__)

HOSTS_FILE = "/etc/hosts"
BLOCK_START = "# --- Network Scanner Blocker Start ---"
BLOCK_END = "# --- Network Scanner Blocker End ---"

def apply_hosts(active_domains: list[str]):
    """Rewrite the custom block in /etc/hosts with active domains."""
    try:
        with open(HOSTS_FILE, 'r') as f:
            lines = f.readlines()
    except Exception as e:
        logger.error(f"Failed to read {HOSTS_FILE}: {e}")
        return False

    # Find boundaries
    start_idx = -1
    end_idx = -1
    for i, line in enumerate(lines):
        if line.strip() == BLOCK_START:
            start_idx = i
        elif line.strip() == BLOCK_END:
            end_idx = i

    # Remove existing block if it exists
    if start_idx != -1 and end_idx != -1 and start_idx < end_idx:
        lines = lines[:start_idx] + lines[end_idx+1:]
    
    # Clean up empty lines at the end of the file
    while lines and lines[-1].strip() == "":
        lines.pop()
    
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    # Create new block
    new_block = [
        "\n",
        BLOCK_START + "\n"
    ]
    
    if active_domains:
        for domain in active_domains:
            new_block.append(f"127.0.0.1 {domain}\n")
            new_block.append(f"127.0.0.1 www.{domain}\n")
            new_block.append(f"::1 {domain}\n")
            new_block.append(f"::1 www.{domain}\n")
    else:
        new_block.append("# No domains blocked\n")
        
    new_block.append(BLOCK_END + "\n")

    lines.extend(new_block)

    try:
        with open(HOSTS_FILE, 'w') as f:
            f.writelines(lines)
    except Exception as e:
        logger.error(f"Failed to write to {HOSTS_FILE}: {e}")
        return False

    flush_dns_cache()
    return True

def flush_dns_cache():
    """Flush macOS DNS cache."""
    try:
        subprocess.run(["dscacheutil", "-flushcache"], check=True)
        subprocess.run(["killall", "-HUP", "mDNSResponder"], check=True)
        logger.info("Successfully flushed DNS cache.")
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to flush DNS cache: {e}")
