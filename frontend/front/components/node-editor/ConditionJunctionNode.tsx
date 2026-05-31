"use client";

import { memo } from "react";
import { Handle, NodeProps, Position } from "@xyflow/react";
import type { BlockData } from "./types";

function ConditionJunctionNodeComponent({ id, data }: NodeProps) {
  const inputBlocks = Array.isArray((data as { inputBlocks?: unknown }).inputBlocks)
    ? ((data as { inputBlocks: BlockData[] }).inputBlocks)
    : [
      { id: "range-1", name: "A", type: "input" as const },
      { id: "range-2", name: "B", type: "input" as const },
    ];
  const height = Math.max(72, 24 + inputBlocks.length * 32);
  const centerY = height / 2;

  return (
    <div className="relative w-px opacity-0" style={{ height }}>
      {inputBlocks.map((block, index) => {
        const y = inputBlocks.length <= 1
          ? centerY
          : 16 + index * ((height - 32) / Math.max(inputBlocks.length - 1, 1));

        return (
          <Handle
            key={block.id}
            type="target"
            position={Position.Left}
            id={`${id}-input-${block.id}-in`}
            style={{ left: 0, top: y }}
          />
        );
      })}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-input-append-in`}
        style={{ left: 0, top: height - 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-condition-out`}
        style={{ right: 0, top: centerY }}
      />
    </div>
  );
}

export const ConditionJunctionNode = memo(ConditionJunctionNodeComponent);
