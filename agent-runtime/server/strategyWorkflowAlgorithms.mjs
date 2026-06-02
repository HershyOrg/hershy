const DEFAULT_CHAIN = 'base-mainnet';

const CHAIN_HINTS = [
  { regex: /\b(base|basechain|base\s+chain|8453)\b/i, chain: 'base-mainnet', label: 'Base' },
  { regex: /\b(ethereum|eth\s+mainnet|mainnet|1)\b/i, chain: 'ethereum', label: 'Ethereum' },
  { regex: /\b(arbitrum|arb|42161)\b/i, chain: 'arbitrum', label: 'Arbitrum' },
  { regex: /\b(optimism|op\s+mainnet|10)\b/i, chain: 'optimism', label: 'Optimism' },
  { regex: /\b(polygon|matic|137)\b/i, chain: 'polygon', label: 'Polygon' },
  { regex: /\b(bsc|bnb|binance\s+smart\s+chain|56)\b/i, chain: 'bsc', label: 'BNB Smart Chain' },
];

const ASSET_GROUPS = [
  { id: 'BTC', regex: /\b(btc|bitcoin|wbtc|cbbtc|tbtc|lbtc|solvbtc|fbtc)\b/i },
  { id: 'ETH', regex: /\b(eth|ether|ethereum|weth|steth|wsteth|cbeth|reth|meth)\b/i },
  { id: 'USD', regex: /\b(usd|usdc|usdt|dai|usde|usds|frax|lusd|crvusd|stable)\b/i },
  { id: 'SOL', regex: /\b(sol|solana|jito|jupsol|lst)\b/i },
  { id: 'AERO', regex: /\b(aero|aerodrome|veaero)\b/i },
];

const RISK_HINTS = [
  { regex: /(conservative|safe|low\s*risk|보수|안전|낮은\s*위험|저위험)/i, risk: 'conservative' },
  { regex: /(aggressive|high\s*risk|공격|고위험|수익률\s*우선)/i, risk: 'aggressive' },
  { regex: /(moderate|balanced|중간|균형)/i, risk: 'moderate' },
];

const CEX_RE = /\b(cex|binance|bybit|okx|kucoin|bitget|gate|coinbase|kraken|upbit|bithumb|centralized|거래소|중앙화)\b/i;
const ONCHAIN_RE = /\b(dex|defi|onchain|on-chain|blockchain|smart\s*contract|contract|wallet|rpc|base|ethereum|arbitrum|optimism|polygon|bsc|uniswap|aerodrome|curve|pancake|aave|morpho|moonwell|온체인|블록체인|컨트랙트|지갑|스왑|디파이)\b/i;

const EXECUTION_DOMAINS = {
  general_automation: {
    id: 'general_automation',
    title: 'General Agentic Workflow',
    description: 'Use generic planning, state, validation, approval, and tool-call boundaries without assuming venue-specific or blockchain-specific modules.',
    modules: ['workflow_state', 'tool_planning', 'validation', 'approval_gate', 'risk_monitor'],
  },
  onchain_only: {
    id: 'onchain_only',
    title: 'Blockchain-only Workflow',
    description: 'Use protocol KG, RPC/indexer reads, on-chain adapters, deterministic solvers, and wallet/contract execution.',
    modules: ['protocol_kg', 'onchain_state', 'solver', 'wallet_execution', 'risk_monitor'],
  },
  hybrid_cex_onchain: {
    id: 'hybrid_cex_onchain',
    title: 'Hybrid Blockchain + CEX Workflow',
    description: 'Use both centralized venue tools and on-chain protocol tools, with explicit bridge/transfer/state boundaries.',
    modules: ['cex_market_data', 'cex_execution', 'protocol_kg', 'onchain_state', 'cross_venue_solver', 'risk_monitor'],
  },
  cex_only: {
    id: 'cex_only',
    title: 'CEX-only Workflow',
    description: 'Use connected centralized venue capabilities, market data, account state, order execution, and risk monitoring without on-chain KG modules.',
    modules: ['cex_market_data', 'cex_account_state', 'cex_execution', 'risk_monitor'],
  },
};

