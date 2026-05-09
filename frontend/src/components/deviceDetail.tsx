"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { kickDevice, stopKick } from "@/api/kick";

interface DeviceRecord {
    ip: string;
    mac: string;
    vendor: string;
    deviceType: string;
    status: string;
    ports: number[];
}

export default function DeviceDetailModal({
    device,
    onClose,
    isKicked: initialKicked = false,
    onKickChange,
}: {
    device: DeviceRecord;
    onClose: () => void;
    isKicked?: boolean;
    onKickChange?: (ip: string, kicked: boolean) => void;
}) {
    const { fetchWithAuth } = useAuth();
    const [isKicked, setIsKicked] = useState(initialKicked);
    const [isLoading, setIsLoading] = useState(false);

    const handleToggleKick = async () => {
        setIsLoading(true);
        try {
            if (isKicked) {
                await stopKick(fetchWithAuth, device.ip);
                setIsKicked(false);
                onKickChange?.(device.ip, false);
            } else {
                await kickDevice(fetchWithAuth, device.ip, device.mac);
                setIsKicked(true);
                onKickChange?.(device.ip, true);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
            alert(message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-xl w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h2 className="text-lg font-bold text-slate-800">รายละเอียดอุปกรณ์</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
                </div>

                <div className="p-6 flex flex-col gap-4">
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">ชื่ออุปกรณ์</p>
                        <p className="text-slate-800 font-semibold">{device.vendor || device.deviceType || "Unknown Device"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">IP Address</p>
                            <p className="font-mono text-slate-700">{device.ip}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">MAC Address</p>
                            <p className="font-mono text-slate-700">{device.mac}</p>
                        </div>
                    </div>
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Device Type</p>
                        <p className="text-slate-700">{device.deviceType || "-"}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Status</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium uppercase ${device.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {device.status || "UNKNOWN"}
                        </span>
                    </div>
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Discovered Ports</p>
                        <div className="flex flex-wrap gap-2">
                            {device.ports?.length > 0 ? (
                                device.ports.map((port, i) => (
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

                <div className="p-6 pt-0">
                    <button
                        onClick={handleToggleKick}
                        disabled={isLoading}
                        className={`w-full py-2.5 font-semibold rounded-xl transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                            isKicked
                                ? "bg-green-500 hover:bg-green-600 text-white"
                                : "bg-red-500 hover:bg-red-600 text-white"
                        }`}
                    >
                        {isLoading
                            ? "⏳ กำลังดำเนินการ..."
                            : isKicked
                                ? "✅ ปล่อยกลับเข้าเน็ต"
                                : "🚫 เตะออกจากเน็ต"}
                    </button>
                </div>
            </div>
        </div>
    );
}