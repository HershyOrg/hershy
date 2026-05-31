"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { Handle, NodeProps, Position, useEdges, useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
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

const DEFAULT_EXPANDED_NODE_WIDTH = 820;
const DEFAULT_CHART_PANE_HEIGHT = 520;
const MIN_EXPANDED_NODE_WIDTH = 620;
const MIN_CHART_PANE_HEIGHT = 280;
const MAX_EXPANDED_NODE_WIDTH = 1280;
const MAX_CHART_PANE_HEIGHT = 920;
const CONDITION_OPERATORS: IndicatorCondition["operator"][] = [">", ">=", "<", "<="];
const CONDITION_OPERATOR_GLYPHS: Record<IndicatorCondition["operator"], string> = {
  ">": "↑",
  ">=": "↥",
  "<": "↓",
  "<=": "↧",
};

type IndicatorOutputBlock = BlockData & {
  formulaCode?: string;
  functionCodeGroupId?: string;
  functionCodeName?: string;
  chartSeries?: NodeChartPoint[];
  chartSource?: string;
  chartWarning?: string;
  chartUpdatedAt?: string;
  condition?: IndicatorCondition;
  conditionControls?: ThresholdConditionControl[];
  chartComparisonValues?: ChartComparisonValue[];
  showChartComparison?: boolean;
  showConditionControl?: boolean;
  outputMode?: "formula" | "passthrough";
  passthroughInputBlockId?: string;
};

type ThresholdConditionControl = {
  id: string;
  condition: IndicatorCondition;
};

type OutputChartModel = {
  block: IndicatorOutputBlock;
  index: number;
  isBooleanChart: boolean;
  functionCodeGroupKey: string;
  functionCodeGroupId: string;
  functionCodeGroupLabel: string;
  functionCodeGroupOrigin: "explicit" | "node" | "formula" | "block";
  series: ReturnType<typeof buildMetricSeries>;
  latestValue: number;
  condition: IndicatorCondition;
  conditionControls: ThresholdConditionControl[];
  conditionMet: boolean;
  showChartComparison: boolean;
  showConditionControl: boolean;
  chartComparisonValues: ChartComparisonValue[];
  visibleChartComparisonValues: ChartComparisonValue[];
  chartSource: string;
  chartWarning: string;
  chartUpdatedAt: string;
};

type OutputChartGroup = {
  key: string;
  id: string;
  label: string;
  origin: OutputChartModel["functionCodeGroupOrigin"];
  models: OutputChartModel[];
};

type PendingOutputDelete = {
  blockId: string;
  blockName: string;
  groupLabel: string;
  returnCount: number;
};

type CanvasPoint = { x: number; y: number };

function getInputBlocks(data: FunctionNodeData) {
  return data.inputBlocks?.length ? data.inputBlocks : [DEFAULT_INPUT_BLOCK];
}

function getOutputBlocks(data: FunctionNodeData) {
  return Array.isArray(data.outputBlocks) ? data.outputBlocks : [DEFAULT_OUTPUT_BLOCK];
}

function isTriggerDataBlock(block: BlockData) {
  const text = `${block.id} ${block.name} ${String(block.outputKind ?? "")}`.toLowerCase();
  return /\btrigger(?:ed)?\b|boolean-trigger|boolean-data/.test(text);
}

