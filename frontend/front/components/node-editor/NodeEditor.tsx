"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
  FinalConnectionState,
  BackgroundVariant,
  OnConnectStartParams,
  Panel,
  SelectionMode,
  NodeTypes,
  EdgeTypes,
  Node,
  Edge,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  useNodesInitialized,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FunctionNode } from "./FunctionNode";
import { TimeTriggerNode } from "./TimeTriggerNode";
import { ClickTriggerNode } from "./ClickTriggerNode";
import { BranchNode } from "./BranchNode";
import { BlockNode } from "./BlockNode";
import { ActionNode } from "./ActionNode";
import { MergedFunctionNode } from "./MergedFunctionNode";
import { TimelineFrame } from "./TimelineFrame";
import { MonitoringNode } from "./MonitoringNode";
import { TerminalPanel } from "./TerminalPanel";
import { GroupNode } from "./GroupNode";
import { StreamingNode } from "./StreamingNode";
import { withExplanation } from "./withExplanation";
import { getLayoutedElements } from "./layout";
import { CustomEdge } from "./CustomEdge";
import { DelayEdge } from "./DelayEdge";
import { FSMEdge } from "./FSMEdge";
import { FSMProvider, useFSM } from "./FSMContext";
import { Toolbar } from "./Toolbar";
import { ContextMenu } from "./ContextMenu";
import type { FunctionNodeData, TimeTriggerData, ClickTriggerData, BranchNodeData, CEXActionData, DEXActionData, ActionNodeData, MergedFunctionNodeData, TimelineFrameData, MonitoringNodeData, StreamingNodeData, NodeChartPoint, BlockData } from "./types";
import { cn } from "@/lib/utils";
import { historyStore } from "@/lib/historyStore";
import { getEtfDcaStrategyNodes, getPepeHedgeStrategyNodes } from "@/lib/demo-data";
import {
  createBinanceFuturesUserDataStreamData,
  createBinanceSpotPriceStreamData,
} from "@/lib/binance-demo-api";

const nodeTypes: NodeTypes = {
  functionNode: withExplanation(FunctionNode),
  timeTrigger: withExplanation(TimeTriggerNode),
  clickTrigger: withExplanation(ClickTriggerNode),
  branchNode: withExplanation(BranchNode),
  block: withExplanation(BlockNode),
  actionNode: withExplanation(ActionNode),
  mergedFunction: withExplanation(MergedFunctionNode),
  timelineFrame: withExplanation(TimelineFrame),
  monitoringNode: withExplanation(MonitoringNode),
  groupNode: withExplanation(GroupNode),
  streamingNode: withExplanation(StreamingNode),
};

const edgeTypes: EdgeTypes = {
  custom: CustomEdge,
  delay: DelayEdge,
  fsmEdge: FSMEdge,
};

const defaultEdgeOptions = {
  type: "custom",
  animated: false,
  style: {
    strokeWidth: 3,
  },
};

function isBlockToInputConnection(params: Pick<Connection, "sourceHandle" | "targetHandle">) {
  return Boolean(
    isConnectableSourceHandle(params.sourceHandle) &&
    isInputBlockTargetHandle(params.targetHandle)
  );
}

function isOutputBlockSourceHandle(sourceHandle?: string | null) {
  return Boolean(sourceHandle?.includes("-block-") && sourceHandle.endsWith("-out"));
}

function isControlSourceHandle(sourceHandle?: string | null) {
  return Boolean(
    sourceHandle?.endsWith("-trigger-out") ||
    sourceHandle?.includes("-branch-") && sourceHandle.endsWith("-out") ||
    sourceHandle?.endsWith("-success-out")
  );
}

function isConnectableSourceHandle(sourceHandle?: string | null) {
  return isOutputBlockSourceHandle(sourceHandle) || isControlSourceHandle(sourceHandle);
}

function isInputBlockTargetHandle(targetHandle?: string | null) {
  return Boolean(
    (targetHandle?.includes("-input-") || targetHandle?.includes("-block-")) &&
    targetHandle.endsWith("-in")
  );
}

function isExecutionTargetHandle(targetHandle?: string | null) {
  return Boolean(
    targetHandle?.endsWith("-func-in") ||
    targetHandle?.endsWith("-branch-in") ||
    targetHandle?.endsWith("-trigger-in") ||
    targetHandle?.endsWith("-monitor-in")
  );
}

function isConnectableTargetHandle(targetHandle?: string | null) {
  return isInputBlockTargetHandle(targetHandle) || isExecutionTargetHandle(targetHandle);
}

function canPromoteExecutionTargetToInput(targetNode: Node | undefined, targetHandle?: string | null) {
  return Boolean(
    targetNode &&
    isExecutionTargetHandle(targetHandle) &&
    ["functionNode", "actionNode", "branchNode", "mergedFunction"].includes(targetNode.type ?? ""),
  );
}

function normalizeConnectionDirection(params: Connection) {
  if (isConnectableSourceHandle(params.sourceHandle) && isConnectableTargetHandle(params.targetHandle)) {
    return params;
  }
  return null;
}

function isAllowedEditorConnection(params: Pick<Connection, "source" | "target" | "sourceHandle" | "targetHandle">) {
  return Boolean(
    params.source &&
    params.target &&
    params.source !== params.target &&
    isConnectableSourceHandle(params.sourceHandle) &&
    isConnectableTargetHandle(params.targetHandle)
  );
}

function isOutputBlockEdge(edge: Pick<Edge, "sourceHandle">) {
  return isOutputBlockSourceHandle(edge.sourceHandle);
}

function getHandleBlockId(handle?: string | null, direction: "source" | "target" = "source") {
  const suffix = direction === "source" ? "-out" : "-in";
  const pattern = direction === "source" ? /-block-(.+)-out$/ : /-(?:input|block)-(.+)-in$/;
  if (!handle?.endsWith(suffix)) return "";
  return handle.match(pattern)?.[1] ?? "";
}

function sanitizeHandlePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "input";
}

function getNodeDisplayName(node?: Node) {
  if (!node) return "source";
  const data = node.data as { label?: string; functionName?: string; title?: string; name?: string };
  return data.label || data.functionName || data.title || data.name || node.id;
}

function getSourceSignalName(sourceNode: Node | undefined, sourceHandle?: string | null) {
  if (!sourceNode) return "signal";

  if (isOutputBlockSourceHandle(sourceHandle)) {
    return getHandleBlockId(sourceHandle, "source") || "output";
  }

  if (sourceHandle?.endsWith("-success-out")) {
    return "success";
  }

  if (sourceHandle?.endsWith("-trigger-out")) {
    if (sourceNode.type === "clickTrigger") return "click";
    if (sourceNode.type === "timeTrigger") return "tick";
    if (sourceNode.type === "streamingNode") return "stream";
    return "trigger";
  }

  const branchId = sourceHandle?.match(/-branch-(.+)-out$/)?.[1];
  if (branchId) {
    const branches = (sourceNode.data as { branches?: Array<{ id: string; name: string }> })?.branches ?? [];
    return branches.find((branch) => branch.id === branchId)?.name || branchId;
  }

  return "signal";
}

function getOutputBlockForHandle(sourceNode: Node | undefined, sourceHandle?: string | null) {
  const blockId = getHandleBlockId(sourceHandle, "source");
  const outputBlocks = (sourceNode?.data as { outputBlocks?: Array<{ id: string; name: string; description?: string; type: "output" }> })?.outputBlocks ?? [];
  return outputBlocks.find((block) => block.id === blockId) ?? null;
}

function getInputBlockForHandle(targetNode: Node | undefined, targetHandle?: string | null) {
  const blockId = getHandleBlockId(targetHandle, "target");
  const inputBlocks = (targetNode?.data as { inputBlocks?: Array<{ id: string; name: string; description?: string; type: "input" }> })?.inputBlocks ?? [];
  return inputBlocks.find((block) => block.id === blockId) ?? null;
}

function getFallbackInputBlocksForNode(node: Node, sourceBlockName: string): BlockData[] {
  if (node.type === "functionNode") {
    return [{ id: "source", name: "source", description: "차트 계산에 들어오는 스트림 또는 지표 블록", type: "input" }];
  }

  if (node.type === "branchNode") {
    return [{ id: "signal", name: "signal", description: "분기 판단에 들어오는 신호", type: "input" }];
  }

  if (node.type === "actionNode") {
    return [{ id: "signal", name: sourceBlockName || "signal", description: "실행에 사용할 입력 신호", type: "input" }];
  }

  if (node.type === "mergedFunction") {
    return [{ id: "source", name: "source", description: "병합 로직에 들어오는 입력", type: "input" }];
  }

  return [];
}

function getInputBlocksForNode(node: Node, sourceBlockName: string) {
  const data = node.data as { inputBlocks?: BlockData[] };
  return Array.isArray(data.inputBlocks) && data.inputBlocks.length > 0
    ? data.inputBlocks
    : getFallbackInputBlocksForNode(node, sourceBlockName);
}

function getTargetInputHandlePrefix(targetNode: Node, targetHandle?: string | null) {
  if (targetHandle?.includes("-block-") || targetNode.type === "mergedFunction") return "block";
  return "input";
}

function resolveActionInputFieldName(blockName: string, node: Node) {
  if (node.type !== "actionNode") return "";
  const normalized = blockName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const data = node.data as Partial<ActionNodeData>;
  const isPolymarket = String(data.exchange || "").toLowerCase().replace(/[\s._-]+/g, "") === "polymarket";

  if (/tokenid|outcometoken/.test(normalized)) return "tokenId";
  if (/price|limit/.test(normalized)) return "price";
  if (/symbol|market|pair|instrument/.test(normalized)) return "symbol";
  if (/side|direction/.test(normalized)) return "side";
  if (/size|qty|quantity|shares/.test(normalized)) return isPolymarket ? "size" : "amount";
  if (/amount|notional|quote|budget|value|usd|usdt/.test(normalized)) return "amount";
  if (/contract|address/.test(normalized)) return "contractAddress";

  return "";
}

function buildActionInputFieldPatch(targetNode: Node, inputBlock: BlockData, connectedFrom: string) {
  const fieldName = resolveActionInputFieldName(inputBlock.name, targetNode);
  if (!fieldName) return {};

  const currentValue = (targetNode.data as Record<string, unknown>)[fieldName];
  const nextValue = `{{${connectedFrom}}}`;
  if (currentValue === nextValue) return {};

  return { [fieldName]: nextValue };
}

function buildInputConnectionUpdate({
  sourceNode,
  targetNode,
  sourceHandle,
  targetHandle,
}: {
  sourceNode: Node;
  targetNode: Node;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}) {
  const sourceBlock = getOutputBlockForHandle(sourceNode, sourceHandle);
  const sourceNodeName = getNodeDisplayName(sourceNode);
  const sourceBlockName = sourceBlock?.name || getSourceSignalName(sourceNode, sourceHandle);
  const connectedFrom = `${sourceNodeName}.${sourceBlockName}`;
  const sourceDescription = sourceBlock?.description || `Connected from ${connectedFrom}`;
  const currentBlocks = getInputBlocksForNode(targetNode, sourceBlockName);
  if (currentBlocks.length === 0) return null;

  const targetNodeInputBlocks = (targetNode.data as { inputBlocks?: BlockData[] }).inputBlocks;
  const isUsingFallbackInputBlock = !Array.isArray(targetNodeInputBlocks) || targetNodeInputBlocks.length === 0;
  const requestedBlockId = getHandleBlockId(targetHandle, "target");
  const requestedBlock =
    currentBlocks.find((block) => block.id === requestedBlockId) ??
    (isUsingFallbackInputBlock && isExecutionTargetHandle(targetHandle) ? currentBlocks[0] : undefined);
  const existingBlock = currentBlocks.find((block) => block.connectedFrom === connectedFrom);
  const shouldAppend =
    targetHandle?.includes("append") ||
    !requestedBlock ||
    Boolean(requestedBlock.connectedFrom && requestedBlock.connectedFrom !== connectedFrom && !existingBlock);
  const targetBlockId = existingBlock?.id || (!shouldAppend && requestedBlock ? requestedBlock.id : `ib-${sanitizeHandlePart(sourceBlockName)}-${Date.now()}`);
  const nextInputBlock: BlockData = {
    ...(requestedBlock ?? {}),
    id: targetBlockId,
    name: requestedBlock && !isPlaceholderInputBlock(requestedBlock) ? requestedBlock.name : sourceBlockName,
    description: requestedBlock?.description || sourceDescription,
    type: "input",
    connectedFrom,
    connectedSourceNodeId: sourceNode.id,
    connectedSourceHandle: sourceHandle || "",
  };
  const hasTargetBlock = currentBlocks.some((block) => block.id === targetBlockId);
  const inputBlocks = hasTargetBlock
    ? currentBlocks.map((block) =>
      block.id === targetBlockId && (isPlaceholderInputBlock(block) || block.connectedFrom === connectedFrom || block.id === requestedBlockId)
        ? { ...block, ...nextInputBlock }
        : block,
    )
    : [...currentBlocks, nextInputBlock];
  const targetInputPrefix = getTargetInputHandlePrefix(targetNode, targetHandle);

  return {
    targetHandle: `${targetNode.id}-${targetInputPrefix}-${targetBlockId}-in`,
    inputBlocks,
    connectedFrom,
    nextInputBlock,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRuntimeSectionName(nodeType?: string) {
  switch (nodeType) {
    case "streamingNode":
      return "generatedStreams";
    case "timeTrigger":
      return "generatedTriggers";
    case "actionNode":
      return "generatedActions";
    case "monitoringNode":
      return "generatedMonitors";
    case "functionNode":
      return "generatedNormalConfigs";
    default:
      return "";
  }
}

function extractGeneratedProgramSnippet(programCode: string, node: Node) {
  const source = programCode.trim();
  if (!source || !node.id) return "";

  const lines = source.split(/\r?\n/);
  const quotedId = escapeRegExp(JSON.stringify(node.id));
  const blockPattern = new RegExp(`(?:ID\\s*:\\s*${quotedId}|${quotedId}\\s*:)`);
  const connectionPattern = new RegExp(`(?:FromID\\s*:\\s*${quotedId}|ToID\\s*:\\s*${quotedId})`);
  const sectionName = getRuntimeSectionName(String(node.type));
  const blockLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => blockPattern.test(line));
  const connectionLines = lines
    .map((line) => line)
    .filter((line) => connectionPattern.test(line));

  if (blockLines.length === 0 && connectionLines.length === 0) return "";

  const snippets: string[] = [];
  snippets.push(
    sectionName
      ? `// generated_strategy.go / ${sectionName} / node "${node.id}"`
      : `// generated_strategy.go / node "${node.id}"`,
  );

  blockLines.forEach(({ line, index }) => {
    if (sectionName && !snippets.some((item) => item.includes(`var ${sectionName}`))) {
      const sectionLine = lines.slice(0, index + 1).reverse().find((item) => item.includes(`var ${sectionName}`));
      if (sectionLine) snippets.push(sectionLine.trim());
    }
    snippets.push(line.trim());
  });

  if (connectionLines.length > 0) {
    snippets.push("");
    snippets.push("// connections touching this node");
    const connectionSectionLine = lines.find((line) => line.includes("var generatedConnections"));
    if (connectionSectionLine) snippets.push(connectionSectionLine.trim());
    connectionLines.slice(0, 8).forEach((line) => snippets.push(line.trim()));
  }

  return snippets.join("\n");
}

function enrichGraphWithRuntimeProgram(graph: NodeEditorInitialGraph, programCode = ""): NodeEditorInitialGraph {
  if (!programCode.trim()) return graph;

  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type === "groupNode") return node;
    const runtimeCode = extractGeneratedProgramSnippet(programCode, node);
    if (!runtimeCode || (node.data as { runtimeCode?: string })?.runtimeCode === runtimeCode) return node;
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        runtimeCode,
        runtimeCodeLabel: "generated_strategy.go",
      },
    };
  });

  return changed ? { ...graph, nodes } : graph;
}

