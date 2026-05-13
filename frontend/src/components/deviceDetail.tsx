"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    X,
    MonitorSmartphone,
    ShieldAlert,
    ShieldCheck,
    Activity,
    Search,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Signal,
    Wifi,
    Server,
} from "lucide-react";
import { kickDevice, stopKick, getActiveKicks } from "@/api/kick";
import {
    fingerprintDevice,
    fetchDeviceSignals,
    type FingerprintResult,
    type FingerprintIndicator,
} from "@/api/devices";
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
    vendor?: string;
    hostname?: string;
    status?: string;
    lastSeen?: string;
    os?: string;
    brand?: string;
    customName?: string;
    deviceType?: string;
    ports?: number[];
    fingerprint?: FingerprintResult | null;
    raw_signals?: Record<string, unknown>;
    lastFingerprintedAt?: string;
    updatedAt?: string;
}

interface DeviceDetailProps {
    device: Device;
    onClose: () => void;
    isKicked?: boolean;
    onKickChange?: (ip: string, kicked: boolean) => void;
}

const PORT_SERVICE: Record<number, string> = {
    20: "FTP-data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP",
    53: "DNS", 67: "DHCP", 68: "DHCP", 80: "HTTP", 110: "POP3",
    123: "NTP", 137: "NBNS", 139: "NetBIOS", 143: "IMAP", 161: "SNMP",
    389: "LDAP", 443: "HTTPS", 445: "SMB", 515: "LPD", 548: "AFP",
    554: "RTSP", 587: "SMTP", 631: "IPP", 993: "IMAPS", 995: "POP3S",
    1883: "MQTT", 1900: "SSDP", 3000: "HTTP-alt", 3306: "MySQL",
    3389: "RDP", 5000: "UPnP", 5353: "mDNS", 5355: "LLMNR",
    5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 8000: "HTTP-alt",
    8080: "HTTP-proxy", 8443: "HTTPS-alt", 9000: "HTTP-alt",
    9100: "Printer", 27017: "MongoDB", 62078: "iPhone-Sync",
};

function classNames(...args: (string | false | null | undefined)[]) {
    return args.filter(Boolean).join(" ");
}

function ConfidenceBar({ value }: { value: number }) {
    const pct = Math.max(0, Math.min(100, value));
    const color =
        pct >= 75 ? "bg-emerald-500" :
        pct >= 50 ? "bg-indigo-500" :
        pct >= 25 ? "bg-amber-500" : "bg-rose-500";
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-black tabular-nums tracking-widest text-zinc-500 dark:text-zinc-400">
                {pct}%
            </span>
        </div>
    );
}

function Section({ icon, title, children, defaultOpen = true }: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between p-3 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition"
            >
                <div className="flex items-center gap-2">
                    <span className="text-indigo-500">{icon}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-300">
                        {title}
                    </span>
                </div>
                {open ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </button>
            {open && <div className="p-3 pt-0">{children}</div>}
        </div>
    );
}

function formatTs(ts?: string | null) {
    if (!ts) return null;
    try {
        return new Date(ts).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    } catch {
        return ts;
    }
}

