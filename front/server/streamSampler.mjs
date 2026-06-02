import {
  CHAIN_ALIASES,
  EXPLORER_API_ENDPOINTS,
} from './dataStructures.mjs';
import { normalizeText } from './env.mjs';

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeStringArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((item) => normalizeText(item)).filter(Boolean);
  }
  return [];
}

function trimSnippet(text, limit) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export function normalizeStreamSampleInput(raw) {
  const body = normalizeObject(raw) || {};
  const sourceURL = normalizeText(body.source_url || body.sourceUrl);
  const streamChain = normalizeText(body.stream_chain || body.streamChain).toLowerCase();
  return {
    streamKind: normalizeStreamKind(body.stream_kind || body.streamKind, sourceURL, streamChain),
    sourceURL,
    exchange: normalizeExchangeName(body.exchange || body.venue || body.provider),
    symbol: normalizeText(body.symbol || body.market || body.pair),
    marketId: normalizeText(body.market_id || body.marketId),
    tokenId: normalizeText(body.token_id || body.tokenId),
    streamChain,
    streamMethod: normalizeText(body.stream_method || body.streamMethod),
    streamParamsJSON: normalizeText(body.stream_params_json || body.streamParamsJson) || '[]',
    responseSchema: normalizeText(body.response_schema || body.responseSchema),
    fields: normalizeStringArray(body.fields),
    authContext: normalizeObject(body.auth_context || body.authContext) || null,
    timeoutMs: clampTimeoutMs(body.timeout_ms || body.timeoutMs, 6000),
  };
}

function normalizeStreamKind(rawKind, sourceURL = '', streamChain = '') {
  const text = normalizeText(rawKind).toLowerCase();
  if (text === 'evm-rpc' || streamChain) return 'evm-rpc';
  if (text === 'cex-market') return 'cex-market';
  if (text === 'polymarket-market') return 'polymarket-market';
  if (text === 'url' || text === 'ws' || text === 'websocket') return 'url';
  if (isWebSocketSourceURL(sourceURL) || isHTTPSourceURL(sourceURL)) return 'url';
  return 'url';
}

function clampTimeoutMs(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1000, Math.min(parsed, 15000));
}

function isHTTPSourceURL(value) {
  return /^https?:\/\//i.test(normalizeText(value));
}

function isWebSocketSourceURL(value) {
  return /^wss?:\/\//i.test(normalizeText(value));
}

export function parseResponseSchemaFields(rawSchema) {
  const text = normalizeText(rawSchema);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const fields = flattenPayloadFields(parsed);
    return fields.length > 0 ? Array.from(new Set(fields)) : [];
  } catch {
    return [];
  }
}

export async function sampleStreamPayload(input) {
  if (input.streamKind === 'evm-rpc') return sampleEVMRPCPayload(input);
  if (input.streamKind === 'cex-market') return sampleCEXMarketPayload(input);
  if (input.streamKind === 'polymarket-market') return samplePolymarketMarketPayload(input);
  if (isWebSocketSourceURL(input.sourceURL)) return sampleWebSocketPayload(input.sourceURL, input.timeoutMs);
  if (isHTTPSourceURL(input.sourceURL)) return sampleHTTPPayload(input.sourceURL, input.timeoutMs);
  throw new Error('unsupported stream source');
}

async function sampleHTTPPayload(sourceURL, timeoutMs) {
  const response = await fetch(sourceURL, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`status ${response.status}: ${trimSnippet(text, 160)}`);
  }
  return parseSamplePayload(text);
}

async function sampleWebSocketPayload(sourceURL, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(sourceURL);

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      } catch {
        // Ignore close errors for one-shot sampling.
      }
      handler(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('timed out waiting for websocket payload'));
    }, timeoutMs);

    socket.addEventListener('message', async (event) => {
      try {
        const text = await normalizeWebSocketMessageData(event.data);
        finish(resolve, parseSamplePayload(text));
      } catch (error) {
        finish(reject, error);
      }
    });

    socket.addEventListener('error', () => {
      finish(reject, new Error('websocket sample failed'));
    });

    socket.addEventListener('close', (event) => {
      if (!settled) {
        finish(reject, new Error(`websocket closed before payload (${event.code})`));
      }
    });
  });
}

