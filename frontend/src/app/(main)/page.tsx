"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchDevices } from "@/api/devices";
import { triggerScan } from "@/api/scan";
import Card from "@/components/Card";

export default function Home() {
  const { fetchWithAuth } = useAuth();
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ฟังก์ชันสำหรับดึงข้อมูลอุปกรณ์
  const loadDevices = () => {
    setIsLoading(true);
    setError(null);
    fetchDevices(fetchWithAuth)
      .then((data) => {
        setDevices(data);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.message !== "Unauthorized") {
          console.error("พังซะแล้ว:", err);
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
    setError(null);
    triggerScan(fetchWithAuth)
      .then((data) => {
        console.log("Scan complete:", data);
        if (data && data.message && !data.success && data.message.includes("Access denied")) {
          setError(data.message);
        }
        // แจ้ง Navbar ให้ refresh ชื่อ Wi-Fi
        window.dispatchEvent(new Event("wifi-ssid-refresh"));
        loadDevices();
      })
      .catch((err) => {
        if (err.message !== "Unauthorized") {
          console.error("Scan error:", err);
          setError("เกิดข้อผิดพลาดในการสแกน");
        }
      })
      .finally(() => {
        setIsScanning(false);
      });
  };

  const totalDevices = Array.isArray(devices) ? devices.length : 0;
  const onlineDevices = Array.isArray(devices) ? devices.filter((d: any) => d.status === "online").length : 0;
  const offlineDevices = totalDevices - onlineDevices;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6 md:p-10 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* ===== Header ===== */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 dark:from-blue-400 dark:via-indigo-400 dark:to-violet-400">
            Network Scanner
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            ค้นหาและตรวจสอบอุปกรณ์ทั้งหมดในเครือข่ายของคุณ
          </p>
        </div>

        {/* ===== ปุ่มสแกนใหญ่ ===== */}
        <div className="flex justify-center">
          <button
            id="scan-button"
            onClick={handleScan}
            disabled={isScanning}
            className={`
              relative group w-full max-w-md py-5 px-8 rounded-2xl font-bold text-lg text-white
              shadow-lg transition-all duration-300 ease-out
              flex items-center justify-center gap-3 overflow-hidden
              ${isScanning
                ? "bg-gray-400 dark:bg-gray-600 cursor-not-allowed shadow-none"
                : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 hover:shadow-xl hover:shadow-blue-500/25 hover:scale-[1.02] active:scale-[0.98]"
              }
            `}
          >
            {/* Animated glow behind button */}
            {!isScanning && (
              <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500" />
            )}

            {isScanning ? (
              <>
                {/* Spinning radar icon */}
                <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>กำลังสแกนเครือข่าย...</span>
              </>
            ) : (
              <>
                {/* Radar / scan icon */}
                <svg className="w-6 h-6 transition-transform duration-300 group-hover:rotate-12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <span>เริ่มสแกนเครือข่าย</span>
              </>
            )}
          </button>
        </div>

        {/* ===== Error Alert ===== */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/50 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* ===== Summary Cards ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total Devices */}
          <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200/60 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
            <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 dark:bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">อุปกรณ์ทั้งหมด</p>
            <p className="text-4xl font-bold text-gray-900 dark:text-white">
              {isLoading ? <span className="inline-block w-10 h-8 bg-gray-200 dark:bg-zinc-700 rounded animate-pulse" /> : totalDevices}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">เครื่อง</p>
          </div>

          {/* Online */}
          <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200/60 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
            <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">🟢 ออนไลน์</p>
            <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
              {isLoading ? <span className="inline-block w-10 h-8 bg-gray-200 dark:bg-zinc-700 rounded animate-pulse" /> : onlineDevices}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">เครื่อง</p>
          </div>

          {/* Offline */}
          <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200/60 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
            <div className="absolute top-0 right-0 w-20 h-20 bg-red-500/5 dark:bg-red-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">🔴 ออฟไลน์</p>
            <p className="text-4xl font-bold text-red-500 dark:text-red-400">
              {isLoading ? <span className="inline-block w-10 h-8 bg-gray-200 dark:bg-zinc-700 rounded animate-pulse" /> : offlineDevices}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">เครื่อง</p>
          </div>
        </div>

        {/* ===== Device List Card ===== */}
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200/60 dark:border-zinc-800 shadow-sm overflow-hidden">
          {/* Card Header */}
          <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              📋 รายการอุปกรณ์
            </h2>
            {!isLoading && totalDevices > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-zinc-800 px-2.5 py-1 rounded-full">
                {totalDevices} เครื่อง
              </span>
            )}
          </div>

          {/* Card Body — scrollable */}
          <div className="max-h-[420px] overflow-y-auto">
            {isLoading && !isScanning ? (
              <div className="p-8 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 bg-gray-100 dark:bg-zinc-800 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : totalDevices === 0 && !error ? (
              <div className="p-12 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-zinc-800 mb-4">
                  <svg className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                  </svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400 font-medium">ไม่พบอุปกรณ์ในระบบ</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">กดปุ่ม &quot;เริ่มสแกนเครือข่าย&quot; เพื่อค้นหาอุปกรณ์</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {Array.isArray(devices) && devices.map((device: any) => (
                  <Card key={device._id || Math.random()} device={device} />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}