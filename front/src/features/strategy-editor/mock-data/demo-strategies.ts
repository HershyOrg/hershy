import { Node, Edge } from "@xyflow/react";
import type {
  TimeTriggerData,
  CEXActionData,
  DEXActionData,
  FunctionNodeData,
  StreamingNodeData,
} from "@/features/strategy-editor/types/editorTypes";
import {
  createBinanceFuturesFundingStreamData,
  createBinanceFuturesUserDataStreamData,
  createBinanceSpotBalanceStreamData,
  createBinanceSpotPriceStreamData,
} from "./binance-demo-api";

function buildDailySeries(seed: string, length = 96, base = 445) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const now = Math.floor(Date.now() / 1000);
  const day = 86_400;

  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((index + (hash % 29)) / 7) * 6;
    const drift = index * 0.18;
    return {
      time: now - (length - index - 1) * day,
      value: Number((base + wave + drift).toFixed(2)),
      volume: Math.round(52_000_000 + Math.abs(Math.cos(index / 5)) * 24_000_000),
    };
  });
}

function buildThreeDownSignalSeries(length = 96) {
  const now = Math.floor(Date.now() / 1000);
  const day = 86_400;
  return Array.from({ length }, (_, index) => ({
    time: now - (length - index - 1) * day,
    value: index >= length - 1 ? 1 : index % 19 === 0 ? 1 : 0,
  }));
}

function buildPullbackSeries(length = 96) {
  const now = Math.floor(Date.now() / 1000);
  const day = 86_400;
  return Array.from({ length }, (_, index) => {
    const baseline = -0.2 + Math.sin(index / 6) * 0.4;
    const signalPullback = index % 19 === 0 || index >= length - 1 ? -1.8 : 0;
    return {
      time: now - (length - index - 1) * day,
      value: Number((baseline + signalPullback).toFixed(2)),
    };
  });
}