async function normalizeWebSocketMessageData(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('utf8');
  }
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return String(data ?? '');
}

async function sampleEVMRPCPayload(input) {
  const rpcURL = resolvePreviewEVMRPCURL(input.streamChain, input.sourceURL, input.authContext);
  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: input.streamMethod,
    params: parsePreviewRPCParams(input.streamParamsJSON),
  };

  const response = await fetch(rpcURL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`rpc status ${response.status}: ${trimSnippet(text, 160)}`);
  }

  const rpcResponse = parseSamplePayload(text);
  if (!rpcResponse || typeof rpcResponse !== 'object' || Array.isArray(rpcResponse)) {
    throw new Error('unexpected rpc response payload');
  }
  if (rpcResponse.error && typeof rpcResponse.error === 'object') {
    throw new Error(normalizeText(rpcResponse.error.message) || 'rpc error');
  }

  const payload = {
    result: rpcResponse.result,
    method: input.streamMethod,
    chain: input.streamChain,
  };
  if (typeof rpcResponse.result === 'string' && /^0x[0-9a-f]+$/i.test(rpcResponse.result)) {
    try {
      payload.result_dec = BigInt(rpcResponse.result).toString();
    } catch {
      // Keep hex string only when BigInt parsing fails.
    }
  }
  return payload;
}

function normalizeExchangeName(rawValue) {
  const text = normalizeText(rawValue).toLowerCase();
  if (text === 'gate' || text === 'gate.io') return 'gateio';
  return text;
}

function parseMarketNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitMarketSymbol(rawValue) {
  const compact = normalizeText(rawValue).toUpperCase().replace(/[\s/_-]+/g, '');
  if (!compact) return null;
  const quoteAssets = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'DAI', 'USD', 'BTC', 'ETH', 'EUR', 'KRW'];
  for (const quote of quoteAssets) {
    if (compact.length > quote.length && compact.endsWith(quote)) {
      return {
        base: compact.slice(0, compact.length - quote.length),
        quote,
      };
    }
  }
  return { base: compact, quote: '' };
}

function formatExchangeSymbol(exchange, rawValue) {
  const parts = splitMarketSymbol(rawValue);
  if (!parts?.base) return normalizeText(rawValue);
  const { base, quote } = parts;
  switch (exchange) {
    case 'okx':
    case 'kucoin':
      return quote ? `${base}-${quote}` : base;
    case 'gateio':
      return quote ? `${base}_${quote}` : base;
    default:
      return `${base}${quote}`;
  }
}

function buildMarketSnapshot(base = {}) {
  const bidPrice = parseMarketNumber(base.bidPrice);
  const askPrice = parseMarketNumber(base.askPrice);
  const lastPrice = parseMarketNumber(base.lastPrice) || (bidPrice > 0 && askPrice > 0 ? (bidPrice + askPrice) / 2 : bidPrice || askPrice);
  const midPrice = bidPrice > 0 && askPrice > 0 ? (bidPrice + askPrice) / 2 : lastPrice;
  const spread = bidPrice > 0 && askPrice > 0 ? askPrice - bidPrice : 0;
  return {
    ...base,
    lastPrice,
    midPrice,
    bidPrice,
    askPrice,
    spread,
    eventTime: base.eventTime || Date.now(),
  };
}

