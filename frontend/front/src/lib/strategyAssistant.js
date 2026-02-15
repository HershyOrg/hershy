import { STRATEGY_SCHEMA_VERSION, validateStrategyDefinition } from './strategyCompiler';

const DEFAULT_STREAM_FIELDS = ['lastPrice', 'volume', 'eventTime'];

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeStrategyPayload = (payload) => {
  if (!payload) {
    return null;
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (typeof payload === 'object') {
    if (payload.kind === 'hershy-strategy-graph') {
      return payload;
    }
    if (payload.strategy?.kind === 'hershy-strategy-graph') {
      return payload.strategy;
    }
    if (payload.data?.strategy?.kind === 'hershy-strategy-graph') {
      return payload.data.strategy;
    }
    if (typeof payload.output_text === 'string') {
      return normalizeStrategyPayload(payload.output_text);
    }
  }

  return null;
};

const buildSummary = (blocks, connections) => ({
  blocks: blocks.length,
  connections: connections.length,
  byType: {
    streaming: blocks.filter((block) => block.type === 'streaming').length,
    normal: blocks.filter((block) => block.type === 'normal').length,
    trigger: blocks.filter((block) => block.type === 'trigger').length,
    action: blocks.filter((block) => block.type === 'action').length,
    monitoring: blocks.filter((block) => block.type === 'monitoring').length
  }
});

const extractSymbol = (prompt) => {
  const upper = prompt.toUpperCase();
  const full = upper.match(/\b([A-Z]{2,10}USDT)\b/);
  if (full?.[1]) {
    return full[1];
  }
  const coin = upper.match(/\b(BTC|ETH|SOL|XRP|DOGE|BNB|ADA|AVAX|TRX|LINK|MATIC)\b/);
  if (coin?.[1]) {
    return `${coin[1]}USDT`;
  }
  return 'BTCUSDT';
};

const extractThresholds = (prompt) => {
  const numeric = Array.from(prompt.matchAll(/-?\d+(?:\.\d+)?/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && Math.abs(value) >= 1);

  if (numeric.length >= 2) {
    const upper = Math.max(numeric[0], numeric[1]);
    const lower = Math.min(numeric[0], numeric[1]);
    return { upper, lower };
  }

  if (numeric.length === 1) {
    const pivot = numeric[0];
    const spread = Math.max(1, Math.abs(pivot) * 0.003);
    return { upper: pivot + spread, lower: pivot - spread };
  }

  return { upper: 65050, lower: 64950 };
};

const detectBias = (prompt) => {
  const lower = prompt.toLowerCase();
  if (/(short only|sell only|downside|short-biased|숏만|매도만)/.test(lower)) {
    return 'short';
  }
  if (/(long only|buy only|upside|long-biased|롱만|매수만)/.test(lower)) {
    return 'long';
  }
  return 'both';
};

const toRounded = (value) => (
  Number.isInteger(value) ? value : Number(value.toFixed(6))
);

const buildRuleBasedStrategy = (prompt, currentStrategy) => {
  const symbol = extractSymbol(prompt);
  const symbolLower = symbol.toLowerCase();
  const bias = detectBias(prompt);
  const thresholds = extractThresholds(prompt);
  const strategyName = normalizeText(currentStrategy?.strategy?.name) || `AI ${symbol} strategy`;

  const blocks = [
    {
      id: 'streaming-1',
      type: 'streaming',
      position: { x: 40, y: 80 },
      config: {
        name: `${symbol} ticker`,
        sourceUrl: `wss://stream.binance.com:9443/ws/${symbolLower}@ticker`,
        updateMode: 'periodic',
        updateIntervalMs: 1000,
        fields: [...DEFAULT_STREAM_FIELDS]
      }
    },
    {
      id: 'monitoring-1',
      type: 'monitoring',
      position: { x: 40, y: 360 },
      config: {
        name: `${symbol} monitor`,
        monitorType: 'table',
        connectedStreamId: 'streaming-1',
        connectedStream: `${symbol} ticker`,
        fields: [...DEFAULT_STREAM_FIELDS]
      }
    }
  ];

  const connections = [
    {
      id: 'conn-stream-monitor-1',
      kind: 'stream-monitor',
      fromId: 'streaming-1',
      toId: 'monitoring-1',
      fromSide: 'bottom',
      toSide: 'top'
    }
  ];

  if (bias === 'long' || bias === 'both') {
    blocks.push(
      {
        id: 'normal-1',
        type: 'normal',
        position: { x: 410, y: 40 },
        config: {
          name: 'long_threshold',
          value: toRounded(thresholds.upper)
        }
      },
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 410, y: 180 },
        config: {
          name: 'long_entry_trigger',
          triggerType: 'condition',
          intervalMs: 1000,
          condition: 'streaming-1::lastPrice > normal-1',
          logicOperator: 'OR'
        }
      },
      {
        id: 'action-1',
        type: 'action',
        position: { x: 760, y: 160 },
        config: {
          name: 'paper_buy',
          actionType: 'cex',
          exchange: 'Binance'
        }
      }
    );
    connections.push(
      {
        id: 'conn-trigger-action-long',
        kind: 'trigger-action',
        fromId: 'trigger-1',
        toId: 'action-1',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-stream-action-long',
        kind: 'action-input',
        fromId: 'streaming-1',
        toId: 'action-1',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-normal-action-long',
        kind: 'action-input',
        fromId: 'normal-1',
        toId: 'action-1',
        fromSide: 'right',
        toSide: 'left'
      }
    );
  }

  if (bias === 'short' || bias === 'both') {
    blocks.push(
      {
        id: 'normal-2',
        type: 'normal',
        position: { x: 410, y: 300 },
        config: {
          name: 'short_threshold',
          value: toRounded(thresholds.lower)
        }
      },
      {
        id: 'trigger-2',
        type: 'trigger',
        position: { x: 410, y: 440 },
        config: {
          name: 'short_entry_trigger',
          triggerType: 'condition',
          intervalMs: 1000,
          condition: 'streaming-1::lastPrice < normal-2',
          logicOperator: 'OR'
        }
      },
      {
        id: 'action-2',
        type: 'action',
        position: { x: 760, y: 420 },
        config: {
          name: 'paper_sell',
          actionType: 'cex',
          exchange: 'Binance'
        }
      }
    );
    connections.push(
      {
        id: 'conn-trigger-action-short',
        kind: 'trigger-action',
        fromId: 'trigger-2',
        toId: 'action-2',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-stream-action-short',
        kind: 'action-input',
        fromId: 'streaming-1',
        toId: 'action-2',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-normal-action-short',
        kind: 'action-input',
        fromId: 'normal-2',
        toId: 'action-2',
        fromSide: 'right',
        toSide: 'left'
      }
    );
  }

  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    kind: 'hershy-strategy-graph',
    strategy: {
      id: `ai-${Date.now()}`,
      name: strategyName
    },
    generatedAt: new Date().toISOString(),
    summary: buildSummary(blocks, connections),
    blocks,
    connections
  };
};

