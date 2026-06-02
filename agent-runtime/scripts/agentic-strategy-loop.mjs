#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONT_ROOT, '..', '..');
const PYTHON_NATIVE_AGENT_LOOP_SCRIPT = path.join(FRONT_ROOT, 'server', 'agentic_strategy_loop_py', 'native_langgraph.py');

loadEnvFiles([
  path.join(FRONT_ROOT, '.env.local'),
  path.join(FRONT_ROOT, '.env'),
  path.join(REPO_ROOT, '.env.local'),
  path.join(REPO_ROOT, '.env'),
]);

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    printHelp();
  } else {
    const prompt = String(args.prompt || args.query || args.q || args._.join(' ') || '').trim();
    if (!prompt) {
      throw new Error('prompt is required');
    }

    const result = await runNativePythonAgentLoop(prompt, {
      databaseUrl: args.databaseUrl,
      chain: args.chain,
      assets: splitCSV(args.assets),
      riskProfile: args.riskProfile || args.risk,
      executionDomain: args.executionDomain || args.domain,
      searchLimit: args.searchLimit || args.limit,
      webSearch: args.webSearch,
      webSearchProvider: args.webSearchProvider || args.webProvider,
      webResultLimit: args.webResultLimit,
      webQueryLimit: args.webQueryLimit,
      webQueries: args.webQueries,
      webSearchTimeoutMs: args.webSearchTimeoutMs,
      braveSearchApiKey: args.braveSearchApiKey,
      tavilyApiKey: args.tavilyApiKey,
      serperApiKey: args.serperApiKey,
      fetchWebPages: args.fetchWebPages,
      apiFetchLimit: args.apiFetchLimit,
      pageFetchTimeoutMs: args.pageFetchTimeoutMs,
      validate: args.validate === undefined ? true : Boolean(args.validate),
      validationTimeoutSeconds: args.validationTimeoutSeconds || args.validationTimeout || args.timeout,
      contractReasoning: args.contractReasoning,
      contractReasoningChunkLimit: args.contractReasoningChunkLimit,
      embeddingProvider: args.embeddingProvider || args.provider,
      openaiApiKey: args.openaiApiKey,
      openaiBaseUrl: args.openaiBaseUrl,
      ollamaBaseUrl: args.ollamaBaseUrl,
      embeddingModel: args.embeddingModel || args.model,
      embeddingDim: args.embeddingDim || args.dimensions,
      embeddingQueryPrefix: args.embeddingQueryPrefix,
      embeddingDocumentPrefix: args.embeddingDocumentPrefix,
      embeddingMaxInputTokens: args.embeddingMaxInputTokens,
      rpcUrl: args.rpcUrl || args.rpc,
      websocketUrl: args.websocketUrl || args.wsUrl || args.ws || args.wssUrl || args.wss,
    });

    if (args.json || args.full) {
      printJSON(result);
    } else {
      printSummary(result);
    }
  }
} catch (error) {
  console.error(`agentic-strategy-loop: ${error?.message || error}`);
  process.exitCode = 1;
}

