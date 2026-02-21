import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONT_PORT = resolvePort(process.env.FRONT_PORT || process.env.PORT, 9090);
const HOST_API_BASE = normalizeBaseURL(process.env.HOST_API_BASE || 'http://localhost:9000');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const EXPLORER_API_ENDPOINTS = {
  'eth-mainnet': 'https://api.etherscan.io/api',
  'base-mainnet': 'https://api.basescan.org/api',
  'arb-mainnet': 'https://api.arbiscan.io/api',
  'opt-mainnet': 'https://api-optimistic.etherscan.io/api',
  'polygon-mainnet': 'https://api.polygonscan.com/api',
  'bsc-mainnet': 'https://api.bscscan.com/api',
};

const EXPLORER_CHAIN_IDS = {
  'eth-mainnet': 1,
  'base-mainnet': 8453,
  'arb-mainnet': 42161,
  'opt-mainnet': 10,
  'polygon-mainnet': 137,
  'bsc-mainnet': 56,
};

const ETHERSCAN_V2_ENDPOINT = 'https://api.etherscan.io/v2/api';

app.get('/api/config', (_req, res) => {
  res.json({
    host_api_base: HOST_API_BASE,
    front_port: FRONT_PORT,
  });
});

app.post('/api/ai/research', express.json({ limit: '2mb' }), async (req, res) => {
  const prompt = normalizeText(req.body?.prompt);
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  const currentStrategy = resolveCurrentStrategy(req.body?.current_strategy);
  const orchestrationPlan = normalizeObject(req.body?.orchestration_plan);
  const authContext = mergeExplorerKeyIntoAuthContext(
    req.body?.auth_context,
    req.body?.explorer_api_key
  );
  try {
    const researched = await runResearchLayer({
      prompt,
      currentStrategy,
      orchestrationPlan,
      authContext
    });
    res.json({
      research: researched.research,
      source: researched.source,
      provider: researched.provider,
      model: researched.model,
      message: 'AI research bundle generated'
    });
  } catch (error) {
    sendAIFailure(res, error, 'ai research failed');
  }
});

app.post('/api/ai/strategy-compose', express.json({ limit: '2mb' }), async (req, res) => {
  const prompt = normalizeText(req.body?.prompt);
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  const currentStrategy = resolveCurrentStrategy(req.body?.current_strategy);
  const researchBundle = normalizeObject(req.body?.research_bundle);
  try {
    const composed = await runStrategyLayer({
      prompt,
      currentStrategy,
      researchBundle
    });
    res.json({
      strategy: composed.strategy,
      source: composed.source,
      provider: composed.provider,
      model: composed.model,
      message: 'AI strategy composed from research bundle'
    });
  } catch (error) {
    sendAIFailure(res, error, 'ai strategy compose failed');
  }
});

app.post('/api/ai/orchestrate-strategy', express.json({ limit: '2mb' }), async (req, res) => {
  const prompt = normalizeText(req.body?.prompt);
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  const currentStrategy = resolveCurrentStrategy(req.body?.current_strategy);
  const authContext = mergeExplorerKeyIntoAuthContext(
    req.body?.auth_context,
    req.body?.explorer_api_key
  );
  try {
    const result = await runOrchestrationPipeline({
      prompt,
      currentStrategy,
      authContext
    });
    res.json({
      strategy: result.strategy,
      research: result.research,
      orchestration: result.orchestration,
      source: result.source,
      providers: result.providers,
      models: result.models,
      message: 'Orchestrated AI strategy draft generated'
    });
  } catch (error) {
    sendAIFailure(res, error, 'ai orchestration failed');
  }
});

app.post('/api/ai/strategy-draft', express.json({ limit: '2mb' }), async (req, res) => {
  const prompt = normalizeText(req.body?.prompt);
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  const currentStrategy = resolveCurrentStrategy(req.body?.current_strategy);
  const authContext = mergeExplorerKeyIntoAuthContext(
    req.body?.auth_context,
    req.body?.explorer_api_key
  );
  try {
    const result = await runOrchestrationPipeline({
      prompt,
      currentStrategy,
      authContext
    });
    res.json({
      strategy: result.strategy,
      research: result.research,
      orchestration: result.orchestration,
      source: result.source,
      model: result.models?.strategy || result.models?.orchestrator || '',
      providers: result.providers,
      models: result.models,
      message: 'AI strategy draft generated (orchestrated)'
    });
  } catch (error) {
    sendAIFailure(res, error, 'ai generation failed');
  }
});

app.post('/api/evm/abi', express.json({ limit: '256kb' }), async (req, res) => {
  const chain = normalizeText(req.body?.chain).toLowerCase();
  const address = normalizeText(req.body?.address);
  const explorerAPIKey = normalizeText(req.body?.explorer_api_key)
    || resolveExplorerAPIKeyFromAuthContext(req.body?.auth_context);
  if (!chain) {
    sendError(res, 400, 'chain is required');
    return;
  }
  if (!isValidEVMAddress(address)) {
    sendError(res, 400, 'address must be a valid EVM address');
    return;
  }

  const endpoint = EXPLORER_API_ENDPOINTS[chain];
  if (!endpoint) {
    sendError(res, 400, `unsupported chain: ${chain}`);
    return;
  }

  try {
    const lookup = await fetchExplorerABI(chain, endpoint, address, explorerAPIKey);
    res.json(lookup);
  } catch (error) {
    sendError(res, 502, `abi lookup failed: ${error?.message || 'unknown error'}`);
  }
});

