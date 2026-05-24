import type { Edge, Node } from "@xyflow/react";
import type {
  ActionNodeData,
  BlockData,
  ChartComparisonValue,
  ClickTriggerData,
  FunctionNodeData,
  IndicatorCondition,
  MonitoringNodeData,
  StreamingNodeData,
  TimeTriggerData,
} from "@/components/node-editor/types";

export type StrategyTemplate = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  tags: string[];
};

export type EasyNodeKind = "start" | "stream" | "condition" | "cex" | "dex" | "monitor" | "risk" | "end";
export type EasyEdgeKind = "sequence" | "condition" | "data" | "risk";

export type EasyViewParam = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  helper: string;
  options?: string[];
  readonly?: boolean;
};

export type EasyViewChart = {
  title: string;
  fields: string[];
  highlight?: string;
};

export type EasyViewNode = {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  description: string;
  roleDescription?: string;
  conditionText?: string;
  inputSummary?: string;
  outputSummary?: string;
  kind: EasyNodeKind;
  status: "ready" | "watching" | "running" | "complete" | "blocked";
  x: number;
  y: number;
  w: number;
  params: EasyViewParam[];
  editableInEasyView: boolean;
  chart?: EasyViewChart;
  sourceBlockIds?: string[];
  isAbstracted?: boolean;
};

export type EasyViewEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: EasyEdgeKind;
  sharedDataPipeline?: boolean;
};

export type EasyViewModel = {
  title: string;
  summary: string;
  strategyType: string;
  timeframe: string;
  lastModified: string;
  code: string;
  canvasWidth: number;
  canvasHeight: number;
  nodes: EasyViewNode[];
  edges: EasyViewEdge[];
};

export type EasyViewAgentResult = {
  code: string;
  easyView: EasyViewModel;
  steps: string[];
  advancedGraph?: {
    nodes: Node[];
    edges: Edge[];
  };
};

type StrategyGraphBlock = {
  id?: unknown;
  type?: unknown;
  config?: Record<string, unknown>;
};

type StrategyGraphConnection = {
  id?: unknown;
  kind?: unknown;
  fromId?: unknown;
  toId?: unknown;
  sourceBlockId?: unknown;
  fromBlockId?: unknown;
  sourceOutputBlockId?: unknown;
  label?: unknown;
  easyLabel?: unknown;
  description?: unknown;
  sharedDataPipeline?: unknown;
};

export type StrategyGraphPayload = {
  schemaVersion?: unknown;
  kind?: unknown;
  strategy?: {
    id?: unknown;
    name?: unknown;
  };
  generatedAt?: unknown;
  summary?: unknown;
  metadata?: Record<string, unknown>;
  blocks?: StrategyGraphBlock[];
  connections?: StrategyGraphConnection[];
};

const EASY_ORIGIN_X = 32;
const EASY_ORIGIN_Y = 104;
const EASY_COLUMN_GAP = 380;
const EASY_ROW_GAP = 300;

function isKillSwitchText(text: string) {
  return /kill\s*switch|killswitch|emergency|panic|circuit\s*breaker|manual\s*(halt|stop)|global\s*(halt|stop)|stop\s*all|halt\s*strategy|킬\s*스위치|긴급|비상|강제\s*중단|전체\s*(중단|정지|청산)/i.test(text);
}

function isKillSwitchBlock(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  if (config.killSwitch === true || config.emergencyStop === true || config.circuitBreaker === true) {
    return true;
  }
  return isKillSwitchText([
    normalizeGraphText(block.id),
    normalizeGraphText(block.type),
    collectEasyBlockText(block),
  ].join(" "));
}

function makeUniqueStrategyBlockId(blocks: StrategyGraphBlock[], preferredId: string) {
  const used = new Set(blocks.map((block) => normalizeGraphText(block.id)).filter(Boolean));
  if (!used.has(preferredId)) return preferredId;
  for (let index = 2; index < 1000; index += 1) {
    const id = `${preferredId}-${index}`;
    if (!used.has(id)) return id;
  }
  return `${preferredId}-${Date.now()}`;
}

function hasGraphKillSwitch(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]) {
  const killTriggers = new Set(
    blocks
      .filter((block) => getBlockType(block) === "trigger" && isKillSwitchBlock(block))
      .map((block) => getBlockId(block)),
  );
  const killActions = new Set(
    blocks
      .filter((block) => getBlockType(block) === "action" && isKillSwitchBlock(block))
      .map((block) => getBlockId(block)),
  );
  if (killTriggers.size === 0 || killActions.size === 0) return false;
  return connections.some((connection) =>
    normalizeGraphText(connection.kind) === "trigger-action" &&
    killTriggers.has(normalizeGraphText(connection.fromId)) &&
    killActions.has(normalizeGraphText(connection.toId)));
}

function shouldAttachAutoKillSwitch(strategyGraph: StrategyGraphPayload, blocks: StrategyGraphBlock[]) {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const sequenceIsolation = normalizeGraphText(metadata.sequenceIsolation).toLowerCase();
  const readiness = metadata.executionReadiness && typeof metadata.executionReadiness === "object"
    ? metadata.executionReadiness as Record<string, unknown>
    : {};
  if (sequenceIsolation.includes("monitoring-only") || readiness.liveExecutable === false && readiness.monitoringReady === true) {
    return false;
  }

  return blocks.some((block) => getBlockType(block) === "action" && !isKillSwitchBlock(block));
}

function inferDisplayKillSwitchActionConfig(blocks: StrategyGraphBlock[]) {
  const actionText = blocks
    .filter((block) => getBlockType(block) === "action")
    .map((block) => collectEasyBlockText(block))
    .join(" ")
    .toLowerCase();
  const useDex = /dex|swap|contract|onchain|flash\s*loan|flashloan|uniswap|jupiter|aave|온체인|스왑|플래시론/.test(actionText);
  if (useDex) {
    return {
      actionType: "dex",
      exchange: "연결된 온체인 실행 환경",
      chain: "connected-chain",
      contractAddress: "0x0000000000000000000000000000000000000000",
      functionName: "emergencyExit()",
      closeAllPositions: true,
      cancelOpenOrders: true,
    };
  }
  return {
    actionType: "cex",
    exchange: "연결된 거래소",
    symbol: "ALL",
    side: "SELL",
    orderType: "MARKET",
    reduceOnly: true,
    cancelOpenOrders: true,
    closeAllPositions: true,
  };
}

function withStrategyKillSwitch(strategyGraph: StrategyGraphPayload): StrategyGraphPayload {
  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks.map((block) => ({ ...block, config: { ...(block.config ?? {}) } })) : [];
  const connections = Array.isArray(strategyGraph.connections) ? strategyGraph.connections.map((connection) => ({ ...connection })) : [];
  if (!shouldAttachAutoKillSwitch(strategyGraph, blocks)) {
    return { ...strategyGraph, blocks, connections };
  }
  if (hasGraphKillSwitch(blocks, connections)) {
    return { ...strategyGraph, blocks, connections };
  }

  const triggerId = makeUniqueStrategyBlockId(blocks, "kill-switch-trigger");
  const actionId = makeUniqueStrategyBlockId(blocks, "kill-switch-close-all");
  const firstDataSource = blocks.find((block) => getBlockType(block) === "streaming") || blocks.find((block) => getBlockType(block) === "normal");
  const actionConfig = inferDisplayKillSwitchActionConfig(blocks);
  blocks.push({
    id: triggerId,
    type: "trigger",
    config: {
      name: "킬스위치",
      label: "킬스위치",
      triggerType: "condition",
      condition: "manual_kill_switch == true || strategy_drawdown_pct <= -5 || data_stale_seconds >= 30 || exchange_disconnect == true",
      killSwitch: true,
      emergencyStop: true,
      overviewDescription: "수동 중단, 손실 한도, 데이터 지연, 거래소 연결 이상이 감지되면 전략을 즉시 멈춥니다.",
      roleDescription: "정상 매매 조건과 별개로 전략 전체를 멈추는 최종 안전장치입니다.",
      inputSummary: "수동 중단 상태, 누적 손실률, 데이터 지연 시간, 거래소 연결 상태",
      outputSummary: "전체 포지션 정리 신호",
    },
  });
  blocks.push({
    id: actionId,
    type: "action",
    config: {
      name: "킬스위치 실행",
      label: "킬스위치 실행",
      ...actionConfig,
      killSwitch: true,
      emergencyStop: true,
      overviewDescription: "열려 있는 주문을 취소하고 전략이 만든 포지션을 가능한 한 감소 전용으로 정리합니다.",
      roleDescription: "킬스위치 조건이 켜졌을 때만 실행되는 종료 액션입니다. 새 진입을 막고 기존 노출을 줄입니다.",
      inputSummary: "킬스위치 신호와 최신 시장/계정 상태",
      outputSummary: "취소/청산 요청 상태와 실행 결과",
    },
  });
  connections.push({
    id: "kill-switch-trigger-action",
    kind: "trigger-action",
    fromId: triggerId,
    toId: actionId,
  });
  if (firstDataSource?.id) {
    connections.push({
      id: "kill-switch-safety-context",
      kind: "action-input",
      fromId: firstDataSource.id,
      toId: actionId,
    });
  }

  return { ...strategyGraph, blocks, connections };
}

function advancedNodeToStrategyBlockType(node: Node) {
  if (node.type === "streamingNode") return "streaming";
  if (node.type === "actionNode") return "action";
  if (node.type === "monitoringNode") return "monitoring";
  if (node.type === "timeTrigger" || node.type === "clickTrigger") return "trigger";
  return "normal";
}

function collectAdvancedNodeText(node: Node) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return [
    node.id,
    node.type,
    data.label,
    data.name,
    data.title,
    data.functionName,
    data.description,
    data.summary,
    data.condition,
    data.styleType,
  ].map((value) => String(value ?? "")).join(" ");
}

function isRuntimeArtifactNode(node: Node) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return node.type === "codeEditor" || data.isRuntimeArtifact === true;
}

function sanitizeGraphId(value: string, fallback: string) {
  return normalizeGraphText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function getAdvancedGroupLabel(node: Node, fallback: string) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return readConfigText(data, ["label", "title", "name"], fallback);
}

function isSequenceGroupNode(node: Node) {
  if (node.type !== "groupNode") return false;
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return data.styleType !== "solid";
}

function getAdvancedWorkflowIdForNode(node: Node, groupById: Map<string, Node>) {
  const parent = node.parentId ? groupById.get(node.parentId) : undefined;
  if (!parent || !isSequenceGroupNode(parent)) return "";
  return sanitizeGraphId(parent.id.replace(/^ai_seq_/, ""), parent.id);
}

function isAdvancedInitNode(node: Node) {
  return /(^|[\s_-])(init|initial|initialize|bootstrap|setup|start)([\s_-]|$)|초기|초기화|시작|capitalready|startapproved/i.test(collectAdvancedNodeText(node));
}

function isAdvancedKillSwitchNode(node: Node) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return data.killSwitch === true ||
    data.emergencyStop === true ||
    data.circuitBreaker === true ||
    isKillSwitchText(collectAdvancedNodeText(node));
}

function shouldStayVisibleInWorkflow(node: Node) {
  return node.type === "actionNode" ||
    node.type === "timeTrigger" ||
    node.type === "clickTrigger" ||
    isAdvancedInitNode(node) ||
    isAdvancedKillSwitchNode(node);
}

function buildAdvancedWorkflowGroups(graph: { nodes: Node[]; edges: Edge[] }, visibleNodes: Node[]) {
  const groupNodes = graph.nodes.filter((node) => node.type === "groupNode");
  const groupById = new Map(groupNodes.map((node) => [node.id, node]));
  const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const assigned = new Set<string>();
  const groups = groupNodes
    .filter(isSequenceGroupNode)
    .map((group, index): EasyWorkflowGroupSpec | null => {
      const workflowId = sanitizeGraphId(group.id.replace(/^ai_seq_/, ""), `workflow-${index + 1}`);
      const nodeIds = visibleNodes
        .filter((node) => {
          if (node.parentId === group.id) return true;
          const parent = node.parentId ? groupById.get(node.parentId) : undefined;
          return parent?.parentId === group.id;
        })
        .map((node) => node.id);
      nodeIds.forEach((nodeId) => assigned.add(nodeId));
      const text = `${workflowId} ${getAdvancedGroupLabel(group, workflowId)} ${collectAdvancedNodeText(group)}`;
      const isSafetyGroup = /kill|emergency|panic|stop|exit|close|킬|긴급|비상|중단|정리|청산/i.test(text);
      const isInitGroup = /init|start|bootstrap|setup|capital|초기|시작/i.test(text);
      return {
        id: workflowId,
        title: getAdvancedGroupLabel(group, workflowId),
        purpose: readConfigText((group.data ?? {}) as Record<string, unknown>, ["purpose", "description", "summary"], ""),
        sequenceType: isSafetyGroup ? "kill-switch" : isInitGroup ? "init" : "workflow",
        order: index + 1,
        nodeIds,
        canAbstract: !isSafetyGroup && !isInitGroup,
        mustStayVisibleNodeIds: nodeIds.filter((nodeId) => {
          const node = visibleNodeById.get(nodeId);
          return node ? shouldStayVisibleInWorkflow(node) : false;
        }),
      };
    })
    .filter((group): group is EasyWorkflowGroupSpec => Boolean(group && group.nodeIds.length > 0));

  const unassigned = visibleNodes.filter((node) => !assigned.has(node.id));
  if (unassigned.length > 0 || groups.length === 0) {
    const fallbackNodes = unassigned.length > 0 ? unassigned : visibleNodes;
    groups.push({
      id: "main-workflow",
      title: "메인 전략 흐름",
      purpose: "AI 또는 사용자가 명시 시퀀스로 묶지 않은 핵심 실행 흐름입니다.",
      sequenceType: "workflow",
      order: groups.length + 1,
      nodeIds: fallbackNodes.map((node) => node.id),
      canAbstract: true,
      mustStayVisibleNodeIds: fallbackNodes.filter(shouldStayVisibleInWorkflow).map((node) => node.id),
    });
  }

  return groups;
}

function sanitizeAdvancedNodeConfig(node: Node) {
  const rawData = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  const config: Record<string, unknown> = { ...rawData };

  delete config.selected;
  delete config.dragging;

  if (node.type === "timeTrigger") {
    const interval = normalizeGraphNumber(config.interval, 60);
    config.triggerType = "time";
    config.interval = interval;
    config.intervalMs = normalizeGraphNumber(config.intervalMs, interval * 1000);
    config.outputBlocks = config.outputBlocks ?? [
      {
        id: "tick",
        name: "tick",
        description: `${Math.round(interval)}초마다 true 신호를 내보냅니다.`,
        type: "output",
      },
    ];
  }

  if (node.type === "clickTrigger") {
    config.triggerType = "manual";
    config.outputBlocks = config.outputBlocks ?? [
      {
        id: "click",
        name: "click",
        description: "클릭되면 true 신호를 내보냅니다.",
        type: "output",
      },
    ];
  }

  if (node.type === "functionNode") {
    if (typeof config.triggerCondition === "string" && !config.condition) {
      config.condition = config.triggerCondition;
    }
    if (typeof config.code === "string" && !config.logic) {
      config.logic = config.code;
    }
  }

  if (node.type === "actionNode" && typeof config.actionType === "string") {
    config.actionType = config.actionType.toUpperCase();
    const exchange = normalizeGraphText(config.exchange).toLowerCase().replace(/[\s._-]+/g, "");
    if (config.actionType === "CEX" && exchange === "polymarket") {
      const tokenId = normalizeGraphText(config.tokenId);
      const price = normalizeGraphText(config.price);
      const size = normalizeGraphText(config.size || config.amount);
      const postOnly = typeof config.postOnly === "boolean"
        ? config.postOnly
        : normalizeGraphText(config.postOnly).toLowerCase() === "true";
      config.dexProtocol = "polymarket";
      config.executionMode = "api";
      config.apiUrl = "https://clob.polymarket.com";
      config.chainId = normalizeGraphNumber(config.chainId, 137);
      config.parameters = [
        { name: "tokenId", value: tokenId },
        { name: "side", value: normalizeGraphText(config.side, "BUY").toUpperCase() },
        { name: "price", value: price },
        { name: "size", value: size },
        { name: "orderType", value: normalizeGraphText(config.polymarketOrderType || config.orderType, "GTC").toUpperCase() },
        { name: "postOnly", value: String(postOnly) },
      ];
    }
  }

  return config;
}

function getAdvancedEdgeEasyLabel(edge: Edge) {
  const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
  const label = normalizeGraphText(data.easyLabel ?? data.label ?? edge.label);
  if (!label || STRATEGY_CONNECTION_KIND_SET.has(label.toLowerCase())) return "";
  return compactEasyEdgeLabel(label);
}

function normalizeAdvancedEdgeKind(edge: Edge, sourceNode?: Node, targetNode?: Node) {
  const label = normalizeGraphText((edge.data as { label?: unknown } | undefined)?.label || edge.label).toLowerCase();
  const compactLabel = label.replace(/[^a-z0-9]/g, "");
  const aliasMap: Array<[RegExp, string]> = [
    [/streammonitor|stream-monitor/, "stream-monitor"],
    [/triggeraction|trigger-action/, "trigger-action"],
    [/triggerinput|trigger-input|timegate|gate/, "trigger-input"],
    [/actioninput|action-input/, "action-input"],
    [/actionresult|action-result/, "action-result"],
    [/dataflow|data-flow|metric|output/, "data-flow"],
  ];

  for (const [pattern, kind] of aliasMap) {
    if (pattern.test(label) || pattern.test(compactLabel)) return kind;
  }

  if (sourceNode?.type === "actionNode") return "action-result";
  if (targetNode?.type === "monitoringNode") return "stream-monitor";
  const sourceIsTrigger = sourceNode?.type === "timeTrigger" || sourceNode?.type === "clickTrigger";
  const targetIsTrigger = targetNode?.type === "timeTrigger" || targetNode?.type === "clickTrigger";
  if (sourceIsTrigger && targetIsTrigger) return "trigger-input";
  if (targetNode?.type === "actionNode") {
    return sourceIsTrigger ? "trigger-action" : "action-input";
  }
  if (targetIsTrigger) return "trigger-input";
  return "data-flow";
}

export function advancedGraphToStrategyGraph(
  graph: { nodes: Node[]; edges: Edge[] },
  strategyName = "Edited advanced strategy",
): StrategyGraphPayload {
  const strategyId = normalizeGraphText(strategyName, "edited-advanced-strategy")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "") || "edited-advanced-strategy";
  const groupNodes = graph.nodes.filter((node) => node.type === "groupNode");
  const groupById = new Map(groupNodes.map((node) => [node.id, node]));
  const isHiddenByCollapsedSequence = (node: Node) => {
    if (!node.hidden) return false;
    let parentId = node.parentId;
    while (parentId) {
      const parent = groupById.get(parentId);
      const parentData = parent?.data && typeof parent.data === "object" ? parent.data as Record<string, unknown> : {};
      if (parent?.type === "groupNode" && parentData.styleType !== "solid" && parentData.isCollapsed === true) {
        return true;
      }
      parentId = parent?.parentId;
    }
    return false;
  };
  const strategyNodes = graph.nodes.filter((node) =>
    node.type !== "groupNode" && !isRuntimeArtifactNode(node) && (!node.hidden || isHiddenByCollapsedSequence(node)),
  );
  const strategyGroup = groupNodes.find((node) => {
    const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
    return data.styleType === "solid";
  });
  const workflowGroups = buildAdvancedWorkflowGroups(graph, strategyNodes);
  const nodeById = new Map(strategyNodes.map((node) => [node.id, node]));
  const blocks = strategyNodes.map((node) => ({
    id: node.id,
    type: advancedNodeToStrategyBlockType(node),
    config: {
      ...sanitizeAdvancedNodeConfig(node),
      ...(getAdvancedWorkflowIdForNode(node, groupById)
        ? { workflowId: getAdvancedWorkflowIdForNode(node, groupById) }
        : {}),
    },
  }));
  const connections = graph.edges
    .filter((edge) => {
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target) || edge.source === edge.target) return false;
      const label = normalizeGraphText((edge.data as { label?: unknown } | undefined)?.label || edge.label).toLowerCase();
      return !/^interval sample$/.test(label) && !edge.id.startsWith("adv-visual-");
    })
    .map((edge, index) => {
      const easyLabel = getAdvancedEdgeEasyLabel(edge);
      return {
        id: normalizeGraphText(edge.id, `edited-edge-${index + 1}`),
        kind: normalizeAdvancedEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target)),
        fromId: edge.source,
        toId: edge.target,
        ...(easyLabel ? { easyLabel } : {}),
      };
    });

  if (connections.length === 0 && strategyNodes.length > 1) {
    strategyNodes.slice(0, -1).forEach((node, index) => {
      const next = strategyNodes[index + 1];
      connections.push({
        id: `edited-auto-edge-${index + 1}`,
        kind: next.type === "actionNode" ? "action-input" : "data-flow",
        fromId: node.id,
        toId: next.id,
      });
    });
  }

  return {
    schemaVersion: 1,
    kind: "hershy-strategy-graph",
    strategy: {
      id: strategyId,
      name: strategyName,
    },
    generatedAt: new Date().toISOString(),
    summary: {
      blocks: blocks.length,
      connections: connections.length,
    },
    metadata: {
      source: "advanced-view-edit",
      easyViewRegeneratedFromAdvanced: true,
      strategyBlock: {
        id: strategyId,
        title: strategyGroup ? getAdvancedGroupLabel(strategyGroup, strategyName) : strategyName,
        purpose: "전략 전체를 감싸는 최상위 실행 컨테이너입니다.",
        nodeIds: strategyNodes.map((node) => node.id),
      },
      workflowGroups,
    },
    blocks,
    connections,
  };
}

