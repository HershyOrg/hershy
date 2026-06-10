import type { StrategyVaultMetadata, StrategyVaultResponse, VaultPeriodLabel } from "./schema";
import { strategyVaultsTable, vaultBalancesTable, vaultPeriodsTable } from "./vaultTables";

const periodOrder: Record<VaultPeriodLabel, number> = {
  "24h": 1,
  "7d": 2,
  "30d": 3,
  All: 4,
};

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildVaultMetadataEndpoint(strategyId: string) {
  return `/api/strategy-exchange/vaults/${encodeURIComponent(strategyId)}`;
}

export function buildVaultByAddressEndpoint(address: string) {
  return `/api/strategy-exchange/vault-addresses/${encodeURIComponent(address)}`;
}

export function buildVaultByStrategyIdSql(strategyId: string) {
  return [
    "select",
    "  v.*,",
    "  p.label as period_label, p.pnl as period_pnl, p.equity as period_equity, p.volume as period_volume,",
    "  b.token, b.venue, b.amount, b.value, b.weight",
    "from strategy_vaults v",
    "left join vault_periods p on p.strategy_id = v.strategy_id",
    "left join vault_balances b on b.strategy_id = v.strategy_id",
    `where v.strategy_id = ${sqlString(strategyId)}`,
    "order by p.label, b.sort_order;",
  ].join("\n");
}

export function buildVaultByAddressSql(address: string) {
  return [
    "select",
    "  v.*,",
    "  p.label as period_label, p.pnl as period_pnl, p.equity as period_equity, p.volume as period_volume,",
    "  b.token, b.venue, b.amount, b.value, b.weight",
    "from strategy_vaults v",
    "left join vault_periods p on p.strategy_id = v.strategy_id",
    "left join vault_balances b on b.strategy_id = v.strategy_id",
    `where lower(v.address) = lower(${sqlString(address)})`,
    "order by p.label, b.sort_order;",
  ].join("\n");
}

export function selectVaultByStrategyId(strategyId: string): StrategyVaultMetadata | null {
  const vault = strategyVaultsTable.find((row) => row.strategyId === strategyId);
  if (!vault) return null;

  return {
    ...vault,
    periods: vaultPeriodsTable
      .filter((row) => row.strategyId === strategyId)
      .sort((a, b) => periodOrder[a.label] - periodOrder[b.label]),
    balances: vaultBalancesTable
      .filter((row) => row.strategyId === strategyId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export function selectVaultByAddress(address: string): StrategyVaultMetadata | null {
  const vault = strategyVaultsTable.find((row) => row.address.toLowerCase() === address.toLowerCase());
  return vault ? selectVaultByStrategyId(vault.strategyId) : null;
}

export async function requestVaultMetadata(strategyId: string): Promise<StrategyVaultResponse> {
  const endpoint = buildVaultMetadataEndpoint(strategyId);

  if (typeof fetch === "function") {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });
      if (response.ok) {
        return (await response.json()) as StrategyVaultResponse;
      }
    } catch {
      // Static previews can render without the Vite mock API; keep the modal usable.
    }
  }

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultByStrategyIdSql(strategyId),
    vault: selectVaultByStrategyId(strategyId),
  };
}

export async function requestVaultMetadataByAddress(address: string): Promise<StrategyVaultResponse> {
  const endpoint = buildVaultByAddressEndpoint(address);

  if (typeof fetch === "function") {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });
      if (response.ok) {
        return (await response.json()) as StrategyVaultResponse;
      }
    } catch {
      // Static previews can render without the Vite mock API; keep address routes usable.
    }
  }

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultByAddressSql(address),
    vault: selectVaultByAddress(address),
  };
}
