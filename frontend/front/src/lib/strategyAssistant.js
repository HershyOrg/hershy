import { STRATEGY_SCHEMA_VERSION, validateStrategyDefinition } from './strategyCompiler';
import { withUserContextHeaders, withUserContextPayload } from './userContextClient';

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
    .filter((value) => Number.isFinite(value) && Math.abs(value) >= 1 && Math.abs(value) <= 10_000_000);

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
  if (/(short only|sell only|downside|short-biased|숏만|매도만|down only|no only|buy no|하락만|하방만)/.test(lower)) {
    return 'short';
  }
  if (/(long only|buy only|upside|long-biased|롱만|매수만|up only|yes only|buy yes|상승만|상방만)/.test(lower)) {
    return 'long';
  }
  return 'both';
};

const toRounded = (value) => (
  Number.isInteger(value) ? value : Number(value.toFixed(6))
);

const isPolymarketPrompt = (prompt, currentStrategy) => {
  const lower = prompt.toLowerCase();
  if (currentStrategy?.runtime?.profile === 'polymarket') {
    return true;
  }
  return /(polymarket|prediction market|예측시장|업오다운|up or down|yes token|no token|token id)/.test(lower);
};

const extractPolymarketTokenIds = (prompt, currentStrategy) => {
  const matches = Array.from(prompt.matchAll(/\b\d{20,}\b/g)).map((match) => match[0]);
  const existing = currentStrategy?.runtime?.polymarket || {};
  return {
    yesTokenId: matches[0] || existing.yesTokenId || 'REPLACE_YES_TOKEN_ID',
    noTokenId: matches[1] || existing.noTokenId || 'REPLACE_NO_TOKEN_ID'
  };
};

const extractPolymarketPrice = (prompt, currentStrategy) => {
  const existing = Number(currentStrategy?.runtime?.polymarket?.orderPrice);
  const cents = prompt.match(/(\d+(?:\.\d+)?)\s*(?:c|¢|cent|cents)\b/i);
  if (cents?.[1]) {
    return toRounded(Number(cents[1]) / 100);
  }
  if (Number.isFinite(existing) && existing > 0) {
    return toRounded(existing);
  }
  return 0.55;
};

const extractPolymarketSizeShares = (prompt, currentStrategy) => {
  const existing = Number(currentStrategy?.runtime?.polymarket?.orderSizeShares);
  const shares = prompt.match(/(\d+(?:\.\d+)?)\s*(?:shares?|주)\b/i);
  if (shares?.[1]) {
    return toRounded(Number(shares[1]));
  }
  if (Number.isFinite(existing) && existing > 0) {
    return toRounded(existing);
  }
  return 5;
};

const extractPolymarketSignalThresholds = (prompt) => {
  const cleaned = prompt
    .replace(/\b\d{20,}\b/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:shares?|주)\b/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:c|¢|cent|cents)\b/gi, ' ');
  return extractThresholds(cleaned);
};

const extractSlugPrefix = (prompt, currentStrategy) => {
  const explicit = prompt.match(/slug(?:\s*prefix)?\s*[:=]\s*([a-z0-9-]+)/i);
  if (explicit?.[1]) {
    return explicit[1].toLowerCase();
  }
  const existing = normalizeText(currentStrategy?.runtime?.polymarket?.slugPrefix);
  if (existing) {
    return existing;
  }
  const dashed = prompt.toLowerCase().match(/\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/g) || [];
  const preferred = dashed.find((item) => item.includes('up-or-down'));
  return preferred || dashed[0] || '';
};