export const DEFAULT_STRATEGY_TEMPLATES: StrategyTemplate[] = [
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

const nowLabel = () => new Date().toLocaleString("ko-KR", { hour12: false });

export function buildStrategyCodeFromTemplate(template: StrategyTemplate): string {
  if (template.id === "trend") {
    return `strategy "BTC 20MA volume trend" {
  stream price = binance.spot("BTCUSDT").candles("1m")
  indicator ma20 = sma(price.close, 20)
  indicator volume_avg = sma(price.volume, 20)

  signal entry = crossover(price.close, ma20) and price.volume > volume_avg

  when entry {
    cex.buy(exchange: "Binance", symbol: "BTCUSDT", order_type: "MARKET", quote: 1000 USDT)
  }

  while position.open {
    monitor trailing_stop = drawdown_from_high(price.close) > 1.20
    close if price.close < ma20 or trailing_stop
  }
}`;
  }

  if (template.id === "dca") {
    return `strategy "ETH timed DCA" {
  stream price = binance.spot("ETHUSDT").ticker("1m")
  schedule every 4h

  when schedule.tick {
    cex.buy(exchange: "Binance", symbol: "ETHUSDT", order_type: "MARKET", quote: 250 USDT)
  }

  while strategy.active {
    monitor total_drawdown = portfolio.pnl_pct < -5.00
    pause if total_drawdown
  }
}`;
  }

  if (template.id === "funding") {
    return `strategy "Funding carry neutral" {
  stream funding = binance.perp("BTCUSDT.P").funding_rate("1m")
  stream basis = binance.basis("BTCUSDT", "BTCUSDT.P")

  signal entry = funding.rate > 0.010 and abs(basis.percent) < 0.20

  when entry {
    cex.buy(exchange: "Binance", symbol: "BTCUSDT", order_type: "MARKET", quote: 1000 USDT)
    cex.short(exchange: "Binance Futures", symbol: "BTCUSDT.P", leverage: 1x, quote: 1000 USDT)
  }

  close if funding.rate < 0.002 or basis.percent > 0.50
}`;
  }

  return `strategy "BTC spot-perp basis" {
  stream spot = binance.spot("BTCUSDT").ticker("1m")
  stream perp = binance.perp("BTCUSDT.P").ticker("1m")

  basis = (perp.price - spot.price) / spot.price * 100

  when basis > 0.50 {
    cex.buy(exchange: "Binance", symbol: "BTCUSDT", order_type: "MARKET", quote: 1000 USDT)
    cex.short(exchange: "Binance Futures", symbol: "BTCUSDT.P", leverage: 1x, quote: 1000 USDT)
  }

  while position.open {
    rebalance if exposure_gap > 0.20
    close if basis < 0.10 or pnl < -1.00
  }
}`;
}

function createTrendView(code: string): EasyViewModel {
  const nodes: EasyViewNode[] = [
    {
      id: "start",
      index: 1,
      title: "전략 시작",
      subtitle: "Init",
      description: "거래소 연결과 실행 컨텍스트를 확인합니다.",
      kind: "start",
      status: "complete",
      x: 28,
      y: 122,
      w: 132,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "stream",
      index: 2,
      title: "BTC 시세 스트림",
      subtitle: "1m candles",
      description: "BTCUSDT 1분 봉의 종가와 거래량을 받아옵니다.",
      kind: "stream",
      status: "watching",
      x: 210,
      y: 76,
      w: 196,
      params: [],
      editableInEasyView: false,
      chart: {
        title: "BTCUSDT 1m",
        fields: ["close", "volume", "MA20"],
        highlight: "trailing_stop",
      },
    },
    {
      id: "entry",
      index: 3,
      title: "20MA + 거래량 진입",
      subtitle: "Signal",
      description: "종가가 20MA를 상향 돌파하고 거래량이 평균보다 높은 구간만 표시합니다.",
      kind: "condition",
      status: "running",
      x: 412,
      y: 78,
      w: 162,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "cex-buy",
      index: 4,
      title: "BTC 현물 매수",
      subtitle: "CEX order",
      description: "조건 충족 시 Binance에서 BTCUSDT 현물을 매수합니다.",
      kind: "cex",
      status: "ready",
      x: 642,
      y: 76,
      w: 166,
      params: [
        { key: "exchange", label: "거래소", value: "Binance", helper: "주문을 보낼 CEX", options: ["Binance", "Bybit", "OKX", "Coinbase"] },
        { key: "symbol", label: "심볼", value: "BTCUSDT", helper: "매수 대상 마켓" },
        { key: "quote", label: "투입금", value: "1,000", unit: "USDT", helper: "진입 주문 금액" },
        { key: "orderType", label: "주문 방식", value: "MARKET", helper: "CEX 주문 타입", options: ["MARKET", "LIMIT"] },
      ],
      editableInEasyView: true,
    },
    {
      id: "risk",
      index: 5,
      title: "트레일링 스톱",
      subtitle: "Risk",
      description: "고점 대비 1.20% 이상 하락하면 종료 후보로 표시합니다.",
      kind: "risk",
      status: "blocked",
      x: 622,
      y: 350,
      w: 130,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "end",
      index: 6,
      title: "포지션 종료",
      subtitle: "Close",
      description: "조건이 깨지면 포지션을 닫고 실행 기록을 저장합니다.",
      kind: "end",
      status: "ready",
      x: 780,
      y: 350,
      w: 142,
      params: [
        { key: "closeType", label: "청산 방식", value: "MARKET", helper: "종료 주문 방식", options: ["MARKET", "LIMIT"] },
      ],
      editableInEasyView: true,
    },
  ];

  return finalizeEasyViewModel({
    title: "BTC 20MA 거래량 추세 추종",
    summary: "20MA 상향 돌파와 거래량 증가가 동시에 발생하면 CEX 매수 주문을 실행합니다.",
    strategyType: "추세 추종",
    timeframe: "1분",
    lastModified: nowLabel(),
    code,
    canvasWidth: 980,
    canvasHeight: 460,
    nodes,
    edges: buildEasyViewEdges(nodes, [
      ["start", "stream", "시작"],
      ["stream", "entry", "데이터"],
      ["entry", "cex-buy", "조건 충족"],
      ["cex-buy", "risk", "체결 후"],
      ["risk", "end", "종료"],
    ]),
  });
}

function createBasisView(code: string, template: StrategyTemplate): EasyViewModel {
  const isFunding = template.id === "funding";
  const nodes: EasyViewNode[] = [
    {
      id: "start",
      index: 1,
      title: "전략 시작",
      subtitle: "Init",
      description: "거래소 연결과 기본 잔고를 확인합니다.",
      kind: "start",
      status: "complete",
      x: 28,
      y: 118,
      w: 132,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "basis",
      index: 2,
      title: isFunding ? "펀딩비 조건" : "가격차 진입 조건",
      subtitle: isFunding ? "Funding signal" : "Basis signal",
      description: isFunding ? "펀딩비와 베이시스가 동시에 안정적인 구간을 찾습니다." : "현물과 선물 가격차가 설정 기준 이상인지 감시합니다.",
      kind: "condition",
      status: "running",
      x: 220,
      y: 92,
      w: 150,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "spot",
      index: 3,
      title: "BTC 현물 매수",
      subtitle: "CEX spot",
      description: "현물 포지션을 열어 기준 자산 노출을 만듭니다.",
      kind: "cex",
      status: "ready",
      x: 430,
      y: 62,
      w: 166,
      params: [
        { key: "exchange", label: "거래소", value: "Binance", helper: "현물 주문 CEX", options: ["Binance", "Bybit", "OKX", "Coinbase"] },
        { key: "symbol", label: "심볼", value: "BTCUSDT", helper: "현물 마켓" },
        { key: "quote", label: "투입금", value: "1,000", unit: "USDT", helper: "현물 주문 금액" },
      ],
      editableInEasyView: true,
    },
    {
      id: "perp",
      index: 4,
      title: "BTC 선물 숏",
      subtitle: "CEX perp",
      description: "선물 숏으로 가격 방향 리스크를 상쇄합니다.",
      kind: "cex",
      status: "ready",
      x: 660,
      y: 62,
      w: 166,
      params: [
        { key: "exchange", label: "거래소", value: "Binance Futures", helper: "선물 주문 CEX", options: ["Binance Futures", "Bybit", "OKX"] },
        { key: "symbol", label: "심볼", value: "BTCUSDT.P", helper: "선물 마켓" },
        { key: "leverage", label: "레버리지", value: "1x", helper: "선물 레버리지", options: ["1x", "2x", "3x"] },
      ],
      editableInEasyView: true,
    },
    {
      id: "risk",
      index: 5,
      title: "손실 제한",
      subtitle: "Risk",
      description: "허용 손실을 넘으면 종료 단계로 넘깁니다.",
      kind: "risk",
      status: "blocked",
      x: 530,
      y: 350,
      w: 122,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "end",
      index: 6,
      title: "종료",
      subtitle: "Close",
      description: "현물과 선물 포지션을 함께 닫습니다.",
      kind: "end",
      status: "ready",
      x: 720,
      y: 350,
      w: 142,
      params: [
        { key: "closeType", label: "청산 방식", value: "동시 청산", helper: "종료 주문 방식", options: ["동시 청산", "선물 우선", "현물 우선"] },
      ],
      editableInEasyView: true,
    },
  ];

  return finalizeEasyViewModel({
    title: isFunding ? "펀딩비 중립 수익 전략" : "BTC 현물-선물 가격차 전략",
    summary: isFunding ? "펀딩비가 높고 베이시스가 안정적일 때 시장 중립 포지션을 엽니다." : "현물-선물 가격차가 벌어질 때 현물 매수와 선물 숏을 동시에 실행합니다.",
    strategyType: isFunding ? "펀딩비/중립" : "차익거래(Basis)",
    timeframe: "1분",
    lastModified: nowLabel(),
    code,
    canvasWidth: 980,
    canvasHeight: 460,
    nodes,
    edges: buildEasyViewEdges(nodes, [
      ["start", "basis", "시작"],
      ["basis", "spot", "조건 충족"],
      ["spot", "perp", "헤지"],
      ["perp", "risk", "손실 제한"],
      ["spot", "risk", "노출 확인"],
      ["risk", "end", "종료"],
    ]),
  });
}

function createDcaView(code: string): EasyViewModel {
  const nodes: EasyViewNode[] = [
    {
      id: "start",
      index: 1,
      title: "전략 시작",
      subtitle: "Init",
      description: "거래소 연결과 예산을 확인합니다.",
      kind: "start",
      status: "complete",
      x: 28,
      y: 122,
      w: 132,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "schedule",
      index: 2,
      title: "4시간 주기",
      subtitle: "Schedule",
      description: "정해진 주기마다 매수 조건을 발생시킵니다.",
      kind: "condition",
      status: "running",
      x: 234,
      y: 96,
      w: 138,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "cex-buy",
      index: 3,
      title: "ETH 현물 매수",
      subtitle: "CEX order",
      description: "주기마다 ETHUSDT를 분할 매수합니다.",
      kind: "cex",
      status: "ready",
      x: 456,
      y: 78,
      w: 166,
      params: [
        { key: "exchange", label: "거래소", value: "Binance", helper: "주문 CEX", options: ["Binance", "Bybit", "OKX", "Coinbase"] },
        { key: "symbol", label: "심볼", value: "ETHUSDT", helper: "매수 대상 마켓" },
        { key: "quote", label: "회차 투입금", value: "250", unit: "USDT", helper: "주기별 주문 금액" },
      ],
      editableInEasyView: true,
    },
    {
      id: "risk",
      index: 4,
      title: "총 손실 제한",
      subtitle: "Risk",
      description: "누적 손실이 기준을 넘으면 DCA를 중단합니다.",
      kind: "risk",
      status: "blocked",
      x: 456,
      y: 260,
      w: 138,
      params: [],
      editableInEasyView: false,
    },
    {
      id: "end",
      index: 5,
      title: "일시 중단",
      subtitle: "Pause",
      description: "손실 조건이 해소될 때까지 새 주문을 막습니다.",
      kind: "end",
      status: "ready",
      x: 680,
      y: 260,
      w: 142,
      params: [],
      editableInEasyView: false,
    },
  ];

  return finalizeEasyViewModel({
    title: "ETH 4시간 DCA 전략",
    summary: "4시간마다 ETH를 분할 매수하고 누적 손실 조건이 오면 중단합니다.",
    strategyType: "DCA",
    timeframe: "4시간",
    lastModified: nowLabel(),
    code,
    canvasWidth: 920,
    canvasHeight: 410,
    nodes,
    edges: buildEasyViewEdges(nodes, [
      ["start", "schedule", "시작"],
      ["schedule", "cex-buy", "주기 도달"],
      ["cex-buy", "risk", "체결 후"],
      ["risk", "end", "중단"],
    ]),
  });
}

export function createEasyViewFromStrategyCode(code: string, template: StrategyTemplate): EasyViewModel {
  if (template.id === "trend" || /20MA|crossover|volume/i.test(code)) return createTrendView(code);
  if (template.id === "dca" || /every 4h|DCA/i.test(code)) return createDcaView(code);
  return createBasisView(code, template);
}

function normalizeGraphText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeGraphNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readConfigText(config: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = normalizeGraphText(config[key]);
    if (value) return value;
  }
  return fallback;
}

function normalizeGraphTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return readConfigText(record, ["name", "label", "field", "metric", "key", "id"]);
        }
        if (typeof item === "number" && Number.isFinite(item)) return String(item);
        return "";
      })
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
}

function readConfigTextList(config: Record<string, unknown>, keys: string[], fallback: string[] = []) {
  for (const key of keys) {
    const values = normalizeGraphTextList(config[key]);
    if (values.length > 0) return values;
  }
  return fallback;
}

function inferEasyNodeKind(blockType: string, config: Record<string, unknown>): EasyNodeKind {
  const isExplicitRiskBlock = config.killSwitch === true || config.emergencyStop === true || config.circuitBreaker === true;
  if (isExplicitRiskBlock) {
    return "risk";
  }
  if (blockType === "action") {
    const actionType = normalizeGraphText(config.actionType || config.type).toUpperCase();
    const chainId = config.chainId || config.chain || config.contractAddress;
    return actionType === "DEX" || Boolean(chainId) ? "dex" : "cex";
  }
  if (blockType === "streaming") return "stream";
  if (blockType === "monitoring") return "stream";
  if (blockType === "trigger") return "condition";
  if (blockType === "normal") return "condition";
  if (isKillSwitchText(Object.values(config).map((value) => String(value ?? "")).join(" "))) {
    return "risk";
  }
  return "condition";
}

function buildParamsFromGraphConfig(nodeKind: EasyNodeKind, config: Record<string, unknown>): EasyViewParam[] {
  if (nodeKind !== "cex" && nodeKind !== "dex") return [];

  const labelMap: Record<string, string> = {
    exchange: "거래소",
    symbol: "심볼",
    side: "방향",
    orderType: "주문 방식",
    amount: "수량/금액",
    buyAmount: "매수 수량/금액",
    sellAmount: "매도 수량/금액",
    amountType: "금액 타입",
    price: "가격",
    leverage: "레버리지",
    chain: "체인",
    chainId: "체인 ID",
    evmChain: "EVM 체인",
    dexProtocol: "DEX 프로토콜",
    contractAddress: "컨트랙트",
    functionName: "함수",
    evmFunctionName: "EVM 함수",
    evmFunctionSignature: "함수 시그니처",
    executionMode: "실행 모드",
    paperStatus: "실행 상태",
    liveExecutable: "실전 실행 가능",
    tokenIn: "입력 토큰",
    tokenOut: "출력 토큰",
    slippage: "슬리피지",
  };

  const excludeKeys = new Set([
    "id",
    "type",
    "actionType",
    "name",
    "label",
    "title",
    "description",
    "summary",
    "overviewDescription",
    "easyDescription",
    "roleDescription",
    "easyRoleDescription",
    "inputDescription",
    "logicDescription",
    "outputDescription",
    "inputSummary",
    "easyInputSummary",
    "outputSummary",
    "easyOutputSummary",
    "tradingCriterion",
    "executionCriterion",
    "entryCriterion",
    "exitCriterion",
    "agentLoopObjective",
    "agentLoopWorkflow",
    "agentLoopCapability",
    "agentLoopEvidence",
    "agentLoopStageIds",
    "contractAbi",
    "missingExecutionPrerequisites",
    "condition",
    "expression",
    "code",
    "position",
    "url",
    "sourceUrl",
  ]);

  return Object.keys(config)
    .filter((key) => !excludeKeys.has(key) && config[key] !== undefined && config[key] !== null && typeof config[key] !== "object")
    .map((key) => {
      const val = String(config[key]);
      const isRef = val.includes("$");
      return {
        key,
        label: labelMap[key] ?? key,
        value: val,
        helper: isRef ? "외부 블록에서 제공되는 값입니다." : "AI가 생성한 실행 블록 파라미터",
        readonly: isRef,
      };
    });
}

function formatDurationFromMs(value: unknown) {
  const ms = normalizeGraphNumber(value, Number.NaN);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    days ? `${days}일` : "",
    hours ? `${hours}시간` : "",
    minutes ? `${minutes}분` : "",
    seconds || (!days && !hours && !minutes) ? `${seconds}초` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function humanizeCondition(condition: string) {
  return condition
    .replace(/::/g, ".")
    .replace(/&&/g, " 그리고 ")
    .replace(/\|\|/g, " 또는 ")
    .replace(/>=/g, " 이상")
    .replace(/<=/g, " 이하")
    .replace(/>/g, " 초과")
    .replace(/</g, " 미만")
    .replace(/==/g, " 같음")
    .replace(/!=/g, " 다름")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEasyNodeDetails(
  id: string,
  blockType: string,
  kind: EasyNodeKind,
  title: string,
  config: Record<string, unknown>,
) {
  const condition = readConfigText(config, ["condition", "predicate", "expression", "logic"]);
  const expression = readConfigText(config, ["expression", "formula", "logic", "code"]);
  const triggerType = readConfigText(config, ["triggerType", "type"]);
  const interval = formatDurationFromMs(config.intervalMs ?? config.updateIntervalMs);
  const inputs = readConfigTextList(config, ["inputs", "inputBlocks", "params", "parameters"]);
  const outputs = readConfigTextList(config, ["outputs", "outputBlocks", "outputData", "returns"]);
  const absorbedSourceTitles = readConfigTextList(config, ["absorbedSourceTitles"]);
  const actionTargetTitles = readConfigTextList(config, ["actionTargetTitles"]);
  const overviewDescription = readConfigText(config, ["overviewDescription", "easyDescription"]);
  const aiRoleDescription = readConfigText(config, ["roleDescription", "easyRoleDescription"]);
  const aiTradingCriterion = readConfigText(config, ["tradingCriterion", "executionCriterion", "entryCriterion", "exitCriterion"]);
  const aiInputSummary = readConfigText(config, ["inputSummary", "easyInputSummary"]);
  const aiOutputSummary = readConfigText(config, ["outputSummary", "easyOutputSummary"]);
  const isKillSwitch = kind === "risk" && (
    config.killSwitch === true ||
    config.emergencyStop === true ||
    config.circuitBreaker === true ||
    isKillSwitchText(`${id} ${title} ${collectEasyBlockText({ id, type: blockType, config })}`)
  );

  if (isKillSwitch) {
    const killDescription = blockType === "action"
      ? "열려 있는 주문을 취소하고 전략이 만든 포지션을 감소 전용으로 정리합니다."
      : "수동 중단, 손실 한도, 데이터 지연, 거래소 연결 이상이 감지되면 전략을 즉시 멈춥니다.";
    return {
      description: overviewDescription || readConfigText(config, ["description", "summary"], killDescription),
      roleDescription: aiRoleDescription || `${title}은 이 전략의 최종 안전장치입니다. 정상 매매 조건과 별개로 위험 상태가 발생하면 새 진입을 막고 종료 흐름을 실행합니다.`,
      conditionText: condition ? `킬스위치 조건: ${humanizeCondition(condition)}` : "킬스위치 조건: 수동 중단 또는 위험 한도 초과",
      inputSummary: aiInputSummary || "확인하는 값: 수동 중단, 누적 손실률, 데이터 지연, 거래소 연결 상태",
      outputSummary: aiOutputSummary || (blockType === "action" ? "내보내는 결과: 취소/청산 요청 상태" : "내보내는 값: 전체 종료 신호"),
    };
  }

  if (blockType === "trigger") {
    const conditionText = triggerType.toLowerCase() === "time"
      ? `시간 트리거: ${interval || "설정된 주기"}마다 true 신호를 냅니다.`
      : condition
        ? `조건 트리거: ${humanizeCondition(condition)}`
        : "조건 트리거: 연결된 입력이 충족될 때 true 신호를 냅니다.";
    const sourceText = absorbedSourceTitles.length > 0
      ? `${absorbedSourceTitles.join(", ")}을 기준으로 `
      : "";
    const targetText = actionTargetTitles.length > 0
      ? `${actionTargetTitles.join(", ")} 실행 여부`
      : "다음 거래 실행 여부";
    return {
      description: overviewDescription || readConfigText(config, ["description", "summary"], conditionText),
      roleDescription: aiRoleDescription || `${title}은 ${sourceText}${targetText}를 판단합니다. 조건이 충족되는 순간에만 연결된 실행 블록으로 신호를 보냅니다.`,
      conditionText,
      inputSummary: aiInputSummary || (absorbedSourceTitles.length > 0
        ? `확인하는 값: ${absorbedSourceTitles.join(", ")}`
        : inputs.length > 0
          ? `확인하는 값: ${inputs.join(", ")}`
          : "확인하는 값: 연결된 시장 데이터/계산 결과"),
      outputSummary: aiOutputSummary || (outputs.length > 0 ? `내보내는 값: ${outputs.join(", ")}` : "내보내는 값: 실행 신호"),
    };
  }

  if (blockType === "normal") {
    const conditionText = expression ? `계산식: ${expression}` : condition ? `조건식: ${condition}` : "";
    return {
      description: overviewDescription || readConfigText(config, ["description", "summary"], conditionText || `${title} 값을 계산합니다.`),
      roleDescription: aiRoleDescription || `${title}은 이 전략에서 원본 데이터를 실행 조건이나 주문 파라미터로 쓸 수 있는 계산값으로 바꿉니다.`,
      conditionText,
      inputSummary: aiInputSummary || (inputs.length > 0 ? `받는 입력: ${inputs.join(", ")}` : "받는 입력: 연결된 스트림/이전 계산값"),
      outputSummary: aiOutputSummary || (outputs.length > 0 ? `내보내는 값: ${outputs.join(", ")}` : "내보내는 값: 계산 결과"),
    };
  }

  if (blockType === "streaming") {
    const fields = readConfigTextList(config, ["fields", "outputs", "outputBlocks"], ["lastPrice"]);
    const source = readConfigText(config, ["sourceUrl", "url", "endpoint", "source"], "데이터 소스");
    return {
      description: overviewDescription || readConfigText(config, ["description", "summary"], `${source}에서 ${fields.join(", ")} 데이터를 받아옵니다.`),
      roleDescription: aiRoleDescription || `${title}은 이 전략의 원본 시장 데이터를 공급합니다. 이 값은 직접 주문을 실행하지 않고 계산/조건 블록으로 전달됩니다.`,
      conditionText: interval ? `갱신 주기: ${interval}` : "",
      inputSummary: aiInputSummary || "받는 입력: 없음",
      outputSummary: aiOutputSummary || `내보내는 값: ${fields.join(", ")}`,
    };
  }

  if (blockType === "action") {
    const venue = readConfigText(config, ["exchange", "venue", "chain"], kind === "dex" ? "DEX" : "CEX");
    const symbol = readConfigText(config, ["symbol", "market", "tokenOut", "contractAddress"], "");
    const side = readConfigText(config, ["side", "orderSide", "method", "functionName"], "");
    return {
      description: overviewDescription || readConfigText(config, ["description", "summary"], `${venue}${symbol ? ` ${symbol}` : ""}${side ? ` ${side}` : ""} 실행 블록입니다.`),
      roleDescription: aiRoleDescription || `${title}은 트리거가 충족됐을 때 실제 주문/스왑을 제출합니다. 결과값은 후속 계산이나 확인 트리거에서 다시 데이터로 사용할 수 있습니다.`,
      conditionText: aiTradingCriterion || "연결된 매매 기준이 충족될 때만 실행됩니다.",
      inputSummary: aiInputSummary || (inputs.length > 0 ? `받는 입력: ${inputs.join(", ")}` : "받는 입력: 주문 수량, 가격, 신호 등"),
      outputSummary: aiOutputSummary || (outputs.length > 0 ? `내보내는 결과: ${outputs.join(", ")}` : "내보내는 결과: orderId/status/filledQty/avgFillPrice"),
    };
  }

  return {
    description: overviewDescription || readConfigText(config, ["description", "summary", "condition", "url"], `${title} 블록`),
    roleDescription: aiRoleDescription || `${title}은 이 전략의 흐름 안에서 연결된 블록으로 데이터를 전달하거나 상태를 보여줍니다.`,
    conditionText: condition ? `조건/로직: ${condition}` : "",
    inputSummary: aiInputSummary || (inputs.length > 0 ? `받는 입력: ${inputs.join(", ")}` : "받는 입력: 연결된 이전 블록"),
    outputSummary: aiOutputSummary || (outputs.length > 0 ? `내보내는 값: ${outputs.join(", ")}` : "내보내는 값: 연결된 다음 블록으로 전달"),
  };
}

function getBlockConfig(block: StrategyGraphBlock): Record<string, unknown> {
  return block.config && typeof block.config === "object" ? block.config : {};
}

function getBlockId(block: StrategyGraphBlock, index = 0) {
  return normalizeGraphText(block.id, `ai-block-${index + 1}`);
}

function getBlockType(block: StrategyGraphBlock) {
  return normalizeGraphText(block.type, "normal");
}

function isFixedValueBlock(block: StrategyGraphBlock) {
  const blockType = getBlockType(block);
  if (blockType !== "normal") return false;

  const config = getBlockConfig(block);
  const fixedKeys = ["value", "constant", "threshold", "limit", "amount", "quote", "price"];
  const computedKeys = ["source", "sourceId", "fromId", "expression", "logic", "code", "formula", "inputs", "inputBlocks"];
  const hasFixedPrimitive = fixedKeys.some((key) => {
    const value = config[key];
    return ["string", "number", "boolean"].includes(typeof value);
  });
  const hasComputedInput = computedKeys.some((key) => config[key] !== undefined && config[key] !== null);

  return hasFixedPrimitive && !hasComputedInput;
}

function isVisibleEasyBlock(block: StrategyGraphBlock) {
  const blockType = getBlockType(block);
  if (blockType === "monitoring") return false;
  if (isFixedValueBlock(block)) return false;
  return true;
}

function hasConfigValue(config: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value)) return true;
    return normalizeGraphText(value).length > 0;
  });
}

function readFixedBlockValue(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  for (const key of ["value", "constant", "threshold", "limit", "amount", "quote", "price"]) {
    const value = config[key];
    if (["string", "number", "boolean"].includes(typeof value)) return value;
  }
  return undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function conditionMentionsBlock(condition: string, blockId: string) {
  if (!condition || !blockId) return false;
  return condition.includes(`${blockId}::`) || new RegExp(`(^|[^a-zA-Z0-9_-])${escapeRegExp(blockId)}([^a-zA-Z0-9_-]|$)`).test(condition);
}

function uniqueTexts(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getMonitoringBlocksForStream(
  streamId: string,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  const monitors: StrategyGraphBlock[] = [];

  for (const connection of connections) {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const kind = normalizeGraphText(connection.kind);
    const targetBlock = blocksById.get(target);
    if (source === streamId && kind === "stream-monitor" && targetBlock && getBlockType(targetBlock) === "monitoring") {
      monitors.push(targetBlock);
    }
  }

  blocksById.forEach((block) => {
    if (getBlockType(block) !== "monitoring") return;
    const config = getBlockConfig(block);
    const connectedStreamId = readConfigText(config, ["connectedStreamId", "streamId", "sourceId", "fromId"]);
    if (connectedStreamId === streamId && !monitors.includes(block)) monitors.push(block);
  });

  return monitors;
}

function buildStreamingChart(block: StrategyGraphBlock, monitors: StrategyGraphBlock[]): EasyViewChart {
  const config = getBlockConfig(block);
  const id = getBlockId(block);
  const title = readConfigText(config, ["symbol", "name", "label", "title"], id);
  const streamFields = readConfigTextList(config, ["fields", "outputBlocks", "outputs", "outputData"], ["price", "volume"]);
  const monitorFields = monitors.flatMap((monitor) => {
    const monitorConfig = getBlockConfig(monitor);
    const condition = monitorConfig.condition && typeof monitorConfig.condition === "object"
      ? monitorConfig.condition as Record<string, unknown>
      : {};
    return [
      ...readConfigTextList(monitorConfig, ["fields", "selectedVariables", "outputs"]),
      readConfigText(monitorConfig, ["metric", "field"]),
      readConfigText(condition, ["metric", "field"]),
    ];
  });
  const highlight = monitors
    .map((monitor) => readConfigText(getBlockConfig(monitor), ["name", "label", "title", "metric"]))
    .filter(Boolean)[0];

  return {
    title,
    fields: uniqueTexts([...streamFields, ...monitorFields]).slice(0, 4),
    highlight,
  };
}

const STRATEGY_CONNECTION_KIND_SET = new Set([
  "action-input",
  "action-result",
  "data-flow",
  "stream-monitor",
  "trigger-action",
  "trigger-input",
  "sequence",
  "condition",
  "data",
]);

function compactEasyEdgeLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 9)}...`;
}

function readEasyConnectionLabel(connection?: StrategyGraphConnection) {
  if (!connection) return "";
  const record = connection as Record<string, unknown>;
  const label = normalizeGraphText(
    record.easyLabel ?? record.label ?? record.title ?? record.description ?? record.summary,
  );
  if (!label || STRATEGY_CONNECTION_KIND_SET.has(label.toLowerCase())) return "";
  return compactEasyEdgeLabel(label);
}

function withEasyConnectionLabel(connection: StrategyGraphConnection) {
  const label = readEasyConnectionLabel(connection);
  return label ? { easyLabel: label } : {};
}

function edgeTextForIntent(node?: EasyViewNode) {
  return `${node?.id ?? ""} ${node?.title ?? ""} ${node?.subtitle ?? ""} ${node?.description ?? ""} ${node?.conditionText ?? ""}`.toLowerCase();
}

function inferEasyConnectionLabel(kind: string, sourceNode?: EasyViewNode, targetNode?: EasyViewNode) {
  const normalized = kind.trim().toLowerCase();
  const sourceText = edgeTextForIntent(sourceNode);
  const targetText = edgeTextForIntent(targetNode);
  const combinedText = `${sourceText} ${targetText}`;

  if (sourceNode?.kind === "risk" || targetNode?.kind === "risk" || /kill|emergency|긴급|비상|중단|회수/.test(combinedText)) {
    return "위험 중단";
  }
  if (targetNode?.kind === "monitor") return "상태 추적";
  if (sourceNode?.kind === "stream") return "시세 전달";
  if (normalized === "action-result") return /claim|reward|보상/.test(combinedText) ? "보상 결과" : "체결 결과";
  if (normalized === "action-input") return targetNode?.kind === "cex" || targetNode?.kind === "dex" ? "주문 입력" : "입력";
  if (normalized === "data-flow") return targetNode?.kind === "condition" ? "신호 계산" : "데이터";
  if (normalized === "trigger-input") return sourceNode?.kind === "start" ? "시작 승인" : "조건 입력";
  if (normalized === "trigger-action" || sourceNode?.kind === "condition") {
    if (/close|exit|sell|청산|종료/.test(targetText)) return "청산 실행";
    if (/hedge|short|perp|선물|헤지/.test(targetText)) return "헤지 실행";
    if (/rebalance|리밸런/.test(targetText)) return "리밸런싱";
    return "조건 충족";
  }
  if (targetNode?.kind === "cex" || targetNode?.kind === "dex") return "실행";
  if (targetNode?.kind === "end") return "종료";
  return getEasyConnectionLabel(normalized || kind);
}

function getEasyEdgeLabel(
  connection: StrategyGraphConnection | undefined,
  kind: string,
  sourceNode?: EasyViewNode,
  targetNode?: EasyViewNode,
) {
  return readEasyConnectionLabel(connection) || inferEasyConnectionLabel(kind, sourceNode, targetNode);
}

function getEasyConnectionLabel(kind: string) {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "action-input") return "입력";
  if (normalized === "action-result") return "결과";
  if (normalized === "data-flow") return "데이터";
  if (normalized === "trigger-action") return "실행";
  if (normalized === "trigger-input") return "조건 입력";
  if (normalized === "stream-monitor") return "차트";
  if (normalized === "sequence") return "다음";
  if (normalized === "condition") return "조건";
  if (normalized === "data") return "데이터";
  return kind;
}

function resolveEasyEdgeKind(connectionKind: string, sourceNode?: EasyViewNode, targetNode?: EasyViewNode): EasyEdgeKind {
  const normalized = connectionKind.toLowerCase();
  if (normalized === "action-input" || normalized === "action-result" || normalized === "data-flow" || normalized === "trigger-input" || sourceNode?.kind === "stream") return "data";
  if (normalized === "trigger-action" || sourceNode?.kind === "condition") return "condition";
  if (sourceNode?.kind === "risk" || targetNode?.kind === "end") return "risk";
  if (targetNode?.kind === "cex" || targetNode?.kind === "dex") return "sequence";
  return "sequence";
}

function connectionPairKey(source: string, target: string) {
  return `${source}->${target}`;
}

function blockCanSeedSharedDataPipeline(block: StrategyGraphBlock) {
  const blockType = getBlockType(block);
  return blockType === "streaming" || (blockType === "normal" && !isFixedValueBlock(block));
}

function blockIsSharedPipelineEffect(block: StrategyGraphBlock) {
  return getBlockType(block) === "action" && !isKillSwitchBlock(block);
}

function isSharedPipelineTraversalKind(kind: string) {
  return [
    "action-input",
    "condition",
    "data",
    "data-flow",
    "sequence",
    "signal",
    "trigger",
    "trigger-action",
    "trigger-input",
  ].includes(kind.toLowerCase());
}

function analyzeSharedDataPipelines(
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
) {
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const outgoingById = new Map<string, StrategyGraphConnection[]>();
  connections.forEach((connection) => {
    const source = normalizeGraphText(connection.fromId);
    if (!source) return;
    const list = outgoingById.get(source) ?? [];
    list.push(connection);
    outgoingById.set(source, list);
  });

  const sourceIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const actionTargetsBySource = new Map<string, Set<string>>();

  blocksById.forEach((block, sourceId) => {
    if (!blockCanSeedSharedDataPipeline(block)) return;
    const pathsByAction = new Map<string, string[][]>();
    const queue: Array<{ id: string; depth: number; path: string[] }> = [{ id: sourceId, depth: 0, path: [] }];
    const visited = new Set<string>([`${sourceId}:0`]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth > 5) continue;

      for (const connection of outgoingById.get(current.id) ?? []) {
        const kind = normalizeGraphText(connection.kind, "data-flow");
        if (!isSharedPipelineTraversalKind(kind)) continue;

        const targetId = normalizeGraphText(connection.toId);
        const targetBlock = blocksById.get(targetId);
        if (!targetId || !targetBlock) continue;

        const pairKey = connectionPairKey(current.id, targetId);
        const nextPath = [...current.path, pairKey];
        if (getBlockType(targetBlock) === "action") {
          if (!blockIsSharedPipelineEffect(targetBlock)) continue;
          const actionPaths = pathsByAction.get(targetId) ?? [];
          actionPaths.push(nextPath);
          pathsByAction.set(targetId, actionPaths);
          continue;
        }

        if (getBlockType(targetBlock) === "monitoring") continue;
        const visitKey = `${targetId}:${current.depth + 1}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        queue.push({ id: targetId, depth: current.depth + 1, path: nextPath });
      }
    }

    if (pathsByAction.size < 2) return;
    sourceIds.add(sourceId);
    actionTargetsBySource.set(sourceId, new Set(pathsByAction.keys()));
    pathsByAction.forEach((paths) => paths.forEach((path) => path.forEach((edgeKey) => edgeKeys.add(edgeKey))));
  });

  return { sourceIds, edgeKeys, actionTargetsBySource };
}