const STRATEGY_ALGORITHMS = {
  generic_agentic_workflow: {
    id: 'generic_agentic_workflow',
    title: 'Generic Agentic Workflow',
    objective: 'Turn any user objective into an explicit, validated, approval-gated Hershy workflow graph.',
    triggerRegexes: [],
    deterministicCore: [
      'Parse the user objective into goals, constraints, required inputs, and expected outputs.',
      'Select only the domain modules required by the request.',
      'Create an ordered workflow contract before creating runtime graph blocks.',
      'Represent unavailable tools as planned module boundaries instead of pretending results exist.',
      'Validate the generated Hershy graph before returning it.',
    ],
    kgQueries: ({ prompt, chainLabel }) => {
      const query = normalizeText(prompt).toLowerCase().includes(normalizeText(chainLabel).toLowerCase())
        ? normalizeText(prompt)
        : normalizeText(`${chainLabel || ''} ${prompt}`);
      return query ? [query] : [];
    },
    liveTools: [
      'read_workflow_context(inputSpec)',
      'call_allowed_tool(toolName, parameters)',
      'validate_workflow_output(outputSpec)',
      'request_user_approval(approvalSpec)',
    ],
    scoringModel: {
      name: 'workflow_readiness_v1',
      formula: 'ready = requiredInputsAvailable && validationPassed && userApproved && killSwitch == false',
      requiredMetrics: [
        'requiredInputsAvailable',
        'validationPassed',
        'userApproved',
        'killSwitch',
      ],
    },
    workflow: [],
    forbiddenShortcuts: [
      'Do not assume the request is a DEX, CEX, or blockchain strategy unless the prompt indicates that domain.',
      'Do not invent tool outputs, addresses, prices, balances, or external facts.',
      'Do not mark a workflow executable until validation and user approval are represented.',
    ],
  },
  dex_lp_pool_selection: {
    id: 'dex_lp_pool_selection',
    title: 'DEX LP Pool Selection',
    objective: 'Find and rank the best liquidity pools for a requested asset pair or asset group.',
    triggerRegexes: [
      /(liquidity|lp|pool|add\s+liquidity|provide\s+liquidity|유동성|풀|예치|공급|lp\s*하고|lp\s*넣)/i,
    ],
    deterministicCore: [
      'Build candidate DEX universe from KG by chain/category.',
      'Resolve user assets into asset groups and chain token addresses.',
      'Discover pools from verified factory contracts and PoolCreated/PairCreated events.',
      'Read live pool state through adapters, never from LLM guesses.',
      'Rank pools with a transparent scoring model and emit evidence.',
      'Generate deposit, stake, monitor, rebalance, and exit workflow only after pool ranking.',
    ],
    kgQueries: ({ chainLabel, assets }) => [
      `${chainLabel} DEX protocols factory router quoter gauge pool`,
      `${chainLabel} ${(assets || []).join(' ')} token addresses pools DEX`,
      `${chainLabel} Aerodrome Uniswap PancakeSwap pool factory fee gauge`,
      'proxy admin pause fee cap oracle DEX pool router factory',
    ],
    liveTools: [
      'discover_liquidity_markets(chain, assetGroups, constraints)',
      'read_market_state(candidateMarketIds)',
      'read_incentive_state(candidateMarketIds)',
      'quote_liquidity_allocation(marketId, amounts)',
      'simulate_allocation(candidate)',
    ],
    scoringModel: {
      name: 'lp_pool_score_v1',
      formula: 'score = feeApr*0.30 + rewardApr*0.20 + liquidityDepth*0.18 + volumeStability*0.12 - impermanentLossRisk*0.10 - adminRisk*0.05 - tokenRisk*0.03 - gasCost*0.02',
      requiredMetrics: [
        'feeApr',
        'rewardApr',
        'tvlUsd',
        'depthAtDepositSize',
        'volume24h',
        'spread',
        'poolAge',
        'gaugeAddress',
        'paused',
        'proxyAdminRisk',
        'oracleOrPriceDependency',
      ],
    },
    workflow: [
      { id: 'intent', title: 'Intent and Constraint Parsing', phase: 'intent', output: 'asset groups, chain, deposit size, risk profile' },
      { id: 'kg-universe', title: 'KG Candidate Universe', phase: 'retrieval', output: 'DEX protocols, factories, routers, quoters, gauges, token addresses' },
      { id: 'pool-discovery', title: 'Pool Discovery', phase: 'market-discovery', output: 'candidate pool list with pool type, fee tier, tokens, gauge' },
      { id: 'live-state', title: 'Live Pool State Reads', phase: 'market-state', output: 'reserves/liquidity/tick/price/volume/rewards/pause state' },
      { id: 'rank', title: 'Pool Ranking', phase: 'solver', output: 'ranked pools with score breakdown and rejected candidates' },
      { id: 'workflow', title: 'Executable LP Workflow', phase: 'strategy-generation', output: 'approval, deposit, optional gauge stake, monitor, rebalance, exit plan' },
    ],
    forbiddenShortcuts: [
      'Do not rank pools from protocol names alone.',
      'Do not treat TVL as sufficient for LP recommendation.',
      'Do not invent token or pool addresses.',
      'Do not recommend a pool without live state and pause/admin risk checks.',
    ],
  },
  dex_arbitrage_scan: {
    id: 'dex_arbitrage_scan',
    title: 'DEX Arbitrage Scan',
    objective: 'Search live pool graph for profitable swap cycles after fees, slippage, and gas.',
    triggerRegexes: [
      /(arbitrage|arb|차익|아비트라지|재정거래|price\s*gap|mispricing|spread)/i,
    ],
    deterministicCore: [
      'Build token-pool graph from KG-discovered DEX adapters and factory events.',
      'Read quotes/live reserves for candidate edges.',
      'Search bounded cycles or cross-DEX paths with max hops.',
      'Simulate exact input/output and gas before surfacing a candidate.',
      'Reject opportunities that do not clear profit buffer or stale-block checks.',
    ],
    kgQueries: ({ chainLabel, assets }) => [
      `${chainLabel} DEX router quoter factory pools swap`,
      `${chainLabel} ${(assets || []).join(' ')} arbitrage pools liquidity`,
      `${chainLabel} Uniswap Aerodrome PancakeSwap swap router quoter`,
      'flash loan provider router callback swap exact input output',
    ],
    liveTools: [
      'build_tradable_venue_graph(chain, tokenUniverse)',
      'quote_graph_edges(graph, amountIn)',
      'search_price_dislocation_paths(graph, maxHops)',
      'simulate_path(path)',
      'estimate_execution_cost(path)',
    ],
    scoringModel: {
      name: 'arb_opportunity_score_v1',
      formula: 'netProfit = quotedOut - inputAmount - gasCost - slippageBuffer - protocolFees; accept only netProfit > minProfitBuffer',
      requiredMetrics: [
        'blockNumber',
        'amountIn',
        'quotedOut',
        'gasCost',
        'poolFees',
        'priceImpact',
        'slippageBuffer',
        'netProfit',
        'routeAtomicity',
      ],
    },
    workflow: [
      { id: 'intent', title: 'Token Universe Parsing', phase: 'intent', output: 'chain, token set, max hops, min profit buffer' },
      { id: 'kg-universe', title: 'DEX Adapter Retrieval', phase: 'retrieval', output: 'routers, quoters, factories, pool contracts' },
      { id: 'market-graph', title: 'Live Market Graph', phase: 'market-state', output: 'token nodes and pool swap edges' },
      { id: 'cycle-search', title: 'Cycle and Path Search', phase: 'solver', output: 'candidate arbitrage paths' },
      { id: 'simulation', title: 'Simulation and Gas Filter', phase: 'verification', output: 'net-profit verified candidates' },
      { id: 'workflow', title: 'Execution and Kill Switch Plan', phase: 'strategy-generation', output: 'atomic execution, stale-block guard, revert rule' },
    ],
    forbiddenShortcuts: [
      'Do not claim arbitrage from stale price snapshots.',
      'Do not use LLM arithmetic for route profitability.',
      'Do not output executable arbitrage without simulation and gas filter.',
      'Do not search unbounded path depth.',
    ],
  },
  yield_allocator: {
    id: 'yield_allocator',
    title: 'Yield Allocator',
    objective: 'Rank vault, lending, staking, and gauge opportunities for requested assets.',
    triggerRegexes: [
      /(yield|apr|apy|farm|vault|stake|staking|lend|lending|수익률|이자|파밍|스테이킹|대출|예치)/i,
    ],
    deterministicCore: [
      'Retrieve yield-bearing protocols from KG.',
      'Resolve asset support and chain deployments.',
      'Read live APR, utilization, caps, pause state, withdrawal liquidity, and admin risk.',
      'Rank by risk-adjusted net yield and user constraints.',
    ],
    kgQueries: ({ chainLabel, assets }) => [
      `${chainLabel} ${(assets || []).join(' ')} yield vault lending staking gauge`,
      `${chainLabel} cap pause oracle admin owner vault lending`,
      `${chainLabel} Morpho Aave Moonwell Compound vault market`,
    ],
    liveTools: [
      'find_yield_markets(chain, assetGroups)',
      'read_market_state(marketIds)',
      'read_supply_caps_and_pause_state(marketIds)',
      'rank_yield_markets(markets, riskProfile)',
    ],
    scoringModel: {
      name: 'risk_adjusted_yield_v1',
      formula: 'score = netApr*0.35 + liquidityExitScore*0.20 + utilizationHealth*0.15 - smartContractRisk*0.12 - oracleRisk*0.08 - adminRisk*0.05 - gasCost*0.05',
      requiredMetrics: [
        'netApr',
        'rewardApr',
        'utilization',
        'supplyCapRemaining',
        'withdrawalLiquidity',
        'paused',
        'oracleAddress',
        'adminOrGuardian',
      ],
    },
    workflow: [
      { id: 'intent', title: 'Asset and Risk Parsing', phase: 'intent', output: 'asset groups, chain, risk/yield preference' },
      { id: 'kg-universe', title: 'Yield Market Retrieval', phase: 'retrieval', output: 'vaults, lending markets, gauges, staking contracts' },
      { id: 'live-state', title: 'Live Market Reads', phase: 'market-state', output: 'APR, caps, liquidity, pause/admin/oracle state' },
      { id: 'rank', title: 'Risk-Adjusted Ranking', phase: 'solver', output: 'ranked markets and excluded markets' },
      { id: 'workflow', title: 'Deposit and Monitoring Workflow', phase: 'strategy-generation', output: 'approve/deposit/claim/exit/rebalance plan' },
    ],
    forbiddenShortcuts: [
      'Do not compare APR without withdrawal liquidity and cap checks.',
      'Do not use reward APR without reward token risk.',
      'Do not recommend paused or capped markets.',
    ],
  },
  scheduled_dca: {
    id: 'scheduled_dca',
    title: 'Scheduled DCA Execution',
    objective: 'Convert a recurring buy/sell intent into a time-gated strategy workflow.',
    triggerRegexes: [
      /(dca|적립식|분할\s*매수|분할\s*매도)/i,
      /(?:daily|weekly|monthly|every\s+\d+|매일|매주|매월|정기).*(?:buy|sell|order|trade|btc|eth|sol|usdc|usdt|사줘|사고|팔|매수|매도|주문|거래)/i,
      /(?:buy|sell|order|trade|btc|eth|sol|usdc|usdt|사줘|사고|팔|매수|매도|주문|거래).*(?:daily|weekly|monthly|every\s+\d+|매일|매주|매월|정기)/i,
    ],
    deterministicCore: [
      'Parse cadence, asset, quote amount, venue, and max slippage.',
      'Represent cadence as a time trigger, not a formula node.',
      'Gate execution with balance/readiness checks.',
      'Execute only through connected venue capabilities.',
      'Monitor fills, cumulative spend, and kill-switch conditions.',
    ],
    kgQueries: () => [],
    liveTools: [
      'read_account_balance(venue, asset)',
      'read_market_price(venue, symbol)',
      'estimate_order_slippage(venue, symbol, amount)',
      'place_scheduled_order(orderPlan)',
    ],
    scoringModel: {
      name: 'dca_readiness_v1',
      formula: 'ready = balanceAvailable && cadenceDue && slippage <= maxSlippage && killSwitch == false',
      requiredMetrics: [
        'cadenceDue',
        'quoteBalance',
        'lastPrice',
        'estimatedSlippage',
        'maxSlippage',
        'orderStatus',
      ],
    },
    workflow: [
      { id: 'intent', title: 'Cadence and Asset Parsing', phase: 'intent', output: 'asset, quote amount, cadence, venue' },
      { id: 'init', title: 'Capital Readiness', phase: 'init', output: 'balance and connected venue readiness' },
      { id: 'time-trigger', title: 'Time Gate', phase: 'trigger', output: 'cadence due signal' },
      { id: 'execution', title: 'Scheduled Order', phase: 'execution', output: 'market/limit order and fill result' },
      { id: 'monitor', title: 'Fill and Risk Monitoring', phase: 'risk', output: 'cumulative spend, failed orders, kill switch' },
    ],
    forbiddenShortcuts: [
      'Do not model cadence as eventTime modulo formula.',
      'Do not execute without balance/readiness checks.',
      'Do not invent unsupported exchange actions.',
    ],
  },
  strategy_graph_generation: {
    id: 'strategy_graph_generation',
    title: 'Legacy Generic Strategy Graph Generation',
    objective: 'Generate a validated strategy graph when the request is not a DeFi market search problem.',
    triggerRegexes: [],
    deterministicCore: [
      'Parse the user objective.',
      'Build explicit data -> compute -> trigger -> action logic.',
      'Validate with semantic linter and runtime validator.',
    ],
    kgQueries: () => [],
    liveTools: [],
    scoringModel: {
      name: 'none',
      formula: '',
      requiredMetrics: [],
    },
    workflow: [
      { id: 'intent', title: 'Intent Parsing', phase: 'intent', output: 'strategy kind and required signals' },
      { id: 'logic-ir', title: 'Logic IR Planning', phase: 'logic', output: 'data, compute, predicate, action graph' },
      { id: 'runtime', title: 'Runtime Graph Generation', phase: 'strategy-generation', output: 'validated Hershy strategy graph' },
    ],
    forbiddenShortcuts: [
      'Do not connect raw feeds directly to actions when a computed signal is required.',
      'Do not omit init safety and kill-switch workflows.',
    ],
  },
};

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function detectChain(prompt, options = {}) {
  const explicit = normalizeText(options.chain);
  if (explicit) {
    return { chain: explicit, label: chainLabelFromSlug(explicit), source: 'options' };
  }
  for (const hint of CHAIN_HINTS) {
    if (hint.regex.test(prompt)) {
      return { chain: hint.chain, label: hint.label, source: 'prompt' };
    }
  }
  return { chain: DEFAULT_CHAIN, label: 'Base', source: 'default' };
}

