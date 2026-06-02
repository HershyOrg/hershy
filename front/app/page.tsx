"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { ExchangeLibraryModal } from "@/components/home/ExchangeLibraryModal";
import { PageRightRail } from "@/components/home/PageRightRail";
import { PortfolioWorkspace } from "@/components/home/PortfolioWorkspace";
import {
  AI_STRATEGY_TEMPLATES,
  DEFAULT_CEX_TRADE_EXCHANGE,
  EXCHANGE_CONNECTIONS,
  EXCHANGE_CONNECTION_NAMES,
  GUIDE_ITEMS,
  MAIN_VIEW_TABS,
  MARKET_ROWS,
  NAV_ITEMS,
  STRATEGY_BUILDER_STORAGE_KEY,
  buildExchangeFormFromConnection,
  createEmptyExchangeForm,
  type StrategyTemplate,
} from "@/components/home/config";
import type {
  AgentActivity,
  BalanceMyDataSnapshot,
  ExchangeConnection,
  ExchangeFormState,
  MarketRow,
} from "@/components/home/types";
import { NodeEditor, type NodeEditorInitialGraph } from "@/components/node-editor/NodeEditor";
import {
  advancedGraphToStrategyGraph,
  createAdvancedViewFromStrategyGraph,
  strategyGraphToCode,
  type StrategyGraphPayload,
} from "@/lib/strategyGraph";
import { historyStore, type HistorySnapshot, type HistorySnapshotCodeMeta } from "@/lib/historyStore";
import { cn } from "@/lib/utils";
import {
  getClientUserProfile,
  withUserContextHeaders,
  withUserContextPayload,
} from "@/lib/userContextClient";

type MainView = "advanced" | "code";
type ExchangeTab = string;
type PlanTier = "free" | "pro" | "team";
type WorkspaceView = "create" | "portfolio";

type AdvancedGraphModel = NodeEditorInitialGraph;

type PersistedStrategyBuilderState = {
  version: 2;
  savedAt: number;
  generatedCode: string;
  programCode: string;
  strategyTitle: string;
  strategySummary: string;
  advancedGraphModel: AdvancedGraphModel | null;
  lastSyncedAdvancedGraphSignature: string;
  aiSummary: string;
  agentSteps: string[];
};

const START_GUIDE_COMPLETED_STORAGE_PREFIX = "hershy-start-guide-completed";
const EMPTY_STRATEGY_TITLE = "새 전략";
const EMPTY_STRATEGY_SUMMARY = "아직 생성된 전략이 없습니다. AI에게 전략을 요청하거나 템플릿을 선택해 시작하세요.";
const DEPRECATED_XRP_SEED_PATTERN = /XRPUSDT|XRPUSDT\.P|\bXRP\b/i;

