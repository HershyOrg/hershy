"use client";

import { memo, useState, useCallback } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import { Layers, ChevronDown, ChevronUp, X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MergedFunctionNodeData, BlockData } from "./types";

function MergedFunctionNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<MergedFunctionNodeData>>) {
  const { setNodes } = useReactFlow();
  const [isHovered, setIsHovered] = useState(false);

  const isExpanded = data.isExpanded || false;
  const nodeCount = data.mergedNodes.length;

  const handleToggleExpand = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isExpanded: !isExpanded } }
          : node
      )
    );
  }, [id, isExpanded, setNodes]);

  const handleRemoveOutputBlock = useCallback(
    (blockId: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  outputBlocks: (node.data as MergedFunctionNodeData).outputBlocks.filter(
                    (b) => b.id !== blockId
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleBlockChange = useCallback(
    (blockType: "input" | "output", blockId: string, patch: Partial<BlockData>) => {
      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  [key]: ((node.data as MergedFunctionNodeData)[key] as BlockData[]).map(
                    (block) => (block.id === blockId ? { ...block, ...patch } : block)
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  // Collapsed View
  if (!isExpanded) {
    return (
      <div
        className={cn(
          "min-w-[180px] bg-gradient-to-br from-indigo-50 to-purple-50 border-2 rounded-lg shadow-md transition-all",
          selected ? "border-indigo-500 shadow-indigo-200" : "border-indigo-300",
          isHovered && "shadow-lg"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDoubleClick={handleToggleExpand}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-indigo-100/50 border-b border-indigo-200 rounded-t-lg">
          <div className="flex items-center gap-2 flex-1 mr-4">
            <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
            <input 
              value={data.label}
              onChange={(e) => {
                setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, label: e.target.value } } : n))
              }}
              placeholder="병합된 동작의 이름"
              className="bg-transparent border-none outline-none text-sm font-bold text-indigo-700 w-full placeholder:text-indigo-400"
            />
          </div>
          <button
            onClick={handleToggleExpand}
            className="p-1 hover:bg-indigo-200 rounded transition-colors"
          >
            <Maximize2 className="w-3 h-3 text-indigo-600" />
          </button>
        </div>

        {/* Merged function names preview */}
        <div className="px-3 py-2 border-b border-indigo-100">
          <Handle
            type="target"
            position={Position.Left}
            id={`${id}-func-in`}
            className="!w-2 !h-2 !bg-indigo-400 !border-indigo-500"
            style={{ left: -4 }}
          />
          <div className="text-xs font-medium text-indigo-500 truncate">
             {nodeCount}개의 세부 동작
          </div>
        </div>

        {/* Output blocks */}
        {data.outputBlocks.map((block) => (
          <div
            key={block.id}
            className="relative px-3 py-2 border-b border-indigo-100 last:border-b-0"
          >
            <div className="text-xs font-semibold text-indigo-700">{block.name}</div>
            <div className="mt-0.5 min-h-[14px] text-[11px] text-indigo-500">
              {block.description || ""}
            </div>
            <Handle
              type="source"
              position={Position.Right}
              id={`${id}-block-${block.id}-out`}
              className="!w-2 !h-2 !bg-green-500 !border-green-600"
              style={{ right: -4 }}
            />
          </div>
        ))}
      </div>
    );
  }

  // Expanded View - Shows all internal nodes and edges
  return (
    <div
      className={cn(
        "min-w-[400px] bg-white border-2 rounded-lg shadow-xl transition-all",
        selected ? "border-indigo-500" : "border-indigo-300"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-indigo-100 to-purple-100 border-b border-indigo-200 rounded-t-lg">
        <div className="flex items-center gap-2 flex-1 mr-4">
          <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
          <input 
            value={data.label}
            onChange={(e) => {
              setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, label: e.target.value } } : n))
            }}
            placeholder="동작을 설명해주세요"
            className="bg-transparent border-none outline-none text-sm font-bold text-indigo-700 w-full placeholder:text-indigo-400"
          />
        </div>
        <button
          onClick={handleToggleExpand}
          className="p-1 hover:bg-indigo-200 rounded transition-colors"
        >
          <Minimize2 className="w-4 h-4 text-indigo-600" />
        </button>
      </div>

      {/* Main input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-func-in`}
        className="!w-3 !h-3 !bg-indigo-500 !border-indigo-600"
        style={{ left: -6, top: 50 }}
      />

      {/* Input Blocks Section */}
      {data.inputBlocks.length > 0 && (
        <div className="px-3 py-2 bg-blue-50/50 border-b border-gray-200">
          <div className="text-xs font-medium text-blue-600 mb-1">Input Blocks</div>
          {data.inputBlocks.map((block) => (
            <div
              key={block.id}
              data-connect-target-node={id}
              data-connect-target-handle={`${id}-block-${block.id}-in`}
              className="relative py-1.5 px-2 mb-1 last:mb-0 bg-blue-100 rounded"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${id}-block-${block.id}-in`}
                className="!w-2 !h-2 !bg-blue-400 !border-blue-500"
                style={{ left: -8 }}
              />
              <input
                type="text"
                value={block.name}
                onChange={(e) => handleBlockChange("input", block.id, { name: e.target.value })}
                className="w-full bg-transparent text-xs font-semibold text-blue-700 outline-none placeholder:text-blue-300"
                placeholder="블록 이름"
              />
              <input
                type="text"
                value={block.description ?? ""}
                onChange={(e) =>
                  handleBlockChange("input", block.id, { description: e.target.value })
                }
                className="mt-0.5 w-full bg-transparent text-[11px] text-blue-500 outline-none placeholder:text-blue-300"
                placeholder="블록 설명 한 줄"
              />
            </div>
          ))}
        </div>
      )}

      {/* Internal Nodes (Pipeline View) */}
      <div className="px-3 py-3 bg-gray-50 border-b border-gray-200">
        <div className="text-xs font-medium text-gray-600 mb-2">Pipeline</div>
        <div className="relative">
          {data.mergedNodes.map((mergedNode, index) => (
            <div key={mergedNode.id} className="flex items-center mb-2 last:mb-0">
              {/* Connection line */}
              {index > 0 && (
                <div className="absolute left-[calc(50%-1px)] w-0.5 h-6 bg-indigo-300 -mt-8" />
              )}
              
              {/* Node card */}
              <div className="w-full p-2 bg-white border border-indigo-200 rounded shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-gray-400">#{index + 1}</span>
                  <span className="text-xs font-medium text-indigo-600">
                    {mergedNode.data.label || "세부 동작"}
                  </span>
                </div>
                
                {/* Output blocks of this node */}
                {mergedNode.data.outputBlocks.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {mergedNode.data.outputBlocks.map((block) => (
                      <span
                        key={block.id}
                        className="px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 rounded"
                      >
                        {block.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Arrow to next node */}
              {index < data.mergedNodes.length - 1 && (
                <div className="flex justify-center my-1">
                  <ChevronDown className="w-4 h-4 text-indigo-400" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Final Output Blocks */}
      <div className="px-3 py-2 bg-green-50/50">
        <div className="text-xs font-medium text-green-600 mb-1">Final Outputs</div>
        {data.outputBlocks.map((block) => (
          <div
            key={block.id}
            className="relative group py-1.5 px-2 mb-1 last:mb-0 bg-green-100 rounded"
          >
            <input
              type="text"
              value={block.name}
              onChange={(e) => handleBlockChange("output", block.id, { name: e.target.value })}
              className="w-full bg-transparent text-xs font-semibold text-green-800 outline-none placeholder:text-green-400"
              placeholder="블록 이름"
            />
            <input
              type="text"
              value={block.description ?? ""}
              onChange={(e) =>
                handleBlockChange("output", block.id, { description: e.target.value })
              }
              className="mt-0.5 w-full bg-transparent text-[11px] text-green-600 outline-none placeholder:text-green-400"
              placeholder="블록 설명 한 줄"
            />
            <button
              onClick={() => handleRemoveOutputBlock(block.id)}
              className="absolute right-4 top-1.5 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-opacity"
            >
              <X className="w-3 h-3 text-red-500" />
            </button>
            <Handle
              type="source"
              position={Position.Right}
              id={`${id}-block-${block.id}-out`}
              className="!w-2 !h-2 !bg-green-500 !border-green-600"
              style={{ right: -8 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const MergedFunctionNode = memo(MergedFunctionNodeComponent);
