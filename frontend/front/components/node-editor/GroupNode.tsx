"use client";

import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { Handle, NodeProps, NodeResizer, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Database, Lock, Minimize2, Play, Square, Unlock } from "lucide-react";
import { useFSM, type FSMState } from "./FSMContext";
import { runningStore } from "@/lib/runningStore";
import { historyStore } from "@/lib/historyStore";

export type GroupNodeData = Record<string, unknown> & {
  label: string;
  styleType: "solid" | "dashed-init" | "dashed-trigger" | "dashed-emergency" | "pipeline";
  requiredStates?: FSMState[];
  executingStates?: FSMState[];
  width?: number;
  height?: number;
  isCollapsed?: boolean;
  summaryWord?: string;
  summaryEmoji?: string;
  summaryGlyph?: string;
  collapsedWidth?: number;
  collapsedHeight?: number;
  revealTick?: number;
}

function GroupNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<any>>) {
  const typedData = data as GroupNodeData;
  const { isAvailable, showFSMEdges, currentState } = useFSM();
  const [isBursting, setIsBursting] = useState(false);

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
  const isSequence = !isSolid;
  const isCollapsed = isSequence && Boolean(typedData.isCollapsed);

  // Outer strategy box is never locked; inner groups lock when FSM state doesn't match
  const locked = !isSolid && !isPipeline && showFSMEdges && !isAvailable(typedData.requiredStates);
  const isExecuting = !isSolid && !isPipeline && showFSMEdges && typedData.executingStates?.includes(currentState);

  useEffect(() => {
    if (!isSequence || isCollapsed || !typedData.revealTick) return;

    setIsBursting(true);
    const timeout = window.setTimeout(() => setIsBursting(false), 520);

    return () => window.clearTimeout(timeout);
  }, [isSequence, isCollapsed, typedData.revealTick]);

  const handleExpand = (event: React.MouseEvent | React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent("toggleSequenceCollapse", { detail: { groupId: id, collapsed: false } }));
  };

  const handleCollapse = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent("toggleSequenceCollapse", { detail: { groupId: id, collapsed: true } }));
  };

  const handleToggleRun = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const activeTabId = historyStore.getActiveId();
    if (activeTabId) {
      runningStore.toggleNode(activeTabId, id, typedData.label);
    }
  };

  const handleUngroup = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent("ungroupNode", { detail: { groupId: id } }));
  };

  const collapsedShellClass = cn(
    "group-node-drag-handle relative flex h-full w-full cursor-grab flex-col items-center justify-center rounded-[28px] border-2 px-4 text-center shadow-[0_18px_34px_rgba(15,23,42,0.08)] transition-all duration-500 ease-out pointer-events-auto nopan active:cursor-grabbing dark:shadow-[0_18px_40px_rgba(0,0,0,0.34)]",
    {
      "border-indigo-300 bg-[linear-gradient(160deg,rgba(224,231,255,0.98),rgba(238,242,255,0.92))] hover:border-indigo-400 hover:shadow-[0_24px_42px_rgba(99,102,241,0.18)] dark:border-indigo-400/55 dark:bg-[linear-gradient(160deg,rgba(49,46,129,0.42),rgba(15,23,42,0.92))] dark:hover:border-indigo-300/80 dark:hover:shadow-[0_24px_48px_rgba(129,140,248,0.22)]": isDashedInit,
      "border-sky-300 bg-[linear-gradient(160deg,rgba(224,242,254,0.98),rgba(240,249,255,0.92))] hover:border-sky-400 hover:shadow-[0_24px_42px_rgba(14,165,233,0.18)] dark:border-sky-400/55 dark:bg-[linear-gradient(160deg,rgba(12,74,110,0.42),rgba(15,23,42,0.92))] dark:hover:border-sky-300/80 dark:hover:shadow-[0_24px_48px_rgba(56,189,248,0.2)]": isDashedTrigger,
      "border-rose-300 bg-[linear-gradient(160deg,rgba(255,228,230,0.98),rgba(255,241,242,0.92))] hover:border-rose-400 hover:shadow-[0_24px_42px_rgba(244,63,94,0.18)] dark:border-rose-400/55 dark:bg-[linear-gradient(160deg,rgba(136,19,55,0.38),rgba(15,23,42,0.92))] dark:hover:border-rose-300/80 dark:hover:shadow-[0_24px_48px_rgba(251,113,133,0.2)]": isDashedEmergency,
      "border-teal-300 bg-[linear-gradient(160deg,rgba(204,251,241,0.98),rgba(240,253,250,0.92))] hover:border-teal-400 hover:shadow-[0_24px_42px_rgba(20,184,166,0.16)] dark:border-teal-400/55 dark:bg-[linear-gradient(160deg,rgba(19,78,74,0.44),rgba(15,23,42,0.92))] dark:hover:border-teal-300/80 dark:hover:shadow-[0_24px_48px_rgba(45,212,191,0.18)]": isPipeline,
    },
  );

  const collapsedBadgeClass = cn(
    "inline-flex min-h-11 items-center justify-center rounded-2xl border px-4 text-[15px] font-black tracking-[0.12em] shadow-sm dark:bg-slate-950/76 dark:shadow-[0_10px_26px_rgba(0,0,0,0.26)]",
    {
      "border-indigo-200 bg-white/85 text-indigo-600 dark:border-indigo-400/35 dark:text-indigo-200": isDashedInit,
      "border-sky-200 bg-white/85 text-sky-600 dark:border-sky-400/35 dark:text-sky-200": isDashedTrigger,
      "border-rose-200 bg-white/85 text-rose-600 dark:border-rose-400/35 dark:text-rose-200": isDashedEmergency,
      "border-teal-200 bg-white/85 text-teal-700 dark:border-teal-400/35 dark:text-teal-200": isPipeline,
    },
  );

  return (
    <>
      <NodeResizer
        color="#818cf8"
        isVisible={selected && !isCollapsed && !isSolid}
        minWidth={200}
        minHeight={100}
      />

      {/* FSM target handle is kept for legacy snapshots; FSM source edges are no longer connectable. */}
      {!isSolid && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id={`${id}-fsm-target`}
            className="!w-[3px] !h-[3px] !bg-[#10b981] !border-none !rounded-full"
            style={{ top: "35%", left: -4 }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id={`${id}-fsm-source`}
            className="!w-[3px] !h-[3px] !bg-[#10b981] !border-none !rounded-full"
            isConnectable={false}
            style={{ top: "35%", right: -4 }}
          />
        </>
      )}

      {isCollapsed ? (
        <button type="button" onDoubleClick={handleExpand} className={collapsedShellClass}>
          <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.65),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.3),transparent_42%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.05),transparent_42%)]" />
          <div className="relative flex items-center gap-3">
            <span className="text-[30px] leading-none">{typedData.summaryEmoji ?? "✨"}</span>
            <span className={collapsedBadgeClass}>{typedData.summaryWord ?? "시퀀스"}</span>
          </div>
          <div className="relative mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">더블클릭하면 펼쳐집니다</div>
        </button>
      ) : (
        <>
          <div
            className={cn(
              "group-node-drag-handle w-full h-full cursor-grab rounded-2xl border-2 transition-all duration-300 p-4 pointer-events-auto relative overflow-hidden nopan active:cursor-grabbing",
              {
                "border-solid border-slate-700 bg-slate-50/50 shadow-xl dark:border-slate-600 dark:bg-slate-900/34 dark:shadow-[0_22px_64px_rgba(0,0,0,0.34)]": isSolid && !isRunning,
                // Running glow on the strategy block itself
                "border-solid border-emerald-500 bg-emerald-50/30 shadow-[0_0_0_3px_rgba(52,211,153,0.2),0_0_40px_rgba(52,211,153,0.25)] ring-2 ring-emerald-400/40 dark:bg-emerald-950/20 dark:shadow-[0_0_0_3px_rgba(52,211,153,0.16),0_0_44px_rgba(52,211,153,0.28)]": isSolid && isRunning,
                "border-dashed border-indigo-400 bg-indigo-50/30 dark:border-indigo-400/65 dark:bg-indigo-950/18": isDashedInit && !isExecuting,
                "border-dashed border-sky-400 bg-sky-50/30 dark:border-sky-400/65 dark:bg-sky-950/18": isDashedTrigger && !isExecuting,
                "border-dashed border-rose-400 bg-rose-50/30 dark:border-rose-400/65 dark:bg-rose-950/18": isDashedEmergency && !isExecuting,
                "border-dashed border-teal-400 bg-teal-50/35 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.14)] dark:border-teal-400/65 dark:bg-teal-950/16 dark:shadow-[inset_0_0_0_1px_rgba(45,212,191,0.16)]": isPipeline,
                "border-indigo-400 bg-indigo-100/40 ring-4 ring-indigo-400/50 shadow-[0_0_30px_rgba(129,140,248,0.6)] animate-pulse dark:bg-indigo-950/28 dark:shadow-[0_0_34px_rgba(129,140,248,0.42)]": isDashedInit && isExecuting,
                "border-sky-400 bg-sky-100/40 ring-4 ring-sky-400/50 shadow-[0_0_30px_rgba(56,189,248,0.6)] animate-pulse dark:bg-sky-950/28 dark:shadow-[0_0_34px_rgba(56,189,248,0.4)]": isDashedTrigger && isExecuting,
                "border-rose-400 bg-rose-100/40 ring-4 ring-rose-400/50 shadow-[0_0_30px_rgba(251,113,133,0.6)] animate-pulse dark:bg-rose-950/28 dark:shadow-[0_0_34px_rgba(251,113,133,0.38)]": isDashedEmergency && isExecuting,
                "animate-in fade-in zoom-in-95 duration-500": isBursting,
              }
            )}
          >
            {isBursting ? (
              <div className="pointer-events-none absolute inset-3 rounded-2xl border border-white/60 bg-white/20 shadow-[0_0_34px_rgba(255,255,255,0.45)] animate-pulse dark:border-white/12 dark:bg-white/5 dark:shadow-[0_0_34px_rgba(255,255,255,0.16)]" />
            ) : null}
          </div>

          {/* Label badge */}
          <div
            className={cn(
              "group-node-drag-handle absolute -top-3 left-6 z-10 flex cursor-grab items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold shadow-sm pointer-events-auto transition-all duration-300 active:cursor-grabbing",
              {
                "bg-slate-700 text-white dark:bg-slate-800 dark:text-slate-100 dark:border dark:border-slate-600": isSolid && !isRunning,
                "bg-emerald-600 text-white shadow-[0_0_12px_rgba(52,211,153,0.5)]": isSolid && isRunning,
                "bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-400/12 dark:text-indigo-200 dark:border-indigo-400/35": isDashedInit && !locked,
                "bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-400/12 dark:text-sky-200 dark:border-sky-400/35": isDashedTrigger && !locked,
                "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-400/12 dark:text-rose-200 dark:border-rose-400/35": isDashedEmergency && !locked,
                "bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-400/12 dark:text-teal-200 dark:border-teal-400/35": isPipeline && !locked,
                "bg-slate-200 text-slate-500 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700": locked,
              }
            )}
          >
            {locked && <Lock className="w-2.5 h-2.5 shrink-0" />}
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
              title={isRunning ? "전략 정지" : "전략 실행"}
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
                  <span>정지</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 fill-current" />
                  <span>실행</span>
                </>
              )}
            </button>
          )}

          {/* 접기 / 그룹해제 buttons — sequence blocks only */}
          {isSequence ? (
            <div className="absolute right-3 top-3 z-20 flex items-center gap-2 pointer-events-auto nodrag nopan">
              <button
                type="button"
                onClick={handleUngroup}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/88 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-300 dark:hover:border-rose-400/45 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                title="그룹(시퀀스) 해제"
              >
                <Unlock className="h-3.5 w-3.5" />
                해제
              </button>
              <button
                type="button"
                onClick={handleCollapse}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/88 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                title="시퀀스 압축"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                접기
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

export const GroupNode = memo(GroupNodeComponent);
