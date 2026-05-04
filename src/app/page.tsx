"use client";

import { useEffect, useState } from "react";

export default function Home() {
  // สร้างกล่องเก็บข้อมูลอุปกรณ์ที่ดึงมาได้
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // useEffect จะทำงาน 1 ครั้งตอนเปิดหน้าเว็บมา
  useEffect(() => {
    // ยิงไปถาม Backend ที่ /api/devices
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices`)
      .then((res) => res.json())
      .then((data) => {
        setDevices(data); // เอาข้อมูลเก็บใส่กล่อง
        setIsLoading(false); // ปิดสถานะโหลด
      })
      .catch((err) => console.error("พังซะแล้ว:", err));
  }, []);

  return (
    <div className="p-10 font-sans">
      <h1 className="text-3xl font-bold mb-6">📡 รายชื่ออุปกรณ์ใน Network</h1>

      {isLoading ? (
        <p>กำลังดึงข้อมูล...</p>
      ) : (
        <ul className="space-y-3">
          {/* เอาข้อมูลในกล่องมาวนลูปแสดงผล */}
          {devices.map((device: any) => (
            <li key={device._id} className="p-4 border rounded-lg shadow-sm bg-gray-50 text-black">
              <p><strong>ชื่อ:</strong> {device.customName || "Unknown Device"}</p>
              <p><strong>IP:</strong> {device.ip}</p>
              <p><strong>MAC:</strong> {device.mac}</p>
              <p><strong>สถานะ:</strong> {device.status === 'online' ? '🟢 Online' : '🔴 Offline'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}