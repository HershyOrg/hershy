import { connectedExchanges } from "./store/strategyCatalog";
import type { Sector } from "./types/strategyTypes";

export const sectorLabels: Record<"All" | Sector, string> = {
  All: "전체",
  CEX: "CEX",
  DeFi: "DeFi",
  Mixed: "혼합",
  Funding: "펀딩",
  Basis: "베이시스",
  "LP/Hedge": "LP/Hedge",
};

export const connectedVenueSet = new Set(connectedExchanges);

export const strategyDescriptions: Record<string, string> = {
  "btc-funding-carry":
    "Keeps BTC delta close to neutral while routing spot and perp legs across connected CEX venues to collect funding spread.",
  "usdc-depeg-router":
    "Routes stablecoin liquidity between CEX redemption and DeFi pools when USDC deviates from target liquidity bands.",
  "eth-lst-basis":
    "Rotates ETH into LST, lending, and DEX legs when the LST discount and borrow curve create positive basis.",
  "sol-momentum-ladder":
    "Stages SOL entries across connected CEX venues, scales exposure only while momentum and risk caps stay aligned.",
  "gmx-basis-hedge":
    "Pairs GMX vault exposure with Hyperliquid and Binance hedges to keep directional risk bounded while basis accrues.",
  "stable-loop-yield":
    "Runs conservative stablecoin supply, borrow, and swap loops across DeFi venues with utilization guardrails.",
  "kimchi-spread-watch":
    "Monitors KRW market premium and CEX hedge routes, then flags executable spread windows after FX and liquidity checks.",
  "lp-delta-neutral":
    "Combines LP range exposure with options and lending legs so pool yield can run with capped delta and gamma risk.",
  "eth-perp-basis-sweep":
    "Sweeps ETH basis between perp and lending venues, using macro filters before margin is committed.",
  "arb-bridge-latency":
    "Watches Arbitrum bridge timing and local DEX displacement, then hedges inventory through connected CEX liquidity.",
};

export const baseForkCounts: Record<string, number> = {
  "btc-funding-carry": 128,
  "usdc-depeg-router": 214,
  "eth-lst-basis": 76,
  "sol-momentum-ladder": 92,
  "gmx-basis-hedge": 104,
  "stable-loop-yield": 58,
  "kimchi-spread-watch": 167,
  "lp-delta-neutral": 49,
  "eth-perp-basis-sweep": 63,
  "arb-bridge-latency": 71,
};
