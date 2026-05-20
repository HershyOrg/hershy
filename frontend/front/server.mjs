import express from 'express';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import next from 'next';
import {
  DEFAULT_EXCHANGE_CONNECTIONS,
  SUPPORTED_EXCHANGE_CONNECTION_IDS,
} from './src/lib/exchangeCatalog.mjs';
import {
  sanitizeUserContextID,
} from './contextManager.mjs';
import { createExchangeConnectionManager } from './server/exchangeConnections.mjs';
import {
  buildUserContextPromptSection,
  prepareStrategyUserContext,
  resolveRequestUserID,
} from './server/requestUserContext.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STRATEGY_RUNNER_DIR = path.resolve(REPO_ROOT, 'examples/strategy-runner');
const LOCAL_STATE_DIR = path.resolve(__dirname, '.local');
const AI_STRATEGY_LOGIC_ERROR_LOG_PATH = path.join(LOCAL_STATE_DIR, 'ai-strategy-logic-errors.jsonl');
const STRATEGY_RUNNER_RUNTIME_FILES = [
  'go.mod',
  'go.sum',
  'runner/runner.go',
  'liveexec/liveexec.go',
];

loadServerEnvFiles([
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env'),
  path.resolve(REPO_ROOT, '.env.local'),
  path.resolve(REPO_ROOT, '.env'),
]);

const DEFAULT_HERSHY_CONTEXT_FILES = [
  'README.md',
  'examples/strategy-runner/README.md',
  'examples/strategy-runner/strategy.sample.json',
  'program/reducer.go',
  'program/effect.go',
];

const EXCHANGE_WEBSOCKET_RAG_INDEX_FILE = 'frontend/front/docs/rag/exchange-websocket-subscriptions/index.md';
const EXCHANGE_WEBSOCKET_RAG_FILES = {
  binance: 'frontend/front/docs/rag/exchange-websocket-subscriptions/binance.md',
  bybit: 'frontend/front/docs/rag/exchange-websocket-subscriptions/bybit.md',
  okx: 'frontend/front/docs/rag/exchange-websocket-subscriptions/okx.md',
  kucoin: 'frontend/front/docs/rag/exchange-websocket-subscriptions/kucoin.md',
  bitget: 'frontend/front/docs/rag/exchange-websocket-subscriptions/bitget.md',
  gate: 'frontend/front/docs/rag/exchange-websocket-subscriptions/gateio.md',
  gateio: 'frontend/front/docs/rag/exchange-websocket-subscriptions/gateio.md',
  polymarket: 'frontend/front/docs/rag/exchange-websocket-subscriptions/polymarket.md',
};

const hershyContextCachePromises = new Map();

const FRONT_PORT = resolvePort(process.env.FRONT_PORT || process.env.PORT, 9090);
const HOST_API_BASE = normalizeBaseURL(process.env.HOST_API_BASE || 'http://localhost:9000');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const nextApp = next({ dev: !IS_PRODUCTION });
const nextHandler = nextApp.getRequestHandler();

await nextApp.prepare();

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

const exchangeConnectionManager = createExchangeConnectionManager({
  localStateDir: LOCAL_STATE_DIR,
  defaultExchangeConnections: DEFAULT_EXCHANGE_CONNECTIONS,
  supportedExchangeConnectionIDs: SUPPORTED_EXCHANGE_CONNECTION_IDS,
  sanitizeUserContextID,
});

const {
  buildConnectedExchangeContextForAI,
  getConnectedExchangeConnections,
  loadExchangeConnections,
  patchExchangeConnection,
  serializeExchangeConnection,
  serializeExchangeConnections,
  testBinanceSignedConnection,
  upsertExchangeConnection,
} = exchangeConnectionManager;

function stripEnvQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadServerEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }
  const content = fsSync.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = normalized.slice(0, separatorIndex).trim();
    const value = stripEnvQuotes(normalized.slice(separatorIndex + 1));
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}

function loadServerEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      loadServerEnvFile(filePath);
    } catch (error) {
      console.warn(`[front] failed to load env file ${filePath}: ${error?.message || error}`);
    }
  }
}

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

const DEFAULT_MARKET_OVERVIEW_ROWS = [
  { symbol: 'BTCUSDT', icon: '₿', tone: 'up', price: '0.00', change: '+0.00%', source: 'Binance Spot' },
  { symbol: 'ETHUSDT', icon: 'Ξ', tone: 'up', price: '0.00', change: '+0.00%', source: 'Binance Spot' },
  { symbol: 'XRPUSDT', icon: 'X', tone: 'up', price: '0.0000', change: '+0.00%', source: 'Binance Spot' },
  { symbol: 'XRPUSDT.P', icon: 'P', tone: 'down', price: '0.0000', change: '+0.00%', source: 'Binance Futures' },
];

const ORCHESTRATION_PLAN_SCHEMA = {
  type: 'object',
  required: ['mode', 'needResearch', 'researchTasks', 'strategyTasks', 'contractHints', 'notes'],
  properties: {
    mode: { type: 'string' },
    needResearch: { type: 'boolean' },
    researchTasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'query', 'priority'],
        properties: {
          kind: { type: 'string' },
          query: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    strategyTasks: { type: 'array', items: { type: 'string' } },
    contractHints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['chain', 'address', 'reason'],
        properties: {
          chain: { type: 'string' },
          address: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

const RESEARCH_BUNDLE_SCHEMA = {
  type: 'object',
  required: ['goals', 'findings', 'urls', 'contracts', 'warnings'],
  properties: {
    goals: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
    urls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title', 'note'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    contracts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['chain', 'address', 'label', 'reason'],
        properties: {
          chain: { type: 'string' },
          address: { type: 'string' },
          label: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const STRATEGY_OVERVIEW_SCHEMA = {
  type: 'object',
  required: ['blocks'],
  properties: {
    strategySummary: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'roleDescription', 'inputSummary', 'outputSummary'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          roleDescription: { type: 'string' },
          tradingCriterion: { type: 'string' },
          inputSummary: { type: 'string' },
          outputSummary: { type: 'string' },
        },
      },
    },
  },
};

const STRATEGY_GRAPH_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'kind', 'strategy', 'blocks', 'connections'],
  properties: {
    schemaVersion: { type: 'number' },
    kind: { type: 'string', enum: ['hershy-strategy-graph'] },
    strategy: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
    generatedAt: { type: 'string' },
    summary: {
      type: 'object',
      properties: {
        blocks: { type: 'number' },
        connections: { type: 'number' },
      },
    },
    metadata: { type: 'object' },
    blocks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'type', 'config'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['streaming', 'normal', 'trigger', 'action', 'monitoring'] },
          config: { type: 'object' },
        },
      },
    },
    connections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'kind', 'fromId', 'toId'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['stream-monitor', 'trigger-action', 'trigger-input', 'action-input', 'data-flow', 'action-result'] },
          fromId: { type: 'string' },
          toId: { type: 'string' },
        },
      },
    },
  },
};

app.get('/api/config', (_req, res) => {
  res.json({
    host_api_base: HOST_API_BASE,
    front_port: FRONT_PORT,
  });
});

app.get('/api/market/overview', async (_req, res) => {
  try {
    res.json(await fetchMarketOverviewRows());
  } catch (error) {
    res.json({
      updatedAt: new Date().toISOString(),
      source: 'fallback',
      warning: error?.message || 'market overview fetch failed',
      rows: DEFAULT_MARKET_OVERVIEW_ROWS,
    });
  }
});

app.get('/api/market/chart', async (req, res) => {
  try {
    const result = await fetchMarketChartSeries({
      symbol: normalizeText(req.query.symbol) || 'BTCUSDT',
      market: normalizeText(req.query.market),
      interval: normalizeText(req.query.interval) || '1m',
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    sendError(res, 502, `market chart fetch failed: ${error?.message || 'unknown error'}`);
  }
});

app.post('/api/strategy/runtime-artifacts', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const body = normalizeObject(req.body) || {};
    let strategy = normalizeObject(body.strategy || body.strategyGraph);
    if (!strategy && typeof body.code === 'string') {
      strategy = normalizeObject(parseJSON(body.code, 'strategy code'));
    }
    if (!strategy) {
      sendError(res, 400, 'strategy graph is required');
      return;
    }

    const validation = await validateStrategyGraphWithRunner(strategy);
    const validationHistory = [{
      attempt: 1,
      stage: 'code-view-runtime-artifacts',
      ok: validation.ok,
      issues: validation.issues,
      stdout: validation.stdout,
      stderr: validation.stderr,
    }];

    if (!validation.ok) {
      sendError(res, 400, 'strategy graph validation failed', { validation });
      return;
    }

    const runtime = await writeStrategyRuntimeArtifacts(strategy, validationHistory, { registerHostProgram: false });
    res.json({ ok: true, validation, runtime });
  } catch (error) {
    sendError(res, 502, `runtime artifact generation failed: ${error?.message || 'unknown error'}`);
  }
});

app.get('/api/exchange-connections', async (req, res) => {
  try {
    const userId = resolveRequestUserID(req);
    res.json({
      userId,
      connections: serializeExchangeConnections(await loadExchangeConnections(userId)),
    });
  } catch (error) {
    sendError(res, 500, `exchange connections load failed: ${error?.message || 'unknown error'}`);
  }
});

app.post('/api/exchange-connections', express.json({ limit: '512kb' }), async (req, res) => {
  try {
    const userId = resolveRequestUserID(req);
    const saved = await upsertExchangeConnection(userId, req.body);
    res.json({
      userId,
      connection: serializeExchangeConnection(saved),
      connections: serializeExchangeConnections(await loadExchangeConnections(userId)),
    });
  } catch (error) {
    sendError(res, 400, error?.message || 'exchange connection save failed');
  }
});

app.post('/api/exchange-connections/:id/binance-auth-test', express.json({ limit: '128kb' }), async (req, res) => {
  const userId = resolveRequestUserID(req);
  try {
    const connectionId = normalizeText(req.params.id);
    const market = normalizeText(req.body?.market).toLowerCase() === 'futures' ? 'futures' : 'spot';
    const connections = await loadExchangeConnections(userId);
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) {
      sendError(res, 404, 'exchange connection not found');
      return;
    }

    const result = await testBinanceSignedConnection(connection, { market });
    const updated = await patchExchangeConnection(userId, connection.id, {
      credentials: {
        ...(connection.credentials || {}),
        authStatus: '검증됨',
        authMarket: market,
        lastAuthCheckAt: new Date().toISOString(),
        lastAuthError: '',
      },
    });

    res.json({
      ok: true,
      userId,
      connection: serializeExchangeConnection(updated),
      connections: serializeExchangeConnections(await loadExchangeConnections(userId)),
      account: summarizeBinanceAccount(result.data, market),
      message: 'Binance HMAC signed request succeeded.',
    });
  } catch (error) {
    const connectionId = normalizeText(req.params.id);
    if (connectionId) {
      try {
        const connections = await loadExchangeConnections(userId);
        const connection = connections.find((item) => item.id === connectionId);
        if (connection) {
          await patchExchangeConnection(userId, connection.id, {
            credentials: {
              ...(connection.credentials || {}),
              authStatus: '실패',
              lastAuthCheckAt: new Date().toISOString(),
              lastAuthError: error?.message || 'unknown error',
            },
          });
        }
      } catch {
        // Preserve the original Binance error for the response.
      }
    }
    sendError(res, 502, `binance signed request failed: ${error?.message || 'unknown error'}`);
  }
});

app.get('/api/ai/strategy-logic-error-log', async (req, res) => {
  try {
    const limit = clampInteger(Number(req.query.limit) || 100, 1, 1000);
    const runId = normalizeText(req.query.runId);
    const entries = await readStrategyLogicErrorLog({ limit, runId });
    res.json({
      logPath: path.relative(REPO_ROOT, AI_STRATEGY_LOGIC_ERROR_LOG_PATH),
      runId,
      entries,
    });
  } catch (error) {
    sendError(res, 500, `strategy logic error log read failed: ${error?.message || 'unknown error'}`);
  }
});

app.post('/api/stream/sample', express.json({ limit: '256kb' }), async (req, res) => {
  const input = normalizeStreamSampleInput(req.body);
  if (input.streamKind === 'evm-rpc') {
    if (!input.streamChain) {
      sendError(res, 400, 'stream_chain is required for evm-rpc');
      return;
    }
    if (!input.streamMethod) {
      sendError(res, 400, 'stream_method is required for evm-rpc');
      return;
    }
  } else if (input.streamKind === 'cex-market') {
    if (!input.exchange) {
      sendError(res, 400, 'exchange is required for cex-market');
      return;
    }
    if (!input.symbol) {
      sendError(res, 400, 'symbol is required for cex-market');
      return;
    }
  } else if (input.streamKind === 'polymarket-market') {
    if (!input.tokenId) {
      sendError(res, 400, 'token_id is required for polymarket-market');
      return;
    }
  } else if (!input.sourceURL) {
    sendError(res, 400, 'source_url is required for url/websocket streams');
    return;
  }

  try {
    const payload = await sampleStreamPayload(input);
    const schemaFields = parseResponseSchemaFields(input.responseSchema);
    const derivedFields = schemaFields.length > 0 ? schemaFields : derivePayloadFields(payload);
    const snapshotFields = input.fields.length > 0 ? input.fields : derivedFields;
    res.json({
      fields: derivedFields,
      snapshot: {
        timestamp: new Date().toISOString(),
        values: buildPreviewValues(payload, snapshotFields),
      },
    });
  } catch (error) {
    sendError(res, 502, `stream sample failed: ${error?.message || 'unknown error'}`);
  }
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
    const exchangeConnections = await loadExchangeConnections(resolveRequestUserID(req));
    const userContext = await prepareStrategyUserContext({
      req,
      connectedExchangeConnections: getConnectedExchangeConnections(exchangeConnections),
      source: 'ai-research',
    });
    const researched = await runResearchLayer({
      prompt,
      currentStrategy,
      orchestrationPlan,
      authContext,
      exchangeConnections,
      userContext,
    });
    res.json({
      research: researched.research,
      source: researched.source,
      provider: researched.provider,
      model: researched.model,
      reasoning: researched.reasoning,
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
    const exchangeConnections = await loadExchangeConnections(resolveRequestUserID(req));
    const userContext = await prepareStrategyUserContext({
      req,
      connectedExchangeConnections: getConnectedExchangeConnections(exchangeConnections),
      source: 'ai-strategy-compose',
    });
    if (getConnectedExchangeConnections(exchangeConnections).length === 0) {
      sendError(res, 400, 'connected exchange is required before generating an executable strategy');
      return;
    }
    const composed = await runStrategyLayer({
      prompt,
      currentStrategy,
      researchBundle,
      exchangeConnections,
      userContext,
    });
    res.json({
      strategy: composed.strategy,
      source: composed.source,
      provider: composed.provider,
      model: composed.model,
      reasoning: composed.reasoning,
      validation: composed.validation,
      runtime: composed.runtime,
      overview: composed.overview,
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
    const exchangeConnections = await loadExchangeConnections(resolveRequestUserID(req));
    const userContext = await prepareStrategyUserContext({
      req,
      connectedExchangeConnections: getConnectedExchangeConnections(exchangeConnections),
      source: 'ai-orchestrate-strategy',
    });
    if (getConnectedExchangeConnections(exchangeConnections).length === 0) {
      sendError(res, 400, 'connected exchange is required before generating an executable strategy');
      return;
    }
    const result = await runOrchestrationPipeline({
      prompt,
      currentStrategy,
      authContext,
      exchangeConnections,
      userContext,
    });
    res.json({
      strategy: result.strategy,
      research: result.research,
      orchestration: result.orchestration,
      source: result.source,
      providers: result.providers,
      models: result.models,
      reasoning: result.reasoning,
      validation: result.validation,
      runtime: result.runtime,
      overview: result.overview,
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
    const exchangeConnections = await loadExchangeConnections(resolveRequestUserID(req));
    const userContext = await prepareStrategyUserContext({
      req,
      connectedExchangeConnections: getConnectedExchangeConnections(exchangeConnections),
      source: 'ai-strategy-draft',
    });
    if (getConnectedExchangeConnections(exchangeConnections).length === 0) {
      sendError(res, 400, 'connected exchange is required before generating an executable strategy');
      return;
    }
    const result = await runOrchestrationPipeline({
      prompt,
      currentStrategy,
      authContext,
      exchangeConnections,
      userContext,
    });
    res.json(makeStrategyDraftResponse(result));
  } catch (error) {
    sendAIFailure(res, error, 'ai generation failed');
  }
});

app.post('/api/ai/strategy-draft-stream', express.json({ limit: '2mb' }), async (req, res) => {
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
    const exchangeConnections = await loadExchangeConnections(resolveRequestUserID(req));
    const userContext = await prepareStrategyUserContext({
      req,
      connectedExchangeConnections: getConnectedExchangeConnections(exchangeConnections),
      source: 'ai-strategy-draft-stream',
    });
    if (getConnectedExchangeConnections(exchangeConnections).length === 0) {
      sendError(res, 400, 'connected exchange is required before generating an executable strategy');
      return;
    }

    startAgentEventStream(res);
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const sendEvent = (eventName, payload) => {
      if (!closed) {
        writeAgentEvent(res, eventName, payload);
      }
    };

    sendEvent('progress', {
      status: 'running',
      stage: 'exchange-context',
      label: `연결 거래소 ${getConnectedExchangeConnections(exchangeConnections).length}개 확인`,
      timestamp: new Date().toISOString(),
    });

    const result = await runOrchestrationPipeline({
      prompt,
      currentStrategy,
      authContext,
      exchangeConnections,
      userContext,
      onProgress: (event) => sendEvent('progress', withAgentEventTimestamp(event)),
    });
    sendEvent('result', makeStrategyDraftResponse(result));
    sendEvent('done', withAgentEventTimestamp({
      status: 'done',
      stage: 'done',
      label: '전략 생성 완료',
    }));
    res.end();
  } catch (error) {
    if (res.headersSent) {
      const failure = buildAIFailurePayload(error, 'ai generation failed');
      writeAgentEvent(res, 'error', {
        status: 'error',
        stage: 'error',
        label: '전략 생성 실패',
        message: failure.payload.message,
        ...(failure.payload.logicErrorLog ? { logicErrorLog: failure.payload.logicErrorLog } : {}),
        timestamp: new Date().toISOString(),
      });
      res.end();
      return;
    }
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

app.use('/api', (_req, res) => {
  sendError(res, 404, 'api route not found');
});

app.all(/.*/, (req, res) => {
  return nextHandler(req, res);
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

function normalizeStreamSampleInput(raw) {
  const body = normalizeObject(raw) || {};
  const sourceURL = normalizeText(body.source_url || body.sourceUrl);
  const streamChain = normalizeText(body.stream_chain || body.streamChain).toLowerCase();
  return {
    streamKind: normalizeStreamKind(body.stream_kind || body.streamKind, sourceURL, streamChain),
    sourceURL,
    exchange: normalizeExchangeName(body.exchange || body.venue || body.provider),
    symbol: normalizeText(body.symbol || body.market || body.pair),
    marketId: normalizeText(body.market_id || body.marketId),
    tokenId: normalizeText(body.token_id || body.tokenId),
    streamChain,
    streamMethod: normalizeText(body.stream_method || body.streamMethod),
    streamParamsJSON: normalizeText(body.stream_params_json || body.streamParamsJson) || '[]',
    responseSchema: normalizeText(body.response_schema || body.responseSchema),
    fields: normalizeStringArray(body.fields),
    authContext: normalizeObject(body.auth_context || body.authContext) || null,
    timeoutMs: clampTimeoutMs(body.timeout_ms || body.timeoutMs, 6000),
  };
}

function normalizeStreamKind(rawKind, sourceURL = '', streamChain = '') {
  const text = normalizeText(rawKind).toLowerCase();
  if (text === 'evm-rpc' || streamChain) {
    return 'evm-rpc';
  }
  if (text === 'cex-market') {
    return 'cex-market';
  }
  if (text === 'polymarket-market') {
    return 'polymarket-market';
  }
  if (text === 'url' || text === 'ws' || text === 'websocket') {
    return 'url';
  }
  if (isWebSocketSourceURL(sourceURL) || isHTTPSourceURL(sourceURL)) {
    return 'url';
  }
  return 'url';
}

function clampTimeoutMs(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1000, Math.min(parsed, 15000));
}

function isHTTPSourceURL(value) {
  return /^https?:\/\//i.test(normalizeText(value));
}

function isWebSocketSourceURL(value) {
  return /^wss?:\/\//i.test(normalizeText(value));
}

function parseResponseSchemaFields(rawSchema) {
  const text = normalizeText(rawSchema);
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    const fields = flattenPayloadFields(parsed);
    return fields.length > 0 ? Array.from(new Set(fields)) : [];
  } catch {
    return [];
  }
}

async function sampleStreamPayload(input) {
  if (input.streamKind === 'evm-rpc') {
    return sampleEVMRPCPayload(input);
  }
  if (input.streamKind === 'cex-market') {
    return sampleCEXMarketPayload(input);
  }
  if (input.streamKind === 'polymarket-market') {
    return samplePolymarketMarketPayload(input);
  }
  if (isWebSocketSourceURL(input.sourceURL)) {
    return sampleWebSocketPayload(input.sourceURL, input.timeoutMs);
  }
  if (isHTTPSourceURL(input.sourceURL)) {
    return sampleHTTPPayload(input.sourceURL, input.timeoutMs);
  }
  throw new Error('unsupported stream source');
}

async function sampleHTTPPayload(sourceURL, timeoutMs) {
  const response = await fetch(sourceURL, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`status ${response.status}: ${trimSnippet(text, 160)}`);
  }
  return parseSamplePayload(text);
}

async function sampleWebSocketPayload(sourceURL, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(sourceURL);

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      } catch {
        // Ignore close errors for one-shot sampling.
      }
      handler(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('timed out waiting for websocket payload'));
    }, timeoutMs);

    socket.addEventListener('message', async (event) => {
      try {
        const text = await normalizeWebSocketMessageData(event.data);
        finish(resolve, parseSamplePayload(text));
      } catch (error) {
        finish(reject, error);
      }
    });

    socket.addEventListener('error', () => {
      finish(reject, new Error('websocket sample failed'));
    });

    socket.addEventListener('close', (event) => {
      if (!settled) {
        finish(reject, new Error(`websocket closed before payload (${event.code})`));
      }
    });
  });
}

async function normalizeWebSocketMessageData(data) {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('utf8');
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  return String(data ?? '');
}

async function sampleEVMRPCPayload(input) {
  const rpcURL = resolvePreviewEVMRPCURL(input.streamChain, input.sourceURL, input.authContext);
  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: input.streamMethod,
    params: parsePreviewRPCParams(input.streamParamsJSON),
  };

  const response = await fetch(rpcURL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`rpc status ${response.status}: ${trimSnippet(text, 160)}`);
  }

  const rpcResponse = parseSamplePayload(text);
  if (!rpcResponse || typeof rpcResponse !== 'object' || Array.isArray(rpcResponse)) {
    throw new Error('unexpected rpc response payload');
  }
  if (rpcResponse.error && typeof rpcResponse.error === 'object') {
    const message = normalizeText(rpcResponse.error.message) || 'rpc error';
    throw new Error(message);
  }

  const payload = {
    result: rpcResponse.result,
    method: input.streamMethod,
    chain: input.streamChain,
  };
  if (typeof rpcResponse.result === 'string' && /^0x[0-9a-f]+$/i.test(rpcResponse.result)) {
    try {
      payload.result_dec = BigInt(rpcResponse.result).toString();
    } catch {
      // Keep hex string only when BigInt parsing fails.
    }
  }
  return payload;
}

