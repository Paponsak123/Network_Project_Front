"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { updateProfile } from "@/api/auth";
import { User, Edit3, LogOut, ShieldCheck, Check, X, Shield, Activity, Key } from "lucide-react";

function getUsernameFromToken(): string {
    if (typeof window === "undefined") return "";
    const token = localStorage.getItem("token");
    if (!token) return "";
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.username || payload.sub || "";
    } catch {
        return "";
    }
}

export default function ProfilePage() {
    const { handleUnauthorized } = useAuth();
    const [username, setUsername] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");

    useEffect(() => {
        const name = localStorage.getItem("displayName") || getUsernameFromToken();
        setUsername(name);
        setEditValue(name);
    }, []);

    const handleSaveName = async () => {
        if (!editValue.trim()) return;
        try {
            const token = localStorage.getItem("token");
            if (!token) return;
            const data = await updateProfile(token, editValue.trim());
            localStorage.setItem("token", data.token);
            localStorage.removeItem("displayName");
            setUsername(data.user.username);
            setEditValue(data.user.username);
        } catch (err: any) {
            alert(err.message);
        }
        setIsEditing(false);
    };

    return (
        <div className="p-6 md:p-10">
            <div className="max-w-2xl mx-auto space-y-12">
                {/* Header */}
                <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-top-4 duration-1000">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
                    <User className="w-3 h-3" />
                    Operator Profile
                  </div>
                  <h1 className="text-4xl md:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter text-center">
                    Settings<span className="text-indigo-600">.</span>
                  </h1>
                </div>

                <div className="bg-white dark:bg-zinc-900/80 backdrop-blur-md rounded-[3rem] border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xl shadow-indigo-500/5 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                    {/* Visual Accent */}
                    <div className="h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600" />

                    <div className="p-8 md:p-12">
                        {/* Profile Section */}
                        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 mb-12">
                            <div className="w-24 h-24 rounded-3xl bg-indigo-600 flex items-center justify-center text-white shadow-2xl shadow-indigo-600/30 relative">
                                <User className="w-10 h-10" />
                                <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-emerald-500 rounded-xl border-4 border-white dark:border-zinc-900 flex items-center justify-center">
                                    <ShieldCheck className="w-4 h-4 text-white" />
                                </div>
                            </div>

                            <div className="flex-1 text-center md:text-left space-y-4">
                                <div>
                                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Identity Name</p>
                                    {isEditing ? (
                                        <div className="flex items-center justify-center md:justify-start gap-3">
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                                                className="text-2xl font-black text-zinc-900 dark:text-white border-b-2 border-indigo-500 outline-none bg-transparent w-full max-w-[200px]"
                                                autoFocus
                                            />
                                            <button onClick={handleSaveName} className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors">
                                                <Check className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => setIsEditing(false)} className="p-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded-xl hover:bg-zinc-200 transition-colors">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center md:justify-start gap-3">
                                            <h1 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight">{username || "Operator"}</h1>
                                            <button
                                                onClick={() => { setEditValue(username); setIsEditing(true); }}
                                                className="p-2 text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                            >
                                                <Edit3 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-center md:justify-start gap-2">
                                    <span className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-black rounded-full border border-indigo-100 dark:border-indigo-900/50 uppercase tracking-widest">
                                        Root Access
                                    </span>
                                    <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black rounded-full border border-emerald-100 dark:border-emerald-900/50 uppercase tracking-widest">
                                        Verified
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* System Status Table */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
                            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 shadow-sm flex items-center justify-center text-indigo-500">
                                    <Key className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Security Level</p>
                                    <p className="text-sm font-black text-zinc-900 dark:text-white">Encrypted / WPA3</p>
                                </div>
                            </div>
                            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 shadow-sm flex items-center justify-center text-emerald-500">
                                    <Activity className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">System Health</p>
                                    <p className="text-sm font-black text-zinc-900 dark:text-white">Optimal Performance</p>
                                </div>
                            </div>
                        </div>

                        {/* Logout Section */}
                        <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={handleUnauthorized}
                                className="w-full flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black text-sm transition-all shadow-lg shadow-rose-500/20 active:scale-95"
                            >
                                <LogOut className="w-5 h-5" />
                                TERMINATE SESSION
                            </button>
                            <p className="text-center text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-4">
                                Session ID: {Math.random().toString(36).substring(7).toUpperCase()}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}