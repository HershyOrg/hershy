"use client";

import { memo, useCallback, useState, useEffect, useRef } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import type { BlockData, ClickTriggerData } from "./types";
import { cn } from "@/lib/utils";
import { MousePointer2, Keyboard, X } from "lucide-react";

const DEFAULT_CLICK_OUTPUT_BLOCK: BlockData = {
  id: "yes-no",
  name: "yes/no",
  description: "클릭되면 yes, 아니면 no인 boolean 신호를 반환합니다.",
  type: "output",
  outputKind: "boolean-data",
};

function ClickTriggerNodeComponent({ id, data, selected }: NodeProps<import("@xyflow/react").Node<ClickTriggerData>>) {
  const { setNodes } = useReactFlow();
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef(false);
  const outputBlocks = [DEFAULT_CLICK_OUTPUT_BLOCK];

  useEffect(() => {
    const firstBlock = data.outputBlocks?.[0];
    const needsYesNoOutput =
      data.outputBlocks?.length !== 1 ||
      firstBlock?.id !== DEFAULT_CLICK_OUTPUT_BLOCK.id ||
      firstBlock?.name !== DEFAULT_CLICK_OUTPUT_BLOCK.name ||
      firstBlock?.outputKind !== DEFAULT_CLICK_OUTPUT_BLOCK.outputKind;

    if (!needsYesNoOutput) return;

    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, outputBlocks: [DEFAULT_CLICK_OUTPUT_BLOCK] } }
          : node
      )
    );
  }, [data.outputBlocks, id, setNodes]);

  // Handle keyboard shortcut recording
  useEffect(() => {
    if (!isRecording) return;

    recordingRef.current = true;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!recordingRef.current) return;
      
      e.preventDefault();
      e.stopPropagation();

      // Build shortcut string
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      
      // Add the key if it's not a modifier
      if (!["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        const keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        parts.push(keyName);
      }

      if (parts.length > 0 && !["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        const shortcut = parts.join("+");
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? { ...node, data: { ...node.data, shortcut, isRecording: false } }
              : node
          )
        );
        setIsRecording(false);
        recordingRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      recordingRef.current = false;
    };
  }, [isRecording, id, setNodes]);

  const handleStartRecording = useCallback(() => {
    setIsRecording(true);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isRecording: true } }
          : node
      )
    );
  }, [id, setNodes]);

  const handleCancelRecording = useCallback(() => {
    setIsRecording(false);
    recordingRef.current = false;
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isRecording: false } }
          : node
      )
    );
  }, [id, setNodes]);

  const handleClearShortcut = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, shortcut: null } }
          : node
      )
    );
  }, [id, setNodes]);

  return (
    <div
      className={cn(
        "min-w-[140px] bg-gray-50 border-2 rounded-md shadow-sm transition-all",
        selected ? "border-gray-600 ring-2 ring-gray-300" : "border-gray-400",
        isRecording && "ring-2 ring-yellow-400 ring-offset-2 animate-pulse"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800 rounded-t-sm">
        <MousePointer2 className="w-3.5 h-3.5 text-white" />
        <span className="text-xs font-semibold text-white">CLICK</span>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        {/* Shortcut Display */}
        <div className="mb-2">
          <div className="text-[10px] text-gray-500 mb-1">Keyboard Shortcut</div>
          {data.shortcut ? (
            <div className="flex items-center gap-1">
              <div className="flex-1 px-2 py-1.5 bg-gray-100 rounded border border-gray-200">
                <span className="text-xs font-mono font-medium text-gray-700">
                  {data.shortcut}
                </span>
              </div>
              <button
                onClick={handleClearShortcut}
                className="p-1 hover:bg-red-50 rounded transition-colors"
                title="Clear shortcut"
              >
                <X className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          ) : (
            <div className="px-2 py-1.5 bg-gray-100 rounded border border-dashed border-gray-300 text-center">
              <span className="text-xs text-gray-400">No shortcut set</span>
            </div>
          )}
        </div>

        {/* Recording Button */}
        {isRecording ? (
          <div className="space-y-1">
            <div className="px-2 py-2 bg-yellow-50 border border-yellow-300 rounded text-center">
              <div className="text-xs text-yellow-700 font-medium animate-pulse">
                Press any key...
              </div>
            </div>
            <button
              onClick={handleCancelRecording}
              className="w-full px-3 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleStartRecording}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-xs font-medium text-gray-700 transition-colors"
          >
            <Keyboard className="w-3 h-3" />
            {data.shortcut ? "Change Shortcut" : "Set Shortcut"}
          </button>
        )}
        <div className="mt-2 space-y-1">
          {outputBlocks.map((block) => (
            <div key={block.id} className="relative rounded border border-gray-200 bg-white px-2 py-1">
              <div className="text-[11px] font-semibold text-gray-800">{block.name}</div>
              <div className="truncate text-[10px] text-gray-500">
                {block.description || "수동 클릭 신호"}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={`${id}-block-${block.id}-out`}
                className="!h-2.5 !w-2.5 !border-gray-700 !bg-gray-700"
                style={{ right: -17 }}
              />
              {block.id === DEFAULT_CLICK_OUTPUT_BLOCK.id ? (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${id}-trigger-out`}
                  isConnectable={false}
                  className="!h-0 !w-0 !border-0 !bg-transparent opacity-0"
                  style={{ right: -17 }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

export const ClickTriggerNode = memo(ClickTriggerNodeComponent);
