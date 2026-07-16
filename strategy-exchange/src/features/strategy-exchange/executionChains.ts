export const currentExecutionChains: readonly string[] = ["Hyperliquid"];
export const primaryExecutionChain = currentExecutionChains[0] ?? "Hyperliquid";

export const defaultScwUsdcByChain: Record<string, number> = {
  Hyperliquid: 32000,
};

export function keepCurrentExecutionChainBalances(balances: Record<string, number> | null | undefined) {
  return currentExecutionChains.reduce<Record<string, number>>((currentBalances, chain) => {
    currentBalances[chain] = balances?.[chain] ?? defaultScwUsdcByChain[chain] ?? 0;
    return currentBalances;
  }, {});
}
