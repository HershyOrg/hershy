import type { LucideIcon } from "lucide-react";
export type {
  AgentActivity,
  BalanceMyDataAsset,
  BalanceMyDataSnapshot,
  ExchangeConnection,
  ExchangeConnectionCredentials,
  ExchangeFormState,
  MarketRow,
} from "@/shared/types/domain";

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
