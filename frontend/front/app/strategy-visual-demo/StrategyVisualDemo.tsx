"use client";

import { useState, type CSSProperties } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Boxes,
  BrainCircuit,
  CircleDollarSign,
  Eye,
  FileSearch,
  Filter,
  GitBranch,
  Gauge,
  Layers3,
  Network,
  Radar,
  Route,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import styles from "./StrategyVisualDemo.module.css";

type ViewMode = "easy" | "advanced";
type NodeKind =
  | "entity"
  | "attribute"
  | "relation"
  | "hierarchy"
  | "dependency"
  | "flow"
  | "time"
  | "constraint"
  | "evidence";
type SubstrateId = "data" | "compute" | "predicate" | "action" | "risk";
type EdgeKind = "data" | "control" | "risk" | "evidence" | "flow";
type NodeStatus = "ready" | "watching" | "active" | "guarded" | "complete";

type SemanticNode = {
  id: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  plainLanguage: string;
  kind: NodeKind;
  substrate: SubstrateId;
  status: NodeStatus;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
  inputs: string[];
  outputs: string[];
  params: Array<{ label: string; value: string }>;
  evidence: string[];
  userHint: string;
};

type SemanticEdge = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  strength: "low" | "medium" | "high";
  labelOffset?: number;
};

type EasyNode = {
  id: string;
  title: string;
  subtitle: string;
  metric: string;
  body: string;
  icon: LucideIcon;
  x: number;
  y: number;
  w: number;
  h: number;
  relatedNodeIds: string[];
};

type EasyEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  tone: EdgeKind;
};

type Substrate = {
  id: SubstrateId;
  label: string;
  helper: string;
  x: number;
  w: number;
};

const SUBSTRATES: Substrate[] = [
  { id: "data", label: "DATA", helper: "시장, 시간, 근거", x: 34, w: 214 },
  { id: "compute", label: "COMPUTE", helper: "계산과 특징량", x: 276, w: 214 },
  { id: "predicate", label: "PREDICATE", helper: "판단과 제약", x: 518, w: 214 },
  { id: "action", label: "ACTION", helper: "주문과 전이", x: 760, w: 214 },
  { id: "risk", label: "RISK", helper: "방어와 검증", x: 1002, w: 214 },
];

const MODEL_TAGS = [
  "Entity / Concept",
  "Attribute",
  "Relation",
  "Hierarchy",
  "Dependency",
  "Flow",
  "Time",
  "Constraint",
  "Evidence",
];

const KIND_LABELS: Record<NodeKind, string> = {
  entity: "개체",
  attribute: "속성",
  relation: "관계",
  hierarchy: "그룹",
  dependency: "의존성",
  flow: "흐름",
  time: "시간",
  constraint: "제약",
  evidence: "근거",
};

const STATUS_LABELS: Record<NodeStatus, string> = {
  ready: "준비",
  watching: "감시",
  active: "작동",
  guarded: "보호",
  complete: "완료",
};

