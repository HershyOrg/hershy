"use client";

import { memo } from "react";
import { type EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from "@xyflow/react";
import { useFSM } from "./FSMContext";

export type FSMEdgeData = Record<string, unknown> & {
  label: string;
  color: string;
}

function FSMEdgeComponent({

  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const { showFSMEdges } = useFSM();

  const edgeData = data as any;
  const isHighlighted = edgeData?.isHighlighted;
  const isDimmed = style?.opacity === 0.2;
  const defaultColor = edgeData?.color ?? "#10b981";

  let color = defaultColor;
  if (!showFSMEdges) color = "#cbd5e1";
  if (isHighlighted) color = "#3b82f6";
  
  let baseOpacity = 0.75;
  if (!showFSMEdges) baseOpacity = 0.4;
  if (isHighlighted) baseOpacity = 1;
  if (isDimmed) baseOpacity = 0.1;

  
  let strokeW = 3.2;

  if (isHighlighted) {
    color = "#3b82f6";
    baseOpacity = 1;
    strokeW = 4;
  } else if (!showFSMEdges) {
    color = "#cbd5e1";
    baseOpacity = 0.4;
    strokeW = 2.2;
  }


  const [edgePath, labelX, labelY] = getSmoothStepPath({ borderRadius: 30, offset: 60, 
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const markerId = `fsm-arrow-${id}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity={isHighlighted ? 1 : baseOpacity} />
        </marker>
      </defs>

      {/* Shadow / glow path */}
      <path
        d={edgePath}
        stroke={color}
        strokeWidth={isHighlighted ? 8 : 6}
        fill="none"
        opacity={isHighlighted ? 0.3 : 0.05}
        style={{ pointerEvents: "none" }}
      />

      {/* Main path */}
      <path
        id={id}
        d={edgePath}
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={(!showFSMEdges && !isHighlighted) ? "none" : "10 5"}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={(style?.opacity as number) ?? baseOpacity}
        markerEnd={`url(#${markerId})`}
        style={{ pointerEvents: "none" }}
      />

      {edgeData?.label && (showFSMEdges || isHighlighted) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            <div
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap shadow-sm backdrop-blur-sm"
              style={{
                background: color + "20",
                border: `1px solid ${color}50`,
                color,
              }}
            >
              {edgeData.label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FSMEdge = memo(FSMEdgeComponent);
