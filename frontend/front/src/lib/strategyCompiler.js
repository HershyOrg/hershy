const STRATEGY_SCHEMA_VERSION = 1;
const KNOWN_BLOCK_TYPES = new Set(['streaming', 'normal', 'trigger', 'action', 'monitoring']);
const KNOWN_CONNECTION_KINDS = new Set(['stream-monitor', 'trigger-action', 'action-input']);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSourceRef = (source) => {
  if (!source || typeof source !== 'object') {
    return null;
  }
  return {
    blockId: normalizeString(source.blockId),
    blockName: normalizeString(source.blockName),
    blockType: normalizeString(source.blockType),
    field: normalizeString(source.field),
    mode: normalizeString(source.mode)
  };
};

const coerceLiteral = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }

  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return numeric;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
};

const compileBlockConfig = (block) => {
  switch (block.type) {
    case 'streaming': {
      const intervalMs = Math.max(300, normalizeNumber(block.updateInterval, 1000));
      return {
        name: normalizeString(block.name) || block.id,
        sourceUrl: normalizeString(block.apiUrl),
        updateMode: normalizeString(block.updateMode) || 'periodic',
        updateIntervalMs: intervalMs,
        fields: Array.isArray(block.fields) ? block.fields.filter((field) => typeof field === 'string' && field.trim() !== '') : [],
        responseSchema: normalizeString(block.responseSchema)
      };
    }

    case 'normal':
      return {
        name: normalizeString(block.name) || block.id,
        rawValue: block.value,
        value: coerceLiteral(block.value)
      };

    case 'trigger': {
      const intervalMs = Math.max(1, normalizeNumber(block.interval, 1000));
      return {
        name: normalizeString(block.name) || block.id,
        triggerType: normalizeString(block.triggerType) || 'manual',
        intervalMs,
        condition: normalizeString(block.conditionSummary),
        logicOperator: normalizeString(block.logicOperator || 'OR').toUpperCase()
      };
    }

    case 'action':
      return {
        name: normalizeString(block.name) || block.id,
        actionType: normalizeString(block.actionType) || 'cex',
        exchange: normalizeString(block.exchange),
        executionMode: normalizeString(block.executionMode) || 'address',
        contractAddress: normalizeString(block.contractAddress),
        contractAbi: normalizeString(block.contractAbi),
        apiUrl: normalizeString(block.apiUrl),
        apiPayloadTemplate: normalizeString(block.apiPayloadTemplate),
        parameters: Array.isArray(block.parameters)
          ? block.parameters.map((param) => ({
              name: normalizeString(param?.name),
              value: param?.value ?? '',
              placeholder: normalizeString(param?.placeholder),
              source: normalizeSourceRef(param?.source),
              sources: Array.isArray(param?.sources)
                ? param.sources.map(normalizeSourceRef).filter(Boolean)
                : []
            }))
          : [],
        contractAddressSource: normalizeSourceRef(block.contractAddressSource),
        contractAddressSources: Array.isArray(block.contractAddressSources)
          ? block.contractAddressSources.map(normalizeSourceRef).filter(Boolean)
          : []
      };

    case 'monitoring':
      return {
        name: normalizeString(block.name) || block.id,
        monitorType: normalizeString(block.monitorType) || 'table',
        connectedStreamId: normalizeString(block.connectedStreamId),
        connectedStream: normalizeString(block.connectedStream),
        fields: Array.isArray(block.fields) ? block.fields.filter((field) => typeof field === 'string' && field.trim() !== '') : []
      };

    default:
      return {
        name: normalizeString(block.name) || block.id
      };
  }
};

