import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { kickDevice, stopKick } from "@/api/kick";
import { Globe, Activity, Clock } from "lucide-react";

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

    // Start monitoring when modal opens
    useEffect(() => {
        const startMonitor = async () => {
            try {
                await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/monitor/start`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ip: device.ip, mac: device.mac }),
                });
            } catch (err) {
                console.error("Failed to start monitoring:", err);
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
                console.error("Failed to stop monitoring:", err);
            }
        };

        const fetchConnections = async () => {
            try {
                const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/monitor/${device.ip}`);
                if (res.ok) {
                    const data = await res.json();
                    setConnections(data);
                }
            } catch (err) {
                console.error("Failed to fetch connections:", err);
            }
        };

        startMonitor();
        const interval = setInterval(fetchConnections, 2000);

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
                className="bg-white dark:bg-zinc-900 rounded-[32px] shadow-2xl w-full max-w-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in zoom-in duration-300"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-8 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                    <div>
                        <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
                            Device Intelligence
                        </h2>
                        <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mt-1 flex items-center gap-1.5">
                            <Activity className="w-3 h-3" /> Real-time Analysis
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-400">✕</button>
                </div>

                <div className="p-8 max-h-[70vh] overflow-y-auto space-y-8">
                    {/* Device Info */}
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Network Address</p>
                            <p className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{device.ip}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Physical Identity</p>
                            <p className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{device.mac}</p>
                        </div>
                    </div>

                    {/* Live Connections Section */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Active Connections</p>
                            <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                                <span className="text-[10px] font-black text-indigo-500 uppercase">Live Sniffing</span>
                            </div>
                        </div>

                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                            {connections.length > 0 ? (
                                [...connections].reverse().map((conn, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 animate-in slide-in-from-right-4 duration-300">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-900 flex items-center justify-center border border-zinc-200 dark:border-zinc-800">
                                                <Globe className="w-4 h-4 text-indigo-500" />
                                            </div>
                                            <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">
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
                                <div className="p-8 rounded-3xl border-2 border-dashed border-zinc-100 dark:border-zinc-800 flex flex-col items-center justify-center text-center">
                                    <Globe className="w-8 h-8 text-zinc-200 dark:text-zinc-800 mb-2" />
                                    <p className="text-xs font-bold text-zinc-400">Waiting for traffic data...</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-4">
                        <button
                            onClick={handleToggleKick}
                            disabled={isLoading}
                            className={`w-full py-4 font-black rounded-2xl transition-all duration-300 shadow-lg active:scale-95 disabled:opacity-50 ${isKicked
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20"
                                : "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20"
                                }`}
                        >
                            {isLoading
                                ? "Processing..."
                                : isKicked
                                    ? "Release from Network"
                                    : "Kick from Network"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
