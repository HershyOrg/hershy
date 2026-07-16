import { keepCurrentExecutionChainBalances } from "../executionChains";

const bookmarkKey = "strategy-exchange-bookmarks";
const usedKey = "strategy-exchange-used";
const positionKey = "strategy-exchange-positions";
const scwUsdcBalanceKey = "strategy-exchange-scw-usdc-balances";

export type ScwUsdcBalances = Record<string, number>;

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(key);
  return saved ? (JSON.parse(saved) as T) : null;
}

export function readBookmarkStore() {
  return new Set(readJson<string[]>(bookmarkKey) ?? ["hl-majors-index"]);
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
  const saved = readJson<ScwUsdcBalances>(scwUsdcBalanceKey);
  return keepCurrentExecutionChainBalances(saved);
}

export function writeScwUsdcBalanceStore(scwUsdcBalances: ScwUsdcBalances) {
  window.localStorage.setItem(
    scwUsdcBalanceKey,
    JSON.stringify(keepCurrentExecutionChainBalances(scwUsdcBalances)),
  );
}
