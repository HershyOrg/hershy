"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Handle, NodeProps, Position, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import dynamic from "next/dynamic";
import type { BlockData, ChartComparisonValue, FunctionNodeData, IndicatorCondition, NodeChartPoint } from "./types";
import {
  MetricChart,
  buildMetricSeries,
  createChartComparisonValue,
  evaluateCondition,
  getConditionLabel,
  normalizeChartComparisonValues,
} from "./MetricChart";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  Boxes,
  Code2,
  Copy,
  Eye,
  EyeOff,
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

function isTriggerDataBlock(block: BlockData) {
  const text = `${block.id} ${block.name} ${String(block.outputKind ?? "")}`.toLowerCase();
  return /\btrigger(?:ed)?\b|boolean-trigger|boolean-data/.test(text);
}

function getInputHandleId(nodeId: string, blockId: string) {
  return `${nodeId}-input-${blockId}-in`;
}

function getOutputHandleId(nodeId: string, blockId: string) {
  return `${nodeId}-block-${blockId}-out`;
}

function compactBlocksForCollapsedHandles(
  blocks: BlockData[],
  connectedHandleIds: Set<string>,
  getHandleId: (blockId: string) => string,
) {
  const selected = new Map<string, BlockData>();
  const primary = blocks[0];
  if (primary) {
    selected.set(primary.id, primary);
  }
  blocks.forEach((block) => {
    if (connectedHandleIds.has(getHandleId(block.id))) {
      selected.set(block.id, block);
    }
  });
  return Array.from(selected.values());
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
  const showChartComparison = data.showChartComparison !== false;
  const chartComparisonValues = useMemo(
    () => normalizeChartComparisonValues(data.chartComparisonValues),
    [data.chartComparisonValues],
  );
  const visibleChartComparisonValues = useMemo(
    () => showChartComparison ? chartComparisonValues.filter((item) => item.enabled !== false) : [],
    [chartComparisonValues, showChartComparison],
  );
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
      description: `${getConditionLabel(condition)} 결과 boolean 데이터`,
      type: "output",
      outputKind: "boolean-data",
    }),
    [condition],
  );
  const runtimeBlockType = String(data.runtimeBlockType ?? data.blockType ?? data.nodeCategory ?? "").toLowerCase();
  const triggerType = String(data.triggerType ?? "").trim();
  const isTriggerFormulaNode = outputBlocks.some(isTriggerDataBlock) ||
    runtimeBlockType === "trigger" ||
    triggerType.length > 0 ||
    data.materializedTriggerFormula === true;
  const visibleOutputBlocks = useMemo(
    () => {
      if (!isTriggerFormulaNode) return outputBlocks;
      return outputBlocks.some(isTriggerDataBlock) ? outputBlocks : [...outputBlocks, triggerOutputBlock];
    },
    [isTriggerFormulaNode, outputBlocks, triggerOutputBlock],
  );

  const connectedInputHandleIds = useMemo(() => {
    const ids = new Set<string>();
    edges.forEach((edge) => {
      if (edge.target === id && edge.targetHandle) ids.add(edge.targetHandle);
    });
    return ids;
  }, [edges, id]);

  const connectedOutputHandleIds = useMemo(() => {
    const ids = new Set<string>();
    edges.forEach((edge) => {
      if (edge.source === id && edge.sourceHandle) ids.add(edge.sourceHandle);
    });
    return ids;
  }, [edges, id]);

  const collapsedInputBlocks = useMemo(
    () => compactBlocksForCollapsedHandles(
      inputBlocks,
      connectedInputHandleIds,
      (blockId) => getInputHandleId(id, blockId),
    ),
    [connectedInputHandleIds, id, inputBlocks],
  );

  const collapsedOutputBlocks = useMemo(
    () => compactBlocksForCollapsedHandles(
      visibleOutputBlocks,
      connectedOutputHandleIds,
      (blockId) => getOutputHandleId(id, blockId),
    ),
    [connectedOutputHandleIds, id, visibleOutputBlocks],
  );

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

  const handleToggleChartComparison = useCallback(() => {
    updateNodeData({ showChartComparison: !showChartComparison });
  }, [showChartComparison, updateNodeData]);

  const handleAddChartComparisonValue = useCallback(() => {
    const next = createChartComparisonValue(chartComparisonValues.length + 1, Number(condition.threshold) + chartComparisonValues.length + 1);
    updateNodeData({
      showChartComparison: true,
      chartComparisonValues: [...chartComparisonValues, next],
    });
  }, [chartComparisonValues, condition.threshold, updateNodeData]);

  const handleUpdateChartComparisonValue = useCallback(
    (lineId: string, patch: Partial<ChartComparisonValue>) => {
      updateNodeData({
        chartComparisonValues: chartComparisonValues.map((item) =>
          item.id === lineId ? { ...item, ...patch } : item,
        ),
      });
    },
    [chartComparisonValues, updateNodeData],
  );

  const handleRemoveChartComparisonValue = useCallback(
    (lineId: string) => {
      updateNodeData({
        chartComparisonValues: chartComparisonValues.filter((item) => item.id !== lineId),
      });
    },
    [chartComparisonValues, updateNodeData],
  );

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

  const handleLogicDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData({ logicDescription: event.target.value });
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

  const renderInputHandles = (blocks: BlockData[], baseTop = 70) =>
    blocks.map((block, index) => (
      <Handle
        key={block.id}
        type="target"
        position={Position.Left}
        id={getInputHandleId(id, block.id)}
        className="!h-2.5 !w-2.5 !border-blue-600 !bg-blue-500"
        style={{ left: -5, top: baseTop + index * 28 }}
      />
    ));

  const renderOutputHandles = (blocks: BlockData[], baseTop = 116) =>
    blocks.map((block, index) => {
      const isTriggerOutput = isTriggerDataBlock(block);
      return (
        <Handle
          key={block.id}
          type="source"
          position={Position.Right}
          id={getOutputHandleId(id, block.id)}
          className={cn(
            "!h-2.5 !w-2.5",
            isTriggerOutput
              ? "!border-violet-700 !bg-violet-600"
              : "!border-emerald-600 !bg-emerald-500",
            conditionMet && "!h-3 !w-3 !shadow-[0_0_0_4px_rgba(16,185,129,0.18)]",
          )}
          style={{ right: -5, top: baseTop + index * 28 }}
        />
      );
    });

  if (!isExpanded) {
    return (
      <div
        className={cn(
          "w-[310px] overflow-hidden rounded-lg border-2 bg-white shadow-sm transition-all",
          selected ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200",
          conditionMet && "border-emerald-500",
        )}
      >
        {renderInputHandles(collapsedInputBlocks, 70)}
        {renderOutputHandles(collapsedOutputBlocks, 160)}

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
          <div className="h-[132px] overflow-hidden rounded-md border border-slate-100 dark:border-slate-700">
            <MetricChart
              series={chartSeries}
              condition={showChartComparison ? condition : undefined}
              comparisonValues={visibleChartComparisonValues}
              compact
              height={132}
              source={chartSource}
              updatedAt={typeof data.chartUpdatedAt === "string" ? data.chartUpdatedAt : ""}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
            <span className={cn("truncate", chartWarning && "text-amber-600")} title={chartWarning || chartSource}>
              {chartWarning || chartSource || (showChartComparison ? getConditionLabel(condition) : "비교 표시 꺼짐")}
              {showChartComparison && chartComparisonValues.length > 0 ? ` + ${chartComparisonValues.length}` : ""}
            </span>
            <span className={conditionMet ? "font-semibold text-emerald-600" : ""}>
              {conditionMet ? "TRUE" : "FALSE"}
            </span>
          </div>
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
                    {chartWarning
                      ? `차트 계산 경고: ${chartWarning}`
                      : chartSource
                        ? `차트 데이터: ${chartSource}`
                        : showChartComparison
                          ? `조건 충족 구간과 기준선 ${chartComparisonValues.length + 1}개를 차트에 표시합니다`
                          : "조건 비교 표시는 꺼져 있습니다"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-slate-950">{formatValue(latestValue)}</div>
                  <div className={cn("text-[11px] font-semibold", conditionMet ? "text-emerald-600" : "text-slate-500")}>
                    {conditionMet ? "true" : "false"}
                  </div>
                </div>
              </div>
              <div className="h-[240px] overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
            <MetricChart
              series={chartSeries}
              condition={showChartComparison ? condition : undefined}
              comparisonValues={visibleChartComparisonValues}
              height={240}
              source={chartSource}
                  updatedAt={typeof data.chartUpdatedAt === "string" ? data.chartUpdatedAt : ""}
                />
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
                <span className="text-xs font-semibold text-emerald-700">Output Blocks</span>
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
                  const isTriggerOutput = isTriggerDataBlock(block);
                  const blockName = isTriggerOutput ? "trigger" : block.name;
                  return (
                    <div
                      key={block.id}
                      draggable
                      onDragStart={(event) => handleDragStart(event, blockName)}
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
                            <div className="text-xs font-semibold text-violet-900">{blockName}</div>
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-[9px] font-black",
                              conditionMet ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600",
                            )}>
                              {conditionMet ? "true" : "false"}
                            </span>
                          </div>
                          <div className="mt-0.5 pr-4 text-[11px] text-violet-600">
                            trigger formula output
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

          <div className="border-b border-slate-200 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              Trigger Formula
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_70px_90px_28px_28px_74px] gap-2">
                <input
                  value={condition.metric ?? primaryOutput.name}
                  onChange={(event) => handleConditionChange({ metric: event.target.value })}
                  className="min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-300"
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
                <button
                  onClick={handleToggleChartComparison}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors",
                    showChartComparison
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                  )}
                  title={showChartComparison ? "비교값 차트 표시 끄기" : "비교값 차트 표시 켜기"}
                  aria-pressed={showChartComparison}
                >
                  {showChartComparison ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={handleAddChartComparisonValue}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
                  title="차트 비교값 추가"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <div
                  className={cn(
                    "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-bold",
                    conditionMet ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
                  )}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {conditionMet ? "True" : "False"}
                </div>
              </div>

              {chartComparisonValues.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_90px_28px_28px] gap-2"
                >
                  <input
                    value={item.label ?? ""}
                    onChange={(event) => handleUpdateChartComparisonValue(item.id, { label: event.target.value })}
                    className="min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-300"
                    placeholder="비교값 이름"
                  />
                  <input
                    type="number"
                    value={item.value}
                    onChange={(event) => handleUpdateChartComparisonValue(item.id, { value: Number(event.target.value) })}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-300"
                  />
                  <button
                    onClick={() => handleUpdateChartComparisonValue(item.id, { enabled: item.enabled === false })}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors",
                      item.enabled !== false
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                    )}
                    title={item.enabled !== false ? "이 비교값 숨기기" : "이 비교값 표시"}
                    aria-pressed={item.enabled !== false}
                  >
                    {item.enabled !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => handleRemoveChartComparisonValue(item.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100"
                    title="차트 비교값 삭제"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-emerald-200 bg-emerald-50/80 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                Logic 설명
              </span>
              {outgoingTargets.length > 0 ? (
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  {outgoingTargets.length} 연결
                </span>
              ) : null}
            </div>
            <textarea
              value={data.logicDescription ?? data.description ?? ""}
              onChange={handleLogicDescriptionChange}
              className="min-h-[58px] w-full resize-none rounded-md border border-emerald-200 bg-white/90 px-2 py-1.5 text-xs leading-5 text-emerald-950 outline-none placeholder:text-emerald-300 focus:border-emerald-400"
              placeholder={"1. 어떤 데이터를 받아와서: ...\n2. 어떤 동작을 수행하고: ...\n3. 어떤 output을 내는지: ..."}
            />
            {outgoingTargets.length > 0 ? (
              <div className="mt-2 text-[11px] font-semibold text-emerald-800">
                {getConditionLabel(condition)} 충족 시 연결된 노드 작동: {outgoingTargets.join(", ")}
              </div>
            ) : null}
          </div>
        </div>
    </div>
  );
}

export const FunctionNode = memo(FunctionNodeComponent);