function readNodeText(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeMarketSymbol(value: string) {
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/\.P$/i, "")
    .replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5,20}$/.test(cleaned) ? cleaned : "";
}

function inferNodeChartRequest(node: Node) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  const explicitSymbol = readNodeText(data, ["chartSymbol", "symbol", "market", "pair", "instrument"]);
  const endpoint = readNodeText(data, ["url", "sourceUrl", "endpoint", "apiReference"]);
  const label = readNodeText(data, ["label", "name", "title"]);
  const rawText = `${explicitSymbol} ${endpoint} ${label}`;
  const querySymbol = endpoint.match(/[?&]symbol=([A-Za-z0-9._/-]+)/i)?.[1] ?? "";
  const tickerMatch = rawText.match(/\b([A-Z]{2,12}(?:USDT|USD|BTC|ETH)(?:\.P)?)\b/i)?.[1] ?? "";
  const symbol = normalizeMarketSymbol(querySymbol || explicitSymbol || tickerMatch);
  if (!symbol) return null;

  const market = /perp|future|futures|swap|\.p\b|선물/i.test(rawText) ? "futures" : "spot";
  return { symbol, market };
}

function isWebSocketSource(value?: string) {
  return /^wss?:\/\//i.test(String(value || "").trim());
}

function isHTTPSource(value?: string) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isSampleableStreamSource(value?: string) {
  return isWebSocketSource(value) || isHTTPSource(value);
}

function toChartNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const STREAM_SAMPLE_PRICE_KEYS = [
  "result_dec",
  "result",
  "outputs::value",
  "outputs::amount",
  "outputs::price",
  "lastPrice",
  "price",
  "close",
  "markPrice",
  "indexPrice",
  "midPrice",
  "bidPrice",
  "askPrice",
  "value",
  "p",
  "c",
  "k::c",
];

function pickStreamSampleChartValue(values: Record<string, unknown>) {
  const entries = Object.entries(values);
  const findByKey = (target: string) => {
    const normalizedTarget = target.toLowerCase();
    return entries.find(([key]) => {
      const normalizedKey = key.toLowerCase();
      return normalizedKey === normalizedTarget || normalizedKey.endsWith(`::${normalizedTarget}`);
    });
  };

  for (const key of STREAM_SAMPLE_PRICE_KEYS) {
    const entry = findByKey(key);
    if (!entry) continue;
    const parsed = toChartNumber(entry[1]);
    if (parsed !== null) return { field: entry[0], value: parsed };
  }

  for (const [key, value] of entries) {
    const normalizedKey = key.toLowerCase();
    if (/time|timestamp|volume|qty|quantity|size|id|symbol|event|type/.test(normalizedKey)) {
      continue;
    }
    const parsed = toChartNumber(value);
    if (parsed !== null) return { field: key, value: parsed };
  }

  return null;
}

function buildStreamSampleChartPoint(payload: unknown): { point: NodeChartPoint; field: string } | null {
  const snapshot = payload && typeof payload === "object"
    ? (payload as { snapshot?: { timestamp?: unknown; values?: unknown } }).snapshot
    : null;
  const values = snapshot?.values && typeof snapshot.values === "object"
    ? snapshot.values as Record<string, unknown>
    : {};
  const selected = pickStreamSampleChartValue(values);
  if (!selected) return null;

  const parsedTimestamp = typeof snapshot?.timestamp === "string" ? Date.parse(snapshot.timestamp) : NaN;
  return {
    point: {
      time: Math.floor((Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now()) / 1000),
      value: selected.value,
    },
    field: selected.field,
  };
}

function chartSeriesEqual(left?: NodeChartPoint[], right?: NodeChartPoint[]) {
  if (!left || !right || left.length !== right.length) return false;
  if (left.length === 0) return right.length === 0;
  const firstLeft = left[0];
  const firstRight = right[0];
  const lastLeft = left[left.length - 1];
  const lastRight = right[right.length - 1];
  return (
    firstLeft.time === firstRight.time &&
    firstLeft.value === firstRight.value &&
    lastLeft.time === lastRight.time &&
    lastLeft.value === lastRight.value
  );
}

function alignSeries(seriesList: NodeChartPoint[][]) {
  const minLength = Math.min(...seriesList.map((series) => series.length));
  if (!Number.isFinite(minLength) || minLength <= 0) return [];
  return seriesList.map((series) => series.slice(series.length - minLength));
}

function movingAverageSeries(series: NodeChartPoint[], windowSize = 20) {
  return series.map((point, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = series.slice(start, index + 1);
    const average = window.reduce((sum, item) => sum + item.value, 0) / window.length;
    return { time: point.time, value: Number(average.toFixed(6)) };
  });
}

type ReactiveIncomingSeries = {
  node: Node;
  series: NodeChartPoint[];
  sourceBlockName?: string;
  targetInputName?: string;
};

type ReactiveFormulaResult = {
  series: NodeChartPoint[];
  source: string;
  warning?: string;
};

function sanitizeFormulaIdentifier(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_$]+/g, "_")
    .replace(/^([^a-zA-Z_$])/, "_$1")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned || "";
}

function uniquePushIdentifier(list: string[], value: string) {
  const cleaned = sanitizeFormulaIdentifier(value);
  if (cleaned && !list.includes(cleaned)) {
    list.push(cleaned);
  }
}

function getFunctionFormulaText(data: Record<string, unknown>, primaryOutputName = "") {
  const code = readNodeText(data, ["code", "formula", "expression", "logic"]);
  const candidates = [primaryOutputName, "result", "value", "signal", "basis", "spread", "metric"]
    .map((value) => sanitizeFormulaIdentifier(value))
    .filter(Boolean);

  if (code) {
    const returnMatch = code.match(/return\s+([^;{}\n]+)\s*;?/m);
    if (returnMatch?.[1]) return returnMatch[1].trim();

    for (const candidate of candidates) {
      const assignment = new RegExp(`(?:const|let|var)?\\s*${escapeRegExp(candidate)}\\s*=\\s*([^;\\n]+)`, "m").exec(code);
      if (assignment?.[1]) return assignment[1].trim();
    }

    const assignmentMatches = [...code.matchAll(/(?:const|let|var)?\s*[a-zA-Z_$][\w$]*\s*=\s*([^;\n]+)/g)];
    const lastAssignment = assignmentMatches[assignmentMatches.length - 1]?.[1]?.trim();
    if (lastAssignment) return lastAssignment;

    if (!/[{};]/.test(code) && /[+\-*/%()]/.test(code)) return code;
  }

  const description = readNodeText(data, ["logicDescription", "description"]);
  if (!/[{};]/.test(description) && /[+\-*/%()]/.test(description)) {
    return description;
  }

  return "";
}

const BLOCKED_FORMULA_TOKENS = /\b(?:window|document|globalThis|Function|eval|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|import|process|require|constructor|prototype|__proto__|this|new)\b|=>/;

function normalizeFormulaExpression(expression: string) {
  const trimmed = expression.trim();
  if (!trimmed || trimmed.length > 800) return "";
  if (BLOCKED_FORMULA_TOKENS.test(trimmed)) return "";
  return trimmed.replace(/\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\b/g, "$1_$2");
}

function buildReactiveInputAliases(input: ReactiveIncomingSeries, index: number) {
  const data = input.node.data as Record<string, unknown>;
  const aliases: string[] = [];
  uniquePushIdentifier(aliases, input.targetInputName || "");
  uniquePushIdentifier(aliases, input.sourceBlockName || "");
  uniquePushIdentifier(aliases, readNodeText(data, ["symbol", "market", "pair", "instrument", "chartSymbol"]));
  uniquePushIdentifier(aliases, readNodeText(data, ["label", "name", "title", "functionName"]));
  uniquePushIdentifier(aliases, input.node.id);
  uniquePushIdentifier(aliases, `input${index + 1}`);
  uniquePushIdentifier(aliases, `source${index + 1}`);
  if (index === 0) {
    uniquePushIdentifier(aliases, "source");
    uniquePushIdentifier(aliases, "x");
    uniquePushIdentifier(aliases, "a");
  }
  if (index === 1) {
    uniquePushIdentifier(aliases, "y");
    uniquePushIdentifier(aliases, "b");
  }
  return aliases;
}

function buildFormulaContext(inputs: ReactiveIncomingSeries[], values: number[]) {
  const context: Record<string, number> = {};
  inputs.forEach((input, index) => {
    const value = values[index] ?? 0;
    const aliases = buildReactiveInputAliases(input, index);
    aliases.forEach((alias) => {
      context[alias] = value;
      ["value", "price", "close", "lastPrice", "midPrice", "bidPrice", "askPrice"].forEach((field) => {
        context[`${alias}_${field}`] = value;
      });
    });
  });
  return context;
}

function compileFormulaEvaluator(expression: string) {
  const normalized = normalizeFormulaExpression(expression);
  if (!normalized) return null;

  return (context: Record<string, number>) => {
    const names = Object.keys(context).sort();
    const values = names.map((name) => context[name]);
    const evaluator = new Function(
      ...names,
      "abs",
      "min",
      "max",
      "sqrt",
      "pow",
      "log",
      "exp",
      "round",
      "floor",
      "ceil",
      `"use strict"; return (${normalized});`,
    ) as (...args: unknown[]) => unknown;
    return evaluator(
      ...values,
      Math.abs,
      Math.min,
      Math.max,
      Math.sqrt,
      Math.pow,
      Math.log,
      Math.exp,
      Math.round,
      Math.floor,
      Math.ceil,
    );
  };
}

function deriveFormulaChartSeries(node: Node, incoming: ReactiveIncomingSeries[]): ReactiveFormulaResult | null {
  const data = node.data as Record<string, unknown>;
  const outputBlocks = Array.isArray(data.outputBlocks) ? data.outputBlocks as BlockData[] : [];
  const primaryOutputName = outputBlocks[0]?.name || "value";
  const expression = getFunctionFormulaText(data, primaryOutputName);
  if (!expression) return null;

  const evaluator = compileFormulaEvaluator(expression);
  if (!evaluator) {
    return { series: [], source: "formula", warning: "chart formula is empty or blocked" };
  }

  const aligned = alignSeries(incoming.map((item) => item.series));
  if (aligned.length === 0) return null;

  const series: NodeChartPoint[] = [];
  let firstError = "";
  aligned[0].forEach((point, index) => {
    try {
      const values = aligned.map((item) => item[index]?.value ?? 0);
      const context = buildFormulaContext(incoming, values);
      const evaluated = evaluator(context);
      const value = toChartNumber(evaluated);
      if (value !== null) {
        series.push({ time: point.time, value: Number(value.toFixed(8)) });
      }
    } catch (error) {
      if (!firstError) {
        firstError = error instanceof Error ? error.message : "formula evaluation failed";
      }
    }
  });

  return {
    series,
    source: `formula: ${expression}`,
    warning: series.length > 0 ? "" : firstError || "formula did not return numeric values",
  };
}

function deriveFunctionChartSeries(node: Node, incoming: ReactiveIncomingSeries[]): ReactiveFormulaResult | null {
  if (incoming.length === 0) return null;
  const formulaResult = deriveFormulaChartSeries(node, incoming);
  if (formulaResult && formulaResult.series.length > 0) return formulaResult;

  const data = node.data as Record<string, unknown>;
  const text = [
    node.id,
    readNodeText(data, ["label", "name", "functionName", "description", "logicDescription", "code", "expression", "logic"]),
  ].join(" ").toLowerCase();

  if (incoming.length >= 2 && /basis|spread|gap|premium|차익|가격차|괴리|현선/.test(text)) {
    const ordered = [...incoming].sort((a, b) => {
      const aText = `${a.node.id} ${readNodeText(a.node.data as Record<string, unknown>, ["label", "name", "symbol", "market"])}`.toLowerCase();
      const bText = `${b.node.id} ${readNodeText(b.node.data as Record<string, unknown>, ["label", "name", "symbol", "market"])}`.toLowerCase();
      const score = (value: string) => (/perp|future|선물|\.p/.test(value) ? -1 : /spot|현물/.test(value) ? 1 : 0);
      return score(aText) - score(bText);
    });
    const aligned = alignSeries([ordered[0].series, ordered[1].series]);
    if (aligned.length < 2) return null;
    const [perp, spot] = aligned;
    return {
      series: perp.map((point, index) => ({
        time: point.time,
        value: Number((((point.value - spot[index].value) / Math.max(spot[index].value, 0.0000001)) * 100).toFixed(6)),
      })),
      source: "heuristic: basis spread",
      warning: formulaResult?.warning,
    };
  }

  if (/ma|moving average|sma|ema|이동평균|평균/.test(text)) {
    return {
      series: movingAverageSeries(incoming[0].series),
      source: "heuristic: moving average",
      warning: formulaResult?.warning,
    };
  }

  return {
    series: incoming[0].series,
    source: formulaResult?.warning ? "source passthrough" : "source",
    warning: formulaResult?.warning,
  };
}

function isPlaceholderInputBlock(block: { name?: string; connectedFrom?: unknown }) {
  return !block.connectedFrom && (!block.name || ["source", "input", "param"].includes(String(block.name).toLowerCase()));
}

