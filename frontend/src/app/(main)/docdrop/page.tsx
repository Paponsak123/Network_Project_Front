// hooks/useTransferService.ts
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    SendToBack, FolderOpen, Layers, Clock, X,
    File, Image as ImageIcon, Video, Music, Archive,
    FileText, Code, Database, Wifi,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface Peer {
    peer_id: string;
    user_id: string;
    username: string;
    ip: string | null;
    joined_at: number;
    capabilities: string[];
}

export type TransferStatus = 'queued' | 'offering' | 'sending' | 'done' | 'error' | 'cancelled';

export interface FileTransfer {
    id: string;
    file: File;
    peerId: string;
    progress: number;
    status: TransferStatus;
    speed: number;
    error?: string;
}

interface SignalEnvelope {
    type: string;
    [key: string]: any;
}

// ─── Configuration ───────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

const CHUNK_SIZE = 64 * 1024;

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useTransferService(token: string | null) {
    const [connected, setConnected] = useState(false);
    const [myPeerId, setMyPeerId] = useState<string | null>(null);
    const [peers, setPeers] = useState<Peer[]>([]);
    const [transfers, setTransfers] = useState<FileTransfer[]>([]);
    const [incomingFile, setIncomingFile] = useState<{
        from: string;
        fromUsername: string;
        fileName: string;
        fileSize: number;
        transferId: string;
    } | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const peerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
    const transfersRef = useRef<Map<string, FileTransfer>>(new Map());
    const pendingFilesRef = useRef<Map<string, File>>(new Map());
    const incomingBuffersRef = useRef<Map<string, {
        chunks: ArrayBuffer[];
        received: number;
        fileName: string;
        fileSize: number;
    }>>(new Map());

    const updateTransfer = useCallback((id: string, patch: Partial<FileTransfer>) => {
        transfersRef.current.forEach((t, key) => {
            if (key === id) Object.assign(t, patch);
        });
        setTransfers(Array.from(transfersRef.current.values()));
    }, []);

    const addTransfer = useCallback((t: FileTransfer) => {
        transfersRef.current.set(t.id, t);
        setTransfers(Array.from(transfersRef.current.values()));
    }, []);

    const getOrCreatePeerConnection = useCallback((peerId: string): RTCPeerConnection => {
        let pc = peerConnsRef.current.get(peerId);
        if (pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') return pc;
        pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnsRef.current.set(peerId, pc);
        pc.onicecandidate = (event) => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'signal', to: peerId,
                    payload: { type: 'ice-candidate', candidate: event.candidate },
                }));
            }
        };
        pc.onconnectionstatechange = () => {
            if (pc!.connectionState === 'failed' || pc!.connectionState === 'disconnected') {
                console.warn(`[RTC] Connection to ${peerId}: ${pc!.connectionState}`);
            }
        };
        pc.ondatachannel = (event) => setupIncomingDataChannel(event.channel, peerId);
        return pc;
    }, []);

    const setupIncomingDataChannel = useCallback((dc: RTCDataChannel, peerId: string) => {
        dc.binaryType = 'arraybuffer';
        let meta: { fileName: string; fileSize: number; transferId: string } | null = null;
        dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'file-meta') {
                        meta = { fileName: msg.name, fileSize: msg.size, transferId: msg.transferId };
                        incomingBuffersRef.current.set(msg.transferId, {
                            chunks: [], received: 0, fileName: msg.name, fileSize: msg.size,
                        });
                        const senderPeer = peers.find(p => p.peer_id === peerId);
                        setIncomingFile({
                            from: peerId,
                            fromUsername: senderPeer?.username || 'Unknown',
                            fileName: msg.name, fileSize: msg.size, transferId: msg.transferId,
                        });
                    } else if (msg.type === 'file-eof' && meta) {
                        const buf = incomingBuffersRef.current.get(meta.transferId);
                        if (buf) {
                            const blob = new Blob(buf.chunks);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = buf.fileName;
                            document.body.appendChild(a); a.click();
                            document.body.removeChild(a); URL.revokeObjectURL(url);
                            incomingBuffersRef.current.delete(meta.transferId);
                            setIncomingFile(null);
                        }
                    }
                } catch { /* not JSON */ }
            } else if (event.data instanceof ArrayBuffer && meta) {
                const buf = incomingBuffersRef.current.get(meta.transferId);
                if (buf) { buf.chunks.push(event.data); buf.received += event.data.byteLength; }
            }
        };
        dc.onclose = () => console.log(`[RTC] Channel from ${peerId} closed`);
    }, [peers]);

    const sendFileOverChannel = useCallback(async (dc: RTCDataChannel, file: File, transferId: string) => {
        if (dc.readyState !== 'open') {
            await new Promise<void>((resolve, reject) => {
                dc.onopen = () => resolve();
                dc.onerror = (e) => reject(e);
                setTimeout(() => reject(new Error('Data channel open timeout')), 10000);
            });
        }
        dc.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, transferId }));
        updateTransfer(transferId, { status: 'sending' });
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        let sentBytes = 0;
        const startTime = Date.now();
        for (let i = 0; i < totalChunks; i++) {
            const chunk = await file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)).arrayBuffer();
            while (dc.bufferedAmount > 1024 * 1024) await new Promise(r => setTimeout(r, 20));
            const current = transfersRef.current.get(transferId);
            if (!current || current.status === 'cancelled') return;
            dc.send(chunk);
            sentBytes += chunk.byteLength;
            const elapsed = (Date.now() - startTime) / 1000;
            updateTransfer(transferId, {
                progress: Math.round((sentBytes / file.size) * 100),
                speed: elapsed > 0 ? sentBytes / elapsed : 0,
            });
        }
        dc.send(JSON.stringify({ type: 'file-eof', transferId }));
        updateTransfer(transferId, { progress: 100, status: 'done', speed: 0 });
    }, [updateTransfer]);

    const sendFile = useCallback(async (file: File, targetPeerId: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        addTransfer({ id: transferId, file, peerId: targetPeerId, progress: 0, status: 'offering', speed: 0 });
        pendingFilesRef.current.set(transferId, file);
        try {
            const pc = getOrCreatePeerConnection(targetPeerId);
            const dc = pc.createDataChannel(`file-${transferId}`, { ordered: true });
            dc.binaryType = 'arraybuffer';
            dataChannelsRef.current.set(transferId, dc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            wsRef.current.send(JSON.stringify({
                type: 'signal', to: targetPeerId,
                payload: { type: 'offer', sdp: pc.localDescription, transferId },
            }));
            sendFileOverChannel(dc, file, transferId).catch(err =>
                updateTransfer(transferId, { status: 'error', error: err.message }));
        } catch (err: any) {
            updateTransfer(transferId, { status: 'error', error: err.message });
        }
    }, [getOrCreatePeerConnection, sendFileOverChannel, addTransfer, updateTransfer]);

    const cancelTransfer = useCallback((transferId: string) => {
        const dc = dataChannelsRef.current.get(transferId);
        if (dc) { try { dc.close(); } catch { } dataChannelsRef.current.delete(transferId); }
        transfersRef.current.delete(transferId);
        setTransfers(Array.from(transfersRef.current.values()));
    }, []);

    const handleSignal = useCallback(async (fromPeerId: string, payload: any) => {
        const pc = getOrCreatePeerConnection(fromPeerId);
        if (payload.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            wsRef.current?.send(JSON.stringify({
                type: 'signal', to: fromPeerId,
                payload: { type: 'answer', sdp: pc.localDescription, transferId: payload.transferId },
            }));
        } else if (payload.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } else if (payload.type === 'ice-candidate') {
            try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
            catch (e) { console.warn('[RTC] ICE candidate failed:', e); }
        }
    }, [getOrCreatePeerConnection]);

    useEffect(() => {
        if (!token) return;
        const safeToken = token;
        let ws: WebSocket;
        let reconnectTimer: ReturnType<typeof setTimeout>;
        let pingTimer: ReturnType<typeof setInterval>;
        let alive = true;

        function connect() {
            ws = new WebSocket(`${WS_BASE}/api/transfer/ws?token=${encodeURIComponent(safeToken)}`);
            wsRef.current = ws;
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'hello', capabilities: ['text', 'file'] }));
                pingTimer = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
                }, 25000);
            };
            ws.onmessage = (event) => {
                let msg: SignalEnvelope;
                try { msg = JSON.parse(event.data); } catch { return; }
                switch (msg.type) {
                    case 'registered': setConnected(true); setMyPeerId(msg.peer_id); setPeers(msg.peers || []); break;
                    case 'peers': setPeers(msg.peers || []); break;
                    case 'peer-joined': setPeers(prev => [...prev.filter(p => p.peer_id !== msg.peer.peer_id), msg.peer]); break;
                    case 'peer-left':
                        setPeers(prev => prev.filter(p => p.peer_id !== msg.peer_id));
                        const pc = peerConnsRef.current.get(msg.peer_id);
                        if (pc) { try { pc.close(); } catch { } peerConnsRef.current.delete(msg.peer_id); }
                        break;
                    case 'signal': handleSignal(msg.from, msg.payload).catch(console.error); break;
                    case 'pong': break;
                    case 'error': console.warn('[WS] Server error:', msg.message); break;
                }
            };
            ws.onclose = (event) => {
                setConnected(false); setMyPeerId(null); clearInterval(pingTimer);
                if (alive && event.code !== 4401) {
                    reconnectTimer = setTimeout(() => connect(), 3000);
                }
            };
            ws.onerror = (err) => console.error('[WS] Error:', err);
        }

        connect();
        return () => {
            alive = false;
            clearTimeout(reconnectTimer); clearInterval(pingTimer);
            if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'unmounting');
            wsRef.current = null;
            peerConnsRef.current.forEach(pc => { try { pc.close(); } catch { } });
            peerConnsRef.current.clear(); dataChannelsRef.current.clear();
        };
    }, [token, handleSignal]);

    const [lanPeers, setLanPeers] = useState<any[]>([]);
    const refreshLanPeers = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE}/api/transfer/lan`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) { const data = await res.json(); setLanPeers(data.peers || []); }
        } catch (err) { console.warn('[LAN] Failed:', err); }
    }, [token]);

    const refreshPeers = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify({ type: 'list' }));
    }, []);

    return { connected, myPeerId, peers, lanPeers, transfers, incomingFile, sendFile, cancelTransfer, refreshPeers, refreshLanPeers, setIncomingFile };
}

// ─── UI Constants ────────────────────────────────────────────────────────────
const CX = 170, CY = 170, ORBIT_R = 142;

const PEER_COLORS = [
    { border: 'border-indigo-500',  bg: 'bg-indigo-500/10',  text: 'text-indigo-500',  ring: 'shadow-indigo-500/20',  hex: '#6366f1' },
    { border: 'border-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-500', ring: 'shadow-emerald-500/20', hex: '#10b981' },
    { border: 'border-amber-500',   bg: 'bg-amber-500/10',   text: 'text-amber-500',   ring: 'shadow-amber-500/20',   hex: '#f59e0b' },
    { border: 'border-pink-500',    bg: 'bg-pink-500/10',    text: 'text-pink-500',    ring: 'shadow-pink-500/20',    hex: '#ec4899' },
    { border: 'border-teal-500',    bg: 'bg-teal-500/10',    text: 'text-teal-500',    ring: 'shadow-teal-500/20',    hex: '#14b8a6' },
    { border: 'border-violet-500',  bg: 'bg-violet-500/10',  text: 'text-violet-500',  ring: 'shadow-violet-500/20',  hex: '#8b5cf6' },
    { border: 'border-rose-500',    bg: 'bg-rose-500/10',    text: 'text-rose-500',    ring: 'shadow-rose-500/20',    hex: '#ef4444' },
    { border: 'border-blue-500',    bg: 'bg-blue-500/10',    text: 'text-blue-500',    ring: 'shadow-blue-500/20',    hex: '#3b82f6' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function etaText(t: FileTransfer): string {
    if (t.status === 'done') return 'Done';
    if (t.status === 'offering') return 'Negotiating…';
    if (t.status === 'error') return 'Error';
    if (t.speed > 0) {
        const secs = Math.ceil((t.file.size * (1 - t.progress / 100)) / t.speed);
        return secs < 60 ? `${secs}s left` : `${Math.floor(secs / 60)}m ${secs % 60}s left`;
    }
    return '…';
}

function FileTypeIcon({ name }: { name: string }) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const cls = 'w-5 h-5 text-indigo-500';
    if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return <ImageIcon className={cls} />;
    if (['mp4','mov','avi','mkv','webm'].includes(ext)) return <Video className={cls} />;
    if (['mp3','wav','flac','aac','ogg'].includes(ext)) return <Music className={cls} />;
    if (['zip','rar','7z','tar','gz'].includes(ext)) return <Archive className={cls} />;
    if (['js','ts','jsx','tsx','py','html','css','json'].includes(ext)) return <Code className={cls} />;
    if (['pdf','doc','docx','txt','md','xls','xlsx'].includes(ext)) return <FileText className={cls} />;
    return <File className={cls} />;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DeviceNode({ peer, index, total, selected, onClick }: {
    peer: Peer; index: number; total: number; selected: boolean; onClick: () => void;
}) {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    const x = CX + ORBIT_R * Math.cos(angle);
    const y = CY + ORBIT_R * Math.sin(angle);
    const palette = PEER_COLORS[index % PEER_COLORS.length];
    const initials = peer.username.slice(0, 2).toUpperCase();

    return (
        <button
            style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -50%)' }}
            onClick={onClick}
            title={`${peer.username} · ${peer.ip ?? 'LAN'}`}
            className={`
                w-14 h-14 rounded-full flex flex-col items-center justify-center z-10
                border-2 transition-all duration-300 cursor-pointer select-none
                bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm
                ${selected
                    ? `${palette.border} shadow-lg ${palette.ring} scale-110`
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-indigo-400/60 hover:scale-105'}
            `}
        >
            <span className={`text-[10px] font-black ${selected ? palette.text : 'text-zinc-500 dark:text-zinc-400'}`}>
                {initials}
            </span>
            <span className={`text-[6px] font-black uppercase tracking-widest mt-0.5 ${selected ? palette.text : 'text-zinc-400'}`}>
                {peer.username.slice(0, 6)}
            </span>
            {/* online dot */}
            <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-900" />
        </button>
    );
}

function TransferRow({ transfer, onCancel }: { transfer: FileTransfer; onCancel: (id: string) => void }) {
    const isDone    = transfer.status === 'done';
    const isError   = transfer.status === 'error';
    const isActive  = transfer.status === 'sending' || transfer.status === 'offering';

    const statusLabel: Record<TransferStatus, string> = {
        queued: 'Queued', offering: 'Connecting', sending: 'Sending',
        done: 'Done', error: 'Error', cancelled: 'Cancelled',
    };
    const statusColor: Record<TransferStatus, string> = {
        queued:    'bg-zinc-100 dark:bg-zinc-800 text-zinc-500',
        offering:  'bg-zinc-100 dark:bg-zinc-800 text-zinc-400',
        sending:   'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
        done:      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        error:     'bg-rose-500/10 text-rose-600 dark:text-rose-400',
        cancelled: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400',
    };
    const barColor = isDone ? 'bg-emerald-500' : isError ? 'bg-rose-500' : 'bg-indigo-500';

    return (
        <div className="flex items-center gap-4 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 transition-all duration-300 hover:shadow-md hover:shadow-indigo-500/5">
            {/* Icon */}
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                <FileTypeIcon name={transfer.file.name} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-zinc-900 dark:text-white truncate tracking-tight">
                        {transfer.file.name}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] font-bold text-zinc-400 font-mono">
                            {formatSize(transfer.file.size)}
                        </span>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusColor[transfer.status]}`}>
                            {statusLabel[transfer.status]}
                        </span>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: `${transfer.progress}%` }}
                        />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-400 min-w-[28px] text-right">
                        {transfer.progress}%
                    </span>
                    <span className="text-[10px] font-bold text-zinc-400 flex items-center gap-1 min-w-[60px]">
                        <Clock className="w-3 h-3" /> {etaText(transfer)}
                    </span>
                </div>

                {transfer.error && (
                    <p className="text-[10px] text-rose-500 font-bold truncate">{transfer.error}</p>
                )}
            </div>

            {/* Cancel */}
            {isActive && (
                <button
                    onClick={() => onCancel(transfer.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 border border-zinc-200 dark:border-zinc-700 hover:border-rose-500/40 transition-all"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DocDrop() {
    const [token, setToken] = useState<string | null>(null);
    useEffect(() => {
        try { setToken(localStorage.getItem('token')); } catch { /* private mode */ }
    }, []);

    const { connected, peers, transfers, incomingFile, sendFile, cancelTransfer, refreshPeers, setIncomingFile } =
        useTransferService(token);

    const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [warning, setWarning] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (selectedPeer && !peers.find(p => p.peer_id === selectedPeer.peer_id))
            setSelectedPeer(null);
    }, [peers, selectedPeer]);

    const addFiles = useCallback((fileList: FileList) => {
        if (!selectedPeer) {
            setWarning(true);
            setTimeout(() => setWarning(false), 2000);
            return;
        }
        Array.from(fileList).forEach(f => sendFile(f, selectedPeer.peer_id));
    }, [selectedPeer, sendFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    }, [addFiles]);

    const visibleTransfers = transfers.filter(t => t.status !== 'cancelled');

    return (
        <div className="p-6 md:p-10 pt-24 md:pt-28">
            {/* Keyframes only — no other custom CSS */}
            <style>{`
                @keyframes orbit-spin   { to { transform: rotate(360deg);  } }
                @keyframes orbit-spin-r { to { transform: rotate(-360deg); } }
            `}</style>

            <div className="max-w-4xl mx-auto space-y-12">

                {/* ── Header — identical pattern to History / Home ── */}
                <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-top-4 duration-1000">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
                        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-indigo-500 animate-pulse' : 'bg-zinc-400'}`} />
                        Send Files
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter text-center">
                        DocDrop<span className="text-indigo-600">.</span>
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-center max-w-sm text-sm font-medium leading-relaxed">
                        Select a device on your network and drop files to send them instantly.
                    </p>
                </div>

                {/* ── Orbit section ── */}
                <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-1000 delay-200">

                    {/* Orbit wrap — fixed 340×340 coordinate space */}
                    <div style={{ position: 'relative', width: 340, height: 340 }}>

                        {/* Dashed spinning rings */}
                        <div style={{
                            position: 'absolute', inset: 0, borderRadius: '50%',
                            border: '1.5px dashed #6366f128',
                            animation: 'orbit-spin 28s linear infinite',
                        }} />
                        <div style={{
                            position: 'absolute', inset: 30, borderRadius: '50%',
                            border: '1px dashed #6366f114',
                            animation: 'orbit-spin-r 18s linear infinite',
                        }} />

                        {/* Peer nodes */}
                        {peers.map((peer, i) => (
                            <DeviceNode
                                key={peer.peer_id}
                                peer={peer} index={i} total={peers.length}
                                selected={selectedPeer?.peer_id === peer.peer_id}
                                onClick={() => setSelectedPeer(prev =>
                                    prev?.peer_id === peer.peer_id ? null : peer)}
                            />
                        ))}

                        {/* No-peers hint */}
                        {peers.length === 0 && (
                            <div style={{ position: 'absolute', inset: 0 }}
                                className="flex flex-col items-center justify-center gap-2">
                                <Wifi className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
                            </div>
                        )}

                        {/* Central drop zone */}
                        <div
                            style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 130, height: 130 }}
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={handleDrop}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                            className={`
                                rounded-full z-10 flex flex-col items-center justify-center gap-1.5 cursor-pointer
                                transition-all duration-200 select-none
                                bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm
                                ${isDragOver
                                    ? 'border-2 border-indigo-500 bg-indigo-500/5 scale-105 shadow-xl shadow-indigo-500/20'
                                    : selectedPeer
                                        ? 'border-2 border-indigo-500 shadow-lg shadow-indigo-500/10'
                                        : 'border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 hover:scale-105'}
                            `}
                        >
                            <FolderOpen className={`w-8 h-8 transition-colors ${isDragOver ? 'text-indigo-500' : 'text-indigo-600 dark:text-indigo-400'}`} />
                            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center leading-relaxed px-2">
                                Drop files<br />
                                <span className="font-normal normal-case tracking-normal text-zinc-400">or click to browse</span>
                            </p>
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={e => {
                                if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; }
                            }}
                        />
                    </div>

                    {/* Target label */}
                    <p className="text-sm font-bold text-zinc-500 dark:text-zinc-400 text-center">
                        {warning
                            ? <span className="text-rose-500 font-black">⚠ Select a device first</span>
                            : selectedPeer
                                ? <>Sending to: <span className="text-indigo-600 dark:text-indigo-400 font-black">{selectedPeer.username} · {selectedPeer.ip ?? 'LAN'}</span></>
                                : 'Select a device to send files'
                        }
                    </p>
                </div>

                {/* ── Transfer queue ── */}
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                <Layers className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">Transfer Queue</h2>
                                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                    {visibleTransfers.length} {visibleTransfers.length === 1 ? 'file' : 'files'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={refreshPeers}
                            disabled={!connected}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            <SendToBack className="w-3.5 h-3.5" /> Refresh
                        </button>
                    </div>

                    {visibleTransfers.length === 0 ? (
                        <div className="py-24 text-center space-y-6 bg-white dark:bg-zinc-900/30 rounded-[3rem] border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-zinc-100 dark:bg-zinc-900 mb-2">
                                <Database className="w-10 h-10 text-zinc-300" />
                            </div>
                            <div className="space-y-2">
                                <p className="text-zinc-900 dark:text-white font-black text-2xl tracking-tighter">No Files Queued</p>
                                <p className="text-sm text-zinc-400 max-w-xs mx-auto font-medium">
                                    Select a device from the orbit above, then drop files onto the centre zone.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {visibleTransfers.map((t, idx) => (
                                <div key={t.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <TransferRow transfer={t} onCancel={cancelTransfer} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Incoming file toast ── */}
            {incomingFile && (
                <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 w-[min(90vw,420px)] animate-in slide-in-from-bottom-4 fade-in duration-300">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-3xl shadow-2xl overflow-hidden">
                        <div className="flex items-start gap-4 p-5">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                                <FolderOpen className="w-6 h-6 text-indigo-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-0.5">Incoming File</p>
                                <p className="font-black text-zinc-900 dark:text-white text-sm truncate tracking-tight">
                                    {incomingFile.fileName}
                                </p>
                                <p className="text-xs text-zinc-400 font-bold mt-0.5">
                                    from <span className="text-zinc-600 dark:text-zinc-300">{incomingFile.fromUsername}</span>
                                    {' · '}{formatSize(incomingFile.fileSize)}
                                </p>
                            </div>
                        </div>
                        <div className="flex border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={() => setIncomingFile(null)}
                                className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            >
                                Dismiss
                            </button>
                            <div className="w-px bg-zinc-100 dark:bg-zinc-800" />
                            <button
                                onClick={() => setIncomingFile(null)}
                                className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                            >
                                Save File ↓
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