app.use('/api/host', express.raw({ type: '*/*', limit: '32mb' }), async (req, res) => {
  const targetURL = `${HOST_API_BASE}${req.url}`;
  try {
    const headers = buildForwardHeaders(req.headers);
    const method = req.method.toUpperCase();
    const response = await fetch(targetURL, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD'
        ? undefined
        : (req.body && req.body.length > 0 ? req.body : undefined),
      redirect: 'manual',
    });

    for (const [key, value] of response.headers.entries()) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        continue;
      }
      res.setHeader(key, value);
    }

    res.status(response.status);
    const payload = Buffer.from(await response.arrayBuffer());
    res.send(payload);
  } catch (error) {
    sendError(res, 502, `host proxy request failed: ${error?.message || targetURL}`);
  }
});

let vite;
if (!IS_PRODUCTION) {
  const { createServer } = await import('vite');
  vite = await createServer({
    root: __dirname,
    appType: 'spa',
    server: {
      middlewareMode: true,
    },
  });
  app.use(vite.middlewares);
} else {
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir, { index: false }));
}

app.use('/api', (_req, res) => {
  sendError(res, 404, 'api route not found');
});

app.use('*', async (req, res, next) => {
  try {
    const indexPath = IS_PRODUCTION
      ? path.resolve(__dirname, 'dist/index.html')
      : path.resolve(__dirname, 'index.html');

    let html = await fs.readFile(indexPath, 'utf8');
    if (!IS_PRODUCTION && vite) {
      html = await vite.transformIndexHtml(req.originalUrl, html);
    }

    res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  sendError(res, 500, error?.message || 'internal server error');
});

app.listen(FRONT_PORT, () => {
  console.log(`[front] standalone server listening on http://localhost:${FRONT_PORT}`);
  console.log(`[front] host proxy target: ${HOST_API_BASE}`);
  console.log(`[front] mode: ${IS_PRODUCTION ? 'production' : 'development'}`);
});

class UpstreamHTTPError extends Error {
  constructor(provider, status, body) {
    super(`${provider} status=${status} body=${trimForLog(body, 800)}`);
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

function resolvePort(raw, fallback) {
  const parsed = Number.parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseURL(raw) {
  const value = String(raw || '').trim();
  return value.replace(/\/+$/, '') || 'http://localhost:9000';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sendError(res, code, message) {
  res.status(code).json({
    error: statusText(code),
    code,
    message,
  });
}

function statusText(code) {
  const table = {
    400: 'Bad Request',
    401: 'Unauthorized',
    404: 'Not Found',
    405: 'Method Not Allowed',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
  };
  return table[code] || 'Error';
}

function buildForwardHeaders(rawHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }
    if (Array.isArray(value)) {
      headers[key] = value.join(', ');
      continue;
    }
    if (typeof value === 'string') {
      headers[key] = value;
    }
  }
  return headers;
}

function normalizeAIProviderAlias(rawProvider) {
  const provider = normalizeText(rawProvider).toLowerCase();
  if (!provider) {
    return '';
  }
  if (provider === 'ollama' || provider === 'local' || provider === 'oss') {
    return 'ollama';
  }
  if (provider === 'google' || provider === 'gemini' || provider === 'gemini-api') {
    return 'gemini';
  }
  if (provider === 'openai') {
    return 'openai';
  }
  return provider;
}

function resolveAIProvider() {
  const explicit = normalizeAIProviderAlias(process.env.AI_PROVIDER);
  if (explicit) {
    return explicit;
  }
  if (normalizeText(process.env.OLLAMA_BASE_URL) || normalizeText(process.env.OLLAMA_MODEL)) {
    return 'ollama';
  }
  if (normalizeText(process.env.GOOGLE_API_KEY) || normalizeText(process.env.GEMINI_API_KEY)) {
    return 'gemini';
  }
  if (normalizeText(process.env.OPENAI_API_KEY)) {
    return 'openai';
  }
  return 'ollama';
}

function layerEnv(layer, key) {
  if (!layer || !key) {
    return '';
  }
  return normalizeText(process.env[`AI_${String(layer).toUpperCase()}_${key}`]);
}

function resolveLayerProvider(layer) {
  return normalizeAIProviderAlias(layerEnv(layer, 'PROVIDER')) || resolveAIProvider();
}

function resolveTimeoutSeconds(envKey, fallbackSeconds) {
  const raw = normalizeText(process.env[envKey]);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

function resolveLayerTimeoutSeconds(layer, providerTimeoutEnvKey, fallbackSeconds) {
  const direct = Number.parseInt(layerEnv(layer, providerTimeoutEnvKey), 10);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const generic = Number.parseInt(layerEnv(layer, 'TIMEOUT_SEC'), 10);
  if (Number.isFinite(generic) && generic > 0) {
    return generic;
  }
  return resolveTimeoutSeconds(providerTimeoutEnvKey, fallbackSeconds);
}

function resolveGeminiAPIKey(layer = '') {
  return (
    layerEnv(layer, 'GOOGLE_API_KEY')
    || layerEnv(layer, 'GEMINI_API_KEY')
    || normalizeText(process.env.GOOGLE_API_KEY)
    || normalizeText(process.env.GEMINI_API_KEY)
  );
}

function resolveOpenAIAPIKey(layer = '') {
  return layerEnv(layer, 'OPENAI_API_KEY') || normalizeText(process.env.OPENAI_API_KEY);
}

function resolveOllamaAPIKey(layer = '') {
  return layerEnv(layer, 'OLLAMA_API_KEY') || normalizeText(process.env.OLLAMA_API_KEY);
}

function resolveCurrentStrategy(raw) {
  return raw && typeof raw === 'object' ? raw : null;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function mergeExplorerKeyIntoAuthContext(rawAuthContext, rawExplorerAPIKey) {
  const base = normalizeObject(rawAuthContext) || {};
  const explorerApiKey = normalizeText(rawExplorerAPIKey);
  if (!explorerApiKey) {
    return base;
  }
  const evm = normalizeObject(base.evm) || {};
  return {
    ...base,
    evm: {
      ...evm,
      explorerApiKey
    }
  };
}

function sendAIFailure(res, error, prefix) {
  if (error instanceof UpstreamHTTPError) {
    let status = 502;
    if (error.status === 429) {
      status = 429;
    } else if (error.status === 401 || error.status === 403) {
      status = 401;
    } else if (error.status === 400) {
      status = 400;
    }
    sendError(res, status, `${prefix}: ${error.message}`);
    return;
  }
  sendError(res, 502, `${prefix}: ${error?.message || 'unknown error'}`);
}

function resolveExplorerAPIKeyFromAuthContext(authContext) {
  const context = normalizeObject(authContext);
  if (!context) {
    return '';
  }
  const evm = normalizeObject(context.evm);
  return (
    normalizeText(context.explorerApiKey)
    || normalizeText(context.explorer_api_key)
    || normalizeText(evm?.explorerApiKey)
    || normalizeText(evm?.explorer_api_key)
  );
}

function resolveExplorerAPIKey(chain, requestExplorerAPIKey = '') {
  const chainKey = chain.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return (
    normalizeText(requestExplorerAPIKey)
    || normalizeText(process.env[`${chainKey}_EXPLORER_API_KEY`])
    || normalizeText(process.env.EXPLORER_API_KEY)
    || normalizeText(process.env.ETHERSCAN_API_KEY)
  );
}

function isValidEVMAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(normalizeText(value));
}

const EXPLORER_WEB_BASE_URLS = {
  'eth-mainnet': 'https://etherscan.io/address',
  'base-mainnet': 'https://basescan.org/address',
  'arb-mainnet': 'https://arbiscan.io/address',
  'opt-mainnet': 'https://optimistic.etherscan.io/address',
  'polygon-mainnet': 'https://polygonscan.com/address',
  'bsc-mainnet': 'https://bscscan.com/address',
};

const CHAIN_ALIASES = {
  ethereum: 'eth-mainnet',
  eth: 'eth-mainnet',
  mainnet: 'eth-mainnet',
  'eth-mainnet': 'eth-mainnet',
  base: 'base-mainnet',
  'base-mainnet': 'base-mainnet',
  arbitrum: 'arb-mainnet',
  arb: 'arb-mainnet',
  'arb-mainnet': 'arb-mainnet',
  optimism: 'opt-mainnet',
  opt: 'opt-mainnet',
  'opt-mainnet': 'opt-mainnet',
  polygon: 'polygon-mainnet',
  matic: 'polygon-mainnet',
  'polygon-mainnet': 'polygon-mainnet',
  bsc: 'bsc-mainnet',
  bnb: 'bsc-mainnet',
  'bsc-mainnet': 'bsc-mainnet',
};

function normalizeChainSlug(raw) {
  const text = normalizeText(raw).toLowerCase().replace(/_/g, '-');
  if (!text) {
    return '';
  }
  if (EXPLORER_API_ENDPOINTS[text]) {
    return text;
  }
  return CHAIN_ALIASES[text] || '';
}

function buildExplorerAddressURL(chain, address) {
  const base = EXPLORER_WEB_BASE_URLS[chain];
  if (!base) {
    return '';
  }
  return `${base}/${address}`;
}

function normalizeStringArray(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeURLItems(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const normalized = list.map((item) => {
    if (typeof item === 'string') {
      const url = normalizeText(item);
      return url ? { url, title: '', note: '' } : null;
    }
    if (!item || typeof item !== 'object') {
      return null;
    }
    const url = normalizeText(item.url || item.href || item.link);
    if (!url) {
      return null;
    }
    return {
      url,
      title: normalizeText(item.title),
      note: normalizeText(item.note || item.reason),
    };
  }).filter(Boolean);

  const seen = new Set();
  return normalized.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

function normalizeContractHints(rawContracts, fallbackChain = 'eth-mainnet') {
  const list = Array.isArray(rawContracts) ? rawContracts : [];
  const normalized = list.map((item) => {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const address = normalizeText(item.address || item.contractAddress);
    if (!isValidEVMAddress(address)) {
      return null;
    }
    const chain = normalizeChainSlug(item.chain || item.network || fallbackChain) || fallbackChain;
    if (!EXPLORER_API_ENDPOINTS[chain]) {
      return null;
    }
    return {
      chain,
      address,
      label: normalizeText(item.label || item.name),
      reason: normalizeText(item.reason || item.note),
    };
  }).filter(Boolean);

  const seen = new Set();
  return normalized.filter((item) => {
    const key = `${item.chain}:${item.address.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractEVMAddresses(text) {
  return Array.from(new Set(
    String(text || '').match(/0x[a-fA-F0-9]{40}/g) || []
  ));
}

function detectChainHints(text) {
  const lower = String(text || '').toLowerCase();
  const hints = [];
  if (/\b(base)\b/.test(lower)) {
    hints.push('base-mainnet');
  }
  if (/\b(arbitrum|arb)\b/.test(lower)) {
    hints.push('arb-mainnet');
  }
  if (/\b(optimism|opt)\b/.test(lower)) {
    hints.push('opt-mainnet');
  }
  if (/\b(polygon|matic)\b/.test(lower)) {
    hints.push('polygon-mainnet');
  }
  if (/\b(bsc|bnb)\b/.test(lower)) {
    hints.push('bsc-mainnet');
  }
  if (/\b(ethereum|eth|mainnet)\b/.test(lower)) {
    hints.push('eth-mainnet');
  }
  if (hints.length === 0) {
    hints.push('eth-mainnet');
  }
  return Array.from(new Set(hints));
}

function buildDefaultOrchestrationPlan(prompt) {
  return {
    mode: 'research_then_strategy',
    needResearch: true,
    researchTasks: [
      {
        kind: 'contract_discovery',
        query: normalizeText(prompt),
        priority: 'high'
      }
    ],
    strategyTasks: [
      'Use verified contracts when available',
      'Do not fabricate addresses or URLs',
      'Return valid hershy-strategy-graph JSON'
    ],
    contractHints: [],
    notes: []
  };
}

function normalizeOrchestrationPlan(rawPlan, prompt) {
  const fallback = buildDefaultOrchestrationPlan(prompt);
  const plan = normalizeObject(rawPlan);
  if (!plan) {
    return fallback;
  }

  const needResearchRaw = plan.needResearch;
  let needResearch = true;
  if (typeof needResearchRaw === 'boolean') {
    needResearch = needResearchRaw;
  } else if (typeof needResearchRaw === 'string') {
    needResearch = ['1', 'true', 'yes', 'y'].includes(needResearchRaw.trim().toLowerCase());
  }

  const researchTasks = Array.isArray(plan.researchTasks)
    ? plan.researchTasks
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const query = normalizeText(item.query || item.task);
        if (!query) {
          return null;
        }
        return {
          kind: normalizeText(item.kind) || 'general',
          query,
          priority: normalizeText(item.priority) || 'medium'
        };
      })
      .filter(Boolean)
    : [];

  const contractHints = normalizeContractHints(
    plan.contractHints || plan.contracts || plan.contract_candidates,
    detectChainHints(prompt)[0]
  );

  return {
    mode: normalizeText(plan.mode) || fallback.mode,
    needResearch,
    researchTasks: researchTasks.length > 0 ? researchTasks : fallback.researchTasks,
    strategyTasks: normalizeStringArray(plan.strategyTasks || plan.strategyDirectives || plan.directives),
    contractHints,
    notes: normalizeStringArray(plan.notes || plan.assumptions),
  };
}

function buildFallbackResearchBundle({ prompt, orchestrationPlan }) {
  const now = new Date().toISOString();
  const chainHints = detectChainHints(prompt);
  const rawAddresses = extractEVMAddresses(prompt);
  const inferredContracts = rawAddresses.map((address, index) => ({
    chain: chainHints[index] || chainHints[0] || 'eth-mainnet',
    address,
    label: '',
    reason: 'Detected from user prompt',
  }));

  const orchestratorHints = normalizeContractHints(
    orchestrationPlan?.contractHints || [],
    chainHints[0] || 'eth-mainnet'
  );
  const contracts = normalizeContractHints(
    [...inferredContracts, ...orchestratorHints],
    chainHints[0] || 'eth-mainnet'
  );

  return {
    generatedAt: now,
    prompt: normalizeText(prompt),
    goals: normalizeStringArray(orchestrationPlan?.strategyTasks),
    findings: [],
    urls: [],
    contracts,
    warnings: []
  };
}

function normalizeResearchBundle(rawBundle, context) {
  const bundle = normalizeObject(rawBundle) || {};
  const fallbackChain = detectChainHints(context?.prompt || '')[0] || 'eth-mainnet';
  return {
    generatedAt: new Date().toISOString(),
    prompt: normalizeText(context?.prompt),
    goals: normalizeStringArray(bundle.goals || bundle.researchGoals || bundle.objectives),
    findings: normalizeStringArray(bundle.findings || bundle.insights || bundle.notes),
    urls: normalizeURLItems(bundle.urls || bundle.sources || bundle.references),
    contracts: normalizeContractHints(bundle.contracts || bundle.contractCandidates, fallbackChain),
    warnings: normalizeStringArray(bundle.warnings || []),
  };
}

function mergeResearchBundles(baseBundle, aiBundle) {
  if (!aiBundle) {
    return baseBundle;
  }
  const mergedContracts = normalizeContractHints(
    [...(baseBundle.contracts || []), ...(aiBundle.contracts || [])],
    'eth-mainnet'
  );
  const mergedUrls = normalizeURLItems([
    ...(baseBundle.urls || []),
    ...(aiBundle.urls || []),
  ]);
  const mergedFindings = Array.from(new Set([
    ...(baseBundle.findings || []),
    ...(aiBundle.findings || []),
  ]));
  const mergedGoals = Array.from(new Set([
    ...(baseBundle.goals || []),
    ...(aiBundle.goals || []),
  ]));

  return {
    ...baseBundle,
    ...aiBundle,
    goals: mergedGoals,
    findings: mergedFindings,
    urls: mergedUrls,
    contracts: mergedContracts,
    warnings: Array.from(new Set([
      ...(baseBundle.warnings || []),
      ...(aiBundle.warnings || []),
    ])),
    generatedAt: new Date().toISOString(),
  };
}

async function enrichResearchBundleContracts(bundle, options = {}) {
  const requestExplorerAPIKey = normalizeText(options?.explorerAPIKey);
  const contracts = Array.isArray(bundle?.contracts) ? bundle.contracts : [];
  if (contracts.length === 0) {
    return bundle;
  }

  const enriched = [];
  const urls = [...(bundle.urls || [])];
  const maxContracts = Math.min(contracts.length, 4);
  for (let i = 0; i < maxContracts; i += 1) {
    const item = contracts[i];
    const chain = normalizeChainSlug(item.chain);
    const address = normalizeText(item.address);
    if (!chain || !isValidEVMAddress(address)) {
      enriched.push({
        ...item,
        verified: false,
        verificationError: 'invalid chain/address',
      });
      continue;
    }

    const endpoint = EXPLORER_API_ENDPOINTS[chain];
    if (!endpoint) {
      enriched.push({
        ...item,
        verified: false,
        verificationError: 'unsupported chain',
      });
      continue;
    }

    try {
      const lookup = await fetchExplorerABI(chain, endpoint, address, requestExplorerAPIKey);
      const explorerURL = buildExplorerAddressURL(chain, address);
      if (explorerURL) {
        urls.push({
          url: explorerURL,
          title: `${chain} verified contract`,
          note: address
        });
      }
      enriched.push({
        ...item,
        chain,
        address,
        verified: true,
        explorer: endpoint,
        totalFunctions: lookup.total_functions,
        functions: (lookup.functions || []).slice(0, 60).map((fn) => ({
          name: fn.name,
          signature: fn.signature,
          stateMutability: fn.stateMutability,
        })),
      });
    } catch (error) {
      enriched.push({
        ...item,
        chain,
        address,
        verified: false,
        verificationError: error?.message || 'lookup failed',
      });
    }
  }

  const untouched = contracts.slice(maxContracts);
  return {
    ...bundle,
    contracts: [...enriched, ...untouched],
    urls: normalizeURLItems(urls),
    generatedAt: new Date().toISOString(),
  };
}

function summarizeResearchBundle(research) {
  const verifiedContracts = (research.contracts || []).filter((item) => item.verified).length;
  return {
    goals: (research.goals || []).length,
    findings: (research.findings || []).length,
    urls: (research.urls || []).length,
    contracts: (research.contracts || []).length,
    verifiedContracts,
  };
}

function buildExplorerQuery(chain, address, requestExplorerAPIKey = '') {
  const params = new URLSearchParams({
    module: 'contract',
    action: 'getabi',
    address,
  });
  const apiKey = resolveExplorerAPIKey(chain, requestExplorerAPIKey);
  if (apiKey) {
    params.set('apikey', apiKey);
  }
  return params;
}

function simplifyABIItem(entry) {
  if (!entry || entry.type !== 'function') {
    return null;
  }
  const name = normalizeText(entry.name);
  if (!name) {
    return null;
  }

  const stateMutability = normalizeText(entry.stateMutability) || 'nonpayable';
  const inputs = Array.isArray(entry.inputs)
    ? entry.inputs.map((input, index) => ({
      name: normalizeText(input?.name) || `arg${index + 1}`,
      type: normalizeText(input?.type) || 'bytes',
      internalType: normalizeText(input?.internalType),
    }))
    : [];
  const outputs = Array.isArray(entry.outputs)
    ? entry.outputs.map((output, index) => ({
      name: normalizeText(output?.name) || `out${index + 1}`,
      type: normalizeText(output?.type) || 'bytes',
      internalType: normalizeText(output?.internalType),
    }))
    : [];

  const signature = `${name}(${inputs.map((input) => input.type).join(',')})`;
  return {
    name,
    stateMutability,
    inputs,
    outputs,
    signature,
  };
}

async function fetchExplorerABI(chain, endpoint, address, requestExplorerAPIKey = '') {
  const query = buildExplorerQuery(chain, address, requestExplorerAPIKey);
  const response = await fetch(`${endpoint}?${query.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`explorer status=${response.status} body=${trimForLog(text, 400)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`invalid explorer response: ${trimForLog(text, 200)}`);
  }

  const rawABI = payload?.result;
  if (!rawABI || typeof rawABI !== 'string') {
    throw new Error(`invalid explorer payload: ${trimForLog(text, 200)}`);
  }
  if (isExplorerV1Deprecated(rawABI)) {
    return fetchExplorerABIV2(chain, address, requestExplorerAPIKey);
  }
  if (String(payload?.status || '') === '0' && !rawABI.trim().startsWith('[')) {
    throw new Error(rawABI || payload?.message || 'explorer returned status=0');
  }
  if (rawABI.startsWith('Contract source code not verified')) {
    throw new Error('contract is not verified on explorer');
  }

  let abi;
  try {
    abi = JSON.parse(rawABI);
  } catch {
    throw new Error(`abi parse failed: ${trimForLog(rawABI, 200)}`);
  }
  if (!Array.isArray(abi)) {
    throw new Error('abi payload is not an array');
  }

  const functions = abi
    .map(simplifyABIItem)
    .filter(Boolean);
  if (functions.length === 0) {
    throw new Error('no callable functions found in ABI');
  }

  return {
    chain,
    address,
    abi,
    functions,
    total_functions: functions.length,
    explorer: endpoint,
  };
}

function isExplorerV1Deprecated(message) {
  const text = normalizeText(message).toLowerCase();
  return text.includes('deprecated v1 endpoint') || text.includes('v2-migration');
}

async function fetchExplorerABIV2(chain, address, requestExplorerAPIKey = '') {
  const chainID = EXPLORER_CHAIN_IDS[chain];
  if (!chainID) {
    throw new Error(`unsupported chain for explorer v2: ${chain}`);
  }
  const params = new URLSearchParams({
    chainid: String(chainID),
    module: 'contract',
    action: 'getabi',
    address,
  });
  const apiKey = resolveExplorerAPIKey(chain, requestExplorerAPIKey);
  if (apiKey) {
    params.set('apikey', apiKey);
  }

  const response = await fetch(`${ETHERSCAN_V2_ENDPOINT}?${params.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`explorer v2 status=${response.status} body=${trimForLog(text, 400)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`invalid explorer v2 response: ${trimForLog(text, 200)}`);
  }

  const rawABI = payload?.result;
  if (!rawABI || typeof rawABI !== 'string') {
    throw new Error(`invalid explorer v2 payload: ${trimForLog(text, 200)}`);
  }
  if (String(payload?.status || '') === '0' && !rawABI.trim().startsWith('[')) {
    throw new Error(rawABI || payload?.message || 'explorer v2 returned status=0');
  }
  if (rawABI.startsWith('Contract source code not verified')) {
    throw new Error('contract is not verified on explorer');
  }

  let abi;
  try {
    abi = JSON.parse(rawABI);
  } catch {
    throw new Error(`abi parse failed: ${trimForLog(rawABI, 200)}`);
  }
  if (!Array.isArray(abi)) {
    throw new Error('abi payload is not an array');
  }

  const functions = abi
    .map(simplifyABIItem)
    .filter(Boolean);
  if (functions.length === 0) {
    throw new Error('no callable functions found in ABI');
  }

  return {
    chain,
    address,
    abi,
    functions,
    total_functions: functions.length,
    explorer: `${ETHERSCAN_V2_ENDPOINT}?chainid=${chainID}`,
  };
}

function buildAIStrategySystemPrompt() {
  return String.raw`
You generate strategy JSON for Hershy runner.
Return only valid JSON (no markdown).

Required top-level object:
{
  "schemaVersion": 1,
  "kind": "hershy-strategy-graph",
  "strategy": {"id": "string", "name": "string"},
  "generatedAt": "ISO8601",
  "summary": {"blocks": number, "connections": number, "byType": {"streaming": number, "normal": number, "trigger": number, "action": number, "monitoring": number}},
  "blocks": [...],
  "connections": [...]
}

Validation constraints:
- at least 1 streaming block
- at least 1 trigger block
- at least 1 action block
- each action should have at least one incoming trigger-action connection
- include position {x,y} for each block
`.trim();
}

function buildAIStrategyUserPrompt(prompt, currentStrategy, researchBundle, orchestrationPlan) {
  let text = `User request:\n${normalizeText(prompt)}`;
  if (currentStrategy && typeof currentStrategy === 'object') {
    text += `\n\nCurrent strategy JSON (optional context):\n${trimForLog(stringifyJSON(currentStrategy), 12000)}`;
  }
  if (orchestrationPlan && typeof orchestrationPlan === 'object') {
    text += `\n\nOrchestration plan:\n${trimForLog(stringifyJSON(orchestrationPlan), 6000)}`;
  }
  if (researchBundle && typeof researchBundle === 'object') {
    text += `\n\nResearch bundle:\n${trimForLog(stringifyJSON(researchBundle), 24000)}`;
  }
  text += '\n\nRules: use verified contracts from research if available; do not invent contract addresses or URLs.';
  text += '\nReturn a complete strategy graph JSON object.';
  return text;
}

function buildOrchestratorSystemPrompt() {
  return String.raw`
You are an orchestration planner for a two-worker AI pipeline.
Return only JSON object with keys:
{
  "mode": "research_then_strategy",
  "needResearch": true|false,
  "researchTasks": [{"kind":"string","query":"string","priority":"high|medium|low"}],
  "strategyTasks": ["string"],
  "contractHints": [{"chain":"eth-mainnet|base-mainnet|arb-mainnet|opt-mainnet|polygon-mainnet|bsc-mainnet","address":"0x...","reason":"string"}],
  "notes": ["string"]
}
Constraints:
- If user asks smart-contract/web3/dex onchain behavior, set needResearch=true.
- Prefer explicit contract hints only if user provided addresses or clear protocol names.
- Keep response concise and machine-usable.
`.trim();
}

function buildOrchestratorUserPrompt(prompt, currentStrategy) {
  let text = `User request:\n${normalizeText(prompt)}`;
  if (currentStrategy && typeof currentStrategy === 'object') {
    text += `\n\nCurrent strategy context:\n${trimForLog(stringifyJSON(currentStrategy), 9000)}`;
  }
  text += '\n\nReturn orchestration plan JSON only.';
  return text;
}

function buildResearchSystemPrompt() {
  return String.raw`
You are a research worker for strategy generation.
Return only JSON object with keys:
{
  "goals": ["string"],
  "findings": ["string"],
  "urls": [{"url":"https://...","title":"string","note":"string"}],
  "contracts": [{"chain":"eth-mainnet|base-mainnet|arb-mainnet|opt-mainnet|polygon-mainnet|bsc-mainnet","address":"0x...","label":"string","reason":"string"}],
  "warnings": ["string"]
}
Rules:
- Prefer concrete, verifiable references.
- Do not invent private endpoints.
- Keep contracts limited to high-confidence candidates.
`.trim();
}

function buildResearchUserPrompt(prompt, orchestrationPlan) {
  let text = `User request:\n${normalizeText(prompt)}`;
  if (orchestrationPlan && typeof orchestrationPlan === 'object') {
    text += `\n\nOrchestration plan:\n${trimForLog(stringifyJSON(orchestrationPlan), 9000)}`;
  }
  text += '\n\nReturn research JSON only.';
  return text;
}

function trimForLog(text, limit) {
  if (typeof text !== 'string') {
    return '';
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...(truncated)`;
}

function stringifyJSON(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function parseJSON(rawText, label) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`decode ${label}: ${error.message}`);
  }
}

function extractMessageContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => (item && typeof item === 'object' && typeof item.text === 'string' ? item.text : ''))
    .join('')
    .trim();
}

function parseChatCompletionContent(rawText) {
  const parsed = parseJSON(rawText, 'chat completion');
  const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (!firstChoice || typeof firstChoice !== 'object') {
    throw new Error('chat completion returned no choices');
  }
  const content = extractMessageContent(firstChoice.message?.content);
  if (!content) {
    throw new Error('chat completion content is empty');
  }
  return content;
}

function parseOllamaChatContent(rawText) {
  const parsed = parseJSON(rawText, 'ollama response');
  const content = normalizeText(parsed?.message?.content);
  if (!content) {
    throw new Error('ollama content is empty');
  }
  return content;
}

function parseGeminiContent(rawText) {
  const parsed = parseJSON(rawText, 'gemini response');
  const firstCandidate = Array.isArray(parsed.candidates) ? parsed.candidates[0] : null;
  const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];
  const content = parts
    .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!content) {
    throw new Error('gemini content is empty');
  }
  return content;
}

function parseJSONObjectContent(rawText, label) {
  let text = normalizeText(rawText);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    text = normalizeText(fenced[1]);
  }
  const parsed = parseJSON(text, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return parsed;
}

function parseStrategyGraph(rawText) {
  const parsed = parseJSONObjectContent(rawText, 'strategy JSON');
  if (parsed?.kind === 'hershy-strategy-graph') {
    return parsed;
  }
  if (parsed?.strategy?.kind === 'hershy-strategy-graph') {
    return parsed.strategy;
  }
  throw new Error('response is not hershy-strategy-graph');
}

async function fetchTextOrThrow(provider, endpoint, requestInit, timeoutSeconds) {
  const response = await fetch(endpoint, {
    ...requestInit,
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new UpstreamHTTPError(provider, response.status, text);
  }
  return text;
}

async function callOllamaLayer(layer, systemPrompt, userPrompt) {
  const baseURL = normalizeBaseURL(layerEnv(layer, 'OLLAMA_BASE_URL') || process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
  const endpoint = layerEnv(layer, 'OLLAMA_ENDPOINT') || normalizeText(process.env.OLLAMA_ENDPOINT) || `${baseURL}/api/chat`;
  const model = layerEnv(layer, 'OLLAMA_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.OLLAMA_MODEL) || 'gpt-oss:20b';
  const wireAPI = normalizeText(layerEnv(layer, 'OLLAMA_WIRE_API') || process.env.OLLAMA_WIRE_API).toLowerCase()
    || (endpoint.includes('/v1/') ? 'openai' : 'ollama');
  const payload = wireAPI === 'openai'
    ? {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }
    : {
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = resolveOllamaAPIKey(layer);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const rawText = await fetchTextOrThrow(
    'ollama',
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    resolveLayerTimeoutSeconds(layer, 'OLLAMA_TIMEOUT_SEC', 180),
  );

  const content = wireAPI === 'openai'
    ? parseChatCompletionContent(rawText)
    : parseOllamaChatContent(rawText);

  return {
    text: content,
    provider: 'ollama',
    model,
    source: 'ollama-chat-layer',
  };
}

async function callGeminiLayer(layer, systemPrompt, userPrompt) {
  const apiKey = resolveGeminiAPIKey(layer);
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is not set');
  }

  const model = layerEnv(layer, 'GEMINI_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.GEMINI_MODEL) || 'gemini-2.0-flash';
  const baseURL = normalizeBaseURL(layerEnv(layer, 'GEMINI_BASE_URL') || process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta');
  const endpoint = layerEnv(layer, 'GEMINI_ENDPOINT') || normalizeText(process.env.GEMINI_ENDPOINT)
    || `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const rawText = await fetchTextOrThrow(
    'gemini',
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    resolveLayerTimeoutSeconds(layer, 'GEMINI_TIMEOUT_SEC', 45),
  );

  return {
    text: parseGeminiContent(rawText),
    provider: 'gemini',
    model,
    source: 'google-gemini-generate-content-layer',
  };
}

async function callOpenAILayer(layer, systemPrompt, userPrompt) {
  const apiKey = resolveOpenAIAPIKey(layer);
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const baseURL = normalizeBaseURL(layerEnv(layer, 'OPENAI_BASE_URL') || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const endpoint = layerEnv(layer, 'OPENAI_CHAT_ENDPOINT') || normalizeText(process.env.OPENAI_CHAT_ENDPOINT) || `${baseURL}/chat/completions`;
  const model = layerEnv(layer, 'OPENAI_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.OPENAI_MODEL) || 'gpt-4o-mini';

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };

  const rawText = await fetchTextOrThrow(
    'openai',
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    resolveLayerTimeoutSeconds(layer, 'OPENAI_TIMEOUT_SEC', 35),
  );

  return {
    text: parseChatCompletionContent(rawText),
    provider: 'openai',
    model,
    source: 'openai-chat-completions-layer',
  };
}

async function callAITextLayer({ layer, systemPrompt, userPrompt }) {
  const provider = resolveLayerProvider(layer);
  if (provider === 'ollama') {
    return callOllamaLayer(layer, systemPrompt, userPrompt);
  }
  if (provider === 'gemini') {
    return callGeminiLayer(layer, systemPrompt, userPrompt);
  }
  if (provider === 'openai') {
    return callOpenAILayer(layer, systemPrompt, userPrompt);
  }
  throw new Error(`unsupported AI provider for layer ${layer}: ${provider}`);
}

async function runOrchestratorLayer({ prompt, currentStrategy }) {
  const fallbackPlan = buildDefaultOrchestrationPlan(prompt);
  try {
    const response = await callAITextLayer({
      layer: 'ORCHESTRATOR',
      systemPrompt: buildOrchestratorSystemPrompt(),
      userPrompt: buildOrchestratorUserPrompt(prompt, currentStrategy)
    });
    const parsed = parseJSONObjectContent(response.text, 'orchestration plan');
    return {
      plan: normalizeOrchestrationPlan(parsed, prompt),
      provider: response.provider,
      model: response.model,
      source: response.source,
      warnings: []
    };
  } catch (error) {
    return {
      plan: fallbackPlan,
      provider: 'fallback',
      model: '',
      source: 'fallback-orchestrator-plan',
      warnings: [error?.message || 'orchestrator failed']
    };
  }
}

async function runResearchLayer({
  prompt,
  currentStrategy,
  orchestrationPlan,
  authContext
}) {
  const requestExplorerAPIKey = resolveExplorerAPIKeyFromAuthContext(authContext);
  const baseBundle = buildFallbackResearchBundle({ prompt, orchestrationPlan });
  let aiBundle = null;
  let provider = 'fallback';
  let model = '';
  let source = 'fallback-research-bundle';
  let warnings = [];

  try {
    const response = await callAITextLayer({
      layer: 'RESEARCH',
      systemPrompt: buildResearchSystemPrompt(),
      userPrompt: buildResearchUserPrompt(prompt, orchestrationPlan)
    });
    const parsed = parseJSONObjectContent(response.text, 'research bundle');
    aiBundle = normalizeResearchBundle(parsed, { prompt, orchestrationPlan, currentStrategy });
    provider = response.provider;
    model = response.model;
    source = response.source;
  } catch (error) {
    warnings = [error?.message || 'research ai failed'];
  }

  let merged = mergeResearchBundles(baseBundle, aiBundle);
  if (warnings.length > 0) {
    merged = {
      ...merged,
      warnings: Array.from(new Set([...(merged.warnings || []), ...warnings]))
    };
  }
  merged = await enrichResearchBundleContracts(merged, {
    explorerAPIKey: requestExplorerAPIKey
  });
  merged.summary = summarizeResearchBundle(merged);

  return {
    research: merged,
    provider,
    model,
    source,
  };
}

async function runStrategyLayer({ prompt, currentStrategy, researchBundle, orchestrationPlan }) {
  const response = await callAITextLayer({
    layer: 'STRATEGY',
    systemPrompt: buildAIStrategySystemPrompt(),
    userPrompt: buildAIStrategyUserPrompt(prompt, currentStrategy, researchBundle, orchestrationPlan)
  });
  return {
    strategy: parseStrategyGraph(response.text),
    provider: response.provider,
    model: response.model,
    source: response.source,
  };
}

async function runOrchestrationPipeline({ prompt, currentStrategy, authContext }) {
  const orchestrator = await runOrchestratorLayer({ prompt, currentStrategy });
  const research = orchestrator.plan.needResearch
    ? await runResearchLayer({
      prompt,
      currentStrategy,
      orchestrationPlan: orchestrator.plan,
      authContext
    })
    : {
      research: {
        ...buildFallbackResearchBundle({ prompt, orchestrationPlan: orchestrator.plan }),
        warnings: ['research skipped by orchestration plan'],
        summary: {
          goals: 0,
          findings: 0,
          urls: 0,
          contracts: 0,
          verifiedContracts: 0
        }
      },
      provider: 'skipped',
      model: '',
      source: 'orchestrator-skip-research'
    };

  const strategy = await runStrategyLayer({
    prompt,
    currentStrategy,
    researchBundle: research.research,
    orchestrationPlan: orchestrator.plan
  });

  const orchestrationPayload = {
    ...orchestrator.plan,
    warnings: Array.from(new Set([
      ...(orchestrator.warnings || []),
      ...(research.research?.warnings || [])
    ]))
  };

  return {
    strategy: strategy.strategy,
    research: research.research,
    orchestration: orchestrationPayload,
    source: 'orchestrated-ai-pipeline',
    providers: {
      orchestrator: orchestrator.provider,
      research: research.provider,
      strategy: strategy.provider
    },
    models: {
      orchestrator: orchestrator.model,
      research: research.model,
      strategy: strategy.model
    }
  };
}
