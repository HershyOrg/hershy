import { buildPolymarketParams } from '../lib/polymarketTrade';

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
  apiDefault: [
    { name: 'to', placeholder: '0x...' },
    { name: 'amount', placeholder: '0.0' },
    { name: 'data', placeholder: '0x...' }
  ]
};

export function getActionParams(actionType, executionMode, dexProtocol = 'generic') {
  if (actionType === 'cex') {
    return ACTION_PARAM_PRESETS.cex.map((param) => ({
      ...param,
      value: '',
      source: null,
      sources: []
    }));
  }

  const selected = executionMode === 'api'
    ? ACTION_PARAM_PRESETS.apiDefault
    : ACTION_PARAM_PRESETS.dexDefault;
  if (dexProtocol === 'polymarket') {
    return buildPolymarketParams();
  }
  return selected.map((param) => ({
    ...param,
    value: '',
    source: null,
    sources: []
  }));
}
