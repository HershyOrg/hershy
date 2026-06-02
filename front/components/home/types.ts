"use client";

import type { LucideIcon } from "lucide-react";

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

export type StrategyBlock = {
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
  icon: LucideIcon;
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
