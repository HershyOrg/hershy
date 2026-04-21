import { STRATEGY_SCHEMA_VERSION, validateStrategyDefinition } from './strategyCompiler';

const DEFAULT_STREAM_FIELDS = ['lastPrice', 'volume', 'eventTime'];
const DEFAULT_PRICE_STREAM_FIELDS = ['lastPrice', 'priceChangePercent', 'volume', 'eventTime'];
const DEFAULT_LP_STREAM_FIELDS = [
  'walletBaseFree',
  'walletQuoteFree',
  'lpBaseAmount',
  'lpQuoteAmount',
  'feesAccruedUsd',
  'deltaExposure'
];
const DEFAULT_HEDGE_STREAM_FIELDS = [
  'shortNotionalUsd',
  'marginRatio',
  'unrealizedPnlUsd',
  'fundingRate'
];
const LIQUIDITY_BOT_PROMPT_PATTERN = /(v2|liquidity|lp\b|delta[\s-]*neutral|hedg(?:e|ing)|uniswap|impermanent|유동성|델타\s*뉴트럴|헷지|헤지|리밸런싱 봇|비영구적 손실)/i;

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

const detectLiquidityBotPrompt = (prompt) => LIQUIDITY_BOT_PROMPT_PATTERN.test(prompt);

const extractLiquidityStableAsset = (prompt) => {
  const lower = prompt.toLowerCase();
  if (/\busdc\b/.test(lower)) {
    return 'USDC';
  }
  if (/\busdt\b/.test(lower)) {
    return 'USDT';
  }
  return 'USDT';
};

const extractLiquidityBaseAsset = (prompt) => {
  const upper = prompt.toUpperCase();
  const pair = upper.match(/\b([A-Z]{2,10})(USDT|USDC)\b/);
  if (pair?.[1]) {
    return pair[1];
  }

  const symbol = extractSymbol(prompt);
  const baseFromSymbol = symbol.replace(/(USDT|USDC|USD|BUSD)$/i, '').trim();
  if (baseFromSymbol) {
    return baseFromSymbol;
  }

  const asset = upper.match(/\b(ETH|SOL|BTC|BNB|AVAX|ARB|OP|MATIC|LINK|AAVE)\b/);
  if (asset?.[1]) {
    return asset[1];
  }

  return 'ETH';
};

const makeSource = (blockId, blockName, blockType, field = '', mode = 'live') => ({
  blockId,
  blockName,
  blockType,
  field,
  mode
});

const makeParam = (name, { value = '', placeholder = '', source = null } = {}) => ({
  name,
  value,
  placeholder,
  source,
  sources: source ? [source] : []
});

