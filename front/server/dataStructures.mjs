export const STRATEGY_RUNNER_RUNTIME_FILES = [
  'go.mod',
  'go.sum',
  'runner/runner.go',
  'liveexec/liveexec.go',
];

export { DEFAULT_MARKET_OVERVIEW_ROWS } from '../mock-data/server/market-overview.mjs';

export const DEFAULT_HERSHY_CONTEXT_FILES = [
  'README.md',
  'examples/strategy-runner/README.md',
  'examples/strategy-runner/strategy.sample.json',
  'program/reducer.go',
  'program/effect.go',
];

export const EXCHANGE_WEBSOCKET_RAG_INDEX_FILE = 'agent-runtime/docs/rag/exchange-websocket-subscriptions/index.md';

export const EXCHANGE_WEBSOCKET_RAG_FILES = {
  binance: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/binance.md',
  bybit: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/bybit.md',
  okx: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/okx.md',
  kucoin: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/kucoin.md',
  bitget: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/bitget.md',
  gate: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/gateio.md',
  gateio: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/gateio.md',
  polymarket: 'agent-runtime/docs/rag/exchange-websocket-subscriptions/polymarket.md',
};

export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export const EXPLORER_API_ENDPOINTS = {
  'eth-mainnet': 'https://api.etherscan.io/api',
  'base-mainnet': 'https://api.basescan.org/api',
  'arb-mainnet': 'https://api.arbiscan.io/api',
  'opt-mainnet': 'https://api-optimistic.etherscan.io/api',
  'polygon-mainnet': 'https://api.polygonscan.com/api',
  'bsc-mainnet': 'https://api.bscscan.com/api',
};

export const EXPLORER_CHAIN_IDS = {
  'eth-mainnet': 1,
  'base-mainnet': 8453,
  'arb-mainnet': 42161,
  'opt-mainnet': 10,
  'polygon-mainnet': 137,
  'bsc-mainnet': 56,
};

export const ETHERSCAN_V2_ENDPOINT = 'https://api.etherscan.io/v2/api';

export const EXPLORER_WEB_BASE_URLS = {
  'eth-mainnet': 'https://etherscan.io/address',
  'base-mainnet': 'https://basescan.org/address',
  'arb-mainnet': 'https://arbiscan.io/address',
  'opt-mainnet': 'https://optimistic.etherscan.io/address',
  'polygon-mainnet': 'https://polygonscan.com/address',
  'bsc-mainnet': 'https://bscscan.com/address',
};

export const CHAIN_ALIASES = {
  ethereum: 'eth-mainnet',
  eth: 'eth-mainnet',
  mainnet: 'eth-mainnet',
  'eth-mainnet': 'eth-mainnet',
  base: 'base-mainnet',
  'base-mainnet': 'base-mainnet',
  arbitrum: 'arb-mainnet',
  arb: 'arb-mainnet',
  'arb-mainnet': 'arb-mainnet',
  optimism: 'opt-mainnet',
  opt: 'opt-mainnet',
  'opt-mainnet': 'opt-mainnet',
  polygon: 'polygon-mainnet',
  matic: 'polygon-mainnet',
  'polygon-mainnet': 'polygon-mainnet',
  bsc: 'bsc-mainnet',
  bnb: 'bsc-mainnet',
  'bsc-mainnet': 'bsc-mainnet',
};

export const MARKET_CHART_INTERVALS = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
]);

