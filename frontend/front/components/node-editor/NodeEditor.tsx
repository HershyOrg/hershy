"use client";

import { useCallback, useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
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
import type { FunctionNodeData, TimeTriggerData, ClickTriggerData, BranchNodeData, CEXActionData, DEXActionData, MergedFunctionNodeData, TimelineFrameData, MonitoringNodeData, StreamingNodeData } from "./types";
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
    isOutputBlockSourceHandle(params.sourceHandle) &&
    (params.targetHandle?.includes("-input-") ||
      (params.targetHandle?.includes("-block-") && params.targetHandle.endsWith("-in")))
  );
}

function isOutputBlockSourceHandle(sourceHandle?: string | null) {
  return Boolean(sourceHandle?.includes("-block-") && sourceHandle.endsWith("-out"));
}

function isOutputBlockEdge(edge: Pick<Edge, "sourceHandle">) {
  return isOutputBlockSourceHandle(edge.sourceHandle);
}

function getHandleBlockId(handle?: string | null, direction: "source" | "target" = "source") {
  const suffix = direction === "source" ? "-out" : "-in";
  const pattern = direction === "source" ? /-block-(.+)-out$/ : /-input-(.+)-in$/;
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

function getOutputBlockForHandle(sourceNode: Node | undefined, sourceHandle?: string | null) {
  const blockId = getHandleBlockId(sourceHandle, "source");
  const outputBlocks = (sourceNode?.data as { outputBlocks?: Array<{ id: string; name: string; description?: string; type: "output" }> })?.outputBlocks ?? [];
  return outputBlocks.find((block) => block.id === blockId) ?? null;
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
};

function NodeEditorInner({ initialGraph, initialGraphVersion = 0 }: NodeEditorProps) {
  const { fitView, getIntersectingNodes, getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { showFSMEdges, isAvailable, currentState } = useFSM();
  const nodesInitialized = useNodesInitialized();
  const initialSnapshot = useMemo(() => {
    if (initialGraph && initialGraph.nodes.length > 0) {
      return initialGraph;
    }
    const activeId = historyStore.getActiveId();
    return historyStore.getSnapshotById(activeId);
  }, [initialGraph]);
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
  const [clipboard, setClipboard] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);

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

    loadedInitialGraphVersionRef.current = initialGraphVersion;
    activeSnapshotPersistSignatureRef.current = JSON.stringify({
      nodes: initialGraph.nodes,
      edges: initialGraph.edges,
    });
    isUndoRedoRef.current = true;
    setHistory([{ nodes: initialGraph.nodes, edges: initialGraph.edges }]);
    setHistoryIndex(0);
    applyMeasuredLayout(initialGraph.nodes, initialGraph.edges, { fitView: true });
  }, [applyMeasuredLayout, initialGraph, initialGraphVersion]);

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

    setHistory((prev) => {
      // Remove any future history if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1);
      // Add new state
      return [...newHistory, { nodes, edges }];
    });
    setHistoryIndex((prev) => prev + 1);
  }, [nodes, edges]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const { nodes: historyNodes, edges: historyEdges } = history[newIndex];

    isUndoRedoRef.current = true;
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
        const nodeData = node.data as FunctionNodeData;
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

  const handleCloseFocus = useCallback(() => {
    setFocusState({
      isActive: false,
      focusedNodeId: null,
      connectedNodeIds: [],
      connectedEdgeIds: [],
    });
    // Collapse any expanded nodes
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: { ...node.data, isExpanded: false },
      }))
    );
  }, [setNodes]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!isOutputBlockSourceHandle(params.sourceHandle)) {
        return;
      }

      const targetNode = nodes.find((n) => n.id === params.target);
      const sourceNode = nodes.find((n) => n.id === params.source);
      let nextParams: Connection = { ...params };

      if (targetNode?.type === "functionNode" && sourceNode) {
        const sourceBlock = getOutputBlockForHandle(sourceNode, params.sourceHandle);
        const sourceNodeName = getNodeDisplayName(sourceNode);
        const sourceBlockName = sourceBlock?.name || getHandleBlockId(params.sourceHandle, "source") || "output";
        const connectedFrom = `${sourceNodeName}.${sourceBlockName}`;
        const sourceDescription = sourceBlock?.description || `Connected from ${connectedFrom}`;
        const targetData = targetNode.data as FunctionNodeData;
        const currentBlocks = Array.isArray(targetData.inputBlocks) && targetData.inputBlocks.length > 0
          ? targetData.inputBlocks
          : [{ id: "source", name: "source", description: "차트 계산에 들어오는 스트림 또는 지표 블록", type: "input" as const }];
        const requestedBlockId = getHandleBlockId(params.targetHandle, "target");
        const requestedBlock = currentBlocks.find((block) => block.id === requestedBlockId);
        const existingBlock = currentBlocks.find((block) => block.connectedFrom === connectedFrom);
        const shouldAppend =
          params.targetHandle?.includes("append") ||
          !requestedBlock ||
          Boolean(requestedBlock.connectedFrom && requestedBlock.connectedFrom !== connectedFrom && !existingBlock);
        const targetBlockId = existingBlock?.id || (!shouldAppend && requestedBlock ? requestedBlock.id : `ib-${sanitizeHandlePart(sourceBlockName)}-${Date.now()}`);
        nextParams = {
          ...nextParams,
          targetHandle: `${targetNode.id}-input-${targetBlockId}-in`,
        };

        setNodes((nds) =>
          nds.map((node) => {
            if (node.id !== targetNode.id) return node;
            const nodeData = node.data as FunctionNodeData;
            const blocks = Array.isArray(nodeData.inputBlocks) && nodeData.inputBlocks.length > 0
              ? nodeData.inputBlocks
              : currentBlocks;
            const nextInputBlock = {
              id: targetBlockId,
              name: sourceBlockName,
              description: sourceDescription,
              type: "input" as const,
              connectedFrom,
            };
            const hasTargetBlock = blocks.some((block) => block.id === targetBlockId);
            const updatedBlocks = hasTargetBlock
              ? blocks.map((block) =>
                block.id === targetBlockId && (isPlaceholderInputBlock(block) || block.connectedFrom === connectedFrom || block.id === requestedBlockId)
                  ? { ...block, ...nextInputBlock }
                  : block,
              )
              : [...blocks, nextInputBlock];

            return {
              ...node,
              data: {
                ...node.data,
                inputBlocks: updatedBlocks,
                inputDescription: nodeData.inputDescription || `입력 데이터: ${connectedFrom}`,
              },
            };
          }),
        );

        window.setTimeout(() => updateNodeInternals(targetNode.id), 0);
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
        const newConnectedNodeIds = [...connInfo.connectedNodeIds, params.target].filter(Boolean) as string[];
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
    (connection: Connection | Edge) => isOutputBlockSourceHandle(connection.sourceHandle),
    []
  );

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (params.handleType === "source" && !isOutputBlockSourceHandle(params.handleId)) {
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
      if (!isOutputBlockSourceHandle(start.handleId)) {
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

      if (!target || !targetHandle || target === start.nodeId) {
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
    const handleGenerateV2 = () => {
      applyMeasuredLayout(initialNodes, initialEdges);
      // Reset initialization ref so layout runs again once nodes measure
      initLayoutRunRef.current = false;
    };

    window.addEventListener("generateV2Strategy", handleGenerateV2);
    return () => window.removeEventListener("generateV2Strategy", handleGenerateV2);
  }, [applyMeasuredLayout]);

  // Run initial layout when component mounts and all nodes have been measured
  useEffect(() => {
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
  }, [nodesInitialized, nodes.length, handleLayout]);

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
    if (!nodesInitialized || nodes.length === 0 || !historyStore.getActiveId()) return;

    const nextSignature = JSON.stringify({ nodes, edges });
    if (activeSnapshotPersistSignatureRef.current === nextSignature) {
      return;
    }

    activeSnapshotPersistSignatureRef.current = nextSignature;
    historyStore.updateActiveSnapshot(nodes, edges);
  }, [nodesInitialized, nodes, edges]);

  useEffect(() => {
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
  }, [applyMeasuredLayout]);

  useEffect(() => {
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
      activeSnapshotPersistSignatureRef.current = JSON.stringify({
        nodes: snapshotNodes,
        edges: snapshotEdges,
      });
      applyMeasuredLayout(snapshotNodes, snapshotEdges);
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
  }, [applyMeasuredLayout, nodes, edges, handleToggleSequenceCollapse, setNodes]);

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

    let result = nodes.map((node) => {
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
    let executingEdgeIds = new Set<string>();
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
          connectionMode={ConnectionMode.Loose}
          connectionRadius={96}
          connectOnClick
          connectionLineStyle={{ strokeWidth: 3, stroke: "#64748b" }}
          fitView
          selectionMode={SelectionMode.Partial}
          selectionOnDrag
          panOnScroll={false}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          className="bg-gray-100"
        >
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

        <TerminalPanel
          isOpen={isTerminalOpen}
          onClose={() => setTerminalOpen(false)}
          monitoringNodesData={monitoringNodesData}
        />

        {/* Context Menu for group/merge/unmerge */}
        {contextMenu && (
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

export function NodeEditor({ initialGraph, initialGraphVersion }: NodeEditorProps) {
  return (
    <ReactFlowProvider>
      <FSMProvider>
        <NodeEditorInner initialGraph={initialGraph} initialGraphVersion={initialGraphVersion} />
      </FSMProvider>
    </ReactFlowProvider>
  );
}
