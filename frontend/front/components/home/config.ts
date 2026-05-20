import {
  Bell,
  Bot,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  Code2,
  Crosshair,
  Folder,
  Home as HomeIcon,
  Network,
  Plus,
  Rocket,
  RotateCcw,
  Settings,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  DEFAULT_EXCHANGE_CONNECTIONS,
  DEFAULT_CEX_TRADE_EXCHANGE,
  SUPPORTED_CEX_TRADE_EXCHANGES,
  joinExchangeNames,
} from "@/src/lib/exchangeCatalog.mjs";
import {
  DEFAULT_STRATEGY_TEMPLATES as AI_STRATEGY_TEMPLATES,
  buildStrategyCodeFromTemplate,
  createEasyViewFromStrategyCode,
  type EasyViewModel,
} from "@/lib/easyViewAgent";
import type { ExchangeConnection, ExchangeFormState, MarketRow, StrategyBlock } from "./types";

export const NAV_ITEMS = [
  { id: "home", label: "홈", icon: HomeIcon },
  { id: "create", label: "전략 만들기", icon: Plus, active: true },
  { id: "library", label: "전략 라이브러리", icon: Boxes },
  { id: "workspace", label: "워크스페이스", icon: BriefcaseBusiness },
  { id: "tuning", label: "튜닝 / 백테스트", icon: Network },
  { id: "deploy", label: "실행 / 봇", icon: Bot },
  { id: "portfolio", label: "포트폴리오", icon: Folder },
  { id: "risk", label: "리스크 알림", icon: Bell },
  { id: "settings", label: "설정", icon: Settings },
];

export const STRATEGY_BLOCKS: StrategyBlock[] = [
  {
    id: "init",
    index: 1,
    title: "전략 시작",
    subtitle: "Init",
    description: "거래소 연결과 기본 잔고를 확인하고 전략 실행 컨텍스트를 만듭니다.",
    status: "complete",
    kind: "start",
    x: 22,
    y: 86,
    w: 124,
    icon: Rocket,
    color: "violet",
    params: [
      { key: "capital", label: "초기 자본(USDT)", value: "10,000", helper: "전략이 사용할 기준 자본" },
      { key: "mode", label: "실행 모드", value: "드라이런", helper: "실전 실행 전 모의 주문으로 검증", options: ["드라이런", "실전"] },
    ],
  },
  {
    id: "condition",
    index: 2,
    title: "가격차 진입 조건 충족",
    subtitle: "Basis check",
    description: "현물과 선물 가격차가 설정한 기준 이상 벌어졌는지 감시합니다.",
    status: "running",
    kind: "condition",
    x: 176,
    y: 90,
    w: 104,
    icon: Crosshair,
    color: "emerald",
    params: [
      { key: "entryGap", label: "진입 가격차(%)", value: "0.50", unit: "%", helper: "이상 벌어지면 진입" },
      { key: "exitGap", label: "종료 가격차(%)", value: "0.10", unit: "%", helper: "이하로 줄어들면 종료" },
      { key: "confirm", label: "확인 캔들", value: "2", helper: "조건 유지 확인 개수" },
    ],
  },
  {
    id: "spot-buy",
    index: 3,
    title: "XRP 현물 매수",
    subtitle: "가격차 진입 조건 충족",
    description: "현물 XRP를 매수해 차익거래의 롱 포지션을 만듭니다.",
    status: "watching",
    kind: "trade",
    x: 320,
    y: 62,
    w: 154,
    icon: TrendingUp,
    color: "blue",
    params: [
      { key: "spotSize", label: "투입금(USDT)", value: "1,000", helper: "현물 매수 주문 금액" },
      { key: "spotSlippage", label: "슬리피지 허용", value: "0.08", unit: "%", helper: "시장가 체결 허용 범위" },
      { key: "orderType", label: "주문 방식", value: "Market", helper: "현물 주문 방식", options: ["Market", "Limit"] },
    ],
  },
  {
    id: "future-short",
    index: 4,
    title: "XRP 선물 숏",
    subtitle: "헤지 포지션 실행",
    description: "동일 규모의 선물 숏을 열어 가격 방향 리스크를 상쇄합니다.",
    status: "watching",
    kind: "hedge",
    x: 516,
    y: 62,
    w: 154,
    icon: TrendingDown,
    color: "sky",
    params: [
      { key: "leverage", label: "레버리지", value: "1x", helper: "선물 포지션 레버리지", options: ["1x", "2x", "3x"] },
      { key: "hedgeRatio", label: "헤지 비율", value: "100", unit: "%", helper: "현물 대비 선물 노출 비율" },
    ],
  },
  {
    id: "rebalance",
    index: 5,
    title: "포지션 유지",
    subtitle: "리밸런싱 및 유지",
    description: "가격차와 포지션 비중을 계속 감시하며 필요 시 재조정합니다.",
    status: "ready",
    kind: "rebalance",
    x: 382,
    y: 162,
    w: 166,
    icon: RotateCcw,
    color: "blue",
    params: [
      { key: "rebalanceGap", label: "리밸런싱 기준", value: "0.20", unit: "%", helper: "비중 차이가 커지면 조정" },
      { key: "checkInterval", label: "확인 주기", value: "1분", helper: "포지션 상태 점검 주기", options: ["10초", "1분", "5분"] },
    ],
  },
  {
    id: "risk",
    index: 6,
    title: "손실 제한 시 종료",
    subtitle: "Risk stop",
    description: "허용 손실을 넘으면 즉시 종료 단계로 넘깁니다.",
    status: "blocked",
    kind: "risk",
    x: 446,
    y: 232,
    w: 104,
    icon: ShieldAlert,
    color: "rose",
    params: [
      { key: "lossLimit", label: "손실 제한(%)", value: "1.00", unit: "%", helper: "총 손실 허용 한도" },
      { key: "maxLatency", label: "응답 지연 제한", value: "800", unit: "ms", helper: "거래소 응답 지연 제한" },
    ],
  },
  {
    id: "exit",
    index: 7,
    title: "종료",
    subtitle: "포지션 청산 및 종료",
    description: "현물과 선물 포지션을 동시에 닫고 손익을 기록합니다.",
    status: "ready",
    kind: "exit",
    x: 516,
    y: 268,
    w: 154,
    icon: CheckCircle2,
    color: "rose",
    params: [
      { key: "closeType", label: "청산 방식", value: "동시 청산", helper: "현물과 선물 종료 방식", options: ["동시 청산", "선물 우선", "현물 우선"] },
      { key: "report", label: "리포트 생성", value: "켜짐", helper: "실행 종료 후 요약 저장", options: ["켜짐", "꺼짐"] },
    ],
  },
];

