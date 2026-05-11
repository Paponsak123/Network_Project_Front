import { ReactNode } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footerText: ReactNode;
  footerLink: string;
  footerLinkText: string;
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footerText,
  footerLink,
  footerLinkText,
}: AuthLayoutProps) {
  return (
    <main className="flex-1 flex items-center justify-center p-6 bg-[#fafafa] dark:bg-[#0b0b0d] font-sans relative overflow-hidden min-h-screen">
      {/* Background Decorations (Shared with MainLayout) */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 dark:bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 dark:bg-blue-500/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-[420px] relative z-10 animate-in zoom-in duration-500">
        {/* Header (Brand Logo) */}
        <div className="flex flex-col items-center space-y-3 mb-8">
          <div className="w-14 h-14 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center shadow-lg shadow-zinc-200/20 dark:shadow-none transition-transform duration-300 hover:scale-105">
            <UsersRound className="w-9 h-9 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter mb-2">
              {title}
            </h1>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 shadow-xl shadow-zinc-200/20 dark:shadow-none transition-all duration-300">

          {children}

          {/* Footer Link */}
          <div className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-800 pt-6">
            {footerText}{" "}
            <Link
              href={footerLink}
              className="font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              {footerLinkText}
            </Link>
          </div>
        </div>

        {/* Footer Copyright */}
        <p className="text-center text-xs font-medium text-zinc-400 dark:text-zinc-600 mt-8">
          © {new Date().getFullYear()} ScanDer. All rights reserved.
        </p>
      </div>
    </main>
  );
}

