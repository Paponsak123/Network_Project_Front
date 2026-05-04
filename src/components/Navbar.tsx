"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MonitorSmartphone, Clock, User } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { name: "Home", href: "/", icon: Home },
    { name: "Devices", href: "/devices", icon: MonitorSmartphone },
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
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold shadow-md group-hover:shadow-lg transition-all duration-300 group-hover:scale-105">
                N
              </div>
              <span className="font-semibold text-lg bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300">
                Network
              </span>
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
                    relative px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-2 group overflow-hidden
                    ${isActive 
                      ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-500/10" 
                      : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
                    }
                  `}
                >
                  <item.icon 
                    className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} 
                  />
                  <span>{item.name}</span>
                  {isActive && (
                    <span className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-blue-600 to-indigo-500 rounded-t-full shadow-[0_-2px_8px_rgba(37,99,235,0.4)]" />
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
                <div className={`relative p-1 rounded-xl transition-all duration-300 ${isActive ? "bg-blue-100 dark:bg-blue-900/30" : ""}`}>
                  <item.icon className={`w-5 h-5 ${isActive ? "stroke-[2.5px]" : "stroke-2"}`} />
                </div>
                <span className="text-[10px] font-medium">{item.name}</span>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-blue-600 dark:bg-blue-500 rounded-b-full shadow-[0_2px_8px_rgba(37,99,235,0.4)]" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
