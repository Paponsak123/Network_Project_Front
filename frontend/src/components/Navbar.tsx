"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MonitorSmartphone,
  Clock,
  User,
  LogOut,
  ChevronDown,
  SendToBack,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

function getUsernameFromToken(): string {
  if (typeof window === "undefined") return "";
  let token: string | null = null;
  try {
    token = localStorage.getItem("token");
  } catch {
    return "";
  }
  if (!token) return "";

  try {
    const parts = token.split(".");
    if (parts.length < 2) return "";

    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";

    const json = atob(b64);
    const payload = JSON.parse(json);
    if (payload && typeof payload === "object") {
      return payload.username || payload.sub || "";
    }
    return "";
  } catch {
    return "";
  }
}

export function Navbar() {
  const pathname = usePathname();
  const { handleUnauthorized } = useAuth();
  const [username, setUsername] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let displayName = "";
    try {
      displayName = localStorage.getItem("displayName") || "";
    } catch {
      /* storage disabled */
    }
    setUsername(displayName || getUsernameFromToken());

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const navItems = [
    { name: "Home", href: "/", icon: Home },
    { name: "Devices", href: "/device", icon: MonitorSmartphone },
    { name: "History", href: "/history", icon: Clock },
    { name: "Docdrop", href: "/docdrop", icon: SendToBack },
  ];

  return (
    <>
      {/* ── TOP HEADER ── */}
      <nav className="fixed top-0 z-50 w-full backdrop-blur-md bg-white/70 dark:bg-black/70 border-b border-zinc-200/50 dark:border-zinc-800/50 shadow-sm transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
              <img
                src="/shrimp.png"
                alt="ScanDer logo"
                className="w-9 h-9 rounded-xl object-cover group-hover:scale-105 transition-all duration-300"
              />
              <div className="flex flex-col leading-none">
                <span className="font-black text-xl tracking-tighter text-zinc-900 dark:text-white">
                  ScanDer<span className="text-indigo-600">.</span>
                </span>
              </div>
            </Link>

            {/* ── DESKTOP NAV LINKS ── */}
            <div className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (pathname?.startsWith(item.href) && item.href !== "/");
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`
                      relative px-4 py-2 rounded-xl text-[13px] font-bold transition-all duration-300 flex items-center gap-2 group
                      ${
                        isActive
                          ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10"
                          : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
                      }
                    `}
                  >
                    <item.icon
                      className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${
                        isActive ? "stroke-[2.5px]" : "stroke-2"
                      }`}
                    />
                    <span>{item.name}</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-1/4 w-1/2 h-[2px] bg-indigo-600 rounded-t-full shadow-[0_-2px_8px_rgba(79,70,229,0.4)]" />
                    )}
                  </Link>
                );
              })}
            </div>

            {/* ── DESKTOP PROFILE DROPDOWN ── */}
            <div className="hidden md:block relative" ref={dropdownRef}>
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
                <ChevronDown
                  className={`w-3 h-3 text-zinc-400 transition-transform duration-300 ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 z-[60]">
                  <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                      Identity
                    </p>
                    <p className="text-sm font-black text-zinc-900 dark:text-white truncate">
                      {username || "User"}
                    </p>
                  </div>
                  <div className="p-2">
                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        handleUnauthorized();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs font-bold text-rose-500 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                      <LogOut className="w-4 h-4" /> Logout Session
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── MOBILE RIGHT: Profile avatar + Hamburger ── */}
            <div className="md:hidden flex items-center gap-2">
              {/* Avatar / profile indicator */}
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[11px] font-black uppercase select-none">
                {username?.charAt(0) || <User className="w-4 h-4" />}
              </div>

              {/* Hamburger toggle */}
              <button
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                aria-label="Toggle menu"
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all active:scale-95"
              >
                {isMobileMenuOpen ? (
                  <X className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                ) : (
                  <Menu className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── MOBILE DROPDOWN MENU ── */}
        <div
          ref={mobileMenuRef}
          className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
            isMobileMenuOpen ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-1">
            {/* Nav links */}
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (pathname?.startsWith(item.href) && item.href !== "/");
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all duration-200
                    ${
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-white"
                    }
                  `}
                >
                  <item.icon
                    className={`w-5 h-5 flex-shrink-0 ${
                      isActive ? "stroke-[2.5px]" : "stroke-2"
                    }`}
                  />
                  <span>{item.name}</span>
                  {isActive && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                  )}
                </Link>
              );
            })}

            {/* Divider */}
            <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />

            {/* User info + logout */}
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[11px] font-black uppercase flex-shrink-0">
                  {username?.charAt(0) || <User className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                    Signed in as
                  </p>
                  <p className="text-sm font-black text-zinc-900 dark:text-white truncate">
                    {username || "User"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleUnauthorized();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-500 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors flex-shrink-0"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}