export const MARKET_ROWS: MarketRow[] = [
  { symbol: "BTCUSDT", price: "67,245.8", change: "+1.24%", tone: "up", icon: "₿" },
  { symbol: "ETHUSDT", price: "3,285.6", change: "+0.82%", tone: "up", icon: "Ξ" },
  { symbol: "XRPUSDT", price: "0.5321", change: "+0.45%", tone: "up", icon: "X" },
  { symbol: "XRPUSDT.P", price: "0.5303", change: "-0.05%", tone: "down", icon: "P" },
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
  "백테스트 실행하기",
  "소액으로 드라이런 시작하기",
];

export const MAIN_VIEW_TABS = [
  { id: "easy" as const, label: "쉬운 보기", icon: Boxes },
  { id: "advanced" as const, label: "고급 보기", icon: Network },
  { id: "code" as const, label: "코드 보기", icon: Code2 },
];

export const STRATEGY_CODE = `strategy "XRP 현물-선물 가격차" {
  stream spot = binance.spot("XRPUSDT")
  stream perp = binance.perp("XRPUSDT.P")

  basis = (perp.price - spot.price) / spot.price * 100

  when basis > 0.50 {
    buy spot with 1000 USDT
    short perp with 1x hedge
  }

  while position.open {
    rebalance if exposure_gap > 0.20
    close if basis < 0.10 or pnl < -1.00
  }
}`;

export const EMPTY_EASY_VIEW: EasyViewModel = {
  title: "새 전략",
  summary: "아직 생성된 전략이 없습니다. AI에게 전략을 요청하거나 템플릿을 선택해 시작하세요.",
  strategyType: "미설정",
  timeframe: "미설정",
  lastModified: "생성 전",
  code: "",
  canvasWidth: 1280,
  canvasHeight: 780,
  nodes: [],
  edges: [],
};

export const INITIAL_TEMPLATE = AI_STRATEGY_TEMPLATES[0];
export const INITIAL_STRATEGY_CODE = buildStrategyCodeFromTemplate(INITIAL_TEMPLATE);
export const INITIAL_EASY_VIEW = createEasyViewFromStrategyCode(INITIAL_STRATEGY_CODE, INITIAL_TEMPLATE);
export const STRATEGY_BUILDER_STORAGE_KEY = "thirdeye.strategy-builder-state.v1";
export { AI_STRATEGY_TEMPLATES };
export { DEFAULT_CEX_TRADE_EXCHANGE };
