import { connectedVenueSet, strategyDescriptions, baseForkCounts } from "../constants";
import type { BrowseFilter, Strategy } from "../types/strategyTypes";
import { formatCompact, formatPct } from "../../../shared/utils/formatters";

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

export function getBaseForkCount(strategy: Strategy) {
  return baseForkCounts[strategy.id] ?? Math.max(12, Math.round(strategy.traders * 0.3));
}

export function getCreatedAtHours(createdAt: string) {
  const match = createdAt.match(/^(\d+)([hd])$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  return match[2] === "d" ? value * 24 : value;
}

export function getHotScore(strategy: Strategy) {
  return strategy.traders * 1.2 + strategy.dailyVolume / 1800 + strategy.pnlPct * 18;
}

export function sortStrategiesByFilter(items: Strategy[], filter: BrowseFilter) {
  return [...items].sort((a, b) => {
    if (filter === "New") return getCreatedAtHours(a.createdAt) - getCreatedAtHours(b.createdAt);
    if (filter === "Top Gainer") return b.pnlPct - a.pnlPct;
    if (filter === "Top Volume") return b.dailyVolume - a.dailyVolume;
    return getHotScore(b) - getHotScore(a);
  });
}

export function getSpotlightMetric(strategy: Strategy, filter: BrowseFilter) {
  if (filter === "New") return strategy.createdAt;
  if (filter === "Top Volume") return `$${formatCompact(strategy.dailyVolume)}`;
  if (filter === "Daily Hot") return `${getBaseForkCount(strategy)} fork`;
  return formatPct(strategy.pnlPct);
}
