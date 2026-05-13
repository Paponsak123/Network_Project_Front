import React from "react";
import { Laptop, Smartphone, Monitor, Cpu, Server, Globe } from "lucide-react";

interface Device {
  _id?: string;
  customName?: string;
  vendor?: string;
  ip: string;
  mac: string;
  status: string;
}

interface DeviceCardProps {
  device: Device;
}

const getDeviceIcon = (vendor: string = "") => {
  const v = vendor.toLowerCase();
  if (v.includes("apple") || v.includes("samsung") || v.includes("google") || v.includes("huawei")) return <Smartphone className="w-5 h-5" />;
  if (v.includes("intel") || v.includes("dell") || v.includes("hp") || v.includes("lenovo") || v.includes("asus")) return <Laptop className="w-5 h-5" />;
  if (v.includes("tp-link") || v.includes("cisco") || v.includes("ubiquiti") || v.includes("netgear")) return <Server className="w-5 h-5" />;
  return <Cpu className="w-5 h-5" />;
};

export default function Card({ device }: DeviceCardProps) {
  const isOnline = device.status === "online";

  return (
    <div className="group relative p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-500/30 overflow-hidden cursor-pointer">
      {/* Status Accent Line */}
      <div className={`absolute top-0 left-0 w-1 h-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Icon Container */}
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors duration-300 ${isOnline ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
            }`}>
            {getDeviceIcon(device.vendor)}
          </div>

          <div>
            <h3 className="font-black text-zinc-900 dark:text-white leading-tight">
              {device.customName || device.vendor || "Unknown Node"}
            </h3>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">
              {device.vendor || "Generic Device"}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${isOnline ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
          }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
          {isOnline ? "Live" : "Idle"}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <div className="flex items-center justify-between text-[11px] p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
          <span className="text-zinc-400 font-bold uppercase tracking-widest">IP Address</span>
          <span className="font-mono font-bold text-zinc-700 dark:text-zinc-300">{device.ip}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
          <span className="text-zinc-400 font-bold uppercase tracking-widest">MAC Identity</span>
          <span className="font-mono font-bold text-zinc-700 dark:text-zinc-300">{device.mac}</span>
        </div>
      </div>

      {/* Hover Reveal Action */}
      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <Globe className="w-4 h-4 text-indigo-500" />
      </div>
    </div>
  );
}
