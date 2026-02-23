const STREAMING_SAMPLES = {
  default: {
    timestamp: '2024-01-01T00:00:00Z',
    price: 43210.12,
    volume: 123.45,
    change: -0.12
  },
  'wss://stream.binance.com:9443/ws/btcusdt@ticker': {
    eventTime: 1710000000000,
    symbol: 'BTCUSDT',
    lastPrice: 62345.5,
    volume: 789.12,
    priceChangePercent: 1.23
  },
  'wss://stream.binance.com:9443/ws/ethusdt@ticker': {
    eventTime: 1710000000000,
    symbol: 'ETHUSDT',
    lastPrice: 3456.78,
    volume: 456.78,
    priceChangePercent: -0.45
  },
  'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT': {
    symbol: 'BTCUSDT',
    lastPrice: 62111.1,
    volume: 1123.45,
    highPrice: 63450.0,
    lowPrice: 61234.2
  }
};

const ACTION_PARAM_PRESETS = {
  cex: [
    { name: 'symbol', placeholder: 'BTCUSDT' },
    { name: 'marketType', placeholder: 'spot/futures' },
    { name: 'side', placeholder: 'buy/sell' },
    { name: 'type', placeholder: 'market/limit' },
    { name: 'quantity', placeholder: '0.01' },
    { name: 'price', placeholder: 'optional' }
  ],
  dexDefault: [
    { name: 'tokenIn', placeholder: '0x...' },
    { name: 'tokenOut', placeholder: '0x...' },
    { name: 'amountIn', placeholder: '0.0' },
    { name: 'amountOutMin', placeholder: '0.0' }
  ],
  dexPolymarket: [
    { name: 'tokenId', placeholder: 'Polymarket token_id' },
    { name: 'side', placeholder: 'buy/sell' },
    { name: 'price', placeholder: '0.52' },
    { name: 'size', placeholder: '10' },
    { name: 'orderType', placeholder: 'GTC/FAK/FOK' },
    { name: 'postOnly', placeholder: 'true/false (선택)' }
  ],
  apiDefault: [
    { name: 'to', placeholder: '0x...' },
    { name: 'amount', placeholder: '0.0' },
    { name: 'data', placeholder: '0x...' }
  ]
};

export function getStreamingFields(source) {
  const sample = STREAMING_SAMPLES[source] || STREAMING_SAMPLES.default;
  return Object.keys(sample);
}

export function getActionParams(actionType, executionMode, dexProtocol = 'generic') {
  if (actionType === 'cex') {
    return ACTION_PARAM_PRESETS.cex.map((param) => ({
      ...param,
      value: '',
      source: null,
      sources: []
    }));
  }

  let selected = executionMode === 'api'
    ? ACTION_PARAM_PRESETS.apiDefault
    : ACTION_PARAM_PRESETS.dexDefault;
  if (dexProtocol === 'polymarket') {
    selected = ACTION_PARAM_PRESETS.dexPolymarket;
  }
  return selected.map((param) => ({
    ...param,
    value: '',
    source: null,
    sources: []
  }));
}
