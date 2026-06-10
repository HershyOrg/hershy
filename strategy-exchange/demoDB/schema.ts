export type VaultPeriodLabel = "24h" | "7d" | "30d" | "All";

export type StrategyVaultRow = {
  strategyId: string;
  address: string;
  leaderAddress: string;
  leaderFraction: number;
  leaderCommission: number;
  projectedApr: number;
  strategyEquity: number;
  allTimePnl: number;
  chains: string[];
  updatedAt: string;
};

export type VaultPeriodRow = {
  strategyId: string;
  label: VaultPeriodLabel;
  pnl: number;
  equity: number;
  volume: number;
};

export type VaultBalanceRow = {
  strategyId: string;
  token: string;
  venue: string;
  chain: string;
  amount: number;
  value: number;
  weight: number;
  sortOrder: number;
};

export type StrategyVaultMetadata = StrategyVaultRow & {
  periods: VaultPeriodRow[];
  balances: VaultBalanceRow[];
};

export type StrategyVaultResponse = {
  endpoint: string;
  sql: string;
  vault: StrategyVaultMetadata | null;
};
