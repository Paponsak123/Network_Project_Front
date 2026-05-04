"use client";

import { useEffect, useState } from "react";

export default function HistoryPage() {
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
}