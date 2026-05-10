"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getActiveKicks } from "@/api/kick";
import DeviceDetailModal from "@/components/deviceDetail";
import { MonitorSmartphone, ShieldAlert, Cpu, Laptop, Smartphone, Server, Loader2, Database, History } from "lucide-react";

interface DeviceRecord {
    ip: string;
    mac: string;
    vendor: string;
    deviceType: string;
    status: string;
    ports: number[];
}

const getDeviceIcon = (vendor: string = "") => {
    const v = vendor.toLowerCase();
    if (v.includes("apple") || v.includes("samsung") || v.includes("google")) return <Smartphone className="w-5 h-5" />;
    if (v.includes("intel") || v.includes("dell") || v.includes("hp") || v.includes("lenovo")) return <Laptop className="w-5 h-5" />;
    if (v.includes("tp-link") || v.includes("cisco") || v.includes("ubiquiti")) return <Server className="w-5 h-5" />;
    return <Cpu className="w-5 h-5" />;
};

export default function DevicePage() {
    const { fetchWithAuth } = useAuth();
    const [devices, setDevices] = useState<DeviceRecord[]>([]);
    const [scanTime, setScanTime] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState<DeviceRecord | null>(null);
    const [kickedIPs, setKickedIPs] = useState<Set<string>>(new Set());

    const loadLatestDevices = () => {
        setIsLoading(true);
        Promise.all([
            fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/scan/latest`).then(res => res.json()),
            getActiveKicks(fetchWithAuth).catch(() => []),
        ])
            .then(([latestScan, activeKicks]) => {
                setDevices(latestScan.devices || []);
                setScanTime(latestScan.scanTime);
                setKickedIPs(new Set(activeKicks.map((k: { ip: string }) => k.ip)));
                setIsLoading(false);
            })
            .catch((err) => {
                if (err.message !== "Unauthorized") {
                    console.error("Load error:", err);
                    setIsLoading(false);
                }
            });
    };

    useEffect(() => {
        loadLatestDevices();
    }, []);

    const handleKickChange = (ip: string, kicked: boolean) => {
        setKickedIPs((prev) => {
            const next = new Set(prev);
            if (kicked) next.add(ip);
            else next.delete(ip);
            return next;
        });
    };

    return (
        <div className="p-6 md:p-10">
            <div className="max-w-5xl mx-auto space-y-12">
                {/* Header */}
                <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-top-4 duration-1000">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
                        <MonitorSmartphone className="w-3 h-3" />
                        Latest Scan Results
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter text-center">
                        Devices<span className="text-indigo-600">.</span>
                    </h1>
                    {scanTime && (
                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest flex items-center gap-2 bg-white/50 dark:bg-zinc-900/50 px-4 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800">
                            <History className="w-3 h-3" />
                            Last Scan: {new Date(scanTime).toLocaleString("th-TH")}
                        </p>
                    )}
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                        <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Accessing Latest Snapshot...</p>
                    </div>
                ) : devices.length === 0 ? (
                    <div className="py-24 text-center space-y-6 bg-white dark:bg-zinc-900/30 rounded-[3rem] border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                        <Database className="w-10 h-10 text-zinc-300 mx-auto" />
                        <p className="text-zinc-900 dark:text-white font-black text-2xl tracking-tighter">No Recent Scan Data</p>
                        <p className="text-sm text-zinc-400 max-w-xs mx-auto font-medium">Please perform a new scan from the Home dashboard.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                        {devices.map((record, idx) => {
                            const isOnline = record.status === "online" || record.status === "up";
                            const isKicked = kickedIPs.has(record.ip);
                            return (
                                <div
                                    key={record.mac || idx}
                                    onClick={() => setSelectedDevice(record)}
                                    className="group relative p-6 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-500/30 cursor-pointer animate-in fade-in slide-in-from-bottom-4"
                                    style={{ animationDelay: `${idx * 50}ms` }}
                                >
                                    <div className={`absolute top-0 left-0 w-1 h-full ${isKicked ? "bg-orange-500" : isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />

                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isOnline ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>
                                                {getDeviceIcon(record.vendor)}
                                            </div>
                                            <div>
                                                <h2 className="font-black text-zinc-900 dark:text-white tracking-tight">
                                                    {record.vendor || "Generic Device"}
                                                </h2>
                                                <div className="flex gap-3 mt-1">
                                                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{record.ip}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isKicked && (
                                                <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 flex items-center gap-1">
                                                    <ShieldAlert className="w-3 h-3" /> Kicked
                                                </span>
                                            )}
                                            <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${isOnline ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400"}`}>
                                                {record.status}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-2">
                                            {record.ports?.length > 0 ? (
                                                record.ports.map((port, i) => (
                                                    <span key={i} className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-[10px] font-black rounded-xl border border-indigo-100 dark:border-indigo-900/50 uppercase tracking-widest">
                                                        Port {port}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">No Active Ports</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {selectedDevice && (
                <DeviceDetailModal
                    device={selectedDevice}
                    onClose={() => setSelectedDevice(null)}
                    isKicked={kickedIPs.has(selectedDevice.ip)}
                    onKickChange={handleKickChange}
                />
            )}
        </div>
    );
}