type EasyTriggerAbsorption = {
  hiddenIds: Set<string>;
  sourceToTrigger: Map<string, string>;
  triggerToSources: Map<string, StrategyGraphBlock[]>;
};

type EasyWorkflowGroupSpec = {
  id: string;
  title: string;
  purpose: string;
  sequenceType?: string;
  order?: number;
  nodeIds: string[];
  canAbstract: boolean;
  mustStayVisibleNodeIds: string[];
  sharedDataPipeline?: boolean;
  checkEffect?: unknown;
};

function normalizeEasyWorkflowGroups(strategyGraph: StrategyGraphPayload): EasyWorkflowGroupSpec[] {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const rawGroups = Array.isArray(metadata.workflowGroups) ? metadata.workflowGroups : [];
  const groups = rawGroups
    .map((group, index): EasyWorkflowGroupSpec | null => {
      if (!group || typeof group !== "object") return null;
      const item = group as Record<string, unknown>;
      const id = normalizeGraphText(item.id ?? item.workflowId ?? item.name, `workflow-${index + 1}`);
      return {
        id,
        title: readConfigText(item, ["title", "label", "name"], id),
        purpose: readConfigText(item, ["purpose", "description", "summary"], ""),
        sequenceType: readConfigText(item, ["sequenceType", "type"], ""),
        order: normalizeGraphNumber(item.order, index + 1),
        nodeIds: normalizeGraphTextList(item.nodeIds ?? item.nodes ?? item.blockIds),
        canAbstract: item.canAbstract !== false,
        mustStayVisibleNodeIds: normalizeGraphTextList(item.mustStayVisibleNodeIds ?? item.visibleNodeIds ?? item.anchorNodeIds),
        sharedDataPipeline: item.sharedDataPipeline === true,
        checkEffect: item.checkEffect,
      };
    });
  return groups.filter((group) => Boolean(group?.id)) as EasyWorkflowGroupSpec[];
}

function getBlockWorkflowId(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  return readConfigText(config, ["workflowId", "workflow", "phaseId"], "");
}

function collectWorkflowForcedVisibleIds(workflowGroups: EasyWorkflowGroupSpec[]) {
  const visibleIds = new Set<string>();
  workflowGroups.forEach((group) => {
    if (!group.canAbstract) {
      group.nodeIds.forEach((id) => visibleIds.add(id));
    }
    group.mustStayVisibleNodeIds.forEach((id) => visibleIds.add(id));
  });
  return visibleIds;
}

function buildWorkflowComponentSpecs(
  workflowGroups: EasyWorkflowGroupSpec[],
  abstractableIds: Set<string>,
  blocksById: Map<string, StrategyGraphBlock>,
) {
  const assignedIds = new Set<string>();
  const componentSpecs: Array<{
    id: string;
    memberIds: string[];
    blocks: StrategyGraphBlock[];
    title?: string;
    purpose?: string;
  }> = [];

  workflowGroups.forEach((group) => {
    if (!group.canAbstract) return;
    const memberIdSet = new Set(group.nodeIds);
    blocksById.forEach((block, blockId) => {
      if (getBlockWorkflowId(block) === group.id) memberIdSet.add(blockId);
    });

    const memberIds = Array.from(memberIdSet).filter((id) => abstractableIds.has(id));
    if (memberIds.length === 0) return;
    const blocks = memberIds
      .map((memberId) => blocksById.get(memberId))
      .filter((block): block is StrategyGraphBlock => Boolean(block));
    if (blocks.length === 0) return;
    memberIds.forEach((id) => assignedIds.add(id));
    componentSpecs.push({
      id: `workflow-${group.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72)}`,
      memberIds,
      blocks,
      title: group.title,
      purpose: group.purpose,
    });
  });

  return { componentSpecs, assignedIds };
}

function buildEasyTriggerAbsorption(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]): EasyTriggerAbsorption {
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const hiddenIds = new Set<string>();
  const sourceToTrigger = new Map<string, string>();
  const triggerToSources = new Map<string, StrategyGraphBlock[]>();

  blocks.forEach((block, index) => {
    if (!isConditionTriggerBlock(block)) return;
    const triggerId = getBlockId(block, index);
    const normalSources = getTriggerNormalSources(triggerId, block, blocksById, connections);
    const absorbableSources = normalSources.filter((sourceId) => {
      const sourceBlock = blocksById.get(sourceId);
      if (!sourceBlock || !isVisibleEasyBlock(sourceBlock)) return false;
      const outgoing = getOutgoingConnections(connections, sourceId).filter((connection) => {
        const kind = normalizeGraphText(connection.kind);
        if (kind === "stream-monitor") return false;
        return normalizeGraphText(connection.toId) !== triggerId;
      });
      return outgoing.length === 0;
    });

    if (absorbableSources.length === 0) return;
    triggerToSources.set(
      triggerId,
      absorbableSources
        .map((sourceId) => blocksById.get(sourceId))
        .filter((sourceBlock): sourceBlock is StrategyGraphBlock => Boolean(sourceBlock)),
    );
    absorbableSources.forEach((sourceId) => {
      hiddenIds.add(sourceId);
      sourceToTrigger.set(sourceId, triggerId);
    });
  });

  return { hiddenIds, sourceToTrigger, triggerToSources };
}

function buildEffectiveEasyConnections(
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
  absorption: EasyTriggerAbsorption,
) {
  const visibleIds = new Set(
    blocks
      .filter((block, index) => isVisibleEasyBlock(block) && !absorption.hiddenIds.has(getBlockId(block, index)))
      .map((block, index) => getBlockId(block, index)),
  );
  const effective: StrategyGraphConnection[] = connections.filter((connection) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const kind = normalizeGraphText(connection.kind);
    if (kind === "stream-monitor") return false;
    if (absorption.hiddenIds.has(source) && absorption.sourceToTrigger.get(source) === target) return false;
    return visibleIds.has(source) && visibleIds.has(target);
  });
  const existing = new Set(effective.map((connection) => `${normalizeGraphText(connection.fromId)}->${normalizeGraphText(connection.toId)}`));

  connections.forEach((connection, index) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const remappedTarget = absorption.sourceToTrigger.get(target);
    if (!remappedTarget || !visibleIds.has(source) || !visibleIds.has(remappedTarget) || source === remappedTarget) return;
    const key = `${source}->${remappedTarget}`;
    if (existing.has(key)) return;
    existing.add(key);
    effective.push({
      id: `${normalizeGraphText(connection.id, `easy-edge-${index}`)}-absorbed-input`,
      kind: "data-flow",
      fromId: source,
      toId: remappedTarget,
    });
  });

  blocks.forEach((block, triggerIndex) => {
    if (getBlockType(block) !== "trigger" || !isVisibleEasyBlock(block)) return;
    const triggerId = getBlockId(block, triggerIndex);
    const condition = readConfigText(getBlockConfig(block), ["condition", "expression", "logic"]);
    if (!condition) return;

    blocks.forEach((sourceBlock, sourceIndex) => {
      if (!isVisibleEasyBlock(sourceBlock)) return;
      const sourceId = getBlockId(sourceBlock, sourceIndex);
      if (absorption.hiddenIds.has(sourceId)) return;
      if (sourceId === triggerId || !conditionMentionsBlock(condition, sourceId)) return;
      const key = `${sourceId}->${triggerId}`;
      if (existing.has(key)) return;
      existing.add(key);
      effective.push({
        id: `derived-trigger-input-${sourceId}-${triggerId}`,
        kind: "trigger-input",
        fromId: sourceId,
        toId: triggerId,
      });
    });
  });

  return effective;
}

function inferEasyActionIntent(actionBlocks: StrategyGraphBlock[]) {
  const text = actionBlocks
    .map((block) => {
      const config = getBlockConfig(block);
      return [
        readConfigText(config, ["name", "label", "title", "description", "summary"]),
        readConfigText(config, ["side", "orderSide", "method", "functionName"]),
      ].join(" ");
    })
    .join(" ")
    .toLowerCase();

  if (/close|exit|sell|stop|loss|청산|종료|손실|중단/.test(text)) return "청산 기준";
  if (/rebalance|hedge|adjust|리밸런|헤지|조정/.test(text)) return "관리 기준";
  return "진입 기준";
}

function getFriendlyEasySubtitle(blockType: string, kind: EasyNodeKind, config: Record<string, unknown>) {
  if (kind === "stream") return "시장 데이터";
  if (kind === "cex") return "거래소 주문";
  if (kind === "dex") return "온체인 실행";
  if (kind === "risk") return "리스크 기준";
  if (kind === "monitor") return "상태 확인";
  if (blockType === "trigger") {
    const triggerType = readConfigText(config, ["triggerType", "type"]).toLowerCase();
    return triggerType === "time" ? "시간 기준" : "매매 기준";
  }
  if (blockType === "normal") return "지표 계산";
  if (kind === "start") return "시작";
  return "전략 단계";
}

function buildEasyTriggerConfig(
  triggerBlock: StrategyGraphBlock,
  absorbedSources: StrategyGraphBlock[],
  actionTargets: StrategyGraphBlock[],
) {
  const config = getBlockConfig(triggerBlock);
  if (absorbedSources.length === 0 && actionTargets.length === 0) return config;

  const sourceTitles = absorbedSources.map((source) => {
    const sourceConfig = getBlockConfig(source);
    return readConfigText(sourceConfig, ["name", "label", "title", "functionName"], getBlockId(source));
  });
  const sourceSummaries = absorbedSources.map((source) => {
    const sourceConfig = getBlockConfig(source);
    return readConfigText(
      sourceConfig,
      ["description", "summary", "expression", "formula", "logic"],
      readConfigText(sourceConfig, ["name", "label", "title"], getBlockId(source)),
    );
  });
  const actionTitles = actionTargets.map((target) => {
    const targetConfig = getBlockConfig(target);
    return readConfigText(targetConfig, ["name", "label", "title", "functionName", "symbol"], getBlockId(target));
  });
  const easyTitle = inferEasyActionIntent(actionTargets);
  const condition = readConfigText(config, ["condition", "predicate", "expression", "logic"]);
  const sourceText = sourceTitles.length > 0 ? `${sourceTitles.join(", ")} 확인 후 ` : "";
  const conditionText = condition ? humanizeCondition(condition) : "설정된 조건 충족";

  return {
    ...config,
    easyTitle,
    absorbedSourceTitles: sourceTitles,
    actionTargetTitles: actionTitles,
    description: readConfigText(
      config,
      ["description", "summary"],
      `${sourceText}${conditionText}이면 ${actionTitles.join(", ") || "다음 거래"}를 실행합니다.`,
    ),
    inputDescription: sourceSummaries.join(" / "),
  };
}

function graphBlockToEasyNode(
  block: StrategyGraphBlock,
  index: number,
  level: number,
  row: number,
  chart?: EasyViewChart,
): EasyViewNode {
  const config = block.config && typeof block.config === "object" ? block.config : {};
  const id = normalizeGraphText(block.id, `ai-block-${index + 1}`);
  const blockType = normalizeGraphText(block.type, "normal");
  const kind = inferEasyNodeKind(blockType, config);
  const title = readConfigText(config, ["easyTitle", "name", "label", "title", "functionName", "symbol"], id);
  const details = buildEasyNodeDetails(id, blockType, kind, title, config);
  const x = EASY_ORIGIN_X + level * EASY_COLUMN_GAP;
  const y = EASY_ORIGIN_Y + row * EASY_ROW_GAP;

  return {
    id,
    index: index + 1,
    title,
    subtitle: getFriendlyEasySubtitle(blockType, kind, config),
    description: details.description,
    roleDescription: details.roleDescription,
    conditionText: details.conditionText,
    inputSummary: details.inputSummary,
    outputSummary: details.outputSummary,
    kind,
    status: kind === "risk" ? "blocked" : kind === "condition" ? "running" : kind === "stream" || kind === "monitor" ? "watching" : "ready",
    x,
    y,
    w: kind === "stream" ? 196 : kind === "condition" || kind === "risk" ? 152 : 168,
    params: buildParamsFromGraphConfig(kind, config),
    editableInEasyView: kind === "cex" || kind === "dex",
    chart,
    sourceBlockIds: [id],
  };
}

function isEasyEditableBlock(block: StrategyGraphBlock) {
  const kind = inferEasyNodeKind(getBlockType(block), getBlockConfig(block));
  return kind === "cex" || kind === "dex";
}

function buildEasyBranchAnchorIds(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]) {
  const triggerIds = blocks
    .map((block, index) => ({ block, id: getBlockId(block, index) }))
    .filter(({ block, id }) =>
      getBlockType(block) === "trigger" &&
      connections.some((connection) =>
        normalizeGraphText(connection.kind) === "trigger-action" &&
        normalizeGraphText(connection.fromId) === id,
      ),
    )
    .map(({ id }) => id);

  return new Set(triggerIds.length > 1 ? triggerIds : []);
}

function inferAbstractNodeKind(blocks: StrategyGraphBlock[]): EasyNodeKind {
  const text = blocks.map((block) => `${getBlockType(block)} ${collectEasyBlockText(block)}`).join(" ").toLowerCase();
  if (/loss|stop|close|exit|risk|청산|손실|중단|리스크/.test(text)) return "risk";
  if (blocks.some((block) => getBlockType(block) === "trigger" || getBlockType(block) === "normal")) return "condition";
  if (blocks.some((block) => getBlockType(block) === "streaming")) return "stream";
  return "condition";
}

function collectEasyBlockText(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  return [
    getBlockId(block),
    getBlockType(block),
    readConfigText(config, ["easyTitle", "name", "label", "title", "functionName", "symbol"]),
    readConfigText(config, ["overviewDescription", "description", "summary", "roleDescription"]),
    readConfigText(config, ["expression", "formula", "condition", "logic", "code"]),
  ].filter(Boolean).join(" ");
}

function inferAbstractNodeTitle(blocks: StrategyGraphBlock[], prompt = "") {
  const text = `${prompt} ${blocks.map(collectEasyBlockText).join(" ")}`.toLowerCase();
  if (/basis|spread|현선|베이시스|가격차|괴리/.test(text)) return "가격차 감시";
  if (/funding|펀딩/.test(text)) return "펀딩 조건 확인";
  if (/dca|interval|schedule|timer|every|마다|주기|정기/.test(text)) return "실행 주기 확인";
  if (/ma|moving|crossover|trend|volume|이동평균|추세|거래량|돌파/.test(text)) return "추세 조건 확인";
  if (/rsi/.test(text)) return "RSI 조건 확인";
  if (/loss|stop|close|exit|청산|손실|중단/.test(text)) return "청산 조건 확인";
  if (blocks.every((block) => getBlockType(block) === "streaming")) return "시장 데이터 수집";
  return "시장 조건 확인";
}

function summarizeAbstractMemberDescriptions(blocks: StrategyGraphBlock[]) {
  return uniqueTexts(
    blocks
      .map((block) => {
        const config = getBlockConfig(block);
        return readConfigText(config, ["roleDescription", "overviewDescription", "description", "summary", "expression", "formula", "condition"]);
      })
      .filter(Boolean),
  );
}

function buildAbstractEasyNode(
  id: string,
  memberBlocks: StrategyGraphBlock[],
  index: number,
  level: number,
  row: number,
  prompt: string,
  chart?: EasyViewChart,
  workflowTitle?: string,
  workflowPurpose?: string,
): EasyViewNode {
  const sourceBlockIds = memberBlocks.map((block, memberIndex) => getBlockId(block, memberIndex));
  const title = workflowTitle || inferAbstractNodeTitle(memberBlocks, prompt);
  const kind = inferAbstractNodeKind(memberBlocks);
  const descriptions = summarizeAbstractMemberDescriptions(memberBlocks);
  const description = workflowPurpose || descriptions[0] || `${title} 단계입니다.`;
  const roleDescription = workflowPurpose
    ? `${title} 워크플로우는 ${workflowPurpose}`
    : descriptions.length > 0
    ? descriptions.slice(0, 2).join(" ")
    : `${title} 단계는 쉬운 보기에서 직접 조정하지 않는 데이터 수집, 계산, 조건 확인을 하나로 묶어 보여줍니다.`;

  return {
    id,
    index: index + 1,
    title,
    subtitle: `${memberBlocks.length}개 노드 요약`,
    description,
    roleDescription,
    conditionText: "",
    inputSummary: "입력: 이전 단계의 시장 데이터와 계산값",
    outputSummary: "출력: 다음 거래 실행에 필요한 조건 신호 또는 주문 입력값",
    kind,
    status: kind === "stream" ? "watching" : kind === "risk" ? "blocked" : "running",
    x: EASY_ORIGIN_X + level * EASY_COLUMN_GAP,
    y: EASY_ORIGIN_Y + row * EASY_ROW_GAP,
    w: kind === "stream" ? 218 : 210,
    params: [],
    editableInEasyView: false,
    chart,
    sourceBlockIds,
    isAbstracted: memberBlocks.length > 1,
  };
}

