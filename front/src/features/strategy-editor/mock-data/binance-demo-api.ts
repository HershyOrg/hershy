import type { BlockData, StreamingNodeData } from "@/features/strategy-editor/types/editorTypes";

const STREAM_BASE_URL = "wss://stream.binance.com:9443";
const WS_API_BASE_URL = "wss://ws-api.binance.com:443/ws-api/v3";
const FUTURES_STREAM_BASE_URL = "wss://fstream.binance.com";
const SPOT_REST_BASE_URL = "https://api.binance.com";
const FUTURES_REST_BASE_URL = "https://fapi.binance.com";

const DUMMY_TIMESTAMP = "1714435200000";
const DUMMY_SPOT_SIGNATURE = "demo_spot_hmac_sha256_signature_2026_04_30";
const DUMMY_FUTURES_SIGNATURE = "demo_futures_hmac_sha256_signature_2026_04_30";

export const BINANCE_DEMO_TOKENS = {
  spotApiKey: "demo_spot_api_key_2026_04_30",
  spotUserDataSubscriptionToken: "demo_spot_user_stream_subscription_2026_04_30",
  futuresListenKey: "demo_futures_listen_key_2026_04_30",
} as const;

const toStreamSymbol = (symbol: string) => symbol.toLowerCase().replace(/\//g, "");

export const getBinanceSpotTickerRestUrl = (symbol: string) =>
  `${SPOT_REST_BASE_URL}/api/v3/ticker/price?symbol=${symbol.replace(/\//g, "")}`;

export const getBinanceSpotAccountRestUrl = () =>
  `${SPOT_REST_BASE_URL}/api/v3/account?omitZeroBalances=true&timestamp=${DUMMY_TIMESTAMP}&signature=${DUMMY_SPOT_SIGNATURE}`;

export const getBinanceFuturesAccountRestUrl = () =>
  `${FUTURES_REST_BASE_URL}/fapi/v2/account?timestamp=${DUMMY_TIMESTAMP}&signature=${DUMMY_FUTURES_SIGNATURE}`;

export const getBinanceFuturesListenKeyRestUrl = () =>
  `${FUTURES_REST_BASE_URL}/fapi/v1/listenKey`;

export const getBinanceSpotTickerStreamUrl = (symbols: string[]) =>
  `${STREAM_BASE_URL}/stream?streams=${symbols
    .map((symbol) => `${toStreamSymbol(symbol)}@ticker`)
    .join("/")}`;

export const getBinanceFuturesMarkPriceStreamUrl = (symbols: string[]) =>
  `${FUTURES_STREAM_BASE_URL}/stream?streams=${symbols
    .map((symbol) => `${toStreamSymbol(symbol)}@markPrice`)
    .join("/")}`;

export const getBinanceFuturesUserDataStreamUrl = (
  listenKey = BINANCE_DEMO_TOKENS.futuresListenKey,
) => `${FUTURES_STREAM_BASE_URL}/private/ws/${listenKey}`;

type StreamDataOptions = {
  label: string;
  outputBlocks: BlockData[];
};

export const createBinanceSpotPriceStreamData = ({
  label,
  outputBlocks,
  symbols,
}: StreamDataOptions & {
  symbols: string[];
}): StreamingNodeData => ({
  label,
  method: "WEBSOCKET",
  url: getBinanceSpotTickerStreamUrl(symbols),
  isActive: true,
  outputBlocks,
  isExpanded: false,
  apiReference: "GET /api/v3/ticker/price + WebSocket <symbol>@ticker",
  authMode: "NONE",
  requestHint: `REST fallback: ${getBinanceSpotTickerRestUrl(symbols[0])}`,
});

export const createBinanceSpotBalanceStreamData = ({
  label,
  outputBlocks,
}: StreamDataOptions): StreamingNodeData => ({
  label,
  method: "WEBSOCKET",
  url: WS_API_BASE_URL,
  isActive: true,
  outputBlocks,
  isExpanded: false,
  apiReference: "GET /api/v3/account + userDataStream.subscribe.signature",
  authMode: "USER_STREAM",
  authToken: BINANCE_DEMO_TOKENS.spotUserDataSubscriptionToken,
  requestHint:
    `Header X-MBX-APIKEY=${BINANCE_DEMO_TOKENS.spotApiKey} | ` +
    `REST snapshot: ${getBinanceSpotAccountRestUrl()}`,
});

export const createBinanceFuturesFundingStreamData = ({
  label,
  outputBlocks,
  symbols,
}: StreamDataOptions & {
  symbols: string[];
}): StreamingNodeData => ({
  label,
  method: "WEBSOCKET",
  url: getBinanceFuturesMarkPriceStreamUrl(symbols),
  isActive: true,
  outputBlocks,
  isExpanded: false,
  apiReference: "Futures markPrice stream",
  authMode: "NONE",
  requestHint: "Funding rate and mark price are streamed from the futures markPrice feed.",
});

export const createBinanceFuturesUserDataStreamData = ({
  label,
  outputBlocks,
}: StreamDataOptions): StreamingNodeData => ({
  label,
  method: "WEBSOCKET",
  url: getBinanceFuturesUserDataStreamUrl(),
  isActive: true,
  outputBlocks,
  isExpanded: false,
  apiReference: "POST /fapi/v1/listenKey + GET /fapi/v2/account",
  authMode: "USER_STREAM",
  authToken: BINANCE_DEMO_TOKENS.futuresListenKey,
  requestHint:
    `Bootstrap: ${getBinanceFuturesListenKeyRestUrl()} | ` +
    `Snapshot: ${getBinanceFuturesAccountRestUrl()}`,
});