export const buildStrategyDefinition = ({ tabId, tabLabel, blocks = [], connections = [] }) => {
  const strategyName = normalizeString(tabLabel) || normalizeString(tabId) || 'strategy';

  const compiledBlocks = blocks.map((block) => ({
    id: block.id,
    type: block.type,
    position: block.position || { x: 0, y: 0 },
    config: compileBlockConfig(block)
  }));

  const blockTypeById = new Map(compiledBlocks.map((block) => [block.id, block.type]));

  const compiledConnections = connections.map((connection) => ({
    id: connection.id || `${connection.kind || 'link'}:${connection.fromId}:${connection.toId}`,
    kind: connection.kind,
    fromId: connection.fromId,
    toId: connection.toId,
    fromSide: connection.fromSide || 'right',
    toSide: connection.toSide || 'left',
    fromType: blockTypeById.get(connection.fromId) || null,
    toType: blockTypeById.get(connection.toId) || null
  }));

  const summary = {
    blocks: compiledBlocks.length,
    connections: compiledConnections.length,
    byType: {
      streaming: compiledBlocks.filter((block) => block.type === 'streaming').length,
      normal: compiledBlocks.filter((block) => block.type === 'normal').length,
      trigger: compiledBlocks.filter((block) => block.type === 'trigger').length,
      action: compiledBlocks.filter((block) => block.type === 'action').length,
      monitoring: compiledBlocks.filter((block) => block.type === 'monitoring').length
    }
  };

  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    kind: 'hershy-strategy-graph',
    strategy: {
      id: normalizeString(tabId) || `strategy-${Date.now()}`,
      name: strategyName
    },
    generatedAt: new Date().toISOString(),
    summary,
    blocks: compiledBlocks,
    connections: compiledConnections
  };
};

const collectNameDuplicates = (blocks) => {
  const index = new Map();
  blocks.forEach((block) => {
    const name = normalizeString(block?.config?.name);
    if (!name) {
      return;
    }
    const next = index.get(name) || [];
    next.push(block.id);
    index.set(name, next);
  });

  return Array.from(index.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids }));
};

