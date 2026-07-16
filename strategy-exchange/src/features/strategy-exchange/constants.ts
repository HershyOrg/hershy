import { connectedExchanges } from "./store/strategyCatalog";
import type { DisclosureMode, ProductType, Sector } from "./types/strategyTypes";

export const sectorLabels: Record<"All" | Sector, string> = {
  All: "전체",
  "Perp Index": "Perp Index",
  Funding: "Funding",
  Basis: "Basis",
  "Market Neutral": "Market Neutral",
  Momentum: "Momentum",
  Liquidity: "Liquidity",
  Volatility: "Volatility",
  "Risk Hedge": "Risk Hedge",
};

export const productTypeLabels: Record<"All" | ProductType, string> = {
  All: "전체",
  Index: "지수",
  Quant: "퀀트",
};

export const disclosureLabels: Record<DisclosureMode, string> = {
  Full: "전체 공개",
  PerformanceOnly: "성과만 공개",
};

export const productTypeDisclosureLabels: Record<"All" | ProductType, string> = {
  All: "전체 상품",
  Index: "ETF형 전체 공개",
  Quant: "로직 비공개 / 성과만 공개",
};

export const connectedVenueSet = new Set(connectedExchanges);

export const strategyDescriptions: Record<string, string> = {
  "hl-majors-index":
    "Publishes a transparent BTC, ETH, SOL, and HYPE perp basket with daily Hyperliquid rebalance weights.",
  "hl-alt-rotation-index":
    "Rotates a public Hyperliquid alt-perp basket by momentum rank while keeping weights and rebalance rules visible.",
  "hl-defensive-collateral-index":
    "Keeps a larger USDC collateral sleeve and smaller major-perp exposure for a lower drawdown index profile.",
  "hl-btc-funding-carry":
    "Captures BTC perp funding on Hyperliquid while keeping delta and margin usage inside private risk bands.",
  "hl-eth-basis-carry":
    "Trades ETH perp basis and funding dislocations with macro filters before margin is committed.",
  "hl-market-neutral-grid":
    "Runs a Hyperliquid maker grid that adjusts bands from live marks, spread, and inventory skew.",
  "hl-liquidation-reversal":
    "Looks for liquidation clusters and orderflow imbalance, then trades short reversal windows with hard stops.",
  "hl-vol-breakout":
    "Detects volatility regime shifts and follows confirmed perp breakouts with trailing risk controls.",
  "hl-orderflow-scalp":
    "Uses Hyperliquid order book pressure and spread gates for short-horizon market-neutral scalps.",
  "hl-margin-risk-hedge":
    "Monitors cross-margin exposure and adds hedge orders when account-level risk moves outside target bands.",
};
