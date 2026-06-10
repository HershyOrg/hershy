import { vaultActivityTransactionsTable, vaultActivityUsersTable } from "./activityTables";
import type { VaultActivityResponse, VaultActivityTransactionRow, VaultActivityUserRow } from "./schema";

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildVaultActivityEndpoint(address: string) {
  return `/api/strategy-exchange/activity/vaults/${encodeURIComponent(address)}`;
}

export function buildVaultActivitySql(address: string) {
  return [
    "select",
    "  u.vault_address, u.user_address, u.user_name, u.deposit_usd, u.deposit_asset_amount,",
    "  u.asset_symbol, u.share_pct,",
    "  t.id as transaction_id, t.type, t.amount_usd, t.asset_amount, t.asset_symbol as transaction_asset_symbol,",
    "  t.tx_hash, t.chain, t.created_at",
    "from vault_activity_users u",
    "left join vault_activity_transactions t on lower(t.vault_address) = lower(u.vault_address)",
    `where lower(u.vault_address) = lower(${sqlString(address)})`,
    "order by u.sort_order asc, t.created_at desc;",
  ].join("\n");
}

export function selectVaultActivityUsersByVaultAddress(address: string): VaultActivityUserRow[] {
  return vaultActivityUsersTable
    .filter((row) => row.vaultAddress.toLowerCase() === address.toLowerCase())
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function selectVaultActivityTransactionsByVaultAddress(address: string): VaultActivityTransactionRow[] {
  return vaultActivityTransactionsTable
    .filter((row) => row.vaultAddress.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function requestVaultActivity(address: string): Promise<VaultActivityResponse> {
  const endpoint = buildVaultActivityEndpoint(address);

  if (typeof fetch === "function") {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });
      if (response.ok) {
        return (await response.json()) as VaultActivityResponse;
      }
    } catch {
      // Static previews can render without the Vite mock API; keep vault activity usable.
    }
  }

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultActivitySql(address),
    users: selectVaultActivityUsersByVaultAddress(address),
    transactions: selectVaultActivityTransactionsByVaultAddress(address),
  };
}