function computeGraphLayout(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]) {
  const ids = blocks.map((block, index) => normalizeGraphText(block.id, `ai-block-${index + 1}`));
  const idSet = new Set(ids);
  const originalIndex = new Map(ids.map((id, index) => [id, index]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const incomingById = new Map(ids.map((id) => [id, [] as string[]]));

  for (const connection of connections) {
    const fromId = normalizeGraphText(connection.fromId);
    const toId = normalizeGraphText(connection.toId);
    if (!idSet.has(fromId) || !idSet.has(toId)) continue;
    outgoing.get(fromId)?.push(toId);
    incomingById.get(toId)?.push(fromId);
    incoming.set(toId, (incoming.get(toId) ?? 0) + 1);
  }

  const queue = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  const levelById = new Map(ids.map((id) => [id, 0]));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    visited.add(current);
    const currentLevel = levelById.get(current) ?? 0;
    for (const target of outgoing.get(current) ?? []) {
      levelById.set(target, Math.max(levelById.get(target) ?? 0, currentLevel + 1));
      incoming.set(target, (incoming.get(target) ?? 0) - 1);
      if ((incoming.get(target) ?? 0) === 0) queue.push(target);
    }
  }

  ids.forEach((id) => {
    if (!visited.has(id)) {
      const parentLevels = (incomingById.get(id) ?? []).map((source) => levelById.get(source) ?? 0);
      levelById.set(id, parentLevels.length > 0 ? Math.max(...parentLevels) + 1 : 0);
    }
  });

  const idsByLevel = new Map<number, string[]>();
  ids.forEach((id) => {
    const level = levelById.get(id) ?? 0;
    const group = idsByLevel.get(level) ?? [];
    group.push(id);
    idsByLevel.set(level, group);
  });
  const rowById = new Map<string, number>();
  const result: Array<{ id: string; level: number; row: number }> = [];

  Array.from(idsByLevel.keys()).sort((a, b) => a - b).forEach((level) => {
    const group = idsByLevel.get(level) ?? [];
    group.sort((a, b) => {
      const averageParentRow = (id: string) => {
        const parentRows = (incomingById.get(id) ?? [])
          .map((source) => rowById.get(source))
          .filter((row): row is number => typeof row === "number");
        if (parentRows.length === 0) return originalIndex.get(id) ?? 0;
        return parentRows.reduce((sum, row) => sum + row, 0) / parentRows.length;
      };

      return averageParentRow(a) - averageParentRow(b) || (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
    });

    group.forEach((id, row) => {
      rowById.set(id, row);
      result.push({ id, level, row });
    });
  });

  return result;
}

export function strategyGraphToCode(strategyGraph: StrategyGraphPayload): string {
  const name = normalizeGraphText(strategyGraph.strategy?.name, "AI generated strategy");
  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  const connections = Array.isArray(strategyGraph.connections) ? strategyGraph.connections : [];
  const payload = {
    schemaVersion: normalizeGraphNumber(strategyGraph.schemaVersion, 1),
    kind: normalizeGraphText(strategyGraph.kind, "hershy-strategy-graph"),
    strategy: {
      id: normalizeGraphText(strategyGraph.strategy?.id, "ai-generated-strategy"),
      name,
    },
    generatedAt: normalizeGraphText(strategyGraph.generatedAt, new Date().toISOString()),
    summary: strategyGraph.summary && typeof strategyGraph.summary === "object"
      ? strategyGraph.summary
      : {
        blocks: blocks.length,
        connections: connections.length,
      },
    metadata: strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {},
    blocks,
    connections,
  };

  return JSON.stringify(payload, null, 2);
}

export function createEasyViewFromStrategyGraph(strategyGraph: StrategyGraphPayload, prompt = ""): EasyViewModel {
  const normalizedStrategyGraph = withStrategyKillSwitch(strategyGraph);
  const allBlocks = Array.isArray(normalizedStrategyGraph.blocks) ? normalizedStrategyGraph.blocks : [];
  const connections = Array.isArray(normalizedStrategyGraph.connections) ? normalizedStrategyGraph.connections : [];
  const absorption = buildEasyTriggerAbsorption(allBlocks, connections);
  const visibleBlocks = allBlocks.filter((block, index) => isVisibleEasyBlock(block) && !absorption.hiddenIds.has(getBlockId(block, index)));
  const blocksById = new Map(allBlocks.map((block, index) => [getBlockId(block, index), block]));
  const effectiveConnections = buildEffectiveEasyConnections(allBlocks, connections, absorption);
  const sharedPipeline = analyzeSharedDataPipelines(allBlocks, effectiveConnections);
  const visibleIdSet = new Set(visibleBlocks.map((block, index) => getBlockId(block, index)));
  const branchAnchorIds = buildEasyBranchAnchorIds(visibleBlocks, effectiveConnections);
  const workflowGroups = normalizeEasyWorkflowGroups(normalizedStrategyGraph);
  const workflowForcedVisibleIds = collectWorkflowForcedVisibleIds(workflowGroups);
  const anchorIds = new Set(
    visibleBlocks
      .map((block, index) => ({ block, id: getBlockId(block, index) }))
      .filter(({ block, id }) =>
        isEasyEditableBlock(block) ||
        branchAnchorIds.has(id) ||
        sharedPipeline.sourceIds.has(id) ||
        isKillSwitchBlock(block) ||
        workflowForcedVisibleIds.has(id))
      .map(({ id }) => id),
  );
  const abstractableIds = new Set(
    visibleBlocks
      .map((block, index) => getBlockId(block, index))
      .filter((id) => !anchorIds.has(id)),
  );
  const workflowComponents = buildWorkflowComponentSpecs(workflowGroups, abstractableIds, blocksById);
  const unassignedAbstractableIds = new Set(
    Array.from(abstractableIds).filter((id) => !workflowComponents.assignedIds.has(id)),
  );
  const abstractAdjacency = new Map<string, Set<string>>(
    Array.from(unassignedAbstractableIds).map((id) => [id, new Set<string>()]),
  );

  effectiveConnections.forEach((connection) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    if (!unassignedAbstractableIds.has(source) || !unassignedAbstractableIds.has(target)) return;
    abstractAdjacency.get(source)?.add(target);
    abstractAdjacency.get(target)?.add(source);
  });

  const componentByBlockId = new Map<string, string>();
  const componentSpecs: Array<{
    id: string;
    memberIds: string[];
    blocks: StrategyGraphBlock[];
    title?: string;
    purpose?: string;
  }> = [...workflowComponents.componentSpecs];
  componentSpecs.forEach((component) => {
    component.memberIds.forEach((memberId) => componentByBlockId.set(memberId, component.id));
  });
  const visited = new Set<string>();
  Array.from(unassignedAbstractableIds).forEach((startId) => {
    if (visited.has(startId)) return;
    const queue = [startId];
    const memberIds: string[] = [];
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      memberIds.push(current);
      abstractAdjacency.get(current)?.forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push(next);
      });
    }

    const id = `easy-${memberIds.map((item) => item.replace(/[^a-zA-Z0-9_-]/g, "-")).join("-").slice(0, 72)}`;
    const blocks = memberIds
      .map((memberId) => blocksById.get(memberId))
      .filter((block): block is StrategyGraphBlock => Boolean(block));
    if (blocks.length === 0) return;
    memberIds.forEach((memberId) => componentByBlockId.set(memberId, id));
    componentSpecs.push({ id, memberIds, blocks });
  });

  const blockToEasyNodeId = new Map<string, string>();
  visibleBlocks.forEach((block, index) => {
    const id = getBlockId(block, index);
    blockToEasyNodeId.set(id, componentByBlockId.get(id) || id);
  });

  const edgePriority: Record<string, number> = {
    "trigger-action": 5,
    "action-result": 4,
    "action-input": 3,
    "data-flow": 2,
    "trigger-input": 2,
    "stream-monitor": 1,
  };
  const remappedByPair = new Map<string, StrategyGraphConnection>();
  effectiveConnections.forEach((connection, index) => {
    const rawSource = normalizeGraphText(connection.fromId);
    const rawTarget = normalizeGraphText(connection.toId);
    if (!visibleIdSet.has(rawSource) || !visibleIdSet.has(rawTarget)) return;
    const source = blockToEasyNodeId.get(rawSource);
    const target = blockToEasyNodeId.get(rawTarget);
    if (!source || !target || source === target) return;
    const kind = normalizeGraphText(connection.kind, "data-flow");
    const key = `${source}->${target}`;
    const existing = remappedByPair.get(key);
    const isSharedPipelineEdge = connection.sharedDataPipeline === true || sharedPipeline.edgeKeys.has(connectionPairKey(rawSource, rawTarget));
    if (existing && (edgePriority[normalizeGraphText(existing.kind)] ?? 0) >= (edgePriority[kind] ?? 0)) {
      if (isSharedPipelineEdge) {
        remappedByPair.set(key, { ...existing, sharedDataPipeline: true });
      }
      return;
    }
    remappedByPair.set(key, {
      id: normalizeGraphText(connection.id, `easy-edge-${index + 1}`),
      kind,
      fromId: source,
      toId: target,
      sharedDataPipeline: isSharedPipelineEdge || existing?.sharedDataPipeline === true,
      ...withEasyConnectionLabel(connection),
    });
  });
  const remappedConnections = Array.from(remappedByPair.values());

  const anchorSpecs = visibleBlocks
    .map((block, index) => ({ type: "block" as const, id: getBlockId(block, index), block }))
    .filter((spec) => anchorIds.has(spec.id));
  const easySpecs: Array<
    | { type: "abstract"; id: string; blocks: StrategyGraphBlock[]; title?: string; purpose?: string }
    | { type: "block"; id: string; block: StrategyGraphBlock }
  > = [
      ...componentSpecs.map((component) => ({
        type: "abstract" as const,
        id: component.id,
        blocks: component.blocks,
        title: component.title,
        purpose: component.purpose,
      })),
      ...anchorSpecs,
    ];
  const layoutBlocks = easySpecs.map((spec) => ({ id: spec.id, type: "normal", config: {} }));
  const layout = computeGraphLayout(layoutBlocks, remappedConnections);
  const layoutById = new Map(layout.map((item) => [item.id, item]));

  const nodes = easySpecs.map((spec, index) => {
    const item = layoutById.get(spec.id) ?? { level: index, row: 0 };
    if (spec.type === "abstract") {
      const streamBlock = spec.blocks.find((block) => getBlockType(block) === "streaming");
      const streamId = streamBlock ? getBlockId(streamBlock) : "";
      const chart = streamBlock
        ? buildStreamingChart(streamBlock, getMonitoringBlocksForStream(streamId, blocksById, connections))
        : undefined;
      return buildAbstractEasyNode(spec.id, spec.blocks, index, item.level, item.row, prompt, chart, spec.title, spec.purpose);
    }

    const block = spec.block;
    const id = spec.id;
    const chart = getBlockType(block) === "streaming"
      ? buildStreamingChart(block, getMonitoringBlocksForStream(id, blocksById, connections))
      : undefined;
    const triggerSources = absorption.triggerToSources.get(id) ?? [];
    const actionTargets = getOutgoingConnections(connections, id)
      .filter((connection) => normalizeGraphText(connection.kind) === "trigger-action")
      .map((connection) => blocksById.get(normalizeGraphText(connection.toId)))
      .filter((target): target is StrategyGraphBlock => Boolean(target));
    const easyBlock = triggerSources.length > 0 || actionTargets.length > 0
      ? { ...block, config: buildEasyTriggerConfig(block, triggerSources, actionTargets) }
      : block;
    return graphBlockToEasyNode(easyBlock, index, item.level, item.row, chart);
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: EasyViewEdge[] = remappedConnections
    .map((connection, index): EasyViewEdge | null => {
      const source = normalizeGraphText(connection.fromId);
      const target = normalizeGraphText(connection.toId);
      const sourceNode = nodeById.get(source);
      const targetNode = nodeById.get(target);
      if (!sourceNode || !targetNode) return null;
      const connectionKind = normalizeGraphText(connection.kind, "sequence");
      const kind = resolveEasyEdgeKind(connectionKind, sourceNode, targetNode);
      return {
        id: normalizeGraphText(connection.id, `ai-edge-${index + 1}`),
        source,
        target,
        label: getEasyEdgeLabel(connection, connectionKind, sourceNode, targetNode),
        kind,
        sharedDataPipeline: connection.sharedDataPipeline === true,
      };
    })
    .filter((edge): edge is EasyViewEdge => edge !== null);

  const maxRight = nodes.reduce((max, node) => Math.max(max, node.x + node.w), 0);
  const maxBottom = nodes.reduce((max, node) => Math.max(max, node.y + (node.kind === "stream" ? 134 : 100)), 0);
  const title = normalizeGraphText(normalizedStrategyGraph.strategy?.name, prompt || "AI 생성 전략");

  return finalizeEasyViewModel({
    title,
    summary: prompt ? `AI가 "${prompt}" 요청으로 생성한 전략입니다.` : "AI가 생성한 전략 그래프입니다.",
    strategyType: "AI 생성",
    timeframe: "자동",
    lastModified: nowLabel(),
    code: strategyGraphToCode(normalizedStrategyGraph),
    canvasWidth: Math.max(1080, maxRight + 300),
    canvasHeight: Math.max(430, maxBottom + 80),
    nodes,
    edges,
  });
}

type AdvancedGraph = {
  nodes: Node[];
  edges: Edge[];
};

type AdvancedGraphHarnessResult = {
  graph: AdvancedGraph;
  attempts: number;
  diagnostics: string[];
};

const ADVANCED_NODE_TYPES = new Set([
  "groupNode",
  "functionNode",
  "timeTrigger",
  "clickTrigger",
  "actionNode",
  "monitoringNode",
  "streamingNode",
]);

function readConfigNumber(config: Record<string, unknown>, keys: string[], fallback: number) {
  for (const key of keys) {
    if (config[key] !== undefined) {
      const value = normalizeGraphNumber(config[key], Number.NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

function readConfigBool(config: Record<string, unknown>, keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    }
  }
  return fallback;
}

function normalizeBlockData(value: unknown, type: "input" | "output", fallbackName: string, index: number): BlockData {
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const name = readConfigText(item, ["name", "label", "key", "field"], fallbackName);
    return {
      id: normalizeGraphText(item.id, `${type}-${index + 1}-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`),
      name,
      description: readConfigText(item, ["description", "helper", "summary"], `${name} ${type} block`),
      type,
    };
  }

  const name = normalizeGraphText(value, fallbackName);
  return {
    id: `${type}-${index + 1}-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    name,
    description: `${name} ${type} block`,
    type,
  };
}

function normalizeBlockList(
  rawValue: unknown,
  type: "input" | "output",
  fallbackNames: string[],
): BlockData[] {
  if (Array.isArray(rawValue)) {
    const blocks = rawValue
      .map((item, index) => normalizeBlockData(item, type, fallbackNames[index] ?? `${type}${index + 1}`, index))
      .filter((block) => block.name.trim().length > 0);
    if (blocks.length > 0) return blocks;
  }

  if (rawValue && typeof rawValue === "object") {
    const blocks = Object.entries(rawValue).map(([key, value], index) =>
      normalizeBlockData(
        {
          id: key,
          name: key,
          description: typeof value === "string" ? value : `${key} ${type} block`,
        },
        type,
        fallbackNames[index] ?? key,
        index,
      ),
    );
    if (blocks.length > 0) return blocks;
  }

  return fallbackNames.map((name, index) => normalizeBlockData(name, type, name, index));
}

function readInputBlocks(config: Record<string, unknown>, fallbackNames: string[]) {
  return normalizeBlockList(
    config.inputBlocks ?? config.inputs ?? config.params ?? config.parameters,
    "input",
    fallbackNames,
  );
}

function readOutputBlocks(config: Record<string, unknown>, fallbackNames: string[]) {
  return normalizeBlockList(
    config.outputBlocks ?? config.outputs ?? config.outputData ?? config.returns,
    "output",
    fallbackNames,
  );
}

function normalizeTriggerOutputBlocks(blocks: BlockData[]) {
  const firstBlock = blocks[0];
  return [
    {
      ...(firstBlock ?? {}),
      id: "trigger",
      name: "trigger",
      description: firstBlock?.description || "조건식 결과 boolean 데이터",
      type: "output" as const,
      outputKind: "boolean-data",
    },
  ];
}

function hasIndicatorLogicDescriptionFormat(value: string) {
  return /^1\.\s*어떤 데이터를 받아와서:/m.test(value) &&
    /^2\.\s*어떤 동작을 수행하고:/m.test(value) &&
    /^3\.\s*어떤 output을 내는지:/m.test(value);
}

function isDeveloperCentricIndicatorDescription(value: string) {
  const text = normalizeGraphText(value);
  if (!text) return true;
  const withoutHeadings = text
    .replace(/^1\.\s*어떤 데이터를 받아와서:/gm, "")
    .replace(/^2\.\s*어떤 동작을 수행하고:/gm, "")
    .replace(/^3\.\s*어떤 output을 내는지:/gm, "");
  if (!/[가-힣]/.test(withoutHeadings)) return true;
  return Boolean(
    /::|\{\{|\}\}|&&|\|\||=>|[=!<>]=/.test(withoutHeadings) ||
    /\b(?:Agent loop|workflow|runtime|config|schema|function|return|compute|input|output|source|resolver|protocolContracts|routerContracts|tokenAddressMap|contractAddress|routeData|amountIn|quotedOut|netProfitUsd|netProfitBps|triggered)\b/i.test(withoutHeadings) ||
    /\b[a-z]+(?:[A-Z][a-zA-Z0-9]*)+\b/.test(withoutHeadings) ||
    /\b[a-z0-9]+(?:-[a-z0-9]+){1,}\b/i.test(withoutHeadings) ||
    /\b[a-z0-9]+(?:_[a-z0-9]+){1,}\b/i.test(withoutHeadings)
  );
}

function isFormattedIndicatorLogicDescription(value: string) {
  return hasIndicatorLogicDescriptionFormat(value) && !isDeveloperCentricIndicatorDescription(value);
}

function blockNames(blocks: BlockData[]) {
  return blocks.map((block) => block.name || block.id).filter(Boolean);
}

function cleanIndicatorLogicSentence(value: string) {
  return normalizeGraphText(value)
    .replace(/^Agent loop (input|output|logic|criterion):\s*/i, "")
    .replace(/^Agent loop 그대로:\s*/i, "")
    .trim();
}

function ensureKoreanSentence(value: string, suffix: string) {
  const text = cleanIndicatorLogicSentence(value);
  if (!text) return "";
  if (/[.!?。]|다$|요$/.test(text)) return text;
  return `${text}${suffix}`;
}

function compactPlainConceptList(concepts: string[], fallback: string) {
  const names = Array.from(new Set(concepts.map((concept) => normalizeGraphText(concept)).filter(Boolean)));
  if (names.length === 0) return fallback;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}와 ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}와 ${names[names.length - 1]}`;
}

function humanizeIndicatorConcept(name: string) {
  const lower = normalizeGraphText(name).toLowerCase();
  if (!lower) return "";
  if (/contract|resolver|router|quoter|factory|address|executor|tokenaddress|protocolcontracts/.test(lower)) {
    return "거래에 필요한 실제 주소 정보";
  }
  if (/quote|price|market|pool|route|venue|dex/.test(lower)) {
    return "현재 시장 가격과 거래 경로 정보";
  }
  if (/profit|score|yield|apr|return|pnl/.test(lower)) {
    return "예상 수익과 위험 점수";
  }
  if (/gas|fee|slippage|impact/.test(lower)) {
    return "거래 비용과 가격 변동 여유분";
  }
  if (/balance|wallet|allowance|amount/.test(lower)) {
    return "지갑 잔고와 사용할 금액";
  }
  if (/status|txhash|order|result|success|revert/.test(lower)) {
    return "실행 상태와 거래 기록";
  }
  if (/kill|halt|stop|risk|pause|stale|mismatch/.test(lower)) {
    return "위험 신호와 긴급 중단 상태";
  }
  if (/trigger|condition|check/.test(lower)) {
    return "조건 통과 여부";
  }
  return "";
}

function humanizeIndicatorConcepts(names: string[], fallback: string) {
  return compactPlainConceptList(names.map(humanizeIndicatorConcept).filter(Boolean), fallback);
}

function indicatorSemanticText(
  id: string,
  label: string,
  config: Record<string, unknown>,
  inputBlocks: BlockData[],
  outputBlocks: BlockData[],
) {
  return [
    id,
    label,
    readConfigText(config, ["name", "label", "title", "description", "summary", "overviewDescription", "expression", "formula", "logic", "code"]),
    ...blockNames(inputBlocks),
    ...blockNames(outputBlocks),
  ].join(" ").toLowerCase();
}

function describePlainIndicatorInput(
  id: string,
  label: string,
  config: Record<string, unknown>,
  inputBlocks: BlockData[],
  outputBlocks: BlockData[],
) {
  const text = indicatorSemanticText(id, label, config, inputBlocks, outputBlocks);
  if (/contract|resolver|router|quoter|factory|address|executor/.test(text)) {
    return "현재 시장에서 사용할 거래소, 토큰, 실행 주소가 준비되어 있는지 확인할 수 있는 정보를 받아옵니다.";
  }
  if (/profit|score|gas|fee|slippage|impact/.test(text)) {
    return "현재 시세, 투입할 금액, 받을 것으로 예상되는 금액, 수수료와 가스비 정보를 받아옵니다.";
  }
  if (/risk|kill|halt|pause|stale|mismatch/.test(text)) {
    return "최신 시세와 거래가 멈춰야 하는 위험 신호를 받아옵니다.";
  }
  return `${humanizeIndicatorConcepts(blockNames(inputBlocks), "연결된 시장 데이터와 이전 계산 결과")}를 받아옵니다.`;
}

function describePlainIndicatorBehavior(
  id: string,
  label: string,
  config: Record<string, unknown>,
  inputBlocks: BlockData[],
  outputBlocks: BlockData[],
) {
  const text = indicatorSemanticText(id, label, config, inputBlocks, outputBlocks);
  if (/contract|resolver|router|quoter|factory|address|executor/.test(text)) {
    return "실제 거래에 필요한 주소가 준비되어 있는지 확인하고, 빠진 항목이 있으면 실행 전에 멈춰야 한다고 표시합니다.";
  }
  if (/profit|net|score|gas|fee|slippage|impact/.test(text)) {
    return "예상으로 받을 금액에서 투입 금액, 수수료, 가스비, 가격 변동 여유분을 빼서 실제로 남는 수익을 계산합니다.";
  }
  if (/yield|apr|reward|liquidity|tvl/.test(text)) {
    return "수익률, 유동성, 보상, 위험 요소를 함께 비교해서 들어가도 괜찮은 기회인지 점수로 정리합니다.";
  }
  if (/risk|kill|halt|pause|stale|mismatch/.test(text)) {
    return "시세가 오래됐거나 가격 차이가 너무 크거나 손실 위험이 커진 상황을 골라냅니다.";
  }
  return `${label}에서 필요한 판단 기준을 사람이 확인할 수 있는 한 가지 결과로 정리합니다.`;
}

function describePlainIndicatorOutput(
  id: string,
  label: string,
  config: Record<string, unknown>,
  inputBlocks: BlockData[],
  outputBlocks: BlockData[],
) {
  const text = indicatorSemanticText(id, label, config, inputBlocks, outputBlocks);
  if (/contract|resolver|router|quoter|factory|address|executor/.test(text)) {
    return "거래를 실제로 진행할 준비가 되었는지와 부족한 준비 항목을 알려줍니다.";
  }
  if (/profit|net|score|gas|fee|slippage|impact/.test(text)) {
    return "거래를 계속 검토해도 되는 예상 순수익과 최소 수익 기준을 알려줍니다.";
  }
  if (/yield|apr|reward|liquidity|tvl/.test(text)) {
    return "선택한 기회의 매력도와 조심해야 할 위험 수준을 알려줍니다.";
  }
  if (/risk|kill|halt|pause|stale|mismatch/.test(text)) {
    return "거래를 멈추거나 다음 단계로 보내지 말아야 하는지 알려줍니다.";
  }
  return `${humanizeIndicatorConcepts(blockNames(outputBlocks), "다음 단계에서 사용할 판단 결과")}를 알려줍니다.`;
}

function formatIndicatorLogicDescription(
  id: string,
  label: string,
  config: Record<string, unknown>,
  inputBlocks: BlockData[],
  outputBlocks: BlockData[],
) {
  const existing = readConfigText(config, ["logicDescription"]);
  if (isFormattedIndicatorLogicDescription(existing)) return existing;
  return [
    `1. 어떤 데이터를 받아와서: ${ensureKoreanSentence(describePlainIndicatorInput(id, label, config, inputBlocks, outputBlocks), "를 받아옵니다.")}`,
    `2. 어떤 동작을 수행하고: ${ensureKoreanSentence(describePlainIndicatorBehavior(id, label, config, inputBlocks, outputBlocks), "을 수행합니다.")}`,
    `3. 어떤 output을 내는지: ${ensureKoreanSentence(describePlainIndicatorOutput(id, label, config, inputBlocks, outputBlocks), "를 알려줍니다.")}`,
  ].join("\n");
}

function normalizeOrderSide(value: string) {
  const text = value.trim().toUpperCase();
  if (["SELL", "SHORT", "CLOSE", "EXIT"].includes(text)) return "SELL";
  return "BUY";
}

function normalizeOrderType(value: string) {
  const text = value.trim().toUpperCase();
  return text === "LIMIT" ? "LIMIT" : "MARKET";
}

function parseIndicatorConditionExpression(expression: string, fallbackMetric: string, fallbackThreshold: number): IndicatorCondition | null {
  const text = expression.trim();
  if (!text) return null;
  const match = text.match(/([a-zA-Z0-9_.:-]+)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return {
      metric: fallbackMetric,
      operator: ">",
      threshold: fallbackThreshold,
      label: humanizeCondition(text),
    };
  }

  const metric = match[1].split("::").pop()?.split(".").pop() || fallbackMetric;
  return {
    metric,
    operator: match[2] as IndicatorCondition["operator"],
    threshold: Number(match[3]),
    label: humanizeCondition(text),
  };
}

function buildIndicatorConditionConfig(config: Record<string, unknown>, outputName: string, fallbackThreshold: number): IndicatorCondition {
  const rawCondition = config.condition;
  if (rawCondition && typeof rawCondition === "object") {
    const condition = rawCondition as Record<string, unknown>;
    const operator = readConfigText(condition, ["operator"], ">");
    const threshold = normalizeGraphNumber(condition.threshold, fallbackThreshold);
    return {
      metric: readConfigText(condition, ["metric", "field"], outputName),
      operator: [">", ">=", "<", "<="].includes(operator) ? operator as IndicatorCondition["operator"] : ">",
      threshold,
      label: readConfigText(condition, ["label"], `${readConfigText(condition, ["metric", "field"], outputName)} ${operator} ${threshold}`),
    };
  }

  const expression = readConfigText(config, ["triggerCondition", "condition", "predicate", "logic"]);
  return parseIndicatorConditionExpression(expression, outputName, fallbackThreshold) ?? {
    metric: outputName,
    operator: ">",
    threshold: fallbackThreshold,
    label: `${outputName} > ${fallbackThreshold}`,
  };
}

function normalizeChartComparisonNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildChartComparisonValuesConfig(config: Record<string, unknown>, fallbackThreshold: number): ChartComparisonValue[] {
  const rawValues = config.chartComparisonValues ?? config.comparisonValues ?? config.thresholds ?? config.referenceValues;
  if (!Array.isArray(rawValues)) return [];
  return rawValues
    .map((item, index): ChartComparisonValue | null => {
      if (typeof item === "number" || typeof item === "string") {
        const value = normalizeChartComparisonNumber(item, Number.NaN);
        if (!Number.isFinite(value)) return null;
        return {
          id: `comparison-${index + 1}`,
          label: `비교값 ${index + 1}`,
          value,
          enabled: true,
        };
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const value = normalizeChartComparisonNumber(record.value ?? record.threshold ?? record.price ?? record.level, Number.NaN);
      if (!Number.isFinite(value)) return null;
      return {
        id: readConfigText(record, ["id"], `comparison-${index + 1}`),
        label: readConfigText(record, ["label", "name"], `비교값 ${index + 1}`),
        value,
        color: readConfigText(record, ["color"], ""),
        enabled: readConfigBool(record, ["enabled", "visible"], true),
      };
    })
    .filter((item): item is ChartComparisonValue => item !== null)
    .filter((item) => Math.abs(item.value - fallbackThreshold) > Number.EPSILON);
}

function buildStreamingNodeData(id: string, config: Record<string, unknown>): StreamingNodeData {
  const label = readConfigText(config, ["name", "label", "title", "symbol"], id);
  const streamKind = readConfigText(config, ["streamKind"], readConfigText(config, ["streamChain"], "") ? "evm-rpc" : "url") as StreamingNodeData["streamKind"];
  const url = readConfigText(config, ["sourceUrl", "url", "endpoint", "apiUrl"], streamKind === "evm-rpc" ? "" : "wss://stream.binance.com/ws");
  const methodText = readConfigText(config, ["method", "protocol"], url.startsWith("ws") ? "WEBSOCKET" : "POLLING").toUpperCase();
  return {
    label,
    method: methodText === "POLLING" ? "POLLING" : "WEBSOCKET",
    url,
    intervalMs: readConfigNumber(config, ["intervalMs", "pollMs"], 1000),
    isActive: readConfigBool(config, ["isActive", "active"], true),
    streamKind: streamKind || "url",
    streamChain: readConfigText(config, ["streamChain"], streamKind === "evm-rpc" ? "eth-mainnet" : ""),
    streamMethod: readConfigText(config, ["streamMethod"], streamKind === "evm-rpc" ? "eth_call" : ""),
    streamParamsJson: readConfigText(config, ["streamParamsJson"], streamKind === "evm-rpc" ? '[{"to":"0x...","data":"0x..."}, "latest"]' : ""),
    responseSchema: readConfigText(config, ["responseSchema"], ""),
    outputBlocks: readOutputBlocks(config, streamKind === "evm-rpc" ? ["result_dec", "result"] : ["price", "volume"]),
    isExpanded: false,
    apiReference: readConfigText(config, ["apiReference", "reference"], ""),
    authMode: "NONE",
    requestHint: readConfigText(config, ["description", "summary"], "실시간 시장 데이터를 수신합니다."),
  };
}

function buildFunctionNodeData(id: string, type: string, config: Record<string, unknown>): FunctionNodeData {
  const label = readConfigText(config, ["name", "label", "title", "functionName"], id);
  const outputName = type === "trigger" ? "trigger" : "value";
  const threshold = readConfigNumber(config, ["threshold", "entryThreshold", "exitThreshold"], 108);
  const condition = buildIndicatorConditionConfig(config, outputName, threshold);
  const outputBlocks = readOutputBlocks(config, [outputName]);
  const normalizedOutputBlocks = type === "trigger" ? normalizeTriggerOutputBlocks(outputBlocks) : outputBlocks;
  const inputBlocks = readInputBlocks(config, ["source"]);
  return {
    label,
    runtimeBlockType: type,
    triggerType: readConfigText(config, ["triggerType", "type", "kind"], ""),
    materializedTriggerFormula: readConfigBool(config, ["materializedTriggerFormula"], false),
    description: readConfigText(config, ["description", "summary"], `${label} 값을 계산하고 조건 충족 구간을 시각화합니다.`),
    functionName: readConfigText(config, ["functionName", "name"], `${id.replace(/[^a-zA-Z0-9_]/g, "_")}()`),
    code: readConfigText(
      config,
      ["code", "logic", "expression"],
      `// ${label}\nreturn compute("${id}", input);`,
    ),
    inputBlocks,
    outputBlocks: normalizedOutputBlocks,
    inputDescription: readConfigText(config, ["inputDescription"], "연결된 스트림 또는 이전 블록의 값을 사용합니다."),
    logicDescription: formatIndicatorLogicDescription(id, label, config, inputBlocks, normalizedOutputBlocks),
    outputDescription: readConfigText(config, ["outputDescription"], `${outputName} 값을 다음 블록으로 전달합니다.`),
    condition,
    showChartComparison: readConfigBool(config, ["showChartComparison", "showComparison", "showConditionOverlay"], true),
    chartComparisonValues: buildChartComparisonValuesConfig(config, condition.threshold),
    isExpanded: false,
    viewMode: "node",
  };
}

function buildTimeTriggerNodeData(id: string, config: Record<string, unknown>): TimeTriggerData {
  const label = readConfigText(config, ["name", "label", "title"], id);
  const intervalMs = readConfigNumber(config, ["intervalMs", "updateIntervalMs"], Number.NaN);
  const interval = Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs / 1000
    : readConfigNumber(config, ["interval", "seconds", "intervalSec"], 60);
  return {
    label,
    interval,
    isActive: readConfigBool(config, ["isActive", "active"], true),
    linkedCondition: readConfigText(config, ["linkedCondition", "condition"], ""),
    outputBlocks: readOutputBlocks(config, ["tick"]),
  };
}

function buildClickTriggerNodeData(id: string, config: Record<string, unknown>): ClickTriggerData {
  const label = readConfigText(config, ["name", "label", "title"], id);
  return {
    label,
    shortcut: readConfigText(config, ["shortcut", "hotkey"], "") || null,
    isRecording: false,
    outputBlocks: readOutputBlocks(config, ["click"]),
  };
}

function buildActionNodeData(id: string, config: Record<string, unknown>): ActionNodeData {
  const label = readConfigText(config, ["name", "label", "title", "functionName"], id);
  const actionType = readConfigText(config, ["actionType", "venueType", "adapter"], "");
  const isDex = /dex|swap|contract|onchain/i.test(actionType)
    || Boolean(readConfigText(config, ["contractAddress", "chain", "chainId"], ""));

  if (isDex) {
    return {
      label,
      actionType: "DEX",
      contractAddress: readConfigText(config, ["contractAddress", "address"], "0x0000000000000000000000000000000000000000"),
      functionName: readConfigText(config, ["functionName", "method"], "swap()"),
      chainId: readConfigNumber(config, ["chainId"], 1),
      inputBlocks: readInputBlocks(config, ["signal", "amount"]),
      outputBlocks: readOutputBlocks(config, ["txHash", "status", "amountOut", "executionPrice"]),
      isExpanded: false,
      abi: readConfigText(config, ["abi"], ""),
    };
  }

  const amount = readConfigText(config, ["amount", "quote", "size", "notional"], "1000");
  return {
    label,
    actionType: "CEX",
    exchange: readConfigText(config, ["exchange", "venue"], "Binance"),
    symbol: readConfigText(config, ["symbol", "market"], "BTCUSDT"),
    side: normalizeOrderSide(readConfigText(config, ["side", "orderSide"], "BUY")),
    orderType: normalizeOrderType(readConfigText(config, ["orderType", "type"], "MARKET")),
    amount,
    amountType: amount.includes("%") ? "PERCENT" : "FIXED",
    price: readConfigText(config, ["price", "limitPrice"], ""),
    inputBlocks: readInputBlocks(config, ["signal", "amount"]),
    outputBlocks: readOutputBlocks(config, ["orderId", "status", "filledQty", "avgFillPrice"]),
    isExpanded: false,
  };
}

function buildMonitoringNodeData(id: string, config: Record<string, unknown>): MonitoringNodeData {
  return {
    label: readConfigText(config, ["name", "label", "title"], id),
    format: "chart",
    selectedVariables: [],
    condition: {
      metric: readConfigText(config, ["metric", "field"], "value"),
      operator: ">",
      threshold: readConfigNumber(config, ["threshold"], 108),
    },
    showChartComparison: readConfigBool(config, ["showChartComparison", "showComparison", "showConditionOverlay"], true),
    chartComparisonValues: buildChartComparisonValuesConfig(config, readConfigNumber(config, ["threshold"], 108)),
  };
}

function isTimeLikeTriggerConfig(config: Record<string, unknown>) {
  const triggerType = readConfigText(config, ["triggerType", "type"]).toLowerCase();
  const condition = readConfigText(config, ["condition", "expression", "logic"]).toLowerCase();
  return (
    ["time", "timer", "schedule", "scheduled", "cron", "interval"].includes(triggerType) ||
    hasConfigValue(config, ["interval", "seconds", "intervalSec", "schedule", "cron"]) ||
    /::pulse\b|eventtime\s*%|timestamp\s*%/.test(condition)
  );
}

function isManualLikeTriggerConfig(config: Record<string, unknown>) {
  const triggerType = readConfigText(config, ["triggerType", "type", "kind"]).toLowerCase();
  if (["manual", "click", "button", "start", "startup", "on-start", "on_start"].includes(triggerType)) {
    return true;
  }
  if (triggerType && triggerType !== "trigger") {
    return false;
  }

  const text = [
    readConfigText(config, ["name", "label", "title"]),
    readConfigText(config, ["description", "summary"]),
    readConfigText(config, ["condition", "expression", "logic"]),
  ].join(" ");
  return /\b(manual|click|button|start|strategy\s*start|on\s*start|startup)\b|수동|클릭|버튼|전략\s*시작|시작\s*시/.test(text);
}

type InlineTriggerInfo = {
  triggerId: string;
  sourceId: string;
  triggerBlock: StrategyGraphBlock;
};

function isConditionTriggerBlock(block: StrategyGraphBlock) {
  return getBlockType(block) === "trigger" && !isTimeLikeTriggerConfig(getBlockConfig(block));
}

function getIncomingConnections(connections: StrategyGraphConnection[], targetId: string) {
  return connections.filter((connection) => normalizeGraphText(connection.toId) === targetId);
}

function getOutgoingConnections(connections: StrategyGraphConnection[], sourceId: string) {
  return connections.filter((connection) => normalizeGraphText(connection.fromId) === sourceId);
}

function getTriggerNormalSources(
  triggerId: string,
  triggerBlock: StrategyGraphBlock,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  const condition = readConfigText(getBlockConfig(triggerBlock), ["condition", "expression", "logic"]);
  const sourceIds = new Set<string>();

  getIncomingConnections(connections, triggerId).forEach((connection) => {
    const sourceId = normalizeGraphText(connection.fromId);
    const sourceBlock = blocksById.get(sourceId);
    if (sourceBlock && getBlockType(sourceBlock) === "normal") sourceIds.add(sourceId);
  });

  blocksById.forEach((block, blockId) => {
    if (getBlockType(block) === "normal" && conditionMentionsBlock(condition, blockId)) {
      sourceIds.add(blockId);
    }
  });

  return Array.from(sourceIds);
}

function buildAdvancedInlineTriggerMap(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]) {
  // Trigger nodes must stay visible in advanced view. Older UI builds inlined
  // a condition trigger into its indicator source, which left a visual "then"
  // edge without an explicit "if/when" gate. Keep this function as an opt-in
  // compatibility hook, but do not inline triggers by default.
  void blocks;
  void connections;
  const triggerById = new Map<string, InlineTriggerInfo>();
  const sourceToTrigger = new Map<string, InlineTriggerInfo>();
  return { triggerById, sourceToTrigger };
}

function isBooleanLikeOutputBlock(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  const outputs = readOutputBlocks(config, ["signal"]);
  if (outputs.length === 0) return true;
  return outputs.length <= 1 && outputs.every((output) =>
    /\b(bool|boolean|signal|trigger|ready|ok|pass|success|true|confirmed|valid)\b|신호|조건|성공|확인|준비/.test(
      `${output.id} ${output.name} ${output.description || ""}`.toLowerCase(),
    ),
  );
}

function normalBlockLooksLikeOmittableBooleanRelay(block: StrategyGraphBlock, id: string) {
  if (getBlockType(block) !== "normal") return false;
  if (isFixedValueBlock(block)) return false;
  const config = getBlockConfig(block);
  if (config.uiOmit === true || config.omitInAdvancedView === true || config.omittableIndicator === true) return true;
  if (config.uiOmit === false || config.omitInAdvancedView === false) return false;

  const text = [
    id,
    readConfigText(config, ["name", "label", "title", "functionName"]),
    readConfigText(config, ["description", "summary", "logicDescription", "outputDescription"]),
    readConfigText(config, ["condition", "predicate", "expression", "logic", "code"]),
  ].join(" ").toLowerCase();

  if (/\b(score|spread|basis|ma|ema|rsi|atr|volatility|price|amount|size|balance|allowance|reward|tvl|apr|apy|slippage|ratio|delta)\b|점수|가격|잔고|수량|보상|유동성|비율/.test(text)) {
    return false;
  }

  return (
    isBooleanLikeOutputBlock(block) &&
    /\b(indicator|predicate|boolean|bool|relay|gate|ready|ok|success|confirmed|pass|true|signal)\b|조건|신호|성공|확인|준비|통과/.test(text)
  );
}

function isOmittableBooleanRelayBlock(
  block: StrategyGraphBlock,
  id: string,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  if (!normalBlockLooksLikeOmittableBooleanRelay(block, id)) return false;
  const incoming = getIncomingConnections(connections, id).filter((connection) =>
    ["data-flow", "action-result", "trigger-input"].includes(normalizeGraphText(connection.kind)),
  );
  const outgoing = getOutgoingConnections(connections, id).filter((connection) =>
    ["data-flow", "trigger-input"].includes(normalizeGraphText(connection.kind)),
  );
  if (incoming.length !== 1 || outgoing.length === 0) return false;
  if (outgoing.length > 1) return false;
  return outgoing.every((connection) => {
    const target = blocksById.get(normalizeGraphText(connection.toId));
    return target && getBlockType(target) === "trigger";
  });
}

function buildOmittableBooleanRelayIds(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]) {
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  return new Set(
    blocks
      .map((block, index) => ({ block, id: getBlockId(block, index) }))
      .filter(({ block, id }) => isOmittableBooleanRelayBlock(block, id, blocksById, connections))
      .map(({ id }) => id),
  );
}

function withHiddenRelayConditionsOnTriggers(
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
  hiddenRelayIds: Set<string>,
) {
  if (hiddenRelayIds.size === 0) return blocks;
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const triggerConditionById = new Map<string, string>();

  hiddenRelayIds.forEach((relayId) => {
    const relayBlock = blocksById.get(relayId);
    if (!relayBlock) return;
    const relayConfig = getBlockConfig(relayBlock);
    const relayCondition = readConfigText(relayConfig, ["condition", "predicate", "expression", "logic", "code"]);
    if (!relayCondition) return;

    getOutgoingConnections(connections, relayId).forEach((connection) => {
      const targetId = normalizeGraphText(connection.toId);
      const targetBlock = blocksById.get(targetId);
      if (!targetBlock || getBlockType(targetBlock) !== "trigger") return;
      const targetConfig = getBlockConfig(targetBlock);
      if (readConfigText(targetConfig, ["condition", "predicate", "expression", "logic"])) return;
      triggerConditionById.set(targetId, relayCondition);
    });
  });

  if (triggerConditionById.size === 0) return blocks;
  return blocks.map((block, index) => {
    const id = getBlockId(block, index);
    const condition = triggerConditionById.get(id);
    if (!condition) return block;
    return {
      ...block,
      config: {
        ...getBlockConfig(block),
        condition,
        description: readConfigText(getBlockConfig(block), ["description", "summary"], humanizeCondition(condition)),
      },
    };
  });
}

function remapHiddenBooleanRelayConnections(
  connections: StrategyGraphConnection[],
  hiddenRelayIds: Set<string>,
  blocksById: Map<string, StrategyGraphBlock>,
) {
  if (hiddenRelayIds.size === 0) return connections;
  const remapped: StrategyGraphConnection[] = [];
  const seen = new Set<string>();

  const push = (connection: StrategyGraphConnection) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const kind = normalizeGraphText(connection.kind, "data-flow");
    if (!source || !target || source === target) return;
    const key = `${source}->${target}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    remapped.push(connection);
  };

  connections.forEach((connection, index) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    if (hiddenRelayIds.has(source)) return;

    if (hiddenRelayIds.has(target)) {
      getOutgoingConnections(connections, target).forEach((outgoing) => {
        const relayTargetId = normalizeGraphText(outgoing.toId);
        const relayTarget = blocksById.get(relayTargetId);
        if (!relayTarget || getBlockType(relayTarget) !== "trigger") return;
        const sourceBlock = blocksById.get(source);
        push({
          id: `${normalizeGraphText(connection.id, `relay-${index}`)}-${target}-omitted-${relayTargetId}`,
          kind: getBlockType(sourceBlock ?? {}) === "action" ? "action-result" : "data-flow",
          fromId: source,
          toId: relayTargetId,
        });
      });
      return;
    }

    push(connection);
  });

  return remapped;
}

function withInlineTriggerConfig(config: Record<string, unknown>, info?: InlineTriggerInfo) {
  if (!info) return config;
  const triggerConfig = getBlockConfig(info.triggerBlock);
  const condition = readConfigText(triggerConfig, ["condition", "predicate", "expression", "logic"]);
  const triggerLabel = readConfigText(triggerConfig, ["name", "label", "title"], "실행 조건");
  const description = readConfigText(
    triggerConfig,
    ["description", "summary"],
    condition ? `${humanizeCondition(condition)}이면 실행 신호를 냅니다.` : "조건이 충족되면 실행 신호를 냅니다.",
  );

  return {
    ...config,
    triggerCondition: condition,
    description: readConfigText(config, ["description", "summary"], description),
    logicDescription: readConfigText(config, ["logicDescription", "description"], description),
    outputDescription: readConfigText(
      config,
      ["outputDescription"],
      `${triggerLabel} true/false 신호를 output block 아래 trigger로 내보냅니다.`,
    ),
  };
}

function remapInlineTriggerConnections(
  connections: StrategyGraphConnection[],
  inlineTriggerById: Map<string, InlineTriggerInfo>,
  hiddenValueBlockIds: Set<string>,
) {
  const remapped: StrategyGraphConnection[] = [];
  const seen = new Set<string>();

  const pushConnection = (connection: StrategyGraphConnection) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const kind = normalizeGraphText(connection.kind, "sequence");
    if (!source || !target || source === target) return;
    if (hiddenValueBlockIds.has(source) || hiddenValueBlockIds.has(target)) return;
    const key = `${source}->${target}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    remapped.push(connection);
  };

  connections.forEach((connection, index) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const sourceInline = inlineTriggerById.get(source);
    const targetInline = inlineTriggerById.get(target);

    if (targetInline) {
      if (source !== targetInline.sourceId) {
        pushConnection({
          id: `${normalizeGraphText(connection.id, `edge-${index}`)}-into-inline-source`,
          kind: "data-flow",
          fromId: source,
          toId: targetInline.sourceId,
        });
      }
      return;
    }

    if (sourceInline) {
      pushConnection({
        id: `${normalizeGraphText(connection.id, `edge-${index}`)}-from-inline-trigger`,
        kind: normalizeGraphText(connection.kind, "trigger-action"),
        fromId: sourceInline.sourceId,
        toId: target,
      });
      return;
    }

    pushConnection(connection);
  });

  return remapped;
}

