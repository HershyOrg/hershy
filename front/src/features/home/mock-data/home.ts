import {
  CheckCircle2,
  Crosshair,
  Rocket,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "@/shared/components/icons";
import type { MarketRow, StrategyBlock } from "@/features/home/types/homeTypes";

export type StrategyTemplate = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  tags: string[];
};

export const AI_STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "spy-3-days-down-overnight",
    title: "SPY 3 Days Down Overnight",
    summary: "Build the SPY mean-reversion setup from the Quantified Strategies article: three down closes, enter at the third close, exit next session.",
    prompt: "Create the strategy graph from https://quantifiedstrategies.substack.com/p/3-days-down-overnight-trading-strategy-942?utm_source=chatgpt.com. Use SPY daily OHLCV data, detect three consecutive close-to-close down sessions, enter long at the third down close, and exit at the next session open or close.",
    tags: ["SPY", "Mean Reversion", "Daily"],
  },
  {
    id: "basis",
    title: "Basis Arbitrage",
    summary: "Open a delta-neutral position when the spot-futures spread widens.",
    prompt: "Create a strategy that buys BTC spot and hedges with a futures short when the spot-futures spread exceeds 0.5%.",
    tags: ["BTC", "Hedge", "1m"],
  },
  {
    id: "trend",
    title: "Trend Following",
    summary: "Confirm a moving-average breakout together with rising volume.",
    prompt: "Create a trend-following strategy that enters when BTC breaks above the 20MA and volume is above average.",
    tags: ["BTC", "MA", "Volume"],
  },
  {
    id: "funding",
    title: "Funding Carry",
    summary: "Monitor funding and basis together before entering.",
    prompt: "Create a market-neutral strategy that enters when funding is high and basis is stable.",
    tags: ["Funding", "Neutral", "Perp"],
  },
  {
    id: "dca",
    title: "ETH DCA",
    summary: "Buy in slices on a fixed cadence and stop when risk limits trigger.",
    prompt: "Create a DCA strategy that buys ETH every 4 hours and stops when a loss-limit condition is reached.",
    tags: ["ETH", "DCA", "4h"],
  },
];