function isWorkspaceNavId(value: string): value is WorkspaceView {
  return value === "create" || value === "portfolio";
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function getStartGuideStorageKey(userId: string) {
  return `${START_GUIDE_COMPLETED_STORAGE_PREFIX}:${userId || "guest"}`;
}

function readStartGuideCompleted(userId: string) {
  if (!canUseBrowserStorage()) return false;
  return window.localStorage.getItem(getStartGuideStorageKey(userId)) === "1";
}

function writeStartGuideCompleted(userId: string) {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(getStartGuideStorageKey(userId), "1");
}

function isAdvancedGraphModel(value: unknown): value is AdvancedGraphModel {
  if (!value || typeof value !== "object") return false;
  const graph = value as Record<string, unknown>;
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

const DEFAULT_AGENT_STEPS = [
  "거래소 연결 확인",
  "AI 전략 생성 또는 템플릿 선택",
  "고급 전략 캔버스 생성",
] as const;

function getNodeDataForAdvancedStructureSignature(node: AdvancedGraphModel["nodes"][number]) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return data;
}

function readPersistedStrategyBuilderState(): PersistedStrategyBuilderState | null {
  if (!canUseBrowserStorage()) return null;

  try {
    const raw = window.localStorage.getItem(STRATEGY_BUILDER_STORAGE_KEY);
    if (!raw) return null;
    if (DEPRECATED_XRP_SEED_PATTERN.test(raw)) {
      window.localStorage.removeItem(STRATEGY_BUILDER_STORAGE_KEY);
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedStrategyBuilderState>;
    if (parsed.version !== 2) return null;

    const advancedGraphModel = isAdvancedGraphModel(parsed.advancedGraphModel) ? parsed.advancedGraphModel : null;
    const restoredGeneratedCode = typeof parsed.generatedCode === "string" ? parsed.generatedCode : "";
    const restoredProgramCode = typeof parsed.programCode === "string" ? parsed.programCode : "";
    const restoredStrategySummary = typeof parsed.strategySummary === "string" ? parsed.strategySummary : EMPTY_STRATEGY_SUMMARY;
    const restoredAiSummary = typeof parsed.aiSummary === "string" ? parsed.aiSummary : `AI 요약: ${restoredStrategySummary}`;
    const restoredAgentSteps = Array.isArray(parsed.agentSteps)
      ? parsed.agentSteps.filter((step): step is string => typeof step === "string")
      : [];

    return {
      version: 2,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
      generatedCode: restoredGeneratedCode,
      programCode: restoredProgramCode,
      strategyTitle: typeof parsed.strategyTitle === "string" ? parsed.strategyTitle : EMPTY_STRATEGY_TITLE,
      strategySummary: restoredStrategySummary,
      advancedGraphModel,
      lastSyncedAdvancedGraphSignature: typeof parsed.lastSyncedAdvancedGraphSignature === "string"
        ? parsed.lastSyncedAdvancedGraphSignature
        : advancedGraphModel
          ? createAdvancedGraphSignature(advancedGraphModel)
          : "",
      aiSummary: restoredAiSummary,
      agentSteps: restoredAgentSteps,
    };
  } catch (error) {
    console.warn("[strategyBuilder] failed to restore persisted strategy canvas", error);
    return null;
  }
}

function writePersistedStrategyBuilderState(state: Omit<PersistedStrategyBuilderState, "version" | "savedAt">) {
  if (!canUseBrowserStorage()) return;

  try {
    const payload: PersistedStrategyBuilderState = {
      version: 2,
      savedAt: Date.now(),
      ...state,
    };
    window.localStorage.setItem(STRATEGY_BUILDER_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("[strategyBuilder] failed to persist strategy canvas", error);
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

function compactCodeMetaForSignature(value: HistorySnapshotCodeMeta | null | undefined) {
  if (!value) return null;
  const next: HistorySnapshotCodeMeta = {};

  if (value.strategyTitle !== undefined) next.strategyTitle = value.strategyTitle;
  if (value.strategySummary !== undefined) next.strategySummary = value.strategySummary;
  if (value.generatedCode !== undefined) next.generatedCode = value.generatedCode;
  if (value.programCode !== undefined) next.programCode = value.programCode;
  if (value.strategyGraph !== undefined) next.strategyGraph = value.strategyGraph;
  if (value.graphSignature !== undefined) next.graphSignature = value.graphSignature;
  if (value.programCodeSignature !== undefined) next.programCodeSignature = value.programCodeSignature;
  if (value.aiSummary !== undefined) next.aiSummary = value.aiSummary;
  if (value.agentSteps !== undefined) next.agentSteps = value.agentSteps;

  return Object.keys(next).length > 0 ? next : null;
}

function codeMetaComparableSignature(value: HistorySnapshotCodeMeta | null | undefined) {
  return stableStringify(compactCodeMetaForSignature(value));
}

function stringArraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
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

function getStrategyGraphTitle(strategyGraph: StrategyGraphPayload, fallback = EMPTY_STRATEGY_TITLE) {
  const name = strategyGraph.strategy?.name;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

function getStrategyGraphSummary(strategyGraph: StrategyGraphPayload, fallback = EMPTY_STRATEGY_SUMMARY) {
  const summary = strategyGraph.summary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  if (summary && typeof summary === "object") {
    const record = summary as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
    const blocks = typeof record.blocks === "number" ? record.blocks : undefined;
    const connections = typeof record.connections === "number" ? record.connections : undefined;
    if (blocks !== undefined || connections !== undefined) {
      return `전략 그래프 노드 ${blocks ?? 0}개와 연결 ${connections ?? 0}개로 구성되었습니다.`;
    }
  }
  return fallback;
}

function materializeAdvancedStrategyGraph(strategyGraph: StrategyGraphPayload, fallbackTitle = EMPTY_STRATEGY_TITLE) {
  const title = getStrategyGraphTitle(strategyGraph, fallbackTitle);
  const summary = getStrategyGraphSummary(strategyGraph);
  return {
    title,
    summary,
    code: strategyGraphToCode(strategyGraph),
    advancedGraph: createAdvancedViewFromStrategyGraph(strategyGraph, title),
    steps: [
      "전략 그래프 수신",
      "고급 전략 캔버스 생성",
      "실행 가능한 노드/간선 검증",
    ],
  };
}

function getAdvancedGraphCodeState(
  graph: AdvancedGraphModel | null | undefined,
  title: string,
  fallbackSummary = EMPTY_STRATEGY_SUMMARY,
) {
  if (!graph?.nodes.some((node) => node.type !== "groupNode")) {
    return {
      generatedCode: "",
      graphSignature: "",
      programCodeSignature: "",
      strategyGraph: null,
      strategySummary: fallbackSummary,
    };
  }

  try {
    const strategyGraph = advancedGraphToStrategyGraph(graph, title);
    return {
      generatedCode: strategyGraphToCode(strategyGraph),
      graphSignature: createAdvancedGraphSignature(graph),
      programCodeSignature: stableStringify(strategyGraph),
      strategyGraph,
      strategySummary: getStrategyGraphSummary(strategyGraph, fallbackSummary),
    };
  } catch {
    return {
      generatedCode: "",
      graphSignature: createAdvancedGraphSignature(graph),
      programCodeSignature: "",
      strategyGraph: null,
      strategySummary: fallbackSummary,
    };
  }
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

function stripAISummaryPrefix(value: string) {
  return value.replace(/^AI\s*요약\s*[:：]\s*/i, "").trim();
}

function formatStrategyAISummary(data: Record<string, any> | null | undefined, fallbackSummary = "") {
  const payload =
    data?.strategyAISummary && typeof data.strategyAISummary === "object"
      ? data.strategyAISummary as Record<string, any>
      : data?.strategy?.metadata?.strategyAISummary && typeof data.strategy.metadata.strategyAISummary === "object"
        ? data.strategy.metadata.strategyAISummary as Record<string, any>
        : null;
  const summaryText = typeof payload?.summaryText === "string" ? payload.summaryText.trim() : "";
  const keyPoints = Array.isArray(payload?.keyPoints)
    ? payload.keyPoints.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  const readiness = typeof payload?.executionReadinessText === "string" ? payload.executionReadinessText.trim() : "";
  const riskNotes = Array.isArray(payload?.riskNotes)
    ? payload.riskNotes.map((item) => String(item).trim()).filter(Boolean).slice(0, 2)
    : [];
  const lines = [
    summaryText || stripAISummaryPrefix(fallbackSummary),
    ...keyPoints.map((item) => `- ${item}`),
    readiness ? `실행 준비: ${readiness}` : "",
    ...riskNotes.map((item) => `주의: ${item}`),
  ].filter(Boolean);
  return `AI 요약: ${lines.join("\n") || "전략 요약을 준비하지 못했습니다."}`;
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

export default function Page() {
  const { resolvedTheme, setTheme } = useTheme();
  const [isThemeMounted, setIsThemeMounted] = useState(false);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("create");
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [mainView, setMainView] = useState<MainView>("advanced");
  const [exchangeTab, setExchangeTab] = useState<ExchangeTab>(EXCHANGE_CONNECTIONS[0]?.id ?? "binance");
  const [planTier, setPlanTier] = useState<PlanTier>("pro");
  const [marketRows, setMarketRows] = useState<MarketRow[]>(MARKET_ROWS);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState("");
  const [marketWarning, setMarketWarning] = useState("");
  const [exchangeConnections, setExchangeConnections] = useState<ExchangeConnection[]>(EXCHANGE_CONNECTIONS);
  const [balanceSnapshots, setBalanceSnapshots] = useState<BalanceMyDataSnapshot[]>([]);
  const [syncingBalanceConnectionId, setSyncingBalanceConnectionId] = useState("");
  const [exchangeForm, setExchangeForm] = useState<ExchangeFormState>(createEmptyExchangeForm);
  const [isSavingExchange, setIsSavingExchange] = useState(false);
  const [isTestingExchangeAuth, setIsTestingExchangeAuth] = useState(false);
  const [exchangeAuthMarket] = useState<"spot" | "futures">("spot");
  const [exchangeAuthMessage, setExchangeAuthMessage] = useState("");
  const [exchangeFormError, setExchangeFormError] = useState("");
  const [clientUserId, setClientUserId] = useState("");
  const [isPersonalLoggedIn, setIsPersonalLoggedIn] = useState(false);
  const [guideDone, setGuideDone] = useState<Set<number>>(new Set());
  const [isGuideCompleted, setIsGuideCompleted] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isExchangeLibraryOpen, setIsExchangeLibraryOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isTemplatePanelOpen, setIsTemplatePanelOpen] = useState(false);
  const [templatePanelMode, setTemplatePanelMode] = useState<"compact" | "expanded">("compact");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMessages, setAgentMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    {
      role: "ai",
      text: "추천 템플릿을 고르거나 직접 말로 전략을 요청하면 코드 생성 후 고급 전략 캔버스를 만듭니다.",
    },
  ]);
  const [, setAgentActivities] = useState<AgentActivity[]>([]);
  const [generatedCode, setGeneratedCode] = useState("");
  const [programCode, setProgramCode] = useState("");
  const [programCodeError, setProgramCodeError] = useState("");
  const [isGeneratingProgramCode, setIsGeneratingProgramCode] = useState(false);
  const [strategyTitle, setStrategyTitle] = useState(EMPTY_STRATEGY_TITLE);
  const [strategySummary, setStrategySummary] = useState(EMPTY_STRATEGY_SUMMARY);
  const [advancedGraphModel, setAdvancedGraphModel] = useState<AdvancedGraphModel | null>(null);
  const [advancedGraphVersion, setAdvancedGraphVersion] = useState(0);
  const [lastSyncedAdvancedGraphSignature, setLastSyncedAdvancedGraphSignature] = useState("");
  const [agentSteps, setAgentSteps] = useState<string[]>(() => [...DEFAULT_AGENT_STEPS]);
  const [aiSummary, setAiSummary] = useState(
    `AI 요약: ${EMPTY_STRATEGY_SUMMARY}`,
  );
  const templatePanelCloseTimer = useRef<number | null>(null);
  const agentAbortControllerRef = useRef<AbortController | null>(null);
  const codexStrategyInboxIdRef = useRef("");
  const codexStrategyInboxErrorIdRef = useRef("");
  const strategyPersistenceReadyRef = useRef(false);
  const isRestoringStrategyStateRef = useRef(false);
  const programCodeRequestRef = useRef("");
  const activeSnapshotCodeMetaRef = useRef<HistorySnapshotCodeMeta | null>(null);
  const lastAppliedSnapshotCodeMetaIdRef = useRef<string | null>(null);
  const lastAppliedSnapshotHydrationSignatureRef = useRef("");
  const lastCodeMetaWriteSignatureRef = useRef("");
  const skipNextSnapshotCodeMetaSyncRef = useRef(false);
  const isDarkMode = isThemeMounted && resolvedTheme === "dark";
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
  const generatedStrategyGraph = useMemo(() => parseStrategyGraphCode(generatedCode), [generatedCode]);
  const activeAdvancedStrategyGraph = useMemo(() => {
    if (!activeAdvancedGraph?.nodes.some((node) => node.type !== "groupNode")) return null;
    try {
      return advancedGraphToStrategyGraph(
        activeAdvancedGraph,
        activeSnapshot?.name || strategyTitle || "고급 보기 전략",
      );
    } catch {
      return null;
    }
  }, [activeAdvancedGraph, activeSnapshot?.name, strategyTitle]);
  const activeAdvancedGraphCode = useMemo(
    () => activeAdvancedStrategyGraph ? strategyGraphToCode(activeAdvancedStrategyGraph) : "",
    [activeAdvancedStrategyGraph],
  );
  const activeAdvancedGraphSignature = useMemo(
    () => activeAdvancedGraph ? createAdvancedGraphSignature(activeAdvancedGraph) : "",
    [activeAdvancedGraph],
  );
  const codeViewStrategyGraph = activeAdvancedStrategyGraph ?? generatedStrategyGraph;
  const codeViewStrategyGraphSignature = useMemo(
    () => (codeViewStrategyGraph ? stableStringify(codeViewStrategyGraph) : ""),
    [codeViewStrategyGraph],
  );
  const codeViewProgramSignature = codeViewStrategyGraphSignature;
  const hasProgramCodeForCodeView = Boolean(
    programCode.trim() &&
    codeViewProgramSignature &&
    programCodeRequestRef.current === codeViewProgramSignature,
  );
  const codeViewContent = hasProgramCodeForCodeView ? programCode : activeAdvancedGraphCode || generatedCode;
  const codeViewTitle = hasProgramCodeForCodeView
    ? "Hershy generated_strategy.go"
    : activeAdvancedStrategyGraph
      ? "Advanced View Strategy Graph"
      : generatedStrategyGraph
        ? "Hershy Strategy Graph"
        : "Hershy Strategy Code";
  const codeViewStatus = isGeneratingProgramCode
    ? "generating program"
    : hasProgramCodeForCodeView
      ? "program"
      : activeAdvancedStrategyGraph
        ? "advanced graph"
        : generatedStrategyGraph
          ? "graph"
          : "source";
  const activeSnapshotCodeMeta = useMemo<HistorySnapshotCodeMeta>(() => ({
    strategyTitle: activeSnapshot?.name || strategyTitle,
    strategySummary,
    generatedCode: activeAdvancedGraphCode || generatedCode,
    programCode: hasProgramCodeForCodeView ? programCode : "",
    strategyGraph: codeViewStrategyGraph,
    graphSignature: activeAdvancedGraphSignature || lastSyncedAdvancedGraphSignature,
    programCodeSignature: hasProgramCodeForCodeView ? codeViewProgramSignature : "",
    aiSummary,
    agentSteps,
  }), [
    activeAdvancedGraphCode,
    activeAdvancedGraphSignature,
    activeSnapshot?.name,
    agentSteps,
    aiSummary,
    codeViewProgramSignature,
    codeViewStrategyGraph,
    generatedCode,
    hasProgramCodeForCodeView,
    lastSyncedAdvancedGraphSignature,
    programCode,
    strategySummary,
    strategyTitle,
  ]);
  const activeSnapshotCodeMetaSignature = useMemo(
    () => codeMetaComparableSignature(activeSnapshotCodeMeta),
    [activeSnapshotCodeMeta],
  );
  const activeSnapshotStoredCodeMetaSignature = useMemo(
    () => codeMetaComparableSignature(activeSnapshot?.codeMeta),
    [activeSnapshot?.codeMeta],
  );

  const generateRuntimeProgramCode = useCallback(
    async (options?: { force?: boolean }) => {
      if (!codeViewStrategyGraph || isGeneratingProgramCode) return false;
      if (hasProgramCodeForCodeView && !options?.force) return true;
      if (codeViewProgramSignature && programCodeRequestRef.current === codeViewProgramSignature && !options?.force) {
        return false;
      }

      programCodeRequestRef.current = codeViewProgramSignature;
      setIsGeneratingProgramCode(true);
      setProgramCodeError("");
      try {
        const response = await fetch("/api/strategy/runtime-artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy: codeViewStrategyGraph }),
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
    [
      codeViewStrategyGraph,
      codeViewProgramSignature,
      hasProgramCodeForCodeView,
      isGeneratingProgramCode,
    ],
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

  const loadBalanceMyData = useCallback(async () => {
    try {
      const response = await fetch("/api/mydata/balances", {
        cache: "no-store",
        headers: withUserContextHeaders(),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "잔고 마이데이터를 불러오지 못했습니다."));
      setBalanceSnapshots(Array.isArray(data?.snapshots) ? data.snapshots as BalanceMyDataSnapshot[] : []);
    } catch {
      setBalanceSnapshots([]);
    }
  }, []);

  const syncExchangeBalance = useCallback(async (connectionId: string, market: "spot" | "futures" = "spot") => {
    if (!connectionId) return;
    setSyncingBalanceConnectionId(connectionId);
    setExchangeAuthMessage("");
    try {
      const response = await fetch(`/api/exchange-connections/${encodeURIComponent(connectionId)}/balances/sync`, {
        method: "POST",
        headers: withUserContextHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(withUserContextPayload({ market })),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.message || "잔고 동기화 실패"));
      if (Array.isArray(data?.connections)) {
        setExchangeConnections(data.connections as ExchangeConnection[]);
      }
      if (Array.isArray(data?.balanceSnapshots)) {
        setBalanceSnapshots(data.balanceSnapshots as BalanceMyDataSnapshot[]);
      } else if (data?.balanceSnapshot) {
        setBalanceSnapshots((prev) => [
          ...prev.filter((snapshot) => `${snapshot.connectionId || snapshot.exchangeId}:${snapshot.market || snapshot.accountType || "spot"}` !== `${connectionId}:${market}`),
          data.balanceSnapshot as BalanceMyDataSnapshot,
        ]);
      }
      const snapshot = data?.balanceSnapshot as BalanceMyDataSnapshot | undefined;
      const preferredAsset = snapshot?.spendable?.preferredAsset || "잔고";
      const preferredAvailable = snapshot?.spendable?.preferredAvailable || "";
      setExchangeAuthMessage(
        preferredAvailable
          ? `${preferredAsset} ${preferredAvailable} 사용 가능 · 마이데이터 동기화 완료`
          : "잔고 마이데이터 동기화 완료",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "잔고 동기화 실패";
      setExchangeAuthMessage(message);
      setAgentMessages((prev) => [...prev, { role: "ai", text: message }]);
    } finally {
      setSyncingBalanceConnectionId("");
    }
  }, []);

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
      if (Array.isArray(data?.balanceSnapshots)) {
        setBalanceSnapshots(data.balanceSnapshots as BalanceMyDataSnapshot[]);
      }
      const snapshot = data?.balanceSnapshot as BalanceMyDataSnapshot | undefined;
      const preferredAsset = snapshot?.spendable?.preferredAsset;
      const preferredAvailable = snapshot?.spendable?.preferredAvailable;
      setExchangeAuthMessage(
        `${exchangeAuthMarket === "futures" ? "Futures" : "Spot"} 잔고 동기화 성공${preferredAsset && preferredAvailable ? ` · ${preferredAsset} ${preferredAvailable} 사용 가능` : data?.account?.accountType ? ` · ${data.account.accountType}` : ""}`,
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
    setIsThemeMounted(true);
  }, []);

  useEffect(() => {
    const profile = getClientUserProfile();
    const hasCompletedStartGuide = readStartGuideCompleted(profile.userId);
    setClientUserId(profile.userId);
    setIsPersonalLoggedIn(profile.isLoggedIn);
    setIsGuideCompleted(hasCompletedStartGuide);
    if (profile.isLoggedIn && !hasCompletedStartGuide) {
      setGuideDone(new Set());
      setGuideStep(0);
      setIsGuideOpen(true);
    }
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

    const unsubHistory = historyStore.subscribe(() => {
      setOpenTabs(historyStore.getOpenTabs());
      setActiveTabId(historyStore.getActiveId());
      setSnapshots(historyStore.getSnapshots());
    });

    return () => {
      unsubHistory();
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
    setStrategyTitle(persisted.strategyTitle);
    setStrategySummary(persisted.strategySummary);
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
      strategyTitle,
      strategySummary,
      advancedGraphModel,
      lastSyncedAdvancedGraphSignature,
      aiSummary,
      agentSteps,
    });
  }, [generatedCode, programCode, strategyTitle, strategySummary, advancedGraphModel, lastSyncedAdvancedGraphSignature, aiSummary, agentSteps]);

  useEffect(() => {
    activeSnapshotCodeMetaRef.current = activeSnapshotCodeMeta;
  }, [activeSnapshotCodeMeta]);

  useEffect(() => {
    const snapshotId = activeSnapshot?.id ?? null;
    const snapshotHydrationSignature = activeSnapshot
      ? stableStringify({
        id: activeSnapshot.id,
        name: activeSnapshot.name,
        codeMeta: compactCodeMetaForSignature(activeSnapshot.codeMeta),
      })
      : "none";
    if (lastAppliedSnapshotHydrationSignatureRef.current === snapshotHydrationSignature) return;
    lastAppliedSnapshotHydrationSignatureRef.current = snapshotHydrationSignature;
    lastAppliedSnapshotCodeMetaIdRef.current = snapshotId;
    if (!activeSnapshot) return;

    const snapshotGraph = activeSnapshot.nodes.length > 0
      ? {
        nodes: activeSnapshot.nodes as AdvancedGraphModel["nodes"],
        edges: activeSnapshot.edges as AdvancedGraphModel["edges"],
      }
      : null;
    const meta = activeSnapshot.codeMeta;
    const derived = getAdvancedGraphCodeState(
      snapshotGraph,
      meta?.strategyTitle || activeSnapshot.name || strategyTitle,
      meta?.strategySummary || strategySummary,
    );
    const nextSummary = meta?.strategySummary || derived.strategySummary || EMPTY_STRATEGY_SUMMARY;
    const nextProgramCode = meta?.programCode || "";

    skipNextSnapshotCodeMetaSyncRef.current = true;
    setGeneratedCode((current) => {
      const next = meta?.generatedCode ?? derived.generatedCode;
      return current === next ? current : next;
    });
    setProgramCode((current) => current === nextProgramCode ? current : nextProgramCode);
    programCodeRequestRef.current = nextProgramCode
      ? meta?.programCodeSignature || derived.programCodeSignature
      : "";
    setStrategyTitle((current) => {
      const next = meta?.strategyTitle || activeSnapshot.name || EMPTY_STRATEGY_TITLE;
      return current === next ? current : next;
    });
    setStrategySummary((current) => current === nextSummary ? current : nextSummary);
    setLastSyncedAdvancedGraphSignature((current) => {
      const next = meta?.graphSignature || derived.graphSignature;
      return current === next ? current : next;
    });
    setAiSummary((current) => {
      const next = meta?.aiSummary || `AI 요약: ${nextSummary}`;
      return current === next ? current : next;
    });
    setAgentSteps((current) => {
      const next = meta?.agentSteps?.length ? meta.agentSteps : [...DEFAULT_AGENT_STEPS];
      return stringArraysEqual(current, next) ? current : next;
    });
  }, [activeSnapshot, strategySummary, strategyTitle]);

  useEffect(() => {
    if (!activeTabId || isRestoringStrategyStateRef.current) return;
    if (lastAppliedSnapshotCodeMetaIdRef.current !== activeTabId) return;
    if (skipNextSnapshotCodeMetaSyncRef.current) {
      skipNextSnapshotCodeMetaSyncRef.current = false;
      return;
    }

    const codeMeta = activeSnapshotCodeMetaRef.current;
    const nextCodeMetaSignature = codeMetaComparableSignature(codeMeta);
    if (activeSnapshotStoredCodeMetaSignature === nextCodeMetaSignature) {
      lastCodeMetaWriteSignatureRef.current = "";
      return;
    }

    if (codeMeta) {
      const writeSignature = `${activeTabId}:${nextCodeMetaSignature}`;
      if (lastCodeMetaWriteSignatureRef.current === writeSignature) {
        return;
      }
      lastCodeMetaWriteSignatureRef.current = writeSignature;
      historyStore.updateActiveSnapshotCodeMeta(codeMeta);
    }
  }, [activeSnapshotCodeMetaSignature, activeSnapshotStoredCodeMetaSignature, activeTabId]);

  useEffect(() => {
    void loadExchangeConnections();
    void loadBalanceMyData();
    void loadMarketOverview();
    const timer = window.setInterval(() => {
      void loadMarketOverview();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadBalanceMyData, loadExchangeConnections, loadMarketOverview]);

  useEffect(() => {
    if (!codeViewStrategyGraph || !codeViewStrategyGraphSignature || hasProgramCodeForCodeView) return;
    const delayMs = mainView === "advanced" || mainView === "code" ? 450 : 1400;
    const timer = window.setTimeout(() => {
      void generateRuntimeProgramCode();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    codeViewStrategyGraph,
    codeViewStrategyGraphSignature,
    generateRuntimeProgramCode,
    hasProgramCodeForCodeView,
    mainView,
  ]);

  const guideProgress = Math.min(guideDone.size, GUIDE_ITEMS.length);
  const shouldShowStartGuide = isPersonalLoggedIn && !isGuideCompleted;
  const handleSave = () => {
    window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));
  };

  const handleMainViewChange = (nextView: MainView) => {
    if (nextView === mainView) return;
    setMainView(nextView);
  };

  const syncAdvancedGraphFromCanvas = useCallback(
    (graph: AdvancedGraphModel, name = strategyTitle || "고급 보기 전략") => {
      if (!graph.nodes.some((node) => node.type !== "groupNode")) return false;

      const strategyGraph = advancedGraphToStrategyGraph(graph, name);
      const signature = createAdvancedGraphSignature(graph);
      const summary = getStrategyGraphSummary(strategyGraph, strategySummary);

      setGeneratedCode(strategyGraphToCode(strategyGraph));
      programCodeRequestRef.current = "";
      setProgramCode("");
      setStrategyTitle(name);
      setStrategySummary(summary);
      setAdvancedGraphModel(graph);
      setAdvancedGraphVersion((version) => version + 1);
      setLastSyncedAdvancedGraphSignature(signature);
      setAiSummary(`AI 요약: ${summary}`);
      return true;
    },
    [strategySummary, strategyTitle],
  );

  useEffect(() => {
    const handleHistorySnapshotSaved = (event: Event) => {
      const snapshot = (event as CustomEvent<HistorySnapshot>).detail;
      if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) return;

      const graph: AdvancedGraphModel = {
        nodes: snapshot.nodes as AdvancedGraphModel["nodes"],
        edges: snapshot.edges as AdvancedGraphModel["edges"],
      };
      syncAdvancedGraphFromCanvas(graph, snapshot.name);
    };

    window.addEventListener("historySnapshotSaved", handleHistorySnapshotSaved);
    return () => window.removeEventListener("historySnapshotSaved", handleHistorySnapshotSaved);
  }, [syncAdvancedGraphFromCanvas]);

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

  const completeStartGuide = useCallback(() => {
    if (clientUserId) {
      writeStartGuideCompleted(clientUserId);
    }
    setGuideDone(new Set(GUIDE_ITEMS.map((_, index) => index)));
    setIsGuideCompleted(true);
    setIsGuideOpen(false);
  }, [clientUserId]);

  const handleGuideNext = () => {
    setGuideDone((prev) => {
      const next = new Set(prev);
      for (let index = 0; index <= guideStep; index += 1) {
        next.add(index);
      }
      return next;
    });
    if (guideStep >= GUIDE_ITEMS.length - 1) {
      completeStartGuide();
      return;
    }
    setGuideStep((current) => Math.min(current + 1, GUIDE_ITEMS.length - 1));
  };

  const handleCloseGuide = () => {
    setIsGuideOpen(false);
  };

  const handleDismissGuide = () => {
    completeStartGuide();
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
      const appendAgentActivity = (rawActivity: unknown) => {
        const activity = normalizeAgentActivities([rawActivity])[0];
        if (!activity) return;
        setAgentActivities((prev) => {
          const next = [...prev.filter((item) => item.id !== activity.id), activity].slice(-60);
          setAgentSteps(agentStepsFromActivities(next));
          return next;
        });
      };

      appendAgentActivity({
        id: "strategy-intent",
        status: "running",
        stage: "intent",
        label: "요청 해석 및 전략 초안 준비",
        timestamp: new Date().toISOString(),
      });
      appendAgentActivity({
        id: "strategy-pipeline",
        status: "running",
        stage: "research",
        label: "전략 생성 파이프라인 실행",
        timestamp: new Date().toISOString(),
      });

      const response = await fetch("/api/ai/strategy-draft", {
        method: "POST",
        headers: withUserContextHeaders({ "Content-Type": "application/json" }),
        signal: controller.signal,
        body: JSON.stringify(withUserContextPayload({
          prompt,
          current_strategy: {
            code: generatedCode,
            title: strategyTitle,
            summary: strategySummary,
          },
        })),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          `${String(errorData?.message || errorData?.error || `AI API 요청 실패 (${response.status})`)}${formatAILogicErrorLog(errorData?.logicErrorLog)}`,
        );
      }
      const data = await response.json();
      appendAgentActivity({
        id: "strategy-pipeline",
        status: "done",
        stage: "research",
        label: "전략 생성 파이프라인 완료",
        timestamp: new Date().toISOString(),
      });
      if (!data?.strategy?.blocks || !data?.strategy?.connections) {
        throw new Error("AI 응답에 strategy graph가 없습니다.");
      }

      appendAgentActivity({
        status: "running",
        stage: "frontend-materialize",
        label: "프론트 그래프와 고급 캔버스 반영",
        timestamp: new Date().toISOString(),
      });
      const result = materializeAdvancedStrategyGraph(data.strategy, prompt);
      const advancedGraph = result.advancedGraph;
      if (!advancedGraph || advancedGraph.nodes.length === 0) {
        throw new Error("고급 전략 그래프가 완성되지 않았습니다.");
      }
      const nextProgramCode = extractRuntimeProgramCode(data.runtime);
      const nextGraphState = getAdvancedGraphCodeState(advancedGraph, result.title, result.summary);
      const nextAISummary = formatStrategyAISummary(data, result.summary);
      const nextProgramCodeSignature = nextProgramCode ? nextGraphState.programCodeSignature : "";
      const nextCodeMeta: HistorySnapshotCodeMeta = {
        strategyTitle: result.title,
        strategySummary: result.summary,
        generatedCode: result.code,
        programCode: nextProgramCode,
        strategyGraph: nextGraphState.strategyGraph ?? data.strategy,
        graphSignature: nextGraphState.graphSignature,
        programCodeSignature: nextProgramCodeSignature,
        aiSummary: nextAISummary,
        agentSteps: result.steps,
      };
      setGeneratedCode(result.code);
      programCodeRequestRef.current = nextProgramCodeSignature;
      setProgramCode(nextProgramCode);
      setStrategyTitle(result.title);
      setStrategySummary(result.summary);
      setAdvancedGraphModel(advancedGraph);
      setAdvancedGraphVersion((version) => version + 1);
      setLastSyncedAdvancedGraphSignature(nextGraphState.graphSignature);
      setAgentSteps(result.steps);
      setAiSummary(nextAISummary);
      setGuideDone((prev) => new Set([...prev, 1]));
      setMainView("advanced");

      // Advanced View 업데이트
      if (!historyStore.getActiveId()) {
        historyStore.createEmptyStrategy(null, result.title, nextCodeMeta);
      } else {
        historyStore.updateSnapshotName(historyStore.getActiveId()!, result.title);
      }
      historyStore.updateActiveSnapshot(advancedGraph.nodes, advancedGraph.edges, nextCodeMeta);
      window.dispatchEvent(
        new CustomEvent("loadSnapshot", {
          detail: {
            nodes: advancedGraph.nodes,
            edges: advancedGraph.edges,
          },
        })
      );

      setAgentMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: `${data.message || "AI strategy draft generated"}\n\n${nextAISummary}`,
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
              ? `AI 에이전트 응답 실패: ${message}\n\n요청 시간이 길어져 중단되었습니다. 웹 검색, KG 검색, validator 환경을 확인한 뒤 다시 시도하세요. 로컬 데모로 대체하지 않았습니다.`
              : `AI 에이전트 응답 실패: ${message}\n\n로컬 데모로 대체하지 않았습니다. 서버의 KG_DATABASE_URL/DATABASE_URL, 웹 검색 provider, validator 상태를 확인하세요.`,
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

  useEffect(() => {
    let stopped = false;

    const loadCodexStrategyInbox = async () => {
      if (stopped || isAgentRunning) return;
      try {
        const response = await fetch("/api/codex/strategy-inbox?consume=true", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        if (!payload?.hasStrategy || !payload?.result?.strategy) return;
        const inboxId = typeof payload.id === "string" ? payload.id : "";
        if (!inboxId || codexStrategyInboxIdRef.current === inboxId) return;

        const data = payload.result;
        const shouldReplaceExisting = payload.replaceExisting === true || data.replaceExisting === true;
        const prompt = typeof payload.prompt === "string" && payload.prompt.trim()
          ? payload.prompt.trim()
          : typeof data.prompt === "string"
            ? data.prompt
            : "Codex generated strategy";
        let result: ReturnType<typeof materializeAdvancedStrategyGraph>;
        let advancedGraph: AdvancedGraphModel;
        try {
          result = materializeAdvancedStrategyGraph(data.strategy, prompt);
          if (!result.advancedGraph || result.advancedGraph.nodes.length === 0) {
            throw new Error("Codex 전략을 고급 보기 그래프로 변환하지 못했습니다.");
          }
          advancedGraph = result.advancedGraph;
        } catch (error) {
          if (codexStrategyInboxErrorIdRef.current !== inboxId) {
            codexStrategyInboxErrorIdRef.current = inboxId;
            const message = error instanceof Error ? error.message : "알 수 없는 변환 오류";
            setAgentActivities((prev) => [
              ...prev,
              {
                id: `codex-inbox-error-${inboxId}`,
                status: "error",
                stage: "strategy-load-error",
                label: "Codex 전략을 UI 그래프로 변환하지 못했습니다.",
                timestamp: new Date().toISOString(),
                detail: { inboxId, error: message },
              },
            ]);
            setAgentMessages((prev) => [
              ...prev,
              {
                role: "ai",
                text: `Codex 전략 로드 실패: ${message}\n\n하네스는 AI 리서치/랭킹 루프가 아니라 실제 트레이딩 로직 그래프만 UI 시퀀스로 받습니다.`,
              },
            ]);
          }
          return;
        }
        codexStrategyInboxIdRef.current = inboxId;
        codexStrategyInboxErrorIdRef.current = "";

        const nextProgramCode = extractRuntimeProgramCode(data.runtime);
        const nextGraphState = getAdvancedGraphCodeState(advancedGraph, result.title, result.summary);
        const strategySummaryText = formatStrategyAISummary(data, result.summary);
        const nextProgramCodeSignature = nextProgramCode ? nextGraphState.programCodeSignature : "";
        const nextCodeMeta: HistorySnapshotCodeMeta = {
          strategyTitle: result.title,
          strategySummary: result.summary,
          generatedCode: result.code,
          programCode: nextProgramCode,
          strategyGraph: nextGraphState.strategyGraph ?? data.strategy,
          graphSignature: nextGraphState.graphSignature,
          programCodeSignature: nextProgramCodeSignature,
          aiSummary: strategySummaryText,
          agentSteps: result.steps,
        };
        setGeneratedCode(result.code);
        programCodeRequestRef.current = nextProgramCodeSignature;
        setProgramCode(nextProgramCode);
        setStrategyTitle(result.title);
        setStrategySummary(result.summary);
        setAdvancedGraphModel(advancedGraph);
        setAdvancedGraphVersion((version) => version + 1);
        setLastSyncedAdvancedGraphSignature(nextGraphState.graphSignature);
        setAgentSteps(result.steps);
        setAiSummary(strategySummaryText);
        setMainView("advanced");
        setActiveWorkspace("create");

        if (shouldReplaceExisting) {
          if (canUseBrowserStorage()) {
            window.localStorage.removeItem(STRATEGY_BUILDER_STORAGE_KEY);
          }
          const existingSnapshotIds = historyStore.getSnapshots().map((snapshot) => snapshot.id);
          if (existingSnapshotIds.length > 0) {
            historyStore.deleteSnapshots(existingSnapshotIds);
          }
          historyStore.createEmptyStrategy(null, result.title, nextCodeMeta);
        } else if (!historyStore.getActiveId()) {
          historyStore.createEmptyStrategy(null, result.title, nextCodeMeta);
        } else {
          historyStore.updateSnapshotName(historyStore.getActiveId()!, result.title);
        }
        historyStore.updateActiveSnapshot(advancedGraph.nodes, advancedGraph.edges, nextCodeMeta);
        window.dispatchEvent(new CustomEvent("loadSnapshot", { detail: { nodes: advancedGraph.nodes, edges: advancedGraph.edges } }));
        setAgentActivities([]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `${payload.message || "Codex generated strategy"}\n\n${strategySummaryText}`,
          },
        ]);
      } catch {
        // The inbox is a local Codex bridge; polling should stay quiet if it is unavailable.
      }
    };

    void loadCodexStrategyInbox();
    const timer = window.setInterval(loadCodexStrategyInbox, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isAgentRunning]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex dark:border-slate-800 dark:bg-slate-950",
          isLeftPanelCollapsed ? "w-[52px]" : "w-[164px]",
        )}
      >
        <div
          className={cn(
            "flex h-[52px] items-center border-b border-slate-200 dark:border-slate-800",
            isLeftPanelCollapsed ? "justify-center px-1" : "gap-2 px-3",
          )}
        >
          {isLeftPanelCollapsed ? (
            <button
              type="button"
              onClick={() => setIsLeftPanelCollapsed(false)}
              aria-label="왼쪽 패널 펼치기"
              title="왼쪽 패널 펼치기"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <>
              <div className="min-w-0 flex-1 truncate text-[15px] font-black tracking-[-0.01em]">ThirdEye</div>
              <button
                type="button"
                onClick={() => setIsLeftPanelCollapsed(true)}
                aria-label="왼쪽 패널 접기"
                title="왼쪽 패널 접기"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <nav className={cn("flex-1 space-y-1 overflow-y-auto py-3", isLeftPanelCollapsed ? "px-1.5" : "px-2")}>
          {NAV_ITEMS.map((item) => {
            const workspaceId = isWorkspaceNavId(item.id) ? item.id : null;
            const isInteractive = Boolean(workspaceId);
            const isActive = workspaceId === activeWorkspace;
            return (
              <button
                key={item.id}
                type="button"
                onClick={workspaceId ? () => setActiveWorkspace(workspaceId) : undefined}
                title={isInteractive ? item.label : `${item.label} · 준비 중`}
                className={cn(
                  "flex h-10 w-full items-center border-l-2 border-transparent text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900",
                  isLeftPanelCollapsed ? "justify-center px-0" : "gap-2 px-2.5",
                  !isInteractive && "cursor-default opacity-55 hover:bg-transparent",
                  isActive && "border-violet-600 bg-slate-50 text-slate-950 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100",
                )}
              >
                {isLeftPanelCollapsed ? (
                  <span className="text-xs font-black">{item.shortLabel}</span>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
                {!isLeftPanelCollapsed && !isInteractive ? (
                  <span className="ml-auto border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    soon
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {isLeftPanelCollapsed ? (
          <div className="grid gap-2 border-t border-slate-200 px-1.5 py-2.5 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              aria-label="거래소 연결 관리"
              title="거래소 연결 관리"
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center border text-[11px] font-black transition-colors",
                connectedExchangeCount > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              거
              {connectedExchangeCount > 0 ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setIsLeftPanelCollapsed(false)}
              aria-label="플랜 패널 펼치기"
              title={`Plan: ${planTier}`}
              className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-[11px] font-black text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              P
            </button>
          </div>
        ) : (
        <div className="border-t border-slate-200 p-2.5 dark:border-slate-800">
          <section className="border-b border-slate-200 pb-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-300">거래소 연결</div>
            <div className="mb-2 grid grid-cols-2 gap-1">
              {exchangeConnections.map((exchange) => (
                <button
                  key={exchange.id}
                  type="button"
                  onClick={() => setExchangeTab(exchange.id)}
                  className={cn(
                    "border px-1.5 py-1 text-[10px] font-bold capitalize",
                    exchangeTab === exchange.id
                      ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-200"
                      : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400",
                  )}
                >
                  {exchange.id}
                </button>
              ))}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">
                {selectedExchange?.name ?? "거래소 연결 필요"}
                {connectedExchangeCount > 0 ? ` (${connectedExchangeCount})` : ""}
              </div>
              <div className={cn("text-[11px] font-semibold", selectedExchange?.status === "연결됨" ? "text-emerald-600 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400")}>
                {selectedExchange?.status ?? "대기"}
              </div>
            </div>
            {selectedExchange?.rpcUrl || selectedExchange?.apiUrl || selectedExchange?.wsUrl ? (
              <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                API/RPC URL 저장됨
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              className="mt-2 h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              거래소 연결 관리
            </button>
          </section>

          <section className="border-b border-slate-200 py-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-300">
              Plan
            </div>
            <div className="mb-2 grid grid-cols-3 gap-1">
              {(["free", "pro", "team"] as PlanTier[]).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setPlanTier(tier)}
                  className={cn(
                    "border px-1 py-1 text-[10px] font-bold uppercase",
                    planTier === tier
                      ? "border-violet-400 bg-white text-violet-700 dark:bg-slate-950 dark:text-violet-200"
                      : "border-violet-100 bg-violet-100/60 text-violet-400 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300/70",
                  )}
                >
                  {tier}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">만료일 2026-06-30</div>
            <button className="mt-2 h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              플랜 관리
            </button>
          </section>
        </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-950">
          {isCreateWorkspace ? (
            <div className="flex min-w-0 overflow-x-auto">
              {MAIN_VIEW_TABS.map((tab) => {
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleMainViewChange(tab.id)}
                    className={cn(
                      "inline-flex h-[52px] shrink-0 items-center border-b-2 border-transparent px-3 text-xs font-bold",
                      mainView === tab.id ? "border-violet-600 text-slate-950 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Portfolio
              </div>
              <div className="truncate text-sm font-black text-slate-950 dark:text-slate-100">
                거래소별 자산과 가용 자금을 추적합니다
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(isDarkMode ? "light" : "dark")}
              className="inline-flex h-9 items-center border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              title={isDarkMode ? "라이트 모드로 전환" : "다크 모드로 전환"}
            >
              <span>{isDarkMode ? "라이트" : "다크"}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              className="inline-flex h-9 items-center border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              거래소
            </button>
            {isCreateWorkspace ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex h-9 items-center bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700"
                >
                  저장
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsExchangeLibraryOpen(true)}
                className="inline-flex h-9 items-center bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
              >
                거래소 연결 관리
              </button>
            )}
          </div>
        </header>

        <main
          className={cn(
            "grid min-h-0 flex-1 overflow-hidden",
            isCreateWorkspace
              ? isRightPanelCollapsed
                ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_52px]"
                : "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_clamp(246px,20vw,320px)]"
              : "grid-cols-1",
          )}
        >
          <section className="flex min-w-0 flex-col overflow-hidden">
            {isCreateWorkspace ? (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">
              {mainView === "advanced" ? (
                <div className="h-full">
                  <NodeEditor
                    initialGraph={advancedGraphModel}
                    initialGraphVersion={advancedGraphVersion}
                    programCode={programCode}
                  />
                  {openTabs.length === 0 ? (
                    <div className="pointer-events-none absolute inset-x-[180px] top-[210px] z-20 flex justify-center">
                      <div className="pointer-events-auto border border-slate-200 bg-white px-4 py-3 text-center text-sm">
                        <div className="font-bold text-slate-900">열려 있는 전략 탭이 없습니다</div>
                        <button
                          onClick={() => historyStore.createEmptyStrategy(null)}
                          className="mt-2 bg-violet-600 px-3 py-1.5 text-xs font-bold text-white"
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
                      {codeViewTitle}
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black", hasProgramCodeForCodeView ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
                        {codeViewStatus}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void generateRuntimeProgramCode({ force: true })}
                      disabled={!codeViewStrategyGraph || isGeneratingProgramCode}
                      className="border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isGeneratingProgramCode ? "생성 중" : "Hershy Go 생성"}
                    </button>
                  </div>
                  {programCodeError ? (
                    <div className="mb-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
                      {programCodeError}
                    </div>
                  ) : null}
                  <pre className="border border-slate-800 bg-black/40 p-4 text-sm leading-7 text-emerald-200">
                    {codeViewContent}
                  </pre>
                </div>
              ) : null}
              </div>
            ) : (
              <PortfolioWorkspace
                exchangeConnections={exchangeConnections}
                balanceSnapshots={balanceSnapshots}
                marketRows={marketRows}
                strategyCount={snapshots.length}
                syncingBalanceConnectionId={syncingBalanceConnectionId}
                onSyncBalance={syncExchangeBalance}
                onManageExchanges={() => setIsExchangeLibraryOpen(true)}
              />
            )}
          </section>

          {isCreateWorkspace ? (
            <PageRightRail
              marketUpdatedAt={marketUpdatedAt}
              marketWarning={marketWarning}
              marketRows={marketRows}
              isAgentRunning={isAgentRunning}
              onCancelAgentRun={handleCancelAgentRun}
              strategySummary={stripAISummaryPrefix(aiSummary)}
              programCode={programCode}
              showGuide={shouldShowStartGuide}
              guideItems={GUIDE_ITEMS}
              guideDone={guideDone}
              onOpenGuide={() => setIsGuideOpen(true)}
              onSelectGuideStep={(index) => {
                setGuideStep(index);
                setIsGuideOpen(true);
              }}
              isCollapsed={isRightPanelCollapsed}
              onToggleCollapsed={() => setIsRightPanelCollapsed((value) => !value)}
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

      {isGuideOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-6">
          <section className="w-full max-w-lg border border-slate-200 bg-white">
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
                className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="튜토리얼 닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              <div className="border-l-2 border-violet-300 bg-slate-50 px-4 py-3">
                <p className="text-sm leading-6 text-slate-800">
                  {guideStep === 0
                    ? "좌측 거래소 연결 탭에서 API 권한을 확인하세요. 읽기/거래 권한 상태가 연결됨으로 표시되면 전략을 만들 수 있습니다."
                    : null}
                  {guideStep === 1
                    ? "우측 하단 AI 전략 템플릿에서 추천 전략을 고르거나 입력 탭에 원하는 전략을 말로 적어 고급 전략 캔버스를 생성하세요."
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
                      "h-1 flex-1",
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
                onClick={handleDismissGuide}
                className="text-sm font-bold text-slate-500 hover:text-slate-800"
              >
                다시 보지 않기
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGuideStep((current) => Math.max(0, current - 1))}
                  disabled={guideStep === 0}
                  className="h-9 border border-slate-200 px-3 text-sm font-bold text-slate-600 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={handleGuideNext}
                  className="h-9 bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700"
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
          <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                  AI 전략 템플릿
                </div>
                <div className="text-sm font-black text-slate-950 dark:text-slate-100">
                  빠른 추천과 직접 입력
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setTemplatePanelMode((mode) => (mode === "compact" ? "expanded" : "compact"))
                  }
                  className="border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                >
                  {templatePanelMode === "compact" ? "확장" : "간소화"}
                </button>
              </div>
            </div>

            <div className="p-3">
              <div className="mb-3">
                <div className="mb-2 text-xs font-black text-slate-700 dark:text-slate-300">빠른 추천</div>
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
                          "border border-slate-200 bg-white p-3 text-left transition-colors hover:border-violet-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-violet-400/40 dark:hover:bg-slate-900",
                          templatePanelMode === "compact" && "px-2 py-2",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-black text-slate-900 dark:text-slate-100">{template.title}</div>
                            {templatePanelMode === "expanded" ? (
                              <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{template.summary}</p>
                            ) : (
                              <div className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">{template.tags.join(" · ")}</div>
                            )}
                          </div>
                        </div>
                        {templatePanelMode === "expanded" ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {template.tags.map((tag) => (
                              <span key={tag} className="border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
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

              <div className="mb-3 max-h-44 space-y-2 overflow-y-auto border-y border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
                {agentMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={cn(
                      "whitespace-pre-wrap border-l-2 px-3 py-2 text-xs leading-5",
                      message.role === "user" ? "ml-8 bg-violet-600 text-white" : "mr-8 bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200",
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
                  className="w-full resize-none border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-violet-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400"
                  placeholder="예) BTC 20MA 돌파와 거래량 증가를 기준으로 진입하고, 1.2% 트레일링 스톱을 넣어줘"
                />
                <button
                  type="submit"
                  disabled={!agentPrompt.trim() || isAgentRunning}
                  className="inline-flex h-9 w-full items-center justify-center bg-violet-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAgentRunning ? "에이전트 생성 중" : "에이전트에게 보내기"}
                </button>
                {isAgentRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelAgentRun}
                    className="inline-flex h-9 w-full items-center justify-center border border-violet-200 bg-white text-sm font-bold text-violet-700 transition-colors hover:bg-violet-50 dark:border-violet-400/30 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-violet-400/10"
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
            className="inline-flex h-10 items-center bg-violet-600 px-4 text-sm font-black text-white transition-colors hover:bg-violet-700"
          >
            {isAgentRunning ? "전략 생성 중" : "AI 전략 템플릿"}
          </button>
        </div>
      ) : null}

    </div>
  );
}