function getAdvancedNodeType(blockType: string, config: Record<string, unknown>) {
  if (blockType === "streaming") return "streamingNode";
  if (blockType === "action") return "actionNode";
  if (blockType === "monitoring") return "monitoringNode";
  if (blockType === "trigger" && isManualLikeTriggerConfig(config)) {
    return "clickTrigger";
  }
  if (blockType === "trigger" && isTimeLikeTriggerConfig(config)) {
    return "timeTrigger";
  }
  return "functionNode";
}

function buildAdvancedNodeData(id: string, blockType: string, config: Record<string, unknown>) {
  const nodeType = getAdvancedNodeType(blockType, config);
  if (nodeType === "streamingNode") return buildStreamingNodeData(id, config);
  if (nodeType === "clickTrigger") return buildClickTriggerNodeData(id, config);
  if (nodeType === "timeTrigger") return buildTimeTriggerNodeData(id, config);
  if (nodeType === "actionNode") return buildActionNodeData(id, config);
  if (nodeType === "monitoringNode") return buildMonitoringNodeData(id, config);
  return buildFunctionNodeData(id, blockType, config);
}

function getOutputHandle(node: Node) {
  const outputBlocks = (node.data as { outputBlocks?: BlockData[] })?.outputBlocks ?? [];
  const firstBlock = outputBlocks[0];
  if (!firstBlock && node.type === "timeTrigger") return `${node.id}-block-tick-out`;
  return firstBlock ? `${node.id}-block-${firstBlock.id}-out` : undefined;
}

function getConnectionSourceHandle(connection: StrategyGraphConnection, node: Node) {
  const sourceBlockId = normalizeGraphText(
    connection.sourceBlockId ?? connection.fromBlockId ?? connection.sourceOutputBlockId,
  );
  if (sourceBlockId) return `${node.id}-block-${sourceBlockId}-out`;
  return getOutputHandle(node);
}

function getExecutionTargetHandle(node: Node) {
  if (node.type === "monitoringNode") return `${node.id}-monitor-in`;
  if (node.type === "timeTrigger") return `${node.id}-trigger-in`;
  if (node.type === "functionNode") {
    const inputBlocks = (node.data as { inputBlocks?: BlockData[] })?.inputBlocks ?? [];
    return inputBlocks[0] ? `${node.id}-input-${inputBlocks[0].id}-in` : undefined;
  }
  if (node.type === "actionNode" || node.type === "streamingNode") return `${node.id}-func-in`;
  return undefined;
}

function getDataTargetHandle(node: Node) {
  if (node.type === "monitoringNode") return `${node.id}-monitor-in`;
  const inputBlocks = (node.data as { inputBlocks?: BlockData[] })?.inputBlocks ?? [];
  return inputBlocks[0] ? `${node.id}-input-${inputBlocks[0].id}-in` : getExecutionTargetHandle(node);
}

function normalizeIntervalSeconds(value: unknown, label = "") {
  const numeric = normalizeGraphNumber(value, Number.NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return /ms|millisecond/i.test(label) || numeric >= 10_000 ? numeric / 1000 : numeric;
}

function resolveTriggerIntervalSeconds(
  config: Record<string, unknown>,
  blocksById: Map<string, StrategyGraphBlock>,
) {
  const explicitSeconds = readConfigNumber(config, ["interval", "seconds", "intervalSec"], Number.NaN);
  if (Number.isFinite(explicitSeconds) && explicitSeconds > 0) return explicitSeconds;

  const condition = readConfigText(config, ["condition", "expression", "logic"]);
  const pulseSource = condition.match(/([a-zA-Z0-9_-]+)::pulse\b/i)?.[1];
  if (pulseSource) {
    const streamConfig = getBlockConfig(blocksById.get(pulseSource) ?? { id: pulseSource, type: "streaming", config: {} });
    const streamMs = readConfigNumber(streamConfig, ["updateIntervalMs", "intervalMs", "pollMs"], Number.NaN);
    if (Number.isFinite(streamMs) && streamMs > 0) return streamMs / 1000;
  }

  for (const [blockId, block] of blocksById.entries()) {
    if (!conditionMentionsBlock(condition, blockId) || !isFixedValueBlock(block)) continue;
    const blockConfig = getBlockConfig(block);
    const label = readConfigText(blockConfig, ["name", "label", "title"], blockId);
    if (!/interval|cadence|period|time|ms|초|주기/i.test(`${label} ${condition}`)) continue;
    const seconds = normalizeIntervalSeconds(readFixedBlockValue(block), label);
    if (seconds) return seconds;
  }

  const explicitMs = readConfigNumber(config, ["intervalMs", "updateIntervalMs", "pollMs"], Number.NaN);
  if (isTimeLikeTriggerConfig(config) && Number.isFinite(explicitMs) && explicitMs > 0) {
    return explicitMs / 1000;
  }

  return undefined;
}

function deriveActionConfigWithInlineValues(
  actionId: string,
  config: Record<string, unknown>,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  const next = { ...config };
  let baseToken = "";
  let quoteToken = "";

  for (const connection of connections) {
    const kind = normalizeGraphText(connection.kind);
    const sourceId = normalizeGraphText(connection.fromId);
    const targetId = normalizeGraphText(connection.toId);
    if (kind !== "action-input" || targetId !== actionId) continue;

    const sourceBlock = blocksById.get(sourceId);
    if (!sourceBlock || !isFixedValueBlock(sourceBlock)) continue;

    const sourceConfig = getBlockConfig(sourceBlock);
    const label = readConfigText(sourceConfig, ["name", "label", "title"], sourceId);
    const normalizedLabel = label.toLowerCase();
    const value = readFixedBlockValue(sourceBlock);
    if (value === undefined) continue;
    const textValue = String(value);

    if (/quote\s*(token|asset|currency)|counter\s*(token|asset|currency)/i.test(normalizedLabel)) {
      quoteToken = textValue;
      continue;
    }
    if (/(target|base|asset|token|coin|symbol|대상)/i.test(normalizedLabel)) {
      baseToken = textValue;
      continue;
    }
    if (/(amount|investment|budget|notional|size|투입|투자|금액)/i.test(normalizedLabel)) {
      if (!hasConfigValue(next, ["amount", "quote", "size", "notional"])) next.amount = textValue;
    }
  }

  if (!hasConfigValue(next, ["symbol", "market"]) && baseToken) {
    const quote = quoteToken || "USDT";
    next.symbol = baseToken.includes("/") || baseToken.endsWith(quote) ? baseToken : `${baseToken}${quote}`;
  }

  return next;
}

function deriveAdvancedBlockConfig(
  id: string,
  blockType: string,
  config: Record<string, unknown>,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  if (blockType === "action") {
    return deriveActionConfigWithInlineValues(id, config, blocksById, connections);
  }

  if (blockType === "trigger") {
    const interval = resolveTriggerIntervalSeconds(config, blocksById);
    if (interval) {
      return {
        ...config,
        interval,
        outputBlocks: config.outputBlocks ?? [
          {
            id: "tick",
            name: "tick",
            description: `${Math.round(interval)}초마다 true 신호를 내보냅니다.`,
            type: "output",
          },
        ],
      };
    }
  }

  return config;
}

function getStrategyBlockMetadata(strategyGraph: StrategyGraphPayload, defaultTitle: string) {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const rawStrategyBlock = metadata.strategyBlock && typeof metadata.strategyBlock === "object"
    ? metadata.strategyBlock as Record<string, unknown>
    : {};
  return {
    id: sanitizeGraphId(readConfigText(rawStrategyBlock, ["id"], normalizeGraphText(strategyGraph.strategy?.id, "ai-strategy")), "ai-strategy"),
    title: readConfigText(rawStrategyBlock, ["title", "label", "name"], defaultTitle || normalizeGraphText(strategyGraph.strategy?.name, "AI 전략")),
    purpose: readConfigText(rawStrategyBlock, ["purpose", "description", "summary"], "AI가 생성한 전략 전체를 감싸는 최상위 컨테이너입니다."),
  };
}

function inferAdvancedSequenceStyle(
  group: EasyWorkflowGroupSpec,
  _blocks: StrategyGraphBlock[],
): "dashed-init" | "dashed-trigger" | "dashed-emergency" | "pipeline" {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  if (sequenceType === "data-pipeline" || sequenceType === "pipeline" || group.sharedDataPipeline === true) {
    return "pipeline";
  }
  const text = `${group.id} ${group.title} ${group.purpose}`.toLowerCase();
  if (/kill|emergency|panic|stop|exit|close|drawdown|킬|긴급|비상|중단|정리|청산/.test(text)) {
    return "dashed-emergency";
  }
  if (/init|initial|start|bootstrap|setup|capital|ready|초기|시작|준비|자금/.test(text)) {
    return "dashed-init";
  }
  return "dashed-trigger";
}

function getAdvancedSequenceSummary(group: EasyWorkflowGroupSpec, styleType: "dashed-init" | "dashed-trigger" | "dashed-emergency" | "pipeline") {
  const text = `${group.title} ${group.purpose}`.toLowerCase();
  if (styleType === "pipeline") {
    return { summaryWord: "데이터", summaryEmoji: "▦", summaryGlyph: "데" };
  }
  if (styleType === "dashed-emergency") {
    return { summaryWord: "정리", summaryEmoji: "🧯", summaryGlyph: "정" };
  }
  if (styleType === "dashed-init") {
    return { summaryWord: "진입", summaryEmoji: "🚀", summaryGlyph: "진" };
  }
  if (/monitor|watch|감시|모니터/.test(text)) {
    return { summaryWord: "감시", summaryEmoji: "📡", summaryGlyph: "감" };
  }
  if (/signal|condition|trigger|조건|신호/.test(text)) {
    return { summaryWord: "조건", summaryEmoji: "⚡", summaryGlyph: "조" };
  }
  if (/execute|trade|order|swap|실행|주문|거래/.test(text)) {
    return { summaryWord: "실행", summaryEmoji: "🧭", summaryGlyph: "실" };
  }
  return { summaryWord: "흐름", summaryEmoji: "✨", summaryGlyph: "흐" };
}

function workflowGroupLooksLikeDataPipeline(group: EasyWorkflowGroupSpec) {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  return sequenceType === "data-pipeline" || sequenceType === "pipeline" || group.sharedDataPipeline === true;
}

function getWorkflowGroupLanePriority(group: EasyWorkflowGroupSpec) {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  if (workflowGroupLooksLikeDataPipeline(group)) return 0;
  if (sequenceType === "monitoring") return 2;
  return 1;
}

function compareWorkflowGroupsForLeftToRightLayout(
  left: EasyWorkflowGroupSpec,
  right: EasyWorkflowGroupSpec,
) {
  return getWorkflowGroupLanePriority(left) - getWorkflowGroupLanePriority(right) ||
    (left.order ?? 0) - (right.order ?? 0) ||
    left.id.localeCompare(right.id);
}

function blockIsAllowedInDataPipeline(block: StrategyGraphBlock) {
  const blockType = getBlockType(block);
  return blockType === "streaming" || blockType === "normal";
}

const HARNESS_AGENT_LOOP_INTERNAL_RE = /\b(intent|research|retrieval|knowledge\s*graph|kg|web\s*discovery|candidate\s*universe|pool\s*discovery|implementation\s*research|orchestration|planner|planning|ranking|ranker|solver|evidence|adapter|labeling|check\s*effect|check-effect|workflow\s*plan)\b|의도|리서치|검색|후보|지식\s*그래프|랭킹|순위|계획|근거|증거|어댑터|라벨|오케스트레이션/i;
const HARNESS_TRADING_RUNTIME_RE = /\b(capital|balance|allowance|collateral|approve|approval|entry|enter|deposit|add\s*liquidity|liquidity|lp|stake|staking|gauge|unstake|withdraw|remove\s*liquidity|claim|reward|rebalance|exit|swap|order|buy|sell|long|short|hedge|position|monitor|drawdown|slippage|kill\s*switch|close|cancel|reduce\s*only|stop)\b|자금|잔고|승인|진입|입금|예치|유동성|스테이킹|게이지|출금|회수|보상|클레임|리밸런스|종료|출구|스왑|주문|매수|매도|포지션|모니터|손실|슬리피지|킬\s*스위치|중단|청산/i;
const HARNESS_EXECUTABLE_ACTION_RE = /\b(dex|cex|swap|order|buy|sell|approve|deposit|withdraw|stake|unstake|claim|getreward|addliquidity|removeliquidity|mint|burn|closeposition|cancelorder|placeorder|reduceonly|emergencyexit)\b/i;

function isHarnessAgenticGraph(strategyGraph: StrategyGraphPayload) {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  return metadata.agenticWorkflow === true ||
    metadata.aiLoopInternalized === true ||
    metadata.checkEffectGraph === true ||
    normalizeGraphText(metadata.visibleGraphScope).toLowerCase() === "trading-logic-only";
}

function isMonitoringOnlyStrategyGraph(strategyGraph: StrategyGraphPayload) {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const sequenceIsolation = normalizeGraphText(metadata.sequenceIsolation).toLowerCase();
  const readiness = metadata.executionReadiness && typeof metadata.executionReadiness === "object"
    ? metadata.executionReadiness as Record<string, unknown>
    : {};
  if (sequenceIsolation.includes("monitoring-only")) return true;
  return readiness.liveExecutable === false && readiness.monitoringReady === true;
}

function blockLooksLikeExecutableTradingAction(block: StrategyGraphBlock) {
  if (getBlockType(block) !== "action") return false;
  const config = getBlockConfig(block);
  const actionType = normalizeGraphText(config.actionType || config.type).toUpperCase();
  if (actionType === "DEX" || actionType === "CEX") return true;
  const actionText = [
    getBlockId(block),
    collectEasyBlockText(block),
    readConfigText(config, ["functionName", "method", "side", "orderType", "executionMode"]),
    normalizeGraphText(config.exchange),
    normalizeGraphText(config.chain),
    normalizeGraphText(config.dexProtocol),
  ].join(" ");
  return HARNESS_EXECUTABLE_ACTION_RE.test(actionText);
}

function blockLooksLikeTradingRuntime(block: StrategyGraphBlock) {
  if (blockLooksLikeExecutableTradingAction(block)) return true;
  if (isKillSwitchBlock(block)) return true;
  return HARNESS_TRADING_RUNTIME_RE.test(`${getBlockId(block)} ${getBlockType(block)} ${collectEasyBlockText(block)}`);
}

function workflowGroupLooksLikeAgentLoopInternal(
  group: EasyWorkflowGroupSpec,
  memberBlocks: StrategyGraphBlock[],
) {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  if (sequenceType === "check-effect" || sequenceType === "data-pipeline" || group.sharedDataPipeline === true) {
    return false;
  }
  const groupText = `${group.id} ${group.title} ${group.purpose}`;
  if (!HARNESS_AGENT_LOOP_INTERNAL_RE.test(groupText)) return false;
  if (/check\s*effect|check-effect|intent|research|retrieval|knowledge\s*graph|kg|web\s*discovery|candidate|pool\s*discovery|ranking|solver|workflow\s*plan|의도|리서치|검색|후보|랭킹|순위|계획|근거|증거/i.test(groupText)) {
    return true;
  }
  return !memberBlocks.some(blockLooksLikeExecutableTradingAction);
}

function validateHarnessTradingLogicScope(strategyGraph: StrategyGraphPayload) {
  const errors: string[] = [];
  if (!isHarnessAgenticGraph(strategyGraph)) return errors;

  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const visibleGraphScope = normalizeGraphText(metadata.visibleGraphScope).toLowerCase();
  if (visibleGraphScope !== "trading-logic-only") {
    errors.push("AI 루프 결과는 runtimeGraph.metadata.visibleGraphScope='trading-logic-only'로 선언된 실제 트레이딩 그래프만 하네스에 올릴 수 있습니다");
  }

  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const workflowGroups = normalizeEasyWorkflowGroups(strategyGraph);
  const hasVisibleCheckEffectSequences = workflowGroups.some((group) => normalizeGraphText(group.sequenceType).toLowerCase() === "check-effect");
  if (metadata.checkEffectGraph === true && !hasVisibleCheckEffectSequences) {
    errors.push("check/effect 그래프는 화면에 표시할 check-effect workflowGroups를 함께 제공해야 합니다");
  }
  workflowGroups
    .filter(workflowGroupLooksLikeDataPipeline)
    .forEach((group) => {
      const invalidNodeIds = group.nodeIds.filter((nodeId) => {
        const block = blocksById.get(nodeId);
        return block ? !blockIsAllowedInDataPipeline(block) : false;
      });
      if (invalidNodeIds.length > 0) {
        errors.push(`data-pipeline workflowGroup에는 streaming/indicator logic 블록만 들어갈 수 있습니다: ${group.id} -> ${invalidNodeIds.slice(0, 4).join(", ")}`);
      }
    });
  const badGroups = workflowGroups
    .map((group) => ({
      group,
      memberBlocks: group.nodeIds
        .map((nodeId) => blocksById.get(nodeId))
        .filter((block): block is StrategyGraphBlock => Boolean(block)),
    }))
    .filter(({ group, memberBlocks }) => workflowGroupLooksLikeAgentLoopInternal(group, memberBlocks));

  if (badGroups.length > 0) {
    errors.push(`AI 내부 루프 workflowGroups는 시퀀스로 렌더링할 수 없습니다: ${badGroups.slice(0, 4).map(({ group }) => group.title || group.id).join(", ")}`);
  }

  const executableActions = blocks.filter(blockLooksLikeExecutableTradingAction);
  if (visibleGraphScope === "trading-logic-only" && executableActions.length === 0 && !isMonitoringOnlyStrategyGraph(strategyGraph)) {
    errors.push("trading-logic-only 그래프에는 DEX/CEX 주문, 스왑, 입금, 스테이킹, 출구 같은 실행 액션 블록이 최소 1개 필요합니다");
  }

  const runtimeBlocks = blocks.filter(blockLooksLikeTradingRuntime);
  if (visibleGraphScope === "trading-logic-only" && runtimeBlocks.length === 0) {
    errors.push("trading-logic-only 그래프에는 실제 매매 상태, 조건, 실행, 모니터링 블록만 포함되어야 합니다");
  }

  return errors;
}

function collectHarnessValueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(collectHarnessValueText).join(" ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key} ${collectHarnessValueText(item)}`)
      .join(" ");
  }
  return "";
}

