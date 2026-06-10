import { userAccountsTable } from "../userTables";
import { strategyVaultsTable } from "../vaultTables";
import type { VaultActivityTransactionRow, VaultActivityUserRow } from "./schema";

const participantWeights = [0.36, 0.24, 0.15, 0.09, 0.06, 0.035, 0.025, 0.018, 0.014, 0.008];
const transactionTypes: VaultActivityTransactionRow["type"][] = [
  "Use",
  "Use",
  "Drop",
  "Use",
  "Use",
  "Drop",
  "Use",
  "Use",
  "Drop",
  "Use",
  "Use",
  "Drop",
  "Use",
  "Drop",
  "Use",
  "Drop",
  "Use",
  "Drop",
];

const vaultAssetSymbols: Record<string, string> = {
  "btc-funding-carry": "USDC",
  "usdc-depeg-router": "USDC",
  "eth-lst-basis": "ETH",
  "sol-momentum-ladder": "USDC",
  "gmx-basis-hedge": "USDC",
  "stable-loop-yield": "USDC",
  "kimchi-spread-watch": "USDC",
  "lp-delta-neutral": "USDC",
  "eth-perp-basis-sweep": "ETH",
  "arb-bridge-latency": "USDC",
};

function displayName(creatorId: string) {
  return creatorId
    .split(/[.-]/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getAssetAmount(valueUsd: number, assetSymbol: string) {
  if (assetSymbol === "ETH") return roundMoney(valueUsd / 3285.6);
  if (assetSymbol === "SOL") return roundMoney(valueUsd / 152.4);
  if (assetSymbol === "BTC") return roundMoney(valueUsd / 67245.8);
  return roundMoney(valueUsd);
}

function buildTxHash(vaultAddress: string, index: number) {
  return `${vaultAddress.slice(0, 34)}${String(index + 11).padStart(6, "0")}`;
}

export const vaultActivityUsersTable: VaultActivityUserRow[] = strategyVaultsTable.flatMap((vault, vaultIndex) => {
  const assetSymbol = vaultAssetSymbols[vault.strategyId] ?? "USDC";

  return participantWeights.map((weight, participantIndex) => {
    const account = userAccountsTable[(vaultIndex + participantIndex) % userAccountsTable.length];
    const depositUsd = roundMoney(vault.strategyEquity * weight);

    return {
      vaultAddress: vault.address,
      userAddress: account.eoaAddress,
      userName: displayName(account.creatorId),
      avatarUrl: account.avatarUrl,
      depositUsd,
      depositAssetAmount: getAssetAmount(depositUsd, assetSymbol),
      assetSymbol,
      sharePct: weight,
      sortOrder: participantIndex + 1,
    };
  });
});

export const vaultActivityTransactionsTable: VaultActivityTransactionRow[] = strategyVaultsTable.flatMap(
  (vault, vaultIndex) => {
    const assetSymbol = vaultAssetSymbols[vault.strategyId] ?? "USDC";
    const baseTimestamp = Date.parse(vault.updatedAt);

    return transactionTypes.map((type, transactionIndex) => {
      const account = userAccountsTable[(vaultIndex + transactionIndex + 1) % userAccountsTable.length];
      const amountUsd = roundMoney(vault.strategyEquity * (0.024 / (1 + transactionIndex * 0.18)));

      return {
        id: `${vault.strategyId}-activity-${transactionIndex + 1}`,
        vaultAddress: vault.address,
        type,
        userAddress: account.eoaAddress,
        userName: displayName(account.creatorId),
        avatarUrl: account.avatarUrl,
        amountUsd,
        assetAmount: amountUsd ? getAssetAmount(amountUsd, assetSymbol) : undefined,
        assetSymbol: amountUsd ? assetSymbol : undefined,
        txHash: buildTxHash(vault.address, transactionIndex),
        chain: vault.chains[transactionIndex % vault.chains.length] ?? "Ethereum",
        createdAt: new Date(baseTimestamp - transactionIndex * 18 * 60 * 1000).toISOString(),
      };
    });
  },
);
