import type { Strategy } from "../types/strategyTypes";

const shareSymbols: Record<string, string> = {
  "hl-majors-index": "HMI",
  "hl-alt-rotation-index": "HAI",
  "hl-defensive-collateral-index": "HDI",
  "hl-btc-funding-carry": "BFC",
  "hl-eth-basis-carry": "EBC",
  "hl-market-neutral-grid": "MNG",
  "hl-liquidation-reversal": "HLR",
  "hl-vol-breakout": "HVB",
  "hl-orderflow-scalp": "HOS",
  "hl-margin-risk-hedge": "CMH",
};

export const vaultSharePalettes = [
  { bg: "#b45309", accent: "#fde68a", ink: "#1f1303" },
  { bg: "#065f46", accent: "#6ee7b7", ink: "#041611" },
  { bg: "#1d4ed8", accent: "#bfdbfe", ink: "#06142c" },
  { bg: "#7c2d12", accent: "#fdba74", ink: "#1f0d04" },
  { bg: "#4338ca", accent: "#c4b5fd", ink: "#111033" },
  { bg: "#9f1239", accent: "#fda4af", ink: "#250510" },
  { bg: "#0f766e", accent: "#99f6e4", ink: "#041a18" },
  { bg: "#475569", accent: "#e2e8f0", ink: "#0f172a" },
];

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getVaultShareSymbol(strategy: Strategy) {
  if (shareSymbols[strategy.id]) return shareSymbols[strategy.id];

  const words = strategy.title
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function getVaultShareMarketCap(strategy: Strategy) {
  return Math.max(
    12_000,
    strategy.deployedCapital + strategy.realizedPnl + strategy.dailyVolume * 0.035,
  );
}

export function getVaultSharePalette(strategy: Strategy) {
  return vaultSharePalettes[hashString(strategy.id) % vaultSharePalettes.length];
}