function runNativePythonAgentLoop(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const python = String(process.env.HERSHY_AGENT_LOOP_PYTHON || process.env.PYTHON || 'python3').trim() || 'python3';
    const child = spawn(python, [PYTHON_NATIVE_AGENT_LOOP_SCRIPT], {
      cwd: FRONT_ROOT,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONWARNINGS: 'ignore',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`python native agent loop failed (${code}): ${stderr.trim() || stdout.trim() || 'no output'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`python native agent loop returned invalid JSON: ${error?.message || error}`));
      }
    });
    child.stdin.end(`${JSON.stringify({ prompt, options })}\n`);
  });
}

function parseArgs(rawArgs) {
  const parsed = { _: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const key = camelCase(arg.slice(2, eqIndex > -1 ? eqIndex : undefined));
    const value = eqIndex > -1 ? arg.slice(eqIndex + 1) : rawArgs[index + 1];
    if (eqIndex === -1 && (value === undefined || String(value).startsWith('--'))) {
      parsed[key] = true;
      continue;
    }
    if (eqIndex === -1) {
      index += 1;
    }
    parsed[key] = normalizeArgValue(value);
  }
  return parsed;
}

function normalizeArgValue(value) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

function camelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, chr) => chr.toUpperCase());
}

function splitCSV(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

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

function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    if (!fsSync.existsSync(filePath)) {
      continue;
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
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = stripEnvQuotes(normalized.slice(separatorIndex + 1));
    }
  }
}

function printJSON(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printSummary(result) {
  const plan = result.workflowPlan || {};
  const graph = result.strategy || {};
  const research = result.research || {};
  const webDiscovery = result.webDiscovery || {};
  const apiResearch = result.apiResearch || {};
  const validation = result.validation || {};
  const readiness = result.executionReadiness || result.strategy?.metadata?.executionReadiness || {};
  const contractResolution = result.contractResolution || result.evidenceBundle?.contractResolution || {};
  const resolvedContracts = contractResolution.resolution?.contracts || contractResolution.contracts || [];
  console.log(`Algorithm: ${plan.selectedAlgorithm?.id || 'unknown'}`);
  console.log(`Domain: ${plan.executionDomain?.id || 'unknown'}`);
  console.log(`Web discovery: ${webDiscovery.status || 'unknown'} (${result.evidenceBundle?.webSources?.length || 0} sources)`);
  console.log(`API/docs research: ${apiResearch.status || 'unknown'} (${result.evidenceBundle?.apiSources?.length || 0} pages)`);
  console.log(`KG research: ${research.status || 'unknown'}`);
  console.log(`Contract resolution: ${contractResolution.status || 'unknown'} (${resolvedContracts.length} contracts)`);
  console.log(`Adaptive labels: ${result.workflowPlan?.adaptiveLabels?.length || 0}`);
  console.log(`Evidence chunks: ${result.evidenceBundle?.chunks?.length || 0}`);
  console.log(`Persistence: ${result.persistence?.status || 'unknown'}${result.persistence?.runID ? ` (${result.persistence.runID})` : ''}`);
  console.log(`Strategy graph: ${graph.blocks?.length || 0} blocks, ${graph.connections?.length || 0} connections`);
  console.log(`Validation: ${validation.ok === true ? 'ok' : validation.skipped ? 'skipped' : 'failed'}`);
  console.log(`Execution readiness: ${readiness.status || 'unknown'}${readiness.liveExecutable === true ? ' (live executable)' : ''}`);
  if (Array.isArray(readiness.actions) && readiness.actions.some((action) => action.liveExecutable === false)) {
    console.log('\nExecution readiness issues:');
    for (const action of readiness.actions.filter((item) => item.liveExecutable === false).slice(0, 6)) {
      const issue = Array.isArray(action.issues) && action.issues.length > 0 ? `: ${action.issues[0]}` : '';
      console.log(`- ${action.id} [${action.status}]${issue}`);
    }
  }
  if (Array.isArray(validation.issues) && validation.issues.length > 0) {
    console.log('\nValidation issues:');
    for (const issue of validation.issues.slice(0, 12)) {
      console.log(`- ${issue}`);
    }
  }
}

function printHelp() {
  console.log(`
Usage:
  npm run strategy:agent-loop -- --prompt "Base에서 BTC ETH 유동성 공급하고 싶어"

Options:
  --prompt "..."                 User strategy request.
  --chain base-mainnet           Optional chain hint.
  --assets BTC,ETH               Optional asset hints.
  --execution-domain onchain_only|cex_only|hybrid_cex_onchain
  --limit 8                      KG search limit per research task.
  --web-search=false             Disable web discovery.
  --web-provider duckduckgo       duckduckgo | brave | tavily | serper.
  --web-result-limit 5            Search results per web query.
  --web-query-limit 4             Number of generated web queries.
  --fetch-web-pages=false         Disable API/docs page preview fetch.
  --api-fetch-limit 4             Number of API/docs pages to preview.
  --json                         Print the full strategy package.
  --validate=false               Skip Go strategy graph validation.
  --contract-reasoning=false     Disable AI contract reasoning analysis.
  --provider ollama              Embedding provider for semantic KG search.
  --model nomic-embed-text       Embedding model.
  --rpc-url https://...          External EVM RPC URL for polling/view-read blocks.
  --ws-url wss://...             External WebSocket URL for streaming blocks.

Environment:
  KG_DATABASE_URL=postgres://...
  KG_EMBEDDING_PROVIDER=ollama
  KG_OLLAMA_BASE_URL=http://localhost:11434
  KG_EMBEDDING_MODEL=nomic-embed-text
  AGENT_WEB_SEARCH_PROVIDER=duckduckgo
  BRAVE_SEARCH_API_KEY=...
  TAVILY_API_KEY=...
  SERPER_API_KEY=...
  BASE_RPC_URL=https://mainnet.base.org
  BASE_WS_URL=wss://...
`.trim());
}
