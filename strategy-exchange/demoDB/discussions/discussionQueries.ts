import { vaultDiscussionMessagesTable } from "./discussionTables";
import type { DiscussionMessageRow, VaultDiscussionResponse } from "./schema";

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildVaultDiscussionEndpoint(address: string) {
  return `/api/strategy-exchange/discussions/vaults/${encodeURIComponent(address)}`;
}

export function buildVaultDiscussionSql(address: string) {
  return [
    "select",
    "  m.id, m.vault_address, m.author_name, m.author_address, m.body, m.created_at",
    "from vault_discussion_messages m",
    `where lower(m.vault_address) = lower(${sqlString(address)})`,
    "order by m.created_at asc;",
  ].join("\n");
}

export function selectDiscussionMessagesByVaultAddress(address: string): DiscussionMessageRow[] {
  return vaultDiscussionMessagesTable
    .filter((message) => message.vaultAddress.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function requestVaultDiscussion(address: string): Promise<VaultDiscussionResponse> {
  const endpoint = buildVaultDiscussionEndpoint(address);

  if (typeof fetch === "function") {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });
      if (response.ok) {
        return (await response.json()) as VaultDiscussionResponse;
      }
    } catch {
      // Static previews can render without the Vite mock API; keep vault discussions usable.
    }
  }

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultDiscussionSql(address),
    messages: selectDiscussionMessagesByVaultAddress(address),
  };
}