function normalizeExchangeName(rawValue) {
  const text = normalizeText(rawValue).toLowerCase();
  if (text === 'gate' || text === 'gate.io') return 'gateio';
  return text;
}

function parseMarketNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitMarketSymbol(rawValue) {
  const compact = normalizeText(rawValue).toUpperCase().replace(/[\s/_-]+/g, '');
  if (!compact) {
    return null;
  }
  const quoteAssets = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'DAI', 'USD', 'BTC', 'ETH', 'EUR', 'KRW'];
  for (const quote of quoteAssets) {
    if (compact.length > quote.length && compact.endsWith(quote)) {
      return {
        base: compact.slice(0, compact.length - quote.length),
        quote,
      };
    }
  }
  return { base: compact, quote: '' };
}

function formatExchangeSymbol(exchange, rawValue) {
  const parts = splitMarketSymbol(rawValue);
  if (!parts?.base) {
    return normalizeText(rawValue);
  }
  const { base, quote } = parts;
  switch (exchange) {
    case 'okx':
    case 'kucoin':
      return quote ? `${base}-${quote}` : base;
    case 'gateio':
      return quote ? `${base}_${quote}` : base;
    default:
      return `${base}${quote}`;
  }
}

function buildMarketSnapshot(base = {}) {
  const bidPrice = parseMarketNumber(base.bidPrice);
  const askPrice = parseMarketNumber(base.askPrice);
  const lastPrice = parseMarketNumber(base.lastPrice) || (bidPrice > 0 && askPrice > 0 ? (bidPrice + askPrice) / 2 : bidPrice || askPrice);
  const midPrice = bidPrice > 0 && askPrice > 0 ? (bidPrice + askPrice) / 2 : lastPrice;
  const spread = bidPrice > 0 && askPrice > 0 ? askPrice - bidPrice : 0;
  return {
    ...base,
    lastPrice,
    midPrice,
    bidPrice,
    askPrice,
    spread,
    eventTime: base.eventTime || Date.now(),
  };
}

async function sampleCEXMarketPayload(input) {
  const exchange = normalizeExchangeName(input.exchange);
  const symbol = formatExchangeSymbol(exchange, input.symbol);
  if (!exchange) {
    throw new Error('exchange is required for cex-market stream');
  }
  if (!symbol) {
    throw new Error('symbol is required for cex-market stream');
  }

  switch (exchange) {
    case 'binance': {
      const payload = await sampleHTTPPayload(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: payload.lastPrice,
        bidPrice: payload.bidPrice,
        askPrice: payload.askPrice,
        bidSize: payload.bidQty,
        askSize: payload.askQty,
        volume: payload.volume,
        quoteVolume: payload.quoteVolume,
        highPrice: payload.highPrice,
        lowPrice: payload.lowPrice,
        openPrice: payload.openPrice,
        eventTime: parseMarketNumber(payload.closeTime) || parseMarketNumber(payload.eventTime),
      });
    }
    case 'bybit': {
      const payload = await sampleHTTPPayload(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.result?.list) ? payload.result.list[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.lastPrice,
        bidPrice: row.bid1Price,
        askPrice: row.ask1Price,
        bidSize: row.bid1Size,
        askSize: row.ask1Size,
        volume: row.volume24h,
        quoteVolume: row.turnover24h,
        highPrice: row.highPrice24h,
        lowPrice: row.lowPrice24h,
        eventTime: parseMarketNumber(payload?.time) || Date.now(),
      });
    }
    case 'okx': {
      const payload = await sampleHTTPPayload(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.data) ? payload.data[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.last,
        bidPrice: row.bidPx,
        askPrice: row.askPx,
        bidSize: row.bidSz,
        askSize: row.askSz,
        volume: row.vol24h,
        quoteVolume: row.volCcy24h,
        highPrice: row.high24h,
        lowPrice: row.low24h,
        eventTime: parseMarketNumber(row.ts),
      });
    }
    case 'kucoin': {
      const payload = await sampleHTTPPayload(`https://api.kucoin.com/api/ua/v1/market/ticker?tradeType=SPOT&symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.data?.list) ? payload.data.list[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.lastPrice,
        bidPrice: row.bestBidPrice,
        askPrice: row.bestAskPrice,
        bidSize: row.bestBidSize,
        askSize: row.bestAskSize,
        volume: row.baseVolume,
        quoteVolume: row.quoteVolume,
        highPrice: row.high,
        lowPrice: row.low,
        openPrice: row.open,
        eventTime: Math.round(parseMarketNumber(row.ts) / 1e6) || parseMarketNumber(row.M),
      });
    }
    case 'bitget': {
      const payload = await sampleHTTPPayload(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload?.data) ? payload.data[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.lastPr,
        bidPrice: row.bidPr,
        askPrice: row.askPr,
        bidSize: row.bidSz,
        askSize: row.askSz,
        volume: row.baseVolume,
        quoteVolume: row.quoteVolume || row.usdtVolume,
        highPrice: row.high24h,
        lowPrice: row.low24h,
        openPrice: row.open,
        eventTime: parseMarketNumber(row.ts) || parseMarketNumber(payload?.requestTime),
      });
    }
    case 'gateio': {
      const payload = await sampleHTTPPayload(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(symbol)}`, input.timeoutMs);
      const row = Array.isArray(payload) ? payload[0] || {} : {};
      return buildMarketSnapshot({
        exchange,
        symbol,
        lastPrice: row.last,
        bidPrice: row.highest_bid,
        askPrice: row.lowest_ask,
        bidSize: row.highest_size,
        askSize: row.lowest_size,
        volume: row.base_volume,
        quoteVolume: row.quote_volume,
        highPrice: row.high_24h || row.high24h,
        lowPrice: row.low_24h || row.low24h,
        eventTime: Date.now(),
      });
    }
    default:
      throw new Error(`unsupported cex exchange: ${exchange}`);
  }
}

async function samplePolymarketMarketPayload(input) {
  const tokenId = normalizeText(input.tokenId);
  if (!tokenId) {
    throw new Error('token_id is required for polymarket stream');
  }
  const payload = await sampleHTTPPayload(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`, input.timeoutMs);
  const bestBid = Array.isArray(payload?.bids) ? payload.bids[0] || {} : {};
  const bestAsk = Array.isArray(payload?.asks) ? payload.asks[0] || {} : {};
  const bidPrice = parseMarketNumber(bestBid.price);
  const askPrice = parseMarketNumber(bestAsk.price);
  const bidSize = parseMarketNumber(bestBid.size);
  const askSize = parseMarketNumber(bestAsk.size);
  const lastPrice = parseMarketNumber(payload?.last_trade_price) || (bidPrice > 0 && askPrice > 0 ? (bidPrice + askPrice) / 2 : bidPrice || askPrice);
  return buildMarketSnapshot({
    exchange: 'polymarket',
    tokenId,
    marketId: normalizeText(input.marketId) || normalizeText(payload?.market),
    lastPrice,
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    liquidity: bidPrice * bidSize + askPrice * askSize,
    eventTime: parseMarketNumber(payload?.timestamp) || Date.now(),
  });
}

function resolvePreviewEVMRPCURL(streamChain, sourceURL, authContext) {
  const direct = normalizeText(sourceURL);
  if (direct) {
    return direct;
  }

  const evm = normalizeObject(authContext?.evm) || {};
  const authRPCURL = normalizeText(evm.rpcUrl);
  if (authRPCURL) {
    return authRPCURL;
  }

  const chainEnvKey = toEnvKey(streamChain);
  const envRPCURL = normalizeText(process.env[`${chainEnvKey}_RPC_URL`]) || normalizeText(process.env.EVM_RPC_URL);
  if (envRPCURL) {
    return envRPCURL;
  }

  const alchemyKey = normalizeText(evm.alchemyApiKey)
    || normalizeText(process.env[`${chainEnvKey}_ALCHEMY_API_KEY`])
    || normalizeText(process.env.ALCHEMY_API_KEY);
  if (!alchemyKey) {
    throw new Error('evm rpc url or alchemy api key is required');
  }

  const chainSlug = normalizeAlchemyChainSlug(streamChain);
  if (!chainSlug) {
    throw new Error('unsupported evm chain slug');
  }
  return `https://${chainSlug}.g.alchemy.com/v2/${alchemyKey}`;
}

function normalizeAlchemyChainSlug(raw) {
  return normalizeChainSlug(raw);
}

function toEnvKey(rawValue) {
  return normalizeText(rawValue).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function parsePreviewRPCParams(rawValue) {
  const text = normalizeText(rawValue);
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function parseSamplePayload(rawValue) {
  const text = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
  if (!text) {
    throw new Error('empty payload');
  }
  try {
    return JSON.parse(text);
  } catch {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return { value: numeric };
    }
    return { value: text };
  }
}

function flattenPayloadFields(value, prefix = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [prefix] : [];
    }
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return flattenPayloadFields(first, prefix);
    }
    return prefix ? [prefix] : [];
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return prefix ? [prefix] : [];
    }
    return keys.flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}::${key}` : key;
      return flattenPayloadFields(value[key], nextPrefix);
    });
  }

  return prefix ? [prefix] : [];
}

function derivePayloadFields(payload) {
  const fields = flattenPayloadFields(payload);
  if (fields.length > 0) {
    return Array.from(new Set(fields));
  }
  return ['value'];
}

function buildPreviewValues(payload, fields) {
  const output = {};
  const normalizedFields = fields.length > 0 ? fields : derivePayloadFields(payload);
  normalizedFields.forEach((field) => {
    output[field] = extractPayloadField(payload, field);
  });
  return output;
}

function extractPayloadField(payload, field) {
  if (field === 'value') {
    return normalizePreviewValue(payload?.value !== undefined ? payload.value : payload);
  }

  const path = parsePreviewFieldPath(field);
  const preserveAsText = shouldPreservePreviewText(path[path.length - 1]);
  const direct = lookupPayloadPath(payload, path);
  if (direct.found) {
    return preserveAsText ? String(direct.value ?? '') : normalizePreviewValue(direct.value);
  }
  if (payload && typeof payload === 'object' && payload.data !== undefined) {
    const nested = lookupPayloadPath(payload.data, path);
    if (nested.found) {
      return preserveAsText ? String(nested.value ?? '') : normalizePreviewValue(nested.value);
    }
  }
  return null;
}

function parsePreviewFieldPath(field) {
  const text = normalizeText(field);
  if (!text) {
    return ['value'];
  }
  if (text.includes('::')) {
    return text.split('::').map((part) => normalizeText(part)).filter(Boolean);
  }
  if (text.includes('.')) {
    return text.split('.').map((part) => normalizeText(part)).filter(Boolean);
  }
  return [text];
}

function lookupPayloadPath(payload, path) {
  let current = payload;
  for (const rawSegment of path) {
    const segment = normalizeText(rawSegment);
    if (!segment) {
      return { found: false, value: null };
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: null };
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return { found: false, value: null };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function normalizePreviewValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(numeric)) {
      return numeric;
    }
    return value;
  }
  return value ?? null;
}

function shouldPreservePreviewText(field) {
  return ['exchange', 'symbol', 'marketId', 'tokenId'].includes(normalizeText(field));
}

function getAIBooleanEnv(key, fallback = false) {
  const raw = normalizeText(process.env[key]).toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y' || raw === 'on';
}

function getPositiveIntegerEnv(key, fallback) {
  const parsed = Number.parseInt(process.env[key] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseExchangeWebsocketRag(prompt = '') {
  const lower = normalizeText(prompt).toLowerCase();
  if (!lower) return false;
  return /websocket|web\s*socket|\bws\b|wss:|stream|streaming|subscribe|subscription|payload|ticker|orderbook|order\s*book|kline|candle|웹소켓|스트리밍|스트림|구독|거래소|실시간|차트|cex|polymarket|binance|bybit|okx|kucoin|bitget|gate/.test(lower);
}

function resolveExchangeWebsocketRagFiles(prompt = '') {
  if (!getAIBooleanEnv('AI_STRATEGY_ENABLE_EXCHANGE_WS_RAG', true)) {
    return [];
  }
  if (!shouldUseExchangeWebsocketRag(prompt)) {
    return [];
  }

  const lower = normalizeText(prompt).toLowerCase();
  const files = [EXCHANGE_WEBSOCKET_RAG_INDEX_FILE];
  const matchedFiles = Object.entries(EXCHANGE_WEBSOCKET_RAG_FILES)
    .filter(([exchange]) => lower.includes(exchange))
    .map(([, file]) => file);

  if (matchedFiles.length > 0) {
    files.push(...matchedFiles);
  } else {
    files.push(...Object.values(EXCHANGE_WEBSOCKET_RAG_FILES));
  }

  return Array.from(new Set(files));
}

function resolveHershyContextFileList(prompt = '') {
  const envList = normalizeText(process.env.AI_STRATEGY_HERSHY_CONTEXT_FILES);
  const candidates = envList
    ? envList.split(',').map((item) => normalizeText(item)).filter(Boolean)
    : DEFAULT_HERSHY_CONTEXT_FILES;

  return Array.from(new Set([
    ...resolveExchangeWebsocketRagFiles(prompt),
    ...candidates,
  ]));
}

async function loadHershyLibraryContext(prompt = '') {
  if (!getAIBooleanEnv('AI_STRATEGY_ENABLE_HERSHY_CONTEXT', true)) {
    return '';
  }

  const files = resolveHershyContextFileList(prompt);
  const fileLimit = getPositiveIntegerEnv('AI_STRATEGY_HERSHY_CONTEXT_FILE_CHARS', 8000);
  const totalLimit = getPositiveIntegerEnv('AI_STRATEGY_HERSHY_CONTEXT_TOTAL_CHARS', 42000);
  const cacheKey = JSON.stringify({ files, fileLimit, totalLimit });

  if (!hershyContextCachePromises.has(cacheKey)) {
    hershyContextCachePromises.set(cacheKey, (async () => {
      const chunks = [];
      for (const relPath of files) {
        const absPath = path.resolve(REPO_ROOT, relPath);
        try {
          const content = await fs.readFile(absPath, 'utf8');
          if (!normalizeText(content)) {
            continue;
          }
          chunks.push(`--- ${relPath} ---\n${trimForLog(content, fileLimit)}`);
        } catch {
          // Skip missing/unreadable context file.
        }
      }
      return trimForLog(chunks.join('\n\n'), totalLimit);
    })());
  }

  return hershyContextCachePromises.get(cacheKey);
}

function sendError(res, code, message, extra = {}) {
  res.status(code).json({
    error: statusText(code),
    code,
    message,
    ...(normalizeObject(extra) || {}),
  });
}

function buildAIFailurePayload(error, prefix) {
  let status = 502;
  let message = `${prefix}: ${error?.message || 'unknown error'}`;

  if (isTimeoutError(error)) {
    status = 504;
    message = `${prefix}: AI provider request timed out. Increase DEEPSEEK_TIMEOUT_SEC or AI_STRATEGY_DEEPSEEK_TIMEOUT_SEC if this strategy needs a longer repair loop.`;
  } else if (error instanceof UpstreamHTTPError) {
    if (error.status === 429) {
      status = 429;
    } else if (error.status === 401 || error.status === 403) {
      status = 401;
    } else if (error.status === 400) {
      status = 400;
    }
    message = `${prefix}: ${error.message}`;
  }

  return {
    status,
    payload: {
      error: statusText(status),
      code: status,
      message,
      ...(error?.logicErrorLog ? { logicErrorLog: error.logicErrorLog } : {}),
    },
  };
}

function resolveLayerModelForLog(layer, provider) {
  const prefix = normalizeText(provider).toUpperCase();
  return layerEnv(layer, `${prefix}_MODEL`)
    || layerEnv(layer, 'MODEL')
    || normalizeText(process.env[`${prefix}_MODEL`])
    || '';
}

function makeStrategyDraftResponse(result) {
  return {
    strategy: result.strategy,
    research: result.research,
    orchestration: result.orchestration,
    source: result.source,
    model: result.models?.strategy || result.models?.orchestrator || '',
    providers: result.providers,
    models: result.models,
    reasoning: result.reasoning,
    validation: result.validation,
    runtime: result.runtime,
    overview: result.overview,
    message: 'AI strategy draft generated (orchestrated)',
  };
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function makeStrategyLogicErrorRunID() {
  return `logic-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
}

function summarizeStrategyGraphForLogicLog(strategy) {
  return {
    strategy: strategy?.strategy,
    summary: strategy?.summary,
    blocks: Array.isArray(strategy?.blocks)
      ? strategy.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        kind: block.kind,
        config: normalizeConfigObject(block.config),
        inputBlocks: block.inputBlocks,
        outputBlocks: block.outputBlocks,
      }))
      : [],
    connections: Array.isArray(strategy?.connections)
      ? strategy.connections.map((connection) => ({ ...connection }))
      : [],
  };
}

function summarizeLogicErrorLogEntry(entry) {
  return {
    timestamp: entry.timestamp,
    runId: entry.runId,
    attempt: entry.attempt,
    maxAttempts: entry.maxAttempts,
    stage: entry.stage,
    provider: entry.provider,
    model: entry.model,
    issueCount: entry.issueCount,
    issues: entry.issues,
    validation: entry.validation
      ? {
        ok: entry.validation.ok,
        command: entry.validation.command,
        issues: entry.validation.issues,
      }
      : undefined,
  };
}

function makeStrategyValidationError(message, logicErrorLog) {
  const error = new Error(message);
  error.logicErrorLog = logicErrorLog;
  return error;
}

async function appendStrategyLogicErrorLog(entry) {
  await fs.mkdir(path.dirname(AI_STRATEGY_LOGIC_ERROR_LOG_PATH), { recursive: true });
  await fs.appendFile(
    AI_STRATEGY_LOGIC_ERROR_LOG_PATH,
    `${JSON.stringify(entry)}\n`,
    'utf8',
  );
}

async function recordStrategyLogicError({
  runId,
  attempt,
  maxAttempts,
  stage,
  prompt,
  provider,
  model,
  issues = [],
  logicLintIssues = [],
  validation = null,
  strategy = null,
  intentPlan = null,
  logicIR = null,
}) {
  const entry = {
    timestamp: new Date().toISOString(),
    runId,
    attempt,
    maxAttempts,
    stage,
    provider,
    model,
    prompt: trimForLog(prompt, 8000),
    issueCount: issues.length,
    issues,
    logicLintIssues,
    validation: validation
      ? {
        ok: validation.ok,
        command: validation.command,
        issues: validation.issues,
        stdout: validation.stdout,
        stderr: validation.stderr,
      }
      : null,
    intentPlan,
    logicIR,
    strategy: summarizeStrategyGraphForLogicLog(strategy),
  };
  await appendStrategyLogicErrorLog(entry);
  return summarizeLogicErrorLogEntry(entry);
}