export const getSpyThreeDownDayTradeStrategyNodes = (): { nodes: Node[], edges: Edge[] } => {
  const closeSeries = buildDailySeries("spy-close", 96, 442);
  const latestIndex = closeSeries.length - 1;
  closeSeries[latestIndex - 3] = { ...closeSeries[latestIndex - 3], value: 456.2 };
  closeSeries[latestIndex - 2] = { ...closeSeries[latestIndex - 2], value: 452.4 };
  closeSeries[latestIndex - 1] = { ...closeSeries[latestIndex - 1], value: 448.7 };
  closeSeries[latestIndex] = { ...closeSeries[latestIndex], value: 445.1 };
  const signalSeries = buildThreeDownSignalSeries(closeSeries.length);
  const pullbackSeries = buildPullbackSeries(closeSeries.length);

  const nodes: Node[] = [
    {
      id: "spy-3down-strategy",
      type: "groupNode",
      position: { x: 50, y: 50 },
      style: { width: 1760, height: 960 },
      data: {
        label: "SPY 3-Day Down Mean Reversion Day Trade",
        purpose: "Implements a simple SPY mean-reversion setup: buy the third consecutive down close and exit the next session.",
        styleType: "solid",
      },
    },
    {
      id: "spy-3down-data-seq",
      type: "groupNode",
      parentId: "spy-3down-strategy",
      position: { x: 40, y: 60 },
      style: { width: 1640, height: 240 },
      data: {
        label: "SPY Daily Market Data",
        purpose: "Daily SPY OHLCV feed used to detect three consecutive close-to-close declines.",
        styleType: "pipeline",
        sequenceType: "data-pipeline",
        sharedDataPipeline: true,
      } as any,
    },
    {
      id: "spy-3down-signal-seq",
      type: "groupNode",
      parentId: "spy-3down-strategy",
      position: { x: 40, y: 340 },
      style: { width: 1640, height: 260 },
      data: {
        label: "Three Consecutive Down-Day Signal",
        purpose: "Signal turns true only after SPY has closed below the prior close for three sessions in a row.",
        styleType: "dashed-trigger",
      } as any,
    },
    {
      id: "spy-3down-execution-seq",
      type: "groupNode",
      parentId: "spy-3down-strategy",
      position: { x: 40, y: 640 },
      style: { width: 1640, height: 260 },
      data: {
        label: "Close Entry and Next-Session Exit",
        purpose: "Enter SPY at the third down-day close, then exit at the next open or next close depending on the configured exit action.",
        styleType: "dashed-init",
      } as any,
    },
    {
      id: "spy-daily-ohlcv",
      type: "streamingNode",
      parentId: "spy-3down-data-seq",
      extent: "parent",
      position: { x: 24, y: 52 },
      data: {
        label: "SPY Daily OHLCV Stream",
        method: "POLLING",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=6mo&interval=1d&symbol=SPY",
        intervalMs: 86_400_000,
        isActive: true,
        streamKind: "url",
        responseSchema: "chart.result[0].indicators.quote[0].close/open/volume",
        outputBlocks: [
          { id: "close", name: "close", type: "output", chartSeries: closeSeries, visualizationFormat: "chart" },
          { id: "open", name: "open", type: "output" },
          { id: "volume", name: "volume", type: "output" },
        ],
        chartSeries: closeSeries,
        chartSource: "SPY daily close demo series",
        chartUpdatedAt: new Date().toISOString(),
        chartSymbol: "SPY",
        apiReference: "Yahoo Finance daily chart endpoint",
        requestHint: "Use adjusted daily SPY OHLC data before live execution.",
      } as StreamingNodeData,
    },
    {
      id: "spy-3down-detector",
      type: "functionNode",
      parentId: "spy-3down-signal-seq",
      extent: "parent",
      position: { x: 28, y: 46 },
      data: {
        label: "3-Down Close Detector",
        description: "Computes whether SPY has closed down for three consecutive sessions.",
        functionName: "detectThreeDownCloses()",
        code:
          "function detectThreeDownCloses(close) {\n" +
          "  const n = close.length;\n" +
          "  const down1 = close[n - 1] < close[n - 2];\n" +
          "  const down2 = close[n - 2] < close[n - 3];\n" +
          "  const down3 = close[n - 3] < close[n - 4];\n" +
          "  const signal = down1 && down2 && down3;\n" +
          "  const pullbackPct = ((close[n - 1] / close[n - 4]) - 1) * 100;\n" +
          "  return { yesNo: signal ? 1 : 0, pullbackPct };\n" +
          "}",
        inputBlocks: [
          { id: "close", name: "close", type: "input", description: "Daily SPY closes" },
        ],
        outputBlocks: [
          {
            id: "yes-no",
            name: "yesNo",
            type: "output",
            description: "YES when the last three closes are all lower than the previous close.",
            visualizationFormat: "chart",
            outputKind: "boolean-data",
            chartSeries: signalSeries,
            condition: { metric: "yesNo", operator: ">=", threshold: 0.5, label: "yesNo is YES" },
            conditionControls: [
              { id: "primary", condition: { metric: "yesNo", operator: ">=", threshold: 0.5, label: "yesNo is YES" } },
            ],
            showConditionControl: true,
          },
          {
            id: "pullback",
            name: "threeDayPullbackPct",
            type: "output",
            description: "Three-day close-to-close pullback percentage.",
            visualizationFormat: "chart",
            chartSeries: pullbackSeries,
          },
        ],
        condition: { metric: "yesNo", operator: ">=", threshold: 0.5, label: "yesNo is YES" },
        conditionMet: true,
        showChartComparison: true,
        chartComparisonValues: [{ id: "yes-line", label: "YES threshold", value: 0.5, color: "#f59e0b", enabled: true }],
        viewMode: "node",
      } as FunctionNodeData,
    },
    {
      id: "spy-close-entry",
      type: "actionNode",
      parentId: "spy-3down-execution-seq",
      extent: "parent",
      position: { x: 28, y: 48 },
      data: {
        label: "Enter Long SPY at Third Down Close",
        actionType: "CEX",
        exchange: "Paper Broker",
        symbol: "SPY",
        side: "BUY",
        orderType: "MARKET",
        timeInForce: "GTC",
        amount: "100% available test capital",
        amountType: "PERCENT",
        inputBlocks: [
          { id: "entry-signal", name: "yesNo", type: "input", description: "Indicator YES value from the 3-down close detector" },
        ],
        outputBlocks: [{ id: "entry-filled", name: "entryFilled", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "spy-next-session-exit-trigger",
      type: "timeTrigger",
      parentId: "spy-3down-execution-seq",
      extent: "parent",
      position: { x: 440, y: 56 },
      data: {
        label: "Next Session Exit Timer",
        triggerMode: "TIME",
        interval: 86_400,
        isActive: false,
        outputBlocks: [
          { id: "yes-no", name: "yes/no", description: "Exit at the next open, or switch the action note to next close.", type: "output", outputKind: "boolean-data" },
        ],
      } as TimeTriggerData,
    },
    {
      id: "spy-next-open-exit",
      type: "actionNode",
      parentId: "spy-3down-execution-seq",
      extent: "parent",
      position: { x: 820, y: 48 },
      data: {
        label: "Exit SPY at Next Session Open",
        actionType: "CEX",
        exchange: "Paper Broker",
        symbol: "SPY",
        side: "SELL",
        orderType: "MARKET",
        timeInForce: "GTC",
        amount: "100% SPY position",
        amountType: "PERCENT",
        inputBlocks: [
          { id: "exit-trigger", name: "exitTrigger", type: "input" },
        ],
        outputBlocks: [{ id: "exit-filled", name: "exitFilled", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
  ];

  const edges: Edge[] = [
    { id: "spy-data-to-detector-flow", source: "spy-daily-ohlcv", target: "spy-3down-detector", sourceHandle: "spy-daily-ohlcv-trigger-out", targetHandle: "spy-3down-detector-func-in", type: "custom", data: { sharedDataPipeline: true } },
    { id: "spy-close-to-detector-input", source: "spy-daily-ohlcv", target: "spy-3down-detector", sourceHandle: "spy-daily-ohlcv-block-close-out", targetHandle: "spy-3down-detector-input-close-in", type: "custom", data: { label: "close", sharedDataPipeline: true } },
    { id: "spy-yes-no-to-long-entry", source: "spy-3down-detector", target: "spy-close-entry", sourceHandle: "spy-3down-detector-block-yes-no-out", targetHandle: "spy-close-entry-func-in", type: "custom", data: { label: "yesNo -> enter long SPY", allowCrossSequence: true, condition: { metric: "yesNo", operator: ">=", threshold: 0.5, label: "yesNo is YES" } } },
    { id: "spy-entry-to-exit-timer", source: "spy-close-entry", target: "spy-next-session-exit-trigger", sourceHandle: "spy-close-entry-success-out", targetHandle: "spy-next-session-exit-trigger-trigger-in", type: "custom", data: { label: "entry filled" } },
    { id: "spy-exit-timer-to-exit", source: "spy-next-session-exit-trigger", target: "spy-next-open-exit", sourceHandle: "spy-next-session-exit-trigger-trigger-out", targetHandle: "spy-next-open-exit-func-in", type: "custom", data: { label: "next session" } },
    { id: "spy-exit-trigger-input", source: "spy-next-session-exit-trigger", target: "spy-next-open-exit", sourceHandle: "spy-next-session-exit-trigger-block-yes-no-out", targetHandle: "spy-next-open-exit-input-exit-trigger-in", type: "custom", data: { label: "exitTrigger" } },
  ];

  return { nodes, edges };
};

export const getEtfDcaStrategyNodes = (): { nodes: Node[], edges: Edge[] } => {
  const nodes: Node[] = [
    {
      id: "demo-etf-group",
      type: "groupNode",
      position: { x: 50, y: 50 },
      style: { width: 780, height: 690 },
      data: {
        label: "Core ETF DCA Strategy",
        styleType: "solid"
      }
    },
    {
      id: "demo-etf-trigger",
      type: "timeTrigger",
      parentId: "demo-etf-group",
      extent: "parent",
      position: { x: 240, y: 40 },
      data: {
        label: "Run Once a Month",
        interval: 2592000, // 30 days in seconds
        isActive: true,
      } as TimeTriggerData
    },
    {
      id: "demo-etf-balance-stream",
      type: "streamingNode",
      parentId: "demo-etf-group",
      extent: "parent",
      position: { x: 30, y: 150 },
      data: createBinanceSpotBalanceStreamData({
        label: "Binance Spot Balance Stream",
        outputBlocks: [
          { id: "spot-usdt-free", name: "spotUsdtFree", type: "output" },
          { id: "spot-btc-free", name: "spotBtcFree", type: "output" },
          { id: "spot-eth-free", name: "spotEthFree", type: "output" },
        ],
      }) as StreamingNodeData,
    },
    {
      id: "demo-etf-func",
      type: "functionNode",
      parentId: "demo-etf-group",
      extent: "parent",
      position: { x: 350, y: 160 },
      data: {
        label: "DCA Allocation Splitter\n(Based on Available USDT)",
        functionName: "allocateDCA()",
        code: "function allocateDCA(amount) {\n  const rules = [\n    { asset: 'BTC',  weight: 55, executable: true },\n    { asset: 'ETH',  weight: 25, executable: true },\n    { asset: 'SOL',  weight: 10, executable: true },\n    { asset: 'LINK', weight: 3,  executable: false },\n    { asset: 'AAVE', weight: 2,  executable: false },\n    { asset: 'Cash', weight: 5,  executable: false }\n  ];\n\n  let btcAmount = 0, ethAmount = 0, solAmount = 0;\n  let reserveBudget = 0;\n\n  for (const rule of rules) {\n    const notional = amount * (rule.weight / 100);\n    if (rule.executable) {\n      if (rule.asset === 'BTC') btcAmount = notional;\n      if (rule.asset === 'ETH') ethAmount = notional;\n      if (rule.asset === 'SOL') solAmount = notional;\n    } else {\n      reserveBudget += notional;\n    }\n  }\n\n  return {\n    btcAmount,\n    ethAmount,\n    solAmount,\n    reserveBudget\n  };\n}",
        inputBlocks: [{ id: "ib1", name: "spotUsdtFree", type: "input" }],
        outputBlocks: [
          { id: "ob-btc", name: "btcAmount", type: "output" },
          { id: "ob-eth", name: "ethAmount", type: "output" },
          { id: "ob-sol", name: "solAmount", type: "output" }
        ],
        viewMode: "node"
      } as FunctionNodeData
    },
    {
      id: "demo-etf-act-btc",
      type: "actionNode",
      parentId: "demo-etf-group",
      extent: "parent",
      position: { x: 30, y: 390 },
      data: {
        label: "Buy BTC (55%)",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "BTC/USDT",
        side: "BUY",
        orderType: "MARKET",
        amount: "{{DCA Allocation Splitter.btcAmount}}",
        amountType: "FIXED",
        inputBlocks: [{ id: "ib-btc", name: "btcAmount", type: "input"}],
        outputBlocks: [],
        isExpanded: false,
      } as CEXActionData
    },
    {
      id: "demo-etf-act-eth",
      type: "actionNode",
      parentId: "demo-etf-group",
      extent: "parent",
      position: { x: 470, y: 390 },
      data: {
        label: "Buy ETH (25%)",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "ETH/USDT",
        side: "BUY",
        orderType: "MARKET",
        amount: "{{DCA Allocation Splitter.ethAmount}}",
        amountType: "FIXED",
        inputBlocks: [{ id: "ib-eth", name: "ethAmount", type: "input"}],
        outputBlocks: [],
        isExpanded: false,
      } as CEXActionData
    },
    {
      id: "demo-etf-act-sol",
      type: "actionNode",
      parentId: "demo-etf-group",
      extent: "parent",
      position: { x: 250, y: 580 },
      data: {
        label: "Buy SOL (10%)",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "SOL/USDT",
        side: "BUY",
        orderType: "MARKET",
        amount: "{{DCA Allocation Splitter.solAmount}}",
        amountType: "FIXED",
        inputBlocks: [{ id: "ib-sol", name: "solAmount", type: "input"}],
        outputBlocks: [],
        isExpanded: false,
      } as CEXActionData
    }
  ];

  const edges: Edge[] = [
    { id: "e-etf0", source: "demo-etf-trigger", target: "demo-etf-balance-stream", type: "fsm", sourceHandle: "demo-etf-trigger-trigger-out", targetHandle: "demo-etf-balance-stream-func-in" },
    { id: "e-etf0b", source: "demo-etf-balance-stream", target: "demo-etf-func", type: "fsm", sourceHandle: "demo-etf-balance-stream-trigger-out", targetHandle: "demo-etf-func-func-in" },
    { id: "e-etf0c", source: "demo-etf-balance-stream", target: "demo-etf-func", type: "custom", sourceHandle: "demo-etf-balance-stream-block-spot-usdt-free-out", targetHandle: "demo-etf-func-func-in" },
    { id: "e-etf2", source: "demo-etf-func", target: "demo-etf-act-btc", type: "fsm", sourceHandle: "demo-etf-func-block-ob-btc-out", targetHandle: "demo-etf-act-btc-func-in" },
    { id: "e-etf-b1", source: "demo-etf-func", target: "demo-etf-act-btc", type: "custom", sourceHandle: "demo-etf-func-block-ob-btc-out", targetHandle: "demo-etf-act-btc-input-ib-btc-in" },
    { id: "e-etf3", source: "demo-etf-func", target: "demo-etf-act-eth", type: "fsm", sourceHandle: "demo-etf-func-block-ob-eth-out", targetHandle: "demo-etf-act-eth-func-in" },
    { id: "e-etf-b2", source: "demo-etf-func", target: "demo-etf-act-eth", type: "custom", sourceHandle: "demo-etf-func-block-ob-eth-out", targetHandle: "demo-etf-act-eth-input-ib-eth-in" },
    { id: "e-etf4", source: "demo-etf-func", target: "demo-etf-act-sol", type: "fsm", sourceHandle: "demo-etf-func-block-ob-sol-out", targetHandle: "demo-etf-act-sol-func-in" },
    { id: "e-etf-b3", source: "demo-etf-func", target: "demo-etf-act-sol", type: "custom", sourceHandle: "demo-etf-func-block-ob-sol-out", targetHandle: "demo-etf-act-sol-input-ib-sol-in" }
  ];

  return { nodes, edges };
};

export const getPepeHedgeStrategyNodes = (): { nodes: Node[], edges: Edge[] } => {
  const nodes: Node[] = [
    {
      id: "g_strategy",
      type: "groupNode",
      position: { x: 50, y: 50 },
      style: { width: 1320, height: 980 },
      data: {
        label: "PEPE/WETH LP Hedge Strategy",
        styleType: "solid"
      }
    },
    {
      id: "g_init",
      type: "groupNode",
      parentId: "g_strategy",
      position: { x: 40, y: 50 },
      data: {
        label: "Initial Entry Sequence (Init)",
        styleType: "dashed-init",
      } as any,
      style: { width: 1100, height: 160 },
    },
    {
      id: "g_trigger1",
      type: "groupNode",
      parentId: "g_strategy",
      position: { x: 40, y: 220 },
      data: {
        label: "1h Monitoring: Hold After Funding Check (Trigger)",
        styleType: "dashed-trigger",
      } as any,
      style: { width: 1100, height: 160 },
    },
    {
      id: "g_trigger2",
      type: "groupNode",
      parentId: "g_strategy",
      position: { x: 40, y: 390 },
      data: {
        label: "Continuous Monitoring: Realign PEPE Short (Trigger)",
        styleType: "dashed-trigger",
      } as any,
      style: { width: 1100, height: 160 },
    },
    {
      id: "g_trigger3",
      type: "groupNode",
      parentId: "g_strategy",
      position: { x: 40, y: 560 },
      data: {
        label: "Continuous Monitoring: Realign ETH Short (Trigger)",
        styleType: "dashed-trigger",
      } as any,
      style: { width: 1100, height: 160 },
    },
    {
      id: "g_emergency",
      type: "groupNode",
      parentId: "g_strategy",
      position: { x: 40, y: 730 },
      data: {
        label: "Manual Emergency Exit Sequence (Trigger)",
        styleType: "dashed-emergency",
      } as any,
      style: { width: 1100, height: 160 },
    },
    {
      id: "n_init_click",
      type: "clickTrigger",
      parentId: "g_init",
      position: { x: 20, y: 60 },
      data: { label: "Start PEPE/WETH Hedge Bot", shortcut: null, isRecording: false } as any,
    },
    {
      id: "n_init_prepare",
      type: "functionNode",
      parentId: "g_init",
      position: { x: 300, y: 60 },
      data: {
        label: "Initial Capital Allocation and Margin Alignment",
        functionName: "preparePepeHedge()",
        code: "function preparePepeHedge(capital, currentPepePrice, currentEthPrice) {\n  const lpSeed = capital * 0.50;\n  const pepeShortMargin = capital * 0.25;\n  const ethShortMargin = capital * 0.25;\n\n  const basePepeQty = (lpSeed * 0.50) / currentPepePrice;\n  const baseEthQty = (lpSeed * 0.50) / currentEthPrice;\n\n  return {\n    hedgePlan: { lpSeed, pepeShortMargin, ethShortMargin },\n    targetOrders: {\n      dexLiquidityPepe: basePepeQty,\n      dexLiquidityEth: baseEthQty,\n      cexShortPepe: basePepeQty,\n      cexShortEth: baseEthQty\n    }\n  };\n}",
        inputBlocks: [],
        outputBlocks: [{ id: "out-1", name: "hedgePlan", type: "output" }, { id: "out-order", name: "targetOrders", type: "output" }],
        viewMode: "node",
      } as FunctionNodeData,
    },
    {
      id: "n_init_swap",
      type: "actionNode",
      parentId: "g_init",
      position: { x: 650, y: 40 },
      data: {
        label: "Execute: Supply PEPE/WETH LP",
        actionType: "DEX",
        contractAddress: "0xPepeWethLpRouter",
        functionName: "addLiquidityPEPEWETH()",
        chainId: 1,
        inputBlocks: [{ id: "ib-lp", name: "targetOrders", type: "input"}],
        outputBlocks: [{ id: "out-2", name: "lpReady", type: "output" }],
        isExpanded: false,
      } as DEXActionData,
    },
    {
      id: "n_init_execute_pepe",
      type: "actionNode",
      parentId: "g_init",
      position: { x: 950, y: 40 },
      data: {
        label: "Execute: Enter PEPE Short",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "PEPE/USDT",
        side: "SELL",
        orderType: "MARKET",
        amount: "{{Initial Capital Allocation and Margin Alignment.targetOrders.cexShortPepe}}",
        amountType: "FIXED",
        inputBlocks: [{ id: "ib-cex", name: "targetOrders", type: "input"}],
        outputBlocks: [{ id: "out-3", name: "success", type: "output" }],
        isExpanded: true,
      } as CEXActionData,
    },
    {
      id: "n_init_execute_eth",
      type: "actionNode",
      parentId: "g_init",
      position: { x: 1250, y: 40 },
      data: {
        label: "Execute: Enter ETH Short",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "ETH/USDT",
        side: "SELL",
        orderType: "MARKET",
        amount: "{{Initial Capital Allocation and Margin Alignment.targetOrders.cexShortEth}}",
        amountType: "FIXED",
        inputBlocks: [{ id: "ib-cex-eth", name: "targetOrders", type: "input"}],
        outputBlocks: [{ id: "out-3-eth", name: "success", type: "output" }],
        isExpanded: true,
      } as CEXActionData,
    },
    {
      id: "n_t1_stream",
      type: "streamingNode",
      parentId: "g_trigger1",
      position: { x: 20, y: 60 },
      data: createBinanceFuturesFundingStreamData({
        label: "Binance Live Funding Rate Detector",
        outputBlocks: [
          { id: "out-funding", name: "fundingRateBps", type: "output" },
          { id: "out-slippage", name: "slippageBps", type: "output" }
        ],
        symbols: ["PEPEUSDT"],
      }) as StreamingNodeData,
    },
    {
      id: "n_t1_branch",
      type: "branchNode",
      parentId: "g_trigger1",
      position: { x: 380, y: 60 },
      data: {
        label: "Condition Wait: Funding and Slippage Allowed",
        branches: [{ id: "b1", name: "Hold Allowed", active: true, code: "// Let the action pass only when the upstream function returns 'Hold Allowed'.\nreturn result === 'Hold Allowed';" }],
        inputBlocks: [
          { id: "ib-fund", name: "fundingRate", type: "input" },
          { id: "ib-slip", name: "slippage", type: "input" },
        ],
        functionName: "checkFundingStatus()",
        code: "function checkFundingStatus(fundingRateBps, slippageBps) {\n  // Hold the position when funding is at or below 8 bps and slippage is at or below 20 bps.\n  if (fundingRateBps <= 8 && slippageBps <= 20) {\n    return 'Hold Allowed';\n  }\n  return 'Hold';\n}",
        viewMode: "node",
      } as any,
    },
    {
      id: "n_t1_execute_pepe",
      type: "actionNode",
      parentId: "g_trigger1",
      position: { x: 750, y: 40 },
      data: {
        label: "Execute: Adjust PEPE Short Hold",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "PEPE/USDT",
        side: "SELL",
        orderType: "MARKET",
        amount: "250",
        amountType: "FIXED",
        inputBlocks: [],
        outputBlocks: [{ id: "out-t1-pepe", name: "success", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "n_t1_execute_eth",
      type: "actionNode",
      parentId: "g_trigger1",
      position: { x: 1050, y: 40 },
      data: {
        label: "Execute: Adjust ETH Short Hold",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "ETH/USDT",
        side: "SELL",
        orderType: "MARKET",
        amount: "250",
        amountType: "FIXED",
        inputBlocks: [],
        outputBlocks: [{ id: "out-t1-eth", name: "success", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "n_t2_stream",
      type: "streamingNode",
      parentId: "g_trigger2",
      position: { x: 20, y: 60 },
      data: createBinanceSpotPriceStreamData({
        label: "Binance Spot Price Stream",
        outputBlocks: [{ id: "out-price", name: "currentPrice", type: "output" }],
        symbols: ["PEPEUSDT", "ETHUSDT"],
      }) as StreamingNodeData,
    },
    {
      id: "n_t2_branch",
      type: "branchNode",
      parentId: "g_trigger2",
      position: { x: 380, y: 60 },
      data: {
        functionName: "checkRebalanceNeeded()",
        code: "function checkRebalanceNeeded(entry, current) {\n  const deviation = Math.abs(1 - current.pepePrice / entry.pepePrice);\n\n  if (deviation > 0.10) {\n     return 'Realignment Needed';\n  }\n  return 'Hold';\n}",
        viewMode: "node",
        label: "Risk Detection: PEPE Spike or Low Collateral",
        branches: [{ id: "b1", name: "Realignment Needed", active: true, code: "return result === 'Realignment Needed';" }],
        inputBlocks: [
          { id: "ib-price", name: "currentPrice", type: "input" },
        ],
      } as any,
    },
    {
      id: "n_t2_execute",
      type: "actionNode",
      parentId: "g_trigger2",
      position: { x: 750, y: 40 },
      data: {
        label: "Execute: Realign PEPE Short",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "PEPE/USDT",
        side: "SELL",
        orderType: "MARKET",
        amount: "250",
        amountType: "FIXED",
        inputBlocks: [],
        outputBlocks: [{ id: "out-t2", name: "success", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "n_t3_stream",
      type: "streamingNode",
      parentId: "g_trigger3",
      position: { x: 20, y: 60 },
      data: createBinanceSpotPriceStreamData({
        label: "Binance Spot Price Stream",
        outputBlocks: [{ id: "out-price-eth", name: "currentPrice", type: "output" }],
        symbols: ["ETHUSDT"],
      }) as StreamingNodeData,
    },
    {
      id: "n_t3_branch",
      type: "branchNode",
      parentId: "g_trigger3",
      position: { x: 380, y: 60 },
      data: {
        functionName: "checkEthRebalanceNeeded()",
        code: "function checkEthRebalanceNeeded(entry, current) {\n  const deviation = Math.abs(1 - current.ethPrice / entry.ethPrice);\n\n  if (deviation > 0.08) {\n     return 'Realignment Needed';\n  }\n  return 'Hold';\n}",
        viewMode: "node",
        label: "Risk Detection: ETH Spike or Low Collateral",
        branches: [{ id: "b1", name: "Realignment Needed", active: true, code: "return result === 'Realignment Needed';" }],
        inputBlocks: [
          { id: "ib-price-eth", name: "currentPrice", type: "input" },
        ],
      } as any,
    },
    {
      id: "n_t3_execute_eth",
      type: "actionNode",
      parentId: "g_trigger3",
      position: { x: 750, y: 40 },
      data: {
        label: "Execute: Realign ETH Short",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "ETH/USDT",
        side: "SELL",
        orderType: "MARKET",
        amount: "250",
        amountType: "FIXED",
        inputBlocks: [],
        outputBlocks: [{ id: "out-t2-eth", name: "success", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "n_em_click",
      type: "clickTrigger",
      parentId: "g_emergency",
      position: { x: 20, y: 60 },
      data: { label: "Emergency: Close All PEPE/WETH Positions", shortcut: null, isRecording: false } as any,
    },
    {
      id: "n_em_stream",
      type: "streamingNode",
      parentId: "g_emergency",
      position: { x: 240, y: 36 },
      data: createBinanceFuturesUserDataStreamData({
        label: "Binance Futures Position Stream",
        outputBlocks: [
          { id: "pos-pepe", name: "pepeShortQty", type: "output" },
          { id: "pos-eth", name: "ethShortQty", type: "output" },
          { id: "wallet-usdt", name: "futuresWalletUsdt", type: "output" },
        ],
      }) as StreamingNodeData,
    },
    {
      id: "n_em_cex_pepe",
      type: "actionNode",
      parentId: "g_emergency",
      position: { x: 560, y: 40 },
      data: {
        label: "Close: Fully Close Binance PEPE Short",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "PEPE/USDT",
        side: "BUY",
        orderType: "MARKET",
        amount: "{{Binance Futures Position Stream.pepeShortQty}}",
        amountType: "FIXED",
        inputBlocks: [
          { id: "ib-pos-pepe", name: "pepeShortQty", type: "input" },
          { id: "ib-wallet-usdt", name: "futuresWalletUsdt", type: "input" },
        ],
        outputBlocks: [{ id: "out-em-cex-pepe", name: "positionsClosed", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "n_em_cex_eth",
      type: "actionNode",
      parentId: "g_emergency",
      position: { x: 860, y: 40 },
      data: {
        label: "Close: Fully Close Binance ETH Short",
        actionType: "CEX",
        exchange: "Binance",
        symbol: "ETH/USDT",
        side: "BUY",
        orderType: "MARKET",
        amount: "{{Binance Futures Position Stream.ethShortQty}}",
        amountType: "FIXED",
        inputBlocks: [
          { id: "ib-pos-eth", name: "ethShortQty", type: "input" },
          { id: "ib-wallet-usdt-eth", name: "futuresWalletUsdt", type: "input" },
        ],
        outputBlocks: [{ id: "out-em-cex-eth", name: "positionsClosed", type: "output" }],
        isExpanded: false,
      } as CEXActionData,
    },
    {
      id: "n_em_execute",
      type: "actionNode",
      parentId: "g_emergency",
      position: { x: 1160, y: 40 },
      data: {
        label: "Close: Withdraw LP and Convert All to USDT",
        actionType: "DEX",
        contractAddress: "0xPepeWethExitRouter",
        functionName: "liquidatePepeHedge()",
        chainId: 1,
        inputBlocks: [],
        outputBlocks: [{ id: "out-em", name: "success", type: "output" }],
        isExpanded: false,
      } as DEXActionData,
    },
  ];

  const edges: Edge[] = [
    { id: "e_init_1", source: "n_init_click", target: "n_init_prepare", sourceHandle: "n_init_click-trigger-out", targetHandle: "n_init_prepare-func-in", type: "custom" },
    { id: "e_init_2", source: "n_init_prepare", target: "n_init_swap", sourceHandle: "n_init_prepare-block-out-1-out", targetHandle: "n_init_swap-func-in", type: "custom" },
    { id: "e_init_data1", source: "n_init_prepare", target: "n_init_swap", sourceHandle: "n_init_prepare-block-out-order-out", targetHandle: "n_init_swap-input-ib-lp-in", type: "custom" },
    { id: "e_init_3", source: "n_init_swap", target: "n_init_execute_pepe", sourceHandle: "n_init_swap-success-out", targetHandle: "n_init_execute_pepe-func-in", type: "custom" },
    { id: "e_init_data2", source: "n_init_prepare", target: "n_init_execute_pepe", sourceHandle: "n_init_prepare-block-out-order-out", targetHandle: "n_init_execute_pepe-input-ib-cex-in", type: "custom" },
    { id: "e_init_4", source: "n_init_execute_pepe", target: "n_init_execute_eth", sourceHandle: "n_init_execute_pepe-success-out", targetHandle: "n_init_execute_eth-func-in", type: "custom" },
    { id: "e_init_data3", source: "n_init_prepare", target: "n_init_execute_eth", sourceHandle: "n_init_prepare-block-out-order-out", targetHandle: "n_init_execute_eth-input-ib-cex-eth-in", type: "custom" },

    { id: "e_t1_1", source: "n_t1_stream", target: "n_t1_branch", sourceHandle: "n_t1_stream-trigger-out", targetHandle: "n_t1_branch-branch-in", type: "custom" },
    { id: "e_t1_block1", source: "n_t1_stream", target: "n_t1_branch", sourceHandle: "n_t1_stream-block-out-funding-out", targetHandle: "n_t1_branch-input-ib-fund-in", type: "custom" },
    { id: "e_t1_block2", source: "n_t1_stream", target: "n_t1_branch", sourceHandle: "n_t1_stream-block-out-slippage-out", targetHandle: "n_t1_branch-input-ib-slip-in", type: "custom" },
    { id: "e_t1_2", source: "n_t1_branch", target: "n_t1_execute_pepe", sourceHandle: "n_t1_branch-branch-b1-out", targetHandle: "n_t1_execute_pepe-func-in", type: "custom" },
    { id: "e_t1_3", source: "n_t1_execute_pepe", target: "n_t1_execute_eth", sourceHandle: "n_t1_execute_pepe-success-out", targetHandle: "n_t1_execute_eth-func-in", type: "custom" },

    { id: "e_t2_1", source: "n_t2_stream", target: "n_t2_branch", sourceHandle: "n_t2_stream-trigger-out", targetHandle: "n_t2_branch-branch-in", type: "custom" },
    { id: "e_t2_block1", source: "n_t2_stream", target: "n_t2_branch", sourceHandle: "n_t2_stream-block-out-price-out", targetHandle: "n_t2_branch-input-ib-price-in", type: "custom" },
    { id: "e_t2_2", source: "n_t2_branch", target: "n_t2_execute", sourceHandle: "n_t2_branch-branch-b1-out", targetHandle: "n_t2_execute-func-in", type: "custom" },
    { id: "e_t3_1", source: "n_t3_stream", target: "n_t3_branch", sourceHandle: "n_t3_stream-trigger-out", targetHandle: "n_t3_branch-branch-in", type: "custom" },
    { id: "e_t3_block1", source: "n_t3_stream", target: "n_t3_branch", sourceHandle: "n_t3_stream-block-out-price-eth-out", targetHandle: "n_t3_branch-input-ib-price-eth-in", type: "custom" },
    { id: "e_t3_2", source: "n_t3_branch", target: "n_t3_execute_eth", sourceHandle: "n_t3_branch-branch-b1-out", targetHandle: "n_t3_execute_eth-func-in", type: "custom" },

    { id: "e_em_1", source: "n_em_click", target: "n_em_stream", sourceHandle: "n_em_click-trigger-out", targetHandle: "n_em_stream-func-in", type: "custom" },
    { id: "e_em_2", source: "n_em_stream", target: "n_em_cex_pepe", sourceHandle: "n_em_stream-trigger-out", targetHandle: "n_em_cex_pepe-func-in", type: "custom" },
    { id: "e_em_data1", source: "n_em_stream", target: "n_em_cex_pepe", sourceHandle: "n_em_stream-block-pos-pepe-out", targetHandle: "n_em_cex_pepe-input-ib-pos-pepe-in", type: "custom" },
    { id: "e_em_data2", source: "n_em_stream", target: "n_em_cex_pepe", sourceHandle: "n_em_stream-block-wallet-usdt-out", targetHandle: "n_em_cex_pepe-input-ib-wallet-usdt-in", type: "custom" },
    { id: "e_em_3", source: "n_em_cex_pepe", target: "n_em_cex_eth", sourceHandle: "n_em_cex_pepe-success-out", targetHandle: "n_em_cex_eth-func-in", type: "custom" },
    { id: "e_em_data3", source: "n_em_stream", target: "n_em_cex_eth", sourceHandle: "n_em_stream-block-pos-eth-out", targetHandle: "n_em_cex_eth-input-ib-pos-eth-in", type: "custom" },
    { id: "e_em_data4", source: "n_em_stream", target: "n_em_cex_eth", sourceHandle: "n_em_stream-block-wallet-usdt-out", targetHandle: "n_em_cex_eth-input-ib-wallet-usdt-eth-in", type: "custom" },
    { id: "e_em_4", source: "n_em_cex_eth", target: "n_em_execute", sourceHandle: "n_em_cex_eth-success-out", targetHandle: "n_em_execute-func-in", type: "custom" },
  ];

  return { nodes, edges };
};
