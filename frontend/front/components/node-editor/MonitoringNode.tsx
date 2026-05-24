"use client";

import { memo, useCallback, useMemo } from "react";
import { Handle, NodeProps, Position, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import type {
  BlockData,
  ChartComparisonValue,
  IndicatorCondition,
  MonitoringNode as MonitoringNodeType,
  MonitoringNodeData,
} from "./types";
import {
  MetricChart,
  buildMetricSeries,
  createChartComparisonValue,
  evaluateCondition,
  getConditionLabel,
  normalizeChartComparisonValues,
} from "./MetricChart";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Eye, EyeOff, ListFilter, Plus, TerminalSquare, X, Zap } from "lucide-react";

const COMPARE_COLORS = ["#2563eb", "#f97316", "#8b5cf6", "#0f766e", "#dc2626"];

function getSourceBlock(edgeSourceHandle: string | null | undefined, sourceNode: any) {
  const blockId = edgeSourceHandle?.match(/-block-(.+)-out$/)?.[1];
  const blocks = (sourceNode?.data as { outputBlocks?: BlockData[] })?.outputBlocks ?? [];
  return blocks.find((block) => block.id === blockId) ?? null;
}

function getDefaultCondition(metric: string): IndicatorCondition {
  return {
    metric,
    operator: ">",
    threshold: 108,
  };
}

