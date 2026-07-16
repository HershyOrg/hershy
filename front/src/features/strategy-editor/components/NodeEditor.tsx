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
  reconnectEdge,
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
  PanOnScrollMode,
  type NodeChange,
  type OnReconnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FunctionNode } from "./FunctionNode";
import { TimeTriggerNode } from "./TimeTriggerNode";
import { BranchNode } from "./BranchNode";
import { BlockNode } from "./BlockNode";
import { ActionNode } from "./ActionNode";
import { ConditionJunctionNode } from "./ConditionJunctionNode";
import { MergedFunctionNode } from "./MergedFunctionNode";
import { TimelineFrame } from "./TimelineFrame";
import { MonitoringNode } from "./MonitoringNode";
import { GroupNode } from "./GroupNode";
import { StreamingNode } from "./StreamingNode";
import { CodeEditorNode } from "./CodeEditorNode";
import { SequenceMonitorPanel } from "./SequenceMonitorPanel";
import { withExplanation } from "./withExplanation";
import { getLayoutedElements } from "../utils/layout";
import { CustomEdge } from "./CustomEdge";
import { DelayEdge } from "./DelayEdge";
import { ConditionMergeEdge } from "./ConditionMergeEdge";
import { Toolbar } from "./Toolbar";
import { ContextMenu } from "./ContextMenu";
import type { FunctionNodeData, TimeTriggerData, BranchNodeData, CEXActionData, DEXActionData, ActionNodeData, MergedFunctionNodeData, StreamingNodeData, NodeChartPoint, BlockData, IndicatorCondition } from "../types/editorTypes";
import { buildConditionBracket } from "../utils/conditionBracket";
import { cn } from "@/shared/utils/utils";
import {
  getDummyMarketChart,
  getDummyStreamSample,
} from "@/shared/api/dummyApi";
import { historyStore } from "@/features/strategy-editor/store/historyStore";
import { getEtfDcaStrategyNodes, getPepeHedgeStrategyNodes } from "@/features/strategy-editor/mock-data/demo-strategies";
import {
  createBinanceFuturesUserDataStreamData,
  createBinanceSpotPriceStreamData,
} from "@/features/strategy-editor/mock-data/binance-demo-api";
import { Activity } from "@/shared/components/icons";

const nodeTypes: NodeTypes = {
  functionNode: withExplanation(FunctionNode),
  timeTrigger: withExplanation(TimeTriggerNode),
  clickTrigger: withExplanation(TimeTriggerNode),
  branchNode: withExplanation(BranchNode),
  conditionJunction: ConditionJunctionNode,
  block: withExplanation(BlockNode),
  actionNode: withExplanation(ActionNode),
  mergedFunction: withExplanation(MergedFunctionNode),
  timelineFrame: withExplanation(TimelineFrame),
  monitoringNode: withExplanation(MonitoringNode),
  groupNode: withExplanation(GroupNode),
  streamingNode: withExplanation(StreamingNode),
  codeEditor: CodeEditorNode,
};

const edgeTypes: EdgeTypes = {
  custom: CustomEdge,
  delay: DelayEdge,
  conditionMerge: ConditionMergeEdge,
};

const defaultEdgeOptions = {
  type: "custom",
  animated: false,
  style: {
    stroke: "var(--advanced-edge-default)",
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
    /-trigger-.+-out$/.test(sourceHandle ?? "") ||
    sourceHandle?.endsWith("-condition-out") ||
    sourceHandle?.includes("-branch-") && sourceHandle.endsWith("-out") ||
    sourceHandle?.endsWith("-success-out")
  );
}

function isTriggerFormulaSourceHandle(sourceHandle?: string | null) {
  return /-trigger-.+-out$/.test(sourceHandle ?? "");
}

function isConditionJunctionSourceHandle(sourceHandle?: string | null) {
  return Boolean(sourceHandle?.endsWith("-condition-out"));
}

function shouldUseConditionMergeEdge(edge: Pick<Edge, "sourceHandle" | "target" | "targetHandle">, targetNode?: Node) {
  const isConditionJunctionTarget =
    targetNode?.type === "conditionJunction" ||
    (edge.target?.startsWith("condition-junction-") && edge.targetHandle?.includes("-input-"));
  const isActionTarget = targetNode
    ? targetNode.type === "actionNode" || targetNode.type === "timelineFrame"
    : edge.target?.startsWith("action-") || edge.targetHandle?.startsWith("action-");

  return isConditionJunctionTarget ||
    (isActionTarget &&
      (isTriggerFormulaSourceHandle(edge.sourceHandle) || isConditionJunctionSourceHandle(edge.sourceHandle)));
}

function normalizeConditionMergeEdge(edge: Edge, nodesById: Map<string, Node>) {
  const targetNode = nodesById.get(edge.target);
  if (!shouldUseConditionMergeEdge(edge, targetNode)) {
    return edge.type === "conditionMerge" ? { ...edge, type: "custom" } : edge;
  }

  const data = (edge.data ?? {}) as Record<string, unknown>;
  const logicMode = data.logicMode === "OR" ? "OR" : "AND";
  const isActionTarget = targetNode
    ? targetNode.type === "actionNode" || targetNode.type === "timelineFrame"
    : edge.target?.startsWith("action-") || edge.targetHandle?.startsWith("action-");

  if (
    edge.type === "conditionMerge" &&
    data.logicMode === logicMode &&
    (!isActionTarget || (data.delay === 0 && data.waitForResult === true))
  ) {
    return edge;
  }

  return {
    ...edge,
    type: "conditionMerge",
    data: {
      ...data,
      ...(isActionTarget ? { delay: 0, waitForResult: true } : {}),
      logicMode,
    },
  };
}

function normalizeConditionMergeEdges(inputNodes: Node[], inputEdges: Edge[]) {
  const nodesById = new Map(inputNodes.map((node) => [node.id, node]));
  let changed = false;
  const edges = inputEdges.map((edge) => {
    const normalized = normalizeConditionMergeEdge(edge, nodesById);
    if (normalized !== edge) changed = true;
    return normalized;
  });

  return changed ? edges : inputEdges;
}

function hasParentCycle(node: Node, nodesById: Map<string, Node>) {
  const visited = new Set<string>([node.id]);
  let parentId = node.parentId;

  while (parentId) {
    if (visited.has(parentId)) return true;
    visited.add(parentId);
    parentId = nodesById.get(parentId)?.parentId;
  }

  return false;
}

function orderParentNodesFirst(nodes: Node[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const ordered: Node[] = [];
  const visited = new Set<string>();

  const visit = (node: Node) => {
    if (visited.has(node.id)) return;
    const parent = node.parentId ? nodesById.get(node.parentId) : null;
    if (parent) visit(parent);
    visited.add(node.id);
    ordered.push(node);
  };

  nodes.forEach(visit);
  const changed = ordered.some((node, index) => node !== nodes[index]);

  return { nodes: ordered, changed };
}

function sanitizeEditorGraph<T extends { nodes: Node[]; edges: Edge[] }>(graph: T): T {
  const seenNodeIds = new Set<string>();
  const validNodes: Node[] = [];
  let changed = false;

  for (const node of graph.nodes) {
    const isValidNode = node && typeof node.id === "string" && node.id.trim().length > 0;
    if (!isValidNode || seenNodeIds.has(node.id)) {
      changed = true;
      continue;
    }

    seenNodeIds.add(node.id);
    validNodes.push(node);
  }

  const validNodeIds = new Set(validNodes.map((node) => node.id));
  const nodesById = new Map(validNodes.map((node) => [node.id, node]));
  const parentSafeNodes = validNodes.map((node) => {
    if (!node.parentId) return node;
    if (validNodeIds.has(node.parentId) && !hasParentCycle(node, nodesById)) return node;

    changed = true;
    return {
      ...node,
      parentId: undefined,
      extent: node.extent === "parent" ? undefined : node.extent,
      expandParent: undefined,
    };
  });
  const ordered = orderParentNodesFirst(parentSafeNodes);
  if (ordered.changed) changed = true;

  const orderedNodeIds = new Set(ordered.nodes.map((node) => node.id));
  const orderedNodesById = new Map(ordered.nodes.map((node) => [node.id, node]));
  const seenEdgeIds = new Set<string>();
  const edges: Edge[] = [];

  for (const edge of graph.edges) {
    const sourceNode = typeof edge?.source === "string" ? orderedNodesById.get(edge.source) : undefined;
    const targetNode = typeof edge?.target === "string" ? orderedNodesById.get(edge.target) : undefined;
    const isValidEdge =
      edge &&
      typeof edge.id === "string" &&
      edge.id.trim().length > 0 &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      orderedNodeIds.has(edge.source) &&
      orderedNodeIds.has(edge.target) &&
      edge.type !== "fsmEdge" &&
      sourceNode?.type !== "groupNode" &&
      targetNode?.type !== "groupNode" &&
      !seenEdgeIds.has(edge.id);

    if (!isValidEdge) {
      changed = true;
      continue;
    }

    seenEdgeIds.add(edge.id);
    edges.push(edge);
  }

  if (!changed) return graph;
  return { ...graph, nodes: ordered.nodes, edges };
}

const MAX_EDITOR_HISTORY_ENTRIES = 60;
const EDITOR_HISTORY_COMMIT_DELAY_MS = 280;
const SNAPSHOT_PERSIST_DELAY_MS = 500;
const TRANSIENT_GRAPH_DATA_KEYS = new Set([
  "chartSeries",
  "chartSource",
  "chartUpdatedAt",
  "chartWarning",
  "conditionMet",
  "isHighlighted",
  "runtimeCode",
  "runtimeCodeLabel",
]);

function cloneEditorGraphValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneEditorGraphValue);
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.keys(source).forEach((key) => {
      if (TRANSIENT_GRAPH_DATA_KEYS.has(key)) return;
      next[key] = cloneEditorGraphValue(source[key]);
    });
    return next;
  }

  return value;
}

function cloneEditorNodeForHistory(node: Node): Node {
  const next = {
    ...node,
    position: { ...node.position },
    data: cloneEditorGraphValue(node.data) as Node["data"],
    style: cloneEditorGraphValue(node.style) as Node["style"],
  } as Node & Record<string, unknown>;

  delete next.dragging;
  delete next.hidden;
  delete next.measured;
  delete next.positionAbsolute;
  delete next.resizing;
  delete next.selected;
  delete next.zIndex;

  return next as Node;
}

function cloneEditorEdgeForHistory(edge: Edge): Edge {
  const next = {
    ...edge,
    data: cloneEditorGraphValue(edge.data) as Edge["data"],
    style: cloneEditorGraphValue(edge.style) as Edge["style"],
  } as Edge & Record<string, unknown>;

  delete next.selected;

  return next as Edge;
}

function createEditorHistoryGraph(nodes: Node[], edges: Edge[]) {
  return normalizeEditorGraphEdges({
    nodes: nodes.map(cloneEditorNodeForHistory),
    edges: edges.map(cloneEditorEdgeForHistory),
  });
}

type EditorHistoryGraph = ReturnType<typeof createEditorHistoryGraph>;

type EditorHistoryEntityPatch<T> = {
  id: string;
  before: T | null;
  after: T | null;
  beforeIndex: number;
  afterIndex: number;
};

type EditorHistoryEntry = {
  nodes: EditorHistoryEntityPatch<Node>[];
  edges: EditorHistoryEntityPatch<Edge>[];
  beforeSignature: string;
  afterSignature: string;
};

function cloneEditorHistoryGraph(graph: EditorHistoryGraph): EditorHistoryGraph {
  return createEditorHistoryGraph(graph.nodes, graph.edges);
}

