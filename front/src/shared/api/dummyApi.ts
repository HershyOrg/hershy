import type { StrategyGraphPayload } from "@/features/strategy-editor/utils/strategyGraph";
import type {
  BalanceMyDataSnapshot,
  ExchangeConnection,
  ExchangeFormState,
  MarketRow,
} from "@/shared/types/domain";

import { DEFAULT_EXCHANGE_CONNECTIONS } from "./exchangeCatalog.mjs";

type MarketChartPoint = {
  time: number;
  value: number;
  volume?: number;
};

type StrategyDraftRequest = {
  prompt: string;
  currentStrategy?: {
    code?: string;
    title?: string;
    summary?: string;
  };
  signal?: AbortSignal;
};

type DummyBalanceSyncResponse = {
  connections: ExchangeConnection[];
  balanceSnapshot: BalanceMyDataSnapshot;
  balanceSnapshots: BalanceMyDataSnapshot[];
  account?: {
    accountType?: string;
  };
};

type DummyCodexStrategyInboxPayload = {
  hasStrategy: boolean;
  id: string;
  prompt?: string;
  message?: string;
  replaceExisting?: boolean;
  result: {
    prompt?: string;
    replaceExisting?: boolean;
    strategy: StrategyGraphPayload;
    runtime?: unknown;
    strategyAISummary?: unknown;
  } | null;
};

const DEMO_LATENCY_MS = 220;

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

function createAbortError() {
  return new DOMException("dummy API request aborted", "AbortError");
}

