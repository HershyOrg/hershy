import type { ConnectedWallet, EIP1193Provider } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddress,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import { createScwChain } from "@/shared/config/scwConfig";

export const MANTLE_SEPOLIA_CHAIN_ID = 5003;
export const MANTLE_SEPOLIA_RPC_URL = "https://rpc.sepolia.mantle.xyz";
export const MANTLE_SEPOLIA_EXPLORER_URL = "https://explorer.sepolia.mantle.xyz";

export type MantleCallInput = {
  wallet: ConnectedWallet;
  accountAddress: string;
  to: string;
  data: string;
  valueWei?: string;
  rpcUrl?: string;
};

export type MantleCallResult = {
  chainId: typeof MANTLE_SEPOLIA_CHAIN_ID;
  txHash: Hex;
  watchToken: Hex;
};

function getProviderErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "number") return code;
  if (typeof code === "string") return Number(code);
  return undefined;
}

function normalizeCallData(data: string): Hex {
  const trimmed = data.trim() || "0x";
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed)) {
    throw new Error("data must be 0x-prefixed hex calldata");
  }
  return trimmed as Hex;
}

function normalizeValueWei(valueWei = "0") {
  const trimmed = valueWei.trim() || "0";
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("valueWei must be a decimal wei string");
  }
  return BigInt(trimmed);
}

async function ensureMantleSepolia(wallet: ConnectedWallet, provider: EIP1193Provider, rpcUrl: string) {
  const targetChainId = numberToHex(MANTLE_SEPOLIA_CHAIN_ID);

  if (wallet.chainId === `eip155:${MANTLE_SEPOLIA_CHAIN_ID}` || wallet.chainId === targetChainId) {
    return;
  }

  try {
    await wallet.switchChain(MANTLE_SEPOLIA_CHAIN_ID);
    return;
  } catch {
    // Some embedded wallet providers only expose the raw EIP-1193 chain methods.
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  } catch (error) {
    if (getProviderErrorCode(error) !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetChainId,
          chainName: "Mantle Sepolia Testnet",
          nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: [MANTLE_SEPOLIA_EXPLORER_URL],
        },
      ],
    });
  }
}

export async function executeMantleCall({
  wallet,
  accountAddress,
  to,
  data,
  valueWei = "0",
  rpcUrl = MANTLE_SEPOLIA_RPC_URL,
}: MantleCallInput): Promise<MantleCallResult> {
  if (!isAddress(to)) {
    throw new Error("to must be a valid contract address");
  }

  const initialProvider = await wallet.getEthereumProvider();
  await ensureMantleSepolia(wallet, initialProvider, rpcUrl);
  const provider = await wallet.getEthereumProvider();
  const account = getAddress(accountAddress);
  const chain = createScwChain(MANTLE_SEPOLIA_CHAIN_ID, rpcUrl);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: custom(provider),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const txHash = await walletClient.sendTransaction({
    account,
    chain,
    to: getAddress(to) as Address,
    data: normalizeCallData(data),
    value: normalizeValueWei(valueWei),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    chainId: MANTLE_SEPOLIA_CHAIN_ID,
    txHash,
    watchToken: txHash,
  };
}

export const watch = {
  useMantleCall: executeMantleCall,
} as const;
