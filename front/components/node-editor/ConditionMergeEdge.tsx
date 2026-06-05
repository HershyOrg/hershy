"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, EdgeProps, useEdges, useNodes } from "@xyflow/react";
import type { BlockData } from "./types";

type ConditionMergeEdgeData = Record<string, unknown> & {
  logicMode?: "AND" | "OR";
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getConditionInputBlockId(targetId: string, targetHandleId?: string | null) {
  if (!targetHandleId) return "";
  const match = targetHandleId.match(new RegExp(`^${escapeRegExp(targetId)}-input-(.+)-in$`));
  return match?.[1] ?? "";
}

function getConditionInputBlocks(value: unknown): BlockData[] {
  return Array.isArray(value) ? value.filter((item): item is BlockData => Boolean(item && typeof item === "object")) : [];
}

function getConditionSlotOffset(index: number, count: number) {
  const height = Math.max(72, 24 + count * 32);
  if (count <= 1) return height / 2;
  return 16 + index * ((height - 32) / Math.max(count - 1, 1));
}

function getConditionSharedMidOffset(count: number) {
  if (count <= 1) return getConditionSlotOffset(0, count);
  const firstOffset = getConditionSlotOffset(0, count);
  const lastOffset = getConditionSlotOffset(count - 1, count);
  return (firstOffset + lastOffset) / 2;
}

function buildOrthogonalInputPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  inputIndex,
  inputCount,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  inputIndex: number;
  inputCount: number;
}) {
  const count = Math.max(1, inputCount);
  const index = clamp(inputIndex, 0, count - 1);
  const direction = targetX >= sourceX ? 1 : -1;
  const slotOffset = getConditionSlotOffset(index, count);
  const mergeY = targetY - slotOffset + getConditionSharedMidOffset(count);
  const mergeX = targetX + direction;
  const availableWidth = Math.max(36, Math.abs(mergeX - sourceX));
  const pairIndex = count <= 2 ? 0 : Math.floor(index / 2);
  const laneGap = clamp(availableWidth * 0.18, 22, 34);
  const laneDistance = clamp(46 + pairIndex * laneGap, 46, Math.min(132, availableWidth - 14));
  const laneX = mergeX - direction * laneDistance;
  const commands = [`M ${sourceX} ${sourceY}`, `H ${laneX}`];

  if (Math.abs(sourceY - mergeY) > 0.5) {
    commands.push(`V ${mergeY}`);
  }
  commands.push(`H ${mergeX}`);

  return {
    path: commands.join(" "),
    labelX: (laneX + mergeX) / 2,
    labelY: mergeY,
    mergeX,
    mergeY,
  };
}

function buildOrthogonalTerminalPath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const direction = targetX >= sourceX ? 1 : -1;
  const availableWidth = Math.max(40, Math.abs(targetX - sourceX));
  const trunkX = sourceX + direction * clamp(availableWidth * 0.42, 52, 112);
  const commands = [`M ${sourceX} ${sourceY}`, `H ${trunkX}`];

  if (Math.abs(sourceY - targetY) > 0.5) {
    commands.push(`V ${targetY}`);
  }
  commands.push(`H ${targetX}`);

  return {
    path: commands.join(" "),
    labelX: (trunkX + targetX) / 2,
    labelY: targetY,
    mergeX: sourceX,
    mergeY: sourceY,
  };
}

function ConditionMergeEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  selected,
  target,
  targetHandleId,
  data,
}: EdgeProps<import("@xyflow/react").Edge<ConditionMergeEdgeData>>) {
  const nodes = useNodes();
  const edges = useEdges();
  const logicMode = data?.logicMode === "OR" ? "OR" : "AND";
  const color = logicMode === "OR" ? "#f0b90b" : "#eaecef";
  const isInputLeg = Boolean(targetHandleId?.includes("-input-"));
  const isTerminalLeg = !isInputLeg;
  const targetNode = nodes.find((node) => node.id === target);
  const inputBlocks = getConditionInputBlocks((targetNode?.data as { inputBlocks?: unknown } | undefined)?.inputBlocks);
  const siblingInputEdges = edges.filter((edge) =>
    edge.type === "conditionMerge" &&
    edge.target === target &&
    edge.targetHandle?.includes("-input-"),
  );
  const inputBlockId = getConditionInputBlockId(target, targetHandleId);
  const inputIndexFromBlocks = inputBlocks.findIndex((block) => block.id === inputBlockId);
  const inputIndexFromEdges = siblingInputEdges
    .map((edge) => edge.targetHandle ?? "")
    .sort()
    .findIndex((handleId) => handleId === targetHandleId);
  const inputCount = Math.max(inputBlocks.length, siblingInputEdges.length, 1);
  const inputIndex = inputIndexFromBlocks >= 0 ? inputIndexFromBlocks : Math.max(0, inputIndexFromEdges);
  const route = isInputLeg
    ? buildOrthogonalInputPath({ sourceX, sourceY, targetX, targetY, inputIndex, inputCount })
    : buildOrthogonalTerminalPath(sourceX, sourceY, targetX, targetY);
  const edgePath = route.path;
  const labelX = route.labelX;
  const labelY = route.labelY;
  const markerId = `condition-merge-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const strokeDasharray = logicMode === "OR" ? "7 6" : style.strokeDasharray;
  const strokeWidth = selected ? 4 : isTerminalLeg ? 3.25 : 2.75;

  return (
    <>
      {isTerminalLeg ? (
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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={String(style.stroke || color)} />
          </marker>
        </defs>
      ) : null}
      <BaseEdge
        id={`${id}-bracket-shadow`}
        path={edgePath}
        style={{
          stroke: "#0b0e11",
          strokeWidth: strokeWidth + 3,
          strokeLinecap: "butt",
          strokeLinejoin: "miter",
          opacity: 0.82,
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={isTerminalLeg ? `url(#${markerId})` : undefined}
        style={{
          ...style,
          stroke: style.stroke || color,
          strokeWidth,
          strokeDasharray,
          strokeLinecap: "butt",
          strokeLinejoin: "miter",
        }}
      />
      {isInputLeg ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute h-12 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            data-connect-target-node={target}
            data-connect-target-mode="append-input"
            title="이 논리식에 조건 간선 추가"
          />
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const ConditionMergeEdge = memo(ConditionMergeEdgeComponent);
