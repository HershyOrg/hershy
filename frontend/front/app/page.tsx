"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlarmClock,
  BarChart3,
  Bell,
  Bot,
  Box,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Coins,
  Crosshair,
  ExternalLink,
  FileCode2,
  Folder,
  Globe2,
  Home as HomeIcon,
  KeyRound,
  LayoutDashboard,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  Network,
  PlayCircle,
  Plus,
  Redo2,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  WalletCards,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { NodeEditor } from "@/components/node-editor/NodeEditor";
import { StrategyHistoryModal } from "@/components/node-editor/StrategyHistoryModal";
import { EasyStrategyGraph } from "@/components/strategy-builder/EasyStrategyGraph";
import {
  DEFAULT_STRATEGY_TEMPLATES as AI_STRATEGY_TEMPLATES,
  advancedGraphToStrategyGraph,
  buildStrategyCodeFromTemplate,
  createEasyViewFromStrategyCode,
  runEasyViewGraphAgentLoop,
  strategyGraphToCode,
  type EasyViewModel,
  type EasyViewAgentResult,
  type StrategyTemplate,
} from "@/lib/easyViewAgent";
import { historyStore, type HistorySnapshot } from "@/lib/historyStore";
import { cn } from "@/lib/utils";

type MainView = "easy" | "advanced" | "code";
type DetailTab = "overview" | "params" | "risk" | "code";
type ExchangeTab = string;
type PlanTier = "free" | "pro" | "team";

type MarketRow = {
  symbol: string;
  price: string;
  change: string;
  tone: "up" | "down";
  icon: string;
  source?: string;
};

type ExchangeConnection = {
  id: string;
  name: string;
  type: "CEX" | "DEX" | "RPC";
  status: string;
  scopes: string[];
  color?: string;
  apiUrl?: string;
  restUrl?: string;
  wsUrl?: string;
  rpcUrl?: string;
  marketDataUrl?: string;
  credentials?: {
    hasApiKey?: boolean;
    hasApiSecret?: boolean;
    apiKeyLast4?: string;
    authStatus?: string;
    authMarket?: string;
    lastAuthCheckAt?: string;
    lastAuthError?: string;
  };
};

type AgentActivity = {
  id: string;
  timestamp?: string;
  status: string;
  stage: string;
  label: string;
  detail?: Record<string, unknown>;
};

type StrategyBlock = {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  description: string;
  status: "ready" | "watching" | "running" | "complete" | "blocked";
  kind: "start" | "condition" | "trade" | "hedge" | "rebalance" | "risk" | "exit";
  x: number;
  y: number;
  w: number;
  icon: typeof Rocket;
  color: string;
  params: Array<{
    key: string;
    label: string;
    value: string;
    unit?: string;
    helper: string;
    options?: string[];
  }>;
};

const NAV_ITEMS = [
  { id: "home", label: "홈", icon: HomeIcon },
  { id: "create", label: "전략 만들기", icon: Plus, active: true },
  { id: "library", label: "전략 라이브러리", icon: Boxes },
  { id: "workspace", label: "워크스페이스", icon: BriefcaseBusiness },
  { id: "tuning", label: "튜닝 / 백테스트", icon: Network },
  { id: "deploy", label: "실행 / 봇", icon: Bot },
  { id: "portfolio", label: "포트폴리오", icon: Folder },
  { id: "risk", label: "리스크 알림", icon: Bell },
  { id: "settings", label: "설정", icon: Settings },
];

