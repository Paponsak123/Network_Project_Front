"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const { fetchWithAuth, handleUnauthorized } = useAuth();
  // สร้างกล่องเก็บข้อมูลอุปกรณ์ที่ดึงมาได้
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ฟังก์ชันสำหรับดึงข้อมูลอุปกรณ์
  const fetchDevices = () => {
    setIsLoading(true);
    setError(null);
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/devices`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setDevices(data); // เอาข้อมูลเก็บใส่กล่อง
        } else if (data && data.message) {
          setError(data.message); // แสดง Error message หาก Backend ส่งกลับมาเป็น Object Error
          setDevices([]);
        } else {
          setDevices([]);
        }
        setIsLoading(false); // ปิดสถานะโหลด
      })
      .catch((err) => {
        if (err.message !== "Unauthorized") {
          console.error("พังซะแล้ว:", err);
          setError("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
          setIsLoading(false);
        }
      });
  };

  // useEffect จะทำงาน 1 ครั้งตอนเปิดหน้าเว็บมา
  useEffect(() => {
    fetchDevices();
  }, []);

  // ฟังก์ชันสำหรับกดปุ่มสแกน
  const handleScan = () => {
    setIsScanning(true);
    setError(null);
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/scan`, {
      method: "POST",
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Scan complete:", data);
        if (data && data.message && !data.success && data.message.includes("Access denied")) {
          setError(data.message);
        }
        // ดึงข้อมูลใหม่หลังจากสแกนเสร็จ
        fetchDevices();
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

  const handleLogout = () => {
    handleUnauthorized();
  };

  return (
    <div className="p-10 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">📡 รายชื่ออุปกรณ์ใน Network</h1>
          <button 
            onClick={handleLogout}
            className="text-sm px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors"
          >
            Logout
          </button>
        </div>
        <button
          onClick={handleScan}
          disabled={isScanning}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isScanning ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              กำลังสแกน...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
              เริ่มสแกน
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 dark:bg-red-900/30 dark:text-red-400 dark:border-red-600 rounded-r-lg">
          <p className="font-semibold">Error:</p>
          <p>{error}</p>
        </div>
      )}

      {isLoading && !isScanning ? (
        <p className="text-gray-500">กำลังดึงข้อมูล...</p>
      ) : (
        <ul className="space-y-3">
          {/* เอาข้อมูลในกล่องมาวนลูปแสดงผล */}
          {Array.isArray(devices) && devices.map((device: any) => (
            <li key={device._id || Math.random()} className="p-4 border rounded-lg shadow-sm bg-white dark:bg-zinc-900 text-black dark:text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-medium text-lg mb-1">{device.customName || device.vendor || "Unknown Device"}</p>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 text-sm text-gray-600 dark:text-gray-400">
                  <p><span className="font-semibold text-gray-700 dark:text-gray-300">IP:</span> {device.ip}</p>
                  <p><span className="font-semibold text-gray-700 dark:text-gray-300">MAC:</span> {device.mac}</p>
                </div>
              </div>
              <div className="flex-shrink-0">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
                  device.status === 'online' 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {device.status === 'online' ? '🟢 Online' : '🔴 Offline'}
                </span>
              </div>
            </li>
          ))}
          {Array.isArray(devices) && devices.length === 0 && !error && (
            <li className="p-8 text-center text-gray-500 bg-gray-50 dark:bg-zinc-900/50 rounded-lg border border-dashed border-gray-300 dark:border-zinc-700">
              ไม่พบอุปกรณ์ในระบบ ลองกดปุ่ม "เริ่มสแกน" เพื่อค้นหาอุปกรณ์ในเครือข่าย
            </li>
          )}
        </ul>
      )}
    </div>
  );
}