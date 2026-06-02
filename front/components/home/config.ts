import {
  DEFAULT_EXCHANGE_CONNECTIONS,
  DEFAULT_CEX_TRADE_EXCHANGE,
  SUPPORTED_CEX_TRADE_EXCHANGES,
  joinExchangeNames,
} from "@/lib/exchangeCatalog.mjs";
import {
  AI_STRATEGY_TEMPLATES,
  MARKET_ROWS,
  STRATEGY_BLOCKS,
  STRATEGY_CODE,
  type StrategyTemplate,
} from "@/mock-data/client/home";
import type { ExchangeConnection, ExchangeFormState } from "./types";

export {
  AI_STRATEGY_TEMPLATES,
  MARKET_ROWS,
  STRATEGY_BLOCKS,
  STRATEGY_CODE,
  type StrategyTemplate,
};

export const NAV_ITEMS = [
  { id: "create", label: "전략 만들기", shortLabel: "전", active: true },
  { id: "portfolio", label: "포트폴리오", shortLabel: "포" },
];

export const EXCHANGE_CONNECTIONS: ExchangeConnection[] = DEFAULT_EXCHANGE_CONNECTIONS as ExchangeConnection[];
export const EXCHANGE_CONNECTION_NAMES = joinExchangeNames(EXCHANGE_CONNECTIONS);
export const CEX_TRADE_EXCHANGE_NAMES = joinExchangeNames(SUPPORTED_CEX_TRADE_EXCHANGES);

export const createEmptyExchangeForm = (): ExchangeFormState => ({
  id: "",
  name: "",
  type: "CEX",
  apiUrl: "",
  wsUrl: "",
  rpcUrl: "",
  marketDataUrl: "",
  apiKey: "",
  apiSecret: "",
  apiPassphrase: "",
  privateKey: "",
  funder: "",
  chainId: "",
});

export const buildExchangeFormFromConnection = (connection?: ExchangeConnection | null): ExchangeFormState => {
  if (!connection) {
    return createEmptyExchangeForm();
  }

  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    apiUrl: connection.apiUrl || connection.restUrl || "",
    wsUrl: connection.wsUrl || "",
    rpcUrl: connection.rpcUrl || "",
    marketDataUrl: connection.marketDataUrl || "",
    apiKey: "",
    apiSecret: "",
    apiPassphrase: "",
    privateKey: "",
    funder: connection.credentials?.funder || "",
    chainId: connection.credentials?.chainId || (connection.id === "polymarket" ? "137" : ""),
  };
};

export const GUIDE_ITEMS = [
  "거래소 연결하기",
  "전략 생성하기",
];

export const MAIN_VIEW_TABS = [
  { id: "advanced" as const, label: "고급 보기" },
  { id: "code" as const, label: "코드 보기" },
];

export const STRATEGY_BUILDER_STORAGE_KEY = "thirdeye.strategy-builder-state.v2";
export { DEFAULT_CEX_TRADE_EXCHANGE };
