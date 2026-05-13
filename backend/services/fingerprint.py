import threading
import logging
from scapy.all import sniff, DHCP, DNS, DNSQR, IP, UDP, conf
from database import get_db

logger = logging.getLogger(__name__)

# คีย์เก็บข้อมูลชั่วคราว { mac: { hostname: str, os: str, brand: str } }
_fingerprint_cache = {}
_lock = threading.Lock()

def _update_device_info(mac, info):
    """อัปเดตข้อมูลลง MongoDB"""
    try:
        db = get_db()
        if db is not None:
            # ค้นหาและอัปเดตข้อมูลที่ได้มาใหม่
            db.devices.update_one(
                {"mac": mac.lower()},
                {"$set": info},
                upsert=False
            )
            logger.debug(f"🔍 Updated fingerprint for {mac}: {info}")
    except Exception as e:
        logger.error(f"Error updating device info: {e}")

def _fingerprint_callback(packet):
    """ฟังก์ชัน Callback สำหรับวิเคราะห์แพ็กเก็ต DHCP และ mDNS"""
    
    # 1. DHCP Fingerprinting (ดึง Hostname และเดา OS)
    if packet.haslayer(DHCP):
        options = packet[DHCP].options
        mac = packet.src.lower()
        new_info = {}
        
        for opt in options:
            if isinstance(opt, tuple):
                key, val = opt
                # Option 12 คือ Hostname
                if key == 'hostname':
                    hostname = val.decode(errors='ignore') if isinstance(val, bytes) else str(val)
                    new_info["hostname"] = hostname
                    logger.info(f"🏷️ Found DHCP Hostname: {hostname} for {mac}")
                
                # Option 55 คือ Parameter Request List (ใช้เดา OS)
                if key == 'param_req_list':
                    # ตัวอย่างการเดาแบบง่าย (ในอนาคตเพิ่ม DB ได้)
                    req_list = ",".join(map(str, val))
                    if "121" in req_list:
                        new_info["os"] = "Apple iOS/macOS"
                    elif "26" in req_list or "28" in req_list:
                        new_info["os"] = "Windows"
                    elif "51" in req_list:
                        new_info["os"] = "Android/Linux"
        
        if new_info:
            _update_device_info(mac, new_info)

    # 2. mDNS Discovery (ระบุยี่ห้อและบริการ)
    if packet.haslayer(UDP) and packet[UDP].dport == 5353:
        if packet.haslayer(DNSQR):
            qname = packet[DNSQR].qname.decode(errors='ignore').lower()
            mac = packet.src.lower()
            
            brand_info = None
            if "apple" in qname or "airplay" in qname or "iphone" in qname:
                brand_info = {"brand": "Apple", "os": "iOS/macOS"}
            elif "google" in qname or "cast" in qname:
                brand_info = {"brand": "Google/Android"}
            elif "samsung" in qname:
                brand_info = {"brand": "Samsung"}
                
            if brand_info:
                _update_device_info(mac, brand_info)

def _sniffer_thread():
    """รัน Sniffer ใน Background"""
    iface = conf.iface
    logger.info(f"🕵️ Fingerprint Sniffer started on {iface}...")
    try:
        # ดักฟัง DHCP (port 67, 68) และ mDNS (port 5353)
        sniff(iface=iface, filter="udp port 67 or udp port 68 or udp port 5353", 
              prn=_fingerprint_callback, store=0)
    except Exception as e:
        logger.error(f"Fingerprint Sniffer error: {e}")

def start_fingerprinting():
    """เริ่มระบบ Fingerprinting"""
    t = threading.Thread(target=_sniffer_thread, daemon=True)
    t.start()
    return t
