"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BarChart3,
  ChevronRight,
  Clock3,
  Coins,
  FileCode2,
  Network,
  PlayCircle,
  Rocket,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { ExchangeLibraryModal } from "@/components/home/ExchangeLibraryModal";
import { PageRightRail } from "@/components/home/PageRightRail";
import { PortfolioWorkspace } from "@/components/home/PortfolioWorkspace";
import { StrategyLibraryWorkspace } from "@/components/home/StrategyLibraryWorkspace";
import {
  AI_STRATEGY_TEMPLATES,
  DEFAULT_CEX_TRADE_EXCHANGE,
  EMPTY_EASY_VIEW,
  EXCHANGE_CONNECTIONS,
  EXCHANGE_CONNECTION_NAMES,
  GUIDE_ITEMS,
  INITIAL_EASY_VIEW,
  INITIAL_STRATEGY_CODE,
  MAIN_VIEW_TABS,
  MARKET_ROWS,
  NAV_ITEMS,
  STRATEGY_BLOCKS,
  STRATEGY_BUILDER_STORAGE_KEY,
  STRATEGY_CODE,
  buildExchangeFormFromConnection,
  createEmptyExchangeForm,
} from "@/components/home/config";
import { StatusBadge } from "@/components/home/shared";
import type {
  AgentActivity,
  ExchangeConnection,
  ExchangeFormState,
  MarketRow,
} from "@/components/home/types";
import { NodeEditor } from "@/components/node-editor/NodeEditor";
import { StrategyHistoryModal } from "@/components/node-editor/StrategyHistoryModal";
import { EasyStrategyGraph } from "@/components/strategy-builder/EasyStrategyGraph";
import {
  advancedGraphToStrategyGraph,
  runEasyViewGraphAgentLoop,
  strategyGraphToCode,
  type EasyViewModel,
  type EasyViewNode,
  type EasyViewAgentResult,
  type StrategyTemplate,
  type StrategyGraphPayload,
} from "@/lib/easyViewAgent";
import { historyStore, type HistorySnapshot } from "@/lib/historyStore";
import { cn } from "@/lib/utils";
import {
  getClientUserProfile,
  loginClientUser,
  logoutClientUser,
  withUserContextHeaders,
  withUserContextPayload,
} from "@/src/lib/userContextClient";

type MainView = "easy" | "advanced" | "code";
type DetailTab = "overview" | "params" | "risk" | "code";
type ExchangeTab = string;
type PlanTier = "free" | "pro" | "team";
type WorkspaceView = "create" | "library" | "portfolio";

type AdvancedGraphModel = NonNullable<EasyViewAgentResult["advancedGraph"]>;
type AdvancedToEasySafetyIssue = {
  id: "missing-init" | "missing-kill-switch";
  title: string;
  description: string;
};

type PendingAdvancedToEasyRegeneration = {
  graph: AdvancedGraphModel;
  options: {
    strategyName?: string;
    switchToEasy?: boolean;
    source?: "save" | "tab-switch";
  };
  issues: AdvancedToEasySafetyIssue[];
};

type CapitalVenue = {
  key: string;
  kind: "CEX" | "DEX";
  label: string;
  sourceLabel: string;
  sinkLabel: string;
  exchange?: string;
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  side?: string;
  chainId?: string;
  contractAddress?: string;
};

type PersistedStrategyBuilderState = {
  version: 1;
  savedAt: number;
  generatedCode: string;
  programCode: string;
  easyViewModel: EasyViewModel;
  advancedGraphModel: AdvancedGraphModel | null;
  lastSyncedAdvancedGraphSignature: string;
  aiSummary: string;
  agentSteps: string[];
};

function isWorkspaceNavId(value: string): value is WorkspaceView {
  return value === "create" || value === "library" || value === "portfolio";
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function collectAdvancedNodeText(node: AdvancedGraphModel["nodes"][number]) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return [
    node.id,
    node.type,
    data.label,
    data.name,
    data.title,
    data.functionName,
    data.description,
    data.summary,
    data.condition,
    data.styleType,
  ].map((value) => String(value ?? "")).join(" ").toLowerCase();
}

function hasAdvancedGraphInit(graph: AdvancedGraphModel) {
  return graph.nodes.some((node) => {
    const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
    if (data.styleType === "dashed-init") return true;
    return /(^|[\s_-])(init|initial|initialize|bootstrap|setup|start)([\s_-]|$)|초기|초기화|시작/.test(collectAdvancedNodeText(node));
  });
}

function hasAdvancedGraphKillSwitch(graph: AdvancedGraphModel) {
  return graph.nodes.some((node) => {
    const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
    if (data.killSwitch === true || data.emergencyStop === true || data.circuitBreaker === true) return true;
    return /kill\s*switch|killswitch|emergency|panic|circuit\s*breaker|manual\s*(halt|stop)|global\s*(halt|stop)|stop\s*all|halt\s*strategy|킬\s*스위치|긴급|비상|강제\s*중단|전체\s*(중단|정지|청산)/.test(collectAdvancedNodeText(node));
  });
}

function auditAdvancedGraphForEasyView(graph: AdvancedGraphModel): AdvancedToEasySafetyIssue[] {
  const issues: AdvancedToEasySafetyIssue[] = [];
  if (!hasAdvancedGraphInit(graph)) {
    issues.push({
      id: "missing-init",
      title: "Init / 시작 시퀀스 없음",
      description: "초기 진입, 초기 자금 배분, 최초 상태 세팅을 담당하는 시작 단계가 보이지 않습니다.",
    });
  }
  if (!hasAdvancedGraphKillSwitch(graph)) {
    issues.push({
      id: "missing-kill-switch",
      title: "Kill switch / 긴급 중단 없음",
      description: "손실 한도, 데이터 지연, 거래소 연결 이상, 수동 중단 같은 안전 종료 흐름이 보이지 않습니다.",
    });
  }
  return issues;
}

