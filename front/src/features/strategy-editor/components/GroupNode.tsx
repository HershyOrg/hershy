"use client";

import { memo, useSyncExternalStore } from "react";
import { NodeProps, NodeResizer } from "@xyflow/react";
import { cn } from "@/shared/utils/utils";
import { Database, Play, Square } from "@/shared/components/icons";
import { runningStore } from "@/features/strategy-editor/store/runningStore";
import { historyStore } from "@/features/strategy-editor/store/historyStore";

export type GroupNodeData = Record<string, unknown> & {
  label: string;
  styleType: "solid" | "dashed-init" | "dashed-trigger" | "dashed-emergency" | "pipeline";
  width?: number;
  height?: number;
}

function GroupNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<any>>) {
  const typedData = data as GroupNodeData;

  // Subscribe to runningStore — stable reference, no infinite loop
  const runningEntries = useSyncExternalStore(
    (cb) => runningStore.subscribe(cb),
    () => runningStore.getSnapshot(),
    () => runningStore.getSnapshot()
  );

  // Is THIS specific strategy block (id) currently running?
  const isRunning = runningEntries.some((e) => e.nodeId === id);

  const isSolid = typedData.styleType === "solid";
  const isDashedInit = typedData.styleType === "dashed-init";
  const isDashedTrigger = typedData.styleType === "dashed-trigger";
  const isDashedEmergency = typedData.styleType === "dashed-emergency";
  const isPipeline = typedData.styleType === "pipeline";

  const handleToggleRun = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const activeTabId = historyStore.getActiveId();
    if (activeTabId) {
      runningStore.toggleNode(activeTabId, id, typedData.label);
    }
  };

  return (
    <>
      <NodeResizer
        color="#818cf8"
        isVisible={selected && !isSolid}
        minWidth={200}
        minHeight={100}
      />

      <div
        className={cn(
          "group-node-drag-handle w-full h-full cursor-grab rounded-2xl border-2 transition-all duration-300 p-4 pointer-events-auto relative overflow-hidden nopan active:cursor-grabbing",
          {
            "border-solid border-slate-700 bg-slate-50/50 shadow-xl dark:border-slate-600 dark:bg-slate-900/34 dark:shadow-[0_22px_64px_rgba(0,0,0,0.34)]": isSolid && !isRunning,
            // Running glow on the strategy block itself
            "border-solid border-emerald-500 bg-emerald-50/30 shadow-[0_0_0_3px_rgba(52,211,153,0.2),0_0_40px_rgba(52,211,153,0.25)] ring-2 ring-emerald-400/40 dark:bg-emerald-950/20 dark:shadow-[0_0_0_3px_rgba(52,211,153,0.16),0_0_44px_rgba(52,211,153,0.28)]": isSolid && isRunning,
            "border-dashed border-indigo-400 bg-indigo-50/30 dark:border-indigo-400/65 dark:bg-indigo-950/18": isDashedInit,
            "border-dashed border-sky-400 bg-sky-50/30 dark:border-sky-400/65 dark:bg-sky-950/18": isDashedTrigger,
            "border-dashed border-rose-400 bg-rose-50/30 dark:border-rose-400/65 dark:bg-rose-950/18": isDashedEmergency,
            "border-dashed border-teal-400 bg-teal-50/35 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.14)] dark:border-teal-400/65 dark:bg-teal-950/16 dark:shadow-[inset_0_0_0_1px_rgba(45,212,191,0.16)]": isPipeline,
          }
        )}
      />

      {/* Label badge */}
      <div
        className={cn(
          "group-node-drag-handle absolute -top-3 left-6 z-10 flex cursor-grab items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold shadow-sm pointer-events-auto transition-all duration-300 active:cursor-grabbing",
          {
            "bg-slate-700 text-white dark:bg-slate-800 dark:text-slate-100 dark:border dark:border-slate-600": isSolid && !isRunning,
            "bg-emerald-600 text-white shadow-[0_0_12px_rgba(52,211,153,0.5)]": isSolid && isRunning,
            "bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-400/12 dark:text-indigo-200 dark:border-indigo-400/35": isDashedInit,
            "bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-400/12 dark:text-sky-200 dark:border-sky-400/35": isDashedTrigger,
            "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-400/12 dark:text-rose-200 dark:border-rose-400/35": isDashedEmergency,
            "bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-400/12 dark:text-teal-200 dark:border-teal-400/35": isPipeline,
          }
        )}
      >
        {isPipeline && <Database className="w-3 h-3 shrink-0" />}
        {isSolid && isRunning && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse shrink-0" />
        )}
        {typedData.label}
      </div>

      {/* ▶ / ⏹ Run button — solid (strategy) blocks only */}
      {isSolid && (
        <button
          type="button"
          onClick={handleToggleRun}
          title={isRunning ? "Stop strategy" : "Run strategy"}
          className={cn(
            "absolute right-3 top-3 z-20 nodrag nopan pointer-events-auto",
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition-all hover:-translate-y-0.5",
            isRunning
              ? "border-emerald-400 bg-emerald-500 text-white hover:bg-red-500 hover:border-red-400 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
              : "border-white/80 bg-white/88 text-slate-600 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-300 dark:hover:border-emerald-400/45 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-200"
          )}
        >
          {isRunning ? (
            <>
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </>
          ) : (
            <>
              <Play className="h-3 w-3 fill-current" />
              <span>Run</span>
            </>
          )}
        </button>
      )}
    </>
  );
}

export const GroupNode = memo(GroupNodeComponent);
