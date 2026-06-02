import {
  CheckCircle2,
  Crosshair,
  Rocket,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { MarketRow, StrategyBlock } from "@/components/home/types";

export type StrategyTemplate = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  tags: string[];
};

export const AI_STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "basis",
    title: "Basis 차익거래",
    summary: "현물-선물 가격차가 벌어질 때 델타 중립 포지션을 엽니다.",
    prompt: "BTC 현물과 선물 가격차가 0.5% 이상 벌어지면 현물을 매수하고 선물을 숏으로 헤지해줘",
    tags: ["BTC", "Hedge", "1m"],
  },
  {
    id: "trend",
    title: "추세 추종",
    summary: "이동평균 돌파와 거래량 증가를 함께 확인합니다.",
    prompt: "BTC가 20MA를 상향 돌파하고 거래량이 평균보다 높으면 진입하는 추세 추종 전략을 만들어줘",
    tags: ["BTC", "MA", "Volume"],
  },
  {
    id: "funding",
    title: "펀딩비 수익",
    summary: "펀딩비와 베이시스를 함께 감시해 진입합니다.",
    prompt: "펀딩비가 높고 베이시스가 안정적일 때 시장 중립 포지션을 잡는 전략을 만들어줘",
    tags: ["Funding", "Neutral", "Perp"],
  },
  {
    id: "dca",
    title: "ETH DCA",
    summary: "정해진 간격으로 분할 매수하고 리스크 조건에서 중단합니다.",
    prompt: "ETH를 4시간마다 분할 매수하고 손실 제한 조건이 오면 중단하는 DCA 전략을 만들어줘",
    tags: ["ETH", "DCA", "4h"],
  },
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
    title: "BTC 현물 매수",
    subtitle: "가격차 진입 조건 충족",
    description: "현물 BTC를 매수해 차익거래의 롱 포지션을 만듭니다.",
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
    title: "BTC 선물 숏",
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
  { symbol: "SOLUSDT", price: "152.4", change: "+0.45%", tone: "up", icon: "S" },
  { symbol: "BNBUSDT", price: "610.2", change: "-0.05%", tone: "down", icon: "B" },
];

export const STRATEGY_CODE = `strategy "BTC 현물-선물 가격차" {
  stream spot = binance.spot("BTCUSDT")
  stream perp = binance.perp("BTCUSDT.P")

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
