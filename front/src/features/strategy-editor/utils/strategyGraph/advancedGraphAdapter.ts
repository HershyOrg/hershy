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
} from "@/features/strategy-editor/types/editorTypes";
import type {
  AdvancedGraph,
  AdvancedGraphHarnessResult,
  StrategyGraphBlock,
  StrategyGraphConnection,
  StrategyGraphPayload,
  StrategyWorkflowGroupSpec,
} from "./types";

function isKillSwitchText(text: string) {
  return /kill\s*switch|killswitch|emergency|panic|circuit\s*breaker|manual\s*(halt|stop)|global\s*(halt|stop)|stop\s*all|halt\s*strategy/i.test(text);
}

function isKillSwitchBlock(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  if (config.killSwitch === true || config.emergencyStop === true || config.circuitBreaker === true) {
    return true;
  }
  return isKillSwitchText([
    normalizeGraphText(block.id),
    normalizeGraphText(block.type),
    collectStrategyBlockText(block),
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
    .map((block) => collectStrategyBlockText(block))
    .join(" ")
    .toLowerCase();
  const useDex = /dex|swap|contract|onchain|flash\s*loan|flashloan|uniswap|jupiter|aave/.test(actionText);
  if (useDex) {
    return {
      actionType: "dex",
      exchange: "Connected on-chain execution environment",
      chain: "connected-chain",
      contractAddress: "0x0000000000000000000000000000000000000000",
      functionName: "emergencyExit()",
      closeAllPositions: true,
      cancelOpenOrders: true,
    };
  }
  return {
    actionType: "cex",
    exchange: "Connected exchange",
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
      name: "Kill Switch",
      label: "Kill Switch",
      triggerType: "condition",
      condition: "manual_kill_switch == true || strategy_drawdown_pct <= -5 || data_stale_seconds >= 30 || exchange_disconnect == true",
      killSwitch: true,
      emergencyStop: true,
      overviewDescription: "Stops the strategy immediately when manual halt, loss limit, stale data, or exchange disconnect is detected.",
      roleDescription: "Final safety guard for the whole strategy, independent of normal trading conditions.",
      inputSummary: "Manual halt state, cumulative loss rate, data delay, exchange connection status",
      outputSummary: "Signal to close all positions",
    },
  });
  blocks.push({
    id: actionId,
    type: "action",
    config: {
      name: "Execute Kill Switch",
      label: "Execute Kill Switch",
      ...actionConfig,
      killSwitch: true,
      emergencyStop: true,
      overviewDescription: "Cancels open orders and closes strategy-created positions as reduce-only where possible.",
      roleDescription: "Exit action that runs only when the kill switch condition is active. It blocks new entries and reduces existing exposure.",
      inputSummary: "Kill switch signal and latest market/account state",
      outputSummary: "Cancel/close request status and execution result",
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
  if (node.type === "conditionJunction") return "trigger";
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

function formatConditionLiteral(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return String(numeric);
  return JSON.stringify(String(value ?? ""));
}

function readConditionPayloadExpression(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const explicit = normalizeGraphText(record.conditionExpression ?? record.expression);
  if (explicit) return explicit;

  const metric = normalizeGraphText(record.metric ?? record.field ?? record.sourceOutputBlockId, "value")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_");
  const sourceNodeId = normalizeGraphText(record.sourceNodeId);
  const operator = normalizeGraphText(record.operator, ">");
  const threshold = record.threshold;
  if (!sourceNodeId || ![">", ">=", "<", "<="].includes(operator)) return "";
  return `${sourceNodeId}::${metric} ${operator} ${formatConditionLiteral(threshold)}`;
}

function readConditionJunctionExpression(config: Record<string, unknown>) {
  return normalizeGraphText(config.conditionExpression ?? config.expression ?? config.logic) ||
    readConditionPayloadExpression(config.condition);
}

function collectConditionSourceIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = Array.isArray(record.conditionSourceIds)
    ? record.conditionSourceIds.map((item) => normalizeGraphText(item)).filter(Boolean)
    : [];
  const sourceNodeId = normalizeGraphText(record.sourceNodeId);
  const nested = [
    ...(Array.isArray(record.children) ? record.children : []),
    record.left,
    record.right,
    record.conditionTree,
  ].flatMap(collectConditionSourceIds);

  return Array.from(new Set([...direct, sourceNodeId, ...nested].filter(Boolean)));
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
  return /(^|[\s_-])(init|initial|initialize|bootstrap|setup|start)([\s_-]|$)|capitalready|startapproved/i.test(collectAdvancedNodeText(node));
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
    .map((group, index): StrategyWorkflowGroupSpec | null => {
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
      const isSafetyGroup = /kill|emergency|panic|stop|exit|close/i.test(text);
      const isInitGroup = /init|start|bootstrap|setup|capital/i.test(text);
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
    .filter((group): group is StrategyWorkflowGroupSpec => Boolean(group && group.nodeIds.length > 0));

  const unassigned = visibleNodes.filter((node) => !assigned.has(node.id));
  if (unassigned.length > 0 || groups.length === 0) {
    const fallbackNodes = unassigned.length > 0 ? unassigned : visibleNodes;
    groups.push({
      id: "main-workflow",
      title: "Main Strategy Flow",
      purpose: "Core execution flow that the AI or user did not group into an explicit sequence.",
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
        description: `Emits a true signal every ${Math.round(interval)} seconds.`,
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
        description: "Emits a true signal when clicked.",
        type: "output",
      },
    ];
  }

  if (node.type === "conditionJunction") {
    const conditionExpression = readConditionJunctionExpression(config);
    config.visualNodeType = "conditionJunction";
    config.triggerType = "condition";
    config.name = readConfigText(config, ["name", "label", "title"], "Condition Bracket");
    config.condition = conditionExpression;
    config.expression = conditionExpression;
    config.outputBlocks = normalizeTriggerOutputBlocks(
      readOutputBlocks(config, ["trigger"]),
    );
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
    } else if (config.actionType === "CEX") {
      const parameters = Array.isArray(config.parameters)
        ? (config.parameters.filter((parameter) => parameter && typeof parameter === "object") as Record<string, unknown>[])
        : [];
      const findParameter = (name: string) => parameters.find((parameter) =>
        normalizeGraphText(parameter.name).toLowerCase() === name.toLowerCase(),
      );
      const hasDynamicSource = (parameter: Record<string, unknown>) =>
        Boolean(
          parameter.source ||
          (Array.isArray(parameter.sources) && parameter.sources.length > 0),
        );
      const setParameter = (name: string, value: unknown) => {
        const text = normalizeGraphText(value);
        if (!text) return;
        const existing = findParameter(name);
        if (existing) {
          if (!hasDynamicSource(existing)) existing.value = text;
          return;
        }
        parameters.push({ name, value: text });
      };
      const orderType = normalizeOrderType(readActionParameterText(config, ["orderType", "type"], "MARKET"));
      const timeInForce = normalizeCEXTimeInForce(readActionParameterText(config, ["timeInForce", "tif", "fillPolicy", "orderFill", "executionPolicy"], "GTC"));
      const quantity = readActionParameterText(config, ["quantity", "amount", "size"], "");
      const quoteOrderQty = readActionParameterText(config, ["quoteOrderQty", "quote", "notional"], "");

      config.orderType = orderType;
      config.timeInForce = timeInForce;
      setParameter("symbol", readActionParameterText(config, ["symbol", "market"], "BTCUSDT"));
      setParameter("side", normalizeOrderSide(readActionParameterText(config, ["side", "orderSide"], "BUY")));
      setParameter("type", orderType);
      if (quoteOrderQty) {
        setParameter("quoteOrderQty", quoteOrderQty);
      } else {
        setParameter("quantity", quantity || "0.1");
      }
      if (orderType === "LIMIT") {
        setParameter("price", readActionParameterText(config, ["price", "limitPrice"], ""));
      }
      setParameter("timeInForce", timeInForce);
      config.parameters = parameters;
    } else if (config.actionType === "DEX") {
      const contractAbi = normalizeGraphText(config.contractAbi || config.abi);
      const functionText = normalizeGraphText(config.functionName || config.evmFunctionName || config.method);
      const signatureMatch = functionText.match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)$/);
      const evmFunctionName = normalizeGraphText(config.evmFunctionName) ||
        signatureMatch?.[1] ||
        functionText.replace(/\(.*/, "").trim();
      const evmFunctionSignature = normalizeGraphText(config.evmFunctionSignature || config.functionSignature) ||
        (signatureMatch ? `${signatureMatch[1]}(${signatureMatch[2].replace(/\s+/g, "")})` : "");
      const parameters = Array.isArray(config.parameters)
        ? (config.parameters.filter((parameter) => parameter && typeof parameter === "object") as Record<string, unknown>[])
        : [];
      const parameterNames = new Set(parameters.map((parameter) => normalizeGraphText(parameter.name)));
      const inputBlocks = Array.isArray(config.inputBlocks) ? config.inputBlocks : [];

      inputBlocks.forEach((block) => {
        if (!block || typeof block !== "object") return;
        const record = block as Record<string, unknown>;
        const name = normalizeGraphText(record.name);
        if (!name || parameterNames.has(name)) return;
        parameters.push({
          name,
          value: normalizeGraphText(record.value),
          placeholder: normalizeGraphText(record.abiType || record.description),
        });
        parameterNames.add(name);
      });

      config.dexProtocol = normalizeGraphText(config.dexProtocol, "evm");
      config.executionMode = normalizeGraphText(config.executionMode, "address");
      if (contractAbi) {
        config.contractAbi = contractAbi;
        config.abi = contractAbi;
      }
      if (evmFunctionName) config.evmFunctionName = evmFunctionName;
      if (evmFunctionSignature) config.evmFunctionSignature = evmFunctionSignature;
      config.parameters = parameters;
    }
  }

  return config;
}

function getAdvancedEdgeLabel(edge: Edge) {
  const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
  const label = normalizeGraphText(data.label ?? edge.label);
  if (!label || STRATEGY_CONNECTION_KIND_SET.has(label.toLowerCase())) return "";
  return compactConnectionLabel(label);
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
  const sourceIsConditionJunction = sourceNode?.type === "conditionJunction";
  const targetIsConditionJunction = targetNode?.type === "conditionJunction";
  if (sourceIsConditionJunction && targetNode?.type === "actionNode") return "trigger-action";
  if (sourceIsConditionJunction && targetIsConditionJunction) return "trigger-input";
  if (targetIsConditionJunction) return sourceIsTrigger ? "trigger-input" : "data-flow";
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
  const strategyNodes = graph.nodes.filter((node) =>
    node.type !== "groupNode" && !isRuntimeArtifactNode(node) && !node.hidden,
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
      const connectionLabel = getAdvancedEdgeLabel(edge);
      const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
      const sourceOutputBlockId = normalizeGraphText(
        data.sourceOutputBlockId ?? data.sourceBlockId ?? data.fromBlockId,
      ) || normalizeGraphText(edge.sourceHandle?.match(/-block-(.+)-out$/)?.[1]);
      const targetInputBlockId = normalizeGraphText(
        data.targetInputBlockId ?? data.targetBlockId ?? data.toBlockId,
      ) || normalizeGraphText(edge.targetHandle?.match(/-(?:input|block)-(.+)-in$/)?.[1]);
      const logicMode = data.logicMode === "OR" ? "OR" : data.logicMode === "AND" ? "AND" : "";
      return {
        id: normalizeGraphText(edge.id, `edited-edge-${index + 1}`),
        kind: normalizeAdvancedEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target)),
        fromId: edge.source,
        toId: edge.target,
        ...(sourceOutputBlockId ? { sourceOutputBlockId, sourceBlockId: sourceOutputBlockId } : {}),
        ...(targetInputBlockId ? { targetInputBlockId, targetBlockId: targetInputBlockId } : {}),
        ...(logicMode ? { logicMode } : {}),
        ...(connectionLabel ? { label: connectionLabel } : {}),
      };
    });

  const blockTypeById = new Map(blocks.map((block) => [normalizeGraphText(block.id), normalizeGraphText(block.type)]));
  const hasConnection = (kind: string, fromId: string, toId: string) =>
    connections.some((connection) =>
      normalizeGraphText(connection.kind) === kind &&
      normalizeGraphText(connection.fromId) === fromId &&
      normalizeGraphText(connection.toId) === toId,
    );

  connections
    .filter((connection) =>
      normalizeGraphText(connection.kind) === "trigger-action" &&
      blockTypeById.get(normalizeGraphText(connection.fromId)) === "trigger" &&
      blockTypeById.get(normalizeGraphText(connection.toId)) === "action",
    )
    .forEach((connection) => {
      const triggerNode = nodeById.get(normalizeGraphText(connection.fromId));
      if (triggerNode?.type !== "conditionJunction") return;
      const data = triggerNode.data && typeof triggerNode.data === "object" ? triggerNode.data as Record<string, unknown> : {};
      const sourceIds = collectConditionSourceIds(data);
      const actionId = normalizeGraphText(connection.toId);

      sourceIds.forEach((sourceId, index) => {
        const sourceType = blockTypeById.get(sourceId);
        if (sourceType !== "normal" && sourceType !== "streaming") return;
        if (hasConnection("action-input", sourceId, actionId)) return;
        connections.push({
          id: `${normalizeGraphText(connection.id, "condition-trigger")}-action-input-${index + 1}`,
          kind: "action-input",
          fromId: sourceId,
          toId: actionId,
          label: "Condition Data",
        });
      });
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
    generatedAt: "1970-01-01T00:00:00.000Z",
    summary: {
      blocks: blocks.length,
      connections: connections.length,
    },
    metadata: {
      source: "advanced-view-edit",
      advancedGraphEdited: true,
      strategyBlock: {
        id: strategyId,
        title: strategyGroup ? getAdvancedGroupLabel(strategyGroup, strategyName) : strategyName,
        purpose: "Top-level execution container that wraps the whole strategy.",
        nodeIds: strategyNodes.map((node) => node.id),
      },
      workflowGroups,
    },
    blocks,
    connections,
  };
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

function readActionParameterText(config: Record<string, unknown>, keys: string[], fallback = "") {
  const directValue = readConfigText(config, keys);
  if (directValue) return directValue;

  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  const parameters = Array.isArray(config.parameters) ? config.parameters : [];
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== "object") continue;
    const record = parameter as Record<string, unknown>;
    const name = normalizeGraphText(record.name).toLowerCase();
    if (!keySet.has(name)) continue;
    const value = normalizeGraphText(record.value);
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

function humanizeCondition(condition: string) {
  return condition
    .replace(/::/g, ".")
    .replace(/&&/g, " and ")
    .replace(/\|\|/g, " or ")
    .replace(/>=/g, " at least ")
    .replace(/<=/g, " at most ")
    .replace(/>/g, " greater than ")
    .replace(/</g, " less than ")
    .replace(/==/g, " equals ")
    .replace(/!=/g, " not equal to ")
    .replace(/\s+/g, " ")
    .trim();
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

function compactConnectionLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 9)}...`;
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

function normalizeWorkflowGroups(strategyGraph: StrategyGraphPayload): StrategyWorkflowGroupSpec[] {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const rawGroups = Array.isArray(metadata.workflowGroups) ? metadata.workflowGroups : [];
  const groups = rawGroups
    .map((group, index): StrategyWorkflowGroupSpec | null => {
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
  return groups.filter((group) => Boolean(group?.id)) as StrategyWorkflowGroupSpec[];
}

function getBlockWorkflowId(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  return readConfigText(config, ["workflowId", "workflow", "phaseId"], "");
}

function collectStrategyBlockText(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  return [
    getBlockId(block),
    getBlockType(block),
    readConfigText(config, ["name", "label", "title", "functionName", "symbol"]),
    readConfigText(config, ["overviewDescription", "description", "summary", "roleDescription"]),
    readConfigText(config, ["expression", "formula", "condition", "logic", "code"]),
  ].filter(Boolean).join(" ");
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

const ADVANCED_NODE_TYPES = new Set([
  "groupNode",
  "functionNode",
  "timeTrigger",
  "clickTrigger",
  "conditionJunction",
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
      ...item,
      id: normalizeGraphText(item.id, `${type}-${index + 1}-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`),
      name,
      description: readConfigText(item, ["description", "helper", "summary"], `${name} ${type} block`),
      type,
      ...(type === "output" ? {
        visualizationFormat: readConfigText(item, ["visualizationFormat", "visualFormat", "format"], ""),
        visualType: readConfigText(item, ["visualType", "chartType", "viewType"], ""),
        ladderSide: readConfigText(item, ["ladderSide", "bookSide", "side", "levelSide"], ""),
        ladderRows: Array.isArray(item.ladderRows) ? item.ladderRows : Array.isArray(item.rows) ? item.rows : undefined,
        ladderValues: Array.isArray(item.ladderValues) ? item.ladderValues : Array.isArray(item.values) ? item.values : undefined,
      } : {}),
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
    const blocks = Object.entries(rawValue).map(([key, value], index) => {
      const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      return normalizeBlockData(
        {
          ...record,
          id: key,
          name: readConfigText(record, ["name", "label"], key),
          description: typeof value === "string" ? value : readConfigText(record, ["description", "helper", "summary"], `${key} ${type} block`),
        },
        type,
        fallbackNames[index] ?? key,
        index,
      );
    });
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
      description: firstBlock?.description || "Boolean data from the condition expression result",
      type: "output" as const,
      outputKind: "boolean-data",
    },
  ];
}

function hasIndicatorLogicDescriptionFormat(value: string) {
  return /^1\.\s*Data received:/m.test(value) &&
    /^2\.\s*Action performed:/m.test(value) &&
    /^3\.\s*Output produced:/m.test(value);
}

function isDeveloperCentricIndicatorDescription(value: string) {
  const text = normalizeGraphText(value);
  if (!text) return true;
  const withoutHeadings = text
    .replace(/^1\.\s*Data received:/gm, "")
    .replace(/^2\.\s*Action performed:/gm, "")
    .replace(/^3\.\s*Output produced:/gm, "");
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
    .replace(/^Agent loop as-is:\s*/i, "")
    .trim();
}

function ensureKoreanSentence(value: string, suffix: string) {
  const text = cleanIndicatorLogicSentence(value);
  if (!text) return "";
  if (/[.!?。]/.test(text)) return text;
  return `${text}${suffix}`;
}

function compactPlainConceptList(concepts: string[], fallback: string) {
  const names = Array.from(new Set(concepts.map((concept) => normalizeGraphText(concept)).filter(Boolean)));
  if (names.length === 0) return fallback;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function humanizeIndicatorConcept(name: string) {
  const lower = normalizeGraphText(name).toLowerCase();
  if (!lower) return "";
  if (/contract|resolver|router|quoter|factory|address|executor|tokenaddress|protocolcontracts/.test(lower)) {
    return "actual address information needed for trading";
  }
  if (/quote|price|market|pool|route|venue|dex/.test(lower)) {
    return "current market prices and trading route information";
  }
  if (/profit|score|yield|apr|return|pnl/.test(lower)) {
    return "expected profit and risk score";
  }
  if (/gas|fee|slippage|impact/.test(lower)) {
    return "trading costs and price-movement buffer";
  }
  if (/balance|wallet|allowance|amount/.test(lower)) {
    return "wallet balance and usable amount";
  }
  if (/status|txhash|order|result|success|revert/.test(lower)) {
    return "execution status and trade records";
  }
  if (/kill|halt|stop|risk|pause|stale|mismatch/.test(lower)) {
    return "risk signals and emergency halt state";
  }
  if (/trigger|condition|check/.test(lower)) {
    return "condition pass status";
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
    return "Receives information that can verify whether the exchange, token, and execution addresses are ready for the current market.";
  }
  if (/profit|score|gas|fee|slippage|impact/.test(text)) {
    return "Receives current price, input amount, expected output amount, fees, and gas cost information.";
  }
  if (/risk|kill|halt|pause|stale|mismatch/.test(text)) {
    return "Receives latest prices and risk signals that may require the trade to stop.";
  }
  return `Receives ${humanizeIndicatorConcepts(blockNames(inputBlocks), "connected market data and prior calculation results")}.`;
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
    return "Checks whether addresses required for live trading are ready, and flags missing items that should stop execution before launch.";
  }
  if (/profit|net|score|gas|fee|slippage|impact/.test(text)) {
    return "Calculates net profit by subtracting input amount, fees, gas costs, and price-movement buffer from the expected output amount.";
  }
  if (/yield|apr|reward|liquidity|tvl/.test(text)) {
    return "Compares yield, liquidity, rewards, and risk factors to score whether the opportunity is suitable to enter.";
  }
  if (/risk|kill|halt|pause|stale|mismatch/.test(text)) {
    return "Finds cases where prices are stale, spreads are too wide, or loss risk has increased.";
  }
  return `Summarizes the judgment criteria needed by ${label} into a single human-readable result.`;
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
    return "Reports whether the trade is ready to execute and which preparation items are missing.";
  }
  if (/profit|net|score|gas|fee|slippage|impact/.test(text)) {
    return "Reports expected net profit and the minimum profit threshold for continued trade review.";
  }
  if (/yield|apr|reward|liquidity|tvl/.test(text)) {
    return "Reports the selected opportunity's attractiveness and the risk level to watch.";
  }
  if (/risk|kill|halt|pause|stale|mismatch/.test(text)) {
    return "Reports whether the trade should stop or avoid moving to the next step.";
  }
  return `Reports ${humanizeIndicatorConcepts(blockNames(outputBlocks), "judgment results for the next step")}.`;
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
    `1. Data received: ${ensureKoreanSentence(describePlainIndicatorInput(id, label, config, inputBlocks, outputBlocks), ".")}`,
    `2. Action performed: ${ensureKoreanSentence(describePlainIndicatorBehavior(id, label, config, inputBlocks, outputBlocks), ".")}`,
    `3. Output produced: ${ensureKoreanSentence(describePlainIndicatorOutput(id, label, config, inputBlocks, outputBlocks), ".")}`,
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

function normalizeCEXTimeInForce(value: string): "GTC" | "FAK" | "FOK" {
  const text = value.trim().toUpperCase();
  if (text === "FOK") return "FOK";
  if (text === "FAK" || text === "IOC") return "FAK";
  return "GTC";
}

function parseIndicatorConditionExpression(expression: string, fallbackMetric: string, fallbackThreshold: number): IndicatorCondition | null {
  const text = expression.trim();
  if (!text) return null;
  const boolMatch = text.match(/([a-zA-Z0-9_.:-]+)\s*(==|=|!=)\s*(true|false|yes|no|1|0)\b/i);
  if (boolMatch) {
    const metric = boolMatch[1].split("::").pop()?.split(".").pop() || fallbackMetric;
    const expectedValue = boolMatch[3].toLowerCase();
    const expectsTrue = ["true", "yes", "1"].includes(expectedValue);
    const equalityPassesOnTrue = boolMatch[2] !== "!=" ? expectsTrue : !expectsTrue;
    return {
      metric,
      operator: equalityPassesOnTrue ? ">=" : "<",
      threshold: 0.5,
      label: humanizeCondition(text),
    };
  }

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

function splitConditionClauses(expression: string) {
  return expression
    .split(/\s*(?:&&|\|\||\band\b|\bor\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractConditionClausesForBlock(expression: string, blockId: string) {
  const clauses = splitConditionClauses(expression);
  if (!blockId) return clauses;
  const matching = clauses.filter((clause) => conditionMentionsBlock(clause, blockId));
  return matching.length > 0 ? matching : clauses;
}

function inferConditionMergeModeFromExpression(expression: string): "AND" | "OR" {
  return /\|\||\bor\b/i.test(expression) ? "OR" : "AND";
}

function parseIndicatorConditionExpressions(
  expression: string,
  blockId: string,
  fallbackMetric: string,
  fallbackThreshold: number,
) {
  return extractConditionClausesForBlock(expression, blockId)
    .map((clause) => parseIndicatorConditionExpression(clause, fallbackMetric, fallbackThreshold))
    .filter((condition): condition is IndicatorCondition => condition !== null);
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

function getConditionMetricName(expression: string, blockId: string, fallbackMetric: string) {
  const clause = extractConditionClausesForBlock(expression, blockId)[0] ?? expression;
  const scopedMatch = blockId
    ? clause.match(new RegExp(`${escapeRegExp(blockId)}::([a-zA-Z0-9_.:-]+)`, "i"))
    : null;
  const metric = scopedMatch?.[1] ?? clause.match(/([a-zA-Z0-9_.:-]+)\s*(?:>=|<=|>|<|==|=|!=)/)?.[1] ?? "";
  return metric.split("::").pop()?.split(".").pop() || fallbackMetric;
}

function outputBlockLooksLikeTrigger(block: BlockData) {
  return /\btrigger(?:ed)?\b|boolean-trigger|boolean-data/i.test(
    `${block.id} ${block.name} ${String(block.outputKind ?? "")}`,
  );
}

function findOutputBlockForCondition(outputBlocks: BlockData[], expression: string, sourceId: string) {
  const metric = getConditionMetricName(expression, sourceId, outputBlocks[0]?.name || "value").toLowerCase();
  const exactIndex = outputBlocks.findIndex((block) =>
    [block.id, block.name].some((value) => String(value ?? "").toLowerCase() === metric),
  );
  if (exactIndex >= 0) return exactIndex;

  const fuzzyIndex = outputBlocks.findIndex((block) =>
    [block.id, block.name].some((value) => {
      const text = String(value ?? "").toLowerCase();
      return text.length > 0 && (metric.includes(text) || text.includes(metric));
    }),
  );
  if (fuzzyIndex >= 0) return fuzzyIndex;

  const nonTriggerIndex = outputBlocks.findIndex((block) => !outputBlockLooksLikeTrigger(block));
  return Math.max(0, nonTriggerIndex);
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
          label: `Comparison ${index + 1}`,
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
        label: readConfigText(record, ["label", "name"], `Comparison ${index + 1}`),
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
    requestHint: readConfigText(config, ["description", "summary"], "Receives real-time market data."),
  };
}

function buildFunctionNodeData(id: string, type: string, config: Record<string, unknown>): FunctionNodeData {
  const label = readConfigText(config, ["name", "label", "title", "functionName"], id);
  const outputName = type === "trigger" ? "trigger" : "value";
  const threshold = readConfigNumber(config, ["threshold", "entryThreshold", "exitThreshold"], 108);
  const condition = buildIndicatorConditionConfig(config, outputName, threshold);
  const visualizationFormat = readConfigText(config, ["visualizationFormat", "visualFormat", "visualType", "chartType"], "");
  const outputBlocks = readOutputBlocks(config, [outputName]).map((block, index, blocks) => {
    if (!visualizationFormat || block.visualizationFormat || block.visualType || block.chartType) return block;
    return {
      ...block,
      visualizationFormat,
      ...(/order[-_\s]?book|book|depth|ladder|levels?/i.test(visualizationFormat) && !block.ladderSide
        ? { ladderSide: index < Math.ceil(blocks.length / 2) ? "upper" : "lower" }
        : {}),
    };
  });
  const normalizedOutputBlocks = type === "trigger" ? normalizeTriggerOutputBlocks(outputBlocks) : outputBlocks;
  const inputBlocks = readInputBlocks(config, ["source"]);
  return {
    label,
    runtimeBlockType: type,
    triggerType: readConfigText(config, ["triggerType", "type", "kind"], ""),
    materializedTriggerFormula: readConfigBool(config, ["materializedTriggerFormula"], false),
    description: readConfigText(config, ["description", "summary"], `Calculates ${label} values and visualizes ranges where conditions are met.`),
    functionName: readConfigText(config, ["functionName", "name"], `${id.replace(/[^a-zA-Z0-9_]/g, "_")}()`),
    code: readConfigText(
      config,
      ["code", "logic", "expression"],
      `// ${label}\nreturn compute("${id}", input);`,
    ),
    inputBlocks,
    outputBlocks: normalizedOutputBlocks,
    inputDescription: readConfigText(config, ["inputDescription"], "Uses values from the connected stream or previous block."),
    logicDescription: formatIndicatorLogicDescription(id, label, config, inputBlocks, normalizedOutputBlocks),
    outputDescription: readConfigText(config, ["outputDescription"], `Passes ${outputName} values to the next block.`),
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
      abi: readConfigText(config, ["abi", "contractAbi"], ""),
      contractAbi: readConfigText(config, ["contractAbi", "abi"], ""),
      evmFunctionName: readConfigText(config, ["evmFunctionName", "functionName", "method"], ""),
      evmFunctionSignature: readConfigText(config, ["evmFunctionSignature", "functionSignature"], ""),
      evmFunctionStateMutability: readConfigText(config, ["evmFunctionStateMutability", "stateMutability"], ""),
    };
  }

  const amount = readActionParameterText(config, ["amount", "quantity", "quoteOrderQty", "quote", "size", "notional"], "1000");
  return {
    label,
    actionType: "CEX",
    exchange: readConfigText(config, ["exchange", "venue"], "Binance"),
    symbol: readActionParameterText(config, ["symbol", "market"], "BTCUSDT"),
    side: normalizeOrderSide(readActionParameterText(config, ["side", "orderSide"], "BUY")),
    orderType: normalizeOrderType(readActionParameterText(config, ["orderType", "type"], "MARKET")),
    timeInForce: normalizeCEXTimeInForce(readActionParameterText(config, ["timeInForce", "tif", "fillPolicy", "orderFill", "executionPolicy"], "GTC")),
    amount,
    amountType: amount.includes("%") ? "PERCENT" : "FIXED",
    price: readActionParameterText(config, ["price", "limitPrice"], ""),
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
  return /\b(manual|click|button|start|strategy\s*start|on\s*start|startup)\b/.test(text);
}