function createEditorHistoryEntityPatches<T extends { id: string }>(
  beforeItems: T[],
  afterItems: T[],
): EditorHistoryEntityPatch<T>[] {
  const beforeById = new Map(beforeItems.map((item, index) => [item.id, { item, index }]));
  const afterById = new Map(afterItems.map((item, index) => [item.id, { item, index }]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  const patches: EditorHistoryEntityPatch<T>[] = [];

  ids.forEach((id) => {
    const before = beforeById.get(id);
    const after = afterById.get(id);
    if (JSON.stringify(before?.item ?? null) === JSON.stringify(after?.item ?? null)) {
      return;
    }

    patches.push({
      id,
      before: before ? cloneEditorGraphValue(before.item) as T : null,
      after: after ? cloneEditorGraphValue(after.item) as T : null,
      beforeIndex: before?.index ?? -1,
      afterIndex: after?.index ?? -1,
    });
  });

  return patches;
}

function createEditorHistoryEntry(beforeGraph: EditorHistoryGraph, afterGraph: EditorHistoryGraph): EditorHistoryEntry | null {
  const beforeSignature = JSON.stringify(beforeGraph);
  const afterSignature = JSON.stringify(afterGraph);
  if (beforeSignature === afterSignature) return null;

  const entry: EditorHistoryEntry = {
    nodes: createEditorHistoryEntityPatches(beforeGraph.nodes, afterGraph.nodes),
    edges: createEditorHistoryEntityPatches(beforeGraph.edges, afterGraph.edges),
    beforeSignature,
    afterSignature,
  };

  return entry.nodes.length > 0 || entry.edges.length > 0 ? entry : null;
}

function applyEditorHistoryEntityPatches<T extends { id: string }>(
  currentItems: T[],
  patches: EditorHistoryEntityPatch<T>[],
  direction: "undo" | "redo",
): T[] {
  if (patches.length === 0) return currentItems;

  const patchedIds = new Set(patches.map((patch) => patch.id));
  const baseItems = currentItems.filter((item) => !patchedIds.has(item.id));
  const insertions = patches
    .map((patch) => ({
      index: direction === "undo" ? patch.beforeIndex : patch.afterIndex,
      item: direction === "undo" ? patch.before : patch.after,
    }))
    .filter((entry): entry is { index: number; item: T } => entry.item !== null)
    .sort((a, b) => a.index - b.index);

  const nextItems = [...baseItems];
  insertions.forEach(({ index, item }) => {
    const nextIndex = index < 0 ? nextItems.length : Math.min(index, nextItems.length);
    nextItems.splice(nextIndex, 0, cloneEditorGraphValue(item) as T);
  });

  return nextItems;
}

function applyEditorHistoryEntry(
  currentGraph: EditorHistoryGraph,
  entry: EditorHistoryEntry,
  direction: "undo" | "redo",
): EditorHistoryGraph {
  return normalizeEditorGraphEdges({
    nodes: applyEditorHistoryEntityPatches(currentGraph.nodes, entry.nodes, direction),
    edges: applyEditorHistoryEntityPatches(currentGraph.edges, entry.edges, direction),
  });
}

const INTERNAL_PREPARATION_GROUP_RE = /\b(intent|research|retrieval|rag|retrieval[-\s]*augmented|knowledge\s*retrieval|context\s*retrieval|knowledge\s*graph|kg|web\s*discovery|candidate\s*universe|pool\s*discovery|implementation\s*research|orchestration|planner|planning|ranking|ranker|solver|evidence|adapter|labeling|workflow\s*plan)\b/i;

function isInternalPreparationGroup(node: Node) {
  if (node.type !== "groupNode") return false;
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  if (data.styleType === "solid") return false;
  return INTERNAL_PREPARATION_GROUP_RE.test([
    node.id,
    data.label,
    data.purpose,
    data.description,
    data.sequenceType,
  ].map((value) => String(value ?? "")).join(" "));
}

function stripInternalPreparationGroups<T extends { nodes: Node[]; edges: Edge[] }>(graph: T): T {
  const removedIds = new Set(graph.nodes.filter(isInternalPreparationGroup).map((node) => node.id));
  if (removedIds.size === 0) return graph;

  let changed = true;
  while (changed) {
    changed = false;
    graph.nodes.forEach((node) => {
      if (node.parentId && removedIds.has(node.parentId) && !removedIds.has(node.id)) {
        removedIds.add(node.id);
        changed = true;
      }
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !removedIds.has(node.id)),
    edges: graph.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
  };
}

function normalizeEditorGraphEdges<T extends { nodes: Node[]; edges: Edge[] }>(graph: T): T {
  const visibleGraph = sanitizeEditorGraph(stripInternalPreparationGroups(sanitizeEditorGraph(graph)));
  const edges = normalizeConditionMergeEdges(visibleGraph.nodes, visibleGraph.edges);
  return edges === visibleGraph.edges ? visibleGraph : { ...visibleGraph, edges };
}

function isConnectableSourceHandle(sourceHandle?: string | null) {
  return isOutputBlockSourceHandle(sourceHandle) || isControlSourceHandle(sourceHandle) || isCollapsedSourceHandle(sourceHandle);
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

function getCollapsedSourceHandle(nodeId: string) {
  return `${nodeId}-collapsed-out`;
}

function getCollapsedTargetHandle(nodeId: string) {
  return `${nodeId}-collapsed-in`;
}

function isCollapsedSourceHandle(sourceHandle?: string | null) {
  return Boolean(sourceHandle?.endsWith("-collapsed-out"));
}

function isCollapsedTargetHandle(targetHandle?: string | null) {
  return Boolean(targetHandle?.endsWith("-collapsed-in"));
}

function isConnectableTargetHandle(targetHandle?: string | null) {
  return isInputBlockTargetHandle(targetHandle) || isExecutionTargetHandle(targetHandle) || isCollapsedTargetHandle(targetHandle);
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

function isOutputBlockEdge(edge: Pick<Edge, "sourceHandle" | "data">) {
  return Boolean((edge.data as Record<string, unknown> | undefined)?.collapsedProxy === true) ||
    isOutputBlockSourceHandle(edge.sourceHandle) ||
    isControlSourceHandle(edge.sourceHandle);
}

function isTriggerDataBlock(block: Pick<BlockData, "id" | "name"> & Record<string, unknown>) {
  const text = `${block.id} ${block.name} ${String(block.outputKind ?? "")}`.toLowerCase();
  return /\btrigger(?:ed)?\b|boolean-trigger|boolean-data/.test(text);
}

function getHandleBlockId(handle?: string | null, direction: "source" | "target" = "source") {
  const suffix = direction === "source" ? "-out" : "-in";
  const pattern = direction === "source" ? /-block-(.+)-out$/ : /-(?:input|block)-(.+)-in$/;
  if (!handle?.endsWith(suffix)) return "";
  return handle.match(pattern)?.[1] ?? "";
}

function isIndicatorCondition(value: unknown): value is IndicatorCondition {
  if (!value || typeof value !== "object") return false;
  const condition = value as Partial<IndicatorCondition>;
  return [">", ">=", "<", "<="].includes(String(condition.operator)) &&
    Number.isFinite(Number(condition.threshold));
}

function getTriggerFormulaHandleInfo(sourceNode: Node | undefined, sourceHandle?: string | null) {
  if (!sourceNode || !sourceHandle) return null;
  const prefix = `${sourceNode.id}-trigger-`;
  const suffix = "-out";
  if (!sourceHandle.startsWith(prefix) || !sourceHandle.endsWith(suffix)) return null;

  const body = sourceHandle.slice(prefix.length, -suffix.length);
  const outputBlocks = (sourceNode.data as { outputBlocks?: BlockData[] })?.outputBlocks ?? [];
  const matchedBlock = [...outputBlocks]
    .sort((a, b) => b.id.length - a.id.length)
    .find((block) => body === block.id || body.startsWith(`${block.id}-`));

  if (!matchedBlock) {
    return { outputBlock: null, outputBlockId: body, controlId: "primary" };
  }

  const rest = body === matchedBlock.id ? "" : body.slice(matchedBlock.id.length + 1);
  return {
    outputBlock: matchedBlock,
    outputBlockId: matchedBlock.id,
    controlId: rest || "primary",
  };
}

function resolveTriggerFormulaCondition(sourceNode: Node | undefined, sourceHandle?: string | null): IndicatorCondition | null {
  const handleInfo = getTriggerFormulaHandleInfo(sourceNode, sourceHandle);
  if (!handleInfo?.outputBlock) return null;

  const block = handleInfo.outputBlock as BlockData & {
    condition?: unknown;
    conditionControls?: Array<{ id?: string; condition?: unknown }>;
  };
  const nodeData = sourceNode?.data as { condition?: unknown };
  const fallbackCondition = isIndicatorCondition(block.condition)
    ? block.condition
    : isIndicatorCondition(nodeData.condition)
      ? nodeData.condition
      : null;
  const controls = Array.isArray(block.conditionControls) ? block.conditionControls : [];
  const controlCondition = controls.find((control) => String(control.id || "primary") === handleInfo.controlId)?.condition;
  const condition = isIndicatorCondition(controlCondition)
    ? controlCondition
    : controls.length > 0 && isIndicatorCondition(controls[0]?.condition)
      ? controls[0].condition
      : fallbackCondition;

  if (!condition) return null;
  return {
    ...condition,
    metric: condition.metric || block.name || handleInfo.outputBlockId,
  };
}

function getConditionForSourceHandle(sourceNode: Node | undefined, sourceHandle?: string | null): IndicatorCondition | null {
  const triggerCondition = resolveTriggerFormulaCondition(sourceNode, sourceHandle);
  if (triggerCondition) return triggerCondition;

  const nodeCondition = (sourceNode?.data as { condition?: unknown } | undefined)?.condition;
  if (isIndicatorCondition(nodeCondition)) {
    return {
      ...nodeCondition,
      metric: nodeCondition.metric || getSourceSignalName(sourceNode, sourceHandle),
    };
  }

  return null;
}

function getConnectionEdgePresentation({
  params,
  sourceNode,
  targetNode,
  baseData,
}: {
  params: Pick<Connection, "sourceHandle" | "targetHandle">;
  sourceNode?: Node;
  targetNode?: Node;
  baseData?: Record<string, unknown>;
}) {
  const targetConditionJunctionMode =
    targetNode?.type === "conditionJunction"
      ? ((targetNode.data as Record<string, unknown>).mode === "OR" ? "OR" : "AND")
      : null;
  const sourceConditionJunctionMode =
    sourceNode?.type === "conditionJunction"
      ? ((sourceNode.data as Record<string, unknown>).mode === "OR" ? "OR" : "AND")
      : null;
  const isActionTarget = targetNode?.type === "actionNode" || targetNode?.type === "timelineFrame";
  const isDataFlow = isBlockToInputConnection(params);
  const isTriggerFormulaActionEdge = Boolean(
    isActionTarget &&
    !isDataFlow &&
    isTriggerFormulaSourceHandle(params.sourceHandle),
  );
  const isConditionJunctionActionEdge = Boolean(
    isActionTarget &&
    !isDataFlow &&
    isConditionJunctionSourceHandle(params.sourceHandle),
  );
  const shouldUseConditionMerge =
    Boolean(targetConditionJunctionMode) ||
    isTriggerFormulaActionEdge ||
    isConditionJunctionActionEdge;
  const logicMode = targetConditionJunctionMode ?? sourceConditionJunctionMode ??
    (baseData?.logicMode === "OR" ? "OR" : "AND");
  const condition = getConditionForSourceHandle(sourceNode, params.sourceHandle);

  return {
    type: shouldUseConditionMerge
      ? "conditionMerge"
      : isActionTarget && !isDataFlow ? "delay" : "custom",
    data: {
      ...(baseData ?? {}),
      ...(isActionTarget && !isDataFlow ? { delay: 0, waitForResult: true } : {}),
      ...(shouldUseConditionMerge ? { logicMode } : {}),
      ...(condition ? { condition } : {}),
    },
  };
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

  if (sourceHandle?.endsWith("-condition-out")) {
    return "yes";
  }

  const triggerOutputBlockId = sourceHandle?.match(/-trigger-(.+)-out$/)?.[1];
  if (triggerOutputBlockId) {
    const outputBlocks = (sourceNode.data as { outputBlocks?: BlockData[] })?.outputBlocks ?? [];
    const outputBlock = outputBlocks.find((block) => block.id === triggerOutputBlockId);
    return outputBlock?.name ? `${outputBlock.name} yes` : "yes";
  }

  if (/-trigger-.+-out$/.test(sourceHandle ?? "")) {
    return "yes";
  }

  if (sourceHandle?.endsWith("-trigger-out")) {
    if (sourceNode.type === "clickTrigger" || sourceNode.type === "timeTrigger") return "yes";
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
  const outputBlocks = (sourceNode?.data as { outputBlocks?: BlockData[] })?.outputBlocks ?? [];
  return outputBlocks.find((block) => block.id === blockId) ?? null;
}

function getInputBlockForHandle(targetNode: Node | undefined, targetHandle?: string | null) {
  const blockId = getHandleBlockId(targetHandle, "target");
  const inputBlocks = (targetNode?.data as { inputBlocks?: BlockData[] })?.inputBlocks ?? [];
  return inputBlocks.find((block) => block.id === blockId) ?? null;
}

function getPrimarySourceHandleForNode(node: Node | undefined) {
  if (!node) return null;
  const data = node.data as { outputBlocks?: BlockData[]; branches?: Array<{ id: string }> } | undefined;
  const outputBlock = data?.outputBlocks?.[0];
  if (outputBlock?.id) return `${node.id}-block-${outputBlock.id}-out`;

  if (node.type === "timeTrigger" || node.type === "clickTrigger") {
    return `${node.id}-trigger-out`;
  }

  const branch = data?.branches?.[0];
  if (node.type === "branchNode" && branch?.id) {
    return `${node.id}-branch-${branch.id}-out`;
  }

  if (node.type === "actionNode") return `${node.id}-success-out`;
  if (node.type === "codeEditor") return `${node.id}-func-out`;
  return null;
}

function getPrimaryTargetHandleForNode(node: Node | undefined, sourceBlockName = "source") {
  if (!node) return null;
  const inputBlocks = getInputBlocksForNode(node, sourceBlockName);
  const inputBlock = inputBlocks[0];
  if (inputBlock?.id) {
    const targetInputPrefix = getTargetInputHandlePrefix(node, `${node.id}-input-${inputBlock.id}-in`);
    return `${node.id}-${targetInputPrefix}-${inputBlock.id}-in`;
  }

  if (node.type === "branchNode") return `${node.id}-branch-in`;
  if (node.type === "timeTrigger" || node.type === "clickTrigger") return `${node.id}-trigger-in`;
  if (node.type === "monitoringNode") return `${node.id}-monitor-in`;
  if (node.type === "functionNode" || node.type === "actionNode" || node.type === "mergedFunction") {
    return `${node.id}-func-in`;
  }
  return null;
}

function resolveCollapsedConnectionHandles(
  params: Connection,
  sourceNode: Node | undefined,
  targetNode: Node | undefined,
) {
  const sourceHandle = isCollapsedSourceHandle(params.sourceHandle)
    ? getPrimarySourceHandleForNode(sourceNode) ?? params.sourceHandle
    : params.sourceHandle;
  const sourceBlockName = getSourceSignalName(sourceNode, sourceHandle);
  const targetHandle = isCollapsedTargetHandle(params.targetHandle)
    ? getPrimaryTargetHandleForNode(targetNode, sourceBlockName) ?? params.targetHandle
    : params.targetHandle;

  return {
    ...params,
    sourceHandle,
    targetHandle,
  };
}

function getChartSeriesForOutputHandle(sourceNode: Node, sourceHandle?: string | null) {
  const sourceBlock = getOutputBlockForHandle(sourceNode, sourceHandle) as (BlockData & { chartSeries?: NodeChartPoint[] }) | null;
  const blockSeries = sourceBlock?.chartSeries;
  if (Array.isArray(blockSeries) && blockSeries.length > 0) return blockSeries;
  const nodeSeries = (sourceNode.data as { chartSeries?: NodeChartPoint[] })?.chartSeries;
  return Array.isArray(nodeSeries) ? nodeSeries : [];
}

function getFallbackInputBlocksForNode(node: Node, sourceBlockName: string): BlockData[] {
  if (node.type === "functionNode") {
    return [{ id: "source", name: "source", description: "Incoming stream or indicator block for chart calculations", type: "input" }];
  }

  if (node.type === "branchNode") {
    return [{ id: "signal", name: "signal", description: "Signal used for branch evaluation", type: "input" }];
  }

  if (node.type === "actionNode") {
    return [{ id: "signal", name: sourceBlockName || "signal", description: "Input signal used for execution", type: "input" }];
  }

  if (node.type === "mergedFunction") {
    return [{ id: "source", name: "source", description: "Input used by merge logic", type: "input" }];
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
  const targetBlockId = existingBlock?.id ||
    (!shouldAppend && requestedBlock
      ? requestedBlock.id
      : createUniqueBlockId(`ib-${sanitizeHandlePart(sourceBlockName)}`, currentBlocks));
  const shouldKeepRequestedName =
    requestedBlock &&
    !isPlaceholderInputBlock(requestedBlock) &&
    targetNode.type !== "conditionJunction";
  const nextInputBlock: BlockData = {
    ...(requestedBlock ?? {}),
    id: targetBlockId,
    name: shouldKeepRequestedName ? requestedBlock.name : sourceBlockName,
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

function buildPassthroughOutputBlock(inputBlock: BlockData, connectedFrom: string, existingOutputBlocks: BlockData[]): BlockData {
  const baseName = sanitizeHandlePart(inputBlock.name || "source") || "source";
  return {
    id: createUniqueBlockId(`ob-pass-${sanitizeHandlePart(inputBlock.id || baseName)}`, existingOutputBlocks),
    name: inputBlock.name || baseName,
    description: `Returns input ${connectedFrom} unchanged`,
    type: "output",
    outputMode: "passthrough",
    passthroughInputBlockId: inputBlock.id,
    connectedFrom,
    formulaCode: sanitizeFormulaIdentifier(inputBlock.name || baseName) || "source",
  };
}

function appendPassthroughOutputBlockIfNeeded(
  outputBlocks: BlockData[] | undefined,
  inputBlock: BlockData,
  connectedFrom: string,
) {
  const currentOutputBlocks = Array.isArray(outputBlocks) ? outputBlocks : [];
  const alreadyExists = currentOutputBlocks.some((block) =>
    block.connectedFrom === connectedFrom ||
    block.passthroughInputBlockId === inputBlock.id ||
    block.name === inputBlock.name,
  );
  if (alreadyExists) return currentOutputBlocks;
  return [...currentOutputBlocks, buildPassthroughOutputBlock(inputBlock, connectedFrom, currentOutputBlocks)];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clearRuntimeProgramFromNodes(inputNodes: Node[]) {
  let changed = false;
  const nodes = inputNodes
    .filter((node) => {
      const remove = node.id === RUNTIME_PROGRAM_NODE_ID;
      if (remove) changed = true;
      return !remove;
    })
    .map((node) => {
      const data = node.data as { runtimeCode?: string; runtimeCodeLabel?: string } | undefined;
      if (!data?.runtimeCode && !data?.runtimeCodeLabel) return node;
      changed = true;
      const nextData = { ...(node.data as Record<string, unknown>) };
      delete nextData.runtimeCode;
      delete nextData.runtimeCodeLabel;
      return { ...node, data: nextData };
    });

  return changed ? nodes : inputNodes;
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

function getURL(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isYahooFinanceChartUrl(value?: string) {
  const url = getURL(String(value || "").trim());
  if (!url) return false;
  return /(^|\.)query1\.finance\.yahoo\.com$/i.test(url.hostname) &&
    url.pathname.startsWith("/v8/finance/chart/");
}

function getYahooFinanceFetchUrl(value: string) {
  const url = getURL(value.trim());
  if (!url || !isYahooFinanceChartUrl(value)) return value;
  return `/yahoo-finance${url.pathname}${url.search}`;
}

function inferNodeChartRequest(node: Node) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  const explicitSymbol = readNodeText(data, ["chartSymbol", "symbol", "market", "pair", "instrument"]);
  const endpoint = readNodeText(data, ["url", "sourceUrl", "endpoint", "apiReference"]);
  if (isYahooFinanceChartUrl(endpoint)) return null;
  const label = readNodeText(data, ["label", "name", "title"]);
  const rawText = `${explicitSymbol} ${endpoint} ${label}`;
  const querySymbol = endpoint.match(/[?&]symbol=([A-Za-z0-9._/-]+)/i)?.[1] ?? "";
  const tickerMatch = rawText.match(/\b([A-Z]{2,12}(?:USDT|USD|BTC|ETH)(?:\.P)?)\b/i)?.[1] ?? "";
  const symbol = normalizeMarketSymbol(querySymbol || explicitSymbol || tickerMatch);
  if (!symbol) return null;

  const market = /perp|future|futures|swap|\.p\b/i.test(rawText) ? "futures" : "spot";
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

function normalizeChartFieldKey(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildSeriesForField(timestamps: unknown[], values: unknown[], volumes?: unknown[]) {
  return timestamps
    .map((timestamp, index): NodeChartPoint | null => {
      const time = Number(timestamp);
      const value = toChartNumber(values[index]);
      const volume = volumes ? toChartNumber(volumes[index]) : null;
      if (!Number.isFinite(time) || value === null) return null;
      return {
        time,
        value,
        ...(volume !== null ? { volume } : {}),
      };
    })
    .filter((point): point is NodeChartPoint => Boolean(point));
}

function parseYahooFinanceChartPayload(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const chart = root.chart && typeof root.chart === "object" ? root.chart as Record<string, any> : {};
  const result = Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result || typeof result !== "object") {
    const errorDescription = chart.error?.description || chart.error?.message;
    throw new Error(typeof errorDescription === "string" ? errorDescription : "Yahoo chart result was empty");
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = Array.isArray(result.indicators?.quote) ? result.indicators.quote[0] : null;
  if (timestamps.length === 0 || !quote || typeof quote !== "object") {
    throw new Error("Yahoo chart payload did not include timestamp and quote arrays");
  }

  const seriesByField: Record<string, NodeChartPoint[]> = {};
  ["open", "high", "low", "close", "volume"].forEach((field) => {
    const values = Array.isArray(quote[field]) ? quote[field] : [];
    if (values.length === 0) return;
    const series = buildSeriesForField(
      timestamps,
      values,
      field === "volume" ? undefined : quote.volume,
    );
    if (series.length > 0) {
      seriesByField[normalizeChartFieldKey(field)] = series;
    }
  });

  const adjustedClose = Array.isArray(result.indicators?.adjclose)
    ? result.indicators.adjclose[0]?.adjclose
    : null;
  if (Array.isArray(adjustedClose)) {
    const adjustedSeries = buildSeriesForField(timestamps, adjustedClose, quote.volume);
    if (adjustedSeries.length > 0) {
      seriesByField.adjustedclose = adjustedSeries;
      seriesByField.adjclose = adjustedSeries;
    }
  }

  const primarySeries = seriesByField.close ?? seriesByField.adjustedclose ?? Object.values(seriesByField)[0] ?? [];
  if (primarySeries.length === 0) {
    throw new Error("Yahoo chart payload did not include numeric OHLC values");
  }

  const symbol = typeof result.meta?.symbol === "string" ? result.meta.symbol : "Yahoo";
  return {
    symbol,
    series: primarySeries,
    seriesByField,
  };
}

function applyStreamingOutputChartSeries(
  outputBlocks: BlockData[] | undefined,
  fallbackSeries: NodeChartPoint[],
  seriesByField: Record<string, NodeChartPoint[]> = {},
) {
  const blocks = Array.isArray(outputBlocks) ? outputBlocks : [];
  let changed = false;
  const nextBlocks = blocks.map((block, index) => {
    const candidates = [
      normalizeChartFieldKey(block.id),
      normalizeChartFieldKey(block.name),
    ];
    const matchedSeries = candidates
      .map((key) => seriesByField[key])
      .find((series) => Array.isArray(series) && series.length > 0) ??
      (index === 0 ? fallbackSeries : null);

    if (!matchedSeries || matchedSeries.length === 0) return block;
    const currentSeries = (block as Record<string, unknown>).chartSeries as NodeChartPoint[] | undefined;
    if (chartSeriesEqual(currentSeries, matchedSeries)) return block;
    changed = true;
    return {
      ...block,
      chartSeries: matchedSeries,
      visualizationFormat: block.visualizationFormat ?? (index === 0 ? "chart" : block.visualizationFormat),
    };
  });

  return changed ? nextBlocks : blocks;
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
  sourceHandle?: string | null;
  targetHandle?: string | null;
  targetInputId?: string;
  sourceBlockName?: string;
  targetInputName?: string;
  connectedFrom?: string;
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

function getFunctionFormulaText(data: Record<string, unknown>, primaryOutputName = "", outputBlock?: BlockData | null) {
  const outputData = outputBlock as Record<string, unknown> | null | undefined;
  const outputCode = outputData
    ? readNodeText(outputData, ["formulaCode", "code", "formula", "expression", "logic"])
    : "";
  const code = outputCode || readNodeText(data, ["code", "formula", "expression", "logic"]);
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

  const outputDescription = outputData ? readNodeText(outputData, ["logicDescription", "description"]) : "";
  const description = outputDescription || readNodeText(data, ["logicDescription", "description"]);
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

function deriveFormulaChartSeries(node: Node, incoming: ReactiveIncomingSeries[], outputBlock?: BlockData | null): ReactiveFormulaResult | null {
  const data = node.data as Record<string, unknown>;
  const outputBlocks = Array.isArray(data.outputBlocks) ? data.outputBlocks as BlockData[] : [];
  const primaryOutputName = outputBlock?.name || outputBlocks[0]?.name || "value";
  const expression = getFunctionFormulaText(data, primaryOutputName, outputBlock);
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

function deriveFunctionChartSeries(node: Node, incoming: ReactiveIncomingSeries[], outputBlock?: BlockData | null): ReactiveFormulaResult | null {
  if (incoming.length === 0) return null;
  const outputData = outputBlock as Record<string, unknown> | null | undefined;

  if (outputData?.outputMode === "passthrough") {
    const passthroughInputBlockId = typeof outputData.passthroughInputBlockId === "string" ? outputData.passthroughInputBlockId : "";
    const connectedFrom = typeof outputData.connectedFrom === "string" ? outputData.connectedFrom : "";
    const matchedInput =
      incoming.find((item) => passthroughInputBlockId && item.targetInputId === passthroughInputBlockId) ??
      incoming.find((item) => connectedFrom && item.connectedFrom === connectedFrom) ??
      incoming.find((item) => item.targetInputName === outputBlock?.name) ??
      incoming[0];

    return {
      series: matchedInput.series,
      source: `passthrough: ${matchedInput.connectedFrom || matchedInput.sourceBlockName || matchedInput.targetInputName || "source"}`,
      warning: "",
    };
  }

  const formulaResult = deriveFormulaChartSeries(node, incoming, outputBlock);
  if (formulaResult && formulaResult.series.length > 0) return formulaResult;

  const data = node.data as Record<string, unknown>;
  const text = [
    node.id,
    readNodeText(data, ["label", "name", "functionName", "description", "logicDescription", "code", "expression", "logic"]),
    outputBlock?.name ?? "",
    outputBlock?.description ?? "",
  ].join(" ").toLowerCase();

  if (incoming.length >= 2 && /basis|spread|gap|premium/.test(text)) {
    const ordered = [...incoming].sort((a, b) => {
      const aText = `${a.node.id} ${readNodeText(a.node.data as Record<string, unknown>, ["label", "name", "symbol", "market"])}`.toLowerCase();
      const bText = `${b.node.id} ${readNodeText(b.node.data as Record<string, unknown>, ["label", "name", "symbol", "market"])}`.toLowerCase();
      const score = (value: string) => (/perp|future|\.p/.test(value) ? -1 : /spot/.test(value) ? 1 : 0);
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

  if (/ma|moving average|sma|ema/.test(text)) {
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
const CONDITION_JUNCTION_ACTION_GAP = 228;
const CONDITION_BRACKET_ROUND_GAP = 156;
const CONDITION_BRACKET_LEAF_HEIGHT = 42;
const CONDITION_BRACKET_ROW_GAP = 22;
const RUNTIME_PROGRAM_NODE_ID = "hershy-generated-program";
const FOCUS_NODE_TRANSITION = "opacity 140ms ease, filter 140ms ease";
const FOCUS_NODE_FILTERS = new Set([
  "drop-shadow(0 0 12px rgba(45, 212, 191, 0.26))",
  "drop-shadow(0 0 8px rgba(94, 234, 212, 0.18))",
  "grayscale(0.72) saturate(0.55)",
]);
const FOCUS_EDGE_FILTER = "drop-shadow(0 0 7px rgba(45, 212, 191, 0.38))";

function isStrategySequenceGroup(node: Node) {
  return node.type === "groupNode" && (node.data as any)?.styleType !== "solid";
}

function clearFocusNodeStyle(node: Node): Node {
  if (!node.style) return node;

  const nextStyle = { ...node.style };
  const maybeOpacity = nextStyle.opacity;
  let changed = false;

  if (maybeOpacity === 0.22 || maybeOpacity === 1 || maybeOpacity === "0.22" || maybeOpacity === "1") {
    delete nextStyle.opacity;
    changed = true;
  }

  if (typeof nextStyle.filter === "string" && FOCUS_NODE_FILTERS.has(nextStyle.filter)) {
    delete nextStyle.filter;
    changed = true;
  }

  if (nextStyle.transition === FOCUS_NODE_TRANSITION) {
    delete nextStyle.transition;
    changed = true;
  }

  return changed ? { ...node, style: nextStyle } : node;
}

function clearFocusEdgeStyle(edge: Edge): Edge {
  if (!edge.style) return edge;

  const nextStyle = { ...edge.style };
  const maybeOpacity = nextStyle.opacity;
  let changed = false;

  if (maybeOpacity === 0.1 || maybeOpacity === 1 || maybeOpacity === "0.1" || maybeOpacity === "1") {
    delete nextStyle.opacity;
    changed = true;
  }

  if (nextStyle.stroke === "#5eead4" || nextStyle.stroke === "var(--advanced-edge-dim)") {
    delete nextStyle.stroke;
    changed = true;
  }

  if (
    nextStyle.strokeWidth === 4.6 ||
    nextStyle.strokeWidth === 1.6 ||
    nextStyle.strokeWidth === "4.6" ||
    nextStyle.strokeWidth === "1.6"
  ) {
    delete nextStyle.strokeWidth;
    changed = true;
  }

  if (nextStyle.filter === FOCUS_EDGE_FILTER || ("filter" in nextStyle && nextStyle.filter === undefined)) {
    delete nextStyle.filter;
    changed = true;
  }

  return changed ? { ...edge, style: nextStyle } : edge;
}

function shouldRenderCollapsedPort(node: Node | undefined) {
  if (!node) return false;
  const data = node.data as Record<string, unknown> | undefined;

  if (node.type === "functionNode" || node.type === "actionNode" || node.type === "mergedFunction") {
    return data?.isExpanded !== true;
  }

  if (node.type === "streamingNode") {
    return data?.isExpanded === false;
  }

  return false;
}

function buildCollapsedPortRenderEdges(nodes: Node[], edges: Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return edges.map((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const useCollapsedSource = shouldRenderCollapsedPort(sourceNode) && isConnectableSourceHandle(edge.sourceHandle);
    const useCollapsedTarget = shouldRenderCollapsedPort(targetNode) && isConnectableTargetHandle(edge.targetHandle);

    if (!useCollapsedSource && !useCollapsedTarget) return edge;

    return {
      ...edge,
      sourceHandle: useCollapsedSource ? getCollapsedSourceHandle(edge.source) : edge.sourceHandle,
      targetHandle: useCollapsedTarget ? getCollapsedTargetHandle(edge.target) : edge.targetHandle,
      data: {
        ...(edge.data as Record<string, unknown> | undefined),
        collapsedProxy: true,
        originalSourceHandle: edge.sourceHandle,
        originalTargetHandle: edge.targetHandle,
      },
    };
  });
}

function getNodeTreeDepth(node: Node | undefined, nodesById: Map<string, Node>) {
  let depth = 0;
  let currentParentId = node?.parentId;

  while (currentParentId) {
    depth += 1;
    currentParentId = nodesById.get(currentParentId)?.parentId;
  }

  return depth;
}

function pickDeepestStrategySequenceGroup(nodes: Node[], nodesById: Map<string, Node>) {
  return nodes
    .filter(isStrategySequenceGroup)
    .sort((a, b) => getNodeTreeDepth(b, nodesById) - getNodeTreeDepth(a, nodesById))[0];
}

function getCollectionSize(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function getTrailingNumericIdCounter(id: string) {
  const match = id.match(/-(\d+)$/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getNextNodeIdSeed(nodes: Node[]) {
  return nodes.reduce((max, node) => Math.max(max, getTrailingNumericIdCounter(node.id)), 0) + 1;
}

function createUniqueNodeId(prefix: string, nodes: Node[], counterRef: { current: number }) {
  const existingIds = new Set(nodes.map((node) => node.id));
  let index = Math.max(counterRef.current, getNextNodeIdSeed(nodes), 1);
  let id = `${prefix}-${index}`;

  while (existingIds.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }

  counterRef.current = index + 1;
  return { id, index };
}

function createUniqueBlockId(prefix: string, blocks: Array<{ id?: string }>, seed = String(Date.now())) {
  const existingIds = new Set(blocks.map((block) => block.id).filter(Boolean));
  let id = `${prefix}-${seed}`;
  let attempt = 1;

  while (existingIds.has(id)) {
    id = `${prefix}-${seed}-${attempt}`;
    attempt += 1;
  }

  return id;
}

function readNodeDimension(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function estimateEditorNodeSize(node: Node) {
  const data = node.data as Record<string, unknown> | undefined;
  const inputCount = Math.max(getCollectionSize(data?.inputBlocks), 1);
  const outputCount = Math.max(getCollectionSize(data?.outputBlocks), 1);
  const expanded = data?.isExpanded !== false && data?.isExpanded !== undefined;
  const viewMode = String(data?.viewMode ?? "");

  switch (node.type) {
    case "actionNode":
      return expanded
        ? { width: 420, height: 560 + inputCount * 34 + outputCount * 28 }
        : { width: 220, height: 118 + Math.max(0, inputCount - 1) * 16 };
    case "functionNode":
      return expanded
        ? { width: 640, height: viewMode === "code" ? 650 : 590 + inputCount * 34 + outputCount * 34 }
        : { width: 310, height: 282 + Math.min(inputCount, 2) * 14 + Math.min(outputCount, 2) * 14 };
    case "streamingNode":
      return data?.isExpanded === false
        ? { width: 260, height: 172 + Math.min(outputCount, 4) * 42 }
        : { width: 260, height: 520 + outputCount * 42 };
    case "monitoringNode":
      return { width: 420, height: 500 + Math.max(0, outputCount - 1) * 36 };
    case "codeEditor":
      return { width: 430, height: 360 };
    case "branchNode":
      return { width: 460, height: 180 };
    case "conditionJunction":
      return { width: 96, height: Math.max(72, 24 + inputCount * 32) };
    case "timelineFrame":
      return { width: 560, height: 380 };
    case "clickTrigger":
      return { width: 180, height: 184 };
    case "timeTrigger":
      return { width: 300, height: 170 };
    case "groupNode":
      return { width: 360, height: 220 };
    default:
      return { width: 320, height: 130 };
  }
}

function getEditorNodeSize(node: Node) {
  const style = node.style as Record<string, unknown> | undefined;
  const measured = node.measured as { width?: number; height?: number } | undefined;
  const estimate = estimateEditorNodeSize(node);
  if (node.type === "groupNode") {
    return {
      width: readNodeDimension(style?.width) || readNodeDimension(measured?.width) || readNodeDimension(node.width) || estimate.width,
      height: readNodeDimension(style?.height) || readNodeDimension(measured?.height) || readNodeDimension(node.height) || estimate.height,
    };
  }

  return {
    width: Math.max(
      readNodeDimension(measured?.width),
      readNodeDimension(style?.width),
      readNodeDimension(node.width),
      estimate.width,
    ),
    height: Math.max(
      readNodeDimension(measured?.height),
      readNodeDimension(style?.height),
      readNodeDimension(node.height),
      estimate.height,
    ),
  };
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
  const nodesById = new Map(inputNodes.map((node) => [node.id, node]));

  return inputNodes.map((node) => {
    if (!node.parentId) {
      return {
        ...node,
        extent: undefined,
        expandParent: undefined,
      };
    }

    const parentNode = nodesById.get(node.parentId);
    const shouldExpandParent = parentNode?.type === "groupNode";

    return {
      ...node,
      extent: "parent" as const,
      expandParent: shouldExpandParent,
    };
  });
}

function applySequenceCollapsedState(inputNodes: Node[], inputEdges: Edge[]) {
  const containedNodes = applyParentContainmentRules(inputNodes);
  const nodes = containedNodes.map((node) => {
    if (!isStrategySequenceGroup(node)) return { ...node };

    return {
      ...node,
      style: {
        ...node.style,
        transition: SEQUENCE_GROUP_TRANSITION,
      },
    };
  });
  const edges = normalizeConditionMergeEdges(nodes, inputEdges);

  return { nodes, edges };
}

const initialNodes: Node[] = [
  // --- GROUPS ---
  {
    id: "g_strategy",
    type: "groupNode",
    position: { x: 50, y: 50 },
    data: { label: "V2 Liquidity Bot Strategy", styleType: "solid" } as any,
    style: { width: 1200, height: 750 },
  },
  {
    id: "g_init",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 50 },
    data: {
      label: "Initial Entry Sequence (Init)",
      styleType: "dashed-init",
    } as any,
    style: { width: 1100, height: 160 },
  },
  {
    id: "g_trigger1",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 220 },
    data: {
      label: "1h Monitoring: Ratio-Matched Liquidity Supply (Trigger)",
      styleType: "dashed-trigger",
    } as any,
    style: { width: 1100, height: 160 },
  },
  {
    id: "g_trigger2",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 390 },
    data: {
      label: "Continuous Monitoring: Risk-Detection Rebalancing (Trigger)",
      styleType: "dashed-trigger",
    } as any,
    style: { width: 1100, height: 160 },
  },
  {
    id: "g_emergency",
    type: "groupNode",
    parentId: "g_strategy",
    position: { x: 40, y: 560 },
    data: {
      label: "Manual Emergency Exit Sequence (Trigger)",
      styleType: "dashed-emergency",
    } as any,
    style: { width: 1100, height: 160 },
  },

  // --- INIT SEQUENCE (g_init) ---
  {
    id: "n_init_click",
    type: "clickTrigger",
    parentId: "g_init",
    position: { x: 20, y: 60 },
    data: { label: "Start Rebalancing Bot", shortcut: null, isRecording: false } as any,
  },
  {
    id: "n_init_prepare",
    type: "functionNode",
    parentId: "g_init",
    position: { x: 300, y: 60 },
    data: {
      label: "Rebalance Base Asset Ratio (Minimum Basis)",
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
      label: "Swap Excess USDT to ETH",
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
      label: "Execute: DEX Liquidity Supply + CEX Short",
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
    data: { label: "Data Detection (1h)", interval: 3600, isActive: true } as any,
  },
  {
    id: "n_t1_branch",
    type: "branchNode",
    parentId: "g_trigger1",
    position: { x: 300, y: 60 },
    data: {
      label: "Condition Wait: Both-Side Capital Ratio Met",
      branches: [{ id: "b1", name: "Ratio Met", active: true }],
      inputBlocks: [],
    } as any,
  },
  {
    id: "n_t1_execute",
    type: "actionNode",
    parentId: "g_trigger1",
    position: { x: 650, y: 40 },
    data: {
      label: "Execute: DEX Liquidity Supply + CEX Short",
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
    data: { label: "Data Detection (1h)", interval: 0, isActive: true } as any,
  },
  {
    id: "n_t2_branch",
    type: "branchNode",
    parentId: "g_trigger2",
    position: { x: 300, y: 60 },
    data: {
      label: "Risk Detection: ETH Price Rises 10% or More",
      branches: [{ id: "b1", name: "On Rise", active: true }],
      inputBlocks: [],
    } as any,
  },
  {
    id: "n_t2_execute",
    type: "actionNode",
    parentId: "g_trigger2",
    position: { x: 650, y: 40 },
    data: {
      label: "Execute: Delta-Neutral Realignment",
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
    data: { label: "Emergency: Close All Positions", shortcut: null, isRecording: false } as any,
  },
  {
    id: "n_em_stream",
    type: "streamingNode",
    parentId: "g_emergency",
    position: { x: 240, y: 36 },
    data: createBinanceFuturesUserDataStreamData({
      label: "Binance Futures Position Stream",
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
      label: "Close: Fully Close Binance ETH Short",
      actionType: "CEX",
      exchange: "Binance",
      symbol: "ETH/USDT",
      side: "BUY",
      orderType: "MARKET",
      amount: "{{Binance Futures Position Stream.ethShortQty}}",
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
      label: "Close: Withdraw LP and Convert All to USDT",
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
  previewMode?: boolean;
};

type CanvasPoint = { x: number; y: number };

type CreateHistoricalApiBlockDetail = {
  sourceNodeId?: string;
  label: string;
  url: string;
  method?: StreamingNodeData["method"];
  streamKind?: StreamingNodeData["streamKind"];
  outputFields?: string[];
  datasetId?: string;
  datasetFileName?: string;
  normalizedPreviewRows?: Array<Record<string, number | string>>;
};

function buildHistoricalPreviewChartSeries(rows: CreateHistoricalApiBlockDetail["normalizedPreviewRows"]): NodeChartPoint[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): NodeChartPoint | null => {
      const timeValue = row.date ?? row.timestamp ?? row.time;
      const parsedTime = typeof timeValue === "number" ? timeValue : Date.parse(String(timeValue ?? ""));
      const value = Number(row.close ?? row.price ?? row.last ?? row.value);
      if (!Number.isFinite(parsedTime) || !Number.isFinite(value)) return null;
      const point: NodeChartPoint = {
        time: parsedTime,
        value,
      };
      if (Number.isFinite(Number(row.volume))) {
        point.volume = Number(row.volume);
      }
      return point;
    })
    .filter((point): point is NodeChartPoint => point !== null);
}

type ThresholdActionCreateDetail = {
  sourceNodeId: string;
  sourceHandleId: string;
  sourceHandleIds?: string[];
  clientPoint?: CanvasPoint;
  outputBlockId: string;
  blockName: string;
  chartIndex?: number;
  condition: IndicatorCondition;
  conditions?: IndicatorCondition[];
  mergeMode?: "AND" | "OR";
  directSignal?: boolean;
};

type ConditionJunctionModeChangeDetail = {
  nodeId: string;
  mode?: "AND" | "OR";
};

type ConditionBracketLeafPayload = {
  id: string;
  order?: number;
  sourceNodeId: string;
  sourceHandleId: string;
  outputBlockId: string;
  blockName: string;
  label: string;
  condition: IndicatorCondition;
};

type ConditionLogicTree =
  | {
    type: "leaf";
    sourceNodeId: string;
    sourceHandleId: string;
    outputBlockId: string;
    condition: IndicatorCondition;
    expression: string;
  }
  | {
    type: "operator";
    mode: "AND" | "OR";
    left: ConditionLogicTree;
    right: ConditionLogicTree;
    expression: string;
  };

type ConditionEndpoint = {
  id: string;
  source: string;
  sourceHandle: string;
  label: string;
  conditions: IndicatorCondition[];
  condition: IndicatorCondition & Record<string, unknown>;
  expression: string;
  tree: ConditionLogicTree;
  sourceNodeIds: string[];
  sourceOutputBlockIds: string[];
};

type BuiltConditionBracketGraph = {
  nodes: Node[];
  edges: Edge[];
  nodeIds: string[];
  edgeIds: string[];
  finalCondition: IndicatorCondition & Record<string, unknown>;
};

function getAbsoluteNodePosition(node: Node | undefined, nodesById: Map<string, Node>) {
  if (!node) return { x: 0, y: 0 };
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;

  while (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeConditionMode(value: unknown, fallback: "AND" | "OR" = "AND"): "AND" | "OR" {
  return value === "OR" ? "OR" : value === "AND" ? "AND" : fallback;
}

function sanitizeConditionExpressionField(value: string) {
  return sanitizeHandlePart(value || "value").replace(/-/g, "_") || "value";
}

function formatConditionExpressionValue(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return String(numeric);
  return JSON.stringify(String(value ?? ""));
}

function buildLeafConditionExpression(leaf: ConditionBracketLeafPayload) {
  const field = sanitizeConditionExpressionField(leaf.outputBlockId || leaf.condition.metric || leaf.blockName);
  return `${leaf.sourceNodeId}::${field} ${leaf.condition.operator} ${formatConditionExpressionValue(leaf.condition.threshold)}`;
}

function makeLeafConditionEndpoint(leaf: ConditionBracketLeafPayload): ConditionEndpoint {
  const expression = buildLeafConditionExpression(leaf);
  const condition = {
    ...leaf.condition,
    metric: leaf.condition.metric || leaf.blockName,
    sourceNodeId: leaf.sourceNodeId,
    sourceHandleId: leaf.sourceHandleId,
    sourceOutputBlockId: leaf.outputBlockId,
    order: leaf.order,
    expression,
    conditionExpression: expression,
  };
  const tree: ConditionLogicTree = {
    type: "leaf",
    sourceNodeId: leaf.sourceNodeId,
    sourceHandleId: leaf.sourceHandleId,
    outputBlockId: leaf.outputBlockId,
    condition,
    expression,
  };

  return {
    id: leaf.id,
    source: leaf.sourceNodeId,
    sourceHandle: leaf.sourceHandleId,
    label: leaf.label,
    conditions: [condition],
    condition,
    expression,
    tree,
    sourceNodeIds: [leaf.sourceNodeId],
    sourceOutputBlockIds: [leaf.outputBlockId],
  };
}

function makeMergedConditionEndpoint({
  id,
  source,
  sourceHandle,
  label,
  mode,
  left,
  right,
}: {
  id: string;
  source: string;
  sourceHandle: string;
  label: string;
  mode: "AND" | "OR";
  left: ConditionEndpoint;
  right: ConditionEndpoint;
}): ConditionEndpoint {
  const expression = `(${left.expression}) ${mode === "OR" ? "||" : "&&"} (${right.expression})`;
  const conditions = [...left.conditions, ...right.conditions];
  const tree: ConditionLogicTree = {
    type: "operator",
    mode,
    left: left.tree,
    right: right.tree,
    expression,
  };
  const condition = {
    ...(conditions[0] ?? {
      metric: "condition",
      operator: ">=" as const,
      threshold: 1,
    }),
    metric: conditions[0]?.metric || "condition",
    conditions,
    mergeMode: mode,
    expression,
    conditionExpression: expression,
    conditionTree: tree,
    conditionSourceIds: uniqueStrings([...left.sourceNodeIds, ...right.sourceNodeIds]),
    conditionSourceOutputBlockIds: uniqueStrings([...left.sourceOutputBlockIds, ...right.sourceOutputBlockIds]),
  };

  return {
    id,
    source,
    sourceHandle,
    label,
    conditions,
    condition,
    expression,
    tree,
    sourceNodeIds: condition.conditionSourceIds as string[],
    sourceOutputBlockIds: condition.conditionSourceOutputBlockIds as string[],
  };
}

function readExistingConditionJunctionMode(nodesById: Map<string, Node>, nodeId: string, fallback: "AND" | "OR") {
  const data = nodesById.get(nodeId)?.data as Record<string, unknown> | undefined;
  return normalizeConditionMode(data?.mode, fallback);
}

function conditionJunctionBelongsToGroup(node: Node | undefined, groupId: string) {
  if (!node || node.type !== "conditionJunction") return false;
  const data = node.data as Record<string, unknown> | undefined;
  return data?.bracketGroupId === groupId || node.id === groupId || node.id.startsWith(`${groupId}-`);
}

function makeConditionJunctionOutputBlock(): BlockData {
  return {
    id: "yes-no",
    name: "yes/no",
    description: "condition result",
    type: "output",
    outputKind: "boolean-data",
  };
}

function getConditionEndpointBlock(endpoint: ConditionEndpoint, fallbackId: "left" | "right" | "input"): BlockData {
  return {
    id: fallbackId,
    name: endpoint.label,
    description: endpoint.expression,
    type: "input",
  };
}

function getConditionEdgeData(endpoint: ConditionEndpoint, mode: "AND" | "OR", extra: Record<string, unknown> = {}) {
  const leafTree = endpoint.tree.type === "leaf" ? endpoint.tree : null;
  const leafOrder = (endpoint.condition as Record<string, unknown>).order;
  return {
    ...extra,
    condition: endpoint.condition,
    conditionExpression: endpoint.expression,
    conditionTree: endpoint.tree,
    conditionSourceIds: endpoint.sourceNodeIds,
    conditionSourceOutputBlockIds: endpoint.sourceOutputBlockIds,
    conditionLeaf: leafTree
      ? {
        id: endpoint.id,
        order: typeof leafOrder === "number" && Number.isFinite(leafOrder) ? leafOrder : undefined,
        sourceNodeId: leafTree.sourceNodeId,
        sourceHandleId: leafTree.sourceHandleId,
        outputBlockId: leafTree.outputBlockId,
        blockName: String(endpoint.condition.metric || leafTree.outputBlockId),
        label: endpoint.label,
        condition: leafTree.condition,
      }
      : undefined,
    logicMode: mode,
  };
}

function getConditionBracketPositionForAction(actionNode: Node, junctionNode: Node) {
  const actionSize = getEditorNodeSize(actionNode);
  const junctionSize = getEditorNodeSize(junctionNode);
  const data = junctionNode.data as Record<string, unknown>;
  const roundNo = Number(data.bracketRoundNo);
  const maxRoundNo = Number(data.bracketMaxRoundNo);
  const bracketCenterY = Number(data.bracketCenterY);
  const bracketHeight = Number(data.bracketHeight);

  if (
    !Number.isFinite(roundNo) ||
    !Number.isFinite(maxRoundNo) ||
    !Number.isFinite(bracketCenterY) ||
    !Number.isFinite(bracketHeight)
  ) {
    return null;
  }

  const actionCenterY = actionNode.position.y + actionSize.height / 2;
  const centerY = actionCenterY - bracketHeight / 2 + bracketCenterY;

  return {
    x: actionNode.position.x - CONDITION_JUNCTION_ACTION_GAP - Math.max(0, maxRoundNo - roundNo) * CONDITION_BRACKET_ROUND_GAP,
    y: centerY - junctionSize.height / 2,
  };
}

function getConditionJunctionPositionForAction(actionNode: Node, junctionNode?: Node) {
  if (junctionNode) {
    const bracketPosition = getConditionBracketPositionForAction(actionNode, junctionNode);
    if (bracketPosition) return bracketPosition;
  }

  const actionSize = getEditorNodeSize(actionNode);
  const junctionSize = junctionNode ? getEditorNodeSize(junctionNode) : { width: 1, height: 96 };

  return {
    x: actionNode.position.x - CONDITION_JUNCTION_ACTION_GAP,
    y: actionNode.position.y + actionSize.height / 2 - junctionSize.height / 2,
  };
}

function buildConditionBracketGraph({
  baseId,
  leaves,
  actionNode,
  actionId,
  nodesById,
  defaultMode,
}: {
  baseId: string;
  leaves: ConditionBracketLeafPayload[];
  actionNode: Node;
  actionId: string;
  nodesById: Map<string, Node>;
  defaultMode: "AND" | "OR";
}): BuiltConditionBracketGraph | null {
  if (leaves.length === 0) return null;

  const bracket = buildConditionBracket(
    leaves.map((leaf) => ({ id: leaf.id, payload: leaf })),
    {
      baseId,
      leafHeight: CONDITION_BRACKET_LEAF_HEIGHT,
      rowGap: CONDITION_BRACKET_ROW_GAP,
    },
  );
  const endpointByRepId = new Map<string, ConditionEndpoint>();

  bracket.rounds[0].forEach((node) => {
    if (node.type !== "leaf" || !node.leaf) return;
    endpointByRepId.set(node.id, makeLeafConditionEndpoint(node.leaf.payload));
  });

  const conditionNodes: Node[] = [];
  const conditionEdges: Edge[] = [];
  const maxRoundNo = Math.max(1, bracket.rounds.length);
  const makeNodePatch = (
    nodeId: string,
    mode: "AND" | "OR",
    centerY: number,
    roundNo: number,
    inputBlocks: BlockData[],
    endpoint: ConditionEndpoint,
  ): Node => {
    const patch: Node = {
      id: nodeId,
      type: "conditionJunction",
      parentId: actionNode.parentId,
      extent: actionNode.parentId ? ("parent" as const) : undefined,
      expandParent: Boolean(actionNode.parentId),
      selected: false,
      selectable: false,
      draggable: false,
      focusable: false,
      position: { x: 0, y: 0 },
      data: {
        label: mode,
        mode,
        bracketGroupId: baseId,
        bracketRoundNo: roundNo,
        bracketMaxRoundNo: maxRoundNo,
        bracketCenterY: centerY,
        bracketHeight: bracket.height,
        passthrough: inputBlocks.length <= 1,
        condition: endpoint.condition,
        conditionExpression: endpoint.expression,
        conditionTree: endpoint.tree,
        conditionSourceIds: endpoint.sourceNodeIds,
        inputBlocks,
        outputBlocks: [makeConditionJunctionOutputBlock()],
      },
    };

    return {
      ...patch,
      position: getConditionJunctionPositionForAction(actionNode, patch),
    };
  };
  const pushInputEdge = (
    edgeId: string,
    endpoint: ConditionEndpoint,
    targetId: string,
    inputBlockId: string,
    mode: "AND" | "OR",
  ) => {
    conditionEdges.push({
      id: edgeId,
      source: endpoint.source,
      target: targetId,
      sourceHandle: endpoint.sourceHandle,
      targetHandle: `${targetId}-input-${inputBlockId}-in`,
      type: "conditionMerge",
      selectable: false,
      data: getConditionEdgeData(endpoint, mode),
    });
  };

  bracket.visibleOperators.forEach((operator) => {
    const leftRepId = operator.left.rep?.sourceId;
    const rightRepId = operator.right.rep?.sourceId;
    const leftEndpoint = leftRepId ? endpointByRepId.get(leftRepId) : undefined;
    const rightEndpoint = rightRepId ? endpointByRepId.get(rightRepId) : undefined;
    if (!leftEndpoint || !rightEndpoint) return;

    const mode = readExistingConditionJunctionMode(nodesById, operator.id, defaultMode);
    const outputEndpoint = makeMergedConditionEndpoint({
      id: operator.id,
      source: operator.id,
      sourceHandle: `${operator.id}-condition-out`,
      label: `${mode} ${operator.roundNo}.${operator.index}`,
      mode,
      left: leftEndpoint,
      right: rightEndpoint,
    });
    const inputBlocks = [
      getConditionEndpointBlock(leftEndpoint, "left"),
      getConditionEndpointBlock(rightEndpoint, "right"),
    ];

    conditionNodes.push(makeNodePatch(operator.id, mode, operator.centerY, operator.roundNo, inputBlocks, outputEndpoint));
    pushInputEdge(`e-${leftEndpoint.id}-${operator.id}-left`, leftEndpoint, operator.id, "left", mode);
    pushInputEdge(`e-${rightEndpoint.id}-${operator.id}-right`, rightEndpoint, operator.id, "right", mode);
    endpointByRepId.set(operator.id, outputEndpoint);
  });

  let rootEndpoint = bracket.rootRep?.sourceId ? endpointByRepId.get(bracket.rootRep.sourceId) : undefined;
  let rootNodeId = rootEndpoint?.source ?? "";
  let finalMode = defaultMode;

  if (!rootEndpoint) {
    const firstLeaf = leaves[0];
    const leafEndpoint = makeLeafConditionEndpoint(firstLeaf);
    const nodeId = baseId;
    finalMode = readExistingConditionJunctionMode(nodesById, nodeId, "AND");
    const passthroughEndpoint = makeMergedConditionEndpoint({
      id: nodeId,
      source: nodeId,
      sourceHandle: `${nodeId}-condition-out`,
      label: firstLeaf.label,
      mode: finalMode,
      left: leafEndpoint,
      right: leafEndpoint,
    });
    const condition = {
      ...leafEndpoint.condition,
      mergeMode: undefined,
      conditions: [leafEndpoint.condition],
      expression: leafEndpoint.expression,
      conditionExpression: leafEndpoint.expression,
      conditionTree: leafEndpoint.tree,
      conditionSourceIds: leafEndpoint.sourceNodeIds,
    };
    const singleEndpoint: ConditionEndpoint = {
      ...passthroughEndpoint,
      condition,
      expression: leafEndpoint.expression,
      tree: leafEndpoint.tree,
      conditions: [leafEndpoint.condition],
    };

    conditionNodes.push(makeNodePatch(
      nodeId,
      finalMode,
      bracket.height / 2,
      maxRoundNo,
      [getConditionEndpointBlock(leafEndpoint, "input")],
      singleEndpoint,
    ));
    pushInputEdge(`e-${leafEndpoint.id}-${nodeId}-input`, leafEndpoint, nodeId, "input", finalMode);
    rootEndpoint = singleEndpoint;
    rootNodeId = nodeId;
  } else if (rootEndpoint.source === rootNodeId) {
    finalMode = readExistingConditionJunctionMode(nodesById, rootNodeId, defaultMode);
  }

  if (!rootEndpoint || !rootNodeId) return null;

  const actionEdgeId = `e-${rootNodeId}-${actionId}`;
  conditionEdges.push({
    id: actionEdgeId,
    source: rootEndpoint.source,
    target: actionId,
    sourceHandle: rootEndpoint.sourceHandle,
    targetHandle: `${actionId}-func-in`,
    type: "conditionMerge",
    data: getConditionEdgeData(rootEndpoint, finalMode, {
      delay: 0,
      waitForResult: true,
      bracketGroupId: baseId,
    }),
  });

  return {
    nodes: conditionNodes,
    edges: conditionEdges,
    nodeIds: conditionNodes.map((node) => node.id),
    edgeIds: conditionEdges.map((edge) => edge.id),
    finalCondition: rootEndpoint.condition,
  };
}

function readConditionLeafPayloadFromEdge(edge: Edge): ConditionBracketLeafPayload | null {
  const data = edge.data as Record<string, unknown> | undefined;
  const rawLeaf = data?.conditionLeaf && typeof data.conditionLeaf === "object"
    ? data.conditionLeaf as Record<string, unknown>
    : null;
  const rawCondition = rawLeaf?.condition ?? data?.condition;
  if (!rawCondition || typeof rawCondition !== "object") return null;

  const condition = rawCondition as IndicatorCondition;
  if (!condition.operator || typeof condition.threshold !== "number") return null;

  const sourceNodeId = typeof rawLeaf?.sourceNodeId === "string" && rawLeaf.sourceNodeId
    ? rawLeaf.sourceNodeId
    : edge.source;
  const sourceHandleId = typeof rawLeaf?.sourceHandleId === "string" && rawLeaf.sourceHandleId
    ? rawLeaf.sourceHandleId
    : edge.sourceHandle ?? "";
  if (!sourceNodeId || !sourceHandleId) return null;

  const outputBlockId = typeof rawLeaf?.outputBlockId === "string" && rawLeaf.outputBlockId
    ? rawLeaf.outputBlockId
    : typeof (condition as Record<string, unknown>).sourceOutputBlockId === "string"
      ? (condition as Record<string, string>).sourceOutputBlockId
      : sanitizeHandlePart(sourceHandleId.replace(/-trigger-.+$/, ""));
  const blockName = typeof rawLeaf?.blockName === "string" && rawLeaf.blockName
    ? rawLeaf.blockName
    : String(condition.metric || outputBlockId || "condition");
  const label = typeof rawLeaf?.label === "string" && rawLeaf.label
    ? rawLeaf.label
    : `${condition.operator} ${formatThresholdActionValue(Number(condition.threshold))}`;
  const order = typeof rawLeaf?.order === "number" && Number.isFinite(rawLeaf.order)
    ? rawLeaf.order
    : typeof (condition as Record<string, unknown>).order === "number" && Number.isFinite((condition as Record<string, unknown>).order)
      ? Number((condition as Record<string, unknown>).order)
      : undefined;

  return {
    id: typeof rawLeaf?.id === "string" && rawLeaf.id
      ? rawLeaf.id
      : `condition-leaf-${sanitizeHandlePart(sourceHandleId)}`,
    order,
    sourceNodeId,
    sourceHandleId,
    outputBlockId,
    blockName,
    label,
    condition: {
      ...condition,
      metric: condition.metric || blockName,
    },
  };
}

function rebuildConditionBracketGroup({
  nodeList,
  edgeList,
  groupId,
  defaultMode,
}: {
  nodeList: Node[];
  edgeList: Edge[];
  groupId: string;
  defaultMode: "AND" | "OR";
}) {
  const nodesById = new Map(nodeList.map((node) => [node.id, node]));
  const groupNodeIds = new Set(
    nodeList
      .filter((node) => conditionJunctionBelongsToGroup(node, groupId))
      .map((node) => node.id),
  );
  if (groupNodeIds.size === 0) return null;

  const actionEdge = edgeList.find((edge) =>
    groupNodeIds.has(edge.source) &&
    edge.sourceHandle?.endsWith("-condition-out") &&
    nodesById.get(edge.target)?.type === "actionNode",
  );
  const actionNode = actionEdge ? nodesById.get(actionEdge.target) : undefined;
  if (!actionEdge || !actionNode) return null;

  const leavesByHandle = new Map<string, ConditionBracketLeafPayload>();
  edgeList.forEach((edge) => {
    if (!groupNodeIds.has(edge.target) || groupNodeIds.has(edge.source) || !edge.targetHandle?.includes("-input-")) return;
    const leaf = readConditionLeafPayloadFromEdge(edge);
    if (!leaf) return;
    const key = `${leaf.sourceNodeId}:${leaf.sourceHandleId}`;
    const previous = leavesByHandle.get(key);
    if (!previous || (leaf.order ?? Number.MAX_SAFE_INTEGER) < (previous.order ?? Number.MAX_SAFE_INTEGER)) {
      leavesByHandle.set(key, leaf);
    }
  });

  const leaves = Array.from(leavesByHandle.values()).sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
    a.sourceHandleId.localeCompare(b.sourceHandleId),
  );
  if (leaves.length === 0) return null;

  const bracketGraph = buildConditionBracketGraph({
    baseId: groupId,
    leaves,
    actionNode,
    actionId: actionNode.id,
    nodesById,
    defaultMode,
  });
  if (!bracketGraph) return null;

  const actionData = actionNode.data as Record<string, unknown>;
  const previousTriggerCondition = actionData.triggerCondition && typeof actionData.triggerCondition === "object"
    ? actionData.triggerCondition as Record<string, unknown>
    : {};
  const nextActionNode: Node = {
    ...actionNode,
    data: {
      ...actionData,
      triggerCondition: {
        ...bracketGraph.finalCondition,
        directSignal: previousTriggerCondition.directSignal === true,
        sourceOutputBlockId: previousTriggerCondition.sourceOutputBlockId ?? leaves[0]?.outputBlockId,
      },
    },
  };

  const nextNodes = [
    ...nodeList
      .filter((node) => !conditionJunctionBelongsToGroup(node, groupId))
      .map((node) => node.id === actionNode.id ? nextActionNode : node),
    ...bracketGraph.nodes,
  ];
  const nextEdges = [
    ...edgeList.filter((edge) => {
      if (groupNodeIds.has(edge.source) || groupNodeIds.has(edge.target)) return false;
      const data = edge.data as Record<string, unknown> | undefined;
      return data?.bracketGroupId !== groupId;
    }),
    ...bracketGraph.edges,
  ];

  return {
    nodes: nextNodes,
    edges: nextEdges,
    nodeIds: bracketGraph.nodeIds,
    actionId: actionNode.id,
  };
}

function syncConditionJunctionsForAction(nodeList: Node[], edgeList: Edge[], actionNode: Node) {
  const rootJunctionIds = new Set(
    edgeList
      .filter((edge) => edge.target === actionNode.id && edge.sourceHandle?.endsWith("-condition-out"))
      .map((edge) => edge.source),
  );

  if (rootJunctionIds.size === 0) return nodeList;

  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  const bracketGroupIds = new Set<string>();
  rootJunctionIds.forEach((nodeId) => {
    const data = nodeById.get(nodeId)?.data as Record<string, unknown> | undefined;
    if (typeof data?.bracketGroupId === "string" && data.bracketGroupId) {
      bracketGroupIds.add(data.bracketGroupId);
    }
  });

  const shouldMoveJunction = (node: Node) => {
    if (node.type !== "conditionJunction") return false;
    if (rootJunctionIds.has(node.id)) return true;
    const data = node.data as Record<string, unknown> | undefined;
    return typeof data?.bracketGroupId === "string" && bracketGroupIds.has(data.bracketGroupId);
  };

  return nodeList.map((node) => {
    if (!shouldMoveJunction(node)) return node;
    return {
      ...node,
      parentId: actionNode.parentId,
      extent: actionNode.parentId ? ("parent" as const) : undefined,
      expandParent: Boolean(actionNode.parentId),
      position: getConditionJunctionPositionForAction(actionNode, node),
    };
  });
}

function formatThresholdActionValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getEdgeConditionPayload(edge: Edge): (IndicatorCondition & Record<string, unknown>) | null {
  const condition = (edge.data as { condition?: unknown } | undefined)?.condition;
  if (isIndicatorCondition(condition)) return condition;

  if (condition && typeof condition === "object") {
    const record = condition as IndicatorCondition & Record<string, unknown>;
    if (Array.isArray(record.conditions) || typeof record.expression === "string" || typeof record.conditionExpression === "string") {
      return record;
    }
  }

  return null;
}

function getConditionsFromPayload(payload: (IndicatorCondition & Record<string, unknown>) | null) {
  if (!payload) return [];
  if (Array.isArray(payload.conditions)) {
    const nested = payload.conditions.filter(isIndicatorCondition);
    if (nested.length > 0) return nested;
  }
  return isIndicatorCondition(payload) ? [payload] : [];
}

function getConditionPayloadExpression(payload: (IndicatorCondition & Record<string, unknown>) | null) {
  if (!payload) return "";
  return typeof payload.conditionExpression === "string"
    ? payload.conditionExpression
    : typeof payload.expression === "string"
      ? payload.expression
      : "";
}

function buildMergedJunctionCondition(junctionNode: Node | undefined, inputEdges: Edge[]) {
  const mode = ((junctionNode?.data as Record<string, unknown> | undefined)?.mode === "OR" ? "OR" : "AND") as "AND" | "OR";
  const payloads = inputEdges
    .map(getEdgeConditionPayload)
    .filter((condition): condition is IndicatorCondition & Record<string, unknown> => Boolean(condition));
  const conditions = payloads.flatMap(getConditionsFromPayload);

  if (conditions.length === 0) return null;

  const expressionParts = payloads.map(getConditionPayloadExpression).filter(Boolean);
  const expression = expressionParts.length > 0
    ? expressionParts.map((part) => `(${part})`).join(` ${mode === "OR" ? "||" : "&&"} `)
    : "";
  const conditionTrees = payloads
    .map((payload) => payload.conditionTree)
    .filter(Boolean);

  return {
    ...conditions[0],
    metric: conditions[0].metric || "condition",
    conditions,
    mergeMode: mode,
    ...(expression ? { expression, conditionExpression: expression } : {}),
    ...(conditionTrees.length > 0
      ? {
        conditionTree: conditionTrees.length === 1
          ? conditionTrees[0]
          : { type: "operator", mode, children: conditionTrees, expression },
      }
      : {}),
  };
}

function syncConditionJunctionOutputEdges(edgeList: Edge[], nodeList: Node[], junctionId: string) {
  const nodesById = new Map(nodeList.map((node) => [node.id, node]));
  const junctionNode = nodesById.get(junctionId);
  if (!junctionNode) return edgeList;

  const inputEdges = edgeList.filter((edge) => edge.target === junctionId && edge.targetHandle?.includes("-input-"));
  const mergedCondition = buildMergedJunctionCondition(junctionNode, inputEdges);
  if (!mergedCondition) return edgeList;
  const logicMode = mergedCondition.mergeMode;

  return edgeList.map((edge) => {
    if (edge.source !== junctionId || !edge.sourceHandle?.endsWith("-condition-out")) return edge;
    return {
      ...edge,
      type: "conditionMerge",
      data: {
        ...edge.data,
        delay: 0,
        waitForResult: true,
        condition: mergedCondition,
        logicMode,
      },
    };
  });
}

function NodeEditorInner({ initialGraph, initialGraphVersion = 0, previewMode = false }: NodeEditorProps) {
  const { fitView, getIntersectingNodes, getNodes, screenToFlowPosition } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodesInitialized = useNodesInitialized();
  const initialSnapshot = useMemo(() => {
    if (initialGraph) {
      return normalizeEditorGraphEdges(initialGraph);
    }
    if (previewMode) return null;
    const activeId = historyStore.getActiveId();
    const snapshot = historyStore.getSnapshotById(activeId);
    return snapshot ? normalizeEditorGraphEdges(snapshot) : null;
  }, [initialGraph, previewMode]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialSnapshot && initialSnapshot.nodes.length > 0 ? initialSnapshot.nodes : [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialSnapshot && initialSnapshot.nodes.length > 0 ? initialSnapshot.edges : [],
  );

  // Undo/Redo history
  const [history, setHistory] = useState<EditorHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  const isUndoRedoRef = useRef(false);
  const initLayoutRunRef = useRef(false);
  const [isSequenceLayoutAnimating, setIsSequenceLayoutAnimating] = useState(false);
  const latestGraphRef = useRef({ nodes, edges });
  const isNodeDraggingRef = useRef(false);
  const historyCommitTimerRef = useRef<number | null>(null);
  const snapshotPersistTimerRef = useRef<number | null>(null);
  const lastHistorySignatureRef = useRef("");
  const committedHistoryGraphRef = useRef<EditorHistoryGraph>({ nodes: [], edges: [] });
  const lastPersistedSnapshotSignatureRef = useRef("");
  const sequenceLayoutAnimationTimerRef = useRef<number | null>(null);
  const sequenceRelayoutFrameRef = useRef<number | null>(null);
  const measuredSequenceRelayoutFrameRef = useRef<number | null>(null);
  const containmentResizeFrameRef = useRef<number | null>(null);
  const connectionStartRef = useRef<OnConnectStartParams | null>(null);
  const [focusState, setFocusState] = useState<FocusState>({
    isActive: false,
    focusedNodeId: null,
    connectedNodeIds: [],
    connectedEdgeIds: [],
  });
  const [isSequenceMonitorOpen, setIsSequenceMonitorOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    selectedNodes: Node[];
  } | null>(null);
  const nodeIdRef = useRef(10);

  useEffect(() => {
    latestGraphRef.current = { nodes, edges };
  }, [nodes, edges]);

  const commitLatestGraphToHistory = useCallback(() => {
    const latestGraph = latestGraphRef.current;
    const historyGraph = createEditorHistoryGraph(latestGraph.nodes, latestGraph.edges);
    const previousHistoryGraph = committedHistoryGraphRef.current;
    const entry = createEditorHistoryEntry(previousHistoryGraph, historyGraph);
    if (!entry) return;

    lastHistorySignatureRef.current = entry.afterSignature;
    committedHistoryGraphRef.current = cloneEditorHistoryGraph(historyGraph);
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndexRef.current);
      const nextHistory = [...newHistory, entry];
      const trimmedHistory = nextHistory.length > MAX_EDITOR_HISTORY_ENTRIES
        ? nextHistory.slice(-MAX_EDITOR_HISTORY_ENTRIES)
        : nextHistory;
      historyIndexRef.current = trimmedHistory.length;
      setHistoryIndex(trimmedHistory.length);
      return trimmedHistory;
    });
  }, []);

  const persistGraphToActiveSnapshot = useCallback((graph: { nodes: Node[]; edges: Edge[] }) => {
    if (previewMode) return;
    if (!historyStore.getActiveId()) return;

    const historyGraph = createEditorHistoryGraph(graph.nodes, graph.edges);
    const nextSignature = JSON.stringify(historyGraph);
    if (lastPersistedSnapshotSignatureRef.current === nextSignature) {
      return;
    }

    lastPersistedSnapshotSignatureRef.current = nextSignature;
    historyStore.updateActiveSnapshot(historyGraph.nodes, historyGraph.edges);
  }, [previewMode]);

  const persistLatestGraphToActiveSnapshot = useCallback(() => {
    persistGraphToActiveSnapshot(latestGraphRef.current);
  }, [persistGraphToActiveSnapshot]);

  const scheduleSettledGraphCommit = useCallback(() => {
    window.requestAnimationFrame(() => {
      commitLatestGraphToHistory();
      persistLatestGraphToActiveSnapshot();
    });
  }, [commitLatestGraphToHistory, persistLatestGraphToActiveSnapshot]);

  const handleNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    const effectiveChanges = isNodeDraggingRef.current
      ? changes.filter((change) => change.type === "position")
      : changes;

    if (effectiveChanges.length === 0) return;
    onNodesChange(effectiveChanges);
  }, [onNodesChange]);

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

  const stopSequenceLayoutAnimation = useCallback(() => {
    if (sequenceLayoutAnimationTimerRef.current !== null) {
      window.clearTimeout(sequenceLayoutAnimationTimerRef.current);
      sequenceLayoutAnimationTimerRef.current = null;
    }

    setIsSequenceLayoutAnimating(false);
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
      const safeGraph = normalizeEditorGraphEdges({ nodes: inputNodes, edges: inputEdges });
      const normalized = applySequenceCollapsedState(safeGraph.nodes, safeGraph.edges);
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
      if (historyCommitTimerRef.current !== null) {
        window.clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = null;
      }
      if (snapshotPersistTimerRef.current !== null) {
        window.clearTimeout(snapshotPersistTimerRef.current);
        snapshotPersistTimerRef.current = null;
      }
      if (containmentResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(containmentResizeFrameRef.current);
        containmentResizeFrameRef.current = null;
      }
      stopSequenceLayoutAnimation();
    };
  }, [clearPendingSequenceRelayout, stopSequenceLayoutAnimation]);

  const marketChartRequestPayload = useMemo(() => {
    const requests = nodes
      .filter((node) => node.type === "streamingNode")
      .map((node) => {
        const data = node.data as StreamingNodeData;
        if (data.streamKind && data.streamKind !== "url") return null;
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

  const yahooChartRequestPayload = useMemo(() => {
    const requests = nodes
      .filter((node) => node.type === "streamingNode")
      .map((node) => {
        const data = node.data as StreamingNodeData;
        if (!isYahooFinanceChartUrl(data.url)) return null;
        return {
          nodeId: node.id,
          url: data.url,
          intervalMs: data.intervalMs ?? 60_000,
        };
      })
      .filter((item): item is { nodeId: string; url: string; intervalMs: number } => Boolean(item));

    return JSON.stringify(requests);
  }, [nodes]);

  useEffect(() => {
    const requests = JSON.parse(yahooChartRequestPayload) as Array<{
      nodeId: string;
      url: string;
      intervalMs: number;
    }>;
    if (requests.length === 0) return;

    let cancelled = false;
    let inFlight = false;
    const intervalMs = Math.max(
      30_000,
      Math.min(...requests.map((request) => Math.max(30_000, Number(request.intervalMs) || 60_000))),
    );

    const loadYahooCharts = async () => {
      if (inFlight) return;
      inFlight = true;
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const response = await fetch(getYahooFinanceFetchUrl(request.url), {
              headers: { Accept: "application/json" },
            });
            if (!response.ok) {
              throw new Error(`Yahoo Finance returned ${response.status}`);
            }
            const payload = await response.json();
            const parsed = parseYahooFinanceChartPayload(payload);
            return {
              ...request,
              ok: true,
              series: parsed.series,
              seriesByField: parsed.seriesByField,
              symbol: parsed.symbol,
              source: `Yahoo Finance chart: ${parsed.symbol}`,
              updatedAt: new Date().toISOString(),
              warning: "",
            };
          } catch (error) {
            return {
              ...request,
              ok: false,
              series: [] as NodeChartPoint[],
              seriesByField: {} as Record<string, NodeChartPoint[]>,
              symbol: "",
              source: "Yahoo Finance chart endpoint",
              updatedAt: new Date().toISOString(),
              warning: error instanceof Error ? error.message : "Yahoo chart fetch failed",
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

          if (!result.ok) {
            if (currentData.chartWarning === result.warning && currentData.chartSource === result.source) return node;
            changed = true;
            return {
              ...node,
              data: {
                ...node.data,
                chartSource: result.source,
                chartUpdatedAt: result.updatedAt,
                chartWarning: result.warning,
              },
            };
          }

          const outputBlocks = applyStreamingOutputChartSeries(
            currentData.outputBlocks,
            result.series,
            result.seriesByField,
          );
          if (
            chartSeriesEqual(currentData.chartSeries, result.series) &&
            outputBlocks === currentData.outputBlocks &&
            currentData.chartSource === result.source &&
            currentData.chartWarning === ""
          ) {
            return node;
          }

          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              chartSeries: result.series,
              outputBlocks,
              chartSource: result.source,
              chartUpdatedAt: result.updatedAt,
              chartSymbol: result.symbol,
              chartWarning: "",
            },
          };
        });

        return changed ? nextNodes : currentNodes;
      });
    };

    void loadYahooCharts();
    const timer = window.setInterval(() => void loadYahooCharts(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [setNodes, yahooChartRequestPayload]);

  useEffect(() => {
    const requests = JSON.parse(marketChartRequestPayload) as Array<{ nodeIds: string[]; symbol: string; market: string }>;
    if (requests.length === 0) return;

    let cancelled = false;
    const loadCharts = async () => {
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const payload = await getDummyMarketChart({
              symbol: request.symbol,
              market: request.market,
              interval: "1m",
              limit: 96,
            });
            const series = Array.isArray(payload?.series)
              ? payload.series
                .map((point: { time?: unknown; value?: unknown; volume?: unknown }) => {
                  const volume = Number(point.volume);
                  return {
                    time: Number(point.time),
                    value: Number(point.value),
                    volume: Number.isFinite(volume) ? volume : undefined,
                  };
                })
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
            chartSeriesEqual(((currentData.outputBlocks?.[0] as Record<string, unknown> | undefined)?.chartSeries as NodeChartPoint[] | undefined), series) &&
            currentData.chartSource === meta.source &&
            currentData.chartWarning === meta.warning
          ) {
            return node;
          }
          const outputBlocks = applyStreamingOutputChartSeries(currentData.outputBlocks, series ?? []);
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              chartSeries: series,
              outputBlocks,
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
    const timer = window.setInterval(() => void loadCharts(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
            const payload = await getDummyStreamSample({
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
            });
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
          const outputBlocks = applyStreamingOutputChartSeries(currentData.outputBlocks, series);

          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              chartSeries: series,
              outputBlocks,
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
              const series = getChartSeriesForOutputHandle(sourceNode, edge.sourceHandle);
              if (!Array.isArray(series) || series.length === 0) return null;
              const sourceBlockName = getOutputBlockForHandle(sourceNode, edge.sourceHandle)?.name;
              const targetInputBlock = getInputBlockForHandle(currentFunctionNode, edge.targetHandle);
              const sourceNodeName = getNodeDisplayName(sourceNode);
              return {
                node: sourceNode,
                series,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
                targetInputId: targetInputBlock?.id,
                sourceBlockName,
                targetInputName: targetInputBlock?.name,
                connectedFrom: sourceBlockName ? `${sourceNodeName}.${sourceBlockName}` : undefined,
              };
            })
            .filter((item): item is ReactiveIncomingSeries => Boolean(item));

          const currentData = currentFunctionNode.data as FunctionNodeData;
          const outputBlocks = Array.isArray(currentData.outputBlocks) ? currentData.outputBlocks as BlockData[] : [];
          const chartableOutputBlocks = outputBlocks.filter((block) => !isTriggerDataBlock(block));
          const nextOutputBlocks = outputBlocks.map((block) => ({ ...block }));
          let nodeChartPatch: Partial<FunctionNodeData> = {};
          let nodeChanged = false;

          chartableOutputBlocks.forEach((outputBlock, outputIndex) => {
            const result = deriveFunctionChartSeries(currentFunctionNode, incoming, outputBlock);
            if (!result) return;

            const blockIndex = nextOutputBlocks.findIndex((block) => block.id === outputBlock.id);
            if (blockIndex < 0) return;
            const currentBlock = nextOutputBlocks[blockIndex] as BlockData & {
              chartSeries?: NodeChartPoint[];
              chartSource?: string;
              chartWarning?: string;
            };
            const nextSeries = result.series.length > 0 ? result.series : currentBlock.chartSeries;
            const seriesSame = result.series.length > 0
              ? chartSeriesEqual(currentBlock.chartSeries, nextSeries)
              : true;
            const nextWarning = result.warning || "";
            if (
              seriesSame &&
              currentBlock.chartSource === result.source &&
              (currentBlock.chartWarning || "") === nextWarning
            ) {
              return;
            }

            const updatedBlock = {
              ...currentBlock,
              chartSeries: nextSeries,
              chartSource: result.source,
              chartUpdatedAt: new Date().toISOString(),
              chartWarning: nextWarning,
            };
            nextOutputBlocks[blockIndex] = updatedBlock;
            nodeChanged = true;

            if (outputIndex === 0) {
              nodeChartPatch = {
                chartSeries: nextSeries,
                chartSource: result.source,
                chartUpdatedAt: updatedBlock.chartUpdatedAt,
                chartWarning: nextWarning,
              };
            }
          });

          if (!nodeChanged) continue;

          const updatedNode = {
            ...currentFunctionNode,
            data: {
              ...currentFunctionNode.data,
              ...nodeChartPatch,
              outputBlocks: nextOutputBlocks,
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

  const loadedInitialGraphVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!initialGraph) {
      return;
    }
    if (loadedInitialGraphVersionRef.current === initialGraphVersion) {
      return;
    }

    const runtimeGraph = normalizeEditorGraphEdges({
      ...initialGraph,
      nodes: clearRuntimeProgramFromNodes(initialGraph.nodes),
    });
    const historyGraph = createEditorHistoryGraph(runtimeGraph.nodes, runtimeGraph.edges);

    loadedInitialGraphVersionRef.current = initialGraphVersion;
    lastHistorySignatureRef.current = JSON.stringify(historyGraph);
    committedHistoryGraphRef.current = cloneEditorHistoryGraph(historyGraph);
    lastPersistedSnapshotSignatureRef.current = JSON.stringify(historyGraph);
    initLayoutRunRef.current = true;
    isUndoRedoRef.current = true;
    setHistory([]);
    historyIndexRef.current = 0;
    setHistoryIndex(0);
    applyMeasuredLayout(runtimeGraph.nodes, runtimeGraph.edges, { fitView: true });
  }, [applyMeasuredLayout, initialGraph, initialGraphVersion]);

  useEffect(() => {
    setNodes((currentNodes) => clearRuntimeProgramFromNodes(currentNodes));
  }, [setNodes]);

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

      let result = nodeList;
      let changed = false;
      sortedParentIds.forEach(parentId => {
        const parentNode = result.find((node) => node.id === parentId);
        if (!parentNode) return;

        const children = result.filter(n => n.parentId === parentId);
        if (children.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        children.forEach(c => {
          const { width: w, height: h } = getEditorNodeSize(c);
          minX = Math.min(minX, c.position.x);
          minY = Math.min(minY, c.position.y);
          maxX = Math.max(maxX, c.position.x + w);
          maxY = Math.max(maxY, c.position.y + h);
        });

        const shiftX = Math.max(0, PADDING - minX);
        const shiftY = Math.max(0, PADDING - minY);
        const adjustedMaxX = maxX + shiftX;
        const adjustedMaxY = maxY + shiftY;
        const curW = readNodeDimension(parentNode.style?.width) || readNodeDimension(parentNode.width) || 400;
        const curH = readNodeDimension(parentNode.style?.height) || readNodeDimension(parentNode.height) || 300;
        const newW = Math.max(curW + shiftX, adjustedMaxX + PADDING);
        const newH = Math.max(curH + shiftY, adjustedMaxY + PADDING);
        let passChanged = false;

        const nextResult = result.map(n => {
          if (n.id === parentId) {
            if (newW <= curW && newH <= curH && shiftX === 0 && shiftY === 0) return n; // only grow, never shrink
            const width = Math.max(curW, newW);
            const height = Math.max(curH, newH);
            passChanged = true;
            return {
              ...n,
              position: {
                x: n.position.x - shiftX,
                y: n.position.y - shiftY,
              },
              width,
              height,
              style: { ...n.style, width, height },
            };
          }

          if (n.parentId === parentId && (shiftX > 0 || shiftY > 0)) {
            passChanged = true;
            return {
              ...n,
              position: {
                x: n.position.x + shiftX,
                y: n.position.y + shiftY,
              },
            };
          }

          return n;
        });

        if (passChanged) {
          result = nextResult;
          changed = true;
        }
      });

      return changed ? result : nodeList;
    },
    []
  );

  const handleCreateThresholdActionNode = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent<ThresholdActionCreateDetail>).detail;
      if (!detail?.sourceNodeId || !detail.sourceHandleId || !detail.outputBlockId || !detail.blockName) return;

      const sourceNode = nodes.find((node) => node.id === detail.sourceNodeId);
      if (!sourceNode) return;

      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      const sourceHandleIds = (detail.sourceHandleIds?.length ? detail.sourceHandleIds : [detail.sourceHandleId])
        .filter((handleId): handleId is string => Boolean(handleId));
      const sourceHandleIdSet = new Set(sourceHandleIds);
      const conditions = (detail.conditions?.length ? detail.conditions : [detail.condition]).map((condition) => ({
        ...condition,
        metric: condition.metric || detail.blockName,
      }));
      const isDirectSignal = detail.directSignal === true;
      const defaultMode = normalizeConditionMode(detail.mergeMode, "AND");
      const junctionId = `condition-junction-${sanitizeHandlePart(detail.sourceNodeId)}-${sanitizeHandlePart(detail.outputBlockId)}`;
      const conditionLeaves: ConditionBracketLeafPayload[] = sourceHandleIds.map((sourceHandleId, index) => {
      const condition = conditions[index] ?? conditions[0];
        return {
          id: `condition-leaf-${sanitizeHandlePart(sourceHandleId)}`,
          order: index,
          sourceNodeId: detail.sourceNodeId,
          sourceHandleId,
          outputBlockId: detail.outputBlockId,
          blockName: detail.blockName,
          label: condition
            ? `${condition.operator} ${formatThresholdActionValue(Number(condition.threshold))}`
            : `C${index + 1}`,
          condition,
        };
      });
      if (conditionLeaves.length === 0) return;

      const directActionEdge = edges.find((edge) => {
        if (edge.source !== detail.sourceNodeId || !sourceHandleIdSet.has(edge.sourceHandle ?? "")) return false;
        return nodesById.get(edge.target)?.type === "actionNode";
      });
      const junctionActionEdge = edges.find((edge) => {
        const source = nodesById.get(edge.source);
        return conditionJunctionBelongsToGroup(source, junctionId) &&
          edge.sourceHandle?.endsWith("-condition-out") &&
          nodesById.get(edge.target)?.type === "actionNode";
      });
      const existingTargetNode =
        (junctionActionEdge ? nodesById.get(junctionActionEdge.target) : undefined) ??
        (directActionEdge ? nodesById.get(directActionEdge.target) : undefined);
      const now = Date.now();
      const actionId = existingTargetNode?.id ?? `action-${now}`;
      const sourceSize = getEditorNodeSize(sourceNode);
      const sourcePosition = getAbsoluteNodePosition(sourceNode, nodesById);
      const anchorPosition = detail.clientPoint
        ? screenToFlowPosition(detail.clientPoint)
        : {
          x: sourcePosition.x + sourceSize.width,
          y: sourcePosition.y + 86 + (detail.chartIndex ?? 0) * 96,
        };
      const targetParentId = sourceNode.parentId;
      const parentPosition = targetParentId
        ? getAbsoluteNodePosition(nodesById.get(targetParentId), nodesById)
        : { x: 0, y: 0 };
      const bracketRoundCount = Math.max(1, Math.ceil(Math.log2(Math.max(1, conditionLeaves.length))));
      const actionOffsetX =
        92 +
        CONDITION_JUNCTION_ACTION_GAP +
        Math.max(0, bracketRoundCount - 1) * CONDITION_BRACKET_ROUND_GAP;
      const actionPosition = {
        x: anchorPosition.x + actionOffsetX - parentPosition.x,
        y: anchorPosition.y - 58 - parentPosition.y,
      };
      const fallbackTriggerCondition = {
        ...conditions[0],
        metric: conditions[0]?.metric || detail.blockName,
        conditions,
        mergeMode: conditionLeaves.length > 1 ? defaultMode : undefined,
        directSignal: isDirectSignal,
      };
      const conditionSummary = conditions
        .map((condition) => `${condition.operator} ${formatThresholdActionValue(Number(condition.threshold))}`)
        .join(` ${defaultMode} `);
      const existingActionData = existingTargetNode?.data as Partial<DEXActionData> | undefined;
      const baseActionData: DEXActionData = {
        ...(existingActionData ?? {}),
        label: isDirectSignal
          ? `Action when ${detail.blockName} YES`
          : `Action when ${detail.blockName} ${conditionSummary}`,
        actionType: "DEX",
        contractAddress: "0x...",
        functionName: "swap()",
        chainId: 1,
        inputBlocks: [],
        outputBlocks: (existingActionData?.outputBlocks?.length
          ? existingActionData.outputBlocks
          : [{ id: `dex-ob-${now}`, name: "success", type: "output" }]),
        isExpanded: false,
        triggerCondition: fallbackTriggerCondition,
        triggerOutputBlockId: detail.outputBlockId,
      };
      const actionNodeBase: Node<DEXActionData> = {
        id: actionId,
        type: "actionNode",
        parentId: targetParentId,
        extent: targetParentId ? ("parent" as const) : undefined,
        expandParent: Boolean(targetParentId),
        position: actionPosition,
        selected: true,
        data: baseActionData,
      };
      const bracketGraph = buildConditionBracketGraph({
        baseId: junctionId,
        leaves: conditionLeaves,
        actionNode: actionNodeBase,
        actionId,
        nodesById,
        defaultMode,
      });
      if (!bracketGraph) return;
      const actionData: DEXActionData = {
        ...baseActionData,
        triggerCondition: {
          ...bracketGraph.finalCondition,
          directSignal: isDirectSignal,
          sourceOutputBlockId: detail.outputBlockId,
        },
      };
      const actionNodePatch: Node<DEXActionData> = {
        ...actionNodeBase,
        data: actionData,
      };

      setNodes((currentNodes) => {
        const hasExistingTargetInState = currentNodes.some((node) => node.id === actionId);
        const withoutOldConditionNodes = currentNodes.filter((node) => !conditionJunctionBelongsToGroup(node, junctionId));
        let nextNodes: Node[] = hasExistingTargetInState
          ? withoutOldConditionNodes.map((node) =>
            node.id === actionId
              ? {
                ...node,
                ...actionNodePatch,
              }
              : { ...node, selected: false },
          )
          : [
            ...withoutOldConditionNodes.map((node) => ({ ...node, selected: false })),
            actionNodePatch,
          ];

        nextNodes = [...nextNodes, ...bracketGraph.nodes];

        return resizeParentsToFitChildren(nextNodes);
      });

      setEdges((currentEdges) => {
        const oldConditionNodeIds = new Set(
          nodes
            .filter((node) => conditionJunctionBelongsToGroup(node, junctionId))
            .map((node) => node.id),
        );
        bracketGraph.nodeIds.forEach((nodeId) => oldConditionNodeIds.add(nodeId));
        const retainedEdges = currentEdges.filter((edge) => {
          if (edge.source === detail.sourceNodeId && sourceHandleIdSet.has(edge.sourceHandle ?? "")) return false;
          if (oldConditionNodeIds.has(edge.source) || oldConditionNodeIds.has(edge.target)) return false;
          return true;
        });

        return [...retainedEdges, ...bracketGraph.edges];
      });

      window.requestAnimationFrame(() => {
        updateNodeInternals(detail.sourceNodeId);
        bracketGraph.nodeIds.forEach((nodeId) => updateNodeInternals(nodeId));
        updateNodeInternals(actionId);
        window.setTimeout(() => {
          updateNodeInternals(detail.sourceNodeId);
          bracketGraph.nodeIds.forEach((nodeId) => updateNodeInternals(nodeId));
          updateNodeInternals(actionId);
        }, 0);
      });

      setFocusState({
        isActive: true,
        focusedNodeId: detail.sourceNodeId,
        connectedNodeIds: [...bracketGraph.nodeIds, actionId],
        connectedEdgeIds: bracketGraph.edgeIds,
      });
    },
    [edges, nodes, resizeParentsToFitChildren, screenToFlowPosition, setEdges, setNodes, updateNodeInternals],
  );

  useEffect(() => {
    window.addEventListener("createThresholdActionNode", handleCreateThresholdActionNode);
    return () => window.removeEventListener("createThresholdActionNode", handleCreateThresholdActionNode);
  }, [handleCreateThresholdActionNode]);

  const handleConditionJunctionModeChange = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent<ConditionJunctionModeChangeDetail>).detail;
      if (!detail?.nodeId) return;

      const targetNode = nodes.find((node) => node.id === detail.nodeId);
      if (!targetNode || targetNode.type !== "conditionJunction") return;

      const targetData = targetNode.data as Record<string, unknown>;
      const groupId = typeof targetData.bracketGroupId === "string" ? targetData.bracketGroupId : "";
      if (!groupId) return;

      const currentMode = normalizeConditionMode(targetData.mode, "AND");
      const nextMode = normalizeConditionMode(detail.mode, currentMode === "OR" ? "AND" : "OR");
      const nodeListWithMode = nodes.map((node) =>
        node.id === detail.nodeId
          ? {
            ...node,
            data: {
              ...(node.data as Record<string, unknown>),
              label: nextMode,
              mode: nextMode,
            },
          }
          : node,
      );
      const rebuilt = rebuildConditionBracketGroup({
        nodeList: nodeListWithMode,
        edgeList: edges,
        groupId,
        defaultMode: nextMode,
      });

      if (!rebuilt) {
        setNodes(nodeListWithMode);
        setEdges((currentEdges) => currentEdges.map((edge) => {
          if (edge.source !== detail.nodeId && edge.target !== detail.nodeId) return edge;
          return {
            ...edge,
            data: {
              ...(edge.data as Record<string, unknown> | undefined),
              logicMode: nextMode,
            },
          };
        }));
        window.requestAnimationFrame(() => updateNodeInternals(detail.nodeId));
        return;
      }

      setNodes(resizeParentsToFitChildren(rebuilt.nodes));
      setEdges(rebuilt.edges);

      window.requestAnimationFrame(() => {
        rebuilt.nodeIds.forEach((nodeId) => updateNodeInternals(nodeId));
        updateNodeInternals(rebuilt.actionId);
      });
    },
    [edges, nodes, resizeParentsToFitChildren, setEdges, setNodes, updateNodeInternals],
  );

  useEffect(() => {
    window.addEventListener("conditionJunctionModeChange", handleConditionJunctionModeChange);
    return () => window.removeEventListener("conditionJunctionModeChange", handleConditionJunctionModeChange);
  }, [handleConditionJunctionModeChange]);

  // Calculate connected nodes and edges when focus changes.
  // A focused parent/group should keep every descendant block in the same focus set.
  const getConnectedInfo = useCallback((nodeId: string) => {
    const focusTreeNodeIds = new Set<string>([nodeId]);
    collectDescendantIds(nodes, nodeId).forEach((id) => focusTreeNodeIds.add(id));

    const connectedNodeIds = new Set<string>();
    const connectedEdgeIds = new Set<string>();

    focusTreeNodeIds.forEach((id) => {
      if (id !== nodeId) connectedNodeIds.add(id);
    });

    edges.forEach((edge) => {
      const sourceInFocusTree = focusTreeNodeIds.has(edge.source);
      const targetInFocusTree = focusTreeNodeIds.has(edge.target);
      if (!sourceInFocusTree && !targetInFocusTree) return;

      connectedEdgeIds.add(edge.id);
      if (edge.source !== nodeId) connectedNodeIds.add(edge.source);
      if (edge.target !== nodeId) connectedNodeIds.add(edge.target);
    });

    return {
      connectedNodeIds: [...connectedNodeIds],
      connectedEdgeIds: [...connectedEdgeIds],
    };
  }, [edges, nodes]);

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

  const handleCreateHistoricalApiBlock = useCallback((event: Event) => {
    const detail = (event as CustomEvent<CreateHistoricalApiBlockDetail>).detail;
    if (!detail?.label) return;

    const normalizedFields = Array.from(new Set(
      (detail.outputFields ?? [])
        .map((field) => String(field).trim())
        .filter(Boolean),
    ));
    const fallbackFields = detail.normalizedPreviewRows?.[0]
      ? Object.keys(detail.normalizedPreviewRows[0]).filter((key) => !["date", "time", "timestamp", "symbol"].includes(key))
      : [];
    const outputFields = (normalizedFields.length > 0 ? normalizedFields : fallbackFields).slice(0, 8);
    const chartSeries = buildHistoricalPreviewChartSeries(detail.normalizedPreviewRows);
    const datasetData = {
      historicalDatasetId: detail.datasetId,
      historicalDatasetFileName: detail.datasetFileName,
      dataNormalizationMode: "ai-normalized",
      chartSeries,
      chartSource: detail.datasetFileName
        ? `AI normalized historical dataset: ${detail.datasetFileName}`
        : "AI normalized historical dataset",
      chartUpdatedAt: new Date().toISOString(),
    };
    let focusNodeId = detail.sourceNodeId || "";

    setNodes((currentNodes) => {
      const existingNode = detail.sourceNodeId
        ? currentNodes.find((node) => node.id === detail.sourceNodeId)
        : null;
      const outputBlocks = outputFields.map((field) => ({
        id: `${existingNode?.id ?? "historical-api"}-ob-${field.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "value"}`,
        name: field,
        type: "output" as const,
      }));

      if (existingNode) {
        return currentNodes.map((node) => {
          if (node.id !== existingNode.id) return node;
          const currentData = node.data && typeof node.data === "object" ? node.data as Partial<StreamingNodeData> : {};
          return {
            ...node,
            data: {
              ...currentData,
              ...datasetData,
              label: detail.label,
              url: detail.url || currentData.url || "",
              method: detail.method || currentData.method || "POLLING",
              streamKind: detail.streamKind || currentData.streamKind || "url",
              intervalMs: currentData.intervalMs ?? 86_400_000,
              isActive: currentData.isActive ?? false,
              outputBlocks: outputBlocks.length > 0
                ? outputBlocks
                : currentData.outputBlocks ?? [{ id: `${existingNode.id}-ob-close`, name: "close", type: "output" }],
              isExpanded: true,
            } satisfies StreamingNodeData,
          };
        });
      }

      const { id } = createUniqueNodeId("historical-api", currentNodes, nodeIdRef);
      focusNodeId = id;
      const maxX = currentNodes.reduce((max, node) => Math.max(max, Number(node.position?.x ?? 0)), 0);
      const newNode: Node = {
        id,
        type: "streamingNode",
        position: { x: maxX + 360, y: 120 },
        data: {
          label: detail.label,
          method: detail.method || "POLLING",
          url: detail.url,
          intervalMs: 86_400_000,
          isActive: false,
          streamKind: detail.streamKind || "url",
          outputBlocks: outputBlocks.length > 0
            ? outputBlocks.map((block) => ({ ...block, id: `${id}-${block.id}` }))
            : [{ id: `${id}-ob-close`, name: "close", type: "output" }],
          isExpanded: true,
          apiReference: detail.url,
          requestHint: detail.datasetFileName
            ? `Use AI-normalized historical dataset ${detail.datasetFileName} as the backtest source.`
            : "Use AI-normalized historical data as the backtest source.",
          ...datasetData,
        } satisfies StreamingNodeData,
      };
      return [...currentNodes, newNode];
    });

    window.setTimeout(() => {
      if (focusNodeId) {
        window.dispatchEvent(new CustomEvent("nodeFocus", { detail: { nodeId: focusNodeId } }));
      }
      fitView({ duration: 600, padding: 0.2 });
    }, 80);
  }, [fitView, setNodes]);

  useEffect(() => {
    window.addEventListener("createHistoricalApiBlock", handleCreateHistoricalApiBlock);
    return () => window.removeEventListener("createHistoricalApiBlock", handleCreateHistoricalApiBlock);
  }, [handleCreateHistoricalApiBlock]);

  useEffect(() => {
    const normalizedEdges = normalizeConditionMergeEdges(nodes, edges);
    if (normalizedEdges === edges) return;

    setEdges(normalizedEdges);
  }, [edges, nodes, setEdges]);

  // Save editor undo history after interaction settles. Dragging and ReactFlow
  // measurements can update many times per second, so committing every change
  // makes large graphs feel sticky.
  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    if (isNodeDraggingRef.current) return;
    if (nodes.length === 0 && edges.length === 0) return;

    if (historyCommitTimerRef.current !== null) {
      window.clearTimeout(historyCommitTimerRef.current);
    }

    historyCommitTimerRef.current = window.setTimeout(() => {
      historyCommitTimerRef.current = null;
      commitLatestGraphToHistory();
    }, EDITOR_HISTORY_COMMIT_DELAY_MS);

    return () => {
      if (historyCommitTimerRef.current !== null) {
        window.clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = null;
      }
    };
  }, [nodes, edges, commitLatestGraphToHistory]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    if (!entry) return;

    isUndoRedoRef.current = true;
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    const currentGraph = createEditorHistoryGraph(latestGraphRef.current.nodes, latestGraphRef.current.edges);
    const graph = applyEditorHistoryEntry(currentGraph, entry, "undo");
    committedHistoryGraphRef.current = cloneEditorHistoryGraph(graph);
    lastHistorySignatureRef.current = entry.beforeSignature;
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [historyIndex, history, setNodes, setEdges]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length) return;

    const entry = history[historyIndex];
    if (!entry) return;
    const newIndex = historyIndex + 1;

    isUndoRedoRef.current = true;
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    const currentGraph = createEditorHistoryGraph(latestGraphRef.current.nodes, latestGraphRef.current.edges);
    const graph = applyEditorHistoryEntry(currentGraph, entry, "redo");
    committedHistoryGraphRef.current = cloneEditorHistoryGraph(graph);
    lastHistorySignatureRef.current = entry.afterSignature;
    setNodes(graph.nodes);
    setEdges(graph.edges);
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

  // ESC key closes focus mode.
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
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusState.isActive, setNodes]);

  // ------------------------------------------
  // Group Feature
  // ------------------------------------------
  const getGroupableSelectedNodes = useCallback((
    groupKind: "sequence" | "master",
    selection: Node[] = nodes.filter((node) => node.selected),
  ) => {
    const rawSelectedIds = new Set(selection.map((node) => node.id));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const hasSelectedAncestor = (node: Node) => {
      let parentId = node.parentId;
      while (parentId) {
        if (rawSelectedIds.has(parentId)) return true;
        parentId = nodesById.get(parentId)?.parentId;
      }
      return false;
    };
    return selection.filter((node) => {
      if (hasSelectedAncestor(node)) return false;
      if (groupKind === "sequence") return node.type !== "groupNode";
      if (node.type !== "groupNode") return true;
      return (node.data as Record<string, unknown> | undefined)?.styleType !== "solid";
    });
  }, [nodes]);

  const handleGroup = useCallback((groupKind: "sequence" | "master" = "sequence") => {
    const selectedNodes = getGroupableSelectedNodes(groupKind);
    if (selectedNodes.length < 1) return;

    const isMasterGroup = groupKind === "master";
    const groupLabel = isMasterGroup ? "New Master Group" : "New Sequence Group";
    const styleType = isMasterGroup ? "solid" : "dashed-trigger";

    const newGroupId = `${isMasterGroup ? "master" : "sequence"}-group-${Date.now()}`;
    const selectedIds = new Set(selectedNodes.map(n => n.id));

    // Helper: get absolute position of a node (walking up the parentId chain)
    const getAbsPos = (nodeId: string): { x: number; y: number } => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return { x: 0, y: 0 };
      if (!node.parentId) return { ...node.position };
      const parentAbs = getAbsPos(node.parentId);
      return { x: parentAbs.x + node.position.x, y: parentAbs.y + node.position.y };
    };

    // Calculate bounding box using ABSOLUTE coordinates of selected nodes.
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
        explanation: isMasterGroup
          ? "Master group owns the run control for the selected strategy area."
          : "Sequence group organizes related logic for monitoring and readability.",
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
            expandParent: false,
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

    // AI auto-summary for newly created group.
    const nodeLabels = selectedNodes
      .map(n => (n.data as any)?.label || (n.data as any)?.functionName || n.id)
      .filter(Boolean);

    const summary = isMasterGroup
      ? `Master group for ${nodeLabels.join(", ")}. It owns the run button while child blocks keep their own logic.`
      : `Sequence group for ${nodeLabels.join(", ")}. It only separates the monitor panel and labels this logic area.`;

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
        setNodes(nds =>
          nds.map(n =>
            n.id === newGroupId
              ? { ...n, data: { ...n.data, explanation: summary } }
              : n
          )
        );
      }
    }, 18);

    setContextMenu(null);
  }, [getGroupableSelectedNodes, nodes, setNodes]);

  // G-key shortcut: group selected nodes (placed after handleGroup declaration)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        handleGroup("sequence");
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
    window.dispatchEvent(new CustomEvent("aiExplainGroup", { detail: { groupId: "multi-selection", label: `Selected nodes (${nodeLabels})` } }));
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

  const handleNodeDragStart = useCallback(() => {
    isNodeDraggingRef.current = true;
    clearPendingSequenceRelayout();
    if (historyCommitTimerRef.current !== null) {
      window.clearTimeout(historyCommitTimerRef.current);
      historyCommitTimerRef.current = null;
    }
    if (snapshotPersistTimerRef.current !== null) {
      window.clearTimeout(snapshotPersistTimerRef.current);
      snapshotPersistTimerRef.current = null;
    }
    stopSequenceLayoutAnimation();
  }, [clearPendingSequenceRelayout, stopSequenceLayoutAnimation]);

  const finishNodeDrag = useCallback(() => {
    isNodeDraggingRef.current = false;
    scheduleSettledGraphCommit();
  }, [scheduleSettledGraphCommit]);

  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      if (draggedNode.type === "actionNode") {
        const timeline = getOverlappingTimeline(draggedNode);
        window.dispatchEvent(
          new CustomEvent("dragOverTimeline", {
            detail: { timelineId: timeline?.id ?? null, dragging: !!timeline },
          })
        );
      }
    },
    [getOverlappingTimeline]
  );

  // Drop: when drag ends over a timeline or group, reparent accordingly
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      try {
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
          const currentParent = allNodes.find((node) => node.id === draggedNode.parentId);
          const isSequenceInsideStrategy =
            draggedStyleType !== "solid" &&
            currentParent?.type === "groupNode" &&
            (currentParent.data as any)?.styleType === "solid";
          if (isSequenceInsideStrategy) {
            setNodes((nds) => resizeParentsToFitChildren(nds));
            return;
          }

          const draggedAbs = getAbsolutePosition(draggedNode.id);
          setNodes((nds) => nds.map(n => {
            if (n.id !== draggedNode.id) return n;
            return { ...n, parentId: undefined, extent: undefined, expandParent: undefined, position: draggedAbs };
          }));
        }
        return;
      }

      // 3. Non-groupNode drag: only reparent between sequence groups.
      // Falling back to the solid strategy parent makes child blocks jump while
      // users are simply arranging blocks inside a sequence.
      const intersections = getIntersectingNodes(draggedNode).filter(n => n.type === "groupNode");
      const nodesById = new Map(allNodes.map((node) => [node.id, node]));
      const currentDraggedNode = nodesById.get(draggedNode.id) ?? draggedNode;
      const currentParentId = currentDraggedNode.parentId ?? draggedNode.parentId;
      const target = pickDeepestStrategySequenceGroup(intersections, nodesById);

      if (target) {
        if (currentParentId !== target.id) {
          const draggedAbs = getAbsolutePosition(draggedNode.id);
          const targetAbs = getAbsolutePosition(target.id);
          setNodes((nds) => {
            const updated = nds.map(n => {
              if (n.id !== draggedNode.id) return n;
              return {
                ...n,
                parentId: target.id,
                extent: "parent" as const,
                expandParent: false,
                position: { x: draggedAbs.x - targetAbs.x, y: draggedAbs.y - targetAbs.y },
              };
            });
            const updatedActionNode = updated.find((node) => node.id === draggedNode.id) ?? draggedNode;
            const synced = draggedNode.type === "actionNode"
              ? syncConditionJunctionsForAction(updated, edges, updatedActionNode)
              : updated;
            return resizeParentsToFitChildren(synced);
          });
        } else {
          // Already in the right parent — still resize in case position changed
          setNodes((nds) => {
            const liveActionNode = nds.find((node) => node.id === draggedNode.id) ?? draggedNode;
            const synced = draggedNode.type === "actionNode"
              ? syncConditionJunctionsForAction(nds, edges, liveActionNode)
              : nds;
            return resizeParentsToFitChildren(synced);
          });
        }
        return;
      }

      if (currentParentId) {
        setNodes((nds) => {
          const liveActionNode = nds.find((node) => node.id === draggedNode.id) ?? draggedNode;
          const synced = draggedNode.type === "actionNode"
            ? syncConditionJunctionsForAction(nds, edges, liveActionNode)
            : nds;
          return resizeParentsToFitChildren(synced);
        });
      }
      } finally {
        finishNodeDrag();
      }
    },
    [edges, finishNodeDrag, getOverlappingTimeline, setNodes, setEdges, getIntersectingNodes, getNodes, resizeParentsToFitChildren]
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
      let nextParams: Connection = resolveCollapsedConnectionHandles(
        { ...normalizedParams },
        sourceNode,
        targetNode,
      );

      const shouldUseAsInput = Boolean(
        sourceNode &&
        targetNode &&
        isConnectableSourceHandle(nextParams.sourceHandle) &&
        (isInputBlockTargetHandle(nextParams.targetHandle) ||
          (isOutputBlockSourceHandle(nextParams.sourceHandle) &&
            canPromoteExecutionTargetToInput(targetNode, nextParams.targetHandle))),
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
              const nextOutputBlocks = node.type === "functionNode"
                ? appendPassthroughOutputBlockIfNeeded(
                  nodeData.outputBlocks as BlockData[] | undefined,
                  inputUpdate.nextInputBlock,
                  inputUpdate.connectedFrom,
                )
                : nodeData.outputBlocks;
              return {
                ...node,
                data: {
                  ...node.data,
                  ...actionFieldPatch,
                  ...(node.type === "actionNode" ? { isExpanded: true } : {}),
                  ...(node.type === "functionNode" ? { isExpanded: true, outputBlocks: nextOutputBlocks } : {}),
                  inputBlocks: inputUpdate.inputBlocks,
                  inputDescription: nodeData.inputDescription || `Input data: ${inputUpdate.connectedFrom}`,
                },
              };
            }),
          );

          window.setTimeout(() => updateNodeInternals(targetNode.id), 0);
        }
      }

      const edgePresentation = getConnectionEdgePresentation({
        params: nextParams,
        sourceNode,
        targetNode,
      });

      const newEdgeId = `e-${nextParams.source}-${nextParams.target}-${Date.now()}`;
      setEdges((eds) => {
        const nextEdges = addEdge(
          { ...nextParams, id: newEdgeId, type: edgePresentation.type, data: edgePresentation.data },
          eds,
        );
        return targetNode?.type === "conditionJunction"
          ? syncConditionJunctionOutputEdges(nextEdges, nodes, targetNode.id)
          : nextEdges;
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
    [setEdges, nodes, getConnectedInfo, setNodes, updateNodeInternals]
  );

  const handleReconnect = useCallback<OnReconnect<Edge>>(
    (oldEdge, newConnection) => {
      if (previewMode) return;

      const normalizedConnection = normalizeConnectionDirection(newConnection);
      if (!normalizedConnection || !isAllowedEditorConnection(normalizedConnection)) {
        return;
      }

      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      const sourceNode = nodesById.get(normalizedConnection.source);
      const targetNode = nodesById.get(normalizedConnection.target);

      let nextParams: Connection = resolveCollapsedConnectionHandles(
        { ...normalizedConnection },
        sourceNode,
        targetNode,
      );
      const currentOldEdge = edges.find((edge) => edge.id === oldEdge.id) ?? oldEdge;
      const oldTargetNode = nodesById.get(currentOldEdge.target);
      const shouldUseAsInput = Boolean(
        sourceNode &&
        targetNode &&
        isConnectableSourceHandle(nextParams.sourceHandle) &&
        (isInputBlockTargetHandle(nextParams.targetHandle) ||
          (isOutputBlockSourceHandle(nextParams.sourceHandle) &&
            canPromoteExecutionTargetToInput(targetNode, nextParams.targetHandle))),
      );
      const inputUpdate = sourceNode && targetNode && shouldUseAsInput
        ? buildInputConnectionUpdate({
          sourceNode,
          targetNode,
          sourceHandle: nextParams.sourceHandle,
          targetHandle: nextParams.targetHandle,
        })
        : null;

      if (inputUpdate) {
        nextParams = {
          ...nextParams,
          targetHandle: inputUpdate.targetHandle,
        };
      }

      const edgePresentation = getConnectionEdgePresentation({
        params: nextParams,
        sourceNode,
        targetNode,
        baseData: currentOldEdge.data as Record<string, unknown> | undefined,
      });
      const reconnectedEdges = reconnectEdge(
        currentOldEdge,
        nextParams,
        edges,
        { shouldReplaceId: false },
      ).map((edge) =>
        edge.id === currentOldEdge.id
          ? {
            ...edge,
            type: edgePresentation.type,
            data: edgePresentation.data,
          }
          : edge,
      );

      const junctionIdsToSync = new Set<string>();
      if (targetNode?.type === "conditionJunction") junctionIdsToSync.add(targetNode.id);
      if (oldTargetNode?.type === "conditionJunction") junctionIdsToSync.add(oldTargetNode.id);
      const oldSourceNode = nodesById.get(currentOldEdge.source);
      if (oldSourceNode?.type === "conditionJunction") junctionIdsToSync.add(oldSourceNode.id);

      let nextEdges = reconnectedEdges;
      junctionIdsToSync.forEach((junctionId) => {
        nextEdges = syncConditionJunctionOutputEdges(nextEdges, nodes, junctionId);
      });

      const removableActionIds = new Set<string>();
      if (
        oldTargetNode?.type === "actionNode" &&
        currentOldEdge.target !== nextParams.target &&
        !nextEdges.some((edge) => edge.source === currentOldEdge.target || edge.target === currentOldEdge.target)
      ) {
        removableActionIds.add(currentOldEdge.target);
      }

      if (removableActionIds.size > 0) {
        nextEdges = nextEdges.filter((edge) => !removableActionIds.has(edge.source) && !removableActionIds.has(edge.target));
      }

      setEdges(nextEdges);
      setNodes((currentNodes) => {
        const nextNodes = currentNodes
          .filter((node) => !removableActionIds.has(node.id))
          .map((node) => {
            if (!inputUpdate || node.id !== targetNode?.id) return node;
            const nodeData = node.data as Record<string, unknown>;
            return {
              ...node,
              data: {
                ...node.data,
                inputBlocks: inputUpdate.inputBlocks,
                inputDescription: nodeData.inputDescription || `Input data: ${inputUpdate.connectedFrom}`,
              },
            };
          });

        return resizeParentsToFitChildren(nextNodes);
      });

      window.requestAnimationFrame(() => {
        updateNodeInternals(nextParams.source);
        updateNodeInternals(nextParams.target);
        if (targetNode?.type === "conditionJunction") updateNodeInternals(targetNode.id);
      });
    },
    [edges, nodes, previewMode, resizeParentsToFitChildren, setEdges, setNodes, updateNodeInternals],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const normalizedConnection =
        "source" in connection && "target" in connection
          ? normalizeConnectionDirection(connection as Connection)
          : null;

      if (!normalizedConnection || !isAllowedEditorConnection(normalizedConnection)) return false;

      return true;
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
    (type: "function" | "trigger" | "branch" | "action" | "cex" | "dex" | "streaming") => {
      setNodes((currentNodes) => {
        const { id, index } = createUniqueNodeId(type, currentNodes, nodeIdRef);
        let newNode: Node | null = null;

        switch (type) {
          case "function":
            newNode = {
              id,
              type: "functionNode",
              position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
              data: {
                label: `Indicator Logic ${index}`,
                description: "Indicator logic visualized as a chart and used as a trigger over matching condition ranges",
                functionName: `indicator${index}()`,
                code:
                  "function indicator({ price, volume }) {\n" +
                  "  const movingAverage = sma(price, 20);\n" +
                  "  const signal = price.at(-1) > movingAverage.at(-1);\n" +
                  "  return { movingAverage, signal };\n" +
                  "}",
                inputDescription: "Receives streaming blocks or other indicator outputs as input.",
                outputDescription: "Outputs changing data exposed as chart-connectable output blocks.",
                inputBlocks: [
                  {
                    id: `${id}-ib-source`,
                    name: "source",
                    description: "Price/volume or previous indicator output",
                    type: "input",
                  },
                ],
                outputBlocks: [
                  {
                    id: `${id}-ob-signal`,
                    name: "signal",
                    description: "Real-time changing trigger indicator",
                    type: "output",
                    formulaCode: "source",
                    outputMode: "formula",
                    condition: {
                      metric: "signal",
                      operator: ">",
                      threshold: 108,
                    },
                  },
                ],
                condition: {
                  metric: "signal",
                  operator: ">",
                  threshold: 108,
                },
                showChartComparison: true,
                chartComparisonValues: [],
                viewMode: "node",
              } satisfies FunctionNodeData,
            };
            break;
          case "trigger":
            newNode = {
              id,
              type: "timeTrigger",
              position: { x: 100 + Math.random() * 100, y: 100 + Math.random() * 100 },
              data: {
                label: "Trigger",
                triggerMode: "TIME",
                interval: 5,
                isActive: false,
                shortcut: null,
                isRecording: false,
                outputBlocks: [
                  {
                    id: `${id}-ob-yes-no`,
                    name: "yes/no",
                    description: "Returns a boolean yes/no signal when the condition is met.",
                    type: "output",
                    outputKind: "boolean-data",
                  },
                ],
              } satisfies TimeTriggerData,
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
                  { id: `${id}-branch-1`, name: "Branch 1", active: false },
                ],
              } satisfies BranchNodeData,
            };
            break;
          case "action":
          case "dex":
            newNode = {
              id,
              type: "actionNode",
              position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
              data: {
                label: `Action ${index}`,
                actionType: "DEX",
                contractAddress: "0x...",
                functionName: "swap()",
                chainId: 1,
                inputBlocks: [],
                outputBlocks: [{ id: `${id}-ob-success`, name: "success", type: "output" }],
              } satisfies DEXActionData,
            };
            break;
          case "cex":
            newNode = {
              id,
              type: "actionNode",
              position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
              data: {
                label: `Action ${index}`,
                actionType: "CEX",
                exchange: "Binance",
                symbol: "BTC/USDT",
                side: "BUY",
                orderType: "MARKET",
                amount: "0.1",
                amountType: "FIXED",
                inputBlocks: [],
                outputBlocks: [{ id: `${id}-ob-success`, name: "success", type: "output" }],
              } satisfies CEXActionData,
            };
            break;
          case "streaming":
            newNode = {
              id,
              type: "streamingNode",
              position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
              data: createBinanceSpotPriceStreamData({
                label: `Binance Spot Price Stream ${index}`,
                outputBlocks: [{ id: `${id}-ob-last-price`, name: "lastPrice", type: "output" }],
                symbols: ["BTCUSDT"],
              }) satisfies StreamingNodeData,
            };
            break;
          default:
            return currentNodes;
        }

        return newNode ? [...currentNodes, newNode] : currentNodes;
      });
    },
    [setNodes]
  );

  const handleDeleteSelected = useCallback(() => {
    const currentGraph = latestGraphRef.current;
    const selectedNodeIds = new Set(
      currentGraph.nodes
        .filter((node) => node.selected)
        .map((node) => node.id),
    );
    const hasSelectedEdges = currentGraph.edges.some((edge) => edge.selected);

    if (selectedNodeIds.size === 0 && !hasSelectedEdges) return;

    const nextGraph = sanitizeEditorGraph({
      nodes: currentGraph.nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges: currentGraph.edges.filter((edge) =>
        !edge.selected &&
        !selectedNodeIds.has(edge.source) &&
        !selectedNodeIds.has(edge.target),
      ),
    });

    latestGraphRef.current = nextGraph;
    setNodes(nextGraph.nodes);
    setEdges(nextGraph.edges);
    commitLatestGraphToHistory();
    persistGraphToActiveSnapshot(nextGraph);
  }, [commitLatestGraphToHistory, persistGraphToActiveSnapshot, setNodes, setEdges]);

  const handleLayout = useCallback(() => {
    applyMeasuredLayout(nodes, edges, { fitView: true });
  }, [applyMeasuredLayout, nodes, edges]);

  useEffect(() => {
    window.addEventListener("runAutoLayout", handleLayout);
    return () => window.removeEventListener("runAutoLayout", handleLayout);
  }, [handleLayout]);

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
      const historyGraph = createEditorHistoryGraph(nodes, edges);
      committedHistoryGraphRef.current = cloneEditorHistoryGraph(historyGraph);
      lastHistorySignatureRef.current = JSON.stringify(historyGraph);
      lastPersistedSnapshotSignatureRef.current = JSON.stringify(historyGraph);
      setHistory([]);
      historyIndexRef.current = 0;
      setHistoryIndex(0);
      // Initialize strategy history store
      historyStore.init({
        id: "snapshot-initial",
        name: "V2 Liquidity Bot-1",
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
    if (previewMode) return;
    if (isNodeDraggingRef.current) return;
    if (!nodesInitialized || nodes.length === 0 || !historyStore.getActiveId()) return;

    if (snapshotPersistTimerRef.current !== null) {
      window.clearTimeout(snapshotPersistTimerRef.current);
    }

    snapshotPersistTimerRef.current = window.setTimeout(() => {
      snapshotPersistTimerRef.current = null;
      persistLatestGraphToActiveSnapshot();
    }, SNAPSHOT_PERSIST_DELAY_MS);

    return () => {
      if (snapshotPersistTimerRef.current !== null) {
        window.clearTimeout(snapshotPersistTimerRef.current);
        snapshotPersistTimerRef.current = null;
      }
    };
  }, [nodesInitialized, nodes, edges, previewMode, persistLatestGraphToActiveSnapshot]);

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
    const persistBeforePageLeave = () => {
      persistLatestGraphToActiveSnapshot();
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        persistLatestGraphToActiveSnapshot();
      }
    };

    const handleLoadSnapshot = (e: any) => {
      const { nodes: snapshotNodes, edges: snapshotEdges } = e.detail;
      const runtimeGraph = normalizeEditorGraphEdges({
        nodes: clearRuntimeProgramFromNodes(snapshotNodes),
        edges: snapshotEdges,
      });
      const historyGraph = createEditorHistoryGraph(runtimeGraph.nodes, runtimeGraph.edges);
      lastHistorySignatureRef.current = JSON.stringify(historyGraph);
      committedHistoryGraphRef.current = cloneEditorHistoryGraph(historyGraph);
      lastPersistedSnapshotSignatureRef.current = JSON.stringify(historyGraph);
      isUndoRedoRef.current = true;
      setHistory([]);
      historyIndexRef.current = 0;
      setHistoryIndex(0);
      initLayoutRunRef.current = true;
      applyMeasuredLayout(runtimeGraph.nodes, runtimeGraph.edges);
    };
    const handleSaveSnapshot = () => {
      const latestGraph = latestGraphRef.current;
      historyStore.saveSnapshot(latestGraph.nodes, latestGraph.edges);
    };
    window.addEventListener("loadSnapshot", handleLoadSnapshot);
    window.addEventListener("saveHistorySnapshot", handleSaveSnapshot);
    window.addEventListener("persistActiveHistorySnapshot", persistLatestGraphToActiveSnapshot);
    window.addEventListener("beforeunload", persistBeforePageLeave);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      persistLatestGraphToActiveSnapshot();
      if (snapshotPersistTimerRef.current !== null) {
        window.clearTimeout(snapshotPersistTimerRef.current);
        snapshotPersistTimerRef.current = null;
      }
      window.removeEventListener("loadSnapshot", handleLoadSnapshot);
      window.removeEventListener("saveHistorySnapshot", handleSaveSnapshot);
      window.removeEventListener("persistActiveHistorySnapshot", persistLatestGraphToActiveSnapshot);
      window.removeEventListener("beforeunload", persistBeforePageLeave);
      document.removeEventListener("visibilitychange", persistWhenHidden);
    };
  }, [applyMeasuredLayout, persistLatestGraphToActiveSnapshot, previewMode]);

  const renderGraph = useMemo(() => sanitizeEditorGraph({ nodes, edges }), [nodes, edges]);
  const renderNodes = renderGraph.nodes;
  const renderEdges = useMemo(
    () => buildCollapsedPortRenderEdges(renderGraph.nodes, renderGraph.edges),
    [renderGraph.edges, renderGraph.nodes],
  );

  // Process nodes with focus state styling.
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
      const cleanedNode = clearFocusNodeStyle(node);
      if (!focusState.isActive) return cleanedNode;

      const isFocused = cleanedNode.id === focusState.focusedNodeId;
      const isConnected = focusNodeIds.has(cleanedNode.id);
      return {
        ...cleanedNode,
        zIndex: isFocused ? 240 : isConnected ? 220 : getNodeLayer(node),
      };
    };

    const result = renderNodes.map((node) => {
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
  }, [renderNodes, focusState]);

  // Process edges with focus state styling
  const styledEdges = useMemo(() => {
    const outputBlockEdges = renderEdges.filter(isOutputBlockEdge);
    const focusedEdgeIds = new Set(focusState.connectedEdgeIds);

    const activeConditionSourceIds = new Set(
      renderNodes
        .filter((node) => (node.data as any)?.conditionMet)
        .map((node) => node.id),
    );
    const activeConditionJunctionIds = new Set(
      outputBlockEdges
        .filter((edge) => activeConditionSourceIds.has(edge.source) && edge.target.startsWith("condition-junction-"))
        .map((edge) => edge.target),
    );
    const isActiveConditionEdge = (edge: Edge) =>
      activeConditionSourceIds.has(edge.source) || activeConditionJunctionIds.has(edge.source);

    const applyConditionEdgeStyle = (edge: Edge) => {
      if (!isActiveConditionEdge(edge)) return edge;

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
      if (!focusState.isActive) return clearFocusEdgeStyle(edge);
      const isFocusedEdge = focusedEdgeIds.has(edge.id);

      if (isFocusedEdge) {
        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: "#5eead4",
            strokeWidth: 4.6,
            opacity: 1,
            filter: "drop-shadow(0 0 7px rgba(45, 212, 191, 0.38))",
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
          stroke: "var(--advanced-edge-dim)",
          strokeWidth: 1.6,
          opacity: 0.1,
          filter: undefined,
        },
        data: { ...edge.data, isHighlighted: false },
      };
    };

    return outputBlockEdges.map(applyConditionEdgeStyle).map(applyFocusEdgeStyle);
  }, [renderEdges, renderNodes, focusState]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0b0e11] text-[#eaecef]">


      {/* React Flow Editor */}
      <div
        className={cn(
          "relative flex w-full flex-1 overflow-hidden bg-[#0b0e11]",
          isSequenceLayoutAnimating &&
          "[&_.react-flow__node]:transition-transform [&_.react-flow__node]:duration-[420ms] [&_.react-flow__node]:ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
      >
        <div className="relative min-w-0 flex-1 overflow-hidden">
        <ReactFlow
          nodes={styledNodes}
          edges={styledEdges}
          minZoom={0.1}
          maxZoom={3.0}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={handleReconnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onContextMenu={handleContextMenu}
          onPaneClick={handlePaneClick}
          onNodeClick={handleNodeClick}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
	          connectionMode={ConnectionMode.Strict}
	          connectionRadius={96}
	          connectOnClick={!previewMode}
	          connectionLineStyle={{ strokeWidth: 3, stroke: "var(--advanced-flow-connection)" }}
	          fitView
	          nodesDraggable={!previewMode}
	          nodesConnectable={!previewMode}
	          edgesReconnectable={!previewMode}
	          elementsSelectable={!previewMode}
	          selectionMode={SelectionMode.Partial}
	          selectionOnDrag={!previewMode}
	          zoomOnScroll={false}
	          panOnScroll
	          panOnScrollMode={PanOnScrollMode.Free}
	          panOnScrollSpeed={0.9}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          className="advanced-node-editor-flow bg-[#0b0e11]"
        >
	          {!previewMode ? (
	            <Panel position="top-left" className="z-30">
	              <Toolbar
	                onAddNode={handleAddNode}
	                onDeleteSelected={handleDeleteSelected}
	                onUndo={handleUndo}
	                onRedo={handleRedo}
	                onLayout={handleLayout}
	              />
	            </Panel>
	          ) : null}
          <Panel position="top-right" className="z-30">
            <button
              type="button"
              onClick={() => setIsSequenceMonitorOpen((current) => !current)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-black shadow-sm backdrop-blur",
                isSequenceMonitorOpen
                  ? "border-[#f0b90b] bg-[#f0b90b] text-[#0b0e11]"
                  : "border-[#2b3139] bg-[#181a20]/95 text-[#fcd535] hover:border-[#f0b90b]",
              )}
            >
              <Activity className="h-3.5 w-3.5" />
              Monitor
            </button>
          </Panel>
          <Controls style={{ bottom: 90 }} position="bottom-right" className="z-30 rounded-md border border-[#2b3139] bg-[#181a20]/95 shadow-none backdrop-blur-sm" />
          {styledNodes.length > 0 ? (
            <MiniMap
              position="bottom-left"
              className="z-30 rounded-md border border-[#2b3139] bg-[#181a20]/95 shadow-none backdrop-blur-sm"
              maskColor="var(--advanced-minimap-mask)"
              nodeColor={(node) => {
                switch (node.type) {
                  case "timeTrigger":
                    return "#848e9c";
                  case "clickTrigger":
                    return "#5e6673";
                  case "ifTrigger":
                    return "#0ecb81";
                  case "branchNode":
                    return "#f0b90b";
                  case "conditionJunction":
                    return "#fcd535";
                  case "functionNode":
                    return "#f0b90b";
                  case "mergedFunction":
                    return "#b7bdc6";
                  case "actionNode":
                    return (node.data as CEXActionData | DEXActionData).actionType === "CEX" ? "#f0b90b" : "#0ecb81";
                  case "timelineFrame":
                    return "#848e9c";
                  default:
                    return "#5e6673";
                }
              }}
            />
          ) : null}
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--advanced-flow-dots)"
          />
        </ReactFlow>
	        {/* Context Menu for group/merge/unmerge */}
	        {!previewMode && contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            canMerge={canMergeNodes(contextMenu.selectedNodes)}
            canUnmerge={contextMenu.selectedNodes.some((n) => n.type === "mergedFunction")}
            canCreateSequenceGroup={getGroupableSelectedNodes("sequence", contextMenu.selectedNodes).length > 0}
            canCreateMasterGroup={getGroupableSelectedNodes("master", contextMenu.selectedNodes).length > 0}
            onMerge={handleMerge}
            onUnmerge={handleUnmerge}
            onCreateSequenceGroup={() => handleGroup("sequence")}
            onCreateMasterGroup={() => handleGroup("master")}
            onAiExplain={handleAiExplain}
            onDelete={handleDeleteSelected}
          />
        )}
        </div>
        <SequenceMonitorPanel
          nodes={nodes}
          edges={edges}
          setNodes={setNodes}
          isOpen={isSequenceMonitorOpen}
          onOpenChange={setIsSequenceMonitorOpen}
        />
      </div>
    </div>
  );
}

export function NodeEditor({ initialGraph, initialGraphVersion, previewMode }: NodeEditorProps) {
  return (
    <ReactFlowProvider>
      <NodeEditorInner
        initialGraph={initialGraph}
        initialGraphVersion={initialGraphVersion}
        previewMode={previewMode}
      />
    </ReactFlowProvider>
  );
}
