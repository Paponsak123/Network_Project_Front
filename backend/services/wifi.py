"""
Wi-Fi service — get the SSID of the currently connected Wi-Fi network.
"""
import platform
import subprocess

SYSTEM = platform.system().lower()


def get_current_ssid():
    """
    Get the SSID of the Wi-Fi network this machine is currently connected to.
    Returns a dict with 'ssid' (str or None).
    """
    if SYSTEM == "darwin":
        return _get_ssid_macos()
    elif SYSTEM == "linux":
        return _get_ssid_linux()
    else:
        return _get_ssid_windows()


def _get_ssid_macos():
    """macOS: use CoreWLAN to get current Wi-Fi SSID."""
    try:
        import CoreWLAN
        iface = CoreWLAN.CWInterface.interface()
        if not iface:
            return {"ssid": None, "message": "No Wi-Fi interface found."}
        ssid = iface.ssid()
        if ssid:
            return {"ssid": ssid}
        return {"ssid": None, "message": "Wi-Fi is on but not connected to any network."}
    except ImportError:
        # Fallback ถ้าไม่มี CoreWLAN
        return _get_ssid_macos_fallback()
    except Exception as e:
        return {"ssid": None, "error": str(e)}


def _get_ssid_macos_fallback():
    """Fallback: use networksetup CLI."""
    try:
        result = subprocess.run(
            "networksetup -getairportnetwork en0",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        output = result.stdout.strip()
        if "Current Wi-Fi Network:" in output:
            ssid = output.split("Current Wi-Fi Network:")[1].strip()
            return {"ssid": ssid}
        return {"ssid": None, "message": output}
    except Exception as e:
        return {"ssid": None, "error": str(e)}


def _get_ssid_linux():
    """Linux: use iwgetid."""
    try:
        result = subprocess.run(
            "iwgetid -r", shell=True, capture_output=True, text=True, timeout=10,
        )
        ssid = result.stdout.strip()
        if ssid:
            return {"ssid": ssid}
        return {"ssid": None, "message": "Not connected to any Wi-Fi network."}
    except Exception as e:
        return {"ssid": None, "error": str(e)}


def _get_ssid_windows():
    """Windows: use netsh wlan show interfaces."""
    try:
        result = subprocess.run(
            "netsh wlan show interfaces",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        for line in result.stdout.split("\n"):
            if "SSID" in line and "BSSID" not in line:
                ssid = line.split(":")[1].strip()
                if ssid:
                    return {"ssid": ssid}
        return {"ssid": None, "message": "Not connected to any Wi-Fi network."}
    except Exception as e:
        return {"ssid": None, "error": str(e)}