const semanticNodes: SemanticNode[] = [
  {
    id: "market-feed",
    title: "Binance BTCUSDT Stream",
    shortTitle: "가격 스트림",
    subtitle: "1초 가격, 거래량, 체결 강도",
    plainLanguage: "전략이 가장 먼저 보는 실시간 시장 온도계입니다.",
    kind: "entity",
    substrate: "data",
    status: "watching",
    confidence: 92,
    x: 58,
    y: 132,
    w: 168,
    h: 94,
    inputs: ["WebSocket ticker", "Trade tape"],
    outputs: ["price.tick", "volume.1s"],
    params: [
      { label: "symbol", value: "BTCUSDT" },
      { label: "cadence", value: "1s" },
    ],
    evidence: ["거래소 WS heartbeat 정상", "최근 120초 누락 없음"],
    userHint: "데이터가 멈추면 아래 계산 노드는 자동으로 보류됩니다.",
  },
  {
    id: "orderbook-feed",
    title: "Coinbase L3 Orderbook",
    shortTitle: "호가장",
    subtitle: "상위 호가와 유동성 깊이",
    plainLanguage: "주문이 미끄러질 가능성을 미리 보는 현미경입니다.",
    kind: "entity",
    substrate: "data",
    status: "watching",
    confidence: 88,
    x: 58,
    y: 272,
    w: 168,
    h: 94,
    inputs: ["L3 diff stream", "Snapshot"],
    outputs: ["book.depth", "spread.bps"],
    params: [
      { label: "depth", value: "20 levels" },
      { label: "venue", value: "Coinbase" },
    ],
    evidence: ["snapshot drift 0.02%", "spread median 1.8 bps"],
    userHint: "쉬운 보기에서는 '거래 비용 괜찮음?'으로 묶어 보여줍니다.",
  },
  {
    id: "funding-clock",
    title: "Funding Window",
    shortTitle: "펀딩 시간",
    subtitle: "펀딩비 발표 전후 시간대",
    plainLanguage: "이 전략이 언제 더 조심해야 하는지 알려주는 시계입니다.",
    kind: "time",
    substrate: "data",
    status: "ready",
    confidence: 86,
    x: 58,
    y: 412,
    w: 168,
    h: 94,
    inputs: ["exchange schedule", "UTC clock"],
    outputs: ["time.window", "funding.phase"],
    params: [
      { label: "avoid", value: "T-3m to T+2m" },
      { label: "timezone", value: "UTC" },
    ],
    evidence: ["다음 funding 02:00 UTC", "window rule enabled"],
    userHint: "사용자에게는 복잡한 시간 규칙 대신 '지금 주문 가능/불가'로 보여줍니다.",
  },
  {
    id: "open-distance",
    title: "1H Open Distance",
    shortTitle: "시가 거리",
    subtitle: "현재가가 1시간 시가에서 벗어난 정도",
    plainLanguage: "가격이 평소보다 멀리 튀었는지를 계산합니다.",
    kind: "attribute",
    substrate: "compute",
    status: "active",
    confidence: 91,
    x: 300,
    y: 112,
    w: 168,
    h: 94,
    inputs: ["price.tick"],
    outputs: ["distance.z"],
    params: [
      { label: "lookback", value: "60m" },
      { label: "normalize", value: "ATR" },
    ],
    evidence: ["distance.z = 1.34", "ATR regime stable"],
    userHint: "높을수록 반전 후보가 되지만, 단독으로 주문하지는 않습니다.",
  },
  {
    id: "orderflow-imbalance",
    title: "Order Flow Imbalance",
    shortTitle: "매수/매도 압력",
    subtitle: "체결 방향과 호가 잔량의 불균형",
    plainLanguage: "지금 시장이 한쪽으로 밀리고 있는지 살핍니다.",
    kind: "relation",
    substrate: "compute",
    status: "active",
    confidence: 84,
    x: 300,
    y: 252,
    w: 168,
    h: 94,
    inputs: ["trade tape", "book.depth"],
    outputs: ["ofi.score"],
    params: [
      { label: "window", value: "45s" },
      { label: "smooth", value: "EMA 8" },
    ],
    evidence: ["ofi.score = 0.61", "book refresh healthy"],
    userHint: "강한 압력이 신호를 확인해줄 때만 다음 판단으로 넘깁니다.",
  },
  {
    id: "volatility-score",
    title: "Volume Z-Score",
    shortTitle: "거래량 이상치",
    subtitle: "최근 거래량이 평소보다 큰지",
    plainLanguage: "진짜 움직임인지, 얇은 노이즈인지 구분합니다.",
    kind: "attribute",
    substrate: "compute",
    status: "active",
    confidence: 79,
    x: 300,
    y: 392,
    w: 168,
    h: 94,
    inputs: ["volume.1s"],
    outputs: ["volume.z"],
    params: [
      { label: "baseline", value: "14d intraday" },
      { label: "trigger", value: "> 1.2" },
    ],
    evidence: ["volume.z = 1.47", "news filter clean"],
    userHint: "쉬운 보기에서는 '움직임에 힘이 있음'으로 설명됩니다.",
  },
  {
    id: "flip-score",
    title: "Flip Probability Gate",
    shortTitle: "반전 확률",
    subtitle: "여러 신호를 합쳐 진입 후보를 판단",
    plainLanguage: "흩어진 신호를 하나의 '지금 들어갈 만한가?'로 바꿉니다.",
    kind: "dependency",
    substrate: "predicate",
    status: "active",
    confidence: 87,
    x: 542,
    y: 142,
    w: 168,
    h: 104,
    inputs: ["distance.z", "ofi.score", "volume.z"],
    outputs: ["flip.probability"],
    params: [
      { label: "threshold", value: "0.72" },
      { label: "cooldown", value: "12m" },
    ],
    evidence: ["score = 0.76", "최근 30일 precision 63%"],
    userHint: "사용자는 임계값만 조절하고, 입력 신호의 조합은 고급 보기에서 확인합니다.",
  },
  {
    id: "liquidity-gate",
    title: "Liquidity & Spread Gate",
    shortTitle: "비용 확인",
    subtitle: "스프레드와 예상 슬리피지 검사",
    plainLanguage: "신호가 좋아도 비싸게 체결될 상황이면 멈춥니다.",
    kind: "constraint",
    substrate: "predicate",
    status: "guarded",
    confidence: 82,
    x: 542,
    y: 302,
    w: 168,
    h: 104,
    inputs: ["book.depth", "spread.bps"],
    outputs: ["liquidity.ok"],
    params: [
      { label: "max spread", value: "4 bps" },
      { label: "max slip", value: "8 bps" },
    ],
    evidence: ["spread now 2.1 bps", "slippage estimate 5.4 bps"],
    userHint: "이 노드는 사용자 친화적으로 '거래비용 안전장치'라고 부르면 좋습니다.",
  },
  {
    id: "session-window",
    title: "Session Window Rule",
    shortTitle: "시간 규칙",
    subtitle: "거래 가능한 세션과 금지 시간",
    plainLanguage: "전략이 무리해서 나쁜 시간대에 들어가지 않게 합니다.",
    kind: "time",
    substrate: "predicate",
    status: "ready",
    confidence: 90,
    x: 542,
    y: 462,
    w: 168,
    h: 94,
    inputs: ["time.window", "funding.phase"],
    outputs: ["session.ok"],
    params: [
      { label: "allowed", value: "London, NY" },
      { label: "funding lock", value: "on" },
    ],
    evidence: ["현재 NY overlap", "funding lock inactive"],
    userHint: "고급 사용자는 시간 규칙을 세부 편집할 수 있습니다.",
  },
  {
    id: "enter-spot",
    title: "Enter Spot Position",
    shortTitle: "현물 진입",
    subtitle: "BTC 현물 매수 주문",
    plainLanguage: "조건이 맞으면 정해진 금액만큼 BTC를 삽니다.",
    kind: "flow",
    substrate: "action",
    status: "ready",
    confidence: 85,
    x: 784,
    y: 142,
    w: 168,
    h: 104,
    inputs: ["flip.probability", "liquidity.ok", "session.ok"],
    outputs: ["spot.order", "position.open"],
    params: [
      { label: "notional", value: "$1,250" },
      { label: "order", value: "limit IOC" },
    ],
    evidence: ["exchange auth valid", "balance check passed"],
    userHint: "쉬운 보기의 핵심 편집 지점입니다. 금액, 거래소, 주문 타입을 노출하세요.",
  },
  {
    id: "hedge-perp",
    title: "Perp Hedge",
    shortTitle: "선물 헤지",
    subtitle: "반대 방향 선물로 리스크 완충",
    plainLanguage: "현물 진입 후 급격한 반대 움직임을 줄이는 안전벨트입니다.",
    kind: "flow",
    substrate: "action",
    status: "ready",
    confidence: 76,
    x: 784,
    y: 302,
    w: 168,
    h: 104,
    inputs: ["spot.order", "funding.phase"],
    outputs: ["hedge.order"],
    params: [
      { label: "hedge ratio", value: "0.35x" },
      { label: "venue", value: "Binance Futures" },
    ],
    evidence: ["margin free 41%", "funding acceptable"],
    userHint: "초보자에게는 기본값을 숨기고 '변동성 완충 켜기'로 표현할 수 있습니다.",
  },
  {
    id: "exit-plan",
    title: "Exit & Monitor Plan",
    shortTitle: "종료 계획",
    subtitle: "익절, 손절, 추적 감시",
    plainLanguage: "들어간 뒤에는 언제 나올지를 계속 감시합니다.",
    kind: "hierarchy",
    substrate: "action",
    status: "watching",
    confidence: 89,
    x: 784,
    y: 462,
    w: 168,
    h: 104,
    inputs: ["position.open", "risk.state"],
    outputs: ["exit.order", "monitor.log"],
    params: [
      { label: "take profit", value: "1.8%" },
      { label: "trail", value: "0.45%" },
    ],
    evidence: ["exit simulator green", "monitor interval 5s"],
    userHint: "여러 종료 조건을 하나의 카드로 묶고, 상세는 펼침 패널에 넣습니다.",
  },
  {
    id: "loss-budget",
    title: "Loss Budget",
    shortTitle: "손실 한도",
    subtitle: "전략별 최대 허용 손실",
    plainLanguage: "이번 전략이 잃어도 되는 최대 금액을 정합니다.",
    kind: "constraint",
    substrate: "risk",
    status: "guarded",
    confidence: 95,
    x: 1026,
    y: 132,
    w: 168,
    h: 94,
    inputs: ["position.open", "account.equity"],
    outputs: ["risk.limit"],
    params: [
      { label: "max loss", value: "$210" },
      { label: "daily cap", value: "1.2%" },
    ],
    evidence: ["portfolio exposure 18%", "budget remaining $640"],
    userHint: "사용자가 반드시 이해해야 하는 노드라 쉬운 보기에도 크게 노출합니다.",
  },
  {
    id: "slippage-guard",
    title: "Slippage Guard",
    shortTitle: "슬리피지 방어",
    subtitle: "체결 가격이 나빠지면 주문 취소",
    plainLanguage: "예상보다 불리한 가격이면 주문을 통과시키지 않습니다.",
    kind: "constraint",
    substrate: "risk",
    status: "guarded",
    confidence: 81,
    x: 1026,
    y: 292,
    w: 168,
    h: 94,
    inputs: ["spot.order", "hedge.order", "book.depth"],
    outputs: ["order.approved"],
    params: [
      { label: "price band", value: "8 bps" },
      { label: "retry", value: "2 times" },
    ],
    evidence: ["최근 20회 평균 slip 3.7 bps", "outlier 1회"],
    userHint: "간선은 빨간 경고선보다 '보호 경로'처럼 보여주는 편이 덜 위협적입니다.",
  },
  {
    id: "kill-switch",
    title: "Evidence Kill Switch",
    shortTitle: "중지 스위치",
    subtitle: "데이터 결손, 인증 실패, 급변동 시 정지",
    plainLanguage: "근거가 흔들리면 전략 전체를 멈추는 비상 버튼입니다.",
    kind: "evidence",
    substrate: "risk",
    status: "guarded",
    confidence: 93,
    x: 1026,
    y: 452,
    w: 168,
    h: 104,
    inputs: ["data.health", "auth.state", "monitor.log"],
    outputs: ["strategy.pause"],
    params: [
      { label: "heartbeat", value: "3 misses" },
      { label: "vol shock", value: "> 3.0z" },
    ],
    evidence: ["auth scope verified", "heartbeat SLA 99.96%"],
    userHint: "근거와 provenance를 별도 타입으로 보여주면 사용자가 시스템을 더 신뢰합니다.",
  },
];

