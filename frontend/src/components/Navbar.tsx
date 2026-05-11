"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MonitorSmartphone, Clock, User, Wifi, LogOut, ChevronDown, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

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

export function Navbar() {
  const pathname = usePathname();
  const { handleUnauthorized } = useAuth();
  const [username, setUsername] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUsername(localStorage.getItem("displayName") || getUsernameFromToken());

    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const navItems = [
    { name: "Home", href: "/", icon: Home },
    { name: "Devices", href: "/device", icon: MonitorSmartphone },
    { name: "Block", href: "/blocker", icon: Shield },
    { name: "History", href: "/history", icon: Clock },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/70 dark:bg-black/70 border-b border-zinc-200/50 dark:border-zinc-800/50 shadow-sm transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo / Brand */}
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/20 group-hover:scale-105 transition-all duration-300">
                <Wifi className="w-5 h-5" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-xl tracking-tighter text-zinc-900 dark:text-white">
                  Scanner<span className="text-indigo-600">.</span>
                </span>
              </div>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (pathname?.startsWith(item.href) && item.href !== "/");
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`
                      relative px-4 py-2 rounded-xl text-[13px] font-bold transition-all duration-300 flex items-center gap-2 group
                      ${isActive
                        ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
                      }
                    `}
                  >
                    <item.icon
                      className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`}
                    />
                    <span>{item.name}</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-1/4 w-1/2 h-[2px] bg-indigo-600 rounded-t-full shadow-[0_-2px_8px_rgba(79,70,229,0.4)]" />
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Profile Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-95"
              >
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-black uppercase">
                  {username?.charAt(0) || <User className="w-4 h-4" />}
                </div>
                <span className="text-xs font-black text-zinc-900 dark:text-white truncate max-w-[100px]">
                  {username || "User"}
                </span>
                <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform duration-300 ${isDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Identity</p>
                    <p className="text-sm font-black text-zinc-900 dark:text-white truncate">{username}</p>
                  </div>
                  <div className="p-2">
                    <button
                      onClick={handleUnauthorized}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs font-bold text-rose-500 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                      <LogOut className="w-4 h-4" /> Logout Session
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Profile Trigger (Top Right) */}
          <div className="md:hidden flex items-center gap-3">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center border border-zinc-200 dark:border-zinc-800"
            >
              <User className="w-5 h-5 text-zinc-500" />
            </button>
            {isDropdownOpen && (
              <div className="fixed top-16 right-4 w-48 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl z-[60] animate-in fade-in slide-in-from-top-4">
                <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                  <p className="text-sm font-black text-zinc-900 dark:text-white">{username}</p>
                </div>
                <div className="p-2">
                  <button
                    onClick={handleUnauthorized}
                    className="w-full flex items-center gap-3 px-3 py-2 text-xs font-bold text-rose-500"
                  >
                    <LogOut className="w-4 h-4" /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-lg border-t border-zinc-200/50 dark:border-zinc-800/50 pb-safe">
        <div className="flex justify-around items-center h-16 px-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (pathname?.startsWith(item.href) && item.href !== "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`
                  flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors duration-300 relative
                  ${isActive ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500 dark:text-zinc-400"}
                `}
              >
                <div className={`relative p-2 rounded-2xl transition-all duration-300 ${isActive ? "bg-indigo-100 dark:bg-indigo-900/40 scale-110 shadow-lg shadow-indigo-500/10" : ""}`}>
                  <item.icon className={`w-5 h-5 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} />
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest">{item.name}</span>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-indigo-600 dark:bg-indigo-500 rounded-b-full shadow-[0_2px_8px_rgba(79,70,229,0.4)]" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