function getClientPoint(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  if ("touches" in event && event.touches.length > 0) {
    const touch = event.touches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  const mouseEvent = event as MouseEvent;
  return { x: mouseEvent.clientX, y: mouseEvent.clientY };
}

const SEQUENCE_GROUP_TRANSITION =
  "width 420ms cubic-bezier(0.22,1,0.36,1), height 420ms cubic-bezier(0.22,1,0.36,1), box-shadow 280ms ease";
const SEQUENCE_LAYOUT_MOVE_DURATION_MS = 420;

function isStrategySequenceGroup(node: Node) {
  return node.type === "groupNode" && node.parentId === "g_strategy";
}

function isNodeInStrategyTree(node: Node, nodesById: Map<string, Node>) {
  let currentParentId = node.parentId;

  while (currentParentId) {
    if (currentParentId === "g_strategy") return true;
    currentParentId = nodesById.get(currentParentId)?.parentId;
  }

  return false;
}

function getCollectionSize(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function buildStrategyContentRelayoutSignature(nodes: Node[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return nodes
    .filter((node) => node.type !== "groupNode" && isNodeInStrategyTree(node, nodesById))
    .map((node) => {
      const data = (node.data ?? {}) as Record<string, unknown>;

      return [
        node.id,
        node.parentId ?? "",
        node.type ?? "",
        data.isExpanded ? "1" : "0",
        String(data.viewMode ?? ""),
        data.showCode ? "1" : "0",
        getCollectionSize(data.inputBlocks),
        getCollectionSize(data.outputBlocks),
        getCollectionSize(data.branches),
        getCollectionSize(data.timelineItems),
      ].join(":");
    })
    .sort()
    .join("|");
}

function collectDescendantIds(nodes: Node[], ancestorId: string) {
  const childrenByParent = new Map<string, string[]>();

  nodes.forEach((node) => {
    if (!node.parentId) return;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenByParent.set(node.parentId, siblings);
  });

  const descendants = new Set<string>();
  const queue = [...(childrenByParent.get(ancestorId) ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (descendants.has(currentId)) continue;
    descendants.add(currentId);
    queue.push(...(childrenByParent.get(currentId) ?? []));
  }

  return descendants;
}

function applyParentContainmentRules(inputNodes: Node[]) {
  return inputNodes.map((node) => {
    if (!node.parentId) {
      return {
        ...node,
        extent: undefined,
        expandParent: undefined,
      };
    }

    return {
      ...node,
      extent: "parent" as const,
      expandParent: true,
    };
  });
}

function applySequenceCollapsedState(inputNodes: Node[], inputEdges: Edge[]) {
  const containedNodes = applyParentContainmentRules(inputNodes);
  const decoratedNodes = containedNodes.map((node) => {
    if (!isStrategySequenceGroup(node)) return { ...node };

    return {
      ...node,
      style: {
        ...node.style,
        transition: SEQUENCE_GROUP_TRANSITION,
      },
    };
  });

  const hiddenNodeIds = new Set<string>();

  decoratedNodes.forEach((node) => {
    if (!isStrategySequenceGroup(node)) return;
    if (!(node.data as any)?.isCollapsed) return;

    collectDescendantIds(decoratedNodes, node.id).forEach((id) => hiddenNodeIds.add(id));
  });

  const nodes = decoratedNodes.map((node) => {
    const isHidden = hiddenNodeIds.has(node.id);

    return {
      ...node,
      hidden: isHidden,
      extent: isHidden ? undefined : node.extent,
      expandParent: isHidden ? undefined : node.expandParent,
    };
  });

  const edges = inputEdges.map((edge) => ({
    ...edge,
    hidden: hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target),
  }));

  return { nodes, edges };
}

const initialNodes: Node[] = [
  // --- GROUPS ---
  {
    id: "g_strategy",
    type: "groupNode",
    position: { x: 50, y: 50 },
    data: { label: "V2 유동성 봇 전략", styleType: "solid" } as any,
    style: { width: 1200, height: 750 },
  },
  {
    id: "g_init",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 50 },
    data: {
      label: "초기 진입 시퀸스 (Init)",
      styleType: "dashed-init",
      requiredStates: ["IDLE"],
      executingStates: ["IDLE"],
      isCollapsed: true,
      summaryWord: "진입",
      summaryEmoji: "🚀",
      summaryGlyph: "입",
      collapsedWidth: 196,
      collapsedHeight: 118,
    } as any,
    style: { width: 1100, height: 160 },
  },
  {
    id: "g_trigger1",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 220 },
    data: {
      label: "1시간 모니터링: 비율 맞춤 유동성 공급 (Trigger)",
      styleType: "dashed-trigger",
      requiredStates: ["ACTIVE"],
      executingStates: [],
      isCollapsed: true,
      summaryWord: "공급",
      summaryEmoji: "💧",
      summaryGlyph: "공",
      collapsedWidth: 196,
      collapsedHeight: 118,
    } as any,
    style: { width: 1100, height: 160 },
  },
  {
    id: "g_trigger2",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 390 },
    data: {
      label: "상시 모니터링: 위기 감지 리밸런싱 (Trigger)",
      styleType: "dashed-trigger",
      requiredStates: ["ACTIVE", "REBALANCING"],
      executingStates: ["REBALANCING"],
      isCollapsed: true,
      summaryWord: "조정",
      summaryEmoji: "⚖️",
      summaryGlyph: "조",
      collapsedWidth: 196,
      collapsedHeight: 118,
    } as any,
    style: { width: 1100, height: 160 },
  },
  {
    id: "g_emergency",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 560 },
    data: {
      label: "수동 긴급 종료 시퀸스 (Trigger)",
      styleType: "dashed-emergency",
      requiredStates: ["ACTIVE", "CLOSED"],
      executingStates: ["CLOSED"],
      isCollapsed: true,
      summaryWord: "정리",
      summaryEmoji: "🧯",
      summaryGlyph: "정",
      collapsedWidth: 196,
      collapsedHeight: 118,
    } as any,
    style: { width: 1100, height: 160 },
  },

  // --- INIT SEQUENCE (g_init) ---
  {
    id: "n_init_click",
    type: "clickTrigger",
    parentId: "g_init",
    position: { x: 20, y: 60 },
    data: { label: "리밸런싱 봇 시작", shortcut: null, isRecording: false } as any,
  },
  {
    id: "n_init_prepare",
    type: "functionNode",
    parentId: "g_init",
    position: { x: 300, y: 60 },
    data: {
      label: "기초자산 비율 재조정 (최소값 기준)",
      functionName: "prepareFunds()",
      inputBlocks: [],
      outputBlocks: [{ id: "out-1", name: "baseAsset", type: "output" }],
      viewMode: "node",
    } as any,
  },
  {
    id: "n_init_swap",
    type: "actionNode",
    parentId: "g_init",
    position: { x: 650, y: 40 },
    data: {
      label: "초과 USDT를 ETH로 스왑",
      actionType: "DEX",
      contractAddress: "swap",
      functionName: "swapUSDTtoETH()",
      chainId: 1,
      inputBlocks: [],
      outputBlocks: [{ id: "out-2", name: "success", type: "output" }],
      isExpanded: false,
    } as any,
  },
  {
    id: "n_init_execute",
    type: "actionNode",
    parentId: "g_init",
    position: { x: 950, y: 40 },
    data: {
      label: "실행: DEX 유동성 공급 + CEX 숏",
      actionType: "CEX",
      exchange: "Binance",
      symbol: "ETH/USDT",
      side: "SELL",
      orderType: "MARKET",
      inputBlocks: [],
      outputBlocks: [{ id: "out-3", name: "success", type: "output" }],
      isExpanded: false,
    } as any,
  },

  // --- TRIGGER 1 SEQUENCE (g_trigger1) ---
  {
    id: "n_t1_stream",
    type: "timeTrigger",
    parentId: "g_trigger1",
    position: { x: 20, y: 60 },
    data: { label: "데이터 감지 (1h)", interval: 3600, isActive: true } as any,
  },
  {
    id: "n_t1_branch",
    type: "branchNode",
    parentId: "g_trigger1",
    position: { x: 300, y: 60 },
    data: {
      label: "조건 대기: 양측 자금 비율 충족 시",
      branches: [{ id: "b1", name: "비율 충족 시", active: true }],
      inputBlocks: [],
    } as any,
  },
  {
    id: "n_t1_execute",
    type: "actionNode",
    parentId: "g_trigger1",
    position: { x: 650, y: 40 },
    data: {
      label: "실행: DEX 유동성 공급 + CEX 숏",
      actionType: "CEX",
      exchange: "Binance",
      symbol: "ETH/USDT",
      side: "SELL",
      orderType: "MARKET",
      inputBlocks: [],
      outputBlocks: [{ id: "out-t1", name: "success", type: "output" }],
      isExpanded: false,
    } as any,
  },

  // --- TRIGGER 2 SEQUENCE (g_trigger2) ---
  {
    id: "n_t2_stream",
    type: "timeTrigger",
    parentId: "g_trigger2",
    position: { x: 20, y: 60 },
    data: { label: "데이터 감지 (1h)", interval: 0, isActive: true } as any,
  },
  {
    id: "n_t2_branch",
    type: "branchNode",
    parentId: "g_trigger2",
    position: { x: 300, y: 60 },
    data: {
      label: "위기 감지: ETH 가격 10% 이상 상승 시",
      branches: [{ id: "b1", name: "상승 시", active: true }],
      inputBlocks: [],
    } as any,
  },
  {
    id: "n_t2_execute",
    type: "actionNode",
    parentId: "g_trigger2",
    position: { x: 650, y: 40 },
    data: {
      label: "실행: 델타 뉴트럴 재정렬",
      actionType: "CEX",
      exchange: "Binance",
      symbol: "ETH/USDT",
      side: "SELL",
      orderType: "MARKET",
      inputBlocks: [],
      outputBlocks: [{ id: "out-t2", name: "success", type: "output" }],
      isExpanded: false,
    } as any,
  },

  // --- EMERGENCY SEQUENCE (g_emergency) ---
  {
    id: "n_em_click",
    type: "clickTrigger",
    parentId: "g_emergency",
    position: { x: 20, y: 60 },
    data: { label: "긴급: 모든 포지션 종료", shortcut: null, isRecording: false } as any,
  },
  {
    id: "n_em_stream",
    type: "streamingNode",
    parentId: "g_emergency",
    position: { x: 240, y: 36 },
    data: createBinanceFuturesUserDataStreamData({
      label: "Binance 선물 포지션 스트림",
      outputBlocks: [
        { id: "short-qty", name: "ethShortQty", type: "output" },
        { id: "wallet-usdt", name: "futuresWalletUsdt", type: "output" },
      ],
    }) as any,
  },
  {
    id: "n_em_cex",
    type: "actionNode",
    parentId: "g_emergency",
    position: { x: 560, y: 40 },
    data: {
      label: "청산: Binance ETH 숏 전량 정리",
      actionType: "CEX",
      exchange: "Binance",
      symbol: "ETH/USDT",
      side: "BUY",
      orderType: "MARKET",
      amount: "{{Binance 선물 포지션 스트림.ethShortQty}}",
      amountType: "FIXED",
      inputBlocks: [
        { id: "ib-short-qty", name: "ethShortQty", type: "input" },
        { id: "ib-wallet-usdt", name: "futuresWalletUsdt", type: "input" },
      ],
      outputBlocks: [{ id: "out-em-cex", name: "positionsClosed", type: "output" }],
      isExpanded: false,
    } as any,
  },
  {
    id: "n_em_execute",
    type: "actionNode",
    parentId: "g_emergency",
    position: { x: 860, y: 40 },
    data: {
      label: "청산: LP 회수 및 전체 USDT 변환",
      actionType: "DEX",
      contractAddress: "swap",
      functionName: "liquidate()",
      chainId: 1,
      inputBlocks: [],
      outputBlocks: [{ id: "out-em", name: "success", type: "output" }],
      isExpanded: false,
    } as any,
  }
];

const initialEdges: Edge[] = [
  { id: "e_init_1", source: "n_init_click", target: "n_init_prepare", sourceHandle: "n_init_click-trigger-out", targetHandle: "n_init_prepare-func-in", type: "custom" },
  { id: "e_init_2", source: "n_init_prepare", target: "n_init_swap", sourceHandle: "n_init_prepare-block-out-1-out", targetHandle: "n_init_swap-func-in", type: "custom" },
  { id: "e_init_3", source: "n_init_swap", target: "n_init_execute", sourceHandle: "n_init_swap-block-out-2-out", targetHandle: "n_init_execute-func-in", type: "custom" },

  { id: "e_t1_1", source: "n_t1_stream", target: "n_t1_branch", sourceHandle: "n_t1_stream-trigger-out", targetHandle: "n_t1_branch-branch-in", type: "custom" },
  { id: "e_t1_2", source: "n_t1_branch", target: "n_t1_execute", sourceHandle: "n_t1_branch-branch-b1-out", targetHandle: "n_t1_execute-func-in", type: "custom" },

  { id: "e_t2_1", source: "n_t2_stream", target: "n_t2_branch", sourceHandle: "n_t2_stream-trigger-out", targetHandle: "n_t2_branch-branch-in", type: "custom" },
  { id: "e_t2_2", source: "n_t2_branch", target: "n_t2_execute", sourceHandle: "n_t2_branch-branch-b1-out", targetHandle: "n_t2_execute-func-in", type: "custom" },

  { id: "e_em_1", source: "n_em_click", target: "n_em_stream", sourceHandle: "n_em_click-trigger-out", targetHandle: "n_em_stream-func-in", type: "custom" },
  { id: "e_em_2", source: "n_em_stream", target: "n_em_cex", sourceHandle: "n_em_stream-trigger-out", targetHandle: "n_em_cex-func-in", type: "custom" },
  { id: "e_em_data1", source: "n_em_stream", target: "n_em_cex", sourceHandle: "n_em_stream-block-short-qty-out", targetHandle: "n_em_cex-input-ib-short-qty-in", type: "custom" },
  { id: "e_em_data2", source: "n_em_stream", target: "n_em_cex", sourceHandle: "n_em_stream-block-wallet-usdt-out", targetHandle: "n_em_cex-input-ib-wallet-usdt-in", type: "custom" },
  { id: "e_em_3", source: "n_em_cex", target: "n_em_execute", sourceHandle: "n_em_cex-success-out", targetHandle: "n_em_execute-func-in", type: "custom" },

  // --- FSM STATE TRANSITION EDGES ---
  // g_init 완료 → ACTIVE 상태 진입 (trigger1, trigger2 활성화)
  { id: "fsm-1", source: "g_init", target: "g_trigger1", sourceHandle: "g_init-fsm-source", targetHandle: "g_trigger1-fsm-target", type: "fsmEdge", data: { label: "완료 시 ACTIVE 진입", color: "#10b981" }, selectable: false, focusable: false, deletable: false } as any,
  { id: "fsm-2", source: "g_init", target: "g_trigger2", sourceHandle: "g_init-fsm-source", targetHandle: "g_trigger2-fsm-target", type: "fsmEdge", data: { label: "완료 시 ACTIVE 진입", color: "#10b981" }, selectable: false, focusable: false, deletable: false } as any,
  // 리밸런싱 완료 → ACTIVE 유지 (종료 아님)
  { id: "fsm-3", source: "g_trigger2", target: "g_trigger1", sourceHandle: "g_trigger2-fsm-source", targetHandle: "g_trigger1-fsm-target", type: "fsmEdge", data: { label: "재정렬 완료 → ACTIVE 유지", color: "#a78bfa" }, selectable: false, focusable: false, deletable: false } as any,
  // 긴급 종료는 ACTIVE 중 수동으로만 가능
  { id: "fsm-4", source: "g_trigger1", target: "g_emergency", sourceHandle: "g_trigger1-fsm-source", targetHandle: "g_emergency-fsm-target", type: "fsmEdge", data: { label: "ACTIVE 중 수동 종료 가능", color: "#ef4444" }, selectable: false, focusable: false, deletable: false } as any,
];