function chainLabelFromSlug(slug) {
  const hit = CHAIN_HINTS.find((hint) => hint.chain === slug);
  if (hit) {
    return hit.label;
  }
  if (slug === 'base-mainnet') {
    return 'Base';
  }
  return slug;
}

function detectAssets(prompt, options = {}) {
  const optionAssets = Array.isArray(options.assets)
    ? options.assets.map(String)
    : [];
  const promptAssets = ASSET_GROUPS
    .filter((asset) => asset.regex.test(prompt))
    .map((asset) => asset.id);
  return uniqueStrings([...optionAssets, ...promptAssets]);
}

function detectRiskProfile(prompt, options = {}) {
  const explicit = normalizeText(options.riskProfile);
  if (explicit) {
    return explicit;
  }
  const hit = RISK_HINTS.find((item) => item.regex.test(prompt));
  return hit?.risk || 'moderate';
}

function detectDepositIntent(prompt) {
  const amount = prompt.match(/\b(\d+(?:\.\d+)?)\s*(eth|btc|usdc|usd|dai|weth|cbbtc|wbtc)\b/i);
  if (!amount) {
    return null;
  }
  return {
    amount: Number(amount[1]),
    asset: amount[2].toUpperCase(),
  };
}

function chooseAlgorithm(prompt) {
  const candidates = Object.values(STRATEGY_ALGORITHMS)
    .filter((algorithm) => algorithm.triggerRegexes?.length)
    .map((algorithm) => {
      const hits = algorithm.triggerRegexes.filter((regex) => regex.test(prompt)).length;
      return { algorithm, hits };
    })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (candidates[0]) {
    return {
      ...candidates[0].algorithm,
      confidence: Math.min(0.95, 0.65 + candidates[0].hits * 0.15),
      reason: 'Matched user request keywords.',
    };
  }

  return {
    ...STRATEGY_ALGORITHMS.generic_agentic_workflow,
    confidence: 0.45,
    reason: 'No specialized workflow matched; using generic agentic workflow generation.',
  };
}

