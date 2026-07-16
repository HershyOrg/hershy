import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  X,
} from "@/shared/components/icons";
import { useTheme } from "@/shared/components/theme-provider";
import { ExchangeLibraryModal } from "@/features/home/components/ExchangeLibraryModal";
import { PortfolioWorkspace } from "@/features/home/components/PortfolioWorkspace";
import { ScwOnboardingManagerModal, ScwOnboardingPanel } from "@/features/scw-onboarding";
import {
  AI_STRATEGY_TEMPLATES,
  DEFAULT_CEX_TRADE_EXCHANGE,
  EXCHANGE_CONNECTIONS,
  EXCHANGE_CONNECTION_NAMES,
  GUIDE_ITEMS,
  MAIN_VIEW_TABS,
  MARKET_ROWS,
  NAV_ITEMS,
  buildExchangeFormFromConnection,
  createEmptyExchangeForm,
  type StrategyTemplate,
} from "@/features/home/config/homeConfig";
import type {
  AgentActivity,
  BalanceMyDataSnapshot,
  ExchangeConnection,
  ExchangeFormState,
  MarketRow,
} from "@/features/home/types/homeTypes";
import { ApiHistoricalDataTab } from "@/features/strategy-editor/components/ApiHistoricalDataTab";
import { NodeEditor } from "@/features/strategy-editor/components/NodeEditor";
import { getSpyThreeDownDayTradeStrategyNodes } from "@/features/strategy-editor/mock-data/demo-strategies";
import {
  advancedGraphToStrategyGraph,
  createAdvancedViewFromStrategyGraph,
  strategyGraphToCode,
  type StrategyGraphPayload,
} from "@/features/strategy-editor/utils/strategyGraph";
import { historyStore, type HistorySnapshot, type HistorySnapshotCodeMeta } from "@/features/strategy-editor/store/historyStore";
import {
  clearStrategyBuilderState,
  readGuideCompleted,
  readStrategyBuilderState,
  writeGuideCompleted,
  writeStrategyBuilderState,
} from "@/shared/store/clientStateStore";
import type {
  AdvancedGraphModel,
  HistoricalDataDataset,
  PersistedStrategyBuilderState,
} from "@/shared/types/domain";
import { cn } from "@/shared/utils/utils";
import {
  createDummyStrategyDraft,
  getDummyCodexStrategyInbox,
  getDummyMarketOverview,
  getDummyRuntimeArtifacts,
  listDummyBalanceSnapshots,
  listDummyExchangeConnections,
  saveDummyExchangeConnection,
  syncDummyExchangeBalance,
  testDummyBinanceAuth,
} from "@/shared/api/dummyApi";
import {
  getClientUserProfile,
} from "@/shared/api/userContextClient";

type MainView = "advanced" | "api-data" | "code";
type ExchangeTab = string;
type PlanTier = "free" | "pro" | "team";
type WorkspaceView = "create" | "portfolio";
type GenerationNotice = {
  title: string;
  detail: string;
  sourceUrl?: string;
};

const EMPTY_STRATEGY_TITLE = "New Strategy";
const EMPTY_STRATEGY_SUMMARY = "No strategy has been generated yet. Ask the AI for a strategy or choose a template to start.";
const SPY_THREE_DOWN_STRATEGY_TITLE = "SPY 3-Day Down Mean Reversion Day Trade";
const SPY_THREE_DOWN_STRATEGY_SESSION_KEY = "hershy-spy-three-down-strategy-opened-v8";
const SPY_THREE_DOWN_STRATEGY_TEMPLATE_ID = "spy-3-days-down-overnight";
const SPY_THREE_DOWN_STRATEGY_SOURCE_URL =
  "https://quantifiedstrategies.substack.com/p/3-days-down-overnight-trading-strategy-942?utm_source=chatgpt.com";
const SPY_THREE_DOWN_DEMO_DELAY_MS = 30_000;
const SPY_THREE_DOWN_STRATEGY_SUMMARY =
  "SPY day-trade mean reversion rule: require three consecutive close-to-close down sessions, enter long at the third down close, then exit at the next session open or close.";

function isWorkspaceNavId(value: string): value is WorkspaceView {
  return value === "create" || value === "portfolio";
}

function isConnectedExchangeStatus(status?: string | null) {
  return status === "Connected" || status === "Saved" || status === "Synced";
}

function isSpyThreeDownStrategyPrompt(value: string) {
  const text = value.toLowerCase();
  return text.includes(SPY_THREE_DOWN_STRATEGY_TEMPLATE_ID) ||
    text.includes("quantifiedstrategies.substack.com/p/3-days-down-overnight-trading-strategy-942") ||
    (text.includes("spy") && text.includes("three") && text.includes("down") && text.includes("overnight"));
}

function waitForDemoStrategyDelay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, SPY_THREE_DOWN_DEMO_DELAY_MS);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", abort, { once: true });
  });
}

function readStartGuideCompleted(userId: string) {
  return readGuideCompleted(userId);
}

function writeStartGuideCompleted(userId: string) {
  writeGuideCompleted(userId);
}

function isAdvancedGraphModel(value: unknown): value is AdvancedGraphModel {
  if (!value || typeof value !== "object") return false;
  const graph = value as Record<string, unknown>;
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

const DEFAULT_AGENT_STEPS = [
  "Check exchange connection",
  "Generate an AI strategy or choose a template",
  "Create the advanced strategy canvas",
] as const;

function getNodeDataForAdvancedStructureSignature(node: AdvancedGraphModel["nodes"][number]) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return data;
}