export const validateStrategyDefinition = (strategy) => {
  const errors = [];
  const warnings = [];

  if (!strategy || typeof strategy !== 'object') {
    return {
      valid: false,
      errors: [{ code: 'EMPTY_STRATEGY', message: 'strategy is empty.' }],
      warnings,
      stats: null
    };
  }

  const blocks = Array.isArray(strategy.blocks) ? strategy.blocks : [];
  const connections = Array.isArray(strategy.connections) ? strategy.connections : [];

  const blockMap = new Map();
  blocks.forEach((block) => {
    if (!block?.id) {
      errors.push({ code: 'BLOCK_ID_REQUIRED', message: 'a block is missing id.' });
      return;
    }

    if (blockMap.has(block.id)) {
      errors.push({ code: 'BLOCK_ID_DUPLICATE', message: `duplicate block id: ${block.id}` });
      return;
    }

    blockMap.set(block.id, block);

    if (!KNOWN_BLOCK_TYPES.has(block.type)) {
      errors.push({ code: 'BLOCK_TYPE_UNKNOWN', message: `unsupported block type: ${block.type} (${block.id})` });
    }

    if (!normalizeString(block?.config?.name)) {
      warnings.push({ code: 'BLOCK_NAME_EMPTY', message: `block name is empty: ${block.id}` });
    }
  });

  const byType = {
    streaming: blocks.filter((block) => block.type === 'streaming'),
    normal: blocks.filter((block) => block.type === 'normal'),
    trigger: blocks.filter((block) => block.type === 'trigger'),
    action: blocks.filter((block) => block.type === 'action'),
    monitoring: blocks.filter((block) => block.type === 'monitoring')
  };

  if (byType.streaming.length === 0) {
    errors.push({ code: 'STREAMING_REQUIRED', message: 'at least one streaming block is required.' });
  }
  if (byType.trigger.length === 0) {
    warnings.push({ code: 'TRIGGER_MISSING', message: 'no trigger block found.' });
  }
  if (byType.action.length === 0) {
    warnings.push({ code: 'ACTION_MISSING', message: 'no action block found.' });
  }

  const actionTriggerCount = new Map(byType.action.map((block) => [block.id, 0]));
  const triggerActionCount = new Map(byType.trigger.map((block) => [block.id, 0]));

  connections.forEach((connection) => {
    const kind = normalizeString(connection.kind);
    const fromId = normalizeString(connection.fromId);
    const toId = normalizeString(connection.toId);

    if (!KNOWN_CONNECTION_KINDS.has(kind)) {
      errors.push({ code: 'CONNECTION_KIND_UNKNOWN', message: `unsupported connection type: ${connection.kind}` });
      return;
    }

    const fromBlock = blockMap.get(fromId);
    const toBlock = blockMap.get(toId);

    if (!fromBlock || !toBlock) {
      errors.push({ code: 'CONNECTION_BLOCK_MISSING', message: `connection refers missing block: ${fromId} -> ${toId}` });
      return;
    }

    if (kind === 'stream-monitor' && !(fromBlock.type === 'streaming' && toBlock.type === 'monitoring')) {
      errors.push({ code: 'STREAM_MONITOR_INVALID', message: `stream-monitor must be streaming -> monitoring: ${fromId} -> ${toId}` });
    }

    if (kind === 'trigger-action' && !(fromBlock.type === 'trigger' && toBlock.type === 'action')) {
      errors.push({ code: 'TRIGGER_ACTION_INVALID', message: `trigger-action must be trigger -> action: ${fromId} -> ${toId}` });
    } else if (kind === 'trigger-action') {
      actionTriggerCount.set(toId, (actionTriggerCount.get(toId) || 0) + 1);
      triggerActionCount.set(fromId, (triggerActionCount.get(fromId) || 0) + 1);
    }

    if (kind === 'action-input' && !(toBlock.type === 'action' && ['streaming', 'normal', 'monitoring'].includes(fromBlock.type))) {
      errors.push({ code: 'ACTION_INPUT_INVALID', message: `action-input must be (streaming|normal|monitoring) -> action: ${fromId} -> ${toId}` });
    }
  });

  byType.trigger.forEach((block) => {
    const config = block.config || {};

    if (config.triggerType === 'condition' && !normalizeString(config.condition)) {
      errors.push({ code: 'TRIGGER_CONDITION_REQUIRED', message: `condition trigger requires condition: ${block.id}` });
    }

    if (config.triggerType === 'time') {
      const intervalMs = normalizeNumber(config.intervalMs, 0);
      if (!intervalMs || intervalMs <= 0) {
        errors.push({ code: 'TRIGGER_INTERVAL_INVALID', message: `invalid intervalMs for time trigger: ${block.id}` });
      }
    }

    if ((triggerActionCount.get(block.id) || 0) === 0) {
      warnings.push({ code: 'TRIGGER_UNCONNECTED', message: `trigger not connected to action: ${block.id}` });
    }
  });

  byType.action.forEach((block) => {
    if ((actionTriggerCount.get(block.id) || 0) === 0) {
      errors.push({ code: 'ACTION_TRIGGER_REQUIRED', message: `action needs at least one trigger: ${block.id}` });
    }
  });

  byType.monitoring.forEach((block) => {
    const streamId = normalizeString(block?.config?.connectedStreamId);
    if (streamId && !blockMap.has(streamId)) {
      warnings.push({ code: 'MONITOR_STREAM_MISSING', message: `monitoring references missing stream: ${block.id} -> ${streamId}` });
    }
  });

  collectNameDuplicates(blocks).forEach((duplicate) => {
    warnings.push({ code: 'BLOCK_NAME_DUPLICATE', message: `duplicate block name: ${duplicate.name} (${duplicate.ids.join(', ')})` });
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      blocks: blocks.length,
      connections: connections.length,
      byType: {
        streaming: byType.streaming.length,
        normal: byType.normal.length,
        trigger: byType.trigger.length,
        action: byType.action.length,
        monitoring: byType.monitoring.length
      }
    }
  };
};

export const strategyToPrettyJson = (strategy) => JSON.stringify(strategy, null, 2);

export const buildStrategyFilename = (strategyName) => {
  const base = normalizeString(strategyName)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safe = base || 'strategy';
  return `${safe}.strategy.json`;
};

const sanitizeCanvasPosition = (position, fallback) => {
  const x = normalizeNumber(position?.x, fallback.x);
  const y = normalizeNumber(position?.y, fallback.y);
  return { x, y };
};

const normalizeConnectionSide = (side, fallback) => {
  const normalized = normalizeString(side);
  if (normalized === 'top' || normalized === 'right' || normalized === 'bottom' || normalized === 'left') {
    return normalized;
  }
  return fallback;
};