function detectExecutionDomain(prompt, algorithm, options = {}) {
  const explicit = normalizeText(options.executionDomain || options.domain);
  if (EXECUTION_DOMAINS[explicit]) {
    return { ...EXECUTION_DOMAINS[explicit], source: 'options' };
  }

  const mentionsCEX = CEX_RE.test(prompt);
  const mentionsOnchain = ONCHAIN_RE.test(prompt);

  if (mentionsCEX && mentionsOnchain) {
    return { ...EXECUTION_DOMAINS.hybrid_cex_onchain, source: 'prompt' };
  }
  if (algorithm.id === 'generic_agentic_workflow' && !mentionsCEX && !mentionsOnchain) {
    return { ...EXECUTION_DOMAINS.general_automation, source: 'default' };
  }
  if (['dex_lp_pool_selection', 'dex_arbitrage_scan', 'yield_allocator'].includes(algorithm.id)) {
    return { ...EXECUTION_DOMAINS.onchain_only, source: 'algorithm' };
  }
  if (mentionsOnchain) {
    return { ...EXECUTION_DOMAINS.onchain_only, source: 'prompt' };
  }
  return { ...EXECUTION_DOMAINS.cex_only, source: 'default' };
}

function domainUsesModule(domain, moduleName) {
  return Array.isArray(domain?.modules) && domain.modules.includes(moduleName);
}

