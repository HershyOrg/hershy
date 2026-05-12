"use client";

import { memo, useState, useCallback } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { Copy, Maximize2, Minimize2, Plus, X } from "lucide-react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#1e1e1e] text-gray-400 text-sm">
      Loading editor...
    </div>
  ),
});

interface BlockItem {
  id: string;
  name: string;
  type: string;
}

export type CodeEditorData = Record<string, unknown> & {
  label: string;
  code: string;
  blocks: BlockItem[];
}

function CodeEditorNodeComponent({
  id,
  data,
  selected,
}: NodeProps<import("@xyflow/react").Node<CodeEditorData>>) {
  const { setNodes } = useReactFlow();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, code: value || "" } }
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
                  ...(node.data as CodeEditorData).blocks,
                  { id: `cb-${Date.now()}`, name: "BLOCK", type: "output" },
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
                  blocks: (node.data as CodeEditorData).blocks.filter(
                    (b: BlockItem) => b.id !== blockId
                  ),
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(data.code);
  }, [data.code]);

  return (
    <div
      className={cn(
        "bg-[#2d2225] rounded-lg overflow-hidden shadow-xl border border-[#4d4245]",
        selected ? "ring-2 ring-blue-400" : "",
        isExpanded ? "w-[600px]" : "w-[400px]"
      )}
    >
      {/* Top bar with node label and input blocks */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#3d3235] border-b border-[#4d4245]">
        <span className="text-xs text-gray-400 font-mono">node_</span>
        <div className="flex gap-1 ml-auto">
          {data.blocks?.slice(0, 2).map((block) => (
            <span
              key={block.id}
              className="px-1.5 py-0.5 text-[10px] bg-[#4d4245] text-gray-300 rounded font-mono"
            >
              BLOCK
            </span>
          ))}
        </div>
      </div>

      {/* Function header with handles */}
      <div className="relative flex items-center justify-between px-3 py-2 bg-[#3d3235]/50 border-b border-[#4d4245]">
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-func-in`}
          className="!w-2.5 !h-2.5 !bg-gray-400 !border-gray-500"
          style={{ left: -5 }}
        />
        <span className="text-sm text-gray-300 font-mono">* function() *</span>
        <Handle
          type="source"
          position={Position.Right}
          id={`${id}-func-out`}
          className="!w-2.5 !h-2.5 !bg-gray-400 !border-gray-500"
          style={{ right: -5 }}
        />
      </div>

      {/* Code editor */}
      <div
        className={cn(
          "relative",
          isExpanded ? "h-[400px]" : "h-[250px]"
        )}
      >
        {/* Editor toolbar */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-[#2d2225]/80 rounded px-1">
          <button
            onClick={handleCopyCode}
            className="p-1 hover:bg-white/10 rounded text-gray-400 transition-colors"
            title="Copy code"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-white/10 rounded text-gray-400 transition-colors"
            title={isExpanded ? "Minimize" : "Maximize"}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>

        <MonacoEditor
          height="100%"
          language="javascript"
          theme="vs-dark"
          value={data.code}
          onChange={handleCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            fontFamily: "Geist Mono, monospace",
          }}
        />
      </div>

      {/* Output blocks */}
      <div className="bg-[#3d3235]/50 border-t border-[#4d4245]">
        {data.blocks.map((block) => (
          <div
            key={block.id}
            className="relative group flex items-center justify-between px-3 py-1.5 border-b border-[#4d4245] last:border-b-0"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`${id}-block-${block.id}-in`}
              className="!w-2 !h-2 !bg-gray-400 !border-gray-500"
              style={{ left: -4 }}
            />
            <span className="text-xs text-gray-400 font-mono">
              * {block.name} *
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleRemoveBlock(block.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/20 rounded transition-opacity"
              >
                <X className="w-3 h-3 text-red-400" />
              </button>
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

        {/* Add block button */}
        <button
          onClick={handleAddBlock}
          className="w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 flex items-center justify-center gap-1 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Block
        </button>
      </div>
    </div>
  );
}

export const CodeEditorNode = memo(CodeEditorNodeComponent);