async function readStrategyLogicErrorLog({ limit = 100, runId = '' } = {}) {
  let raw = '';
  try {
    raw = await fs.readFile(AI_STRATEGY_LOGIC_ERROR_LOG_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const parsed = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => !runId || entry.runId === runId);
  return parsed.slice(-limit);
}

function emitAgentProgress(onProgress, event) {
  if (typeof onProgress !== 'function') {
    return;
  }
  try {
    onProgress({
      status: normalizeText(event.status) || 'running',
      stage: normalizeText(event.stage) || 'running',
      label: normalizeText(event.label) || '에이전트 실행 중',
      ...(event.detail === undefined ? {} : { detail: event.detail }),
    });
  } catch {
    // Progress reporting should never interrupt strategy generation.
  }
}

function startAgentEventStream(res) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

function withAgentEventTimestamp(event = {}) {
  return {
    status: normalizeText(event.status) || 'running',
    stage: normalizeText(event.stage) || 'running',
    label: normalizeText(event.label) || '에이전트 실행 중',
    timestamp: new Date().toISOString(),
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  };
}

function writeAgentEvent(res, eventName, payload) {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${stringifyJSON(payload)}\n\n`);
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
    504: 'Gateway Timeout',
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
  if (provider === 'deepseek' || provider === 'deepseek-api') {
    return 'deepseek';
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
  if (normalizeText(process.env.DEEPSEEK_API_KEY)) {
    return 'deepseek';
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

function parseBoolText(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text) {
    return null;
  }
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y' || text === 'on') {
    return true;
  }
  if (text === '0' || text === 'false' || text === 'no' || text === 'n' || text === 'off') {
    return false;
  }
  return null;
}

function resolveLayerBool(layer, key) {
  const fromLayer = parseBoolText(layerEnv(layer, key));
  if (fromLayer !== null) {
    return fromLayer;
  }
  return parseBoolText(process.env[key]);
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

function resolveDeepSeekAPIKey(layer = '') {
  return layerEnv(layer, 'DEEPSEEK_API_KEY') || normalizeText(process.env.DEEPSEEK_API_KEY);
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

function summarizeBinanceAccount(data, market) {
  if (!data || typeof data !== 'object') {
    return { market };
  }
  return {
    market,
    canTrade: data.canTrade,
    accountType: data.accountType,
    permissions: Array.isArray(data.permissions) ? data.permissions : undefined,
    assets: Array.isArray(data.balances)
      ? data.balances.length
      : Array.isArray(data.assets)
        ? data.assets.length
        : undefined,
    updateTime: data.updateTime,
  };
}

function exchangeNameAliases(connection) {
  return [
    connection.id,
    connection.name,
    `${connection.name} Futures`,
    `${connection.name} Perp`,
  ].map(normalizeToken).filter(Boolean);
}

function isActionUsingConnectedExchange(action, connections) {
  const connected = getConnectedExchangeConnections(connections);
  if (connected.length === 0) return false;
  const config = normalizeConfigObject(action?.config);
  const actionExchange = normalizeToken(firstConfigText(config, ['connectionId', 'exchange', 'venue', 'adapter', 'chain', 'network'], ''));
  if (!actionExchange) return false;
  return connected.some((connection) => exchangeNameAliases(connection).includes(actionExchange));
}

function formatMarketPrice(value, symbol) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  if (/XRP|DOGE|PEPE|SHIB/i.test(symbol)) {
    return numeric.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  return numeric.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatMarketChange(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '+0.00%';
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

async function fetchJSONWithTimeout(url, timeoutMs = 6000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function fetchMarketOverviewRows() {
  const [btc, eth, xrp, xrpPerp, gecko] = await Promise.allSettled([
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 8000),
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', 8000),
    fetchJSONWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbol=XRPUSDT', 8000),
    fetchJSONWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=XRPUSDT', 8000),
    fetchJSONWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,ripple&vs_currencies=usd&include_24hr_change=true', 8000),
  ]);
  const geckoValue = gecko.status === 'fulfilled' ? gecko.value : {};
  const bySymbol = new Map([
    ['BTCUSDT', btc.status === 'fulfilled' ? btc.value : null],
    ['ETHUSDT', eth.status === 'fulfilled' ? eth.value : null],
    ['XRPUSDT', xrp.status === 'fulfilled' ? xrp.value : null],
    ['XRPUSDT.P', xrpPerp.status === 'fulfilled' ? xrpPerp.value : null],
  ]);
  const geckoBySymbol = {
    BTCUSDT: geckoValue?.bitcoin ? { lastPrice: geckoValue.bitcoin.usd, priceChangePercent: geckoValue.bitcoin.usd_24h_change } : null,
    ETHUSDT: geckoValue?.ethereum ? { lastPrice: geckoValue.ethereum.usd, priceChangePercent: geckoValue.ethereum.usd_24h_change } : null,
    XRPUSDT: geckoValue?.ripple ? { lastPrice: geckoValue.ripple.usd, priceChangePercent: geckoValue.ripple.usd_24h_change } : null,
    'XRPUSDT.P': geckoValue?.ripple ? { lastPrice: geckoValue.ripple.usd, priceChangePercent: geckoValue.ripple.usd_24h_change } : null,
  };
  const rows = DEFAULT_MARKET_OVERVIEW_ROWS.map((base) => {
    const source = bySymbol.get(base.symbol) || geckoBySymbol[base.symbol];
    const change = Number(source?.priceChangePercent);
    return {
      ...base,
      price: formatMarketPrice(source?.lastPrice, base.symbol),
      change: formatMarketChange(change),
      tone: change >= 0 ? 'up' : 'down',
      source: source === geckoBySymbol[base.symbol] ? 'CoinGecko' : base.source,
    };
  });
  return {
    updatedAt: new Date().toISOString(),
    source: 'public-market-ticker',
    rows,
  };
}

const MARKET_CHART_INTERVALS = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
]);

function normalizeMarketChartSymbol(symbol) {
  const text = normalizeText(symbol).toUpperCase();
  return text
    .replace(/\.P$/i, '')
    .replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
}

function resolveMarketChartMarket(symbol, market) {
  const text = `${normalizeText(symbol)} ${normalizeText(market)}`.toLowerCase();
  if (/perp|futures|future|swap|\.p\b|선물/.test(text)) return 'futures';
  return 'spot';
}

function normalizeMarketChartLimit(limit) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return 96;
  return Math.max(24, Math.min(500, Math.floor(numeric)));
}

async function fetchMarketChartSeries({ symbol, market, interval, limit }) {
  const resolvedMarket = resolveMarketChartMarket(symbol, market);
  const normalizedSymbol = normalizeMarketChartSymbol(symbol);
  const normalizedInterval = MARKET_CHART_INTERVALS.has(interval) ? interval : '1m';
  const normalizedLimit = normalizeMarketChartLimit(limit);
  const baseUrl = resolvedMarket === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const path = resolvedMarket === 'futures' ? '/fapi/v1/klines' : '/api/v3/klines';
  const url = `${baseUrl}${path}?symbol=${encodeURIComponent(normalizedSymbol)}&interval=${encodeURIComponent(normalizedInterval)}&limit=${normalizedLimit}`;
  const rows = await fetchJSONWithTimeout(url, 8000);
  if (!Array.isArray(rows)) {
    throw new Error('unexpected Binance kline response');
  }

  return {
    updatedAt: new Date().toISOString(),
    source: resolvedMarket === 'futures' ? 'Binance Futures kline' : 'Binance Spot kline',
    symbol: normalizedSymbol,
    market: resolvedMarket,
    interval: normalizedInterval,
    series: rows
      .map((row) => {
        if (!Array.isArray(row)) return null;
        const openTime = Number(row[0]);
        const close = Number(row[4]);
        const volume = Number(row[5]);
        if (!Number.isFinite(openTime) || !Number.isFinite(close)) return null;
        return {
          time: Math.floor(openTime / 1000),
          value: close,
          volume: Number.isFinite(volume) ? volume : undefined,
        };
      })
      .filter(Boolean),
  };
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

function isTimeoutError(error) {
  const name = normalizeText(error?.name).toLowerCase();
  const code = normalizeText(error?.code).toLowerCase();
  const message = normalizeText(error?.message).toLowerCase();
  return (
    name === 'timeouterror' ||
    code === 'abort_err' ||
    code === 'etimedout' ||
    /timeout|timed out|aborted due to timeout/.test(message)
  );
}

function sendAIFailure(res, error, prefix) {
  const { status, payload } = buildAIFailurePayload(error, prefix);
  res.status(status).json(payload);
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

function shouldDefaultResearchPrompt(prompt) {
  const lower = normalizeText(prompt).toLowerCase();
  if (extractEVMAddresses(prompt).length > 0) {
    return true;
  }
  return /\b(smart\s*contract|contract|web3|dex|uniswap|aave|curve|compound|lido|pool|router|vault|token\s*address|abi|onchain|온체인|컨트랙트|주소|디파이)\b/.test(lower);
}

function buildDefaultOrchestrationPlan(prompt) {
  const needResearch = shouldDefaultResearchPrompt(prompt);
  return {
    mode: 'research_then_strategy',
    needResearch,
    researchTasks: needResearch ? [
      {
        kind: 'contract_discovery',
        query: normalizeText(prompt),
        priority: 'high'
      }
    ] : [],
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
  let needResearch = fallback.needResearch;
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
You generate semantic strategy packages for Hershy runner.
Return only valid JSON (no markdown).
Response MUST be a single JSON object with no prose before/after it.

Required top-level object:
{
  "intentPlan": {
    "intentSummary": "string",
    "detectedStrategyKinds": ["open string hints only, not source of truth"],
    "requiredConcepts": ["string"],
    "requiredComputationNodes": ["string"],
    "requiredTriggerTypes": ["condition|time"],
    "forbiddenShortcuts": ["string"]
  },
  "logicIR": {
    "intentSummary": "string",
    "classification": {"primary": "open string hint", "tags": ["open string"], "confidence": number},
    "requirements": [
      {"id": "string", "kind": "requires_data|requires_computation|requires_predicate|requires_trigger|requires_action|requires_action_result|requires_risk_control", "semanticType": "open string", "inputs": ["string"], "reason": "string"}
    ],
    "nodes": [
      {"id": "string", "nodeCategory": "data_feed|compute|predicate|trigger|action|risk_control|monitoring", "semanticType": "open string", "label": "string", "expression": "string", "inputs": ["string"], "outputs": ["string"], "triggerType": "condition|time|event", "actionType": "cex_order|dex_swap|close_position|cancel_order|notify|custom", "config": {}}
    ],
    "edges": [
      {"from": "string", "to": "string", "kind": "data|signal|predicate|trigger|action-input|action-result|state"}
    ],
    "invariants": [{"id": "string", "description": "string"}],
    "assumptions": ["string"],
    "unresolved": ["string"]
  },
  "runtimeGraph": {
    "schemaVersion": 1,
    "kind": "hershy-strategy-graph",
    "strategy": {"id": "string", "name": "string"},
    "generatedAt": "ISO8601",
    "metadata": {
      "strategyKind": "string",
      "requiredSignals": ["string"],
      "requiredTriggerTypes": ["string"],
      "sourcePrompt": "string",
      "workflowGroups": [
        {
          "id": "stable workflow id",
          "title": "short user-facing workflow name",
          "purpose": "why this workflow exists",
          "nodeIds": ["exact runtimeGraph block ids in this workflow"],
          "canAbstract": true,
          "mustStayVisibleNodeIds": ["block ids that must not be collapsed in easy view"]
        }
      ]
    },
    "summary": {"blocks": number, "connections": number, "byType": {"streaming": number, "normal": number, "trigger": number, "action": number, "monitoring": number}},
    "blocks": [...],
    "connections": [...]
  }
}

Validation constraints:
- at least 1 streaming block
- at least 1 trigger block
- at least 1 action block
- each action should have at least one incoming trigger-action connection
- each action must also have at least one incoming action-input connection from streaming or normal
- condition/manual triggers must connect to an action via trigger-action
- time triggers that only gate condition triggers should connect with trigger-input from the time trigger to the condition trigger; do not create normal "time pulse" formula nodes
- every monitoring block must have an incoming stream-monitor connection
- every streaming and normal block must be consumed by action-input, data-flow, trigger condition, or stream-monitor
- supported connection kinds are only trigger-action, trigger-input, action-input, data-flow, action-result, stream-monitor
- streaming.config.updateIntervalMs is required
- trigger.config.triggerType="condition" requires non-empty trigger.config.condition
- Logic IR is not a strategy-template selector. classification is only a hint; requirements, nodes, edges, and invariants are the source of truth.
- Logic node categories are fixed: data_feed, compute, predicate, trigger, action, risk_control, monitoring. semanticType is an open string.
- Before writing runtimeGraph blocks, decide the semantic workflow groups. Put them in runtimeGraph.metadata.workflowGroups and list the exact block ids for each workflow.
- Every runtimeGraph block must belong to exactly one workflow, either via block.config.workflowId or metadata.workflowGroups[].nodeIds.
- Workflow groups should represent user-comprehensible phases such as Init capital readiness, data ingestion, signal computation, decision gating, execution, risk monitoring, and kill-switch safe exit.
- Do not make workflow grouping by graph proximity alone. Group by semantic responsibility first, then list node ids.
- Blocks that must remain visible in easy view include CEX/DEX action blocks, branch decision triggers, Init approval/readiness nodes, and Kill switch trigger/action nodes. Put these in mustStayVisibleNodeIds or set canAbstract=false for their workflow.
- For non-pure-execution strategies, canonical flow is: Data Feed -> Compute / Formula / Indicator -> Predicate / Trigger -> Action.
- For strategies that require a formula or indicator, create a normal block with config.expression/formula/code and connect inputs with data-flow. Do not connect raw feeds directly to CEX/DEX when an intermediate formula is required.
- For spot/perp basis, create a basis formula node first, e.g. normal.config.expression="(perp::lastPrice - spot::lastPrice) / spot::lastPrice"; then connect basis -> trigger and trigger -> action.
- For basis/spread/indicator strategies, condition triggers must reference computed signal nodes, not raw feed fields directly.
- Actions are not terminal nodes. If a later action depends on an earlier action, connect action outputs with action-result to normal/trigger/monitoring, then require a confirmation trigger before the next action.
- Use action-result only from action blocks to normal, trigger, or monitoring blocks. Never connect action directly to action.
- Every strategy MUST include an explicit Init/start safety sequence. It must identify where strategy capital starts, verify balances/allowances/collateral before first execution, and emit a capitalReady/startApproved signal that gates the first execution action.
- Every strategy MUST include an explicit kill switch: a condition trigger for manual halt plus strategy-specific fail-safe conditions such as max drawdown, stale data, disconnect, or failed hedge; it must connect via trigger-action to close/cancel/reduce-only/unwind actions that can stop the strategy and unwind/cancel open exposure.
- Kill switch capital objective: move strategy assets into lower-volatility assets as safely as possible. Prefer stable/cash-like assets such as USDC, USDT, DAI, USD, or KRW. Do not leave assets in volatile base tokens, LP positions, or perpetual exposure unless the user explicitly asks for that.
- Mark safety configs with clear fields such as killSwitch, emergencyStop, capitalSource, capitalSink, safeAsset, and safetyObjective.
- CEX action outputBlocks should include orderId, status, filledQty, avgFillPrice. DEX action outputBlocks should include txHash, status, amountOut, executionPrice.
- If execution is driven by time, schedule, interval, cadence, DCA timing, cron, or "every N minutes/hours/days", use a trigger block with config.triggerType="time" and config.intervalMs set to the cadence in milliseconds.
- If a condition should only be evaluated on that cadence, connect the time trigger to the condition trigger with trigger-input. Do not create a separate normal block for DCA interval/cadence/time-pulse/time period.
- Easy view will abstract non-adjustable pipeline nodes. Keep CEX/DEX action configs concrete and parameterized; keep branch conditions explicit so easy view can split paths when logic branches.
- include position {x,y} for each block
- runtimeGraph must pass: cd examples/strategy-runner && go run ./cmd/strategy-validate --file <json>
	`.trim();
}

async function buildAIStrategyUserPrompt(prompt, currentStrategy, researchBundle, orchestrationPlan, exchangeConnections = [], userContext = null) {
  let text = `User request:\n${normalizeText(prompt)}`;
  const hershyContext = await loadHershyLibraryContext(prompt);
  if (hershyContext) {
    text += `\n\nHershy library/project reference context (read carefully):\n${hershyContext}`;
  }
  const userContextSection = buildUserContextPromptSection(userContext);
  if (userContextSection) {
    text += `\n\n${userContextSection}`;
  }
  if (currentStrategy && typeof currentStrategy === 'object') {
    text += `\n\nCurrent strategy JSON (optional context):\n${trimForLog(stringifyJSON(currentStrategy), 12000)}`;
  }
  if (orchestrationPlan && typeof orchestrationPlan === 'object') {
    text += `\n\nOrchestration plan:\n${trimForLog(stringifyJSON(orchestrationPlan), 6000)}`;
  }
  if (researchBundle && typeof researchBundle === 'object') {
    text += `\n\nResearch bundle:\n${trimForLog(stringifyJSON(researchBundle), 24000)}`;
  }
  const connectedExchangeContext = buildConnectedExchangeContextForAI(exchangeConnections);
  text += `\n\nConnected exchange/API context (hard constraint):\n${trimForLog(stringifyJSON(connectedExchangeContext), 10000)}`;
  text += '\nYou MUST create executable action blocks only for the connected exchanges listed above and only for actions listed in capabilities.actions. Use config.exchange and/or config.connectionId that exactly matches a listed name/id. Do not invent venues or unsupported exchange actions. Do not include raw private API/RPC URLs in generated strategy JSON.';
  text += '\n\nRules: use verified contracts from research if available; do not invent contract addresses or URLs.';
  text += '\nReturn a complete semantic strategy package object with intentPlan, logicIR, and runtimeGraph.';
  return text;
}

function buildStrategyOverviewSystemPrompt() {
  return String.raw`
You write block-level UI overview copy for a trading strategy graph.
Return only valid JSON.
Every sentence must be specific to the given strategy and block. Do not write generic product explanations.
Use Korean.

Return shape:
{
  "strategySummary": "one short Korean sentence",
  "blocks": [
    {
      "id": "must match an existing runtimeGraph block id",
      "description": "one short sentence shown in selected block card",
      "roleDescription": "1-2 sentences explaining exactly what this block does in this strategy",
      "tradingCriterion": "only for action blocks: the condition/time/risk criterion that causes this trade to execute. Empty string for non-action blocks.",
      "inputSummary": "one short sentence naming the concrete inputs this block uses",
      "outputSummary": "one short sentence naming the concrete values/results this block produces"
    }
  ]
}

Rules:
- Include one entry for every runtimeGraph block.
- Do not mention "trigger-action", "data-flow", "runtimeGraph", or internal schema terms.
- For CEX/DEX action blocks, tradingCriterion must explain when that order/swap runs in this strategy.
- For non-action blocks, tradingCriterion must be "".
- Easy view abstraction rule: any block that does not expose user-adjustable CEX/DEX parameters may be summarized into a higher-level strategy stage.
- Write non-action descriptions so they compose well when grouped with neighboring data/feed/formula/trigger blocks.
- If a trigger/condition branches into multiple paths, describe each branch by its actual outcome so the easy view can split the abstraction into separate paths.
- Prefer trader language: 시세, 베이시스, 진입, 청산, 리밸런싱, 주문, 체결 결과.
  `.trim();
}

function buildStrategyOverviewUserPrompt({ prompt, strategyGraph, logicIR }) {
  return [
    `User request:\n${normalizeText(prompt)}`,
    `Strategy Logic IR:\n${trimForLog(stringifyJSON(logicIR || {}), 10000)}`,
    `Validated runtimeGraph:\n${trimForLog(stringifyJSON(strategyGraph), 24000)}`,
  ].join('\n\n');
}

function enrichStrategyGraphWithOverview(strategyGraph, overviewPayload) {
  const graph = normalizeObject(strategyGraph) || strategyGraph;
  const overviewByID = new Map(
    (Array.isArray(overviewPayload?.blocks) ? overviewPayload.blocks : [])
      .map((item) => normalizeObject(item))
      .filter(Boolean)
      .map((item) => [normalizeText(item.id), item])
      .filter(([id]) => Boolean(id)),
  );

  const blocks = Array.isArray(graph.blocks)
    ? graph.blocks.map((block) => {
      const overview = overviewByID.get(normalizeText(block?.id));
      if (!overview) return block;
      const config = normalizeConfigObject(block.config);
      const roleDescription = normalizeText(overview.roleDescription);
      const description = normalizeText(overview.description);
      const tradingCriterion = normalizeText(overview.tradingCriterion);
      const inputSummary = normalizeText(overview.inputSummary);
      const outputSummary = normalizeText(overview.outputSummary);
      return {
        ...block,
        config: {
          ...config,
          overviewDescription: description || config.overviewDescription,
          roleDescription: roleDescription || config.roleDescription,
          tradingCriterion: normalizeText(block.type) === 'action' ? tradingCriterion : '',
          inputSummary: inputSummary || config.inputSummary,
          outputSummary: outputSummary || config.outputSummary,
        },
      };
    })
    : graph.blocks;

  return {
    ...graph,
    metadata: {
      ...(normalizeObject(graph.metadata) || {}),
      easyOverviewGenerated: true,
      easyOverviewSummary: normalizeText(overviewPayload?.strategySummary),
    },
    blocks,
  };
}

async function runStrategyOverviewLayer({ prompt, strategyGraph, logicIR }) {
  const response = await callAITextLayer({
    layer: 'STRATEGY_OVERVIEW',
    systemPrompt: buildStrategyOverviewSystemPrompt(),
    userPrompt: buildStrategyOverviewUserPrompt({ prompt, strategyGraph, logicIR }),
  });
  const parsed = parseJSONObjectWithSchema(response.text, 'strategy overview', STRATEGY_OVERVIEW_SCHEMA);
  return {
    strategy: enrichStrategyGraphWithOverview(strategyGraph, parsed),
    provider: response.provider,
    model: response.model,
    source: response.source,
    reasoning: buildAIReasoningTrace('strategy-overview', response),
  };
}

function buildStrategyRepairSystemPrompt() {
  return String.raw`
You repair Hershy strategy JSON so it passes semantic strategy linting and the local strategy-runner validator.
Return only valid JSON (no markdown, no prose).
Preserve the user's intent, but change blocks/config/connections as needed.
Prefer returning the complete semantic package shape {"intentPlan": {...}, "logicIR": {...}, "runtimeGraph": {...}}.
If you return a bare graph, it must still satisfy every semantic lint issue using the provided intentPlan and logicIR.

Hard validation target:
- kind must be "hershy-strategy-graph"
- supported block types: streaming, normal, trigger, action, monitoring
- supported connection kinds: trigger-action, trigger-input, action-input, data-flow, action-result, stream-monitor
- every action must have incoming trigger-action and incoming action-input
- condition/manual triggers must connect to at least one action via trigger-action; time triggers may gate condition triggers via trigger-input
- every monitoring block must have incoming stream-monitor
- every streaming/normal block must be consumed
- no isolated blocks and no disconnected graph components
- streaming.config.updateIntervalMs is required
- condition triggers need triggerType="condition" and a non-empty condition, e.g. stream-1::lastPrice > threshold-1
- Formula/indicator dependencies must be preserved as data-flow connections. Do not bypass required formula nodes by connecting raw market feeds directly to actions.
- Raw market feeds must flow into formula/indicator nodes first when a derived signal is required. Actions must be downstream of triggers.
- Preserve or add runtimeGraph.metadata.workflowGroups. Each group must define id, title, purpose, nodeIds, canAbstract, and mustStayVisibleNodeIds.
- Every runtimeGraph block must belong to exactly one workflow, either through config.workflowId or workflowGroups[].nodeIds.
- Workflow groups are semantic phases, not arbitrary layout clusters. Keep editable actions, branch triggers, Init approval/readiness, and Kill switch trigger/action visible via mustStayVisibleNodeIds or canAbstract=false.
- Use action-input only for data/parameters required by the action. Never use action-input as a substitute for trigger logic.
- For basis/spread/indicator strategies, condition triggers must reference computed signal nodes, not raw feed fields directly.
- For action outputs, use action-result from action blocks to normal, trigger, or monitoring blocks.
- Do not connect action directly to action.
- If a later action depends on an earlier action result, add a confirmation trigger and any required formula nodes first.
- Use filledQty, avgFillPrice, status, orderId, txHash, amountOut, executionPrice outputs instead of requested order quantities when chaining fills.
- Time/schedule/DCA cadence must be represented as one trigger block with triggerType="time" and intervalMs; if it gates a condition, use trigger-input from time trigger to condition trigger. Do not repair it into normal interval/time-pulse + condition trigger.
- Preserve or add the Init sequence. It must remain visible and verify capital location, balances/allowances/collateral, and readiness before the first execution action can use funds.
- Preserve or add the kill switch. It must remain visible as trigger -> close/cancel/reduce-only/unwind action and must be able to halt the strategy for manual stop, drawdown breach, stale data, disconnect, or failed hedge.
- Kill switch capital objective: collect strategy assets into lower-volatility assets such as USDC, USDT, DAI, USD, or KRW. Do not leave assets in volatile base tokens, LP positions, or perpetual exposure unless explicitly requested.
- Mark safety configs with killSwitch, emergencyStop, capitalSource, capitalSink, safeAsset, and safetyObjective when applicable.
	`.trim();
}

function buildStrategyRepairUserPrompt({
  prompt,
  currentStrategy,
  researchBundle,
  orchestrationPlan,
  intentPlan,
  logicIR,
  previousStrategy,
  logicLintIssues,
  validation,
  exchangeConnections = [],
  userContext = null,
}) {
  let text = `Original user request:\n${normalizeText(prompt)}`;
  const userContextSection = buildUserContextPromptSection(userContext);
  if (userContextSection) {
    text += `\n\n${userContextSection}`;
  }
  if (intentPlan && typeof intentPlan === 'object') {
    text += `\n\nIntent plan:\n${trimForLog(stringifyPrettyJSON(intentPlan), 12000)}`;
  }
  if (logicIR && typeof logicIR === 'object') {
    text += `\n\nStrategy Logic IR:\n${trimForLog(stringifyPrettyJSON(logicIR), 24000)}`;
  }
  text += `\n\nLogic lint issues:\n${formatLogicLintIssues(logicLintIssues || []) || 'none'}`;
  text += `\n\nValidator command:\n${validation?.command || 'go run ./cmd/strategy-validate --file <strategy.json>'}`;
  text += `\n\nValidator issues:\n${(validation?.issues || []).map((issue, index) => `${index + 1}. ${issue}`).join('\n') || 'none'}`;
  text += `\n\nPrevious invalid strategy JSON:\n${trimForLog(stringifyPrettyJSON(previousStrategy), 50000)}`;
  if (currentStrategy && typeof currentStrategy === 'object') {
    text += `\n\nCurrent UI strategy context:\n${trimForLog(stringifyJSON(currentStrategy), 8000)}`;
  }
  if (orchestrationPlan && typeof orchestrationPlan === 'object') {
    text += `\n\nOrchestration plan:\n${trimForLog(stringifyJSON(orchestrationPlan), 6000)}`;
  }
  if (researchBundle && typeof researchBundle === 'object') {
    text += `\n\nResearch bundle:\n${trimForLog(stringifyJSON(researchBundle), 12000)}`;
  }
  const connectedExchangeContext = buildConnectedExchangeContextForAI(exchangeConnections);
  text += `\n\nConnected exchange/API context (hard constraint):\n${trimForLog(stringifyJSON(connectedExchangeContext), 10000)}`;
  text += '\nRepair MUST use only connected exchanges listed above and only actions listed in capabilities.actions for executable action blocks.';
  text += '\n\nRepair policy: do not add shortcut edges just to satisfy the validator. If a formula/indicator is required, create it explicitly, connect data feeds into it with data-flow, connect the computed signal into triggers with data-flow, and connect triggers into actions with trigger-action. For action outputs, use action-result from action to normal/trigger/monitoring; never action -> action. A later action that depends on an earlier action result needs a confirmation trigger and any required formula nodes first.';
  text += '\n\nReturn the corrected complete semantic strategy package object with intentPlan, logicIR, and runtimeGraph.';
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

function buildOrchestratorUserPrompt(prompt, currentStrategy, exchangeConnections = [], userContext = null) {
  let text = `User request:\n${normalizeText(prompt)}`;
  const userContextSection = buildUserContextPromptSection(userContext);
  if (userContextSection) {
    text += `\n\n${userContextSection}`;
  }
  if (currentStrategy && typeof currentStrategy === 'object') {
    text += `\n\nCurrent strategy context:\n${trimForLog(stringifyJSON(currentStrategy), 9000)}`;
  }
  const connectedExchangeContext = buildConnectedExchangeContextForAI(exchangeConnections);
  text += `\n\nConnected exchange/API context (hard constraint):\n${trimForLog(stringifyJSON(connectedExchangeContext), 10000)}`;
  text += '\nYou must verify the connected exchanges and capabilities above before proposing executable venues or action plans.';
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

function buildResearchUserPrompt(prompt, orchestrationPlan, exchangeConnections = [], userContext = null) {
  let text = `User request:\n${normalizeText(prompt)}`;
  const userContextSection = buildUserContextPromptSection(userContext);
  if (userContextSection) {
    text += `\n\n${userContextSection}`;
  }
  if (orchestrationPlan && typeof orchestrationPlan === 'object') {
    text += `\n\nOrchestration plan:\n${trimForLog(stringifyJSON(orchestrationPlan), 9000)}`;
  }
  const connectedExchangeContext = buildConnectedExchangeContextForAI(exchangeConnections);
  if (connectedExchangeContext.length > 0) {
    text += `\n\nConnected exchange/API context:\n${trimForLog(stringifyJSON(connectedExchangeContext), 8000)}`;
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

function trimSnippet(text, limit) {
  return trimForLog(String(text || '').replace(/\s+/g, ' ').trim(), limit);
}

function stringifyJSON(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function stringifyPrettyJSON(value) {
  try {
    return JSON.stringify(value, null, 2);
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

function extractMessageReasoningContent(message) {
  if (!message || typeof message !== 'object') {
    return '';
  }
  const content = message.reasoning_content ?? message.reasoningContent;
  return extractMessageContent(content);
}

function parseChatCompletionMessage(rawText) {
  const parsed = parseJSON(rawText, 'chat completion');
  const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (!firstChoice || typeof firstChoice !== 'object') {
    throw new Error('chat completion returned no choices');
  }
  const message = firstChoice.message;
  const content = extractMessageContent(message?.content);
  if (!content) {
    throw new Error('chat completion content is empty');
  }
  return {
    content,
    reasoningContent: extractMessageReasoningContent(message),
  };
}

function parseChatCompletionContent(rawText) {
  return parseChatCompletionMessage(rawText).content;
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
  if (!(text.startsWith('{') && text.endsWith('}'))) {
    throw new Error(`${label} must be a single JSON object (no extra text)`);
  }
  const parsed = parseJSON(text, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return parsed;
}

function validateSchema(value, schema, pathLabel = 'root') {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return errors;
  }

  const type = normalizeText(schema.type);
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${pathLabel} must be object`);
      return errors;
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${pathLabel}.${key} is required`);
      }
    }
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in value)) {
        continue;
      }
      errors.push(...validateSchema(value[key], childSchema, `${pathLabel}.${key}`));
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${pathLabel} must be array`);
      return errors;
    }
    const minItems = Number(schema.minItems);
    if (Number.isFinite(minItems) && value.length < minItems) {
      errors.push(`${pathLabel} must contain at least ${minItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(item, schema.items, `${pathLabel}[${index}]`));
      });
    }
    return errors;
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${pathLabel} must be string`);
      return errors;
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0 && !schema.enum.includes(value)) {
      errors.push(`${pathLabel} must be one of: ${schema.enum.join(', ')}`);
    }
    return errors;
  }

  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${pathLabel} must be number`);
    }
    return errors;
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${pathLabel} must be boolean`);
    }
    return errors;
  }

  return errors;
}

function parseJSONObjectWithSchema(rawText, label, schema) {
  const parsed = parseJSONObjectContent(rawText, label);
  const errors = validateSchema(parsed, schema, label);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed: ${errors.slice(0, 10).join('; ')}`);
  }
  return parsed;
}

