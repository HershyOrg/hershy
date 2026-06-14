import { defineChain, type Chain } from "viem";
import { mantle, mantleSepoliaTestnet } from "viem/chains";

const DEFAULT_SCW_CHAIN_ID = 5003;
const DEFAULT_SCW_POLICY_ID = "mantle-sepolia-dex-adapter";
const DEFAULT_SCW_RPC_URL = "https://rpc.sepolia.mantle.xyz";

export function getScwChainId() {
  const raw = import.meta.env.VITE_SCW_CHAIN_ID?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_SCW_CHAIN_ID;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SCW_CHAIN_ID;
}

export function getScwPolicyId() {
  return import.meta.env.VITE_SCW_POLICY_ID?.trim() || DEFAULT_SCW_POLICY_ID;
}

export function getScwRpcUrl() {
  return import.meta.env.VITE_SCW_RPC_URL?.trim() || DEFAULT_SCW_RPC_URL;
}

export function createScwChain(chainId = getScwChainId(), rpcUrl = getScwRpcUrl()): Chain {
  if (chainId === mantle.id) {
    return {
      ...mantle,
      rpcUrls: {
        ...mantle.rpcUrls,
        default: { http: [rpcUrl] },
      },
    };
  }

  if (chainId === mantleSepoliaTestnet.id) {
    return {
      ...mantleSepoliaTestnet,
      rpcUrls: {
        ...mantleSepoliaTestnet.rpcUrls,
        default: { http: [rpcUrl] },
      },
    };
  }

  if (chainId === 56) {
    return defineChain({
      id: 56,
      name: "BNB Smart Chain",
      nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
      rpcUrls: {
        default: { http: [rpcUrl] },
      },
      blockExplorers: {
        default: {
          name: "BscScan",
          url: "https://bscscan.com",
        },
      },
    });
  }

  return defineChain({
    id: chainId,
    name: `EVM ${chainId}`,
    nativeCurrency: { decimals: 18, name: "Native Token", symbol: "ETH" },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  });
}