function buildResearchTasks(algorithm, context, executionDomain) {
  if (!domainUsesModule(executionDomain, 'protocol_kg')) {
    return [];
  }
  return (algorithm.kgQueries?.(context) || []).map((query, index) => ({
    kind: index === 0 ? 'protocol_kg_search' : 'protocol_kg_expansion',
    query,
    priority: index <= 1 ? 'high' : 'medium',
    useProtocolKG: true,
    expectedEvidence: [
      'entity hits',
      'current knowledge page URI',
      'chunk evidence',
      'deployment chain/address when available',
    ],
  }));
}

function buildToolContract(algorithm, executionDomain) {
  const kgTools = [
    'search_kg(query, filters)',
    'get_entity(entityId)',
    'get_neighbors(entityId, relationTypes, depth)',
    'get_evidence(evidenceId)',
  ];
  const centralizedVenueTools = [
    'read_venue_market_data(venue, symbol)',
    'read_venue_account_state(venue)',
    'place_venue_order(orderPlan)',
    'cancel_venue_order(orderId)',
  ];
  const onchainTools = [
    'read_rpc_state(chain, call)',
    'simulate_contract_call(chain, call)',
    'estimate_onchain_gas(chain, transaction)',
  ];
  const tools = [];
  if (domainUsesModule(executionDomain, 'protocol_kg')) {
    tools.push(...kgTools);
  }
  if (domainUsesModule(executionDomain, 'cex_market_data') || domainUsesModule(executionDomain, 'cex_execution')) {
    tools.push(...centralizedVenueTools);
  }
  if (domainUsesModule(executionDomain, 'onchain_state')) {
    tools.push(...onchainTools);
  }
  tools.push(...(algorithm.liveTools || []));
  return uniqueStrings(tools);
}

