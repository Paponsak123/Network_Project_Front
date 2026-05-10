"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MonitorSmartphone, Clock, User, Wifi } from "lucide-react";
import { fetchSSID } from "@/api/wifi";

export function Navbar() {
  const pathname = usePathname();
  const [ssid, setSsid] = useState<string>("Network");

  const loadSSID = () => {
    fetchSSID().then((name) => {
      if (name) setSsid(name);
    });
  };

  useEffect(() => {
    loadSSID();
    // อัปเดตชื่อ Wi-Fi เมื่อกดสแกนเสร็จ
    window.addEventListener("wifi-ssid-refresh", loadSSID);
    return () => window.removeEventListener("wifi-ssid-refresh", loadSSID);
  }, []);

  const navItems = [
    { name: "Home", href: "/", icon: Home },
    { name: "Devices", href: "/device", icon: MonitorSmartphone },
    { name: "History", href: "/history", icon: Clock },
    { name: "Profile", href: "/profile", icon: User },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/70 dark:bg-black/70 border-b border-gray-200/50 dark:border-gray-800/50 shadow-sm transition-all duration-300">
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
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{ssid}</span>
              </div>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
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

          {/* Mobile Navigation Button (Optional/Placeholder for future) */}
          <div className="md:hidden flex items-center">
            {/* We'll implement mobile menu as a bottom bar for better UX on phones */}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-lg border-t border-gray-200/50 dark:border-gray-800/50 pb-safe">
        <div className="flex justify-around items-center h-16 px-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (pathname?.startsWith(item.href) && item.href !== "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`
                  flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors duration-300 relative
                  ${isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"}
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