function MonitoringNodeComponent({ id, data, selected }: NodeProps<MonitoringNodeType>) {
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  const allNodes = useNodes();

  const availableVariables = useMemo(() => {
    return edges
      .filter((edge) => edge.target === id && edge.sourceHandle?.includes("-block-"))
      .map((edge) => {
        const sourceNode = allNodes.find((node) => node.id === edge.source);
        const nodeLabel =
          (sourceNode?.data as { label?: string; functionName?: string })?.label ||
          (sourceNode?.data as { functionName?: string })?.functionName ||
          sourceNode?.id ||
          edge.source;
        const block = getSourceBlock(edge.sourceHandle, sourceNode);
        const name = block?.name || edge.sourceHandle || "output";

        return {
          key: `${edge.source}:${edge.sourceHandle}`,
          nodeId: edge.source,
          nodeLabel,
          name,
          description: block?.description,
          type: "output",
        };
      });
  }, [allNodes, edges, id]);

  const selectedVars = data.selectedVariables || [];
  const selectedVariableObjects = useMemo(() => {
    const selectedSet = new Set(selectedVars);
    const selectedFromData = availableVariables.filter((variable) => selectedSet.has(variable.key));
    if (selectedFromData.length > 0) return selectedFromData;
    return availableVariables.slice(0, 1);
  }, [availableVariables, selectedVars]);

  const primaryVariable = selectedVariableObjects[0] ?? availableVariables[0] ?? null;
  const primarySeries = useMemo(
    () =>
      primaryVariable
        ? buildMetricSeries(`monitor:${primaryVariable.key}`, 84, 100 + (primaryVariable.name.length % 12))
        : [],
    [primaryVariable],
  );
  const compareSeries = useMemo(
    () =>
      selectedVariableObjects.slice(1, 6).map((variable, index) => ({
        label: variable.name,
        color: COMPARE_COLORS[index % COMPARE_COLORS.length],
        series: buildMetricSeries(`monitor:${variable.key}`, 84, 96 + index * 4),
      })),
    [selectedVariableObjects],
  );
  const condition = useMemo(
    () => data.condition ?? getDefaultCondition(primaryVariable?.name || "value"),
    [data.condition, primaryVariable?.name],
  );
  const showChartComparison = data.showChartComparison !== false;
  const chartComparisonValues = useMemo(
    () => normalizeChartComparisonValues(data.chartComparisonValues),
    [data.chartComparisonValues],
  );
  const visibleCompareSeries = useMemo(
    () => (showChartComparison ? compareSeries : []),
    [compareSeries, showChartComparison],
  );
  const visibleChartComparisonValues = useMemo(
    () => showChartComparison ? chartComparisonValues.filter((item) => item.enabled !== false) : [],
    [chartComparisonValues, showChartComparison],
  );
  const latestValue = primarySeries[primarySeries.length - 1]?.value ?? 0;
  const conditionMet = evaluateCondition(latestValue, condition);

  const updateNodeData = useCallback(
    (patch: Partial<MonitoringNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
    },
    [id, setNodes],
  );

  const toggleFormat = useCallback(() => {
    updateNodeData({ format: data.format === "chart" ? "logs" : "chart" });
  }, [data.format, updateNodeData]);

  const toggleChartComparison = useCallback(() => {
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

  const openTerminal = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("toggleTerminal", {
        detail: { open: true, monitoringNodeId: id },
      }),
    );
  }, [id]);

  const handleToggleVariable = useCallback(
    (varKey: string) => {
      const selectedSet = new Set(selectedVars);
      if (selectedSet.has(varKey)) {
        selectedSet.delete(varKey);
      } else {
        selectedSet.add(varKey);
      }
      updateNodeData({ selectedVariables: Array.from(selectedSet) });
    },
    [selectedVars, updateNodeData],
  );

  const handleConditionChange = useCallback(
    (patch: Partial<IndicatorCondition>) => {
      updateNodeData({ condition: { ...condition, ...patch } });
    },
    [condition, updateNodeData],
  );

  return (
    <div
      className={cn(
        "w-[420px] overflow-hidden rounded-lg border-2 bg-slate-950 text-slate-200 shadow-xl transition-all",
        selected ? "border-emerald-400" : "border-slate-700",
        conditionMet && "border-emerald-500",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-monitor-in`}
        className="!h-3 !w-3 !border-emerald-700 !bg-emerald-500"
        style={{ left: -6 }}
      />

      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-emerald-400" />
          <input
            value={data.label || "Visual Monitor"}
            onChange={(event) => updateNodeData({ label: event.target.value })}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-emerald-50 outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFormat}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800"
            title="Toggle visualization"
          >
            {data.format === "chart" ? (
              <TerminalSquare className="h-4 w-4" />
            ) : (
              <ListFilter className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={openTerminal}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800"
            title="Open terminal"
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3">
        {primaryVariable ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-emerald-300">
                  {primaryVariable.nodeLabel}.{primaryVariable.name}
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  {!showChartComparison
                    ? "차트 비교 표시 꺼짐"
                    : compareSeries.length > 0
                      ? `${compareSeries.length + 1} indicators · 기준값 ${chartComparisonValues.length + 1}개`
                      : chartComparisonValues.length > 0
                        ? `기준값 ${chartComparisonValues.length + 1}개`
                        : primaryVariable.description || "single indicator view"}
                </div>
              </div>
              <div
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold",
                  conditionMet ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-800 text-slate-400",
                )}
              >
                <Zap className="h-3.5 w-3.5" />
                {conditionMet ? "Signal" : "Watch"}
              </div>
            </div>

            {data.format === "logs" ? (
              <div className="rounded-md border border-slate-800 bg-black/35 p-3 font-mono text-[11px] leading-5 text-slate-400">
                <div>{">"} visual monitor attached</div>
                <div>{">"} metric: {primaryVariable.name}</div>
                <div>{">"} condition: {getConditionLabel(condition)}</div>
                <div className={conditionMet ? "text-emerald-300" : "text-slate-500"}>
                  {">"} status: {conditionMet ? "condition matched" : "watching"}
                </div>
              </div>
            ) : (
              <div className="h-[210px] overflow-hidden rounded-md border border-slate-800">
                <MetricChart
                  series={primarySeries}
                  compareSeries={visibleCompareSeries}
                  condition={showChartComparison ? condition : undefined}
                  comparisonValues={visibleChartComparisonValues}
                  height={210}
                  backgroundColor="#020617"
                  baseColor="#22c55e"
                  activeColor="#f59e0b"
                  thresholdColor="#f97316"
                />
              </div>
            )}

            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_64px_84px_28px_28px] gap-2">
                <input
                  value={condition.metric ?? primaryVariable.name}
                  onChange={(event) => handleConditionChange({ metric: event.target.value })}
                  className="min-w-0 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
                />
                <select
                  value={condition.operator}
                  onChange={(event) =>
                    handleConditionChange({
                      operator: event.target.value as IndicatorCondition["operator"],
                    })
                  }
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
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
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
                />
                <button
                  onClick={toggleChartComparison}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors",
                    showChartComparison
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-700 bg-slate-900 text-slate-500 hover:bg-slate-800",
                  )}
                  title={showChartComparison ? "비교값 차트 표시 끄기" : "비교값 차트 표시 켜기"}
                  aria-pressed={showChartComparison}
                >
                  {showChartComparison ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={handleAddChartComparisonValue}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 transition-colors hover:bg-emerald-500/20"
                  title="차트 비교값 추가"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {chartComparisonValues.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_84px_28px_28px] gap-2"
                >
                  <input
                    value={item.label ?? ""}
                    onChange={(event) => handleUpdateChartComparisonValue(item.id, { label: event.target.value })}
                    className="min-w-0 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
                    placeholder="비교값 이름"
                  />
                  <input
                    type="number"
                    value={item.value}
                    onChange={(event) => handleUpdateChartComparisonValue(item.id, { value: Number(event.target.value) })}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => handleUpdateChartComparisonValue(item.id, { enabled: item.enabled === false })}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors",
                      item.enabled !== false
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-700 bg-slate-900 text-slate-500 hover:bg-slate-800",
                    )}
                    title={item.enabled !== false ? "이 비교값 숨기기" : "이 비교값 표시"}
                    aria-pressed={item.enabled !== false}
                  >
                    {item.enabled !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => handleRemoveChartComparisonValue(item.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 transition-colors hover:bg-rose-500/20"
                    title="차트 비교값 삭제"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-slate-700 bg-slate-900/60 px-3 py-8 text-center text-xs text-slate-500">
            output block을 모니터에 연결하면 차트가 생성됩니다
          </div>
        )}
      </div>

      <div className="border-t border-slate-800 bg-slate-900/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
          <Activity className="h-3.5 w-3.5 text-emerald-400" />
          Visualized Outputs
        </div>

        {availableVariables.length === 0 ? (
          <div className="text-xs text-slate-600">No connected output blocks</div>
        ) : (
          <div className="grid max-h-36 gap-1.5 overflow-y-auto pr-1">
            {availableVariables.map((variable) => {
              const isChecked = selectedVars.includes(variable.key);

              return (
                <label
                  key={variable.key}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    isChecked
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-900",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleVariable(variable.key)}
                    className="h-3 w-3 accent-emerald-500"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {variable.nodeLabel}.{variable.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const MonitoringNode = memo(MonitoringNodeComponent);