const semanticEdges: SemanticEdge[] = [
  { id: "e1", source: "market-feed", target: "open-distance", kind: "data", label: "가격", strength: "high", labelOffset: -14 },
  { id: "e2", source: "market-feed", target: "volatility-score", kind: "data", label: "거래량", strength: "medium", labelOffset: 18 },
  { id: "e3", source: "orderbook-feed", target: "orderflow-imbalance", kind: "data", label: "체결/호가", strength: "high", labelOffset: -14 },
  { id: "e4", source: "orderbook-feed", target: "liquidity-gate", kind: "data", label: "스프레드", strength: "high", labelOffset: 18 },
  { id: "e5", source: "funding-clock", target: "session-window", kind: "control", label: "시간 제한", strength: "medium", labelOffset: 8 },
  { id: "e6", source: "open-distance", target: "flip-score", kind: "data", label: "거리 z", strength: "high", labelOffset: -28 },
  { id: "e7", source: "orderflow-imbalance", target: "flip-score", kind: "data", label: "압력", strength: "medium", labelOffset: 0 },
  { id: "e8", source: "volatility-score", target: "flip-score", kind: "data", label: "힘", strength: "medium", labelOffset: 26 },
  { id: "e9", source: "flip-score", target: "enter-spot", kind: "control", label: "score > 0.72", strength: "high", labelOffset: -22 },
  { id: "e10", source: "liquidity-gate", target: "enter-spot", kind: "risk", label: "비용 OK", strength: "high", labelOffset: 0 },
  { id: "e11", source: "session-window", target: "enter-spot", kind: "control", label: "시간 OK", strength: "medium", labelOffset: 22 },
  { id: "e12", source: "enter-spot", target: "hedge-perp", kind: "flow", label: "포지션 열림", strength: "medium", labelOffset: -18 },
  { id: "e13", source: "enter-spot", target: "loss-budget", kind: "risk", label: "노출", strength: "high", labelOffset: -20 },
  { id: "e14", source: "hedge-perp", target: "slippage-guard", kind: "risk", label: "체결 보호", strength: "medium", labelOffset: 8 },
  { id: "e15", source: "loss-budget", target: "exit-plan", kind: "risk", label: "손실 상태", strength: "medium", labelOffset: -16 },
  { id: "e16", source: "exit-plan", target: "kill-switch", kind: "evidence", label: "모니터 로그", strength: "high", labelOffset: 22 },
  { id: "e17", source: "slippage-guard", target: "kill-switch", kind: "evidence", label: "이상 체결", strength: "medium", labelOffset: -24 },
];