function parseStrategyGraph(rawText) {
  return parseJSONObjectWithSchema(rawText, 'strategy JSON', STRATEGY_GRAPH_SCHEMA);
}

const STRATEGY_BLOCK_TYPE_ALIASES = {
  stream: 'streaming',
  feed: 'streaming',
  data_feed: 'streaming',
  source: 'streaming',
  websocket: 'streaming',
  wss: 'streaming',
  api: 'streaming',
  compute: 'normal',
  formula: 'normal',
  indicator: 'normal',
  predicate: 'normal',
  signal: 'normal',
  condition: 'trigger',
  condition_trigger: 'trigger',
  time_trigger: 'trigger',
  timer: 'trigger',
  schedule: 'trigger',
  cex: 'action',
  dex: 'action',
  order: 'action',
  swap: 'action',
  execution: 'action',
  execute: 'action',
  monitor: 'monitoring',
  chart: 'monitoring',
};

const STRATEGY_CONNECTION_KIND_ALIASES = {
  stream_monitor: 'stream-monitor',
  streammonitor: 'stream-monitor',
  monitor: 'stream-monitor',
  chart: 'stream-monitor',
  trigger_action: 'trigger-action',
  triggeraction: 'trigger-action',
  trigger_to_action: 'trigger-action',
  execute: 'trigger-action',
  execution: 'trigger-action',
  action: 'trigger-action',
  condition: 'trigger-action',
  predicate: 'trigger-action',
  trigger_input: 'trigger-input',
  triggerinput: 'trigger-input',
  time_gate: 'trigger-input',
  gate: 'trigger-input',
  action_input: 'action-input',
  actioninput: 'action-input',
  input: 'action-input',
  parameter: 'action-input',
  param: 'action-input',
  data_flow: 'data-flow',
  dataflow: 'data-flow',
  data: 'data-flow',
  signal: 'data-flow',
  predicate_input: 'data-flow',
  formula_input: 'data-flow',
  computed_signal: 'data-flow',
  action_result: 'action-result',
  actionresult: 'action-result',
  result: 'action-result',
  output: 'action-result',
  order_result: 'action-result',
  tx_result: 'action-result',
};

function normalizeSchemaBlockType(rawType, config = {}) {
  const normalized = normalizeToken(rawType);
  if (['streaming', 'normal', 'trigger', 'action', 'monitoring'].includes(normalized)) {
    return normalized;
  }
  if (STRATEGY_BLOCK_TYPE_ALIASES[normalized]) {
    return STRATEGY_BLOCK_TYPE_ALIASES[normalized];
  }
  const actionType = normalizeToken(config.actionType || config.venueType || config.adapter);
  if (/cex|dex|order|swap|contract|onchain/.test(actionType)) {
    return 'action';
  }
  if (config.sourceUrl || config.sourceURL || config.url || config.endpoint || config.apiReference) {
    return 'streaming';
  }
  if (config.triggerType || config.condition || config.schedule || config.cron) {
    return 'trigger';
  }
  return 'normal';
}

function isSchemaConnectionKindCompatible(kind, fromType, toType) {
  if (kind === 'trigger-action') return fromType === 'trigger' && toType === 'action';
  if (kind === 'trigger-input') return fromType === 'trigger' && toType === 'trigger';
  if (kind === 'action-result') return fromType === 'action' && ['normal', 'trigger', 'monitoring'].includes(toType);
  if (kind === 'stream-monitor') return fromType === 'streaming' && toType === 'monitoring';
  if (kind === 'data-flow') return ['streaming', 'normal', 'monitoring'].includes(fromType) && ['normal', 'trigger', 'monitoring'].includes(toType);
  if (kind === 'action-input') return ['streaming', 'normal'].includes(fromType) && toType === 'action';
  return false;
}