async function sampleCEXMarketPayload(input) {
  const exchange = normalizeExchangeName(input.exchange);
  const symbol = formatExchangeSymbol(exchange, input.symbol);
  if (!exchange) throw new Error('exchange is required for cex-market stream');
  if (!symbol) throw new Error('symbol is required for cex-market stream');

  switch (exchange) {
    case 'binance': {
      const payload = await sampleHTTPPayload(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: payload.lastPrice,
        bidPrice: payload.bidPrice,
        askPrice: payload.askPrice,
        bidSize: payload.bidQty,
        askSize: payload.askQty,
        volume: payload.volume,
        quoteVolume: payload.quoteVolume,
        highPrice: payload.highPrice,
        lowPrice: payload.lowPrice,
        openPrice: payload.openPrice,
        eventTime: parseMarketNumber(payload.closeTime) || parseMarketNumber(payload.eventTime),
      });
    }
    case 'bybit': {
      const payload = await sampleHTTPPayload(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.result?.list) ? payload.result.list[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.lastPrice,
        bidPrice: row.bid1Price,
        askPrice: row.ask1Price,
        bidSize: row.bid1Size,
        askSize: row.ask1Size,
        volume: row.volume24h,
        quoteVolume: row.turnover24h,
        highPrice: row.highPrice24h,
        lowPrice: row.lowPrice24h,
        eventTime: parseMarketNumber(payload?.time) || Date.now(),
      });
    }
    case 'okx': {
      const payload = await sampleHTTPPayload(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.data) ? payload.data[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.last,
        bidPrice: row.bidPx,
        askPrice: row.askPx,
        bidSize: row.bidSz,
        askSize: row.askSz,
        volume: row.vol24h,
        quoteVolume: row.volCcy24h,
        highPrice: row.high24h,
        lowPrice: row.low24h,
        eventTime: parseMarketNumber(row.ts),
      });
    }
    case 'kucoin': {
      const payload = await sampleHTTPPayload(`https://api.kucoin.com/api/ua/v1/market/ticker?tradeType=SPOT&symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.data?.list) ? payload.data.list[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.lastPrice,
        bidPrice: row.bestBidPrice,
        askPrice: row.bestAskPrice,
        bidSize: row.bestBidSize,
        askSize: row.bestAskSize,
        volume: row.baseVolume,
        quoteVolume: row.quoteVolume,
        highPrice: row.high,
        lowPrice: row.low,
        openPrice: row.open,
        eventTime: Math.round(parseMarketNumber(row.ts) / 1e6) || parseMarketNumber(row.M),
      });
    }
    case 'bitget': {
      const payload = await sampleHTTPPayload(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.data) ? payload.data[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.lastPr,
        bidPrice: row.bidPr,
        askPrice: row.askPr,
        bidSize: row.bidSz,
        askSize: row.askSz,
        volume: row.baseVolume,
        quoteVolume: row.quoteVolume || row.usdtVolume,
        highPrice: row.high24h,
        lowPrice: row.low24h,
        openPrice: row.open,
        eventTime: parseMarketNumber(row.ts) || parseMarketNumber(payload?.requestTime),
      });
    }
    case 'gateio': {
      const payload = await sampleHTTPPayload(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload) ? payload[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.last,
        bidPrice: row.highest_bid,
        askPrice: row.lowest_ask,
        bidSize: row.highest_size,
        askSize: row.lowest_size,
        volume: row.base_volume,
        quoteVolume: row.quote_volume,
        highPrice: row.high_24h || row.high24h,
        lowPrice: row.low_24h || row.low24h,
        eventTime: Date.now(),
      });
    }
    default:
      throw new Error(`unsupported cex exchange: ${exchange}`);
  }
}

async function samplePolymarketMarketPayload(input) {
  const tokenId = normalizeText(input.tokenId);
  if (!tokenId) throw new Error('token_id is required for polymarket stream');
  const payload = await sampleHTTPPayload(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`, input.timeoutMs);
  const bestBid = Array.isArray(payload?.bids) ? payload.bids[0] || {} : {};
  const bestAsk = Array.isArray(payload?.asks) ? payload.asks[0] || {} : {};
  const bidPrice = parseMarketNumber(bestBid.price);
  const askPrice = parseMarketNumber(bestAsk.price);
  const bidSize = parseMarketNumber(bestBid.size);
  const askSize = parseMarketNumber(bestAsk.size);
  const lastPrice = parseMarketNumber(payload?.last_trade_price) || (bidPrice > 0 && askPrice > 0 ? (bidPrice + askPrice) / 2 : bidPrice || askPrice);
  return buildMarketSnapshot({
    exchange: 'polymarket',
    tokenId,
    marketId: normalizeText(input.marketId) || normalizeText(payload?.market),
    lastPrice,
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    liquidity: bidPrice * bidSize + askPrice * askSize,
    eventTime: parseMarketNumber(payload?.timestamp) || Date.now(),
  });
}

