import { strategies } from "./strategyCatalog";
import { getBaseForkCount } from "../utils/strategyMetrics";

const bookmarkKey = "strategy-exchange-bookmarks";
const usedKey = "strategy-exchange-used";
const forkKey = "strategy-exchange-forks";
const positionKey = "strategy-exchange-positions";
const scwUsdcBalanceKey = "strategy-exchange-scw-usdc-balances";

export type ScwUsdcBalances = Record<string, number>;

const defaultScwUsdcBalances: ScwUsdcBalances = {
  Ethereum: 18000,
  Arbitrum: 1500,
  Solana: 2200,
  "BNB Chain": 900,
  Base: 7200,
  Bitcoin: 2400,
  Cosmos: 1800,
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(key);
  return saved ? (JSON.parse(saved) as T) : null;
}

export function readBookmarkStore() {
  return new Set(readJson<string[]>(bookmarkKey) ?? ["btc-funding-carry"]);
}

export function writeBookmarkStore(bookmarks: Set<string>) {
  window.localStorage.setItem(bookmarkKey, JSON.stringify(Array.from(bookmarks)));
}

export function readUsedStrategyStore() {
  return new Set(readJson<string[]>(usedKey) ?? []);
}

export function writeUsedStrategyStore(usedStrategies: Set<string>) {
  window.localStorage.setItem(usedKey, JSON.stringify(Array.from(usedStrategies)));
}

export function readStrategyPositionStore() {
  return readJson<Record<string, number>>(positionKey) ?? {};
}

export function writeStrategyPositionStore(strategyPositions: Record<string, number>) {
  window.localStorage.setItem(positionKey, JSON.stringify(strategyPositions));
}

export function readScwUsdcBalanceStore() {
  return {
    ...defaultScwUsdcBalances,
    ...(readJson<ScwUsdcBalances>(scwUsdcBalanceKey) ?? {}),
  };
}

export function writeScwUsdcBalanceStore(scwUsdcBalances: ScwUsdcBalances) {
  window.localStorage.setItem(scwUsdcBalanceKey, JSON.stringify(scwUsdcBalances));
}

export function buildBaseForkCounts() {
  return Object.fromEntries(strategies.map((strategy) => [strategy.id, getBaseForkCount(strategy)]));
}

export function readForkCountStore() {
  const baseCounts = buildBaseForkCounts();
  const saved = readJson<Record<string, number>>(forkKey);
  return saved ? { ...baseCounts, ...saved } : baseCounts;
}

export function writeForkCountStore(forkCounts: Record<string, number>) {
  window.localStorage.setItem(forkKey, JSON.stringify(forkCounts));
}
