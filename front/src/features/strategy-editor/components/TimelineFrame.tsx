"use client";

import { memo, useCallback, useState, useRef, useEffect } from "react";
import { Handle, Position, NodeProps, useReactFlow, useNodes } from "@xyflow/react";
import type { TimelineFrameData, ActionNodeData, TimelineReference, TimelineReferenceType, TimelineItem } from "../types/editorTypes";
import { cn } from "@/shared/utils/utils";
import {
  Clock,
  Plus,
  X,
  Maximize2,
  Minimize2,
  Timer,
  Building2,
  Globe,
  GripVertical,
} from "@/shared/components/icons";

function TimelineFrameComponent({ id, data, selected }: NodeProps) {
  const typedData = data as TimelineFrameData;
  const { setNodes } = useReactFlow();
  const allNodes = useNodes();
  const [isExpanded, setIsExpanded] = useState(typedData.isExpanded || false);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [itemContextMenu, setItemContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get available action nodes not already in timeline (for picker dropdown)
  const availableActions = allNodes.filter(
    (n) =>
      n.type === "actionNode" &&
      !typedData.timelineItems.some((item) => item.actionNodeId === n.id)
  );

  // Timeline items now have embedded actionData, so we use that directly
  const timelineActions = typedData.timelineItems;

  const handleToggleExpand = useCallback(() => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    window.dispatchEvent(new CustomEvent("nodeFocus", { detail: { nodeId: newExpanded ? id : null } }));
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, isExpanded: newExpanded } } : node
      )
    );
  }, [id, isExpanded, setNodes]);

  const handleUpdateItem = useCallback(
    (index: number, updates: Partial<TimelineItem>) => {
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;
          const items = [...(node.data as TimelineFrameData).timelineItems];
          items[index] = { ...items[index], ...updates };
          return { ...node, data: { ...node.data, timelineItems: items } };
        })
      );
    },
    [id, setNodes]
  );

  const handleRemoveItem = useCallback(
    (index: number) => {
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;
          const items = [...(node.data as TimelineFrameData).timelineItems];
          items.splice(index, 1);
          return { ...node, data: { ...node.data, timelineItems: items } };
        })
      );
      setItemContextMenu(null);
    },
    [id, setNodes]
  );

  // Add action from picker dropdown (action still exists on canvas)
  const handleAddActionFromPicker = useCallback(
    (actionNodeId: string, actionData: ActionNodeData) => {
      const defaultReference: TimelineReference = {
        type: "sequence_start",
        delayMs: typedData.timelineItems.length * 1000,
      };
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;
          const items = [...(node.data as TimelineFrameData).timelineItems];
          items.push({
            actionNodeId,
            actionData,
            startTime: typedData.timelineItems.length * 1000,
            waitForResult: true,
            reference: defaultReference,
          });
          return { ...node, data: { ...node.data, timelineItems: items } };
        })
      );
      setShowActionPicker(false);
      setIsDragOver(false);
    },
    [id, typedData.timelineItems.length, setNodes]
  );

  // Add action from drag-drop (actionData passed from event)
  const handleAddActionFromDrop = useCallback(
    (actionNodeId: string, actionData: ActionNodeData) => {
      const defaultReference: TimelineReference = {
        type: "sequence_start",
        delayMs: typedData.timelineItems.length * 1000,
      };
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;
          const items = [...(node.data as TimelineFrameData).timelineItems];
          // Check if already exists
          if (items.some((item) => item.actionNodeId === actionNodeId)) return node;
          items.push({
            actionNodeId,
            actionData,
            startTime: typedData.timelineItems.length * 1000,
            waitForResult: true,
            reference: defaultReference,
          });
          return { ...node, data: { ...node.data, timelineItems: items } };
        })
      );
      setIsDragOver(false);
    },
    [id, typedData.timelineItems.length, setNodes]
  );

  const handleUpdateReference = useCallback(
    (index: number, type: TimelineReferenceType, refActionId?: string) => {
      const newRef: TimelineReference = {
        type,
        referenceActionId: refActionId,
        delayMs: typedData.timelineItems[index]?.reference?.delayMs || 0,
      };
      handleUpdateItem(index, { reference: newRef });
    },
    [handleUpdateItem, typedData.timelineItems]
  );

  const handleUpdateDelay = useCallback(
    (index: number, delayMs: number) => {
      const currentRef = typedData.timelineItems[index]?.reference || {
        type: "sequence_start" as TimelineReferenceType,
        delayMs: 0,
      };
      handleUpdateItem(index, { reference: { ...currentRef, delayMs }, startTime: delayMs });
    },
    [handleUpdateItem, typedData.timelineItems]
  );

  // Drag timeline marker
  const handleDragStart = useCallback((index: number) => {
    setIsDragging(index);
  }, []);

  const handleDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging === null || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = x / rect.width;
      const newTime = Math.round(percent * typedData.totalDuration);
      handleUpdateDelay(isDragging, newTime);
    },
    [isDragging, typedData.totalDuration, handleUpdateDelay]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(null);
  }, []);

  // Listen for drop events from canvas
  useEffect(() => {
    const handleDropOnTimeline = (e: CustomEvent) => {
      const { timelineId, actionNodeId, actionData } = e.detail;
      if (timelineId !== id) return;
      if (!actionData) return;
      handleAddActionFromDrop(actionNodeId, actionData);
    };
    window.addEventListener("dropOnTimeline" as any, handleDropOnTimeline);
    return () => window.removeEventListener("dropOnTimeline" as any, handleDropOnTimeline);
  }, [id, handleAddActionFromDrop]);

  // Visual drag-over state from canvas
  useEffect(() => {
    const handleDragOverTimeline = (e: CustomEvent) => {
      setIsDragOver(e.detail.timelineId === id && e.detail.dragging);
    };
    window.addEventListener("dragOverTimeline" as any, handleDragOverTimeline);
    return () => window.removeEventListener("dragOverTimeline" as any, handleDragOverTimeline);
  }, [id]);

  // Close context menu on outside click
  useEffect(() => {
    if (!itemContextMenu) return;
    const handleClick = () => setItemContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [itemContextMenu]);

  // Helper to get action label
  const getActionLabel = (item: TimelineItem) => {
    const actionData = item.actionData;
    if (!actionData) return item.actionNodeId;
    return actionData.label || item.actionNodeId;
  };

  const getActionType = (item: TimelineItem) => {
    return item.actionData?.actionType;
  };

  // ─── Collapsed view ───
  if (!isExpanded) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "min-w-[200px] bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg border-2 shadow-lg transition-all",
          selected ? "border-indigo-500 shadow-indigo-200" : "border-indigo-200",
          isDragOver && "border-indigo-400 bg-indigo-50 shadow-indigo-300 scale-[1.02]"
        )}
      >
        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-md">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-white" />
            <span className="text-sm font-semibold text-white">{typedData.label}</span>
          </div>
          <button onClick={handleToggleExpand} className="p-1 hover:bg-white/20 rounded transition-colors">
            <Maximize2 className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="px-3 py-2">
          <Handle
            type="target"
            position={Position.Left}
            id={`${id}-in`}
            className="!w-2 !h-2 !bg-indigo-400 !border-indigo-500"
            style={{ left: -4 }}
          />

          {/* Drop hint */}
          {isDragOver && (
            <div className="mb-2 px-2 py-1.5 bg-indigo-100 border border-dashed border-indigo-400 rounded text-xs text-indigo-600 text-center">
              Release to add action
            </div>
          )}

          {/* Mini timeline bar */}
          <div className="relative h-8 bg-gray-100 rounded overflow-hidden mb-2">
            {timelineActions.map((action, index) => {
              const isCEX = getActionType(action) === "CEX";
              const position = (action.startTime / typedData.totalDuration) * 100;
              return (
                <div
                  key={action.actionNodeId}
                  className={cn(
                    "absolute top-1 bottom-1 w-6 rounded flex items-center justify-center text-white text-[8px] font-bold",
                    isCEX ? "bg-amber-500" : "bg-cyan-500"
                  )}
                  style={{ left: `${Math.min(position, 90)}%` }}
                  title={getActionLabel(action)}
                >
                  {index + 1}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>{timelineActions.length} actions</span>
            <span>{(typedData.totalDuration / 1000).toFixed(1)}s</span>
          </div>
          
          {/* Output handles for each action's blocks - visible even when collapsed */}
          {timelineActions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="text-[9px] text-gray-400 mb-1">Outputs:</div>
              <div className="flex flex-wrap gap-1">
                {timelineActions.map((action) => {
                  const isCEX = getActionType(action) === "CEX";
                  const outputBlocks = action.actionData?.outputBlocks ?? [];
                  return outputBlocks.map((block) => (
                    <div key={`${action.actionNodeId}-${block.id}`} className="relative flex items-center">
                      <span className={cn(
                        "text-[9px] px-1 py-0.5 rounded",
                        isCEX ? "bg-amber-100 text-amber-700" : "bg-cyan-100 text-cyan-700"
                      )}>
                        {block.name}
                      </span>
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={`${id}-block-${action.actionNodeId}-${block.id}-out`}
                        className={cn("!w-2 !h-2 !border-white !relative !transform-none !right-0 !top-0 ml-0.5", isCEX ? "!bg-amber-500" : "!bg-cyan-500")}
                      />
                    </div>
                  ));
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Expanded view ───
  return (
    <div
      ref={containerRef}
      className={cn(
        "min-w-[500px] max-w-[700px] bg-white rounded-xl border-2 shadow-2xl transition-all",
        selected ? "border-indigo-500" : "border-indigo-300",
        isDragOver && "border-indigo-400 shadow-indigo-300"
      )}
      onMouseMove={isDragging !== null ? handleDragMove : undefined}
      onMouseUp={handleDragEnd}
      onMouseLeave={handleDragEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-lg">
        <Handle
          type="target"
          position={Position.Left}
          id={`${id}-in`}
          className="!w-3 !h-3 !bg-white !border-indigo-300"
          style={{ left: -6 }}
        />
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-white" />
          <span className="text-base font-bold text-white">{typedData.label}</span>
        </div>
        <button onClick={handleToggleExpand} className="p-1.5 hover:bg-white/20 rounded transition-colors">
          <Minimize2 className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Drop hint */}
      {isDragOver && (
        <div className="mx-4 mt-3 px-3 py-2 bg-indigo-100 border-2 border-dashed border-indigo-400 rounded-lg text-sm text-indigo-600 text-center font-medium">
          Release to add action to sequence
        </div>
      )}

      {/* Timeline ruler */}
      <div className="px-4 pt-4">
        <div
          ref={timelineRef}
          className="relative h-16 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200 overflow-visible"
        >
          {/* Time markers */}
          {[0, 25, 50, 75, 100].map((percent) => (
            <div
              key={percent}
              className="absolute top-0 bottom-0 w-px bg-gray-300"
              style={{ left: `${percent}%` }}
            >
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-400">
                {((percent / 100) * typedData.totalDuration / 1000).toFixed(1)}s
              </span>
            </div>
          ))}

          {/* Action markers (draggable) */}
          {timelineActions.map((action, index) => {
            const isCEX = getActionType(action) === "CEX";
            const position = Math.min((action.startTime / typedData.totalDuration) * 100, 95);
            return (
              <div
                key={action.actionNodeId}
                className={cn(
                  "absolute top-2 cursor-grab active:cursor-grabbing transition-all",
                  isDragging === index && "scale-110 z-10"
                )}
                style={{ left: `${position}%`, transform: "translateX(-50%)" }}
                onMouseDown={() => handleDragStart(index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setItemContextMenu({ index, x: e.clientX, y: e.clientY });
                }}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2 border-white",
                    isCEX ? "bg-amber-500" : "bg-cyan-500"
                  )}
                >
                  {isCEX ? (
                    <Building2 className="w-5 h-5 text-white" />
                  ) : (
                    <Globe className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-gray-600 bg-white px-1 rounded shadow">
                  {getActionLabel(action)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action list */}
      <div className="px-4 py-3 space-y-2 max-h-[300px] overflow-y-auto">
        {timelineActions.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">
            Drag action nodes here or use + to add
          </div>
        ) : (
          timelineActions.map((action, index) => {
            const isCEX = getActionType(action) === "CEX";
            const ref = action.reference;
            return (
              <div
                key={action.actionNodeId}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-all",
                  isCEX ? "bg-amber-50 border-amber-200" : "bg-cyan-50 border-cyan-200"
                )}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setItemContextMenu({ index, x: e.clientX, y: e.clientY });
                }}
              >
                {/* Drag handle */}
                <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />

                {/* Icon */}
                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", isCEX ? "bg-amber-500" : "bg-cyan-500")}>
                  {isCEX ? <Building2 className="w-4 h-4 text-white" /> : <Globe className="w-4 h-4 text-white" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{getActionLabel(action)}</div>
                  <div className="text-[10px] text-gray-500">
                    {isCEX
                      ? `${(action.actionData as any)?.exchange || "CEX"} - ${(action.actionData as any)?.symbol || ""}`
                      : `${(action.actionData as any)?.functionName || "DEX"}`}
                  </div>
                </div>

                {/* Reference selector */}
                <div className="flex flex-col gap-1">
                  <select
                    value={ref?.type || "sequence_start"}
                    onChange={(e) => handleUpdateReference(index, e.target.value as TimelineReferenceType)}
                    className="text-[10px] px-1.5 py-0.5 border border-gray-300 rounded bg-white"
                  >
                    <option value="sequence_start">From Start</option>
                    <option value="action_executed">After Action Exec</option>
                    <option value="action_returned">After Action Return</option>
                  </select>
                  {(ref?.type === "action_executed" || ref?.type === "action_returned") && (
                    <select
                      value={ref.referenceActionId || ""}
                      onChange={(e) => handleUpdateReference(index, ref.type, e.target.value)}
                      className="text-[10px] px-1.5 py-0.5 border border-gray-300 rounded bg-white"
                    >
                      <option value="">Select action</option>
                      {timelineActions
                        .filter((a) => a.actionNodeId !== action.actionNodeId)
                        .map((a) => (
                          <option key={a.actionNodeId} value={a.actionNodeId}>
                            {getActionLabel(a)}
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                {/* Delay input */}
                <div className="flex items-center gap-1">
                  <Timer className="w-3 h-3 text-gray-400" />
                  <input
                    type="number"
                    value={(ref?.delayMs || 0) / 1000}
                    onChange={(e) => handleUpdateDelay(index, parseFloat(e.target.value) * 1000 || 0)}
                    className="w-14 text-xs px-1.5 py-0.5 border border-gray-300 rounded text-center"
                    step="0.1"
                    min="0"
                  />
                  <span className="text-[10px] text-gray-400">s</span>
                </div>

                {/* Wait/Parallel toggle */}
                <button
                  onClick={() => handleUpdateItem(index, { waitForResult: !action.waitForResult })}
                  className={cn(
                    "px-2 py-1 text-[10px] rounded font-medium transition-colors",
                    action.waitForResult
                      ? "bg-amber-100 text-amber-700"
                      : "bg-cyan-100 text-cyan-700"
                  )}
                  title={action.waitForResult ? "Wait for result" : "Parallel execution"}
                >
                  {action.waitForResult ? "WAIT" : "PARALLEL"}
                </button>

                {/* Remove button */}
                <button
                  onClick={() => handleRemoveItem(index)}
                  className="p-1 hover:bg-red-100 rounded transition-colors"
                >
                  <X className="w-4 h-4 text-red-500" />
                </button>

                {/* Output blocks section with handles */}
                <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-200">
                  <span className="text-[10px] text-gray-400">out:</span>
                  {(action.actionData?.outputBlocks ?? []).map((block) => (
                    <div key={block.id} className="relative flex items-center">
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded",
                        isCEX ? "bg-amber-100 text-amber-700" : "bg-cyan-100 text-cyan-700"
                      )}>
                        {block.name}
                      </span>
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={`${id}-block-${action.actionNodeId}-${block.id}-out`}
                        className={cn("!w-2.5 !h-2.5 !border-white !relative !transform-none !right-0 !top-0 ml-1", isCEX ? "!bg-amber-500" : "!bg-cyan-500")}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add action button */}
      <div className="px-4 pb-4 relative">
        <button
          onClick={() => setShowActionPicker(!showActionPicker)}
          className="w-full py-2 border-2 border-dashed border-indigo-300 rounded-lg text-indigo-500 font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Action
        </button>

        {/* Action picker dropdown */}
        {showActionPicker && availableActions.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-white rounded-lg border border-gray-200 shadow-xl max-h-[200px] overflow-y-auto z-50">
            {availableActions.map((node) => {
              const nodeData = node.data as ActionNodeData;
              const isCEX = nodeData.actionType === "CEX";
              return (
                <button
                  key={node.id}
                  onClick={() => handleAddActionFromPicker(node.id, nodeData)}
                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className={cn("w-6 h-6 rounded-full flex items-center justify-center", isCEX ? "bg-amber-500" : "bg-cyan-500")}>
                    {isCEX ? <Building2 className="w-3 h-3 text-white" /> : <Globe className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-sm font-medium text-gray-700">{nodeData.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Item context menu */}
      {itemContextMenu && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[160px]"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleRemoveItem(itemContextMenu.index)}
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Remove from sequence
          </button>
        </div>
      )}
    </div>
  );
}

export const TimelineFrame = memo(TimelineFrameComponent);