function resolvePreviewEVMRPCURL(streamChain, sourceURL, authContext) {
  const direct = normalizeText(sourceURL);
  if (direct) return direct;

  const evm = normalizeObject(authContext?.evm) || {};
  const authRPCURL = normalizeText(evm.rpcUrl);
  if (authRPCURL) return authRPCURL;

  const chainEnvKey = toEnvKey(streamChain);
  const envRPCURL = normalizeText(process.env[`${chainEnvKey}_RPC_URL`]) || normalizeText(process.env.EVM_RPC_URL);
  if (envRPCURL) return envRPCURL;

  const alchemyKey = normalizeText(evm.alchemyApiKey)
    || normalizeText(process.env[`${chainEnvKey}_ALCHEMY_API_KEY`])
    || normalizeText(process.env.ALCHEMY_API_KEY);
  if (!alchemyKey) {
    throw new Error('evm rpc url or alchemy api key is required');
  }

  const chainSlug = normalizeChainSlug(streamChain);
  if (!chainSlug) {
    throw new Error('unsupported evm chain slug');
  }
  return `https://${chainSlug}.g.alchemy.com/v2/${alchemyKey}`;
}

function normalizeChainSlug(raw) {
  const text = normalizeText(raw).toLowerCase().replace(/_/g, '-');
  if (!text) return '';
  if (EXPLORER_API_ENDPOINTS[text]) return text;
  return CHAIN_ALIASES[text] || '';
}

function toEnvKey(rawValue) {
  return normalizeText(rawValue).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function parsePreviewRPCParams(rawValue) {
  const text = normalizeText(rawValue);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function parseSamplePayload(rawValue) {
  const text = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
  if (!text) throw new Error('empty payload');
  try {
    return JSON.parse(text);
  } catch {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? { value: numeric } : { value: text };
  }
}

function flattenPayloadFields(value, prefix = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) return prefix ? [prefix] : [];
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return flattenPayloadFields(first, prefix);
    }
    return prefix ? [prefix] : [];
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return prefix ? [prefix] : [];
    return keys.flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}::${key}` : key;
      return flattenPayloadFields(value[key], nextPrefix);
    });
  }

  return prefix ? [prefix] : [];
}

export function derivePayloadFields(payload) {
  const fields = flattenPayloadFields(payload);
  return fields.length > 0 ? Array.from(new Set(fields)) : ['value'];
}

export function buildPreviewValues(payload, fields) {
  const output = {};
  const normalizedFields = fields.length > 0 ? fields : derivePayloadFields(payload);
  normalizedFields.forEach((field) => {
    output[field] = extractPayloadField(payload, field);
  });
  return output;
}

function extractPayloadField(payload, field) {
  if (field === 'value') {
    return normalizePreviewValue(payload?.value !== undefined ? payload.value : payload);
  }

  const path = parsePreviewFieldPath(field);
  const preserveAsText = shouldPreservePreviewText(path[path.length - 1]);
  const direct = lookupPayloadPath(payload, path);
  if (direct.found) {
    return preserveAsText ? String(direct.value ?? '') : normalizePreviewValue(direct.value);
  }
  if (payload && typeof payload === 'object' && payload.data !== undefined) {
    const nested = lookupPayloadPath(payload.data, path);
    if (nested.found) {
      return preserveAsText ? String(nested.value ?? '') : normalizePreviewValue(nested.value);
    }
  }
  return null;
}

function parsePreviewFieldPath(field) {
  const text = normalizeText(field);
  if (!text) return ['value'];
  if (text.includes('::')) return text.split('::').map((part) => normalizeText(part)).filter(Boolean);
  if (text.includes('.')) return text.split('.').map((part) => normalizeText(part)).filter(Boolean);
  return [text];
}

function lookupPayloadPath(payload, path) {
  let current = payload;
  for (const rawSegment of path) {
    const segment = normalizeText(rawSegment);
    if (!segment) return { found: false, value: null };
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: null };
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return { found: false, value: null };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function normalizePreviewValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(numeric)) {
      return numeric;
    }
    return value;
  }
  return value ?? null;
}

function shouldPreservePreviewText(field) {
  return ['exchange', 'symbol', 'marketId', 'tokenId'].includes(normalizeText(field));
}