function actionOrderKind(beforeAction: StrategyGraphBlock, afterAction: StrategyGraphBlock) {
  const beforeText = collectEasyBlockText(beforeAction).toLowerCase();
  const afterText = collectEasyBlockText(afterAction).toLowerCase();
  const beforeApproval = /approve|approval|allowance|승인/.test(beforeText);
  const beforeAddLiquidity = /add\s*liquidity|deposit.*pool|mint.*lp|liquidity.*deposit|유동성.*(추가|입금|예치)/.test(beforeText);
  const beforeClaim = /claim|getreward|reward|클레임|보상/.test(beforeText);
  const beforeUnstake = /unstake|withdrawgauge|withdraw\s*gauge|gauge.*withdraw|언스테이킹|스테이킹.*해제/.test(beforeText);
  const afterNeedsApproval = /add\s*liquidity|deposit|stake|supply|swap|mint|입금|예치|스테이킹|스왑|공급/.test(afterText);
  const afterStake = /stake|depositgauge|gauge.*deposit|스테이킹|게이지/.test(afterText);
  const afterRebalance = /rebalance|리밸런스|재조정/.test(afterText);
  const afterRemoveLiquidity = /remove\s*liquidity|withdraw.*liquidity|redeem|burn.*lp|유동성.*(제거|회수|출금)/.test(afterText);

  if (beforeApproval && afterNeedsApproval) return "approval-before-execution";
  if (beforeAddLiquidity && afterStake) return "deposit-before-stake";
  if (beforeClaim && afterRebalance) return "claim-before-rebalance";
  if (beforeUnstake && afterRemoveLiquidity) return "unstake-before-remove-liquidity";
  return "";
}

function hasConfirmationActionChain(
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
  fromActionId: string,
  toActionId: string,
) {
  const outgoingById = new Map<string, StrategyGraphConnection[]>();
  connections.forEach((connection) => {
    const fromId = normalizeGraphText(connection.fromId);
    if (!fromId) return;
    const list = outgoingById.get(fromId) ?? [];
    list.push(connection);
    outgoingById.set(fromId, list);
  });

  const queue: Array<{ id: string; depth: number }> = [{ id: fromActionId, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(`${id}:${depth}`) || depth > 4) continue;
    visited.add(`${id}:${depth}`);

    const sourceBlock = blocksById.get(id);
    const sourceType = sourceBlock ? getBlockType(sourceBlock) : "";
    for (const connection of outgoingById.get(id) ?? []) {
      const kind = normalizeGraphText(connection.kind);
      const targetId = normalizeGraphText(connection.toId);
      const targetBlock = blocksById.get(targetId);
      const targetType = targetBlock ? getBlockType(targetBlock) : "";
      if (!targetId || !targetBlock) continue;

      if (sourceType === "action" && kind !== "action-result") continue;
      if (targetType === "action" && kind !== "trigger-action") continue;
      if (!["action-result", "data-flow", "trigger-input", "trigger-action"].includes(kind)) continue;
      if (targetId === toActionId && kind === "trigger-action") return true;
      queue.push({ id: targetId, depth: depth + 1 });
    }
  }

  return false;
}

function validateHarnessSequentialExecution(strategyGraph: StrategyGraphPayload) {
  const errors: string[] = [];
  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  const connections = Array.isArray(strategyGraph.connections) ? strategyGraph.connections : [];
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const actions = blocks
    .map((block, index) => ({ id: getBlockId(block, index), block }))
    .filter(({ block }) => getBlockType(block) === "action");
  const actionById = new Map(actions.map(({ id, block }) => [id, block]));

  actions.forEach(({ id: targetId, block: targetAction }) => {
    const targetText = collectHarnessValueText(getBlockConfig(targetAction)).toLowerCase();
    actions.forEach(({ id: sourceId }) => {
      if (sourceId === targetId) return;
      if (!targetText.includes(sourceId.toLowerCase())) return;
      if (hasConfirmationActionChain(blocksById, connections, sourceId, targetId)) return;
      errors.push(`Action ${targetId} references ${sourceId} output but is missing action-result -> confirmation trigger -> trigger-action sequencing`);
    });
  });

  const triggerFanout = new Map<string, string[]>();
  connections.forEach((connection) => {
    if (normalizeGraphText(connection.kind) !== "trigger-action") return;
    const fromId = normalizeGraphText(connection.fromId);
    const toId = normalizeGraphText(connection.toId);
    if (!fromId || !actionById.has(toId)) return;
    const targets = triggerFanout.get(fromId) ?? [];
    targets.push(toId);
    triggerFanout.set(fromId, targets);
  });

  triggerFanout.forEach((targetIds, triggerId) => {
    if (targetIds.length < 2) return;
    targetIds.forEach((leftId) => {
      targetIds.forEach((rightId) => {
        if (leftId === rightId) return;
        const leftAction = actionById.get(leftId);
        const rightAction = actionById.get(rightId);
        if (!leftAction || !rightAction) return;
        const orderKind = actionOrderKind(leftAction, rightAction);
        if (!orderKind) return;
        if (hasConfirmationActionChain(blocksById, connections, leftId, rightId)) return;
        errors.push(`Trigger ${triggerId} fans out dependent actions ${leftId} -> ${rightId}; use a confirmation trigger chain for ${orderKind}`);
      });
    });
  });

  return errors;
}