const requestRemoteDraft = async ({ endpoint, prompt, currentStrategy }) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        current_strategy: currentStrategy || null,
        response_format: 'hershy-strategy-graph'
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    const strategy = normalizeStrategyPayload(payload);
    if (!strategy) {
      throw new Error('response does not include valid strategy graph');
    }
    return strategy;
  } finally {
    window.clearTimeout(timeout);
  }
};

export const generateStrategyDraft = async ({ prompt, currentStrategy, endpoint: endpointOverride }) => {
  const trimmedPrompt = normalizeText(prompt);
  if (!trimmedPrompt) {
    throw new Error('프롬프트가 비어 있습니다.');
  }

  const endpoint = normalizeText(endpointOverride || import.meta.env.VITE_STRATEGY_AI_ENDPOINT);
  if (endpoint) {
    try {
      const remoteStrategy = await requestRemoteDraft({
        endpoint,
        prompt: trimmedPrompt,
        currentStrategy
      });
      const report = validateStrategyDefinition(remoteStrategy);
      if (report.valid) {
        return {
          strategy: remoteStrategy,
          source: 'remote-ai',
          message: '원격 AI 응답으로 전략을 생성했습니다.'
        };
      }
    } catch (error) {
      return {
        strategy: buildRuleBasedStrategy(trimmedPrompt, currentStrategy),
        source: 'local-fallback',
        message: `원격 AI 호출 실패로 로컬 규칙 생성 사용: ${error.message}`
      };
    }
  }

  return {
    strategy: buildRuleBasedStrategy(trimmedPrompt, currentStrategy),
    source: 'local-rule',
    message: '로컬 규칙 기반으로 전략을 생성했습니다.'
  };
};
