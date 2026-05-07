"use client";

import { useEffect, useState } from "react";

interface DeviceRecord {
    ip: string;
    mac: string;
    vendor: string;
    deviceType: string;
    status: string;
    ports: number[];
}

export default function DevicePage() {
    const [devices, setDevices] = useState<DeviceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices`)
            .then((res) => res.json())
            .then((data) => {
                console.log("👀 ข้อมูลจาก Backend:", data);
                if (data.devices && Array.isArray(data.devices)) {
                    setDevices(data.devices);
                } else if (Array.isArray(data)) {
                    setDevices(data);
                } else {
                    setDevices([]);
                }
                setIsLoading(false);
            })
            .catch((err) => {
                console.error("พังซะแล้ว:", err);
                setIsLoading(false);
            });
    }, []);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans text-slate-500">
                <p>กำลังโหลดข้อมูลอุปกรณ์...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold text-slate-800 mb-6">Devices</h1>

                {devices.length === 0 ? (
                    <div className="text-center text-slate-500 py-10">
                        ยังไม่พบอุปกรณ์ใน Network
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {devices.map((record, index) => (
                            <div
                                key={record.mac || index}
                                className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h2 className="text-lg font-semibold text-slate-900">
                                            {record.vendor || record.deviceType || "Unknown Device"}
                                        </h2>
                                        <div className="flex gap-3 mt-1">
                                            <p className="text-sm font-mono text-slate-600">IP: {record.ip}</p>
                                            <p className="text-sm font-mono text-slate-400">MAC: {record.mac}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium uppercase tracking-wider ${record.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                        {record.status || "UNKNOWN"}
                                    </span>
                                </div>

                                <div>
                                    <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Discovered Ports</p>
                                    <div className="flex flex-wrap gap-2">
                                        {record.ports && record.ports.length > 0 ? (
                                            record.ports.map((port, i) => (
                                                <span key={i} className="px-3 py-1 bg-indigo-50 text-indigo-700 text-sm font-mono rounded-md border border-indigo-100">
                                                    Port {port}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-sm text-slate-400 italic">No open ports found</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