function mergeWorkflowGroupsByConnections(
  workflowGroups: EasyWorkflowGroupSpec[],
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
  initialBlockWorkflowId: Map<string, string>,
) {
  if (workflowGroups.length <= 1) {
    return { workflowGroups, blockWorkflowId: initialBlockWorkflowId };
  }
  if (workflowGroups.some((group) => normalizeGraphText(group.sequenceType).toLowerCase() === "check-effect")) {
    return { workflowGroups, blockWorkflowId: initialBlockWorkflowId };
  }

  const groupIds = new Set(workflowGroups.map((group) => group.id));
  const parent = new Map(workflowGroups.map((group) => [group.id, group.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    if (!groupIds.has(left) || !groupIds.has(right)) return;
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent.set(rightRoot, leftRoot);
  };

  connections.forEach((connection) => {
    const source = normalizeGraphText(connection.fromId);
    const target = normalizeGraphText(connection.toId);
    const sourceWorkflowId = initialBlockWorkflowId.get(source);
    const targetWorkflowId = initialBlockWorkflowId.get(target);
    if (!sourceWorkflowId || !targetWorkflowId || sourceWorkflowId === targetWorkflowId) return;
    union(sourceWorkflowId, targetWorkflowId);
  });

  const oldToMergedId = new Map<string, string>();
  workflowGroups.forEach((group) => oldToMergedId.set(group.id, find(group.id)));
  const hasMerge = workflowGroups.some((group) => oldToMergedId.get(group.id) !== group.id);
  if (!hasMerge) {
    return { workflowGroups, blockWorkflowId: initialBlockWorkflowId };
  }

  const blockIds = new Set(blocks.map((block, index) => getBlockId(block, index)));
  const mergedById = new Map<string, {
    groups: EasyWorkflowGroupSpec[];
    nodeIds: Set<string>;
    mustStayVisibleNodeIds: Set<string>;
  }>();

  workflowGroups.forEach((group) => {
    const mergedId = oldToMergedId.get(group.id) ?? group.id;
    const entry = mergedById.get(mergedId) ?? {
      groups: [],
      nodeIds: new Set<string>(),
      mustStayVisibleNodeIds: new Set<string>(),
    };
    entry.groups.push(group);
    group.nodeIds.forEach((nodeId) => {
      if (blockIds.has(nodeId)) entry.nodeIds.add(nodeId);
    });
    group.mustStayVisibleNodeIds.forEach((nodeId) => {
      if (blockIds.has(nodeId)) entry.mustStayVisibleNodeIds.add(nodeId);
    });
    mergedById.set(mergedId, entry);
  });

  initialBlockWorkflowId.forEach((workflowId, blockId) => {
    const mergedId = oldToMergedId.get(workflowId) ?? workflowId;
    const entry = mergedById.get(mergedId);
    if (entry && blockIds.has(blockId)) entry.nodeIds.add(blockId);
  });

  const mergedWorkflowGroups = Array.from(mergedById.entries())
    .map(([mergedId, entry]) => {
      const firstGroup = entry.groups[0];
      const mergedTitle = entry.groups.length === 1
        ? firstGroup.title
        : "Connected trading flow";
      const mergedPurpose = entry.groups.length === 1
        ? firstGroup.purpose
        : "All runtime blocks connected by arrows are kept inside one visible sequence.";
      return {
        id: mergedId,
        title: mergedTitle || mergedId,
        purpose: mergedPurpose || firstGroup.purpose,
        nodeIds: Array.from(entry.nodeIds),
        canAbstract: entry.groups.every((group) => group.canAbstract),
        mustStayVisibleNodeIds: Array.from(entry.mustStayVisibleNodeIds),
      };
    })
    .filter((group) => group.nodeIds.length > 0);

  const mergedBlockWorkflowId = new Map<string, string>();
  initialBlockWorkflowId.forEach((workflowId, blockId) => {
    mergedBlockWorkflowId.set(blockId, oldToMergedId.get(workflowId) ?? workflowId);
  });

  return { workflowGroups: mergedWorkflowGroups, blockWorkflowId: mergedBlockWorkflowId };
}

const ADVANCED_NODE_WIDTH = 360;
const ADVANCED_SEQUENCE_LEFT = 40;
const ADVANCED_SEQUENCE_TOP = 50;
const ADVANCED_SEQUENCE_LANE_GAP = 96;
const ADVANCED_SEQUENCE_STACK_GAP = 42;
const ADVANCED_SEQUENCE_CHILD_X = 28;
const ADVANCED_SEQUENCE_CHILD_Y = 62;
const ADVANCED_SEQUENCE_NODE_GAP = 430;
const ADVANCED_SEQUENCE_MIN_WIDTH = 720;
const ADVANCED_SEQUENCE_HEIGHT = 240;

function workflowGroupLooksLikeInit(group: EasyWorkflowGroupSpec) {
  return /\b(init|initial|start|startup|bootstrap|setup|entry|capital)\b|초기|시작|진입|준비|자금/.test(
    `${group.id} ${group.title} ${group.purpose}`.toLowerCase(),
  );
}

function blockLooksLikeStartTrigger(block: StrategyGraphBlock) {
  if (getBlockType(block) !== "trigger") return false;
  const config = getBlockConfig(block);
  return isManualLikeTriggerConfig(config) || /\b(start|startup|manual|click|button)\b|시작|수동|클릭|버튼/.test(
    `${getBlockId(block)} ${collectEasyBlockText(block)}`.toLowerCase(),
  );
}

function addVisibleStartTriggerBlocks(
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
  workflowGroups: EasyWorkflowGroupSpec[],
) {
  if (workflowGroups.length === 0) return { blocks, connections, workflowGroups };
  const blockIds = new Set(blocks.map((block, index) => getBlockId(block, index)));
  const blockById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  let nextBlocks = blocks;
  let nextConnections = connections;
  let nextWorkflowGroups = workflowGroups;

  workflowGroups.forEach((group) => {
    if (!workflowGroupLooksLikeInit(group)) return;
    const memberIds = group.nodeIds.filter((nodeId) => blockIds.has(nodeId));
    if (memberIds.length === 0) return;
    if (memberIds.some((nodeId) => blockLooksLikeStartTrigger(blockById.get(nodeId) ?? {}))) return;

    const targetId = memberIds.find((nodeId) => {
      const blockType = getBlockType(blockById.get(nodeId) ?? {});
      return blockType === "trigger" || blockType === "action";
    });
    if (!targetId) return;

    const targetBlock = blockById.get(targetId);
    const startId = sanitizeGraphId(`${group.id}-strategy-start`, `strategy-start-${nextBlocks.length + 1}`);
    if (blockIds.has(startId)) return;
    blockIds.add(startId);
    const startBlock: StrategyGraphBlock = {
      id: startId,
      type: "trigger",
      config: {
        name: "전략 시작",
        label: "전략 시작",
        title: "전략 시작",
        triggerType: "manual",
        workflowId: group.id,
        description: "전략이 시작되면 true 신호를 내보내 초기 실행 조건을 평가합니다.",
        outputBlocks: [
          {
            id: "click",
            name: "start",
            description: "전략 시작 시 true",
            type: "output",
          },
        ],
      },
    };
    const connectionKind = getBlockType(targetBlock ?? {}) === "action" ? "trigger-action" : "trigger-input";
    nextBlocks = [startBlock, ...nextBlocks];
    nextConnections = [
      {
        id: `${startId}-${targetId}`,
        kind: connectionKind,
        fromId: startId,
        toId: targetId,
      },
      ...nextConnections,
    ];
    nextWorkflowGroups = nextWorkflowGroups.map((item) => {
      if (item.id !== group.id) return item;
      return {
        ...item,
        nodeIds: [startId, ...item.nodeIds.filter((nodeId) => nodeId !== startId)],
        mustStayVisibleNodeIds: [startId, ...item.mustStayVisibleNodeIds.filter((nodeId) => nodeId !== startId)],
      };
    });
  });

  return { blocks: nextBlocks, connections: nextConnections, workflowGroups: nextWorkflowGroups };
}

function getFirstOutputBlock(block: StrategyGraphBlock | undefined, fallbackName = "trigger") {
  const outputs = readOutputBlocks(block ? getBlockConfig(block) : {}, [fallbackName]);
  return outputs[0] ?? { id: fallbackName, name: fallbackName, type: "output" as const };
}

function materializeTriggerActionFormulaBlocks(
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
  workflowGroups: EasyWorkflowGroupSpec[],
) {
  const blockById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const addedBlocks: StrategyGraphBlock[] = [];
  const insertedFormulaTargets: Array<{ formulaId: string; targetId: string }> = [];
  const nextConnections: StrategyGraphConnection[] = [];

  connections.forEach((connection, index) => {
    const kind = normalizeGraphText(connection.kind, "data-flow");
    const sourceId = normalizeGraphText(connection.fromId);
    const targetId = normalizeGraphText(connection.toId);
    const sourceBlock = blockById.get(sourceId);
    const targetBlock = blockById.get(targetId);
    const sourceType = getBlockType(sourceBlock ?? {});
    const targetType = getBlockType(targetBlock ?? {});
    const shouldMaterialize =
      kind === "trigger-action" &&
      sourceId &&
      targetId &&
      targetType === "action" &&
      (sourceType === "normal" || sourceType === "streaming");

    if (!shouldMaterialize) {
      nextConnections.push(connection);
      return;
    }

    const sourceConfig = getBlockConfig(sourceBlock ?? {});
    const sourceLabel = readConfigText(sourceConfig, ["name", "label", "title", "functionName"], sourceId);
    const sourceOutput = getFirstOutputBlock(sourceBlock, sourceType === "normal" ? "trigger" : "signal");
    const sourceOutputLooksTrigger = /\btrigger(?:ed)?\b/i.test(`${sourceOutput.id} ${sourceOutput.name}`);
    const sourceOutputName = sourceType === "normal" ? "trigger" : sourceOutput.name || "signal";
    const sourceOutputId = sourceType === "normal" && !sourceOutputLooksTrigger
      ? "trigger"
      : sourceOutput.id || sourceOutputName;
    const formulaId = makeUniqueStrategyBlockId(
      [...blocks, ...addedBlocks],
      sanitizeGraphId(`${sourceId}-${targetId}-trigger-formula`, `trigger-formula-${index + 1}`),
    );

    addedBlocks.push({
      id: formulaId,
      type: "trigger",
      config: {
        name: `${sourceLabel} trigger`,
        triggerType: "condition",
        condition: `${sourceId}::${String(sourceOutputName).replace(/[^a-zA-Z0-9_.:-]+/g, "_")} == true`,
        overviewDescription: `${sourceLabel}.${sourceOutputName} boolean 데이터를 실행 조건으로 변환합니다.`,
        inputBlocks: [
          {
            id: "trigger",
            name: "trigger",
            description: `${sourceLabel}.${sourceOutputName} boolean 데이터`,
            type: "input",
          },
        ],
        outputBlocks: [
          {
            id: "trigger",
            name: "trigger",
            description: "조건식 결과 boolean 데이터",
            type: "output",
          },
        ],
        materializedTriggerFormula: true,
      },
    });
    insertedFormulaTargets.push({ formulaId, targetId });

    nextConnections.push(
      {
        id: `${normalizeGraphText(connection.id, `edge-${index}`)}-data-trigger`,
        kind: "data-flow",
        fromId: sourceId,
        toId: formulaId,
        sourceBlockId: sourceOutputId,
        easyLabel: "조건 입력",
        sharedDataPipeline: connection.sharedDataPipeline === true,
      },
      {
        ...connection,
        id: `${normalizeGraphText(connection.id, `edge-${index}`)}-trigger-action`,
        kind: "trigger-action",
        fromId: formulaId,
        toId: targetId,
      },
    );
  });

  if (addedBlocks.length === 0) {
    return { blocks, connections, workflowGroups };
  }

  const nextWorkflowGroups = workflowGroups.map((group) => {
    const additions = insertedFormulaTargets.filter(({ targetId }) => group.nodeIds.includes(targetId));
    if (additions.length === 0) return group;

    const nextNodeIds = [...group.nodeIds];
    additions.forEach(({ formulaId, targetId }) => {
      if (nextNodeIds.includes(formulaId)) return;
      const targetIndex = nextNodeIds.indexOf(targetId);
      nextNodeIds.splice(targetIndex >= 0 ? targetIndex : nextNodeIds.length, 0, formulaId);
    });

    const nextVisibleIds = [...group.mustStayVisibleNodeIds];
    additions.forEach(({ formulaId }) => {
      if (!nextVisibleIds.includes(formulaId)) nextVisibleIds.push(formulaId);
    });

    const checkEffect = group.checkEffect && typeof group.checkEffect === "object"
      ? group.checkEffect as Record<string, unknown>
      : undefined;
    const matchingCheckFormula = additions.find(({ targetId }) =>
      normalizeGraphText(checkEffect?.effectNodeId) === targetId,
    );

    return {
      ...group,
      nodeIds: nextNodeIds,
      mustStayVisibleNodeIds: nextVisibleIds,
      ...(checkEffect && matchingCheckFormula
        ? { checkEffect: { ...checkEffect, checkNodeId: matchingCheckFormula.formulaId } }
        : {}),
    };
  });

  return { blocks: [...blocks, ...addedBlocks], connections: nextConnections, workflowGroups: nextWorkflowGroups };
}

function buildAdvancedGraphFromStrategyGraph(strategyGraph: StrategyGraphPayload, defaultTitle: string): AdvancedGraph {
  let allBlocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  let connections = Array.isArray(strategyGraph.connections) ? strategyGraph.connections : [];
  let sourceWorkflowGroups = normalizeEasyWorkflowGroups(strategyGraph);
  const startTriggerPatch = addVisibleStartTriggerBlocks(allBlocks, connections, sourceWorkflowGroups);
  allBlocks = startTriggerPatch.blocks;
  connections = startTriggerPatch.connections;
  sourceWorkflowGroups = startTriggerPatch.workflowGroups;
  const triggerFormulaPatch = materializeTriggerActionFormulaBlocks(allBlocks, connections, sourceWorkflowGroups);
  allBlocks = triggerFormulaPatch.blocks;
  connections = triggerFormulaPatch.connections;
  sourceWorkflowGroups = triggerFormulaPatch.workflowGroups;
  let allBlocksById = new Map(allBlocks.map((block, index) => [getBlockId(block, index), block]));
  const inlineTriggers = buildAdvancedInlineTriggerMap(allBlocks, connections);
  const hiddenBooleanRelayIds = buildOmittableBooleanRelayIds(allBlocks, connections);
  allBlocks = withHiddenRelayConditionsOnTriggers(allBlocks, connections, hiddenBooleanRelayIds);
  allBlocksById = new Map(allBlocks.map((block, index) => [getBlockId(block, index), block]));
  const hiddenValueBlockIds = new Set(
    allBlocks
      .map((block, index) => ({ block, id: getBlockId(block, index) }))
      .filter(({ block, id }) => isFixedValueBlock(block) || hiddenBooleanRelayIds.has(id))
      .map(({ id }) => id),
  );
  const blocks = allBlocks.filter((block, index) => {
    const id = getBlockId(block, index);
    return !hiddenValueBlockIds.has(id) && !inlineTriggers.triggerById.has(id);
  });
  const relayRemappedConnections = remapHiddenBooleanRelayConnections(
    connections,
    hiddenBooleanRelayIds,
    allBlocksById,
  );
  const visibleConnections = remapInlineTriggerConnections(
    relayRemappedConnections,
    inlineTriggers.triggerById,
    hiddenValueBlockIds,
  );
  const sharedPipeline = analyzeSharedDataPipelines(allBlocks, visibleConnections);
  const layout = computeGraphLayout(blocks, visibleConnections);
  const layoutById = new Map(layout.map((item) => [item.id, item]));
  const blockIds = new Set(blocks.map((block, index) => getBlockId(block, index)));
  let workflowGroups = sourceWorkflowGroups.length > 0
    ? sourceWorkflowGroups
    : [{
      id: "main-workflow",
      title: "메인 전략 흐름",
      purpose: "AI가 명시 시퀀스를 만들지 않은 전략의 기본 실행 흐름입니다.",
      nodeIds: Array.from(blockIds),
      canAbstract: true,
      mustStayVisibleNodeIds: blocks
        .map((block, index) => ({ block, id: getBlockId(block, index) }))
        .filter(({ block }) => getBlockType(block) === "action" || isKillSwitchBlock(block))
        .map(({ id }) => id),
    }];
  let blockWorkflowId = new Map<string, string>();
  workflowGroups.forEach((group) => {
    group.nodeIds.forEach((nodeId) => {
      if (blockIds.has(nodeId) && !blockWorkflowId.has(nodeId)) {
        blockWorkflowId.set(nodeId, group.id);
      }
    });
  });
  blocks.forEach((block, index) => {
    const blockId = getBlockId(block, index);
    const workflowId = getBlockWorkflowId(block);
    if (workflowId && workflowGroups.some((group) => group.id === workflowId)) {
      blockWorkflowId.set(blockId, workflowId);
    }
  });
  const mergedWorkflowScope = mergeWorkflowGroupsByConnections(
    workflowGroups,
    blocks,
    visibleConnections,
    blockWorkflowId,
  );
  workflowGroups = mergedWorkflowScope.workflowGroups;
  blockWorkflowId = mergedWorkflowScope.blockWorkflowId;
  const workflowGroupsWithMembers = [...workflowGroups]
    .sort(compareWorkflowGroupsForLeftToRightLayout)
    .map((group) => ({
      group,
      memberIds: blocks
        .map((block, index) => getBlockId(block, index))
        .filter((blockId) => blockWorkflowId.get(blockId) === group.id)
        .sort((a, b) => {
          const aLayout = layoutById.get(a) ?? { level: 0, row: 0 };
          const bLayout = layoutById.get(b) ?? { level: 0, row: 0 };
          return aLayout.level - bLayout.level || aLayout.row - bLayout.row;
        }),
    }))
    .filter((item) => item.memberIds.length > 0);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const mainGroupId = `ai_adv_group_${Date.now()}`;
  const strategyBlock = getStrategyBlockMetadata(strategyGraph, defaultTitle);
  const sequenceLayoutEntries = workflowGroupsWithMembers.map(({ group, memberIds }, index) => {
    const memberBlocks = memberIds
      .map((memberId) => allBlocksById.get(memberId))
      .filter((block): block is StrategyGraphBlock => Boolean(block));
    const styleType = inferAdvancedSequenceStyle(group, memberBlocks);
    const width = Math.max(
      ADVANCED_SEQUENCE_MIN_WIDTH,
      ADVANCED_SEQUENCE_CHILD_X * 2 + memberIds.length * ADVANCED_NODE_WIDTH + Math.max(0, memberIds.length - 1) * (ADVANCED_SEQUENCE_NODE_GAP - ADVANCED_NODE_WIDTH),
    );
    return {
      group,
      memberIds,
      index,
      styleType,
      lane: getWorkflowGroupLanePriority(group),
      sequenceGroupId: `ai_seq_${sanitizeGraphId(group.id, `workflow-${index + 1}`)}`,
      width,
      height: ADVANCED_SEQUENCE_HEIGHT,
    };
  });
  const sequenceLayoutOrder = [...sequenceLayoutEntries].sort((left, right) =>
    left.lane - right.lane ||
    (left.group.order ?? 0) - (right.group.order ?? 0) ||
    left.index - right.index ||
    left.group.id.localeCompare(right.group.id),
  );
  const occupiedLanes = Array.from(new Set(sequenceLayoutEntries.map((entry) => entry.lane))).sort((left, right) => left - right);
  const laneWidths = new Map<number, number>();
  sequenceLayoutEntries.forEach((entry) => {
    laneWidths.set(entry.lane, Math.max(laneWidths.get(entry.lane) ?? 0, entry.width));
  });
  const laneXByPriority = new Map<number, number>();
  let laneCursorX = ADVANCED_SEQUENCE_LEFT;
  occupiedLanes.forEach((lane) => {
    laneXByPriority.set(lane, laneCursorX);
    laneCursorX += (laneWidths.get(lane) ?? ADVANCED_SEQUENCE_MIN_WIDTH) + ADVANCED_SEQUENCE_LANE_GAP;
  });
  const laneCursorYByPriority = new Map<number, number>(occupiedLanes.map((lane) => [lane, ADVANCED_SEQUENCE_TOP]));
  const sequencePositionByWorkflowId = new Map<string, { x: number; y: number }>();
  sequenceLayoutOrder.forEach((entry) => {
    const x = laneXByPriority.get(entry.lane) ?? ADVANCED_SEQUENCE_LEFT;
    const y = laneCursorYByPriority.get(entry.lane) ?? ADVANCED_SEQUENCE_TOP;
    sequencePositionByWorkflowId.set(entry.group.id, { x, y });
    laneCursorYByPriority.set(entry.lane, y + entry.height + ADVANCED_SEQUENCE_STACK_GAP);
  });

  nodes.push({
    id: mainGroupId,
    type: "groupNode",
    position: { x: 50, y: 50 },
    style: { width: 1200, height: 800 },
    data: {
      label: strategyBlock.title || "AI 지능형 파이프라인 (Advanced)",
      purpose: strategyBlock.purpose,
      styleType: "solid"
    }
  });

  const sequenceGroupByWorkflowId = new Map<string, string>();
  sequenceLayoutOrder.forEach(({ group, index, styleType, sequenceGroupId, width }) => {
    const position = sequencePositionByWorkflowId.get(group.id) ?? { x: ADVANCED_SEQUENCE_LEFT, y: ADVANCED_SEQUENCE_TOP };
    sequenceGroupByWorkflowId.set(group.id, sequenceGroupId);
    nodes.push({
      id: sequenceGroupId,
      type: "groupNode",
      parentId: mainGroupId,
      extent: "parent",
      position: {
        x: position.x,
        y: position.y,
      },
      style: { width, height: ADVANCED_SEQUENCE_HEIGHT },
      data: {
        label: group.title || group.id,
        purpose: group.purpose,
        sequenceType: group.sequenceType || "workflow",
        order: group.order ?? index + 1,
        sharedDataPipeline: group.sharedDataPipeline === true,
        styleType,
        requiredStates: styleType === "pipeline" ? [] : styleType === "dashed-init" ? ["IDLE"] : styleType === "dashed-emergency" ? ["ACTIVE", "CLOSED"] : ["ACTIVE"],
        executingStates: styleType === "pipeline" ? [] : styleType === "dashed-init" ? ["IDLE"] : styleType === "dashed-emergency" ? ["CLOSED"] : [],
        isCollapsed: false,
        ...getAdvancedSequenceSummary(group, styleType),
        collapsedWidth: 196,
        collapsedHeight: 118,
      },
    });
  });

  blocks.forEach((block, index) => {
    const id = normalizeGraphText(block.id, `adv-${index}`);
    const bType = normalizeGraphText(block.type, "normal");
    const item = layoutById.get(id) || { level: index, row: 0 };
    const workflowId = blockWorkflowId.get(id);
    const sequenceGroupId = workflowId ? sequenceGroupByWorkflowId.get(workflowId) : undefined;
    const workflowMemberIndex = workflowId
      ? workflowGroupsWithMembers.find((entry) => entry.group.id === workflowId)?.memberIds.indexOf(id) ?? -1
      : -1;
    const baseConfig = block.config && typeof block.config === "object" ? block.config : {};
    const inlineTrigger = inlineTriggers.sourceToTrigger.get(id);
    const config = withInlineTriggerConfig(
      deriveAdvancedBlockConfig(id, bType, baseConfig, allBlocksById, connections),
      inlineTrigger,
    );
    const rfType = getAdvancedNodeType(bType, config);

    nodes.push({
      id,
      type: rfType,
      parentId: sequenceGroupId || mainGroupId,
      extent: "parent",
      position: sequenceGroupId
        ? {
          x: ADVANCED_SEQUENCE_CHILD_X + Math.max(0, workflowMemberIndex) * ADVANCED_SEQUENCE_NODE_GAP,
          y: ADVANCED_SEQUENCE_CHILD_Y,
        }
        : {
          x: 48 + item.level * 340,
          y: ADVANCED_SEQUENCE_TOP + ADVANCED_SEQUENCE_HEIGHT + 80 + item.row * 210,
        },
      data: {
        ...config,
        ...(workflowId ? { workflowId } : {}),
        ...buildAdvancedNodeData(id, bType, config),
      },
    });
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  visibleConnections.forEach((conn, index) => {
    const source = normalizeGraphText(conn.fromId);
    const target = normalizeGraphText(conn.toId);
    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    if (!sourceNode || !targetNode || sourceNode.id === mainGroupId || targetNode.id === mainGroupId) return;
    const kind = normalizeGraphText(conn.kind, "sequence");
    const isDataLike = /data|result|metric|output|input|stream|monitor/i.test(kind) || targetNode.type === "monitoringNode";
    const isSharedPipelineEdge = conn.sharedDataPipeline === true || sharedPipeline.edgeKeys.has(connectionPairKey(source, target));
    const sourceHandle = getConnectionSourceHandle(conn, sourceNode);
    edges.push({
      id: normalizeGraphText(conn.id, `adv-edge-${index}`),
      source,
      target,
      sourceHandle,
      targetHandle: isDataLike ? getDataTargetHandle(targetNode) : getExecutionTargetHandle(targetNode),
      type: "custom",
      animated: true,
      data: { label: kind, ...(isSharedPipelineEdge ? { sharedDataPipeline: true } : {}) },
      style: { strokeWidth: isSharedPipelineEdge ? 4 : 3, ...(isSharedPipelineEdge ? { stroke: "var(--advanced-edge-shared-pipeline, #ef4444)" } : {}) },
    });
  });

  const confirmationInputByTriggerId = new Map<string, string[]>();
  const confirmationOutputByTriggerId = new Map<string, string[]>();
  visibleConnections.forEach((conn) => {
    const source = normalizeGraphText(conn.fromId);
    const target = normalizeGraphText(conn.toId);
    const kind = normalizeGraphText(conn.kind);
    if (kind === "action-result" && nodeById.get(source)?.type === "actionNode" && nodeById.get(target)?.type !== "actionNode") {
      const sources = confirmationInputByTriggerId.get(target) ?? [];
      sources.push(source);
      confirmationInputByTriggerId.set(target, sources);
    }
    if (kind === "trigger-action" && nodeById.get(source)?.type !== "actionNode" && nodeById.get(target)?.type === "actionNode") {
      const targets = confirmationOutputByTriggerId.get(source) ?? [];
      targets.push(target);
      confirmationOutputByTriggerId.set(source, targets);
    }
  });

  let visualSequenceIndex = 0;
  confirmationInputByTriggerId.forEach((sourceIds, triggerId) => {
    const targetIds = confirmationOutputByTriggerId.get(triggerId) ?? [];
    sourceIds.forEach((sourceId) => {
      targetIds.forEach((targetId) => {
        const sourceNode = nodeById.get(sourceId);
        const targetNode = nodeById.get(targetId);
        if (!sourceNode || !targetNode || sourceId === targetId) return;
        visualSequenceIndex += 1;
        edges.push({
          id: `adv-visual-action-sequence-${visualSequenceIndex}-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          sourceHandle: getOutputHandle(sourceNode),
          targetHandle: getExecutionTargetHandle(targetNode),
          type: "custom",
          animated: true,
          data: { label: "then", visualOnly: true, sequenceDependency: true },
          style: { strokeWidth: 4, strokeDasharray: "10 6" },
        });
      });
    });
  });

  const edgeKeySet = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
  const triggerActionConnections = connections.filter((conn) => {
    const source = normalizeGraphText(conn.fromId);
    const target = normalizeGraphText(conn.toId);
    const kind = normalizeGraphText(conn.kind);
    return kind === "trigger-action" && nodeById.get(source)?.type === "timeTrigger" && nodeById.get(target)?.type === "actionNode";
  });
  const actionInputConnections = connections.filter((conn) => {
    const source = normalizeGraphText(conn.fromId);
    const target = normalizeGraphText(conn.toId);
    const kind = normalizeGraphText(conn.kind);
    return kind === "action-input" && nodeById.get(source)?.type === "streamingNode" && nodeById.get(target)?.type === "actionNode";
  });

  triggerActionConnections.forEach((triggerConn, triggerIndex) => {
    const triggerId = normalizeGraphText(triggerConn.fromId);
    const actionId = normalizeGraphText(triggerConn.toId);
    const triggerNode = nodeById.get(triggerId);
    if (!triggerNode) return;

    actionInputConnections
      .filter((inputConn) => normalizeGraphText(inputConn.toId) === actionId)
      .forEach((inputConn, inputIndex) => {
        const streamId = normalizeGraphText(inputConn.fromId);
        const streamNode = nodeById.get(streamId);
        if (!streamNode || edgeKeySet.has(`${triggerId}->${streamId}`)) return;
        edgeKeySet.add(`${triggerId}->${streamId}`);
        edges.push({
          id: `adv-visual-interval-feed-${triggerIndex}-${inputIndex}`,
          source: triggerId,
          target: streamId,
          sourceHandle: getOutputHandle(triggerNode),
          targetHandle: getExecutionTargetHandle(streamNode),
          type: "custom",
          animated: true,
          data: { label: "interval sample" },
          style: { strokeWidth: 3, strokeDasharray: "8 7" },
        });
      });
  });

  resizeAdvancedGroup(nodes, mainGroupId);
  return { nodes, edges };
}

function resizeAdvancedGroup(nodes: Node[], groupId: string) {
  const groupNode = nodes.find((node) => node.id === groupId);
  if (!groupNode) return;
  const children = nodes.filter((node) => node.parentId === groupId);
  const maxRight = children.reduce((max, node) => Math.max(max, node.position.x + Number(node.style?.width ?? 360)), 0);
  const maxBottom = children.reduce((max, node) => Math.max(max, node.position.y + Number(node.style?.height ?? 240)), 0);
  groupNode.style = {
    ...(groupNode.style ?? {}),
    width: Math.max(1200, maxRight + 80),
    height: Math.max(800, maxBottom + 80),
  };
}

function validateBlockArray(value: unknown, label: string, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must contain at least one block`);
    return;
  }
  value.forEach((block, index) => {
    if (!block || typeof block !== "object") {
      errors.push(`${label}[${index}] must be object`);
      return;
    }
    const item = block as Partial<BlockData>;
    if (!item.id || !item.name || item.type !== "input" && item.type !== "output") {
      errors.push(`${label}[${index}] has invalid id/name/type`);
    }
  });
}

function validateAdvancedNode(node: Node, errors: string[]) {
  if (!node.id) errors.push("node id is empty");
  if (!ADVANCED_NODE_TYPES.has(String(node.type))) errors.push(`unsupported node type: ${String(node.type)}`);
  if (!node.data || typeof node.data !== "object") errors.push(`${node.id} data is empty`);

  if (node.type === "actionNode") {
    const data = node.data as Partial<ActionNodeData>;
    if (data.actionType !== "CEX" && data.actionType !== "DEX") errors.push(`${node.id} actionType is missing`);
    validateBlockArray(data.inputBlocks, `${node.id}.inputBlocks`, errors);
    validateBlockArray(data.outputBlocks, `${node.id}.outputBlocks`, errors);
  }

  if (node.type === "streamingNode") {
    const data = node.data as Partial<StreamingNodeData>;
    if (data.method !== "POLLING" && data.method !== "WEBSOCKET") errors.push(`${node.id} streaming method is invalid`);
    validateBlockArray(data.outputBlocks, `${node.id}.outputBlocks`, errors);
  }

  if (node.type === "functionNode") {
    const data = node.data as Partial<FunctionNodeData>;
    if (!data.label || !data.functionName || typeof data.code !== "string") errors.push(`${node.id} function data is incomplete`);
    validateBlockArray(data.inputBlocks, `${node.id}.inputBlocks`, errors);
    validateBlockArray(data.outputBlocks, `${node.id}.outputBlocks`, errors);
  }

  if (node.type === "monitoringNode") {
    const data = node.data as Partial<MonitoringNodeData>;
    if (!data.label || !Array.isArray(data.selectedVariables)) errors.push(`${node.id} monitoring data is incomplete`);
  }

  if (node.type === "timeTrigger") {
    const data = node.data as Partial<TimeTriggerData>;
    if (!Number.isFinite(data.interval) || Number(data.interval) <= 0) errors.push(`${node.id} interval is invalid`);
    if (typeof data.isActive !== "boolean") errors.push(`${node.id} isActive is invalid`);
  }

  if (node.type === "clickTrigger") {
    const data = node.data as Partial<ClickTriggerData>;
    if (!data.label) errors.push(`${node.id} click trigger label is missing`);
    validateBlockArray(data.outputBlocks, `${node.id}.outputBlocks`, errors);
  }
}

function getAdvancedSequenceAncestorId(node: Node | undefined, nodeById: Map<string, Node>) {
  let parentId = node?.parentId;
  while (parentId) {
    const parent = nodeById.get(parentId);
    const data = parent?.data && typeof parent.data === "object" ? parent.data as Record<string, unknown> : {};
    if (parent?.type === "groupNode" && data.styleType !== "solid") return parent.id;
    parentId = parent?.parentId;
  }
  return "";
}

function getAdvancedSequenceType(sequenceId: string, nodeById: Map<string, Node>) {
  const node = nodeById.get(sequenceId);
  const data = node?.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return normalizeGraphText(data.sequenceType).toLowerCase();
}

function advancedNodeIsAllowedInDataPipeline(node: Node) {
  return node.type === "streamingNode" || node.type === "functionNode";
}

function advancedDimension(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getAdvancedNodeSize(node: Node) {
  const style = node.style as Record<string, unknown> | undefined;
  const measured = node.measured as { width?: number; height?: number } | undefined;
  const widthFallback = node.type === "groupNode" ? 360 : node.type === "timeTrigger" ? 300 : 340;
  const heightFallback = node.type === "groupNode" ? 220 : node.type === "timeTrigger" ? 96 : 128;
  return {
    width: advancedDimension(style?.width ?? measured?.width ?? node.width, widthFallback),
    height: advancedDimension(style?.height ?? measured?.height ?? node.height, heightFallback),
  };
}

function getAdvancedGroupLanePriority(node: Node) {
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  const sequenceType = normalizeGraphText(data.sequenceType).toLowerCase();
  if (data.styleType === "pipeline" || sequenceType === "data-pipeline" || sequenceType === "pipeline" || data.sharedDataPipeline === true) {
    return 0;
  }
  if (sequenceType === "monitoring") return 2;
  return 1;
}

function compareAdvancedGroupNodesForLeftToRightLayout(left: Node, right: Node) {
  const leftData = left.data && typeof left.data === "object" ? left.data as Record<string, unknown> : {};
  const rightData = right.data && typeof right.data === "object" ? right.data as Record<string, unknown> : {};
  return getAdvancedGroupLanePriority(left) - getAdvancedGroupLanePriority(right) ||
    normalizeGraphNumber(leftData.order, 0) - normalizeGraphNumber(rightData.order, 0) ||
    left.position.x - right.position.x ||
    left.position.y - right.position.y ||
    left.id.localeCompare(right.id);
}

function arrangeAdvancedGroupsInLaneColumns(children: Node[]) {
  const ordered = children.sort(compareAdvancedGroupNodesForLeftToRightLayout);
  const occupiedLanes = Array.from(new Set(ordered.map(getAdvancedGroupLanePriority))).sort((left, right) => left - right);
  const laneWidths = new Map<number, number>();
  ordered.forEach((child) => {
    const size = getAdvancedNodeSize(child);
    const lane = getAdvancedGroupLanePriority(child);
    laneWidths.set(lane, Math.max(laneWidths.get(lane) ?? 0, size.width));
  });

  const laneXByPriority = new Map<number, number>();
  let cursorX = 40;
  occupiedLanes.forEach((lane) => {
    laneXByPriority.set(lane, cursorX);
    cursorX += (laneWidths.get(lane) ?? ADVANCED_SEQUENCE_MIN_WIDTH) + ADVANCED_SEQUENCE_LANE_GAP;
  });

  const laneCursorYByPriority = new Map<number, number>(occupiedLanes.map((lane) => [lane, 72]));
  let maxRight = 0;
  let maxBottom = 0;
  ordered.forEach((child) => {
    const lane = getAdvancedGroupLanePriority(child);
    const size = getAdvancedNodeSize(child);
    const x = laneXByPriority.get(lane) ?? 40;
    const y = laneCursorYByPriority.get(lane) ?? 72;
    child.position = { x, y };
    laneCursorYByPriority.set(lane, y + size.height + ADVANCED_SEQUENCE_STACK_GAP);
    maxRight = Math.max(maxRight, x + size.width);
    maxBottom = Math.max(maxBottom, y + size.height);
  });

  return { maxRight, maxBottom };
}

function validateAdvancedLayout(graph: AdvancedGraph, errors: string[]) {
  const visibleNodes = graph.nodes.filter((node) => !node.hidden);
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const siblingsByParent = new Map<string, Node[]>();
  visibleNodes.forEach((node) => {
    const parentKey = node.parentId ?? "__root__";
    const siblings = siblingsByParent.get(parentKey) ?? [];
    siblings.push(node);
    siblingsByParent.set(parentKey, siblings);
  });

  siblingsByParent.forEach((siblings) => {
    for (let leftIndex = 0; leftIndex < siblings.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < siblings.length; rightIndex += 1) {
        const left = siblings[leftIndex];
        const right = siblings[rightIndex];
        const leftSize = getAdvancedNodeSize(left);
        const rightSize = getAdvancedNodeSize(right);
        const leftRight = left.position.x + leftSize.width;
        const leftBottom = left.position.y + leftSize.height;
        const rightRight = right.position.x + rightSize.width;
        const rightBottom = right.position.y + rightSize.height;
        const overlaps = left.position.x < rightRight - 8 &&
          leftRight > right.position.x + 8 &&
          left.position.y < rightBottom - 8 &&
          leftBottom > right.position.y + 8;
        if (overlaps) {
          errors.push(`nodes overlap in same sequence/container: ${left.id} and ${right.id}`);
        }
      }
    }
  });

  visibleNodes.forEach((node) => {
    if (!node.parentId) return;
    const parent = nodeById.get(node.parentId);
    if (!parent) return;
    const nodeSize = getAdvancedNodeSize(node);
    const parentSize = getAdvancedNodeSize(parent);
    if (node.position.x < 0 || node.position.y < 0 ||
      node.position.x + nodeSize.width > parentSize.width + 12 ||
      node.position.y + nodeSize.height > parentSize.height + 12) {
      errors.push(`${node.id} is outside parent container ${node.parentId}`);
    }
  });
}

function advancedGraphIsMonitoringOnly(graph: AdvancedGraph) {
  const nonGroupNodes = graph.nodes.filter((node) => node.type !== "groupNode");
  if (nonGroupNodes.length === 0 || nonGroupNodes.some((node) => node.type === "actionNode")) return false;
  const hasMarketOrMonitorNode = nonGroupNodes.some((node) =>
    node.type === "streamingNode" ||
    node.type === "monitoringNode" ||
    node.type === "functionNode"
  );
  const sequenceGroups = graph.nodes.filter((node) => {
    if (node.type !== "groupNode") return false;
    const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
    return data.styleType !== "solid";
  });
  const hasExecutionSequence = sequenceGroups.some((node) => {
    const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
    const text = `${data.sequenceType ?? ""} ${data.label ?? ""} ${data.purpose ?? ""}`.toLowerCase();
    return /check-effect|execute|execution|order|swap|trade|action|실행|주문|거래|스왑/.test(text);
  });
  return hasMarketOrMonitorNode && !hasExecutionSequence;
}

function validateAdvancedGraph(graph: AdvancedGraph) {
  const errors: string[] = [];
  const ids = new Set<string>();
  const nonGroupNodes = graph.nodes.filter((node) => node.type !== "groupNode");
  if (nonGroupNodes.length === 0) errors.push("advanced graph has no strategy nodes");
  if (!nonGroupNodes.some((node) => node.type === "actionNode") && !advancedGraphIsMonitoringOnly(graph)) {
    errors.push("advanced graph has no executable action node");
  }

  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    validateAdvancedNode(node, errors);
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) errors.push(`${edge.id} source does not exist: ${edge.source}`);
    if (!ids.has(edge.target)) errors.push(`${edge.id} target does not exist: ${edge.target}`);
    if (edge.source === edge.target) errors.push(`${edge.id} is a self edge`);
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const pipelineGroupIds = new Set(
    graph.nodes
      .filter((node) => {
        if (node.type !== "groupNode") return false;
        const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
        return normalizeGraphText(data.sequenceType).toLowerCase() === "data-pipeline" ||
          normalizeGraphText(data.sequenceType).toLowerCase() === "pipeline" ||
          data.sharedDataPipeline === true ||
          data.styleType === "pipeline";
      })
      .map((node) => node.id),
  );
  for (const node of graph.nodes) {
    if (!node.parentId || !pipelineGroupIds.has(node.parentId)) continue;
    if (advancedNodeIsAllowedInDataPipeline(node)) continue;
    errors.push(`${node.id} cannot be inside data pipeline group ${node.parentId}; pipelines only allow streaming and indicator logic nodes`);
  }

  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.type === "groupNode" || targetNode.type === "groupNode") continue;
    const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
    if (data.sharedDataPipeline === true) continue;
    const sourceSequenceId = getAdvancedSequenceAncestorId(sourceNode, nodeById);
    const targetSequenceId = getAdvancedSequenceAncestorId(targetNode, nodeById);
    if (sourceSequenceId && targetSequenceId && sourceSequenceId !== targetSequenceId) {
      const sourceSequenceType = getAdvancedSequenceType(sourceSequenceId, nodeById);
      const targetSequenceType = getAdvancedSequenceType(targetSequenceId, nodeById);
      if (
        sourceNode.type === "monitoringNode" ||
        targetNode.type === "monitoringNode" ||
        sourceSequenceType === "monitoring" ||
        targetSequenceType === "monitoring"
      ) {
        continue;
      }
      errors.push(`${edge.id} crosses sequence boundary: ${sourceSequenceId} -> ${targetSequenceId}`);
    }
  }

  const visualSequenceEdges = new Set(
    graph.edges
      .filter((edge) => {
        const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
        return data.sequenceDependency === true;
      })
      .map((edge) => `${edge.source}->${edge.target}`),
  );
  const resultSourcesByMiddle = new Map<string, string[]>();
  const actionTargetsByMiddle = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
    if (data.visualOnly === true) return;
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const label = normalizeGraphText(data.label).toLowerCase();
    if (label === "action-result" && sourceNode?.type === "actionNode" && targetNode?.type !== "actionNode") {
      const list = resultSourcesByMiddle.get(edge.target) ?? [];
      list.push(edge.source);
      resultSourcesByMiddle.set(edge.target, list);
    }
    if (label === "trigger-action" && sourceNode?.type !== "actionNode" && targetNode?.type === "actionNode") {
      const list = actionTargetsByMiddle.get(edge.source) ?? [];
      list.push(edge.target);
      actionTargetsByMiddle.set(edge.source, list);
    }
  });
  resultSourcesByMiddle.forEach((sources, middleId) => {
    const targets = actionTargetsByMiddle.get(middleId) ?? [];
    sources.forEach((sourceId) => {
      targets.forEach((targetId) => {
        if (!visualSequenceEdges.has(`${sourceId}->${targetId}`)) {
          errors.push(`missing visible sequential action edge: ${sourceId} -> ${targetId}`);
        }
      });
    });
  });

  validateAdvancedLayout(graph, errors);

  for (const action of nonGroupNodes.filter((node) => node.type === "actionNode")) {
    if (!graph.edges.some((edge) => edge.target === action.id)) {
      errors.push(`${action.id} action node has no incoming edge`);
    }
  }

  return errors;
}

function patchNodeDataForHarness(node: Node): Node {
  const config = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  if (node.type === "actionNode") {
    return { ...node, data: buildActionNodeData(node.id, config) };
  }
  if (node.type === "streamingNode") {
    return { ...node, data: buildStreamingNodeData(node.id, config) };
  }
  if (node.type === "monitoringNode") {
    return { ...node, data: buildMonitoringNodeData(node.id, config) };
  }
  if (node.type === "timeTrigger") {
    return { ...node, data: buildTimeTriggerNodeData(node.id, config) };
  }
  if (node.type === "clickTrigger") {
    return { ...node, data: buildClickTriggerNodeData(node.id, config) };
  }
  if (node.type === "functionNode") {
    return { ...node, data: buildFunctionNodeData(node.id, "normal", config) };
  }
  return node;
}

function repairAdvancedLayout(nodes: Node[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depthForNode = (node: Node): number => {
    if (!node.parentId) return 0;
    const parent = nodeById.get(node.parentId);
    return parent ? depthForNode(parent) + 1 : 0;
  };
  const parentIds = Array.from(new Set(nodes.map((node) => node.parentId).filter(Boolean) as string[]))
    .sort((left, right) => {
      const leftNode = nodeById.get(left);
      const rightNode = nodeById.get(right);
      return (rightNode ? depthForNode(rightNode) : 0) - (leftNode ? depthForNode(leftNode) : 0);
    });

  parentIds.forEach((parentId) => {
    const parent = nodeById.get(parentId);
    if (!parent) return;
    const children = nodes.filter((node) => node.parentId === parentId && !node.hidden)
      .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y || left.id.localeCompare(right.id));
    if (children.length === 0) return;

    const parentData = parent.data && typeof parent.data === "object" ? parent.data as Record<string, unknown> : {};
    const layOutGroupsInLaneColumns = parentData.styleType === "solid" && children.every((node) => node.type === "groupNode");
    let cursor = 28;
    let maxRight = 0;
    let maxBottom = 0;

    if (layOutGroupsInLaneColumns) {
      const bounds = arrangeAdvancedGroupsInLaneColumns(children);
      maxRight = bounds.maxRight;
      maxBottom = bounds.maxBottom;
    } else {
      children.forEach((child) => {
        const size = getAdvancedNodeSize(child);
        child.position = { x: cursor, y: 72 };
        cursor += size.width + 90;
        maxRight = Math.max(maxRight, child.position.x + size.width);
        maxBottom = Math.max(maxBottom, child.position.y + size.height);
      });
    }

    parent.style = {
      ...(parent.style ?? {}),
      width: Math.max(720, maxRight + 80),
      height: Math.max(220, maxBottom + 64),
    };
  });
}

function repairAdvancedGraph(graph: AdvancedGraph): AdvancedGraph {
  const nodes = graph.nodes.map(patchNodeDataForHarness);
  repairAdvancedLayout(nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nonGroupNodes = nodes.filter((node) => node.type !== "groupNode");
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target)
    .map((edge) => {
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) return edge;
      return {
        ...edge,
        type: "custom",
        sourceHandle: edge.sourceHandle ?? getOutputHandle(sourceNode),
        targetHandle: edge.targetHandle ?? getExecutionTargetHandle(targetNode),
        style: { ...(edge.style ?? {}), strokeWidth: 3 },
      };
    });

  if (edges.length === 0 && nonGroupNodes.length > 1) {
    nonGroupNodes
      .slice(0, -1)
      .forEach((node, index) => {
        const nextNode = nonGroupNodes[index + 1];
        edges.push({
          id: `harness-edge-${index + 1}`,
          source: node.id,
          target: nextNode.id,
          sourceHandle: getOutputHandle(node),
          targetHandle: getExecutionTargetHandle(nextNode),
          type: "custom",
          animated: true,
          data: { label: "harness sequence" },
          style: { strokeWidth: 3 },
        });
      });
  }

  for (const actionNode of nonGroupNodes.filter((node) => node.type === "actionNode")) {
    if (edges.some((edge) => edge.target === actionNode.id)) continue;
    const sourceNode = nonGroupNodes
      .filter((node) => node.id !== actionNode.id)
      .sort((a, b) => Math.hypot(a.position.x - actionNode.position.x, a.position.y - actionNode.position.y)
        - Math.hypot(b.position.x - actionNode.position.x, b.position.y - actionNode.position.y))[0];
    if (!sourceNode) continue;
    edges.push({
      id: `harness-action-${sourceNode.id}-${actionNode.id}`,
      source: sourceNode.id,
      target: actionNode.id,
      sourceHandle: getOutputHandle(sourceNode),
      targetHandle: getExecutionTargetHandle(actionNode),
      type: "custom",
      animated: true,
      data: { label: "harness action input" },
      style: { strokeWidth: 3 },
    });
  }

  const groupNode = nodes.find((node) => node.type === "groupNode");
  if (groupNode) resizeAdvancedGroup(nodes, groupNode.id);
  return { nodes, edges };
}

function createAdvancedViewWithHarness(strategyGraph: StrategyGraphPayload, defaultTitle: string): AdvancedGraphHarnessResult {
  const contractErrors = [
    ...validateHarnessTradingLogicScope(strategyGraph),
    ...validateHarnessSequentialExecution(strategyGraph),
  ];
  if (contractErrors.length > 0) {
    throw new Error(`고급 전략 그래프 하네스 범위 위반: ${contractErrors.slice(0, 6).join("; ")}`);
  }

  let graph = buildAdvancedGraphFromStrategyGraph(strategyGraph, defaultTitle);
  const diagnostics: string[] = [];
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const errors = validateAdvancedGraph(graph);
    if (errors.length === 0) {
      diagnostics.push(`고급 그래프 하네스 검증 완료 (${attempt}회차)`);
      return { graph, attempts: attempt, diagnostics };
    }
    diagnostics.push(`고급 그래프 하네스 ${attempt}회차 수정: ${errors.slice(0, 4).join("; ")}`);
    graph = repairAdvancedGraph(graph);
  }

  const finalErrors = validateAdvancedGraph(graph);
  if (finalErrors.length > 0) {
    throw new Error(`고급 전략 그래프 생성 실패: ${finalErrors.slice(0, 6).join("; ")}`);
  }

  diagnostics.push("고급 그래프 하네스 검증 완료 (최종 복구)");
  return { graph, attempts: maxAttempts, diagnostics };
}

export function createAdvancedViewFromStrategyGraph(strategyGraph: StrategyGraphPayload, defaultTitle: string) {
  return createAdvancedViewWithHarness(withStrategyKillSwitch(strategyGraph), defaultTitle).graph;
}

export function chooseStrategyTemplateForPrompt(
  prompt: string,
  templates: StrategyTemplate[] = DEFAULT_STRATEGY_TEMPLATES,
) {
  const normalized = prompt.toLowerCase();
  if (/20ma|ma20|moving|이동평균|추세|trend|volume|거래량|btc/.test(normalized)) {
    return templates.find((template) => template.id === "trend") ?? templates[0];
  }
  if (/dca|분할|정기|4시간|eth/.test(normalized)) {
    return templates.find((template) => template.id === "dca") ?? templates[0];
  }
  if (/funding|펀딩|중립|neutral/.test(normalized)) {
    return templates.find((template) => template.id === "funding") ?? templates[0];
  }
  return templates.find((template) => template.id === "basis") ?? templates[0];
}

export function buildEasyViewEdges(
  nodes: EasyViewNode[],
  pairs: Array<[string, string, string?]>,
): EasyViewEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return pairs
    .filter(([source, target]) => nodeMap.has(source) && nodeMap.has(target))
    .map(([source, target, label]) => {
      const sourceNode = nodeMap.get(source);
      const targetNode = nodeMap.get(target);
      const kind: EasyEdgeKind =
        sourceNode?.kind === "condition" ? "condition" :
          sourceNode?.kind === "risk" || targetNode?.kind === "end" ? "risk" :
            sourceNode?.kind === "stream" || targetNode?.kind === "monitor" ? "data" :
              "sequence";

      return {
        id: `${source}-${target}`,
        source,
        target,
        label,
        kind,
      };
    });
}

function estimateEasyEdgeLabelWidth(label?: string) {
  if (!label) return 0;
  return Math.min(106, Math.max(46, label.length * 11 + 22));
}

function getEasyNodeHeight(node: EasyViewNode) {
  if (node.kind === "stream" && node.chart) return 134;
  return NODE_HEIGHT_BY_KIND[node.kind] ?? 78;
}

function shiftEasyNodesAfterX(nodes: EasyViewNode[], boundaryX: number, delta: number, lockedId: string) {
  if (delta <= 0) return;
  nodes.forEach((node) => {
    if (node.id !== lockedId && node.x >= boundaryX) node.x += delta;
  });
}

function shiftEasyNodesAfterY(nodes: EasyViewNode[], boundaryY: number, delta: number, lockedId: string) {
  if (delta <= 0) return;
  nodes.forEach((node) => {
    if (node.id !== lockedId && node.y >= boundaryY) node.y += delta;
  });
}

function ensureEasyEdgeLabelSpacing(model: EasyViewModel): EasyViewModel {
  const nodes = model.nodes.map((node) => ({ ...node }));
  const nodeById = () => new Map(nodes.map((node) => [node.id, node]));
  const horizontalPadding = 86;
  const verticalPadding = 58;

  for (let pass = 0; pass < 4; pass += 1) {
    const map = nodeById();
    let changed = false;

    for (const edge of model.edges) {
      const labelWidth = estimateEasyEdgeLabelWidth(edge.label);
      if (!labelWidth) continue;

      const source = map.get(edge.source);
      const target = map.get(edge.target);
      if (!source || !target) continue;

      const sourceRight = source.x + source.w;
      const targetRight = target.x + target.w;
      const sourceBottom = source.y + getEasyNodeHeight(source);
      const targetBottom = target.y + getEasyNodeHeight(target);
      const minHorizontalGap = labelWidth + horizontalPadding;
      const minVerticalGap = 22 + verticalPadding;

      if (target.x >= sourceRight) {
        const gap = target.x - sourceRight;
        const delta = minHorizontalGap - gap;
        if (delta > 0) {
          shiftEasyNodesAfterX(nodes, sourceRight, delta, source.id);
          changed = true;
        }
      } else if (source.x >= targetRight) {
        const gap = source.x - targetRight;
        const delta = minHorizontalGap - gap;
        if (delta > 0) {
          shiftEasyNodesAfterX(nodes, targetRight, delta, target.id);
          changed = true;
        }
      }

      if (target.y >= sourceBottom) {
        const gap = target.y - sourceBottom;
        const delta = minVerticalGap - gap;
        if (delta > 0) {
          shiftEasyNodesAfterY(nodes, sourceBottom, delta, source.id);
          changed = true;
        }
      } else if (source.y >= targetBottom) {
        const gap = source.y - targetBottom;
        const delta = minVerticalGap - gap;
        if (delta > 0) {
          shiftEasyNodesAfterY(nodes, targetBottom, delta, target.id);
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  const maxRight = nodes.reduce((max, node) => Math.max(max, node.x + node.w), 0);
  const maxBottom = nodes.reduce((max, node) => Math.max(max, node.y + getEasyNodeHeight(node)), 0);
  return {
    ...model,
    nodes,
    canvasWidth: Math.max(model.canvasWidth, maxRight + 160),
    canvasHeight: Math.max(model.canvasHeight, maxBottom + 80),
  };
}

function easyViewHasKillSwitch(model: EasyViewModel) {
  return model.nodes.some((node) =>
    node.kind === "risk" &&
    isKillSwitchText(`${node.id} ${node.title} ${node.subtitle} ${node.description} ${node.roleDescription ?? ""}`));
}

function ensureEasyViewKillSwitch(model: EasyViewModel): EasyViewModel {
  if (easyViewHasKillSwitch(model)) {
    return model;
  }
  const maxRight = model.nodes.reduce((max, node) => Math.max(max, node.x + node.w), 0);
  const maxBottom = model.nodes.reduce((max, node) => Math.max(max, node.y + getEasyNodeHeight(node)), 0);
  const anchor = [...model.nodes].reverse().find((node) => node.kind === "cex" || node.kind === "dex" || node.kind === "risk")
    ?? model.nodes[model.nodes.length - 1];
  const killNode: EasyViewNode = {
    id: "kill-switch",
    index: model.nodes.length + 1,
    title: "킬스위치",
    subtitle: "전략 안전장치",
    description: "수동 중단, 손실 한도, 데이터 지연, 거래소 연결 이상이 감지되면 전략을 즉시 멈춥니다.",
    roleDescription: "정상 매매 조건과 별개로 새 진입을 막고 전체 종료 흐름을 실행하는 최종 안전장치입니다.",
    conditionText: "킬스위치 조건: 수동 중단 또는 위험 한도 초과",
    inputSummary: "확인하는 값: 수동 중단, 누적 손실률, 데이터 지연, 거래소 연결 상태",
    outputSummary: "내보내는 값: 전체 종료 신호",
    kind: "risk",
    status: "blocked",
    x: Math.max(28, maxRight + 90),
    y: anchor ? anchor.y : Math.max(88, maxBottom + 60),
    w: 170,
    params: [],
    editableInEasyView: false,
    sourceBlockIds: ["kill-switch-trigger", "kill-switch-close-all"],
  };
  const edgeSource = anchor?.id ?? model.nodes[0]?.id;
  const edges = edgeSource
    ? [
      ...model.edges,
      {
        id: `${edgeSource}-kill-switch`,
        source: edgeSource,
        target: killNode.id,
        label: "위험 중단",
        kind: "risk" as EasyEdgeKind,
      },
    ]
    : model.edges;
  return {
    ...model,
    nodes: [...model.nodes, killNode],
    edges,
    canvasWidth: Math.max(model.canvasWidth, killNode.x + killNode.w + 160),
    canvasHeight: Math.max(model.canvasHeight, killNode.y + getEasyNodeHeight(killNode) + 80),
  };
}

function finalizeEasyViewModel(model: EasyViewModel): EasyViewModel {
  return ensureEasyEdgeLabelSpacing(ensureEasyViewKillSwitch(model));
}

type Point = { x: number; y: number };
type Rect = { left: number; right: number; top: number; bottom: number; cx: number; cy: number };
type MeasuredEasyViewNode = EasyViewNode & { measuredWidth?: number; measuredHeight?: number };

const NODE_HEIGHT_BY_KIND: Record<EasyNodeKind, number> = {
  start: 78,
  stream: 134,
  condition: 56,
  cex: 78,
  dex: 78,
  monitor: 78,
  risk: 56,
  end: 78,
};

const EDGE_NODE_GAP = 0;
const EDGE_ARROW_HEAD_LENGTH = 14;
const EDGE_MIN_SIDE_GAP = 74;
const EDGE_MIN_VERTICAL_GAP = 62;
const EDGE_LANE_STEP = 34;
const EDGE_ANCHOR_STEP = 22;

function getEasyNodeRouteWidth(node: EasyViewNode) {
  return (node as MeasuredEasyViewNode).measuredWidth ?? node.w;
}

function getEasyNodeRouteHeight(node: EasyViewNode) {
  return (node as MeasuredEasyViewNode).measuredHeight ?? NODE_HEIGHT_BY_KIND[node.kind] ?? 74;
}

function getNodeRect(node: EasyViewNode, padding = 12): Rect {
  const width = getEasyNodeRouteWidth(node);
  const height = getEasyNodeRouteHeight(node);
  return {
    left: node.x - padding,
    right: node.x + width + padding,
    top: node.y - padding,
    bottom: node.y + height + padding,
    cx: node.x + width / 2,
    cy: node.y + height / 2,
  };
}

function intervalsOverlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.max(a1, b1) <= Math.min(a2, b2);
}

function verticalSegmentPenalty(x: number, y1: number, y2: number, rects: Rect[]) {
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return rects.reduce((score, rect) => {
    const crossesX = x > rect.left && x < rect.right;
    const crossesY = intervalsOverlap(top, bottom, rect.top, rect.bottom);
    return score + (crossesX && crossesY ? 1 : 0);
  }, 0);
}

function horizontalSegmentPenalty(y: number, x1: number, x2: number, rects: Rect[]) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  return rects.reduce((score, rect) => {
    const crossesY = y > rect.top && y < rect.bottom;
    const crossesX = intervalsOverlap(left, right, rect.left, rect.right);
    return score + (crossesX && crossesY ? 1 : 0);
  }, 0);
}

function chooseBestNumber(candidates: number[], score: (value: number) => number) {
  return candidates
    .map((value) => ({ value, score: score(value) }))
    .sort((a, b) => a.score - b.score || Math.abs(a.value) - Math.abs(b.value))[0]?.value ?? candidates[0] ?? 0;
}

function roundedOrthogonalPath(points: Point[], radius = 10) {
  if (points.length <= 1) return "";
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const prevLength = Math.hypot(current.x - prev.x, current.y - prev.y);
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
    const corner = Math.min(radius, prevLength / 2, nextLength / 2);

    const from: Point = {
      x: current.x - ((current.x - prev.x) / (prevLength || 1)) * corner,
      y: current.y - ((current.y - prev.y) / (prevLength || 1)) * corner,
    };
    const to: Point = {
      x: current.x + ((next.x - current.x) / (nextLength || 1)) * corner,
      y: current.y + ((next.y - current.y) / (nextLength || 1)) * corner,
    };

    path += ` L ${from.x} ${from.y} Q ${current.x} ${current.y} ${to.x} ${to.y}`;
  }

  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function getOrderedEdgeIndex(edge: EasyViewEdge, related: EasyViewEdge[]) {
  const sorted = [...related].sort((a, b) => a.id.localeCompare(b.id));
  return Math.max(0, sorted.findIndex((candidate) => candidate.id === edge.id));
}

function getCenteredOffset(index: number, total: number, step: number) {
  if (total <= 1) return 0;
  return (index - (total - 1) / 2) * step;
}

function getEdgeLaneOffset(edge: EasyViewEdge | undefined, edges: EasyViewEdge[], sourceId: string, targetId: string) {
  if (!edge) return 0;
  const samePair = edges.filter((candidate) => candidate.source === sourceId && candidate.target === targetId);
  if (samePair.length > 1) {
    return getCenteredOffset(getOrderedEdgeIndex(edge, samePair), samePair.length, EDGE_LANE_STEP);
  }

  const fanOut = edges.filter((candidate) => candidate.source === sourceId);
  const fanIn = edges.filter((candidate) => candidate.target === targetId);
  const related = fanOut.length >= fanIn.length ? fanOut : fanIn;
  return getCenteredOffset(getOrderedEdgeIndex(edge, related), related.length, EDGE_LANE_STEP);
}

function getNodeAnchorOffset(edge: EasyViewEdge | undefined, edges: EasyViewEdge[], nodeId: string, role: "source" | "target") {
  if (!edge) return 0;
  const related = edges.filter((candidate) => role === "source" ? candidate.source === nodeId : candidate.target === nodeId);
  return getCenteredOffset(getOrderedEdgeIndex(edge, related), related.length, EDGE_ANCHOR_STEP);
}

function clampToRect(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getHorizontalAnchorY(rect: Rect, offset: number) {
  return clampToRect(rect.cy + offset, rect.top + 18, rect.bottom - 18);
}

function getVerticalAnchorX(rect: Rect, offset: number) {
  return clampToRect(rect.cx + offset, rect.left + 22, rect.right - 22);
}

export function getEasyViewEdgeRoutePoints(
  source: EasyViewNode,
  target: EasyViewNode,
  nodes: EasyViewNode[] = [],
  edge?: EasyViewEdge,
  edges: EasyViewEdge[] = [],
): Point[] {
  const sourceRect = getNodeRect(source, 0);
  const targetRect = getNodeRect(target, 0);
  const obstacleRects = nodes
    .filter((node) => node.id !== source.id && node.id !== target.id)
    .map((node) => getNodeRect(node));
  const laneOffset = getEdgeLaneOffset(edge, edges, source.id, target.id);
  const sourceAnchorOffset = getNodeAnchorOffset(edge, edges, source.id, "source");
  const targetAnchorOffset = getNodeAnchorOffset(edge, edges, target.id, "target");
  const horizontalGap = targetRect.left - sourceRect.right;
  const reverseHorizontalGap = sourceRect.left - targetRect.right;
  const verticalGap = targetRect.top - sourceRect.bottom;
  const reverseVerticalGap = sourceRect.top - targetRect.bottom;

  if (horizontalGap >= EDGE_MIN_SIDE_GAP) {
    const sourcePoint = { x: sourceRect.right + EDGE_NODE_GAP, y: getHorizontalAnchorY(sourceRect, sourceAnchorOffset) };
    const targetPoint = { x: targetRect.left - EDGE_ARROW_HEAD_LENGTH, y: getHorizontalAnchorY(targetRect, targetAnchorOffset) };
    const visibleGap = Math.max(8, targetPoint.x - sourcePoint.x);
    const leftLane = sourcePoint.x + Math.min(46, visibleGap / 3);
    const centerLane = sourcePoint.x + visibleGap / 2;
    const rightLane = targetPoint.x - Math.min(46, visibleGap / 3);
    const laneX = chooseBestNumber(
      [centerLane + laneOffset, leftLane + laneOffset, rightLane + laneOffset],
      (x) => verticalSegmentPenalty(x, sourcePoint.y, targetPoint.y, obstacleRects),
    );

    return [
      sourcePoint,
      { x: laneX, y: sourcePoint.y },
      { x: laneX, y: targetPoint.y },
      targetPoint,
    ];
  }

  if (reverseHorizontalGap >= EDGE_MIN_SIDE_GAP) {
    const sourcePoint = { x: sourceRect.left - EDGE_NODE_GAP, y: getHorizontalAnchorY(sourceRect, sourceAnchorOffset) };
    const targetPoint = { x: targetRect.right + EDGE_ARROW_HEAD_LENGTH, y: getHorizontalAnchorY(targetRect, targetAnchorOffset) };
    const visibleGap = Math.max(8, sourcePoint.x - targetPoint.x);
    const laneX = chooseBestNumber(
      [
        targetPoint.x + visibleGap / 2 + laneOffset,
        sourceRect.left - 54 + laneOffset,
        targetRect.right + 54 + laneOffset,
      ],
      (x) => verticalSegmentPenalty(x, sourcePoint.y, targetPoint.y, obstacleRects),
    );

    return [
      sourcePoint,
      { x: laneX, y: sourcePoint.y },
      { x: laneX, y: targetPoint.y },
      targetPoint,
    ];
  }

  if (verticalGap >= EDGE_MIN_VERTICAL_GAP) {
    const sourcePoint = { x: getVerticalAnchorX(sourceRect, sourceAnchorOffset), y: sourceRect.bottom + EDGE_NODE_GAP };
    const targetPoint = { x: getVerticalAnchorX(targetRect, targetAnchorOffset), y: targetRect.top - EDGE_ARROW_HEAD_LENGTH };
    const visibleGap = Math.max(8, targetPoint.y - sourcePoint.y);
    const centerLane = sourcePoint.y + visibleGap / 2;
    const upperLane = sourcePoint.y + Math.min(42, visibleGap / 3) + laneOffset / 2;
    const lowerLane = targetPoint.y - Math.min(42, visibleGap / 3) + laneOffset / 2;
    const laneY = chooseBestNumber(
      [centerLane + laneOffset, upperLane, lowerLane],
      (y) => horizontalSegmentPenalty(y, sourcePoint.x, targetPoint.x, obstacleRects),
    );

    return [
      sourcePoint,
      { x: sourcePoint.x, y: laneY },
      { x: targetPoint.x, y: laneY },
      targetPoint,
    ];
  }

  if (reverseVerticalGap >= EDGE_MIN_VERTICAL_GAP) {
    const sourcePoint = { x: getVerticalAnchorX(sourceRect, sourceAnchorOffset), y: sourceRect.top - EDGE_NODE_GAP };
    const targetPoint = { x: getVerticalAnchorX(targetRect, targetAnchorOffset), y: targetRect.bottom + EDGE_ARROW_HEAD_LENGTH };
    const visibleGap = Math.max(8, sourcePoint.y - targetPoint.y);
    const laneY = chooseBestNumber(
      [
        targetPoint.y + visibleGap / 2 + laneOffset,
        sourceRect.top - 48 + laneOffset,
        targetRect.bottom + 48 + laneOffset,
      ],
      (y) => horizontalSegmentPenalty(y, sourcePoint.x, targetPoint.x, obstacleRects),
    );

    return [
      sourcePoint,
      { x: sourcePoint.x, y: laneY },
      { x: targetPoint.x, y: laneY },
      targetPoint,
    ];
  }

  const routeRight = targetRect.cx >= sourceRect.cx;
  const allRects = [...obstacleRects, sourceRect, targetRect];
  const routeX = routeRight
    ? Math.max(...allRects.map((rect) => rect.right)) + 76 + Math.max(0, laneOffset)
    : Math.min(...allRects.map((rect) => rect.left)) - 76 + Math.min(0, laneOffset);
  const sourcePoint = {
    x: routeRight ? sourceRect.right + EDGE_NODE_GAP : sourceRect.left - EDGE_NODE_GAP,
    y: getHorizontalAnchorY(sourceRect, sourceAnchorOffset),
  };
  const targetPoint = {
    x: routeRight ? targetRect.right + EDGE_ARROW_HEAD_LENGTH : targetRect.left - EDGE_ARROW_HEAD_LENGTH,
    y: getHorizontalAnchorY(targetRect, targetAnchorOffset),
  };

  return [
    sourcePoint,
    { x: routeX, y: sourcePoint.y },
    { x: routeX, y: targetPoint.y },
    targetPoint,
  ];
}

function getPolylinePointAtRatio(points: Point[], ratio: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return {
      start: point,
      end: next,
      length: Math.hypot(next.x - point.x, next.y - point.y),
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = totalLength * ratio;

  for (const segment of segments) {
    if (remaining <= segment.length) {
      const t = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
      };
    }
    remaining -= segment.length;
  }

  return points[points.length - 1];
}

export function getEasyViewEdgeMidpoint(
  source: EasyViewNode,
  target: EasyViewNode,
  nodes: EasyViewNode[] = [],
  edge?: EasyViewEdge,
  edges: EasyViewEdge[] = [],
): Point {
  return getPolylinePointAtRatio(getEasyViewEdgeRoutePoints(source, target, nodes, edge, edges), 0.5);
}

export function getEasyViewEdgePath(
  source: EasyViewNode,
  target: EasyViewNode,
  nodes: EasyViewNode[] = [],
  edge?: EasyViewEdge,
  edges: EasyViewEdge[] = [],
): string {
  return roundedOrthogonalPath(getEasyViewEdgeRoutePoints(source, target, nodes, edge, edges));
}

export function isEasyViewParamEditable(node: EasyViewNode): boolean {
  return node.editableInEasyView && (node.kind === "cex" || node.kind === "dex" || node.kind === "end");
}

export async function runEasyViewAgentLoop(template: StrategyTemplate): Promise<EasyViewAgentResult> {
  const code = buildStrategyCodeFromTemplate(template);
  const easyView = createEasyViewFromStrategyCode(code, template);

  return {
    code,
    easyView,
    steps: [
      "템플릿 프롬프트를 실행 가능한 전략 코드로 변환",
      "생성된 코드에서 스트림, 조건, 실행 블록을 추출",
      "고급 보기 파이프라인은 잠그고 CEX/DEX 실행 파라미터만 쉬운 보기에서 노출",
      "기존 간선 규칙에 맞춰 조건/데이터/리스크 화살표를 생성",
    ],
  };
}

export async function runEasyViewPromptAgentLoop(prompt: string): Promise<EasyViewAgentResult> {
  const template = chooseStrategyTemplateForPrompt(prompt);
  const code = buildStrategyCodeFromTemplate(template);
  const easyView = createEasyViewFromStrategyCode(code, template);

  return {
    code,
    easyView,
    steps: [
      "사용자 프롬프트를 전략 의도로 분류",
      `추천 템플릿 "${template.title}"을 기준 전략으로 선택`,
      "전략 코드를 먼저 생성한 뒤 쉬운 보기 그래프를 재구성",
      "쉬운 보기에서는 CEX/DEX 실행 파라미터만 수정 가능하도록 잠금",
    ],
  };
}

export function runEasyViewGraphAgentLoop(
  strategyGraph: StrategyGraphPayload,
  prompt: string,
): EasyViewAgentResult {
  const strategyGraphWithKillSwitch = withStrategyKillSwitch(strategyGraph);
  const advancedHarness = createAdvancedViewWithHarness(strategyGraphWithKillSwitch, "AI 에이전트 생성 파이프라인");
  const easyView = createEasyViewFromStrategyGraph(strategyGraphWithKillSwitch, prompt);
  const code = strategyGraphToCode(strategyGraphWithKillSwitch);
  return {
    code,
    easyView,
    advancedGraph: advancedHarness.graph,
    steps: [
      "실제 AI API 응답 수신",
      "AI가 반환한 strategy graph를 분석하여 고급 파이프라인 노드로 먼저 변환",
      ...advancedHarness.diagnostics,
      "고급 전략 그래프가 완성된 뒤 쉬운 보기 노드와 간선을 생성",
      "쉬운 보기에서는 모니터 노드를 스트리밍 차트로 흡수하고 트리거 데이터 의존성을 화살표로 표시",
    ],
  };
}
