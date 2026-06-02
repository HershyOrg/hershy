import {
  DEFAULT_MARKET_OVERVIEW_ROWS,
  MARKET_CHART_INTERVALS,
} from './dataStructures.mjs';
import { normalizeText } from './env.mjs';

function formatMarketPrice(value, symbol) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  if (/DOGE|PEPE|SHIB/i.test(symbol)) {
    return numeric.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  return numeric.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatMarketChange(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '+0.00%';
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

async function fetchJSONWithTimeout(url, timeoutMs = 6000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

export async function fetchMarketOverviewRows() {
  const [btc, eth, sol, bnb, gecko] = await Promise.allSettled([
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 8000),
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', 8000),
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT', 8000),
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=BNBUSDT', 8000),
    fetchJSONWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true', 8000),
  ]);
  const geckoValue = gecko.status === 'fulfilled' ? gecko.value : {};
  const bySymbol = new Map([
    ['BTCUSDT', btc.status === 'fulfilled' ? btc.value : null],
    ['ETHUSDT', eth.status === 'fulfilled' ? eth.value : null],
    ['SOLUSDT', sol.status === 'fulfilled' ? sol.value : null],
    ['BNBUSDT', bnb.status === 'fulfilled' ? bnb.value : null],
  ]);
  const geckoBySymbol = {
    BTCUSDT: geckoValue?.bitcoin ? { lastPrice: geckoValue.bitcoin.usd, priceChangePercent: geckoValue.bitcoin.usd_24h_change } : null,
    ETHUSDT: geckoValue?.ethereum ? { lastPrice: geckoValue.ethereum.usd, priceChangePercent: geckoValue.ethereum.usd_24h_change } : null,
    SOLUSDT: geckoValue?.solana ? { lastPrice: geckoValue.solana.usd, priceChangePercent: geckoValue.solana.usd_24h_change } : null,
    BNBUSDT: geckoValue?.binancecoin ? { lastPrice: geckoValue.binancecoin.usd, priceChangePercent: geckoValue.binancecoin.usd_24h_change } : null,
  };
  const rows = DEFAULT_MARKET_OVERVIEW_ROWS.map((base) => {
    const source = bySymbol.get(base.symbol) || geckoBySymbol[base.symbol];
    const change = Number(source?.priceChangePercent);
    return {
      ...base,
      price: formatMarketPrice(source?.lastPrice, base.symbol),
      change: formatMarketChange(change),
      tone: change >= 0 ? 'up' : 'down',
      source: source === geckoBySymbol[base.symbol] ? 'CoinGecko' : base.source,
    };
  });
  return {
    updatedAt: new Date().toISOString(),
    source: 'public-market-ticker',
    rows,
  };
}

function normalizeMarketChartSymbol(symbol) {
  const text = normalizeText(symbol).toUpperCase();
  return text
    .replace(/\.P$/i, '')
    .replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
}

function resolveMarketChartMarket(symbol, market) {
  const text = `${normalizeText(symbol)} ${normalizeText(market)}`.toLowerCase();
  if (/perp|futures|future|swap|\.p\b|선물/.test(text)) return 'futures';
  return 'spot';
}

function normalizeMarketChartLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return 96;
  return Math.max(24, Math.min(500, Math.floor(numeric)));
}

export async function fetchMarketChartSeries({ symbol, market, interval, limit }) {
  const resolvedMarket = resolveMarketChartMarket(symbol, market);
  const normalizedSymbol = normalizeMarketChartSymbol(symbol);
  const normalizedInterval = MARKET_CHART_INTERVALS.has(interval) ? interval : '1m';
  const normalizedLimit = normalizeMarketChartLimit(limit);
  const baseUrl = resolvedMarket === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const endpointPath = resolvedMarket === 'futures' ? '/fapi/v1/klines' : '/api/v3/klines';
  const url = `${baseUrl}${endpointPath}?symbol=${encodeURIComponent(normalizedSymbol)}&interval=${encodeURIComponent(normalizedInterval)}&limit=${normalizedLimit}`;
  const rows = await fetchJSONWithTimeout(url, 8000);
  if (!Array.isArray(rows)) {
    throw new Error('unexpected Binance kline response');
  }

  return {
    updatedAt: new Date().toISOString(),
    source: resolvedMarket === 'futures' ? 'Binance Futures kline' : 'Binance Spot kline',
    symbol: normalizedSymbol,
    market: resolvedMarket,
    interval: normalizedInterval,
    series: rows
      .map((row) => {
        if (!Array.isArray(row)) return null;
        const openTime = Number(row[0]);
        const close = Number(row[4]);
        const volume = Number(row[5]);
        if (!Number.isFinite(openTime) || !Number.isFinite(close)) return null;
        return {
          time: Math.floor(openTime / 1000),
          value: close,
          volume: Number.isFinite(volume) ? volume : undefined,
        };
      })
      .filter(Boolean),
  };
}
