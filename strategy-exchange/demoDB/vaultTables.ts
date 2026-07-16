import type {
  AdapterDepositorRow,
  AdapterFlowRow,
  AdapterFundingHistoryRow,
  AdapterPositionRow,
  AdapterTradeHistoryRow,
  StrategyVaultRow,
  VaultBalanceRow,
  VaultPeriodRow,
} from "./schema";

export const strategyVaultsTable: StrategyVaultRow[] = [
  {
    strategyId: "hl-majors-index",
    address: "0xe70c2de5482bb9b071d58a4fb22905edfd93b385",
    leaderAddress: "0x751c7566baf4fec0be6edf0d479b5bf73a68918f",
    leaderFraction: 0.742,
    leaderCommission: 0.1,
    projectedApr: 42.4,
    strategyEquity: 128400,
    allTimePnl: 9400,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-alt-rotation-index",
    address: "0xf00c3c104743116c3893d2bee8b4ea088dccb7bb",
    leaderAddress: "0x5668ddaacb72dcb427639d114783930275e11e12",
    leaderFraction: 0.704,
    leaderCommission: 0.12,
    projectedApr: 72.8,
    strategyEquity: 86200,
    allTimePnl: 11200,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-defensive-collateral-index",
    address: "0xe00c22e0481a708f669fb87fdc6f245d2ff5f2d7",
    leaderAddress: "0xbddf37ba0ef5943d365243b4a83ed08e0816c3a5",
    leaderFraction: 0.681,
    leaderCommission: 0.08,
    projectedApr: 24.6,
    strategyEquity: 74400,
    allTimePnl: 4200,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-btc-funding-carry",
    address: "0xf60c458247521bf6de41704859040ce8ba5fd4db",
    leaderAddress: "0xc93c835eec0bc130f9c78d6debe6b6b8393806c0",
    leaderFraction: 0.781,
    leaderCommission: 0.1,
    projectedApr: 61.2,
    strategyEquity: 91600,
    allTimePnl: 12800,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-eth-basis-carry",
    address: "0xe20c2606412075b848196066d5f2a762d0fceb4c",
    leaderAddress: "0x96afafab3fc17f3c9866db4f274c2392b4116981",
    leaderFraction: 0.733,
    leaderCommission: 0.1,
    projectedApr: 44.8,
    strategyEquity: 68800,
    allTimePnl: 7200,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-market-neutral-grid",
    address: "0xf60c45824c5223d5db4e3782232200a523874f4f",
    leaderAddress: "0x1cada472cf3d2161e44535f054d12904822e15e7",
    leaderFraction: 0.697,
    leaderCommission: 0.1,
    projectedApr: 36.2,
    strategyEquity: 102500,
    allTimePnl: 15300,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-liquidation-reversal",
    address: "0xee0c38ea3d3cf18055f0db3da52950412d0936d7",
    leaderAddress: "0x6b8dc2e09a7f1352b402a4600a76063a1108b1d3",
    leaderFraction: 0.756,
    leaderCommission: 0.12,
    projectedApr: 82.4,
    strategyEquity: 58400,
    allTimePnl: 9800,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-vol-breakout",
    address: "0xe90c310b5831e30ef7888cf33ff54cfc44278e8f",
    leaderAddress: "0xd7f7f4eeb2e96f0138568eab46f26a9db24d798b",
    leaderFraction: 0.714,
    leaderCommission: 0.12,
    projectedApr: 58.6,
    strategyEquity: 79200,
    allTimePnl: 10600,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-orderflow-scalp",
    address: "0xe00c22e0481a708f669fb87fdc6f245d2bf5ec8b",
    leaderAddress: "0x08c686c8e28159cff62acb3bc45f7d323dd799d2",
    leaderFraction: 0.693,
    leaderCommission: 0.1,
    projectedApr: 49.8,
    strategyEquity: 53600,
    allTimePnl: 6100,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
  {
    strategyId: "hl-margin-risk-hedge",
    address: "0xe40c292c5e25208d1d72cecb56bbd521d0b0bec5",
    leaderAddress: "0xf193654d16897301c3bc245e03d0635e540b35f7",
    leaderFraction: 0.667,
    leaderCommission: 0.08,
    projectedApr: 27.4,
    strategyEquity: 66100,
    allTimePnl: 3900,
    chains: ["Hyperliquid"],
    updatedAt: "2026-06-07T07:00:00.000Z",
  },
];

export const vaultPeriodsTable: VaultPeriodRow[] = [
  { strategyId: "hl-majors-index", label: "24h", pnl: 680, equity: 128400, volume: 440000 },
  { strategyId: "hl-majors-index", label: "7d", pnl: 2460, equity: 127260, volume: 3080000 },
  { strategyId: "hl-majors-index", label: "30d", pnl: 5120, equity: 128400, volume: 13200000 },
  { strategyId: "hl-majors-index", label: "All", pnl: 9400, equity: 132680, volume: 70400000 },
  { strategyId: "hl-alt-rotation-index", label: "24h", pnl: 1320, equity: 86200, volume: 510000 },
  { strategyId: "hl-alt-rotation-index", label: "7d", pnl: 3980, equity: 85380, volume: 3570000 },
  { strategyId: "hl-alt-rotation-index", label: "30d", pnl: 7830, equity: 86200, volume: 15300000 },
  { strategyId: "hl-alt-rotation-index", label: "All", pnl: 11200, equity: 89570, volume: 81600000 },
  { strategyId: "hl-defensive-collateral-index", label: "24h", pnl: 210, equity: 74400, volume: 164000 },
  { strategyId: "hl-defensive-collateral-index", label: "7d", pnl: 980, equity: 74080, volume: 1148000 },
  { strategyId: "hl-defensive-collateral-index", label: "30d", pnl: 2480, equity: 74400, volume: 4920000 },
  { strategyId: "hl-defensive-collateral-index", label: "All", pnl: 4200, equity: 76120, volume: 26240000 },
  { strategyId: "hl-btc-funding-carry", label: "24h", pnl: 940, equity: 91600, volume: 390000 },
  { strategyId: "hl-btc-funding-carry", label: "7d", pnl: 4210, equity: 90960, volume: 2730000 },
  { strategyId: "hl-btc-funding-carry", label: "30d", pnl: 7240, equity: 91600, volume: 11700000 },
  { strategyId: "hl-btc-funding-carry", label: "All", pnl: 12800, equity: 97160, volume: 62400000 },
  { strategyId: "hl-eth-basis-carry", label: "24h", pnl: 510, equity: 68800, volume: 276000 },
  { strategyId: "hl-eth-basis-carry", label: "7d", pnl: 2140, equity: 68420, volume: 1932000 },
  { strategyId: "hl-eth-basis-carry", label: "30d", pnl: 4960, equity: 68800, volume: 8280000 },
  { strategyId: "hl-eth-basis-carry", label: "All", pnl: 7200, equity: 71040, volume: 44160000 },
  { strategyId: "hl-market-neutral-grid", label: "24h", pnl: 620, equity: 102500, volume: 338000 },
  { strategyId: "hl-market-neutral-grid", label: "7d", pnl: 3080, equity: 101880, volume: 2366000 },
  { strategyId: "hl-market-neutral-grid", label: "30d", pnl: 5130, equity: 102500, volume: 10140000 },
  { strategyId: "hl-market-neutral-grid", label: "All", pnl: 15300, equity: 112670, volume: 54080000 },
  { strategyId: "hl-liquidation-reversal", label: "24h", pnl: 1180, equity: 58400, volume: 468000 },
  { strategyId: "hl-liquidation-reversal", label: "7d", pnl: 3340, equity: 57880, volume: 3276000 },
  { strategyId: "hl-liquidation-reversal", label: "30d", pnl: 7110, equity: 58400, volume: 14040000 },
  { strategyId: "hl-liquidation-reversal", label: "All", pnl: 9800, equity: 61090, volume: 74880000 },
  { strategyId: "hl-vol-breakout", label: "24h", pnl: -320, equity: 79200, volume: 356000 },
  { strategyId: "hl-vol-breakout", label: "7d", pnl: 1890, equity: 78640, volume: 2492000 },
  { strategyId: "hl-vol-breakout", label: "30d", pnl: 5860, equity: 79200, volume: 10680000 },
  { strategyId: "hl-vol-breakout", label: "All", pnl: 10600, equity: 83940, volume: 56960000 },
  { strategyId: "hl-orderflow-scalp", label: "24h", pnl: 440, equity: 53600, volume: 612000 },
  { strategyId: "hl-orderflow-scalp", label: "7d", pnl: 2010, equity: 53230, volume: 4284000 },
  { strategyId: "hl-orderflow-scalp", label: "30d", pnl: 4020, equity: 53600, volume: 18360000 },
  { strategyId: "hl-orderflow-scalp", label: "All", pnl: 6100, equity: 55680, volume: 97920000 },
  { strategyId: "hl-margin-risk-hedge", label: "24h", pnl: 180, equity: 66100, volume: 188000 },
  { strategyId: "hl-margin-risk-hedge", label: "7d", pnl: 1160, equity: 65870, volume: 1316000 },
  { strategyId: "hl-margin-risk-hedge", label: "30d", pnl: 3090, equity: 66100, volume: 5640000 },
  { strategyId: "hl-margin-risk-hedge", label: "All", pnl: 3900, equity: 66910, volume: 30080000 },
];

export const vaultBalancesTable: VaultBalanceRow[] = [
  { strategyId: "hl-majors-index", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.661, value: 44940, weight: 0.35, sortOrder: 1 },
  { strategyId: "hl-majors-index", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 10.7, value: 38520, weight: 0.3, sortOrder: 2 },
  { strategyId: "hl-majors-index", token: "SOL-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 160.5, value: 25680, weight: 0.2, sortOrder: 3 },
  { strategyId: "hl-majors-index", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 642, value: 19260, weight: 0.15, sortOrder: 4 },
  { strategyId: "hl-alt-rotation-index", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 862, value: 25860, weight: 0.3, sortOrder: 1 },
  { strategyId: "hl-alt-rotation-index", token: "SOL-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 134.7, value: 21550, weight: 0.25, sortOrder: 2 },
  { strategyId: "hl-alt-rotation-index", token: "FET-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 13261.5, value: 17240, weight: 0.2, sortOrder: 3 },
  { strategyId: "hl-alt-rotation-index", token: "PURR-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 71833.3, value: 21550, weight: 0.25, sortOrder: 4 },
  { strategyId: "hl-defensive-collateral-index", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 37200, value: 37200, weight: 0.5, sortOrder: 1 },
  { strategyId: "hl-defensive-collateral-index", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.2407, value: 16368, weight: 0.22, sortOrder: 2 },
  { strategyId: "hl-defensive-collateral-index", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 3.72, value: 13392, weight: 0.18, sortOrder: 3 },
  { strategyId: "hl-defensive-collateral-index", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 248, value: 7440, weight: 0.1, sortOrder: 4 },
  { strategyId: "hl-btc-funding-carry", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.6196, value: 42136, weight: 0.46, sortOrder: 1 },
  { strategyId: "hl-btc-funding-carry", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 31144, value: 31144, weight: 0.34, sortOrder: 2 },
  { strategyId: "hl-btc-funding-carry", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 3.053, value: 10992, weight: 0.12, sortOrder: 3 },
  { strategyId: "hl-btc-funding-carry", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 244.3, value: 7328, weight: 0.08, sortOrder: 4 },
  { strategyId: "hl-eth-basis-carry", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 9.173, value: 33024, weight: 0.48, sortOrder: 1 },
  { strategyId: "hl-eth-basis-carry", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 22016, value: 22016, weight: 0.32, sortOrder: 2 },
  { strategyId: "hl-eth-basis-carry", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.1214, value: 8256, weight: 0.12, sortOrder: 3 },
  { strategyId: "hl-eth-basis-carry", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 183.5, value: 5504, weight: 0.08, sortOrder: 4 },
  { strategyId: "hl-market-neutral-grid", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.4522, value: 30750, weight: 0.3, sortOrder: 1 },
  { strategyId: "hl-market-neutral-grid", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 7.972, value: 28700, weight: 0.28, sortOrder: 2 },
  { strategyId: "hl-market-neutral-grid", token: "SOL-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 140.9, value: 22550, weight: 0.22, sortOrder: 3 },
  { strategyId: "hl-market-neutral-grid", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 20500, value: 20500, weight: 0.2, sortOrder: 4 },
  { strategyId: "hl-liquidation-reversal", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 700.8, value: 21024, weight: 0.36, sortOrder: 1 },
  { strategyId: "hl-liquidation-reversal", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.2061, value: 14016, weight: 0.24, sortOrder: 2 },
  { strategyId: "hl-liquidation-reversal", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 3.244, value: 11680, weight: 0.2, sortOrder: 3 },
  { strategyId: "hl-liquidation-reversal", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 11680, value: 11680, weight: 0.2, sortOrder: 4 },
  { strategyId: "hl-vol-breakout", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.396, value: 26928, weight: 0.34, sortOrder: 1 },
  { strategyId: "hl-vol-breakout", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 6.6, value: 23760, weight: 0.3, sortOrder: 2 },
  { strategyId: "hl-vol-breakout", token: "SOL-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 108.9, value: 17424, weight: 0.22, sortOrder: 3 },
  { strategyId: "hl-vol-breakout", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 11088, value: 11088, weight: 0.14, sortOrder: 4 },
  { strategyId: "hl-orderflow-scalp", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 571.7, value: 17152, weight: 0.32, sortOrder: 1 },
  { strategyId: "hl-orderflow-scalp", token: "SOL-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 87.1, value: 13936, weight: 0.26, sortOrder: 2 },
  { strategyId: "hl-orderflow-scalp", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.1734, value: 11792, weight: 0.22, sortOrder: 3 },
  { strategyId: "hl-orderflow-scalp", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 10720, value: 10720, weight: 0.2, sortOrder: 4 },
  { strategyId: "hl-margin-risk-hedge", token: "USDC", venue: "Hyperliquid", chain: "Hyperliquid", amount: 33050, value: 33050, weight: 0.5, sortOrder: 1 },
  { strategyId: "hl-margin-risk-hedge", token: "BTC-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 0.1944, value: 13220, weight: 0.2, sortOrder: 2 },
  { strategyId: "hl-margin-risk-hedge", token: "ETH-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 3.672, value: 13220, weight: 0.2, sortOrder: 3 },
  { strategyId: "hl-margin-risk-hedge", token: "HYPE-PERP", venue: "Hyperliquid", chain: "Hyperliquid", amount: 220.3, value: 6610, weight: 0.1, sortOrder: 4 },
];

const priceByToken: Record<string, number> = {
  "BTC-PERP": 68000,
  "ETH-PERP": 3600,
  "SOL-PERP": 160,
  "HYPE-PERP": 30,
  "FET-PERP": 1.3,
  "PURR-PERP": 0.3,
  USDC: 1,
};

const depositorSeeds = [
  "0x7421...91ce",
  "0x98af...230d",
  "0x10cb...77a4",
  "0xd84f...6b19",
  "0x4a2e...d905",
  "0xb331...0fe8",
  "0x7c04...a2bd",
  "0x29df...41f0",
];

const actorLabels = {
  creator: "Logic Creator",
  user: "User",
} as const;

function minutesAgo(minutes: number) {
  return new Date(Date.parse("2026-06-07T08:00:00.000Z") - minutes * 60_000).toISOString();
}

function rowsForStrategy(strategyId: string) {
  return vaultBalancesTable.filter((row) => row.strategyId === strategyId);
}

function notionalPrice(row: VaultBalanceRow) {
  return priceByToken[row.token] ?? (row.amount > 0 ? row.value / row.amount : 1);
}

export const adapterPositionsTable: AdapterPositionRow[] = strategyVaultsTable.flatMap((adapter, adapterIndex) =>
  rowsForStrategy(adapter.strategyId)
    .filter((row) => row.token !== "USDC")
    .map((row, rowIndex) => {
      const markPrice = notionalPrice(row);
      const side = (adapterIndex + rowIndex) % 3 === 0 ? "Short" : "Long";
      const entrySkew = side === "Long" ? 0.982 - rowIndex * 0.006 : 1.018 + rowIndex * 0.005;
      const entryPrice = markPrice * entrySkew;
      const size = Math.max(row.amount, row.value / markPrice);
      const unrealizedPnl = side === "Long" ? (markPrice - entryPrice) * size : (entryPrice - markPrice) * size;
      return {
        strategyId: adapter.strategyId,
        coin: row.token.replace("-PERP", ""),
        side,
        size,
        entryPrice,
        markPrice,
        liquidationPrice: side === "Long" ? markPrice * 0.72 : markPrice * 1.34,
        marginUsed: row.value * (0.11 + rowIndex * 0.018),
        unrealizedPnl,
        fundingRate: (side === "Long" ? -1 : 1) * (0.00014 + rowIndex * 0.00005),
        leverage: 3 + ((adapterIndex + rowIndex) % 4),
        sortOrder: rowIndex + 1,
      };
    }),
);

export const adapterTradeHistoryTable: AdapterTradeHistoryRow[] = strategyVaultsTable.flatMap((adapter, adapterIndex) => {
  const rows = rowsForStrategy(adapter.strategyId).filter((row) => row.token !== "USDC");
  return rows.slice(0, 4).map((row, rowIndex) => {
    const price = notionalPrice(row) * (1 + (rowIndex - 1) * 0.004);
    const action = rowIndex === 0 ? "Open" : rowIndex === 1 ? "Increase" : rowIndex === 2 ? "Reduce" : "Close";
    const side = (adapterIndex + rowIndex) % 2 === 0 ? "Long" : "Short";
    const actor = rowIndex % 2 === 0 ? actorLabels.creator : actorLabels.user;
    const size = Math.max(row.amount * (0.18 + rowIndex * 0.05), row.value / price * 0.12);
    const value = size * price;
    return {
      strategyId: adapter.strategyId,
      id: `${adapter.strategyId}-trade-${rowIndex + 1}`,
      actor,
      accountLabel: actor === "Logic Creator" ? "Creator Logic" : "User Allocation",
      action,
      coin: row.token.replace("-PERP", ""),
      side,
      price,
      size,
      value,
      fee: value * 0.00035,
      pnl: action === "Close" || action === "Reduce" ? (side === "Long" ? 1 : -1) * value * (0.006 + rowIndex * 0.002) : 0,
      createdAt: minutesAgo(adapterIndex * 42 + rowIndex * 18 + 12),
      sortOrder: rowIndex + 1,
    };
  });
});

export const adapterFundingHistoryTable: AdapterFundingHistoryRow[] = strategyVaultsTable.flatMap((adapter, adapterIndex) => {
  const rows = rowsForStrategy(adapter.strategyId).filter((row) => row.token !== "USDC");
  return rows.slice(0, 4).map((row, rowIndex) => {
    const side = (adapterIndex + rowIndex) % 2 === 0 ? "Long" : "Short";
    const rate = (side === "Long" ? -1 : 1) * (0.00011 + rowIndex * 0.00004 + adapterIndex * 0.000006);
    return {
      strategyId: adapter.strategyId,
      id: `${adapter.strategyId}-funding-${rowIndex + 1}`,
      coin: row.token.replace("-PERP", ""),
      side,
      rate,
      payment: row.value * rate,
      createdAt: minutesAgo(adapterIndex * 36 + rowIndex * 60 + 30),
      sortOrder: rowIndex + 1,
    };
  });
});

export const adapterFlowsTable: AdapterFlowRow[] = strategyVaultsTable.flatMap((adapter, adapterIndex) => {
  const deposits = [0.034, 0.022, 0.017].map((ratio, rowIndex) => ({
    strategyId: adapter.strategyId,
    id: `${adapter.strategyId}-flow-deposit-${rowIndex + 1}`,
    type: "Deposit" as const,
    accountLabel: rowIndex === 0 ? "User Allocation" : "SCW Batch",
    amount: Math.round(adapter.strategyEquity * ratio),
    createdAt: minutesAgo(adapterIndex * 31 + rowIndex * 44 + 20),
    sortOrder: rowIndex + 1,
  }));
  const withdrawal = {
    strategyId: adapter.strategyId,
    id: `${adapter.strategyId}-flow-withdrawal-1`,
    type: "Withdrawal" as const,
    accountLabel: "User Allocation",
    amount: Math.round(adapter.strategyEquity * 0.012),
    createdAt: minutesAgo(adapterIndex * 31 + 188),
    sortOrder: 4,
  };
  return [...deposits, withdrawal];
});

export const adapterDepositorsTable: AdapterDepositorRow[] = strategyVaultsTable.flatMap((adapter, adapterIndex) =>
  depositorSeeds.map((maskedAddress, rowIndex) => {
    const sharePct = Math.max(0.004, 0.074 - rowIndex * 0.007 + adapterIndex * 0.0008);
    const equity = adapter.strategyEquity * sharePct;
    return {
      strategyId: adapter.strategyId,
      id: `${adapter.strategyId}-depositor-${rowIndex + 1}`,
      maskedAddress,
      equity,
      sharePct,
      pnl: equity * (adapter.allTimePnl / Math.max(adapter.strategyEquity, 1)) * (0.65 + rowIndex * 0.045),
      joinedAt: minutesAgo(720 + adapterIndex * 43 + rowIndex * 210),
      sortOrder: rowIndex + 1,
    };
  }),
);