function buildOutputSpec(algorithm) {
  if (algorithm.id === 'dex_lp_pool_selection') {
    return {
      answerShape: [
        'rankedPools[] with protocol, poolAddress, token0, token1, fee, gauge, score',
        'scoreBreakdown per pool',
        'excludedCandidates[] with reason',
        'depositWorkflow with approval/addLiquidity/stake/monitor/rebalance/exit',
        'evidence[] with KG page URIs and block numbers',
      ],
      finalDecisionRule: 'Recommend only pools that pass live-state, pause, liquidity-depth, and risk checks.',
    };
  }
  if (algorithm.id === 'dex_arbitrage_scan') {
    return {
      answerShape: [
        'opportunities[] with route, amountIn, expectedOut, gasCost, netProfit, blockNumber',
        'simulationEvidence per route',
        'rejectedRoutes[] with reason',
        'executionWorkflow with stale-block guard and kill switch',
      ],
      finalDecisionRule: 'Surface only simulated opportunities with netProfit above minProfitBuffer.',
    };
  }
  if (algorithm.id === 'yield_allocator') {
    return {
      answerShape: [
        'rankedMarkets[] with protocol, marketAddress, asset, netApr, caps, liquidity, score',
        'riskBreakdown per market',
        'depositWorkflow with approval/deposit/claim/exit',
        'evidence[] with KG page URIs and block numbers',
      ],
      finalDecisionRule: 'Recommend only markets with available capacity, withdrawal liquidity, and acceptable admin/oracle risk.',
    };
  }
  if (algorithm.id === 'scheduled_dca') {
    return {
      answerShape: [
        'cadencePlan with asset, quoteAmount, venue, intervalMs',
        'readinessChecks with balance, slippage, connection, and kill-switch state',
        'runtimeGraph using a time trigger, execution action, fill monitor, and kill switch',
      ],
      finalDecisionRule: 'Execute only when cadence is due, capital is ready, slippage is acceptable, and kill switch is false.',
    };
  }
  return {
    answerShape: [
      'workflowContract with objective, phases, required inputs, expected outputs, and blocked assumptions',
      'intentPlan',
      'logicIR',
      'runtimeGraph as hershy-strategy-graph',
      'validationResult',
    ],
    finalDecisionRule: 'Generate only workflow graphs that represent evidence/tool boundaries, validation, user approval, and kill-switch behavior.',
  };
}

function includesAny(prompt, regexes) {
  return regexes.some((regex) => regex.test(prompt));
}

function buildGenericWorkflow(prompt, executionDomain) {
  const needsResearch = includesAny(prompt, [
    /(research|find|search|discover|compare|analy[sz]e|investigate|lookup)/i,
    /(조사|검색|찾|분석|비교|리서치|알아|발견)/i,
  ]);
  const needsMonitoring = includesAny(prompt, [
    /(monitor|watch|alert|notify|track|observe)/i,
    /(모니터|감시|알림|추적|관찰)/i,
  ]);
  const needsExecution = includesAny(prompt, [
    /(execute|run|send|place|create|update|deploy|rebalance|buy|sell|swap|trade|order)/i,
    /(실행|보내|생성|만들|수정|배포|리밸런싱|매수|매도|스왑|거래|주문)/i,
  ]);
  const phases = [
    {
      id: 'intent',
      title: 'Intent and Constraint Parsing',
      phase: 'intent',
      output: 'objective, constraints, allowed domains, required outputs',
    },
  ];

  if (needsResearch || domainUsesModule(executionDomain, 'protocol_kg')) {
    phases.push({
      id: 'context-retrieval',
      title: 'Context Retrieval',
      phase: 'retrieval',
      output: 'required evidence, user context, relevant entities, missing information',
    });
  }

  phases.push(
    {
      id: 'workflow-contract',
      title: 'Workflow Contract',
      phase: 'planning',
      output: 'ordered steps, required tools, blocked assumptions, expected artifacts',
    },
    {
      id: 'logic-ir',
      title: 'Logic IR',
      phase: 'logic',
      output: 'data, compute, trigger, action, monitoring, and safety nodes',
    },
  );

  if (needsMonitoring) {
    phases.push({
      id: 'monitoring-plan',
      title: 'Monitoring Plan',
      phase: 'monitoring',
      output: 'watch conditions, alert targets, escalation rules',
    });
  }

  if (needsExecution) {
    phases.push({
      id: 'execution-boundary',
      title: 'Execution Boundary',
      phase: 'execution',
      output: 'paper/live boundary, approval requirements, tool call parameters',
    });
  }

  phases.push(
    {
      id: 'validation',
      title: 'Validation and Safety',
      phase: 'verification',
      output: 'schema validation, missing tool report, kill-switch rule',
    },
    {
      id: 'runtime-graph',
      title: 'Hershy Runtime Graph',
      phase: 'strategy-generation',
      output: 'validated Hershy workflow graph with approval gate',
    },
  );

  return phases;
}

