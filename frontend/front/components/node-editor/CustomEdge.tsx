"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeProps,
  Position,
  getSmoothStepPath,
} from "@xyflow/react";

export type CustomEdgeData = Record<string, unknown> & {
  isHighlighted?: boolean;
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
  style = {},
  selected,
  sourceHandleId,
  targetHandleId,
  data,
}: EdgeProps<import("@xyflow/react").Edge<CustomEdgeData>>) {
  const routeOffset = 24 + (hashText(`${sourceHandleId ?? ""}:${targetHandleId ?? ""}:${id}`) % 5) * 12;
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
    borderRadius: 14,
    offset: routeOffset,
  });

  const isHighlighted = data?.isHighlighted;

  // Determine edge color based on source handle type and highlight state
  const isBranchEdge = sourceHandleId?.includes("branch");
  const isDataBlockEdge = Boolean(
    sourceHandleId?.includes("-block-") &&
      (targetHandleId?.includes("-input-") ||
        (targetHandleId?.includes("-block-") && targetHandleId?.endsWith("-in")))
  );

  let edgeColor = "#888888";
  let strokeWidth = 3;

  if (isHighlighted) {
    edgeColor = "#3b82f6";
    strokeWidth = 4;
  } else if (selected) {
    edgeColor = "#3b82f6";
    strokeWidth = 3.5;
  } else if (isBranchEdge) {
    edgeColor = "#22c55e";
  } else if (isDataBlockEdge) {
    edgeColor = "#64748b";
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
      {/* Glow effect for highlighted edges */}
      {isHighlighted && (
        <BaseEdge
          path={edgePath}
          style={{
            stroke: "#3b82f6",
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
          strokeDasharray: isDataBlockEdge ? "8 7" : style.strokeDasharray,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          opacity: style.opacity ?? 1,
        }}
      />
    </>
  );
}

export const CustomEdge = memo(CustomEdgeComponent);