export default function DeviceDetail({
    device: initialDevice,
    onClose,
    isKicked: initialKicked = false,
    onKickChange,
}: DeviceDetailProps) {
    const { fetchWithAuth } = useAuth();
    const modalRef = useRef<HTMLDivElement>(null);
    const [device, setDevice] = useState<Device>(initialDevice);
    const [isKicked, setIsKicked] = useState(initialKicked);
    const [isLoading, setIsLoading] = useState(false);
    const [isFingerprinting, setIsFingerprinting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [kickStatus, setKickStatus] = useState<KickStatus | null>(null);
    const [signalsData, setSignalsData] = useState<any | null>(null);
    const [showRaw, setShowRaw] = useState(false);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    useEffect(() => {
        if (!device._id) return;
        let cancelled = false;
        fetchDeviceSignals(fetchWithAuth, device._id)
            .then((data) => { if (!cancelled) setSignalsData(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [device._id, fetchWithAuth]);

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
            } catch {}
        };
        refresh();
        const id = setInterval(refresh, 4000);
        return () => { cancelled = true; clearInterval(id); };
    }, [isKicked, device.ip, fetchWithAuth]);

    const handleToggleKick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isLoading) return;
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
            if (err?.message === "Unauthorized") return;
            setActionError(err?.message || "Action failed");
        } finally {
            setIsLoading(false);
        }
    };

    const handleFingerprint = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isFingerprinting) return;
        if (!device._id) {
            setActionError("This device has no id yet — please run a scan first.");
            return;
        }
        setActionError(null);
        setIsFingerprinting(true);
        try {
            const result = (await fingerprintDevice(fetchWithAuth, device._id, {
                refresh: true,
            })) as FingerprintResult;
            setDevice((d) => ({
                ...d,
                fingerprint: result,
                os: result.os || d.os,
                brand: result.brand || d.brand,
                hostname: result.hostname || d.hostname,
                deviceType: result.device_type || d.deviceType,
            }));
            if (device._id) {
                try {
                    const sigs = await fetchDeviceSignals(fetchWithAuth, device._id);
                    setSignalsData(sigs);
                } catch {}
            }
        } catch (err: any) {
            if (err?.message === "Unauthorized") return;
            setActionError(err?.message || "Fingerprinting failed");
        } finally {
            setIsFingerprinting(false);
        }
    };

    const fp = device.fingerprint ?? null;
    const displayName =
        device.customName || fp?.brand || device.brand || device.vendor || "Unknown Node";

    const subtitle = useMemo(() => {
        const parts: string[] = [];
        if (fp?.os || device.os) parts.push(String(fp?.os || device.os));
        if (fp?.device_type || device.deviceType) parts.push(String(fp?.device_type || device.deviceType));
        if (fp?.brand || device.brand || device.vendor) parts.push(String(fp?.brand || device.brand || device.vendor));
        return parts.join(" · ");
    }, [fp, device]);

    const ports = Array.isArray(device.ports) ? device.ports : [];
    const isOnline = device.status === "online" || device.status === "up";

    const groupedIndicators = useMemo(() => {
        if (!fp?.indicators) return {} as Record<string, FingerprintIndicator[]>;
        const out: Record<string, FingerprintIndicator[]> = {};
        for (const ind of fp.indicators) {
            (out[ind.source] ||= []).push(ind);
        }
        return out;
    }, [fp]);

    const protocolsSeen = useMemo(() => {
        const out = new Set<string>();
        const passive = (signalsData?.passive || {}) as Record<string, unknown>;
        for (const k of Object.keys(passive)) {
            if (k === "meta") continue;
            out.add(k.toUpperCase());
        }
        const active = (signalsData?.active || {}) as Record<string, unknown>;
        for (const k of Object.keys(active)) {
            out.add(`${k.toUpperCase()} (active)`);
        }
        return Array.from(out);
    }, [signalsData]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="bg-white dark:bg-zinc-950 w-full max-w-2xl max-h-[92vh] rounded-[2.5rem] shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-10 duration-500 relative"
            >
                {/* Header */}
                <div className="relative bg-indigo-600 overflow-hidden flex-shrink-0 px-8 pt-6 pb-5 flex items-center gap-4">
                    <div className="absolute inset-0 opacity-20 pointer-events-none">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_120%,rgba(255,255,255,0.3),transparent)]" />
                    </div>
                    <div className="relative w-14 h-14 rounded-2xl bg-white/20 backdrop-blur border border-white/30 shadow-lg flex items-center justify-center flex-shrink-0">
                        <MonitorSmartphone className="w-7 h-7 text-white" />
                    </div>
                    <div className="flex-1 min-w-0" />
                    <button
                        onClick={onClose}
                        className="relative p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors backdrop-blur-md"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-8 pt-5 pb-6 space-y-5">
                    {/* Identity */}
                    <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                            <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter truncate">
                                {displayName}
                            </h2>
                            {subtitle && (
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mt-1">
                                    {subtitle}
                                </p>
                            )}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                                <span className="text-xs font-bold text-zinc-500 font-mono">{device.ip}</span>
                                <span className="w-1 h-1 rounded-full bg-zinc-300" />
                                <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest font-mono">
                                    {device.mac}
                                </span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleFingerprint}
                            disabled={isFingerprinting}
                            className="p-3 bg-zinc-100 dark:bg-zinc-900 rounded-2xl text-zinc-500 hover:text-indigo-600 transition-all active:scale-90 disabled:opacity-50 border border-zinc-200 dark:border-zinc-800 flex-shrink-0"
                            title="Re-run fingerprint engine"
                        >
                            <Search className={`w-5 h-5 ${isFingerprinting ? "animate-spin text-indigo-500" : ""}`} />
                        </button>
                    </div>

                    {/* Confidence */}
                    {fp && (
                        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-indigo-50/50 to-transparent dark:from-indigo-950/20">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                    Detection confidence
                                </span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                    {(fp.discovery_methods || []).length} methods
                                </span>
                            </div>
                            <ConfidenceBar value={fp.confidence || 0} />
                            {fp.discovery_methods?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-3">
                                    {fp.discovery_methods.map((m) => (
                                        <span
                                            key={m}
                                            className="px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                                        >
                                            {m}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Stat grid */}
                    <div className="grid grid-cols-3 gap-3">
                        <StatCard
                            label="Status"
                            value={isOnline ? "Online" : (device.status || "Unknown")}
                            valueClass={isOnline ? "text-emerald-500" : "text-rose-500"}
                            dot={isOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}
                        />
                        <StatCard label="Device type" value={fp?.device_type || device.deviceType || "—"} />
                        <StatCard
                            label="OS"
                            value={fp?.os || device.os || "Undetected"}
                            valueClass="text-indigo-600 dark:text-indigo-400"
                            confidence={fp?.per_attribute_confidence?.os}
                        />
                        <StatCard label="Vendor" value={fp?.vendor || device.vendor || "—"} confidence={fp?.per_attribute_confidence?.vendor} />
                        <StatCard label="Brand" value={fp?.brand || device.brand || "—"} confidence={fp?.per_attribute_confidence?.brand} />
                        <StatCard label="Hostname" value={fp?.hostname || device.hostname || "—"} />
                    </div>

                    {/* Network */}
                    <Section icon={<Wifi className="w-3.5 h-3.5" />} title="Network">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <KV k="IP" v={device.ip} mono />
                            <KV k="MAC" v={device.mac} mono />
                            {device.hostname && <KV k="Hostname" v={device.hostname} />}
                            {formatTs(device.lastSeen) && <KV k="Last seen" v={formatTs(device.lastSeen)!} />}
                            {formatTs(device.lastFingerprintedAt) && (
                                <KV k="Fingerprinted" v={formatTs(device.lastFingerprintedAt)!} />
                            )}
                        </dl>
                    </Section>

                    {/* Ports */}
                    {ports.length > 0 && (
                        <Section icon={<Server className="w-3.5 h-3.5" />} title={`Ports & services (${ports.length})`}>
                            <div className="flex flex-wrap gap-1.5">
                                {ports.map((p) => (
                                    <span
                                        key={p}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black tracking-widest rounded-lg border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300"
                                        title={PORT_SERVICE[p] || ""}
                                    >
                                        <span className="font-mono">{p}</span>
                                        {PORT_SERVICE[p] && (
                                            <span className="text-zinc-500 dark:text-zinc-400 font-bold">{PORT_SERVICE[p]}</span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Protocols */}
                    {protocolsSeen.length > 0 && (
                        <Section icon={<Signal className="w-3.5 h-3.5" />} title="Protocol activity">
                            <div className="flex flex-wrap gap-1.5">
                                {protocolsSeen.map((p) => (
                                    <span
                                        key={p}
                                        className="px-2 py-1 text-[10px] font-black tracking-widest rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase"
                                    >
                                        {p}
                                    </span>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Indicators */}
                    {fp && fp.indicators?.length > 0 && (
                        <Section
                            icon={<Activity className="w-3.5 h-3.5" />}
                            title={`Detection signals (${fp.indicators.length})`}
                            defaultOpen={false}
                        >
                            <div className="space-y-2">
                                {Object.entries(groupedIndicators).map(([source, list]) => (
                                    <div key={source} className="p-2.5 rounded-xl bg-white dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{source}</span>
                                            <span className="text-[9px] font-black text-zinc-400">{list.length} signal{list.length === 1 ? "" : "s"}</span>
                                        </div>
                                        <ul className="space-y-1">
                                            {list.map((ind, i) => (
                                                <li key={i} className="flex items-start gap-2 text-[11px]">
                                                    <span className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mt-0.5 w-20 flex-shrink-0">{ind.attribute}</span>
                                                    <span className="text-zinc-900 dark:text-white font-mono font-bold flex-1 min-w-0 truncate">{ind.value}</span>
                                                    <span className="text-[9px] font-black text-indigo-500 tabular-nums">+{ind.weight.toFixed(2)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Cache & correlation */}
                    {signalsData && (
                        <Section icon={<RefreshCw className="w-3.5 h-3.5" />} title="Cache & correlation" defaultOpen={false}>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                                <KV k="Cache mode" v={String(signalsData.cache_mode || "?")} />
                                <KV k="Healthy" v={String(signalsData.cache_healthy)} />
                                {signalsData.related_macs?.by_hostname && (
                                    <KV k="Same hostname" v={(signalsData.related_macs.by_hostname as string[]).join(", ")} mono />
                                )}
                                {signalsData.related_macs?.by_client_id && (
                                    <KV k="Same client-id" v={(signalsData.related_macs.by_client_id as string[]).join(", ")} mono />
                                )}
                            </dl>
                        </Section>
                    )}

                    {/* Raw signals */}
                    {(fp?.raw_signals || signalsData) && (
                        <Section icon={<Server className="w-3.5 h-3.5" />} title="Raw scan metadata" defaultOpen={false}>
                            <button
                                type="button"
                                onClick={() => setShowRaw((v) => !v)}
                                className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition mb-2"
                            >
                                {showRaw ? "Hide JSON" : "Show JSON"}
                            </button>
                            {showRaw && (
                                <pre className="text-[10px] font-mono leading-relaxed text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900/60 p-3 rounded-xl overflow-x-auto max-h-72">
{JSON.stringify({ fingerprint: fp, signals: signalsData }, null, 2)}
                                </pre>
                            )}
                        </Section>
                    )}

                    {/* Kick status */}
                    {isKicked && kickStatus && (
                        <div
                            className={classNames(
                                "p-3 rounded-xl text-xs font-medium border",
                                kickStatus.effective
                                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20"
                                    : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
                            )}
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
                                <div className="mt-1 text-[10px] opacity-90 italic">⚠ {kickStatus.warning}</div>
                            )}
                        </div>
                    )}

                    {actionError && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 rounded-xl text-xs font-medium">
                            {actionError}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 border-t border-zinc-100 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
                    <button
                        type="button"
                        onClick={handleToggleKick}
                        disabled={isLoading}
                        className={classNames(
                            "w-full py-3.5 rounded-2xl font-black text-sm transition-all duration-300 shadow-lg flex items-center justify-center gap-3 disabled:opacity-50",
                            isKicked
                                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                : "bg-rose-500 text-white hover:bg-rose-600",
                        )}
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
    );
}

function StatCard({ label, value, valueClass, dot, confidence }: {
    label: string;
    value: React.ReactNode;
    valueClass?: string;
    dot?: string;
    confidence?: number;
}) {
    return (
        <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 min-w-0">
            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1 truncate">{label}</p>
            <div className="flex items-center gap-1.5">
                {dot && <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
                <span className={`text-xs font-black truncate ${valueClass || "text-zinc-900 dark:text-white"}`}>{value}</span>
            </div>
            {typeof confidence === "number" && confidence > 0 && (
                <div className="mt-1.5"><ConfidenceBar value={confidence} /></div>
            )}
        </div>
    );
}

function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
    return (
        <>
            <dt className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{k}</dt>
            <dd className={`${mono ? "font-mono" : ""} font-bold text-zinc-800 dark:text-zinc-200 break-words`}>{v}</dd>
        </>
    );
}