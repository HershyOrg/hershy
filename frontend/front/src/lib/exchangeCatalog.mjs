const CEX_TRADE_CONNECTION_IDS = ['binance', 'bybit', 'okx', 'gate', 'polymarket'];
const POLYMARKET_EXCHANGE_ID = 'polymarket';

export const DEFAULT_EXCHANGE_CONNECTIONS = [
  {
    id: 'binance',
    name: 'Binance',
    type: 'CEX',
    status: '대기',
    color: 'amber',
    apiUrl: 'https://api.binance.com',
    marketDataUrl: 'https://api.binance.com',
    wsUrl: 'wss://stream.binance.com:9443/ws',
  },
  {
    id: 'bybit',
    name: 'Bybit',
    type: 'CEX',
    status: '대기',
    color: 'orange',
    apiUrl: 'https://api.bybit.com',
  },
  {
    id: 'okx',
    name: 'OKX',
    type: 'CEX',
    status: '대기',
    color: 'slate',
    apiUrl: 'https://www.okx.com',
  },
  {
    id: 'gate',
    name: 'Gate.io',
    type: 'CEX',
    status: '대기',
    color: 'rose',
    apiUrl: 'https://api.gateio.ws',
  },
  {
    id: 'polymarket',
    name: 'Polymarket',
    type: 'DEX',
    status: '대기',
    color: 'cyan',
    apiUrl: 'https://clob.polymarket.com',
    marketDataUrl: 'https://clob.polymarket.com',
    wsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  },
];

export const SUPPORTED_EXCHANGE_CONNECTION_IDS = new Set(
  DEFAULT_EXCHANGE_CONNECTIONS.map((connection) => connection.id),
);

export const SUPPORTED_CEX_TRADE_EXCHANGES = DEFAULT_EXCHANGE_CONNECTIONS
  .filter((connection) => CEX_TRADE_CONNECTION_IDS.includes(connection.id))
  .map((connection) => ({
    id: connection.id,
    name: connection.name,
  }));

export const DEFAULT_CEX_TRADE_EXCHANGE = SUPPORTED_CEX_TRADE_EXCHANGES[0]?.name || 'Binance';

export function joinExchangeNames(connections = []) {
  return connections
    .map((connection) => {
      if (typeof connection === 'string') {
        return connection.trim();
      }
      return typeof connection?.name === 'string' ? connection.name.trim() : '';
    })
    .filter(Boolean)
    .join(', ');
}

export function isSupportedCEXTradeExchangeName(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SUPPORTED_CEX_TRADE_EXCHANGES.some((connection) => connection.name.toLowerCase() === normalized);
}

export function isPolymarketExchangeName(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s._-]+/g, '')
    : '';
  return normalized === POLYMARKET_EXCHANGE_ID;
}
