"use client";

import { memo, useState, useCallback } from "react";
import {
  BaseEdge,
  EdgeProps,
  getSmoothStepPath,
  EdgeLabelRenderer,
  useReactFlow,
} from "@xyflow/react";
import { Timer, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type DelayEdgeData = Record<string, unknown> & {
  delay?: number;
  waitForResult?: boolean;
  isHighlighted?: boolean;
}

function DelayEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  selected,
  data,
}: EdgeProps<import("@xyflow/react").Edge<DelayEdgeData>>) {
  const { setEdges } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String((data?.delay || 0) / 1000));

  const delay = data?.delay || 0;
  const waitForResult = data?.waitForResult ?? true;
  const isHighlighted = data?.isHighlighted;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const handleUpdateDelay = useCallback(
    (newDelay: number) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id
            ? { ...e, data: { ...e.data, delay: newDelay } }
            : e
        )
      );
    },
    [id, setEdges]
  );

  const handleToggleWait = useCallback(() => {
    setEdges((eds) =>
      eds.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, waitForResult: !waitForResult } }
          : e
      )
    );
  }, [id, setEdges, waitForResult]);

  const handleSaveDelay = useCallback(() => {
    const seconds = parseFloat(editValue) || 0;
    handleUpdateDelay(seconds * 1000);
    setIsEditing(false);
  }, [editValue, handleUpdateDelay]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSaveDelay();
      } else if (e.key === "Escape") {
        setIsEditing(false);
        setEditValue(String(delay / 1000));
      }
    },
    [handleSaveDelay, delay]
  );

  // Color based on mode
  let edgeColor = waitForResult ? "#f59e0b" : "#06b6d4"; // amber for wait, cyan for parallel
  let strokeWidth = 3;

  if (isHighlighted) {
    strokeWidth = 4;
  } else if (selected) {
    strokeWidth = 3.5;
  }

  // Dashed line for parallel execution (not waiting)
  const strokeDasharray = waitForResult ? "none" : "8 4";
  const markerId = `delay-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor} />
        </marker>
      </defs>
      {/* Glow effect */}
      {(isHighlighted || selected) && (
        <BaseEdge
          path={edgePath}
          style={{
            stroke: edgeColor,
            strokeWidth: 8,
            strokeOpacity: 0.2,
            filter: "blur(2px)",
          }}
        />
      )}
      <BaseEdge
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          ...style,
          stroke: edgeColor,
          strokeWidth,
          strokeDasharray,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-full border shadow-sm text-xs font-medium transition-all",
              waitForResult
                ? "bg-amber-50 border-amber-200 text-amber-700"
                : "bg-cyan-50 border-cyan-200 text-cyan-700",
              selected && "ring-2 ring-blue-400"
            )}
          >
            {/* Toggle wait/parallel mode */}
            <button
              onClick={handleToggleWait}
              className={cn(
                "p-0.5 rounded hover:bg-white/50 transition-colors",
                "focus:outline-none focus:ring-1 focus:ring-offset-1",
                waitForResult ? "focus:ring-amber-400" : "focus:ring-cyan-400"
              )}
              title={waitForResult ? "Waiting for result (click for parallel)" : "Parallel execution (click to wait)"}
            >
              {waitForResult ? (
                <Timer className="w-3 h-3" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
            </button>

            {/* Delay time */}
            {isEditing ? (
              <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSaveDelay}
                onKeyDown={handleKeyDown}
                className="w-12 px-1 py-0 text-xs bg-white border rounded focus:outline-none focus:ring-1"
                step="0.1"
                min="0"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="hover:underline focus:outline-none"
                title="Click to edit delay"
              >
                {delay > 0 ? `${delay / 1000}s` : "0s"}
              </button>
            )}

            {/* Mode indicator */}
            <span className="text-[10px] opacity-70">
              {waitForResult ? "wait" : "parallel"}
            </span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const DelayEdge = memo(DelayEdgeComponent);
