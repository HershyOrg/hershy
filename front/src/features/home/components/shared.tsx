"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/utils/utils";
import type { StrategyBlock } from "../types/homeTypes";

export function Sparkline({ tone = "up" }: { tone?: "up" | "down" }) {
  const points =
    tone === "up"
      ? "0,24 8,20 16,22 24,16 32,18 40,11 48,14 56,7 64,10 72,4"
      : "0,8 8,10 16,7 24,12 32,11 40,17 48,15 56,22 64,20 72,24";

  return (
    <svg viewBox="0 0 72 28" className="h-6 w-full">
      <polyline
        points={points}
        fill="none"
        stroke={tone === "up" ? "#22c55e" : "#ef4444"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconButton({
  children,
  title,
  onClick,
  active,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50",
        active && "border-violet-200 bg-violet-50 text-violet-700",
      )}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: StrategyBlock["status"] }) {
  const label = {
    ready: "Ready",
    watching: "Watching",
    running: "Running",
    complete: "Complete",
    blocked: "Blocked",
  }[status];

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold",
        status === "running" && "bg-emerald-100 text-emerald-700",
        status === "watching" && "bg-blue-100 text-blue-700",
        status === "complete" && "bg-violet-100 text-violet-700",
        status === "blocked" && "bg-rose-100 text-rose-700",
        status === "ready" && "bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </span>
  );
}
