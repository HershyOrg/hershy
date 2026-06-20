import { defineChain, type Chain } from "viem";

const DEFAULT_SCW_CHAIN_ID = 56;
const DEFAULT_SCW_POLICY_ID = "bsc-eth-usdt-swap";
const DEFAULT_SCW_RPC_URL = "https://bsc-dataseed.binance.org";

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