type InlineTriggerInfo = {
  triggerId: string;
  sourceId: string;
  triggerBlock: StrategyGraphBlock;
};

function getIncomingConnections(connections: StrategyGraphConnection[], targetId: string) {
  return connections.filter((connection) => normalizeGraphText(connection.toId) === targetId);
}

function getOutgoingConnections(connections: StrategyGraphConnection[], sourceId: string) {
  return connections.filter((connection) => normalizeGraphText(connection.fromId) === sourceId);
}

function isInlineTriggerInputKind(kind: string) {
  return ["data-flow", "trigger-input", "condition", "data", "signal"].includes(kind);
}

function getInlineTriggerCondition(triggerBlock: StrategyGraphBlock) {
  return readConfigText(getBlockConfig(triggerBlock), ["condition", "predicate", "expression", "logic"]);
}

function findInlineConditionTriggerSource(
  triggerId: string,
  triggerCondition: string,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  const incomingIndicatorIds = getIncomingConnections(connections, triggerId)
    .filter((connection) => isInlineTriggerInputKind(normalizeGraphText(connection.kind, "data-flow")))
    .map((connection) => normalizeGraphText(connection.fromId))
    .filter((sourceId) => {
      const sourceBlock = blocksById.get(sourceId);
      return sourceBlock && getBlockType(sourceBlock) === "normal" && !isFixedValueBlock(sourceBlock);
    });

  const uniqueIncomingIds = Array.from(new Set(incomingIndicatorIds));
  if (uniqueIncomingIds.length === 1) return uniqueIncomingIds[0];

  const referencedIndicatorIds = Array.from(blocksById.entries())
    .filter(([blockId, block]) =>
      blockId !== triggerId &&
      getBlockType(block) === "normal" &&
      !isFixedValueBlock(block) &&
      conditionMentionsBlock(triggerCondition, blockId),
    )
    .map(([blockId]) => blockId);

  return referencedIndicatorIds.length === 1 ? referencedIndicatorIds[0] : "";
}

