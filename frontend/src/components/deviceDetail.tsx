"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { kickDevice, stopKick } from "@/api/kick";
import { Globe, Activity, Clock, ShieldAlert, ShieldCheck } from "lucide-react";

interface DeviceRecord {
    ip: string;
    mac: string;
    vendor: string;
    deviceType: string;
    status: string;
    ports: number[];
}

interface Connection {
    host: string;
    time: number;
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
    const [connections, setConnections] = useState<Connection[]>([]);

    // --- Monitoring Logic ---
    useEffect(() => {
        const startMonitor = async () => {
            try {
                await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/monitor/start`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ip: device.ip, mac: device.mac }),
                });
            } catch (err) {
                console.error("Monitor error:", err);
            }
        };

        const stopMonitor = async () => {
            try {
                await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/monitor/stop`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ip: device.ip, mac: device.mac }),
                });
            } catch (err) {
                console.error("Stop monitor error:", err);
            }
        };

        const fetchActivity = async () => {
            try {
                const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/monitor/${device.ip}`);
                if (res.ok) {
                    const data = await res.json();
                    setConnections(data);
                }
            } catch (err) {
                console.error("Fetch activity error:", err);
            }
        };

        startMonitor();
        const interval = setInterval(fetchActivity, 2000);

        return () => {
            clearInterval(interval);
            stopMonitor();
        };
    }, [device.ip, device.mac, fetchWithAuth]);

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
            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-zinc-950 rounded-[32px] shadow-2xl w-full max-w-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in zoom-in duration-300"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header Section */}
                <div className="flex justify-between items-center p-8 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                    <div>
                        <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter">
                            Device Intel<span className="text-indigo-600">.</span>
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${device.status === "online" ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                {device.status} Signal
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-all text-zinc-400">✕</button>
                </div>

                <div className="p-8 max-h-[70vh] overflow-y-auto space-y-8 custom-scrollbar">
                    {/* Identification Section */}
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Network Location</p>
                            <p className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{device.ip}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Physical Address</p>
                            <p className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{device.mac}</p>
                        </div>
                    </div>

                    {/* Live Connections Section */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <Activity className="w-3 h-3 text-indigo-500" /> Live Connections
                            </h3>
                            <span className="text-[9px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full uppercase">Real-time Sniffing</span>
                        </div>
                        
                        <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                            {connections.length > 0 ? (
                                [...connections].reverse().map((conn, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 animate-in slide-in-from-right-4 duration-300">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-900 flex items-center justify-center border border-zinc-200 dark:border-zinc-800">
                                                <Globe className="w-4 h-4 text-indigo-500" />
                                            </div>
                                            <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 truncate max-w-[220px]">
                                                {conn.host}
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-bold text-zinc-400 flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {new Date(conn.time * 1000).toLocaleTimeString()}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-3xl">
                                    <Activity className="w-8 h-8 text-zinc-200 dark:text-zinc-800 mb-3 animate-pulse" />
                                    <p className="text-xs font-bold text-zinc-400">Capturing data packets...</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Hardware Info */}
                    <div className="p-6 rounded-3xl bg-zinc-50/50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Hardware Fingerprint</p>
                        <p className="text-sm font-black text-zinc-900 dark:text-white">
                            {device.vendor || "Generic Hardware Provider"}
                        </p>
                        <p className="text-xs font-bold text-zinc-500 mt-1">
                            Device Category: {device.deviceType || "General Node"}
                        </p>
                    </div>

                    {/* Action Section */}
                    <div className="pt-4">
                        <button
                            onClick={handleToggleKick}
                            disabled={isLoading}
                            className={`w-full py-4 rounded-2xl font-black text-sm tracking-tight transition-all duration-300 shadow-xl active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 ${
                                isKicked
                                    ? "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20"
                                    : "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20"
                            }`}
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : isKicked ? (
                                <>
                                    <ShieldCheck className="w-5 h-5" />
                                    Release Target
                                </>
                            ) : (
                                <>
                                    <ShieldAlert className="w-5 h-5" />
                                    Execute Disconnect
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
