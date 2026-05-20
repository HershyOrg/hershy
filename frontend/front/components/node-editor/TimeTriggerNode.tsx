"use client";

import { memo, useCallback, useState, useEffect } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import type { TimeTriggerData } from "./types";
import { cn } from "@/lib/utils";
import { Timer, Play, Pause } from "lucide-react";

type DurationUnit = "days" | "hours" | "minutes" | "seconds";
type DurationParts = Record<DurationUnit, string>;

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

function TimeTriggerNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<TimeTriggerData>>) {
  const { setNodes } = useReactFlow();
  const [durationParts, setDurationParts] = useState<DurationParts>(() => splitDuration(data.interval));
  const readableInterval = formatDuration(data.interval);
  const outputBlocks = data.outputBlocks?.length
    ? data.outputBlocks
    : [
        {
          id: "tick",
          name: "tick",
          description: `${readableInterval}마다 true 신호를 내보냅니다.`,
          type: "output" as const,
        },
      ];
  const runtimeCode = typeof data.runtimeCode === "string" ? data.runtimeCode : "";

  useEffect(() => {
    setDurationParts(splitDuration(data.interval));
  }, [data.interval]);

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

  return (
    <div
      className={cn(
        "min-w-[240px] bg-purple-50 border-2 rounded-md shadow-sm transition-all",
        selected ? "border-purple-400 ring-2 ring-purple-200" : "border-purple-300",
        data.isActive && "ring-2 ring-purple-400 ring-offset-2"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-purple-500 rounded-t-sm">
        <Timer className="w-3.5 h-3.5 text-white" />
        <span className="text-xs font-semibold text-white">TIME</span>
      </div>

      {/* Input Handle - for connecting from IF/CLICK triggers */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-trigger-in`}
        className="!w-2.5 !h-2.5 !bg-purple-400 !border-purple-500 !top-[24px]"
        style={{ left: -5 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-trigger-out`}
        className="!w-2.5 !h-2.5 !bg-purple-500 !border-purple-600 !top-[24px]"
        style={{ right: -5 }}
      />

      {/* Content */}
      <div className="px-3 py-2">
        {/* Interval Input */}
        <div className="mb-2 rounded-md border border-purple-200 bg-white p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-purple-600">
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
                  className="w-full rounded border border-purple-100 bg-purple-50 px-1.5 py-1 text-center text-xs font-semibold text-purple-900 outline-none focus:border-purple-300"
                />
                <span className="mt-0.5 block text-center text-[10px] font-medium text-purple-500">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Toggle Button */}
        <button
          onClick={handleToggleActive}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all",
            data.isActive
              ? "bg-purple-500 text-white hover:bg-purple-600"
              : "bg-purple-100 text-purple-600 hover:bg-purple-200"
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

        <div className="mt-2 space-y-1">
          {outputBlocks.map((block) => (
            <div
              key={block.id}
              className="relative rounded border border-purple-200 bg-white px-2 py-1"
            >
              <div className="text-[11px] font-semibold text-purple-900">{block.name}</div>
              <div className="truncate text-[10px] text-purple-500">
                {block.description || "시간 조건 충족 신호"}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${block.id}-out`}
                className="!h-2.5 !w-2.5 !border-purple-600 !bg-purple-500"
                style={{ right: -17 }}
              />
            </div>
          ))}
        </div>

        {/* Linked condition indicator */}
        {data.linkedCondition && (
          <div className="mt-2 px-2 py-1 text-[10px] text-purple-500 bg-purple-100/50 rounded">
            Activates on: {data.linkedCondition}
          </div>
        )}

        {runtimeCode ? (
          <div className="mt-2 rounded-md bg-purple-950 p-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-purple-200">
              generated_strategy.go
            </div>
            <pre className="max-h-24 overflow-auto text-[10px] leading-4 text-purple-50">
              {runtimeCode}
            </pre>
          </div>
        ) : null}
      </div>

    </div>
  );
}

export const TimeTriggerNode = memo(TimeTriggerNodeComponent);