function wait(ms = DEMO_LATENCY_MS, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(createAbortError());

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function slug(value: string, fallback = "connection") {
  return (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

function last4(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(-4) : "";
}

let mockConnections: ExchangeConnection[] = (DEFAULT_EXCHANGE_CONNECTIONS as ExchangeConnection[]).map((connection) => ({
  ...connection,
  status: connection.status || "Demo",
}));

const demoMarketRows: MarketRow[] = [
  { symbol: "BTCUSDT", price: "67,245.8", change: "+1.24%", tone: "up", icon: "B", source: "frontend dummy" },
  { symbol: "ETHUSDT", price: "3,285.6", change: "+0.82%", tone: "up", icon: "E", source: "frontend dummy" },
  { symbol: "SOLUSDT", price: "152.4", change: "+0.45%", tone: "up", icon: "S", source: "frontend dummy" },
  { symbol: "BNBUSDT", price: "610.2", change: "-0.05%", tone: "down", icon: "N", source: "frontend dummy" },
];

function buildBalanceSnapshot(connectionId: string, market: "spot" | "futures" = "spot"): BalanceMyDataSnapshot {
  const connection = mockConnections.find((item) => item.id === connectionId);
  const now = new Date().toISOString();
  const multiplier = market === "futures" ? 1.45 : 1;
  const assets = [
    {
      asset: "USDT",
      free: String(Math.round(12_500 * multiplier)),
      total: String(Math.round(12_500 * multiplier)),
      available: String(Math.round(12_200 * multiplier)),
      valueUsd: Math.round(12_500 * multiplier),
      availableUsd: Math.round(12_200 * multiplier),
    },
    {
      asset: "BTC",
      free: "0.184",
      total: "0.184",
      available: "0.184",
      valueUsd: Math.round(12_374 * multiplier),
      availableUsd: Math.round(12_374 * multiplier),
    },
    {
      asset: "ETH",
      free: "2.18",
      total: "2.18",
      available: "2.18",
      valueUsd: Math.round(7_160 * multiplier),
      availableUsd: Math.round(7_160 * multiplier),
    },
  ];
  const totalValueUsd = assets.reduce((sum, asset) => sum + (asset.valueUsd ?? 0), 0);
  const totalAvailableUsd = assets.reduce((sum, asset) => sum + (asset.availableUsd ?? 0), 0);

  return {
    id: `${connectionId}-${market}`,
    exchangeId: connectionId,
    connectionId,
    exchangeName: connection?.name || connectionId,
    exchange: connection?.name || connectionId,
    market,
    accountType: market,
    source: "frontend dummy",
    updatedAt: now,
    assets,
    totals: {
      assetCount: assets.length,
      totalValueUsd,
      totalAvailableUsd,
      stableAvailableUsd: assets.find((asset) => asset.asset === "USDT")?.availableUsd ?? 0,
    },
    spendable: {
      preferredAsset: "USDT",
      preferredAvailable: assets[0].available,
      preferredAvailableUsd: assets[0].availableUsd,
      totalStableAvailableUsd: assets[0].availableUsd,
      stableAssets: [{ asset: "USDT", available: assets[0].available || "0", availableUsd: assets[0].availableUsd }],
      policy: "frontend dummy balance",
    },
  };
}

let mockBalanceSnapshots: BalanceMyDataSnapshot[] = [
  buildBalanceSnapshot("binance", "spot"),
  buildBalanceSnapshot("binance", "futures"),
];

function buildRuntimeProgramCode(strategyGraph: StrategyGraphPayload | null | undefined) {
  const strategyName = typeof strategyGraph?.strategy?.name === "string"
    ? strategyGraph.strategy.name
    : "frontend dummy strategy";
  const blockCount = Array.isArray(strategyGraph?.blocks) ? strategyGraph.blocks.length : 0;
  const connectionCount = Array.isArray(strategyGraph?.connections) ? strategyGraph.connections.length : 0;

  return [
    "package main",
    "",
    "// Frontend dummy runtime artifact.",
    "// Backend will replace this with validated Hershy execution code.",
    "func main() {",
    `    strategyName := ${JSON.stringify(strategyName)}`,
    `    blockCount := ${blockCount}`,
    `    connectionCount := ${connectionCount}`,
    "    _, _, _ = strategyName, blockCount, connectionCount",
    "}",
    "",
  ].join("\n");
}

function buildDummyStrategyGraph(prompt: string): StrategyGraphPayload {
  const cleanedPrompt = prompt.trim();
  const title = cleanedPrompt
    ? cleanedPrompt.slice(0, 48)
    : "BTC Momentum Carry";
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    kind: "hershy-strategy-graph",
    strategy: {
      id: `dummy-${slug(title, "strategy")}`,
      name: title,
    },
    generatedAt: now,
    summary: {
      text: "Frontend dummy strategy that monitors BTC price, volume, and funding, then executes a CEX order when conditions match.",
      blocks: 5,
      connections: 5,
    },
    metadata: {
      source: "frontend-dummy-api",
      strategyAISummary: {
        summaryText: "Strategy draft generated from frontend dummy data without a server.",
        keyPoints: [
          "Monitors BTCUSDT price and volume at a 1-minute cadence.",
          "Connects to a Binance CEX order action when momentum conditions are met.",
          "Adds a separate kill switch for loss-limit protection.",
        ],
        executionReadinessText: "For UI/UX validation before backend connection.",
        riskNotes: [
          "No live trading orders are placed.",
          "Balances and charts use browser dummy data.",
        ],
      },
      workflowGroups: [
        {
          id: "market-scan",
          title: "Market Data Watch",
          purpose: "Collect price, volume, and funding data, then calculate entry conditions.",
          order: 1,
          nodeIds: ["btc-price", "funding-rate", "entry-signal"],
          canAbstract: true,
          mustStayVisibleNodeIds: ["entry-signal"],
          sharedDataPipeline: true,
        },
        {
          id: "execution",
          title: "Order Execution",
          purpose: "Execute an order on the connected CEX when conditions are met.",
          order: 2,
          nodeIds: ["entry-trigger", "place-order"],
          canAbstract: true,
          mustStayVisibleNodeIds: ["place-order"],
        },
      ],
    },
    blocks: [
      {
        id: "btc-price",
        type: "streaming",
        config: {
          label: "BTCUSDT Price",
          method: "WEBSOCKET",
          streamKind: "websocket",
          sourceUrl: "wss://stream.binance.com:9443/ws/btcusdt@ticker",
          outputBlocks: ["price", "volume"],
          workflowId: "market-scan",
        },
      },
      {
        id: "funding-rate",
        type: "streaming",
        config: {
          label: "BTC Funding Rate",
          method: "WEBSOCKET",
          streamKind: "websocket",
          sourceUrl: "wss://fstream.binance.com/ws/btcusdt@markPrice",
          outputBlocks: ["fundingRate", "markPrice"],
          workflowId: "market-scan",
        },
      },
      {
        id: "entry-signal",
        type: "normal",
        config: {
          label: "Momentum Signal",
          expression: "(btc-price::price > ma20) && (btc-price::volume > volume_ma) && (funding-rate::fundingRate >= 0)",
          outputBlocks: ["signal"],
          workflowId: "market-scan",
        },
      },
      {
        id: "entry-trigger",
        type: "trigger",
        config: {
          label: "Entry Condition",
          triggerType: "condition",
          condition: "entry-signal::signal == true",
          workflowId: "execution",
        },
      },
      {
        id: "place-order",
        type: "action",
        config: {
          label: "Binance Order",
          actionType: "CEX",
          exchange: "Binance",
          symbol: "BTCUSDT",
          side: "BUY",
          orderType: "MARKET",
          amount: "user_defined",
          workflowId: "execution",
        },
      },
    ],
    connections: [
      { id: "price-to-signal", kind: "data-flow", fromId: "btc-price", toId: "entry-signal", label: "Price/Volume" },
      { id: "funding-to-signal", kind: "data-flow", fromId: "funding-rate", toId: "entry-signal", label: "Funding Rate" },
      { id: "signal-to-trigger", kind: "trigger-input", fromId: "entry-signal", toId: "entry-trigger", label: "Condition" },
      { id: "trigger-to-order", kind: "trigger-action", fromId: "entry-trigger", toId: "place-order", label: "Execute" },
      { id: "price-to-order", kind: "action-input", fromId: "btc-price", toId: "place-order", label: "Order price reference" },
    ],
  };
}

function symbolSeed(symbol: string) {
  return Array.from(symbol).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

export async function getDummyRuntimeArtifacts(strategy: StrategyGraphPayload | null | undefined) {
  await wait();
  return {
    runtime: {
      programCode: buildRuntimeProgramCode(strategy),
      generatedGoCode: buildRuntimeProgramCode(strategy),
    },
    validation: {
      issues: [],
    },
  };
}

export async function getDummyMarketOverview() {
  await wait(120);
  return {
    rows: clone(demoMarketRows),
    updatedAt: new Date().toISOString(),
    warning: "",
  };
}

export async function listDummyExchangeConnections() {
  await wait(120);
  return {
    connections: clone(mockConnections),
  };
}

export async function listDummyBalanceSnapshots() {
  await wait(120);
  return {
    snapshots: clone(mockBalanceSnapshots),
  };
}

export async function syncDummyExchangeBalance(connectionId: string, market: "spot" | "futures" = "spot"): Promise<DummyBalanceSyncResponse> {
  await wait();
  const balanceSnapshot = buildBalanceSnapshot(connectionId, market);
  mockBalanceSnapshots = [
    ...mockBalanceSnapshots.filter((snapshot) => `${snapshot.connectionId}:${snapshot.market}` !== `${connectionId}:${market}`),
    balanceSnapshot,
  ];
  mockConnections = mockConnections.map((connection) => connection.id === connectionId
    ? {
      ...connection,
      status: "Synced",
      credentials: {
        ...(connection.credentials ?? {}),
        authStatus: "ok",
        authMarket: market,
        lastAuthCheckAt: new Date().toISOString(),
      },
    }
    : connection);

  return {
    connections: clone(mockConnections),
    balanceSnapshot: clone(balanceSnapshot),
    balanceSnapshots: clone(mockBalanceSnapshots),
    account: {
      accountType: market,
    },
  };
}

export async function saveDummyExchangeConnection(form: ExchangeFormState) {
  await wait();
  const id = slug(form.id || form.name, "exchange");
  const connection: ExchangeConnection = {
    id,
    name: form.name.trim() || id,
    type: form.type,
    status: "Saved",
    apiUrl: form.apiUrl.trim(),
    wsUrl: form.wsUrl.trim(),
    rpcUrl: form.rpcUrl.trim(),
    marketDataUrl: form.marketDataUrl.trim(),
    credentials: {
      hasApiKey: Boolean(form.apiKey.trim()),
      hasApiSecret: Boolean(form.apiSecret.trim()),
      hasApiPassphrase: Boolean(form.apiPassphrase.trim()),
      hasPrivateKey: Boolean(form.privateKey.trim()),
      hasFunder: Boolean(form.funder.trim()),
      apiKeyLast4: last4(form.apiKey),
      privateKeyLast4: last4(form.privateKey),
      funder: form.funder.trim(),
      chainId: form.chainId.trim(),
      authStatus: "saved",
      lastAuthCheckAt: new Date().toISOString(),
    },
  };

  mockConnections = [
    ...mockConnections.filter((item) => item.id !== id),
    connection,
  ];

  return {
    connection: clone(connection),
    connections: clone(mockConnections),
  };
}

export async function testDummyBinanceAuth(connectionId: string, market: "spot" | "futures" = "spot") {
  return syncDummyExchangeBalance(connectionId, market);
}

export async function createDummyStrategyDraft({ prompt, currentStrategy, signal }: StrategyDraftRequest) {
  await wait(520, signal);
  const strategy = buildDummyStrategyGraph(prompt || currentStrategy?.title || "BTC Momentum Carry");
  const runtimeCode = buildRuntimeProgramCode(strategy);

  return {
    message: "Frontend dummy strategy draft generated",
    prompt,
    strategy,
    runtime: {
      programCode: runtimeCode,
      generatedGoCode: runtimeCode,
    },
    strategyAISummary: strategy.metadata?.strategyAISummary,
  };
}

export async function getDummyCodexStrategyInbox(): Promise<DummyCodexStrategyInboxPayload> {
  await wait(80);
  return {
    hasStrategy: false,
    id: "frontend-dummy-empty-inbox",
    result: null,
  };
}

export async function getDummyMarketChart({
  symbol,
  market,
  limit = 96,
}: {
  symbol: string;
  market: string;
  interval?: string;
  limit?: number;
}) {
  await wait(90);
  const safeLimit = Math.max(8, Math.min(240, Number(limit) || 96));
  const seed = symbolSeed(`${symbol}:${market}`);
  const base = symbol.toUpperCase().includes("ETH")
    ? 3280
    : symbol.toUpperCase().includes("SOL")
      ? 152
      : 67_000 + seed;
  const now = Math.floor(Date.now() / 1000);
  const series: MarketChartPoint[] = Array.from({ length: safeLimit }, (_, index) => {
    const time = now - (safeLimit - index - 1) * 60;
    const wave = Math.sin((index + seed) / 8) * (base * 0.004);
    const drift = index * (base * 0.00003);
    return {
      time,
      value: Number((base + wave + drift).toFixed(4)),
      volume: Math.round(1800 + Math.abs(Math.cos((index + seed) / 5)) * 4200),
    };
  });

  return {
    series,
    source: "frontend dummy market chart",
    updatedAt: new Date().toISOString(),
  };
}

export async function getDummyStreamSample(request: Record<string, unknown>) {
  await wait(90);
  const source = String(request.source_url || request.stream_chain || "stream");
  const seed = symbolSeed(source);
  const value = 100 + (seed % 900) + Math.sin(Date.now() / 6000) * 8;
  return {
    snapshot: {
      timestamp: new Date().toISOString(),
      values: {
        price: Number(value.toFixed(4)),
        value: Number(value.toFixed(4)),
        volume: Math.round(1500 + (seed % 4000)),
        source,
      },
    },
  };
}

export async function fetchDummyContractAbi({ chain, address }: { chain: string; address: string }) {
  await wait(120);
  return {
    chain,
    address,
    source: "frontend dummy abi",
    abi: [
      {
        type: "function",
        name: "swapExactTokensForTokens",
        stateMutability: "nonpayable",
        inputs: [
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "path", type: "address[]" },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
        outputs: [{ name: "amounts", type: "uint256[]" }],
      },
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "balance", type: "uint256" }],
      },
    ],
  };
}
