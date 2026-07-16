"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { Edge, Node } from "@xyflow/react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Database,
  FileUp,
  FlaskConical,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pause,
  Play,
  Timer,
  Trash2,
  X,
} from "@/shared/components/icons";
import type {
  ActionNodeData,
  BlockData,
  ChartComparisonValue,
  FunctionNodeData,
  IndicatorCondition,
  StreamingNodeData,
  TimeTriggerData,
} from "../types/editorTypes";
import {
  MetricChart,
  buildMetricSeries,
  normalizeChartComparisonValues,
  type MetricPoint,
} from "./MetricChart";
import { readHistoricalDataState, writeHistoricalDataState } from "@/shared/store/clientStateStore";
import type {
  ApiHistoricalDataMapping,
  HistoricalDataDataset,
  PersistedHistoricalDataState,
} from "@/shared/types/domain";
import { sequenceLogStore } from "../store/sequenceLogStore";
import {
  normalizeBacktestDataset,
  normalizeBacktestMetricName,
  replayThreeDownCloseBacktest,
  type BacktestNormalizationResult,
  type BacktestReplayResult,
} from "../utils/backtestData";
import { cn } from "@/shared/utils/utils";

type SequenceMonitorPanelProps = {
  nodes: Node[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

type SequenceMonitorModel = {
  id: string;
  label: string;
  purpose: string;
  nodeIds: Set<string>;
  triggerNodes: Node[];
  actionNodes: Node[];
  indicatorNodes: Node[];
  streamingNodes: Node[];
};

type MonitorChartModel = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  label: string;
  kind: "stream" | "indicator";
  series: MetricPoint[];
  condition?: IndicatorCondition;
  conditions: IndicatorCondition[];
  comparisonValues: ChartComparisonValue[];
  source: string;
  updatedAt: string;
  booleanMode: boolean;
};

type DryRunStatus = {
  timestamp: number;
  checkedTriggers: number;
  reachableActions: number;
  warnings: number;
  status: "passed" | "warning";
};

type BacktestApiFeedModel = {
  id: string;
  nodeId: string;
  label: string;
  apiReference: string;
  sourceUrl: string;
  requiredMetrics: string[];
};

type BacktestDataConnection = {
  nodeId: string;
  nodeLabel: string;
  fileName: string;
  rowCount: number;
  connectedAt: number;
  metrics: string[];
  source?: "manual" | "data-panel";
};

type BacktestUploadTargetModel = {
  id: string;
  nodeId: string;
  nodeIds: string[];
  label: string;
  kind: "stream" | "action";
  detail: string;
  requiredMetrics: string[];
  feed?: BacktestApiFeedModel;
};

type BacktestPendingUpload = {
  id: string;
  fileName: string;
  byteSize: number;
  rawText: string;
  rawPreviewText: string;
  targetId: string;
  targetLabel: string;
};

const BACKTEST_MONITOR_ID = "strategy-backtest-monitor";
const INLINE_DATA_BYTE_LIMIT = 750_000;
const MAX_DATASET_COUNT = 32;

type StoredMarketDatasetOption = {
  id: string;
  apiId: string;
  apiName: string;
  dataset: HistoricalDataDataset;
  isAttachedToStrategy: boolean;
};

type HistoricalBacktestWindow = {
  canRun: boolean;
  reason: string;
  start: number;
  end: number;
  strategyDatasetCount: number;
};

type BacktestTimelineItem = {
  id: string;
  label: string;
  detail: string;
  role: "market" | "strategy";
  dataset: HistoricalDataDataset;
  start: number;
  end: number;
};

type BacktestTimelineModel = {
  items: BacktestTimelineItem[];
  domainStart: number;
  domainEnd: number;
  overlapStart: number;
  overlapEnd: number;
  hasOverlap: boolean;
};

type BacktestSelectedRange = {
  start: number;
  end: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function readText(source: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getNodeData(node?: Node): Record<string, unknown> {
  return isRecord(node?.data) ? node.data : {};
}

function getNodeLabel(node?: Node, fallback = "Node") {
  const data = getNodeData(node);
  return readText(data, ["label", "title", "name", "functionName"], node?.id || fallback);
}

function getStrategyLabel(nodes: Node[]) {
  const strategyGroup = nodes.find((node) => {
    const data = getNodeData(node);
    return node.type === "groupNode" && data.styleType === "solid";
  });
  return getNodeLabel(strategyGroup, "Strategy");
}

function isSequenceGroup(node: Node) {
  if (node.type !== "groupNode") return false;
  const data = getNodeData(node);
  return data.styleType !== "solid";
}

function isDescendantOf(node: Node, groupId: string, nodesById: Map<string, Node>) {
  let parentId = node.parentId;
  while (parentId) {
    if (parentId === groupId) return true;
    parentId = nodesById.get(parentId)?.parentId;
  }
  return false;
}

function isTriggerNode(node: Node) {
  return node.type === "timeTrigger" || node.type === "clickTrigger";
}

function triggerLooksLikeClick(node: Node) {
  const data = getNodeData(node);
  return node.type === "clickTrigger" ||
    data.triggerMode === "CLICK" ||
    (data.triggerMode !== "TIME" && ("shortcut" in data || "isRecording" in data));
}

function normalizeVisualizationFormat(block: Record<string, unknown>) {
  const value = String(block.visualizationFormat ?? block.visualFormat ?? block.visualType ?? block.chartType ?? "chart").toLowerCase();
  if (value === "log" || value === "logs") return "log";
  if (value === "ladder" || value === "orderbook" || value === "order-book") return "ladder";
  return "chart";
}

function isIndicatorCondition(value: unknown): value is IndicatorCondition {
  if (!isRecord(value)) return false;
  return [">", ">=", "<", "<="].includes(String(value.operator)) &&
    Number.isFinite(Number(value.threshold));
}

function normalizeMetricSeries(value: unknown): MetricPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point): MetricPoint | null => {
      if (!isRecord(point)) return null;
      const time = Number(point.time);
      const metricValue = Number(point.value);
      const volume = Number(point.volume);
      if (!Number.isFinite(time) || !Number.isFinite(metricValue)) return null;
      return {
        time: time as MetricPoint["time"],
        value: metricValue,
        ...(Number.isFinite(volume) ? { volume } : {}),
      };
    })
    .filter((point): point is MetricPoint => Boolean(point));
}

function getConditionControls(block: Record<string, unknown>) {
  const controls = Array.isArray(block.conditionControls) ? block.conditionControls : [];
  return controls
    .map((control) => isRecord(control) ? control.condition : null)
    .filter(isIndicatorCondition);
}

function getIndicatorChartModels(node: Node): MonitorChartModel[] {
  const data = getNodeData(node) as FunctionNodeData;
  const nodeLabel = getNodeLabel(node, "Indicator");
  const outputBlocks = Array.isArray(data.outputBlocks) ? data.outputBlocks as BlockData[] : [];
  const chartBlocks = outputBlocks
    .filter((block) => normalizeVisualizationFormat(block) === "chart")
    .slice(0, 4);
  const fallbackBlock = chartBlocks.length === 0
    ? [{ id: "chart", name: nodeLabel, type: "output" as const }]
    : [];

  return [...chartBlocks, ...fallbackBlock].map((block, index) => {
    const blockRecord = block as BlockData & Record<string, unknown>;
    const blockSeries = normalizeMetricSeries(blockRecord.chartSeries);
    const nodeSeries = normalizeMetricSeries(data.chartSeries);
    const series = blockSeries.length > 0
      ? blockSeries
      : nodeSeries.length > 0
        ? nodeSeries
        : buildMetricSeries(`sequence-monitor:${node.id}:${block.id}`, 84, 96 + index * 8);
    const conditionControls = getConditionControls(blockRecord);
    const blockCondition = isIndicatorCondition(blockRecord.condition) ? blockRecord.condition : null;
    const nodeCondition = isIndicatorCondition(data.condition) ? data.condition : null;
    const conditions = conditionControls.length > 0
      ? conditionControls
      : blockCondition
        ? [blockCondition]
        : nodeCondition
          ? [nodeCondition]
          : [];
    const outputKind = `${blockRecord.outputKind ?? ""} ${block.name ?? ""}`.toLowerCase();

    return {
      id: `${node.id}:${block.id}`,
      nodeId: node.id,
      nodeLabel,
      label: block.name || nodeLabel,
      kind: "indicator" as const,
      series,
      condition: conditions[0],
      conditions,
      comparisonValues: normalizeChartComparisonValues(blockRecord.chartComparisonValues ?? data.chartComparisonValues),
      source: readText(blockRecord, ["chartSource"], readText(data, ["chartSource"], "")),
      updatedAt: readText(blockRecord, ["chartUpdatedAt"], readText(data, ["chartUpdatedAt"], "")),
      booleanMode: outputKind.includes("boolean") || outputKind.includes("trigger"),
    };
  });
}

function getStreamingChartModels(node: Node): MonitorChartModel[] {
  const data = getNodeData(node) as StreamingNodeData;
  const nodeLabel = getNodeLabel(node, "Stream");
  const outputBlocks = Array.isArray(data.outputBlocks) ? data.outputBlocks as BlockData[] : [];
  const chartBlocks = outputBlocks
    .filter((block) => normalizeVisualizationFormat(block) === "chart")
    .slice(0, 4);
  const nodeSeries = normalizeMetricSeries(data.chartSeries);
  const fallbackBlock = chartBlocks.length === 0 && nodeSeries.length > 0
    ? [{ id: "stream", name: nodeLabel, type: "output" as const }]
    : [];

  return [...chartBlocks, ...fallbackBlock].map((block, index) => {
    const blockRecord = block as BlockData & Record<string, unknown>;
    const blockSeries = normalizeMetricSeries(blockRecord.chartSeries);
    const series = blockSeries.length > 0
      ? blockSeries
      : nodeSeries.length > 0
        ? nodeSeries
        : buildMetricSeries(`sequence-monitor-stream:${node.id}:${block.id}`, 84, 80 + index * 7);
    const source = readText(
      blockRecord,
      ["chartSource"],
      readText(data, ["chartSource", "apiReference", "url", "wsUrl"], "stream"),
    );

    return {
      id: `${node.id}:${block.id}`,
      nodeId: node.id,
      nodeLabel,
      label: block.name || nodeLabel,
      kind: "stream" as const,
      series,
      condition: undefined,
      conditions: [],
      comparisonValues: normalizeChartComparisonValues(blockRecord.chartComparisonValues ?? data.chartComparisonValues),
      source,
      updatedAt: readText(blockRecord, ["chartUpdatedAt"], readText(data, ["chartUpdatedAt"], "")),
      booleanMode: false,
    };
  });
}

function formatEventTime(timestamp: unknown) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(numeric));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

function formatDateRangeValue(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  }).format(new Date(value));
}

function formatCoverage(count: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.min(Math.round((count / total) * 100), 100)}%`;
}

function formatSignedNumber(value: number) {
  const formatted = Math.abs(value).toFixed(2);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number) {
  const formatted = formatPercent(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatRatio(value: number) {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function formatDurationHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0h";
  if (value < 24) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

function getBacktestRequiredMetrics(node: Node) {
  const data = getNodeData(node) as Partial<StreamingNodeData>;
  const outputBlocks = Array.isArray(data.outputBlocks) ? data.outputBlocks as BlockData[] : [];
  const metrics = outputBlocks
    .map((block) => block.name || block.id)
    .filter((metric): metric is string => typeof metric === "string" && metric.trim().length > 0);
  return Array.from(new Set(metrics.length > 0 ? metrics : ["value"]));
}

function buildBacktestApiFeed(node: Node): BacktestApiFeedModel {
  const data = getNodeData(node);
  const label = getNodeLabel(node, "Stream");
  const requiredMetrics = getBacktestRequiredMetrics(node);
  const sourceUrl = readText(data, ["url", "sourceUrl", "wsUrl"], "");
  const apiReference = readText(data, ["apiReference"], readText(data, ["responseSchema"], "stream output schema"));

  return {
    id: `feed:${node.id}`,
    nodeId: node.id,
    label,
    apiReference,
    sourceUrl,
    requiredMetrics,
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function createRawPreviewText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "Empty file";
  return trimmed.split(/\r?\n/).slice(0, 12).join("\n").slice(0, 4000);
}

function buildHistoricalNormalizedPreviewRows(normalized: BacktestNormalizationResult) {
  return normalized.previewRows.slice(0, 8).map((row) => ({
    date: formatDateRangeValue(row.isoDate),
    symbol: row.symbol,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    ...Object.fromEntries(
      Object.entries(row.metrics)
        .filter(([key]) => !["date", "datetime", "time", "timestamp", "symbol", "open", "high", "low", "close", "volume"].includes(key))
        .slice(0, 6),
    ),
  }));
}

function toHistoricalDatasetFromBacktestUpload(
  upload: BacktestPendingUpload,
  normalized: BacktestNormalizationResult,
): HistoricalDataDataset {
  const now = Date.now();
  const storageMode = normalized.errors.length === 0 && upload.byteSize <= INLINE_DATA_BYTE_LIMIT ? "inline" : "metadata";
  return {
    id: createId("historical-data"),
    fileName: normalized.fileName,
    format: normalized.format,
    byteSize: upload.byteSize,
    sourceFiles: [{
      fileName: upload.fileName,
      byteSize: upload.byteSize,
      rowCount: normalized.rowCount,
      format: normalized.format,
    }],
    rowCount: normalized.rowCount,
    droppedRows: normalized.droppedRows,
    duplicateRows: normalized.duplicateRows,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    symbols: normalized.symbols,
    intervalLabel: normalized.intervalLabel,
    detectedMetrics: normalized.detectedMetrics,
    warnings: normalized.warnings,
    errors: normalized.errors,
    rawPreviewText: upload.rawPreviewText,
    normalizedPreviewRows: buildHistoricalNormalizedPreviewRows(normalized),
    missingDateCount: 0,
    missingDatesPreview: [],
    missingDateRanges: [],
    uploadedAt: now,
    updatedAt: now,
    storageMode,
    ...(storageMode === "inline" ? { rawText: upload.rawText } : {}),
  };
}

function buildBacktestUploadMappings(
  target: BacktestUploadTargetModel,
  datasetId: string,
  currentMappings: ApiHistoricalDataMapping[],
) {
  const now = Date.now();
  const targetNodeIds = new Set(target.nodeIds);
  const previousByApiId = new Map(currentMappings.map((mapping) => [mapping.apiId, mapping]));
  const nextMappings = target.nodeIds.map((nodeId) => {
    const previous = previousByApiId.get(nodeId);
    return {
      id: previous?.id ?? createId("api-data-map"),
      apiId: nodeId,
      apiName: target.label,
      datasetId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    } satisfies ApiHistoricalDataMapping;
  });
  return [
    ...nextMappings,
    ...currentMappings.filter((mapping) => !targetNodeIds.has(mapping.apiId)),
  ];
}

function getFeedCoverage(feed: BacktestApiFeedModel, dataset: BacktestNormalizationResult | null) {
  if (!dataset) return { matched: 0, total: feed.requiredMetrics.length, missing: feed.requiredMetrics };
  const missing = feed.requiredMetrics.filter((metric) => {
    const key = normalizeBacktestMetricName(metric);
    return !dataset.metricCoverage[key];
  });
  return {
    matched: feed.requiredMetrics.length - missing.length,
    total: feed.requiredMetrics.length,
    missing,
  };
}

function createEmptyHistoricalDataState(): PersistedHistoricalDataState {
  return {
    version: 1,
    savedAt: Date.now(),
    datasets: [],
    mappings: [],
  };
}

function isMarketApiMapping(apiId: string) {
  return apiId.startsWith("market-api:");
}

function getStoredMarketApiName(apiId: string, fallback: string) {
  const [, exchange, venue, symbol, interval] = apiId.split(":");
  if (exchange === "binance" && symbol && interval) {
    const venueLabel = venue === "usdm-futures" ? "USD-M Futures" : "Spot";
    return `Binance ${venueLabel} ${symbol} ${interval}`;
  }
  return fallback || "Market candles";
}

function datasetLooksLikeMarketCandles(dataset: HistoricalDataDataset) {
  const metrics = new Set(dataset.detectedMetrics.map(normalizeBacktestMetricName));
  const previewKeys = new Set(
    dataset.normalizedPreviewRows.flatMap((row) => Object.keys(row).map(normalizeBacktestMetricName)),
  );
  const hasMetric = (metric: string) => metrics.has(metric) || previewKeys.has(metric);
  return hasMetric("open") && hasMetric("high") && hasMetric("low") && hasMetric("close");
}

function historicalDatasetCoversMetrics(dataset: HistoricalDataDataset, metrics: string[]) {
  if (dataset.errors.length > 0) return false;
  const detectedMetrics = new Set(dataset.detectedMetrics.map(normalizeBacktestMetricName));
  const previewKeys = new Set(
    dataset.normalizedPreviewRows.flatMap((row) => Object.keys(row).map(normalizeBacktestMetricName)),
  );
  return metrics.every((metric) => {
    const key = normalizeBacktestMetricName(metric);
    return detectedMetrics.has(key) || previewKeys.has(key);
  });
}

function getDatasetTimestampRange(dataset: HistoricalDataDataset | null | undefined) {
  if (!dataset?.startDate || !dataset.endDate) return null;
  const start = Date.parse(dataset.startDate);
  const end = Date.parse(dataset.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

function formatBacktestDateTime(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function formatBacktestDateOnly(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatBacktestInputDateTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Date(timestamp).toISOString().slice(0, 16);
}

function parseBacktestInputDateTime(value: string) {
  if (!value) return Number.NaN;
  const normalized = value.length === 16 ? `${value}:00.000Z` : `${value}.000Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function clampTimelinePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

function clampTimestamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBacktestSelectedRange(
  range: BacktestSelectedRange,
  timeline: BacktestTimelineModel,
  editedField?: "start" | "end",
): BacktestSelectedRange {
  const min = timeline.overlapStart;
  const max = timeline.overlapEnd;
  const span = Math.max(max - min, 1);
  const minStep = Math.min(Math.max(Math.round(span / 500), 60_000), span);
  let start = clampTimestamp(range.start, min, max);
  let end = clampTimestamp(range.end, min, max);

  if (end <= start) {
    if (editedField === "start") {
      end = clampTimestamp(start + minStep, min, max);
      if (end <= start) start = clampTimestamp(end - minStep, min, max);
    } else {
      start = clampTimestamp(end - minStep, min, max);
      if (end <= start) end = clampTimestamp(start + minStep, min, max);
    }
  }

  return end > start ? { start, end } : { start: min, end: max };
}

function getTimelinePercent(timestamp: number, domainStart: number, domainEnd: number) {
  const span = Math.max(domainEnd - domainStart, 1);
  return clampTimelinePercent(((timestamp - domainStart) / span) * 100);
}

function buildBacktestTimelineModel(
  strategyDatasets: HistoricalDataDataset[],
  marketOption: StoredMarketDatasetOption | null,
): BacktestTimelineModel | null {
  const items: BacktestTimelineItem[] = [];
  const seenDatasetIds = new Set<string>();

  if (marketOption) {
    const range = getDatasetTimestampRange(marketOption.dataset);
    if (range) {
      seenDatasetIds.add(marketOption.dataset.id);
      items.push({
        id: `market:${marketOption.dataset.id}`,
        label: marketOption.apiName,
        detail: "Market candles",
        role: "market",
        dataset: marketOption.dataset,
        start: range.start,
        end: range.end,
      });
    }
  }

  strategyDatasets.forEach((dataset, index) => {
    if (seenDatasetIds.has(dataset.id)) return;
    const range = getDatasetTimestampRange(dataset);
    if (!range) return;
    seenDatasetIds.add(dataset.id);
    items.push({
      id: `strategy:${dataset.id}`,
      label: dataset.fileName,
      detail: `Strategy dataset ${index + 1}`,
      role: "strategy",
      dataset,
      start: range.start,
      end: range.end,
    });
  });

  if (items.length === 0) return null;

  const domainStart = Math.min(...items.map((item) => item.start));
  const domainEnd = Math.max(...items.map((item) => item.end));
  const overlapStart = Math.max(...items.map((item) => item.start));
  const overlapEnd = Math.min(...items.map((item) => item.end));

  return {
    items,
    domainStart,
    domainEnd: domainEnd > domainStart ? domainEnd : domainStart + 1,
    overlapStart,
    overlapEnd,
    hasOverlap: overlapEnd > overlapStart,
  };
}

function buildBacktestTimelineTicks(domainStart: number, domainEnd: number) {
  const tickCount = 5;
  const span = Math.max(domainEnd - domainStart, 1);
  return Array.from({ length: tickCount }, (_, index) => domainStart + (span * index) / (tickCount - 1));
}

function truncateChartLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(maxLength - 1, 1))}...`;
}

function BacktestTimelineChart({
  timeline,
  selectedRange,
}: {
  timeline: BacktestTimelineModel;
  selectedRange: BacktestSelectedRange | null;
}) {
  const chartWidth = 820;
  const axisLeft = 168;
  const axisRight = 24;
  const plotWidth = chartWidth - axisLeft - axisRight;
  const top = 42;
  const rowHeight = 44;
  const bottom = 40;
  const chartHeight = top + timeline.items.length * rowHeight + bottom;
  const ticks = buildBacktestTimelineTicks(timeline.domainStart, timeline.domainEnd);
  const xForTime = (timestamp: number) =>
    axisLeft + (plotWidth * getTimelinePercent(timestamp, timeline.domainStart, timeline.domainEnd)) / 100;
  const activeRange = selectedRange ?? (timeline.hasOverlap ? { start: timeline.overlapStart, end: timeline.overlapEnd } : null);
  const selectedX = activeRange ? xForTime(activeRange.start) : 0;
  const selectedWidth = activeRange ? Math.max(xForTime(activeRange.end) - selectedX, 2) : 0;
  const overlapX = timeline.hasOverlap ? xForTime(timeline.overlapStart) : 0;
  const overlapWidth = timeline.hasOverlap ? Math.max(xForTime(timeline.overlapEnd) - overlapX, 2) : 0;

  return (
    <div className="mt-3 overflow-hidden rounded border border-[#2b3139] bg-[#0b0e11]">
      <div className="flex items-center justify-between gap-3 border-b border-[#2b3139] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase text-[#848e9c]">Dataset Time Range Chart</div>
          <div className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[#b7bdc6]">
            {formatBacktestDateOnly(timeline.domainStart)} - {formatBacktestDateOnly(timeline.domainEnd)}
          </div>
        </div>
        <div className={cn(
          "shrink-0 rounded px-2 py-1 text-[10px] font-black",
          timeline.hasOverlap
            ? "bg-[#0ecb81]/15 text-[#0ecb81]"
            : "bg-[#f6465d]/15 text-[#ff808b]",
        )}>
          {timeline.hasOverlap ? "OVERLAP" : "NO OVERLAP"}
        </div>
      </div>

      <div className="overflow-x-auto px-2 py-3">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="h-auto min-w-[720px] w-full"
          role="img"
          aria-label="Backtest dataset time range chart"
        >
          <rect x="0" y="0" width={chartWidth} height={chartHeight} rx="8" fill="#0b0e11" />

          {ticks.map((tick) => {
            const x = xForTime(tick);
            return (
              <g key={tick}>
                <line x1={x} y1={top - 12} x2={x} y2={chartHeight - bottom + 8} stroke="#2b3139" strokeWidth="1" />
                <text x={x} y={top - 20} textAnchor="middle" fill="#848e9c" fontSize="10" fontFamily="monospace">
                  {formatBacktestDateOnly(tick)}
                </text>
              </g>
            );
          })}

          {activeRange ? (
            <g>
              <rect
                x={selectedX}
                y={top - 15}
                width={selectedWidth}
                height={timeline.items.length * rowHeight + 18}
                rx="6"
                fill="#0ecb81"
                opacity="0.16"
              />
              <line x1={selectedX} y1={top - 15} x2={selectedX} y2={chartHeight - bottom + 3} stroke="#0ecb81" strokeWidth="1.8" />
              <line
                x1={selectedX + selectedWidth}
                y1={top - 15}
                x2={selectedX + selectedWidth}
                y2={chartHeight - bottom + 3}
                stroke="#0ecb81"
                strokeWidth="1.8"
              />
            </g>
          ) : null}

          <line x1={axisLeft} y1={top - 4} x2={chartWidth - axisRight} y2={top - 4} stroke="#5e6673" strokeWidth="1" />

          {timeline.items.map((item, index) => {
            const y = top + index * rowHeight;
            const barX = xForTime(item.start);
            const barWidth = Math.max(xForTime(item.end) - barX, 3);
            const isMarket = item.role === "market";

            return (
              <g key={item.id}>
                <text x="12" y={y + 13} fill={isMarket ? "#fcd535" : "#eaecef"} fontSize="11" fontWeight="700">
                  {isMarket ? "Market" : "Feature"}
                </text>
                <text x="12" y={y + 29} fill="#848e9c" fontSize="10">
                  {truncateChartLabel(item.label, 24)}
                </text>
                <rect x={axisLeft} y={y + 12} width={plotWidth} height="10" rx="5" fill="#181a20" stroke="#2b3139" />
                {timeline.hasOverlap ? (
                  <rect x={overlapX} y={y + 12} width={overlapWidth} height="10" rx="5" fill="#0ecb81" opacity="0.07" />
                ) : null}
                {activeRange ? (
                  <rect x={selectedX} y={y + 12} width={selectedWidth} height="10" rx="5" fill="#0ecb81" opacity="0.18" />
                ) : null}
                <rect
                  x={barX}
                  y={y + 15}
                  width={barWidth}
                  height="4"
                  rx="2"
                  fill={isMarket ? "#f0b90b" : "#5e6673"}
                />
                <circle cx={barX} cy={y + 17} r="2.5" fill={isMarket ? "#fcd535" : "#b7bdc6"} />
                <circle cx={barX + barWidth} cy={y + 17} r="2.5" fill={isMarket ? "#fcd535" : "#b7bdc6"} />
                <text x={axisLeft} y={y + 38} fill="#848e9c" fontSize="9" fontFamily="monospace">
                  {formatBacktestDateOnly(item.start)}
                </text>
                <text x={chartWidth - axisRight} y={y + 38} textAnchor="end" fill="#848e9c" fontSize="9" fontFamily="monospace">
                  {formatBacktestDateOnly(item.end)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2b3139] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-black text-[#848e9c]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-5 rounded bg-[#f0b90b]" />
            Market
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-5 rounded bg-[#5e6673]" />
            Feature
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-5 rounded bg-[#0ecb81]/40" />
            Auto overlap
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-5 rounded bg-[#0ecb81]" />
            Test range
          </span>
        </div>
        <div className={cn(
          "rounded px-2 py-1 text-[10px] font-semibold",
          activeRange ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#ff808b]",
        )}>
          {activeRange
            ? `${formatBacktestDateTime(activeRange.start)} - ${formatBacktestDateTime(activeRange.end)}`
            : "No shared range"}
        </div>
      </div>
    </div>
  );
}

function MetricValueCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "positive" | "negative" | "danger" | "neutral";
}) {
  return (
    <div className="rounded bg-[#0b0e11] px-2 py-2">
      <div className="truncate text-[9px] font-black uppercase text-[#848e9c]">{label}</div>
      <div className={cn(
        "mt-1 truncate font-mono text-sm font-black",
        tone === "positive"
          ? "text-[#0ecb81]"
          : tone === "negative" || tone === "danger"
            ? "text-[#f6465d]"
            : "text-[#eaecef]",
      )}>
        {value}
      </div>
    </div>
  );
}

function BacktestPerformanceMetrics({ result }: { result: BacktestReplayResult }) {
  const signedTone = (value: number) => value > 0 ? "positive" : value < 0 ? "negative" : "neutral";

  return (
    <div className="mt-3 rounded border border-[#2b3139] bg-[#181a20]">
      <div className="flex items-center justify-between gap-3 border-b border-[#2b3139] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase text-[#fcd535]">Backtest Results</div>
          <div className="mt-0.5 text-[10px] font-semibold text-[#848e9c]">
            {result.tradeCount} trades · {result.signalCount} signals · {result.pendingSignals} pending
          </div>
        </div>
        <div className={cn(
          "shrink-0 rounded px-2 py-1 text-[10px] font-black",
          result.totalReturnPct > 0
            ? "bg-[#0ecb81]/15 text-[#0ecb81]"
            : result.totalReturnPct < 0
              ? "bg-[#f6465d]/15 text-[#ff808b]"
              : "bg-[#2b3139] text-[#b7bdc6]",
        )}>
          {formatSignedPercent(result.totalReturnPct)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 text-[10px] font-semibold text-[#848e9c] sm:grid-cols-3">
        <MetricValueCard label="PnL" value={formatSignedNumber(result.totalPnl)} tone={signedTone(result.totalPnl)} />
        <MetricValueCard label="Total Return" value={formatSignedPercent(result.totalReturnPct)} tone={signedTone(result.totalReturnPct)} />
        <MetricValueCard label="CAGR" value={formatSignedPercent(result.cagr)} tone={signedTone(result.cagr)} />
        <MetricValueCard label="MDD" value={result.maxDrawdownPct > 0 ? `-${formatPercent(result.maxDrawdownPct)}` : formatPercent(0)} tone={result.maxDrawdownPct > 0 ? "danger" : "neutral"} />
        <MetricValueCard label="Volatility" value={formatPercent(result.annualizedVolatilityPct)} />
        <MetricValueCard label="Sharpe" value={formatRatio(result.sharpeRatio)} tone={signedTone(result.sharpeRatio)} />
        <MetricValueCard label="Sortino" value={formatRatio(result.sortinoRatio)} tone={signedTone(result.sortinoRatio)} />
        <MetricValueCard label="Calmar" value={formatRatio(result.calmarRatio)} tone={signedTone(result.calmarRatio)} />
        <MetricValueCard label="Win Rate" value={formatPercent(result.winRate)} />
        <MetricValueCard label="Profit Factor" value={formatRatio(result.profitFactor)} tone={result.profitFactor > 1 ? "positive" : result.profitFactor > 0 && result.profitFactor < 1 ? "negative" : "neutral"} />
        <MetricValueCard label="Payoff" value={formatRatio(result.payoffRatio)} />
        <MetricValueCard label="Expectancy" value={formatSignedPercent(result.expectancyPct)} tone={signedTone(result.expectancyPct)} />
        <MetricValueCard label="Avg Trade" value={formatSignedPercent(result.averageReturnPct)} tone={signedTone(result.averageReturnPct)} />
        <MetricValueCard label="Avg Win" value={formatSignedPercent(result.averageWinPct)} tone="positive" />
        <MetricValueCard label="Avg Loss" value={formatSignedPercent(result.averageLossPct)} tone={result.averageLossPct < 0 ? "negative" : "neutral"} />
        <MetricValueCard label="Best Trade" value={formatSignedPercent(result.bestTradePct)} tone={signedTone(result.bestTradePct)} />
        <MetricValueCard label="Worst Trade" value={formatSignedPercent(result.worstTradePct)} tone={signedTone(result.worstTradePct)} />
        <MetricValueCard label="Exposure" value={formatPercent(result.exposurePct)} />
        <MetricValueCard label="Avg Hold" value={formatDurationHours(result.averageHoldingHours)} />
        <MetricValueCard label="Max Win Streak" value={result.maxConsecutiveWins} />
        <MetricValueCard label="Max Loss Streak" value={result.maxConsecutiveLosses} tone={result.maxConsecutiveLosses > 0 ? "danger" : "neutral"} />
      </div>
    </div>
  );
}

function getHistoricalBacktestWindow(
  strategyDatasets: HistoricalDataDataset[],
  marketDataset: HistoricalDataDataset | null | undefined,
): HistoricalBacktestWindow {
  if (!marketDataset) {
    return {
      canRun: false,
      reason: "Download market candles in Data > Market Historical, then select them here.",
      start: 0,
      end: 0,
      strategyDatasetCount: strategyDatasets.length,
    };
  }

  const marketRange = getDatasetTimestampRange(marketDataset);
  if (!marketRange) {
    return {
      canRun: false,
      reason: "Selected market candles do not have a valid start and end date.",
      start: 0,
      end: 0,
      strategyDatasetCount: strategyDatasets.length,
    };
  }

  if (!marketDataset.rawText) {
    return {
      canRun: false,
      reason: "Selected market candles are stored as metadata only. Download a smaller range or upload the CSV here.",
      start: marketRange.start,
      end: marketRange.end,
      strategyDatasetCount: strategyDatasets.length,
    };
  }

  const strategyRanges = strategyDatasets
    .filter((dataset) => dataset.id !== marketDataset.id)
    .map(getDatasetTimestampRange)
    .filter((range): range is { start: number; end: number } => Boolean(range));
  const ranges = [marketRange, ...strategyRanges];
  const start = Math.max(...ranges.map((range) => range.start));
  const end = Math.min(...ranges.map((range) => range.end));

  if (end <= start) {
    return {
      canRun: false,
      reason: "The selected market candles and this strategy's attached datasets do not overlap in time.",
      start,
      end,
      strategyDatasetCount: strategyDatasets.length,
    };
  }

  return {
    canRun: true,
    reason: "",
    start,
    end,
    strategyDatasetCount: strategyDatasets.length,
  };
}

function describeAction(node: Node) {
  const data = getNodeData(node) as Partial<ActionNodeData> & Record<string, unknown>;
  const label = getNodeLabel(node, "Action");
  if (data.actionType === "CEX") {
    const side = readText(data, ["side"], "ORDER");
    const amount = readText(data, ["amount", "size"], "market size");
    const symbol = readText(data, ["symbol", "polymarketMarketTitle"], "market");
    const exchange = readText(data, ["exchange"], "CEX");
    const orderType = readText(data, ["orderType", "polymarketOrderType"], "MARKET");
    return `${label}: ${side} ${amount} ${symbol} on ${exchange} (${orderType})`;
  }

  const functionName = readText(data, ["functionName", "evmFunctionName", "evmFunctionSignature"], "contract call");
  const chainId = readText(data, ["chainId"], "chain");
  const contractAddress = readText(data, ["contractAddress"], "");
  return `${label}: ${functionName} on ${chainId}${contractAddress ? ` · ${contractAddress}` : ""}`;
}

function getActionUploadGroupKey(node: Node) {
  const data = getNodeData(node);
  const exchange = readText(data, ["exchange", "exchangeId", "venue", "connectionId"], "");
  const symbol = readText(data, ["symbol", "market", "marketSymbol", "polymarketMarketTitle", "asset", "pair"], "");
  const chainId = readText(data, ["chainId", "network"], "");
  const contractAddress = readText(data, ["contractAddress", "marketAddress"], "");

  if (exchange && symbol) {
    return `action-group:exchange:${exchange.toLowerCase()}:market:${symbol.toLowerCase()}`;
  }
  if (chainId && contractAddress) {
    return `action-group:chain:${chainId.toLowerCase()}:contract:${contractAddress.toLowerCase()}`;
  }
  return `action:${node.id}`;
}

function getActionUploadGroupLabel(nodes: Node[]) {
  if (nodes.length === 0) return "Action data";
  const data = getNodeData(nodes[0]);
  const exchange = readText(data, ["exchange", "exchangeId", "venue", "connectionId"], "");
  const symbol = readText(data, ["symbol", "market", "marketSymbol", "polymarketMarketTitle", "asset", "pair"], "");
  const chainId = readText(data, ["chainId", "network"], "");
  const contractAddress = readText(data, ["contractAddress", "marketAddress"], "");
  if (exchange && symbol) return `${exchange} ${symbol} Actions`;
  if (chainId && contractAddress) return `${chainId} ${contractAddress.slice(0, 8)} Actions`;
  return getNodeLabel(nodes[0], "Action");
}

function getReachableActionIds(
  triggerId: string,
  nodes: Node[],
  edges: Edge[],
  allowedNodeIds: Set<string>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const actionIds: string[] = [];
  const visited = new Set<string>([triggerId]);
  const queue = [triggerId];

  while (queue.length > 0) {
    const sourceId = queue.shift();
    if (!sourceId) continue;

    edges
      .filter((edge) => edge.source === sourceId)
      .forEach((edge) => {
        if (visited.has(edge.target)) return;
        const targetNode = nodeById.get(edge.target);
        if (!targetNode) return;
        const staysInSequence = allowedNodeIds.size === 0 || allowedNodeIds.has(edge.target);
        if (!staysInSequence && targetNode.type !== "actionNode") return;

        visited.add(edge.target);
        if (targetNode.type === "actionNode") {
          actionIds.push(targetNode.id);
          return;
        }

        queue.push(edge.target);
      });
  }

  return actionIds;
}

function buildSequences(nodes: Node[]): SequenceMonitorModel[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const groups = nodes.filter(isSequenceGroup);
  const nonGroupNodes = nodes.filter((node) => node.type !== "groupNode");

  if (groups.length === 0) {
    const nodeIds = new Set(nonGroupNodes.map((node) => node.id));
    return [{
      id: "canvas-monitor",
      label: "Canvas Monitor",
      purpose: "Monitor every strategy node on the canvas.",
      nodeIds,
      triggerNodes: nonGroupNodes.filter(isTriggerNode),
      actionNodes: nonGroupNodes.filter((node) => node.type === "actionNode"),
      indicatorNodes: nonGroupNodes.filter((node) => node.type === "functionNode"),
      streamingNodes: nonGroupNodes.filter((node) => node.type === "streamingNode"),
    }];
  }

  return groups.map((group) => {
    const data = getNodeData(group);
    const members = nonGroupNodes.filter((node) => isDescendantOf(node, group.id, nodesById));
    const nodeIds = new Set(members.map((node) => node.id));
    return {
      id: group.id,
      label: getNodeLabel(group, "Sequence"),
      purpose: readText(data, ["purpose", "description"], ""),
      nodeIds,
      triggerNodes: members.filter(isTriggerNode),
      actionNodes: members.filter((node) => node.type === "actionNode"),
      indicatorNodes: members.filter((node) => node.type === "functionNode"),
      streamingNodes: members.filter((node) => node.type === "streamingNode"),
    };
  });
}

export function SequenceMonitorPanel({
  nodes,
  edges,
  setNodes,
  isOpen,
  onOpenChange,
}: SequenceMonitorPanelProps) {
  const logs = useSyncExternalStore(
    sequenceLogStore.subscribe.bind(sequenceLogStore),
    sequenceLogStore.getSnapshot.bind(sequenceLogStore),
    sequenceLogStore.getSnapshot.bind(sequenceLogStore),
  );
  const processedTriggerPulseRef = useRef<Set<string>>(new Set());
  const hasSeededInitialPulsesRef = useRef(false);
  const backtestFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingBacktestUploadTargetIdRef = useRef("");
  const [activeSequenceId, setActiveSequenceId] = useState(BACKTEST_MONITOR_ID);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dryRunStatus, setDryRunStatus] = useState<DryRunStatus | null>(null);
  const [pendingBacktestUpload, setPendingBacktestUpload] = useState<BacktestPendingUpload | null>(null);
  const [isBacktestNormalizing, setIsBacktestNormalizing] = useState(false);
  const [backtestDataset, setBacktestDataset] = useState<BacktestNormalizationResult | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestReplayResult | null>(null);
  const [backtestError, setBacktestError] = useState("");
  const [backtestRunAt, setBacktestRunAt] = useState<number | null>(null);
  const [backtestConnections, setBacktestConnections] = useState<Record<string, BacktestDataConnection>>({});
  const [isBacktestUploadPickerOpen, setIsBacktestUploadPickerOpen] = useState(false);
  const [selectedBacktestUploadTargetId, setSelectedBacktestUploadTargetId] = useState("");
  const [selectedBacktestRange, setSelectedBacktestRange] = useState<BacktestSelectedRange | null>(null);
  const [historicalDataState, setHistoricalDataState] = useState<PersistedHistoricalDataState>(() =>
    readHistoricalDataState() ?? createEmptyHistoricalDataState(),
  );
  const [selectedSavedMarketDatasetId, setSelectedSavedMarketDatasetId] = useState("");
  const persistHistoricalDataState = useCallback((buildNext: (current: PersistedHistoricalDataState) => PersistedHistoricalDataState) => {
    setHistoricalDataState((currentState) => {
      const current = readHistoricalDataState() ?? currentState ?? createEmptyHistoricalDataState();
      const next = buildNext(current);
      writeHistoricalDataState(next);
      return next;
    });
  }, []);
  const strategyLabel = useMemo(() => getStrategyLabel(nodes), [nodes]);
  const sequences = useMemo(() => buildSequences(nodes), [nodes]);
  const isBacktestMonitorActive = activeSequenceId === BACKTEST_MONITOR_ID;
  const backtestMonitor = useMemo<SequenceMonitorModel>(() => {
    const nonGroupNodes = nodes.filter((node) => node.type !== "groupNode");
    return {
      id: BACKTEST_MONITOR_ID,
      label: "Backtest",
      purpose: "Replay this strategy against saved market candles.",
      nodeIds: new Set(nonGroupNodes.map((node) => node.id)),
      triggerNodes: [],
      actionNodes: nonGroupNodes.filter((node) => node.type === "actionNode"),
      indicatorNodes: nonGroupNodes.filter((node) => node.type === "functionNode"),
      streamingNodes: nonGroupNodes.filter((node) => node.type === "streamingNode"),
    };
  }, [nodes]);
  const activeSequence = useMemo(
    () => isBacktestMonitorActive
      ? backtestMonitor
      : sequences.find((sequence) => sequence.id === activeSequenceId) ?? sequences[0],
    [activeSequenceId, backtestMonitor, isBacktestMonitorActive, sequences],
  );
  const activeLogs = useMemo(() => {
    if (!activeSequence) return [];
    return logs.filter((entry) =>
      entry.sequenceId
        ? entry.sequenceId === activeSequence.id
        : entry.sequenceLabel === activeSequence.label,
    );
  }, [activeSequence, logs]);
  const monitorCharts = useMemo(
    () => [
      ...(activeSequence?.streamingNodes.flatMap(getStreamingChartModels) ?? []),
      ...(activeSequence?.indicatorNodes.flatMap(getIndicatorChartModels) ?? []),
    ],
    [activeSequence],
  );
  const activeBacktestFeeds = useMemo(
    () => activeSequence?.streamingNodes.map(buildBacktestApiFeed) ?? [],
    [activeSequence],
  );
  const backtestUploadTargets = useMemo<BacktestUploadTargetModel[]>(() => {
    const streamTargets = activeBacktestFeeds.map((feed): BacktestUploadTargetModel => ({
      id: `stream:${feed.nodeId}`,
      nodeId: feed.nodeId,
      nodeIds: [feed.nodeId],
      label: feed.label,
      kind: "stream",
      detail: feed.apiReference || feed.sourceUrl || "Streaming/API block",
      requiredMetrics: feed.requiredMetrics,
      feed,
    }));
    const actionGroups = (activeSequence?.actionNodes ?? []).reduce<Map<string, Node[]>>((groups, node) => {
      const key = getActionUploadGroupKey(node);
      const group = groups.get(key) ?? [];
      group.push(node);
      groups.set(key, group);
      return groups;
    }, new Map());
    const actionTargets = Array.from(actionGroups.entries()).map(([key, groupNodes]): BacktestUploadTargetModel => ({
      id: key,
      nodeId: groupNodes[0].id,
      nodeIds: groupNodes.map((node) => node.id),
      label: getActionUploadGroupLabel(groupNodes),
      kind: "action",
      detail: groupNodes.length > 1
        ? `${groupNodes.length} action blocks share this exchange/market data.`
        : describeAction(groupNodes[0]),
      requiredMetrics: ["timestamp", "symbol", "side", "price", "quantity", "fee"],
    }));
    return [...streamTargets, ...actionTargets];
  }, [activeBacktestFeeds, activeSequence]);
  const selectedBacktestUploadTarget = backtestUploadTargets.find((target) =>
    target.id === selectedBacktestUploadTargetId,
  ) ?? backtestUploadTargets[0] ?? null;
  const historicalDatasetsById = useMemo(
    () => new Map(historicalDataState.datasets.map((dataset) => [dataset.id, dataset])),
    [historicalDataState.datasets],
  );
  const historicalDatasetMappingByNodeId = useMemo(() => {
    const mappedDatasets = new Map<string, { dataset: HistoricalDataDataset; connectedAt: number }>();
    historicalDataState.mappings.forEach((mapping) => {
      const dataset = historicalDatasetsById.get(mapping.datasetId);
      if (!dataset) return;
      mappedDatasets.set(mapping.apiId, { dataset, connectedAt: mapping.updatedAt || dataset.updatedAt });
    });
    nodes.forEach((node) => {
      if (node.type === "groupNode" || mappedDatasets.has(node.id)) return;
      const datasetId = readText(getNodeData(node), ["historicalDatasetId"], "");
      if (!datasetId) return;
      const dataset = historicalDatasetsById.get(datasetId);
      if (!dataset) return;
      mappedDatasets.set(node.id, { dataset, connectedAt: dataset.updatedAt || dataset.uploadedAt });
    });
    return mappedDatasets;
  }, [historicalDataState.mappings, historicalDatasetsById, nodes]);
  const autoBacktestConnections = useMemo(() => {
    const connections: Record<string, BacktestDataConnection> = {};
    backtestUploadTargets.forEach((target) => {
      const mappedDataset = target.nodeIds
        .map((nodeId) => historicalDatasetMappingByNodeId.get(nodeId))
        .find((item): item is { dataset: HistoricalDataDataset; connectedAt: number } => Boolean(item));
      if (!mappedDataset || mappedDataset.dataset.errors.length > 0) return;
      if (target.kind === "stream" && !historicalDatasetCoversMetrics(mappedDataset.dataset, target.requiredMetrics)) {
        return;
      }

      target.nodeIds.forEach((nodeId) => {
        connections[nodeId] = {
          nodeId,
          nodeLabel: target.label,
          fileName: mappedDataset.dataset.fileName,
          rowCount: mappedDataset.dataset.rowCount,
          connectedAt: mappedDataset.connectedAt,
          metrics: target.requiredMetrics,
          source: "data-panel",
        };
      });
    });
    return connections;
  }, [backtestUploadTargets, historicalDatasetMappingByNodeId]);
  const effectiveBacktestConnections = useMemo(
    () => ({ ...autoBacktestConnections, ...backtestConnections }),
    [autoBacktestConnections, backtestConnections],
  );
  const activeBacktestConnectionCount = useMemo(() => {
    const targetNodeIds = new Set(backtestUploadTargets.flatMap((target) => target.nodeIds));
    return Array.from(targetNodeIds).filter((nodeId) => effectiveBacktestConnections[nodeId]).length;
  }, [backtestUploadTargets, effectiveBacktestConnections]);
  const activeStrategyDatasets = useMemo(() => {
    const datasetIds = new Set<string>();
    const nodeIds = new Set<string>();
    nodes.forEach((node) => {
      if (node.type === "groupNode") return;
      nodeIds.add(node.id);
      const datasetId = readText(getNodeData(node), ["historicalDatasetId"], "");
      if (datasetId) datasetIds.add(datasetId);
    });
    historicalDataState.mappings.forEach((mapping) => {
      if (nodeIds.has(mapping.apiId)) datasetIds.add(mapping.datasetId);
    });
    return Array.from(datasetIds)
      .map((datasetId) => historicalDatasetsById.get(datasetId))
      .filter((dataset): dataset is HistoricalDataDataset => Boolean(dataset));
  }, [historicalDataState.mappings, historicalDatasetsById, nodes]);
  const activeStrategyDatasetIds = useMemo(
    () => new Set(activeStrategyDatasets.map((dataset) => dataset.id)),
    [activeStrategyDatasets],
  );
  const savedMarketDatasetOptions = useMemo(() => {
    const optionsByDatasetId = new Map<string, StoredMarketDatasetOption>();

    historicalDataState.mappings
      .filter((mapping) => isMarketApiMapping(mapping.apiId) && activeStrategyDatasetIds.has(mapping.datasetId))
      .forEach((mapping) => {
        const dataset = historicalDatasetsById.get(mapping.datasetId);
        if (!dataset) return;
        optionsByDatasetId.set(dataset.id, {
          id: `${mapping.apiId}:${dataset.id}`,
          apiId: mapping.apiId,
          apiName: getStoredMarketApiName(mapping.apiId, mapping.apiName),
          dataset,
          isAttachedToStrategy: true,
        });
      });

    activeStrategyDatasets
      .filter(datasetLooksLikeMarketCandles)
      .forEach((dataset) => {
        if (optionsByDatasetId.has(dataset.id)) return;
        optionsByDatasetId.set(dataset.id, {
          id: `used-market:${dataset.id}`,
          apiId: `used-market:${dataset.id}`,
          apiName: `Used Market Data: ${dataset.fileName}`,
          dataset,
          isAttachedToStrategy: true,
        });
      });

    return Array.from(optionsByDatasetId.values());
  }, [
    activeStrategyDatasetIds,
    activeStrategyDatasets,
    historicalDataState.mappings,
    historicalDatasetsById,
  ]);
  const selectedSavedMarketDatasetOption = savedMarketDatasetOptions.find((option) =>
    option.dataset.id === selectedSavedMarketDatasetId,
  ) ?? null;
  const historicalBacktestWindow = useMemo(
    () => getHistoricalBacktestWindow(activeStrategyDatasets, selectedSavedMarketDatasetOption?.dataset ?? null),
    [activeStrategyDatasets, selectedSavedMarketDatasetOption],
  );
  const missingBacktestDataMessage = useMemo(() => {
    if (savedMarketDatasetOptions.length > 0) return "";
    if (activeStrategyDatasets.length === 0) {
      return "No historical data is connected to this strategy. Backtesting is unavailable until market candles and required datasets are added.";
    }
    return "No market candles are connected to this strategy. Backtesting cannot run without tradeable OHLCV market data.";
  }, [activeStrategyDatasets.length, savedMarketDatasetOptions.length]);
  const backtestTimeline = useMemo(
    () => buildBacktestTimelineModel(activeStrategyDatasets, selectedSavedMarketDatasetOption),
    [activeStrategyDatasets, selectedSavedMarketDatasetOption],
  );
  const effectiveBacktestRange = useMemo(() => {
    if (selectedBacktestRange) return selectedBacktestRange;
    if (historicalBacktestWindow.canRun) {
      return { start: historicalBacktestWindow.start, end: historicalBacktestWindow.end };
    }
    return null;
  }, [historicalBacktestWindow, selectedBacktestRange]);
  const selectedBacktestRangeStep = useMemo(() => {
    if (!backtestTimeline?.hasOverlap) return 60_000;
    return Math.max(Math.round((backtestTimeline.overlapEnd - backtestTimeline.overlapStart) / 500), 60_000);
  }, [backtestTimeline]);
  const uploadedBacktestHasMarketCandles = Boolean(
    backtestDataset &&
      backtestDataset.errors.length === 0 &&
      backtestDataset.rowCount > 0 &&
      backtestDataset.fieldCoverage.open > 0 &&
      backtestDataset.fieldCoverage.close > 0,
  );
  const uploadedBacktestCanRun = Boolean(uploadedBacktestHasMarketCandles && backtestDataset && backtestDataset.rows.length >= 4);
  const missingRequiredBacktestTargets = useMemo(
    () => backtestUploadTargets.filter((target) =>
      target.nodeIds.some((nodeId) => !effectiveBacktestConnections[nodeId]),
    ),
    [backtestUploadTargets, effectiveBacktestConnections],
  );
  const requiredBacktestDataReady = missingRequiredBacktestTargets.length === 0;
  const missingRequiredBacktestDataMessage = useMemo(() => {
    if (requiredBacktestDataReady) return "";
    const labels = missingRequiredBacktestTargets.slice(0, 3).map((target) => target.label);
    const remaining = missingRequiredBacktestTargets.length - labels.length;
    return `${missingRequiredBacktestTargets.length} required dataset${missingRequiredBacktestTargets.length === 1 ? "" : "s"} missing: ${labels.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}. Upload and AI-normalize them, or map them in the Data panel, before running the backtest.`;
  }, [missingRequiredBacktestTargets, requiredBacktestDataReady]);
  const uploadedBacktestStatusMessage = useMemo(() => {
    if (!backtestDataset) return "";
    if (backtestDataset.errors.length > 0) {
      return backtestDataset.errors[0] ?? "Uploaded dataset could not be normalized.";
    }
    if (backtestDataset.rowCount === 0) {
      return "Uploaded dataset has no usable rows. Backtesting is unavailable until valid market candles are added.";
    }
    if (!uploadedBacktestHasMarketCandles) {
      return `${backtestDataset.fileName} is connected as block data, but backtesting still needs market candles with timestamp, open, and close.`;
    }
    if (!uploadedBacktestCanRun) {
      return `${backtestDataset.fileName} has too few market candles for a replay backtest.`;
    }
    if (!requiredBacktestDataReady) {
      return `Market candles ready: ${backtestDataset.fileName} · ${formatCompactNumber(backtestDataset.rowCount)} rows · ${formatDateRangeValue(backtestDataset.startDate)}-${formatDateRangeValue(backtestDataset.endDate)}. Waiting for ${missingRequiredBacktestTargets.length} required dataset${missingRequiredBacktestTargets.length === 1 ? "" : "s"}.`;
    }
    return `Uploaded market candles ready: ${backtestDataset.fileName} · ${formatCompactNumber(backtestDataset.rowCount)} rows · ${formatDateRangeValue(backtestDataset.startDate)}-${formatDateRangeValue(backtestDataset.endDate)}. All required strategy datasets are linked.`;
  }, [
    backtestDataset,
    missingRequiredBacktestTargets.length,
    requiredBacktestDataReady,
    uploadedBacktestCanRun,
    uploadedBacktestHasMarketCandles,
  ]);
  const canRunSavedMarketBacktest = Boolean(
    selectedSavedMarketDatasetOption && historicalBacktestWindow.canRun && effectiveBacktestRange,
  );
  const canStartBacktest = !pendingBacktestUpload &&
    !isBacktestNormalizing &&
    requiredBacktestDataReady &&
    (canRunSavedMarketBacktest || uploadedBacktestCanRun);
  const backtestReadinessStatus = canStartBacktest
    ? "Ready"
    : pendingBacktestUpload
      ? "Normalize needed"
      : missingRequiredBacktestDataMessage
        ? "Missing datasets"
        : selectedSavedMarketDatasetOption || backtestDataset
          ? "Blocked"
          : "Missing data";
  const backtestReadinessMessage = canStartBacktest
    ? "All required market and strategy datasets are connected. Backtesting can run inside the shared historical window."
    : pendingBacktestUpload
      ? "A file is uploaded but not normalized yet. Open Data tools and ask AI to normalize it."
      : missingRequiredBacktestDataMessage || (selectedSavedMarketDatasetOption
        ? historicalBacktestWindow.reason || "Historical data is selected, but the shared test window is unavailable."
        : backtestDataset
          ? uploadedBacktestStatusMessage
          : missingBacktestDataMessage);
  const selectedMarketSummary = selectedSavedMarketDatasetOption
    ? `${selectedSavedMarketDatasetOption.apiName} · ${formatCompactNumber(selectedSavedMarketDatasetOption.dataset.rowCount)} rows · ${formatDateRangeValue(selectedSavedMarketDatasetOption.dataset.startDate)}-${formatDateRangeValue(selectedSavedMarketDatasetOption.dataset.endDate)}`
    : backtestDataset
      ? `${backtestDataset.fileName} · ${formatCompactNumber(backtestDataset.rowCount)} rows · ${formatDateRangeValue(backtestDataset.startDate)}-${formatDateRangeValue(backtestDataset.endDate)}`
      : "No market candles selected";
  const effectiveBacktestRangeLabel = effectiveBacktestRange
    ? `${formatBacktestDateTime(effectiveBacktestRange.start)} - ${formatBacktestDateTime(effectiveBacktestRange.end)}`
    : "No shared test range";
  const backtestResultLabel = backtestResult
    ? `${backtestResult.tradeCount} trades · ${formatSignedPercent(backtestResult.totalReturnPct)} return · ${formatPercent(backtestResult.maxDrawdownPct)} MDD`
    : "Run a backtest to populate performance metrics.";

  useEffect(() => {
    if (!activeSequenceId) {
      setActiveSequenceId(BACKTEST_MONITOR_ID);
      return;
    }
    if (activeSequenceId !== BACKTEST_MONITOR_ID && !sequences.some((sequence) => sequence.id === activeSequenceId)) {
      setActiveSequenceId(BACKTEST_MONITOR_ID);
    }
  }, [activeSequenceId, sequences]);

  useEffect(() => {
    if (!isOpen) setIsFullscreen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const refreshHistoricalDataState = () => {
      setHistoricalDataState(readHistoricalDataState() ?? createEmptyHistoricalDataState());
    };

    refreshHistoricalDataState();
    window.addEventListener("focus", refreshHistoricalDataState);
    const intervalId = window.setInterval(refreshHistoricalDataState, 2_000);
    return () => {
      window.removeEventListener("focus", refreshHistoricalDataState);
      window.clearInterval(intervalId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (backtestUploadTargets.length === 0) {
      setSelectedBacktestUploadTargetId("");
      return;
    }
    if (!selectedBacktestUploadTargetId || !backtestUploadTargets.some((target) => target.id === selectedBacktestUploadTargetId)) {
      setSelectedBacktestUploadTargetId(backtestUploadTargets[0].id);
    }
  }, [backtestUploadTargets, selectedBacktestUploadTargetId]);

  useEffect(() => {
    const selectedStillExists = savedMarketDatasetOptions.some((option) =>
      option.dataset.id === selectedSavedMarketDatasetId,
    );
    if (selectedStillExists) return;

    const preferredDatasetId = savedMarketDatasetOptions.find((option) => option.isAttachedToStrategy)?.dataset.id
      ?? savedMarketDatasetOptions[0]?.dataset.id
      ?? "";
    setSelectedSavedMarketDatasetId(preferredDatasetId);
  }, [savedMarketDatasetOptions, selectedSavedMarketDatasetId]);

  useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;
      const nextNodes = currentNodes.map((node) => {
        const data = getNodeData(node);
        const currentConnection = isRecord(data.backtestConnection)
          ? data.backtestConnection as Partial<BacktestDataConnection>
          : null;
        const autoConnection = autoBacktestConnections[node.id];

        if (autoConnection) {
          if (currentConnection?.source === "manual") return node;
          const matches = currentConnection?.source === "data-panel" &&
            currentConnection.fileName === autoConnection.fileName &&
            currentConnection.rowCount === autoConnection.rowCount &&
            currentConnection.connectedAt === autoConnection.connectedAt;
          if (matches) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              backtestConnection: autoConnection,
            },
          };
        }

        if (currentConnection?.source !== "data-panel") return node;
        const nextData = { ...node.data } as Record<string, unknown>;
        delete nextData.backtestConnection;
        changed = true;
        return { ...node, data: nextData };
      });
      return changed ? nextNodes : currentNodes;
    });
  }, [autoBacktestConnections, setNodes]);

  useEffect(() => {
    if (!backtestTimeline?.hasOverlap) {
      setSelectedBacktestRange(null);
      return;
    }

    setSelectedBacktestRange((current) => {
      if (!current) {
        return { start: backtestTimeline.overlapStart, end: backtestTimeline.overlapEnd };
      }
      const normalized = normalizeBacktestSelectedRange(current, backtestTimeline);
      if (normalized.start === current.start && normalized.end === current.end) return current;
      return normalized;
    });
  }, [backtestTimeline]);

  useEffect(() => {
    if (hasSeededInitialPulsesRef.current) return;
    nodes.filter(isTriggerNode).forEach((node) => {
      const timestamp = readNumber(getNodeData(node).lastTriggeredAt, 0);
      if (timestamp > 0) {
        processedTriggerPulseRef.current.add(`${node.id}:${timestamp}`);
      }
    });
    hasSeededInitialPulsesRef.current = true;
  }, [nodes]);

  const recordActionUse = useCallback((
    actionNode: Node,
    sequence: SequenceMonitorModel,
    timestamp: number,
    sourceLabel: string,
  ) => {
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: sequence.id,
      sequenceLabel: sequence.label,
      nodeId: actionNode.id,
      nodeLabel: getNodeLabel(actionNode, "Action"),
      stateLabel: "Trade",
      message: `${describeAction(actionNode)} · source: ${sourceLabel}`,
      level: "success",
      timestamp,
    });
  }, [strategyLabel]);

  const updateActionExecutionState = useCallback((actionIds: string[], timestamp: number) => {
    if (actionIds.length === 0) return;
    const actionIdSet = new Set(actionIds);
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!actionIdSet.has(node.id)) return node;
        const data = getNodeData(node);
        return {
          ...node,
          data: {
            ...node.data,
            executionCount: readNumber(data.executionCount, 0) + 1,
            lastExecutedAt: timestamp,
            lastExecutionStatus: "filled",
          },
        };
      }),
    );
  }, [setNodes]);

  const recordTriggerUse = useCallback((
    triggerNode: Node,
    sequence: SequenceMonitorModel,
    timestamp: number,
    sourceLabel = getNodeLabel(triggerNode, "Trigger"),
  ) => {
    const pulseKey = `${triggerNode.id}:${timestamp}`;
    processedTriggerPulseRef.current.add(pulseKey);
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: sequence.id,
      sequenceLabel: sequence.label,
      nodeId: triggerNode.id,
      nodeLabel: getNodeLabel(triggerNode, "Trigger"),
      stateLabel: "Trigger",
      message: `${sourceLabel} fired`,
      level: "info",
      timestamp,
    });

    const actionIds = getReachableActionIds(triggerNode.id, nodes, edges, sequence.nodeIds);
    const actionNodes = actionIds
      .map((actionId) => nodes.find((node) => node.id === actionId))
      .filter((node): node is Node => Boolean(node));
    actionNodes.forEach((actionNode, index) => {
      recordActionUse(actionNode, sequence, timestamp + index + 1, sourceLabel);
    });
    updateActionExecutionState(actionIds, timestamp);

    if (actionIds.length === 0) {
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: sequence.id,
        sequenceLabel: sequence.label,
        nodeId: triggerNode.id,
        nodeLabel: getNodeLabel(triggerNode, "Trigger"),
        stateLabel: "Monitor",
        message: "No connected action block was reached from this trigger.",
        level: "warning",
        timestamp: timestamp + 1,
      });
    }
  }, [edges, nodes, recordActionUse, strategyLabel, updateActionExecutionState]);

  useEffect(() => {
    nodes.filter(isTriggerNode).forEach((triggerNode) => {
      const timestamp = readNumber(getNodeData(triggerNode).lastTriggeredAt, 0);
      if (timestamp <= 0) return;
      const pulseKey = `${triggerNode.id}:${timestamp}`;
      if (processedTriggerPulseRef.current.has(pulseKey)) return;
      const sequence = sequences.find((item) => item.nodeIds.has(triggerNode.id)) ?? sequences[0];
      if (!sequence) return;
      recordTriggerUse(triggerNode, sequence, timestamp);
    });
  }, [nodes, recordTriggerUse, sequences]);

  const handleFireTrigger = useCallback((triggerNode: Node) => {
    if (!activeSequence) return;
    const timestamp = Date.now();
    const triggerLabel = getNodeLabel(triggerNode, "Trigger");
    processedTriggerPulseRef.current.add(`${triggerNode.id}:${timestamp}`);
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== triggerNode.id) return node;
        const data = getNodeData(node) as Partial<TimeTriggerData>;
        return {
          ...node,
          data: {
            ...node.data,
            triggerCount: readNumber(data.triggerCount, 0) + 1,
            lastTriggeredAt: timestamp,
          },
        };
      }),
    );
    recordTriggerUse(triggerNode, activeSequence, timestamp, triggerLabel);
  }, [activeSequence, recordTriggerUse, setNodes]);

  const handleToggleTimer = useCallback((triggerNode: Node) => {
    if (!activeSequence) return;
    const data = getNodeData(triggerNode) as Partial<TimeTriggerData>;
    const nextActive = !data.isActive;
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === triggerNode.id
          ? { ...node, data: { ...node.data, isActive: nextActive } }
          : node,
      ),
    );
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: activeSequence.id,
      sequenceLabel: activeSequence.label,
      nodeId: triggerNode.id,
      nodeLabel: getNodeLabel(triggerNode, "Trigger"),
      stateLabel: "Timer",
      message: `${getNodeLabel(triggerNode, "Trigger")} ${nextActive ? "activated" : "paused"}`,
      level: nextActive ? "success" : "info",
    });
  }, [activeSequence, setNodes, strategyLabel]);

  const applyBacktestConnectionToNode = useCallback((connection: BacktestDataConnection | null, nodeId: string) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId) return node;
        const nextData = { ...node.data } as Record<string, unknown>;
        if (connection) {
          nextData.backtestConnection = connection;
        } else {
          delete nextData.backtestConnection;
        }
        return { ...node, data: nextData };
      }),
    );
  }, [setNodes]);

  const connectBacktestFeed = useCallback((feed: BacktestApiFeedModel, dataset: BacktestNormalizationResult | null) => {
    const timestamp = Date.now();
    if (!dataset) {
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence?.id,
        sequenceLabel: activeSequence?.label ?? "Monitor",
        nodeId: feed.nodeId,
        nodeLabel: feed.label,
        stateLabel: "Backtest Data",
        message: "No backtest dataset is loaded for this API block.",
        level: "warning",
        timestamp,
      });
      return false;
    }

    const coverage = getFeedCoverage(feed, dataset);
    if (coverage.missing.length > 0 || dataset.errors.length > 0) {
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence?.id,
        sequenceLabel: activeSequence?.label ?? "Monitor",
        nodeId: feed.nodeId,
        nodeLabel: feed.label,
        stateLabel: "Backtest Data",
        message: `Cannot connect ${feed.label}; missing ${coverage.missing.join(", ") || "valid data"}.`,
        level: "warning",
        timestamp,
      });
      return false;
    }

    const connection: BacktestDataConnection = {
      nodeId: feed.nodeId,
      nodeLabel: feed.label,
      fileName: dataset.fileName,
      rowCount: dataset.rowCount,
      connectedAt: timestamp,
      metrics: feed.requiredMetrics,
      source: "manual",
    };
    setBacktestConnections((currentConnections) => ({
      ...currentConnections,
      [feed.nodeId]: connection,
    }));
    applyBacktestConnectionToNode(connection, feed.nodeId);
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: activeSequence?.id,
      sequenceLabel: activeSequence?.label ?? "Monitor",
      nodeId: feed.nodeId,
      nodeLabel: feed.label,
      stateLabel: "Backtest Data",
      message: `${dataset.fileName} connected to ${feed.label}.`,
      level: "success",
      timestamp,
    });
    return true;
  }, [activeSequence, applyBacktestConnectionToNode, strategyLabel]);

  const connectBacktestUploadTarget = useCallback((target: BacktestUploadTargetModel, dataset: BacktestNormalizationResult | null) => {
    const timestamp = Date.now();
    if (!dataset || dataset.errors.length > 0) {
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence?.id,
        sequenceLabel: activeSequence?.label ?? "Monitor",
        nodeId: target.nodeId,
        nodeLabel: target.label,
        stateLabel: "Backtest Data",
        message: dataset?.errors[0] ?? `No usable dataset is loaded for ${target.label}.`,
        level: "warning",
        timestamp,
      });
      return false;
    }

    const nextConnections = Object.fromEntries(
      target.nodeIds.map((nodeId) => [nodeId, {
        nodeId,
        nodeLabel: target.label,
        fileName: dataset.fileName,
        rowCount: dataset.rowCount,
        connectedAt: timestamp,
        metrics: target.requiredMetrics,
        source: "manual",
      } satisfies BacktestDataConnection]),
    );
    setBacktestConnections((currentConnections) => ({
      ...currentConnections,
      ...nextConnections,
    }));
    target.nodeIds.forEach((nodeId) => {
      applyBacktestConnectionToNode(nextConnections[nodeId], nodeId);
    });
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: activeSequence?.id,
      sequenceLabel: activeSequence?.label ?? "Monitor",
      nodeId: target.nodeId,
      nodeLabel: target.label,
      stateLabel: "Backtest Data",
      message: `${dataset.fileName} connected to ${target.label}${target.nodeIds.length > 1 ? ` (${target.nodeIds.length} action blocks)` : ""}.`,
      level: "success",
      timestamp,
    });
    return true;
  }, [activeSequence, applyBacktestConnectionToNode, strategyLabel]);

  const handleRunDryRun = useCallback(() => {
    const dryRunNodes = nodes.filter((node) => node.type !== "groupNode");
    const dryRunNodeIds = new Set(dryRunNodes.map((node) => node.id));
    const triggerNodes = dryRunNodes.filter(isTriggerNode);
    const actionNodes = dryRunNodes.filter((node) => node.type === "actionNode");
    const logSequenceId = activeSequence?.id ?? BACKTEST_MONITOR_ID;
    const logSequenceLabel = activeSequence?.label ?? "Monitor";
    const timestamp = Date.now();
    const reachableActionIds = new Set<string>();
    let warningCount = 0;

    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: logSequenceId,
      sequenceLabel: logSequenceLabel,
      stateLabel: "Dry Run",
      message: `Started full strategy dry run with ${triggerNodes.length} triggers and ${actionNodes.length} action blocks.`,
      level: "info",
      timestamp,
    });

    if (triggerNodes.length > 0) {
      triggerNodes.forEach((triggerNode, index) => {
        const actionIds = getReachableActionIds(triggerNode.id, nodes, edges, dryRunNodeIds);
        actionIds.forEach((actionId) => reachableActionIds.add(actionId));
        if (actionIds.length === 0) warningCount += 1;
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: logSequenceId,
          sequenceLabel: logSequenceLabel,
          nodeId: triggerNode.id,
          nodeLabel: getNodeLabel(triggerNode, "Trigger"),
          stateLabel: "Dry Trigger",
          message: `${getNodeLabel(triggerNode, "Trigger")} reached ${actionIds.length} action blocks.`,
          level: actionIds.length > 0 ? "info" : "warning",
          timestamp: timestamp + index + 1,
        });
      });
    } else {
      actionNodes.forEach((actionNode) => reachableActionIds.add(actionNode.id));
    }

    const reachableActions = Array.from(reachableActionIds)
      .map((actionId) => nodes.find((node) => node.id === actionId))
      .filter((node): node is Node => Boolean(node));

    if (reachableActions.length === 0) {
      warningCount += 1;
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: logSequenceId,
        sequenceLabel: logSequenceLabel,
        stateLabel: "Dry Run",
        message: "No action block would be reached.",
        level: "warning",
        timestamp: timestamp + 10,
      });
    } else {
      reachableActions.forEach((actionNode, index) => {
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: logSequenceId,
          sequenceLabel: logSequenceLabel,
          nodeId: actionNode.id,
          nodeLabel: getNodeLabel(actionNode, "Action"),
          stateLabel: "Dry Action",
          message: `Would reach ${describeAction(actionNode)}`,
          level: "success",
          timestamp: timestamp + 10 + index,
        });
      });
    }

    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: logSequenceId,
      sequenceLabel: logSequenceLabel,
      stateLabel: "Dry Run",
      message: `Completed: ${reachableActions.length} simulated action blocks.`,
      level: warningCount > 0 ? "warning" : "success",
      timestamp: timestamp + 20,
    });

    setDryRunStatus({
      timestamp,
      checkedTriggers: triggerNodes.length,
      reachableActions: reachableActions.length,
      warnings: warningCount,
      status: warningCount > 0 ? "warning" : "passed",
    });

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!dryRunNodeIds.has(node.id)) return node;
        const data = getNodeData(node);
        return {
          ...node,
          data: {
            ...node.data,
            dryRunCount: readNumber(data.dryRunCount, 0) + 1,
            lastDryRunAt: timestamp,
            lastDryRunStatus: warningCount > 0 ? "warning" : "passed",
          },
        };
      }),
    );
  }, [activeSequence, edges, nodes, setNodes, strategyLabel]);

  const handleSavedMarketDatasetChange = useCallback((datasetId: string) => {
    setSelectedSavedMarketDatasetId(datasetId);
    setSelectedBacktestRange(null);
    setBacktestResult(null);
    setBacktestRunAt(null);
    setBacktestError("");
  }, []);

  const updateSelectedBacktestRange = useCallback((patch: Partial<BacktestSelectedRange>, editedField?: "start" | "end") => {
    if (!backtestTimeline?.hasOverlap) return;
    setSelectedBacktestRange((current) => {
      const base = current ?? { start: backtestTimeline.overlapStart, end: backtestTimeline.overlapEnd };
      return normalizeBacktestSelectedRange({ ...base, ...patch }, backtestTimeline, editedField);
    });
    setBacktestResult(null);
    setBacktestRunAt(null);
    setBacktestError("");
  }, [backtestTimeline]);

  const handleSelectedBacktestRangeInput = useCallback((field: "start" | "end", value: string) => {
    const timestamp = parseBacktestInputDateTime(value);
    if (!Number.isFinite(timestamp)) return;
    updateSelectedBacktestRange({ [field]: timestamp }, field);
  }, [updateSelectedBacktestRange]);

  const handleResetSelectedBacktestRange = useCallback(() => {
    if (!backtestTimeline?.hasOverlap) return;
    setSelectedBacktestRange({ start: backtestTimeline.overlapStart, end: backtestTimeline.overlapEnd });
    setBacktestResult(null);
    setBacktestRunAt(null);
    setBacktestError("");
  }, [backtestTimeline]);

  const handleOpenBacktestUploadTarget = useCallback((targetId: string) => {
    pendingBacktestUploadTargetIdRef.current = targetId;
    setSelectedBacktestUploadTargetId(targetId);
    window.setTimeout(() => backtestFileInputRef.current?.click(), 0);
  }, []);

  const handleBacktestFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setBacktestError("");
    setBacktestRunAt(null);
    setBacktestResult(null);
    const pendingTargetId = pendingBacktestUploadTargetIdRef.current;
    const uploadTarget = backtestUploadTargets.find((target) => target.id === pendingTargetId) ?? selectedBacktestUploadTarget;
    pendingBacktestUploadTargetIdRef.current = "";

    void file.text()
      .then((text) => {
        setPendingBacktestUpload({
          id: `backtest-upload-${Date.now().toString(36)}`,
          fileName: file.name,
          byteSize: file.size || new Blob([text]).size,
          rawText: text,
          rawPreviewText: createRawPreviewText(text),
          targetId: uploadTarget?.id ?? "",
          targetLabel: uploadTarget?.label ?? "Backtest data",
        });
        setIsBacktestUploadPickerOpen(true);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence?.id,
          sequenceLabel: activeSequence?.label ?? "Monitor",
          nodeId: uploadTarget?.nodeId,
          nodeLabel: uploadTarget?.label,
          stateLabel: "Backtest Data",
          message: `${file.name} uploaded${uploadTarget ? ` for ${uploadTarget.label}` : ""}. Review the raw sample, then ask AI to normalize it.`,
          level: "info",
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Upload failed.";
        setBacktestError(message);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence?.id,
          sequenceLabel: activeSequence?.label ?? "Monitor",
          stateLabel: "Backtest Data",
          message,
          level: "warning",
        });
	      });
  }, [
    activeSequence,
    backtestUploadTargets,
    selectedBacktestUploadTarget,
    strategyLabel,
  ]);

  const handleAiNormalizeBacktestUpload = useCallback(() => {
    if (!pendingBacktestUpload) {
      setBacktestError("Upload a dataset first, then ask AI to normalize it.");
      return;
    }

    setIsBacktestNormalizing(true);
    setBacktestError("");
    setBacktestResult(null);
    setBacktestRunAt(null);

    window.setTimeout(() => {
      try {
        const result = normalizeBacktestDataset(pendingBacktestUpload.fileName, pendingBacktestUpload.rawText);
        const uploadTarget = backtestUploadTargets.find((target) => target.id === pendingBacktestUpload.targetId) ?? null;
        setBacktestDataset(result);

        let persistedDataset: HistoricalDataDataset | null = null;
        if (result.errors.length === 0) {
          const datasetToPersist = toHistoricalDatasetFromBacktestUpload(pendingBacktestUpload, result);
          persistedDataset = datasetToPersist;
          persistHistoricalDataState((current) => {
            const datasets = [
              datasetToPersist,
              ...current.datasets.filter((dataset) => dataset.id !== datasetToPersist.id),
            ].slice(0, MAX_DATASET_COUNT);
            const mappings = uploadTarget
              ? buildBacktestUploadMappings(uploadTarget, datasetToPersist.id, current.mappings)
              : current.mappings;
            return {
              ...current,
              datasets,
              mappings,
              activeApiId: uploadTarget?.nodeId ?? current.activeApiId,
            };
          });
          if (datasetLooksLikeMarketCandles(persistedDataset)) {
            setSelectedSavedMarketDatasetId(persistedDataset.id);
          }
        }

        if (result.errors.length === 0 && uploadTarget) {
          if (uploadTarget.feed) {
            connectBacktestFeed(uploadTarget.feed, result);
          } else {
            connectBacktestUploadTarget(uploadTarget, result);
          }
        }

        setPendingBacktestUpload(null);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence?.id,
          sequenceLabel: activeSequence?.label ?? "Monitor",
          nodeId: uploadTarget?.nodeId,
          nodeLabel: uploadTarget?.label ?? pendingBacktestUpload.targetLabel,
          stateLabel: "AI Normalize",
          message: `AI normalized ${result.fileName}${uploadTarget ? ` for ${uploadTarget.label}` : ""}: ${formatCompactNumber(result.rowCount)} rows, ${result.droppedRows} dropped, ${result.intervalLabel}${persistedDataset ? ". Saved to Data panel." : ""}`,
          level: result.errors.length > 0 ? "warning" : "success",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI normalization failed.";
        setBacktestError(message);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence?.id,
          sequenceLabel: activeSequence?.label ?? "Monitor",
          stateLabel: "AI Normalize",
          message,
          level: "warning",
        });
      } finally {
        setIsBacktestNormalizing(false);
      }
    }, 350);
  }, [
    activeSequence,
    backtestUploadTargets,
    connectBacktestFeed,
    connectBacktestUploadTarget,
    pendingBacktestUpload,
    persistHistoricalDataState,
    strategyLabel,
  ]);

  const handleDeleteBacktestDataset = useCallback(() => {
    const deletedFileName = backtestDataset?.fileName ?? "backtest dataset";
    if (backtestDataset?.fileName) {
      setBacktestConnections((currentConnections) =>
        Object.fromEntries(
          Object.entries(currentConnections).filter(([, connection]) => connection.fileName !== backtestDataset.fileName),
        ),
      );
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const data = getNodeData(node);
          const currentConnection = isRecord(data.backtestConnection)
            ? data.backtestConnection as Partial<BacktestDataConnection>
            : null;
          if (currentConnection?.source !== "manual" || currentConnection.fileName !== backtestDataset.fileName) return node;
          const nextData = { ...node.data } as Record<string, unknown>;
          delete nextData.backtestConnection;
          return { ...node, data: nextData };
        }),
      );
    }
    setBacktestDataset(null);
    setBacktestResult(null);
    setBacktestRunAt(null);
    setBacktestError("");
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: activeSequence?.id,
      sequenceLabel: activeSequence?.label ?? "Monitor",
      stateLabel: "Backtest Data",
      message: `${deletedFileName} deleted from monitor.`,
      level: "info",
    });
  }, [activeSequence, backtestDataset, setNodes, strategyLabel]);

  const handleStageBacktest = useCallback(() => {
    if (!activeSequence) return;
    const timestamp = Date.now();
    const savedMarketDataset = selectedSavedMarketDatasetOption?.dataset ?? null;

    if (!requiredBacktestDataReady) {
      const message = missingRequiredBacktestDataMessage || "Required strategy datasets are not fully connected.";
      setBacktestError(message);
      setBacktestResult(null);
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence.id,
        sequenceLabel: activeSequence.label,
        stateLabel: "Backtest",
        message,
        level: "warning",
        timestamp,
      });
      return;
    }

    if (savedMarketDataset) {
      if (!historicalBacktestWindow.canRun || !savedMarketDataset.rawText || !effectiveBacktestRange) {
        const message = historicalBacktestWindow.reason || "Selected market candles are not ready for backtesting.";
        setBacktestError(message);
        setBacktestResult(null);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence.id,
          sequenceLabel: activeSequence.label,
          stateLabel: "Backtest",
          message,
          level: "warning",
          timestamp,
        });
        return;
      }

      const normalized = normalizeBacktestDataset(savedMarketDataset.fileName, savedMarketDataset.rawText);
      setBacktestDataset(normalized);
      if (normalized.errors.length > 0) {
        const message = normalized.errors[0] ?? "Selected market candles could not be normalized.";
        setBacktestError(message);
        setBacktestResult(null);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence.id,
          sequenceLabel: activeSequence.label,
          stateLabel: "Backtest",
          message,
          level: "warning",
          timestamp,
        });
        return;
      }

      const replayRows = normalized.rows.filter((row) =>
        row.timestamp >= effectiveBacktestRange.start && row.timestamp <= effectiveBacktestRange.end,
      );
      if (replayRows.length < 4) {
        const message = "Not enough market candles inside the available strategy backtest window.";
        setBacktestError(message);
        setBacktestResult(null);
        sequenceLogStore.addEntry({
          strategyLabel,
          sequenceId: activeSequence.id,
          sequenceLabel: activeSequence.label,
          stateLabel: "Backtest",
          message,
          level: "warning",
          timestamp,
        });
        return;
      }

      setBacktestError("");
      setBacktestRunAt(timestamp);
      const result = replayThreeDownCloseBacktest(replayRows);
      setBacktestResult(result);
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence.id,
        sequenceLabel: activeSequence.label,
        stateLabel: "Backtest",
        message: `Completed ${result.tradeCount} trades from ${formatCompactNumber(replayRows.length)} candles between ${formatBacktestDateTime(effectiveBacktestRange.start)} and ${formatBacktestDateTime(effectiveBacktestRange.end)}.`,
        level: result.tradeCount > 0 ? "success" : "warning",
        timestamp,
      });
      return;
    }

    if (!backtestDataset) {
      const message = missingBacktestDataMessage || "Select saved market candles for this strategy or upload CSV/JSON market data.";
      setBacktestError(message);
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence.id,
        sequenceLabel: activeSequence.label,
        stateLabel: "Backtest",
        message,
        level: "warning",
        timestamp,
      });
      return;
    }

    if (backtestDataset.errors.length > 0 || backtestDataset.rowCount === 0) {
      const message = backtestDataset.errors[0] ?? "Backtest data is not usable yet.";
      setBacktestError(message);
      setBacktestResult(null);
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence.id,
        sequenceLabel: activeSequence.label,
        stateLabel: "Backtest",
        message,
        level: "warning",
        timestamp,
      });
      return;
    }

    if (!uploadedBacktestHasMarketCandles) {
      const message = "Uploaded data is connected to the strategy, but replay backtesting requires market candles with timestamp, open, and close.";
      setBacktestError(message);
      setBacktestResult(null);
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence.id,
        sequenceLabel: activeSequence.label,
        stateLabel: "Backtest",
        message,
        level: "warning",
        timestamp,
      });
      return;
    }

    if (backtestDataset.rows.length < 4) {
      const message = "Not enough uploaded market candles for a replay backtest.";
      setBacktestError(message);
      setBacktestResult(null);
      sequenceLogStore.addEntry({
        strategyLabel,
        sequenceId: activeSequence.id,
        sequenceLabel: activeSequence.label,
        stateLabel: "Backtest",
        message,
        level: "warning",
        timestamp,
      });
      return;
    }

    setBacktestError("");
    setBacktestRunAt(timestamp);
    const result = replayThreeDownCloseBacktest(backtestDataset.rows);
    setBacktestResult(result);
    sequenceLogStore.addEntry({
      strategyLabel,
      sequenceId: activeSequence.id,
      sequenceLabel: activeSequence.label,
      stateLabel: "Backtest",
      message: `Completed ${result.tradeCount} trades from ${formatCompactNumber(backtestDataset.rowCount)} uploaded candles.`,
      level: result.tradeCount > 0 ? "success" : "warning",
      timestamp,
    });
  }, [
    activeSequence,
    backtestDataset,
    effectiveBacktestRange,
    historicalBacktestWindow,
    missingBacktestDataMessage,
    missingRequiredBacktestDataMessage,
    requiredBacktestDataReady,
    selectedSavedMarketDatasetOption,
    strategyLabel,
    uploadedBacktestHasMarketCandles,
  ]);

  if (!isOpen) return null;

  return (
    <aside
      className={cn(
        "sequence-monitor-panel flex flex-col overflow-x-hidden bg-white text-slate-950 shadow-none dark:bg-[#0f141b] dark:text-[#eaecef]",
        isFullscreen
          ? "sequence-monitor-panel--fullscreen fixed inset-0 z-[100] h-screen w-screen border-0"
          : "fixed inset-y-0 left-0 right-0 z-50 h-screen w-auto max-w-none border-l border-[#2b3139] lg:relative lg:inset-auto lg:left-auto lg:right-auto lg:z-auto lg:h-full lg:w-[420px] lg:max-w-[42vw] lg:shrink-0",
      )}
    >
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[#2b3139] px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black">
            <Activity className="h-4 w-4 text-[#f0b90b]" />
            <span>{isFullscreen ? "Sequence Monitor Fullscreen" : "Sequence Monitor"}</span>
          </div>
          <div className="truncate text-[11px] font-semibold text-[#848e9c]">{strategyLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunDryRun}
            className={cn(
              "hidden h-8 items-center justify-center gap-2 rounded border px-3 text-xs font-black sm:inline-flex",
              dryRunStatus?.status === "passed"
                ? "border-[#0ecb81]/50 text-[#0ecb81] hover:bg-[#0ecb81]/10"
                : dryRunStatus
                  ? "border-[#f0b90b]/50 text-[#fcd535] hover:bg-[#f0b90b]/10"
                  : "border-[#2b3139] text-[#eaecef] hover:border-[#f0b90b] hover:text-[#fcd535]",
            )}
            title={dryRunStatus
              ? `Full strategy dry run: ${dryRunStatus.status === "passed" ? "passed" : "warning"} · ${dryRunStatus.reachableActions} actions · ${formatEventTime(dryRunStatus.timestamp)}`
              : "Run full strategy dry run"}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dry Run</span>
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((current) => !current)}
            className="hidden h-8 w-8 items-center justify-center rounded border border-[#2b3139] text-[#b7bdc6] hover:border-[#f0b90b] hover:text-[#fcd535] sm:inline-flex"
            title={isFullscreen ? "Exit fullscreen monitor" : "Open monitor fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#2b3139] text-[#b7bdc6] hover:border-[#f0b90b] hover:text-[#fcd535]"
            title="Close sequence monitor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-[#2b3139] px-3 py-2">
        <div className="flex gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSequenceId(BACKTEST_MONITOR_ID)}
            className={cn(
              "h-8 shrink-0 rounded px-3 text-xs font-black transition-colors",
              isBacktestMonitorActive
                ? "bg-[#f0b90b] text-[#0b0e11]"
                : "bg-[#181a20] text-[#b7bdc6] hover:bg-[#2b3139] hover:text-[#fcd535]",
            )}
            title="Backtest monitor"
          >
            Backtest
          </button>
          {sequences.map((sequence) => (
            <button
              key={sequence.id}
              type="button"
              onClick={() => setActiveSequenceId(sequence.id)}
              className={cn(
                "h-8 shrink-0 rounded px-3 text-xs font-black transition-colors",
                activeSequence?.id === sequence.id
                  ? "bg-[#f0b90b] text-[#0b0e11]"
                  : "bg-[#181a20] text-[#b7bdc6] hover:bg-[#2b3139] hover:text-[#fcd535]",
              )}
              title={sequence.label}
            >
              {sequence.label}
            </button>
          ))}
        </div>
      </div>

      {activeSequence ? (
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", isFullscreen && "px-8 py-6")}>
          <div className={cn("mb-4", isFullscreen && "mx-auto max-w-[1800px]")}>
            <div className="text-lg font-black leading-tight">{activeSequence.label}</div>
            {activeSequence.purpose ? (
              <div className="mt-1 text-xs font-medium leading-5 text-[#848e9c]">{activeSequence.purpose}</div>
            ) : null}
            <div className={cn("mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3", isFullscreen && "max-w-[760px]")}>
              {isBacktestMonitorActive ? (
                <>
                  <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-2">
                    <div className="text-[9px] font-black uppercase text-[#848e9c]">Market Data</div>
                    <div className="font-mono text-sm font-black">{savedMarketDatasetOptions.length}</div>
                  </div>
                  <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-2">
                    <div className="text-[9px] font-black uppercase text-[#848e9c]">Strategy Data</div>
                    <div className="font-mono text-sm font-black">{activeStrategyDatasets.length}</div>
                  </div>
                  <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-2">
                    <div className="text-[9px] font-black uppercase text-[#848e9c]">Last</div>
                    <div className="truncate font-mono text-xs font-black">{formatEventTime(backtestRunAt)}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-2">
                    <div className="text-[9px] font-black uppercase text-[#848e9c]">Triggers</div>
                    <div className="font-mono text-sm font-black">{activeSequence.triggerNodes.length}</div>
                  </div>
                  <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-2">
                    <div className="text-[9px] font-black uppercase text-[#848e9c]">Actions</div>
                    <div className="font-mono text-sm font-black">{activeSequence.actionNodes.length}</div>
                  </div>
                  <div className="rounded border border-[#2b3139] bg-[#181a20] px-2 py-2">
                    <div className="text-[9px] font-black uppercase text-[#848e9c]">Charts</div>
                    <div className="font-mono text-sm font-black">{monitorCharts.length}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {isBacktestMonitorActive ? (
          <section className={cn("mb-5 space-y-3", isFullscreen && "mx-auto max-w-[1800px]")}>
            <input
              ref={backtestFileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={handleBacktestFileChange}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#fcd535]">
                <Database className="h-3.5 w-3.5" />
                Strategy Backtest
              </div>
              <button
                type="button"
                onClick={() => setIsBacktestUploadPickerOpen((current) => !current)}
                className={cn(
                  "inline-flex h-8 w-full items-center justify-center gap-2 rounded border px-3 text-xs font-black sm:w-auto",
                  isBacktestUploadPickerOpen
                    ? "border-[#f0b90b] text-[#fcd535]"
                    : "border-[#2b3139] text-[#eaecef] hover:border-[#f0b90b] hover:text-[#fcd535]",
                )}
              >
                <FileUp className="h-3.5 w-3.5" />
                Data tools
              </button>
            </div>

            <div className="rounded border border-[#2b3139] bg-[#181a20]">
              <div className="flex flex-col gap-3 border-b border-[#2b3139] px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#fcd535]">1 Data readiness</div>
                  <div className="mt-1 truncate text-xs font-semibold text-[#eaecef]">{selectedMarketSummary}</div>
                </div>
                <div className={cn(
                  "shrink-0 rounded px-2 py-1 text-[10px] font-black",
                  canStartBacktest
                    ? "bg-[#0ecb81]/15 text-[#0ecb81]"
                    : pendingBacktestUpload || missingRequiredBacktestDataMessage
                      ? "bg-[#f0b90b]/15 text-[#fcd535]"
                      : "bg-[#f6465d]/15 text-[#ff808b]",
                )}>
                  {backtestReadinessStatus}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 px-3 py-3 text-[10px] font-semibold text-[#848e9c] sm:grid-cols-3">
                <div className="rounded bg-[#0b0e11] px-2 py-2">
                  <div className="uppercase">Market</div>
                  <div className="mt-1 truncate font-mono text-sm font-black text-[#eaecef]">
                    {selectedSavedMarketDatasetOption || uploadedBacktestHasMarketCandles ? "1" : "0"}
                  </div>
                </div>
                <div className="rounded bg-[#0b0e11] px-2 py-2">
                  <div className="uppercase">Required</div>
                  <div className="mt-1 truncate font-mono text-sm font-black text-[#eaecef]">
                    {activeBacktestConnectionCount}/{backtestUploadTargets.length}
                  </div>
                </div>
                <div className="rounded bg-[#0b0e11] px-2 py-2">
                  <div className="uppercase">Strategy Data</div>
                  <div className="mt-1 truncate font-mono text-sm font-black text-[#eaecef]">
                    {activeStrategyDatasets.length}
                  </div>
                </div>
              </div>

              <div className="border-t border-[#2b3139] px-3 py-3">
                {savedMarketDatasetOptions.length > 0 ? (
                  <select
                    aria-label="Market candle dataset"
                    value={selectedSavedMarketDatasetId}
                    onChange={(event) => handleSavedMarketDatasetChange(event.target.value)}
                    className="h-9 w-full rounded border border-[#2b3139] bg-[#0b0e11] px-2 text-xs font-semibold text-[#eaecef] outline-none focus:border-[#f0b90b]"
                  >
                    {savedMarketDatasetOptions.map((option) => (
                      <option key={option.id} value={option.dataset.id}>
                        {option.apiName} · {formatDateRangeValue(option.dataset.startDate)}-{formatDateRangeValue(option.dataset.endDate)}
                        {option.isAttachedToStrategy ? " · attached" : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                <div className={cn(
                  "mt-3 rounded border px-3 py-2 text-[10px] font-semibold leading-4 break-words",
                  canStartBacktest
                    ? "border-[#0ecb81]/40 bg-[#0ecb81]/10 text-[#0ecb81]"
                    : pendingBacktestUpload || missingRequiredBacktestDataMessage
                      ? "border-[#f0b90b]/40 bg-[#f0b90b]/10 text-[#fcd535]"
                      : "border-[#f6465d]/40 bg-[#f6465d]/10 text-[#ff808b]",
                )}>
                  {backtestReadinessMessage}
                </div>
              </div>
            </div>

            {isBacktestUploadPickerOpen ? (
              <div className="rounded border border-[#2b3139] bg-[#181a20] p-3">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-black">Data tools</div>
                    <div className="mt-1 text-[10px] font-semibold leading-4 text-[#848e9c]">
                      Upload and AI-normalize only the datasets required by this strategy.
                    </div>
                  </div>
                  <div className="shrink-0 rounded bg-[#0b0e11] px-2 py-1 text-[10px] font-black text-[#b7bdc6]">
                    {backtestUploadTargets.length} targets
                  </div>
                </div>

                {pendingBacktestUpload ? (
                  <div className="mb-3 rounded border border-[#f0b90b]/40 bg-[#f0b90b]/10 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-[#fcd535]">Uploaded Dataset</div>
                        <div className="mt-1 truncate text-[10px] font-semibold text-[#b7bdc6]">
                          {pendingBacktestUpload.fileName} · {formatBytes(pendingBacktestUpload.byteSize)} · {pendingBacktestUpload.targetLabel}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAiNormalizeBacktestUpload}
                          disabled={isBacktestNormalizing}
                          className="inline-flex h-8 items-center justify-center gap-2 rounded bg-[#0ecb81] px-3 text-[10px] font-black text-[#0b0e11] hover:bg-[#34d399] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {isBacktestNormalizing ? "AI Normalizing" : "Ask AI to Normalize"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingBacktestUpload(null);
                            setBacktestError("");
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#2b3139] text-[#848e9c] hover:border-[#f6465d] hover:text-[#f6465d]"
                          title="Clear uploaded dataset"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mb-1 text-[9px] font-black uppercase text-[#848e9c]">Raw Sample</div>
                    <pre className="max-h-32 overflow-auto rounded border border-[#2b3139] bg-[#0b0e11] p-2 text-[10px] leading-4 text-[#eaecef]">
                      {pendingBacktestUpload.rawPreviewText}
                    </pre>
                  </div>
                ) : null}

                {backtestUploadTargets.length > 0 ? (
                  <div className={cn("space-y-2", isFullscreen && "grid grid-cols-2 gap-3 space-y-0 2xl:grid-cols-3")}>
                    {backtestUploadTargets.map((target) => {
                      const connection = target.nodeIds.map((nodeId) => effectiveBacktestConnections[nodeId]).find(Boolean);
                      const selected = selectedBacktestUploadTarget?.id === target.id;
                      return (
                        <div
                          key={target.id}
                          className={cn(
                            "rounded border bg-[#0b0e11] p-3",
                            selected ? "border-[#f0b90b]" : "border-[#2b3139]",
                          )}
                        >
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black">{target.label}</div>
                              <div className="mt-1 line-clamp-2 text-[10px] font-semibold leading-4 text-[#848e9c]">
                                {target.detail}
                              </div>
                            </div>
                            <div className={cn(
                              "shrink-0 rounded px-2 py-1 text-[10px] font-black",
                              target.kind === "stream"
                                ? "bg-[#f0b90b]/15 text-[#fcd535]"
                                : "bg-[#0ecb81]/15 text-[#0ecb81]",
                            )}>
                              {target.kind === "stream" ? "STREAM" : `${target.nodeIds.length} ACTION${target.nodeIds.length > 1 ? "S" : ""}`}
                            </div>
                          </div>

                          <div className="mb-3 flex flex-wrap gap-1">
                            {target.requiredMetrics.slice(0, 6).map((metric) => (
                              <span key={metric} className="rounded bg-[#181a20] px-1.5 py-0.5 text-[9px] font-black text-[#b7bdc6]">
                                {metric}
                              </span>
                            ))}
                            {target.requiredMetrics.length > 6 ? (
                              <span className="rounded bg-[#181a20] px-1.5 py-0.5 text-[9px] font-black text-[#848e9c]">
                                +{target.requiredMetrics.length - 6}
                              </span>
                            ) : null}
                          </div>

                          {connection ? (
                            <div className="mb-3 truncate rounded bg-[#0ecb81]/10 px-2 py-1.5 text-[10px] font-semibold text-[#0ecb81]">
                              {connection.source === "data-panel" ? "Data panel · " : ""}{connection.fileName} · {formatEventTime(connection.connectedAt)}
                            </div>
                          ) : (
                            <div className="mb-3 truncate rounded bg-[#2b3139]/70 px-2 py-1.5 text-[10px] font-semibold text-[#848e9c]">
                              No uploaded backtest data
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedBacktestUploadTargetId(target.id)}
                              className={cn(
                                "inline-flex h-8 items-center justify-center rounded border text-[10px] font-black",
                                selected
                                  ? "border-[#f0b90b] text-[#fcd535]"
                                  : "border-[#2b3139] text-[#b7bdc6] hover:border-[#f0b90b] hover:text-[#fcd535]",
                              )}
                            >
                              Select
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenBacktestUploadTarget(target.id)}
                              className="inline-flex h-8 items-center justify-center gap-1 rounded bg-[#f0b90b] text-[10px] font-black text-[#0b0e11] hover:bg-[#fcd535]"
                            >
                              <FileUp className="h-3 w-3" />
                              Upload
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                    No streaming or action block is used by this strategy.
                  </div>
                )}

                {backtestDataset ? (
                  <div className="mt-3 rounded border border-[#2b3139] bg-[#0b0e11]">
                    <div className="flex items-start justify-between gap-3 border-b border-[#2b3139] px-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{backtestDataset.fileName}</div>
                        <div className="mt-1 truncate text-[10px] font-semibold text-[#848e9c]">
                          {backtestDataset.format.toUpperCase()} · normalized {formatEventTime(backtestDataset.normalizedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDeleteBacktestDataset}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#2b3139] text-[#848e9c] hover:border-[#f6465d] hover:text-[#f6465d]"
                        title="Delete backtest data"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 px-3 py-3 text-[10px] font-semibold text-[#848e9c] sm:grid-cols-4">
                      <div className="rounded bg-[#181a20] px-2 py-2">
                        <div className="uppercase">Rows</div>
                        <div className="mt-1 font-mono text-sm font-black text-[#eaecef]">{formatCompactNumber(backtestDataset.rowCount)}</div>
                      </div>
                      <div className="rounded bg-[#181a20] px-2 py-2">
                        <div className="uppercase">Range</div>
                        <div className="mt-1 truncate font-mono text-[11px] font-black text-[#eaecef]">
                          {formatDateRangeValue(backtestDataset.startDate)}-{formatDateRangeValue(backtestDataset.endDate)}
                        </div>
                      </div>
                      <div className="rounded bg-[#181a20] px-2 py-2">
                        <div className="uppercase">Interval</div>
                        <div className="mt-1 font-mono text-sm font-black text-[#eaecef]">{backtestDataset.intervalLabel}</div>
                      </div>
                      <div className="rounded bg-[#181a20] px-2 py-2">
                        <div className="uppercase">Symbols</div>
                        <div className="mt-1 truncate font-mono text-sm font-black text-[#eaecef]">
                          {backtestDataset.symbols.slice(0, 2).join(", ") || "-"}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-[#2b3139] px-3 py-3">
                      <div className="mb-3">
                        <div className="mb-1 text-[9px] font-black uppercase text-[#848e9c]">Detected Metrics</div>
                        <div className="flex flex-wrap gap-1">
                          {backtestDataset.detectedMetrics.slice(0, 12).map((metric) => (
                            <span key={metric} className="rounded bg-[#181a20] px-1.5 py-0.5 text-[9px] font-black text-[#b7bdc6]">
                              {metric}
                            </span>
                          ))}
                          {backtestDataset.detectedMetrics.length > 12 ? (
                            <span className="rounded bg-[#181a20] px-1.5 py-0.5 text-[9px] font-black text-[#848e9c]">
                              +{backtestDataset.detectedMetrics.length - 12}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mb-2 grid grid-cols-4 gap-1 text-[9px] font-black uppercase text-[#848e9c]">
                        <div>Open {formatCoverage(backtestDataset.fieldCoverage.open, backtestDataset.rowCount)}</div>
                        <div>High {formatCoverage(backtestDataset.fieldCoverage.high, backtestDataset.rowCount)}</div>
                        <div>Low {formatCoverage(backtestDataset.fieldCoverage.low, backtestDataset.rowCount)}</div>
                        <div>Vol {formatCoverage(backtestDataset.fieldCoverage.volume, backtestDataset.rowCount)}</div>
                      </div>
                      <div className="overflow-hidden rounded border border-[#2b3139]">
                        <div className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.9fr] bg-[#181a20] px-2 py-1.5 text-[9px] font-black uppercase text-[#848e9c]">
                          <div>Date</div>
                          <div>Symbol</div>
                          <div className="text-right">Close</div>
                          <div className="text-right">Volume</div>
                        </div>
                        {backtestDataset.previewRows.map((row) => (
                          <div key={`${row.symbol}:${row.timestamp}`} className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.9fr] border-t border-[#2b3139] px-2 py-1.5 font-mono text-[10px] text-[#eaecef]">
                            <div className="truncate">{formatDateRangeValue(row.isoDate)}</div>
                            <div className="truncate">{row.symbol}</div>
                            <div className="text-right">{row.close.toFixed(2)}</div>
                            <div className="text-right">{formatCompactNumber(row.volume)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded border border-[#2b3139] bg-[#181a20]">
              <div className="flex flex-col gap-3 border-b border-[#2b3139] px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#fcd535]">2 Test range</div>
                  <div className="mt-1 truncate font-mono text-xs font-semibold text-[#0ecb81]">
                    {effectiveBacktestRangeLabel}
                  </div>
                </div>
                {backtestTimeline?.hasOverlap && effectiveBacktestRange ? (
                  <button
                    type="button"
                    onClick={handleResetSelectedBacktestRange}
                    className="shrink-0 rounded border border-[#2b3139] px-2 py-1 text-[10px] font-black text-[#b7bdc6] hover:border-[#f0b90b] hover:text-[#fcd535]"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              <div className="px-3 py-3">
                {backtestTimeline ? (
                  <>
                    <BacktestTimelineChart timeline={backtestTimeline} selectedRange={effectiveBacktestRange} />
                    {backtestTimeline.hasOverlap && effectiveBacktestRange ? (
                      <div className="mt-3 rounded border border-[#2b3139] bg-[#0b0e11] p-3">
                        <div className="space-y-3">
                          <label className="block">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase text-[#848e9c]">
                              <span>Start</span>
                              <span className="font-mono">{formatBacktestDateTime(effectiveBacktestRange.start)}</span>
                            </div>
                            <input
                              type="range"
                              min={backtestTimeline.overlapStart}
                              max={backtestTimeline.overlapEnd}
                              step={selectedBacktestRangeStep}
                              value={effectiveBacktestRange.start}
                              onChange={(event) => updateSelectedBacktestRange({ start: Number(event.currentTarget.value) }, "start")}
                              className="h-1.5 w-full accent-[#0ecb81]"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase text-[#848e9c]">
                              <span>End</span>
                              <span className="font-mono">{formatBacktestDateTime(effectiveBacktestRange.end)}</span>
                            </div>
                            <input
                              type="range"
                              min={backtestTimeline.overlapStart}
                              max={backtestTimeline.overlapEnd}
                              step={selectedBacktestRangeStep}
                              value={effectiveBacktestRange.end}
                              onChange={(event) => updateSelectedBacktestRange({ end: Number(event.currentTarget.value) }, "end")}
                              className="h-1.5 w-full accent-[#0ecb81]"
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="mb-1 block text-[9px] font-black uppercase text-[#848e9c]">From</span>
                            <input
                              type="datetime-local"
                              min={formatBacktestInputDateTime(backtestTimeline.overlapStart)}
                              max={formatBacktestInputDateTime(backtestTimeline.overlapEnd)}
                              value={formatBacktestInputDateTime(effectiveBacktestRange.start)}
                              onChange={(event) => handleSelectedBacktestRangeInput("start", event.currentTarget.value)}
                              className="h-8 w-full rounded border border-[#2b3139] bg-[#181a20] px-2 font-mono text-[11px] font-semibold text-[#eaecef] outline-none focus:border-[#0ecb81]"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[9px] font-black uppercase text-[#848e9c]">To</span>
                            <input
                              type="datetime-local"
                              min={formatBacktestInputDateTime(backtestTimeline.overlapStart)}
                              max={formatBacktestInputDateTime(backtestTimeline.overlapEnd)}
                              value={formatBacktestInputDateTime(effectiveBacktestRange.end)}
                              onChange={(event) => handleSelectedBacktestRangeInput("end", event.currentTarget.value)}
                              className="h-8 w-full rounded border border-[#2b3139] bg-[#181a20] px-2 font-mono text-[11px] font-semibold text-[#eaecef] outline-none focus:border-[#0ecb81]"
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                    Connect market candles and required datasets to visualize the shared backtest window.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded border border-[#2b3139] bg-[#181a20]">
              <div className="flex flex-col gap-3 border-b border-[#2b3139] px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#fcd535]">3 Results</div>
                  <div className="mt-1 text-xs font-semibold text-[#848e9c]">{backtestResultLabel}</div>
                </div>
                <button
                  type="button"
                  onClick={handleStageBacktest}
                  disabled={!canStartBacktest}
                  className={cn(
                    "inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded px-3 text-xs font-black sm:w-auto",
                    canStartBacktest
                      ? "bg-[#f0b90b] text-[#0b0e11] hover:bg-[#fcd535]"
                      : "cursor-not-allowed bg-[#2b3139] text-[#848e9c]",
                  )}
                >
                  <Play className="h-3.5 w-3.5" />
                  Start Backtest
                </button>
              </div>
              <div className="px-3 py-3">
                {backtestError ? (
                  <div className="mb-3 rounded border border-[#f6465d]/40 bg-[#f6465d]/10 px-3 py-2 text-xs font-semibold text-[#ff808b]">
                    {backtestError}
                  </div>
                ) : null}
                {backtestResult ? (
                  <BacktestPerformanceMetrics result={backtestResult} />
                ) : (
                  <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                    {canStartBacktest
                      ? "Ready. Start the backtest to calculate CAGR, PnL, MDD, and other metrics."
                      : backtestReadinessMessage}
                  </div>
                )}
              </div>
            </div>
          </section>
          ) : null}

          {!isBacktestMonitorActive ? (
          <>
          <section className={cn("mb-5", isFullscreen && "mx-auto max-w-[1800px]")}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-wide text-[#fcd535]">Trigger Controls</div>
            </div>
            {activeSequence.triggerNodes.length > 0 ? (
              <div className={cn("space-y-2", isFullscreen && "grid grid-cols-2 gap-3 space-y-0 xl:grid-cols-3")}>
                {activeSequence.triggerNodes.map((triggerNode) => {
                  const data = getNodeData(triggerNode) as Partial<TimeTriggerData>;
                  const isClick = triggerLooksLikeClick(triggerNode);
                  const triggerCount = readNumber(data.triggerCount, 0);
                  return (
                    <div key={triggerNode.id} className="rounded border border-[#2b3139] bg-[#181a20] p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {isClick ? <MousePointer2 className="h-4 w-4 text-[#f0b90b]" /> : <Timer className="h-4 w-4 text-[#f0b90b]" />}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black">{getNodeLabel(triggerNode, "Trigger")}</div>
                            <div className="truncate text-[10px] font-semibold text-[#848e9c]">
                              {isClick ? (readText(data, ["shortcut"], "manual click")) : `every ${readNumber(data.interval, 0)}s`} · fired {triggerCount}
                            </div>
                          </div>
                        </div>
                        <div className={cn(
                          "rounded px-2 py-1 text-[10px] font-black",
                          data.isActive ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#2b3139] text-[#848e9c]",
                        )}>
                          {isClick ? "CLICK" : data.isActive ? "RUN" : "OFF"}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleFireTrigger(triggerNode)}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded bg-[#f0b90b] text-xs font-black text-[#0b0e11] hover:bg-[#fcd535]"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Fire
                        </button>
                        {!isClick ? (
                          <button
                            type="button"
                            onClick={() => handleToggleTimer(triggerNode)}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-[#2b3139] text-xs font-black text-[#eaecef] hover:border-[#f0b90b] hover:text-[#fcd535]"
                          >
                            {data.isActive ? <Pause className="h-3.5 w-3.5" /> : <Timer className="h-3.5 w-3.5" />}
                            {data.isActive ? "Pause" : "Activate"}
                          </button>
                        ) : (
                          <div className="flex h-9 items-center justify-center rounded border border-[#2b3139] text-[10px] font-bold text-[#848e9c]">
                            Click trigger
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                No trigger or click button is attached to this sequence.
              </div>
            )}
          </section>

          <section className={cn("mb-5", isFullscreen && "mx-auto max-w-[1800px]")}>
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#fcd535]">
              <BarChart3 className="h-3.5 w-3.5" />
              Stream and Indicator Charts
            </div>
            {monitorCharts.length > 0 ? (
              <div className={cn("space-y-3", isFullscreen && "grid grid-cols-2 gap-4 space-y-0 2xl:grid-cols-3")}>
                {monitorCharts.map((chart) => (
                  <div key={chart.id} className="overflow-hidden rounded border border-[#2b3139] bg-[#181a20]">
                    <div className="flex items-center justify-between gap-3 border-b border-[#2b3139] px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{chart.label}</div>
                        <div className="truncate text-[10px] font-semibold text-[#848e9c]">{chart.nodeLabel}</div>
                      </div>
                      <div className={cn(
                        "shrink-0 rounded px-2 py-1 text-[10px] font-black",
                        chart.kind === "stream"
                          ? "bg-[#f0b90b]/15 text-[#fcd535]"
                          : "bg-[#0ecb81]/15 text-[#0ecb81]",
                      )}>
                        {chart.kind === "stream" ? "stream" : chart.conditions.length > 0
                          ? (
                            <>
                          {chart.conditions.length} condition{chart.conditions.length > 1 ? "s" : ""}
                            </>
                          )
                          : "indicator"}
                      </div>
                    </div>
                    <div className={cn("bg-slate-950", isFullscreen ? "h-[320px]" : "h-[190px]")}>
                      <MetricChart
                        series={chart.series}
                        condition={chart.condition}
                        conditions={chart.conditions}
                        comparisonValues={chart.comparisonValues}
                        height={isFullscreen ? 320 : 190}
                        source={chart.source}
                        updatedAt={chart.updatedAt}
                        showStats
                        showVolume={false}
                        frameless
                        booleanMode={chart.booleanMode}
                        rangeKey={`sequence-monitor:${chart.id}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                Attach a streaming block or indicator logic to this sequence to show its chart here.
              </div>
            )}
          </section>

          <section className={cn("mb-5", isFullscreen && "mx-auto max-w-[1800px]")}>
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-[#fcd535]">Action Blocks</div>
            {activeSequence.actionNodes.length > 0 ? (
              <div className={cn("space-y-2", isFullscreen && "grid grid-cols-2 gap-3 space-y-0 xl:grid-cols-3")}>
                {activeSequence.actionNodes.map((actionNode) => {
                  const data = getNodeData(actionNode);
                  const executionCount = readNumber(data.executionCount, 0);
                  return (
                    <div key={actionNode.id} className="rounded border border-[#2b3139] bg-[#181a20] p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black">{getNodeLabel(actionNode, "Action")}</div>
                          <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-[#848e9c]">
                            {describeAction(actionNode)}
                          </div>
                        </div>
                        <span className="shrink-0 rounded border border-[#2b3139] px-2 py-1 text-[10px] font-black text-[#848e9c]">
                          Monitor
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold text-[#848e9c]">
                        <div className="rounded bg-[#0b0e11] px-2 py-1.5">
                          Reached <span className="font-mono text-[#eaecef]">{executionCount}</span>
                        </div>
                        <div className="rounded bg-[#0b0e11] px-2 py-1.5">
                          Last reached <span className="font-mono text-[#eaecef]">{formatEventTime(data.lastExecutedAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                No action block is attached to this sequence.
              </div>
            )}
          </section>

          <section className={cn(isFullscreen && "mx-auto max-w-[1800px]")}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-black uppercase tracking-wide text-[#fcd535]">Trade Records</div>
              <button
                type="button"
                onClick={() => sequenceLogStore.clear()}
                className="inline-flex items-center gap-1 rounded border border-[#2b3139] px-2 py-1 text-[10px] font-black text-[#848e9c] hover:border-[#f6465d] hover:text-[#f6465d]"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            {activeLogs.length > 0 ? (
              <div className={cn("space-y-2", isFullscreen && "grid grid-cols-2 gap-3 space-y-0 xl:grid-cols-3")}>
                {activeLogs.slice(0, 80).map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded border px-3 py-2",
                      entry.level === "success"
                        ? "border-[#0ecb81]/30 bg-[#0ecb81]/8"
                        : entry.level === "warning"
                          ? "border-[#f0b90b]/30 bg-[#f0b90b]/8"
                          : "border-[#2b3139] bg-[#181a20]",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="truncate text-[10px] font-black uppercase text-[#848e9c]">{entry.stateLabel}</div>
                      <div className="shrink-0 font-mono text-[10px] font-black text-[#848e9c]">{entry.timeLabel}</div>
                    </div>
                    <div className="text-xs font-semibold leading-5 text-[#eaecef]">{entry.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-[#2b3139] px-3 py-4 text-center text-xs font-semibold text-[#848e9c]">
                Trigger a sequence to create monitor records.
              </div>
            )}
          </section>
          </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm font-semibold text-[#848e9c]">
          No sequence is available to monitor.
        </div>
      )}
    </aside>
  );
}
