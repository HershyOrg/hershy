"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, NodeProps, useEdges, useReactFlow } from "@xyflow/react";
import type { TimeTriggerData } from "./types";
import { cn } from "@/lib/utils";
import { Keyboard, MousePointer2, Pause, Play, Timer, X } from "lucide-react";

type DurationUnit = "days" | "hours" | "minutes" | "seconds";
type DurationParts = Record<DurationUnit, string>;
type TriggerMode = "TIME" | "CLICK";

const DEFAULT_TRIGGER_OUTPUT_BLOCK = {
  id: "yes-no",
  name: "yes/no",
  description: "조건이 충족되면 yes, 아니면 no인 boolean 신호를 반환합니다.",
  type: "output" as const,
  outputKind: "boolean-data",
};

function toWholeSeconds(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function splitDuration(totalSeconds: unknown): DurationParts {
  let remaining = toWholeSeconds(totalSeconds);
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return {
    days: String(days),
    hours: String(hours),
    minutes: String(minutes),
    seconds: String(seconds),
  };
}

function parsePart(value: string, max?: number) {
  if (!value.trim()) return 0;
  const numeric = Math.max(0, Math.floor(Number(value)));
  if (!Number.isFinite(numeric)) return 0;
  return max === undefined ? numeric : Math.min(numeric, max);
}

function durationPartsToSeconds(parts: DurationParts) {
  return (
    parsePart(parts.days) * 86400 +
    parsePart(parts.hours, 23) * 3600 +
    parsePart(parts.minutes, 59) * 60 +
    parsePart(parts.seconds, 59)
  );
}

function formatDuration(totalSeconds: unknown) {
  const parts = splitDuration(totalSeconds);
  const days = parsePart(parts.days);
  const hours = parsePart(parts.hours);
  const minutes = parsePart(parts.minutes);
  const seconds = parsePart(parts.seconds);
  const tokens = [
    days ? `${days}일` : "",
    hours ? `${hours}시간` : "",
    minutes ? `${minutes}분` : "",
    seconds || (!days && !hours && !minutes) ? `${seconds || 0}초` : "",
  ].filter(Boolean);
  return tokens.join(" ");
}

function readCounter(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function formatGaugeTime(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function TimeTriggerNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<TimeTriggerData>>) {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const isLegacyClickTrigger = data.triggerMode !== "TIME" && ("shortcut" in data || "isRecording" in data);
  const triggerMode: TriggerMode = data.triggerMode === "CLICK" || isLegacyClickTrigger ? "CLICK" : "TIME";
  const [durationParts, setDurationParts] = useState<DurationParts>(() => splitDuration(data.interval));
  const [isRecording, setIsRecording] = useState(false);
  const [gaugeElapsedMs, setGaugeElapsedMs] = useState(0);
  const [triggerCount, setTriggerCount] = useState(() => readCounter(data.triggerCount));
  const [lastTriggeredAt, setLastTriggeredAt] = useState(() => Number(data.lastTriggeredAt) || 0);
  const recordingRef = useRef(false);
  const cycleStartRef = useRef<number | null>(null);
  const readableInterval = formatDuration(data.interval);
  const outputBlocks = [DEFAULT_TRIGGER_OUTPUT_BLOCK];
  const runtimeCode = typeof data.runtimeCode === "string" ? data.runtimeCode : "";
  const isTimeMode = triggerMode === "TIME";
  const intervalSeconds = toWholeSeconds(data.interval);
  const intervalMs = intervalSeconds * 1000;
  const gaugeProgress = intervalMs > 0 ? Math.min(gaugeElapsedMs / intervalMs, 1) : 0;
  const gaugeDegrees = Math.round(gaugeProgress * 360);
  const gaugePercent = Math.floor(gaugeProgress * 100);
  const isTriggerPulse = lastTriggeredAt > 0 && Date.now() - lastTriggeredAt < 900;
  const isOutputConnected = useMemo(() => {
    const triggerHandleId = `${id}-trigger-out`;
    const outputHandleId = `${id}-block-${DEFAULT_TRIGGER_OUTPUT_BLOCK.id}-out`;
    return edges.some(
      (edge) =>
        edge.source === id &&
        (edge.sourceHandle === triggerHandleId || edge.sourceHandle === outputHandleId),
    );
  }, [edges, id]);
  const signalValue = isTimeMode && data.isActive && isTriggerPulse ? "YES" : "NO";
  const signalXPercent = Math.min(Math.max(gaugeProgress * 100, 2), 98);

  useEffect(() => {
    setDurationParts(splitDuration(data.interval));
  }, [data.interval]);

  useEffect(() => {
    setTriggerCount(readCounter(data.triggerCount));
  }, [data.triggerCount]);

  useEffect(() => {
    const nextLastTriggeredAt = Number(data.lastTriggeredAt) || 0;
    setLastTriggeredAt(nextLastTriggeredAt);
  }, [data.lastTriggeredAt]);

  useEffect(() => {
    if (!isTimeMode || !data.isActive || intervalMs <= 0) {
      cycleStartRef.current = null;
      setGaugeElapsedMs(0);
      return;
    }

    cycleStartRef.current = performance.now();
    setGaugeElapsedMs(0);

    const tick = () => {
      const now = performance.now();
      const cycleStart = cycleStartRef.current ?? now;
      const elapsed = now - cycleStart;

      if (elapsed < intervalMs) {
        setGaugeElapsedMs(elapsed);
        return;
      }

      const completedCycles = Math.max(1, Math.floor(elapsed / intervalMs));
      const remainder = elapsed % intervalMs;
      const triggeredAt = Date.now();

      cycleStartRef.current = now - remainder;
      setGaugeElapsedMs(remainder);
      setLastTriggeredAt(triggeredAt);
      setTriggerCount((previousCount) => {
        const nextCount = previousCount + completedCycles;
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? {
                ...node,
                data: {
                  ...node.data,
                  triggerCount: nextCount,
                  lastTriggeredAt: triggeredAt,
                },
              }
              : node,
          ),
        );
        return nextCount;
      });
    };

    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [data.isActive, id, intervalMs, isTimeMode, setNodes]);

  useEffect(() => {
    const firstBlock = data.outputBlocks?.[0];
    const needsYesNoOutput =
      data.outputBlocks?.length !== 1 ||
      firstBlock?.id !== DEFAULT_TRIGGER_OUTPUT_BLOCK.id ||
      firstBlock?.name !== DEFAULT_TRIGGER_OUTPUT_BLOCK.name ||
      firstBlock?.outputKind !== DEFAULT_TRIGGER_OUTPUT_BLOCK.outputKind;

    if (!needsYesNoOutput) return;

    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, outputBlocks: [DEFAULT_TRIGGER_OUTPUT_BLOCK] } }
          : node
      )
    );
  }, [data.outputBlocks, id, setNodes]);

  useEffect(() => {
    if (data.isRecording === isRecording) return;
    setIsRecording(Boolean(data.isRecording));
  }, [data.isRecording, isRecording]);

  useEffect(() => {
    if (!isRecording || triggerMode !== "CLICK") return;

    recordingRef.current = true;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!recordingRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Alt");
      if (event.shiftKey) parts.push("Shift");

      if (!["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
        const keyName = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        parts.push(keyName);
      }

      if (parts.length === 0 || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;

      const shortcut = parts.join("+");
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, shortcut, isRecording: false } }
            : node
        )
      );
      setIsRecording(false);
      recordingRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      recordingRef.current = false;
    };
  }, [id, isRecording, setNodes, triggerMode]);

  const handleTriggerModeChange = useCallback(
    (nextMode: TriggerMode) => {
      setIsRecording(false);
      recordingRef.current = false;
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                triggerMode: nextMode,
                isRecording: false,
                outputBlocks: [DEFAULT_TRIGGER_OUTPUT_BLOCK],
              },
            }
            : node
        )
      );
    },
    [id, setNodes],
  );

  const handleIntervalPartChange = useCallback(
    (unit: DurationUnit, value: string) => {
      const cleanedValue = value.replace(/[^\d]/g, "");
      const nextParts = {
        ...durationParts,
        [unit]: cleanedValue,
      };
      setDurationParts(nextParts);

      const totalSeconds = durationPartsToSeconds(nextParts);
      if (totalSeconds > 0) {
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? { ...node, data: { ...node.data, interval: totalSeconds } }
              : node
          )
        );
      }
    },
    [durationParts, id, setNodes]
  );

  const handleToggleActive = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isActive: !(node.data as TimeTriggerData).isActive } }
          : node
      )
    );
  }, [id, setNodes]);

  const handleStartRecording = useCallback(() => {
    setIsRecording(true);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, triggerMode: "CLICK", isRecording: true } }
          : node
      )
    );
  }, [id, setNodes]);

  const handleCancelRecording = useCallback(() => {
    setIsRecording(false);
    recordingRef.current = false;
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isRecording: false } }
          : node
      )
    );
  }, [id, setNodes]);

  const handleClearShortcut = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, shortcut: null } }
          : node
      )
    );
  }, [id, setNodes]);

  return (
    <div
      className={cn(
        "min-w-[250px] rounded-md border-2 shadow-sm transition-all",
        "bg-[#181a20] text-[#eaecef]",
        selected
          ? "border-[#f0b90b] ring-2 ring-[#f0b90b]/30"
          : "border-[#474d57]",
        isTimeMode && data.isActive && "ring-2 ring-[#f0b90b]/45 ring-offset-2 ring-offset-[#0b0e11]",
        !isTimeMode && isRecording && "animate-pulse ring-2 ring-[#f0b90b]/45 ring-offset-2 ring-offset-[#0b0e11]",
      )}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-2 py-1.5 rounded-t-sm",
        "bg-[#1e2329]",
      )}>
        <div className="flex items-center gap-2">
          {isTimeMode ? <Timer className="h-3.5 w-3.5 text-[#fcd535]" /> : <MousePointer2 className="h-3.5 w-3.5 text-[#fcd535]" />}
          <span className="text-xs font-semibold text-[#eaecef]">TRIGGER</span>
        </div>
        <div className="flex rounded border border-[#2b3139] bg-[#0b0e11] p-0.5">
          {(["TIME", "CLICK"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleTriggerModeChange(mode)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-black transition-colors",
                triggerMode === mode
                  ? "bg-[#f0b90b] text-[#0b0e11]"
                  : "text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Input Handle - for connecting from IF/CLICK triggers */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-trigger-in`}
        className={cn(
          "!w-2.5 !h-2.5 !top-[24px]",
          isTimeMode ? "!border-[#fcd535] !bg-[#f0b90b]" : "!border-[#5e6673] !bg-[#848e9c]",
        )}
        style={{ left: -5 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-trigger-out`}
        className={cn(
          "!w-2.5 !h-2.5 !top-[24px]",
          isTimeMode ? "!border-[#fcd535] !bg-[#f0b90b]" : "!border-[#5e6673] !bg-[#848e9c]",
        )}
        style={{ right: -5 }}
      />

      {/* Content */}
      <div className="px-3 py-2">
        {isTimeMode ? (
          <>
            <div className="mb-2 rounded-md border border-[#2b3139] bg-[#0b0e11] p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#fcd535]">
                Every {readableInterval}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  ["days", "일"],
                  ["hours", "시간"],
                  ["minutes", "분"],
                  ["seconds", "초"],
                ].map(([unit, label]) => (
                  <label key={unit} className="block">
                    <input
                      type="number"
                      min="0"
                      max={unit === "days" ? undefined : unit === "hours" ? 23 : 59}
                      step="1"
                      value={durationParts[unit as DurationUnit]}
                      onChange={(event) => handleIntervalPartChange(unit as DurationUnit, event.target.value)}
                      className="w-full rounded border border-[#2b3139] bg-[#181a20] px-1.5 py-1 text-center text-xs font-semibold text-[#eaecef] outline-none focus:border-[#f0b90b]"
                    />
                    <span className="mt-0.5 block text-center text-[10px] font-medium text-[#848e9c]">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="relative mb-2 overflow-hidden rounded-md border border-[#2b3139] bg-[#0b0e11] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#848e9c]">
                    Next YES
                  </div>
                  <div className="truncate text-xs font-black text-[#eaecef]">
                    {data.isActive ? readableInterval : "Paused"}
                  </div>
                </div>
                <div className={cn(
                  "rounded px-2 py-1 text-[10px] font-black",
                  isTriggerPulse ? "bg-[#0ecb81] text-[#0b0e11]" : "bg-[#1e2329] text-[#fcd535]",
                )}>
                  {isTriggerPulse ? "YES" : `${gaugePercent}%`}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3 pb-3">
                <div
                  className="relative h-24 w-24 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(240,185,11,0.18)]"
                  style={{
                    background: `conic-gradient(#f0b90b ${gaugeDegrees}deg, #2b3139 ${gaugeDegrees}deg 360deg)`,
                  }}
                >
                  <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full border border-[#2b3139] bg-[#181a20]">
                    <div className={cn(
                      "font-mono text-lg font-black leading-none",
                      isTriggerPulse ? "text-[#0ecb81]" : "text-[#fcd535]",
                    )}>
                      {isTriggerPulse ? "YES" : gaugePercent}
                    </div>
                    <div className="mt-1 text-[9px] font-black uppercase tracking-wide text-[#848e9c]">
                      {isTriggerPulse ? "fired" : "filled"}
                    </div>
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] font-bold text-[#848e9c]">
                      <span>elapsed</span>
                      <span>{formatGaugeTime(gaugeElapsedMs)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#2b3139]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-200",
                          isTriggerPulse ? "bg-[#0ecb81]" : "bg-[#f0b90b]",
                        )}
                        style={{ width: `${gaugePercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-1">
                      <div className="text-[9px] font-bold uppercase text-[#848e9c]">cycle</div>
                      <div className="font-mono text-xs font-black text-[#eaecef]">{triggerCount}</div>
                    </div>
                    <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-1">
                      <div className="text-[9px] font-bold uppercase text-[#848e9c]">status</div>
                      <div className={cn("font-mono text-xs font-black", data.isActive ? "text-[#0ecb81]" : "text-[#848e9c]")}>
                        {data.isActive ? "RUN" : "OFF"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-2 right-2 font-mono text-[10px] font-black text-[#b7bdc6]">
                {formatGaugeTime(gaugeElapsedMs)} / {formatGaugeTime(intervalMs)}
              </div>
            </div>

            {isOutputConnected ? (
              <div className="mb-2 overflow-hidden rounded-md border border-[#2b3139] bg-[#0b0e11]">
                <div className="flex items-center justify-between border-b border-[#2b3139] px-2 py-1">
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#848e9c]">
                    YES/NO OUTPUT
                  </div>
                  <div className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-black",
                    signalValue === "YES"
                      ? "bg-[#0ecb81] text-[#0b0e11]"
                      : "bg-[#f6465d]/15 text-[#f6465d]",
                  )}>
                    {signalValue}
                  </div>
                </div>
                <div className="relative h-16 overflow-hidden">
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-[#0ecb81]/10" />
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[#f6465d]/10" />
                  <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#848e9c]/45" />
                  <div className="absolute left-2 top-1 rounded-sm border border-[#0ecb81]/30 bg-[#0ecb81]/10 px-1 py-0.5 font-mono text-[8px] font-black text-[#0ecb81]">
                    YES
                  </div>
                  <div className="absolute bottom-1 left-2 rounded-sm border border-[#f6465d]/30 bg-[#f6465d]/10 px-1 py-0.5 font-mono text-[8px] font-black text-[#f6465d]">
                    NO
                  </div>
                  <div
                    className={cn(
                      "absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 shadow-[0_0_14px_rgba(0,0,0,0.35)] transition-all duration-200",
                      signalValue === "YES"
                        ? "top-[22%] border-[#0ecb81] bg-[#0ecb81]"
                        : "top-[68%] border-[#f6465d] bg-[#f6465d]",
                    )}
                    style={{ left: `${signalXPercent}%` }}
                  />
                  <div
                    className={cn(
                      "absolute left-0 h-0.5 transition-all duration-200",
                      signalValue === "YES" ? "top-[28%] bg-[#0ecb81]" : "top-[74%] bg-[#f6465d]",
                    )}
                    style={{ width: `${signalXPercent}%` }}
                  />
                  <div className="absolute bottom-1 right-2 font-mono text-[9px] font-black text-[#b7bdc6]">
                    connected
                  </div>
                </div>
              </div>
            ) : null}

            <button
              onClick={handleToggleActive}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all",
                data.isActive
                  ? "bg-[#f0b90b] text-[#0b0e11] hover:bg-[#fcd535]"
                  : "bg-[#2b3139] text-[#fcd535] hover:bg-[#474d57]"
              )}
            >
              {data.isActive ? (
                <>
                  <Pause className="w-3 h-3" />
                  Active
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  Inactive
                </>
              )}
            </button>
          </>
        ) : (
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[10px] text-[#848e9c]">Keyboard Shortcut</div>
              {data.shortcut ? (
                <div className="flex items-center gap-1">
                  <div className="flex-1 rounded border border-[#2b3139] bg-[#0b0e11] px-2 py-1.5">
                    <span className="font-mono text-xs font-medium text-[#eaecef]">
                      {data.shortcut}
                    </span>
                  </div>
                  <button
                    onClick={handleClearShortcut}
                    className="rounded p-1 transition-colors hover:bg-[#f6465d]/10"
                    title="Clear shortcut"
                  >
                    <X className="h-3.5 w-3.5 text-[#f6465d]" />
                  </button>
                </div>
              ) : (
                <div className="rounded border border-dashed border-[#2b3139] bg-[#0b0e11] px-2 py-1.5 text-center">
                  <span className="text-xs text-[#848e9c]">No shortcut set</span>
                </div>
              )}
            </div>

            {isRecording ? (
              <div className="space-y-1">
                <div className="rounded border border-[#f0b90b]/50 bg-[#f0b90b]/10 px-2 py-2 text-center">
                  <div className="animate-pulse text-xs font-medium text-[#fcd535]">
                    Press any key...
                  </div>
                </div>
                <button
                  onClick={handleCancelRecording}
                  className="w-full rounded px-3 py-1 text-xs text-[#848e9c] transition-colors hover:bg-[#1e2329] hover:text-[#eaecef]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleStartRecording}
                className="flex w-full items-center justify-center gap-2 rounded bg-[#2b3139] px-3 py-1.5 text-xs font-medium text-[#eaecef] transition-colors hover:bg-[#474d57]"
              >
                <Keyboard className="w-3 h-3" />
                {data.shortcut ? "Change Shortcut" : "Set Shortcut"}
              </button>
            )}
          </div>
        )}

        <div className="mt-2 space-y-1">
          {outputBlocks.map((block) => (
            <div
              key={block.id}
              className={cn(
                "relative rounded border border-[#2b3139] bg-[#0b0e11] px-2 py-1",
              )}
            >
              <div className="text-[11px] font-semibold text-[#eaecef]">{block.name}</div>
              <div className="truncate text-[10px] text-[#848e9c]">
                {block.description || "yes/no 신호"}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${block.id}-out`}
                className={cn(
                  "!h-2.5 !w-2.5",
                  isTimeMode ? "!border-[#fcd535] !bg-[#f0b90b]" : "!border-[#5e6673] !bg-[#848e9c]",
                )}
                style={{ right: -17 }}
              />
            </div>
          ))}
        </div>

        {data.linkedCondition && (
          <div className={cn(
            "mt-2 px-2 py-1 text-[10px] rounded",
            isTimeMode ? "bg-[#f0b90b]/10 text-[#fcd535]" : "bg-[#2b3139] text-[#b7bdc6]",
          )}
          >
            Activates on: {data.linkedCondition}
          </div>
        )}

        {runtimeCode ? (
          <div className="mt-2 rounded-md bg-[#0b0e11] p-2">
            <div className={cn("mb-1 text-[10px] font-bold uppercase tracking-wide", isTimeMode ? "text-[#fcd535]" : "text-[#b7bdc6]")}>
              generated_strategy.go
            </div>
            <pre className={cn("max-h-24 overflow-auto text-[10px] leading-4", isTimeMode ? "text-[#eaecef]" : "text-gray-50")}>
              {runtimeCode}
            </pre>
          </div>
        ) : null}
      </div>

    </div>
  );
}

export const TimeTriggerNode = memo(TimeTriggerNodeComponent);