const buildLiquidityBotStrategy = (prompt, currentStrategy) => {
  const baseAsset = extractLiquidityBaseAsset(prompt);
  const quoteAsset = extractLiquidityStableAsset(prompt);
  const cexSymbol = `${baseAsset}USDT`;
  const cexSymbolLower = cexSymbol.toLowerCase();
  const preservedName = normalizeText(currentStrategy?.strategy?.name);
  const strategyName = preservedName || `V2 ${baseAsset}/${quoteAsset} Liquidity Bot Strategy`;

  const priceStreamName = `${baseAsset}/${quoteAsset} CEX price`;
  const lpStreamName = `${baseAsset}-${quoteAsset} LP wallet state`;
  const hedgeStreamName = `${baseAsset} hedge account state`;

  const sourceRefs = {
    priceLast: makeSource('s_cex_price', priceStreamName, 'streaming', 'lastPrice'),
    priceChangePercent: makeSource('s_cex_price', priceStreamName, 'streaming', 'priceChangePercent'),
    walletBaseFree: makeSource('s_lp_state', lpStreamName, 'streaming', 'walletBaseFree'),
    walletQuoteFree: makeSource('s_lp_state', lpStreamName, 'streaming', 'walletQuoteFree'),
    lpBaseAmount: makeSource('s_lp_state', lpStreamName, 'streaming', 'lpBaseAmount'),
    lpQuoteAmount: makeSource('s_lp_state', lpStreamName, 'streaming', 'lpQuoteAmount'),
    feesAccruedUsd: makeSource('s_lp_state', lpStreamName, 'streaming', 'feesAccruedUsd'),
    deltaExposure: makeSource('s_lp_state', lpStreamName, 'streaming', 'deltaExposure'),
    marginRatio: makeSource('s_hedge_state', hedgeStreamName, 'streaming', 'marginRatio'),
    shortNotionalUsd: makeSource('s_hedge_state', hedgeStreamName, 'streaming', 'shortNotionalUsd'),
    unrealizedPnlUsd: makeSource('s_hedge_state', hedgeStreamName, 'streaming', 'unrealizedPnlUsd'),
    targetBaseRatio: makeSource('n_target_base_ratio', 'target_base_ratio', 'normal'),
    reinvestMinUsd: makeSource('n_reinvest_min_usd', 'reinvest_min_usd', 'normal'),
    crisisUpPct: makeSource('n_crisis_up_pct', 'crisis_up_pct', 'normal'),
    deltaBandPct: makeSource('n_delta_band_pct', 'delta_band_pct', 'normal'),
    marginFloor: makeSource('n_margin_floor', 'margin_floor', 'normal'),
    exitQuoteAsset: makeSource('n_exit_quote_asset', 'exit_quote_asset', 'normal')
  };

  const blocks = [
    {
      id: 's_cex_price',
      type: 'streaming',
      position: { x: 40, y: 40 },
      config: {
        name: priceStreamName,
        sourceUrl: `wss://stream.binance.com:9443/ws/${cexSymbolLower}@ticker`,
        updateMode: 'periodic',
        updateIntervalMs: 1000,
        fields: [...DEFAULT_PRICE_STREAM_FIELDS]
      }
    },
    {
      id: 'm_cex_price',
      type: 'monitoring',
      position: { x: 40, y: 210 },
      config: {
        name: `${baseAsset} price monitor`,
        monitorType: 'table',
        connectedStreamId: 's_cex_price',
        connectedStream: priceStreamName,
        fields: [...DEFAULT_PRICE_STREAM_FIELDS]
      }
    },
    {
      id: 's_lp_state',
      type: 'streaming',
      position: { x: 40, y: 470 },
      config: {
        name: lpStreamName,
        sourceUrl: '',
        updateMode: 'periodic',
        updateIntervalMs: 60000,
        fields: [...DEFAULT_LP_STREAM_FIELDS]
      }
    },
    {
      id: 'm_lp_state',
      type: 'monitoring',
      position: { x: 40, y: 640 },
      config: {
        name: `${baseAsset}-${quoteAsset} liquidity monitor`,
        monitorType: 'table',
        connectedStreamId: 's_lp_state',
        connectedStream: lpStreamName,
        fields: [...DEFAULT_LP_STREAM_FIELDS]
      }
    },
    {
      id: 's_hedge_state',
      type: 'streaming',
      position: { x: 40, y: 900 },
      config: {
        name: hedgeStreamName,
        sourceUrl: '',
        updateMode: 'periodic',
        updateIntervalMs: 60000,
        fields: [...DEFAULT_HEDGE_STREAM_FIELDS]
      }
    },
    {
      id: 'm_hedge_state',
      type: 'monitoring',
      position: { x: 40, y: 1070 },
      config: {
        name: `${baseAsset} hedge monitor`,
        monitorType: 'table',
        connectedStreamId: 's_hedge_state',
        connectedStream: hedgeStreamName,
        fields: [...DEFAULT_HEDGE_STREAM_FIELDS]
      }
    },
    {
      id: 'n_target_base_ratio',
      type: 'normal',
      position: { x: 420, y: 60 },
      config: {
        name: 'target_base_ratio',
        value: 0.5
      }
    },
    {
      id: 'n_reinvest_min_usd',
      type: 'normal',
      position: { x: 420, y: 250 },
      config: {
        name: 'reinvest_min_usd',
        value: 250
      }
    },
    {
      id: 'n_crisis_up_pct',
      type: 'normal',
      position: { x: 420, y: 500 },
      config: {
        name: 'crisis_up_pct',
        value: 10
      }
    },
    {
      id: 'n_delta_band_pct',
      type: 'normal',
      position: { x: 420, y: 640 },
      config: {
        name: 'delta_band_pct',
        value: 3
      }
    },
    {
      id: 'n_margin_floor',
      type: 'normal',
      position: { x: 420, y: 780 },
      config: {
        name: 'margin_floor',
        value: 0.18
      }
    },
    {
      id: 'n_exit_quote_asset',
      type: 'normal',
      position: { x: 420, y: 1030 },
      config: {
        name: 'exit_quote_asset',
        value: quoteAsset
      }
    },
    {
      id: 't_init_start',
      type: 'trigger',
      position: { x: 760, y: 80 },
      config: {
        name: '리밸런싱 봇 시작',
        triggerType: 'manual',
        intervalMs: 1000,
        condition: '',
        logicOperator: 'OR'
      }
    },
    {
      id: 't_hourly_compound',
      type: 'trigger',
      position: { x: 760, y: 320 },
      config: {
        name: '1시간 모니터링: 재투자 조건 충족',
        triggerType: 'condition',
        intervalMs: 3600000,
        condition: 's_lp_state::feesAccruedUsd >= n_reinvest_min_usd and s_lp_state::walletBaseFree > 0 and s_lp_state::walletQuoteFree > 0',
        logicOperator: 'AND'
      }
    },
    {
      id: 't_crisis_rebalance',
      type: 'trigger',
      position: { x: 760, y: 580 },
      config: {
        name: '위기 감지: 델타 뉴트럴 재정렬',
        triggerType: 'condition',
        intervalMs: 1000,
        condition: 's_cex_price::priceChangePercent >= n_crisis_up_pct or s_hedge_state::marginRatio <= n_margin_floor or s_lp_state::deltaExposure >= n_delta_band_pct or s_lp_state::deltaExposure <= -3',
        logicOperator: 'OR'
      }
    },
    {
      id: 't_emergency_exit',
      type: 'trigger',
      position: { x: 760, y: 1050 },
      config: {
        name: '긴급: 모든 포지션 종료',
        triggerType: 'manual',
        intervalMs: 1000,
        condition: '',
        logicOperator: 'OR'
      }
    },
    {
      id: 'a_init_swap_quote_to_base',
      type: 'action',
      position: { x: 1120, y: 20 },
      config: {
        name: `초과 ${quoteAsset}를 ${baseAsset}로 스왑`,
        actionType: 'dex',
        dexProtocol: 'generic',
        executionMode: 'api',
        parameters: [
          makeParam('baseAsset', { value: baseAsset }),
          makeParam('quoteAsset', { value: quoteAsset }),
          makeParam('quoteBalance', { source: sourceRefs.walletQuoteFree }),
          makeParam('targetBaseRatio', { source: sourceRefs.targetBaseRatio })
        ]
      }
    },
    {
      id: 'a_init_add_liquidity',
      type: 'action',
      position: { x: 1430, y: 20 },
      config: {
        name: 'DEX 유동성 공급',
        actionType: 'dex',
        dexProtocol: 'generic',
        executionMode: 'api',
        parameters: [
          makeParam('baseAsset', { value: baseAsset }),
          makeParam('quoteAsset', { value: quoteAsset }),
          makeParam('baseAmount', { source: sourceRefs.walletBaseFree }),
          makeParam('quoteAmount', { source: sourceRefs.walletQuoteFree })
        ]
      }
    },
    {
      id: 'a_init_open_short',
      type: 'action',
      position: { x: 1740, y: 20 },
      config: {
        name: `CEX ${baseAsset} 숏 포지션 오픈`,
        actionType: 'cex',
        exchange: 'Binance',
        parameters: [
          makeParam('symbol', { value: cexSymbol }),
          makeParam('side', { value: 'SELL' }),
          makeParam('accountType', { value: 'USDM_FUTURES' }),
          makeParam('positionSide', { value: 'SHORT' }),
          makeParam('quantity', { source: sourceRefs.lpBaseAmount }),
          makeParam('referencePrice', { source: sourceRefs.priceLast })
        ]
      }
    },
    {
      id: 'a_compound_add_liquidity',
      type: 'action',
      position: { x: 1120, y: 300 },
      config: {
        name: '수익 재투자: LP 추가 공급',
        actionType: 'dex',
        dexProtocol: 'generic',
        executionMode: 'api',
        parameters: [
          makeParam('baseAsset', { value: baseAsset }),
          makeParam('quoteAsset', { value: quoteAsset }),
          makeParam('compoundThresholdUsd', { source: sourceRefs.reinvestMinUsd }),
          makeParam('feesAccruedUsd', { source: sourceRefs.feesAccruedUsd }),
          makeParam('baseAmount', { source: sourceRefs.walletBaseFree }),
          makeParam('quoteAmount', { source: sourceRefs.walletQuoteFree })
        ]
      }
    },
    {
      id: 'a_compound_increase_short',
      type: 'action',
      position: { x: 1430, y: 300 },
      config: {
        name: `수익 재투자: ${baseAsset} 숏 증설`,
        actionType: 'cex',
        exchange: 'Binance',
        parameters: [
          makeParam('symbol', { value: cexSymbol }),
          makeParam('side', { value: 'SELL' }),
          makeParam('accountType', { value: 'USDM_FUTURES' }),
          makeParam('positionSide', { value: 'SHORT' }),
          makeParam('quoteAmount', { source: sourceRefs.feesAccruedUsd }),
          makeParam('referencePrice', { source: sourceRefs.priceLast })
        ]
      }
    },
    {
      id: 'a_crisis_reduce_lp',
      type: 'action',
      position: { x: 1120, y: 540 },
      config: {
        name: '위기 대응: LP 비중 축소/재조정',
        actionType: 'dex',
        dexProtocol: 'generic',
        executionMode: 'api',
        parameters: [
          makeParam('baseAsset', { value: baseAsset }),
          makeParam('quoteAsset', { value: quoteAsset }),
          makeParam('deltaExposure', { source: sourceRefs.deltaExposure }),
          makeParam('deltaBandPct', { source: sourceRefs.deltaBandPct }),
          makeParam('lpBaseAmount', { source: sourceRefs.lpBaseAmount }),
          makeParam('lpQuoteAmount', { source: sourceRefs.lpQuoteAmount })
        ]
      }
    },
    {
      id: 'a_crisis_topup_margin',
      type: 'action',
      position: { x: 1430, y: 540 },
      config: {
        name: '위기 대응: 숏 증거금 보강',
        actionType: 'cex',
        exchange: 'Binance',
        parameters: [
          makeParam('symbol', { value: cexSymbol }),
          makeParam('accountType', { value: 'USDM_FUTURES' }),
          makeParam('positionSide', { value: 'SHORT' }),
          makeParam('marginRatio', { source: sourceRefs.marginRatio }),
          makeParam('marginFloor', { source: sourceRefs.marginFloor }),
          makeParam('unrealizedPnlUsd', { source: sourceRefs.unrealizedPnlUsd })
        ]
      }
    },
    {
      id: 'a_crisis_reopen_short',
      type: 'action',
      position: { x: 1740, y: 540 },
      config: {
        name: '위기 대응: 델타 뉴트럴 재정렬',
        actionType: 'cex',
        exchange: 'Binance',
        parameters: [
          makeParam('symbol', { value: cexSymbol }),
          makeParam('side', { value: 'SELL' }),
          makeParam('accountType', { value: 'USDM_FUTURES' }),
          makeParam('positionSide', { value: 'SHORT' }),
          makeParam('priceChangePercent', { source: sourceRefs.priceChangePercent }),
          makeParam('shortNotionalUsd', { source: sourceRefs.shortNotionalUsd }),
          makeParam('deltaBandPct', { source: sourceRefs.deltaBandPct })
        ]
      }
    },
    {
      id: 'a_emergency_remove_lp',
      type: 'action',
      position: { x: 1120, y: 1020 },
      config: {
        name: '긴급 종료: LP 회수',
        actionType: 'dex',
        dexProtocol: 'generic',
        executionMode: 'api',
        parameters: [
          makeParam('baseAsset', { value: baseAsset }),
          makeParam('quoteAsset', { value: quoteAsset }),
          makeParam('lpBaseAmount', { source: sourceRefs.lpBaseAmount }),
          makeParam('lpQuoteAmount', { source: sourceRefs.lpQuoteAmount })
        ]
      }
    },
    {
      id: 'a_emergency_close_short',
      type: 'action',
      position: { x: 1430, y: 1020 },
      config: {
        name: `긴급 종료: ${baseAsset} 숏 청산`,
        actionType: 'cex',
        exchange: 'Binance',
        parameters: [
          makeParam('symbol', { value: cexSymbol }),
          makeParam('side', { value: 'BUY' }),
          makeParam('accountType', { value: 'USDM_FUTURES' }),
          makeParam('positionSide', { value: 'SHORT' }),
          makeParam('quantity', { source: sourceRefs.lpBaseAmount }),
          makeParam('shortNotionalUsd', { source: sourceRefs.shortNotionalUsd })
        ]
      }
    },
    {
      id: 'a_emergency_swap_to_quote',
      type: 'action',
      position: { x: 1740, y: 1020 },
      config: {
        name: `긴급 종료: 전량 ${quoteAsset} 전환`,
        actionType: 'dex',
        dexProtocol: 'generic',
        executionMode: 'api',
        parameters: [
          makeParam('destinationAsset', { source: sourceRefs.exitQuoteAsset }),
          makeParam('baseAsset', { value: baseAsset }),
          makeParam('walletBaseFree', { source: sourceRefs.walletBaseFree }),
          makeParam('walletQuoteFree', { source: sourceRefs.walletQuoteFree })
        ]
      }
    }
  ];

  const connections = [
    {
      id: 'conn-stream-monitor-price',
      kind: 'stream-monitor',
      fromId: 's_cex_price',
      toId: 'm_cex_price',
      fromSide: 'bottom',
      toSide: 'top'
    },
    {
      id: 'conn-stream-monitor-lp',
      kind: 'stream-monitor',
      fromId: 's_lp_state',
      toId: 'm_lp_state',
      fromSide: 'bottom',
      toSide: 'top'
    },
    {
      id: 'conn-stream-monitor-hedge',
      kind: 'stream-monitor',
      fromId: 's_hedge_state',
      toId: 'm_hedge_state',
      fromSide: 'bottom',
      toSide: 'top'
    },
    {
      id: 'conn-trigger-init-swap',
      kind: 'trigger-action',
      fromId: 't_init_start',
      toId: 'a_init_swap_quote_to_base',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-init-lp',
      kind: 'trigger-action',
      fromId: 't_init_start',
      toId: 'a_init_add_liquidity',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-init-short',
      kind: 'trigger-action',
      fromId: 't_init_start',
      toId: 'a_init_open_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-hourly-lp',
      kind: 'trigger-action',
      fromId: 't_hourly_compound',
      toId: 'a_compound_add_liquidity',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-hourly-short',
      kind: 'trigger-action',
      fromId: 't_hourly_compound',
      toId: 'a_compound_increase_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-crisis-lp',
      kind: 'trigger-action',
      fromId: 't_crisis_rebalance',
      toId: 'a_crisis_reduce_lp',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-crisis-margin',
      kind: 'trigger-action',
      fromId: 't_crisis_rebalance',
      toId: 'a_crisis_topup_margin',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-crisis-short',
      kind: 'trigger-action',
      fromId: 't_crisis_rebalance',
      toId: 'a_crisis_reopen_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-emergency-lp',
      kind: 'trigger-action',
      fromId: 't_emergency_exit',
      toId: 'a_emergency_remove_lp',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-emergency-short',
      kind: 'trigger-action',
      fromId: 't_emergency_exit',
      toId: 'a_emergency_close_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-trigger-emergency-swap',
      kind: 'trigger-action',
      fromId: 't_emergency_exit',
      toId: 'a_emergency_swap_to_quote',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-init-swap-stream',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_init_swap_quote_to_base',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-init-swap-ratio',
      kind: 'action-input',
      fromId: 'n_target_base_ratio',
      toId: 'a_init_swap_quote_to_base',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-init-lp-stream',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_init_add_liquidity',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-init-lp-ratio',
      kind: 'action-input',
      fromId: 'n_target_base_ratio',
      toId: 'a_init_add_liquidity',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-init-short-lp',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_init_open_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-init-short-price',
      kind: 'action-input',
      fromId: 's_cex_price',
      toId: 'a_init_open_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-hourly-lp-stream',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_compound_add_liquidity',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-hourly-lp-normal',
      kind: 'action-input',
      fromId: 'n_reinvest_min_usd',
      toId: 'a_compound_add_liquidity',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-hourly-short-stream',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_compound_increase_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-hourly-short-price',
      kind: 'action-input',
      fromId: 's_cex_price',
      toId: 'a_compound_increase_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-lp-state',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_crisis_reduce_lp',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-lp-band',
      kind: 'action-input',
      fromId: 'n_delta_band_pct',
      toId: 'a_crisis_reduce_lp',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-margin-state',
      kind: 'action-input',
      fromId: 's_hedge_state',
      toId: 'a_crisis_topup_margin',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-margin-floor',
      kind: 'action-input',
      fromId: 'n_margin_floor',
      toId: 'a_crisis_topup_margin',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-short-price',
      kind: 'action-input',
      fromId: 's_cex_price',
      toId: 'a_crisis_reopen_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-short-hedge',
      kind: 'action-input',
      fromId: 's_hedge_state',
      toId: 'a_crisis_reopen_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-crisis-short-band',
      kind: 'action-input',
      fromId: 'n_delta_band_pct',
      toId: 'a_crisis_reopen_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-emergency-lp',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_emergency_remove_lp',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-emergency-short',
      kind: 'action-input',
      fromId: 's_hedge_state',
      toId: 'a_emergency_close_short',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-emergency-swap-lp',
      kind: 'action-input',
      fromId: 's_lp_state',
      toId: 'a_emergency_swap_to_quote',
      fromSide: 'right',
      toSide: 'left'
    },
    {
      id: 'conn-input-emergency-swap-quote',
      kind: 'action-input',
      fromId: 'n_exit_quote_asset',
      toId: 'a_emergency_swap_to_quote',
      fromSide: 'right',
      toSide: 'left'
    }
  ];

  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    kind: 'hershy-strategy-graph',
    strategy: {
      id: `ai-liquidity-${Date.now()}`,
      name: strategyName
    },
    generatedAt: new Date().toISOString(),
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

const buildLocalStrategyDraft = (prompt, currentStrategy) => (
  detectLiquidityBotPrompt(prompt)
    ? buildLiquidityBotStrategy(prompt, currentStrategy)
    : buildRuleBasedStrategy(prompt, currentStrategy)
);

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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload),
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

  if (detectLiquidityBotPrompt(trimmedPrompt)) {
    const templateStrategy = buildLiquidityBotStrategy(trimmedPrompt, currentStrategy);
    const report = validateStrategyDefinition(templateStrategy);
    if (report.valid) {
      return {
        strategy: templateStrategy,
        source: 'local-template',
        message: 'V2 유동성 봇 전략 템플릿을 적용했습니다.'
      };
    }
  }

  const endpoint = normalizeText(endpointOverride || import.meta.env.VITE_STRATEGY_AI_ENDPOINT);
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
          strategy: buildLocalStrategyDraft(trimmedPrompt, currentStrategy),
          source: 'local-fallback',
          message: `원격 AI 호출 실패로 로컬 규칙 생성 사용: ${error.message}`
        };
    }
  }

  return {
    strategy: buildLocalStrategyDraft(trimmedPrompt, currentStrategy),
    source: 'local-rule',
    message: '로컬 규칙 기반으로 전략을 생성했습니다.'
  };
};