const STRATEGY_BLOCKS: StrategyBlock[] = [
  {
    id: "init",
    index: 1,
    title: "전략 시작",
    subtitle: "Init",
    description: "거래소 연결과 기본 잔고를 확인하고 전략 실행 컨텍스트를 만듭니다.",
    status: "complete",
    kind: "start",
    x: 22,
    y: 86,
    w: 124,
    icon: Rocket,
    color: "violet",
    params: [
      { key: "capital", label: "초기 자본(USDT)", value: "10,000", helper: "전략이 사용할 기준 자본" },
      { key: "mode", label: "실행 모드", value: "드라이런", helper: "실전 실행 전 모의 주문으로 검증", options: ["드라이런", "실전"] },
    ],
  },
  {
    id: "condition",
    index: 2,
    title: "가격차 진입 조건 충족",
    subtitle: "Basis check",
    description: "현물과 선물 가격차가 설정한 기준 이상 벌어졌는지 감시합니다.",
    status: "running",
    kind: "condition",
    x: 176,
    y: 90,
    w: 104,
    icon: Crosshair,
    color: "emerald",
    params: [
      { key: "entryGap", label: "진입 가격차(%)", value: "0.50", unit: "%", helper: "이상 벌어지면 진입" },
      { key: "exitGap", label: "종료 가격차(%)", value: "0.10", unit: "%", helper: "이하로 줄어들면 종료" },
      { key: "confirm", label: "확인 캔들", value: "2", helper: "조건 유지 확인 개수" },
    ],
  },
  {
    id: "spot-buy",
    index: 3,
    title: "XRP 현물 매수",
    subtitle: "가격차 진입 조건 충족",
    description: "현물 XRP를 매수해 차익거래의 롱 포지션을 만듭니다.",
    status: "watching",
    kind: "trade",
    x: 320,
    y: 62,
    w: 154,
    icon: TrendingUp,
    color: "blue",
    params: [
      { key: "spotSize", label: "투입금(USDT)", value: "1,000", helper: "현물 매수 주문 금액" },
      { key: "spotSlippage", label: "슬리피지 허용", value: "0.08", unit: "%", helper: "시장가 체결 허용 범위" },
      { key: "orderType", label: "주문 방식", value: "Market", helper: "현물 주문 방식", options: ["Market", "Limit"] },
    ],
  },
  {
    id: "future-short",
    index: 4,
    title: "XRP 선물 숏",
    subtitle: "헤지 포지션 실행",
    description: "동일 규모의 선물 숏을 열어 가격 방향 리스크를 상쇄합니다.",
    status: "watching",
    kind: "hedge",
    x: 516,
    y: 62,
    w: 154,
    icon: TrendingDown,
    color: "sky",
    params: [
      { key: "leverage", label: "레버리지", value: "1x", helper: "선물 포지션 레버리지", options: ["1x", "2x", "3x"] },
      { key: "hedgeRatio", label: "헤지 비율", value: "100", unit: "%", helper: "현물 대비 선물 노출 비율" },
    ],
  },
  {
    id: "rebalance",
    index: 5,
    title: "포지션 유지",
    subtitle: "리밸런싱 및 유지",
    description: "가격차와 포지션 비중을 계속 감시하며 필요 시 재조정합니다.",
    status: "ready",
    kind: "rebalance",
    x: 382,
    y: 162,
    w: 166,
    icon: RotateCcw,
    color: "blue",
    params: [
      { key: "rebalanceGap", label: "리밸런싱 기준", value: "0.20", unit: "%", helper: "비중 차이가 커지면 조정" },
      { key: "checkInterval", label: "확인 주기", value: "1분", helper: "포지션 상태 점검 주기", options: ["10초", "1분", "5분"] },
    ],
  },
  {
    id: "risk",
    index: 6,
    title: "손실 제한 시 종료",
    subtitle: "Risk stop",
    description: "허용 손실을 넘으면 즉시 종료 단계로 넘깁니다.",
    status: "blocked",
    kind: "risk",
    x: 446,
    y: 232,
    w: 104,
    icon: ShieldAlert,
    color: "rose",
    params: [
      { key: "lossLimit", label: "손실 제한(%)", value: "1.00", unit: "%", helper: "총 손실 허용 한도" },
      { key: "maxLatency", label: "응답 지연 제한", value: "800", unit: "ms", helper: "거래소 응답 지연 제한" },
    ],
  },
  {
    id: "exit",
    index: 7,
    title: "종료",
    subtitle: "포지션 청산 및 종료",
    description: "현물과 선물 포지션을 동시에 닫고 손익을 기록합니다.",
    status: "ready",
    kind: "exit",
    x: 516,
    y: 268,
    w: 154,
    icon: CheckCircle2,
    color: "rose",
    params: [
      { key: "closeType", label: "청산 방식", value: "동시 청산", helper: "현물과 선물 종료 방식", options: ["동시 청산", "선물 우선", "현물 우선"] },
      { key: "report", label: "리포트 생성", value: "켜짐", helper: "실행 종료 후 요약 저장", options: ["켜짐", "꺼짐"] },
    ],
  },
];

const MARKET_ROWS: MarketRow[] = [
  { symbol: "BTCUSDT", price: "67,245.8", change: "+1.24%", tone: "up", icon: "₿" },
  { symbol: "ETHUSDT", price: "3,285.6", change: "+0.82%", tone: "up", icon: "Ξ" },
  { symbol: "XRPUSDT", price: "0.5321", change: "+0.45%", tone: "up", icon: "X" },
  { symbol: "XRPUSDT.P", price: "0.5303", change: "-0.05%", tone: "down", icon: "P" },
];