export interface FocusState {
  isActive: boolean;
  focusedNodeId: string | null;
  connectedNodeIds: string[];
  connectedEdgeIds: string[];
}

export type NodeEditorInitialGraph = {
  nodes: Node[];
  edges: Edge[];
};

type NodeEditorProps = {
  initialGraph?: NodeEditorInitialGraph | null;
  initialGraphVersion?: number;
  programCode?: string;
  previewMode?: boolean;
};

function NodeEditorInner({ initialGraph, initialGraphVersion = 0, programCode = "", previewMode = false }: NodeEditorProps) {
  const { fitView, getIntersectingNodes, getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { showFSMEdges, isAvailable, currentState } = useFSM();
  const nodesInitialized = useNodesInitialized();
  const initialSnapshot = useMemo(() => {
    if (initialGraph && initialGraph.nodes.length > 0) {
      return initialGraph;
    }
    if (previewMode) return null;
    const activeId = historyStore.getActiveId();
    return historyStore.getSnapshotById(activeId);
  }, [initialGraph, previewMode]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialSnapshot && initialSnapshot.nodes.length > 0 ? initialSnapshot.nodes : [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialSnapshot && initialSnapshot.nodes.length > 0 ? initialSnapshot.edges : [],
  );

  // Undo/Redo history
  const [history, setHistory] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>([
    { nodes: [], edges: [] },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  const isUndoRedoRef = useRef(false);
  const initLayoutRunRef = useRef(false);
  const [isSequenceLayoutAnimating, setIsSequenceLayoutAnimating] = useState(false);
  const sequenceLayoutAnimationTimerRef = useRef<number | null>(null);
  const sequenceRelayoutFrameRef = useRef<number | null>(null);
  const measuredSequenceRelayoutFrameRef = useRef<number | null>(null);
  const connectionStartRef = useRef<OnConnectStartParams | null>(null);
  const [focusState, setFocusState] = useState<FocusState>({
    isActive: false,
    focusedNodeId: null,
    connectedNodeIds: [],
    connectedEdgeIds: [],
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    selectedNodes: Node[];
  } | null>(null);
  const nodeIdRef = useRef(10);

  const [isTerminalOpen, setTerminalOpen] = useState(false);

  const clearPendingSequenceRelayout = useCallback(() => {
    if (sequenceRelayoutFrameRef.current !== null) {
      window.cancelAnimationFrame(sequenceRelayoutFrameRef.current);
      sequenceRelayoutFrameRef.current = null;
    }

    if (measuredSequenceRelayoutFrameRef.current !== null) {
      window.cancelAnimationFrame(measuredSequenceRelayoutFrameRef.current);
      measuredSequenceRelayoutFrameRef.current = null;
    }
  }, []);

  const startSequenceLayoutAnimation = useCallback(() => {
    if (sequenceLayoutAnimationTimerRef.current !== null) {
      window.clearTimeout(sequenceLayoutAnimationTimerRef.current);
    }

    setIsSequenceLayoutAnimating(true);
    sequenceLayoutAnimationTimerRef.current = window.setTimeout(() => {
      setIsSequenceLayoutAnimating(false);
      sequenceLayoutAnimationTimerRef.current = null;
    }, SEQUENCE_LAYOUT_MOVE_DURATION_MS);
  }, []);

  const applyMeasuredLayout = useCallback(
    (
      inputNodes: Node[],
      inputEdges: Edge[],
      options?: {
        animate?: boolean;
        fitView?: boolean;
        affectedNodeIds?: string[];
      },
    ) => {
      const normalized = applySequenceCollapsedState(inputNodes, inputEdges);
      const layoutedNodes = getLayoutedElements(normalized.nodes, normalized.edges, "LR");

      clearPendingSequenceRelayout();

      if (options?.animate) {
        startSequenceLayoutAnimation();
      }

      setNodes(layoutedNodes);
      setEdges(normalized.edges);

      const nodeIdsToRefresh = Array.from(
        new Set(
          options?.affectedNodeIds ??
          layoutedNodes.filter((node) => !node.hidden).map((node) => node.id),
        ),
      );

      sequenceRelayoutFrameRef.current = window.requestAnimationFrame(() => {
        sequenceRelayoutFrameRef.current = null;

        if (nodeIdsToRefresh.length > 0) {
          updateNodeInternals(nodeIdsToRefresh);
        }

        measuredSequenceRelayoutFrameRef.current = window.requestAnimationFrame(() => {
          measuredSequenceRelayoutFrameRef.current = null;

          const liveNodes = getNodes();
          const measuredNormalized = applySequenceCollapsedState(liveNodes, normalized.edges);
          const measuredLayoutedNodes = getLayoutedElements(
            measuredNormalized.nodes,
            measuredNormalized.edges,
            "LR",
          );

          setNodes(measuredLayoutedNodes);
          setEdges(measuredNormalized.edges);

          if (options?.fitView) {
            window.setTimeout(() => {
              fitView({ duration: 800, padding: 0.2 });
            }, 50);
          }
        });
      });
    },
    [
      clearPendingSequenceRelayout,
      fitView,
      getNodes,
      setEdges,
      setNodes,
      startSequenceLayoutAnimation,
      updateNodeInternals,
    ],
  );

  useEffect(() => {
    return () => {
      clearPendingSequenceRelayout();
      if (sequenceLayoutAnimationTimerRef.current !== null) {
        window.clearTimeout(sequenceLayoutAnimationTimerRef.current);
      }
    };
  }, [clearPendingSequenceRelayout]);

  // Derive monitoring nodes data for the Terminal
  const monitoringNodesData = useMemo(() => {
    const data: Record<string, MonitoringNodeData> = {};
    nodes.forEach((n) => {
      if (n.type === "monitoringNode") {
        data[n.id] = n.data as MonitoringNodeData;
      }
    });
    return data;
  }, [nodes]);

  const marketChartRequestPayload = useMemo(() => {
    const requests = nodes
      .filter((node) => node.type === "streamingNode")
      .map((node) => {
        const data = node.data as StreamingNodeData;
        if (data.streamKind && data.streamKind !== "url") return null;
        if (isSampleableStreamSource(data.url)) return null;
        const request = inferNodeChartRequest(node);
        return request ? { nodeId: node.id, ...request } : null;
      })
      .filter((item): item is { nodeId: string; symbol: string; market: string } => Boolean(item));

    const deduped = new Map<string, { nodeIds: string[]; symbol: string; market: string }>();
    requests.forEach((request) => {
      const key = `${request.market}:${request.symbol}`;
      const item = deduped.get(key);
      if (item) {
        item.nodeIds.push(request.nodeId);
        return;
      }
      deduped.set(key, { nodeIds: [request.nodeId], symbol: request.symbol, market: request.market });
    });

    return JSON.stringify(Array.from(deduped.values()));
  }, [nodes]);

  const streamSampleRequestPayload = useMemo(() => {
    const requests = nodes
      .filter((node) => node.type === "streamingNode")
      .map((node) => {
        const data = node.data as StreamingNodeData;
        const streamKind = data.streamKind ?? "url";
        if (streamKind === "evm-rpc") {
          if (!data.streamChain || !data.streamMethod) return null;
          return {
            nodeId: node.id,
            url: data.url,
            method: data.method,
            streamKind,
            streamChain: data.streamChain,
            streamMethod: data.streamMethod,
            streamParamsJson: data.streamParamsJson || "[]",
            responseSchema: data.responseSchema || "",
            fields: (data.outputBlocks ?? []).map((block) => block.name).filter(Boolean),
            intervalMs: data.intervalMs ?? 5000,
          };
        }
        if (!isSampleableStreamSource(data.url)) {
          return null;
        }
        return {
          nodeId: node.id,
          url: data.url,
          method: data.method,
          streamKind,
          streamChain: "",
          streamMethod: "",
          streamParamsJson: "",
          responseSchema: data.responseSchema || "",
          fields: (data.outputBlocks ?? []).map((block) => block.name).filter(Boolean),
          intervalMs: data.intervalMs ?? 5000,
        };
      })
      .filter((item): item is {
        nodeId: string;
        url: string;
        method: StreamingNodeData["method"];
        streamKind: NonNullable<StreamingNodeData["streamKind"]>;
        streamChain: string;
        streamMethod: string;
        streamParamsJson: string;
        responseSchema: string;
        fields: string[];
        intervalMs: number;
      } => Boolean(item));

    return JSON.stringify(requests);
  }, [nodes]);

  useEffect(() => {
    const requests = JSON.parse(marketChartRequestPayload) as Array<{ nodeIds: string[]; symbol: string; market: string }>;
    if (requests.length === 0) return;

    let cancelled = false;
    const loadCharts = async () => {
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const params = new URLSearchParams({
              symbol: request.symbol,
              market: request.market,
              interval: "1m",
              limit: "96",
            });
            const response = await fetch(`/api/market/chart?${params.toString()}`, { cache: "no-store" });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(String(payload?.message || payload?.error || "chart fetch failed"));
            const series = Array.isArray(payload?.series)
              ? payload.series
                .map((point: { time?: unknown; value?: unknown }) => ({
                  time: Number(point.time),
                  value: Number(point.value),
                }))
                .filter((point: NodeChartPoint) => Number.isFinite(point.time) && Number.isFinite(point.value))
              : [];
            return {
              ...request,
              ok: true,
              series,
              source: typeof payload?.source === "string" ? payload.source : "market chart",
              updatedAt: typeof payload?.updatedAt === "string" ? payload.updatedAt : new Date().toISOString(),
              warning: "",
            };
          } catch (error) {
            return {
              ...request,
              ok: false,
              series: [] as NodeChartPoint[],
              source: "",
              updatedAt: new Date().toISOString(),
              warning: error instanceof Error ? error.message : "chart fetch failed",
            };
          }
        }),
      );

      if (cancelled) return;

      setNodes((currentNodes) => {
        const seriesByStreamId = new Map<string, NodeChartPoint[]>();
        const metaByStreamId = new Map<string, { source: string; updatedAt: string; symbol: string; warning: string }>();
        results.forEach((result) => {
          result.nodeIds.forEach((nodeId) => {
            seriesByStreamId.set(nodeId, result.series);
            metaByStreamId.set(nodeId, {
              source: result.source,
              updatedAt: result.updatedAt,
              symbol: result.symbol,
              warning: result.warning,
            });
          });
        });

        let changed = false;
        const withStreamCharts = currentNodes.map((node) => {
          if (node.type !== "streamingNode") return node;
          const series = seriesByStreamId.get(node.id);
          const meta = metaByStreamId.get(node.id);
          if (!meta) return node;
          const currentData = node.data as StreamingNodeData;
          if (
            chartSeriesEqual(currentData.chartSeries, series) &&
            currentData.chartSource === meta.source &&
            currentData.chartWarning === meta.warning
          ) {
            return node;
          }
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              chartSeries: series,
              chartSource: meta.source,
              chartUpdatedAt: meta.updatedAt,
              chartSymbol: meta.symbol,
              chartWarning: meta.warning,
            },
          };
        });

        return changed ? withStreamCharts : currentNodes;
      });
    };

    void loadCharts();
    return () => {
      cancelled = true;
    };
  }, [edges, marketChartRequestPayload, setNodes]);

  useEffect(() => {
    const requests = JSON.parse(streamSampleRequestPayload) as Array<{
      nodeId: string;
      url: string;
      method: StreamingNodeData["method"];
      streamKind: NonNullable<StreamingNodeData["streamKind"]>;
      streamChain: string;
      streamMethod: string;
      streamParamsJson: string;
      responseSchema: string;
      fields: string[];
      intervalMs: number;
    }>;
    if (requests.length === 0) return;

    let cancelled = false;
    let inFlight = false;
    const intervalMs = Math.max(
      3000,
      Math.min(...requests.map((request) => Math.max(3000, Number(request.intervalMs) || 5000))),
    );

    const loadSamples = async () => {
      if (inFlight) return;
      inFlight = true;
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const response = await fetch("/api/stream/sample", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stream_kind: request.streamKind === "evm-rpc"
                  ? "evm-rpc"
                  : request.method === "WEBSOCKET" ? "websocket" : "url",
                source_url: request.url,
                stream_chain: request.streamChain,
                stream_method: request.streamMethod,
                stream_params_json: request.streamParamsJson,
                response_schema: request.responseSchema,
                fields: request.fields,
                timeout_ms: Math.min(8000, Math.max(3000, intervalMs - 250)),
              }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(String(payload?.message || payload?.error || "websocket sample failed"));
            const sample = buildStreamSampleChartPoint(payload);
            if (!sample) throw new Error("numeric price/value field not found in stream payload");
            return {
              ...request,
              ok: true,
              point: sample.point,
              field: sample.field,
              warning: "",
              updatedAt: typeof payload?.snapshot?.timestamp === "string" ? payload.snapshot.timestamp : new Date().toISOString(),
            };
          } catch (error) {
            return {
              ...request,
              ok: false,
              point: null as NodeChartPoint | null,
              field: "",
              warning: error instanceof Error ? error.message : "stream sample failed",
              updatedAt: new Date().toISOString(),
            };
          }
        }),
      ).finally(() => {
        inFlight = false;
      });

      if (cancelled) return;

      setNodes((currentNodes) => {
        const resultByNodeId = new Map(results.map((result) => [result.nodeId, result]));
        let changed = false;

        const nextNodes = currentNodes.map((node) => {
          if (node.type !== "streamingNode") return node;
          const result = resultByNodeId.get(node.id);
          if (!result) return node;
          const currentData = node.data as StreamingNodeData;

          if (!result.ok || !result.point) {
            if (currentData.chartWarning === result.warning) return node;
            changed = true;
            return {
              ...node,
              data: {
                ...node.data,
                chartWarning: result.warning,
                chartUpdatedAt: result.updatedAt,
              },
            };
          }

          const existing = Array.isArray(currentData.chartSeries) ? currentData.chartSeries : [];
          const last = existing[existing.length - 1];
          const point = { ...result.point };
          if (last && point.time <= last.time) {
            point.time = last.time + 1;
          }
          const series = existing.length === 0
            ? [{ time: point.time - 1, value: point.value }, point]
            : [...existing, point].slice(-96);

          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              chartSeries: series,
              chartSource: `${result.streamKind === "evm-rpc" ? "evm rpc" : result.method === "WEBSOCKET" ? "websocket" : "url"} sample: ${result.field}`,
              chartUpdatedAt: result.updatedAt,
              chartWarning: "",
            },
          };
        });

        return changed ? nextNodes : currentNodes;
      });
    };

    void loadSamples();
    const timer = window.setInterval(() => void loadSamples(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [streamSampleRequestPayload, setNodes]);

  useEffect(() => {
    const functionNodes = nodes.filter((node) => node.type === "functionNode");
    if (functionNodes.length === 0) return;

    setNodes((currentNodes) => {
      const nodeById = new Map(currentNodes.map((node) => [node.id, node]));
      const nextById = new Map(nodeById);
      let changed = false;

      for (let pass = 0; pass < Math.max(1, functionNodes.length); pass += 1) {
        let passChanged = false;

        for (const functionNode of functionNodes) {
          const currentFunctionNode = nextById.get(functionNode.id);
          if (!currentFunctionNode || currentFunctionNode.type !== "functionNode") continue;

          const incoming = edges
            .filter((edge) => edge.target === currentFunctionNode.id)
            .map((edge): ReactiveIncomingSeries | null => {
              const sourceNode = nextById.get(edge.source);
              if (!sourceNode) return null;
              const series = (sourceNode.data as { chartSeries?: NodeChartPoint[] })?.chartSeries ?? [];
              if (!Array.isArray(series) || series.length === 0) return null;
              return {
                node: sourceNode,
                series,
                sourceBlockName: getOutputBlockForHandle(sourceNode, edge.sourceHandle)?.name,
                targetInputName: getInputBlockForHandle(currentFunctionNode, edge.targetHandle)?.name,
              };
            })
            .filter((item): item is ReactiveIncomingSeries => Boolean(item));

          const result = deriveFunctionChartSeries(currentFunctionNode, incoming);
          if (!result) continue;

          const currentData = currentFunctionNode.data as FunctionNodeData;
          const nextSeries = result.series.length > 0 ? result.series : currentData.chartSeries;
          const seriesSame = result.series.length > 0
            ? chartSeriesEqual(currentData.chartSeries, nextSeries)
            : true;
          if (
            seriesSame &&
            currentData.chartSource === result.source &&
            (currentData.chartWarning || "") === (result.warning || "")
          ) {
            continue;
          }

          const updatedNode = {
            ...currentFunctionNode,
            data: {
              ...currentFunctionNode.data,
              chartSeries: nextSeries,
              chartSource: result.source,
              chartUpdatedAt: new Date().toISOString(),
              chartWarning: result.warning || "",
            },
          };
          nextById.set(currentFunctionNode.id, updatedNode);
          changed = true;
          passChanged = true;
        }

        if (!passChanged) break;
      }

      return changed ? currentNodes.map((node) => nextById.get(node.id) ?? node) : currentNodes;
    });
  }, [edges, nodes, setNodes]);

  const strategyContentRelayoutSignature = useMemo(
    () => buildStrategyContentRelayoutSignature(nodes),
    [nodes],
  );
  const strategyContentRelayoutSignatureRef = useRef<string | null>(null);
  const activeSnapshotPersistSignatureRef = useRef<string | null>(null);
  const loadedInitialGraphVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!initialGraph || initialGraph.nodes.length === 0) {
      return;
    }
    if (loadedInitialGraphVersionRef.current === initialGraphVersion) {
      return;
    }

    const runtimeGraph = enrichGraphWithRuntimeProgram(initialGraph, programCode);

    loadedInitialGraphVersionRef.current = initialGraphVersion;
    activeSnapshotPersistSignatureRef.current = JSON.stringify({
      nodes: runtimeGraph.nodes,
      edges: runtimeGraph.edges,
    });
    isUndoRedoRef.current = true;
    setHistory([{ nodes: runtimeGraph.nodes, edges: runtimeGraph.edges }]);
    historyIndexRef.current = 0;
    setHistoryIndex(0);
    applyMeasuredLayout(runtimeGraph.nodes, runtimeGraph.edges, { fitView: true });
  }, [applyMeasuredLayout, initialGraph, initialGraphVersion, programCode]);

  useEffect(() => {
    if (!programCode.trim()) return;
    setNodes((currentNodes) => {
      const enriched = enrichGraphWithRuntimeProgram({ nodes: currentNodes, edges }, programCode);
      return enriched.nodes;
    });
  }, [edges, programCode, setNodes]);

  // ─── Resize parent containers so they always wrap their children ────────
  const resizeParentsToFitChildren = useCallback(
    (nodeList: Node[]): Node[] => {
      const PADDING = 60;
      const nodeMap = new Map(nodeList.map(n => [n.id, n]));

      // Collect all parentIds that need recalculation
      const parentIds = new Set<string>();
      nodeList.forEach(n => { if (n.parentId) parentIds.add(n.parentId); });

      // Process from deepest → shallowest (leaf parents first)
      const sortedParentIds = [...parentIds].sort((a, b) => {
        // node deeper in tree first: count ancestors
        const depth = (id: string): number => {
          const n = nodeMap.get(id);
          return n?.parentId ? 1 + depth(n.parentId) : 0;
        };
        return depth(b) - depth(a);
      });

      let result = [...nodeList];
      sortedParentIds.forEach(parentId => {
        const children = result.filter(n => n.parentId === parentId);
        if (children.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        children.forEach(c => {
          const w = Number(c.measured?.width ?? c.style?.width ?? 300);
          const h = Number(c.measured?.height ?? c.style?.height ?? 120);
          minX = Math.min(minX, c.position.x);
          minY = Math.min(minY, c.position.y);
          maxX = Math.max(maxX, c.position.x + w);
          maxY = Math.max(maxY, c.position.y + h);
        });

        const newW = (maxX - minX) + PADDING * 2;
        const newH = (maxY - minY) + PADDING * 2;

        result = result.map(n => {
          if (n.id !== parentId) return n;
          const curW = Number(n.style?.width ?? 400);
          const curH = Number(n.style?.height ?? 300);
          if (newW <= curW && newH <= curH) return n; // only grow, never shrink
          return { ...n, style: { ...n.style, width: Math.max(curW, newW), height: Math.max(curH, newH) } };
        });
      });

      return result;
    },
    []
  );

  // Terminal toggle listener from MonitoringNodes
  useEffect(() => {
    const handleToggleTerminal = (e: CustomEvent<{ open?: boolean; monitoringNodeId?: string }>) => {
      if (typeof e.detail.open === "boolean") {
        setTerminalOpen(e.detail.open);
      } else {
        setTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener("toggleTerminal", handleToggleTerminal as EventListener);
    return () => window.removeEventListener("toggleTerminal", handleToggleTerminal as EventListener);
  }, []);

  // Calculate connected nodes and edges when focus changes
  // Also handles timeline internal action output handles.
  const getConnectedInfo = useCallback((nodeId: string) => {
    const connectedNodeIds: string[] = [];
    const connectedEdgeIds: string[] = [];

    edges.forEach((edge) => {
      // Direct connection to/from this node
      if (edge.source === nodeId || edge.target === nodeId) {
        connectedEdgeIds.push(edge.id);
        if (edge.source === nodeId) {
          connectedNodeIds.push(edge.target);
        } else {
          connectedNodeIds.push(edge.source);
        }
      }
      // Check if edge comes from a timeline's internal action handle
      // Handle format: ${timelineId}-block-${actionNodeId}-${blockId}-out
      if (edge.sourceHandle?.startsWith(`${nodeId}-`) && edge.source === nodeId) {
        connectedEdgeIds.push(edge.id);
        connectedNodeIds.push(edge.target);
      }
      // Check if edge goes to a timeline's internal action handle
      if (edge.targetHandle?.startsWith(`${nodeId}-`) && edge.target === nodeId) {
        connectedEdgeIds.push(edge.id);
        connectedNodeIds.push(edge.source);
      }
    });

    return {
      connectedNodeIds: [...new Set(connectedNodeIds)],
      connectedEdgeIds: [...new Set(connectedEdgeIds)],
    };
  }, [edges]);

  // Listen for focus events from nodes
  useEffect(() => {
    const handleFocusEvent = (e: CustomEvent<{ nodeId: string | null }>) => {
      if (e.detail.nodeId) {
        const { connectedNodeIds, connectedEdgeIds } = getConnectedInfo(e.detail.nodeId);
        setFocusState({
          isActive: true,
          focusedNodeId: e.detail.nodeId,
          connectedNodeIds,
          connectedEdgeIds,
        });
      } else {
        setFocusState({
          isActive: false,
          focusedNodeId: null,
          connectedNodeIds: [],
          connectedEdgeIds: [],
        });
      }
    };

    window.addEventListener("nodeFocus", handleFocusEvent as EventListener);
    return () => {
      window.removeEventListener("nodeFocus", handleFocusEvent as EventListener);
    };
  }, [getConnectedInfo]);

  // Save to history whenever nodes or edges change
  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }

    const nextHistoryIndex = historyIndexRef.current + 1;
    setHistory((prev) => {
      // Remove any future history if we're not at the end
      const newHistory = prev.slice(0, historyIndexRef.current + 1);
      // Add new state
      return [...newHistory, { nodes, edges }];
    });
    historyIndexRef.current = nextHistoryIndex;
    setHistoryIndex(nextHistoryIndex);
  }, [nodes, edges]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const { nodes: historyNodes, edges: historyEdges } = history[newIndex];

    isUndoRedoRef.current = true;
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    setNodes(historyNodes);
    setEdges(historyEdges);
  }, [historyIndex, history, setNodes, setEdges]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const { nodes: historyNodes, edges: historyEdges } = history[newIndex];

    isUndoRedoRef.current = true;
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    setNodes(historyNodes);
    setEdges(historyEdges);
  }, [historyIndex, history, setNodes, setEdges]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  // ESC key to close focus mode OR open History if nothing is focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusState.isActive) {
          setFocusState({
            isActive: false,
            focusedNodeId: null,
            connectedNodeIds: [],
            connectedEdgeIds: [],
          });
          setNodes((nds) =>
            nds.map((node) => ({
              ...node,
              data: { ...node.data, isExpanded: false },
            }))
          );
        } else {
          // If no focus, ESC opens the History Modal
          window.dispatchEvent(new CustomEvent("openStrategyHistoryModal"));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusState.isActive, setNodes]);

  // ------------------------------------------
  // Group Feature
  // ------------------------------------------
  const handleGroup = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length < 1) return;

    // 시퀀스들을 그룹화하면 전략(Strategy, solid), 일반 노드들을 그룹화하면 시퀀스(Sequence, dashed-trigger)
    const isStrategy = selectedNodes.some(n => n.type === "groupNode");
    const groupLabel = isStrategy ? "새로운 전략 (Strategy)" : "새로운 시퀀스 (Sequence)";
    const styleType = isStrategy ? "solid" : "dashed-trigger";

    const newGroupId = `group-${Date.now()}`;
    const selectedIds = new Set(selectedNodes.map(n => n.id));

    // Helper: get absolute position of a node (walking up the parentId chain)
    const getAbsPos = (nodeId: string): { x: number; y: number } => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return { x: 0, y: 0 };
      if (!node.parentId) return { ...node.position };
      const parentAbs = getAbsPos(node.parentId);
      return { x: parentAbs.x + node.position.x, y: parentAbs.y + node.position.y };
    };

    // Calculate bounding box using ABSOLUTE coordinates of selected nodes
    // (and their measured sizes). For strategy grouping we also include
    // the children that live inside selected sequences so sizing is accurate.
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    const includeNode = (nodeId: string) => {
      const n = nodes.find(nd => nd.id === nodeId);
      if (!n) return;
      const abs = getAbsPos(nodeId);
      const w = Number(n.measured?.width ?? n.style?.width ?? 300);
      const h = Number(n.measured?.height ?? n.style?.height ?? 120);
      minX = Math.min(minX, abs.x);
      minY = Math.min(minY, abs.y);
      maxX = Math.max(maxX, abs.x + w);
      maxY = Math.max(maxY, abs.y + h);
    };

    selectedNodes.forEach(n => {
      includeNode(n.id);
      // Also include their direct children so the wrapping box is big enough
      if (isStrategy) {
        nodes.forEach(child => {
          if (child.parentId === n.id) includeNode(child.id);
        });
      }
    });

    const padding = 60;
    const groupWidth = (maxX - minX) + padding * 2;
    const groupHeight = (maxY - minY) + padding * 2;

    const newGroupNode: Node = {
      id: newGroupId,
      type: "groupNode",
      position: { x: minX - padding, y: minY - padding },
      data: {
        label: groupLabel,
        styleType: styleType,
        explanation: `${groupLabel} 노드 집합입니다.`,
      } as any,
      style: { width: groupWidth, height: groupHeight },
    };

    setNodes((nds) => {
      // Only re-parent the directly selected nodes — do NOT touch their children.
      const groupedChildren = nds
        .filter(n => selectedIds.has(n.id))
        .map(n => {
          const abs = getAbsPos(n.id);
          return {
            ...n,
            parentId: newGroupId,
            extent: "parent" as const,
            expandParent: true,
            position: {
              x: abs.x - (minX - padding),
              y: abs.y - (minY - padding),
            },
            selected: false,
          };
        });

      const otherNodes = nds.filter(n => !selectedIds.has(n.id));
      return [...otherNodes, newGroupNode, ...groupedChildren];
    });

    // ── AI auto-summary for newly created SEQUENCE ─────────────────────
    if (!isStrategy) {
      // Collect node labels for context
      const nodeLabels = selectedNodes
        .map(n => (n.data as any)?.label || (n.data as any)?.functionName || n.id)
        .filter(Boolean);

      // Dummy AI summaries pool — rotate based on node count
      const dummySummaries = [
        `가격 모니터링 후 자동 실행: ${nodeLabels.join(" → ")} 순서로 실행되며, USDC/ETH 페어의 가격 변동을 실시간 감시하고 부충 조건 충족 시 자동 매수/매도 심호를 발송합니다.`,
        `유동성 리밸런싱 시퀀스: ${nodeLabels.join(", ")} 노드가 페어를 확인하고 명목 포지션 차이(delta)가 넘어졌을 때 LP에 다시 추가하여 슬리피지를 줄입니다.`,
        `연속 ${nodeLabels.length}단계 실행 파이프라인: 시장 신호 감지 → 조건 평가 → 주문 실행의 잊년없는 흐름으로 구성되어 있습니다. EMa 크로스오버 + 볼린저 스파이크 신호를 결합해 순간 진입 타이밍을 계산합니다.`,
        `리스크 관리 시퀀스: 변보성 ATR 기반 스톱로스 자동 조정, 노드 (${nodeLabels.join(" · ")})를 통해 PnL 누적 후 추의 취득 조정이 일어납니다.`,
      ];

      const summary = dummySummaries[nodeLabels.length % dummySummaries.length];

      // Animate a "typing" effect on the new group node’s explanation field
      const words = summary.split("");
      let built = "";
      let i = 0;
      const typeInterval = setInterval(() => {
        built += words[i++] || "";
        setNodes(nds =>
          nds.map(n =>
            n.id === newGroupId
              ? { ...n, data: { ...n.data, explanation: built + "▊" } }
              : n
          )
        );
        if (i >= words.length) {
          clearInterval(typeInterval);
          // finalise without cursor
          setNodes(nds =>
            nds.map(n =>
              n.id === newGroupId
                ? { ...n, data: { ...n.data, explanation: summary } }
                : n
            )
          );
        }
      }, 18);
    }

    setContextMenu(null);
  }, [nodes, setNodes]);

  // G-key shortcut: group selected nodes (placed after handleGroup declaration)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        handleGroup();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleGroup]);


  const handleAiExplain = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    const nodeLabels = selectedNodes.map(n => n.data?.label || n.data?.functionName || n.id).join(", ");

    // Trigger AI popup
    window.dispatchEvent(new CustomEvent("aiExplainGroup", { detail: { groupId: "multi-selection", label: `선택된 노드들 (${nodeLabels})` } }));
    setContextMenu(null);
  }, [nodes]);

  // Check if selected nodes can be merged
  const canMergeNodes = useCallback(
    (selectedNodes: Node[]): boolean => {
      // Need at least 2 function nodes
      const functionNodes = selectedNodes.filter(
        (n) => n.type === "functionNode"
      );
      if (functionNodes.length < 2) return false;

      // Check if they form a linear chain
      // For each pair, check if output of one connects only to input of the next
      const nodeIds = new Set(functionNodes.map((n) => n.id));

      for (const node of functionNodes) {
        const outgoingEdges = edges.filter(
          (e) =>
            e.source === node.id &&
            e.sourceHandle?.includes("-block-") &&
            e.sourceHandle?.includes("-out")
        );

        for (const edge of outgoingEdges) {
          // If this edge goes to a node outside the selection, can't merge
          if (!nodeIds.has(edge.target) && functionNodes.length > 1) {
            // Check if all outputs only go to nodes within selection
            const allTargets = edges
              .filter((e) => e.source === node.id)
              .map((e) => e.target);
            const hasExternalTarget = allTargets.some((t) => !nodeIds.has(t));
            if (hasExternalTarget && node !== functionNodes[functionNodes.length - 1]) {
              return false;
            }
          }
        }
      }

      return true;
    },
    [edges]
  );

  // Get the order of nodes in a linear chain
  const getNodeOrder = useCallback(
    (selectedNodes: Node[]): Node[] => {
      const functionNodes = selectedNodes.filter(
        (n) => n.type === "functionNode"
      );
      if (functionNodes.length === 0) return [];

      // Build adjacency map
      const nodeIds = new Set(functionNodes.map((n) => n.id));
      const adjacencyMap = new Map<string, string[]>();
      const incomingCount = new Map<string, number>();

      for (const node of functionNodes) {
        adjacencyMap.set(node.id, []);
        incomingCount.set(node.id, 0);
      }

      for (const edge of edges) {
        if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
          adjacencyMap.get(edge.source)?.push(edge.target);
          incomingCount.set(
            edge.target,
            (incomingCount.get(edge.target) || 0) + 1
          );
        }
      }

      // Find starting node (no incoming edges from within selection)
      const startNodes = functionNodes.filter(
        (n) => (incomingCount.get(n.id) || 0) === 0
      );
      if (startNodes.length !== 1) {
        // If multiple start points, sort by position
        return functionNodes.sort((a, b) => a.position.x - b.position.x);
      }

      // Topological sort
      const ordered: Node[] = [];
      const queue = [startNodes[0]];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        ordered.push(current);

        const nextIds = adjacencyMap.get(current.id) || [];
        for (const nextId of nextIds) {
          const nextNode = functionNodes.find((n) => n.id === nextId);
          if (nextNode && !visited.has(nextId)) {
            queue.push(nextNode);
          }
        }
      }

      return ordered;
    },
    [edges]
  );

  // Merge selected function nodes
  const handleMerge = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (!canMergeNodes(selectedNodes)) return;

    const orderedNodes = getNodeOrder(selectedNodes);
    const firstNode = orderedNodes[0];
    const lastNode = orderedNodes[orderedNodes.length - 1];

    // Collect internal edges (edges between selected nodes)
    const selectedIds = new Set(orderedNodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    );

    // Create merged node
    const mergedId = `merged-${Date.now()}`;
    const mergedNode: Node<MergedFunctionNodeData> = {
      id: mergedId,
      type: "mergedFunction",
      position: firstNode.position,
      data: {
        label: `Merged (${orderedNodes.length})`,
        mergedNodes: orderedNodes.map((n) => ({
          id: n.id,
          data: n.data as FunctionNodeData,
          position: n.position,
        })),
        internalEdges: internalEdges,
        inputBlocks: (firstNode.data as FunctionNodeData).inputBlocks || [],
        outputBlocks: (lastNode.data as FunctionNodeData).outputBlocks || [],
        isExpanded: false,
      },
    };

    // Update edges: redirect edges that pointed to/from merged nodes
    const newEdges = edges
      .filter((e) => !internalEdges.includes(e))
      .map((e) => {
        let newEdge = { ...e };

        // If edge targets first node's function input, redirect to merged node
        if (selectedIds.has(e.target)) {
          if (e.target === firstNode.id) {
            newEdge = {
              ...newEdge,
              target: mergedId,
              targetHandle: e.targetHandle?.replace(firstNode.id, mergedId),
            };
          } else {
            // This edge goes to a middle node - should be removed or handled
            return null;
          }
        }

        // If edge comes from last node's output, redirect from merged node
        if (selectedIds.has(e.source)) {
          if (e.source === lastNode.id) {
            newEdge = {
              ...newEdge,
              source: mergedId,
              sourceHandle: e.sourceHandle?.replace(lastNode.id, mergedId),
            };
          } else {
            // This edge comes from a middle node - should be removed
            return null;
          }
        }

        return newEdge;
      })
      .filter(Boolean) as Edge[];

    // Remove merged nodes and add new merged node
    setNodes((nds) => [
      ...nds.filter((n) => !selectedIds.has(n.id)),
      mergedNode,
    ]);
    setEdges(newEdges);
    setContextMenu(null);
  }, [nodes, edges, canMergeNodes, getNodeOrder, setNodes, setEdges]);

  // Unmerge a merged function node
  const handleUnmerge = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    const mergedNode = selectedNodes.find((n) => n.type === "mergedFunction");
    if (!mergedNode) return;

    const mergedData = mergedNode.data as MergedFunctionNodeData;

    // Restore original nodes
    const restoredNodes: Node[] = mergedData.mergedNodes.map((mn) => ({
      id: mn.id,
      type: "functionNode",
      position: {
        x: mergedNode.position.x + mn.position.x - mergedData.mergedNodes[0].position.x,
        y: mergedNode.position.y + mn.position.y - mergedData.mergedNodes[0].position.y,
      },
      data: mn.data,
    }));

    // Restore internal edges
    const restoredEdges = mergedData.internalEdges;

    // Update external edges
    const firstNodeId = mergedData.mergedNodes[0].id;
    const lastNodeId = mergedData.mergedNodes[mergedData.mergedNodes.length - 1].id;

    const newEdges = edges
      .filter((e) => e.source !== mergedNode.id && e.target !== mergedNode.id)
      .concat(
        edges
          .filter((e) => e.target === mergedNode.id)
          .map((e) => ({
            ...e,
            target: firstNodeId,
            targetHandle: e.targetHandle?.replace(mergedNode.id, firstNodeId),
          }))
      )
      .concat(
        edges
          .filter((e) => e.source === mergedNode.id)
          .map((e) => ({
            ...e,
            source: lastNodeId,
            sourceHandle: e.sourceHandle?.replace(mergedNode.id, lastNodeId),
          }))
      )
      .concat(restoredEdges);

    setNodes((nds) => [
      ...nds.filter((n) => n.id !== mergedNode.id),
      ...restoredNodes,
    ]);
    setEdges(newEdges);
    setContextMenu(null);
  }, [nodes, edges, setNodes, setEdges]);

  // Helper: check if a dragged node overlaps a timeline frame node
  const getOverlappingTimeline = useCallback(
    (draggedNode: Node) => {
      return nodes.find((n) => {
        if (n.type !== "timelineFrame" || n.id === draggedNode.id) return false;
        // Rough bounding box overlap check using positions
        const tlX = n.position.x;
        const tlY = n.position.y;
        const tlW = 250; // approximate collapsed width
        const tlH = 150; // approximate collapsed height
        const dX = draggedNode.position.x;
        const dY = draggedNode.position.y;
        return dX >= tlX - 20 && dX <= tlX + tlW && dY >= tlY - 20 && dY <= tlY + tlH;
      });
    },
    [nodes]
  );

  // Drag: emit hover event so timeline can show drop indicator
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.stopPropagation();
      const { connectedNodeIds, connectedEdgeIds } = getConnectedInfo(node.id);
      setFocusState({
        isActive: true,
        focusedNodeId: node.id,
        connectedNodeIds,
        connectedEdgeIds,
      });
    },
    [getConnectedInfo]
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    setFocusState({
      isActive: false,
      focusedNodeId: null,
      connectedNodeIds: [],
      connectedEdgeIds: [],
    });
  }, []);

  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      if (draggedNode.type !== "actionNode") return;
      const timeline = getOverlappingTimeline(draggedNode);
      window.dispatchEvent(
        new CustomEvent("dragOverTimeline", {
          detail: { timelineId: timeline?.id ?? null, dragging: !!timeline },
        })
      );
    },
    [getOverlappingTimeline]
  );

  // Drop: when drag ends over a timeline or group, reparent accordingly
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      // 1. Timeline drop check (action nodes only)
      if (draggedNode.type === "actionNode") {
        const timeline = getOverlappingTimeline(draggedNode);
        window.dispatchEvent(
          new CustomEvent("dragOverTimeline", { detail: { timelineId: null, dragging: false } })
        );
        if (timeline) {
          window.dispatchEvent(
            new CustomEvent("dropOnTimeline", {
              detail: {
                timelineId: timeline.id,
                actionNodeId: draggedNode.id,
                actionData: draggedNode.data,
              },
            })
          );
          setNodes((nds) => nds.filter((n) => n.id !== draggedNode.id));
          setEdges((eds) => eds.filter((e) => e.source !== draggedNode.id && e.target !== draggedNode.id));
          return;
        }
      }

      const allNodes = getNodes();

      const getAbsolutePosition = (nodeId: string): { x: number; y: number } => {
        const node = allNodes.find(n => n.id === nodeId);
        if (!node) return { x: 0, y: 0 };
        if (!node.parentId) return { ...node.position };
        const pAbs = getAbsolutePosition(node.parentId);
        return { x: pAbs.x + node.position.x, y: pAbs.y + node.position.y };
      };

      // 2. GroupNode drag: sequence→strategy reparenting
      if (draggedNode.type === "groupNode") {
        const intersections = getIntersectingNodes(draggedNode).filter(
          n => n.type === "groupNode" && n.id !== draggedNode.id
        );

        const draggedStyleType = (draggedNode.data as any)?.styleType;
        const candidateParent = intersections.find(n => {
          const s = (n.data as any)?.styleType;
          // sequence (dashed) can go into strategy (solid)
          // regular node can go into sequence
          if (draggedStyleType !== "solid") {
            return s === "solid";
          }
          return false;
        });

        if (candidateParent && draggedNode.parentId !== candidateParent.id) {
          const draggedAbs = getAbsolutePosition(draggedNode.id);
          const parentAbs = getAbsolutePosition(candidateParent.id);
          setNodes((nds) => {
            const updated = nds.map(n => {
              if (n.id !== draggedNode.id) return n;
              return {
                ...n,
                parentId: candidateParent.id,
                extent: "parent" as const,
                expandParent: true,
                position: {
                  x: draggedAbs.x - parentAbs.x,
                  y: draggedAbs.y - parentAbs.y,
                },
              };
            });
            return resizeParentsToFitChildren(updated);
          });
          return;
        }

        // Unparent if dropped outside all groups
        if (draggedNode.parentId && intersections.length === 0) {
          const draggedAbs = getAbsolutePosition(draggedNode.id);
          setNodes((nds) => nds.map(n => {
            if (n.id !== draggedNode.id) return n;
            return { ...n, parentId: undefined, extent: undefined, expandParent: undefined, position: draggedAbs };
          }));
        }
        return;
      }

      // 3. Non-groupNode drag: reparent into sequence on overlap
      const intersections = getIntersectingNodes(draggedNode).filter(n => n.type === "groupNode");

      if (intersections.length > 0) {
        // Prefer deepest group (innermost); for non-groupNodes prefer sequence over strategy
        const target =
          intersections.find(n => (n.data as any)?.styleType !== "solid") ??
          intersections[intersections.length - 1];

        if (draggedNode.parentId !== target.id) {
          const draggedAbs = getAbsolutePosition(draggedNode.id);
          const targetAbs = getAbsolutePosition(target.id);
          setNodes((nds) => {
            const updated = nds.map(n => {
              if (n.id !== draggedNode.id) return n;
              return {
                ...n,
                parentId: target.id,
                extent: "parent" as const,
                expandParent: true,
                position: { x: draggedAbs.x - targetAbs.x, y: draggedAbs.y - targetAbs.y },
              };
            });
            return resizeParentsToFitChildren(updated);
          });
        } else {
          // Already in the right parent — still resize in case position changed
          setNodes((nds) => resizeParentsToFitChildren(nds));
        }
      } else {
        // Unparent if dropped outside
        if (draggedNode.parentId) {
          const draggedAbs = getAbsolutePosition(draggedNode.id);
          setNodes((nds) => nds.map(n => {
            if (n.id !== draggedNode.id) return n;
            return { ...n, parentId: undefined, extent: undefined, expandParent: undefined, position: draggedAbs };
          }));
        }
      }
    },
    [getOverlappingTimeline, setNodes, setEdges, getIntersectingNodes, getNodes, resizeParentsToFitChildren]
  );

  // Context menu handler
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const selectedNodes = nodes.filter((n) => n.selected);
      if (selectedNodes.length === 0) {
        setContextMenu(null);
        return;
      }

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        selectedNodes,
      });
    },
    [nodes]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const normalizedParams = normalizeConnectionDirection(params);
      if (!normalizedParams || !isAllowedEditorConnection(normalizedParams)) {
        return;
      }

      const targetNode = nodes.find((n) => n.id === normalizedParams.target);
      const sourceNode = nodes.find((n) => n.id === normalizedParams.source);
      let nextParams: Connection = { ...normalizedParams };

      const shouldUseAsInput = Boolean(
        sourceNode &&
        targetNode &&
        isConnectableSourceHandle(nextParams.sourceHandle) &&
        (isInputBlockTargetHandle(nextParams.targetHandle) ||
          canPromoteExecutionTargetToInput(targetNode, nextParams.targetHandle)),
      );

      if (sourceNode && targetNode && shouldUseAsInput) {
        const inputUpdate = buildInputConnectionUpdate({
          sourceNode,
          targetNode,
          sourceHandle: nextParams.sourceHandle,
          targetHandle: nextParams.targetHandle,
        });

        if (inputUpdate) {
          nextParams = {
            ...nextParams,
            targetHandle: inputUpdate.targetHandle,
          };

          const actionFieldPatch = buildActionInputFieldPatch(
            targetNode,
            inputUpdate.nextInputBlock,
            inputUpdate.connectedFrom,
          );

          setNodes((nds) =>
            nds.map((node) => {
              if (node.id !== targetNode.id) return node;
              const nodeData = node.data as Record<string, unknown>;
              return {
                ...node,
                data: {
                  ...node.data,
                  ...actionFieldPatch,
                  ...(node.type === "actionNode" ? { isExpanded: true } : {}),
                  inputBlocks: inputUpdate.inputBlocks,
                  inputDescription: nodeData.inputDescription || `입력 데이터: ${inputUpdate.connectedFrom}`,
                },
              };
            }),
          );

          window.setTimeout(() => updateNodeInternals(targetNode.id), 0);
        }
      }

      const isActionTarget = targetNode?.type === "actionNode" || targetNode?.type === "timelineFrame";
      const isDataFlow = isBlockToInputConnection(nextParams);

      const edgeType = isActionTarget && !isDataFlow ? "delay" : "custom";
      const edgeData = isActionTarget && !isDataFlow ? { delay: 0, waitForResult: true } : {};

      const newEdgeId = `e-${nextParams.source}-${nextParams.target}-${Date.now()}`;
      setEdges((eds) => addEdge({ ...nextParams, id: newEdgeId, type: edgeType, data: edgeData }, eds));

      // ── Auto-reparent: if the OTHER end is inside a sequence (groupNode),
      //    move the unparented node into that same sequence ─────────────────
      const getAbsPos = (id: string, nds: Node[]): { x: number; y: number } => {
        const n = nds.find(nd => nd.id === id);
        if (!n) return { x: 0, y: 0 };
        if (!n.parentId) return { ...n.position };
        const pAbs = getAbsPos(n.parentId, nds);
        return { x: pAbs.x + n.position.x, y: pAbs.y + n.position.y };
      };

      setNodes((nds) => {
        // Determine which node is the "new" unparented one and which has a parent
        const src = nds.find(n => n.id === nextParams.source);
        const tgt = nds.find(n => n.id === nextParams.target);
        if (!src || !tgt) return nds;

        // Only reparent non-groupNode nodes
        const candidates: Array<{ mover: Node; anchor: Node }> = [];
        if (!src.parentId && tgt.parentId && src.type !== "groupNode") {
          candidates.push({ mover: src, anchor: tgt });
        } else if (!tgt.parentId && src.parentId && tgt.type !== "groupNode") {
          candidates.push({ mover: tgt, anchor: src });
        }

        if (candidates.length === 0) return nds;

        const { mover, anchor } = candidates[0];
        const targetParentId = anchor.parentId!;
        const targetParent = nds.find(n => n.id === targetParentId);
        // Only reparent into sequence (dashed) group nodes, not strategy (solid)
        if (!targetParent || (targetParent.data as any)?.styleType === "solid") return nds;

        const moverAbs = getAbsPos(mover.id, nds);
        const parentAbs = getAbsPos(targetParentId, nds);

        const updated: Node[] = nds.map(n => {
          if (n.id !== mover.id) return n;
          return {
            ...n,
            parentId: targetParentId,
            extent: "parent" as const,
            expandParent: true,
            position: {
              x: moverAbs.x - parentAbs.x,
              y: moverAbs.y - parentAbs.y,
            },
          };
        });

        return resizeParentsToFitChildren(updated);
      });

      // Auto-focus on the source node after connection
      if (sourceNode) {
        const connInfo = getConnectedInfo(sourceNode.id);
        const newConnectedNodeIds = [...connInfo.connectedNodeIds, normalizedParams.target].filter(Boolean) as string[];
        const newConnectedEdgeIds = [...connInfo.connectedEdgeIds, newEdgeId];
        setFocusState({
          isActive: true,
          focusedNodeId: sourceNode.id,
          connectedNodeIds: [...new Set(newConnectedNodeIds)],
          connectedEdgeIds: [...new Set(newConnectedEdgeIds)],
        });
        setNodes((nds) =>
          nds.map((node) => ({
            ...node,
            data: { ...node.data, isExpanded: node.id === sourceNode.id },
          }))
        );
      }
    },
    [setEdges, nodes, getConnectedInfo, setNodes, resizeParentsToFitChildren, updateNodeInternals]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const normalizedConnection =
        "source" in connection && "target" in connection
          ? normalizeConnectionDirection(connection as Connection)
          : null;

      return Boolean(normalizedConnection && isAllowedEditorConnection(normalizedConnection));
    },
    []
  );

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (params.handleType !== "source" || !isConnectableSourceHandle(params.handleId)) {
        connectionStartRef.current = null;
        return;
      }

      connectionStartRef.current = params;
    },
    []
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) {
        connectionStartRef.current = null;
        return;
      }

      const start = connectionStartRef.current;
      connectionStartRef.current = null;
      if (!start?.nodeId || !start.handleId || start.handleType !== "source") {
        return;
      }
      if (!isConnectableSourceHandle(start.handleId)) {
        return;
      }

      const point = getClientPoint(event);
      const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const targetElement = element?.closest<HTMLElement>("[data-connect-target-node]");
      const target = targetElement?.dataset.connectTargetNode;
      const targetHandle =
        targetElement?.dataset.connectTargetHandle ||
        (targetElement?.dataset.connectTargetMode === "append-input" && target
          ? `${target}-input-append-in`
          : undefined);

      if (!target || !targetHandle || target === start.nodeId || !isConnectableTargetHandle(targetHandle)) {
        return;
      }

      onConnect({
        source: start.nodeId,
        sourceHandle: start.handleId,
        target,
        targetHandle,
      });
    },
    [onConnect]
  );

  const handleAddNode = useCallback(
    (type: "function" | "time" | "click" | "branch" | "block" | "cex" | "dex" | "timeline" | "monitoring" | "streaming") => {
      const id = `${type}-${nodeIdRef.current++}`;
      let newNode: Node;

      switch (type) {
        case "function":
          newNode = {
            id,
            type: "functionNode",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: {
              label: `Indicator Logic ${nodeIdRef.current}`,
              description: "차트로 확인하고 조건 구간을 트리거로 쓰는 지표 로직",
              functionName: `indicator${nodeIdRef.current}()`,
              code:
                "function indicator({ price, volume }) {\n" +
                "  const movingAverage = sma(price, 20);\n" +
                "  const signal = price.at(-1) > movingAverage.at(-1);\n" +
                "  return { movingAverage, signal };\n" +
                "}",
              inputDescription: "스트리밍 블록이나 다른 지표 output을 입력으로 받습니다.",
              logicDescription: "입력 시계열을 계산해 차트 지표와 조건 충족 구간을 만듭니다.",
              outputDescription: "출력값은 변하는 데이터이며 차트와 연결 가능한 output block으로 노출됩니다.",
              inputBlocks: [
                {
                  id: `ib-${Date.now()}`,
                  name: "source",
                  description: "가격/거래량 또는 이전 지표 output",
                  type: "input",
                },
              ],
              outputBlocks: [
                {
                  id: `ob-${Date.now()}`,
                  name: "signal",
                  description: "실시간으로 변하는 트리거 지표",
                  type: "output",
                },
              ],
              condition: {
                metric: "signal",
                operator: ">",
                threshold: 108,
              },
              viewMode: "node",
            } satisfies FunctionNodeData,
          };
          break;
        case "time":
          newNode = {
            id,
            type: "timeTrigger",
            position: { x: 100 + Math.random() * 100, y: 100 + Math.random() * 100 },
            data: {
              label: "Time Trigger",
              interval: 5,
              isActive: false,
              outputBlocks: [
                {
                  id: "tick",
                  name: "tick",
                  description: "5초마다 true 신호를 내보냅니다.",
                  type: "output",
                },
              ],
            } satisfies TimeTriggerData,
          };
          break;
        case "click":
          newNode = {
            id,
            type: "clickTrigger",
            position: { x: 100 + Math.random() * 100, y: 100 + Math.random() * 100 },
            data: {
              label: "Click Trigger",
              shortcut: null,
              isRecording: false,
              outputBlocks: [
                {
                  id: "click",
                  name: "click",
                  description: "클릭되면 true 신호를 내보냅니다.",
                  type: "output",
                },
              ],
            } satisfies ClickTriggerData,
          };
          break;
        case "branch":
          newNode = {
            id,
            type: "branchNode",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: {
              label: "Branch",
              branches: [
                { id: `br-${Date.now()}`, name: "분기 1", active: false },
              ],
            } satisfies BranchNodeData,
          };
          break;
        case "block":
          newNode = {
            id,
            type: "block",
            position: { x: 100 + Math.random() * 100, y: 100 + Math.random() * 100 },
            data: { label: "BLOCK" },
          };
          break;
        case "cex":
          newNode = {
            id,
            type: "actionNode",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: {
              label: `CEX Trade ${nodeIdRef.current}`,
              actionType: "CEX",
              exchange: "Binance",
              symbol: "BTC/USDT",
              side: "BUY",
              orderType: "MARKET",
              amount: "0.1",
              amountType: "FIXED",
              inputBlocks: [],
              outputBlocks: [{ id: `cex-ob-${Date.now()}`, name: "success", type: "output" }],
            } satisfies CEXActionData,
          };
          break;
        case "dex":
          newNode = {
            id,
            type: "actionNode",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: {
              label: `DEX Trade ${nodeIdRef.current}`,
              actionType: "DEX",
              contractAddress: "0x...",
              functionName: "swap()",
              chainId: 1,
              inputBlocks: [],
              outputBlocks: [{ id: `dex-ob-${Date.now()}`, name: "success", type: "output" }],
            } satisfies DEXActionData,
          };
          break;
        case "timeline":
          newNode = {
            id,
            type: "timelineFrame",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: {
              label: `Timeline ${nodeIdRef.current}`,
              timelineItems: [],
              totalDuration: 5000,
              isExpanded: false,
            } satisfies TimelineFrameData,
          };
          break;
        case "monitoring":
          newNode = {
            id,
            type: "monitoringNode",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: {
              label: `Visual Monitor ${nodeIdRef.current}`,
              format: "chart",
              selectedVariables: [],
            } satisfies MonitoringNodeData,
          };
          break;
        case "streaming":
          newNode = {
            id,
            type: "streamingNode",
            position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
            data: createBinanceSpotPriceStreamData({
              label: `Binance 현물 가격 스트림 ${nodeIdRef.current}`,
              outputBlocks: [{ id: `stream-ob-${Date.now()}`, name: "lastPrice", type: "output" }],
              symbols: ["BTCUSDT"],
            }) satisfies StreamingNodeData,
          };
          break;
        default:
          return;
      }

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  const handleDeleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((node) => !node.selected));
    setEdges((eds) => eds.filter((edge) => !edge.selected));
  }, [setNodes, setEdges]);

  const handleLayout = useCallback(() => {
    applyMeasuredLayout(nodes, edges, { fitView: true });
  }, [applyMeasuredLayout, nodes, edges]);

  useEffect(() => {
    window.addEventListener("runAutoLayout", handleLayout);
    return () => window.removeEventListener("runAutoLayout", handleLayout);
  }, [handleLayout]);

  const handleToggleSequenceCollapse = useCallback(
    (groupId: string, collapsed: boolean) => {
      const nextNodes = nodes.map((node) => {
        if (node.id !== groupId) return { ...node };

        return {
          ...node,
          data: {
            ...node.data,
            isCollapsed: collapsed,
            revealTick: collapsed ? undefined : Date.now(),
          },
          style: {
            ...node.style,
            transition: SEQUENCE_GROUP_TRANSITION,
          },
        };
      });

      const affectedNodeIds = [groupId, ...collectDescendantIds(nextNodes, groupId)];

      applyMeasuredLayout(nextNodes, edges, {
        animate: true,
        affectedNodeIds,
      });
    },
    [applyMeasuredLayout, nodes, edges],
  );

  // Demo AI Generation Event Listener
  useEffect(() => {
    if (previewMode) return;
    const handleGenerateV2 = () => {
      applyMeasuredLayout(initialNodes, initialEdges);
      // Reset initialization ref so layout runs again once nodes measure
      initLayoutRunRef.current = false;
    };

    window.addEventListener("generateV2Strategy", handleGenerateV2);
    return () => window.removeEventListener("generateV2Strategy", handleGenerateV2);
  }, [applyMeasuredLayout, previewMode]);

  // Run initial layout when component mounts and all nodes have been measured
  useEffect(() => {
    if (previewMode) return;
    if (nodesInitialized && !initLayoutRunRef.current && nodes.length > 0) {
      initLayoutRunRef.current = true;
      // Initialize strategy history store
      historyStore.init({
        id: "snapshot-initial",
        name: "V2 유동성 봇-1",
        parentId: null,
        nodes: nodes,
        edges: edges,
        timestamp: Date.now() - 100000,
      });
      // Wrap in small timeout to ensure state settles
      setTimeout(() => {
        handleLayout();
      }, 50);
    }
  }, [edges, handleLayout, nodes, nodes.length, nodesInitialized, previewMode]);

  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0 || strategyContentRelayoutSignature.length === 0) {
      return;
    }

    const previousSignature = strategyContentRelayoutSignatureRef.current;
    strategyContentRelayoutSignatureRef.current = strategyContentRelayoutSignature;

    if (previousSignature === null || previousSignature === strategyContentRelayoutSignature) {
      return;
    }

    applyMeasuredLayout(nodes, edges, { animate: true });
  }, [
    applyMeasuredLayout,
    edges,
    nodes,
    nodes.length,
    nodesInitialized,
    strategyContentRelayoutSignature,
  ]);

  useEffect(() => {
    if (previewMode) return;
    if (!nodesInitialized || nodes.length === 0 || !historyStore.getActiveId()) return;

    const nextSignature = JSON.stringify({ nodes, edges });
    if (activeSnapshotPersistSignatureRef.current === nextSignature) {
      return;
    }

    activeSnapshotPersistSignatureRef.current = nextSignature;
    historyStore.updateActiveSnapshot(nodes, edges);
  }, [nodesInitialized, nodes, edges, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    const handleInjectDemoNodes = (e: any) => {
      const { strategy } = e.detail;
      if (strategy === "etfDca") {
        const { nodes: newNodes, edges: newEdges } = getEtfDcaStrategyNodes();
        applyMeasuredLayout(newNodes, newEdges, { fitView: true });
      } else if (strategy === "pepeHedge") {
        const { nodes: newNodes, edges: newEdges } = getPepeHedgeStrategyNodes();
        applyMeasuredLayout(newNodes, newEdges, { fitView: true });
      }
    };

    window.addEventListener("injectDemoNodes", handleInjectDemoNodes);
    return () => window.removeEventListener("injectDemoNodes", handleInjectDemoNodes);
  }, [applyMeasuredLayout, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    const persistActiveSnapshot = () => {
      if (!historyStore.getActiveId()) return;
      historyStore.updateActiveSnapshot(nodes, edges);
    };
    const persistBeforePageLeave = () => {
      persistActiveSnapshot();
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        persistActiveSnapshot();
      }
    };

    const handleLoadSnapshot = (e: any) => {
      const { nodes: snapshotNodes, edges: snapshotEdges } = e.detail;
      const runtimeGraph = enrichGraphWithRuntimeProgram(
        { nodes: snapshotNodes, edges: snapshotEdges },
        programCode,
      );
      activeSnapshotPersistSignatureRef.current = JSON.stringify({
        nodes: runtimeGraph.nodes,
        edges: runtimeGraph.edges,
      });
      applyMeasuredLayout(runtimeGraph.nodes, runtimeGraph.edges);
    };
    const handleSaveSnapshot = () => {
      historyStore.saveSnapshot(nodes, edges);
    };
    const handleToggleSequenceCollapseEvent = (e: any) => {
      const { groupId, collapsed } = e.detail ?? {};
      if (!groupId || typeof collapsed !== "boolean") return;
      handleToggleSequenceCollapse(groupId, collapsed);
    };

    const handleUngroupNode = (e: any) => {
      const { groupId } = e.detail;
      setNodes((currentNodes) => {
        const groupNode = currentNodes.find(n => n.id === groupId);
        return currentNodes.map(node => {
          if (node.parentId === groupId) {
            const parentX = groupNode?.position.x || 0;
            const parentY = groupNode?.position.y || 0;
            return {
              ...node,
              parentId: undefined,
              position: {
                x: node.position.x + parentX,
                y: node.position.y + parentY
              }
            };
          }
          return node;
        }).filter(n => n.id !== groupId);
      });
    };

    window.addEventListener("loadSnapshot", handleLoadSnapshot);
    window.addEventListener("saveHistorySnapshot", handleSaveSnapshot);
    window.addEventListener("persistActiveHistorySnapshot", persistActiveSnapshot);
    window.addEventListener("beforeunload", persistBeforePageLeave);
    document.addEventListener("visibilitychange", persistWhenHidden);
    window.addEventListener("toggleSequenceCollapse", handleToggleSequenceCollapseEvent);
    window.addEventListener("ungroupNode", handleUngroupNode);
    return () => {
      window.removeEventListener("loadSnapshot", handleLoadSnapshot);
      window.removeEventListener("saveHistorySnapshot", handleSaveSnapshot);
      window.removeEventListener("persistActiveHistorySnapshot", persistActiveSnapshot);
      window.removeEventListener("beforeunload", persistBeforePageLeave);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      window.removeEventListener("toggleSequenceCollapse", handleToggleSequenceCollapseEvent);
      window.removeEventListener("ungroupNode", handleUngroupNode);
    };
  }, [applyMeasuredLayout, nodes, edges, handleToggleSequenceCollapse, setNodes, programCode, previewMode]);

  // Process nodes with focus state + FSM locked state styling
  const styledNodes = useMemo(() => {
    const focusNodeIds = new Set(focusState.connectedNodeIds);
    if (focusState.focusedNodeId) {
      focusNodeIds.add(focusState.focusedNodeId);
    }

    const getNodeLayer = (node: Node) => {
      if (node.type !== "groupNode") {
        return 20;
      }

      const styleType = (node.data as any)?.styleType;
      return styleType === "solid" ? 0 : 10;
    };

    const applyFocusStyle = (node: Node): Node => {
      if (!focusState.isActive) return node;

      const isFocused = node.id === focusState.focusedNodeId;
      const isConnected = focusNodeIds.has(node.id);
      return {
        ...node,
        zIndex: isFocused ? 240 : isConnected ? 220 : getNodeLayer(node),
        style: {
          ...node.style,
          opacity: isConnected ? 1 : 0.22,
          filter: isFocused
            ? "drop-shadow(0 0 16px rgba(124, 58, 237, 0.42))"
            : isConnected
              ? "drop-shadow(0 0 10px rgba(59, 130, 246, 0.28))"
              : "grayscale(0.72) saturate(0.55)",
          transition: "opacity 140ms ease, filter 140ms ease",
        },
      };
    };

    // Build set of locked group IDs
    const lockedGroupIds = new Set<string>();
    if (showFSMEdges) {
      nodes.forEach((n) => {
        if (n.type === "groupNode") {
          const d = n.data as any;
          if (d.requiredStates && !isAvailable(d.requiredStates)) {
            lockedGroupIds.add(n.id);
          }
        }
      });
    }

    const result = nodes.map((node) => {
      // Keep child nodes fully visible even when the parent sequence is state-locked
      if (node.parentId && lockedGroupIds.has(node.parentId)) {
        return applyFocusStyle({
          ...node,
          selectable: true,
          focusable: true,
          draggable: true,
          zIndex: getNodeLayer(node),
          style: {
            ...node.style,
            pointerEvents: "auto" as const,
          },
        });
      }

      if (node.type === "groupNode") {
        return applyFocusStyle({
          ...node,
          selectable: true,
          focusable: true,
          draggable: true,
          dragHandle: ".group-node-drag-handle",
          zIndex: getNodeLayer(node),
          style: {
            ...node.style,
            pointerEvents: "auto" as const,
          },
        });
      }

      return applyFocusStyle({
        ...node,
        selectable: true,
        focusable: true,
        draggable: true,
        zIndex: getNodeLayer(node),
      });
    });
    return result;
  }, [nodes, showFSMEdges, isAvailable, focusState]);

  // Process edges with focus state styling
  const styledEdges = useMemo(() => {
    const outputBlockEdges = edges.filter(isOutputBlockEdge);
    const focusedEdgeIds = new Set(focusState.connectedEdgeIds);
    const executingEdgeIds = new Set<string>();
    let hasFsmActive = false;

    if (showFSMEdges) {
      const executingGroupIds = new Set<string>();
      nodes.forEach(n => {
        const groupData = n.data as any;
        if (n.type === 'groupNode' && groupData.executingStates?.includes(currentState)) {
          executingGroupIds.add(n.id);
        }
      });
      outputBlockEdges.forEach(edge => {
        // 현재 발동중인 노드가 시작점으로 연결된 간선
        if (executingGroupIds.has(edge.source)) {
          executingEdgeIds.add(edge.id);
        }
      });
      hasFsmActive = executingEdgeIds.size > 0;
    }

    const activeConditionSourceIds = new Set(
      nodes
        .filter((node) => (node.data as any)?.conditionMet)
        .map((node) => node.id),
    );

    const applyConditionEdgeStyle = (edge: Edge) => {
      if (!activeConditionSourceIds.has(edge.source)) return edge;

      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: "#10b981",
          strokeWidth: 4,
          filter: "drop-shadow(0 0 6px rgba(16, 185, 129, 0.72))",
        },
        animated: true,
        data: { ...edge.data, isHighlighted: true },
      };
    };

    const applyFocusEdgeStyle = (edge: Edge): Edge => {
      if (!focusState.isActive) return edge;
      const isFocusedEdge = focusedEdgeIds.has(edge.id);

      if (isFocusedEdge) {
        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: "#7c3aed",
            strokeWidth: 4.6,
            opacity: 1,
            filter: "drop-shadow(0 0 8px rgba(124, 58, 237, 0.72))",
          },
          animated: true,
          data: { ...edge.data, isHighlighted: true },
        };
      }

      return {
        ...edge,
        animated: false,
        style: {
          ...edge.style,
          stroke: "#94a3b8",
          strokeWidth: 1.6,
          opacity: 0.1,
          filter: undefined,
        },
        data: { ...edge.data, isHighlighted: false },
      };
    };

    if (!hasFsmActive) return outputBlockEdges.map(applyConditionEdgeStyle).map(applyFocusEdgeStyle);

    return outputBlockEdges.map((edge) => {
      const isConnected = showFSMEdges && executingEdgeIds.has(edge.id);

      if (isConnected) {
        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: "#3b82f6",
            strokeWidth: 4,
            filter: "drop-shadow(0 0 6px rgba(59, 130, 246, 0.8))",
          },
          animated: true,
          data: { ...edge.data, isHighlighted: true },
        };
      }

      if (activeConditionSourceIds.has(edge.source)) {
        return applyConditionEdgeStyle(edge);
      }

      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: "#9ca3af",
          strokeWidth: 2.2,
          opacity: 0.2,
        },
        data: { ...edge.data, isHighlighted: false },
      };
    }).map(applyFocusEdgeStyle);
  }, [edges, showFSMEdges, currentState, nodes, focusState]);

  return (
    <div className="flex flex-col w-full h-full bg-[#1e1e1e] relative overflow-hidden">


      {/* React Flow Editor */}
      <div
        className={cn(
          "w-full flex-1 bg-gray-100 relative overflow-hidden",
          isSequenceLayoutAnimating &&
          "[&_.react-flow__node]:transition-transform [&_.react-flow__node]:duration-[420ms] [&_.react-flow__node]:ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
      >
        <ReactFlow
          nodes={styledNodes}
          edges={styledEdges}
          minZoom={0.1}
          maxZoom={3.0}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onContextMenu={handleContextMenu}
          onPaneClick={handlePaneClick}
          onNodeClick={handleNodeClick}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
	          connectionMode={ConnectionMode.Strict}
	          connectionRadius={96}
	          connectOnClick={!previewMode}
	          connectionLineStyle={{ strokeWidth: 3, stroke: "#64748b" }}
	          fitView
	          nodesDraggable={!previewMode}
	          nodesConnectable={!previewMode}
	          edgesReconnectable={!previewMode}
	          elementsSelectable={!previewMode}
	          selectionMode={SelectionMode.Partial}
	          selectionOnDrag={!previewMode}
	          panOnScroll={false}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          className="advanced-node-editor-flow bg-gray-100"
        >
	          {!previewMode ? (
	            <Panel position="top-left" className="z-30">
	              <Toolbar
	                onAddNode={handleAddNode}
	                onDeleteSelected={handleDeleteSelected}
	                onUndo={handleUndo}
	                onRedo={handleRedo}
	                onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
	                onLayout={handleLayout}
	              />
	            </Panel>
	          ) : null}
          <Controls style={{ bottom: 90 }} position="bottom-right" className="bg-white/90 backdrop-blur-sm rounded-lg shadow-md z-30" />
          <MiniMap
            position="bottom-left"
            className="bg-white/90 backdrop-blur-sm rounded-lg shadow-md z-30"
            nodeColor={(node) => {
              switch (node.type) {
                case "timeTrigger":
                  return "#a855f7";
                case "clickTrigger":
                  return "#374151";
                case "ifTrigger":
                  return "#22c55e";
                case "branchNode":
                  return "#f97316";
                case "functionNode":
                  return "#3b82f6";
                case "mergedFunction":
                  return "#6366f1"; // indigo for merged
                case "actionNode":
                  return (node.data as CEXActionData | DEXActionData).actionType === "CEX" ? "#f59e0b" : "#06b6d4";
                case "timelineFrame":
                  return "#8b5cf6"; // purple for timeline
                default:
                  return "#9ca3af";
              }
            }}
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#d1d5db"
          />
        </ReactFlow>

	        {!previewMode ? (
	          <TerminalPanel
	            isOpen={isTerminalOpen}
	            onClose={() => setTerminalOpen(false)}
	            monitoringNodesData={monitoringNodesData}
	          />
	        ) : null}

	        {/* Context Menu for group/merge/unmerge */}
	        {!previewMode && contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            canMerge={canMergeNodes(contextMenu.selectedNodes)}
            canUnmerge={contextMenu.selectedNodes.some((n) => n.type === "mergedFunction")}
            canGroup={contextMenu.selectedNodes.length >= 1}
            onMerge={handleMerge}
            onUnmerge={handleUnmerge}
            onGroup={handleGroup}
            onAiExplain={handleAiExplain}
            onDelete={handleDeleteSelected}
          />
        )}
      </div>
    </div>
  );
}

export function NodeEditor({ initialGraph, initialGraphVersion, programCode, previewMode }: NodeEditorProps) {
  return (
    <ReactFlowProvider>
      <FSMProvider>
        <NodeEditorInner
          initialGraph={initialGraph}
          initialGraphVersion={initialGraphVersion}
          programCode={programCode}
          previewMode={previewMode}
        />
      </FSMProvider>
    </ReactFlowProvider>
  );
}
