import type { UserAccountRow } from "../../../../demoDB";

export type Sector =
  | "Perp Index"
  | "Funding"
  | "Basis"
  | "Market Neutral"
  | "Momentum"
  | "Liquidity"
  | "Volatility"
  | "Risk Hedge";

export type BrowseFilter = "Featured" | "Perp Index" | "Funding Carry" | "Market Neutral" | "Tactical Quant";
export type ProductType = "Index" | "Quant";
export type DisclosureMode = "Full" | "PerformanceOnly";

export type GraphNode = {
  id: string;
  label: string;
  x: number;
  y: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  label: string;
};

export type Creator = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  exchanges: string[];
  chains: string[];
  walletAddress?: string;
  tradedCapital: number;
  tradingProfit: number;
};

export type Strategy = {
  id: string;
  title: string;
  creatorId: string;
  primarySector: Sector;
  sectors: Sector[];
  productType: ProductType;
  disclosure: DisclosureMode;
  venues: string[];
  chains: string[];
  markets: string[];
  assetClasses: string[];
  pnlSeries: number[];
  realizedPnl: number;
  pnlPct: number;
  deployedCapital: number;
  dailyVolume: number;
  winRate: number;
  maxDrawdown: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type AddressRoute =
  | {
      kind: "vault";
      address: string;
      strategyId: string;
    }
  | {
      kind: "user";
      address: string;
      account: UserAccountRow;
    }
  | {
      kind: "unknown";
      address: string;
    };

export type VaultViewMode = "value" | "canvas";

export type UserStrategyLogic = {
  id: string;
  name: string;
  description: string;
  strategyText: string;
  baseLogicId?: string;
  createdAt: string;
  updatedAt: string;
};

export type StrategyLogicDraft = {
  name: string;
  description: string;
  strategyText: string;
  baseLogicId: string;
};

export type UserProfileDraft = {
  name: string;
  handle: string;
  bio: string;
  avatarUrl: string;
  twitter: string;
  github: string;
  exchanges: string[];
  chains: string[];
};

export type UserProfileView = UserProfileDraft & {
  creatorId: string;
  updatedAt?: string;
};
