export type LocalWalletStatus = {
  exists: boolean;
  address?: string;
  privateKeyLast4?: string;
  updatedAt?: string;
  storageLabel?: string;
};

const LOCAL_WALLET_API = "/local-wallet-api/wallet";

async function parseLocalWalletResponse(response: Response): Promise<LocalWalletStatus> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "local wallet request failed",
    );
  }
  return payload as LocalWalletStatus;
}

export async function fetchLocalWalletStatus() {
  const response = await fetch(LOCAL_WALLET_API);
  return parseLocalWalletResponse(response);
}

export async function saveLocalWallet(input: { address: string; privateKey: string }) {
  const response = await fetch(LOCAL_WALLET_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseLocalWalletResponse(response);
}

export async function deleteLocalWallet() {
  const response = await fetch(LOCAL_WALLET_API, {
    method: "DELETE",
  });
  return parseLocalWalletResponse(response);
}
