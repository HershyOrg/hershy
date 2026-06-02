"use client";

import { memo, useCallback, useState } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import type { BranchNodeData, BlockData } from "./types";
import { cn } from "@/lib/utils";
import { GitFork, Plus, X, Code, Eye, Minimize2 } from "lucide-react";
import Editor from "./MonacoCodeEditor";

function BranchNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<BranchNodeData>>) {
  const { setNodes } = useReactFlow();
  const typedData = data as BranchNodeData;
  const [showCode, setShowCode] = useState(typedData.showCode || false);
  const [viewMode, setViewMode] = useState<"node" | "code">((data as any).viewMode || "node");

  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, label: e.target.value } } : node
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
                  branches: (node.data as BranchNodeData).branches.map((b) =>
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

  const handleAddBranch = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                branches: [
                  ...(node.data as BranchNodeData).branches,
                  {
                    id: `br-${Date.now()}`,
                    name: `분기 ${(node.data as BranchNodeData).branches.length + 1}`,
                    active: false,
                    condition: "",
                    code: `// Branch condition\nreturn value > 0;`,
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
                  branches: (node.data as BranchNodeData).branches.filter(
                    (b) => b.id !== branchId
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleBranchNameChange = useCallback(
    (branchId: string, name: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  branches: (node.data as BranchNodeData).branches.map((b) =>
                    b.id === branchId ? { ...b, name } : b
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleConditionChange = useCallback(
    (branchId: string, condition: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  branches: (node.data as BranchNodeData).branches.map((b) =>
                    b.id === branchId ? { ...b, condition } : b
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleCodeChange = useCallback(
    (branchId: string, code: string | undefined) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  branches: (node.data as BranchNodeData).branches.map((b) =>
                    b.id === branchId ? { ...b, code: code || "" } : b
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleToggleCode = useCallback(() => {
    const newMode = viewMode === "node" ? "code" : "node";
    setViewMode(newMode);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, viewMode: newMode } }
          : node
      )
    );
  }, [id, setNodes, viewMode]);

  const handleGlobalCodeChange = useCallback(
    (code: string | undefined) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  code: code || "",
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleAddInputBlock = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                inputBlocks: [
                  ...((node.data as BranchNodeData).inputBlocks || []),
                  {
                    id: `ib-${Date.now()}`,
                    name: `param${((node.data as BranchNodeData).inputBlocks?.length || 0) + 1}`,
                    type: "input" as const,
                  },
                ],
              },
            }
          : node
      )
    );
  }, [id, setNodes]);

  const handleRemoveInputBlock = useCallback(
    (blockId: string) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  inputBlocks: ((node.data as BranchNodeData).inputBlocks || []).filter(
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

  // Code View - shows IF conditions
  if (viewMode === "code") {
    return (
      <div
        className={cn(
          "min-w-[400px] bg-[#1e1e1e] border-2 rounded-md shadow-lg overflow-hidden",
          selected ? "border-orange-500 ring-2 ring-orange-300" : "border-orange-400"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-orange-500">
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-white" />
            <span className="text-sm font-semibold text-white">{(data as any).functionName || "Branch Logic"}</span>
          </div>
          <button
            onClick={handleToggleCode}
            className="p-1 hover:bg-orange-600 rounded transition-colors"
            title="Back to Node View"
          >
            <Minimize2 className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Global Logic Editor */}
        {((data as any).code !== undefined) && (
          <div className="h-[200px] border-b border-gray-700">
             <Editor
              height="100%"
              defaultLanguage="javascript"
              value={(data as any).code || ""}
              onChange={handleGlobalCodeChange}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
            />
          </div>
        )}
        
        {/* Input Handle */}
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-branch-in`}
          className="!w-2.5 !h-2.5 !bg-orange-400 !border-orange-500 !top-[20px]"
          style={{ left: -5 }}
        />

        {/* Input Blocks */}
        {data.inputBlocks && data.inputBlocks.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-700">
            <div className="text-[10px] font-semibold text-orange-400 mb-2 uppercase tracking-wide">
              Input Blocks
            </div>
            {data.inputBlocks.map((block, idx) => (
              <div
                key={block.id}
                data-connect-target-node={id}
                data-connect-target-handle={`${id}-input-${block.id}-in`}
                className="relative group flex items-center gap-2 py-1"
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${id}-input-${block.id}-in`}
                  className="!w-2 !h-2 !bg-blue-400 !border-blue-500"
                  style={{ left: -8, top: `${72 + idx * 28}px` }}
                />
                <div className="min-w-0">
                  <span className="block text-xs font-mono text-gray-300">{block.name}</span>
                  {block.connectedFrom ? (
                    <span className="block truncate text-[10px] font-semibold text-blue-300">
                      {String(block.connectedFrom)}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => handleRemoveInputBlock(block.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/50 rounded"
                >
                  <X className="w-3 h-3 text-red-400" />
                </button>
              </div>
            ))}
            <button
              onClick={handleAddInputBlock}
              className="w-full mt-1 px-2 py-1 text-[10px] text-orange-400 hover:text-orange-300 hover:bg-orange-900/30 flex items-center justify-center gap-1 rounded border border-dashed border-orange-500/50"
            >
              <Plus className="w-3 h-3" />
              Add Block
            </button>
          </div>
        )}

        {/* Branch Code Editors */}
        <div className="max-h-[400px] overflow-y-auto">
          {data.branches.map((branch, index) => (
            <div key={branch.id} className="border-b border-gray-700 last:border-b-0">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      branch.active ? "bg-green-500" : "bg-gray-500"
                    )}
                  />
                  <span className="text-xs font-medium text-gray-300">{branch.name}</span>
                </div>
                <button
                  onClick={() => handleBranchToggle(branch.id)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] rounded",
                    branch.active
                      ? "bg-green-600 text-white"
                      : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                  )}
                >
                  {branch.active ? "TRUE" : "FALSE"}
                </button>
              </div>
              <div className="h-[100px]">
                <Editor
                  height="100%"
                  defaultLanguage="javascript"
                  value={branch.code || `// ${branch.name} condition\nreturn false;`}
                  onChange={(value) => handleCodeChange(branch.id, value)}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 11,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    folding: false,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 2,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Add Branch */}
        <button
          onClick={handleAddBranch}
          className="w-full px-3 py-2 text-xs text-orange-400 hover:text-orange-300 hover:bg-gray-800 flex items-center justify-center gap-1 border-t border-gray-700"
        >
          <Plus className="w-3 h-3" />
          Add Branch
        </button>
      </div>
    );
  }

  // Node View - compact branch display
  return (
    <div
      className={cn(
        "min-w-[160px] bg-orange-50 border-2 rounded-md shadow-sm transition-all",
        selected ? "border-orange-500 ring-2 ring-orange-200" : "border-orange-300"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-orange-400 rounded-t-sm">
        <div className="flex items-center gap-2">
          <GitFork className="w-3.5 h-3.5 text-white" />
          <span className="text-xs font-semibold text-white">BRANCH</span>
        </div>
        <button
          onClick={handleToggleCode}
          className="p-0.5 hover:bg-orange-500 rounded transition-colors"
          title="Show IF Code"
        >
          <Code className="w-3.5 h-3.5 text-white" />
        </button>
      </div>

      {/* Label Textarea */}
      <div className="px-2 py-1.5 border-b border-orange-200 text-[11px] font-medium text-orange-900 bg-orange-100/50 leading-snug">
        <textarea
          value={data.label}
          onChange={handleLabelChange}
          className="w-full bg-transparent border-none text-center resize-none focus:outline-none placeholder:text-orange-400/50"
          rows={2}
          placeholder="분기 조건 설명 입력"
        />
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-branch-in`}
        className="!w-2.5 !h-2.5 !bg-orange-400 !border-orange-500 !top-[24px]"
        style={{ left: -5 }}
      />

      {/* Input Blocks (if any) */}
      {data.inputBlocks && data.inputBlocks.length > 0 && (
        <div className="px-2 py-1 border-b border-orange-200 bg-orange-100/50">
          <div className="text-[9px] font-medium text-orange-600 mb-1">Inputs</div>
          {data.inputBlocks.map((block, idx) => (
            <div
              key={block.id}
              data-connect-target-node={id}
              data-connect-target-handle={`${id}-input-${block.id}-in`}
              className="relative group flex items-center justify-between py-0.5"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${id}-input-${block.id}-in`}
                className="!w-2 !h-2 !bg-blue-400 !border-blue-500"
                style={{ left: -8 }}
              />
              <span className="min-w-0">
                <span className="block text-[10px] font-mono text-orange-700">{block.name}</span>
                {block.connectedFrom ? (
                  <span className="block max-w-[120px] truncate text-[9px] font-semibold text-blue-600">
                    {String(block.connectedFrom)}
                  </span>
                ) : null}
              </span>
              <button
                onClick={() => handleRemoveInputBlock(block.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5"
              >
                <X className="w-2.5 h-2.5 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Branches */}
      <div className="py-1">
        {data.branches.map((branch, index) => (
          <div
            key={branch.id}
            className="relative group flex items-center justify-between px-2 py-1.5 hover:bg-orange-100/50 transition-colors"
          >
            <input
              type="text"
              value={branch.name}
              onChange={(e) => handleBranchNameChange(branch.id, e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-xs bg-transparent border-0 focus:outline-none focus:bg-white focus:border focus:border-orange-200 rounded max-w-[80px]"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleRemoveBranch(branch.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-opacity"
              >
                <X className="w-3 h-3 text-red-500" />
              </button>
              <button
                onClick={() => handleBranchToggle(branch.id)}
                className={cn(
                  "w-0 h-0 border-l-[12px] border-y-[7px] border-y-transparent transition-colors",
                  branch.active ? "border-l-green-500" : "border-l-gray-400 hover:border-l-gray-500"
                )}
                aria-label={`Toggle ${branch.name}`}
                title={branch.active ? "TRUE - click for FALSE" : "FALSE - click for TRUE"}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Add Branch Button */}
      <div className="flex border-t border-orange-200">
        <button
          onClick={handleAddBranch}
          className="flex-1 px-2 py-1.5 text-xs text-orange-500 hover:text-orange-600 hover:bg-orange-100 flex items-center justify-center gap-1 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Branch
        </button>
        <div className="w-px bg-orange-200" />
        <button
          onClick={handleAddInputBlock}
          className="flex-1 px-2 py-1.5 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Block
        </button>
      </div>
    </div>
  );
}

export const BranchNode = memo(BranchNodeComponent);
