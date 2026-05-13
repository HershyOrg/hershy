"use client";

import { memo } from "react";
import { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type BlockNodeData = Record<string, unknown> & {
  label: string;
  description?: string;
  variant?: "default" | "highlighted";
}

function BlockNodeComponent({ data, selected }: NodeProps<import("@xyflow/react").Node<BlockNodeData>>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 px-3 py-1.5 bg-white border rounded-sm shadow-sm min-w-[120px]",
        selected ? "border-blue-400" : "border-gray-300",
        data.variant === "highlighted" && "bg-purple-50 border-purple-300"
      )}
    >
      <span className="text-xs font-mono font-semibold text-gray-800">{data.label || "BLOCK"}</span>
      {data.description && <span className="text-[10px] text-gray-500">{data.description}</span>}
    </div>
  );
}

export const BlockNode = memo(BlockNodeComponent);