export const STRATEGY_BLOCKS: StrategyBlock[] = [
  {
    id: "init",
    index: 1,
    title: "Strategy Start",
    subtitle: "Init",
    description: "Check exchange connections and base balances, then create the execution context.",
    status: "complete",
    kind: "start",
    x: 22,
    y: 86,
    w: 124,
    icon: Rocket,
    color: "violet",
    params: [
      { key: "capital", label: "Initial Capital (USDT)", value: "10,000", helper: "Reference capital for the strategy" },
      { key: "mode", label: "Execution Mode", value: "Dry Run", helper: "Validate with simulated orders before live execution", options: ["Dry Run", "Live"] },
    ],
  },
  {
    id: "condition",
    index: 2,
    title: "Spread Entry Condition Met",
    subtitle: "Basis check",
    description: "Monitor whether the spot-futures spread exceeds the configured threshold.",
    status: "running",
    kind: "condition",
    x: 176,
    y: 90,
    w: 104,
    icon: Crosshair,
    color: "emerald",
    params: [
      { key: "entryGap", label: "Entry Spread (%)", value: "0.50", unit: "%", helper: "Enter when the spread widens above this level" },
      { key: "exitGap", label: "Exit Spread (%)", value: "0.10", unit: "%", helper: "Exit when the spread compresses below this level" },
      { key: "confirm", label: "Confirmation Candles", value: "2", helper: "Number of candles required to confirm the condition" },
    ],
  },
  {
    id: "spot-buy",
    index: 3,
    title: "Buy BTC Spot",
    subtitle: "Spread entry condition met",
    description: "Buy spot BTC to create the long leg of the arbitrage trade.",
    status: "watching",
    kind: "trade",
    x: 320,
    y: 62,
    w: 154,
    icon: TrendingUp,
    color: "blue",
    params: [
      { key: "spotSize", label: "Order Size (USDT)", value: "1,000", helper: "Spot buy order amount" },
      { key: "spotSlippage", label: "Slippage Tolerance", value: "0.08", unit: "%", helper: "Allowed range for market execution" },
      { key: "orderType", label: "Order Type", value: "Market", helper: "Spot order type", options: ["Market", "Limit"] },
    ],
  },
  {
    id: "future-short",
    index: 4,
    title: "Short BTC Futures",
    subtitle: "Execute hedge leg",
    description: "Open an equal-sized futures short to offset directional price risk.",
    status: "watching",
    kind: "hedge",
    x: 516,
    y: 62,
    w: 154,
    icon: TrendingDown,
    color: "sky",
    params: [
      { key: "leverage", label: "Leverage", value: "1x", helper: "Futures position leverage", options: ["1x", "2x", "3x"] },
      { key: "hedgeRatio", label: "Hedge Ratio", value: "100", unit: "%", helper: "Futures exposure relative to spot" },
    ],
  },
  {
    id: "rebalance",
    index: 5,
    title: "Maintain Position",
    subtitle: "Rebalance and monitor",
    description: "Continuously monitor the spread and exposure, then rebalance when needed.",
    status: "ready",
    kind: "rebalance",
    x: 382,
    y: 162,
    w: 166,
    icon: RotateCcw,
    color: "blue",
    params: [
      { key: "rebalanceGap", label: "Rebalance Threshold", value: "0.20", unit: "%", helper: "Adjust when exposure drift grows" },
      { key: "checkInterval", label: "Check Interval", value: "1 min", helper: "Position status check cadence", options: ["10 sec", "1 min", "5 min"] },
    ],
  },
  {
    id: "risk",
    index: 6,
    title: "Exit on Loss Limit",
    subtitle: "Risk stop",
    description: "Move immediately to the exit stage when allowed loss is exceeded.",
    status: "blocked",
    kind: "risk",
    x: 446,
    y: 232,
    w: 104,
    icon: ShieldAlert,
    color: "rose",
    params: [
      { key: "lossLimit", label: "Loss Limit (%)", value: "1.00", unit: "%", helper: "Maximum allowed total loss" },
      { key: "maxLatency", label: "Latency Limit", value: "800", unit: "ms", helper: "Exchange response latency limit" },
    ],
  },
  {
    id: "exit",
    index: 7,
    title: "Exit",
    subtitle: "Close positions",
    description: "Close spot and futures positions together, then record PnL.",
    status: "ready",
    kind: "exit",
    x: 516,
    y: 268,
    w: 154,
    icon: CheckCircle2,
    color: "rose",
    params: [
      { key: "closeType", label: "Close Method", value: "Close Together", helper: "Spot and futures close order", options: ["Close Together", "Futures First", "Spot First"] },
      { key: "report", label: "Generate Report", value: "On", helper: "Save a summary after execution ends", options: ["On", "Off"] },
    ],
  },
];

export const MARKET_ROWS: MarketRow[] = [
  { symbol: "BTCUSDT", price: "67,245.8", change: "+1.24%", tone: "up", icon: "₿" },
  { symbol: "ETHUSDT", price: "3,285.6", change: "+0.82%", tone: "up", icon: "Ξ" },
  { symbol: "SOLUSDT", price: "152.4", change: "+0.45%", tone: "up", icon: "S" },
  { symbol: "BNBUSDT", price: "610.2", change: "-0.05%", tone: "down", icon: "B" },
];

export const STRATEGY_CODE = `strategy "BTC Spot-Futures Spread" {
  stream spot = binance.spot("BTCUSDT")
  stream perp = binance.perp("BTCUSDT.P")

  basis = (perp.price - spot.price) / spot.price * 100

  when basis > 0.50 {
    buy spot with 1000 USDT
    short perp with 1x hedge
  }

  while position.open {
    rebalance if exposure_gap > 0.20
    close if basis < 0.10 or pnl < -1.00
  }
}`;
