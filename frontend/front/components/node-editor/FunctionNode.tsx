"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Handle, NodeProps, Position, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import dynamic from "next/dynamic";
import type { BlockData, FunctionNodeData, IndicatorCondition, NodeChartPoint } from "./types";
import {
  MetricChart,
  buildMetricSeries,
  evaluateCondition,
  getConditionLabel,
} from "./MetricChart";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  Boxes,
  Code2,
  Copy,
  Maximize2,
  Minimize2,
  Plus,
  X,
  Zap,
} from "lucide-react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#1e1e1e] text-sm text-slate-400">
      Loading...
    </div>
  ),
});

const DEFAULT_INPUT_BLOCK: BlockData = {
  id: "source",
  name: "source",
  description: "차트 계산에 들어오는 스트림 또는 지표 블록",
  type: "input",
};

const DEFAULT_OUTPUT_BLOCK: BlockData = {
  id: "signal",
  name: "signal",
  description: "실시간으로 변하는 산출 지표",
  type: "output",
};

function getInputBlocks(data: FunctionNodeData) {
  return data.inputBlocks?.length ? data.inputBlocks : [DEFAULT_INPUT_BLOCK];
}

function getOutputBlocks(data: FunctionNodeData) {
  return data.outputBlocks?.length ? data.outputBlocks : [DEFAULT_OUTPUT_BLOCK];
}

function getDefaultCondition(metric: string): IndicatorCondition {
  return {
    metric,
    operator: ">",
    threshold: 108,
    label: `${metric} > 108`,
  };
}

function formatValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function FunctionNodeComponent({
  id,
  data,
  selected,
}: NodeProps<import("@xyflow/react").Node<FunctionNodeData>>) {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const allNodes = useNodes();
  const [isExpanded, setIsExpanded] = useState(data.isExpanded ?? false);
  const [viewMode, setViewMode] = useState<"node" | "code">(data.viewMode || "node");

  const inputBlocks = getInputBlocks(data);
  const outputBlocks = getOutputBlocks(data);
  const primaryOutput = outputBlocks[0];
  const condition = useMemo(
    () => data.condition ?? getDefaultCondition(primaryOutput.name),
    [data.condition, primaryOutput.name],
  );
  const runtimeCode = typeof data.runtimeCode === "string" ? data.runtimeCode : "";
  const displayCode = runtimeCode || data.code || "";
  const chartSource = typeof data.chartSource === "string" ? data.chartSource : "";
  const chartWarning = typeof data.chartWarning === "string" ? data.chartWarning : "";
  const chartSeries = useMemo(
    () => {
      const integratedSeries = Array.isArray(data.chartSeries)
        ? (data.chartSeries as NodeChartPoint[])
          .map((point) => ({ time: point.time as any, value: point.value }))
          .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
        : [];
      if (integratedSeries.length > 0) {
        return isExpanded ? integratedSeries : integratedSeries.slice(-56);
      }
      return buildMetricSeries(
        `${id}:${primaryOutput.id}:${primaryOutput.name}:${data.label}`,
        isExpanded ? 96 : 56,
        100 + ((id.length + primaryOutput.name.length) % 18),
      );
    },
    [data.chartSeries, data.label, id, isExpanded, primaryOutput.id, primaryOutput.name],
  );
  const latestValue = chartSeries[chartSeries.length - 1]?.value ?? 0;
  const conditionMet = evaluateCondition(latestValue, condition);
  const triggerOutputBlock = useMemo<BlockData>(
    () => ({
      id: "trigger",
      name: "trigger",
      description: `${getConditionLabel(condition)} 결과를 true/false로 내보냅니다.`,
      type: "output",
      outputKind: "boolean-trigger",
    }),
    [condition],
  );
  const visibleOutputBlocks = useMemo(() => [...outputBlocks, triggerOutputBlock], [outputBlocks, triggerOutputBlock]);

  const outgoingTargets = useMemo(() => {
    return edges
      .filter((edge) => edge.source === id && edge.sourceHandle?.includes("-block-"))
      .map((edge) => {
        const targetNode = allNodes.find((node) => node.id === edge.target);
        return (
          (targetNode?.data as { label?: string; functionName?: string })?.label ||
          (targetNode?.data as { functionName?: string })?.functionName ||
          targetNode?.id ||
          edge.target
        );
      });
  }, [allNodes, edges, id]);

  useEffect(() => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== id) return node;
        if ((node.data as FunctionNodeData).conditionMet === conditionMet) return node;
        return { ...node, data: { ...node.data, conditionMet } };
      }),
    );
  }, [conditionMet, id, setNodes]);

  const updateNodeData = useCallback(
    (patch: Partial<FunctionNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
    },
    [id, setNodes],
  );

  const handleToggleExpand = useCallback(() => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    updateNodeData({ isExpanded: nextExpanded });
    window.dispatchEvent(
      new CustomEvent("nodeFocus", {
        detail: { nodeId: nextExpanded ? id : null },
      }),
    );
  }, [id, isExpanded, updateNodeData]);

  const handleViewModeToggle = useCallback(() => {
    const nextMode = viewMode === "node" ? "code" : "node";
    setViewMode(nextMode);
    updateNodeData({ viewMode: nextMode });
  }, [updateNodeData, viewMode]);

  const handleLabelChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      updateNodeData({ label: event.target.value });
    },
    [updateNodeData],
  );

  const handleCodeChange = useCallback(
    (value: string | undefined) => updateNodeData({ code: value || "" }),
    [updateNodeData],
  );

  const handleDescriptionChange = useCallback(
    (key: "description" | "inputDescription" | "logicDescription" | "outputDescription") =>
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        updateNodeData({ [key]: event.target.value } as Partial<FunctionNodeData>);
      },
    [updateNodeData],
  );

  const handleBlockChange = useCallback(
    (blockType: "input" | "output", blockId: string, patch: Partial<BlockData>) => {
      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      const currentBlocks = blockType === "input" ? inputBlocks : outputBlocks;
      updateNodeData({
        [key]: currentBlocks.map((block) =>
          block.id === blockId ? { ...block, ...patch } : block,
        ),
      } as Partial<FunctionNodeData>);
    },
    [inputBlocks, outputBlocks, updateNodeData],
  );

  const handleAddBlock = useCallback(
    (blockType: "input" | "output") => {
      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      const currentBlocks = blockType === "input" ? inputBlocks : outputBlocks;
      updateNodeData({
        [key]: [
          ...currentBlocks,
          {
            id: `${blockType === "input" ? "ib" : "ob"}-${Date.now()}`,
            name: blockType === "input" ? "source" : "metric",
            description: "",
            type: blockType,
          },
        ],
      } as Partial<FunctionNodeData>);
    },
    [inputBlocks, outputBlocks, updateNodeData],
  );

  const handleRemoveBlock = useCallback(
    (blockType: "input" | "output", blockId: string) => {
      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      const currentBlocks = blockType === "input" ? inputBlocks : outputBlocks;
      if (currentBlocks.length <= 1) return;
      updateNodeData({
        [key]: currentBlocks.filter((block) => block.id !== blockId),
      } as Partial<FunctionNodeData>);
    },
    [inputBlocks, outputBlocks, updateNodeData],
  );

  const handleConditionChange = useCallback(
    (patch: Partial<IndicatorCondition>) => {
      const nextCondition = {
        ...condition,
        ...patch,
      };
      if (!patch.label) {
        delete nextCondition.label;
      }
      updateNodeData({
        condition: nextCondition,
      });
    },
    [condition, updateNodeData],
  );

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(displayCode);
  }, [displayCode]);

  const handleDragStart = (event: DragEvent, blockName: string) => {
    const sourceInfo = `${data.label || data.functionName || id}.${blockName}`;
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify({ type: "INPUT_BLOCK", name: sourceInfo }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  const renderInputHandles = (baseTop = 70) =>
    inputBlocks.map((block, index) => (
      <Handle
        key={block.id}
        type="target"
        position={Position.Left}
        id={`${id}-input-${block.id}-in`}
        className="!h-2.5 !w-2.5 !border-blue-600 !bg-blue-500"
        style={{ left: -5, top: baseTop + index * 28 }}
      />
    ));

  if (!isExpanded) {
    return (
      <div
        className={cn(
          "w-[310px] overflow-hidden rounded-lg border-2 bg-white shadow-sm transition-all",
          selected ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200",
          conditionMet && "border-emerald-500",
        )}
      >
        {renderInputHandles(70)}

        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-emerald-600" />
            <input
              value={data.label}
              onChange={handleLabelChange}
              className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none"
              placeholder="Indicator logic"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleViewModeToggle}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200"
              title={viewMode === "code" ? "Show chart" : "Show code"}
            >
              {viewMode === "code" ? <Boxes className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={handleToggleExpand}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200"
              title="Expand"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {primaryOutput.name}
            </div>
            <div
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-bold",
                conditionMet ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
              )}
            >
              {formatValue(latestValue)}
            </div>
          </div>
          <div className="h-[132px] overflow-hidden rounded-md border border-slate-100">
            <MetricChart series={chartSeries} condition={condition} compact height={132} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
            <span className={cn("truncate", chartWarning && "text-amber-600")} title={chartWarning || chartSource}>
              {chartWarning || chartSource || getConditionLabel(condition)}
            </span>
            <span className={conditionMet ? "font-semibold text-emerald-600" : ""}>
              {conditionMet ? "TRIGGER" : "WATCH"}
            </span>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {visibleOutputBlocks.map((block) => {
            const isTriggerOutput = block.id === triggerOutputBlock.id;
            return (
              <div
                key={block.id}
                draggable
                onDragStart={(event) => handleDragStart(event, block.name)}
                className={cn(
                  "nodrag relative px-3 py-2",
                  isTriggerOutput && "bg-emerald-50/70",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800">{block.name}</div>
                  {isTriggerOutput ? (
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-black",
                      conditionMet ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600",
                    )}>
                      {conditionMet ? "true" : "false"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 min-h-[14px] text-[11px] text-slate-500">
                  {block.description || "실시간 산출값"}
                </div>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${id}-block-${block.id}-out`}
                  className={cn(
                    "!h-2.5 !w-2.5 !border-emerald-600 !bg-emerald-500",
                    conditionMet && "!h-3 !w-3 !shadow-[0_0_0_4px_rgba(16,185,129,0.18)]",
                  )}
                  style={{ right: -5 }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-[640px] overflow-hidden rounded-lg border-2 bg-white shadow-2xl transition-all",
        selected ? "border-emerald-400" : "border-slate-300",
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-emerald-600 mt-1" />
          <div className="flex-1 flex flex-col min-w-0">

            <textarea
              value={data.label}
              onChange={handleLabelChange}
              className="min-h-[28px] min-w-0 flex-1 resize-none bg-transparent text-base font-bold text-slate-900 outline-none"
              placeholder="Indicator logic"
              rows={1}
            />
            <input
              value={data.description ?? ""}
              onChange={(e) => updateNodeData({ description: e.target.value })}
              className="w-full bg-transparent text-xs text-slate-500 outline-none placeholder:text-slate-300"
              placeholder="함수 기능 설명"
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleViewModeToggle}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors",
              viewMode === "code"
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100",
            )}
          >
            {viewMode === "code" ? <Code2 className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
            {viewMode === "code" ? "Code" : "Chart"}
          </button>
          <button
            onClick={handleCopyCode}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200"
            title="Copy code"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={handleToggleExpand}
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200"
            title="Collapse"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[230px_minmax(0,1fr)]">
        <div className="border-r border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">Input</div>
            <textarea
              value={data.inputDescription ?? ""}
              onChange={handleDescriptionChange("inputDescription")}
              className="h-16 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300"
              placeholder="어떤 블록/스트림이 들어오는지 설명"
            />
          </div>
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-600">Logic</div>
            <textarea
              value={data.logicDescription ?? data.description ?? ""}
              onChange={handleDescriptionChange("logicDescription")}
              className="h-20 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-amber-300"
              placeholder="값을 산출하는 조건/패턴 설명"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600">Output</div>
            <textarea
              value={data.outputDescription ?? ""}
              onChange={handleDescriptionChange("outputDescription")}
              className="h-16 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-300"
              placeholder="산출되는 지표/트리거 설명"
            />
          </div>
        </div>

        <div className="min-w-0">
          {viewMode === "code" ? (
            <div className="h-[310px] border-b border-slate-200">
              <MonacoEditor
                height="100%"
                language={runtimeCode ? "go" : "javascript"}
                theme="vs-dark"
                value={displayCode}
                onChange={handleCodeChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  tabSize: 2,
                  automaticLayout: true,
                  readOnly: Boolean(runtimeCode),
                  padding: { top: 10, bottom: 10 },
                }}
              />
            </div>
          ) : (
            <div className="border-b border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{primaryOutput.name}</div>
                  <div className={cn("text-[11px] text-slate-500", chartWarning && "text-amber-600")}>
                    {chartWarning ? `차트 계산 경고: ${chartWarning}` : chartSource ? `차트 데이터: ${chartSource}` : "조건 충족 구간은 초록색으로 표시됩니다"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-slate-950">{formatValue(latestValue)}</div>
                  <div className={cn("text-[11px] font-semibold", conditionMet ? "text-emerald-600" : "text-slate-500")}>
                    {conditionMet ? "condition matched" : "watching"}
                  </div>
                </div>
              </div>
              <div className="h-[240px] overflow-hidden rounded-md border border-slate-200">
                <MetricChart series={chartSeries} condition={condition} height={240} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 border-b border-slate-200">
            <div
              className="border-r border-slate-200 p-3"
              data-connect-target-node={id}
              data-connect-target-mode="append-input"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700">Input Blocks</span>
                <button
                  onClick={() => handleAddBlock("input")}
                  className="rounded p-0.5 text-blue-600 hover:bg-blue-50"
                  title="Add input block"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                {inputBlocks.map((block) => (
                  <div
                    key={block.id}
                    data-connect-target-node={id}
                    data-connect-target-handle={`${id}-input-${block.id}-in`}
                    className="nodrag group relative rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5"
                  >
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={`${id}-input-${block.id}-in`}
                      className="!h-2.5 !w-2.5 !border-blue-600 !bg-blue-500"
                      style={{ left: -8 }}
                    />
                    <input
                      value={block.name}
                      onChange={(event) => handleBlockChange("input", block.id, { name: event.target.value })}
                      className="w-full bg-transparent text-xs font-semibold text-blue-900 outline-none"
                      placeholder="input name"
                    />
                    <input
                      value={block.description ?? ""}
                      onChange={(event) =>
                        handleBlockChange("input", block.id, { description: event.target.value })
                      }
                      className="mt-0.5 w-full bg-transparent text-[11px] text-blue-600 outline-none placeholder:text-blue-300"
                      placeholder="input description"
                    />
                    {block.connectedFrom ? (
                      <div className="mt-1 truncate rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                        {String(block.connectedFrom)}
                      </div>
                    ) : null}
                    <button
                      onClick={() => handleRemoveBlock("input", block.id)}
                      className="absolute right-1 top-1 rounded p-0.5 text-rose-500 opacity-0 transition-opacity hover:bg-rose-50 group-hover:opacity-100"
                      title="Remove input block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-700">Output Data</span>
                <button
                  onClick={() => handleAddBlock("output")}
                  className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50"
                  title="Add output block"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                {visibleOutputBlocks.map((block) => {
                  const isTriggerOutput = block.id === triggerOutputBlock.id;
                  return (
                    <div
                      key={block.id}
                      draggable
                      onDragStart={(event) => handleDragStart(event, block.name)}
                      className={cn(
                        "nodrag group relative rounded-md border px-2 py-1.5",
                        isTriggerOutput
                          ? "border-violet-200 bg-violet-50"
                          : "border-emerald-200 bg-emerald-50",
                      )}
                    >
                      {isTriggerOutput ? (
                        <>
                          <div className="flex items-center justify-between gap-2 pr-4">
                            <div className="text-xs font-semibold text-violet-900">{block.name}</div>
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-[9px] font-black",
                              conditionMet ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600",
                            )}>
                              {conditionMet ? "true" : "false"}
                            </span>
                          </div>
                          <div className="mt-0.5 pr-4 text-[11px] text-violet-600">
                            {block.description}
                          </div>
                        </>
                      ) : (
                        <>
                          <input
                            value={block.name}
                            onChange={(event) => handleBlockChange("output", block.id, { name: event.target.value })}
                            className="w-full bg-transparent text-xs font-semibold text-emerald-900 outline-none"
                            placeholder="output name"
                          />
                          <input
                            value={block.description ?? ""}
                            onChange={(event) =>
                              handleBlockChange("output", block.id, { description: event.target.value })
                            }
                            className="mt-0.5 w-full bg-transparent text-[11px] text-emerald-600 outline-none placeholder:text-emerald-300"
                            placeholder="output description"
                          />
                          <button
                            onClick={() => handleRemoveBlock("output", block.id)}
                            className="absolute right-5 top-1 rounded p-0.5 text-rose-500 opacity-0 transition-opacity hover:bg-rose-50 group-hover:opacity-100"
                            title="Remove output block"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={`${id}-block-${block.id}-out`}
                        className={cn(
                          isTriggerOutput
                            ? "!h-3 !w-3 !border-violet-700 !bg-violet-600"
                            : "!h-2.5 !w-2.5 !border-emerald-600 !bg-emerald-500",
                          conditionMet && "!shadow-[0_0_0_4px_rgba(16,185,129,0.18)]",
                        )}
                        style={{ right: -8 }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3 p-3">
            <div className="grid grid-cols-[1fr_70px_90px] gap-2">
              <input
                value={condition.metric ?? primaryOutput.name}
                onChange={(event) => handleConditionChange({ metric: event.target.value })}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-300"
                placeholder="metric"
              />
              <select
                value={condition.operator}
                onChange={(event) =>
                  handleConditionChange({
                    operator: event.target.value as IndicatorCondition["operator"],
                  })
                }
                className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-300"
              >
                <option value=">">&gt;</option>
                <option value=">=">&gt;=</option>
                <option value="<">&lt;</option>
                <option value="<=">&lt;=</option>
              </select>
              <input
                type="number"
                value={condition.threshold}
                onChange={(event) => handleConditionChange({ threshold: Number(event.target.value) })}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-300"
              />
            </div>
            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 text-xs font-bold",
                conditionMet ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              {conditionMet ? "Trigger" : "Watch"}
            </div>
          </div>

          {outgoingTargets.length > 0 ? (
            <div className="border-t border-slate-200 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800">
              {getConditionLabel(condition)} 충족 시 연결된 노드 작동: {outgoingTargets.join(", ")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const FunctionNode = memo(FunctionNodeComponent);
