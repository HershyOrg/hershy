export type VaultActivityUserRow = {
  vaultAddress: string;
  userAddress: string;
  userName: string;
  avatarUrl?: string;
  depositUsd: number;
  depositAssetAmount: number;
  assetSymbol: string;
  sharePct: number;
  sortOrder: number;
};

export type VaultActivityTransactionType = "Use" | "Drop";

export type VaultActivityTransactionRow = {
  id: string;
  vaultAddress: string;
  type: VaultActivityTransactionType;
  userAddress: string;
  userName: string;
  avatarUrl?: string;
  amountUsd?: number;
  assetAmount?: number;
  assetSymbol?: string;
  txHash: string;
  chain: string;
  createdAt: string;
};

export type VaultActivityResponse = {
  endpoint: string;
  sql: string;
  users: VaultActivityUserRow[];
  transactions: VaultActivityTransactionRow[];
};