function makeUniqueAdvancedId(graph: AdvancedGraphModel, preferred: string) {
  const used = new Set([
    ...graph.nodes.map((node) => node.id),
    ...graph.edges.map((edge) => edge.id),
  ]);
  if (!used.has(preferred)) return preferred;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${preferred}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${preferred}-${Date.now()}`;
}

function splitTradingSymbol(symbolValue: unknown) {
  const raw = String(symbolValue ?? "").trim().toUpperCase();
  if (!raw) return { baseAsset: "ASSET", quoteAsset: "USDT" };
  const explicit = raw.split(/[\/:_-]/).filter(Boolean);
  if (explicit.length >= 2) return { baseAsset: explicit[0], quoteAsset: explicit[1] };
  const quotes = ["USDT", "USDC", "USD", "DAI", "BTC", "ETH", "KRW", "EUR"];
  const quoteAsset = quotes.find((quote) => raw.length > quote.length && raw.endsWith(quote)) ?? "USDT";
  return {
    baseAsset: raw.endsWith(quoteAsset) ? raw.slice(0, -quoteAsset.length) : raw,
    quoteAsset,
  };
}

function formatChainLabel(chainId: unknown) {
  const value = String(chainId ?? "").trim();
  if (!value) return "EVM";
  const labels: Record<string, string> = {
    "1": "Ethereum",
    "10": "Optimism",
    "56": "BNB Chain",
    "137": "Polygon",
    "42161": "Arbitrum",
    "8453": "Base",
  };
  return labels[value] ?? `Chain ${value}`;
}

function getCapitalVenueFromAction(node: AdvancedGraphModel["nodes"][number]): CapitalVenue | null {
  if (node.type !== "actionNode" || !node.data || typeof node.data !== "object") return null;
  const data = node.data as Record<string, unknown>;
  const actionType = String(data.actionType ?? "").toUpperCase();
  if (actionType === "CEX") {
    const exchange = String(data.exchange ?? "CEX").trim() || "CEX";
    const symbol = String(data.symbol ?? "").trim();
    const side = String(data.side ?? "").toUpperCase();
    const { baseAsset, quoteAsset } = splitTradingSymbol(symbol);
    const sourceLabel = side === "BUY"
      ? `${exchange} ${quoteAsset} 현물/가용 잔고`
      : `${exchange} ${quoteAsset} 증거금 또는 담보 잔고`;
    const sinkLabel = `${exchange} ${quoteAsset} 안전 잔고`;
    return {
      key: `cex:${exchange}:${symbol || quoteAsset}`,
      kind: "CEX",
      label: symbol ? `${exchange} ${symbol}` : exchange,
      sourceLabel,
      sinkLabel,
      exchange,
      symbol,
      baseAsset,
      quoteAsset,
      side,
    };
  }

  if (actionType === "DEX") {
    const chainId = String(data.chainId ?? data.evmChain ?? "").trim();
    const chainLabel = formatChainLabel(chainId);
    const contractAddress = String(data.contractAddress ?? "").trim();
    return {
      key: `dex:${chainLabel}:${contractAddress || node.id}`,
      kind: "DEX",
      label: `${chainLabel} DEX`,
      sourceLabel: `${chainLabel} 연결 지갑 / 컨트랙트 승인 자금`,
      sinkLabel: `${chainLabel} 연결 지갑`,
      chainId,
      contractAddress,
    };
  }

  return null;
}

function inferCapitalVenues(graph: AdvancedGraphModel) {
  const byKey = new Map<string, CapitalVenue>();
  graph.nodes.forEach((node) => {
    if (/kill|emergency|긴급|청산|중단/.test(collectAdvancedNodeText(node))) return;
    const venue = getCapitalVenueFromAction(node);
    if (venue && !byKey.has(venue.key)) byKey.set(venue.key, venue);
  });
  return Array.from(byKey.values());
}

function getCapitalSummary(venues: CapitalVenue[]) {
  if (venues.length === 0) {
    return {
      sourceSummary: "연결 거래소 또는 온체인 지갑의 전략 전용 자금",
      sinkSummary: "전략 종료 후 안전 지갑 또는 현금성 잔고",
    };
  }
  return {
    sourceSummary: venues.map((venue) => venue.sourceLabel).join(", "),
    sinkSummary: Array.from(new Set(venues.map((venue) => venue.sinkLabel))).join(", "),
  };
}

function getRootStrategyGroup(graph: AdvancedGraphModel) {
  return graph.nodes.find((node) =>
    node.type === "groupNode" &&
    node.data &&
    typeof node.data === "object" &&
    (node.data as Record<string, unknown>).styleType === "solid") ?? null;
}

function getNextSequencePosition(graph: AdvancedGraphModel, parentId?: string) {
  const siblings = graph.nodes.filter((node) => parentId ? node.parentId === parentId : !node.parentId);
  const maxBottom = siblings.reduce((max, node) => {
    const height = typeof node.style === "object" && node.style && "height" in node.style ? Number(node.style.height) : 140;
    return Math.max(max, (node.position?.y ?? 0) + (Number.isFinite(height) ? height : 140));
  }, 40);
  return { x: 40, y: maxBottom + 30 };
}

function getFirstActionNodeId(graph: AdvancedGraphModel) {
  const action = graph.nodes
    .filter((node) => node.type === "actionNode" && !/kill|emergency|긴급|청산|중단/.test(collectAdvancedNodeText(node)))
    .sort((left, right) => (left.position?.x ?? 0) - (right.position?.x ?? 0))[0];
  return action?.id ?? "";
}

function buildKillSwitchActions(graph: AdvancedGraphModel, groupId: string, venues: CapitalVenue[]) {
  const targets = venues.length > 0 ? venues.slice(0, 4) : [{
    key: "fallback",
    kind: "CEX" as const,
    label: "전략 자금",
    sourceLabel: "전략 전용 자금",
    sinkLabel: "안전 현금성 잔고",
    exchange: "Connected Exchange",
    symbol: "ALL/USDT",
    baseAsset: "ALL",
    quoteAsset: "USDT",
    side: "BUY",
  }];

  return targets.map((venue, index) => {
    const id = makeUniqueAdvancedId(graph, `auto-kill-action-${index + 1}`);
    if (venue.kind === "DEX") {
      return {
        id,
        type: "actionNode",
        parentId: groupId,
        position: { x: 560 + index * 260, y: 46 },
        data: {
          label: `회수: ${venue.label} 포지션을 ${venue.sinkLabel}로 정리`,
          actionType: "DEX",
          contractAddress: venue.contractAddress || "0x0000000000000000000000000000000000000000",
          functionName: "emergencyExit()",
          chainId: Number(venue.chainId) || 1,
          inputBlocks: [{ id: "exit-plan", name: "exitPlan", type: "input" }],
          outputBlocks: [{ id: "positions-closed", name: "positionsClosed", type: "output" }],
          isExpanded: false,
          killSwitch: true,
          emergencyStop: true,
          capitalSink: venue.sinkLabel,
        },
      } satisfies AdvancedGraphModel["nodes"][number];
    }

    const closeSide = venue.side === "SELL" ? "BUY" : "SELL";
    return {
      id,
      type: "actionNode",
      parentId: groupId,
      position: { x: 560 + index * 260, y: 46 },
      data: {
        label: `회수: ${venue.label} 정리 후 ${venue.sinkLabel}로 모으기`,
        actionType: "CEX",
        exchange: venue.exchange || "Connected Exchange",
        symbol: venue.symbol || "ALL/USDT",
        side: closeSide,
        orderType: "MARKET",
        amount: "ALL",
        amountType: "PERCENT",
        inputBlocks: [{ id: "exit-plan", name: "exitPlan", type: "input" }],
        outputBlocks: [{ id: "positions-closed", name: "positionsClosed", type: "output" }],
        isExpanded: false,
        reduceOnly: true,
        cancelOpenOrders: true,
        closeAllPositions: true,
        killSwitch: true,
        emergencyStop: true,
        capitalSink: venue.sinkLabel,
      },
    } satisfies AdvancedGraphModel["nodes"][number];
  });
}

function addCapitalSafetyScaffold(graph: AdvancedGraphModel, issues: AdvancedToEasySafetyIssue[]) {
  const shouldAddInit = issues.some((issue) => issue.id === "missing-init") && !hasAdvancedGraphInit(graph);
  const shouldAddKill = issues.some((issue) => issue.id === "missing-kill-switch") && !hasAdvancedGraphKillSwitch(graph);
  if (!shouldAddInit && !shouldAddKill) return graph;

  const venues = inferCapitalVenues(graph);
  const { sourceSummary, sinkSummary } = getCapitalSummary(venues);
  const rootGroup = getRootStrategyGroup(graph);
  const nodes: AdvancedGraphModel["nodes"] = graph.nodes.map((node) => ({ ...node }));
  const edges: AdvancedGraphModel["edges"] = graph.edges.map((edge) => ({ ...edge }));
  const rootGroupId = rootGroup?.id;
  const addedGroupIds: string[] = [];

  const appendEdge = (edge: AdvancedGraphModel["edges"][number]) => {
    edges.push({ ...edge, id: makeUniqueAdvancedId({ nodes, edges }, edge.id) });
  };

  if (shouldAddInit) {
    const groupId = makeUniqueAdvancedId({ nodes, edges }, "auto-init");
    const clickId = makeUniqueAdvancedId({ nodes, edges }, "auto-init-click");
    const planId = makeUniqueAdvancedId({ nodes, edges }, "auto-init-capital-plan");
    const groupPosition = getNextSequencePosition({ nodes, edges }, rootGroupId);
    nodes.push({
      id: groupId,
      type: "groupNode",
      parentId: rootGroupId,
      position: groupPosition,
      style: { width: 980, height: 170 },
      data: {
        label: "Init: 전략 자금 출발지 확인",
        styleType: "dashed-init",
        summaryWord: "자금 확인",
        summaryGlyph: "I",
        isCollapsed: true,
        capitalSource: sourceSummary,
      },
    });
    nodes.push({
      id: clickId,
      type: "clickTrigger",
      parentId: groupId,
      position: { x: 24, y: 62 },
      data: {
        label: "전략 시작 승인",
        shortcut: null,
        isRecording: false,
        outputBlocks: [{ id: "click", name: "click", description: "Init 실행 승인 신호", type: "output" }],
      },
    });
    nodes.push({
      id: planId,
      type: "functionNode",
      parentId: groupId,
      position: { x: 300, y: 42 },
      data: {
        label: "Init: 자금 출발지와 할당 확인",
        functionName: "prepareInitialCapital()",
        description: `전략 시작 전 자금 출발지: ${sourceSummary}`,
        logicDescription: `시작 시점에 전략에 투입될 돈이 ${sourceSummary}에 있는지 확인하고, 각 실행 노드가 사용할 capitalReady 신호를 만듭니다.`,
        inputBlocks: [],
        outputBlocks: [{ id: "capital-ready", name: "capitalReady", description: sourceSummary, type: "output" }],
        viewMode: "node",
        capitalSource: sourceSummary,
      },
    });
    appendEdge({
      id: "auto-init-click-plan",
      source: clickId,
      target: planId,
      sourceHandle: `${clickId}-block-click-out`,
      targetHandle: `${planId}-func-in`,
      type: "custom",
    });
    const firstActionId = getFirstActionNodeId({ nodes, edges });
    if (firstActionId) {
      appendEdge({
        id: "auto-init-to-first-action",
        source: planId,
        target: firstActionId,
        sourceHandle: `${planId}-block-capital-ready-out`,
        targetHandle: `${firstActionId}-func-in`,
        type: "custom",
      });
    }
    addedGroupIds.push(groupId);
  }

  if (shouldAddKill) {
    const groupId = makeUniqueAdvancedId({ nodes, edges }, "auto-kill-switch");
    const clickId = makeUniqueAdvancedId({ nodes, edges }, "auto-kill-click");
    const planId = makeUniqueAdvancedId({ nodes, edges }, "auto-kill-exit-plan");
    const groupPosition = getNextSequencePosition({ nodes, edges }, rootGroupId);
    const killActions = buildKillSwitchActions({ nodes, edges }, groupId, venues);
    nodes.push({
      id: groupId,
      type: "groupNode",
      parentId: rootGroupId,
      position: groupPosition,
      style: { width: Math.max(980, 620 + killActions.length * 260), height: 170 },
      data: {
        label: "Kill switch: 전략 자금 회수",
        styleType: "dashed-emergency",
        summaryWord: "회수",
        summaryGlyph: "K",
        isCollapsed: true,
        killSwitch: true,
        emergencyStop: true,
        capitalSink: sinkSummary,
      },
    });
    nodes.push({
      id: clickId,
      type: "clickTrigger",
      parentId: groupId,
      position: { x: 24, y: 62 },
      data: {
        label: "긴급 중단 승인",
        shortcut: null,
        isRecording: false,
        outputBlocks: [{ id: "click", name: "click", description: "Kill switch 실행 승인 신호", type: "output" }],
        killSwitch: true,
        emergencyStop: true,
      },
    });
    nodes.push({
      id: planId,
      type: "functionNode",
      parentId: groupId,
      position: { x: 300, y: 42 },
      data: {
        label: "Kill switch: 자금 회수 계획",
        functionName: "prepareEmergencyExit()",
        description: `전략 중지 시 자금 회수지: ${sinkSummary}`,
        logicDescription: `전략에서 사용된 자금을 ${sinkSummary}로 모으도록 포지션 정리, 주문 취소, LP 회수 순서를 결정합니다.`,
        inputBlocks: [],
        outputBlocks: [{ id: "exit-plan", name: "exitPlan", description: sinkSummary, type: "output" }],
        viewMode: "node",
        killSwitch: true,
        emergencyStop: true,
        capitalSink: sinkSummary,
      },
    });
    nodes.push(...killActions);
    appendEdge({
      id: "auto-kill-click-plan",
      source: clickId,
      target: planId,
      sourceHandle: `${clickId}-block-click-out`,
      targetHandle: `${planId}-func-in`,
      type: "custom",
    });
    killActions.forEach((action, index) => {
      appendEdge({
        id: `auto-kill-plan-action-${index + 1}`,
        source: index === 0 ? planId : killActions[index - 1].id,
        target: action.id,
        sourceHandle: index === 0 ? `${planId}-block-exit-plan-out` : `${killActions[index - 1].id}-success-out`,
        targetHandle: `${action.id}-func-in`,
        type: "custom",
      });
      appendEdge({
        id: `auto-kill-plan-input-${index + 1}`,
        source: planId,
        target: action.id,
        sourceHandle: `${planId}-block-exit-plan-out`,
        targetHandle: `${action.id}-input-exit-plan-in`,
        type: "custom",
      });
    });
    addedGroupIds.push(groupId);
  }

  if (rootGroupId && addedGroupIds.length > 0) {
    const rootIndex = nodes.findIndex((node) => node.id === rootGroupId);
    const root = nodes[rootIndex];
    const maxChildRight = nodes
      .filter((node) => node.parentId === rootGroupId)
      .reduce((max, node) => {
        const width = typeof node.style === "object" && node.style && "width" in node.style ? Number(node.style.width) : 240;
        return Math.max(max, (node.position?.x ?? 0) + (Number.isFinite(width) ? width : 240));
      }, 0);
    const maxChildBottom = nodes
      .filter((node) => node.parentId === rootGroupId)
      .reduce((max, node) => {
        const height = typeof node.style === "object" && node.style && "height" in node.style ? Number(node.style.height) : 160;
        return Math.max(max, (node.position?.y ?? 0) + (Number.isFinite(height) ? height : 160));
      }, 0);
    if (root && typeof root.style === "object") {
      nodes[rootIndex] = {
        ...root,
        style: {
          ...root.style,
          width: Math.max(Number(root.style?.width) || 0, maxChildRight + 50),
          height: Math.max(Number(root.style?.height) || 0, maxChildBottom + 50),
        },
      };
    }
  }

  return { nodes, edges };
}

function buildAISafetyScaffoldPrompt(
  graph: AdvancedGraphModel,
  issues: AdvancedToEasySafetyIssue[],
  strategyName: string,
) {
  const venues = inferCapitalVenues(graph);
  const { sourceSummary, sinkSummary } = getCapitalSummary(venues);
  const missingLabels = issues.map((issue) => issue.title).join(", ");
  const venueLines = venues.length > 0
    ? venues.map((venue) => `- ${venue.kind} ${venue.label}: source=${venue.sourceLabel}, current fallback sink=${venue.sinkLabel}`).join("\n")
    : "- No explicit venue was detected. Infer from connected exchange/API context and existing action blocks.";

  return [
    `Revise the existing Hershy strategy "${strategyName}" by adding only the missing safety structure: ${missingLabels}.`,
    "Preserve the existing trading logic, symbols, venues, thresholds, and execution intent. Do not rewrite the strategy into a different strategy.",
    "Safety objective: when the strategy stops, move my assets into lower-volatility assets as safely as possible. Prefer stable/cash-like assets such as USDC, USDT, DAI, USD, or KRW. For CEX actions, cancel open orders, reduce/close strategy exposure, and settle into the safest available quote/stable balance. For DEX/on-chain actions, unwind LP/positions and swap or return residual volatile exposure into a stable token wallet when possible.",
    "Init requirement: add an explicit Init/start sequence that checks where the strategy capital currently lives, verifies required balances/allowances/collateral, and emits a capitalReady/start-approved signal before the first execution action can use funds.",
    "Kill switch requirement: add an explicit manual/emergency stop trigger plus fail-safe predicates for drawdown, stale data, disconnect, failed hedge, or failed order. It must route to close/cancel/reduce-only or unwind actions that collect assets into the lower-volatility destination.",
    "Mark safety blocks with config fields such as killSwitch, emergencyStop, capitalSource, capitalSink, safeAsset, and safetyObjective so the UI can recognize them.",
    "Before finalizing runtimeGraph, define runtimeGraph.metadata.workflowGroups. Each workflow group must have id, title, purpose, nodeIds, canAbstract, and mustStayVisibleNodeIds. Assign every runtimeGraph block to exactly one workflow either by config.workflowId or by listing it in workflowGroups[].nodeIds.",
    "Workflow grouping rule: group semantic workflows first, then list the exact node ids inside each workflow. Do not put editable execution actions, branch decision triggers, Init approval, or Kill switch trigger/action into abstractable groups; put those ids in mustStayVisibleNodeIds or set canAbstract=false for that workflow.",
    "Recommended workflow groups: init-capital-readiness, data-ingestion, signal-computation, decision-gating, execution, risk-monitoring, kill-switch-safe-exit. Use only the groups that fit the current strategy.",
    `Detected capital source summary: ${sourceSummary}`,
    `Detected current fallback sink summary: ${sinkSummary}`,
    `Detected venues:\n${venueLines}`,
    "Return a complete Hershy semantic strategy package with intentPlan, logicIR, and runtimeGraph. Use only connected exchanges/API context from the server. Do not invent private URLs, keys, or unverified contract addresses.",
  ].join("\n\n");
}

function isEasyViewModel(value: unknown): value is EasyViewModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  return (
    typeof model.title === "string" &&
    typeof model.summary === "string" &&
    Array.isArray(model.nodes) &&
    Array.isArray(model.edges)
  );
}

function isAdvancedGraphModel(value: unknown): value is AdvancedGraphModel {
  if (!value || typeof value !== "object") return false;
  const graph = value as Record<string, unknown>;
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

const EASY_SYNC_ACTION_PARAM_KEYS = [
  "exchange",
  "venue",
  "symbol",
  "market",
  "side",
  "orderSide",
  "orderType",
  "amount",
  "buyAmount",
  "sellAmount",
  "amountType",
  "quote",
  "size",
  "notional",
  "price",
  "limitPrice",
  "leverage",
  "chain",
  "chainId",
  "contractAddress",
  "functionName",
  "method",
  "tokenIn",
  "tokenOut",
  "slippage",
] as const;

const EASY_SYNC_ACTION_PARAM_KEY_SET = new Set<string>(EASY_SYNC_ACTION_PARAM_KEYS);
const LEGACY_SEEDED_AGENT_STEPS = [
  "기본 전략 템플릿 코드 로드",
  "코드에서 쉬운 보기 블록과 간선을 생성",
  "쉬운 보기에서는 CEX/DEX 실행 파라미터만 편집 가능",
] as const;
const DEFAULT_AGENT_STEPS = [
  "거래소 연결 확인",
  "AI 전략 생성 또는 템플릿 선택",
  "쉬운 보기와 고급 보기 동기화",
] as const;

function matchesExactStepSequence(steps: string[], target: readonly string[]) {
  return steps.length === target.length && steps.every((step, index) => step === target[index]);
}

function getAdvancedGraphActionParamValues(graph: AdvancedGraphModel) {
  const paramsByNodeId = new Map<string, Record<string, string>>();

  graph.nodes.forEach((node) => {
    if (node.type !== "actionNode" || !node.data || typeof node.data !== "object") return;
    const data = node.data as Record<string, unknown>;
    const params: Record<string, string> = {};

    EASY_SYNC_ACTION_PARAM_KEYS.forEach((key) => {
      const value = data[key];
      if (value === undefined || value === null || typeof value === "object") return;
      params[key] = String(value);
    });

    if (Object.keys(params).length > 0) {
      paramsByNodeId.set(node.id, params);
    }
  });

  return paramsByNodeId;
}

function syncEasyViewActionParams(model: EasyViewModel, graph: AdvancedGraphModel): EasyViewModel {
  const paramsByNodeId = getAdvancedGraphActionParamValues(graph);
  if (paramsByNodeId.size === 0) return model;

  let changed = false;
  const nodes = model.nodes.map((node) => {
    const sourceIds = [node.id, ...(node.sourceBlockIds ?? [])];
    const advancedParams = sourceIds.map((id) => paramsByNodeId.get(id)).find(Boolean);
    if (!advancedParams) return node;

    let nodeChanged = false;
    const params = node.params.map((param) => {
      const nextValue = advancedParams[param.key];
      if (nextValue === undefined || nextValue === param.value) return param;
      changed = true;
      nodeChanged = true;
      return { ...param, value: nextValue };
    });

    return nodeChanged ? { ...node, params } : node;
  });

  return changed
    ? {
      ...model,
      lastModified: new Date().toISOString(),
      nodes,
    }
    : model;
}

function getNodeDataForAdvancedStructureSignature(node: AdvancedGraphModel["nodes"][number]) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  if (node.type !== "actionNode") return data;

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !EASY_SYNC_ACTION_PARAM_KEY_SET.has(key)),
  );
}

function readPersistedStrategyBuilderState(): PersistedStrategyBuilderState | null {
  if (!canUseBrowserStorage()) return null;

  try {
    const raw = window.localStorage.getItem(STRATEGY_BUILDER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedStrategyBuilderState>;
    if (parsed.version !== 1 || !isEasyViewModel(parsed.easyViewModel)) return null;

    const advancedGraphModel = isAdvancedGraphModel(parsed.advancedGraphModel) ? parsed.advancedGraphModel : null;
    const restoredGeneratedCode = typeof parsed.generatedCode === "string" ? parsed.generatedCode : parsed.easyViewModel.code;
    const restoredProgramCode = typeof parsed.programCode === "string" ? parsed.programCode : "";
    const restoredAiSummary = typeof parsed.aiSummary === "string" ? parsed.aiSummary : `AI 요약: ${parsed.easyViewModel.summary}`;
    const restoredAgentSteps = Array.isArray(parsed.agentSteps)
      ? parsed.agentSteps.filter((step): step is string => typeof step === "string")
      : [];

    const isLegacySeededTemplate =
      !advancedGraphModel &&
      restoredProgramCode === "" &&
      restoredGeneratedCode === INITIAL_STRATEGY_CODE &&
      parsed.easyViewModel.code === INITIAL_STRATEGY_CODE &&
      parsed.easyViewModel.title === INITIAL_EASY_VIEW.title &&
      parsed.easyViewModel.summary === INITIAL_EASY_VIEW.summary &&
      restoredAiSummary === `AI 요약: ${INITIAL_EASY_VIEW.summary}` &&
      (restoredAgentSteps.length === 0 || matchesExactStepSequence(restoredAgentSteps, LEGACY_SEEDED_AGENT_STEPS));

    if (isLegacySeededTemplate) {
      window.localStorage.removeItem(STRATEGY_BUILDER_STORAGE_KEY);
      return null;
    }

    return {
      version: 1,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
      generatedCode: restoredGeneratedCode,
      programCode: restoredProgramCode,
      easyViewModel: parsed.easyViewModel,
      advancedGraphModel,
      lastSyncedAdvancedGraphSignature: advancedGraphModel
        ? createAdvancedGraphSignature(advancedGraphModel)
        : typeof parsed.lastSyncedAdvancedGraphSignature === "string"
          ? parsed.lastSyncedAdvancedGraphSignature
          : "",
      aiSummary: restoredAiSummary,
      agentSteps: restoredAgentSteps,
    };
  } catch (error) {
    console.warn("[strategyBuilder] failed to restore persisted easy view", error);
    return null;
  }
}

function writePersistedStrategyBuilderState(state: Omit<PersistedStrategyBuilderState, "version" | "savedAt">) {
  if (!canUseBrowserStorage()) return;

  try {
    const payload: PersistedStrategyBuilderState = {
      version: 1,
      savedAt: Date.now(),
      ...state,
    };
    window.localStorage.setItem(STRATEGY_BUILDER_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("[strategyBuilder] failed to persist easy view", error);
  }
}

function isExchangeFormEffectivelyEmpty(form: ExchangeFormState) {
  return ![
    form.id,
    form.name,
    form.apiUrl,
    form.wsUrl,
    form.rpcUrl,
    form.marketDataUrl,
    form.apiKey,
    form.apiSecret,
    form.apiPassphrase,
    form.privateKey,
    form.funder,
    form.chainId,
  ].some((value) => value.trim().length > 0);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function createAdvancedGraphSignature(graph: AdvancedGraphModel | null | undefined) {
  if (!graph) return "";

  const nodes = graph.nodes
    .filter((node) => node.type !== "groupNode" && !node.hidden)
    .map((node) => ({
      id: node.id,
      type: node.type,
      parentId: node.parentId ?? "",
      data: getNodeDataForAdvancedStructureSignature(node),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = graph.edges
    .filter((edge) => !edge.hidden)
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? "",
      targetHandle: edge.targetHandle ?? "",
      label: typeof edge.data === "object" && edge.data ? (edge.data as Record<string, unknown>).label ?? "" : "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return stableStringify({ nodes, edges });
}

const AI_REASONING_LAYER_LABELS: Record<string, string> = {
  orchestrator: "Orchestrator",
  research: "Research",
  strategy: "Strategy",
  "strategy-overview": "Overview",
};

function formatAIReasoningTrace(value: unknown) {
  if (!Array.isArray(value)) return "";
  const sections = value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const trace = item as Record<string, unknown>;
      const content = typeof trace.content === "string" ? trace.content.trim() : "";
      if (!content) return "";
      const layer = typeof trace.layer === "string" ? trace.layer : "";
      const provider = typeof trace.provider === "string" ? trace.provider : "";
      const model = typeof trace.model === "string" ? trace.model : "";
      const label = AI_REASONING_LAYER_LABELS[layer] ?? layer ?? "AI";
      const meta = [provider, model].filter(Boolean).join(" / ");
      return `[${label}${meta ? ` · ${meta}` : ""}]\n${content}`;
    })
    .filter(Boolean);

  if (sections.length === 0) return "";
  return `\n\nDeepSeek reasoning\n${sections.join("\n\n")}`;
}

function formatAIRuntimeResult(validation: unknown, runtime: unknown) {
  const validationObj = validation && typeof validation === "object" ? validation as Record<string, unknown> : null;
  const runtimeObj = runtime && typeof runtime === "object" ? runtime as Record<string, unknown> : null;
  const attempts = typeof validationObj?.attempts === "number" ? validationObj.attempts : null;
  const runCommand = typeof runtimeObj?.runCommand === "string" ? runtimeObj.runCommand : "";
  const validateCommand = typeof runtimeObj?.validateCommand === "string" ? runtimeObj.validateCommand : "";
  const codegenCommand = typeof runtimeObj?.codegenCommand === "string" ? runtimeObj.codegenCommand : "";
  const compileCommand = typeof runtimeObj?.compileCommand === "string" ? runtimeObj.compileCommand : "";
  const strategyPath = typeof runtimeObj?.strategyPath === "string" ? runtimeObj.strategyPath : "";
  const mainGoPath = typeof runtimeObj?.mainGoPath === "string" ? runtimeObj.mainGoPath : "";
  const hostProgram = runtimeObj?.hostProgram && typeof runtimeObj.hostProgram === "object"
    ? runtimeObj.hostProgram as Record<string, unknown>
    : null;
  const lines = [];

  if (validationObj?.ok === true) {
    lines.push(`검증: strategy-validate 통과${attempts ? ` (${attempts}회차)` : ""}`);
  }
  if (strategyPath) lines.push(`전략 JSON: ${strategyPath}`);
  if (mainGoPath) lines.push(`생성 Hershy Go 코드: ${mainGoPath}`);
  if (validateCommand) lines.push(`검증 명령: ${validateCommand}`);
  if (codegenCommand) lines.push(`코드 생성 명령: ${codegenCommand}`);
  if (compileCommand) lines.push(`컴파일 확인: ${compileCommand}`);
  if (runCommand) lines.push(`실행 명령: ${runCommand}`);
  if (hostProgram?.ok === true) {
    if (typeof hostProgram.programId === "string") lines.push(`Host Program: ${hostProgram.programId}`);
    if (typeof hostProgram.state === "string") lines.push(`Host 상태: ${hostProgram.state}`);
    if (typeof hostProgram.hostUI === "string") lines.push(`Program UI: ${hostProgram.hostUI}`);
    if (typeof hostProgram.watcherStatusUrl === "string") lines.push(`Watcher 상태: ${hostProgram.watcherStatusUrl}`);
    if (typeof hostProgram.startWarning === "string" && hostProgram.startWarning) lines.push(`Host 시작 경고: ${hostProgram.startWarning}`);
  } else if (hostProgram && typeof hostProgram.warning === "string") {
    lines.push(`Host Program 등록 경고: ${hostProgram.warning}`);
  }

  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

function extractRuntimeProgramCode(runtime: unknown) {
  const runtimeObj = runtime && typeof runtime === "object" ? runtime as Record<string, unknown> : null;
  const programCode = runtimeObj?.programCode || runtimeObj?.generatedGoCode;
  return typeof programCode === "string" ? programCode : "";
}

function parseStrategyGraphCode(code: string): StrategyGraphPayload | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as StrategyGraphPayload;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.kind === "hershy-strategy-graph" &&
      Array.isArray(parsed.blocks) &&
      Array.isArray(parsed.connections)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function formatAILogicErrorLog(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const log = value as Record<string, unknown>;
  const runId = typeof log.runId === "string" ? log.runId : "";
  const logPath = typeof log.logPath === "string" ? log.logPath : "";
  const readEndpoint = typeof log.readEndpoint === "string" ? log.readEndpoint : "";
  const entries = Array.isArray(log.entries) ? log.entries : [];
  const recent = entries.slice(-5).map((entry, index) => {
    if (!entry || typeof entry !== "object") return "";
    const row = entry as Record<string, unknown>;
    const stage = typeof row.stage === "string" ? row.stage : "logic";
    const attempt = typeof row.attempt === "number" ? row.attempt : index + 1;
    const issueCount = typeof row.issueCount === "number" ? row.issueCount : 0;
    const issues = Array.isArray(row.issues)
      ? row.issues.slice(0, 3).map((issue) => {
        if (typeof issue === "string") return issue;
        if (!issue || typeof issue !== "object") return "";
        const item = issue as Record<string, unknown>;
        const code = typeof item.code === "string" ? item.code : "ISSUE";
        const message = typeof item.message === "string" ? item.message : "";
        return `${code}${message ? `: ${message}` : ""}`;
      }).filter(Boolean)
      : [];
    return `- ${attempt}회차 ${stage}: ${issueCount}개${issues.length > 0 ? ` · ${issues.join(" / ")}` : ""}`;
  }).filter(Boolean);

  const lines = [
    "논리 오류 로그가 저장되었습니다.",
    runId ? `runId: ${runId}` : "",
    logPath ? `파일: ${logPath}` : "",
    readEndpoint ? `조회: ${readEndpoint}` : "",
    ...recent,
  ].filter(Boolean);
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

function normalizeAgentActivities(value: unknown): AgentActivity[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): AgentActivity | null => {
      if (!item || typeof item !== "object") return null;
      const activity = item as Record<string, unknown>;
      const label = typeof activity.label === "string" ? activity.label.trim() : "";
      if (!label) return null;
      return {
        id: typeof activity.id === "string" ? activity.id : `activity-${index}`,
        timestamp: typeof activity.timestamp === "string" ? activity.timestamp : undefined,
        status: typeof activity.status === "string" ? activity.status : "running",
        stage: typeof activity.stage === "string" ? activity.stage : "running",
        label,
        detail: activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : undefined,
      };
    })
    .filter((item): item is AgentActivity => Boolean(item));
}

function agentStepsFromActivities(activities: AgentActivity[]) {
  return activities.map((activity) => activity.label);
}

function parseAgentEventBlock(block: string) {
  let event = "message";
  const dataLines: string[] = [];
  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  });
  const rawData = dataLines.join("\n");
  if (!rawData) return null;
  try {
    return { event, data: JSON.parse(rawData) as unknown };
  } catch {
    return { event, data: rawData };
  }
}

function parseAgentEventBuffer(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  return {
    events: blocks.map(parseAgentEventBlock).filter((item): item is { event: string; data: unknown } => Boolean(item)),
    remainder,
  };
}

export default function Page() {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("create");
  const [mainView, setMainView] = useState<MainView>("easy");
  const [detailTab, setDetailTab] = useState<DetailTab>("params");
  const [selectedBlockId, setSelectedBlockId] = useState("spot-buy");
  const [exchangeTab, setExchangeTab] = useState<ExchangeTab>(EXCHANGE_CONNECTIONS[0]?.id ?? "binance");
  const [planTier, setPlanTier] = useState<PlanTier>("pro");
  const [marketRows, setMarketRows] = useState<MarketRow[]>(MARKET_ROWS);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState("");
  const [marketWarning, setMarketWarning] = useState("");
  const [exchangeConnections, setExchangeConnections] = useState<ExchangeConnection[]>(EXCHANGE_CONNECTIONS);
  const [exchangeForm, setExchangeForm] = useState<ExchangeFormState>(createEmptyExchangeForm);
  const [isSavingExchange, setIsSavingExchange] = useState(false);
  const [isTestingExchangeAuth, setIsTestingExchangeAuth] = useState(false);
  const [exchangeAuthMarket] = useState<"spot" | "futures">("spot");
  const [exchangeAuthMessage, setExchangeAuthMessage] = useState("");
  const [exchangeFormError, setExchangeFormError] = useState("");
  const [clientUserName, setClientUserName] = useState("Guest");
  const [isPersonalLoggedIn, setIsPersonalLoggedIn] = useState(false);
  const [loginInput, setLoginInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [guideDone, setGuideDone] = useState<Set<number>>(new Set([0]));
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isExchangeLibraryOpen, setIsExchangeLibraryOpen] = useState(false);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isTemplatePanelOpen, setIsTemplatePanelOpen] = useState(false);
  const [templatePanelMode, setTemplatePanelMode] = useState<"compact" | "expanded">("compact");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMessages, setAgentMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    {
      role: "ai",
      text: "추천 템플릿을 고르거나 직접 말로 전략을 요청하면 코드 생성 후 쉬운 보기를 다시 만듭니다.",
    },
  ]);
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
  const [generatedCode, setGeneratedCode] = useState("");
  const [programCode, setProgramCode] = useState("");
  const [programCodeError, setProgramCodeError] = useState("");
  const [isGeneratingProgramCode, setIsGeneratingProgramCode] = useState(false);
  const [easyViewModel, setEasyViewModel] = useState<EasyViewModel>(EMPTY_EASY_VIEW);
  const [advancedGraphModel, setAdvancedGraphModel] = useState<NonNullable<EasyViewAgentResult["advancedGraph"]> | null>(null);
  const [advancedGraphVersion, setAdvancedGraphVersion] = useState(0);
  const [lastSyncedAdvancedGraphSignature, setLastSyncedAdvancedGraphSignature] = useState("");
  const [isAdvancedSyncPromptOpen, setIsAdvancedSyncPromptOpen] = useState(false);
  const [pendingAdvancedToEasyRegeneration, setPendingAdvancedToEasyRegeneration] =
    useState<PendingAdvancedToEasyRegeneration | null>(null);
  const [isRegeneratingEasyView, setIsRegeneratingEasyView] = useState(false);
  const [agentSteps, setAgentSteps] = useState<string[]>(() => [...DEFAULT_AGENT_STEPS]);
  const [aiSummary, setAiSummary] = useState(
    `AI 요약: ${EMPTY_EASY_VIEW.summary}`,
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const entries = STRATEGY_BLOCKS.flatMap((block) =>
      block.params.map((param) => [`${block.id}:${param.key}`, param.value] as const),
    );
    return Object.fromEntries(entries);
  });
  const templatePanelCloseTimer = useRef<number | null>(null);
  const agentAbortControllerRef = useRef<AbortController | null>(null);
  const strategyPersistenceReadyRef = useRef(false);
  const isRestoringStrategyStateRef = useRef(false);
  const switchToEasyAfterAdvancedSaveRef = useRef(false);
  const programCodeRequestRef = useRef("");
  const connectedExchangeCount = exchangeConnections.filter((item) => item.status === "연결됨").length;
  const selectedExchange = exchangeConnections.find((item) => item.id === exchangeTab) ?? exchangeConnections[0];
  const hasExchangeExecutionUrl = Boolean(
    exchangeForm.apiUrl.trim() ||
    exchangeForm.rpcUrl.trim() ||
    selectedExchange?.apiUrl ||
    selectedExchange?.restUrl ||
    selectedExchange?.rpcUrl,
  );
  const selectedExchangeName = selectedExchange?.name || DEFAULT_CEX_TRADE_EXCHANGE;
  const selectedExchangeCredentials = selectedExchange?.credentials;
  const isSelectedExchangePolymarket = Boolean(
    selectedExchange &&
    /polymarket/i.test(`${selectedExchange.id} ${selectedExchange.name}`),
  );
  const isSelectedExchangeOKX = Boolean(
    selectedExchange &&
    /okx/i.test(`${selectedExchange.id} ${selectedExchange.name}`),
  );
  const isSelectedExchangeBinance = Boolean(
    selectedExchange &&
    /binance/i.test(`${selectedExchange.id} ${selectedExchange.name}`),
  );
  const hasPendingBinanceCredentialInput = Boolean(exchangeForm.apiKey.trim() || exchangeForm.apiSecret.trim());
  const hasResolvableBinanceCredentialPair = Boolean(
    (exchangeForm.apiKey.trim() || selectedExchangeCredentials?.hasApiKey)
    && (exchangeForm.apiSecret.trim() || selectedExchangeCredentials?.hasApiSecret),
  );
  const canTestBinanceAuth = Boolean(
    isSelectedExchangeBinance &&
    hasResolvableBinanceCredentialPair,
  );
  const isCreateWorkspace = activeWorkspace === "create";
  const generatedStrategyGraph = useMemo(() => parseStrategyGraphCode(generatedCode), [generatedCode]);
  const generatedStrategyGraphSignature = useMemo(
    () => (generatedStrategyGraph ? stableStringify(generatedStrategyGraph) : ""),
    [generatedStrategyGraph],
  );
  const codeViewContent = programCode || generatedCode;
  const codeViewTitle = programCode
    ? "Hershy generated_strategy.go"
    : generatedStrategyGraph
      ? "Hershy Strategy Graph"
      : "Hershy Strategy Code";
  const codeViewStatus = isGeneratingProgramCode
    ? "generating program"
    : programCode
      ? "program"
      : generatedStrategyGraph
        ? "graph"
        : "source";

  const generateRuntimeProgramCode = useCallback(
    async (options?: { force?: boolean }) => {
      if (!generatedStrategyGraph || isGeneratingProgramCode) return false;
      if (programCode.trim() && !options?.force) return true;
      if (generatedStrategyGraphSignature && programCodeRequestRef.current === generatedStrategyGraphSignature && !options?.force) {
        return false;
      }

      programCodeRequestRef.current = generatedStrategyGraphSignature;
      setIsGeneratingProgramCode(true);
      setProgramCodeError("");
      try {
        const response = await fetch("/api/strategy/runtime-artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy: generatedStrategyGraph }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const issues = Array.isArray(payload?.validation?.issues) && payload.validation.issues.length > 0
            ? `: ${payload.validation.issues.slice(0, 3).join(" / ")}`
            : "";
          throw new Error(`${payload?.message || payload?.error || "Hershy program generation failed"}${issues}`);
        }
        const nextProgramCode = extractRuntimeProgramCode(payload?.runtime);
        if (!nextProgramCode) {
          throw new Error("runtime response did not include generated_strategy.go");
        }
        setProgramCode(nextProgramCode);
        return true;
      } catch (error) {
        setProgramCodeError(error instanceof Error ? error.message : "Hershy program generation failed");
        return false;
      } finally {
        setIsGeneratingProgramCode(false);
      }
    },
    [generatedStrategyGraph, generatedStrategyGraphSignature, isGeneratingProgramCode, programCode],
  );

  const loadMarketOverview = useCallback(async () => {
    try {
      const response = await fetch("/api/market/overview", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "시장 데이터를 불러오지 못했습니다."));
      if (Array.isArray(data?.rows)) setMarketRows(data.rows);
      setMarketUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : new Date().toISOString());
      setMarketWarning(typeof data?.warning === "string" ? data.warning : "");
    } catch (error) {
      setMarketWarning(error instanceof Error ? error.message : "시장 데이터 로딩 실패");
    }
  }, []);

  const loadExchangeConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/exchange-connections", {
        cache: "no-store",
        headers: withUserContextHeaders(),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "거래소 연결 정보를 불러오지 못했습니다."));
      const connections = Array.isArray(data?.connections) ? data.connections as ExchangeConnection[] : EXCHANGE_CONNECTIONS;
      setExchangeConnections(connections);
      if (!connections.some((item) => item.id === exchangeTab)) {
        setExchangeTab(connections[0]?.id ?? "binance");
      }
    } catch {
      setExchangeConnections(EXCHANGE_CONNECTIONS);
    }
  }, [exchangeTab]);

  const handlePersonalLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");
    try {
      const profile = loginClientUser(loginInput);
      setClientUserName(profile.displayName);
      setIsPersonalLoggedIn(profile.isLoggedIn);
      setIsUserSettingsOpen(false);
      setExchangeForm(createEmptyExchangeForm());
      setExchangeAuthMessage(`${profile.displayName} 계정으로 전환했습니다.`);
      setExchangeFormError("");
      await loadExchangeConnections();
    } catch {
      setLoginError("이름이나 이메일을 입력해 주세요.");
    }
  };

  const handlePersonalLogout = async () => {
    const profile = logoutClientUser();
    setClientUserName(profile.displayName);
    setIsPersonalLoggedIn(profile.isLoggedIn);
    setLoginInput("");
    setLoginError("");
    setIsUserSettingsOpen(false);
    setExchangeForm(createEmptyExchangeForm());
    setExchangeAuthMessage("게스트 세션으로 전환했습니다.");
    setExchangeFormError("");
    await loadExchangeConnections();
  };

  const openUserSettings = () => {
    setLoginInput(isPersonalLoggedIn ? clientUserName : "");
    setLoginError("");
    setIsUserSettingsOpen(true);
  };

  const handleCancelAgentRun = useCallback(() => {
    agentAbortControllerRef.current?.abort();
  }, []);

  const persistExchangeConnection = async (options?: { successMessage?: string | null }) => {
    if (!exchangeForm.name.trim()) {
      setExchangeFormError("거래소 이름을 입력하세요.");
      return null;
    }
    if (!hasExchangeExecutionUrl) {
      setExchangeFormError("선택한 거래소의 실행 API 기본값을 찾지 못했습니다.");
      return null;
    }
    setIsSavingExchange(true);
    setExchangeFormError("");
    try {
      const response = await fetch("/api/exchange-connections", {
        method: "POST",
        headers: withUserContextHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(withUserContextPayload(exchangeForm)),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "거래소 연결 저장 실패"));
      const connections = Array.isArray(data?.connections) ? data.connections as ExchangeConnection[] : exchangeConnections;
      setExchangeConnections(connections);
      if (data?.connection?.id) setExchangeTab(data.connection.id);
      const nextSelected = connections.find((item) => item.id === data?.connection?.id) || data?.connection || selectedExchange || null;
      setExchangeForm(buildExchangeFormFromConnection(nextSelected as ExchangeConnection | null));
      if (options?.successMessage !== null) {
        setExchangeAuthMessage(options?.successMessage || "연결 정보를 저장했습니다.");
      }
      setGuideDone((prev) => new Set([...prev, 0]));
      return {
        connection: (nextSelected as ExchangeConnection | null) || null,
        connections,
      };
    } catch (error) {
      setExchangeFormError(error instanceof Error ? error.message : "거래소 연결 저장 실패");
      setAgentMessages((prev) => [
        ...prev,
        { role: "ai", text: `거래소 연결 저장 실패: ${error instanceof Error ? error.message : "unknown error"}` },
      ]);
      return null;
    } finally {
      setIsSavingExchange(false);
    }
  };

  const saveExchangeConnection = async () => {
    await persistExchangeConnection({
      successMessage: "연결 정보를 저장했습니다.",
    });
  };

  const testBinanceAuth = async () => {
    const selectedExchangeId = selectedExchange?.id || exchangeForm.id.trim();
    if (!selectedExchangeId) {
      setExchangeAuthMessage("먼저 연결을 선택하세요.");
      return;
    }
    if (!isSelectedExchangeBinance) {
      setExchangeAuthMessage("현재 서명 테스트는 Binance 연결에서만 지원합니다.");
      return;
    }
    if (!canTestBinanceAuth) {
      setExchangeAuthMessage("Binance API Key와 Secret을 저장한 뒤 서명 테스트를 실행하세요.");
      return;
    }

    let connectionIdForTest = selectedExchangeId;
    if (hasPendingBinanceCredentialInput) {
      const saved = await persistExchangeConnection({ successMessage: null });
      if (!saved?.connection?.id) {
        return;
      }
      connectionIdForTest = saved.connection.id;
      setExchangeAuthMessage("연결 정보를 저장한 뒤 Binance 서명 테스트를 시작합니다.");
    }

    setIsTestingExchangeAuth(true);
    if (!hasPendingBinanceCredentialInput) {
      setExchangeAuthMessage("");
    }
    try {
      const response = await fetch(`/api/exchange-connections/${encodeURIComponent(connectionIdForTest)}/binance-auth-test`, {
        method: "POST",
        headers: withUserContextHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(withUserContextPayload({ market: exchangeAuthMarket })),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "Binance 서명 테스트 실패"));
      if (Array.isArray(data?.connections)) {
        setExchangeConnections(data.connections as ExchangeConnection[]);
      }
      setExchangeAuthMessage(
        `${exchangeAuthMarket === "futures" ? "Futures" : "Spot"} HMAC 서명 요청 성공${data?.account?.accountType ? ` · ${data.account.accountType}` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binance 서명 테스트 실패";
      setExchangeAuthMessage(message);
      setAgentMessages((prev) => [...prev, { role: "ai", text: message }]);
    } finally {
      setIsTestingExchangeAuth(false);
    }
  };

  useEffect(() => {
    const profile = getClientUserProfile();
    setClientUserName(profile.displayName);
    setIsPersonalLoggedIn(profile.isLoggedIn);
    setLoginInput(profile.isLoggedIn ? profile.displayName : "");
  }, []);

  useEffect(() => {
    if (!selectedExchange) return;
    setExchangeForm((prev) => {
      if (!isExchangeFormEffectivelyEmpty(prev)) {
        return prev;
      }
      return buildExchangeFormFromConnection(selectedExchange);
    });
  }, [selectedExchange]);

  useEffect(() => {
    setOpenTabs(historyStore.getOpenTabs());
    setActiveTabId(historyStore.getActiveId());
    setSnapshots(historyStore.getSnapshots());
    setIsGuideOpen(false);

    const unsubHistory = historyStore.subscribe(() => {
      setOpenTabs(historyStore.getOpenTabs());
      setActiveTabId(historyStore.getActiveId());
      setSnapshots(historyStore.getSnapshots());
    });

    const handleOpenHistory = () => setIsHistoryOpen(true);
    window.addEventListener("openStrategyHistoryModal", handleOpenHistory);

    return () => {
      unsubHistory();
      window.removeEventListener("openStrategyHistoryModal", handleOpenHistory);
      if (templatePanelCloseTimer.current) {
        window.clearTimeout(templatePanelCloseTimer.current);
      }
      agentAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const persisted = readPersistedStrategyBuilderState();

    if (!persisted) {
      strategyPersistenceReadyRef.current = true;
      return;
    }

    isRestoringStrategyStateRef.current = true;
    setGeneratedCode(persisted.generatedCode);
    setProgramCode(persisted.programCode);
    setEasyViewModel(persisted.easyViewModel);
    setAiSummary(persisted.aiSummary);
    if (persisted.agentSteps.length > 0) {
      setAgentSteps(persisted.agentSteps);
    }
    if (persisted.advancedGraphModel) {
      setAdvancedGraphModel(persisted.advancedGraphModel);
      setAdvancedGraphVersion((version) => version + 1);
    }
    setLastSyncedAdvancedGraphSignature(
      persisted.lastSyncedAdvancedGraphSignature || createAdvancedGraphSignature(persisted.advancedGraphModel),
    );

    const timer = window.setTimeout(() => {
      isRestoringStrategyStateRef.current = false;
      strategyPersistenceReadyRef.current = true;
    }, 0);

    return () => {
      window.clearTimeout(timer);
      isRestoringStrategyStateRef.current = false;
      strategyPersistenceReadyRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!strategyPersistenceReadyRef.current || isRestoringStrategyStateRef.current) return;

    writePersistedStrategyBuilderState({
      generatedCode,
      programCode,
      easyViewModel,
      advancedGraphModel,
      lastSyncedAdvancedGraphSignature,
      aiSummary,
      agentSteps,
    });
  }, [generatedCode, programCode, easyViewModel, advancedGraphModel, lastSyncedAdvancedGraphSignature, aiSummary, agentSteps]);

  useEffect(() => {
    void loadExchangeConnections();
    void loadMarketOverview();
    const timer = window.setInterval(() => {
      void loadMarketOverview();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadExchangeConnections, loadMarketOverview]);

  useEffect(() => {
    if (mainView !== "code" || programCode.trim() || !generatedStrategyGraph) return;
    void generateRuntimeProgramCode();
  }, [generateRuntimeProgramCode, generatedStrategyGraph, mainView, programCode]);

  const activeSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === activeTabId) ?? null,
    [activeTabId, snapshots],
  );
  const activeAdvancedGraph = useMemo<AdvancedGraphModel | null>(
    () => activeSnapshot && activeSnapshot.nodes.length > 0
      ? { nodes: activeSnapshot.nodes as AdvancedGraphModel["nodes"], edges: activeSnapshot.edges as AdvancedGraphModel["edges"] }
      : advancedGraphModel,
    [activeSnapshot, advancedGraphModel],
  );
  const activeAdvancedGraphSignature = useMemo(
    () => createAdvancedGraphSignature(activeAdvancedGraph),
    [activeAdvancedGraph],
  );
  const hasUnsyncedAdvancedChanges = Boolean(
    activeAdvancedGraphSignature &&
    activeAdvancedGraphSignature !== lastSyncedAdvancedGraphSignature,
  );

  const selectedBlock = useMemo(
    () => STRATEGY_BLOCKS.find((block) => block.id === selectedBlockId) ?? STRATEGY_BLOCKS[0],
    [selectedBlockId],
  );
  const SelectedBlockIcon = selectedBlock.icon;

  const guideProgress = guideDone.size;
  const visibleAgentActivities = useMemo(
    () => agentActivities.length > 0
      ? agentActivities
      : agentSteps.map((step, index) => ({
        id: `static-agent-step-${index}`,
        status: "idle",
        stage: "local",
        label: step,
      })),
    [agentActivities, agentSteps],
  );

  const handleSave = () => {
    window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));
  };

  const handleCreateTemplateDraft = useCallback(() => {
    const fallbackName =
      easyViewModel.title && easyViewModel.title !== EMPTY_EASY_VIEW.title
        ? easyViewModel.title
        : "새 전략 템플릿";
    historyStore.createEmptyStrategy(null, fallbackName);
  }, [easyViewModel.title]);

  const handleCreateBranchDraft = useCallback(() => {
    const graph = activeAdvancedGraph ?? advancedGraphModel;
    const activeId = historyStore.getActiveId();

    if (!activeId) {
      const draft = historyStore.createEmptyStrategy(null, easyViewModel.title || "새 전략 템플릿");
      if (draft && graph && graph.nodes.length > 0) {
        historyStore.updateActiveSnapshot(graph.nodes, graph.edges);
      }
      return;
    }

    historyStore.createBranchDraft(activeId);
  }, [activeAdvancedGraph, advancedGraphModel, easyViewModel.title]);

  const handleSaveTemplateVersion = useCallback(() => {
    const graph = activeAdvancedGraph ?? advancedGraphModel;

    if (!historyStore.getActiveId()) {
      const draft = historyStore.createEmptyStrategy(null, easyViewModel.title || "새 전략 템플릿");
      if (draft && graph && graph.nodes.length > 0) {
        historyStore.updateActiveSnapshot(graph.nodes, graph.edges);
      }
      return;
    }

    if (graph && graph.nodes.length > 0) {
      historyStore.saveSnapshot(graph.nodes, graph.edges);
      return;
    }

    window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));
  }, [activeAdvancedGraph, advancedGraphModel, easyViewModel.title]);

  const handleSaveCurrentEasyBlock = useCallback((node: EasyViewNode) => {
    handleSaveTemplateVersion();
    setAgentMessages((prev) => [
      ...prev,
      {
        role: "ai",
        text: `${node.title || "선택한 블록"} 기준으로 현재 전략 버전을 저장했습니다. 버전 타임라인에서 이 시점의 쉬운 보기와 고급 보기 노드를 다시 볼 수 있어요.`,
      },
    ]);
  }, [handleSaveTemplateVersion]);

  const handleMainViewChange = (nextView: MainView) => {
    if (nextView === mainView) return;
    if (nextView === "easy" && mainView === "advanced") {
      if (hasUnsyncedAdvancedChanges) {
        setIsAdvancedSyncPromptOpen(true);
        return;
      }
      if (activeAdvancedGraph) {
        syncEasyViewParamsFromAdvancedGraph(activeAdvancedGraph, {
          switchToEasy: true,
          silent: true,
        });
        return;
      }
    }
    setMainView(nextView);
  };

  const handleConfirmAdvancedSaveForEasyView = () => {
    setIsAdvancedSyncPromptOpen(false);
    switchToEasyAfterAdvancedSaveRef.current = true;
    window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));

    if (!activeSnapshot && activeAdvancedGraph) {
      const nextSignature = createAdvancedGraphSignature(activeAdvancedGraph);
      const handled = nextSignature === lastSyncedAdvancedGraphSignature
        ? syncEasyViewParamsFromAdvancedGraph(activeAdvancedGraph, {
          strategyName: easyViewModel.title,
          switchToEasy: true,
        })
        : regenerateEasyViewFromAdvancedGraph(activeAdvancedGraph, {
          strategyName: easyViewModel.title,
          switchToEasy: true,
          source: "tab-switch",
        });
      if (handled) switchToEasyAfterAdvancedSaveRef.current = false;
    }
  };

  const handleSkipAdvancedSaveForEasyView = () => {
    setIsAdvancedSyncPromptOpen(false);
    switchToEasyAfterAdvancedSaveRef.current = false;
    setMainView("easy");
  };

  const handleAutoLayout = () => {
    window.dispatchEvent(new CustomEvent("runAutoLayout"));
  };

  const handleAiSummary = () => {
    setIsSummarizing(true);
    window.setTimeout(() => {
      const blockNames = easyViewModel.nodes.map((block) => block.title).join(" -> ");
      setAiSummary(
        `AI 요약: 현재 쉬운 보기는 생성된 코드에서 ${blockNames} 순서로 추출한 요약입니다. 파이프라인 구조는 고급 보기에서 편집하고, 쉬운 보기에서는 CEX/DEX 실행 파라미터만 조절합니다.`,
      );
      setIsSummarizing(false);
    }, 650);
  };

  const syncEasyViewParamsFromAdvancedGraph = useCallback(
    (graph: AdvancedGraphModel, options?: { strategyName?: string; switchToEasy?: boolean; silent?: boolean }) => {
      if (!graph.nodes.some((node) => node.type !== "groupNode")) return false;

      const strategyName = options?.strategyName || activeSnapshot?.name || easyViewModel.title || "고급 보기 수정 전략";
      const strategyGraph = advancedGraphToStrategyGraph(graph, strategyName);
      const signature = createAdvancedGraphSignature(graph);

      setGeneratedCode(strategyGraphToCode(strategyGraph));
      setProgramCode("");
      setEasyViewModel((current) => syncEasyViewActionParams(current, graph));
      setAdvancedGraphModel(graph);
      setAdvancedGraphVersion((version) => version + 1);
      setLastSyncedAdvancedGraphSignature(signature);

      if (!options?.silent) {
        setAgentActivities([
          {
            id: "advanced-param-sync",
            status: "complete",
            stage: "advanced-param-sync",
            label: "고급 보기 파라미터 동기화 완료",
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: "고급 보기의 실행 파라미터 변경만 반영했습니다. 전략 흐름은 바뀌지 않았으므로 쉬운 보기 노드/간선은 다시 만들지 않았습니다.",
          },
        ]);
      }

      if (options?.switchToEasy) {
        setMainView("easy");
      }

      return true;
    },
    [activeSnapshot?.name, easyViewModel.title],
  );

  const regenerateEasyViewFromAdvancedGraph = useCallback(
    (graph: AdvancedGraphModel, options?: {
      strategyName?: string;
      switchToEasy?: boolean;
      source?: "save" | "tab-switch";
      bypassSafetyPrompt?: boolean;
    }) => {
      if (!graph.nodes.some((node) => node.type !== "groupNode")) return false;

      const strategyName = options?.strategyName || activeSnapshot?.name || easyViewModel.title || "고급 보기 수정 전략";
      const safetyIssues = auditAdvancedGraphForEasyView(graph);
      if (safetyIssues.length > 0 && !options?.bypassSafetyPrompt) {
        setPendingAdvancedToEasyRegeneration({
          graph,
          options: {
            strategyName,
            switchToEasy: options?.switchToEasy,
            source: options?.source,
          },
          issues: safetyIssues,
        });
        return false;
      }

      const signature = createAdvancedGraphSignature(graph);
      setIsRegeneratingEasyView(true);
      setAgentActivities([
        {
          id: "advanced-save",
          status: "complete",
          stage: "advanced-save",
          label: "고급 보기 저장 내용 확인",
          timestamp: new Date().toISOString(),
        },
        {
          id: "advanced-to-runtime-graph",
          status: "running",
          stage: "advanced-to-runtime-graph",
          label: "고급 보기 그래프를 전략 graph로 역변환",
          timestamp: new Date().toISOString(),
        },
      ]);

      try {
        const strategyGraph = advancedGraphToStrategyGraph(graph, strategyName);
        const result = runEasyViewGraphAgentLoop(
          strategyGraph,
          `고급 보기에서 저장된 "${strategyName}" 그래프를 기준으로 쉬운 보기를 다시 생성`,
        );

        setGeneratedCode(result.code);
        setProgramCode("");
        setEasyViewModel(result.easyView);
        setAdvancedGraphModel(graph);
        setAdvancedGraphVersion((version) => version + 1);
        setLastSyncedAdvancedGraphSignature(signature);
        setAgentSteps([
          "고급 보기 수정본 저장",
          "고급 보기 노드/간선을 strategy graph로 역변환",
          ...result.steps,
        ]);
        setAiSummary(`AI 요약: ${result.easyView.summary}`);
        setAgentActivities([
          {
            id: "advanced-save",
            status: "complete",
            stage: "advanced-save",
            label: "고급 보기 저장 내용 확인",
            timestamp: new Date().toISOString(),
          },
          {
            id: "advanced-to-runtime-graph",
            status: "complete",
            stage: "advanced-to-runtime-graph",
            label: "고급 보기 그래프를 전략 graph로 역변환",
            timestamp: new Date().toISOString(),
          },
          {
            id: "easy-view-regenerated",
            status: "complete",
            stage: "easy-view-regenerated",
            label: "쉬운 보기 재생성 완료",
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `고급 보기 저장본을 기준으로 쉬운 보기를 다시 생성했습니다.\n\n${result.easyView.title}\n고급 보기 노드 ${graph.nodes.filter((node) => node.type !== "groupNode").length}개 / 간선 ${graph.edges.length}개를 반영했습니다.`,
          },
        ]);
        if (options?.switchToEasy) {
          setMainView("easy");
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "쉬운 보기 재생성 실패";
        setAgentActivities((prev) => [
          ...prev,
          {
            id: "easy-view-regenerate-failed",
            status: "error",
            stage: "easy-view-regenerate-failed",
            label: message,
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `고급 보기 수정본으로 쉬운 보기를 다시 생성하지 못했습니다: ${message}`,
          },
        ]);
        return false;
      } finally {
        setIsRegeneratingEasyView(false);
      }
    },
    [activeSnapshot?.name, easyViewModel.title],
  );

  const runAISafetyScaffoldFromAdvancedGraph = useCallback(
    async (
      graph: AdvancedGraphModel,
      issues: AdvancedToEasySafetyIssue[],
      options?: {
        strategyName?: string;
        switchToEasy?: boolean;
        source?: "save" | "tab-switch";
      },
    ) => {
      if (isAgentRunning) return false;

      const strategyName = options?.strategyName || activeSnapshot?.name || easyViewModel.title || "고급 보기 수정 전략";
      const strategyGraph = advancedGraphToStrategyGraph(graph, strategyName);
      const prompt = buildAISafetyScaffoldPrompt(graph, issues, strategyName);
      const safetyPolicy = {
        objective: "move_strategy_assets_to_lower_volatility_assets_on_stop",
        preferredSafeAssets: ["USDC", "USDT", "DAI", "USD", "KRW"],
        detectedCapital: getCapitalSummary(inferCapitalVenues(graph)),
        missingSafety: issues.map((issue) => issue.id),
      };

      setIsRegeneratingEasyView(true);
      setIsAgentRunning(true);
      const initialActivity: AgentActivity = {
        id: "ai-safety-scaffold",
        status: "running",
        stage: "ai-safety-scaffold",
        label: "AI가 Init / Kill switch 안전 구조 설계",
        timestamp: new Date().toISOString(),
      };
      setAgentActivities([initialActivity]);
      setAgentSteps([initialActivity.label]);
      setAgentMessages((prev) => [
        ...prev,
        {
          role: "user",
          text: "고급 보기의 Init / Kill switch를 AI가 자금 출발지와 안전자산 회수 기준으로 보강",
        },
      ]);

      const controller = new AbortController();
      agentAbortControllerRef.current = controller;

      try {
        if (connectedExchangeCount === 0) {
          throw new Error("AI 안전 구조 생성을 위해서는 거래소 연결 탭에 REST API URL 또는 RPC URL이 하나 이상 필요합니다.");
        }

        const appendAgentActivity = (rawActivity: unknown) => {
          const activity = normalizeAgentActivities([rawActivity])[0];
          if (!activity) return;
          setAgentActivities((prev) => {
            const next = [...prev.filter((item) => item.id !== activity.id), activity].slice(-80);
            setAgentSteps(agentStepsFromActivities(next));
            return next;
          });
        };

        const response = await fetch("/api/ai/strategy-draft-stream", {
          method: "POST",
          headers: withUserContextHeaders({ "Content-Type": "application/json" }),
          signal: controller.signal,
          body: JSON.stringify(withUserContextPayload({
            prompt,
            current_strategy: {
              code: strategyGraphToCode(strategyGraph),
              runtimeGraph: strategyGraph,
              safetyPolicy,
              easyView: {
                title: easyViewModel.title,
                summary: easyViewModel.summary,
                nodes: easyViewModel.nodes.map((node) => ({
                  id: node.id,
                  title: node.title,
                  kind: node.kind,
                })),
              },
            },
          })),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(
            `${String(errorData?.message || errorData?.error || `AI 안전 구조 요청 실패 (${response.status})`)}${formatAILogicErrorLog(errorData?.logicErrorLog)}`,
          );
        }
        if (!response.body) {
          throw new Error("AI 안전 구조 생성 진행 스트림을 열 수 없습니다.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let data: any = null;
        let streamError = "";

        while (true) {
          const { value, done } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
            const parsed = parseAgentEventBuffer(buffer);
            buffer = parsed.remainder;
            for (const item of parsed.events) {
              if (item.event === "progress" || item.event === "done") {
                appendAgentActivity(item.data);
              } else if (item.event === "result") {
                data = item.data;
              } else if (item.event === "error") {
                const payload = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {};
                streamError = `${typeof payload.message === "string" ? payload.message : "AI 안전 구조 스트림 오류"}${formatAILogicErrorLog(payload.logicErrorLog)}`;
                appendAgentActivity(item.data);
              }
            }
          }
          if (done) break;
        }

        if (buffer.trim()) {
          for (const item of parseAgentEventBuffer(`${buffer}\n\n`).events) {
            if (item.event === "progress" || item.event === "done") appendAgentActivity(item.data);
            if (item.event === "result") data = item.data;
            if (item.event === "error") {
              const payload = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {};
              streamError = `${typeof payload.message === "string" ? payload.message : "AI 안전 구조 스트림 오류"}${formatAILogicErrorLog(payload.logicErrorLog)}`;
              appendAgentActivity(item.data);
            }
          }
        }

        if (streamError) {
          throw new Error(streamError);
        }
        if (!data?.strategy?.blocks || !data?.strategy?.connections) {
          throw new Error("AI 응답에 strategy graph가 없습니다.");
        }

        const result = runEasyViewGraphAgentLoop(data.strategy, prompt);
        const advancedGraph = result.advancedGraph;
        if (!advancedGraph || advancedGraph.nodes.length === 0) {
          throw new Error("AI 안전 구조를 고급 보기 그래프로 변환하지 못했습니다.");
        }

        const remainingIssues = auditAdvancedGraphForEasyView(advancedGraph);
        if (remainingIssues.length > 0) {
          throw new Error(`AI 응답에 아직 안전 구조가 부족합니다: ${remainingIssues.map((issue) => issue.title).join(", ")}`);
        }

        setGeneratedCode(result.code);
        setProgramCode(extractRuntimeProgramCode(data.runtime));
        setEasyViewModel(result.easyView);
        setAdvancedGraphModel(advancedGraph);
        setAdvancedGraphVersion((version) => version + 1);
        setLastSyncedAdvancedGraphSignature(createAdvancedGraphSignature(advancedGraph));
        setAgentSteps([
          "AI 안전 구조 생성",
          "변동성 낮은 자산으로 회수하는 Kill switch 반영",
          ...result.steps,
        ]);
        setAiSummary(`AI 요약: ${result.easyView.summary}`);
        setAgentActivities((prev) => {
          const next = [
            ...prev.filter((item) => item.id !== initialActivity.id && item.id !== "easy-view-regenerated"),
            {
              ...initialActivity,
              status: "complete",
              label: "AI Init / Kill switch 안전 구조 생성 완료",
            },
            {
              id: "easy-view-regenerated",
              status: "complete",
              stage: "easy-view-regenerated",
              label: "쉬운 보기 재생성 완료",
              timestamp: new Date().toISOString(),
            },
          ];
          setAgentSteps(agentStepsFromActivities(next));
          return next;
        });

        if (!historyStore.getActiveId()) {
          historyStore.createEmptyStrategy(null, result.easyView.title);
        } else {
          historyStore.updateSnapshotName(historyStore.getActiveId()!, result.easyView.title);
        }
        historyStore.updateActiveSnapshot(advancedGraph.nodes, advancedGraph.edges);
        window.dispatchEvent(
          new CustomEvent("loadSnapshot", {
            detail: {
              nodes: advancedGraph.nodes,
              edges: advancedGraph.edges,
            },
          }),
        );
        window.dispatchEvent(new CustomEvent("runAutoLayout"));

        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `${data.message || "AI safety scaffold generated"}\nprovider: ${data.providers?.strategy || data.providers?.orchestrator || data.provider || "unknown"} / model: ${data.model || data.models?.strategy || "unknown"}\n\nInit은 전략 자금의 출발지를 확인하고, Kill switch는 전략 자산을 변동성이 낮은 자산으로 회수하도록 설계했습니다.${formatAIRuntimeResult(data.validation, data.runtime)}${formatAIReasoningTrace(data.reasoning)}`,
          },
        ]);

        if (options?.switchToEasy) {
          setMainView("easy");
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI 안전 구조 생성 실패";
        setAgentActivities((prev) => [
          ...prev,
          {
            id: "ai-safety-scaffold-failed",
            status: "error",
            stage: "ai-safety-scaffold-failed",
            label: message,
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `AI 안전 구조 생성에 실패해서 로컬 기본 안전 구조로 보강합니다: ${message}`,
          },
        ]);
        return false;
      } finally {
        agentAbortControllerRef.current = null;
        setIsAgentRunning(false);
        setIsRegeneratingEasyView(false);
      }
    },
    [activeSnapshot?.name, connectedExchangeCount, easyViewModel, isAgentRunning],
  );

  const handleCancelAdvancedToEasySafetyPrompt = useCallback(() => {
    setPendingAdvancedToEasyRegeneration(null);
    switchToEasyAfterAdvancedSaveRef.current = false;
  }, []);

  const handleConfirmAdvancedToEasySafetyPrompt = useCallback(async () => {
    const pending = pendingAdvancedToEasyRegeneration;
    if (!pending) return;
    setPendingAdvancedToEasyRegeneration(null);
    switchToEasyAfterAdvancedSaveRef.current = false;
    const aiHandled = await runAISafetyScaffoldFromAdvancedGraph(pending.graph, pending.issues, pending.options);
    if (aiHandled) return;
    const graphWithSafetyScaffold = addCapitalSafetyScaffold(pending.graph, pending.issues);
    if (graphWithSafetyScaffold !== pending.graph && historyStore.getActiveId()) {
      historyStore.updateActiveSnapshot(graphWithSafetyScaffold.nodes, graphWithSafetyScaffold.edges);
    }
    regenerateEasyViewFromAdvancedGraph(graphWithSafetyScaffold, {
      ...pending.options,
      bypassSafetyPrompt: true,
    });
  }, [
    pendingAdvancedToEasyRegeneration,
    regenerateEasyViewFromAdvancedGraph,
    runAISafetyScaffoldFromAdvancedGraph,
  ]);

  const handleCheckoutTemplate = useCallback(
    (snapshotId: string) => {
      const snapshot = snapshots.find((item) => item.id === snapshotId);
      if (!snapshot) return;

      const graph: AdvancedGraphModel = {
        nodes: snapshot.nodes as AdvancedGraphModel["nodes"],
        edges: snapshot.edges as AdvancedGraphModel["edges"],
      };

      historyStore.setActiveId(snapshotId);

      if (graph.nodes.length > 0) {
        const nextSignature = createAdvancedGraphSignature(graph);
        const restored =
          nextSignature === lastSyncedAdvancedGraphSignature
            ? syncEasyViewParamsFromAdvancedGraph(graph, {
                strategyName: snapshot.name,
                silent: true,
              })
            : regenerateEasyViewFromAdvancedGraph(graph, {
                strategyName: snapshot.name,
              });

        if (!restored) {
          setAdvancedGraphModel(graph);
          setAdvancedGraphVersion((version) => version + 1);
        }
      } else {
        setAdvancedGraphModel(graph);
        setAdvancedGraphVersion((version) => version + 1);
      }

      setActiveWorkspace("create");
      setMainView("advanced");
    },
    [
      lastSyncedAdvancedGraphSignature,
      regenerateEasyViewFromAdvancedGraph,
      snapshots,
      syncEasyViewParamsFromAdvancedGraph,
    ],
  );

  useEffect(() => {
    const handleHistorySnapshotSaved = (event: Event) => {
      const snapshot = (event as CustomEvent<HistorySnapshot>).detail;
      if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) return;

      const graph: AdvancedGraphModel = {
        nodes: snapshot.nodes as AdvancedGraphModel["nodes"],
        edges: snapshot.edges as AdvancedGraphModel["edges"],
      };
      const shouldSwitchToEasy = switchToEasyAfterAdvancedSaveRef.current;
      switchToEasyAfterAdvancedSaveRef.current = false;
      const nextSignature = createAdvancedGraphSignature(graph);
      if (nextSignature === lastSyncedAdvancedGraphSignature) {
        syncEasyViewParamsFromAdvancedGraph(graph, {
          strategyName: snapshot.name,
          switchToEasy: shouldSwitchToEasy,
        });
        return;
      }

      regenerateEasyViewFromAdvancedGraph(graph, {
        strategyName: snapshot.name,
        switchToEasy: shouldSwitchToEasy,
        source: "save",
      });
    };

    window.addEventListener("historySnapshotSaved", handleHistorySnapshotSaved);
    return () => window.removeEventListener("historySnapshotSaved", handleHistorySnapshotSaved);
  }, [lastSyncedAdvancedGraphSignature, regenerateEasyViewFromAdvancedGraph, syncEasyViewParamsFromAdvancedGraph]);

  const clearTemplatePanelCloseTimer = () => {
    if (!templatePanelCloseTimer.current) return;
    window.clearTimeout(templatePanelCloseTimer.current);
    templatePanelCloseTimer.current = null;
  };

  const openTemplatePanel = () => {
    clearTemplatePanelCloseTimer();
    setIsTemplatePanelOpen(true);
  };

  const scheduleTemplatePanelClose = () => {
    clearTemplatePanelCloseTimer();
    templatePanelCloseTimer.current = window.setTimeout(() => {
      setIsTemplatePanelOpen(false);
      templatePanelCloseTimer.current = null;
    }, 500);
  };

  const handleGuideNext = () => {
    setGuideDone((prev) => new Set([...prev, guideStep]));
    if (guideStep >= GUIDE_ITEMS.length - 1) {
      window.localStorage.setItem("thirdeye-guide-dismissed", "1");
      setIsGuideOpen(false);
      return;
    }
    setGuideStep((current) => Math.min(current + 1, GUIDE_ITEMS.length - 1));
  };

  const handleCloseGuide = () => {
    window.localStorage.setItem("thirdeye-guide-dismissed", "1");
    setIsGuideOpen(false);
  };

  const runRemoteAgentPrompt = async (prompt: string, visiblePrompt = prompt) => {
    if (!prompt || isAgentRunning) return;

    setAgentMessages((prev) => [...prev, { role: "user", text: visiblePrompt }]);
    setAgentPrompt("");
    const initialActivity: AgentActivity = {
      id: "request-queued",
      status: "running",
      stage: "queued",
      label: "요청 접수",
      timestamp: new Date().toISOString(),
    };
    setAgentActivities([initialActivity]);
    setAgentSteps([initialActivity.label]);
    setIsAgentRunning(true);
    const controller = new AbortController();
    agentAbortControllerRef.current = controller;

    try {
      if (connectedExchangeCount === 0) {
        throw new Error("전략 생성 전에 거래소 연결 탭에서 유효한 REST API URL 또는 RPC URL을 하나 이상 저장해야 합니다.");
      }

      const appendAgentActivity = (rawActivity: unknown) => {
        const activity = normalizeAgentActivities([rawActivity])[0];
        if (!activity) return;
        setAgentActivities((prev) => {
          const next = [...prev.filter((item) => item.id !== activity.id), activity].slice(-60);
          setAgentSteps(agentStepsFromActivities(next));
          return next;
        });
      };

      const response = await fetch("/api/ai/strategy-draft-stream", {
        method: "POST",
        headers: withUserContextHeaders({ "Content-Type": "application/json" }),
        signal: controller.signal,
        body: JSON.stringify(withUserContextPayload({
          prompt,
          current_strategy: {
            code: generatedCode,
            easy_view: {
              title: easyViewModel.title,
              summary: easyViewModel.summary,
              nodes: easyViewModel.nodes.map((node) => ({
                id: node.id,
                title: node.title,
                kind: node.kind,
              })),
            },
          },
        })),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          `${String(errorData?.message || errorData?.error || `AI API 요청 실패 (${response.status})`)}${formatAILogicErrorLog(errorData?.logicErrorLog)}`,
        );
      }
      if (!response.body) {
        throw new Error("AI 에이전트 진행 스트림을 열 수 없습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: any = null;
      let streamError = "";

      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const parsed = parseAgentEventBuffer(buffer);
          buffer = parsed.remainder;
          for (const item of parsed.events) {
            if (item.event === "progress" || item.event === "done") {
              appendAgentActivity(item.data);
            } else if (item.event === "result") {
              data = item.data;
            } else if (item.event === "error") {
              const payload = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {};
              streamError = `${typeof payload.message === "string" ? payload.message : "AI 에이전트 스트림 오류"}${formatAILogicErrorLog(payload.logicErrorLog)}`;
              appendAgentActivity(item.data);
            }
          }
        }
        if (done) break;
      }

      if (buffer.trim()) {
        for (const item of parseAgentEventBuffer(`${buffer}\n\n`).events) {
          if (item.event === "progress" || item.event === "done") appendAgentActivity(item.data);
          if (item.event === "result") data = item.data;
          if (item.event === "error") {
            const payload = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {};
            streamError = `${typeof payload.message === "string" ? payload.message : "AI 에이전트 스트림 오류"}${formatAILogicErrorLog(payload.logicErrorLog)}`;
            appendAgentActivity(item.data);
          }
        }
      }

      if (streamError) {
        throw new Error(streamError);
      }
      if (!data?.strategy?.blocks || !data?.strategy?.connections) {
        throw new Error("AI 응답에 strategy graph가 없습니다.");
      }

      appendAgentActivity({
        status: "running",
        stage: "frontend-materialize",
        label: "프론트 그래프와 쉬운 보기 반영",
        timestamp: new Date().toISOString(),
      });
      const result = runEasyViewGraphAgentLoop(data.strategy, prompt);
      const advancedGraph = result.advancedGraph;
      if (!advancedGraph || advancedGraph.nodes.length === 0) {
        throw new Error("고급 전략 그래프가 완성되지 않았습니다.");
      }
      setGeneratedCode(result.code);
      setProgramCode(extractRuntimeProgramCode(data.runtime));
      setEasyViewModel(result.easyView);
      setAdvancedGraphModel(advancedGraph);
      setAdvancedGraphVersion((version) => version + 1);
      setLastSyncedAdvancedGraphSignature(createAdvancedGraphSignature(advancedGraph));
      setAgentSteps(result.steps);
      setAiSummary(`AI 요약: ${result.easyView.summary}`);
      setGuideDone((prev) => new Set([...prev, 1]));
      setMainView("easy");

      // Advanced View 업데이트
      if (!historyStore.getActiveId()) {
        historyStore.createEmptyStrategy(null, result.easyView.title);
      } else {
        historyStore.updateSnapshotName(historyStore.getActiveId()!, result.easyView.title);
      }
      historyStore.updateActiveSnapshot(advancedGraph.nodes, advancedGraph.edges);
      window.dispatchEvent(
        new CustomEvent("loadSnapshot", {
          detail: {
            nodes: advancedGraph.nodes,
            edges: advancedGraph.edges,
          },
        })
      );
      window.dispatchEvent(new CustomEvent("runAutoLayout"));

      setAgentMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: `${data.message || "AI strategy draft generated"}\nprovider: ${data.providers?.strategy || data.providers?.orchestrator || "unknown"} / model: ${data.model || data.models?.strategy || "unknown"}\n\n${result.easyView.title} 전략 그래프를 생성했습니다.\n고급 보기 노드 ${advancedGraph.nodes.filter((node) => node.type !== "groupNode").length}개 / 간선 ${advancedGraph.edges.length}개를 로드했습니다.${formatAIRuntimeResult(data.validation, data.runtime)}${formatAIReasoningTrace(data.reasoning)}`,
        },
      ]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setAgentActivities((prev) => [
          ...prev,
          {
            id: `cancelled-${Date.now()}`,
            status: "error",
            stage: "cancelled",
            label: "사용자가 전략 생성을 중단했습니다.",
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: "전략 생성 요청을 중단했습니다.",
          },
        ]);
        return;
      }
      const message = error instanceof Error ? error.message : "전략 생성 중 오류가 발생했습니다.";
      const isTimeout = /timeout|timed out|aborted/i.test(message);
      const isExchangeSetupError = /거래소 연결|REST API URL|RPC URL|API\/RPC/.test(message);
      setAgentMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: isExchangeSetupError
            ? `AI 에이전트를 실행하지 않았습니다: ${message}\n\nWebSocket/WSS 시세 URL만으로는 부족합니다. 거래소 연결 탭에서 실행 가능한 REST API URL 또는 RPC URL을 저장해야 합니다.`
            : isTimeout
              ? `AI 에이전트 응답 실패: ${message}\n\n요청 시간이 길어져 중단되었습니다. 서버의 DEEPSEEK_TIMEOUT_SEC 또는 AI_STRATEGY_DEEPSEEK_TIMEOUT_SEC 값을 늘린 뒤 다시 시도하세요. 로컬 데모로 대체하지 않았습니다.`
              : `AI 에이전트 응답 실패: ${message}\n\n로컬 데모로 대체하지 않았습니다. 서버의 AI_PROVIDER, API 키, provider 응답 상태를 확인하세요.`,
        },
      ]);
    } finally {
      agentAbortControllerRef.current = null;
      setIsAgentRunning(false);
    }
  };

  const handleTemplateSelect = async (template: StrategyTemplate) => {
    await runRemoteAgentPrompt(template.prompt, `추천 템플릿: ${template.title}\n${template.prompt}`);
  };

  const handleAgentPromptSubmit = async () => {
    await runRemoteAgentPrompt(agentPrompt.trim());
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-950">
      <aside className="hidden w-[164px] shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[52px] items-center gap-2 border-b border-slate-200 px-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-orange-300 bg-orange-50">
            <Zap className="h-5 w-5 text-orange-600" />
            <span className="absolute inset-1 rounded-full border border-red-500/50" />
          </div>
          <div className="min-w-0 text-lg font-black tracking-tight">ThirdEye</div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const workspaceId = isWorkspaceNavId(item.id) ? item.id : null;
            const isInteractive = Boolean(workspaceId);
            const isActive = workspaceId === activeWorkspace;
            return (
              <button
                key={item.id}
                type="button"
                onClick={workspaceId ? () => setActiveWorkspace(workspaceId) : undefined}
                title={isInteractive ? undefined : "준비 중"}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-100",
                  !isInteractive && "cursor-default opacity-55 hover:bg-transparent",
                  isActive && "bg-violet-600 text-white shadow-sm hover:bg-violet-600",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {!isInteractive ? (
                  <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                    soon
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-slate-200 p-2.5">
          <section className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="mb-2 text-xs font-bold text-slate-700">거래소 연결</div>
            <div className="mb-2 grid grid-cols-2 gap-1">
              {exchangeConnections.map((exchange) => (
                <button
                  key={exchange.id}
                  type="button"
                  onClick={() => setExchangeTab(exchange.id)}
                  className={cn(
                    "rounded-md border px-1.5 py-1 text-[10px] font-bold capitalize",
                    exchangeTab === exchange.id
                      ? "border-violet-300 bg-violet-50 text-violet-700"
                      : "border-slate-200 text-slate-500",
                  )}
                >
                  {exchange.id}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Coins className="h-6 w-6 rounded-md bg-amber-100 p-1 text-amber-600" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">
                  {selectedExchange?.name ?? "거래소 연결 필요"}
                  {connectedExchangeCount > 0 ? ` (${connectedExchangeCount})` : ""}
                </div>
                <div className={cn("text-[11px] font-semibold", selectedExchange?.status === "연결됨" ? "text-emerald-600" : "text-slate-500")}>
                  ● {selectedExchange?.status ?? "대기"}
                </div>
              </div>
            </div>
            {selectedExchange?.rpcUrl || selectedExchange?.apiUrl || selectedExchange?.wsUrl ? (
              <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                API/RPC URL 저장됨
              </div>
            ) : null}
            <button
              type="button"
              onClick={openUserSettings}
              className="mt-2 flex w-full items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2 py-2 text-left transition-colors hover:bg-violet-100"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-black text-white">
                {isPersonalLoggedIn ? clientUserName.slice(0, 1).toUpperCase() : "G"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold text-violet-700">유저 설정</div>
                <div className="truncate text-[11px] font-black text-violet-950">
                  {isPersonalLoggedIn ? clientUserName : "Guest"}
                </div>
                <div className="mt-0.5 text-[9px] font-semibold text-violet-500">
                  {isPersonalLoggedIn ? "내 거래소 연결 사용 중" : "설정하면 개인 연결로 저장"}
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-500" />
            </button>
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              className="mt-2 h-8 w-full rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 hover:bg-white"
            >
              거래소 연결 관리
            </button>
          </section>

          <section className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-violet-800">
              <Sparkles className="h-4 w-4" />
              Plan
            </div>
            <div className="mb-2 grid grid-cols-3 gap-1">
              {(["free", "pro", "team"] as PlanTier[]).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setPlanTier(tier)}
                  className={cn(
                    "rounded-md border px-1 py-1 text-[10px] font-bold uppercase",
                    planTier === tier
                      ? "border-violet-400 bg-white text-violet-700"
                      : "border-violet-100 bg-violet-100/60 text-violet-400",
                  )}
                >
                  {tier}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-violet-700">만료일 2026-06-30</div>
            <button className="mt-2 h-8 w-full rounded-lg border border-violet-300 bg-white text-xs font-bold text-violet-700">
              플랜 관리
            </button>
          </section>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
          {isCreateWorkspace ? (
            <div className="flex min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
              {MAIN_VIEW_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleMainViewChange(tab.id)}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-bold",
                      mainView === tab.id ? "bg-violet-600 text-white shadow-sm" : "text-slate-600 hover:bg-white",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {activeWorkspace === "portfolio" ? "Portfolio" : "Strategy Library"}
              </div>
              <div className="truncate text-sm font-black text-slate-950">
                {activeWorkspace === "portfolio"
                  ? "거래소별 자산과 가용 자금을 추적합니다"
                  : "저장한 전략 템플릿을 Git 스타일로 관리합니다"}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              <Coins className="h-4 w-4 text-amber-600" />
              거래소
            </button>
            {isCreateWorkspace ? (
              <>
                <button
                  type="button"
                  onClick={handleAutoLayout}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Network className="h-4 w-4 text-violet-600" />
                  Auto Layout
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-violet-700"
                >
                  <Save className="h-4 w-4" />
                  저장
                </button>
              </>
            ) : activeWorkspace === "portfolio" ? (
              <button
                type="button"
                onClick={() => setIsExchangeLibraryOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
              >
                <Coins className="h-4 w-4 text-amber-300" />
                거래소 연결 관리
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Clock3 className="h-4 w-4 text-cyan-600" />
                  히스토리
                </button>
                <button
                  type="button"
                  onClick={handleCreateBranchDraft}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  브랜치
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplateVersion}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
                >
                  <Save className="h-4 w-4" />
                  버전 저장
                </button>
              </>
            )}
          </div>
        </header>

        <main
          className={cn(
            "grid min-h-0 flex-1 overflow-hidden",
            isCreateWorkspace ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_clamp(246px,20vw,320px)]" : "grid-cols-1",
          )}
        >
          <section className="flex min-w-0 flex-col overflow-hidden">
            {isCreateWorkspace ? (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-50">
              {mainView === "easy" ? (
                <EasyStrategyGraph model={easyViewModel} onSaveCurrentBlock={handleSaveCurrentEasyBlock} />
              ) : null}
              {false && mainView === "easy" ? (
                <div className="grid h-full grid-rows-[minmax(292px,1fr)_158px]">
                  <div className="relative overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle,#dbe3f0_1px,transparent_1px)] [background-size:18px_18px]">
                    <div className="absolute left-3 top-2 z-20 flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                      {MAIN_VIEW_TABS.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setMainView(tab.id)}
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold",
                              mainView === tab.id ? "bg-violet-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="relative h-full min-h-[292px] min-w-[800px]">
                      <svg className="pointer-events-none absolute left-0 top-0 h-full w-full" viewBox="0 0 800 340">
                        <defs>
                          <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L7,3 z" fill="#22c55e" />
                          </marker>
                          <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L7,3 z" fill="#3b82f6" />
                          </marker>
                          <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L7,3 z" fill="#ef4444" />
                          </marker>
                        </defs>
                        <path d="M146 116 C160 116 162 118 176 118" stroke="#22c55e" strokeWidth="3" fill="none" strokeDasharray="7 6" markerEnd="url(#arrow-green)" />
                        <path d="M280 118 C294 102 304 90 320 90" stroke="#22c55e" strokeWidth="3" fill="none" strokeDasharray="7 6" markerEnd="url(#arrow-green)" />
                        <path d="M474 90 C492 90 498 90 516 90" stroke="#3b82f6" strokeWidth="3" fill="none" markerEnd="url(#arrow-blue)" />
                        <path d="M594 120 C594 154 548 154 548 190" stroke="#3b82f6" strokeWidth="3" fill="none" strokeDasharray="7 6" markerEnd="url(#arrow-blue)" />
                        <path d="M398 120 C398 152 382 152 382 190" stroke="#3b82f6" strokeWidth="3" fill="none" strokeDasharray="7 6" markerEnd="url(#arrow-blue)" />
                        <path d="M498 220 L498 260" stroke="#ef4444" strokeWidth="3" fill="none" strokeDasharray="7 6" markerEnd="url(#arrow-red)" />
                        <path d="M516 296 C384 296 292 296 188 296" stroke="#ef4444" strokeWidth="3" fill="none" strokeDasharray="7 6" markerEnd="url(#arrow-red)" />
                      </svg>

                      <div className="absolute left-[40px] top-[58px] rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-black text-white">
                        시작
                      </div>
                      <div className="absolute left-[176px] top-[190px] rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                        조건 재충족
                      </div>
                      <div className="absolute left-[182px] top-[284px] rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
                        종료 완료
                      </div>

                      {STRATEGY_BLOCKS.map((block) => {
                        const Icon = block.icon;
                        const isSelected = selectedBlockId === block.id;
                        const isCompactBlock = block.kind === "condition" || block.kind === "risk";
                        return (
                          <button
                            key={block.id}
                            type="button"
                            onClick={() => {
                              setSelectedBlockId(block.id);
                              setDetailTab("params");
                            }}
                            className={cn(
                              "absolute rounded-lg border-2 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                              isCompactBlock ? "px-2 py-2" : "p-3",
                              !isSelected && block.kind === "condition" && "border-emerald-300 bg-emerald-50",
                              !isSelected && block.kind === "risk" && "border-rose-300 bg-rose-50",
                              !isSelected && block.kind !== "condition" && block.kind !== "risk" && "border-slate-200",
                              isSelected && "border-violet-500 ring-4 ring-violet-100",
                            )}
                            style={{ left: block.x, top: block.y, width: block.w }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                {!isCompactBlock ? (
                                  <Icon
                                    className={cn(
                                      "h-5 w-5",
                                      block.color === "rose" && "text-rose-500",
                                      block.color === "emerald" && "text-emerald-500",
                                      block.color === "violet" && "text-violet-500",
                                      block.color === "blue" && "text-blue-500",
                                      block.color === "sky" && "text-sky-500",
                                    )}
                                  />
                                ) : null}
                                <div className="min-w-0">
                                  <div className={cn("truncate font-black text-slate-900", isCompactBlock ? "text-[11px]" : "text-xs")}>{block.title}</div>
                                  <div className="truncate text-[11px] text-slate-500">{block.subtitle}</div>
                                </div>
                              </div>
                              {!isCompactBlock ? (
                                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">{block.index}</span>
                              ) : null}
                            </div>
                            {!isCompactBlock ? (
                              <div className="mt-2 flex items-center justify-between">
                                <StatusBadge status={block.status} />
                                <span className="text-[10px] font-bold text-violet-600">블록 보기</span>
                              </div>
                            ) : null}
                          </button>
                        );
                      })}

                      <div className="absolute right-4 top-[92px] flex w-[116px] flex-col gap-2">
                        {[
                          { label: "백테스트", icon: BarChart3, tone: "violet" },
                          { label: "튜닝하기", icon: SlidersHorizontal, tone: "violet" },
                          { label: "드라이런", icon: PlayCircle, tone: "cyan" },
                          { label: "실전 실행", icon: Rocket, tone: "emerald" },
                        ].map((action) => {
                          const Icon = action.icon;
                          return (
                            <button
                              key={action.label}
                              type="button"
                              className={cn(
                                "inline-flex h-10 items-center justify-center gap-2 rounded-lg border bg-white text-sm font-bold shadow-sm",
                                action.tone === "violet" && "border-violet-300 text-violet-700",
                                action.tone === "cyan" && "border-cyan-300 text-cyan-700",
                                action.tone === "emerald" && "border-emerald-300 text-emerald-700",
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid min-h-0 grid-cols-[184px_minmax(0,1fr)] bg-white">
                    <div className="border-r border-slate-200 p-2.5">
                      <div className="mb-2 text-xs font-bold text-slate-600">선택한 단계</div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                        <div className="flex items-center justify-between">
                          <SelectedBlockIcon className="h-5 w-5 text-blue-600" />
                          <span className="rounded-full bg-white px-1.5 text-[10px] font-bold text-slate-500">{selectedBlock.index}</span>
                        </div>
                        <div className="mt-2 text-sm font-black text-slate-900">{selectedBlock.title}</div>
                        <p className="mt-1 max-h-[34px] overflow-hidden text-xs leading-[17px] text-slate-600">{selectedBlock.description}</p>
                        <button className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-violet-700">
                          단계 변경 <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
                        <div className="flex gap-1">
                          {[
                            { id: "overview", label: "개요" },
                            { id: "params", label: "파라미터" },
                            { id: "risk", label: "리스크" },
                            { id: "code", label: "코드" },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setDetailTab(tab.id as DetailTab)}
                              className={cn(
                                "h-8 rounded-md px-3 text-xs font-bold",
                                detailTab === tab.id ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50",
                              )}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                        <button className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600">
                          <RotateCcw className="h-3.5 w-3.5" />
                          초기화
                        </button>
                      </div>

                      <div className="h-[118px] overflow-auto p-3">
                        {detailTab === "overview" ? (
                          <div className="grid h-full grid-cols-3 gap-3">
                            <div className="rounded-lg border border-slate-200 p-3">
                              <div className="text-xs font-bold text-slate-500">요약</div>
                              <p className="mt-2 text-sm leading-6 text-slate-700">{selectedBlock.description}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 p-3">
                              <div className="text-xs font-bold text-slate-500">상태</div>
                              <div className="mt-3"><StatusBadge status={selectedBlock.status} /></div>
                            </div>
                            <div className="rounded-lg border border-slate-200 p-3">
                              <div className="text-xs font-bold text-slate-500">AI 요약</div>
                              <p className="mt-2 max-h-[60px] overflow-hidden text-xs leading-5 text-slate-600">{aiSummary}</p>
                            </div>
                          </div>
                        ) : null}

                        {detailTab === "params" ? (
                          <div className="grid grid-cols-5 gap-3">
                            {selectedBlock.params.map((param) => {
                              const key = `${selectedBlock.id}:${param.key}`;
                              return (
                                <label key={param.key} className="block">
                                  <div className="mb-1 text-xs font-bold text-slate-700">{param.label}</div>
                                  {param.options ? (
                                    <select
                                      value={paramValues[key] ?? param.value}
                                      onChange={(event) =>
                                        setParamValues((prev) => ({ ...prev, [key]: event.target.value }))
                                      }
                                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold outline-none focus:border-violet-300"
                                    >
                                      {param.options.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div className="flex h-10 rounded-lg border border-slate-200 bg-white">
                                      <input
                                        value={paramValues[key] ?? param.value}
                                        onChange={(event) =>
                                          setParamValues((prev) => ({ ...prev, [key]: event.target.value }))
                                        }
                                        className="min-w-0 flex-1 rounded-l-lg px-2 text-sm font-semibold outline-none focus:ring-1 focus:ring-violet-300"
                                      />
                                      {param.unit ? (
                                        <span className="inline-flex items-center border-l border-slate-200 px-2 text-xs font-bold text-slate-400">
                                          {param.unit}
                                        </span>
                                      ) : null}
                                    </div>
                                  )}
                                  <div className="mt-1 truncate text-[11px] text-slate-500">{param.helper}</div>
                                </label>
                              );
                            })}
                          </div>
                        ) : null}

                        {detailTab === "risk" ? (
                          <div className="grid grid-cols-4 gap-3">
                            {[
                              ["최대 손실", "-1.00%"],
                              ["주문 지연", "800ms"],
                              ["노출 한도", "1,000 USDT"],
                              ["알림", "Slack + Push"],
                            ].map(([label, value]) => (
                              <div key={label} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                                <div className="text-xs font-bold text-rose-700">{label}</div>
                                <div className="mt-2 text-lg font-black text-slate-900">{value}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {detailTab === "code" ? (
                          <pre className="h-full overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-emerald-200">
                            {STRATEGY_CODE}
                          </pre>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {mainView === "advanced" ? (
                <div className="h-full">
                  <NodeEditor
                    initialGraph={advancedGraphModel}
                    initialGraphVersion={advancedGraphVersion}
                    programCode={programCode}
                  />
                  {openTabs.length === 0 ? (
                    <div className="pointer-events-none absolute inset-x-[180px] top-[210px] z-20 flex justify-center">
                      <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-center text-sm shadow-lg">
                        <div className="font-bold text-slate-900">열려 있는 전략 탭이 없습니다</div>
                        <button
                          onClick={() => historyStore.createEmptyStrategy(null)}
                          className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white"
                        >
                          빈 전략 시작
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {mainView === "code" ? (
                <div className="h-full overflow-auto bg-slate-950 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                      <FileCode2 className="h-4 w-4 text-emerald-400" />
                      {codeViewTitle}
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black", programCode ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
                        {codeViewStatus}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void generateRuntimeProgramCode({ force: true })}
                      disabled={!generatedStrategyGraph || isGeneratingProgramCode}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isGeneratingProgramCode ? "생성 중" : "Hershy Go 생성"}
                    </button>
                  </div>
                  {programCodeError ? (
                    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
                      {programCodeError}
                    </div>
                  ) : null}
                  <pre className="rounded-lg border border-slate-800 bg-black/40 p-4 text-sm leading-7 text-emerald-200">
                    {codeViewContent}
                  </pre>
                </div>
              ) : null}
              </div>
            ) : activeWorkspace === "portfolio" ? (
              <PortfolioWorkspace
                exchangeConnections={exchangeConnections}
                marketRows={marketRows}
                strategyCount={snapshots.length}
                onManageExchanges={() => setIsExchangeLibraryOpen(true)}
              />
            ) : (
              <StrategyLibraryWorkspace
                snapshots={snapshots}
                activeSnapshot={activeSnapshot}
                openTabs={openTabs}
                programCode={programCode}
                onOpenHistory={() => setIsHistoryOpen(true)}
                onCreateTemplate={handleCreateTemplateDraft}
                onCreateBranch={handleCreateBranchDraft}
                onSaveVersion={handleSaveTemplateVersion}
                onCheckoutTemplate={handleCheckoutTemplate}
              />
            )}
          </section>

          {isCreateWorkspace ? (
            <PageRightRail
              marketUpdatedAt={marketUpdatedAt}
              marketWarning={marketWarning}
              marketRows={marketRows}
              easyViewModel={easyViewModel}
              aiSummary={aiSummary}
              activeSnapshot={activeSnapshot}
              isSummarizing={isSummarizing}
              onAiSummary={handleAiSummary}
              isAgentRunning={isAgentRunning}
              onCancelAgentRun={handleCancelAgentRun}
              connectedExchangeCount={connectedExchangeCount}
              visibleAgentActivities={visibleAgentActivities}
              programCode={programCode}
              guideItems={GUIDE_ITEMS}
              guideDone={guideDone}
              onOpenGuide={() => setIsGuideOpen(true)}
              onSelectGuideStep={(index) => {
                setGuideStep(index);
                setIsGuideOpen(true);
              }}
            />
          ) : null}
        </main>
      </div>

      <ExchangeLibraryModal
        isOpen={isExchangeLibraryOpen}
        exchangeConnections={exchangeConnections}
        exchangeConnectionNames={EXCHANGE_CONNECTION_NAMES}
        selectedExchangeId={selectedExchange?.id}
        selectedExchangeName={selectedExchangeName}
        selectedExchangeCredentials={selectedExchangeCredentials}
        isSelectedExchangePolymarket={isSelectedExchangePolymarket}
        isSelectedExchangeOKX={isSelectedExchangeOKX}
        isSelectedExchangeBinance={isSelectedExchangeBinance}
        canTestBinanceAuth={canTestBinanceAuth}
        hasPendingBinanceCredentialInput={hasPendingBinanceCredentialInput}
        exchangeForm={exchangeForm}
        setExchangeForm={setExchangeForm}
        exchangeFormError={exchangeFormError}
        exchangeAuthMessage={exchangeAuthMessage}
        isTestingExchangeAuth={isTestingExchangeAuth}
        isSavingExchange={isSavingExchange}
        hasExchangeExecutionUrl={hasExchangeExecutionUrl}
        onSelectExchange={(exchange) => {
          setExchangeTab(exchange.id);
          setExchangeForm(buildExchangeFormFromConnection(exchange));
          setExchangeAuthMessage("");
        }}
        onTestBinanceAuth={testBinanceAuth}
        onSaveExchangeConnection={saveExchangeConnection}
        onClose={() => setIsExchangeLibraryOpen(false)}
      />

      {isUserSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-violet-600">User Settings</div>
                <h2 className="mt-1 text-xl font-black text-slate-950">유저 설정</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  거래소 연결과 AI 전략 컨텍스트를 이 사용자 기준으로 저장합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUserSettingsOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handlePersonalLogin} className="px-5 py-4">
              <label className="text-xs font-black text-slate-700" htmlFor="user-display-name">
                표시 이름 또는 이메일
              </label>
              <input
                id="user-display-name"
                value={loginInput}
                onChange={(event) => {
                  setLoginInput(event.target.value);
                  setLoginError("");
                }}
                placeholder="예: minsu 또는 minsu@example.com"
                className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-violet-400 focus:bg-white"
              />
              {loginError ? <div className="mt-2 text-xs font-semibold text-rose-600">{loginError}</div> : null}

              <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 px-3 py-3">
                <div className="text-xs font-black text-violet-950">
                  현재 사용자: {isPersonalLoggedIn ? clientUserName : "Guest"}
                </div>
                <p className="mt-1 text-xs leading-5 text-violet-700">
                  내부 세션 ID는 숨깁니다. 설정한 사용자 이름만 기준으로 연결 정보와 AI 컨텍스트를 분리합니다.
                </p>
              </div>

              <div className="mt-5 flex items-center justify-between gap-2">
                {isPersonalLoggedIn ? (
                  <button
                    type="button"
                    onClick={handlePersonalLogout}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
                  >
                    로그아웃
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsUserSettingsOpen(false)}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="h-9 rounded-lg bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-700"
                  >
                    저장
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isGuideOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-violet-600">
                  시작 가이드 {guideStep + 1} / {GUIDE_ITEMS.length}
                </div>
                <h2 className="mt-1 text-xl font-black text-slate-950">{GUIDE_ITEMS[guideStep]}</h2>
                <div className="mt-1 text-[11px] font-semibold text-slate-500">
                  완료 {guideProgress} / {GUIDE_ITEMS.length}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseGuide}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="튜토리얼 닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-violet-700 shadow-sm">
                  {guideStep === 0 ? <WalletCards className="h-5 w-5" /> : null}
                  {guideStep === 1 ? <Sparkles className="h-5 w-5" /> : null}
                  {guideStep === 2 ? <BarChart3 className="h-5 w-5" /> : null}
                  {guideStep === 3 ? <PlayCircle className="h-5 w-5" /> : null}
                </div>
                <p className="text-sm leading-6 text-violet-950">
                  {guideStep === 0
                    ? "좌측 거래소 연결 탭에서 API 권한을 확인하세요. 읽기/거래 권한 상태가 연결됨으로 표시되면 전략을 만들 수 있습니다."
                    : null}
                  {guideStep === 1
                    ? "우측 하단 AI 전략 템플릿에서 추천 전략을 고르거나 입력 탭에 원하는 전략을 말로 적어 쉬운 보기 블록을 생성하세요."
                    : null}
                  {guideStep === 2
                    ? "쉬운 보기의 백테스트 버튼으로 조건과 파라미터가 과거 데이터에서 어떻게 작동하는지 확인합니다."
                    : null}
                  {guideStep === 3
                    ? "드라이런으로 소액 또는 모의 주문을 먼저 실행한 뒤, 실전 실행으로 전환하세요."
                    : null}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2">
                {GUIDE_ITEMS.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setGuideStep(index)}
                    className={cn(
                      "h-2 flex-1 rounded-full",
                      index <= guideStep ? "bg-violet-600" : "bg-slate-200",
                    )}
                    title={item}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={handleCloseGuide}
                className="text-sm font-bold text-slate-500 hover:text-slate-800"
              >
                다시 보지 않기
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGuideStep((current) => Math.max(0, current - 1))}
                  disabled={guideStep === 0}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={handleGuideNext}
                  className="h-9 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700"
                >
                  {guideStep === GUIDE_ITEMS.length - 1 ? "완료" : "다음"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isCreateWorkspace ? (
        <div
          className="fixed bottom-5 right-5 z-50"
          onMouseEnter={openTemplatePanel}
          onMouseLeave={scheduleTemplatePanelClose}
          onFocus={openTemplatePanel}
          onBlur={scheduleTemplatePanelClose}
        >
        <div
          className={cn(
            "absolute bottom-14 right-0 translate-y-2 opacity-0 transition-all duration-200",
            isTemplatePanelOpen
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none",
            templatePanelMode === "expanded" ? "w-[520px]" : "w-[440px]",
          )}
        >
          <section className="rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-violet-600">
                  AI 전략 템플릿
                </div>
                <div className="text-sm font-black text-slate-950">
                  빠른 추천과 직접 입력
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setTemplatePanelMode((mode) => (mode === "compact" ? "expanded" : "compact"))
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  {templatePanelMode === "compact" ? "확장" : "간소화"}
                </button>
              </div>
            </div>

            <div className="p-3">
              <div className="mb-3">
                <div className="mb-2 text-xs font-black text-slate-700">빠른 추천</div>
                <div
                  className={cn(
                    "grid gap-2",
                    templatePanelMode === "expanded" ? "grid-cols-2" : "grid-cols-3",
                  )}
                >
                  {(templatePanelMode === "compact" ? AI_STRATEGY_TEMPLATES.slice(0, 3) : AI_STRATEGY_TEMPLATES).map(
                    (template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => handleTemplateSelect(template)}
                        className={cn(
                          "rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-violet-300 hover:bg-violet-50",
                          templatePanelMode === "compact" && "px-2 py-2",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-black text-slate-900">{template.title}</div>
                            {templatePanelMode === "expanded" ? (
                              <p className="mt-1 text-xs leading-5 text-slate-600">{template.summary}</p>
                            ) : (
                              <div className="mt-1 truncate text-[10px] text-slate-500">{template.tags.join(" · ")}</div>
                            )}
                          </div>
                          {templatePanelMode === "expanded" ? (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          ) : null}
                        </div>
                        {templatePanelMode === "expanded" ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {template.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="mb-3 max-h-44 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                {agentMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={cn(
                      "whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-5",
                      message.role === "user" ? "ml-8 bg-violet-600 text-white" : "mr-8 bg-white text-slate-700",
                    )}
                  >
                    {message.text}
                  </div>
                ))}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAgentPromptSubmit();
                }}
                className="space-y-2"
              >
                <textarea
                  value={agentPrompt}
                  onChange={(event) => setAgentPrompt(event.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-violet-300"
                  placeholder="예) BTC 20MA 돌파와 거래량 증가를 기준으로 진입하고, 1.2% 트레일링 스톱을 넣어줘"
                />
                <button
                  type="submit"
                  disabled={!agentPrompt.trim() || isAgentRunning}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {isAgentRunning ? "에이전트 생성 중" : "에이전트에게 보내기"}
                </button>
                {isAgentRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelAgentRun}
                    className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-violet-200 bg-white text-sm font-bold text-violet-700 transition-colors hover:bg-violet-50"
                  >
                    현재 생성 중단
                  </button>
                ) : null}
              </form>
            </div>
          </section>
        </div>

          <button
            type="button"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-violet-600 px-5 text-sm font-black text-white shadow-xl shadow-violet-600/25 transition-transform hover:scale-[1.03]"
          >
            <Sparkles className="h-4 w-4" />
            {isAgentRunning ? "전략 생성 중" : "AI 전략 템플릿"}
          </button>
        </div>
      ) : null}

      {isAdvancedSyncPromptOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 px-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="text-sm font-black text-slate-950">고급 보기 수정본을 저장할까요?</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                고급 보기의 노드/간선 구조가 쉬운 보기와 달라졌습니다. 저장하면 현재 고급 보기 그래프를 기준으로 쉬운 보기를 다시 생성합니다.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4">
              <button
                type="button"
                onClick={() => setIsAdvancedSyncPromptOpen(false)}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSkipAdvancedSaveForEasyView}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                저장 없이 보기
              </button>
              <button
                type="button"
                onClick={handleConfirmAdvancedSaveForEasyView}
                disabled={isRegeneratingEasyView}
                className="h-9 rounded-lg bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRegeneratingEasyView ? "재생성 중" : "저장하고 재생성"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingAdvancedToEasyRegeneration ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/40 px-4">
          <section className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white shadow-2xl">
            <div className="border-b border-amber-100 bg-amber-50/80 px-5 py-4">
              <div className="text-sm font-black text-amber-950">Init / Kill switch를 자동으로 추가할까요?</div>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                AI가 전략 자금의 출발지와 종료 시 회수지를 보고, 변동성이 낮은 자산으로 안전하게 옮기는 흐름을 설계합니다.
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="grid gap-2">
                {pendingAdvancedToEasyRegeneration.issues.map((issue) => (
                  <div key={issue.id} className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
                    <div className="text-xs font-black text-amber-950">{issue.title}</div>
                    <p className="mt-1 text-xs leading-5 text-amber-800">{issue.description}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                우선순위는 USDC, USDT, DAI, USD, KRW 같은 현금성/스테이블 자산입니다. AI 생성이 실패하면 기존 로컬 규칙으로 최소 안전 구조를 보강합니다.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={handleCancelAdvancedToEasySafetyPrompt}
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                고급 보기로 돌아가기
              </button>
              <button
                type="button"
                onClick={handleConfirmAdvancedToEasySafetyPrompt}
                disabled={isRegeneratingEasyView || isAgentRunning}
                className="h-9 rounded-lg bg-amber-600 px-4 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRegeneratingEasyView || isAgentRunning ? "AI 설계 중" : "AI로 추가하고 치환"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <StrategyHistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </div>
  );
}
