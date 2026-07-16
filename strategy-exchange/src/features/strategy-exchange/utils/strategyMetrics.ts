import { connectedVenueSet, strategyDescriptions } from "../constants";
import type { BrowseFilter, Strategy } from "../types/strategyTypes";
import { formatCompact } from "../../../shared/utils/formatters";

export function getDisconnectedVenues(strategy: Strategy) {
  return strategy.venues.filter((venue) => !connectedVenueSet.has(venue));
}

export function getLargestSwing(strategy: Strategy) {
  return strategy.pnlSeries.reduce((largest, value, index, series) => {
    if (index === 0) return largest;
    return Math.max(largest, Math.abs(value - series[index - 1]));
  }, 0);
}

export function getStrategyDescription(strategy: Strategy) {
  return strategyDescriptions[strategy.id] ?? `${strategy.title} strategy logic.`;
}

export function getHotScore(strategy: Strategy) {
  return strategy.deployedCapital / 1200 + strategy.dailyVolume / 1800 + strategy.pnlPct * 18;
}

function getFeaturedScore(strategy: Strategy) {
  const connectedVenues = strategy.venues.length - getDisconnectedVenues(strategy).length;
  return getHotScore(strategy) + connectedVenues * 80 + strategy.winRate * 2;
}

export function strategyMatchesBrowseFilter(strategy: Strategy, filter: BrowseFilter) {
  if (filter === "Featured") return true;
  if (filter === "Perp Index") return strategy.productType === "Index" || strategy.sectors.includes("Perp Index");
  if (filter === "Funding Carry") return strategy.sectors.includes("Funding") || strategy.sectors.includes("Basis");
  if (filter === "Market Neutral") {
    return strategy.sectors.includes("Market Neutral") || strategy.sectors.includes("Risk Hedge");
  }
  return strategy.productType === "Quant" && (
    strategy.sectors.includes("Momentum") ||
    strategy.sectors.includes("Liquidity") ||
    strategy.sectors.includes("Volatility")
  );
}

export function sortStrategiesByFilter(items: Strategy[], filter: BrowseFilter) {
  return [...items]
    .filter((strategy) => strategyMatchesBrowseFilter(strategy, filter))
    .sort((a, b) => {
      if (filter === "Perp Index") return b.deployedCapital - a.deployedCapital;
      if (filter === "Funding Carry") return b.pnlPct - a.pnlPct;
      if (filter === "Market Neutral") return a.maxDrawdown - b.maxDrawdown;
      if (filter === "Tactical Quant") return b.dailyVolume - a.dailyVolume;
      return getFeaturedScore(b) - getFeaturedScore(a);
    });
}

export function getSpotlightMetric(strategy: Strategy, filter: BrowseFilter) {
  if (filter === "Funding Carry") return `${strategy.pnlPct.toFixed(1)}%`;
  if (filter === "Market Neutral") return `${strategy.maxDrawdown.toFixed(1)}% DD`;
  if (filter === "Tactical Quant") return `$${formatCompact(strategy.dailyVolume)}`;
  return `$${formatCompact(strategy.deployedCapital)} AUM`;
}
