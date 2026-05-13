"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchScanHistory } from "@/api/scan";
import { History as HistoryIcon, ChevronDown, ChevronUp, Calendar, Database, Loader2, Search } from "lucide-react";

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
        let cancelled = false;
        fetchScanHistory(fetchWithAuth)
            .then((data) => {
                if (cancelled) return;
                setScans(Array.isArray(data) ? (data as ScanRecord[]) : []);
                setIsLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                if (err?.message !== "Unauthorized") {
                    console.error("Load error:", err);
                    setScans([]);
                    setIsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [fetchWithAuth]);

    return (
        <div className="p-6 md:p-10">
            <div className="max-w-4xl mx-auto space-y-12">
                {/* Header */}
                <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-top-4 duration-1000">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
                        <HistoryIcon className="w-3 h-3" />
                        ScanDer records
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter text-center">
                        History<span className="text-indigo-600">.</span>
                    </h1>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                        <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Accessing Records...</p>
                    </div>
                ) : scans.length === 0 ? (
                    <div className="py-24 text-center space-y-6 bg-white dark:bg-zinc-900/30 rounded-[3rem] border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                        <Database className="w-10 h-10 text-zinc-300 mx-auto" />
                        <p className="text-zinc-900 dark:text-white font-black text-2xl tracking-tighter">Archive Empty</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        {scans.map((scan, idx) => (
                            <div
                                key={scan._id}
                                className="group bg-white dark:bg-zinc-900/80 backdrop-blur-sm rounded-[2rem] border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
                                style={{ animationDelay: `${idx * 100}ms` }}
                            >
                                <button
                                    className="w-full flex justify-between items-center p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors duration-300 text-left"
                                    onClick={() =>
                                        setExpandedId(expandedId === scan._id ? null : scan._id)
                                    }
                                >
                                    <div className="flex items-center gap-6">
                                        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                                            <Calendar className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <p className="font-black text-zinc-900 dark:text-white tracking-tight">
                                                {new Date(scan.scanTime + "Z").toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
                                            </p>
                                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-1">
                                                Nodes Discovered: {scan.totalDevices}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 group-hover:text-indigo-600 transition-colors">
                                        {expandedId === scan._id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                    </div>
                                </button>

                                {expandedId === scan._id && (
                                    <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 p-6 space-y-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {scan.devices.map((device, i) => (
                                                <div key={i} className="p-4 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 flex flex-col justify-between transition-all duration-300 hover:border-indigo-500/20">
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <p className="font-bold text-zinc-900 dark:text-white text-sm">
                                                                {device.vendor || "Generic Device"}
                                                            </p>
                                                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter ${device.status === "up" || device.status === "online" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"}`}>
                                                                {device.status || "UNKNOWN"}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] font-mono font-bold text-zinc-400 tracking-tight">
                                                            {device.ip} · {device.mac}
                                                        </p>
                                                        {device.ports && device.ports.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-3">
                                                                {device.ports.map((port, j) => (
                                                                    <span key={j} className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-[9px] font-black rounded-lg border border-indigo-100 dark:border-indigo-900/50 uppercase tracking-widest">
                                                                        P{port}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
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