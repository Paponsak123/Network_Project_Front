"""
macOS Proxy Configuration Manager for Website Blocking (PAC file).
"""
import subprocess
import logging

logger = logging.getLogger(__name__)

def get_network_services():
    """Get all network services that are currently active."""
    try:
        result = subprocess.run(
            ["networksetup", "-listallnetworkservices"],
            capture_output=True,
            text=True,
            check=True
        )
        services = []
        for line in result.stdout.split("\n"):
            line = line.strip()
            # Ignore header and disabled services (which start with *)
            if line and not line.startswith("*") and "network service" not in line.lower():
                services.append(line)
        return services
    except Exception as e:
        logger.error(f"Failed to list network services: {e}")
        return ["Wi-Fi"] # Fallback

def apply_proxy_pac(has_active_domains: bool):
    """Enable or disable the PAC file on all active network interfaces."""
    port = 3000 # Default port of our API
    pac_url = f"http://127.0.0.1:{port}/api/blocker/pac"
    
    services = get_network_services()
    
    for service in services:
        try:
            if has_active_domains:
                # Set URL
                subprocess.run(["networksetup", "-setautoproxyurl", service, pac_url], check=True)
                # Turn ON
                subprocess.run(["networksetup", "-setautoproxystate", service, "on"], check=True)
                logger.info(f"Enabled PAC proxy on {service}")
            else:
                # Turn OFF
                subprocess.run(["networksetup", "-setautoproxystate", service, "off"], check=True)
                logger.info(f"Disabled PAC proxy on {service}")
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to configure proxy on {service}: {e}")
    
    return True
