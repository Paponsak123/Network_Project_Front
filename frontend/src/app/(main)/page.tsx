"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { triggerScan } from "@/api/scan";
import Card from "@/components/Card";
import CircularScanner from "@/components/CircularScanner";
import { Info, Activity, Database, LayoutDashboard } from "lucide-react";

export default function Home() {
  const { fetchWithAuth } = useAuth();
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // ฟังก์ชันสำหรับดึงข้อมูลอุปกรณ์
  const loadDevices = () => {
    setIsLoading(true);
    setError(null);
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/scan/latest`)
      .then((res) => res.json())
      .then((data) => {
        setDevices(data.devices || []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.message !== "Unauthorized") {
          console.error("Load error:", err);
          setError("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
          setIsLoading(false);
        }
      });
  };

  useEffect(() => {
    loadDevices();
  }, []);

  // ฟังก์ชันสำหรับกดปุ่มสแกน
  const handleScan = () => {
    setIsScanning(true);
    setScanStatus("scanning");
    setIsLoading(true);
    setError(null);
    
    triggerScan(fetchWithAuth)
      .then((data) => {
        if (data && data.message && !data.success && data.message.includes("Access denied")) {
          setError(data.message);
        }

        if (data && Array.isArray(data.devices)) {
          setDevices(data.devices);
        }

        // แจ้ง Navbar ให้ refresh ชื่อ Wi-Fi
        window.dispatchEvent(new Event("wifi-ssid-refresh"));
        
        // เมื่อเสร็จสิ้น เปลี่ยนเป็น Done แล้วรอ 2 วินาทีก่อน Reset
        setScanStatus("done");
        setTimeout(() => {
          setScanStatus("idle");
        }, 2000);
      })
      .catch((err) => {
        if (err.message !== "Unauthorized") {
          console.error("Scan error:", err);
          setError("เกิดข้อผิดพลาดในการสแกน");
          setScanStatus("idle");
        }
      })
      .finally(() => {
        setIsScanning(false);
        setIsLoading(false);
      });
  };

  const totalDevices = Array.isArray(devices) ? devices.length : 0;
  const onlineDevices = Array.isArray(devices) ? devices.filter((d: any) => d.status === "online").length : 0;
  const offlineDevices = totalDevices - onlineDevices;

  return (
    <div className="p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-12">

        {/* ===== Header ===== */}
        <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-top-4 duration-1000">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
            <Activity className="w-3 h-3 animate-pulse" />
            Network Status: Live
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-zinc-900 dark:text-white tracking-tighter">
            Scanner<span className="text-indigo-600">.</span>
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-center max-w-sm mx-auto text-sm font-medium leading-relaxed">
            Real-time network intelligence for your connected environment.
          </p>
        </div>

        {/* ===== Circular Scanner (Centerpiece) ===== */}
        <div className="flex flex-col items-center justify-center space-y-8 py-4 animate-in fade-in zoom-in duration-1000 delay-200">
          <CircularScanner 
            isScanning={isScanning} 
            onScan={handleScan} 
            status={scanStatus} 
          />
          
          {/* Status Indicator Bar */}
          <div className="flex items-center gap-10 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md px-8 py-4 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm transition-all duration-500 hover:shadow-md">
            <div className="flex flex-col items-center">
              <span className="text-3xl font-black text-zinc-900 dark:text-white leading-none">{totalDevices}</span>
              <span className="text-[10px] uppercase font-black text-zinc-400 tracking-widest mt-1">Total</span>
            </div>
            <div className="w-px h-10 bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex flex-col items-center">
              <span className="text-3xl font-black text-emerald-500 leading-none">{onlineDevices}</span>
              <span className="text-[10px] uppercase font-black text-zinc-400 tracking-widest mt-1">Online</span>
            </div>
            <div className="w-px h-10 bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex flex-col items-center">
              <span className="text-3xl font-black text-rose-500 leading-none">{offlineDevices}</span>
              <span className="text-[10px] uppercase font-black text-zinc-400 tracking-widest mt-1">Offline</span>
            </div>
          </div>
        </div>

        {/* ===== Error Alert ===== */}
        {error && (
          <div className="max-w-md mx-auto p-4 bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
            <Info className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {/* ===== Device List Section ===== */}
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Nodes</h2>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Connected Infrastructure</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {isLoading && !isScanning ? (
              [...Array(6)].map((_, i) => (
                <div key={i} className="h-32 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl animate-pulse" />
              ))
            ) : totalDevices === 0 && !error ? (
              <div className="col-span-full py-24 text-center space-y-6 bg-white dark:bg-zinc-900/30 rounded-[3rem] border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-zinc-100 dark:bg-zinc-900 mb-2">
                  <Database className="w-10 h-10 text-zinc-300" />
                </div>
                <div className="space-y-2">
                  <p className="text-zinc-900 dark:text-white font-black text-2xl tracking-tighter">No Active Nodes</p>
                  <p className="text-sm text-zinc-400 max-w-xs mx-auto font-medium">Initialize a scan to discover devices on your current subnet.</p>
                </div>
              </div>
            ) : (
              Array.isArray(devices) && devices.map((device: any, idx) => (
                <div 
                  key={device._id || device.mac || Math.random()} 
                  className="animate-in fade-in slide-in-from-bottom-4 duration-500"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <Card device={device} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}