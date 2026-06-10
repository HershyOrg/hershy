import type { Edge, Node } from "@xyflow/react";
import type { NodeEditorInitialGraph } from "@/features/strategy-editor/components/NodeEditor";
import { connectedVenueSet } from "../constants";
import type { Strategy } from "../types/strategyTypes";

const dexVenues = new Set(["Aave", "Camelot", "Curve", "GMX", "Lido", "Morpho", "Uniswap V3"]);
const chartBaseTimestamp = 1_735_689_600;

const chainIds: Record<string, number> = {
  Ethereum: 1,
  "BNB Chain": 56,
  Arbitrum: 42161,
  Base: 8453,
  Cosmos: 118,
  Solana: 101,
  Bitcoin: 0,
};

function getCanvasSymbol(strategy: Strategy) {
  const text = `${strategy.id} ${strategy.title}`.toLowerCase();
  if (text.includes("sol")) return "SOL/USDT";
  if (text.includes("eth") || text.includes("lst")) return "ETH/USDT";
  if (text.includes("usdc") || text.includes("stable")) return "USDC/USDT";
  if (text.includes("gmx")) return "GMX/USDT";
  return "BTC/USDT";
}

export function getHershyCanvasGraph(strategy: Strategy): NodeEditorInitialGraph {
  const graphId = strategy.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const groupId = `${graphId}-group`;
  const triggerId = `${graphId}-trigger`;
  const streamId = `${graphId}-stream`;
  const signalId = `${graphId}-signal`;
  const actionId = `${graphId}-action`;
  const venue = strategy.venues[0] ?? "Binance";
  const isDexAction = strategy.primarySector === "DeFi" || dexVenues.has(venue);
  const symbol = getCanvasSymbol(strategy);
  const chainName = strategy.chains[0] ?? "Ethereum";
  const chainId = chainIds[chainName] ?? 1;
  const streamOutputId = "market-state";
  const scoreOutputId = "strategy-score";
  const sizingOutputId = "target-size";
  const pnlSeries = strategy.pnlSeries.map((value, index) => ({
    time: chartBaseTimestamp + index * 86_400,
    value: Number(((value / Math.max(strategy.deployedCapital, 1)) * 100).toFixed(3)),
  }));

  const nodes: Node[] = [
    {
      id: groupId,
      type: "groupNode",
      position: { x: 40, y: 40 },
      style: { width: 900, height: 540 },
      data: {
        label: strategy.title,
        styleType: "solid",
      },
    },
    {
      id: triggerId,
      type: "timeTrigger",
      parentId: groupId,
      extent: "parent",
      position: { x: 48, y: 58 },
      data: {
        label: strategy.status === "Live" ? "Live strategy trigger" : `${strategy.status} trigger`,
        interval: strategy.status === "Live" ? 3600 : 14400,
        isActive: strategy.status === "Live",
        outputBlocks: [
          {
            id: "tick",
            name: "tick",
            description: "Strategy execution heartbeat",
            type: "output",
          },
        ],
      },
    },
    {
      id: streamId,
      type: "streamingNode",
      parentId: groupId,
      extent: "parent",
      position: { x: 332, y: 58 },
      data: {
        label: `${venue} ${symbol} stream`,
        method: "WEBSOCKET",
        url: `wss://hershy.exchange/${venue.toLowerCase().replace(/\s+/g, "-")}/${symbol.replace("/", "")}`,
        isActive: connectedVenueSet.has(venue),
        streamKind: isDexAction ? "evm-rpc" : "cex-market",
        streamChain: chainName,
        streamMethod: isDexAction ? "eth_call" : "ticker",
        outputBlocks: [
          {
            id: streamOutputId,
            name: "marketState",
            description: `${venue} live market, balance, and risk state`,
            type: "output",
            visualizationFormat: "chart",
          },
        ],
        chartSeries: pnlSeries,
        chartSymbol: symbol,
        chartSource: `${venue} live stream`,
        chartUpdatedAt: "live",
        isExpanded: false,
      },
    },
    {
      id: signalId,
      type: "functionNode",
      parentId: groupId,
      extent: "parent",
      position: { x: 120, y: 276 },
      data: {
        label: "Return and risk gate",
        functionName: "scoreStrategy()",
        code: [
          "function scoreStrategy(marketState) {",
          `  const realizedPnl = ${strategy.realizedPnl};`,
          `  const returnPct = ${strategy.pnlPct};`,
          `  const maxDrawdown = ${strategy.maxDrawdown};`,
          "  const allowed = returnPct > 0 && maxDrawdown < 12;",
          "  return {",
          "    strategyScore: allowed ? returnPct : -maxDrawdown,",
          "    targetSize: allowed ? 1 : 0",
          "  };",
          "}",
        ].join("\n"),
        inputBlocks: [
          {
            id: streamOutputId,
            name: "marketState",
            description: "Live market state from the selected venue",
            type: "input",
          },
        ],
        outputBlocks: [
          {
            id: scoreOutputId,
            name: "strategyScore",
            description: "Return adjusted by drawdown and live venue readiness",
            type: "output",
            visualizationFormat: "chart",
            chartSeries: pnlSeries,
          },
          {
            id: sizingOutputId,
            name: "targetSize",
            description: "Template allocation ratio",
            type: "output",
          },
        ],
        chartSeries: pnlSeries,
        chartSymbol: strategy.title,
        chartSource: "Realized PnL",
        chartUpdatedAt: "live",
        viewMode: "node",
        isExpanded: false,
      },
    },
    {
      id: actionId,
      type: "actionNode",
      parentId: groupId,
      extent: "parent",
      position: { x: 560, y: 286 },
      data: isDexAction
        ? {
            label: `Route via ${venue}`,
            actionType: "DEX",
            contractAddress: "0x0000000000000000000000000000000000000000",
            functionName: "rebalance(uint256)",
            chainId,
            streamChain: chainName,
            inputBlocks: [
              {
                id: sizingOutputId,
                name: "targetSize",
                description: "Allocation selected by the risk gate",
                type: "input",
              },
            ],
            outputBlocks: [
              {
                id: "success",
                name: "success",
                description: "Execution result",
                type: "output",
              },
            ],
            isExpanded: false,
          }
        : {
            label: `Execute ${symbol}`,
            actionType: "CEX",
            exchange: venue,
            symbol,
            side: "BUY",
            orderType: "MARKET",
            amount: "{{Return and risk gate.targetSize}}",
            amountType: "PERCENT",
            inputBlocks: [
              {
                id: sizingOutputId,
                name: "targetSize",
                description: "Allocation selected by the risk gate",
                type: "input",
              },
            ],
            outputBlocks: [
              {
                id: "success",
                name: "success",
                description: "Execution result",
                type: "output",
              },
            ],
            isExpanded: false,
          },
    },
  ];

  const edges: Edge[] = [
    {
      id: `${graphId}-edge-trigger-stream`,
      source: triggerId,
      target: streamId,
      type: "custom",
      data: { label: "refresh" },
      style: { stroke: "#848e9c", strokeWidth: 3 },
    },
    {
      id: `${graphId}-edge-stream-signal`,
      source: streamId,
      target: signalId,
      type: "custom",
      data: { label: "marketState" },
      style: { stroke: "#f0b90b", strokeWidth: 3 },
    },
    {
      id: `${graphId}-edge-signal-action`,
      source: signalId,
      target: actionId,
      type: "custom",
      data: { label: "targetSize" },
      style: {
        stroke: strategy.pnlPct >= 0 ? "#0ecb81" : "#f6465d",
        strokeWidth: 3,
      },
    },
  ];

  return { nodes, edges };
}