function conditionTriggerCanBeInlined(
  triggerId: string,
  triggerBlock: StrategyGraphBlock,
  blocksById: Map<string, StrategyGraphBlock>,
  connections: StrategyGraphConnection[],
) {
  if (getBlockType(triggerBlock) !== "trigger") return "";
  if (isKillSwitchBlock(triggerBlock)) return "";
  const config = getBlockConfig(triggerBlock);
  const triggerCondition = getInlineTriggerCondition(triggerBlock);
  if (!triggerCondition) return "";
  if (isTimeLikeTriggerConfig(config) || isManualLikeTriggerConfig(config)) return "";

  const outgoing = getOutgoingConnections(connections, triggerId);
  const triggerActionTargets = outgoing.filter((connection) => {
    const targetId = normalizeGraphText(connection.toId);
    return normalizeGraphText(connection.kind) === "trigger-action" &&
      getBlockType(blocksById.get(targetId) ?? {}) === "action";
  });
  if (triggerActionTargets.length === 0 || triggerActionTargets.length !== outgoing.length) return "";

  return findInlineConditionTriggerSource(triggerId, triggerCondition, blocksById, connections);
}

function buildAdvancedInlineTriggerMap(blocks: StrategyGraphBlock[], connections: StrategyGraphConnection[]) {
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const triggerById = new Map<string, InlineTriggerInfo>();
  const sourceToTrigger = new Map<string, InlineTriggerInfo>();

  blocksById.forEach((block, triggerId) => {
    const sourceId = conditionTriggerCanBeInlined(triggerId, block, blocksById, connections);
    if (!sourceId) return;

    const info = { triggerId, sourceId, triggerBlock: block };
    triggerById.set(triggerId, info);
    if (!sourceToTrigger.has(sourceId)) {
      sourceToTrigger.set(sourceId, info);
    }
  });

  return { triggerById, sourceToTrigger };
}

