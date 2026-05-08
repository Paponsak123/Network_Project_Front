"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { updateProfile } from "@/api/auth";

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
            // อัปเดต token ใหม่ใน localStorage
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
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8 font-sans">
            <div className="max-w-lg mx-auto">

                {/* Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

                    {/* Header bar */}
                    <div className="h-2 bg-gradient-to-r from-blue-500 to-indigo-600" />

                    <div className="p-8">
                        {/* ชื่อ + ป้าย — ซ้ายบน */}
                        <div className="mb-8">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Account</p>
                            {isEditing ? (
                                <div className="flex items-center gap-3">
                                    <input
                                        type="text"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                                        className="text-2xl font-bold text-slate-800 border-b-2 border-blue-500 outline-none bg-transparent w-48"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleSaveName}
                                        className="text-sm px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                    >
                                        บันทึก
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="text-sm px-3 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        ยกเลิก
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <h1 className="text-2xl font-bold text-slate-800">{username || "—"}</h1>
                                    <button
                                        onClick={() => { setEditValue(username); setIsEditing(true); }}
                                        className="text-slate-300 hover:text-blue-500 transition-colors"
                                        title="แก้ไขชื่อ"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                            <span className="inline-block mt-2 text-xs px-2.5 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium border border-blue-100">
                                Network Monitor User
                            </span>
                        </div>

                        {/* Info rows */}
                        <div className="space-y-3 mb-10">
                            <div className="flex items-center justify-between py-3 border-b border-slate-100">
                                <span className="text-sm text-slate-500">Username</span>
                                <span className="text-sm font-medium text-slate-800">{username || "—"}</span>
                            </div>
                            <div className="flex items-center justify-between py-3 border-b border-slate-100">
                                <span className="text-sm text-slate-500">Role</span>
                                <span className="text-sm font-medium text-slate-800">User</span>
                            </div>
                            <div className="flex items-center justify-between py-3">
                                <span className="text-sm text-slate-500">Status</span>
                                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                                    Active
                                </span>
                            </div>
                        </div>

                        {/* Logout — กลางล่าง */}
                        <div className="flex justify-center">
                            <button
                                onClick={handleUnauthorized}
                                className="flex items-center gap-2 px-8 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-sm transition-all border border-red-100 hover:border-red-200 hover:shadow-sm active:scale-95"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}