"use client";

import { Navbar } from "@/components/Navbar";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0b0b0d] font-sans relative overflow-hidden">
      {/* Background Decorations (Shared across all main pages) */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full pointer-events-none" />
      
      <Navbar />
      <main className="relative z-10 pb-24 md:pb-10">
        {children}
      </main>
    </div>
  );
}