export const ORCHESTRATION_PLAN_SCHEMA = {
  type: 'object',
  required: ['mode', 'needResearch', 'researchTasks', 'strategyTasks', 'contractHints', 'notes'],
  properties: {
    mode: { type: 'string' },
    needResearch: { type: 'boolean' },
    researchTasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'query', 'priority'],
        properties: {
          kind: { type: 'string' },
          query: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    strategyTasks: { type: 'array', items: { type: 'string' } },
    contractHints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['chain', 'address', 'reason'],
        properties: {
          chain: { type: 'string' },
          address: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

export const RESEARCH_BUNDLE_SCHEMA = {
  type: 'object',
  required: ['goals', 'findings', 'urls', 'contracts', 'warnings'],
  properties: {
    goals: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
    urls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title', 'note'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    contracts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['chain', 'address', 'label', 'reason'],
        properties: {
          chain: { type: 'string' },
          address: { type: 'string' },
          label: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

export const STRATEGY_OVERVIEW_SCHEMA = {
  type: 'object',
  required: ['blocks'],
  properties: {
    strategySummary: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'roleDescription', 'inputSummary', 'outputSummary'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          roleDescription: { type: 'string' },
          tradingCriterion: { type: 'string' },
          inputSummary: { type: 'string' },
          outputSummary: { type: 'string' },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label'],
        properties: {
          id: { type: 'string' },
          fromId: { type: 'string' },
          toId: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
};

export const STRATEGY_GRAPH_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'kind', 'strategy', 'blocks', 'connections'],
  properties: {
    schemaVersion: { type: 'number' },
    kind: { type: 'string', enum: ['hershy-strategy-graph'] },
    strategy: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
    generatedAt: { type: 'string' },
    summary: {
      type: 'object',
      properties: {
        blocks: { type: 'number' },
        connections: { type: 'number' },
      },
    },
    metadata: { type: 'object' },
    blocks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'type', 'config'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['streaming', 'normal', 'trigger', 'action', 'monitoring'] },
          config: { type: 'object' },
        },
      },
    },
    connections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'kind', 'fromId', 'toId'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['stream-monitor', 'trigger-action', 'trigger-input', 'action-input', 'data-flow', 'action-result'] },
          fromId: { type: 'string' },
          toId: { type: 'string' },
          label: { type: 'string' },
          easyLabel: { type: 'string' },
        },
      },
    },
  },
};

export const STRATEGY_BLOCK_TYPE_ALIASES = {
  stream: 'streaming',
  feed: 'streaming',
  data_feed: 'streaming',
  source: 'streaming',
  websocket: 'streaming',
  wss: 'streaming',
  api: 'streaming',
  compute: 'normal',
  formula: 'normal',
  indicator: 'normal',
  predicate: 'normal',
  signal: 'normal',
  condition: 'trigger',
  condition_trigger: 'trigger',
  time_trigger: 'trigger',
  timer: 'trigger',
  schedule: 'trigger',
  cex: 'action',
  dex: 'action',
  order: 'action',
  swap: 'action',
  execution: 'action',
  execute: 'action',
  monitor: 'monitoring',
  chart: 'monitoring',
};

export const STRATEGY_CONNECTION_KIND_ALIASES = {
  stream_monitor: 'stream-monitor',
  streammonitor: 'stream-monitor',
  monitor: 'stream-monitor',
  chart: 'stream-monitor',
  trigger_action: 'trigger-action',
  triggeraction: 'trigger-action',
  trigger_to_action: 'trigger-action',
  execute: 'trigger-action',
  execution: 'trigger-action',
  action: 'trigger-action',
  condition: 'trigger-action',
  predicate: 'trigger-action',
  trigger_input: 'trigger-input',
  triggerinput: 'trigger-input',
  time_gate: 'trigger-input',
  gate: 'trigger-input',
  action_input: 'action-input',
  actioninput: 'action-input',
  input: 'action-input',
  parameter: 'action-input',
  param: 'action-input',
  data_flow: 'data-flow',
  dataflow: 'data-flow',
  data: 'data-flow',
  signal: 'data-flow',
  predicate_input: 'data-flow',
  formula_input: 'data-flow',
  computed_signal: 'data-flow',
  action_result: 'action-result',
  actionresult: 'action-result',
  result: 'action-result',
  output: 'action-result',
  order_result: 'action-result',
  tx_result: 'action-result',
};

export const REQUIRED_SIGNAL_BY_STRATEGY_KIND = {
  spot_perp_basis: ['basis'],
  spread: ['spread'],
  moving_average: ['moving_average'],
  rsi: ['rsi'],
  funding_rate: ['funding_rate'],
};

export const TIME_STRATEGY_KIND_SET = new Set(['dca', 'rebalance']);

export const ALLOWED_RAW_ACTION_INPUT_REASONS = new Set([
  'slippage_guard',
  'quote_preview',
  'execution_price',
  'monitoring_context',
  'risk_control',
  'kill_switch',
]);

export const GENERIC_SIGNAL_TOKENS = new Set([
  'normal',
  'formula',
  'indicator',
  'computed',
  'computation',
  'calculation',
  'signal',
  'node',
  'logic',
  'value',
  'output',
]);

export const RAW_FEED_SIGNAL_TOKENS = new Set([
  'price',
  'spot_price',
  'perp_price',
  'market_price',
  'mark_price',
  'index_price',
  'last_price',
  'lastprice',
  'volume',
  'open',
  'high',
  'low',
  'close',
  'ohlcv',
  'ticker',
  'candle',
  'candles',
  'funding_rate',
  'open_interest',
]);
