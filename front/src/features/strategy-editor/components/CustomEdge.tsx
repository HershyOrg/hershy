"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  Position,
  getBezierPath,
} from "@xyflow/react";

export type CustomEdgeData = Record<string, unknown> & {
  isHighlighted?: boolean;
  label?: unknown;
  sequenceDependency?: boolean;
  sharedDataPipeline?: boolean;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function CustomEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  selected,
  sourceHandleId,
  targetHandleId,
  data,
}: EdgeProps<import("@xyflow/react").Edge<CustomEdgeData>>) {
  const effectiveSourceHandleId = String(data?.originalSourceHandle ?? sourceHandleId ?? "");
  const effectiveTargetHandleId = String(data?.originalTargetHandle ?? targetHandleId ?? "");
  const isCollapsedProxy = Boolean(data?.collapsedProxy);
  const edgeLabel = String(data?.label ?? "").toLowerCase();
  const isStreamMonitorEdge = edgeLabel === "stream-monitor" || effectiveTargetHandleId.includes("-monitor-in");
  const routeCurvature = isStreamMonitorEdge
    ? 0.2 + (hashText(`${effectiveSourceHandleId}:${effectiveTargetHandleId}:${id}`) % 3) * 0.03
    : isCollapsedProxy
      ? 0.22 + (hashText(`${effectiveSourceHandleId}:${effectiveTargetHandleId}:${id}`) % 4) * 0.025
      : 0.28 + (hashText(`${effectiveSourceHandleId}:${effectiveTargetHandleId}:${id}`) % 5) * 0.035;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: sourcePosition ?? Position.Right,
    targetX,
    targetY,
    targetPosition: targetPosition ?? Position.Left,
    curvature: routeCurvature,
  });

  const isHighlighted = data?.isHighlighted;
  const isSequenceDependency = Boolean(data?.sequenceDependency);
  const isSharedDataPipeline = Boolean(data?.sharedDataPipeline);

  // Determine edge color based on source handle type and highlight state
  const isBranchEdge = effectiveSourceHandleId.includes("branch");
  const isDataBlockEdge = Boolean(
    effectiveSourceHandleId.includes("-block-") &&
      (effectiveTargetHandleId.includes("-input-") ||
        (effectiveTargetHandleId.includes("-block-") && effectiveTargetHandleId.endsWith("-in")))
  );

  let edgeColor = "var(--advanced-edge-default)";
  let strokeWidth = 3;

  if (isHighlighted) {
    edgeColor = "#60a5fa";
    strokeWidth = 4;
  } else if (isSharedDataPipeline) {
    edgeColor = "var(--advanced-edge-shared-pipeline, #ef4444)";
    strokeWidth = 4;
  } else if (isSequenceDependency) {
    edgeColor = "#f59e0b";
    strokeWidth = 4;
  } else if (selected) {
    edgeColor = "#60a5fa";
    strokeWidth = 3.5;
  } else if (isBranchEdge) {
    edgeColor = "#22c55e";
  } else if (isCollapsedProxy) {
    edgeColor = "var(--advanced-edge-default)";
    strokeWidth = 3.25;
  } else if (isDataBlockEdge) {
    edgeColor = "var(--advanced-edge-data)";
  }

  const resolvedColor = String(style.stroke || edgeColor);
  const markerId = `custom-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

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
          <path d="M 0 0 L 10 5 L 0 10 z" fill={resolvedColor} />
        </marker>
      </defs>
      {/* Emphasis effect for highlighted edges */}
      {isHighlighted && (
        <BaseEdge
          path={edgePath}
          style={{
            stroke: "#60a5fa",
            strokeWidth: 8,
            strokeOpacity: 0.3,
            filter: "blur(2px)",
          }}
        />
      )}
      {/* Shadow/glow effect for selected edges */}
      {selected && !isHighlighted && (
        <BaseEdge
          path={edgePath}
          style={{
            stroke: "#3b82f6",
            strokeWidth: 6,
            strokeOpacity: 0.2,
          }}
        />
      )}
      <BaseEdge
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          ...style,
          stroke: resolvedColor,
          strokeWidth: style.strokeWidth || strokeWidth,
          strokeDasharray: style.strokeDasharray || (isDataBlockEdge && !isCollapsedProxy ? "8 7" : undefined),
          strokeLinecap: "round",
          strokeLinejoin: "round",
          opacity: style.opacity ?? 1,
        }}
      />
      {isSequenceDependency ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 shadow-sm dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
          >
            Next Run
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const CustomEdge = memo(CustomEdgeComponent);