function isBooleanLikeOutputBlock(block: StrategyGraphBlock) {
  const config = getBlockConfig(block);
  const outputs = readOutputBlocks(config, ["signal"]);
  if (outputs.length === 0) return true;
  return outputs.length <= 1 && outputs.every((output) =>
    /\b(bool|boolean|signal|trigger|ready|ok|pass|success|true|confirmed|valid|condition)\b/.test(
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

  if (/\b(score|spread|basis|ma|ema|rsi|atr|volatility|price|amount|size|balance|allowance|reward|tvl|apr|apy|slippage|ratio|delta|liquidity)\b/.test(text)) {
    return false;
  }

  return (
    isBooleanLikeOutputBlock(block) &&
    /\b(indicator|predicate|boolean|bool|relay|gate|ready|ok|success|confirmed|pass|true|signal|condition)\b/.test(text)
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
  const triggerLabel = readConfigText(triggerConfig, ["name", "label", "title"], "Execution Condition");
  const description = readConfigText(
    triggerConfig,
    ["description", "summary"],
    condition ? `Emits an execution signal when ${humanizeCondition(condition)}.` : "Emits an execution signal when the condition is met.",
  );
  const outputBlocks = readOutputBlocks(config, ["value"]);
  const outputIndex = findOutputBlockForCondition(outputBlocks, condition, info.sourceId);
  const outputBlock = outputBlocks[outputIndex] ?? outputBlocks[0];
  const outputName = outputBlock?.name || "value";
  const threshold = readConfigNumber(triggerConfig, ["threshold", "entryThreshold", "exitThreshold"], 108);
  const parsedConditions = parseIndicatorConditionExpressions(condition, info.sourceId, outputName, threshold);
  const primaryCondition = parsedConditions[0] ?? buildIndicatorConditionConfig({ condition }, outputName, threshold);
  const conditionMergeMode = inferConditionMergeModeFromExpression(condition);
  const nextOutputBlocks = outputBlocks.map((block, index) => {
    if (index !== outputIndex) return block;
    return {
      ...block,
      condition: primaryCondition,
      conditionControls: parsedConditions.length > 1
        ? parsedConditions.slice(0, 2).map((item, itemIndex) => ({
          id: itemIndex === 0 ? "primary" : `range-${itemIndex + 1}`,
          condition: item,
        }))
        : block.conditionControls,
      conditionMergeMode,
      showConditionControl: true,
    };
  });

  return {
    ...config,
    condition: primaryCondition,
    conditionMergeMode,
    showConditionControl: true,
    triggerCondition: condition,
    description: readConfigText(config, ["description", "summary"], description),
    logicDescription: readConfigText(config, ["logicDescription", "description"], description),
    outputDescription: readConfigText(
      config,
      ["outputDescription"],
      `Emits the ${triggerLabel} true/false signal as a trigger under the output block.`,
    ),
    outputBlocks: nextOutputBlocks,
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
        inlineTriggerId: sourceInline.triggerId,
        inlineTriggerCondition: getInlineTriggerCondition(sourceInline.triggerBlock),
        inlineTriggerSourceId: sourceInline.sourceId,
        logicMode: inferConditionMergeModeFromExpression(getInlineTriggerCondition(sourceInline.triggerBlock)),
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
  if (blockType === "trigger" && readConfigText(config, ["visualNodeType", "nodeType"], "") === "conditionJunction") {
    return "conditionJunction";
  }
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
  if (nodeType === "conditionJunction") return buildConditionJunctionNodeData(id, config);
  if (nodeType === "actionNode") return buildActionNodeData(id, config);
  if (nodeType === "monitoringNode") return buildMonitoringNodeData(id, config);
  return buildFunctionNodeData(id, blockType, config);
}

function buildConditionJunctionNodeData(id: string, config: Record<string, unknown>) {
  return {
    label: readConfigText(config, ["name", "label", "title"], "Condition Bracket"),
    mode: readConfigText(config, ["mode", "logicMode", "conditionMergeMode"], "AND") === "OR" ? "OR" : "AND",
    bracketGroupId: readConfigText(config, ["bracketGroupId"], ""),
    bracketRoundNo: readConfigNumber(config, ["bracketRoundNo"], 1),
    bracketMaxRoundNo: readConfigNumber(config, ["bracketMaxRoundNo"], 1),
    bracketCenterY: readConfigNumber(config, ["bracketCenterY"], 48),
    bracketHeight: readConfigNumber(config, ["bracketHeight"], 96),
    condition: config.condition,
    conditionExpression: readConfigText(config, ["conditionExpression", "condition", "expression"], ""),
    conditionTree: config.conditionTree,
    conditionSourceIds: Array.isArray(config.conditionSourceIds) ? config.conditionSourceIds : [],
    inputBlocks: readInputBlocks(config, ["left", "right"]),
    outputBlocks: normalizeTriggerOutputBlocks(readOutputBlocks(config, ["trigger"])),
  };
}

function getOutputHandle(node: Node) {
  if (node.type === "conditionJunction") return `${node.id}-condition-out`;
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

function isInlineableIndicatorFunctionNode(sourceNode: Node) {
  const data = sourceNode.data && typeof sourceNode.data === "object" ? sourceNode.data as Record<string, unknown> : {};
  const runtimeBlockType = normalizeGraphText(data.runtimeBlockType ?? data.blockType ?? data.nodeCategory).toLowerCase();
  const triggerType = normalizeGraphText(data.triggerType).toLowerCase();
  return sourceNode.type === "functionNode" &&
    runtimeBlockType !== "trigger" &&
    triggerType.length === 0 &&
    data.materializedTriggerFormula !== true;
}

function isCompressedIndicatorConditionConnection(
  kind: string,
  sourceNode: Node,
  targetNode: Node,
  hasInlineTrigger = false,
) {
  return kind === "trigger-action" &&
    targetNode.type === "actionNode" &&
    (hasInlineTrigger || isInlineableIndicatorFunctionNode(sourceNode));
}

function getIndicatorConditionExpression(connection: StrategyGraphConnection, sourceNode: Node) {
  const inlineCondition = normalizeGraphText(connection.inlineTriggerCondition);
  if (inlineCondition) return inlineCondition;
  const data = sourceNode.data && typeof sourceNode.data === "object" ? sourceNode.data as Record<string, unknown> : {};
  return readConfigText(data, ["triggerCondition", "condition", "predicate", "logic"]);
}

function getIndicatorConditionOutputBlock(connection: StrategyGraphConnection, sourceNode: Node) {
  const data = sourceNode.data && typeof sourceNode.data === "object" ? sourceNode.data as Record<string, unknown> : {};
  const outputBlocks = Array.isArray(data.outputBlocks)
    ? data.outputBlocks.filter((block): block is BlockData => Boolean(block && typeof block === "object"))
    : [];
  const explicitBlockId = normalizeGraphText(
    connection.sourceBlockId ?? connection.fromBlockId ?? connection.sourceOutputBlockId,
  );
  const explicitBlock = outputBlocks.find((block) => block.id === explicitBlockId);
  if (explicitBlock && !outputBlockLooksLikeTrigger(explicitBlock)) return explicitBlock;

  const condition = getIndicatorConditionExpression(connection, sourceNode);
  const matchingIndex = findOutputBlockForCondition(outputBlocks, condition, sourceNode.id);
  return outputBlocks[matchingIndex] ?? outputBlocks.find((block) => !outputBlockLooksLikeTrigger(block)) ?? outputBlocks[0] ?? null;
}

function getIndicatorConditionSourceHandle(connection: StrategyGraphConnection, sourceNode: Node) {
  const outputBlock = getIndicatorConditionOutputBlock(connection, sourceNode);
  return outputBlock ? `${sourceNode.id}-trigger-${outputBlock.id}-out` : getOutputHandle(sourceNode);
}

function isIndicatorCondition(value: unknown): value is IndicatorCondition {
  if (!value || typeof value !== "object") return false;
  const condition = value as Partial<IndicatorCondition>;
  return [">", ">=", "<", "<="].includes(String(condition.operator)) &&
    Number.isFinite(Number(condition.threshold));
}

function getIndicatorEdgeCondition(connection: StrategyGraphConnection, sourceNode: Node) {
  const outputBlock = getIndicatorConditionOutputBlock(connection, sourceNode);
  const expression = getIndicatorConditionExpression(connection, sourceNode);
  const fallbackMetric = outputBlock?.name || "value";
  const parsed = expression
    ? parseIndicatorConditionExpressions(expression, sourceNode.id, fallbackMetric, 108)[0] ??
      parseIndicatorConditionExpression(expression, fallbackMetric, 108)
    : null;
  if (parsed) return parsed;

  const data = sourceNode.data && typeof sourceNode.data === "object" ? sourceNode.data as Record<string, unknown> : {};
  if (isIndicatorCondition(data.condition)) return data.condition;
  if (outputBlock && isIndicatorCondition(outputBlock.condition)) return outputBlock.condition;
  return null;
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

function getConditionJunctionTargetHandle(connection: StrategyGraphConnection, node: Node) {
  const explicitBlockId = normalizeGraphText(
    connection.targetInputBlockId ?? connection.targetBlockId ?? connection.toBlockId,
  );
  const inputBlocks = (node.data as { inputBlocks?: BlockData[] })?.inputBlocks ?? [];
  const inputBlock = inputBlocks.find((block) => block.id === explicitBlockId) ?? inputBlocks[0];
  return inputBlock ? `${node.id}-input-${inputBlock.id}-in` : getDataTargetHandle(node);
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
    if (!/interval|cadence|period|time|ms|second|minute|hour|schedule|frequency/i.test(`${label} ${condition}`)) continue;
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
    if (/(target|base|asset|token|coin|symbol)/i.test(normalizedLabel)) {
      baseToken = textValue;
      continue;
    }
    if (/(amount|investment|budget|notional|size)/i.test(normalizedLabel)) {
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
            description: `Emits a true signal every ${Math.round(interval)} seconds.`,
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
    title: readConfigText(rawStrategyBlock, ["title", "label", "name"], defaultTitle || normalizeGraphText(strategyGraph.strategy?.name, "AI Strategy")),
    purpose: readConfigText(rawStrategyBlock, ["purpose", "description", "summary"], "Top-level container for the AI-generated strategy."),
  };
}

function inferAdvancedSequenceStyle(group: StrategyWorkflowGroupSpec): "dashed-init" | "dashed-trigger" | "dashed-emergency" | "pipeline" {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  if (sequenceType === "data-pipeline" || sequenceType === "pipeline" || group.sharedDataPipeline === true) {
    return "pipeline";
  }
  const text = `${group.id} ${group.title} ${group.purpose}`.toLowerCase();
  if (/kill|emergency|panic|stop|exit|close|drawdown/.test(text)) {
    return "dashed-emergency";
  }
  if (/init|initial|start|bootstrap|setup|capital|ready/.test(text)) {
    return "dashed-init";
  }
  return "dashed-trigger";
}

function workflowGroupLooksLikeDataPipeline(group: StrategyWorkflowGroupSpec) {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  return sequenceType === "data-pipeline" || sequenceType === "pipeline" || group.sharedDataPipeline === true;
}

function getWorkflowGroupLanePriority(group: StrategyWorkflowGroupSpec) {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  if (workflowGroupLooksLikeDataPipeline(group)) return 0;
  if (sequenceType === "monitoring") return 2;
  return 1;
}

function compareWorkflowGroupsForLeftToRightLayout(
  left: StrategyWorkflowGroupSpec,
  right: StrategyWorkflowGroupSpec,
) {
  return getWorkflowGroupLanePriority(left) - getWorkflowGroupLanePriority(right) ||
    (left.order ?? 0) - (right.order ?? 0) ||
    left.id.localeCompare(right.id);
}

function blockIsAllowedInDataPipeline(block: StrategyGraphBlock) {
  const blockType = getBlockType(block);
  return blockType === "streaming" || blockType === "normal";
}

const HARNESS_INTERNAL_WORKFLOW_RE = /\b(intent|research|retrieval|rag|retrieval[-\s]*augmented|knowledge\s*retrieval|context\s*retrieval|knowledge\s*graph|kg|web\s*discovery|candidate\s*universe|pool\s*discovery|implementation\s*research|orchestration|planner|planning|ranking|ranker|solver|evidence|adapter|labeling|check\s*effect|check-effect|workflow\s*plan)\b/i;

const HARNESS_TRADING_RUNTIME_RE = /\b(capital|balance|allowance|collateral|approve|approval|entry|enter|deposit|add\s*liquidity|liquidity|lp|stake|staking|gauge|unstake|withdraw|remove\s*liquidity|claim|reward|rebalance|exit|swap|order|buy|sell|long|short|hedge|position|monitor|drawdown|slippage|kill\s*switch|close|cancel|reduce\s*only|stop)\b/i;

const HARNESS_EXECUTABLE_ACTION_RE = /\b(dex|cex|swap|order|buy|sell|approve|deposit|withdraw|stake|unstake|claim|getreward|addliquidity|removeliquidity|mint|burn|closeposition|cancelorder|placeorder|reduceonly|emergencyexit)\b/i;

function isHarnessAIGraph(strategyGraph: StrategyGraphPayload) {
  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  return metadata.aiLoopInternalized === true ||
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
    collectStrategyBlockText(block),
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
  return HARNESS_TRADING_RUNTIME_RE.test(`${getBlockId(block)} ${getBlockType(block)} ${collectStrategyBlockText(block)}`);
}

function workflowGroupLooksLikeInternalPlanning(
  group: StrategyWorkflowGroupSpec,
  memberBlocks: StrategyGraphBlock[],
) {
  const sequenceType = normalizeGraphText(group.sequenceType).toLowerCase();
  if (sequenceType === "check-effect" || sequenceType === "data-pipeline" || group.sharedDataPipeline === true) {
    return false;
  }
  const groupText = `${group.id} ${group.title} ${group.purpose}`;
  if (!HARNESS_INTERNAL_WORKFLOW_RE.test(groupText)) return false;
  if (/check\s*effect|check-effect|intent|research|retrieval|rag|retrieval[-\s]*augmented|knowledge\s*retrieval|context\s*retrieval|knowledge\s*graph|kg|web\s*discovery|candidate|pool\s*discovery|ranking|solver|workflow\s*plan/i.test(groupText)) {
    return true;
  }
  return !memberBlocks.some(blockLooksLikeExecutableTradingAction);
}

function validateHarnessTradingLogicScope(strategyGraph: StrategyGraphPayload) {
  const errors: string[] = [];
  if (!isHarnessAIGraph(strategyGraph)) return errors;

  const metadata = strategyGraph.metadata && typeof strategyGraph.metadata === "object" ? strategyGraph.metadata : {};
  const visibleGraphScope = normalizeGraphText(metadata.visibleGraphScope).toLowerCase();
  if (visibleGraphScope !== "trading-logic-only") {
    errors.push("AI loop output can only enter the harness when it is a real trading graph declared as runtimeGraph.metadata.visibleGraphScope='trading-logic-only'");
  }

  const blocks = Array.isArray(strategyGraph.blocks) ? strategyGraph.blocks : [];
  const blocksById = new Map(blocks.map((block, index) => [getBlockId(block, index), block]));
  const workflowGroups = normalizeWorkflowGroups(strategyGraph);
  const hasVisibleCheckEffectSequences = workflowGroups.some((group) => normalizeGraphText(group.sequenceType).toLowerCase() === "check-effect");
  if (metadata.checkEffectGraph === true && !hasVisibleCheckEffectSequences) {
    errors.push("check/effect graphs must include visible check-effect workflowGroups");
  }
  workflowGroups
    .filter(workflowGroupLooksLikeDataPipeline)
    .forEach((group) => {
      const invalidNodeIds = group.nodeIds.filter((nodeId) => {
        const block = blocksById.get(nodeId);
        return block ? !blockIsAllowedInDataPipeline(block) : false;
      });
      if (invalidNodeIds.length > 0) {
        errors.push(`data-pipeline workflowGroups can only contain streaming or indicator logic blocks: ${group.id} -> ${invalidNodeIds.slice(0, 4).join(", ")}`);
      }
    });
  const badGroups = workflowGroups
    .map((group) => ({
      group,
      memberBlocks: group.nodeIds
        .map((nodeId) => blocksById.get(nodeId))
        .filter((block): block is StrategyGraphBlock => Boolean(block)),
    }))
    .filter(({ group, memberBlocks }) => workflowGroupLooksLikeInternalPlanning(group, memberBlocks));

  if (badGroups.length > 0) {
    errors.push(`AI internal loop workflowGroups cannot be rendered as sequences: ${badGroups.slice(0, 4).map(({ group }) => group.title || group.id).join(", ")}`);
  }

  const executableActions = blocks.filter(blockLooksLikeExecutableTradingAction);
  if (visibleGraphScope === "trading-logic-only" && executableActions.length === 0 && !isMonitoringOnlyStrategyGraph(strategyGraph)) {
    errors.push("trading-logic-only graphs require at least one executable action block such as a DEX/CEX order, swap, deposit, stake, or exit");
  }

  const runtimeBlocks = blocks.filter(blockLooksLikeTradingRuntime);
  if (visibleGraphScope === "trading-logic-only" && runtimeBlocks.length === 0) {
    errors.push("trading-logic-only graphs must include real trading state, condition, execution, or monitoring blocks");
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
  const beforeText = collectStrategyBlockText(beforeAction).toLowerCase();
  const afterText = collectStrategyBlockText(afterAction).toLowerCase();
  const beforeApproval = /approve|approval|allowance/.test(beforeText);
  const beforeAddLiquidity = /add\s*liquidity|deposit.*pool|mint.*lp|liquidity.*deposit/.test(beforeText);
  const beforeClaim = /claim|getreward|reward/.test(beforeText);
  const beforeUnstake = /unstake|withdrawgauge|withdraw\s*gauge|gauge.*withdraw/.test(beforeText);
  const afterNeedsApproval = /add\s*liquidity|deposit|stake|supply|swap|mint/.test(afterText);
  const afterStake = /stake|depositgauge|gauge.*deposit/.test(afterText);
  const afterRebalance = /rebalance/.test(afterText);
  const afterRemoveLiquidity = /remove\s*liquidity|withdraw.*liquidity|redeem|burn.*lp/.test(afterText);

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
  workflowGroups: StrategyWorkflowGroupSpec[],
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
    groups: StrategyWorkflowGroupSpec[];
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

function workflowGroupLooksLikeInit(group: StrategyWorkflowGroupSpec) {
  return /\b(init|initial|start|startup|bootstrap|setup|entry|capital)\b/.test(
    `${group.id} ${group.title} ${group.purpose}`.toLowerCase(),
  );
}

function blockLooksLikeStartTrigger(block: StrategyGraphBlock) {
  if (getBlockType(block) !== "trigger") return false;
  const config = getBlockConfig(block);
  return isManualLikeTriggerConfig(config) || /\b(start|startup|manual|click|button)\b/.test(
    `${getBlockId(block)} ${collectStrategyBlockText(block)}`.toLowerCase(),
  );
}

function addVisibleStartTriggerBlocks(
  blocks: StrategyGraphBlock[],
  connections: StrategyGraphConnection[],
  workflowGroups: StrategyWorkflowGroupSpec[],
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
        name: "Strategy Start",
        label: "Strategy Start",
        title: "Strategy Start",
        triggerType: "manual",
        workflowId: group.id,
        description: "Emits a true signal when the strategy starts so the initial execution condition can be evaluated.",
        outputBlocks: [
          {
            id: "click",
            name: "start",
            description: "True when the strategy starts",
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
  workflowGroups: StrategyWorkflowGroupSpec[],
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
        overviewDescription: `Converts ${sourceLabel}.${sourceOutputName} boolean data into an execution condition.`,
        inputBlocks: [
          {
            id: "trigger",
            name: "trigger",
            description: `${sourceLabel}.${sourceOutputName} boolean data`,
            type: "input",
          },
        ],
        outputBlocks: [
          {
            id: "trigger",
            name: "trigger",
            description: "Boolean data from the condition result",
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
        label: "Condition Input",
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
  let sourceWorkflowGroups = normalizeWorkflowGroups(strategyGraph);
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
      title: "Main Strategy Flow",
      purpose: "Default execution flow for strategies without explicit AI-defined sequences.",
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
    const styleType = inferAdvancedSequenceStyle(group);
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
      label: strategyBlock.title || "AI Intelligent Pipeline (Advanced)",
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
    const isCompressedConditionEdge = isCompressedIndicatorConditionConnection(
      kind,
      sourceNode,
      targetNode,
      Boolean(conn.inlineTriggerId),
    );
    const isConditionJunctionEdge = sourceNode.type === "conditionJunction" || targetNode.type === "conditionJunction";
    const shouldUseConditionMergeEdge = isCompressedConditionEdge || isConditionJunctionEdge;
    const sourceHandle = isCompressedConditionEdge
      ? getIndicatorConditionSourceHandle(conn, sourceNode)
      : getConnectionSourceHandle(conn, sourceNode);
    const edgeCondition = isCompressedConditionEdge ? getIndicatorEdgeCondition(conn, sourceNode) : null;
    edges.push({
      id: normalizeGraphText(conn.id, `adv-edge-${index}`),
      source,
      target,
      sourceHandle,
      targetHandle: targetNode.type === "conditionJunction"
        ? getConditionJunctionTargetHandle(conn, targetNode)
        : isDataLike ? getDataTargetHandle(targetNode) : getExecutionTargetHandle(targetNode),
      type: shouldUseConditionMergeEdge ? "conditionMerge" : "custom",
      animated: true,
      data: {
        label: kind,
        ...(isSharedPipelineEdge ? { sharedDataPipeline: true } : {}),
        ...(shouldUseConditionMergeEdge
          ? {
            delay: 0,
            waitForResult: true,
            logicMode: conn.logicMode === "OR" ? "OR" : "AND",
            ...(edgeCondition ? { condition: edgeCondition } : {}),
            ...(conn.inlineTriggerId ? { inlineTriggerId: conn.inlineTriggerId } : {}),
          }
          : {}),
      },
      style: {
        strokeWidth: isSharedPipelineEdge ? 4 : shouldUseConditionMergeEdge ? 3.25 : 3,
        ...(isSharedPipelineEdge
          ? { stroke: "var(--advanced-edge-shared-pipeline, #ef4444)" }
          : shouldUseConditionMergeEdge
            ? { stroke: "var(--advanced-edge-condition, #f0b90b)" }
            : {}),
      },
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

  if (node.type === "conditionJunction") {
    const data = node.data as Record<string, unknown>;
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
    return /check-effect|execute|execution|order|swap|trade|action/.test(text);
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
      const data = edge.data && typeof edge.data === "object" ? edge.data as Record<string, unknown> : {};
      const shouldPreserveConditionMerge = edge.type === "conditionMerge" ||
        isCompressedIndicatorConditionConnection(
          normalizeGraphText(data.label).toLowerCase(),
          sourceNode,
          targetNode,
          Boolean(data.inlineTriggerId),
        );
      return {
        ...edge,
        type: shouldPreserveConditionMerge ? "conditionMerge" : "custom",
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
    throw new Error(`Advanced strategy graph harness scope violation: ${contractErrors.slice(0, 6).join("; ")}`);
  }

  let graph = buildAdvancedGraphFromStrategyGraph(strategyGraph, defaultTitle);
  const diagnostics: string[] = [];
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const errors = validateAdvancedGraph(graph);
    if (errors.length === 0) {
      diagnostics.push(`Advanced graph harness validation passed (attempt ${attempt})`);
      return { graph, attempts: attempt, diagnostics };
    }
    diagnostics.push(`Advanced graph harness repair attempt ${attempt}: ${errors.slice(0, 4).join("; ")}`);
    graph = repairAdvancedGraph(graph);
  }

  const finalErrors = validateAdvancedGraph(graph);
  if (finalErrors.length > 0) {
    throw new Error(`Advanced strategy graph generation failed: ${finalErrors.slice(0, 6).join("; ")}`);
  }

  diagnostics.push("Advanced graph harness validation passed after final repair");
  return { graph, attempts: maxAttempts, diagnostics };
}

export function createAdvancedViewFromStrategyGraph(strategyGraph: StrategyGraphPayload, defaultTitle: string) {
  return createAdvancedViewWithHarness(withStrategyKillSwitch(strategyGraph), defaultTitle).graph;
}