function buildWorkflowForAlgorithm(algorithm, prompt, executionDomain) {
  if (algorithm.id === 'generic_agentic_workflow') {
    return buildGenericWorkflow(prompt, executionDomain);
  }
  return Array.isArray(algorithm.workflow) ? algorithm.workflow : [];
}

function buildGuardrails(executionDomain) {
  const guardrails = [
    'The agent may propose hypotheses, but tool/evidence results decide factual claims and executable parameters.',
    'Do not assume venue-specific, protocol-specific, or chain-specific capabilities until the workflow capability plan requires them.',
    'Default to current knowledge pages and current chunks; historical pages are only for change analysis.',
    'If required tools are unavailable, return an incomplete-workflow report instead of pretending final execution is possible.',
  ];
  if (domainUsesModule(executionDomain, 'protocol_kg') || domainUsesModule(executionDomain, 'onchain_state')) {
    guardrails.push('Every contract address, pool, route, oracle, admin, or proxy claim must cite KG evidence or a live chain read when the on-chain module is enabled.');
  }
  return guardrails;
}

function capability(id, label, reason, requiredEvidence = []) {
  return { id, label, reason, requiredEvidence };
}

function buildCapabilityPlan(algorithm, executionDomain) {
  const capabilities = [
    capability(
      'prompt_interpretation',
      'Prompt interpretation',
      'Turn the user request into explicit goals, constraints, assumptions, and expected outputs.',
      ['user prompt'],
    ),
    capability(
      'web_strategy_discovery',
      'Web strategy discovery',
      'Search current external sources to discover implementation approaches, docs, APIs, and missing context.',
      ['web result URLs', 'source snippets'],
    ),
    capability(
      'workflow_validation',
      'Workflow validation',
      'Validate the generated Hershy graph before it can be presented as usable workflow output.',
      ['strategy validator output'],
    ),
    capability(
      'approval_gate',
      'Approval gate',
      'Keep generated workflows in planned/paper mode until the user approves moving toward execution.',
      ['manual approval state'],
    ),
  ];

  if (domainUsesModule(executionDomain, 'protocol_kg')) {
    capabilities.push(capability(
      'entity_evidence_retrieval',
      'Entity evidence retrieval',
      'Search the local KG for protocol, contract, API, and historical evidence relevant to the workflow.',
      ['current KG page URI', 'chunk evidence', 'revision URI'],
    ));
  }
  if (domainUsesModule(executionDomain, 'onchain_state')) {
    capabilities.push(
      capability(
        'chain_state_read',
        'Chain state read',
        'Read current or historical chain state through RPC/indexers only when the workflow needs it.',
        ['chain id', 'block number', 'call result'],
      ),
      capability(
        'contract_interaction_simulation',
        'Contract interaction simulation',
        'Simulate contract interactions before any execution-oriented workflow step.',
        ['call parameters', 'simulation result', 'revert data when any'],
      ),
    );
  }
  if (domainUsesModule(executionDomain, 'cex_market_data') || domainUsesModule(executionDomain, 'cex_execution')) {
    capabilities.push(
      capability(
        'centralized_venue_market_data',
        'Centralized venue market data',
        'Read market data from configured centralized venues when the workflow needs off-chain venue context.',
        ['venue id', 'symbol', 'timestamped market data'],
      ),
      capability(
        'centralized_venue_order_planning',
        'Centralized venue order planning',
        'Represent account/order actions as planned calls behind readiness, risk, and approval gates.',
        ['venue id', 'account readiness', 'paper/live boundary'],
      ),
    );
  }

  if (algorithm.id === 'dex_lp_pool_selection') {
    capabilities.push(
      capability(
        'liquidity_market_discovery',
        'Liquidity market discovery',
        'Discover venues/markets/pools that can satisfy the requested liquidity allocation without assuming a fixed venue type.',
        ['factory/event evidence or API source', 'market identifier'],
      ),
      capability(
        'liquidity_market_state_read',
        'Liquidity market state read',
        'Read depth, fee, incentive, cap, pause, and risk state for candidate liquidity markets.',
        ['state read result', 'timestamp or block number'],
      ),
      capability(
        'allocation_candidate_ranking',
        'Allocation candidate ranking',
        'Rank candidate markets from measured state, cost, risk, and constraints rather than names alone.',
        ['score inputs', 'rejected candidate reasons'],
      ),
    );
  } else if (algorithm.id === 'dex_arbitrage_scan') {
    capabilities.push(
      capability(
        'tradable_graph_discovery',
        'Tradable graph discovery',
        'Build a bounded graph of venues, markets, routes, and tokens for price-dislocation search.',
        ['venue/market evidence', 'token identifiers'],
      ),
      capability(
        'path_quote_and_simulation',
        'Path quote and simulation',
        'Quote and simulate candidate paths before surfacing any opportunity.',
        ['quote result', 'cost estimate', 'simulation result'],
      ),
      capability(
        'opportunity_filtering',
        'Opportunity filtering',
        'Reject stale, unprofitable, unbounded, or non-atomic paths before workflow generation.',
        ['net result breakdown', 'stale-state guard'],
      ),
    );
  } else if (algorithm.id === 'yield_allocator') {
    capabilities.push(
      capability(
        'yield_market_discovery',
        'Yield market discovery',
        'Find candidate yield markets without assuming the protocol category before evidence is gathered.',
        ['market evidence', 'asset support evidence'],
      ),
      capability(
        'risk_adjusted_market_ranking',
        'Risk-adjusted market ranking',
        'Rank markets from measured yield, liquidity, caps, admin/oracle risk, and exit constraints.',
        ['metric reads', 'risk breakdown'],
      ),
    );
  } else if (algorithm.id === 'scheduled_dca') {
    capabilities.push(
      capability(
        'schedule_trigger_planning',
        'Schedule trigger planning',
        'Represent recurring timing as an explicit trigger and readiness boundary.',
        ['cadence', 'next run condition'],
      ),
      capability(
        'venue_action_planning',
        'Venue action planning',
        'Plan buy/sell/order actions against whichever configured venue satisfies the workflow constraints.',
        ['venue capability', 'paper/live boundary'],
      ),
    );
  }

  return capabilities;
}

