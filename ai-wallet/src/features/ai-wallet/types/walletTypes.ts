export type WalletPanel = "chat" | "graph" | "wallet";

export type WalletSession = {
  id: string;
  label: string;
  apiKeyAlias: string;
  eoaAddress: string;
  scwAddress: string;
  network: string;
  status: "ready" | "funding" | "executing";
  createdAt: string;
  fundingAsset: string;
  fundingAmount: number;
  gasBudgetUsd: number;
};

export type TokenAsset = {
  id: string;
  symbol: string;
  name: string;
  summary?: string;
  firstPrompt?: string;
  contractAddress: string;
  balance: number;
  lockedBalance: number;
  fiatPrice: number;
  change24h: number;
  color: string;
  decimals: number;
  isMajor: boolean;
};

export type TokenTracker = {
  id: string;
  symbol: string;
  contractAddress: string;
  enabled: boolean;
  source: "default" | "custom";
};

export type WalletTransaction = {
  id: string;
  title: string;
  summary: string;
  hash: string;
  kind: "deposit" | "swap" | "execute" | "release";
  status: "confirmed" | "pending" | "failed";
  timestamp: string;
  amountLabel: string;
};

export type LockedAsset = {
  symbol: string;
  amount: number;
  usdValue: number;
};

export type StrategyRun = {
  id: string;
  title: string;
  status: "awaiting" | "running" | "complete" | "stopped";
  mode: "one-shot" | "loop";
  progress: number;
  nextStep: string;
  startedAt: string;
  planId?: string;
  budgetCategoryId?: string;
  budgetCategoryName?: string;
  lockedAssets: LockedAsset[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  planId?: string;
};

export type HershyGraphNode = {
  id: string;
  label: string;
  kind: "input" | "rag" | "plan" | "guard" | "execute" | "settle";
  description: string;
  status: "ready" | "review" | "locked" | "pending" | "complete";
  x: number;
  y: number;
};

export type HershyGraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

export type AllowedAction = {
  protocol: string;
  contractAddress: string;
  functionName: string;
  parameters: Array<{
    name: string;
    value: string;
  }>;
};

export type CommerceWorkflowAction = {
  id: string;
  title: string;
  detail: string;
  status: "Ready" | "Reserved" | "Purchased" | "Completed" | "Skipped";
  source: string;
  sourceUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  previewTitle?: string;
  placeName?: string;
  placeAddress?: string;
  mapUrl?: string;
  timing: string;
  selected: string;
  final: string;
  items?: CommerceWorkflowItem[];
};

export type CommerceWorkflowItem = {
  id: string;
  title: string;
  detail?: string;
  quantity: number;
  priceValue: number;
  priceLabel: string;
  sourceUrl: string;
  imageUrl?: string;
  imageAlt?: string;
  previewTitle?: string;
  isSelected: boolean;
};

export type CommerceTimelineStep = {
  id: string;
  time: string;
  title: string;
  detail: string;
};

export type GeneratedPlan = {
  id: string;
  title: string;
  userPrompt: string;
  summary: string;
  explanation?: string;
  analysisSignals?: string[];
  workflowActions?: CommerceWorkflowAction[];
  timeline?: CommerceTimelineStep[];
  totalLabel?: string;
  totalDetail?: string;
  budgetCategoryId?: string;
  budgetCategoryName?: string;
  budgetAllocatedUsd?: number;
  budgetReservedUsd?: number;
  generatedAt: string;
  approvalStatus: "draft" | "approved" | "executing" | "executed";
  riskLevel: "low" | "medium" | "high";
  estimatedGasUsd: number;
  codeFingerprint: string;
  allowedAction: AllowedAction;
  lockedAssets: LockedAsset[];
  graph: {
    nodes: HershyGraphNode[];
    edges: HershyGraphEdge[];
  };
};

export type WalletWorkspaceSnapshot = {
  session: WalletSession;
  assets: TokenAsset[];
  trackers: TokenTracker[];
  transactions: WalletTransaction[];
  runs: StrategyRun[];
  messages: ChatMessage[];
  activePlan: GeneratedPlan;
};
