"use client";

import { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type EmptyNodeData = Record<string, unknown> & {
  label: string;
}

function EmptyNodeFrameComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<EmptyNodeData>>) {
  return (
    <div
      className={cn(
        "min-w-[120px] min-h-[80px] bg-white border-2 rounded-sm shadow-sm",
        selected ? "border-blue-400 border-dashed" : "border-black"
      )}
    >
      {/* Node Label */}
      <div className="px-2 py-1 text-xs text-muted-foreground border-b border-black/10">
        node
      </div>

      {/* Empty content area */}
      <div className="relative px-4 py-6">
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-in`}
          className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
          style={{ left: -4 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id={`${id}-out`}
          className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
          style={{ right: -4 }}
        />
      </div>
    </div>
  );
}

export const EmptyNodeFrame = memo(EmptyNodeFrameComponent);
