"use client";

import React, { useState, useEffect } from "react";
import { Radar, Check, MousePointer2, Loader2 } from "lucide-react";

interface CircularScannerProps {
  isScanning: boolean;
  onScan: () => void;
  status: "idle" | "scanning" | "done";
}

const CircularScanner: React.FC<CircularScannerProps> = ({
  isScanning,
  onScan,
  status: externalStatus,
}) => {
  const [progress, setProgress] = useState(0);
  const size = 200;
  const strokeWidth = 10;
  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  // จัดการ Progress Animation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isScanning) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 95) return prev; // ไปค้างที่ 95% จนกว่าจะเสร็จจริง
          return prev + Math.random() * 5;
        });
      }, 500);
    } else if (externalStatus === "done") {
      setProgress(100);
    } else {
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [isScanning, externalStatus]);

  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center py-10">
      <div className="relative group cursor-pointer" onClick={!isScanning ? onScan : undefined}>
        {/* Glow Effect */}
        <div 
          className={`absolute inset-0 rounded-full blur-2xl transition-all duration-1000 ${
            isScanning ? "bg-blue-500/30 scale-125 animate-pulse" : 
            externalStatus === "done" ? "bg-emerald-500/20 scale-110" : 
            "bg-indigo-500/10 group-hover:bg-indigo-500/20"
          }`} 
        />

        <svg width={size} height={size} className="transform -rotate-90 relative z-10">
          {/* Background Ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-gray-100 dark:text-zinc-800"
          />
          {/* Progress Arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            style={{ 
              strokeDashoffset: offset,
              transition: "stroke-dashoffset 0.5s ease-out, stroke 0.5s ease" 
            }}
            strokeLinecap="round"
            className={`${
              externalStatus === "done" ? "text-emerald-500" : "text-indigo-600"
            }`}
          />
        </svg>

        {/* Inner Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-center p-4">
          {isScanning ? (
            <div className="animate-in fade-in zoom-in duration-300">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-2" />
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {Math.round(progress)}%
              </span>
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Scanning</p>
            </div>
          ) : externalStatus === "done" ? (
            <div className="animate-in zoom-in duration-500 flex flex-col items-center">
              <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/40 mb-2">
                <Check className="w-10 h-10 text-white" strokeWidth={3} />
              </div>
              <span className="text-sm font-bold text-emerald-600 uppercase tracking-wider">Done</span>
            </div>
          ) : (
            <div className="flex flex-col items-center group-hover:scale-110 transition-transform duration-300">
              <Radar className="w-12 h-12 text-indigo-500 mb-2" />
              <span className="text-lg font-bold text-gray-800 dark:text-zinc-200">SCAN</span>
              <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Click to start</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CircularScanner;
