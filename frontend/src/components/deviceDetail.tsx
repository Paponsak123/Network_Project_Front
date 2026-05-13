"use client";

import { useEffect, useState, useRef } from "react";
import { 
    X, 
    MonitorSmartphone, 
    ShieldAlert, 
    ShieldCheck, 
    Activity, 
    Database,
    Search,
    RefreshCw
} from "lucide-react";
import { kickDevice, stopKick, getActiveKicks } from "@/api/kick";
import { fingerprintDevice } from "@/api/devices";
import { useAuth } from "@/hooks/useAuth";

interface KickStatus {
    ip: string;
    effective?: boolean;
    iface?: string;
    gateway?: string;
    warning?: string;
}

interface Device {
    _id?: string;
    ip: string;
    mac: string;
    vendor: string;
    hostname?: string;
    status: string;
    lastSeen?: string;
    os?: string;
    brand?: string;
}

interface DeviceDetailProps {
    device: Device;
    onClose: () => void;
    isKicked?: boolean;
    onKickChange?: (ip: string, kicked: boolean) => void;
}

export default function DeviceDetail({ device: initialDevice, onClose, isKicked: initialKicked = false, onKickChange }: DeviceDetailProps) {
    const { fetchWithAuth } = useAuth();
    const modalRef = useRef<HTMLDivElement>(null);
    const [device, setDevice] = useState(initialDevice);
    const [isKicked, setIsKicked] = useState(initialKicked);
    const [isLoading, setIsLoading] = useState(false);
    const [isFingerprinting, setIsFingerprinting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [kickStatus, setKickStatus] = useState<KickStatus | null>(null);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    // Poll backend liveness while kick is active so the UI can show
    // "actually working" vs "spoofed but device still online".
    useEffect(() => {
        if (!isKicked) {
            setKickStatus(null);
            return;
        }

        let cancelled = false;
        const refresh = async () => {
            try {
                const list = (await getActiveKicks(fetchWithAuth)) as KickStatus[];
                if (cancelled) return;
                const found = Array.isArray(list)
                    ? list.find((k) => k && k.ip === device.ip)
                    : undefined;
                setKickStatus(found || null);
            } catch {
                // Silently ignore — polling will retry.
            }
        };

        refresh();
        const id = setInterval(refresh, 4000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [isKicked, device.ip, fetchWithAuth]);

    const handleToggleKick = async (e: React.MouseEvent) => {
        e.stopPropagation(); // กัน Error ซ้อน
        if (isLoading) return; // กันกดซ้ำขณะ request ค้างอยู่
        setActionError(null);
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
        } catch (err: any) {
            if (err?.message === "Unauthorized") return; // useAuth will redirect
            console.error("Kick Error:", err);
            setActionError(err?.message || "Action failed");
        } finally {
            setIsLoading(false);
        }
    };

    const handleFingerprint = async (e: React.MouseEvent) => {
        e.stopPropagation(); // กัน Error ซ้อน
        if (isFingerprinting) return;
        if (!device._id) {
            setActionError("This device has no id yet — please run a scan first.");
            return;
        }
        setActionError(null);
        setIsFingerprinting(true);
        try {
            const result = await fingerprintDevice(fetchWithAuth, device._id);
            if (result && typeof result === "object" && "os" in result) {
                setDevice({ ...device, os: (result as any).os });
            }
        } catch (err: any) {
            if (err?.message === "Unauthorized") return;
            console.error("Fingerprint Error:", err);
            setActionError(err?.message || "Fingerprinting failed");
        } finally {
            setIsFingerprinting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div 
                ref={modalRef}
                className="bg-white dark:bg-zinc-950 w-full max-w-xl rounded-[2.5rem] shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-10 duration-500 relative"
            >
                {/* Header Section */}
                <div className="relative h-32 bg-indigo-600 overflow-hidden">
                    <div className="absolute inset-0 opacity-20">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_120%,rgba(255,255,255,0.3),transparent)]" />
                    </div>
                    <button 
                        onClick={onClose}
                        className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors backdrop-blur-md z-[110]"
                    >
                        <X className="w-5 h-5" />
                    </button>
                    <div className="absolute -bottom-10 left-10 w-24 h-24 rounded-3xl bg-white dark:bg-zinc-900 border-4 border-zinc-100 dark:border-zinc-800 shadow-xl flex items-center justify-center">
                        <MonitorSmartphone className="w-10 h-10 text-indigo-600" />
                    </div>
                </div>

                <div className="px-10 pt-14 pb-10 space-y-8">
                    {/* Device Header */}
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter">
                                {device.vendor || "Unknown Node"}
                            </h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs font-bold text-zinc-500 font-mono tracking-wider">{device.ip}</span>
                                <span className="w-1 h-1 rounded-full bg-zinc-300" />
                                <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{device.mac}</span>
                            </div>
                        </div>
                        <button 
                            type="button"
                            onClick={handleFingerprint}
                            disabled={isFingerprinting}
                            className="p-4 bg-zinc-100 dark:bg-zinc-900 rounded-2xl text-zinc-500 hover:text-indigo-600 transition-all active:scale-90 disabled:opacity-50 z-[110] border border-zinc-200 dark:border-zinc-800"
                            title="Identify OS"
                        >
                            <Search className={`w-5 h-5 ${isFingerprinting ? "animate-spin text-indigo-500" : ""}`} />
                        </button>
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="p-4 rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Status</p>
                            <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-xs font-black text-zinc-900 dark:text-white uppercase">Online</span>
                            </div>
                        </div>
                        <div className="p-4 rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Operating System</p>
                            <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase truncate block">
                                {isFingerprinting ? "Scanning..." : (device.os || "Undetected")}
                            </span>
                        </div>
                        <div className="p-4 rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1">Brand / Model</p>
                            <span className="text-xs font-black text-emerald-500 uppercase tracking-widest truncate block">
                                {device.brand || device.vendor || "Generic"}
                            </span>
                        </div>
                    </div>

                    {/* History Section placeholder */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <Activity className="w-3 h-3 text-emerald-500" /> Fingerprinting Engine
                            </h3>
                        </div>
                        <div className="p-6 rounded-[2rem] bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 border-dashed flex flex-col items-center justify-center text-center">
                            <div className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center mb-2 shadow-sm">
                                <RefreshCw className={`w-5 h-5 ${isFingerprinting ? "text-indigo-500 animate-spin" : "text-zinc-300"}`} />
                            </div>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                {isFingerprinting ? "Running deep TCP/IP analysis (this takes ~10s)..." : "Passive listening enabled. Click magnifying glass for active scan."}
                            </p>
                        </div>
                    </div>

                    {isKicked && kickStatus && (
                        <div
                            className={`p-3 rounded-xl text-xs font-medium border ${
                                kickStatus.effective
                                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20"
                                    : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20"
                            }`}
                        >
                            <div className="font-bold">
                                {kickStatus.effective
                                    ? "Kick is effective — target is unreachable."
                                    : "Spoofing active, but target is still responding. The router may have ARP protection (DAI)."}
                            </div>
                            <div className="mt-1 text-[10px] opacity-80">
                                iface: {kickStatus.iface || "?"} · gw: {kickStatus.gateway || "?"}
                            </div>
                            {kickStatus.warning && (
                                <div className="mt-1 text-[10px] opacity-90 italic">
                                    ⚠ {kickStatus.warning}
                                </div>
                            )}
                        </div>
                    )}

                    {actionError && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 rounded-xl text-xs font-medium">
                            {actionError}
                        </div>
                    )}

                    <div className="pt-8">
                        <button
                            type="button"
                            onClick={handleToggleKick}
                            disabled={isLoading}
                            className={`w-full py-4 rounded-2xl font-black text-sm transition-all duration-300 shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 z-[110] ${isKicked ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-rose-500 text-white hover:bg-rose-600"}`}
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : isKicked ? (
                                <><ShieldCheck className="w-5 h-5" /> Release Device</>
                            ) : (
                                <><ShieldAlert className="w-5 h-5" /> Kick from Network</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