const toCanvasBlock = (block, index) => {
  const fallbackPosition = {
    x: (index % 3) * 320,
    y: Math.floor(index / 3) * 260
  };
  const id = normalizeString(block?.id) || `block-${index + 1}`;
  const type = normalizeString(block?.type);
  const config = block?.config || {};
  const position = sanitizeCanvasPosition(block?.position, fallbackPosition);

  if (type === 'streaming') {
    return {
      id,
      type,
      position,
      name: normalizeString(config.name) || id,
      apiUrl: normalizeString(config.sourceUrl),
      updateMode: normalizeString(config.updateMode) || 'periodic',
      updateInterval: Math.max(300, normalizeNumber(config.updateIntervalMs, 1000)),
      fields: Array.isArray(config.fields)
        ? config.fields.filter((field) => typeof field === 'string' && field.trim() !== '')
        : [],
      responseSchema: normalizeString(config.responseSchema),
      mutedFields: Array.isArray(config.mutedFields)
        ? config.mutedFields.filter((field) => typeof field === 'string' && field.trim() !== '')
        : [],
      hideMutedFields: Boolean(config.hideMutedFields)
    };
  }

  if (type === 'normal') {
    return {
      id,
      type,
      position,
      name: normalizeString(config.name) || id,
      value: config.rawValue ?? config.value ?? ''
    };
  }

  if (type === 'trigger') {
    return {
      id,
      type,
      position,
      name: normalizeString(config.name) || id,
      triggerType: normalizeString(config.triggerType) || 'manual',
      interval: Math.max(1, normalizeNumber(config.intervalMs, 1000)),
      conditionSummary: normalizeString(config.condition),
      logicOperator: normalizeString(config.logicOperator || 'OR').toUpperCase()
    };
  }

  if (type === 'action') {
    return {
      id,
      type,
      position,
      name: normalizeString(config.name) || id,
      actionType: normalizeString(config.actionType) || 'cex',
      exchange: normalizeString(config.exchange),
      executionMode: normalizeString(config.executionMode) || 'address',
      contractAddress: normalizeString(config.contractAddress),
      contractAbi: normalizeString(config.contractAbi),
      apiUrl: normalizeString(config.apiUrl),
      apiPayloadTemplate: normalizeString(config.apiPayloadTemplate),
      parameters: Array.isArray(config.parameters)
        ? config.parameters.map((param, paramIndex) => ({
            name: normalizeString(param?.name) || `param${paramIndex + 1}`,
            value: param?.value ?? '',
            placeholder: normalizeString(param?.placeholder),
            source: normalizeSourceRef(param?.source),
            sources: Array.isArray(param?.sources)
              ? param.sources.map(normalizeSourceRef).filter(Boolean)
              : []
          }))
        : [],
      contractAddressSource: normalizeSourceRef(config.contractAddressSource),
      contractAddressSources: Array.isArray(config.contractAddressSources)
        ? config.contractAddressSources.map(normalizeSourceRef).filter(Boolean)
        : []
    };
  }

  if (type === 'monitoring') {
    return {
      id,
      type,
      position,
      name: normalizeString(config.name) || id,
      monitorType: normalizeString(config.monitorType) || 'table',
      connectedStreamId: normalizeString(config.connectedStreamId),
      connectedStream: normalizeString(config.connectedStream),
      fields: Array.isArray(config.fields)
        ? config.fields.filter((field) => typeof field === 'string' && field.trim() !== '')
        : []
    };
  }

  return {
    id,
    type: type || 'normal',
    position,
    name: normalizeString(config.name) || id
  };
};

export const strategyDefinitionToCanvas = (strategy) => {
  const blocks = Array.isArray(strategy?.blocks)
    ? strategy.blocks.map((block, index) => toCanvasBlock(block, index))
    : [];

  const connections = Array.isArray(strategy?.connections)
    ? strategy.connections
      .map((connection, index) => ({
        id: normalizeString(connection?.id)
          || `${normalizeString(connection?.kind) || 'link'}-${index + 1}`,
        kind: normalizeString(connection?.kind),
        fromId: normalizeString(connection?.fromId),
        toId: normalizeString(connection?.toId),
        fromSide: normalizeConnectionSide(connection?.fromSide, 'right'),
        toSide: normalizeConnectionSide(connection?.toSide, 'left')
      }))
      .filter((connection) => connection.kind && connection.fromId && connection.toId)
    : [];

  return { blocks, connections };
};

export { STRATEGY_SCHEMA_VERSION };
