import {
  DEFAULT_EXCHANGE_CONNECTIONS,
  DEFAULT_CEX_TRADE_EXCHANGE,
  SUPPORTED_CEX_TRADE_EXCHANGES,
  joinExchangeNames,
} from "@/shared/api/exchangeCatalog.mjs";
import {
  AI_STRATEGY_TEMPLATES,
  MARKET_ROWS,
  STRATEGY_BLOCKS,
  STRATEGY_CODE,
  type StrategyTemplate,
} from "@/features/home/mock-data/home";
import type { ExchangeConnection, ExchangeFormState } from "../types/homeTypes";

export {
  AI_STRATEGY_TEMPLATES,
  MARKET_ROWS,
  STRATEGY_BLOCKS,
  STRATEGY_CODE,
  type StrategyTemplate,
};

export const NAV_ITEMS = [
  { id: "create", label: "Create Strategy", shortLabel: "CS", active: true },
  { id: "portfolio", label: "Portfolio", shortLabel: "PF" },
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
  "Connect an exchange",
  "Generate a strategy",
];

export const MAIN_VIEW_TABS = [
  { id: "advanced" as const, label: "Advanced View" },
  { id: "api-data" as const, label: "Data" },
  { id: "code" as const, label: "Code View" },
];

export { DEFAULT_CEX_TRADE_EXCHANGE };