function readPersistedStrategyBuilderState(): PersistedStrategyBuilderState | null {
  try {
    const parsed = readStrategyBuilderState() as Partial<PersistedStrategyBuilderState> | null;
    if (!parsed) return null;
    if (parsed.version !== 2) return null;

    const advancedGraphModel = isAdvancedGraphModel(parsed.advancedGraphModel) ? parsed.advancedGraphModel : null;
    const restoredGeneratedCode = typeof parsed.generatedCode === "string" ? parsed.generatedCode : "";
    const restoredProgramCode = typeof parsed.programCode === "string" ? parsed.programCode : "";
    const restoredStrategySummary = typeof parsed.strategySummary === "string" ? parsed.strategySummary : EMPTY_STRATEGY_SUMMARY;
    const restoredAiSummary = typeof parsed.aiSummary === "string" ? parsed.aiSummary : `AI Summary: ${restoredStrategySummary}`;
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
  try {
    const payload: PersistedStrategyBuilderState = {
      version: 2,
      savedAt: Date.now(),
      ...state,
    };
    writeStrategyBuilderState(payload);
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
      return `Built from ${blocks ?? 0} strategy graph nodes and ${connections ?? 0} connections.`;
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
      "Received strategy graph",
      "Created advanced strategy canvas",
      "Validated executable nodes and edges",
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

function stripAISummaryPrefix(value: string) {
  return value.replace(/^AI\s*Summary\s*[:：]\s*/i, "").trim();
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
    readiness ? `Execution readiness: ${readiness}` : "",
    ...riskNotes.map((item) => `Risk: ${item}`),
  ].filter(Boolean);
  return `AI Summary: ${lines.join("\n") || "Could not prepare a strategy summary."}`;
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

export default function App() {
  const { resolvedTheme, setTheme } = useTheme();
  const [isThemeMounted, setIsThemeMounted] = useState(false);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("create");
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [mainView, setMainView] = useState<MainView>("advanced");
  const [exchangeTab, setExchangeTab] = useState<ExchangeTab>(EXCHANGE_CONNECTIONS[0]?.id ?? "binance");
  const [planTier, setPlanTier] = useState<PlanTier>("pro");
  const [marketRows, setMarketRows] = useState<MarketRow[]>(MARKET_ROWS);
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
  const [guideDone, setGuideDone] = useState<Set<number>>(new Set());
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isExchangeLibraryOpen, setIsExchangeLibraryOpen] = useState(false);
  const [isWalletManagerOpen, setIsWalletManagerOpen] = useState(false);
  const [isLeftPanelDetailsCollapsed, setIsLeftPanelDetailsCollapsed] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isTemplatePanelOpen, setIsTemplatePanelOpen] = useState(false);
  const [templatePanelMode, setTemplatePanelMode] = useState<"compact" | "expanded">("compact");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [hasRequestedAgentPrompt, setHasRequestedAgentPrompt] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<GenerationNotice | null>(null);
  const [agentMessages, setAgentMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    {
      role: "ai",
      text: "Choose a recommended template or describe a strategy directly. The app will generate code and build an advanced strategy canvas.",
    },
  ]);
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
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
    `AI Summary: ${EMPTY_STRATEGY_SUMMARY}`,
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
  const lastAppliedSnapshotGraphSignatureRef = useRef("");
  const lastCodeMetaWriteSignatureRef = useRef("");
  const skipNextSnapshotCodeMetaSyncRef = useRef(false);
  const isDarkMode = isThemeMounted && resolvedTheme === "dark";
  const connectedExchangeCount = exchangeConnections.filter((item) => isConnectedExchangeStatus(item.status)).length;
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
        activeSnapshot?.name || strategyTitle || "Advanced View Strategy",
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
  const generationElapsedLabel = `${generationElapsedSeconds}s`;
  const isTemplatePanelVisible = isTemplatePanelOpen;
  const visibleAgentActivities = agentActivities.slice(-6);
  const visibleStrategyTemplates = hasRequestedAgentPrompt ? [] : AI_STRATEGY_TEMPLATES.slice(0, 2);

  useEffect(() => {
    if (!isAgentRunning || !generationStartedAt) {
      setGenerationElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setGenerationElapsedSeconds(Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, isAgentRunning]);

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
        const payload = await getDummyRuntimeArtifacts(codeViewStrategyGraph);
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
      const data = await getDummyMarketOverview();
      if (Array.isArray(data?.rows)) setMarketRows(data.rows);
    } catch {
      setMarketRows(MARKET_ROWS);
    }
  }, []);

  const loadExchangeConnections = useCallback(async () => {
    try {
      const data = await listDummyExchangeConnections();
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
      const data = await listDummyBalanceSnapshots();
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
      const data = await syncDummyExchangeBalance(connectionId, market);
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
      const preferredAsset = snapshot?.spendable?.preferredAsset || "Balance";
      const preferredAvailable = snapshot?.spendable?.preferredAvailable || "";
      setExchangeAuthMessage(
        preferredAvailable
          ? `${preferredAsset} ${preferredAvailable} available · balance sync complete`
          : "Balance sync complete",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Balance sync failed";
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
      setExchangeFormError("Enter an exchange name.");
      return null;
    }
    if (!hasExchangeExecutionUrl) {
      setExchangeFormError("No execution API default was found for the selected exchange.");
      return null;
    }
    setIsSavingExchange(true);
    setExchangeFormError("");
    try {
      const data = await saveDummyExchangeConnection(exchangeForm);
      const connections = Array.isArray(data?.connections) ? data.connections as ExchangeConnection[] : exchangeConnections;
      setExchangeConnections(connections);
      if (data?.connection?.id) setExchangeTab(data.connection.id);
      const nextSelected = connections.find((item) => item.id === data?.connection?.id) || data?.connection || selectedExchange || null;
      setExchangeForm(buildExchangeFormFromConnection(nextSelected as ExchangeConnection | null));
      if (options?.successMessage !== null) {
        setExchangeAuthMessage(options?.successMessage || "Connection details saved.");
      }
      setGuideDone((prev) => new Set([...prev, 0]));
      return {
        connection: (nextSelected as ExchangeConnection | null) || null,
        connections,
      };
    } catch (error) {
      setExchangeFormError(error instanceof Error ? error.message : "Failed to save exchange connection");
      setAgentMessages((prev) => [
        ...prev,
        { role: "ai", text: `Failed to save exchange connection: ${error instanceof Error ? error.message : "unknown error"}` },
      ]);
      return null;
    } finally {
      setIsSavingExchange(false);
    }
  };

  const saveExchangeConnection = async () => {
    await persistExchangeConnection({
      successMessage: "Connection details saved.",
    });
  };

  const testBinanceAuth = async () => {
    const selectedExchangeId = selectedExchange?.id || exchangeForm.id.trim();
    if (!selectedExchangeId) {
      setExchangeAuthMessage("Select a connection first.");
      return;
    }
    if (!isSelectedExchangeBinance) {
      setExchangeAuthMessage("Signature testing is currently supported only for Binance connections.");
      return;
    }
    if (!canTestBinanceAuth) {
      setExchangeAuthMessage("Save a Binance API Key and Secret before running the signature test.");
      return;
    }

    let connectionIdForTest = selectedExchangeId;
    if (hasPendingBinanceCredentialInput) {
      const saved = await persistExchangeConnection({ successMessage: null });
      if (!saved?.connection?.id) {
        return;
      }
      connectionIdForTest = saved.connection.id;
      setExchangeAuthMessage("Connection details saved. Starting the Binance signature test.");
    }

    setIsTestingExchangeAuth(true);
    if (!hasPendingBinanceCredentialInput) {
      setExchangeAuthMessage("");
    }
    try {
      const data = await testDummyBinanceAuth(connectionIdForTest, exchangeAuthMarket);
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
        `${exchangeAuthMarket === "futures" ? "Futures" : "Spot"} balance sync succeeded${preferredAsset && preferredAvailable ? ` · ${preferredAsset} ${preferredAvailable} available` : data?.account?.accountType ? ` · ${data.account.accountType}` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binance signature test failed";
      setExchangeAuthMessage(message);
      setAgentMessages((prev) => [...prev, { role: "ai", text: message }]);
    } finally {
      setIsTestingExchangeAuth(false);
    }
  };

  const applySpyThreeDownStrategy = useCallback((options?: { fromTemplate?: boolean }) => {
    setActiveWorkspace("create");
    setMainView("advanced");
    setIsTemplatePanelOpen(false);

    const graph = getSpyThreeDownDayTradeStrategyNodes() as AdvancedGraphModel;
    const graphState = getAdvancedGraphCodeState(
      graph,
      SPY_THREE_DOWN_STRATEGY_TITLE,
      SPY_THREE_DOWN_STRATEGY_SUMMARY,
    );
    const codeMeta: HistorySnapshotCodeMeta = {
      strategyTitle: SPY_THREE_DOWN_STRATEGY_TITLE,
      strategySummary: SPY_THREE_DOWN_STRATEGY_SUMMARY,
      generatedCode: graphState.generatedCode,
      programCode: "",
      strategyGraph: graphState.strategyGraph,
      graphSignature: graphState.graphSignature,
      programCodeSignature: "",
      aiSummary: `AI Summary: ${SPY_THREE_DOWN_STRATEGY_SUMMARY}`,
      agentSteps: [
        "Read the Quantified Strategies SPY 3-days-down overnight rule",
        "Created SPY daily data sequence",
        "Added three-consecutive-down-close signal logic",
        "Connected the yes/no signal to the SPY long entry action",
        "Added close entry and next-session exit actions",
      ],
    };

    const existingSnapshot = historyStore
      .getSnapshots()
      .find((snapshot) => snapshot.name === SPY_THREE_DOWN_STRATEGY_TITLE);

    if (existingSnapshot) {
      historyStore.setActiveId(existingSnapshot.id);
      historyStore.updateSnapshotName(existingSnapshot.id, SPY_THREE_DOWN_STRATEGY_TITLE);
    } else {
      historyStore.createEmptyStrategy(null, SPY_THREE_DOWN_STRATEGY_TITLE, codeMeta);
    }
    historyStore.updateActiveSnapshot(graph.nodes, graph.edges, codeMeta);
    window.dispatchEvent(new CustomEvent("loadSnapshot", { detail: graph }));

    setGeneratedCode(graphState.generatedCode);
    setProgramCode("");
    programCodeRequestRef.current = "";
    setStrategyTitle(SPY_THREE_DOWN_STRATEGY_TITLE);
    setStrategySummary(SPY_THREE_DOWN_STRATEGY_SUMMARY);
    setAdvancedGraphModel(graph);
    setAdvancedGraphVersion((version) => version + 1);
    setLastSyncedAdvancedGraphSignature(graphState.graphSignature);
    setAiSummary(`AI Summary: ${SPY_THREE_DOWN_STRATEGY_SUMMARY}`);
    setAgentSteps(codeMeta.agentSteps ?? []);
    setGuideDone((prev) => new Set([...prev, 1]));
    setAgentMessages((prev) => [
      ...prev,
      {
        role: "ai",
        text: [
          "Created the SPY 3-day down mean-reversion day-trade strategy on the canvas.",
          "",
          SPY_THREE_DOWN_STRATEGY_SUMMARY,
          "",
          `Source article: ${SPY_THREE_DOWN_STRATEGY_SOURCE_URL}`,
          options?.fromTemplate
            ? "The graph maps the article rule into daily SPY data, a three-down-close detector, close entry, wait-until-next-session, and exit action."
            : "",
        ].filter(Boolean).join("\n"),
      },
    ]);

    try {
      window.sessionStorage.setItem(SPY_THREE_DOWN_STRATEGY_SESSION_KEY, "1");
    } catch {
      // Non-critical: historyStore already persists the created strategy.
    }
  }, []);

  useEffect(() => {
    setIsThemeMounted(true);
  }, []);

  useEffect(() => {
    const profile = getClientUserProfile();
    const hasCompletedStartGuide = readStartGuideCompleted(profile.userId);
    setClientUserId(profile.userId);
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
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem(SPY_THREE_DOWN_STRATEGY_SESSION_KEY) === "1") return;
    } catch {
      // Session storage can be unavailable in private or embedded contexts.
    }

    applySpyThreeDownStrategy();
  }, [applySpyThreeDownStrategy]);

  useEffect(() => {
    const persisted = readPersistedStrategyBuilderState();

    if (!persisted) {
      strategyPersistenceReadyRef.current = true;
      return;
    }

    if (persisted.strategyTitle === SPY_THREE_DOWN_STRATEGY_TITLE) {
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
    const snapshotGraph: AdvancedGraphModel | null = activeSnapshot
      ? {
        nodes: activeSnapshot.nodes as AdvancedGraphModel["nodes"],
        edges: activeSnapshot.edges as AdvancedGraphModel["edges"],
      }
      : null;
    const snapshotGraphSignature = createAdvancedGraphSignature(snapshotGraph);
    const snapshotHydrationSignature = activeSnapshot
      ? stableStringify({
        id: activeSnapshot.id,
        name: activeSnapshot.name,
        graphSignature: snapshotGraphSignature,
        codeMeta: compactCodeMetaForSignature(activeSnapshot.codeMeta),
      })
      : "none";
    if (lastAppliedSnapshotHydrationSignatureRef.current === snapshotHydrationSignature) return;
    lastAppliedSnapshotHydrationSignatureRef.current = snapshotHydrationSignature;
    lastAppliedSnapshotCodeMetaIdRef.current = snapshotId;
    if (!activeSnapshot) return;

    if (lastAppliedSnapshotGraphSignatureRef.current !== snapshotGraphSignature) {
      lastAppliedSnapshotGraphSignatureRef.current = snapshotGraphSignature;
      setAdvancedGraphModel(snapshotGraph);
      setAdvancedGraphVersion((version) => version + 1);
    }

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
      const next = meta?.aiSummary || `AI Summary: ${nextSummary}`;
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
  const handleSave = () => {
    window.dispatchEvent(new CustomEvent("saveHistorySnapshot"));
  };

  const handleMainViewChange = (nextView: MainView) => {
    if (nextView === mainView) return;
    setMainView(nextView);
  };

  const handleUseApiBlockInAdvancedView = useCallback((payload: {
    apiBlock: {
      id: string;
      name: string;
      address: string;
      method: string;
      kind: string;
      requiredFields: string[];
    };
    dataset: HistoricalDataDataset | null;
  }) => {
    const dataset = payload.dataset;
    const normalizedFields = dataset?.normalizedPreviewRows?.[0]
      ? Object.keys(dataset.normalizedPreviewRows[0]).filter((key) => !["date", "time", "timestamp", "symbol"].includes(key))
      : [];
    setMainView("advanced");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("createHistoricalApiBlock", {
        detail: {
          sourceNodeId: payload.apiBlock.id,
          label: payload.apiBlock.name,
          url: payload.apiBlock.address,
          method: payload.apiBlock.method === "WEBSOCKET" ? "WEBSOCKET" : "POLLING",
          streamKind: payload.apiBlock.kind || "url",
          outputFields: payload.apiBlock.requiredFields.length > 0
            ? payload.apiBlock.requiredFields
            : normalizedFields,
          datasetId: dataset?.id,
          datasetFileName: dataset?.fileName,
          normalizedPreviewRows: dataset?.normalizedPreviewRows ?? [],
        },
      }));
    }, 120);
  }, []);

  const syncAdvancedGraphFromCanvas = useCallback(
    (graph: AdvancedGraphModel, name = strategyTitle || "Advanced View Strategy") => {
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
      setAiSummary(`AI Summary: ${summary}`);
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

    setHasRequestedAgentPrompt(true);
    setAgentMessages((prev) => [...prev, { role: "user", text: visiblePrompt }]);
    setAgentPrompt("");
    if (isSpyThreeDownStrategyPrompt(prompt) || isSpyThreeDownStrategyPrompt(visiblePrompt)) {
      const controller = new AbortController();
      agentAbortControllerRef.current = controller;
      setIsAgentRunning(true);
      setGenerationStartedAt(Date.now());
      clearTemplatePanelCloseTimer();
      setIsTemplatePanelOpen(true);
      setTemplatePanelMode("expanded");
      setGenerationNotice({
        title: "Generation in progress",
        detail: "Opening the provided link and checking what kind of source it is. Demo generation remains visible for at least 30 seconds.",
        sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL,
      });
      const sourceActivity: AgentActivity = {
        id: "spy-3down-source",
        status: "running",
        stage: "source",
        label: "Opening the provided link",
        timestamp: new Date().toISOString(),
        detail: { sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL },
      };
      const classifyActivity: AgentActivity = {
        id: "spy-3down-classify",
        status: "running",
        stage: "source",
        label: "Checking source metadata and page content",
        timestamp: new Date().toISOString(),
      };
      const readingActivity: AgentActivity = {
        id: "spy-3down-reading",
        status: "running",
        stage: "research",
        label: "Reading the Quantified Strategies article",
        timestamp: new Date().toISOString(),
        detail: { sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL },
      };
      const ruleActivity: AgentActivity = {
        id: "spy-3down-rules",
        status: "running",
        stage: "rules",
        label: "Extracting the three-down overnight rule",
        timestamp: new Date().toISOString(),
      };
      const graphActivity: AgentActivity = {
        id: "spy-3down-graph",
        status: "running",
        stage: "graph",
        label: "Preparing SPY data, signal, entry, wait, and exit nodes",
        timestamp: new Date().toISOString(),
      };
      setAgentActivities([sourceActivity]);
      setAgentSteps(agentStepsFromActivities([sourceActivity]));
      const demoProgressTimers = [
        window.setTimeout(() => {
          setGenerationNotice({
            title: "Generation in progress",
            detail: "The link opened successfully. Inspecting the page metadata before deciding how to use it.",
            sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL,
          });
          const nextActivities: AgentActivity[] = [
            { ...sourceActivity, status: "done", timestamp: new Date().toISOString() },
            { ...classifyActivity, status: "running", timestamp: new Date().toISOString() },
          ];
          setAgentActivities(nextActivities);
          setAgentSteps(agentStepsFromActivities(nextActivities));
        }, 6_000),
        window.setTimeout(() => {
          setGenerationNotice({
            title: "Generation in progress",
            detail: "Detected a trading-strategy article. Reading the article body to understand the setup.",
            sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL,
          });
          const nextActivities: AgentActivity[] = [
            { ...sourceActivity, status: "done", timestamp: new Date().toISOString() },
            { ...classifyActivity, status: "done", timestamp: new Date().toISOString() },
            { ...readingActivity, status: "running", timestamp: new Date().toISOString() },
          ];
          setAgentActivities(nextActivities);
          setAgentSteps(agentStepsFromActivities(nextActivities));
        }, 12_000),
        window.setTimeout(() => {
          setGenerationNotice({
            title: "Generation in progress",
            detail: "Article context loaded. Identifying the entry and exit rule from the strategy text.",
            sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL,
          });
          const nextActivities: AgentActivity[] = [
            { ...sourceActivity, status: "done", timestamp: new Date().toISOString() },
            { ...classifyActivity, status: "done", timestamp: new Date().toISOString() },
            { ...readingActivity, status: "done", timestamp: new Date().toISOString() },
            { ...ruleActivity, status: "running", timestamp: new Date().toISOString() },
          ];
          setAgentActivities(nextActivities);
          setAgentSteps(agentStepsFromActivities(nextActivities));
        }, 20_000),
        window.setTimeout(() => {
          setGenerationNotice({
            title: "Generation in progress",
            detail: "The mean-reversion rule is identified. Mapping it to SPY daily data, signal, entry, wait, and exit blocks.",
            sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL,
          });
          const nextActivities: AgentActivity[] = [
            { ...sourceActivity, status: "done", timestamp: new Date().toISOString() },
            { ...classifyActivity, status: "done", timestamp: new Date().toISOString() },
            { ...readingActivity, status: "done", timestamp: new Date().toISOString() },
            { ...ruleActivity, status: "done", timestamp: new Date().toISOString() },
            { ...graphActivity, status: "running", timestamp: new Date().toISOString() },
          ];
          setAgentActivities(nextActivities);
          setAgentSteps(agentStepsFromActivities(nextActivities));
        }, 26_000),
        window.setTimeout(() => {
          setGenerationNotice({
            title: "Generation in progress",
            detail: "Strategy blocks are ready. Materializing the connected graph on the Advanced View canvas.",
            sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL,
          });
          const nextActivities: AgentActivity[] = [
            { ...sourceActivity, status: "done", timestamp: new Date().toISOString() },
            { ...classifyActivity, status: "done", timestamp: new Date().toISOString() },
            { ...readingActivity, status: "done", timestamp: new Date().toISOString() },
            { ...ruleActivity, status: "done", timestamp: new Date().toISOString() },
            { ...graphActivity, status: "done", timestamp: new Date().toISOString() },
            {
              id: "spy-3down-materialize",
              status: "running",
              stage: "frontend-materialize",
              label: "Materializing strategy graph on the Advanced View canvas",
              timestamp: new Date().toISOString(),
            },
          ];
          setAgentActivities(nextActivities);
          setAgentSteps(agentStepsFromActivities(nextActivities));
        }, 29_000),
      ];
      try {
        await waitForDemoStrategyDelay(controller.signal);
        const completedActivities: AgentActivity[] = [
          ...[sourceActivity, classifyActivity, readingActivity, ruleActivity, graphActivity].map((activity) => ({ ...activity, status: "done", timestamp: new Date().toISOString() })),
          {
            id: "spy-3down-materialize",
            status: "done",
            stage: "frontend-materialize",
            label: "Materialized the connected graph on the Advanced View canvas",
            timestamp: new Date().toISOString(),
          },
          {
            id: "spy-3down-template",
            status: "done",
            stage: "frontend-materialize",
            label: "Created SPY 3-days-down strategy graph from the article",
            timestamp: new Date().toISOString(),
            detail: { sourceUrl: SPY_THREE_DOWN_STRATEGY_SOURCE_URL },
          },
        ];
        setAgentActivities(completedActivities);
        setAgentSteps(agentStepsFromActivities(completedActivities));
        applySpyThreeDownStrategy({ fromTemplate: true });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          setAgentActivities((prev) => [
            ...prev,
            {
              id: `cancelled-${Date.now()}`,
              status: "error",
              stage: "cancelled",
              label: "The user cancelled strategy generation.",
              timestamp: new Date().toISOString(),
            },
          ]);
          setAgentMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: "Strategy generation request was cancelled.",
            },
          ]);
        } else {
          setAgentMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: `AI agent response failed: ${error instanceof Error ? error.message : "unknown error"}`,
            },
          ]);
        }
      } finally {
        demoProgressTimers.forEach((timer) => window.clearTimeout(timer));
        agentAbortControllerRef.current = null;
        setIsAgentRunning(false);
        setGenerationStartedAt(null);
        setGenerationNotice(null);
      }
      return;
    }

    const initialActivity: AgentActivity = {
      id: "request-queued",
      status: "running",
      stage: "queued",
      label: "Request queued",
      timestamp: new Date().toISOString(),
    };
    setAgentActivities([initialActivity]);
    setAgentSteps([initialActivity.label]);
    setIsAgentRunning(true);
    setGenerationStartedAt(Date.now());
    clearTemplatePanelCloseTimer();
    setIsTemplatePanelOpen(true);
    setTemplatePanelMode("expanded");
    setGenerationNotice({
      title: "Generation in progress",
      detail: "The agent is interpreting the prompt, generating a strategy graph, and materializing it on the canvas.",
    });
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
        label: "Interpreting request and preparing strategy draft",
        timestamp: new Date().toISOString(),
      });
      appendAgentActivity({
        id: "strategy-pipeline",
        status: "running",
        stage: "research",
        label: "Running strategy generation pipeline",
        timestamp: new Date().toISOString(),
      });

      const data = await createDummyStrategyDraft({
        prompt,
        signal: controller.signal,
        currentStrategy: {
          code: generatedCode,
          title: strategyTitle,
          summary: strategySummary,
        },
      });
      appendAgentActivity({
        id: "strategy-pipeline",
        status: "done",
        stage: "research",
        label: "Strategy generation pipeline complete",
        timestamp: new Date().toISOString(),
      });
      if (!data?.strategy?.blocks || !data?.strategy?.connections) {
        throw new Error("The AI response did not include a strategy graph.");
      }

      appendAgentActivity({
        status: "running",
        stage: "frontend-materialize",
        label: "Applying frontend graph and advanced canvas",
        timestamp: new Date().toISOString(),
      });
      const result = materializeAdvancedStrategyGraph(data.strategy, prompt);
      const advancedGraph = result.advancedGraph;
      if (!advancedGraph || advancedGraph.nodes.length === 0) {
        throw new Error("The advanced strategy graph was not completed.");
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

      // Update Advanced View.
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
            label: "The user cancelled strategy generation.",
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: "Strategy generation request was cancelled.",
          },
        ]);
        return;
      }
      const message = error instanceof Error ? error.message : "An error occurred while generating the strategy.";
      const isTimeout = /timeout|timed out|aborted/i.test(message);
      const isExchangeSetupError = /exchange connection|REST API URL|RPC URL|API\/RPC/i.test(message);
      setAgentMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: isExchangeSetupError
            ? `AI agent did not run: ${message}\n\nWebSocket/WSS market data URLs are not enough. Save an executable REST API URL or RPC URL in the exchange connection tab.`
            : isTimeout
              ? `AI agent response failed: ${message}\n\nThe request took too long and was stopped. Check web search, KG search, and validator environments before trying again. No local demo fallback was used.`
              : `AI agent response failed: ${message}\n\nNo local demo fallback was used. Check the server API, web search provider, and validator status.`,
        },
      ]);
    } finally {
      agentAbortControllerRef.current = null;
      setIsAgentRunning(false);
      setGenerationStartedAt(null);
      setGenerationNotice(null);
    }
  };

  const handleTemplateSelect = async (template: StrategyTemplate) => {
    await runRemoteAgentPrompt(template.prompt, `Recommended template: ${template.title}\n${template.prompt}`);
  };

  const handleAgentPromptSubmit = async () => {
    await runRemoteAgentPrompt(agentPrompt.trim());
  };

  useEffect(() => {
    let stopped = false;

    const loadCodexStrategyInbox = async () => {
      if (stopped || isAgentRunning) return;
      try {
        const payload = await getDummyCodexStrategyInbox();
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
            throw new Error("Could not convert the Codex strategy into an advanced view graph.");
          }
          advancedGraph = result.advancedGraph;
        } catch (error) {
          if (codexStrategyInboxErrorIdRef.current !== inboxId) {
            codexStrategyInboxErrorIdRef.current = inboxId;
            const message = error instanceof Error ? error.message : "Unknown conversion error";
            setAgentActivities((prev) => [
              ...prev,
              {
                id: `codex-inbox-error-${inboxId}`,
                status: "error",
                stage: "strategy-load-error",
                label: "Could not convert the Codex strategy into a UI graph.",
                timestamp: new Date().toISOString(),
                detail: { inboxId, error: message },
              },
            ]);
            setAgentMessages((prev) => [
              ...prev,
              {
                role: "ai",
                text: `Failed to load Codex strategy: ${message}\n\nThe harness accepts only real trading-logic graphs as UI sequences, not AI research or ranking loops.`,
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
          clearStrategyBuilderState();
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
    <div className="hershy-shell flex h-screen w-full overflow-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex dark:border-slate-800 dark:bg-slate-950",
          isLeftPanelCollapsed ? "w-[52px]" : "w-[188px]",
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
              aria-label="Expand left panel"
              title="Expand left panel"
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
                aria-label="Collapse left panel"
                title="Collapse left panel"
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
                title={isInteractive ? item.label : `${item.label} · coming soon`}
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
              aria-label="Manage exchange connections"
              title="Manage exchange connections"
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center border text-[11px] font-black transition-colors",
                connectedExchangeCount > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              EX
              {connectedExchangeCount > 0 ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setIsWalletManagerOpen(true)}
              aria-label="지갑 연결 관리"
              title="지갑 연결 관리"
              className="relative inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-[11px] font-black text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              지
            </button>
            <button
              type="button"
              onClick={() => setIsLeftPanelCollapsed(false)}
              aria-label="Expand plan panel"
              title={`Plan: ${planTier}`}
              className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-[11px] font-black text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              P
            </button>
          </div>
        ) : (
          <div className="border-t border-slate-200 p-2.5 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsLeftPanelDetailsCollapsed((current) => !current)}
              className="mb-2 flex h-8 w-full items-center justify-between border border-slate-200 bg-white px-2 text-xs font-black text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <span>Exchange / Plan</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  isLeftPanelDetailsCollapsed ? "-rotate-90" : "rotate-0",
                )}
              />
            </button>

            {isLeftPanelDetailsCollapsed ? (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setIsLeftPanelDetailsCollapsed(false)}
                  className="flex w-full items-center justify-between border border-slate-200 bg-slate-50 px-2 py-1.5 text-left dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="min-w-0 truncate text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {selectedExchange?.name ?? "Exchange"}
                  </span>
                  <span className={cn("ml-2 shrink-0 text-[10px] font-black", isConnectedExchangeStatus(selectedExchange?.status) ? "text-emerald-600 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400")}>
                    {selectedExchange?.status ?? "Pending"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLeftPanelDetailsCollapsed(false)}
                  className="flex w-full items-center justify-between border border-slate-200 bg-slate-50 px-2 py-1.5 text-left dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Plan</span>
                  <span className="text-[10px] font-black uppercase text-violet-600 dark:text-violet-300">{planTier}</span>
                </button>
              </div>
            ) : (
              <>
            <section className="border-b border-slate-200 pb-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-300">Exchange Connections</div>
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
                {selectedExchange?.name ?? "Exchange connection required"}
                {connectedExchangeCount > 0 ? ` (${connectedExchangeCount})` : ""}
              </div>
              <div className={cn("text-[11px] font-semibold", isConnectedExchangeStatus(selectedExchange?.status) ? "text-emerald-600 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400")}>
                {selectedExchange?.status ?? "Pending"}
              </div>
            </div>
            {selectedExchange?.rpcUrl || selectedExchange?.apiUrl || selectedExchange?.wsUrl ? (
              <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                API/RPC URL saved
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              title="Manage Exchange Connections"
              className="mt-2 h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Manage Connections
            </button>
            </section>

          <ScwOnboardingPanel onManage={() => setIsWalletManagerOpen(true)} />

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
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Billing status active</div>
            <button className="mt-2 h-8 w-full border border-slate-200 bg-white text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              Manage Plan
            </button>
            </section>
              </>
            )}
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
                Track assets and available capital by exchange
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(isDarkMode ? "light" : "dark")}
              className="inline-flex h-9 items-center border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              <span>{isDarkMode ? "Light" : "Dark"}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsExchangeLibraryOpen(true)}
              className="inline-flex h-9 items-center border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              Exchanges
            </button>
            {isCreateWorkspace ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex h-9 items-center bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700"
                >
                  Save
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsExchangeLibraryOpen(true)}
                className="inline-flex h-9 items-center bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
              >
                Manage Exchange Connections
              </button>
            )}
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden">
          <section className="flex min-w-0 flex-col overflow-hidden">
            {isCreateWorkspace ? (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">
              {mainView === "advanced" ? (
                <div className="h-full">
                  <NodeEditor
                    initialGraph={advancedGraphModel}
                    initialGraphVersion={advancedGraphVersion}
                  />
                  {openTabs.length === 0 ? (
                    <div className="pointer-events-none absolute inset-x-[180px] top-[210px] z-20 flex justify-center">
                      <div className="pointer-events-auto border border-slate-200 bg-white px-4 py-3 text-center text-sm">
                        <div className="font-bold text-slate-900">No strategy tabs are open</div>
                        <button
                          onClick={() => historyStore.createEmptyStrategy(null)}
                          className="mt-2 bg-violet-600 px-3 py-1.5 text-xs font-bold text-white"
                        >
                          Start Empty Strategy
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {mainView === "api-data" ? (
                <ApiHistoricalDataTab
                  graph={activeAdvancedGraph}
                  onUseApiBlock={handleUseApiBlockInAdvancedView}
                />
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
                      {isGeneratingProgramCode ? "Generating" : "Generate Hershy Go"}
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

      <ScwOnboardingManagerModal
        isOpen={isWalletManagerOpen}
        onClose={() => setIsWalletManagerOpen(false)}
      />

      {isGuideOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-6">
          <section className="w-full max-w-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-violet-600">
                  Start Guide {guideStep + 1} / {GUIDE_ITEMS.length}
                </div>
                <h2 className="mt-1 text-xl font-black text-slate-950">{GUIDE_ITEMS[guideStep]}</h2>
                <div className="mt-1 text-[11px] font-semibold text-slate-500">
                  Complete {guideProgress} / {GUIDE_ITEMS.length}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseGuide}
                className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="Close tutorial"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              <div className="border-l-2 border-violet-300 bg-slate-50 px-4 py-3">
                <p className="text-sm leading-6 text-slate-800">
                  {guideStep === 0
                    ? "Check API permissions in the exchange connection tab on the left. Once read/trade permissions show as connected, you can create a strategy."
                    : null}
                  {guideStep === 1
                    ? "Choose a recommended strategy from the AI strategy template panel at the bottom right, or describe the strategy you want to generate an advanced strategy canvas."
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
                Don't show again
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGuideStep((current) => Math.max(0, current - 1))}
                  disabled={guideStep === 0}
                  className="h-9 border border-slate-200 px-3 text-sm font-bold text-slate-600 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={handleGuideNext}
                  className="h-9 bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700"
                >
                  {guideStep === GUIDE_ITEMS.length - 1 ? "Done" : "Next"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isCreateWorkspace ? (
        <div
          className="strategy-template-launcher fixed bottom-5 right-5 z-50"
          onMouseEnter={openTemplatePanel}
          onMouseLeave={scheduleTemplatePanelClose}
          onFocus={openTemplatePanel}
          onBlur={scheduleTemplatePanelClose}
        >
        <div
          className={cn(
            "absolute bottom-14 right-0 translate-y-2 opacity-0 transition-all duration-200",
            isTemplatePanelVisible
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none",
            isAgentRunning || templatePanelMode === "expanded" ? "w-[560px]" : "w-[440px]",
          )}
        >
          <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                  AI Strategy Templates
                </div>
                <div className="text-sm font-black text-slate-950 dark:text-slate-100">
                  Quick picks and direct input
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isAgentRunning ? (
                  <button
                    type="button"
                    onClick={() => setIsTemplatePanelOpen(false)}
                    className="border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                  >
                    Minimize
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setTemplatePanelMode((mode) => (mode === "compact" ? "expanded" : "compact"))
                  }
                  className="border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                >
                  {templatePanelMode === "compact" ? "Expand" : "Compact"}
                </button>
              </div>
            </div>

            <div className="p-3">
              {isAgentRunning ? (
                <div className="mb-3 border border-slate-800 bg-slate-950 text-slate-100 shadow-xl shadow-slate-950/20" aria-live="polite">
                  <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-3">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-300" />
                    <div className="min-w-0 flex-1 truncate text-sm font-black">
                      {generationNotice?.title ?? "Generation in progress"}
                    </div>
                    <span className="shrink-0 border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-200">
                      {generationElapsedLabel}
                    </span>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-xs font-semibold leading-5 text-slate-300">
                      {generationNotice?.detail ?? "The agent is generating the strategy graph and code."}
                    </p>
                    {generationNotice?.sourceUrl ? (
                      <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">
                        Source: {generationNotice.sourceUrl}
                      </p>
                    ) : null}

                    <div className="mt-3 space-y-2">
                      {visibleAgentActivities.map((activity) => {
                        const status = activity.status ?? "running";
                        const isDone = status === "done";
                        const isRunning = status === "running";
                        return (
                          <div key={activity.id} className="flex items-start gap-2 rounded-sm bg-white/[0.04] px-2 py-2">
                            {isDone ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                            ) : isRunning ? (
                              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-violet-300" />
                            ) : (
                              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className={cn("truncate text-xs font-bold", isRunning ? "text-white" : isDone ? "text-emerald-100" : "text-slate-400")}>
                                {activity.label}
                              </div>
                              <div className="mt-0.5 text-[10px] font-semibold uppercase text-slate-500">
                                {isDone ? "completed" : isRunning ? "running" : "queued"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 border border-slate-800 bg-black/35 p-3 font-mono text-[11px] leading-5 text-slate-300">
                      {visibleAgentActivities.map((activity) => (
                        <div key={`${activity.id}-terminal`}>
                          <span className="text-emerald-300">$</span> {activity.label.toLowerCase()}
                        </div>
                      ))}
                      <div className="text-violet-200">assistant is generating<span className="animate-pulse">...</span></div>
                    </div>

                    <div className="mt-3 h-1.5 overflow-hidden bg-slate-800">
                      <div className="h-full w-2/3 animate-pulse bg-emerald-300" />
                    </div>
                  </div>
                </div>
              ) : null}

              {!isAgentRunning ? (
                <>
                  {visibleStrategyTemplates.length > 0 ? (
                    <div className="mb-3">
                      <div className="mb-2 text-xs font-black text-slate-700 dark:text-slate-300">Quick Picks</div>
                      <div className="grid grid-cols-2 gap-2">
                        {visibleStrategyTemplates.map((template) => (
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
                          ))}
                      </div>
                    </div>
                  ) : null}

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
                      placeholder="Example: Enter when BTC breaks above the 20MA with rising volume, then add a 1.2% trailing stop."
                    />
                    <button
                      type="submit"
                      disabled={!agentPrompt.trim()}
                      className="inline-flex h-9 w-full items-center justify-center bg-violet-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Send to Agent
                    </button>
                  </form>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCancelAgentRun}
                  className="inline-flex h-9 w-full items-center justify-center border border-emerald-400/30 bg-slate-950 text-sm font-bold text-emerald-200 transition-colors hover:bg-slate-900"
                >
                  Stop Current Generation
                </button>
              )}
            </div>
          </section>
        </div>

          <button
            type="button"
            onClick={openTemplatePanel}
            className={cn(
              "inline-flex h-10 items-center gap-2 px-4 text-sm font-black text-white transition-colors",
              isAgentRunning ? "bg-slate-950 shadow-lg shadow-slate-950/20 hover:bg-slate-900" : "bg-violet-600 hover:bg-violet-700",
            )}
          >
            {isAgentRunning ? <Loader2 className="h-4 w-4 animate-spin text-emerald-300" /> : null}
            {isAgentRunning ? "Generation in progress" : "AI Strategy Templates"}
          </button>
        </div>
      ) : null}

    </div>
  );
}