const EXCHANGE_CONNECTIONS: ExchangeConnection[] = [
  { id: "binance", name: "Binance", type: "CEX", status: "대기", scopes: ["Spot", "Futures", "Read"], color: "amber" },
  { id: "bybit", name: "Bybit", type: "CEX", status: "대기", scopes: ["Spot", "Perp", "Read"], color: "orange" },
  { id: "okx", name: "OKX", type: "CEX", status: "대기", scopes: ["Spot", "Swap", "Read"], color: "slate" },
  { id: "coinbase", name: "Coinbase", type: "CEX", status: "대기", scopes: ["Spot", "Read"], color: "blue" },
  { id: "kraken", name: "Kraken", type: "CEX", status: "대기", scopes: ["Spot", "Trade"], color: "violet" },
  { id: "kucoin", name: "KuCoin", type: "CEX", status: "대기", scopes: ["Spot", "Futures"], color: "emerald" },
  { id: "bitget", name: "Bitget", type: "CEX", status: "대기", scopes: ["Perp", "Copy"], color: "cyan" },
  { id: "gate", name: "Gate.io", type: "CEX", status: "대기", scopes: ["Spot", "Perp"], color: "rose" },
  { id: "hyperliquid", name: "Hyperliquid", type: "DEX", status: "대기", scopes: ["Perp", "Vault"], color: "emerald" },
  { id: "uniswap", name: "Uniswap", type: "DEX", status: "대기", scopes: ["Swap", "LP"], color: "pink" },
  { id: "pancake", name: "PancakeSwap", type: "DEX", status: "대기", scopes: ["Swap", "LP"], color: "yellow" },
  { id: "jupiter", name: "Jupiter", type: "DEX", status: "대기", scopes: ["Swap", "Route"], color: "green" },
];

const GUIDE_ITEMS = [
  "거래소 연결하기",
  "전략 생성하기",
  "백테스트 실행하기",
  "소액으로 드라이런 시작하기",
];

const MAIN_VIEW_TABS = [
  { id: "easy" as const, label: "쉬운 보기", icon: Boxes },
  { id: "advanced" as const, label: "고급 보기", icon: Network },
  { id: "code" as const, label: "코드 보기", icon: Code2 },
];

const STRATEGY_CODE = `strategy "XRP 현물-선물 가격차" {
  stream spot = binance.spot("XRPUSDT")
  stream perp = binance.perp("XRPUSDT.P")

  basis = (perp.price - spot.price) / spot.price * 100

  when basis > 0.50 {
    buy spot with 1000 USDT
    short perp with 1x hedge
  }

  while position.open {
    rebalance if exposure_gap > 0.20
    close if basis < 0.10 or pnl < -1.00
  }
}`;

const INITIAL_TEMPLATE = AI_STRATEGY_TEMPLATES[0];
const INITIAL_STRATEGY_CODE = buildStrategyCodeFromTemplate(INITIAL_TEMPLATE);
const INITIAL_EASY_VIEW = createEasyViewFromStrategyCode(INITIAL_STRATEGY_CODE, INITIAL_TEMPLATE);
const STRATEGY_BUILDER_STORAGE_KEY = "thirdeye.strategy-builder-state.v1";

type AdvancedGraphModel = NonNullable<EasyViewAgentResult["advancedGraph"]>;

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

function canUseBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
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

    return {
      version: 1,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
      generatedCode: typeof parsed.generatedCode === "string" ? parsed.generatedCode : parsed.easyViewModel.code,
      programCode: typeof parsed.programCode === "string" ? parsed.programCode : "",
      easyViewModel: parsed.easyViewModel,
      advancedGraphModel,
      lastSyncedAdvancedGraphSignature: advancedGraphModel
        ? createAdvancedGraphSignature(advancedGraphModel)
        : typeof parsed.lastSyncedAdvancedGraphSignature === "string"
          ? parsed.lastSyncedAdvancedGraphSignature
          : "",
      aiSummary: typeof parsed.aiSummary === "string" ? parsed.aiSummary : `AI 요약: ${parsed.easyViewModel.summary}`,
      agentSteps: Array.isArray(parsed.agentSteps)
        ? parsed.agentSteps.filter((step): step is string => typeof step === "string")
        : [],
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

function Sparkline({ tone = "up" }: { tone?: "up" | "down" }) {
  const points =
    tone === "up"
      ? "0,24 8,20 16,22 24,16 32,18 40,11 48,14 56,7 64,10 72,4"
      : "0,8 8,10 16,7 24,12 32,11 40,17 48,15 56,22 64,20 72,24";

  return (
    <svg viewBox="0 0 72 28" className="h-6 w-full">
      <polyline
        points={points}
        fill="none"
        stroke={tone === "up" ? "#22c55e" : "#ef4444"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconButton({
  children,
  title,
  onClick,
  active,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50",
        active && "border-violet-200 bg-violet-50 text-violet-700",
      )}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: StrategyBlock["status"] }) {
  const label = {
    ready: "대기",
    watching: "감시",
    running: "작동",
    complete: "완료",
    blocked: "제한",
  }[status];

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold",
        status === "running" && "bg-emerald-100 text-emerald-700",
        status === "watching" && "bg-blue-100 text-blue-700",
        status === "complete" && "bg-violet-100 text-violet-700",
        status === "blocked" && "bg-rose-100 text-rose-700",
        status === "ready" && "bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </span>
  );
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
  const [mainView, setMainView] = useState<MainView>("easy");
  const [detailTab, setDetailTab] = useState<DetailTab>("params");
  const [selectedBlockId, setSelectedBlockId] = useState("spot-buy");
  const [exchangeTab, setExchangeTab] = useState<ExchangeTab>("binance");
  const [planTier, setPlanTier] = useState<PlanTier>("pro");
  const [marketRows, setMarketRows] = useState<MarketRow[]>(MARKET_ROWS);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState("");
  const [marketWarning, setMarketWarning] = useState("");
  const [exchangeConnections, setExchangeConnections] = useState<ExchangeConnection[]>(EXCHANGE_CONNECTIONS);
  const [exchangeForm, setExchangeForm] = useState({
    id: "",
    name: "",
    type: "CEX" as ExchangeConnection["type"],
    apiUrl: "",
    wsUrl: "",
    rpcUrl: "",
    marketDataUrl: "",
    apiKey: "",
    apiSecret: "",
    scopes: "Spot,Futures,Trade",
  });
  const [isSavingExchange, setIsSavingExchange] = useState(false);
  const [isTestingExchangeAuth, setIsTestingExchangeAuth] = useState(false);
  const [exchangeAuthMarket, setExchangeAuthMarket] = useState<"spot" | "futures">("spot");
  const [exchangeAuthMessage, setExchangeAuthMessage] = useState("");
  const [exchangeFormError, setExchangeFormError] = useState("");
  const [guideDone, setGuideDone] = useState<Set<number>>(new Set([0]));
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isExchangeLibraryOpen, setIsExchangeLibraryOpen] = useState(false);
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
  const [generatedCode, setGeneratedCode] = useState(INITIAL_STRATEGY_CODE);
  const [programCode, setProgramCode] = useState("");
  const [easyViewModel, setEasyViewModel] = useState<EasyViewModel>(INITIAL_EASY_VIEW);
  const [advancedGraphModel, setAdvancedGraphModel] = useState<NonNullable<EasyViewAgentResult["advancedGraph"]> | null>(null);
  const [advancedGraphVersion, setAdvancedGraphVersion] = useState(0);
  const [lastSyncedAdvancedGraphSignature, setLastSyncedAdvancedGraphSignature] = useState("");
  const [isAdvancedSyncPromptOpen, setIsAdvancedSyncPromptOpen] = useState(false);
  const [isRegeneratingEasyView, setIsRegeneratingEasyView] = useState(false);
  const [agentSteps, setAgentSteps] = useState<string[]>([
    "기본 전략 템플릿 코드 로드",
    "코드에서 쉬운 보기 블록과 간선을 생성",
    "쉬운 보기에서는 CEX/DEX 실행 파라미터만 편집 가능",
  ]);
  const [aiSummary, setAiSummary] = useState(
    `AI 요약: ${INITIAL_EASY_VIEW.summary}`,
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const entries = STRATEGY_BLOCKS.flatMap((block) =>
      block.params.map((param) => [`${block.id}:${param.key}`, param.value] as const),
    );
    return Object.fromEntries(entries);
  });
  const templatePanelCloseTimer = useRef<number | null>(null);
  const strategyPersistenceReadyRef = useRef(false);
  const isRestoringStrategyStateRef = useRef(false);
  const switchToEasyAfterAdvancedSaveRef = useRef(false);
  const connectedExchangeCount = exchangeConnections.filter((item) => item.status === "연결됨").length;
  const selectedExchange = exchangeConnections.find((item) => item.id === exchangeTab) ?? exchangeConnections[0];
  const hasExchangeExecutionUrl = Boolean(exchangeForm.apiUrl.trim() || exchangeForm.rpcUrl.trim());
  const selectedExchangeCredentials = selectedExchange?.credentials;
  const canTestBinanceAuth = Boolean(
    selectedExchange &&
    /binance/i.test(`${selectedExchange.id} ${selectedExchange.name}`) &&
    selectedExchangeCredentials?.hasApiKey &&
    selectedExchangeCredentials?.hasApiSecret,
  );

  const loadMarketOverview = async () => {
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
  };

  const loadExchangeConnections = async () => {
    try {
      const response = await fetch("/api/exchange-connections", { cache: "no-store" });
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
  };

  const saveExchangeConnection = async () => {
    if (!exchangeForm.name.trim()) {
      setExchangeFormError("거래소 이름을 입력하세요.");
      return;
    }
    if (!hasExchangeExecutionUrl) {
      setExchangeFormError("AI 전략 생성에는 REST API URL 또는 RPC URL이 필요합니다. WSS는 시세 수신용 보조 URL로만 사용됩니다.");
      return;
    }
    setIsSavingExchange(true);
    setExchangeFormError("");
    try {
      const response = await fetch("/api/exchange-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exchangeForm),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "거래소 연결 저장 실패"));
      const connections = Array.isArray(data?.connections) ? data.connections as ExchangeConnection[] : exchangeConnections;
      setExchangeConnections(connections);
      if (data?.connection?.id) setExchangeTab(data.connection.id);
      setExchangeForm({
        id: "",
        name: "",
        type: "CEX",
        apiUrl: "",
        wsUrl: "",
        rpcUrl: "",
        marketDataUrl: "",
        apiKey: "",
        apiSecret: "",
        scopes: "Spot,Futures,Trade",
      });
      setExchangeAuthMessage("연결 정보를 저장했습니다. Binance 키가 있으면 서명 테스트를 실행할 수 있습니다.");
      setGuideDone((prev) => new Set([...prev, 0]));
    } catch (error) {
      setExchangeFormError(error instanceof Error ? error.message : "거래소 연결 저장 실패");
      setAgentMessages((prev) => [
        ...prev,
        { role: "ai", text: `거래소 연결 저장 실패: ${error instanceof Error ? error.message : "unknown error"}` },
      ]);
    } finally {
      setIsSavingExchange(false);
    }
  };

  const testBinanceAuth = async () => {
    if (!selectedExchange?.id) {
      setExchangeAuthMessage("먼저 Binance 연결을 선택하세요.");
      return;
    }
    if (!canTestBinanceAuth) {
      setExchangeAuthMessage("Binance API Key와 Secret을 저장한 뒤 서명 테스트를 실행하세요.");
      return;
    }

    setIsTestingExchangeAuth(true);
    setExchangeAuthMessage("");
    try {
      const response = await fetch(`/api/exchange-connections/${encodeURIComponent(selectedExchange.id)}/binance-auth-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: exchangeAuthMarket }),
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
  }, []);

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
    (graph: AdvancedGraphModel, options?: { strategyName?: string; switchToEasy?: boolean; source?: "save" | "tab-switch" }) => {
      if (!graph.nodes.some((node) => node.type !== "groupNode")) return false;

      const strategyName = options?.strategyName || activeSnapshot?.name || easyViewModel.title || "고급 보기 수정 전략";
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
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
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-100",
                  item.active && "bg-violet-600 text-white shadow-sm hover:bg-violet-600",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-slate-200 p-2.5">
          <section className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="mb-2 text-xs font-bold text-slate-700">거래소 연결</div>
            <div className="mb-2 grid grid-cols-3 gap-1">
              {exchangeConnections.slice(0, 3).map((exchange) => (
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
            <div className="mt-2 flex flex-wrap gap-1">
              {(selectedExchange?.scopes ?? ["API/RPC URL 필요"]).map((scope) => (
                <span key={scope} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {scope}
                </span>
              ))}
            </div>
            {selectedExchange?.rpcUrl || selectedExchange?.apiUrl || selectedExchange?.wsUrl ? (
              <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                API/RPC URL 저장됨
              </div>
            ) : null}
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              <Coins className="h-4 w-4 text-amber-600" />
              거래소
            </button>
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
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_clamp(246px,20vw,320px)]">
          <section className="flex min-w-0 flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-50">
              {mainView === "easy" ? (
                <EasyStrategyGraph model={easyViewModel} />
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
                      Hershy Strategy JSON
                    </div>
                    <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300">
                      코드에서 블록 재생성
                    </button>
                  </div>
                  <pre className="rounded-lg border border-slate-800 bg-black/40 p-4 text-sm leading-7 text-emerald-200">
                    {generatedCode}
                  </pre>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="hidden min-h-0 flex-col gap-2 overflow-y-auto border-l border-slate-200 bg-white p-2 xl:flex">
            <section className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <h2 className="text-xs font-black">시장 개요</h2>
                <span className="text-[10px] text-slate-500">
                  {marketUpdatedAt ? new Date(marketUpdatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "로딩"}
                </span>
              </div>
              {marketWarning ? (
                <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                  public ticker fallback
                </div>
              ) : null}
              <div className="grid gap-1">
                {marketRows.map((row) => (
                  <div key={row.symbol} className="grid h-8 grid-cols-[20px_1fr_52px_40px] items-center gap-1.5">
                    <div className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white", row.tone === "up" ? "bg-orange-500" : "bg-slate-900")}>
                      {row.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-slate-800">{row.symbol}</div>
                      <div className="truncate text-[10px] text-slate-500">{row.price}</div>
                    </div>
                    <Sparkline tone={row.tone as "up" | "down"} />
                    <div className={cn("text-right text-[10px] font-bold", row.tone === "up" ? "text-emerald-600" : "text-rose-600")}>
                      {row.change}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-black">{easyViewModel.title}</h2>
                  <div className="text-[10px] text-slate-500">1분 전</div>
                </div>
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <div className="flex items-end gap-2">
                <div className="text-2xl font-black text-emerald-600">0.180%</div>
                <div className="pb-1 text-[11px] font-bold text-emerald-500">+0.042%</div>
              </div>
              <svg viewBox="0 0 224 76" className="mt-2 h-[74px] w-full rounded-lg bg-slate-50">
                <polyline
                  points="0,54 12,46 24,52 36,40 48,43 60,34 72,38 84,27 96,29 108,21 120,27 132,17 144,23 156,15 168,19 180,11 192,16 204,9 216,14 224,10"
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="0" x2="224" y1="40" y2="40" stroke="#cbd5e1" strokeDasharray="4 4" />
                <text x="2" y="70" className="fill-slate-500 text-[9px]">10:30</text>
                <text x="92" y="70" className="fill-slate-500 text-[9px]">11:00</text>
                <text x="184" y="70" className="fill-slate-500 text-[9px]">12:00</text>
              </svg>
            </section>

            <section className="rounded-lg border border-slate-200 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-black">현재 전략 요약</div>
                <button onClick={handleAiSummary} className="text-[10px] font-bold text-violet-700">
                  {isSummarizing ? "요약 중" : "AI 요약"}
                </button>
              </div>
              <div className="text-[15px] font-black leading-5">{easyViewModel.title}</div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{easyViewModel.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">백테스트 가능</span>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">드라이런 준비됨</span>
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-violet-700">{aiSummary}</p>
              <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1 text-xs">
                <dt className="text-slate-500">전략 유형</dt>
                <dd className="text-right font-bold">{easyViewModel.strategyType}</dd>
                <dt className="text-slate-500">시간 프레임</dt>
                <dd className="text-right font-bold">{easyViewModel.timeframe}</dd>
                <dt className="text-slate-500">마지막 수정</dt>
                <dd className="text-right font-bold">{activeSnapshot?.timestamp ? new Date(activeSnapshot.timestamp).toLocaleString("ko-KR") : easyViewModel.lastModified}</dd>
              </dl>
            </section>

            <section className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-black text-violet-900">에이전트 루프</div>
                <span className="text-[10px] font-bold text-violet-700">{isAgentRunning ? "생성 중" : "완료"}</span>
              </div>
              <div className="grid gap-1.5">
                {visibleAgentActivities.map((activity, index) => (
                  <div key={`${activity.id}-${index}`} className="grid grid-cols-[18px_1fr] gap-1 text-[11px] leading-4 text-violet-900">
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-black",
                        activity.status === "error" ? "text-rose-600" : activity.status === "done" ? "text-emerald-600" : "text-violet-700",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span>
                      {activity.label}
                      {activity.stage ? <span className="ml-1 text-[10px] font-bold text-violet-500">· {activity.stage}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-950 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-black text-slate-100">관리자 Hershy Program 코드</div>
                <span className={cn("text-[10px] font-bold", programCode ? "text-emerald-300" : "text-amber-300")}>
                  {programCode ? "program" : "not generated"}
                </span>
              </div>
              <pre className="max-h-44 overflow-auto rounded-md border border-slate-800 bg-black/40 p-2 text-[10px] leading-4 text-emerald-200">
                {programCode || "아직 generated_strategy.go program 코드가 없습니다.\nAI 전략 생성이 서버 검증과 코드 생성을 통과하면 이 영역에 실제 Hershy Go program 코드가 표시됩니다."}
              </pre>
            </section>

            <section className="rounded-lg border border-slate-200 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-black">시작 가이드</div>
                <button
                  type="button"
                  onClick={() => setIsGuideOpen(true)}
                  className="text-[10px] font-bold text-violet-700"
                >
                  열기
                </button>
              </div>
              <div className="grid gap-1.5">
                {GUIDE_ITEMS.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setGuideStep(index);
                      setIsGuideOpen(true);
                    }}
                    className="grid h-7 grid-cols-[20px_1fr_12px] items-center gap-1 text-left text-xs"
                  >
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold", guideDone.has(index) ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-500")}>
                      {index + 1}
                    </span>
                    <span className="truncate font-semibold text-slate-700">{item}</span>
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                  </button>
                ))}
              </div>
            </section>

            <button className="mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
              <ExternalLink className="h-3.5 w-3.5" />
              전략 리포트 열기
            </button>
          </aside>
        </main>
      </div>

      {isExchangeLibraryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <section className="flex max-h-[82vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-violet-600">Exchange Block Library</div>
                <h2 className="mt-1 text-xl font-black text-slate-950">거래소 연결 블록 모음</h2>
                <p className="mt-1 text-xs text-slate-500">연결된 CEX/DEX 블록을 한 탭에서 확인하고 쉬운 보기의 실행 파라미터에 연결합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsExchangeLibraryOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)] overflow-hidden">
              <aside className="border-r border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-2">
                  {[
                    ["전체", exchangeConnections.length],
                    ["연결됨", exchangeConnections.filter((item) => item.status === "연결됨").length],
                    ["CEX", exchangeConnections.filter((item) => item.type === "CEX").length],
                    ["DEX", exchangeConnections.filter((item) => item.type === "DEX").length],
                  ].map(([label, count]) => (
                    <button
                      key={String(label)}
                      type="button"
                      className="flex h-9 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
                    >
                      <span>{label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{count}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900">
                  저장된 연결만 AI 전략 생성에 사용됩니다. RPC/API URL 원문은 서버에 저장하고, AI에는 연결된 거래소 이름과 권한만 전달합니다.
                </div>
              </aside>

              <div className="overflow-auto p-4">
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-950">API / RPC / 키 연결</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-500">CEX REST API와 API Key/Secret, DEX RPC URL을 저장합니다. 키 원문은 다시 표시하지 않습니다.</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={exchangeAuthMarket}
                        onChange={(event) => setExchangeAuthMarket(event.target.value as "spot" | "futures")}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-violet-300"
                      >
                        <option value="spot">Spot</option>
                        <option value="futures">Futures</option>
                      </select>
                      <button
                        type="button"
                        onClick={testBinanceAuth}
                        disabled={isTestingExchangeAuth || !canTestBinanceAuth}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-700 disabled:border-slate-200 disabled:text-slate-400"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {isTestingExchangeAuth ? "검증 중" : "서명 테스트"}
                      </button>
                      <button
                        type="button"
                        onClick={saveExchangeConnection}
                        disabled={isSavingExchange || !exchangeForm.name.trim() || !hasExchangeExecutionUrl}
                        className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white disabled:bg-slate-300"
                      >
                        {isSavingExchange ? "저장 중" : "연결 저장"}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_100px] gap-2">
                    <input
                      value={exchangeForm.name}
                      onChange={(event) => setExchangeForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="거래소 이름 예: Binance"
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold outline-none focus:border-violet-300"
                    />
                    <select
                      value={exchangeForm.type}
                      onChange={(event) => setExchangeForm((prev) => ({ ...prev, type: event.target.value as ExchangeConnection["type"] }))}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-violet-300"
                    >
                      <option value="CEX">CEX</option>
                      <option value="DEX">DEX</option>
                      <option value="RPC">RPC</option>
                    </select>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      value={exchangeForm.apiUrl}
                      onChange={(event) => {
                        setExchangeFormError("");
                        setExchangeForm((prev) => ({ ...prev, apiUrl: event.target.value }));
                      }}
                      placeholder="REST API URL 예: https://api.binance.com"
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      value={exchangeForm.wsUrl}
                      onChange={(event) => {
                        setExchangeFormError("");
                        setExchangeForm((prev) => ({ ...prev, wsUrl: event.target.value }));
                      }}
                      placeholder="WebSocket URL 선택"
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      value={exchangeForm.rpcUrl}
                      onChange={(event) => {
                        setExchangeFormError("");
                        setExchangeForm((prev) => ({ ...prev, rpcUrl: event.target.value }));
                      }}
                      placeholder="RPC URL 예: https://mainnet.infura.io/v3/..."
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      value={exchangeForm.scopes}
                      onChange={(event) => setExchangeForm((prev) => ({ ...prev, scopes: event.target.value }))}
                      placeholder="권한 예: Spot,Futures,Trade"
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      type="password"
                      autoComplete="off"
                      value={exchangeForm.apiKey}
                      onChange={(event) => {
                        setExchangeFormError("");
                        setExchangeAuthMessage("");
                        setExchangeForm((prev) => ({ ...prev, apiKey: event.target.value }));
                      }}
                      placeholder={
                        selectedExchangeCredentials?.hasApiKey
                          ? `Binance API Key 저장됨 · ****${selectedExchangeCredentials.apiKeyLast4 || "****"}`
                          : "Binance API Key 선택"
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      type="password"
                      autoComplete="off"
                      value={exchangeForm.apiSecret}
                      onChange={(event) => {
                        setExchangeFormError("");
                        setExchangeAuthMessage("");
                        setExchangeForm((prev) => ({ ...prev, apiSecret: event.target.value }));
                      }}
                      placeholder={selectedExchangeCredentials?.hasApiSecret ? "Binance Secret 저장됨 · 새 Secret 입력 시 교체" : "Binance API Secret 선택"}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600">
                      키 상태: {selectedExchangeCredentials?.hasApiKey ? `API Key ****${selectedExchangeCredentials.apiKeyLast4 || "****"}` : "API Key 없음"}
                      {" / "}
                      {selectedExchangeCredentials?.hasApiSecret ? "Secret 저장됨" : "Secret 없음"}
                    </div>
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-2 text-[11px] font-semibold",
                        selectedExchangeCredentials?.authStatus === "검증됨"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : selectedExchangeCredentials?.authStatus === "실패"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      서명 상태: {selectedExchangeCredentials?.authStatus || "미검증"}
                      {selectedExchangeCredentials?.lastAuthCheckAt ? ` · ${new Date(selectedExchangeCredentials.lastAuthCheckAt).toLocaleString("ko-KR")}` : ""}
                    </div>
                  </div>
                  {exchangeFormError ? (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                      {exchangeFormError}
                    </div>
                  ) : null}
                  {exchangeAuthMessage ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700">
                      {exchangeAuthMessage}
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  {exchangeConnections.map((exchange) => (
                    <button
                      key={exchange.id}
                      type="button"
                      onClick={() => {
                        setExchangeTab(exchange.id);
                        setExchangeForm((prev) => ({
                          ...prev,
                          id: exchange.id,
                          name: exchange.name,
                          type: exchange.type,
                          apiUrl: exchange.apiUrl || exchange.restUrl || "",
                          wsUrl: exchange.wsUrl || "",
                          rpcUrl: exchange.rpcUrl || "",
                          marketDataUrl: exchange.marketDataUrl || "",
                          apiKey: "",
                          apiSecret: "",
                          scopes: exchange.scopes.join(","),
                        }));
                        setExchangeAuthMessage("");
                      }}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950">{exchange.name}</div>
                          <div className="mt-0.5 text-[11px] font-bold text-slate-500">{exchange.type}</div>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            exchange.status === "연결됨" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {exchange.status}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {exchange.scopes.map((scope) => (
                          <span key={scope} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            {scope}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 text-[10px] font-semibold text-slate-500">
                        {exchange.apiUrl || exchange.wsUrl || exchange.rpcUrl || exchange.marketDataUrl ? "API/RPC URL 저장됨" : "URL 미설정"}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold text-slate-500">
                        {exchange.credentials?.hasApiKey && exchange.credentials?.hasApiSecret
                          ? `서명키 저장됨${exchange.credentials.apiKeyLast4 ? ` · ****${exchange.credentials.apiKeyLast4}` : ""}`
                          : "서명키 미설정"}
                        {exchange.credentials?.authStatus ? ` · ${exchange.credentials.authStatus}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
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

      <StrategyHistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </div>
  );
}
