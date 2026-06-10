import { userAccountsTable, type UserAccountRow } from "./userTables";

export type UserAccountResponse = {
  endpoint: string;
  sql: string;
  account: UserAccountRow | null;
};

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

export function buildUserByAddressEndpoint(address: string) {
  return `/api/strategy-exchange/users/${encodeURIComponent(address)}`;
}

export function buildUserByAddressSql(address: string) {
  return [
    "select",
    "  u.*",
    "from user_accounts u",
    `where lower(u.eoa_address) = lower(${sqlString(address)})`,
    "limit 1;",
  ].join("\n");
}

export function selectUserAccountByAddress(address: string): UserAccountRow | null {
  const normalizedAddress = normalizeAddress(address);
  return (
    userAccountsTable.find(
      (row) =>
        normalizeAddress(row.eoaAddress) === normalizedAddress ||
        row.aliases.some((alias) => normalizeAddress(alias) === normalizedAddress),
    ) ?? null
  );
}

export function selectUserAccountByCreatorId(creatorId: string): UserAccountRow | null {
  return userAccountsTable.find((row) => row.creatorId === creatorId) ?? null;
}

export async function requestUserAccountByAddress(address: string): Promise<UserAccountResponse> {
  const endpoint = buildUserByAddressEndpoint(address);

  if (typeof fetch === "function") {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });
      if (response.ok) {
        return (await response.json()) as UserAccountResponse;
      }
    } catch {
      // Static previews can render without the Vite mock API; keep address routes usable.
    }
  }

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildUserByAddressSql(address),
    account: selectUserAccountByAddress(address),
  };
}