function normalizeSchemaConnectionKind(rawKind, fromType, toType) {
  const normalized = normalizeToken(rawKind);
  const aliased = STRATEGY_CONNECTION_KIND_ALIASES[normalized] || normalized.replace(/_/g, '-');
  if (['trigger-action', 'trigger-input', 'action-input', 'stream-monitor', 'data-flow', 'action-result'].includes(aliased)) {
    if (isSchemaConnectionKindCompatible(aliased, fromType, toType)) {
      return aliased;
    }
    return inferRunnerConnectionKind(fromType, toType, '');
  }
  return inferRunnerConnectionKind(fromType, toType, rawKind);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripGateReferenceFromCondition(condition, gateId) {
  const source = normalizeText(condition);
  if (!source || !gateId) {
    return source;
  }
  const reference = `${escapeRegExp(gateId)}(?:(?:::|\\.)[A-Za-z0-9_]+)?`;
  const comparison = `${reference}\\s*(?:>=|>|==|=|<=|<)\\s*(?:0|1|true|false)`;
  let next = source
    .replace(new RegExp(`\\s+(?:AND|&&)\\s+${comparison}`, 'gi'), '')
    .replace(new RegExp(`${comparison}\\s+(?:AND|&&)\\s+`, 'gi'), '')
    .replace(new RegExp(`\\(?\\s*${comparison}\\s*\\)?`, 'gi'), 'true')
    .replace(/\(\s*true\s*\)/gi, 'true')
    .replace(/\s+/g, ' ')
    .trim();
  next = next
    .replace(/^\s*(?:AND|&&)\s+/i, '')
    .replace(/\s+(?:AND|&&)\s*$/i, '')
    .trim();
  return next || source;
}

function isTimeTriggerBlock(block) {
  const config = normalizeConfigObject(block?.config);
  const text = [
    normalizeText(block?.id),
    normalizeText(config.name),
    normalizeText(config.label),
    normalizeText(config.triggerType),
    normalizeText(config.type),
    normalizeText(config.semanticType),
  ].join(' ').toLowerCase();
  return normalizeText(block?.type) === 'trigger' && /time|timer|schedule|interval|cron|주기|시간/.test(text);
}

function isTimePulseNormalBlock(block, blocks, connections) {
  if (normalizeText(block?.type) !== 'normal') {
    return false;
  }
  const config = normalizeConfigObject(block?.config);
  const text = [
    normalizeText(block?.id),
    normalizeText(config.name),
    normalizeText(config.label),
    normalizeText(config.semanticType),
    normalizeText(config.expression || config.formula || config.code || config.logic),
  ].join(' ').toLowerCase();
  if (!/time[_\s-]*pulse|timer[_\s-]*pulse|trigger[_\s-]*time|주기적\s*평가|시간\s*펄스/.test(text)) {
    return false;
  }
  const blockByID = new Map(blocks.map((candidate) => [normalizeText(candidate.id), candidate]));
  const incomingTrigger = connections.some((connection) =>
    normalizeText(connection.toId) === normalizeText(block.id) &&
    isTimeTriggerBlock(blockByID.get(normalizeText(connection.fromId))));
  const expression = normalizeText(config.expression || config.formula || config.code || config.logic);
  const expressionTrigger = blocks.some((candidate) =>
    isTimeTriggerBlock(candidate) && conditionMentionsBlockId(expression, candidate.id));
  return incomingTrigger || expressionTrigger;
}

function normalizeRuntimeGraphTopology(blocks, connections) {
  let nextBlocks = Array.isArray(blocks) ? blocks.map((block) => ({ ...block, config: { ...(block.config || {}) } })) : [];
  let nextConnections = Array.isArray(connections) ? connections.map((connection) => ({ ...connection })) : [];
  const blockByID = () => new Map(nextBlocks.map((block) => [normalizeText(block.id), block]));
  const makeConnectionId = (prefix, fromId, toId) => `${prefix}-${slugifyForPath(fromId, 'from')}-${slugifyForPath(toId, 'to')}`;
  const hasConnection = (kind, fromId, toId) => nextConnections.some((connection) =>
    normalizeText(connection.kind) === kind &&
    normalizeText(connection.fromId) === normalizeText(fromId) &&
    normalizeText(connection.toId) === normalizeText(toId));

  const timePulseBlocks = nextBlocks.filter((block) => isTimePulseNormalBlock(block, nextBlocks, nextConnections));
  if (timePulseBlocks.length > 0) {
    for (const pulse of timePulseBlocks) {
      const blocksByID = blockByID();
      const pulseId = normalizeText(pulse.id);
      const config = normalizeConfigObject(pulse.config);
      const expression = normalizeText(config.expression || config.formula || config.code || config.logic);
      const sourceTriggers = uniqueStrings([
        ...nextConnections
          .filter((connection) => normalizeText(connection.toId) === pulseId)
          .map((connection) => normalizeText(connection.fromId)),
        ...nextBlocks
          .filter((candidate) => isTimeTriggerBlock(candidate) && conditionMentionsBlockId(expression, candidate.id))
          .map((candidate) => normalizeText(candidate.id)),
      ]).filter((id) => isTimeTriggerBlock(blocksByID.get(id)));
      const targetTriggers = uniqueStrings([
        ...nextConnections
          .filter((connection) => normalizeText(connection.fromId) === pulseId)
          .map((connection) => normalizeText(connection.toId)),
        ...nextBlocks
          .filter((candidate) =>
            normalizeText(candidate.type) === 'trigger' &&
            conditionMentionsBlockId(blockConfigText(candidate, ['condition', 'expression', 'logic']), pulseId))
          .map((candidate) => normalizeText(candidate.id)),
      ]).filter((id) => normalizeText(blocksByID.get(id)?.type) === 'trigger');

      for (const sourceId of sourceTriggers) {
        for (const targetId of targetTriggers) {
          if (sourceId === targetId || hasConnection('trigger-input', sourceId, targetId)) {
            continue;
          }
          nextConnections.push({
            id: makeConnectionId('auto-trigger-input', sourceId, targetId),
            kind: 'trigger-input',
            fromId: sourceId,
            toId: targetId,
          });
        }
      }

      nextBlocks = nextBlocks.map((block) => {
        if (normalizeText(block.type) !== 'trigger') {
          return block;
        }
        const triggerConfig = normalizeConfigObject(block.config);
        const condition = normalizeText(triggerConfig.condition || triggerConfig.expression || triggerConfig.logic);
        if (!conditionMentionsBlockId(condition, pulseId)) {
          return block;
        }
        return {
          ...block,
          config: {
            ...triggerConfig,
            condition: stripGateReferenceFromCondition(condition, pulseId),
          },
        };
      });
    }
    const removable = new Set(timePulseBlocks.map((block) => normalizeText(block.id)));
    nextBlocks = nextBlocks.filter((block) => !removable.has(normalizeText(block.id)));
    nextConnections = nextConnections.filter((connection) =>
      !removable.has(normalizeText(connection.fromId)) &&
      !removable.has(normalizeText(connection.toId)));
  }

  const normalizedBlockByID = blockByID();
  nextConnections = nextConnections
    .map((connection) => {
      const fromType = normalizedBlockByID.get(normalizeText(connection.fromId))?.type || '';
      const toType = normalizedBlockByID.get(normalizeText(connection.toId))?.type || '';
      return {
        ...connection,
        kind: normalizeSchemaConnectionKind(connection.kind, fromType, toType),
      };
    })
    .filter((connection) => normalizeText(connection.kind));

  return { blocks: nextBlocks, connections: nextConnections };
}

function coerceStrategyGraphForSchema(rawGraph, prompt = '') {
  const graph = normalizeObject(rawGraph) || {};
  const rawBlocks = Array.isArray(graph.blocks) ? graph.blocks : [];
  const blocks = rawBlocks.map((rawBlock, index) => {
    const block = normalizeObject(rawBlock) || {};
    const config = normalizeConfigObject(block.config);
    const id = normalizeText(block.id || block.blockId || block.nodeId || block.name || block.label)
      || `block-${index + 1}`;
    return {
      ...block,
      id,
      type: normalizeSchemaBlockType(block.type || block.kind || block.nodeCategory || block.category, config),
      config,
    };
  });

  const blockByID = new Map(blocks.map((block) => [block.id, block]));
  const rawConnections = Array.isArray(graph.connections)
    ? graph.connections
    : Array.isArray(graph.edges)
      ? graph.edges
      : [];
  const connections = rawConnections.map((rawConnection, index) => {
    const connection = normalizeObject(rawConnection) || {};
    const fromId = normalizeText(connection.fromId || connection.from || connection.source || connection.sourceId);
    const toId = normalizeText(connection.toId || connection.to || connection.target || connection.targetId);
    const fromType = blockByID.get(fromId)?.type || '';
    const toType = blockByID.get(toId)?.type || '';
    const kind = normalizeSchemaConnectionKind(connection.kind || connection.type || connection.label || connection.relation, fromType, toType);
    return {
      ...connection,
      id: normalizeText(connection.id) || `conn-${index + 1}`,
      kind,
      fromId,
      toId,
    };
  });
  const normalizedGraphShape = normalizeRuntimeGraphTopology(blocks, connections);

  const strategy = normalizeObject(graph.strategy) || {};
  const name = normalizeText(strategy.name || graph.name || graph.title || prompt) || 'AI Generated Strategy';
  const id = normalizeText(strategy.id) || slugifyForPath(name, 'ai-generated-strategy');

  return {
    ...graph,
    schemaVersion: Number(graph.schemaVersion) || 1,
    kind: 'hershy-strategy-graph',
    strategy: { ...strategy, id, name },
    blocks: normalizedGraphShape.blocks,
    connections: normalizedGraphShape.connections,
  };
}

function parseStrategyGenerationPackage(rawText) {
  const parsed = parseJSONObjectContent(rawText, 'strategy generation package');
  const rawRuntimeGraph = parsed && typeof parsed.runtimeGraph === 'object' && !Array.isArray(parsed.runtimeGraph)
    ? parsed.runtimeGraph
    : parsed;
  const runtimeGraph = coerceStrategyGraphForSchema(
    rawRuntimeGraph,
    normalizeText(parsed?.intentPlan?.sourcePrompt || parsed?.metadata?.sourcePrompt),
  );
  const errors = validateSchema(runtimeGraph, STRATEGY_GRAPH_SCHEMA, 'runtimeGraph');
  if (errors.length > 0) {
    throw new Error(`runtimeGraph schema validation failed: ${errors.slice(0, 10).join('; ')}`);
  }
  return {
    intentPlan: normalizeObject(parsed.intentPlan),
    logicIR: normalizeObject(parsed.logicIR),
    runtimeGraph,
  };
}

function resolveIntegerEnv(key, fallback) {
  const parsed = Number.parseInt(normalizeText(process.env[key]), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function slugifyForPath(value, fallback = 'strategy') {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function normalizeConfigObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function numberFromConfig(config, keys, fallback) {
  for (const key of keys) {
    const value = config[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function firstConfigText(config, keys, fallback = '') {
  for (const key of keys) {
    const text = normalizeText(config[key]);
    if (text) {
      return text;
    }
  }
  return fallback;
}

function stringArrayFromConfig(config, keys, fallback) {
  for (const key of keys) {
    const value = config[key];
    if (Array.isArray(value)) {
      const items = value.map((item) => normalizeText(item)).filter(Boolean);
      if (items.length > 0) {
        return items;
      }
    }
    if (value && typeof value === 'object') {
      const items = Object.keys(value).map((item) => normalizeText(item)).filter(Boolean);
      if (items.length > 0) {
        return items;
      }
    }
    const text = normalizeText(value);
    if (text) {
      const items = text.split(',').map((item) => normalizeText(item)).filter(Boolean);
      if (items.length > 0) {
        return items;
      }
    }
  }
  return fallback;
}

function countStrategyBlocksByType(blocks) {
  return blocks.reduce((acc, block) => {
    const type = normalizeText(block?.type) || 'normal';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

function normalizeRunnerBlock(block, index, fallbackStreamID) {
  const id = normalizeText(block?.id) || `block-${index + 1}`;
  const type = normalizeText(block?.type) || 'normal';
  const config = normalizeConfigObject(block?.config);
  const name = firstConfigText(config, ['name', 'label', 'title', 'functionName', 'symbol'], id);
  const normalized = {
    id,
    type,
    config: {
      ...config,
      name,
    },
  };

  if (type === 'streaming') {
    normalized.config.sourceUrl = firstConfigText(
      config,
      ['sourceUrl', 'sourceURL', 'url', 'endpoint', 'apiReference', 'source'],
      `synthetic://${id}`,
    );
    normalized.config.updateMode = firstConfigText(config, ['updateMode', 'method', 'mode'], 'periodic');
    normalized.config.updateIntervalMs = numberFromConfig(
      config,
      ['updateIntervalMs', 'intervalMs', 'pollMs', 'interval', 'seconds'],
      1000,
    );
    normalized.config.fields = stringArrayFromConfig(
      config,
      ['fields', 'outputs', 'outputFields'],
      ['lastPrice', 'volume', 'eventTime'],
    );
  }

  if (type === 'normal') {
    normalized.config.value = config.value ?? config.threshold ?? config.defaultValue ?? 0;
  }

  if (type === 'trigger') {
    const rawTriggerType = firstConfigText(config, ['triggerType', 'type'], '');
    const hasCondition = Boolean(normalizeText(config.condition || config.expression || config.logic));
    const looksLikeTimeTrigger =
      !rawTriggerType &&
      !hasCondition &&
      (
        isNumericValue(config.intervalMs) ||
        isNumericValue(config.interval) ||
        isNumericValue(config.seconds) ||
        Boolean(firstConfigText(config, ['schedule', 'cron'], '')) ||
        /dca|interval|cadence|schedule|timer|time|cron|주기|시간/.test(name.toLowerCase())
      );
    normalized.config.triggerType = rawTriggerType || (looksLikeTimeTrigger ? 'time' : 'condition');
    const rawIntervalValue = config.intervalMs ?? config.updateIntervalMs ?? config.interval ?? config.seconds;
    const intervalLabel = config.intervalMs !== undefined || config.updateIntervalMs !== undefined
      ? 'ms'
      : config.seconds !== undefined
        ? 'seconds'
        : firstConfigText(config, ['intervalUnit', 'unit'], name);
    normalized.config.intervalMs = normalizeIntervalToMs(rawIntervalValue, intervalLabel) ?? 1000;
    if (normalized.config.triggerType === 'condition') {
      normalized.config.condition = normalizeText(config.condition || config.expression || config.logic);
    }
  }

  if (type === 'action') {
    normalized.config.actionType = firstConfigText(config, ['actionType', 'venueType', 'adapter'], 'cex').toLowerCase();
    normalized.config.exchange = firstConfigText(config, ['exchange', 'venue'], 'Binance');
    if (!Array.isArray(normalized.config.outputBlocks) && !Array.isArray(normalized.config.outputs)) {
      const isDex = /dex|swap|contract|onchain/.test(normalized.config.actionType);
      normalized.config.outputBlocks = isDex
        ? [
          { id: 'txHash', name: 'txHash', type: 'output', description: 'submitted transaction hash' },
          { id: 'status', name: 'status', type: 'output', description: 'transaction status' },
          { id: 'amountOut', name: 'amountOut', type: 'output', description: 'received amount' },
          { id: 'executionPrice', name: 'executionPrice', type: 'output', description: 'realized execution price' },
        ]
        : [
          { id: 'orderId', name: 'orderId', type: 'output', description: 'exchange order id' },
          { id: 'status', name: 'status', type: 'output', description: 'order status' },
          { id: 'filledQty', name: 'filledQty', type: 'output', description: 'filled quantity' },
          { id: 'avgFillPrice', name: 'avgFillPrice', type: 'output', description: 'average fill price' },
        ];
    }
  }

  if (type === 'monitoring') {
    normalized.config.metric = firstConfigText(config, ['metric', 'field'], 'lastPrice');
    normalized.config.fields = stringArrayFromConfig(config, ['fields', 'selectedVariables'], [normalized.config.metric]);
    if (!normalizeText(normalized.config.connectedStreamId) && fallbackStreamID) {
      normalized.config.connectedStreamId = fallbackStreamID;
    }
  }

  return normalized;
}

function inferRunnerConnectionKind(fromType, toType, rawKind) {
  const kind = normalizeText(rawKind);
  if (
    (kind === 'trigger-action' || kind === 'trigger-input' || kind === 'action-input' || kind === 'stream-monitor' || kind === 'data-flow' || kind === 'action-result') &&
    isSchemaConnectionKindCompatible(kind, fromType, toType)
  ) {
    return kind;
  }
  if (fromType === 'trigger' && toType === 'action') {
    return 'trigger-action';
  }
  if (fromType === 'trigger' && toType === 'trigger') {
    return 'trigger-input';
  }
  if (fromType === 'action' && (toType === 'normal' || toType === 'trigger' || toType === 'monitoring')) {
    return 'action-result';
  }
  if (fromType === 'streaming' && toType === 'monitoring') {
    return 'stream-monitor';
  }
  if ((fromType === 'streaming' || fromType === 'normal' || fromType === 'monitoring') && (toType === 'normal' || toType === 'trigger' || toType === 'monitoring')) {
    return 'data-flow';
  }
  if ((fromType === 'streaming' || fromType === 'normal') && toType === 'action') {
    return 'action-input';
  }
  return '';
}

function addRunnerConnection(connections, existing, kind, fromId, toId, idPrefix, extra = {}) {
  if (!fromId || !toId || fromId === toId) {
    return;
  }
  const key = `${kind}:${fromId}:${toId}`;
  if (existing.has(key)) {
    return;
  }
  existing.add(key);
  connections.push({
    id: `${idPrefix}-${connections.length + 1}`,
    kind,
    fromId,
    toId,
    ...extra,
  });
}

function makeUniqueBlockId(blocks, preferredId) {
  const used = new Set(blocks.map((block) => normalizeText(block?.id)).filter(Boolean));
  const base = slugifyForPath(preferredId, 'block');
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

function isKillSwitchBlock(block) {
  const config = normalizeConfigObject(block?.config);
  if (config.killSwitch === true || config.emergencyStop === true || config.circuitBreaker === true) {
    return true;
  }
  const text = [
    normalizeText(block?.id),
    normalizeText(block?.type),
    collectObjectText(config),
  ].join(' ').toLowerCase();
  return /kill\s*switch|killswitch|emergency|panic|circuit\s*breaker|manual\s*(halt|stop)|global\s*(halt|stop)|stop\s*all|halt\s*strategy|킬\s*스위치|긴급|비상|강제\s*중단|전체\s*(중단|정지|청산)/.test(text);
}

function hasRuntimeKillSwitch(blocks, connections) {
  const killTriggers = new Set(
    blocks
      .filter((block) => normalizeText(block?.type) === 'trigger' && isKillSwitchBlock(block))
      .map((block) => normalizeText(block.id)),
  );
  const killActions = new Set(
    blocks
      .filter((block) => normalizeText(block?.type) === 'action' && isKillSwitchBlock(block))
      .map((block) => normalizeText(block.id)),
  );
  if (killTriggers.size === 0 || killActions.size === 0) {
    return false;
  }
  return connections.some((connection) =>
    normalizeText(connection?.kind) === 'trigger-action' &&
    killTriggers.has(normalizeText(connection?.fromId)) &&
    killActions.has(normalizeText(connection?.toId)));
}

function defaultKillSwitchExchangeName(exchangeConnections = []) {
  const connected = getConnectedExchangeConnections(exchangeConnections);
  return normalizeText(connected[0]?.name || connected[0]?.id) || 'Binance';
}

function inferSafeAssetFromBlocks(blocks) {
  const text = blocks
    .filter((block) => normalizeText(block?.type) === 'action')
    .map((block) => collectObjectText(block))
    .join(' ')
    .toUpperCase();
  for (const asset of ['USDC', 'USDT', 'DAI', 'USD', 'KRW']) {
    if (text.includes(asset)) return asset;
  }
  return 'USDC';
}

function inferKillSwitchActionConfig(blocks, exchangeConnections = []) {
  const connected = getConnectedExchangeConnections(exchangeConnections)[0];
  const venueName = normalizeText(connected?.name || connected?.id) || 'Binance';
  const safeAsset = inferSafeAssetFromBlocks(blocks);
  const actionText = blocks
    .filter((block) => normalizeText(block?.type) === 'action')
    .map((block) => collectObjectText(block))
    .join(' ')
    .toLowerCase();
  const useDex = normalizeText(connected?.type).toUpperCase() !== 'CEX' ||
    /dex|swap|contract|onchain|flash\s*loan|flashloan|uniswap|jupiter|aave|온체인|스왑|플래시론/.test(actionText);

  if (useDex) {
    return {
      actionType: 'dex',
      exchange: venueName,
      chain: normalizeText(connected?.name || connected?.id) || 'configured-chain',
      contractAddress: '0x0000000000000000000000000000000000000000',
      functionName: 'emergencyExitToStableAsset()',
      safeAsset,
      targetToken: safeAsset,
      capitalSink: `${safeAsset} wallet balance`,
      safetyObjective: 'move_strategy_assets_to_lower_volatility_asset',
      closeAllPositions: true,
      cancelOpenOrders: true,
    };
  }

  return {
    actionType: 'cex',
    exchange: venueName,
    symbol: `ALL/${safeAsset}`,
    side: 'SELL',
    orderType: 'MARKET',
    safeAsset,
    targetAsset: safeAsset,
    capitalSink: `${venueName} ${safeAsset} spot/free balance`,
    safetyObjective: 'move_strategy_assets_to_lower_volatility_asset',
    reduceOnly: true,
    cancelOpenOrders: true,
    closeAllPositions: true,
  };
}

function ensureRuntimeKillSwitch(blocks, connections, existing, exchangeConnections = []) {
  if (hasRuntimeKillSwitch(blocks, connections)) {
    return;
  }

  const triggerId = makeUniqueBlockId(blocks, 'kill-switch-trigger');
  const actionId = makeUniqueBlockId(blocks, 'kill-switch-close-all');
  const dataSource = blocks.find((block) => block.type === 'streaming') || blocks.find((block) => block.type === 'normal');
  const actionConfig = inferKillSwitchActionConfig(blocks, exchangeConnections);
  blocks.push({
    id: triggerId,
    type: 'trigger',
    config: {
      name: '킬스위치',
      label: '킬스위치',
      triggerType: 'condition',
      condition: 'manual_kill_switch == true || strategy_drawdown_pct <= -5 || data_stale_seconds >= 30 || exchange_disconnect == true',
      killSwitch: true,
      emergencyStop: true,
      safeAsset: actionConfig.safeAsset,
      capitalSink: actionConfig.capitalSink,
      safetyObjective: 'move_strategy_assets_to_lower_volatility_asset',
      overviewDescription: '수동 중단, 손실 한도, 데이터 지연, 거래소 연결 이상이 감지되면 전략을 즉시 멈추고 자산을 더 안정적인 자산으로 회수합니다.',
      roleDescription: '이 전략의 최종 안전장치입니다. 정상 매매 조건과 별개로 위험 상태가 발생하면 전체 종료 액션으로 신호를 보냅니다.',
      inputSummary: '수동 중단 상태, 누적 손실률, 데이터 지연 시간, 거래소 연결 상태',
      outputSummary: `전체 포지션 정리 및 ${actionConfig.safeAsset || 'stable asset'} 회수 신호`,
      outputBlocks: [
        { id: 'emergencyStop', name: 'emergencyStop', type: 'output', description: 'true when the strategy must stop immediately' },
      ],
    },
  });
  blocks.push({
    id: actionId,
    type: 'action',
    config: {
      name: '킬스위치 실행',
      label: '킬스위치 실행',
      ...actionConfig,
      allowRawFeedInputs: true,
      rawFeedInputReason: 'kill_switch',
      killSwitch: true,
      emergencyStop: true,
      overviewDescription: `열려 있는 주문을 취소하고 전략이 만든 포지션을 가능한 한 시장가/감소 전용으로 정리한 뒤 ${actionConfig.safeAsset || '안전자산'} 쪽으로 회수합니다.`,
      roleDescription: '킬스위치 조건이 켜졌을 때만 실행되는 종료 액션입니다. 새 진입을 막고 기존 노출을 낮은 변동성 자산으로 줄이는 역할을 합니다.',
      inputSummary: '킬스위치 신호와 최신 시장/계정 상태',
      outputSummary: `취소/청산 요청 상태와 ${actionConfig.safeAsset || '안전자산'} 회수 결과`,
      outputBlocks: [
        { id: 'status', name: 'status', type: 'output', description: 'kill switch execution status' },
        { id: 'closedPositions', name: 'closedPositions', type: 'output', description: 'positions requested for closure' },
        { id: 'cancelledOrders', name: 'cancelledOrders', type: 'output', description: 'open orders requested for cancellation' },
      ],
    },
  });
  addRunnerConnection(connections, existing, 'trigger-action', triggerId, actionId, 'auto-kill-switch');
  if (dataSource?.id) {
    addRunnerConnection(connections, existing, 'action-input', dataSource.id, actionId, 'auto-kill-switch-input', {
      reason: 'kill_switch',
      label: 'safety context',
    });
  }
}

function connectionKey(connection) {
  return `${connection.kind}:${connection.fromId}:${connection.toId}`;
}

function rebuildConnectionSet(connections) {
  return new Set(connections.map(connectionKey));
}

function isNumericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function getNormalFixedValue(block) {
  const config = normalizeConfigObject(block?.config);
  for (const key of ['value', 'constant', 'intervalMs', 'interval', 'seconds']) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
      return config[key];
    }
  }
  return undefined;
}

function isTimeIntervalNormalBlock(block) {
  if (normalizeText(block?.type) !== 'normal') {
    return false;
  }
  const config = normalizeConfigObject(block?.config);
  const name = firstConfigText(config, ['name', 'label', 'title'], normalizeText(block?.id));
  const value = getNormalFixedValue(block);
  return isNumericValue(value) && /interval|cadence|period|schedule|time|timer|cron|ms|seconds|minutes|hours|days|주기|시간/.test(name.toLowerCase());
}

function conditionMentionsBlockId(condition, id) {
  const text = normalizeText(condition);
  const blockId = normalizeText(id);
  if (!text || !blockId) {
    return false;
  }
  if (text.includes(`${blockId}::`)) {
    return true;
  }
  return new RegExp(`(^|[^a-zA-Z0-9_-])${blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zA-Z0-9_-]|$)`).test(text);
}

function normalizeIntervalToMs(value, label = '') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  const normalizedLabel = label.toLowerCase();
  if (/millisecond|ms/.test(normalizedLabel)) return Math.round(numeric);
  if (/day|daily|일/.test(normalizedLabel)) return Math.round(numeric * 86_400_000);
  if (/hour|hr|시간/.test(normalizedLabel)) return Math.round(numeric * 3_600_000);
  if (/minute|min|분/.test(normalizedLabel)) return Math.round(numeric * 60_000);
  if (/second|sec|초/.test(normalizedLabel)) return Math.round(numeric * 1000);
  return numeric >= 10_000 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function isTimeLikeTriggerConfig(config) {
  const triggerType = firstConfigText(config, ['triggerType', 'type'], '').toLowerCase();
  const condition = normalizeText(config.condition || config.expression || config.logic).toLowerCase();
  const hasTimeTriggerType = ['time', 'timer', 'schedule', 'scheduled', 'interval', 'cron'].includes(triggerType);
  return (
    hasTimeTriggerType ||
    Boolean(firstConfigText(config, ['schedule', 'cron'], '')) ||
    (!condition && (isNumericValue(config.interval) || isNumericValue(config.seconds))) ||
    /::pulse\b|eventtime\s*%|timestamp\s*%|datetime\s*%/.test(condition)
  );
}

function deriveTimeTriggerIntervalMs(triggerBlock, blockByID) {
  const config = normalizeConfigObject(triggerBlock?.config);
  const explicitMs = numberFromConfig(config, ['intervalMs', 'updateIntervalMs'], Number.NaN);
  if (Number.isFinite(explicitMs) && explicitMs > 0 && firstConfigText(config, ['triggerType', 'type'], '').toLowerCase() === 'time') {
    return Math.round(explicitMs);
  }

  const explicitInterval = numberFromConfig(config, ['interval', 'seconds'], Number.NaN);
  if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
    return explicitInterval < 10000 ? Math.round(explicitInterval * 1000) : Math.round(explicitInterval);
  }

  const condition = normalizeText(config.condition || config.expression || config.logic);
  for (const [id, block] of blockByID.entries()) {
    if (!conditionMentionsBlockId(condition, id) || !isTimeIntervalNormalBlock(block)) {
      continue;
    }
    const label = firstConfigText(block.config || {}, ['name', 'label', 'title'], id);
    const intervalMs = normalizeIntervalToMs(getNormalFixedValue(block), label);
    if (intervalMs) {
      return intervalMs;
    }
  }

  const pulseMatch = condition.match(/([a-zA-Z0-9_-]+)::pulse\b/i);
  if (pulseMatch) {
    const streamConfig = normalizeConfigObject(blockByID.get(pulseMatch[1])?.config);
    const streamInterval = numberFromConfig(streamConfig, ['updateIntervalMs', 'intervalMs', 'pollMs'], Number.NaN);
    if (Number.isFinite(streamInterval) && streamInterval > 0) {
      return Math.round(streamInterval);
    }
  }

  return Number.isFinite(explicitMs) && explicitMs > 0 ? Math.round(explicitMs) : undefined;
}

function forceTimeTriggersIntoTriggerBlocks(blocks, connections) {
  let changed = false;
  const blockByID = new Map(blocks.map((block) => [block.id, block]));
  const removableIntervalIDs = new Set();
  const nextBlocks = blocks.map((block) => {
    if (block.type !== 'trigger' || !isTimeLikeTriggerConfig(block.config || {})) {
      return block;
    }

    const intervalMs = deriveTimeTriggerIntervalMs(block, blockByID);
    if (!intervalMs) {
      return block;
    }

    const condition = normalizeText(block.config?.condition || block.config?.expression || block.config?.logic);
    for (const [id, candidate] of blockByID.entries()) {
      if (conditionMentionsBlockId(condition, id) && isTimeIntervalNormalBlock(candidate)) {
        removableIntervalIDs.add(id);
      }
    }

    changed = true;
    const { condition: _condition, expression: _expression, logic: _logic, ...restConfig } = block.config || {};
    return {
      ...block,
      config: {
        ...restConfig,
        triggerType: 'time',
        intervalMs,
        name: firstConfigText(block.config || {}, ['name', 'label', 'title'], block.id),
      },
    };
  });

  if (!changed && removableIntervalIDs.size === 0) {
    return { blocks, connections };
  }

  const filteredBlocks = nextBlocks.filter((block) => !removableIntervalIDs.has(block.id));
  const filteredConnections = connections.filter(
    (connection) => !removableIntervalIDs.has(connection.fromId) && !removableIntervalIDs.has(connection.toId),
  );

  return { blocks: filteredBlocks, connections: filteredConnections };
}

const REQUIRED_SIGNAL_BY_STRATEGY_KIND = {
  spot_perp_basis: ['basis'],
  spread: ['spread'],
  moving_average: ['moving_average'],
  rsi: ['rsi'],
  funding_rate: ['funding_rate'],
};

const TIME_STRATEGY_KIND_SET = new Set(['dca', 'rebalance']);
const ALLOWED_RAW_ACTION_INPUT_REASONS = new Set([
  'slippage_guard',
  'quote_preview',
  'execution_price',
  'monitoring_context',
  'risk_control',
  'kill_switch',
]);
const GENERIC_SIGNAL_TOKENS = new Set([
  'normal',
  'formula',
  'indicator',
  'computed',
  'computation',
  'calculation',
  'signal',
  'node',
  'logic',
  'value',
  'output',
]);
const RAW_FEED_SIGNAL_TOKENS = new Set([
  'price',
  'spot_price',
  'perp_price',
  'market_price',
  'mark_price',
  'index_price',
  'last_price',
  'lastprice',
  'volume',
  'open',
  'high',
  'low',
  'close',
  'ohlcv',
  'ticker',
  'candle',
  'candles',
  'funding_rate',
  'open_interest',
]);

function normalizeToken(value) {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  const text = normalizeText(value);
  return text ? [text] : [];
}

function uniqueStrings(items) {
  return Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeRequiredSignalName(value) {
  const rawText = normalizeText(value).toLowerCase();
  let token = normalizeToken(value)
    .replace(/_formula$|_signal$|_node$|_calculation$|_computed$/g, '');
  if (rawText.includes('basis') && /[:=()+*/]|::|formula/.test(rawText)) {
    token = 'basis';
  }
  token = token
    .replace(/_formula_raw$|_raw_formula$|_raw$/g, '')
    .replace(/_pass_through$|_passthrough$/g, '');
  if (token === 'basis_calc') {
    token = 'basis';
  }
  return token;
}

function isRawFeedSignalToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return false;
  }
  if (RAW_FEED_SIGNAL_TOKENS.has(normalized)) {
    return true;
  }
  if (/^(spot|perp|future|futures|market|mark|index)?price$/.test(normalized)) {
    return true;
  }
  if (/^(spot|perp|future|futures|market|mark|index)?lastprice$/.test(normalized)) {
    return true;
  }
  if (/^(spot|perp|future|futures|market|mark|index)?(volume|open|high|low|close)$/.test(normalized)) {
    return true;
  }
  if (/^(fundingrate|funding_rate|openinterest|open_interest)$/.test(normalized)) {
    return true;
  }
  if (/(^|_)(price|lastprice|last_price|markprice|mark_price|indexprice|index_price|volume|open|high|low|close|ohlcv|ticker|candle|candles)$/.test(normalized)) {
    return true;
  }
  return /_(spot|perp|future|futures)?_?(price|lastprice|last_price|markprice|mark_price|indexprice|index_price)$/.test(normalized);
}

function collectObjectText(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => collectObjectText(item, depth + 1)).join(' ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${key} ${collectObjectText(item, depth + 1)}`)
      .join(' ');
  }
  return '';
}

function inferStrategyKindsFromText(text) {
  const normalized = normalizeText(text).toLowerCase();
  const kinds = [];
  if (/(spot|현물).*(perp|future|선물)|현선|basis|베이시스|괴리|가격차|basis/.test(normalized)) {
    kinds.push('spot_perp_basis');
  }
  if (/dca|dollar\s*cost|적립|분할\s*매수|정기\s*매수/.test(normalized)) {
    kinds.push('dca');
  }
  if (/moving\s*average|\bma\b|이동\s*평균|이평|20ma|50ma|200ma/.test(normalized)) {
    kinds.push('moving_average');
  }
  if (/\brsi\b/.test(normalized)) {
    kinds.push('rsi');
  }
  if (/funding|펀딩/.test(normalized)) {
    kinds.push('funding_rate');
  }
  if (/spread|스프레드/.test(normalized)) {
    kinds.push('spread');
  }
  if (/rebalance|리밸런스|재조정/.test(normalized)) {
    kinds.push('rebalance');
  }
  if (/pure\s*execution|단순\s*실행/.test(normalized)) {
    kinds.push('pure_execution');
  }
  return uniqueStrings(kinds);
}

function inferRequiredTriggerTypesFromText(text, strategyKinds = []) {
  const normalized = normalizeText(text).toLowerCase();
  const required = [];
  if (strategyKinds.some((kind) => TIME_STRATEGY_KIND_SET.has(kind))) {
    required.push('time');
  }
  if (/every\s+\d+|per\s+\d+|schedule|scheduled|interval|cadence|cron|daily|hourly|weekly|마다|주기|정기|매일|매시간|몇\s*시간|몇\s*분|몇\s*초/.test(normalized)) {
    required.push('time');
  }
  if (/if|when|condition|threshold|cross|above|below|greater|less|충족|조건|돌파|상향|하향|이상|이하|초과|미만/.test(normalized)) {
    required.push('condition');
  }
  return uniqueStrings(required);
}

function strategyKindFromSignals(requiredSignals) {
  const signals = requiredSignals.map(normalizeToken);
  if (signals.includes('basis')) return 'spot_perp_basis';
  if (signals.includes('spread')) return 'spread';
  if (signals.includes('moving_average')) return 'moving_average';
  if (signals.includes('rsi')) return 'rsi';
  if (signals.includes('funding_rate')) return 'funding_rate';
  return '';
}

function getLogicIRRequirements(logicIR) {
  return Array.isArray(logicIR?.requirements) ? logicIR.requirements.filter((item) => item && typeof item === 'object') : [];
}

function getLogicIRNodes(logicIR) {
  if (Array.isArray(logicIR?.nodes)) {
    return logicIR.nodes.filter((item) => item && typeof item === 'object');
  }
  const legacyNodes = [];
  if (Array.isArray(logicIR?.requiredDataFeeds)) {
    legacyNodes.push(...logicIR.requiredDataFeeds.map((node) => ({ ...node, nodeCategory: 'data_feed' })));
  }
  if (Array.isArray(logicIR?.computedSignals)) {
    legacyNodes.push(...logicIR.computedSignals.map((node) => ({
      ...node,
      nodeCategory: 'compute',
      semanticType: node?.semanticType || node?.kind || node?.id,
    })));
  }
  if (Array.isArray(logicIR?.triggers)) {
    legacyNodes.push(...logicIR.triggers.map((node) => ({ ...node, nodeCategory: 'trigger', triggerType: node?.triggerType || node?.kind })));
  }
  if (Array.isArray(logicIR?.actions)) {
    legacyNodes.push(...logicIR.actions.map((node) => ({ ...node, nodeCategory: 'action', actionType: node?.actionType || node?.kind })));
  }
  return legacyNodes;
}

function getLogicIREdges(logicIR) {
  if (Array.isArray(logicIR?.edges)) {
    return logicIR.edges.filter((item) => item && typeof item === 'object');
  }
  return Array.isArray(logicIR?.flow) ? logicIR.flow.filter((item) => item && typeof item === 'object') : [];
}

function getLogicIRClassificationValues(logicIR) {
  const classification = normalizeObject(logicIR?.classification);
  return [
    normalizeText(classification?.primary),
    ...normalizeStringList(classification?.tags),
    normalizeText(logicIR?.strategyKind),
  ].filter(Boolean);
}

function deriveStrategySemantics({ strategyGraph, prompt, intentPlan, logicIR }) {
  const metadata = normalizeObject(strategyGraph?.metadata) || {};
  const requirements = getLogicIRRequirements(logicIR);
  const logicNodes = getLogicIRNodes(logicIR);
  const text = [
    prompt,
    collectObjectText(intentPlan),
    collectObjectText(logicIR),
    collectObjectText(metadata),
  ].join(' ');

  const kinds = uniqueStrings([
    ...normalizeStringList(metadata.strategyKinds),
    normalizeText(metadata.strategyKind),
    ...normalizeStringList(intentPlan?.detectedStrategyKinds),
    ...getLogicIRClassificationValues(logicIR),
    ...inferStrategyKindsFromText(text),
  ].map(normalizeToken));

  const requiredSignals = uniqueStrings([
    ...normalizeStringList(metadata.requiredSignals),
    ...normalizeStringList(logicIR?.requiredSignals),
    ...normalizeStringList(intentPlan?.requiredComputationNodes),
    ...requirements
      .filter((requirement) => /requires_computation|requires_predicate|requires_indicator|requires_signal/.test(normalizeToken(requirement.kind)))
      .map((requirement) => requirement.semanticType || requirement.dataKind || requirement.id),
    ...logicNodes
      .filter((node) => /compute|predicate/.test(normalizeToken(node.nodeCategory || node.category)))
      .map((node) => node.semanticType || node.id || node.label),
    ...kinds.flatMap((kind) => REQUIRED_SIGNAL_BY_STRATEGY_KIND[kind] || []),
  ]
    .map(normalizeRequiredSignalName)
    .filter((item) => item && !GENERIC_SIGNAL_TOKENS.has(item) && !isRawFeedSignalToken(item)));

  const strategyKind = normalizeText(metadata.strategyKind)
    || normalizeText(logicIR?.strategyKind)
    || kinds[0]
    || strategyKindFromSignals(requiredSignals)
    || 'custom';

  const requiredTriggerTypes = uniqueStrings([
    ...normalizeStringList(metadata.requiredTriggerTypes),
    ...normalizeStringList(intentPlan?.requiredTriggerTypes),
    ...requirements
      .filter((requirement) => /requires_trigger/.test(normalizeToken(requirement.kind)))
      .map((requirement) => requirement.triggerType || requirement.type),
    ...logicNodes
      .filter((node) => normalizeToken(node.nodeCategory || node.category) === 'trigger')
      .map((node) => node.triggerType || node.type),
    ...inferRequiredTriggerTypesFromText(text, [strategyKind, ...kinds]),
  ].map(normalizeToken));

  return {
    strategyKind: normalizeToken(strategyKind) || 'custom',
    strategyKinds: uniqueStrings([strategyKind, ...kinds].map(normalizeToken)),
    requiredSignals,
    requiredTriggerTypes,
    sourcePrompt: normalizeText(metadata.sourcePrompt) || normalizeText(prompt),
  };
}

function buildStrategyMetadata(strategyGraph, prompt, intentPlan, logicIR) {
  const existing = normalizeObject(strategyGraph?.metadata) || {};
  const semantics = deriveStrategySemantics({ strategyGraph, prompt, intentPlan, logicIR });
  return {
    ...existing,
    strategyKind: semantics.strategyKind,
    strategyKinds: semantics.strategyKinds,
    requiredSignals: semantics.requiredSignals,
    requiredTriggerTypes: semantics.requiredTriggerTypes,
    sourcePrompt: semantics.sourcePrompt,
  };
}

function logicIssue(code, severity, message, evidence, repairHint) {
  return {
    code,
    severity,
    message,
    ...(evidence === undefined ? {} : { evidence }),
    ...(repairHint ? { repairHint } : {}),
  };
}

function hasBlockingLogicIssues(issues) {
  return issues.some((issue) => issue?.severity === 'error');
}

function formatLogicLintIssues(issues) {
  return (issues || [])
    .map((issue, index) => {
      const evidence = issue.evidence === undefined ? '' : ` evidence=${trimForLog(stringifyJSON(issue.evidence), 1200)}`;
      const hint = issue.repairHint ? ` repairHint=${issue.repairHint}` : '';
      return `${index + 1}. [${issue.severity || 'error'}:${issue.code || 'LOGIC_ISSUE'}] ${issue.message || 'logic issue'}${evidence}${hint}`;
    })
    .join('\n');
}

function blockConfigText(block, keys) {
  return keys.map((key) => normalizeText(block?.config?.[key])).filter(Boolean).join(' ');
}

function blockSearchText(block) {
  return [
    normalizeText(block?.id),
    blockConfigText(block, ['name', 'label', 'title', 'description', 'expression', 'formula', 'code', 'logic', 'condition']),
  ].join(' ').toLowerCase();
}

function isFormulaNormalBlock(block) {
  if (normalizeText(block?.type) !== 'normal') {
    return false;
  }
  const config = normalizeConfigObject(block?.config);
  return Boolean(firstConfigText(config, ['expression', 'formula', 'code', 'logic'], ''));
}

function formulaText(block) {
  const config = normalizeConfigObject(block?.config);
  return firstConfigText(config, ['expression', 'formula', 'code', 'logic'], '');
}

function isFixedNormalBlock(block) {
  if (normalizeText(block?.type) !== 'normal' || isFormulaNormalBlock(block)) {
    return false;
  }
  return getNormalFixedValue(block) !== undefined;
}

function normalizeSignalAliases(signal) {
  const normalized = normalizeToken(signal);
  if (normalized === 'moving_average') return ['moving_average', 'ma', 'average'];
  if (normalized === 'funding_rate') return ['funding_rate', 'funding'];
  return [normalized];
}

function blockMatchesSignal(block, signal) {
  const haystack = blockSearchText(block).replace(/[\s-]+/g, '_');
  if (normalizeSignalAliases(signal).some((alias) => haystack.includes(alias))) {
    return true;
  }

  if (!isFormulaNormalBlock(block)) {
    return false;
  }

  const normalizedSignal = normalizeToken(signal);
  const expression = formulaText(block).toLowerCase().replace(/\s+/g, '');
  const searchText = `${haystack} ${expression}`;
  if (normalizedSignal === 'basis') {
    const hasSpotLeg = /spot|현물/.test(searchText);
    const hasPerpLeg = /perp|future|futures|선물/.test(searchText);
    const hasRelativeExpression = expression.includes('-') && (expression.includes('/') || /percent|pct|%|ratio/.test(searchText));
    return hasSpotLeg && hasPerpLeg && hasRelativeExpression;
  }
  if (normalizedSignal === 'spread') {
    const hasTwoLegs = /(bid|ask|spot|perp|future|futures|cex|dex|현물|선물).*(bid|ask|spot|perp|future|futures|cex|dex|현물|선물)/.test(searchText);
    return hasTwoLegs && expression.includes('-');
  }
  return false;
}

function getIncomingConnections(graph, nodeId, kind = '') {
  return (Array.isArray(graph?.connections) ? graph.connections : []).filter((connection) =>
    connection.toId === nodeId && (!kind || connection.kind === kind));
}

function getOutgoingConnections(graph, nodeId, kind = '') {
  return (Array.isArray(graph?.connections) ? graph.connections : []).filter((connection) =>
    connection.fromId === nodeId && (!kind || connection.kind === kind));
}

function getUpstreamNodeIds(graph, nodeId) {
  const reverseAdj = new Map();
  for (const connection of Array.isArray(graph?.connections) ? graph.connections : []) {
    if (!reverseAdj.has(connection.toId)) {
      reverseAdj.set(connection.toId, []);
    }
    reverseAdj.get(connection.toId).push(connection.fromId);
  }

  const visited = new Set();
  const stack = [...(reverseAdj.get(nodeId) || [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const parent of reverseAdj.get(current) || []) {
      stack.push(parent);
    }
  }
  return Array.from(visited);
}

function hasActionResultUpstream(graph, nodeId) {
  const incomingByTarget = new Map();
  for (const connection of Array.isArray(graph?.connections) ? graph.connections : []) {
    if (!incomingByTarget.has(connection.toId)) {
      incomingByTarget.set(connection.toId, []);
    }
    incomingByTarget.get(connection.toId).push(connection);
  }
  const visited = new Set();
  const stack = [...(incomingByTarget.get(nodeId) || [])];
  while (stack.length > 0) {
    const connection = stack.pop();
    if (!connection) {
      continue;
    }
    if (connection.kind === 'action-result') {
      return true;
    }
    const source = normalizeText(connection.fromId);
    if (!source || visited.has(source)) {
      continue;
    }
    visited.add(source);
    stack.push(...(incomingByTarget.get(source) || []));
  }
  return false;
}

function getDirectIncomingTriggerIds(graph, actionId) {
  return getIncomingConnections(graph, actionId, 'trigger-action')
    .map((connection) => normalizeText(connection.fromId))
    .filter(Boolean);
}

function conditionReferencesSignal(graph, triggerBlock, requiredSignals) {
  const rawCondition = blockConfigText(triggerBlock, ['condition', 'expression', 'logic']);
  const condition = rawCondition.toLowerCase().replace(/[\s-]+/g, '_');
  const signalBlocks = (graph.blocks || []).filter((block) =>
    block.type === 'normal' && requiredSignals.some((signal) => blockMatchesSignal(block, signal)));

  if (signalBlocks.some((block) =>
    conditionMentionsBlockId(rawCondition, block.id) || condition.includes(normalizeToken(block.id)))) {
    return true;
  }

  if (requiredSignals.some((signal) => normalizeSignalAliases(signal).some((alias) => condition.includes(alias)))) {
    return true;
  }

  const incoming = getIncomingConnections(graph, triggerBlock.id, 'data-flow');
  return incoming.some((connection) => signalBlocks.some((block) => block.id === connection.fromId));
}

function conditionReferencesRawFeed(graph, triggerBlock) {
  const condition = blockConfigText(triggerBlock, ['condition', 'expression', 'logic']);
  return (graph.blocks || []).some((block) =>
    block.type === 'streaming' && conditionMentionsBlockId(condition, block.id));
}

function getReferencedBlockIds(text, blocks, excludeId = '') {
  const source = normalizeText(text);
  if (!source) {
    return [];
  }
  return blocks
    .filter((block) => block.id !== excludeId)
    .filter((block) => conditionMentionsBlockId(source, block.id))
    .map((block) => block.id);
}

function isAllowedRawActionInput(connection, actionBlock) {
  const actionConfig = normalizeConfigObject(actionBlock?.config);
  if (actionConfig.allowRawFeedInputs === true) {
    return true;
  }
  const reason = normalizeToken(connection?.reason || connection?.label || actionConfig.rawFeedInputReason);
  return ALLOWED_RAW_ACTION_INPUT_REASONS.has(reason);
}

function logicIRHasComputedSignal(logicIR, signal) {
  return getLogicIRNodes(logicIR).some((node) => {
    if (!/compute|predicate/.test(normalizeToken(node.nodeCategory || node.category))) {
      return false;
    }
    const text = collectObjectText(node).toLowerCase().replace(/[\s-]+/g, '_');
    return normalizeSignalAliases(signal).some((alias) => text.includes(alias));
  });
}

function makeUniqueLogicIRNodeId(nodes, preferredId) {
  const used = new Set(nodes.map((node) => normalizeText(node.id)).filter(Boolean));
  const base = slugifyForPath(preferredId, 'computed-signal');
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

function collectRuntimeFormulaTriggerTargets(strategyGraph, formulaBlock, signal) {
  const blocks = Array.isArray(strategyGraph?.blocks) ? strategyGraph.blocks : [];
  const blockByID = new Map(blocks.map((block) => [normalizeText(block.id), block]));
  const directTargets = getOutgoingConnections(strategyGraph, formulaBlock.id, 'data-flow')
    .map((connection) => normalizeText(connection.toId))
    .filter((id) => blockByID.get(id)?.type === 'trigger');
  const referencedTargets = blocks
    .filter((block) => block.type === 'trigger')
    .filter((trigger) => {
      const condition = blockConfigText(trigger, ['condition', 'expression', 'logic']);
      if (conditionMentionsBlockId(condition, formulaBlock.id)) {
        return true;
      }
      return normalizeSignalAliases(signal).some((alias) =>
        condition.toLowerCase().replace(/[\s-]+/g, '_').includes(alias));
    })
    .map((trigger) => normalizeText(trigger.id));
  return uniqueStrings([...directTargets, ...referencedTargets]);
}

function completeLogicIRFromRuntimeGraph(logicIR, strategyGraph, { prompt = '', intentPlan = null } = {}) {
  const ir = normalizeObject(logicIR);
  const graph = normalizeObject(strategyGraph);
  const blocks = Array.isArray(graph?.blocks) ? graph.blocks : [];
  if (!ir || blocks.length === 0) {
    return ir;
  }

  const semantics = deriveStrategySemantics({ strategyGraph: graph, prompt, intentPlan, logicIR: ir });
  const missingSignals = semantics.requiredSignals.filter((signal) => !logicIRHasComputedSignal(ir, signal));
  if (missingSignals.length === 0) {
    return ir;
  }

  const formulaBlocks = blocks.filter((block) => block.type === 'normal' && isFormulaNormalBlock(block));
  let nextIR = ir;
  let nodes = null;
  let edges = null;
  let requiredSignals = null;

  for (const signal of missingSignals) {
    const formulaBlock = formulaBlocks.find((block) => blockMatchesSignal(block, signal));
    if (!formulaBlock) {
      continue;
    }

    if (nextIR === ir) {
      nodes = Array.isArray(ir.nodes)
        ? ir.nodes.filter((item) => item && typeof item === 'object').map((item) => ({ ...item }))
        : getLogicIRNodes(ir).map((item) => ({ ...item }));
      edges = getLogicIREdges(ir).map((item) => ({ ...item }));
      requiredSignals = uniqueStrings([...normalizeStringList(ir.requiredSignals), ...semantics.requiredSignals]);
      nextIR = {
        ...ir,
        nodes,
        edges,
        requiredSignals,
      };
    }

    const nodeId = makeUniqueLogicIRNodeId(nodes, `${formulaBlock.id}-${signal}`);
    const config = normalizeConfigObject(formulaBlock.config);
    const incomingInputs = getIncomingConnections(graph, formulaBlock.id)
      .filter((connection) => connection.kind === 'data-flow' || connection.kind === 'action-result')
      .map((connection) => normalizeText(connection.fromId))
      .filter(Boolean);
    nodes.push({
      id: nodeId,
      nodeCategory: 'compute',
      semanticType: signal,
      label: firstConfigText(config, ['name', 'label', 'title'], formulaBlock.id),
      expression: formulaText(formulaBlock),
      inputs: uniqueStrings([...incomingInputs, ...normalizeStringList(config.inputs)]),
      outputs: uniqueStrings([signal, ...normalizeStringList(config.outputs)]),
      config: {
        runtimeBlockId: formulaBlock.id,
        autoCompletedFromRuntimeGraph: true,
      },
    });

    for (const targetId of collectRuntimeFormulaTriggerTargets(graph, formulaBlock, signal)) {
      edges.push({
        from: nodeId,
        to: targetId,
        kind: 'signal',
      });
    }
  }

  return nextIR;
}

function lintStrategyLogicIR(logicIR, { prompt = '', intentPlan = null } = {}) {
  if (!logicIR || typeof logicIR !== 'object') {
    return [logicIssue(
      'MISSING_STRATEGY_LOGIC_IR',
      'error',
      'Strategy Logic IR is missing.',
      {},
      'Return intentPlan, logicIR, and runtimeGraph before runtime validation.',
    )];
  }

  const semantics = deriveStrategySemantics({
    strategyGraph: { metadata: {} },
    prompt,
    intentPlan,
    logicIR,
  });
  const issues = [];
  const logicNodes = getLogicIRNodes(logicIR);
  const logicEdges = getLogicIREdges(logicIR);
  const computedSignals = logicNodes.filter((node) => /compute|predicate/.test(normalizeToken(node.nodeCategory || node.category)));
  const irTriggers = logicNodes.filter((node) => normalizeToken(node.nodeCategory || node.category) === 'trigger');
  const logicNodeByID = new Map(logicNodes.map((node) => [normalizeText(node.id), node]).filter(([id]) => Boolean(id)));

  for (const signal of semantics.requiredSignals) {
    const exists = computedSignals.some((candidate) => {
      const text = collectObjectText(candidate).toLowerCase().replace(/[\s-]+/g, '_');
      return normalizeSignalAliases(signal).some((alias) => text.includes(alias));
    });
    if (!exists) {
      issues.push(logicIssue(
        `IR_MISSING_${normalizeToken(signal).toUpperCase()}_SIGNAL`,
        'error',
        `Strategy Logic IR is missing required computed signal "${signal}".`,
        { strategyKind: semantics.strategyKind, requiredSignals: semantics.requiredSignals },
        `Add "${signal}" to logicIR.computedSignals before generating runtimeGraph.`,
      ));
    }
  }

  for (const edge of logicEdges) {
    const source = logicNodeByID.get(normalizeText(edge.from));
    const target = logicNodeByID.get(normalizeText(edge.to));
    if (normalizeToken(source?.nodeCategory || source?.category) === 'action' && normalizeToken(target?.nodeCategory || target?.category) === 'action') {
      issues.push(logicIssue(
        'IR_ACTION_DIRECTLY_CHAINED',
        'error',
        `Logic IR connects action ${edge.from} directly to action ${edge.to}.`,
        { from: edge.from, to: edge.to, kind: edge.kind },
        'Route action outputs through action-result to compute/predicate/trigger nodes before a later action.',
      ));
    }
  }

  const needsTimeTrigger = semantics.requiredTriggerTypes.includes('time') || TIME_STRATEGY_KIND_SET.has(semantics.strategyKind);
  if (needsTimeTrigger) {
    const hasTimeTrigger = irTriggers.some((trigger) =>
      /time|timer|schedule|interval|cron/.test(normalizeToken(trigger?.kind || trigger?.triggerType || trigger?.type)));
    if (!hasTimeTrigger) {
      issues.push(logicIssue(
        'IR_DCA_MUST_USE_TIME_TRIGGER',
        'error',
        'Strategy Logic IR must model time-based execution as a time trigger.',
        { strategyKind: semantics.strategyKind, requiredTriggerTypes: semantics.requiredTriggerTypes },
        'Add a time trigger to logicIR.triggers and use triggerType="time" in runtimeGraph.',
      ));
    }
  }

  for (const signal of semantics.requiredSignals) {
    const signalNode = computedSignals.find((candidate) => {
      const text = collectObjectText(candidate).toLowerCase().replace(/[\s-]+/g, '_');
      return normalizeSignalAliases(signal).some((alias) => text.includes(alias));
    });
    if (!signalNode?.id) {
      continue;
    }
    const hasSignalOutputFlow = logicEdges.some((edge) =>
      normalizeText(edge?.from) === normalizeText(signalNode.id) &&
      /signal|data|predicate/.test(normalizeToken(edge?.kind)));
    if (!hasSignalOutputFlow) {
      issues.push(logicIssue(
        'IR_SIGNAL_MUST_FEED_TRIGGER',
        'error',
        `Computed signal "${signalNode.id}" is not connected to downstream trigger logic in IR.`,
        { signalId: signalNode.id },
        'Add flow from computed signal to the relevant condition trigger.',
      ));
    }
  }

  return issues;
}

function normalizeWorkflowGroupsForLint(metadata) {
  const rawGroups = Array.isArray(metadata?.workflowGroups) ? metadata.workflowGroups : [];
  return rawGroups
    .map((group, index) => {
      const item = normalizeObject(group) || {};
      const id = normalizeText(item.id || item.workflowId || item.name) || `workflow-${index + 1}`;
      return {
        id,
        title: normalizeText(item.title || item.label || item.name) || id,
        purpose: normalizeText(item.purpose || item.description || item.summary),
        canAbstract: item.canAbstract !== false,
        nodeIds: normalizeStringList(item.nodeIds || item.nodes || item.blockIds),
        mustStayVisibleNodeIds: normalizeStringList(item.mustStayVisibleNodeIds || item.visibleNodeIds || item.anchorNodeIds),
      };
    })
    .filter((group) => group.id);
}

function isInitSafetyBlock(block) {
  const text = `${normalizeText(block?.id)} ${normalizeText(block?.type)} ${collectObjectText(normalizeConfigObject(block?.config))}`.toLowerCase();
  return /(^|[\s_-])(init|initial|initialize|bootstrap|setup|start)([\s_-]|$)|초기|초기화|시작|capitalready|startapproved/.test(text);
}

function lintRuntimeStrategyGraph(strategyGraph, { prompt = '', intentPlan = null, logicIR = null, exchangeConnections = [] } = {}) {
  const graph = strategyGraph || {};
  const blocks = Array.isArray(graph.blocks) ? graph.blocks : [];
  const connections = Array.isArray(graph.connections) ? graph.connections : [];
  const blockByID = new Map(blocks.map((block) => [block.id, block]));
  const semantics = deriveStrategySemantics({ strategyGraph: graph, prompt, intentPlan, logicIR });
  const issues = [];
  const workflowGroups = normalizeWorkflowGroupsForLint(normalizeObject(graph.metadata) || {});

  if (workflowGroups.length === 0) {
    issues.push(logicIssue(
      'WORKFLOW_GROUPS_REQUIRED',
      'error',
      'runtimeGraph.metadata.workflowGroups is missing.',
      {},
      'Define semantic workflowGroups first, then list the exact runtimeGraph block ids in each workflow.',
    ));
  } else {
    const groupByID = new Map(workflowGroups.map((group) => [group.id, group]));
    const membership = new Map(blocks.map((block) => [block.id, []]));
    for (const group of workflowGroups) {
      const mustStayVisible = new Set(group.mustStayVisibleNodeIds);
      for (const nodeId of group.nodeIds) {
        if (!blockByID.has(nodeId)) {
          issues.push(logicIssue(
            'WORKFLOW_GROUP_UNKNOWN_NODE',
            'error',
            `Workflow ${group.id} references unknown block ${nodeId}.`,
            { workflowId: group.id, nodeId },
            'Use exact runtimeGraph block ids in workflowGroups[].nodeIds.',
          ));
          continue;
        }
        membership.get(nodeId)?.push(group.id);
      }

      if (group.canAbstract) {
        for (const nodeId of group.nodeIds) {
          const block = blockByID.get(nodeId);
          if (!block) continue;
          const shouldStayVisible =
            block.type === 'action' ||
            isKillSwitchBlock(block) ||
            isInitSafetyBlock(block) ||
            connections.some((connection) => connection.kind === 'trigger-action' && connection.fromId === nodeId);
          if (shouldStayVisible && !mustStayVisible.has(nodeId)) {
            issues.push(logicIssue(
              'WORKFLOW_VISIBLE_NODE_NOT_ANCHORED',
              'error',
              `Workflow ${group.id} can be abstracted but visible block ${nodeId} is not listed in mustStayVisibleNodeIds.`,
              { workflowId: group.id, nodeId, blockType: block.type },
              'Add this block id to mustStayVisibleNodeIds or set canAbstract=false for the workflow.',
            ));
          }
        }
      }
    }

    for (const block of blocks) {
      const config = normalizeConfigObject(block.config);
      const workflowId = normalizeText(config.workflowId || config.workflow || config.phaseId);
      const listedGroups = membership.get(block.id) || [];
      if (workflowId && !groupByID.has(workflowId)) {
        issues.push(logicIssue(
          'BLOCK_WORKFLOW_UNKNOWN',
          'error',
          `Block ${block.id} references unknown workflow ${workflowId}.`,
          { blockId: block.id, workflowId },
          'Use a workflowId that exists in runtimeGraph.metadata.workflowGroups.',
        ));
        continue;
      }
      if (listedGroups.length > 1) {
        issues.push(logicIssue(
          'BLOCK_IN_MULTIPLE_WORKFLOWS',
          'error',
          `Block ${block.id} is listed in multiple workflow groups.`,
          { blockId: block.id, workflowIds: listedGroups },
          'Each block must belong to exactly one workflow.',
        ));
        continue;
      }
      if (workflowId && listedGroups.length === 1 && listedGroups[0] !== workflowId) {
        issues.push(logicIssue(
          'BLOCK_WORKFLOW_CONFLICT',
          'error',
          `Block ${block.id} has workflowId ${workflowId} but is listed in workflow ${listedGroups[0]}.`,
          { blockId: block.id, workflowId, listedWorkflowId: listedGroups[0] },
          'Make config.workflowId and workflowGroups[].nodeIds agree.',
        ));
      }
      if (!workflowId && listedGroups.length !== 1) {
        issues.push(logicIssue(
          'BLOCK_WORKFLOW_MISSING',
          'error',
          `Block ${block.id} is not assigned to exactly one workflow.`,
          { blockId: block.id, listedWorkflowIds: listedGroups },
          'Set block.config.workflowId or list this block in one workflowGroups[].nodeIds.',
        ));
      }
    }
  }

  for (const action of blocks.filter((block) => block.type === 'action')) {
    if (!isActionUsingConnectedExchange(action, exchangeConnections)) {
      issues.push(logicIssue(
        'ACTION_EXCHANGE_NOT_CONNECTED',
        'error',
        `Action ${action.id} uses an exchange that is not connected.`,
        {
          actionId: action.id,
          exchange: action.config?.exchange || action.config?.connectionId || action.config?.venue || '',
          connectedExchanges: getConnectedExchangeConnections(exchangeConnections).map((connection) => ({ id: connection.id, name: connection.name })),
        },
        'Use only one of the connected exchanges from the backend exchange connection list.',
      ));
    }
    const upstreamIDs = getUpstreamNodeIds(graph, action.id);
    const directTriggerIds = getDirectIncomingTriggerIds(graph, action.id);
    const hasTriggerUpstream = directTriggerIds.length > 0 || upstreamIDs.some((id) => blockByID.get(id)?.type === 'trigger');
    if (!hasTriggerUpstream || directTriggerIds.length === 0) {
      issues.push(logicIssue(
        'ACTION_WITHOUT_TRIGGER',
        'error',
        `Action ${action.id} has no direct incoming trigger-action edge.`,
        { actionId: action.id, upstreamIds: upstreamIDs, directTriggerIds },
        'Connect a condition or time trigger before this action. Do not connect raw feeds directly to actions.',
      ));
    }
    if (hasActionResultUpstream(graph, action.id)) {
      const hasResultConfirmationTrigger = directTriggerIds.some((triggerId) => hasActionResultUpstream(graph, triggerId));
      if (!hasResultConfirmationTrigger) {
        issues.push(logicIssue(
          'ACTION_RESULT_NEXT_ACTION_NEEDS_CONFIRMATION',
          'error',
          `Action ${action.id} depends on a previous action result but is not gated by an action-result confirmation trigger.`,
          { actionId: action.id, directTriggerIds },
          'Route the previous action result into a confirmation trigger, then connect that trigger to the later action.',
        ));
      }
    }
  }

  const requiredSignals = semantics.requiredSignals.filter(Boolean);
  for (const signal of requiredSignals) {
    const exists = blocks.some((block) => block.type === 'normal' && isFormulaNormalBlock(block) && blockMatchesSignal(block, signal));
    if (!exists) {
      issues.push(logicIssue(
        `MISSING_${normalizeToken(signal).toUpperCase()}_FORMULA`,
        'error',
        `Required computed signal "${signal}" is missing.`,
        { strategyKind: semantics.strategyKind, requiredSignals },
        `Create a normal expression node for "${signal}" and connect its data-flow into relevant triggers.`,
      ));
    }
  }

  for (const connection of connections) {
    const from = blockByID.get(connection.fromId);
    const to = blockByID.get(connection.toId);
    if (from?.type === 'action' && to?.type === 'action') {
      issues.push(logicIssue(
        'ACTION_DIRECTLY_CHAINED',
        'error',
        `Action ${from.id} is directly connected to action ${to.id}.`,
        { connectionId: connection.id, kind: connection.kind, fromId: from.id, toId: to.id },
        'Route action outputs into a formula/predicate/confirmation trigger before the next action.',
      ));
      continue;
    }
    if (connection.kind === 'action-result') {
      if (from?.type !== 'action' || !['normal', 'trigger', 'monitoring'].includes(to?.type || '')) {
        issues.push(logicIssue(
          'ACTION_RESULT_INVALID_TARGET',
          'error',
          `action-result must connect action -> normal/trigger/monitoring, got ${from?.type || 'missing'} -> ${to?.type || 'missing'}.`,
          { connectionId: connection.id, fromId: connection.fromId, toId: connection.toId },
          'Use action-result only from action blocks to normal, trigger, or monitoring blocks.',
        ));
      }
      continue;
    }
    if (connection.kind !== 'action-input' || from?.type !== 'streaming' || to?.type !== 'action') {
      continue;
    }
    if (semantics.strategyKind === 'pure_execution' || isAllowedRawActionInput(connection, to)) {
      continue;
    }
    const severity = requiredSignals.length > 0 ? 'error' : 'warning';
    issues.push(logicIssue(
      'RAW_FEED_ACTION_BYPASS',
      severity,
      `Raw feed ${from.id} is connected directly to action ${to.id}.`,
      { connectionId: connection.id, fromId: from.id, toId: to.id, strategyKind: semantics.strategyKind },
      'Route market feeds into formula/indicator nodes first. Actions must be triggered by condition/time triggers.',
    ));
  }

  for (const trigger of blocks.filter((block) => block.type === 'trigger')) {
    const config = normalizeConfigObject(trigger.config);
    const triggerType = firstConfigText(config, ['triggerType', 'type'], 'condition').toLowerCase();
    if (triggerType !== 'condition' || requiredSignals.length === 0) {
      continue;
    }
    if (conditionReferencesRawFeed(graph, trigger) && !conditionReferencesSignal(graph, trigger, requiredSignals)) {
      issues.push(logicIssue(
        'TRIGGER_BYPASSES_SIGNAL',
        'error',
        `Condition trigger ${trigger.id} references raw feed fields instead of the required computed signal.`,
        { triggerId: trigger.id, requiredSignals, condition: config.condition || config.expression || config.logic },
        'Create a formula/indicator normal node and make the trigger depend on that computed signal.',
      ));
    }
  }

  const needsTimeTrigger = semantics.requiredTriggerTypes.includes('time') || TIME_STRATEGY_KIND_SET.has(semantics.strategyKind);
  if (needsTimeTrigger) {
    const timeTriggers = blocks.filter((block) =>
      block.type === 'trigger' && firstConfigText(block.config || {}, ['triggerType', 'type'], '').toLowerCase() === 'time');
    if (timeTriggers.length === 0) {
      issues.push(logicIssue(
        'DCA_MUST_USE_TIME_TRIGGER',
        'error',
        'Time-based strategies must use triggerType="time".',
        { strategyKind: semantics.strategyKind, requiredTriggerTypes: semantics.requiredTriggerTypes },
        'Replace interval normal + modulo condition with a single time trigger block with intervalMs.',
      ));
    }
  }

  for (const trigger of blocks.filter((block) => block.type === 'trigger')) {
    const config = normalizeConfigObject(trigger.config);
    const triggerType = firstConfigText(config, ['triggerType', 'type'], '').toLowerCase();
    const condition = normalizeText(config.condition || config.expression || config.logic).toLowerCase();
    if (triggerType === 'condition' && /eventtime\s*%|timestamp\s*%|datetime\s*%|modulo|::pulse\b/.test(condition)) {
      issues.push(logicIssue(
        'DCA_MUST_USE_TIME_TRIGGER',
        'error',
        `Trigger ${trigger.id} implements time logic as a condition expression.`,
        { triggerId: trigger.id, condition },
        'Use one trigger block with triggerType="time" and intervalMs instead.',
      ));
    }
    const referencedActionIDs = getReferencedBlockIds(condition, blocks, trigger.id)
      .filter((id) => blockByID.get(id)?.type === 'action');
    const incomingResultFromIDs = new Set(getIncomingConnections(graph, trigger.id, 'action-result').map((connection) => connection.fromId));
    for (const referencedID of referencedActionIDs) {
      if (!incomingResultFromIDs.has(referencedID)) {
        issues.push(logicIssue(
          'ACTION_RESULT_TRIGGER_MUST_USE_ACTION_RESULT',
          'error',
          `Trigger ${trigger.id} references action ${referencedID} without an action-result edge.`,
          { triggerId: trigger.id, referencedId: referencedID, condition },
          `Add an action-result connection ${referencedID} -> ${trigger.id}.`,
        ));
      }
    }
    if (referencedActionIDs.length > 0 && !/status|filled|confirmed|success|executed|txhash|orderid/.test(condition)) {
      issues.push(logicIssue(
        'ACTION_RESULT_CONFIRMATION_TRIGGER_REQUIRED',
        'warning',
        `Trigger ${trigger.id} depends on an action result but does not check status/fill/confirmation fields.`,
        { triggerId: trigger.id, condition },
        'Use status, filledQty, orderId, txHash, or confirmation fields before firing a follow-up action.',
      ));
    }
  }

  for (const formulaBlock of blocks.filter(isFormulaNormalBlock)) {
    const expression = formulaText(formulaBlock);
    const referencedIDs = getReferencedBlockIds(expression, blocks, formulaBlock.id)
      .filter((id) => ['streaming', 'normal'].includes(blockByID.get(id)?.type));
    const referencedActionIDs = getReferencedBlockIds(expression, blocks, formulaBlock.id)
      .filter((id) => blockByID.get(id)?.type === 'action');
    const incomingDataFromIDs = new Set(getIncomingConnections(graph, formulaBlock.id, 'data-flow').map((connection) => connection.fromId));
    const incomingResultFromIDs = new Set(getIncomingConnections(graph, formulaBlock.id, 'action-result').map((connection) => connection.fromId));
    if (referencedIDs.length === 0 && referencedActionIDs.length === 0 && incomingDataFromIDs.size === 0 && incomingResultFromIDs.size === 0) {
      issues.push(logicIssue(
        'FORMULA_DEPENDENCY_MUST_USE_DATA_FLOW',
        'error',
        `Formula node ${formulaBlock.id} has no data-flow or action-result inputs.`,
        { formulaId: formulaBlock.id, expression },
        'Connect feed/signal dependencies with data-flow and action output dependencies with action-result.',
      ));
      continue;
    }
    for (const referencedID of referencedIDs) {
      if (!incomingDataFromIDs.has(referencedID)) {
        issues.push(logicIssue(
          'FORMULA_DEPENDENCY_MUST_USE_DATA_FLOW',
          'error',
          `Formula node ${formulaBlock.id} references ${referencedID} without a data-flow edge.`,
          { formulaId: formulaBlock.id, referencedId: referencedID, expression },
          `Add a data-flow connection ${referencedID} -> ${formulaBlock.id}.`,
        ));
      }
    }
    for (const referencedID of referencedActionIDs) {
      if (!incomingResultFromIDs.has(referencedID)) {
        issues.push(logicIssue(
          'ACTION_RESULT_DEPENDENCY_MUST_USE_ACTION_RESULT',
          'error',
          `Formula node ${formulaBlock.id} references action ${referencedID} without an action-result edge.`,
          { formulaId: formulaBlock.id, referencedId: referencedID, expression },
          `Add an action-result connection ${referencedID} -> ${formulaBlock.id}.`,
        ));
      }
    }
    if (/requestedqty|requested_qty|orderqty|order_qty|\bqty\b|\bamount\b/i.test(expression) && !/filledqty|filled_qty|filled/i.test(expression)) {
      issues.push(logicIssue(
        'PARTIAL_FILL_SIZE_MUST_USE_FILLED_QTY',
        'warning',
        `Formula node ${formulaBlock.id} appears to size a follow-up action without using filledQty.`,
        { formulaId: formulaBlock.id, expression },
        'For partial-fillable actions, compute follow-up size from filledQty rather than requested quantity.',
      ));
    }
  }

  for (const action of blocks.filter((block) => block.type === 'action')) {
    const config = normalizeConfigObject(action.config);
    const retryEnabled = (
      Number(config.maxRetries ?? config.retries ?? config.retryCount ?? 0) > 0 ||
      config.retry === true ||
      /retry|재시도/.test(blockSearchText(action))
    );
    if (!retryEnabled) {
      continue;
    }
    const hasRetrySafety = ['maxRetries', 'cooldownMs', 'idempotencyKey', 'timeoutMs'].some((key) =>
      config[key] !== undefined && config[key] !== null && config[key] !== '');
    if (!hasRetrySafety) {
      issues.push(logicIssue(
        'RETRY_LOOP_REQUIRES_SAFETY',
        'error',
        `Action ${action.id} has retry behavior without explicit safety limits.`,
        { actionId: action.id },
        'Add maxRetries, cooldownMs, idempotencyKey, and/or timeoutMs to retryable actions.',
      ));
    }
  }

  for (const fixedNormal of blocks.filter(isFixedNormalBlock)) {
    const outgoing = getOutgoingConnections(graph, fixedNormal.id);
    const onlyParameterUse = outgoing.length > 0 && outgoing.every((connection) =>
      connection.kind === 'action-input' || connection.kind === 'data-flow');
    if (onlyParameterUse) {
      issues.push(logicIssue(
        'FIXED_NORMAL_SHOULD_BE_PARAMETER',
        'warning',
        `Fixed normal block ${fixedNormal.id} should be absorbed into UI parameters.`,
        { normalId: fixedNormal.id },
        'Do not display this as a standalone formula node in advanced UI.',
      ));
    }
  }

  return issues;
}

function normalizeStrategyGraphForRunner(strategyGraph, prompt = '', semanticContext = {}) {
  const rawBlocks = Array.isArray(strategyGraph?.blocks) ? strategyGraph.blocks : [];
  const firstRawStream = rawBlocks.find((block) => normalizeText(block?.type) === 'streaming');
  const fallbackStreamID = normalizeText(firstRawStream?.id) || 'streaming-1';
  let blocks = rawBlocks.map((block, index) => normalizeRunnerBlock(block, index, fallbackStreamID));
  const topology = normalizeRuntimeGraphTopology(
    blocks,
    Array.isArray(strategyGraph?.connections) ? strategyGraph.connections : [],
  );
  blocks = topology.blocks;

  let blockByID = new Map(blocks.map((block) => [block.id, block]));
  let connections = [];
  let existing = new Set();
  for (const connection of topology.connections) {
    const fromId = normalizeText(connection?.fromId);
    const toId = normalizeText(connection?.toId);
    const fromType = blockByID.get(fromId)?.type;
    const toType = blockByID.get(toId)?.type;
    if (!fromType || !toType) {
      continue;
    }
    const kind = inferRunnerConnectionKind(fromType, toType, connection?.kind);
    if (!['trigger-action', 'trigger-input', 'action-input', 'data-flow', 'action-result', 'stream-monitor'].includes(kind)) {
      continue;
    }
    const extra = {};
    for (const key of ['reason', 'label', 'field', 'outputField', 'inputField']) {
      const value = normalizeText(connection?.[key]);
      if (value) {
        extra[key] = value;
      }
    }
    addRunnerConnection(connections, existing, kind, fromId, toId, normalizeText(connection?.id) || 'conn', extra);
  }

  const coerced = forceTimeTriggersIntoTriggerBlocks(blocks, connections);
  blocks = coerced.blocks;
  connections = coerced.connections;
  blockByID = new Map(blocks.map((block) => [block.id, block]));
  existing = rebuildConnectionSet(connections);
  ensureRuntimeKillSwitch(blocks, connections, existing, semanticContext.exchangeConnections || []);
  blockByID = new Map(blocks.map((block) => [block.id, block]));
  existing = rebuildConnectionSet(connections);

  const streamingIDs = blocks.filter((block) => block.type === 'streaming').map((block) => block.id);
  const normalIDs = blocks.filter((block) => block.type === 'normal').map((block) => block.id);
  const triggerIDs = blocks.filter((block) => block.type === 'trigger').map((block) => block.id);
  const actionIDs = blocks.filter((block) => block.type === 'action').map((block) => block.id);
  const monitorIDs = blocks.filter((block) => block.type === 'monitoring').map((block) => block.id);

  for (const monitorID of monitorIDs) {
    const streamID = streamingIDs[0];
    if (streamID && !connections.some((conn) => conn.kind === 'stream-monitor' && conn.toId === monitorID)) {
      addRunnerConnection(connections, existing, 'stream-monitor', streamID, monitorID, 'auto-stream-monitor');
    }
  }

  const name = normalizeText(strategyGraph?.strategy?.name) || normalizeText(prompt) || 'AI Generated Strategy';
  const id = normalizeText(strategyGraph?.strategy?.id) || slugifyForPath(name, 'ai-generated-strategy');
  const normalizedGraph = {
    schemaVersion: Number(strategyGraph?.schemaVersion) || 1,
    kind: 'hershy-strategy-graph',
    strategy: { id, name },
    generatedAt: normalizeText(strategyGraph?.generatedAt) || new Date().toISOString(),
    metadata: normalizeObject(strategyGraph?.metadata),
    blocks,
    connections,
  };
  return {
    ...normalizedGraph,
    metadata: buildStrategyMetadata(normalizedGraph, prompt, semanticContext.intentPlan, semanticContext.logicIR),
    summary: {
      blocks: blocks.length,
      connections: connections.length,
      byType: countStrategyBlocksByType(blocks),
    },
    blocks,
    connections,
  };
}

function extractValidationIssues(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, ''));
}

async function validateStrategyGraphWithRunner(strategyGraph) {
  const timeoutSeconds = resolveIntegerEnv('AI_STRATEGY_VALIDATE_TIMEOUT_SEC', 60);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hershy-strategy-'));
  const tmpFile = path.join(tmpDir, 'strategy.json');
  const command = 'go run -mod=mod ./cmd/strategy-validate --file <temp-strategy.json>';

  try {
    await fs.writeFile(tmpFile, `${stringifyPrettyJSON(strategyGraph)}\n`, 'utf8');
    const { stdout, stderr } = await execFileAsync(
      'go',
      ['run', '-mod=mod', './cmd/strategy-validate', '--file', tmpFile],
      {
        cwd: STRATEGY_RUNNER_DIR,
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
      },
    );
    return {
      ok: true,
      command,
      issues: [],
      stdout: normalizeText(stdout),
      stderr: normalizeText(stderr),
    };
  } catch (error) {
    const stdout = String(error?.stdout || '');
    const stderr = String(error?.stderr || '');
    if (error?.code === 1) {
      return {
        ok: false,
        command,
        issues: extractValidationIssues(stdout),
        stdout: normalizeText(stdout),
        stderr: normalizeText(stderr),
      };
    }
    throw new Error(`strategy validator failed: ${error?.message || 'unknown error'} ${trimForLog(stderr || stdout, 1200)}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
  }
}

async function writeStrategyRuntimeArtifacts(strategyGraph, validationHistory = [], options = {}) {
  if (!getAIBooleanEnv('AI_STRATEGY_WRITE_RUNTIME_ARTIFACTS', true)) {
    return null;
  }

  const baseDir = path.resolve(
    REPO_ROOT,
    normalizeText(process.env.AI_STRATEGY_ARTIFACT_DIR) || 'examples/strategy-runner/generated',
  );
  const strategyName = normalizeText(strategyGraph?.strategy?.name) || 'AI Generated Strategy';
  const strategyID = slugifyForPath(strategyGraph?.strategy?.id || strategyName, 'strategy');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = path.join(baseDir, `${stamp}-${strategyID}`);
  const strategyPath = path.join(dir, 'strategy.json');
  const mainGoPath = path.join(dir, 'generated_strategy.go');
  const validationPath = path.join(dir, 'validation.json');
  const readmePath = path.join(dir, 'README.md');

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(strategyPath, `${stringifyPrettyJSON(strategyGraph)}\n`, 'utf8');
  await fs.writeFile(validationPath, `${stringifyPrettyJSON(validationHistory)}\n`, 'utf8');

  const codegenTimeoutSeconds = resolveIntegerEnv('AI_STRATEGY_CODEGEN_TIMEOUT_SEC', 60);
  await execFileAsync(
    'go',
    ['run', '-mod=mod', './cmd/strategy-codegen', '--file', strategyPath, '--out', mainGoPath],
    {
      cwd: STRATEGY_RUNNER_DIR,
      timeout: codegenTimeoutSeconds * 1000,
      maxBuffer: 1024 * 1024,
    },
  );

  await execFileAsync(
    'go',
    ['test', '-mod=mod', '.'],
    {
      cwd: dir,
      timeout: codegenTimeoutSeconds * 1000,
      maxBuffer: 1024 * 1024,
    },
  );
  const generatedGoCode = await fs.readFile(mainGoPath, 'utf8');

  const relDir = path.relative(REPO_ROOT, dir);
  const relStrategyPath = path.relative(REPO_ROOT, strategyPath);
  const relMainGoPath = path.relative(REPO_ROOT, mainGoPath);
  const runnerRelativeStrategyPath = path.relative(STRATEGY_RUNNER_DIR, strategyPath);
  const readme = `# ${strategyName}

Generated Hershy strategy runtime artifact.

This folder contains both the validated strategy JSON and a generated Hershy Go source file.
The generated Go source statically maps each JSON block/connection into runner definitions, then executes them through Hershy.

## Validate

\`\`\`bash
cd examples/strategy-runner
go run -mod=mod ./cmd/strategy-validate --file ${runnerRelativeStrategyPath}
\`\`\`

## Regenerate Go source

\`\`\`bash
cd examples/strategy-runner
go run -mod=mod ./cmd/strategy-codegen --file ${runnerRelativeStrategyPath} --out ${path.relative(STRATEGY_RUNNER_DIR, mainGoPath)}
\`\`\`

## Run

\`\`\`bash
cd ${relDir}
go run .
\`\`\`

Files:
- strategy JSON: ${relStrategyPath}
- generated Hershy Go source: ${relMainGoPath}
- validation history: ${path.relative(REPO_ROOT, validationPath)}
`;
  await fs.writeFile(readmePath, readme, 'utf8');

  let hostProgram = null;
  if (options.registerHostProgram !== false) {
    try {
      hostProgram = await registerGeneratedStrategyHostProgram({
        strategyName,
        strategyID,
        strategyPath,
        generatedGoPath: mainGoPath,
        validationPath,
        readmePath,
      });
    } catch (error) {
      hostProgram = {
        ok: false,
        warning: error?.message || 'host program registration failed',
      };
    }
  }

  return {
    dir: relDir,
    strategyPath: relStrategyPath,
    mainGoPath: relMainGoPath,
    generatedGoPath: relMainGoPath,
    programCode: generatedGoCode,
    generatedGoCode,
    validationPath: path.relative(REPO_ROOT, validationPath),
    readmePath: path.relative(REPO_ROOT, readmePath),
    hostProgram,
    validateCommand: `cd examples/strategy-runner && go run -mod=mod ./cmd/strategy-validate --file ${runnerRelativeStrategyPath}`,
    codegenCommand: `cd examples/strategy-runner && go run -mod=mod ./cmd/strategy-codegen --file ${runnerRelativeStrategyPath} --out ${path.relative(STRATEGY_RUNNER_DIR, mainGoPath)}`,
    compileCommand: `cd ${relDir} && go test -mod=mod .`,
    runCommand: `cd ${relDir} && go run .`,
  };
}

function buildGeneratedStrategyDockerfile() {
  return `FROM golang:1.24-alpine

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/generated-strategy .

EXPOSE 8080
CMD ["/app/generated-strategy"]
`;
}

function hostProgramHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = normalizeText(process.env.HERSHY_HOST_API_TOKEN);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-Hershy-Api-Token'] = token;
  }
  return headers;
}

async function readStrategyRunnerRuntimeSourceFiles() {
  const files = {};
  await Promise.all(STRATEGY_RUNNER_RUNTIME_FILES.map(async (relativePath) => {
    files[relativePath] = await fs.readFile(path.join(STRATEGY_RUNNER_DIR, relativePath), 'utf8');
  }));
  return files;
}

async function registerGeneratedStrategyHostProgram({
  strategyName,
  strategyID,
  strategyPath,
  generatedGoPath,
  validationPath,
  readmePath,
}) {
  if (!getAIBooleanEnv('AI_STRATEGY_REGISTER_HOST_PROGRAM', true)) {
    return null;
  }

  const sourceFiles = await readStrategyRunnerRuntimeSourceFiles();
  sourceFiles['main.go'] = await fs.readFile(generatedGoPath, 'utf8');
  sourceFiles['strategy.json'] = await fs.readFile(strategyPath, 'utf8');
  sourceFiles['validation.json'] = await fs.readFile(validationPath, 'utf8');
  sourceFiles['README.md'] = await fs.readFile(readmePath, 'utf8');

  const userID = `ai-${slugifyForPath(strategyID || strategyName, 'strategy')}-${Date.now()}`;
  const createResponse = await fetch(`${HOST_API_BASE}/programs`, {
    method: 'POST',
    headers: hostProgramHeaders(),
    body: JSON.stringify({
      user_id: userID,
      dockerfile: buildGeneratedStrategyDockerfile(),
      src_files: sourceFiles,
    }),
    signal: AbortSignal.timeout(resolveIntegerEnv('AI_STRATEGY_HOST_TIMEOUT_SEC', 15000)),
  });

  const created = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) {
    const message = created?.message || created?.error || `host create failed: HTTP ${createResponse.status}`;
    throw new Error(message);
  }

  let started = null;
  if (getAIBooleanEnv('AI_STRATEGY_HOST_AUTO_START', false)) {
    const startResponse = await fetch(`${HOST_API_BASE}/programs/${encodeURIComponent(created.program_id)}/start`, {
      method: 'POST',
      headers: hostProgramHeaders(),
      signal: AbortSignal.timeout(resolveIntegerEnv('AI_STRATEGY_HOST_START_TIMEOUT_SEC', 30000)),
    });
    started = await startResponse.json().catch(() => ({}));
    if (!startResponse.ok) {
      started = {
        ok: false,
        warning: started?.message || started?.error || `host start failed: HTTP ${startResponse.status}`,
      };
    }
  }

  return {
    ok: true,
    programId: created.program_id,
    buildId: created.build_id,
    state: started?.state || created.state,
    proxyUrl: created.proxy_url,
    userId,
    hostUI: `${HOST_API_BASE}/ui/programs`,
    statusUrl: `${HOST_API_BASE}/programs/${created.program_id}`,
    watcherStatusUrl: `${HOST_API_BASE}/programs/${created.program_id}/proxy/watcher/status`,
    autoStarted: Boolean(started && started.ok !== false),
    startWarning: started?.warning || '',
  };
}

async function validateRepairAndMaterializeStrategy({
  prompt,
  currentStrategy,
  researchBundle,
  orchestrationPlan,
  initialStrategy,
  initialPackage,
  exchangeConnections = [],
  userContext = null,
  onProgress = null,
}) {
  const maxAttempts = resolveIntegerEnv('AI_STRATEGY_VALIDATE_MAX_ATTEMPTS', 50);
  const history = [];
  const repairReasoning = [];
  const logicErrorRunId = makeStrategyLogicErrorRunID();
  const logicErrorLogPath = path.relative(REPO_ROOT, AI_STRATEGY_LOGIC_ERROR_LOG_PATH);
  const logicErrorLogEntries = [];
  const strategyProviderForLog = resolveLayerProvider('STRATEGY');
  const strategyModelForLog = resolveLayerModelForLog('STRATEGY', strategyProviderForLog);
  let intentPlan = normalizeObject(initialPackage?.intentPlan);
  let logicIR = normalizeObject(initialPackage?.logicIR);
  let strategy = normalizeStrategyGraphForRunner(
    initialPackage?.runtimeGraph || initialStrategy,
    prompt,
    { intentPlan, logicIR, exchangeConnections },
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    emitAgentProgress(onProgress, {
      stage: 'validation',
      label: `검증 ${attempt}/${maxAttempts}: 전략 논리 검사`,
      detail: { attempt, maxAttempts },
    });
    const completedLogicIR = completeLogicIRFromRuntimeGraph(logicIR, strategy, { prompt, intentPlan });
    if (completedLogicIR && completedLogicIR !== logicIR) {
      emitAgentProgress(onProgress, {
        stage: 'validation',
        label: `검증 ${attempt}/${maxAttempts}: 누락된 계산 IR 자동 보정`,
        detail: { attempt },
      });
      logicIR = completedLogicIR;
      strategy = normalizeStrategyGraphForRunner(strategy, prompt, { intentPlan, logicIR, exchangeConnections });
    }

    const irLintIssues = lintStrategyLogicIR(logicIR, { prompt, intentPlan });
    const runtimeLogicIssues = lintRuntimeStrategyGraph(strategy, { prompt, intentPlan, logicIR, exchangeConnections });
    const logicLintIssues = [...irLintIssues, ...runtimeLogicIssues];
    const blockingLogicIssues = logicLintIssues.filter((issue) => issue.severity === 'error');
    if (hasBlockingLogicIssues(logicLintIssues)) {
      const logEntry = await recordStrategyLogicError({
        runId: logicErrorRunId,
        attempt,
        maxAttempts,
        stage: 'logic-lint',
        prompt,
        provider: strategyProviderForLog,
        model: strategyModelForLog,
        issues: blockingLogicIssues,
        logicLintIssues,
        strategy,
        intentPlan,
        logicIR,
      });
      logicErrorLogEntries.push(logEntry);
      history.push({
        attempt,
        stage: 'logic-lint',
        ok: false,
        logicLintIssues,
        issues: blockingLogicIssues.map((issue) => `${issue.code}: ${issue.message}`),
        stdout: '',
        stderr: '',
      });

      if (attempt >= maxAttempts) {
        break;
      }

      emitAgentProgress(onProgress, {
        stage: 'repair',
        label: `수정 ${attempt}/${maxAttempts}: 논리 오류 ${blockingLogicIssues.length}개를 AI에게 전달`,
        detail: {
          attempt,
          issues: blockingLogicIssues.map((issue) => issue.code).slice(0, 8),
          logicErrorRunId,
          logicErrorLogPath,
        },
      });
      const repairResponse = await callAITextLayer({
        layer: 'STRATEGY',
        systemPrompt: buildStrategyRepairSystemPrompt(),
        userPrompt: buildStrategyRepairUserPrompt({
          prompt,
          currentStrategy,
          researchBundle,
          orchestrationPlan,
          intentPlan,
          logicIR,
          previousStrategy: strategy,
          logicLintIssues,
          exchangeConnections,
          userContext,
          validation: {
            command: 'semantic strategy logic linter',
            issues: blockingLogicIssues.map((issue) => `${issue.code}: ${issue.message}`),
          },
        }),
      });
      repairReasoning.push(...buildAIReasoningTrace(`strategy-logic-repair-${attempt}`, repairResponse));
      const repaired = parseStrategyGenerationPackage(repairResponse.text);
      intentPlan = normalizeObject(repaired.intentPlan) || intentPlan;
      logicIR = normalizeObject(repaired.logicIR) || logicIR;
      strategy = normalizeStrategyGraphForRunner(repaired.runtimeGraph, prompt, { intentPlan, logicIR, exchangeConnections });
      emitAgentProgress(onProgress, {
        stage: 'repair',
        label: `수정 ${attempt}/${maxAttempts}: 수정안 수신, 재검증 준비`,
        detail: { attempt },
      });
      continue;
    }

    emitAgentProgress(onProgress, {
      stage: 'validator',
      label: `검증 ${attempt}/${maxAttempts}: Go runtime validator 실행`,
      detail: { attempt, maxAttempts },
    });
    const validation = await validateStrategyGraphWithRunner(strategy);
    if (!validation.ok) {
      const logEntry = await recordStrategyLogicError({
        runId: logicErrorRunId,
        attempt,
        maxAttempts,
        stage: 'go-validator',
        prompt,
        provider: strategyProviderForLog,
        model: strategyModelForLog,
        issues: validation.issues,
        logicLintIssues,
        validation,
        strategy,
        intentPlan,
        logicIR,
      });
      logicErrorLogEntries.push(logEntry);
    }
    history.push({
      attempt,
      stage: 'go-validator',
      ok: validation.ok,
      issues: validation.issues,
      logicLintIssues,
      stdout: validation.stdout,
      stderr: validation.stderr,
    });

    if (validation.ok) {
      emitAgentProgress(onProgress, {
        stage: 'runtime-artifacts',
        label: `검증 통과: 런타임 파일 생성`,
        detail: { attempt },
      });
      const runtime = await writeStrategyRuntimeArtifacts(strategy, history);
      return {
        strategy,
        intentPlan,
        logicIR,
        validation: {
          ok: true,
          attempts: attempt,
          command: validation.command,
          issues: [],
          history,
        },
        runtime,
        reasoning: repairReasoning,
      };
    }

    if (attempt >= maxAttempts) {
      break;
    }

    emitAgentProgress(onProgress, {
      stage: 'repair',
      label: `수정 ${attempt}/${maxAttempts}: validator 오류 ${validation.issues.length}개를 AI에게 전달`,
      detail: {
        attempt,
        issues: validation.issues.slice(0, 8),
        logicErrorRunId,
        logicErrorLogPath,
      },
    });
    const repairResponse = await callAITextLayer({
      layer: 'STRATEGY',
      systemPrompt: buildStrategyRepairSystemPrompt(),
      userPrompt: buildStrategyRepairUserPrompt({
        prompt,
        currentStrategy,
        researchBundle,
        orchestrationPlan,
        intentPlan,
        logicIR,
        previousStrategy: strategy,
        logicLintIssues,
        validation,
        exchangeConnections,
        userContext,
      }),
    });
    repairReasoning.push(...buildAIReasoningTrace(`strategy-repair-${attempt}`, repairResponse));
    const repaired = parseStrategyGenerationPackage(repairResponse.text);
    intentPlan = normalizeObject(repaired.intentPlan) || intentPlan;
    logicIR = normalizeObject(repaired.logicIR) || logicIR;
    strategy = normalizeStrategyGraphForRunner(repaired.runtimeGraph, prompt, { intentPlan, logicIR, exchangeConnections });
    emitAgentProgress(onProgress, {
      stage: 'repair',
      label: `수정 ${attempt}/${maxAttempts}: 수정안 수신, 재검증 준비`,
      detail: { attempt },
    });
  }

  const last = history[history.length - 1] || {};
  throw makeStrategyValidationError(
    `strategy validation failed after ${maxAttempts} attempt(s): ${(last.issues || []).slice(0, 8).join('; ') || 'unknown validation error'}`,
    {
      runId: logicErrorRunId,
      logPath: logicErrorLogPath,
      attempts: maxAttempts,
      entries: logicErrorLogEntries,
      readEndpoint: `/api/ai/strategy-logic-error-log?runId=${encodeURIComponent(logicErrorRunId)}`,
    },
  );
}

async function fetchTextOrThrow(provider, endpoint, requestInit, timeoutSeconds) {
  const hasTimeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0;
  let response;
  try {
    response = await fetch(endpoint, {
      ...requestInit,
      signal: hasTimeout ? AbortSignal.timeout(timeoutSeconds * 1000) : undefined,
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`${provider} request timed out after ${timeoutSeconds}s (${endpoint})`);
    }
    throw new Error(`${provider} request failed: ${error?.message || 'network error'} (${endpoint})`);
  }
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
  const thinkEnabled = resolveLayerBool(layer, 'OLLAMA_THINK');
  const options = { temperature: 0.2, think: thinkEnabled === null ? false : thinkEnabled };
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
      options,
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
    resolveLayerTimeoutSeconds(layer, 'OLLAMA_TIMEOUT_SEC', 0),
  );

  const parsedMessage = wireAPI === 'openai'
    ? parseChatCompletionMessage(rawText)
    : { content: parseOllamaChatContent(rawText), reasoningContent: '' };

  return {
    text: parsedMessage.content,
    reasoningContent: parsedMessage.reasoningContent,
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
    reasoningContent: '',
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

  const parsedMessage = parseChatCompletionMessage(rawText);
  return {
    text: parsedMessage.content,
    reasoningContent: parsedMessage.reasoningContent,
    provider: 'openai',
    model,
    source: 'openai-chat-completions-layer',
  };
}

async function callDeepSeekLayer(layer, systemPrompt, userPrompt) {
  const apiKey = resolveDeepSeekAPIKey(layer);
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set');
  }

  const baseURL = normalizeBaseURL(layerEnv(layer, 'DEEPSEEK_BASE_URL') || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  const endpoint = layerEnv(layer, 'DEEPSEEK_CHAT_ENDPOINT') || normalizeText(process.env.DEEPSEEK_CHAT_ENDPOINT) || `${baseURL}/chat/completions`;
  const model = layerEnv(layer, 'DEEPSEEK_MODEL') || layerEnv(layer, 'MODEL') || normalizeText(process.env.DEEPSEEK_MODEL) || 'deepseek-v4-flash';
  const thinkingEnabled = resolveLayerBool(layer, 'DEEPSEEK_THINKING');

  const payload = {
    model,
    temperature: 0.2,
    thinking: { type: thinkingEnabled === true ? 'enabled' : 'disabled' },
    reasoning_effort: layerEnv(layer, 'DEEPSEEK_REASONING_EFFORT')
      || layerEnv(layer, 'REASONING_EFFORT')
      || normalizeText(process.env.DEEPSEEK_REASONING_EFFORT)
      || (thinkingEnabled === true ? 'high' : undefined),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };

  const rawText = await fetchTextOrThrow(
    'deepseek',
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    resolveLayerTimeoutSeconds(layer, 'DEEPSEEK_TIMEOUT_SEC', 180),
  );

  const parsedMessage = parseChatCompletionMessage(rawText);
  return {
    text: parsedMessage.content,
    reasoningContent: parsedMessage.reasoningContent,
    provider: 'deepseek',
    model,
    source: 'deepseek-chat-completions-layer',
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
  if (provider === 'deepseek') {
    return callDeepSeekLayer(layer, systemPrompt, userPrompt);
  }
  throw new Error(`unsupported AI provider for layer ${layer}: ${provider}`);
}

function buildAIReasoningTrace(layer, response) {
  const content = normalizeText(response?.reasoningContent);
  if (!content) {
    return [];
  }
  return [{
    layer: normalizeText(layer).toLowerCase(),
    provider: response.provider,
    model: response.model,
    content,
  }];
}

async function runOrchestratorLayer({ prompt, currentStrategy, exchangeConnections = [], userContext = null }) {
  const fallbackPlan = buildDefaultOrchestrationPlan(prompt);
  try {
    const response = await callAITextLayer({
      layer: 'ORCHESTRATOR',
      systemPrompt: buildOrchestratorSystemPrompt(),
      userPrompt: buildOrchestratorUserPrompt(prompt, currentStrategy, exchangeConnections, userContext)
    });
    const parsed = parseJSONObjectWithSchema(response.text, 'orchestration plan', ORCHESTRATION_PLAN_SCHEMA);
    return {
      plan: normalizeOrchestrationPlan(parsed, prompt),
      provider: response.provider,
      model: response.model,
      source: response.source,
      reasoning: buildAIReasoningTrace('orchestrator', response),
      warnings: []
    };
  } catch (error) {
    return {
      plan: fallbackPlan,
      provider: 'fallback',
      model: '',
      source: 'fallback-orchestrator-plan',
      reasoning: [],
      warnings: [error?.message || 'orchestrator failed']
    };
  }
}

async function runResearchLayer({
  prompt,
  currentStrategy,
  orchestrationPlan,
  authContext,
  exchangeConnections = [],
  userContext = null,
}) {
  const requestExplorerAPIKey = resolveExplorerAPIKeyFromAuthContext(authContext);
  const baseBundle = buildFallbackResearchBundle({ prompt, orchestrationPlan });
  let aiBundle = null;
  let provider = 'fallback';
  let model = '';
  let source = 'fallback-research-bundle';
  let warnings = [];
  let reasoning = [];

  try {
    const response = await callAITextLayer({
      layer: 'RESEARCH',
      systemPrompt: buildResearchSystemPrompt(),
      userPrompt: buildResearchUserPrompt(prompt, orchestrationPlan, exchangeConnections, userContext)
    });
    const parsed = parseJSONObjectWithSchema(response.text, 'research bundle', RESEARCH_BUNDLE_SCHEMA);
    aiBundle = normalizeResearchBundle(parsed, { prompt, orchestrationPlan, currentStrategy });
    provider = response.provider;
    model = response.model;
    source = response.source;
    reasoning = buildAIReasoningTrace('research', response);
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
    reasoning,
  };
}

async function runStrategyLayer({ prompt, currentStrategy, researchBundle, orchestrationPlan, exchangeConnections = [], userContext = null, onProgress = null }) {
  emitAgentProgress(onProgress, {
    stage: 'strategy-context',
    label: '전략 생성 컨텍스트 구성',
  });
  const userPrompt = await buildAIStrategyUserPrompt(
    prompt,
    currentStrategy,
    researchBundle,
    orchestrationPlan,
    exchangeConnections,
    userContext,
  );
  emitAgentProgress(onProgress, {
    stage: 'strategy-generation',
    label: 'AI 전략 패키지 생성 요청',
  });
  const response = await callAITextLayer({
    layer: 'STRATEGY',
    systemPrompt: buildAIStrategySystemPrompt(),
    userPrompt
  });
  emitAgentProgress(onProgress, {
    stage: 'strategy-generation',
    label: 'AI 전략 패키지 수신, 스키마 정규화',
    detail: { provider: response.provider, model: response.model },
  });
  const generated = parseStrategyGenerationPackage(response.text);
  const validated = await validateRepairAndMaterializeStrategy({
    prompt,
    currentStrategy,
    researchBundle,
    orchestrationPlan,
    initialPackage: generated,
    exchangeConnections,
    userContext,
    onProgress,
  });
  let overview = null;
  let strategy = validated.strategy;
  let overviewWarning = '';
  try {
    emitAgentProgress(onProgress, {
      stage: 'overview',
      label: '쉬운 보기 설명 생성',
    });
    overview = await runStrategyOverviewLayer({
      prompt,
      strategyGraph: validated.strategy,
      logicIR: validated.logicIR,
    });
    strategy = overview.strategy;
    emitAgentProgress(onProgress, {
      stage: 'overview',
      label: '쉬운 보기 설명 생성 완료',
      detail: { provider: overview.provider, model: overview.model },
    });
  } catch (error) {
    overviewWarning = error?.message || 'strategy overview generation failed';
    emitAgentProgress(onProgress, {
      stage: 'overview',
      label: '쉬운 보기 설명은 로컬 기본값으로 대체',
      detail: { warning: overviewWarning },
    });
  }
  return {
    strategy,
    provider: response.provider,
    model: response.model,
    source: response.source,
    validation: validated.validation,
    runtime: validated.runtime,
    overview: overview
      ? {
        provider: overview.provider,
        model: overview.model,
        source: overview.source,
      }
      : {
        provider: 'fallback',
        model: '',
        source: 'local-overview-fallback',
        warning: overviewWarning,
      },
    reasoning: [
      ...buildAIReasoningTrace('strategy', response),
      ...(validated.reasoning || []),
      ...(overview?.reasoning || []),
    ],
  };
}

async function runOrchestrationPipeline({ prompt, currentStrategy, authContext, exchangeConnections = [], userContext = null, onProgress = null }) {
  emitAgentProgress(onProgress, {
    stage: 'orchestrator',
    label: '요청 의도 분석 및 작업 계획 수립',
  });
  const orchestrator = await runOrchestratorLayer({ prompt, currentStrategy, exchangeConnections, userContext });
  emitAgentProgress(onProgress, {
    stage: 'orchestrator',
    label: orchestrator.plan.needResearch ? '오케스트레이션 완료: 리서치 필요' : '오케스트레이션 완료: 리서치 생략',
    detail: {
      provider: orchestrator.provider,
      model: orchestrator.model,
      needResearch: orchestrator.plan.needResearch,
    },
  });
  const research = orchestrator.plan.needResearch
    ? await (async () => {
      emitAgentProgress(onProgress, {
        stage: 'research',
        label: '시장/프로토콜 리서치 실행',
      });
      const researched = await runResearchLayer({
        prompt,
        currentStrategy,
        orchestrationPlan: orchestrator.plan,
        authContext,
        exchangeConnections,
        userContext,
      });
      emitAgentProgress(onProgress, {
        stage: 'research',
        label: '리서치 번들 정리 완료',
        detail: {
          provider: researched.provider,
          model: researched.model,
          findings: researched.research?.summary?.findings || 0,
          urls: researched.research?.summary?.urls || 0,
        },
      });
      return researched;
    })()
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
      source: 'orchestrator-skip-research',
      reasoning: []
    };

  emitAgentProgress(onProgress, {
    stage: 'strategy',
    label: '전략 코드/IR/런타임 그래프 생성 단계 진입',
  });
  const strategy = await runStrategyLayer({
    prompt,
    currentStrategy,
    researchBundle: research.research,
    orchestrationPlan: orchestrator.plan,
    exchangeConnections,
    userContext,
    onProgress,
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
      strategy: strategy.provider,
      overview: strategy.overview?.provider || ''
    },
    models: {
      orchestrator: orchestrator.model,
      research: research.model,
      strategy: strategy.model,
      overview: strategy.overview?.model || ''
    },
    validation: strategy.validation,
    runtime: strategy.runtime,
    overview: strategy.overview,
    reasoning: [
      ...(orchestrator.reasoning || []),
      ...(research.reasoning || []),
      ...(strategy.reasoning || [])
    ]
  };
}