const easyNodes: EasyNode[] = [
  {
    id: "easy-market",
    title: "시장을 읽어요",
    subtitle: "가격, 호가, 펀딩 시간",
    metric: "3 inputs",
    body: "전략이 필요한 원천 정보를 한 묶음으로 보여줍니다.",
    icon: Radar,
    x: 28,
    y: 112,
    w: 154,
    h: 178,
    relatedNodeIds: ["market-feed", "orderbook-feed", "funding-clock"],
  },
  {
    id: "easy-signal",
    title: "신호를 계산해요",
    subtitle: "거리, 압력, 거래량",
    metric: "3 signals",
    body: "복잡한 계산을 사용자가 이해할 수 있는 지표 이름으로 바꿉니다.",
    icon: BrainCircuit,
    x: 212,
    y: 178,
    w: 154,
    h: 178,
    relatedNodeIds: ["open-distance", "orderflow-imbalance", "volatility-score"],
  },
  {
    id: "easy-gate",
    title: "들어갈지 판단해요",
    subtitle: "확률, 비용, 시간",
    metric: "3 checks",
    body: "좋은 신호와 안전 조건이 동시에 맞을 때만 다음 단계로 갑니다.",
    icon: Filter,
    x: 396,
    y: 112,
    w: 154,
    h: 178,
    relatedNodeIds: ["flip-score", "liquidity-gate", "session-window"],
  },
  {
    id: "easy-order",
    title: "주문을 실행해요",
    subtitle: "현물 진입과 헤지",
    metric: "2 orders",
    body: "사용자가 가장 자주 바꾸는 금액, 거래소, 주문 방식을 전면에 둡니다.",
    icon: CircleDollarSign,
    x: 580,
    y: 178,
    w: 154,
    h: 178,
    relatedNodeIds: ["enter-spot", "hedge-perp"],
  },
  {
    id: "easy-risk",
    title: "손실을 막아요",
    subtitle: "손실 한도, 슬리피지",
    metric: "2 guards",
    body: "위험한 연결은 경고색보다 명확한 보호 규칙으로 설명합니다.",
    icon: ShieldCheck,
    x: 764,
    y: 112,
    w: 154,
    h: 178,
    relatedNodeIds: ["loss-budget", "slippage-guard"],
  },
  {
    id: "easy-monitor",
    title: "계속 감시해요",
    subtitle: "종료 계획과 중지",
    metric: "live loop",
    body: "진입 후에는 익절, 손절, 비상 중지를 한 화면에서 추적합니다.",
    icon: TimerReset,
    x: 948,
    y: 178,
    w: 154,
    h: 178,
    relatedNodeIds: ["exit-plan", "kill-switch"],
  },
];

