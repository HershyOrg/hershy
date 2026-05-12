"use client";

import { memo, useCallback } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import type { NodeFrameData, TriggerType, BlockData } from "./types";
import { cn } from "@/lib/utils";
import { Maximize2, Copy, Plus, X } from "lucide-react";

const triggerColors: Record<TriggerType, string> = {
  TIME: "bg-purple-500 text-white",
  CLICK: "bg-black text-white",
  IF: "bg-green-500 text-white",
};

function NodeFrameComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<NodeFrameData>>) {
  const { setNodes } = useReactFlow();

  const handleTriggerChange = useCallback(
    (triggerType: TriggerType) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, triggerType } }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleBranchToggle = useCallback(
    (branchId: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                branches: (node.data as NodeFrameData).branches.map((b: any) =>
                  b.id === branchId ? { ...b, active: !b.active } : b
                ),
              },
            }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleAddBlock = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
            ...node,
            data: {
              ...node.data,
              blocks: [
                ...(node.data as NodeFrameData).blocks,
                {
                  id: `b-${Date.now()}`,
                  name: "BOLCK",
                  type: "output" as const,
                },
              ],
            },
          }
          : node
      )
    );
  }, [id, setNodes]);

  const handleRemoveBlock = useCallback(
    (blockId: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                blocks: (node.data as NodeFrameData).blocks.filter((b: BlockData) => b.id !== blockId),
              },
            }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleAddBranch = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
            ...node,
            data: {
              ...node.data,
              branches: [
                ...(node.data as NodeFrameData).branches,
                {
                  id: `br-${Date.now()}`,
                  name: `분기 ${(node.data as NodeFrameData).branches.length + 1}`,
                  active: false,
                },
              ],
            },
          }
          : node
      )
    );
  }, [id, setNodes]);

  const handleRemoveBranch = useCallback(
    (branchId: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                branches: (node.data as NodeFrameData).branches.filter((b: any) => b.id !== branchId),
              },
            }
            : node
        )
      );
    },
    [id, setNodes]
  );

  return (
    <div
      className={cn(
        "min-w-[200px] bg-white border-2 rounded-sm shadow-sm",
        selected ? "border-blue-400 border-dashed" : "border-black"
      )}
    >
      {/* Node Label */}
      <div className="px-2 py-1 text-xs text-muted-foreground border-b border-black/10">
        node_
      </div>

      {/* Trigger Tabs */}
      <div className="flex border-b border-black/10">
        {(["TIME", "CLICK", "IF"] as TriggerType[]).map((trigger) => (
          <button
            key={trigger}
            onClick={() => handleTriggerChange(trigger)}
            className={cn(
              "flex-1 px-2 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-black/10",
              data.triggerType === trigger
                ? triggerColors[trigger]
                : "bg-gray-50 text-gray-600 hover:bg-gray-100"
            )}
          >
            {trigger}
          </button>
        ))}
      </div>

      {/* Function Block */}
      <div className="relative px-3 py-2 border-b border-black/10">
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-func-in`}
          className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
          style={{ left: -4 }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-mono">* {data.functionName} *</span>
          <div className="flex items-center gap-1">
            <button className="p-0.5 hover:bg-gray-100 rounded">
              <Copy className="w-3 h-3 text-gray-500" />
            </button>
            <button className="p-0.5 hover:bg-gray-100 rounded">
              <Maximize2 className="w-3 h-3 text-gray-500" />
            </button>
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id={`${id}-func-out`}
          className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
          style={{ right: -4 }}
        />
      </div>

      {/* Output Blocks */}
      {data.blocks
        .filter((block) => block.type === "output")
        .map((block) => (
          <div
            key={block.id}
            className="relative group px-3 py-1.5 border-b border-black/10 last:border-b-0 flex items-center justify-between"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`${id}-block-${block.id}-in`}
              className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
              style={{ left: -4, top: "50%" }}
            />
            <span className="text-sm font-mono">* {block.name} *</span>
            <button
              onClick={() => handleRemoveBlock(block.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-opacity"
            >
              <X className="w-3 h-3 text-red-500" />
            </button>
            <Handle
              type="source"
              position={Position.Right}
              id={`${id}-block-${block.id}-out`}
              className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
              style={{ right: -4, top: "50%" }}
            />
          </div>
        ))}

      {/* Add Block Button */}
      <button
        onClick={handleAddBlock}
        className="w-full px-3 py-1 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1 border-b border-black/10"
      >
        <Plus className="w-3 h-3" />
        Block
      </button>

      {/* Branch Nodes */}
      {data.branches.length > 0 && (
        <div className="border-t border-black/20">
          {data.branches.map((branch) => (
            <div
              key={branch.id}
              className="relative group flex items-center justify-between px-3 py-1.5 border-b border-black/10 last:border-b-0"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${id}-branch-${branch.id}-in`}
                className="!w-2 !h-2 !bg-gray-400 !border-gray-600"
                style={{ left: -4 }}
              />
              <div className="flex items-center gap-2">
                <span className="text-sm">{branch.name}</span>
                <button
                  onClick={() => handleRemoveBranch(branch.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-opacity"
                >
                  <X className="w-3 h-3 text-red-500" />
                </button>
              </div>
              <button
                onClick={() => handleBranchToggle(branch.id)}
                className={cn(
                  "w-0 h-0 border-l-[12px] border-y-[7px] border-y-transparent transition-colors ml-2",
                  branch.active ? "border-l-green-500" : "border-l-gray-400"
                )}
                aria-label={`Toggle ${branch.name}`}
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-branch-${branch.id}-out`}
                className="!w-2 !h-2 !bg-green-500 !border-green-600"
                style={{ right: -4 }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add Branch Button */}
      <button
        onClick={handleAddBranch}
        className="w-full px-3 py-1 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1 rounded-b-sm"
      >
        <Plus className="w-3 h-3" />
        Branch
      </button>
    </div>
  );
}

export const NodeFrame = memo(NodeFrameComponent);
