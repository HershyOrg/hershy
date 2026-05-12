"use client";

import { useEffect, useState, useRef } from "react";
import { X, SquareTerminal, Play, Filter, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MonitoringNodeData } from "./types";

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  // Passing the node data of open monitoring nodes to filter mock logs
  monitoringNodesData: Record<string, MonitoringNodeData>;
}

export function TerminalPanel({ isOpen, onClose, monitoringNodesData }: TerminalPanelProps) {
  const [logs, setLogs] = useState<{ timestamp: string; message: string; source: string; type: "info" | "value" | "warn" }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // MOCK LOG GENERATION
  // This simulates logs arriving from the backend or execution engine.
  // We check `monitoringNodesData` to see which variables are being monitored.
  useEffect(() => {
    if (!isOpen) return;

    const monitoredVars = new Set<string>();
    Object.values(monitoringNodesData).forEach((data) => {
      (data.selectedVariables || []).forEach((v) => monitoredVars.add(v));
    });

    if (monitoredVars.size === 0) return;

    const interval = setInterval(() => {
      const vars = Array.from(monitoredVars);
      const randomVar = vars[Math.floor(Math.random() * vars.length)];
      const randomValue = (Math.random() * 100).toFixed(2);
      
      const parts = randomVar.split(".");
      const nodeName = parts[0];
      const blockName = parts.slice(1).join(".");

      const isLogFormat = Object.values(monitoringNodesData).some((d) => 
        (d.selectedVariables || []).includes(randomVar) && d.format === "logs"
      );

      const newLog = {
        timestamp: new Date().toLocaleTimeString(undefined, {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
        }),
        message: isLogFormat 
          ? `Executed block [${blockName}] with success.` 
          : `Block [${blockName}] returned value: ${randomValue}`,
        source: nodeName,
        type: isLogFormat ? "info" as const : "value" as const,
      };

      setLogs((prev) => [...prev.slice(-99), newLog]);
    }, 1500);

    return () => clearInterval(interval);
  }, [isOpen, monitoringNodesData]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      className={cn(
        "fixed right-0 top-0 h-full w-[400px] bg-slate-950 border-l border-slate-800 shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2">
          <SquareTerminal className="w-5 h-5 text-emerald-500" />
          <h2 className="text-sm font-semibold text-slate-200">Monitoring Terminal</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Toolbar / Filters */}
      <div className="flex items-center gap-2 p-2 px-4 border-b border-slate-800/50 bg-slate-900/50">
        <div className="flex gap-2 text-xs">
          <button className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition">
            <Filter className="w-3 h-3" /> All sources
          </button>
          <div className="w-px h-4 bg-slate-700 self-center" />
          <button className="flex items-center gap-1.5 px-2 py-1 text-slate-400 hover:text-slate-300 transition" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live
        </div>
      </div>

      {/* Log Output Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed scroll-smooth"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
            <Activity className="w-8 h-8 opacity-20" />
            <p>Waiting for data from monitoring blocks...</p>
            <p className="text-[10px] opacity-60">(Connect nodes & select variables to see mock logs)</p>
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3 hover:bg-slate-800/50 px-1 py-0.5 rounded group">
                <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                <span className="text-emerald-300/80 shrink-0 w-16 truncate" title={log.source}>
                  {log.source}:
                </span>
                <span className={cn(
                  "flex-1 break-words",
                  log.type === "info" ? "text-slate-300" : "text-amber-200"
                )}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