const easyEdges: EasyEdge[] = [
  { id: "ee1", source: "easy-market", target: "easy-signal", label: "정리", tone: "data" },
  { id: "ee2", source: "easy-signal", target: "easy-gate", label: "판단", tone: "control" },
  { id: "ee3", source: "easy-gate", target: "easy-order", label: "조건 충족", tone: "flow" },
  { id: "ee4", source: "easy-order", target: "easy-risk", label: "보호", tone: "risk" },
  { id: "ee5", source: "easy-risk", target: "easy-monitor", label: "추적", tone: "evidence" },
];

const matrixRows = [
  ["시가 거리", "-", "weak", "med", "low"],
  ["매수/매도 압력", "weak", "-", "high", "med"],
  ["거래량 이상치", "med", "high", "-", "low"],
  ["스프레드", "low", "med", "low", "-"],
];

const flowSteps = [
  { label: "Capital", value: "$1,250", width: 100 },
  { label: "Spot Entry", value: "65%", width: 76 },
  { label: "Hedge", value: "35%", width: 54 },
  { label: "Monitor", value: "5s", width: 68 },
  { label: "Exit", value: "rule based", width: 82 },
];

const timelineEvents = [
  { time: "T-30s", label: "데이터 정상성 확인", tone: "data" },
  { time: "T", label: "반전 확률 0.76 도달", tone: "control" },
  { time: "T+1s", label: "현물 주문 승인", tone: "flow" },
  { time: "T+5s", label: "손실 한도와 슬리피지 감시", tone: "risk" },
];

const nodeById = new Map(semanticNodes.map((node) => [node.id, node]));
const easyNodeById = new Map(easyNodes.map((node) => [node.id, node]));

const substrateClass: Record<SubstrateId, string> = {
  data: styles.substrateData,
  compute: styles.substrateCompute,
  predicate: styles.substratePredicate,
  action: styles.substrateAction,
  risk: styles.substrateRisk,
};

const kindClass: Record<NodeKind, string> = {
  entity: styles.nodeEntity,
  attribute: styles.nodeAttribute,
  relation: styles.nodeRelation,
  hierarchy: styles.nodeHierarchy,
  dependency: styles.nodeDependency,
  flow: styles.nodeFlow,
  time: styles.nodeTime,
  constraint: styles.nodeConstraint,
  evidence: styles.nodeEvidence,
};

const edgeClass: Record<EdgeKind, string> = {
  data: styles.edgeData,
  control: styles.edgeControl,
  risk: styles.edgeRisk,
  evidence: styles.edgeEvidence,
  flow: styles.edgeFlow,
};

const markerId: Record<EdgeKind, string> = {
  data: "arrowData",
  control: "arrowControl",
  risk: "arrowRisk",
  evidence: "arrowEvidence",
  flow: "arrowFlow",
};