function isBooleanOutputBlock(block: BlockData) {
  const semanticText = [
    block.outputKind,
    block.valueKind,
    block.returnKind,
    block.returnType,
    block.dataType,
    block.chartType,
    block.visualType,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  const nameText = `${block.id} ${block.name}`.toLowerCase();

  return /\b(?:boolean|bool)\b|yes[-/\s]?no|true[-/\s]?false/.test(semanticText) ||
    /yes[-/\s]?no|true[-/\s]?false/.test(nameText);
}

function getInputHandleId(nodeId: string, blockId: string) {
  return `${nodeId}-input-${blockId}-in`;
}

function getOutputHandleId(nodeId: string, blockId: string) {
  return `${nodeId}-block-${blockId}-out`;
}

function getTriggerHandleId(nodeId: string, blockId: string) {
  return `${nodeId}-trigger-${blockId}-out`;
}

function getThresholdControlHandleId(nodeId: string, blockId: string, controlId: string) {
  return controlId === "primary"
    ? getTriggerHandleId(nodeId, blockId)
    : `${nodeId}-trigger-${blockId}-${controlId}-out`;
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

function getDefaultBooleanCondition(metric: string): IndicatorCondition {
  return {
    metric,
    operator: ">=",
    threshold: 0.5,
    label: `${metric} is YES`,
  };
}

function normalizeThresholdControls(
  block: IndicatorOutputBlock,
  fallbackCondition: IndicatorCondition,
  showConditionControl: boolean,
): ThresholdConditionControl[] {
  const rawControls = Array.isArray(block.conditionControls)
    ? block.conditionControls
    : [];
  const controls = rawControls
    .map((control, index) => {
      const condition = (control as ThresholdConditionControl).condition ?? fallbackCondition;
      return {
        id: String((control as ThresholdConditionControl).id || (index === 0 ? "primary" : `range-${index + 1}`)),
        condition: {
          ...fallbackCondition,
          ...condition,
          metric: condition.metric || fallbackCondition.metric,
        },
      };
    })
    .slice(0, 2);

  if (controls.length > 0) return controls;
  if (!showConditionControl) return [];

  return [{
    id: "primary",
    condition: fallbackCondition,
  }];
}

function createRangeMateCondition(condition: IndicatorCondition): IndicatorCondition {
  const baseThreshold = Number(condition.threshold);
  const safeThreshold = Number.isFinite(baseThreshold) ? baseThreshold : 0;
  const offset = Math.max(Math.abs(safeThreshold) * 0.03, 1);
  const isLowerBound = condition.operator === ">" || condition.operator === ">=";

  return {
    ...condition,
    operator: isLowerBound ? "<" : ">",
    threshold: Number((safeThreshold + (isLowerBound ? offset : -offset)).toFixed(2)),
    label: undefined,
  };
}

function formatValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatOutputValue(value: number, isBooleanChart: boolean) {
  if (isBooleanChart) return value >= 0.5 ? "YES" : "NO";
  return formatValue(value);
}

function clampDimension(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readDimension(value: unknown, fallback: number, min: number, max: number) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? clampDimension(numericValue, min, max) : fallback;
}

function getChartValueRange(series: ReturnType<typeof buildMetricSeries>, threshold: number | number[]) {
  const values = series.map((point) => point.value).filter(Number.isFinite);
  const thresholds = (Array.isArray(threshold) ? threshold : [threshold]).filter(Number.isFinite);
  const safeThresholds = thresholds.length > 0 ? thresholds : [0];
  const rawMin = Math.min(...values, ...safeThresholds);
  const rawMax = Math.max(...values, ...safeThresholds);
  const span = Math.max(rawMax - rawMin, 1);
  const padding = span * 0.12;
  return {
    min: rawMin - padding,
    max: rawMax + padding,
  };
}

function getThresholdTopPercent(series: ReturnType<typeof buildMetricSeries>, threshold: number, referenceThresholds: number[] = [threshold]) {
  const { min, max } = getChartValueRange(series, referenceThresholds);
  const ratio = (max - threshold) / Math.max(max - min, 1);
  return clampDimension(ratio * 100, 8, 92);
}

function getChartValueFromClientY(
  clientY: number,
  paneElement: HTMLElement,
  series: ReturnType<typeof buildMetricSeries>,
  currentThreshold: number | number[],
) {
  const bounds = paneElement.getBoundingClientRect();
  const ratio = clampDimension((clientY - bounds.top) / Math.max(bounds.height, 1), 0, 1);
  const { min, max } = getChartValueRange(series, currentThreshold);
  return Number((max - ratio * (max - min)).toFixed(2));
}

function getNextConditionOperator(operator: IndicatorCondition["operator"]) {
  const index = CONDITION_OPERATORS.indexOf(operator);
  return CONDITION_OPERATORS[(index + 1) % CONDITION_OPERATORS.length];
}

function hashStableString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function sanitizeGroupId(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "function";
}

function cloneSerializable<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function getOutputFormulaCode(block: IndicatorOutputBlock, fallback = "") {
  if (typeof block.formulaCode === "string") return block.formulaCode;
  if (typeof block.code === "string") return block.code;
  if (typeof block.formula === "string") return block.formula;
  if (typeof block.expression === "string") return block.expression;
  if (typeof block.logic === "string") return block.logic;
  return fallback;
}

function readStringProperty(source: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

type ReturnObjectProperty = {
  key: string;
  start: number;
  end: number;
  text: string;
};

type ReturnObjectInfo = {
  objectStart: number;
  objectEnd: number;
  keys: string[];
  properties: ReturnObjectProperty[];
};

function skipQuotedString(source: string, start: number) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function skipLineComment(source: string, start: number) {
  const end = source.indexOf("\n", start + 2);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source: string, start: number) {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function skipTemplateLiteral(source: string, start: number) {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") return index + 1;
    index += 1;
  }
  return source.length;
}

function findMatchingBrace(source: string, openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "'" || char === "\"") {
      index = skipQuotedString(source, index);
      continue;
    }
    if (char === "`") {
      index = skipTemplateLiteral(source, index);
      continue;
    }
    if (char === "/" && next === "/") {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(source, index);
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

function splitTopLevelObjectProperties(content: string) {
  const ranges: Array<{ start: number; end: number; text: string }> = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index <= content.length;) {
    if (index === content.length) {
      const text = content.slice(start, index);
      if (text.trim()) ranges.push({ start, end: index, text });
      break;
    }

    const char = content[index];
    const next = content[index + 1];

    if (char === "'" || char === "\"") {
      index = skipQuotedString(content, index);
      continue;
    }
    if (char === "`") {
      index = skipTemplateLiteral(content, index);
      continue;
    }
    if (char === "/" && next === "/") {
      index = skipLineComment(content, index);
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(content, index);
      continue;
    }
    if ("{[(".includes(char)) depth += 1;
    if ("}])".includes(char)) depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      const text = content.slice(start, index);
      if (text.trim()) ranges.push({ start, end: index, text });
      start = index + 1;
    }
    index += 1;
  }

  return ranges;
}

function getObjectPropertyKey(propertyText: string) {
  const text = propertyText.trim();
  if (!text || text.startsWith("...")) return "";

  const stringKey = text.match(/^(['"])(.*?)\1\s*(?::|\(|$)/);
  if (stringKey?.[2]) return stringKey[2];

  const identifierKey = text.match(/^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?::|\(|=|$)/);
  return identifierKey?.[1] ?? "";
}

function extractReturnedObjectInfo(code: string): ReturnObjectInfo | null {
  let bestInfo: ReturnObjectInfo | null = null;

  for (let index = 0; index < code.length;) {
    const returnIndex = code.indexOf("return", index);
    if (returnIndex === -1) break;

    const before = code[returnIndex - 1];
    const after = code[returnIndex + "return".length];
    const isWordBoundaryBefore = !before || !/[\w$]/.test(before);
    const isWordBoundaryAfter = !after || !/[\w$]/.test(after);
    if (!isWordBoundaryBefore || !isWordBoundaryAfter) {
      index = returnIndex + 6;
      continue;
    }

    let cursor = returnIndex + "return".length;
    while (/\s/.test(code[cursor] ?? "")) cursor += 1;
    if (code[cursor] !== "{") {
      index = cursor + 1;
      continue;
    }

    const closeIndex = findMatchingBrace(code, cursor);
    if (closeIndex === -1) return bestInfo;

    const content = code.slice(cursor + 1, closeIndex);
    const properties = splitTopLevelObjectProperties(content)
      .map((property) => ({
        ...property,
        key: getObjectPropertyKey(property.text),
      }))
      .filter((property) => property.key);

    bestInfo = {
      objectStart: cursor,
      objectEnd: closeIndex,
      keys: properties.map((property) => property.key),
      properties,
    };
    index = closeIndex + 1;
  }

  return bestInfo;
}

function getLineIndentBefore(source: string, index: number) {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const prefix = source.slice(lineStart, index);
  return prefix.match(/^\s*/)?.[0] ?? "";
}

function removeReturnObjectProperty(code: string, propertyName: string) {
  const info = extractReturnedObjectInfo(code);
  if (!info) return code;

  const remaining = info.properties
    .filter((property) => property.key !== propertyName)
    .map((property) => property.text.trim())
    .filter(Boolean);
  const baseIndent = getLineIndentBefore(code, info.objectStart);
  const propertyIndent = `${baseIndent}  `;
  const nextObject = remaining.length > 0
    ? `{\n${propertyIndent}${remaining.join(`,\n${propertyIndent}`)}\n${baseIndent}}`
    : "{}";

  if (remaining.length === info.properties.length) return code;
  return `${code.slice(0, info.objectStart)}${nextObject}${code.slice(info.objectEnd + 1)}`;
}

function getOutputFunctionGroupMeta({
  block,
  data,
  nodeId,
}: {
  block: IndicatorOutputBlock;
  data: FunctionNodeData;
  nodeId: string;
}) {
  const explicitId = readStringProperty(block, [
    "functionCodeGroupId",
    "functionGroupId",
    "codeGroupId",
    "sourceFunctionId",
  ]);
  const explicitLabel = readStringProperty(block, ["functionCodeName", "functionName", "codeGroupName"]);
  const nodeFunctionName = readStringProperty(data, ["functionName", "label"]);
  const nodeCode = typeof data.code === "string" ? data.code.trim() : "";
  const blockCode = getOutputFormulaCode(block, "").trim();

  if (explicitId) {
    return {
      key: `explicit:${explicitId}`,
      id: explicitId,
      label: explicitLabel || nodeFunctionName || block.name || "function",
      origin: "explicit" as const,
    };
  }

  if (nodeCode && (!blockCode || blockCode === nodeCode)) {
    const groupId = readStringProperty(data, ["functionCodeGroupId", "functionGroupId", "codeGroupId"]) ||
      `fn-${sanitizeGroupId(nodeFunctionName || nodeId)}-${hashStableString(nodeCode).slice(0, 6)}`;
    return {
      key: `node:${groupId}`,
      id: groupId,
      label: nodeFunctionName || "function",
      origin: "node" as const,
    };
  }

  if (blockCode) {
    const groupId = `fx-${hashStableString(blockCode)}`;
    return {
      key: `formula:${groupId}`,
      id: groupId,
      label: explicitLabel || `${block.name} formula`,
      origin: "formula" as const,
    };
  }

  return {
    key: `block:${block.id}`,
    id: `block-${sanitizeGroupId(block.id)}`,
    label: block.name || "output",
    origin: "block" as const,
  };
}

function groupOutputChartModels(models: OutputChartModel[]) {
  const groups = new Map<string, OutputChartGroup>();
  models.forEach((model) => {
    const group = groups.get(model.functionCodeGroupKey);
    if (group) {
      group.models.push(model);
      return;
    }

    groups.set(model.functionCodeGroupKey, {
      key: model.functionCodeGroupKey,
      id: model.functionCodeGroupId,
      label: model.functionCodeGroupLabel,
      origin: model.functionCodeGroupOrigin,
      models: [model],
    });
  });

  return Array.from(groups.values());
}

function getFunctionGroupCode(group: OutputChartGroup | null, fallbackCode = "") {
  if (!group) return fallbackCode;
  const explicitCodes = group.models
    .map((model) => getOutputFormulaCode(model.block, ""))
    .map((code) => code.trim())
    .filter(Boolean);
  const uniqueCodes = Array.from(new Set(explicitCodes));

  if (group.origin === "node" && fallbackCode.trim()) return fallbackCode;
  if (uniqueCodes.length === 1) return uniqueCodes[0];
  if (fallbackCode.trim()) return fallbackCode;
  return uniqueCodes[0] ?? "";
}

function createOutputBlockClone(source: IndicatorOutputBlock, index: number): IndicatorOutputBlock {
  const cloned = cloneSerializable(source);
  const baseName = source.name?.trim() || "metric";
  const nextName = /_\d+$/.test(baseName) ? baseName.replace(/_(\d+)$/, (_, value) => `_${Number(value) + 1}`) : `${baseName}_${index + 1}`;

  return {
    ...cloned,
    id: `ob-${Date.now()}-${index}`,
    name: nextName,
    description: source.description || "복제한 output metric",
    type: "output",
    outputMode: source.outputMode === "passthrough" ? "formula" : source.outputMode,
    passthroughInputBlockId: source.outputMode === "passthrough" ? undefined : source.passthroughInputBlockId,
    connectedFrom: source.outputMode === "passthrough" ? undefined : source.connectedFrom,
  };
}

function readBlockSeries(block: IndicatorOutputBlock, fallback?: NodeChartPoint[]) {
  const candidate = Array.isArray(block.chartSeries) && block.chartSeries.length > 0
    ? block.chartSeries
    : fallback;

  return Array.isArray(candidate)
    ? candidate
      .map((point) => ({ time: point.time as any, value: point.value, volume: point.volume }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    : [];
}

function normalizeBooleanSeries(series: ReturnType<typeof buildMetricSeries>) {
  return series.map((point) => ({
    ...point,
    value: point.value >= 0.5 ? 1 : 0,
  }));
}

function isBinarySeries(series: ReturnType<typeof buildMetricSeries>) {
  const values = series.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (values.length === 0) return false;
  return values.every((value) => value === 0 || value === 1);
}

function buildBooleanSeries(seed: string, length: number) {
  return buildMetricSeries(seed, length, 0).map((point, index) => ({
    ...point,
    value: point.value + Math.sin(index / 4) > 0 ? 1 : 0,
    volume: undefined,
  }));
}

function FunctionCodeBracket({ label }: { label: string }) {
  const displayLabel = label.replace(/\s+/g, " ").slice(0, 32);
  return (
    <div className="pointer-events-none absolute inset-y-3 left-1 z-20 w-4 text-[#848e9c]">
      <div className="absolute left-2 top-0 h-px w-2 bg-[#848e9c]/55" />
      <div className="absolute bottom-0 left-2 h-px w-2 bg-[#848e9c]/55" />
      <div className="absolute left-2 top-0 h-full w-px bg-[#848e9c]/55" />
      <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap rounded-sm bg-[#0b0e11]/82 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#b7bdc6]">
        {displayLabel}
      </div>
    </div>
  );
}

function FunctionNodeComponent({
  id,
  data,
  selected,
}: NodeProps<import("@xyflow/react").Node<FunctionNodeData>>) {
  const { setNodes, getNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useEdges();
  const [isExpanded, setIsExpanded] = useState(data.isExpanded ?? false);
  const [viewMode, setViewMode] = useState<"node" | "code">(data.viewMode || "node");
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [codeOutputId, setCodeOutputId] = useState<string | null>(null);
  const [chartPaneWeights, setChartPaneWeights] = useState<Record<string, number>>({});
  const [pendingOutputDelete, setPendingOutputDelete] = useState<PendingOutputDelete | null>(null);
  const [resizableSize, setResizableSize] = useState(() => ({
    width: readDimension(
      data.nodeWidth,
      DEFAULT_EXPANDED_NODE_WIDTH,
      MIN_EXPANDED_NODE_WIDTH,
      MAX_EXPANDED_NODE_WIDTH,
    ),
    chartHeight: readDimension(
      data.chartPaneHeight,
      DEFAULT_CHART_PANE_HEIGHT,
      MIN_CHART_PANE_HEIGHT,
      MAX_CHART_PANE_HEIGHT,
    ),
  }));
  const chartPaneContainerRef = useRef<HTMLDivElement | null>(null);

  const inputBlocks = useMemo(() => getInputBlocks(data), [data]);
  const outputBlocks = useMemo(
    () => getOutputBlocks(data).map((block) => block as IndicatorOutputBlock),
    [data],
  );
  const primaryOutput = outputBlocks[0];
  const runtimeCode = typeof data.runtimeCode === "string" ? data.runtimeCode : "";
  const triggerOutputBlock = useMemo<BlockData>(
    () => ({
      id: "trigger",
      name: "trigger",
      description: "선택한 output 조건 결과 boolean 데이터",
      type: "output",
      outputKind: "boolean-data",
    }),
    [],
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
  const chartableOutputBlocks = useMemo(
    () => visibleOutputBlocks.filter((block) => !isTriggerDataBlock(block)) as IndicatorOutputBlock[],
    [visibleOutputBlocks],
  );
  const outputChartModels = useMemo<OutputChartModel[]>(
    () => {
      const models = chartableOutputBlocks.map((block, index) => {
        const functionGroup = getOutputFunctionGroupMeta({ block, data, nodeId: id });
        const isBooleanByMetadata = isBooleanOutputBlock(block);
        const fallbackNodeSeries = index === 0 && Array.isArray(data.chartSeries)
          ? data.chartSeries as NodeChartPoint[]
          : undefined;
        const integratedSeries = readBlockSeries(block, fallbackNodeSeries);
        const rawSeries = integratedSeries.length > 0
          ? (isExpanded ? integratedSeries : integratedSeries.slice(-56))
          : isBooleanByMetadata
            ? buildBooleanSeries(`${id}:${block.id}:${block.name}:${data.label}`, isExpanded ? 96 : 56)
            : buildMetricSeries(
              `${id}:${block.id}:${block.name}:${data.label}`,
              isExpanded ? 96 : 56,
              100 + ((id.length + block.name.length + index * 7) % 22),
            );
        const isBooleanChart = isBooleanByMetadata || isBinarySeries(rawSeries);
        const series = isBooleanChart ? normalizeBooleanSeries(rawSeries) : rawSeries;
        const condition = block.condition ??
          (index === 0 ? data.condition : undefined) ??
          (isBooleanChart ? getDefaultBooleanCondition(block.name) : getDefaultCondition(block.name));
        const showChartComparison = block.showChartComparison ?? (index === 0 ? data.showChartComparison !== false : true);
        const showConditionControl = isBooleanChart
          ? false
          : block.showConditionControl === true || (index === 0 && data.showConditionControl === true);
        const conditionControls = isBooleanChart
          ? []
          : normalizeThresholdControls(block, condition, showConditionControl);
        const chartComparisonValues = normalizeChartComparisonValues(
          block.chartComparisonValues ?? (index === 0 ? data.chartComparisonValues : []),
        );
        const latestValue = series[series.length - 1]?.value ?? 0;
        const conditionMet = conditionControls.length > 0
          ? conditionControls.every((control) => evaluateCondition(latestValue, control.condition))
          : evaluateCondition(latestValue, condition);

        return {
          block,
          index,
          isBooleanChart,
          functionCodeGroupKey: functionGroup.key,
          functionCodeGroupId: functionGroup.id,
          functionCodeGroupLabel: functionGroup.label,
          functionCodeGroupOrigin: functionGroup.origin,
          series,
          latestValue,
          condition,
          conditionControls,
          conditionMet,
          showChartComparison,
          showConditionControl,
          chartComparisonValues,
          visibleChartComparisonValues: showChartComparison
            ? chartComparisonValues.filter((item) => item.enabled !== false)
            : [],
          chartSource: typeof block.chartSource === "string"
            ? block.chartSource
            : index === 0 && typeof data.chartSource === "string"
              ? data.chartSource
              : "",
          chartWarning: typeof block.chartWarning === "string"
            ? block.chartWarning
            : index === 0 && typeof data.chartWarning === "string"
              ? data.chartWarning
              : "",
          chartUpdatedAt: typeof block.chartUpdatedAt === "string"
            ? block.chartUpdatedAt
            : index === 0 && typeof data.chartUpdatedAt === "string"
              ? data.chartUpdatedAt
              : "",
        };
      });

      return groupOutputChartModels(models).flatMap((group) => group.models);
    },
    [chartableOutputBlocks, data, id, isExpanded],
  );
  const outputChartGroups = useMemo(
    () => groupOutputChartModels(outputChartModels),
    [outputChartModels],
  );
  const selectedOutput = useMemo(
    () => outputChartModels.find((model) => model.block.id === selectedOutputId) ?? outputChartModels[0] ?? null,
    [outputChartModels, selectedOutputId],
  );
  const selectedOutputGroup = useMemo(
    () => outputChartGroups.find((group) => group.models.some((model) => model.block.id === selectedOutput?.block.id)) ?? outputChartGroups[0] ?? null,
    [outputChartGroups, selectedOutput],
  );
  const codeOutputGroup = useMemo(
    () => outputChartGroups.find((group) => group.models.some((model) => model.block.id === codeOutputId)) ?? null,
    [codeOutputId, outputChartGroups],
  );
  const chartPaneWeightList = useMemo(
    () => outputChartModels.map((model) => {
      const weight = chartPaneWeights[model.block.id];
      return Number.isFinite(weight) && weight > 0 ? weight : 1;
    }),
    [chartPaneWeights, outputChartModels],
  );
  const primaryOutputChart = outputChartModels[0] ?? null;
  const chartSeries = primaryOutputChart?.series ?? buildMetricSeries(`${id}:empty`, isExpanded ? 96 : 56);
  const latestValue = primaryOutputChart?.latestValue ?? 0;
  const condition = selectedOutput?.condition ?? getDefaultCondition(primaryOutput.name);
  const conditionMet = primaryOutputChart?.conditionMet ?? false;
  const primaryThresholdConditions = useMemo(
    () => primaryOutputChart?.showConditionControl
      ? primaryOutputChart.conditionControls.length > 0
        ? primaryOutputChart.conditionControls.map((control) => control.condition)
        : [primaryOutputChart.condition]
      : [],
    [primaryOutputChart],
  );
  const activeCodeGroup = viewMode === "code" ? codeOutputGroup ?? selectedOutputGroup : selectedOutputGroup;
  const displayCode = runtimeCode || getFunctionGroupCode(
    activeCodeGroup,
    typeof data.code === "string" ? data.code : "",
  );
  const selectedChartComparisonValues = useMemo(
    () => selectedOutput?.chartComparisonValues ?? [],
    [selectedOutput],
  );
  const showSelectedChartComparison = selectedOutput?.showChartComparison ?? true;
  const shouldShowTriggerFormulaPanel = Boolean(
    selectedOutput?.showConditionControl ||
    (selectedOutput?.conditionControls?.length ?? 0) > 0,
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

  useEffect(() => {
    if (selectedOutputId && outputChartModels.some((model) => model.block.id === selectedOutputId)) return;
    setSelectedOutputId(outputChartModels[0]?.block.id ?? null);
  }, [outputChartModels, selectedOutputId]);

  useEffect(() => {
    setResizableSize({
      width: readDimension(
        data.nodeWidth,
        DEFAULT_EXPANDED_NODE_WIDTH,
        MIN_EXPANDED_NODE_WIDTH,
        MAX_EXPANDED_NODE_WIDTH,
      ),
      chartHeight: readDimension(
        data.chartPaneHeight,
        DEFAULT_CHART_PANE_HEIGHT,
        MIN_CHART_PANE_HEIGHT,
        MAX_CHART_PANE_HEIGHT,
      ),
    });
  }, [data.chartPaneHeight, data.nodeWidth]);

  useEffect(() => {
    if (viewMode !== "code") {
      if (codeOutputId) setCodeOutputId(null);
      return;
    }

    if (codeOutputId && outputChartModels.some((model) => model.block.id === codeOutputId)) return;

    const fallbackOutputId = outputChartModels.some((model) => model.block.id === selectedOutputId)
      ? selectedOutputId
      : outputChartModels[0]?.block.id ?? null;

    setCodeOutputId(fallbackOutputId);
    if (fallbackOutputId) setSelectedOutputId(fallbackOutputId);
  }, [codeOutputId, outputChartModels, selectedOutputId, viewMode]);

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

  const updateOutputBlock = useCallback(
    (blockId: string, patch: Partial<IndicatorOutputBlock>) => {
      const nextOutputBlocks = outputBlocks.map((block, index) => {
        if (block.id !== blockId) return block;
        const nextBlock = { ...block, ...patch, type: "output" as const };
        if (index === 0 && patch.condition && !patch.formulaCode) {
          return nextBlock;
        }
        return nextBlock;
      });
      const isPrimary = outputBlocks[0]?.id === blockId;
      updateNodeData({
        outputBlocks: nextOutputBlocks,
        ...(isPrimary && patch.condition ? { condition: patch.condition } : {}),
        ...(isPrimary && patch.chartComparisonValues ? { chartComparisonValues: patch.chartComparisonValues } : {}),
        ...(isPrimary && Object.prototype.hasOwnProperty.call(patch, "showChartComparison")
          ? { showChartComparison: patch.showChartComparison }
          : {}),
        ...(isPrimary && typeof patch.formulaCode === "string" ? { code: patch.formulaCode } : {}),
      } as Partial<FunctionNodeData>);
    },
    [outputBlocks, updateNodeData],
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
    const targetOutputId = selectedOutput?.block.id ?? outputChartModels[0]?.block.id ?? null;

    if (nextMode === "code" && targetOutputId) {
      setSelectedOutputId(targetOutputId);
      setCodeOutputId(targetOutputId);
    } else {
      setCodeOutputId(null);
    }
    setViewMode(nextMode);
    updateNodeData({ viewMode: nextMode });
  }, [outputChartModels, selectedOutput, updateNodeData, viewMode]);

  const handleToggleChartComparison = useCallback(() => {
    if (!selectedOutput) return;
    updateOutputBlock(selectedOutput.block.id, { showChartComparison: !showSelectedChartComparison });
  }, [selectedOutput, showSelectedChartComparison, updateOutputBlock]);

  const handleAddChartComparisonValue = useCallback(() => {
    if (!selectedOutput) return;
    const next = createChartComparisonValue(
      selectedChartComparisonValues.length + 1,
      Number(condition.threshold) + selectedChartComparisonValues.length + 1,
    );
    updateOutputBlock(selectedOutput.block.id, {
      showChartComparison: true,
      chartComparisonValues: [...selectedChartComparisonValues, next],
    });
  }, [condition.threshold, selectedChartComparisonValues, selectedOutput, updateOutputBlock]);

  const handleUpdateChartComparisonValue = useCallback(
    (lineId: string, patch: Partial<ChartComparisonValue>) => {
      if (!selectedOutput) return;
      updateOutputBlock(selectedOutput.block.id, {
        chartComparisonValues: selectedChartComparisonValues.map((item) =>
          item.id === lineId ? { ...item, ...patch } : item,
        ),
      });
    },
    [selectedChartComparisonValues, selectedOutput, updateOutputBlock],
  );

  const handleRemoveChartComparisonValue = useCallback(
    (lineId: string) => {
      if (!selectedOutput) return;
      updateOutputBlock(selectedOutput.block.id, {
        chartComparisonValues: selectedChartComparisonValues.filter((item) => item.id !== lineId),
      });
    },
    [selectedChartComparisonValues, selectedOutput, updateOutputBlock],
  );

  const handleChartPaneResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, paneIndex: number) => {
      event.preventDefault();
      event.stopPropagation();

      const containerHeight = chartPaneContainerRef.current?.getBoundingClientRect().height || 1;
      const startY = event.clientY;
      const startWeights = outputChartModels.map((model, index) => {
        const weight = chartPaneWeights[model.block.id] ?? chartPaneWeightList[index] ?? 1;
        return Number.isFinite(weight) && weight > 0 ? weight : 1;
      });
      const totalWeight = startWeights.reduce((sum, weight) => sum + weight, 0) || 1;
      const pairTotal = startWeights[paneIndex] + startWeights[paneIndex + 1];
      const minWeight = Math.max(totalWeight * 0.08, 0.12);

      const handleMove = (moveEvent: MouseEvent) => {
        const deltaWeight = ((moveEvent.clientY - startY) / containerHeight) * totalWeight;
        const nextTop = Math.min(Math.max(startWeights[paneIndex] + deltaWeight, minWeight), pairTotal - minWeight);
        const nextBottom = pairTotal - nextTop;
        const nextWeights = [...startWeights];
        nextWeights[paneIndex] = nextTop;
        nextWeights[paneIndex + 1] = nextBottom;

        setChartPaneWeights((current) => {
          const next = { ...current };
          outputChartModels.forEach((model, index) => {
            next[model.block.id] = nextWeights[index];
          });
          return next;
        });
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [chartPaneWeightList, chartPaneWeights, outputChartModels],
  );

  const handleNodeResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startY = event.clientY;
      const startSize = resizableSize;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: MouseEvent) => {
        const nextSize = {
          width: Math.round(clampDimension(
            startSize.width + moveEvent.clientX - startX,
            MIN_EXPANDED_NODE_WIDTH,
            MAX_EXPANDED_NODE_WIDTH,
          )),
          chartHeight: Math.round(clampDimension(
            startSize.chartHeight + moveEvent.clientY - startY,
            MIN_CHART_PANE_HEIGHT,
            MAX_CHART_PANE_HEIGHT,
          )),
        };

        setResizableSize(nextSize);
        updateNodeData({
          nodeWidth: nextSize.width,
          chartPaneHeight: nextSize.chartHeight,
        });
      };

      const handleUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [resizableSize, updateNodeData],
  );

  const handleLabelChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      updateNodeData({ label: event.target.value });
    },
    [updateNodeData],
  );

  const handleFunctionGroupCodeChange = useCallback(
    (group: OutputChartGroup, value: string | undefined) => {
      const nextCode = value || "";
      const groupBlockIds = new Set(group.models.map((model) => model.block.id));
      const shouldUpdateNodeCode = group.origin === "node" || group.id.startsWith("fn-");
      const returnInfo = extractReturnedObjectInfo(nextCode);
      const returnedKeys = returnInfo ? new Set(returnInfo.keys) : null;
      const removedBlockIds = new Set<string>();
      const nextOutputBlocks = outputBlocks.map((block) => {
        if (!groupBlockIds.has(block.id)) return block;
        return {
          ...block,
          type: "output" as const,
          formulaCode: nextCode,
          outputMode: "formula",
          functionCodeGroupId: group.id,
          functionCodeName: group.label,
        };
      }).filter((block) => {
        if (!groupBlockIds.has(block.id) || !returnedKeys) return true;
        const shouldKeep = returnedKeys.has(block.name);
        if (!shouldKeep) removedBlockIds.add(block.id);
        return shouldKeep;
      });

      if (removedBlockIds.has(selectedOutputId ?? "")) {
        setSelectedOutputId(nextOutputBlocks.find((block) => !isTriggerDataBlock(block))?.id ?? null);
      }
      if (removedBlockIds.has(codeOutputId ?? "")) {
        setCodeOutputId(nextOutputBlocks.find((block) => !isTriggerDataBlock(block))?.id ?? null);
      }

      updateNodeData({
        outputBlocks: nextOutputBlocks,
        ...(shouldUpdateNodeCode ? { code: nextCode } : {}),
      } as Partial<FunctionNodeData>);
    },
    [codeOutputId, outputBlocks, selectedOutputId, updateNodeData],
  );

  const handleBlockChange = useCallback(
    (blockType: "input" | "output", blockId: string, patch: Partial<BlockData>) => {
      if (blockType === "output") {
        const currentBlock = outputBlocks.find((block) => block.id === blockId);
        const nextPatch: Partial<IndicatorOutputBlock> = { ...patch, type: "output" };
        if (
          currentBlock &&
          typeof patch.name === "string" &&
          (!currentBlock.condition || currentBlock.condition.metric === currentBlock.name)
        ) {
          nextPatch.condition = {
            ...(currentBlock.condition ?? getDefaultCondition(currentBlock.name)),
            metric: patch.name,
          };
        }
        updateOutputBlock(blockId, nextPatch);
        return;
      }

      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      const currentBlocks = inputBlocks;
      updateNodeData({
        [key]: currentBlocks.map((block) =>
          block.id === blockId ? { ...block, ...patch } : block,
        ),
      } as Partial<FunctionNodeData>);
    },
    [inputBlocks, outputBlocks, updateNodeData, updateOutputBlock],
  );

  const handleAddBlock = useCallback(
    (blockType: "input" | "output") => {
      const key = blockType === "input" ? "inputBlocks" : "outputBlocks";
      const currentBlocks = blockType === "input" ? inputBlocks : outputBlocks;
      if (blockType === "output") {
        const cloneSource = outputBlocks.filter((block) => !isTriggerDataBlock(block)).at(-1) ?? DEFAULT_OUTPUT_BLOCK;
        const nextBlock = createOutputBlockClone(cloneSource as IndicatorOutputBlock, outputBlocks.length);
        setSelectedOutputId(nextBlock.id);
        updateNodeData({
          outputBlocks: [...outputBlocks, nextBlock],
        } as Partial<FunctionNodeData>);
        return;
      }

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

  const removeOutputBlock = useCallback(
    (blockId: string) => {
      const targetBlock = outputBlocks.find((block) => block.id === blockId);
      if (!targetBlock) return;

      const group = outputChartGroups.find((item) => item.models.some((model) => model.block.id === blockId)) ?? null;
      const shouldUpdateNodeCode = Boolean(group && (group.origin === "node" || group.id.startsWith("fn-")));
      const currentCode = group
        ? getFunctionGroupCode(group, typeof data.code === "string" ? data.code : "")
        : typeof data.code === "string" ? data.code : "";
      const nextCode = currentCode ? removeReturnObjectProperty(currentCode, targetBlock.name) : currentCode;
      const groupBlockIds = new Set(group?.models.map((model) => model.block.id) ?? []);
      const nextBlocks = outputBlocks
        .filter((block) => block.id !== blockId)
        .map((block) => {
          if (!group || !groupBlockIds.has(block.id) || nextCode === currentCode) return block;
          return {
            ...block,
            formulaCode: nextCode,
            functionCodeGroupId: group.id,
            functionCodeName: group.label,
          };
        });

      const nextSelectedId = nextBlocks.find((block) => !isTriggerDataBlock(block))?.id ?? null;
      if (selectedOutputId === blockId) setSelectedOutputId(nextSelectedId);
      if (codeOutputId === blockId) setCodeOutputId(nextSelectedId);
      updateNodeData({
        outputBlocks: nextBlocks,
        ...(shouldUpdateNodeCode && nextCode !== currentCode ? { code: nextCode } : {}),
      } as Partial<FunctionNodeData>);
    },
    [codeOutputId, data.code, outputBlocks, outputChartGroups, selectedOutputId, updateNodeData],
  );

  const handleRequestRemoveOutputBlock = useCallback(
    (blockId: string) => {
      const targetBlock = outputBlocks.find((block) => block.id === blockId);
      const group = outputChartGroups.find((item) => item.models.some((model) => model.block.id === blockId)) ?? null;
      if (!targetBlock || !group) {
        removeOutputBlock(blockId);
        return;
      }

      const groupCode = getFunctionGroupCode(group, typeof data.code === "string" ? data.code : "");
      const returnCount = extractReturnedObjectInfo(groupCode)?.keys.length ?? group.models.length;
      if (returnCount > 1) {
        setPendingOutputDelete({
          blockId,
          blockName: targetBlock.name,
          groupLabel: group.label,
          returnCount,
        });
        return;
      }

      removeOutputBlock(blockId);
    },
    [data.code, outputBlocks, outputChartGroups, removeOutputBlock],
  );

  const handleRemoveBlock = useCallback(
    (blockType: "input" | "output", blockId: string) => {
      if (blockType === "output") {
        handleRequestRemoveOutputBlock(blockId);
        return;
      }

      if (inputBlocks.length <= 1) return;
      updateNodeData({
        inputBlocks: inputBlocks.filter((block) => block.id !== blockId),
      } as Partial<FunctionNodeData>);
    },
    [handleRequestRemoveOutputBlock, inputBlocks, updateNodeData],
  );

  const handleConfirmPendingOutputDelete = useCallback(() => {
    if (!pendingOutputDelete) return;
    removeOutputBlock(pendingOutputDelete.blockId);
    setPendingOutputDelete(null);
  }, [pendingOutputDelete, removeOutputBlock]);

  const handleCancelPendingOutputDelete = useCallback(() => {
    setPendingOutputDelete(null);
  }, []);

  useEffect(() => {
    if (!pendingOutputDelete) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleConfirmPendingOutputDelete();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelPendingOutputDelete();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleCancelPendingOutputDelete, handleConfirmPendingOutputDelete, pendingOutputDelete]);

  const handleConditionChange = useCallback(
    (patch: Partial<IndicatorCondition>) => {
      const nextCondition = {
        ...condition,
        ...patch,
      };
      if (!patch.label) {
        delete nextCondition.label;
      }
      if (!selectedOutput) {
        updateNodeData({ condition: nextCondition });
        return;
      }
      updateOutputBlock(selectedOutput.block.id, { condition: nextCondition });
    },
    [condition, selectedOutput, updateNodeData, updateOutputBlock],
  );

  const handleOutputConditionOperatorCycle = useCallback(
    (model: OutputChartModel, controlId = "primary") => {
      setSelectedOutputId(model.block.id);
      const currentControls = model.conditionControls.length > 0
        ? model.conditionControls
        : [{ id: "primary", condition: model.condition }];
      const nextControls = currentControls.map((control) =>
        control.id === controlId
          ? {
            ...control,
            condition: {
              ...control.condition,
              metric: control.condition.metric || model.block.name,
              operator: getNextConditionOperator(control.condition.operator),
            },
          }
          : control,
      );
      const primaryCondition = nextControls[0]?.condition ?? model.condition;
      updateOutputBlock(model.block.id, {
        showConditionControl: true,
        condition: primaryCondition,
        conditionControls: nextControls,
      });
    },
    [updateOutputBlock],
  );

  const handleConditionThresholdDragStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, model: OutputChartModel, controlId = "primary") => {
      event.preventDefault();
      event.stopPropagation();

      const paneElement = event.currentTarget.closest("[data-chart-pane]") as HTMLElement | null;
      if (!paneElement) return;

      setSelectedOutputId(model.block.id);
      const currentControls = model.conditionControls.length > 0
        ? model.conditionControls
        : [{ id: "primary", condition: model.condition }];
      const currentThresholds = currentControls.map((control) => Number(control.condition.threshold));

      const updateThreshold = (clientY: number) => {
        const threshold = getChartValueFromClientY(
          clientY,
          paneElement,
          model.series,
          currentThresholds,
        );
        const nextControls = currentControls.map((control) =>
          control.id === controlId
            ? {
              ...control,
              condition: {
                ...control.condition,
                metric: control.condition.metric || model.block.name,
                threshold,
              },
            }
            : control,
        );
        const primaryCondition = nextControls[0]?.condition ?? model.condition;
        updateOutputBlock(model.block.id, {
          showConditionControl: true,
          condition: primaryCondition,
          conditionControls: nextControls,
        });
        window.requestAnimationFrame(() => updateNodeInternals(id));
      };

      updateThreshold(event.clientY);

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: MouseEvent) => {
        updateThreshold(moveEvent.clientY);
      };

      const handleUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [id, updateNodeInternals, updateOutputBlock],
  );

  const handleCreateDexAction = useCallback(
    (model: OutputChartModel, clientPoint?: CanvasPoint) => {
      if (model.isBooleanChart) {
        const sourceHandleId = getThresholdControlHandleId(id, model.block.id, "primary");
        const condition = {
          ...getDefaultBooleanCondition(model.block.name),
          metric: model.condition.metric || model.block.name,
        };

        setSelectedOutputId(model.block.id);

        window.requestAnimationFrame(() => {
          updateNodeInternals(id);
        });

        window.dispatchEvent(
          new CustomEvent("createThresholdActionNode", {
            detail: {
              sourceNodeId: id,
              sourceHandleId,
              sourceHandleIds: [sourceHandleId],
              clientPoint,
              outputBlockId: model.block.id,
              blockName: model.block.name,
              chartIndex: model.index,
              condition,
              conditions: [condition],
              directSignal: true,
            },
          }),
        );
        return;
      }

      const existingControls = model.conditionControls.length > 0
        ? model.conditionControls
        : [];
      const nextControls = existingControls.length === 0
        ? [{ id: "primary", condition: { ...model.condition, metric: model.condition.metric || model.block.name } }]
        : existingControls.length === 1
          ? [
            existingControls[0],
            { id: "range-2", condition: createRangeMateCondition(existingControls[0].condition) },
          ]
          : existingControls;
      const primaryCondition = nextControls[0]?.condition ?? model.condition;
      const sourceHandleIds = nextControls.map((control) =>
        getThresholdControlHandleId(id, model.block.id, control.id),
      );

      setSelectedOutputId(model.block.id);
      updateOutputBlock(model.block.id, {
        showConditionControl: true,
        condition: primaryCondition,
        conditionControls: nextControls,
      });

      window.requestAnimationFrame(() => {
        updateNodeInternals(id);
      });

      window.dispatchEvent(
        new CustomEvent("createThresholdActionNode", {
          detail: {
            sourceNodeId: id,
            sourceHandleId: sourceHandleIds[0],
            sourceHandleIds,
            clientPoint,
            outputBlockId: model.block.id,
            blockName: model.block.name,
            chartIndex: model.index,
            condition: primaryCondition,
            conditions: nextControls.map((control) => control.condition),
            mergeMode: nextControls.length > 1 ? "AND" : undefined,
          },
        }),
      );
    },
    [id, updateNodeInternals, updateOutputBlock],
  );

  const handleCreateConditionControl = useCallback(
    (model: OutputChartModel, clientPoint?: CanvasPoint) => {
      handleCreateDexAction(model, clientPoint);
    },
    [handleCreateDexAction],
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
              {primaryOutputChart?.block.name ?? primaryOutput.name}
              {outputChartModels.length > 1 ? ` +${outputChartModels.length - 1}` : ""}
            </div>
            <div
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-bold",
                conditionMet ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
              )}
            >
              {formatOutputValue(latestValue, primaryOutputChart?.isBooleanChart ?? false)}
            </div>
          </div>
          <div className="h-[132px] overflow-hidden rounded-md border border-slate-100 dark:border-slate-700">
            <MetricChart
              series={chartSeries}
              condition={primaryThresholdConditions[0]}
              conditions={primaryThresholdConditions}
              comparisonValues={primaryOutputChart?.visibleChartComparisonValues ?? []}
              compact
              height={132}
              source={primaryOutputChart?.chartSource ?? ""}
              updatedAt={primaryOutputChart?.chartUpdatedAt ?? ""}
              booleanMode={primaryOutputChart?.isBooleanChart ?? false}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
            <span
              className={cn("truncate", primaryOutputChart?.chartWarning && "text-amber-600")}
              title={primaryOutputChart?.chartWarning || primaryOutputChart?.chartSource}
            >
              {primaryOutputChart?.chartWarning ||
                primaryOutputChart?.chartSource ||
                (primaryOutputChart?.showChartComparison ? getConditionLabel(primaryOutputChart.condition) : "비교 표시 꺼짐")}
              {primaryOutputChart?.showChartComparison && primaryOutputChart.chartComparisonValues.length > 0
                ? ` + ${primaryOutputChart.chartComparisonValues.length}`
                : ""}
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
        "relative min-w-[620px] overflow-hidden rounded-lg border-2 bg-white shadow-2xl transition-all",
        selected ? "border-emerald-400" : "border-slate-300",
      )}
      style={{ width: resizableSize.width }}
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
            title={viewMode === "code" ? "선택한 함수 그룹을 차트로 보기" : "선택한 함수 그룹 코드 편집"}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors",
              viewMode === "code"
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100",
            )}
          >
            {viewMode === "code" ? <BarChart3 className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            {viewMode === "code" ? "Chart" : "Code"}
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
          <div
            ref={chartPaneContainerRef}
            className="nodrag nopan nowheel flex flex-col overflow-hidden border-b border-slate-800 bg-slate-950 text-slate-100"
            style={{ height: resizableSize.chartHeight }}
          >
            {outputChartGroups.map((group, groupIndex) => {
              const activeGroupKey = (codeOutputGroup ?? selectedOutputGroup)?.key;
              const isCodeGroup = viewMode === "code" && activeGroupKey === group.key;
              const hasBracket = group.models.length > 1;
              const groupWeight = group.models.reduce((sum, model) => {
                const modelIndex = outputChartModels.findIndex((item) => item.block.id === model.block.id);
                return sum + (chartPaneWeightList[modelIndex] ?? 1);
              }, 0) || 1;
              const groupCode = runtimeCode || getFunctionGroupCode(group, typeof data.code === "string" ? data.code : "");
              const lastModel = group.models[group.models.length - 1];
              const boundaryIndex = outputChartModels.findIndex((model) => model.block.id === lastModel?.block.id);

              return (
                <Fragment key={group.key}>
                  <div
                    className={cn(
                      "relative flex min-h-[96px] min-w-0 flex-col",
                      hasBracket && "pl-5",
                    )}
                    style={{ flexGrow: groupWeight, flexBasis: 0 }}
                  >
                    {hasBracket ? <FunctionCodeBracket label={group.label} /> : null}
                    {isCodeGroup ? (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l border-[#2b3139] bg-[#1e1e1e]">
                        <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate rounded bg-[#f0b90b]/20 px-2 py-1 text-[10px] font-black text-[#fcd535]">
                              {group.label}
                            </span>
                            {group.models.length > 1 ? (
                              <span className="truncate rounded bg-[#2b3139] px-2 py-1 text-[9px] font-black text-[#b7bdc6]">
                                {group.models.map((model) => model.block.name).join(", ")}
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCodeOutputId(null);
                              setViewMode("node");
                              updateNodeData({ viewMode: "node" });
                            }}
                            className="rounded border border-[#2b3139] bg-[#0b0e11] p-1.5 text-[#b7bdc6] hover:border-[#f0b90b] hover:text-[#fcd535]"
                            title="이 함수 그룹을 차트로 보기"
                          >
                            <BarChart3 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="min-h-0 flex-1">
                          <MonacoEditor
                            height="100%"
                            language={runtimeCode ? "go" : "javascript"}
                            theme="vs-dark"
                            value={groupCode}
                            onChange={(value) => handleFunctionGroupCodeChange(group, value)}
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
                      </div>
                    ) : group.models.map((model, groupModelIndex) => {
                      const index = outputChartModels.findIndex((item) => item.block.id === model.block.id);
                      const isFocusedPane = selectedOutput?.block.id === model.block.id;
                      const isActivePane = isFocusedPane;
                      const conditionControls = model.conditionControls;
                      const controlThresholds = conditionControls.map((control) => Number(control.condition.threshold));
                      const sourceHandleIds = conditionControls.map((control) =>
                        getThresholdControlHandleId(id, model.block.id, control.id),
                      );
                      const hasConditionAction = edges.some(
                        (edge) => edge.source === id && sourceHandleIds.includes(edge.sourceHandle ?? "") && Boolean(getNode(edge.target)),
                      );
                      const canAddThresholdControl = conditionControls.length < 2;
                      const thresholdConditions = model.showConditionControl
                        ? conditionControls.length > 0
                          ? conditionControls.map((control) => control.condition)
                          : [model.condition]
                        : [];
                      const booleanSignalHandleId = model.isBooleanChart
                        ? getThresholdControlHandleId(id, model.block.id, "primary")
                        : null;

                      return (
                        <Fragment key={model.block.id}>
                          <div
                            className="flex min-h-[96px] min-w-0 flex-col"
                            style={{ flexGrow: chartPaneWeightList[index] ?? 1, flexBasis: 0 }}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              aria-pressed={isFocusedPane}
                              className={cn(
                                "relative min-h-0 flex-1 overflow-hidden outline-none",
                                isActivePane && "ring-1 ring-inset ring-[#f0b90b]",
                              )}
                              onClick={() => setSelectedOutputId(model.block.id)}
                              onFocus={() => setSelectedOutputId(model.block.id)}
                              data-chart-pane
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedOutputId(model.block.id);
                                }
                              }}
                            >
                              <>
                        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[62%] items-center gap-2">
                          <span className={cn(
                            "truncate rounded bg-slate-950/70 px-2 py-1 text-[10px] font-black text-slate-100 backdrop-blur",
                            isActivePane && "bg-[#f0b90b]/20 text-[#fcd535]",
                          )}>
                            {model.block.name}
                          </span>
                          {model.block.outputMode === "passthrough" ? (
                            <span className="rounded bg-blue-400/20 px-2 py-1 text-[9px] font-black text-blue-100 backdrop-blur">
                              passthrough
                            </span>
                          ) : null}
                          {model.chartWarning ? (
                            <span className="truncate rounded bg-amber-400/20 px-2 py-1 text-[9px] font-black text-amber-100 backdrop-blur">
                              {model.chartWarning}
                            </span>
                          ) : null}
                        </div>

                        <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-2">
                          <div className="rounded bg-slate-950/70 px-2 py-1 text-right backdrop-blur">
                            <div className="font-mono text-[12px] font-black text-slate-50">
                              {formatOutputValue(model.latestValue, model.isBooleanChart)}
                            </div>
                            <div className={cn("text-[9px] font-black", model.conditionMet ? "text-emerald-300" : "text-slate-400")}>
                              {model.conditionMet ? "true" : "false"}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedOutputId(model.block.id);
                              setCodeOutputId(model.block.id);
                              setViewMode("code");
                              updateNodeData({ viewMode: "code" });
                            }}
                            className="pointer-events-auto rounded border border-[#2b3139] bg-[#0b0e11]/85 p-1.5 text-[#b7bdc6] backdrop-blur hover:border-[#f0b90b] hover:text-[#fcd535]"
                            title="같은 함수 그룹 코드 편집"
                          >
                            <Code2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {booleanSignalHandleId ? (
                          <Handle
                            type="source"
                            position={Position.Right}
                            id={booleanSignalHandleId}
                            className="!h-2.5 !w-2.5 !border-[#0ecb81] !bg-[#0ecb81]"
                            style={{
                              right: -5,
                              top: "50%",
                            }}
                          />
                        ) : null}

                        {conditionControls.map((control) => {
                          const thresholdTopPercent = getThresholdTopPercent(
                            model.series,
                            Number(control.condition.threshold),
                            controlThresholds,
                          );
                          const triggerHandleId = getThresholdControlHandleId(id, model.block.id, control.id);

                          return (
                            <Handle
                              key={triggerHandleId}
                              type="source"
                              position={Position.Right}
                              id={triggerHandleId}
                              className="!h-2 !w-2 !border-[#fcd535] !bg-[#f0b90b]"
                              style={{
                                right: -5,
                                top: `${thresholdTopPercent}%`,
                              }}
                            />
                          );
                        })}

                        {conditionControls.length > 0 ? (
                          <>
                            {conditionControls.map((control) => {
                              const thresholdTopPercent = getThresholdTopPercent(
                                model.series,
                                Number(control.condition.threshold),
                                controlThresholds,
                              );

                              return (
                                <div key={control.id}>
                                  <div
                                    className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-[#f0b90b]/55"
                                    style={{ top: `${thresholdTopPercent}%` }}
                                  />
                                  <div
                                    className="absolute right-2 z-30 flex h-6 -translate-y-1/2 items-center gap-1 rounded bg-[#0b0e11]/88 px-1.5 py-0.5 shadow-sm backdrop-blur"
                                    style={{ top: `${thresholdTopPercent}%` }}
                                  >
                                    <div
                                      className="h-4 w-1 cursor-ns-resize rounded bg-[#f0b90b]/40 transition-colors hover:bg-[#f0b90b]/70"
                                      onMouseDown={(event) => handleConditionThresholdDragStart(event, model, control.id)}
                                      title="드래그해서 trigger formula 우측값 조절"
                                    />
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleOutputConditionOperatorCycle(model, control.id);
                                      }}
                                      className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded text-[12px] font-black leading-none text-[#fcd535] hover:bg-[#f0b90b]/25"
                                      title={`${control.condition.operator} 방향 전환`}
                                    >
                                      {CONDITION_OPERATOR_GLYPHS[control.condition.operator]}
                                    </button>
                                    <div className="pointer-events-none min-w-[45px] text-right font-mono text-[10px] font-black text-slate-50">
                                      {formatValue(Number(control.condition.threshold))}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {canAddThresholdControl ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCreateDexAction(model, { x: event.clientX, y: event.clientY });
                                }}
                                className="absolute right-2 z-30 flex h-5 w-5 translate-y-[18px] items-center justify-center rounded border border-[#f0b90b]/55 bg-[#0b0e11]/88 text-[#fcd535] shadow-sm backdrop-blur hover:border-[#0ecb81] hover:text-[#0ecb81]"
                                style={{
                                  top: `${getThresholdTopPercent(
                                    model.series,
                                    Number(conditionControls[conditionControls.length - 1]?.condition.threshold ?? model.condition.threshold),
                                    controlThresholds,
                                  )}%`,
                                }}
                                title={hasConditionAction ? "두 번째 threshold control 추가" : "이 threshold yes 조건으로 action 생성"}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCreateConditionControl(model, { x: event.clientX, y: event.clientY });
                            }}
                            className="absolute right-2 top-1/2 z-30 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded border border-[#f0b90b]/55 bg-[#0b0e11]/88 text-[#fcd535] shadow-sm backdrop-blur hover:border-[#fcd535] hover:text-white"
                            title={model.isBooleanChart ? "YES 신호로 action 생성" : "threshold control 생성"}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        )}

                        <MetricChart
                          series={model.series}
                          condition={thresholdConditions[0]}
                          conditions={thresholdConditions}
                          comparisonValues={model.visibleChartComparisonValues}
                          height={160}
                          source={model.chartSource}
                          updatedAt={model.chartUpdatedAt}
                          showStats={false}
                          showVolume={false}
                          frameless
                          isFocused={isActivePane}
                          booleanMode={model.isBooleanChart}
                        />
                              </>
                            </div>
                          </div>
                          {groupModelIndex < group.models.length - 1 ? (
                            <div
                              role="separator"
                              aria-orientation="horizontal"
                              className="group h-2 shrink-0 cursor-row-resize bg-slate-900"
                              onMouseDown={(event) => handleChartPaneResizeStart(event, index)}
                            >
                              <div className="mx-auto h-full w-full border-y border-[#2b3139] bg-[#181a20] transition-colors group-hover:border-[#f0b90b] group-hover:bg-[#f0b90b]/20" />
                            </div>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </div>
                  {groupIndex < outputChartGroups.length - 1 ? (
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      className="group h-2 shrink-0 cursor-row-resize bg-slate-900"
                      onMouseDown={(event) => handleChartPaneResizeStart(event, boundaryIndex)}
                    >
                      <div className="mx-auto h-full w-full border-y border-[#2b3139] bg-[#181a20] transition-colors group-hover:border-[#f0b90b] group-hover:bg-[#f0b90b]/20" />
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
            {outputChartModels.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-400">
                output block을 추가하면 여기에 차트가 생성됩니다.
              </div>
            ) : null}
          </div>

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
                  title="위 output block의 formula와 차트 설정을 복제합니다"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                {visibleOutputBlocks.map((block) => {
                  const outputBlock = block as IndicatorOutputBlock;
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
                        selectedOutput?.block.id === block.id && "ring-2 ring-emerald-300",
                      )}
                      onClick={() => {
                        if (!isTriggerOutput) setSelectedOutputId(block.id);
                      }}
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
                            className="w-full bg-transparent pr-10 text-xs font-semibold text-emerald-900 outline-none"
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
                          <div className="mt-1 flex items-center gap-1">
                            {outputBlock.outputMode === "passthrough" ? (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-black text-blue-700">
                                passthrough
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedOutputId(block.id);
                                setCodeOutputId(block.id);
                                setViewMode("code");
                                updateNodeData({ viewMode: "code" });
                              }}
                              className="rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 hover:bg-white"
                              title="같은 함수 그룹 코드 편집"
                            >
                              code
                            </button>
                          </div>
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

          {shouldShowTriggerFormulaPanel ? (
            <div className="border-b border-slate-200 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              Trigger Formula · {selectedOutput?.block.name ?? primaryOutput.name}
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
                    showSelectedChartComparison
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                  )}
                  title={showSelectedChartComparison ? "비교값 차트 표시 끄기" : "비교값 차트 표시 켜기"}
                  aria-pressed={showSelectedChartComparison}
                >
                  {showSelectedChartComparison ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
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
                    selectedOutput?.conditionMet ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
                  )}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {selectedOutput?.conditionMet ? "True" : "False"}
                </div>
              </div>

              {selectedChartComparisonValues.map((item) => (
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
          ) : null}
        </div>
      {pendingOutputDelete ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-delete-output-title`}
        >
          <div className="nodrag nopan w-[360px] rounded-md border border-[#f0b90b]/50 bg-[#181a20] p-4 text-[#eaecef] shadow-[0_18px_60px_rgba(0,0,0,0.42)]">
            <div id={`${id}-delete-output-title`} className="text-sm font-black text-[#fcd535]">
              반환값 삭제 확인
            </div>
            <div className="mt-2 text-xs font-semibold leading-5 text-[#b7bdc6]">
              `{pendingOutputDelete.groupLabel}` 함수는 반환값 {pendingOutputDelete.returnCount}개를 가지고 있습니다.
              `{pendingOutputDelete.blockName}` output을 삭제하면 해당 반환값과 차트도 같이 삭제됩니다.
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelPendingOutputDelete}
                className="h-8 rounded-md border border-[#2b3139] bg-[#0b0e11] px-3 text-xs font-black text-[#b7bdc6] hover:border-[#848e9c] hover:text-[#eaecef]"
              >
                취소 Esc
              </button>
              <button
                type="button"
                autoFocus
                onClick={handleConfirmPendingOutputDelete}
                className="h-8 rounded-md bg-[#f0b90b] px-3 text-xs font-black text-[#0b0e11] hover:bg-[#fcd535]"
              >
                OK Enter
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        role="separator"
        aria-orientation="horizontal"
        className="nodrag nopan absolute bottom-0 right-0 z-30 h-5 w-5 cursor-nwse-resize rounded-tl-md border-l border-t border-[#2b3139] bg-[#181a20]/95 text-[#848e9c] shadow-sm transition-colors hover:border-[#f0b90b] hover:text-[#fcd535]"
        onMouseDown={handleNodeResizeStart}
        title="인디케이터 블록 크기 조절"
      >
        <div className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-current" />
      </div>
    </div>
  );
}

export const FunctionNode = memo(FunctionNodeComponent);