const buildPolymarketAction = ({ id, name, tokenBlockId, position }) => ({
  id,
  type: 'action',
  position,
  config: {
    name,
    actionType: 'dex',
    dexProtocol: 'polymarket',
    executionMode: 'address',
    chainId: '137',
    apiUrl: 'https://clob.polymarket.com',
    parameters: [
      {
        name: 'tokenId',
        source: {
          blockId: tokenBlockId,
          blockType: 'normal',
          field: '',
          mode: 'value'
        }
      },
      {
        name: 'price',
        source: {
          blockId: 'normal-order-price',
          blockType: 'normal',
          field: '',
          mode: 'value'
        }
      },
      {
        name: 'size',
        source: {
          blockId: 'normal-order-size',
          blockType: 'normal',
          field: '',
          mode: 'value'
        }
      },
      {
        name: 'side',
        value: 'BUY'
      },
      {
        name: 'clobHost',
        value: 'https://clob.polymarket.com'
      }
    ]
  }
});

const buildPolymarketRuleBasedStrategy = (prompt, currentStrategy) => {
  const symbol = extractSymbol(prompt);
  const symbolLower = symbol.toLowerCase();
  const thresholds = extractPolymarketSignalThresholds(prompt);
  const bias = detectBias(prompt);
  const { yesTokenId, noTokenId } = extractPolymarketTokenIds(prompt, currentStrategy);
  const orderPrice = extractPolymarketPrice(prompt, currentStrategy);
  const orderSizeShares = extractPolymarketSizeShares(prompt, currentStrategy);
  const slugPrefix = extractSlugPrefix(prompt, currentStrategy);
  const strategyName = normalizeText(currentStrategy?.strategy?.name) || `AI ${symbol} polymarket strategy`;

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
        name: `${symbol} signal monitor`,
        monitorType: 'table',
        connectedStreamId: 'streaming-1',
        connectedStream: `${symbol} ticker`,
        fields: [...DEFAULT_STREAM_FIELDS]
      }
    },
    {
      id: 'normal-order-price',
      type: 'normal',
      position: { x: 380, y: 40 },
      config: {
        name: 'polymarket_order_price',
        value: orderPrice
      }
    },
    {
      id: 'normal-order-size',
      type: 'normal',
      position: { x: 380, y: 140 },
      config: {
        name: 'polymarket_order_size_shares',
        value: orderSizeShares
      }
    },
    {
      id: 'normal-yes-token',
      type: 'normal',
      position: { x: 380, y: 240 },
      config: {
        name: 'polymarket_yes_token_id',
        value: yesTokenId
      }
    },
    {
      id: 'normal-no-token',
      type: 'normal',
      position: { x: 380, y: 340 },
      config: {
        name: 'polymarket_no_token_id',
        value: noTokenId
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
        id: 'normal-yes-threshold',
        type: 'normal',
        position: { x: 700, y: 40 },
        config: {
          name: 'yes_entry_threshold',
          value: toRounded(thresholds.upper)
        }
      },
      {
        id: 'trigger-yes-entry',
        type: 'trigger',
        position: { x: 700, y: 180 },
        config: {
          name: 'yes_entry_trigger',
          triggerType: 'condition',
          intervalMs: 1000,
          condition: 'streaming-1::lastPrice > normal-yes-threshold',
          logicOperator: 'OR'
        }
      },
      buildPolymarketAction({
        id: 'action-buy-yes',
        name: 'polymarket_buy_yes',
        tokenBlockId: 'normal-yes-token',
        position: { x: 1060, y: 160 }
      })
    );
    connections.push(
      {
        id: 'conn-trigger-buy-yes',
        kind: 'trigger-action',
        fromId: 'trigger-yes-entry',
        toId: 'action-buy-yes',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-stream-buy-yes',
        kind: 'action-input',
        fromId: 'streaming-1',
        toId: 'action-buy-yes',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-price-buy-yes',
        kind: 'action-input',
        fromId: 'normal-order-price',
        toId: 'action-buy-yes',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-size-buy-yes',
        kind: 'action-input',
        fromId: 'normal-order-size',
        toId: 'action-buy-yes',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-token-buy-yes',
        kind: 'action-input',
        fromId: 'normal-yes-token',
        toId: 'action-buy-yes',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-threshold-buy-yes',
        kind: 'action-input',
        fromId: 'normal-yes-threshold',
        toId: 'action-buy-yes',
        fromSide: 'right',
        toSide: 'left'
      }
    );
  }

  if (bias === 'short' || bias === 'both') {
    blocks.push(
      {
        id: 'normal-no-threshold',
        type: 'normal',
        position: { x: 700, y: 320 },
        config: {
          name: 'no_entry_threshold',
          value: toRounded(thresholds.lower)
        }
      },
      {
        id: 'trigger-no-entry',
        type: 'trigger',
        position: { x: 700, y: 460 },
        config: {
          name: 'no_entry_trigger',
          triggerType: 'condition',
          intervalMs: 1000,
          condition: 'streaming-1::lastPrice < normal-no-threshold',
          logicOperator: 'OR'
        }
      },
      buildPolymarketAction({
        id: 'action-buy-no',
        name: 'polymarket_buy_no',
        tokenBlockId: 'normal-no-token',
        position: { x: 1060, y: 440 }
      })
    );
    connections.push(
      {
        id: 'conn-trigger-buy-no',
        kind: 'trigger-action',
        fromId: 'trigger-no-entry',
        toId: 'action-buy-no',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-stream-buy-no',
        kind: 'action-input',
        fromId: 'streaming-1',
        toId: 'action-buy-no',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-price-buy-no',
        kind: 'action-input',
        fromId: 'normal-order-price',
        toId: 'action-buy-no',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-size-buy-no',
        kind: 'action-input',
        fromId: 'normal-order-size',
        toId: 'action-buy-no',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-token-buy-no',
        kind: 'action-input',
        fromId: 'normal-no-token',
        toId: 'action-buy-no',
        fromSide: 'right',
        toSide: 'left'
      },
      {
        id: 'conn-threshold-buy-no',
        kind: 'action-input',
        fromId: 'normal-no-threshold',
        toId: 'action-buy-no',
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
    runtime: {
      profile: 'polymarket',
      polymarket: {
        signalSymbol: symbol,
        slugPrefix,
        yesTokenId,
        noTokenId,
        orderPrice,
        orderSizeShares,
        needsTokenIdSetup: yesTokenId.startsWith('REPLACE_') || noTokenId.startsWith('REPLACE_')
      }
    },
    summary: buildSummary(blocks, connections),
    blocks,
    connections
  };
};

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

const requestRemoteDraft = async ({ endpoint, prompt, currentStrategy, authContext }) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  try {
    const requestPayload = {
      prompt,
      current_strategy: currentStrategy || null,
      response_format: 'hershy-strategy-graph'
    };
    if (authContext && typeof authContext === 'object') {
      requestPayload.auth_context = authContext;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...withUserContextHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(withUserContextPayload(requestPayload)),
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

export const generateStrategyDraft = async ({
  prompt,
  currentStrategy,
  authContext,
  endpoint: endpointOverride
}) => {
  const trimmedPrompt = normalizeText(prompt);
  if (!trimmedPrompt) {
    throw new Error('프롬프트가 비어 있습니다.');
  }

  if (isPolymarketPrompt(trimmedPrompt, currentStrategy)) {
    const strategy = buildPolymarketRuleBasedStrategy(trimmedPrompt, currentStrategy);
    const requiresTokenSetup = Boolean(strategy.runtime?.polymarket?.needsTokenIdSetup);
    return {
      strategy,
      source: 'local-polymarket-graph',
      message: requiresTokenSetup
        ? 'Polymarket 그래프 전략을 생성했습니다. 배포 전 yes/no tokenId 값을 실제 마켓 토큰 ID로 채워주세요.'
        : 'Polymarket 그래프 전략을 생성했습니다.'
    };
  }

  const viteEndpoint = (typeof import.meta !== 'undefined' && import.meta?.env)
    ? import.meta.env.VITE_STRATEGY_AI_ENDPOINT
    : '';
  const endpoint = normalizeText(endpointOverride || viteEndpoint);
  if (endpoint) {
    try {
      const remoteStrategy = await requestRemoteDraft({
        endpoint,
        prompt: trimmedPrompt,
        currentStrategy,
        authContext
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
