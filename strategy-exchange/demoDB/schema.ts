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

export type AdapterPositionRow = {
  strategyId: string;
  coin: string;
  side: "Long" | "Short";
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  marginUsed: number;
  unrealizedPnl: number;
  fundingRate: number;
  leverage: number;
  sortOrder: number;
};

export type AdapterTradeHistoryRow = {
  strategyId: string;
  id: string;
  actor: "Logic Creator" | "User";
  accountLabel: string;
  action: "Open" | "Close" | "Increase" | "Reduce";
  coin: string;
  side: "Long" | "Short";
  price: number;
  size: number;
  value: number;
  fee: number;
  pnl: number;
  createdAt: string;
  sortOrder: number;
};

export type AdapterFundingHistoryRow = {
  strategyId: string;
  id: string;
  coin: string;
  side: "Long" | "Short";
  rate: number;
  payment: number;
  createdAt: string;
  sortOrder: number;
};

export type AdapterFlowRow = {
  strategyId: string;
  id: string;
  type: "Deposit" | "Withdrawal";
  accountLabel: string;
  amount: number;
  createdAt: string;
  sortOrder: number;
};

export type AdapterDepositorRow = {
  strategyId: string;
  id: string;
  maskedAddress: string;
  equity: number;
  sharePct: number;
  pnl: number;
  joinedAt: string;
  sortOrder: number;
};

export type StrategyVaultMetadata = StrategyVaultRow & {
  periods: VaultPeriodRow[];
  balances: VaultBalanceRow[];
  positions: AdapterPositionRow[];
  trades: AdapterTradeHistoryRow[];
  funding: AdapterFundingHistoryRow[];
  flows: AdapterFlowRow[];
  depositors: AdapterDepositorRow[];
};

export type StrategyVaultResponse = {
  endpoint: string;
  sql: string;
  adapter: StrategyVaultMetadata | null;
};