export function inferStrategyWorkflow(promptInput, options = {}) {
  const prompt = normalizeText(promptInput);
  const chain = detectChain(prompt, options);
  const assets = detectAssets(prompt, options);
  const riskProfile = detectRiskProfile(prompt, options);
  const depositIntent = detectDepositIntent(prompt);
  const algorithm = chooseAlgorithm(prompt);
  const executionDomain = detectExecutionDomain(prompt, algorithm, options);
  const effectiveChain = executionDomain.id === 'cex_only' && chain.source === 'default'
    ? { chain: '', label: '', source: 'not_applicable' }
    : executionDomain.id === 'general_automation' && chain.source === 'default'
    ? { chain: '', label: '', source: 'not_applicable' }
    : chain;
  const modules = uniqueStrings(executionDomain.modules || []);
  const context = {
    prompt,
    chain: effectiveChain.chain,
    chainLabel: effectiveChain.label,
    assets,
    riskProfile,
  };

  const researchTasks = buildResearchTasks(algorithm, context, executionDomain);
  const workflow = buildWorkflowForAlgorithm(algorithm, prompt, executionDomain);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    selectedAlgorithm: {
      id: algorithm.id,
      title: algorithm.title,
      confidence: algorithm.confidence,
      reason: algorithm.reason,
    },
    executionDomain: {
      id: executionDomain.id,
      title: executionDomain.title,
      source: executionDomain.source,
      description: executionDomain.description,
      modules,
      kgModuleEnabled: modules.includes('protocol_kg'),
    },
    intent: {
      userPrompt: prompt,
      chain: effectiveChain.chain,
      chainLabel: effectiveChain.label,
      chainSource: effectiveChain.source,
      assetGroups: assets,
      riskProfile,
      depositIntent,
    },
    algorithmContract: {
      objective: algorithm.objective,
      deterministicCore: algorithm.deterministicCore,
      agentResponsibilities: [
        'Translate user objective into constraints.',
        'Call only the modules enabled by executionDomain.',
        'Call venue-specific, protocol-specific, or chain-specific tools only when the capability plan requires them.',
        'Call live-state or external tools only in the declared workflow order.',
        'Use deterministic tool outputs for factual claims, rankings, profitability, and safety checks.',
        'Generate a Hershy workflow/strategy graph from the workflow contract, with missing tools represented explicitly.',
      ],
      forbiddenShortcuts: algorithm.forbiddenShortcuts,
    },
    researchTasks,
    toolContract: buildToolContract(algorithm, executionDomain),
    capabilityPlan: buildCapabilityPlan(algorithm, executionDomain),
    workflow,
    scoringModel: algorithm.scoringModel,
    outputSpec: buildOutputSpec(algorithm),
    guardrails: buildGuardrails(executionDomain),
  };
}

export function buildStrategyWorkflowPromptSection(workflowPlan) {
  if (!workflowPlan || typeof workflowPlan !== 'object') {
    return '';
  }
  return [
    'Algorithmic strategy workflow contract:',
    JSON.stringify(workflowPlan, null, 2),
    '',
    'Hard rule: follow the selectedAlgorithm workflow. Do not improvise factual claims, rankings, profits, addresses, balances, or executable parameters without KG/live-tool evidence.',
  ].join('\n');
}

export { STRATEGY_ALGORITHMS };
