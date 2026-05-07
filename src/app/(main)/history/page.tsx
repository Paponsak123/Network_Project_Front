"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

interface DeviceSnapshot {
    ip: string;
    mac: string;
    vendor: string;
    deviceType: string;
    status: string;
    ports: number[];
}

interface ScanRecord {
    _id: string;
    scanTime: string;
    totalDevices: number;
    devices: DeviceSnapshot[];
}

export default function HistoryPage() {
    const { fetchWithAuth } = useAuth();
    const [scans, setScans] = useState<ScanRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/scan/history`)
            .then((res) => res.json())
            .then((data) => {
                console.log("📜 Scan history:", data);
                setScans(Array.isArray(data) ? data : []);
                setIsLoading(false);
            })
            .catch((err) => {
                if (err.message !== "Unauthorized") {
                    console.error("พังซะแล้ว:", err);
                    setIsLoading(false);
                }
            });
    }, []);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans text-slate-500">
                <p>กำลังโหลดประวัติการสแกน...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold text-slate-800 mb-6">Scan History</h1>

                {scans.length === 0 ? (
                    <div className="text-center text-slate-500 py-10">
                        ยังไม่มีประวัติการสแกน Network
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {scans.map((scan) => (
                            <div
                                key={scan._id}
                                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                            >
                                <button
                                    className="w-full flex justify-between items-center p-5 hover:bg-slate-50 transition-colors duration-150 text-left"
                                    onClick={() =>
                                        setExpandedId(expandedId === scan._id ? null : scan._id)
                                    }
                                >
                                    <div>
                                        <p className="font-semibold text-slate-800">
                                            🕐 {new Date(scan.scanTime).toLocaleString("th-TH")}
                                        </p>
                                        <p className="text-sm text-slate-500 mt-0.5">
                                            พบอุปกรณ์ทั้งหมด {scan.totalDevices} เครื่อง
                                        </p>
                                    </div>
                                    <span className="text-slate-400 text-lg">
                                        {expandedId === scan._id ? "▲" : "▼"}
                                    </span>
                                </button>

                                {expandedId === scan._id && (
                                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                                        {scan.devices.map((device, i) => (
                                            <div key={i} className="p-4 flex justify-between items-start">
                                                <div>
                                                    <p className="font-medium text-slate-800">
                                                        {device.vendor || device.deviceType || "Unknown Device"}
                                                    </p>
                                                    <p className="text-sm font-mono text-slate-500">
                                                        {device.ip} · {device.mac}
                                                    </p>
                                                    {device.ports && device.ports.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-2">
                                                            {device.ports.map((port, j) => (
                                                                <span key={j} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-mono rounded border border-indigo-100">
                                                                    Port {port}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium uppercase tracking-wider ${device.status === "up" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                                    {device.status || "UNKNOWN"}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}