function getEdgePath(source: Pick<SemanticNode, "x" | "y" | "w" | "h">, target: Pick<SemanticNode, "x" | "y" | "w" | "h">) {
  const x1 = source.x + source.w;
  const y1 = source.y + source.h / 2;
  const x2 = target.x;
  const y2 = target.y + target.h / 2;
  const distance = Math.max(70, Math.abs(x2 - x1));
  const bend = Math.min(150, distance * 0.55);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function getEasyEdgePath(source: EasyNode, target: EasyNode) {
  const x1 = source.x + source.w;
  const y1 = source.y + source.h / 2;
  const x2 = target.x;
  const y2 = target.y + target.h / 2;
  return `M ${x1} ${y1} C ${x1 + 72} ${y1}, ${x2 - 72} ${y2}, ${x2} ${y2}`;
}

function getLabelSize(label: string) {
  return Math.max(58, Math.min(132, label.length * 10 + 30));
}

function isNodeSelected(nodeId: string, selectedNodeId: string) {
  return nodeId === selectedNodeId;
}

function DemoMetric({ icon: Icon, label, value, helper }: { icon: LucideIcon; label: string; value: string; helper: string }) {
  return (
    <div className={styles.demoMetric}>
      <Icon aria-hidden="true" />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{helper}</small>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  helper,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <button className={`${styles.modeButton} ${active ? styles.modeButtonActive : ""}`} type="button" onClick={onClick}>
      <Icon aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{helper}</small>
      </span>
    </button>
  );
}

function LeftRail({ selectedNodeId, onSelectNode }: { selectedNodeId: string; onSelectNode: (nodeId: string) => void }) {
  return (
    <aside className={styles.leftRail} aria-label="정보 구조">
      <div className={styles.railHeader}>
        <span>Ontology Tree</span>
        <strong>5 substrates</strong>
      </div>
      {SUBSTRATES.map((substrate) => {
        const nodes = semanticNodes.filter((node) => node.substrate === substrate.id);
        return (
          <section className={styles.taxonomyGroup} key={substrate.id}>
            <div className={styles.taxonomyTitle}>
              <span className={`${styles.taxonomyDot} ${substrateClass[substrate.id]}`} />
              <span>{substrate.label}</span>
              <small>{nodes.length}</small>
            </div>
            <div className={styles.taxonomyList}>
              {nodes.map((node) => (
                <button
                  className={`${styles.taxonomyItem} ${isNodeSelected(node.id, selectedNodeId) ? styles.taxonomyItemActive : ""}`}
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                >
                  <span>{node.shortTitle}</span>
                  <small>{KIND_LABELS[node.kind]}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </aside>
  );
}

function EasyCanvas({ selectedNodeId, onSelectNode }: { selectedNodeId: string; onSelectNode: (nodeId: string) => void }) {
  return (
    <section className={styles.canvasCard} aria-label="쉬운 보기 데모">
      <div className={styles.canvasHeader}>
        <div>
          <span className={styles.canvasKicker}>Easy View</span>
          <h2>전략을 사람이 읽는 순서로 다시 만든 보기</h2>
        </div>
        <p>복잡한 노드는 6개의 사용 의도 카드로 접고, 간선은 “정리, 판단, 조건 충족, 보호, 추적”처럼 행동 언어로 바꿨습니다.</p>
      </div>
      <div className={styles.easyViewport}>
        <svg className={styles.easyEdges} viewBox="0 0 1128 420" role="img" aria-label="쉬운 보기 단계 연결선">
          <defs>
            <linearGradient id="easyEdgeGradient" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor="#0f9f9a" />
              <stop offset="50%" stopColor="#e98f3e" />
              <stop offset="100%" stopColor="#d14a72" />
            </linearGradient>
            <marker id="easyArrow" markerHeight="9" markerWidth="9" orient="auto" refX="7" refY="4.5">
              <path d="M0,0 L8,4.5 L0,9 Z" fill="#d14a72" />
            </marker>
          </defs>
          {easyEdges.map((edge) => {
            const source = easyNodeById.get(edge.source);
            const target = easyNodeById.get(edge.target);
            if (!source || !target) return null;
            const labelWidth = getLabelSize(edge.label);
            const labelX = (source.x + source.w + target.x) / 2;
            const labelY = (source.y + target.y) / 2 + source.h / 2 - 36;
            return (
              <g key={edge.id}>
                <path className={styles.easyEdgePath} d={getEasyEdgePath(source, target)} markerEnd="url(#easyArrow)" />
                <rect className={styles.easyEdgeLabelBg} x={labelX - labelWidth / 2} y={labelY - 13} width={labelWidth} height="26" rx="13" />
                <text className={styles.easyEdgeLabel} x={labelX} y={labelY + 4} textAnchor="middle">
                  {edge.label}
                </text>
              </g>
            );
          })}
        </svg>
        {easyNodes.map((node, index) => {
          const Icon = node.icon;
          const active = node.relatedNodeIds.includes(selectedNodeId);
          return (
            <button
              className={`${styles.easyNode} ${active ? styles.easyNodeActive : ""}`}
              key={node.id}
              style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h, animationDelay: `${index * 70}ms` } as CSSProperties}
              type="button"
              onClick={() => onSelectNode(node.relatedNodeIds[0])}
            >
              <span className={styles.easyNodeIcon}>
                <Icon aria-hidden="true" />
              </span>
              <span className={styles.easyNodeMetric}>{node.metric}</span>
              <strong>{node.title}</strong>
              <small>{node.subtitle}</small>
              <p>{node.body}</p>
              <span className={styles.easyNodeOpen}>
                관련 노드 보기 <ArrowRight aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.easyLegend}>
        <span><BadgeCheck aria-hidden="true" /> 초보자에게는 편집 가능한 값만 먼저 보여줌</span>
        <span><SplitSquareHorizontal aria-hidden="true" /> 고급 사용자는 카드에서 원본 semantic node로 드릴다운</span>
      </div>
    </section>
  );
}

function AdvancedCanvas({ selectedNodeId, onSelectNode }: { selectedNodeId: string; onSelectNode: (nodeId: string) => void }) {
  return (
    <section className={styles.canvasCard} aria-label="고급 보기 데모">
      <div className={styles.canvasHeader}>
        <div>
          <span className={styles.canvasKicker}>Advanced View</span>
          <h2>Semantic Substrate + Layered DAG</h2>
        </div>
        <p>의미 영역으로 노드 위치를 고정하고, 데이터 의존성, 제어, 리스크, 근거 간선을 타입별로 나눠 읽기 쉽게 만들었습니다.</p>
      </div>
      <div className={styles.advancedViewport}>
        <div className={styles.advancedStage}>
          {SUBSTRATES.map((substrate) => (
            <div
              className={`${styles.substrateBand} ${substrateClass[substrate.id]}`}
              key={substrate.id}
              style={{ left: substrate.x, width: substrate.w } as CSSProperties}
            >
              <strong>{substrate.label}</strong>
              <span>{substrate.helper}</span>
            </div>
          ))}
          <svg className={styles.edgeLayer} viewBox="0 0 1240 650" role="img" aria-label="고급 보기 typed edge graph">
            <defs>
              <marker id="arrowData" markerHeight="9" markerWidth="9" orient="auto" refX="7" refY="4.5">
                <path d="M0,0 L8,4.5 L0,9 Z" fill="#167c80" />
              </marker>
              <marker id="arrowControl" markerHeight="9" markerWidth="9" orient="auto" refX="7" refY="4.5">
                <path d="M0,0 L8,4.5 L0,9 Z" fill="#b76d12" />
              </marker>
              <marker id="arrowRisk" markerHeight="9" markerWidth="9" orient="auto" refX="7" refY="4.5">
                <path d="M0,0 L8,4.5 L0,9 Z" fill="#b82957" />
              </marker>
              <marker id="arrowEvidence" markerHeight="9" markerWidth="9" orient="auto" refX="7" refY="4.5">
                <path d="M0,0 L8,4.5 L0,9 Z" fill="#5b6791" />
              </marker>
              <marker id="arrowFlow" markerHeight="9" markerWidth="9" orient="auto" refX="7" refY="4.5">
                <path d="M0,0 L8,4.5 L0,9 Z" fill="#7e7a14" />
              </marker>
            </defs>
            {semanticEdges.map((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              return (
                <path
                  className={`${styles.edgePath} ${edgeClass[edge.kind]} ${styles[`edgeStrength${edge.strength[0].toUpperCase()}${edge.strength.slice(1)}` as keyof typeof styles]}`}
                  d={getEdgePath(source, target)}
                  key={edge.id}
                  markerEnd={`url(#${markerId[edge.kind]})`}
                />
              );
            })}
            {semanticEdges.map((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              const x1 = source.x + source.w;
              const x2 = target.x;
              const y1 = source.y + source.h / 2;
              const y2 = target.y + target.h / 2;
              const labelWidth = getLabelSize(edge.label);
              const labelX = (x1 + x2) / 2;
              const labelY = (y1 + y2) / 2 + (edge.labelOffset ?? 0);
              return (
                <g className={styles.edgeLabelGroup} key={`${edge.id}-label`}>
                  <rect className={styles.edgeLabelBg} x={labelX - labelWidth / 2} y={labelY - 12} width={labelWidth} height="24" rx="12" />
                  <text className={styles.edgeLabelText} x={labelX} y={labelY + 4} textAnchor="middle">
                    {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {semanticNodes.map((node, index) => (
            <button
              className={`${styles.semanticNode} ${kindClass[node.kind]} ${isNodeSelected(node.id, selectedNodeId) ? styles.semanticNodeSelected : ""}`}
              key={node.id}
              style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h, animationDelay: `${index * 35}ms` } as CSSProperties}
              type="button"
              onClick={() => onSelectNode(node.id)}
            >
              <span className={styles.nodeTopline}>
                <span>{KIND_LABELS[node.kind]}</span>
                <small>{STATUS_LABELS[node.status]}</small>
              </span>
              <strong>{node.shortTitle}</strong>
              <span className={styles.nodeSubtitle}>{node.subtitle}</span>
              <span className={styles.nodeConfidence}>
                <i style={{ width: `${node.confidence}%` }} />
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.advancedLegend}>
        <span className={styles.legendData}>solid = data dependency</span>
        <span className={styles.legendControl}>dashed = control dependency</span>
        <span className={styles.legendRisk}>rose = risk guard</span>
        <span className={styles.legendEvidence}>gray = evidence/provenance</span>
      </div>
    </section>
  );
}

function NodeInspector({ node }: { node: SemanticNode }) {
  return (
    <aside className={styles.rightRail} aria-label="선택한 노드 상세">
      <div className={styles.inspectorHero}>
        <span className={`${styles.inspectorKind} ${kindClass[node.kind]}`}>{KIND_LABELS[node.kind]}</span>
        <h3>{node.title}</h3>
        <p>{node.plainLanguage}</p>
      </div>
      <div className={styles.inspectorScore}>
        <span>신뢰도</span>
        <strong>{node.confidence}%</strong>
        <i>
          <b style={{ width: `${node.confidence}%` }} />
        </i>
      </div>
      <section className={styles.inspectorSection}>
        <h4>사용자에게 보여줄 말</h4>
        <p>{node.userHint}</p>
      </section>
      <section className={styles.inspectorSection}>
        <h4>입력과 출력</h4>
        <div className={styles.ioGrid}>
          <div>
            <span>Inputs</span>
            {node.inputs.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
          <div>
            <span>Outputs</span>
            {node.outputs.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
        </div>
      </section>
      <section className={styles.inspectorSection}>
        <h4>편집 파라미터</h4>
        <div className={styles.paramList}>
          {node.params.map((param) => (
            <div key={param.label}>
              <span>{param.label}</span>
              <strong>{param.value}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.inspectorSection}>
        <h4>근거</h4>
        <div className={styles.evidenceList}>
          {node.evidence.map((item) => (
            <span key={item}>
              <FileSearch aria-hidden="true" />
              {item}
            </span>
          ))}
        </div>
      </section>
    </aside>
  );
}

function MatrixPanel() {
  const columns = ["시가 거리", "OFI", "거래량", "스프레드"];
  return (
    <section className={styles.dockCard}>
      <div className={styles.dockTitle}>
        <Network aria-hidden="true" />
        <div>
          <strong>NodeTrix Detail</strong>
          <span>조밀한 내부 관계는 matrix로 접기</span>
        </div>
      </div>
      <table className={styles.matrixTable}>
        <thead>
          <tr>
            <th />
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrixRows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td className={styles[`matrix${cell[0]?.toUpperCase()}${cell.slice(1)}` as keyof typeof styles] ?? ""} key={`${row[0]}-${index}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FlowPanel() {
  return (
    <section className={styles.dockCard}>
      <div className={styles.dockTitle}>
        <Route aria-hidden="true" />
        <div>
          <strong>Flow View</strong>
          <span>자금과 상태 전이는 Sankey 감각으로</span>
        </div>
      </div>
      <div className={styles.flowRail}>
        {flowSteps.map((step, index) => (
          <div className={styles.flowStep} key={step.label}>
            <span style={{ width: `${step.width}%` }} />
            <strong>{step.label}</strong>
            <small>{step.value}</small>
            {index < flowSteps.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function TimelinePanel() {
  return (
    <section className={styles.dockCard}>
      <div className={styles.dockTitle}>
        <Activity aria-hidden="true" />
        <div>
          <strong>Sensemaking Timeline</strong>
          <span>overview → filter → detail의 작업 로그</span>
        </div>
      </div>
      <div className={styles.timeline}>
        {timelineEvents.map((event) => (
          <div className={`${styles.timelineItem} ${edgeClass[event.tone as EdgeKind]}`} key={event.time}>
            <strong>{event.time}</strong>
            <span>{event.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StrategyVisualDemo() {
  const [mode, setMode] = useState<ViewMode>("easy");
  const [selectedNodeId, setSelectedNodeId] = useState("flip-score");
  const selectedNode = nodeById.get(selectedNodeId) ?? semanticNodes[0];

  return (
    <main className={styles.demoShell}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <Sparkles aria-hidden="true" />
            Hybrid Knowledge Graph Demo
          </span>
          <h1>쉬운 보기는 이야기처럼, 고급 보기는 검증 가능한 구조처럼.</h1>
          <p>
            하나의 예쁜 그래프에 모든 것을 우겨 넣지 않고, 의미 모델을 먼저 만들고 화면에서는 semantic substrate,
            layered DAG, matrix detail, flow view를 조합한 데모입니다.
          </p>
        </div>
        <div className={styles.heroPanel}>
          <DemoMetric icon={Boxes} label="semantic nodes" value="15" helper="정보 타입 기반" />
          <DemoMetric icon={GitBranch} label="typed edges" value="17" helper="data/control/risk 분리" />
          <DemoMetric icon={Eye} label="views" value="2+3" helper="easy, advanced, detail" />
        </div>
      </section>

      <section className={styles.controlStrip}>
        <div className={styles.modeSwitch} role="tablist" aria-label="보기 전환">
          <ModeButton
            active={mode === "easy"}
            helper="사용자 언어와 편집값 중심"
            icon={Gauge}
            label="쉬운 보기"
            onClick={() => setMode("easy")}
          />
          <ModeButton
            active={mode === "advanced"}
            helper="타입, 의존성, 근거 중심"
            icon={Layers3}
            label="고급 보기"
            onClick={() => setMode("advanced")}
          />
        </div>
        <div className={styles.modelTags} aria-label="의미 모델 타입">
          {MODEL_TAGS.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </section>

      <section className={styles.workspace}>
        <LeftRail selectedNodeId={selectedNode.id} onSelectNode={setSelectedNodeId} />
        <div className={styles.centerColumn}>
          {mode === "easy" ? (
            <EasyCanvas selectedNodeId={selectedNode.id} onSelectNode={setSelectedNodeId} />
          ) : (
            <AdvancedCanvas selectedNodeId={selectedNode.id} onSelectNode={setSelectedNodeId} />
          )}
        </div>
        <NodeInspector node={selectedNode} />
      </section>

      <section className={styles.bottomDock} aria-label="하이브리드 상세 보기">
        <MatrixPanel />
        <FlowPanel />
        <TimelinePanel />
      </section>
    </main>
  );
}
