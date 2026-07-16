import type { Edge, Node } from "@xyflow/react";

export type ThemePreference = "dark" | "light" | "system";

export type ClientUserProfile = {
  userId: string;
  displayName: string;
  isLoggedIn: boolean;
};

export type MarketRow = {
  symbol: string;
  price: string;
  change: string;
  tone: "up" | "down";
  icon: string;
  source?: string;
};

export type ExchangeConnectionCredentials = {
  hasApiKey?: boolean;
  hasApiSecret?: boolean;
  hasApiPassphrase?: boolean;
  hasPrivateKey?: boolean;
  hasFunder?: boolean;
  hasAnyL2?: boolean;
  hasL2Bundle?: boolean;
  apiKeyLast4?: string;
  privateKeyLast4?: string;
  authStatus?: string;
  authMarket?: string;
  lastAuthCheckAt?: string;
  lastAuthError?: string;
  funder?: string;
  chainId?: string;
};

export type ExchangeConnection = {
  id: string;
  name: string;
  type: "CEX" | "DEX" | "RPC";
  status: string;
  scopes?: string[];
  color?: string;
  apiUrl?: string;
  restUrl?: string;
  wsUrl?: string;
  rpcUrl?: string;
  marketDataUrl?: string;
  credentials?: ExchangeConnectionCredentials;
};

export type BalanceMyDataAsset = {
  asset: string;
  free?: string;
  locked?: string;
  total?: string;
  available?: string;
  valueUsd?: number;
  availableUsd?: number;
  walletBalance?: string;
  marginBalance?: string;
  unrealizedPnl?: string;
  sourceField?: string;
};

export type BalanceMyDataSnapshot = {
  id: string;
  exchangeId?: string;
  connectionId?: string;
  exchangeName?: string;
  exchange?: string;
  market?: string;
  accountType?: string;
  source?: string;
  updatedAt?: string;
  assets?: BalanceMyDataAsset[];
  totals?: {
    assetCount?: number;
    totalValueUsd?: number;
    totalAvailableUsd?: number;
    stableAvailableUsd?: number;
  };
  spendable?: {
    preferredAsset?: string;
    preferredAvailable?: string;
    preferredAvailableUsd?: number;
    totalStableAvailableUsd?: number;
    stableAssets?: Array<{
      asset: string;
      available: string;
      availableUsd?: number;
    }>;
    policy?: string;
  };
};

export type HistoricalDataStorageMode = "inline" | "metadata";

export type HistoricalMissingDateRange = {
  symbol: string;
  startDate: string;
  endDate: string;
  count: number;
};

export type HistoricalDataDataset = {
  id: string;
  fileName: string;
  format: "csv" | "json";
  byteSize: number;
  sourceFiles?: Array<{
    fileName: string;
    byteSize: number;
    rowCount: number;
    format: "csv" | "json";
  }>;
  rowCount: number;
  droppedRows: number;
  duplicateRows: number;
  startDate: string;
  endDate: string;
  symbols: string[];
  intervalLabel: string;
  detectedMetrics: string[];
  warnings: string[];
  errors: string[];
  rawPreviewText: string;
  normalizedPreviewRows: Array<Record<string, number | string>>;
  missingDateCount: number;
  missingDatesPreview: Array<{
    symbol: string;
    date: string;
  }>;
  missingDateRanges: HistoricalMissingDateRange[];
  uploadedAt: number;
  updatedAt: number;
  storageMode: HistoricalDataStorageMode;
  rawText?: string;
};

export type ApiHistoricalDataMapping = {
  id: string;
  apiId: string;
  apiName: string;
  datasetId: string;
  createdAt: number;
  updatedAt: number;
};

export type PersistedHistoricalDataState = {
  version: 1;
  savedAt: number;
  datasets: HistoricalDataDataset[];
  mappings: ApiHistoricalDataMapping[];
  activeApiId?: string;
};

export type ExchangeFormState = {
  id: string;
  name: string;
  type: ExchangeConnection["type"];
  apiUrl: string;
  wsUrl: string;
  rpcUrl: string;
  marketDataUrl: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  privateKey: string;
  funder: string;
  chainId: string;
};

export type AgentActivity = {
  id: string;
  timestamp?: string;
  status: string;
  stage: string;
  label: string;
  detail?: Record<string, unknown>;
};

export type DomainGraphNode = Node<Record<string, any>>;
export type DomainGraphEdge = Edge<Record<string, any>>;

export type AdvancedGraphModel = {
  nodes: DomainGraphNode[];
  edges: DomainGraphEdge[];
};

export type PersistedStrategyBuilderState = {
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

export type HistorySnapshotCodeMeta = {
  strategyTitle?: string;
  strategySummary?: string;
  generatedCode?: string;
  programCode?: string;
  strategyGraph?: unknown | null;
  graphSignature?: string;
  programCodeSignature?: string;
  aiSummary?: string;
  agentSteps?: string[];
};

export type HistorySnapshot = {
  id: string;
  name: string;
  parentId: string | null;
  nodes: DomainGraphNode[];
  edges: DomainGraphEdge[];
  codeMeta?: HistorySnapshotCodeMeta;
  timestamp: number;
};

export type HistorySnapshotGroup = {
  id: string;
  snapshotIds: string[];
};

export type HistoryStoreState = {
  snapshots: HistorySnapshot[];
  activeId: string | null;
  openTabs: string[];
  hiddenGroups: HistorySnapshotGroup[];
};

export type PersistedHistoryStoreState = HistoryStoreState & {
  version: 1;
  savedAt: number;
};

export type ClientAppState = {
  version: 1;
  savedAt: number;
  theme?: {
    preference?: ThemePreference;
  };
  user?: Partial<ClientUserProfile>;
  guide?: {
    completedByUserId?: Record<string, boolean>;
  };
  strategyBuilder?: PersistedStrategyBuilderState | null;
  history?: PersistedHistoryStoreState | null;
  historicalData?: PersistedHistoricalDataState | null;
};
