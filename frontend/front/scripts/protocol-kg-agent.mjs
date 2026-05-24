#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyKGMigrations,
  backfillChunkEmbeddings,
  createEmbeddingHNSWIndex,
  createKGPool,
  enqueueProtocolResearchTask,
  ingestProtocolSeedToGraph,
  readKnowledgePageHistory,
  runProtocolKnowledgeAgentLoop,
  searchProtocolKnowledgeGraph,
} from '../server/protocolKnowledgeGraphLoop.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONT_ROOT, '..', '..');

loadEnvFiles([
  path.join(FRONT_ROOT, '.env.local'),
  path.join(FRONT_ROOT, '.env'),
  path.join(REPO_ROOT, '.env.local'),
  path.join(REPO_ROOT, '.env'),
]);

const command = process.argv[2] || 'help';
const args = parseArgs(process.argv.slice(3));

try {
  if (command === 'migrate') {
    const result = await applyKGMigrations({
      cwd: FRONT_ROOT,
      migrationsDir: args.migrationsDir,
      databaseUrl: args.databaseUrl,
    });
    printJSON(result);
  } else if (command === 'enqueue') {
    const config = await loadConfig(args.config);
    const result = await enqueueProtocolResearchTask({
      databaseUrl: args.databaseUrl,
      protocolName: args.protocol || args.name || config.protocol || config.protocolName,
      protocolSlug: args.slug || config.slug || config.protocolSlug,
      chain: args.chain || config.chain || 'base-mainnet',
      addresses: normalizeAddressArgs([
        ...(config.addresses || []),
        ...toList(args.address),
        ...toList(args.addresses),
      ]),
      website: args.website || config.website,
      docsUrl: args.docsUrl || config.docsUrl,
      githubUrl: args.githubUrl || config.githubUrl,
      category: args.category || config.category,
      notes: args.notes || config.notes,
      priority: args.priority || config.priority,
      maxAttempts: args.maxAttempts || config.maxAttempts,
    });
    printJSON(result);
  } else if (command === 'loop') {
    const result = await runProtocolKnowledgeAgentLoop({
      databaseUrl: args.databaseUrl,
      workerID: args.workerId || args.workerID,
      once: Boolean(args.once),
      maxJobs: args.maxJobs || args.limit,
      explorerApiKey: args.explorerApiKey || args.apiKey,
      rpcUrl: args.rpcUrl || args.rpc,
      embeddingProvider: args.embeddingProvider,
      openaiApiKey: args.openaiApiKey,
      openaiBaseUrl: args.openaiBaseUrl,
      ollamaBaseUrl: args.ollamaBaseUrl,
      embeddingModel: args.embeddingModel || args.model,
      embeddingDim: args.embeddingDim,
      embeddingQueryPrefix: args.embeddingQueryPrefix,
      embeddingDocumentPrefix: args.embeddingDocumentPrefix,
      embeddingMaxInputTokens: args.embeddingMaxInputTokens,
    });
    printJSON(result);
  } else if (command === 'ingest') {
    const config = await loadConfig(args.config);
    const pool = createKGPool({ databaseUrl: args.databaseUrl });
    try {
      const result = await ingestProtocolSeedToGraph(pool, {
        protocolName: args.protocol || args.name || config.protocol || config.protocolName,
        protocolSlug: args.slug || config.slug || config.protocolSlug,
        chain: args.chain || config.chain || 'base-mainnet',
        addresses: normalizeAddressArgs([
          ...(config.addresses || []),
          ...toList(args.address),
          ...toList(args.addresses),
        ]),
        website: args.website || config.website,
        docsUrl: args.docsUrl || config.docsUrl,
        githubUrl: args.githubUrl || config.githubUrl,
        category: args.category || config.category,
        notes: args.notes || config.notes,
        explorerApiKey: args.explorerApiKey || args.apiKey || config.explorerApiKey,
        rpcUrl: args.rpcUrl || args.rpc || config.rpcUrl,
        embeddingProvider: args.embeddingProvider || config.embeddingProvider,
        openaiApiKey: args.openaiApiKey || config.openaiApiKey,
        openaiBaseUrl: args.openaiBaseUrl || config.openaiBaseUrl,
        ollamaBaseUrl: args.ollamaBaseUrl || config.ollamaBaseUrl,
        embeddingModel: args.embeddingModel || config.embeddingModel,
        embeddingDim: args.embeddingDim || config.embeddingDim,
        embeddingQueryPrefix: args.embeddingQueryPrefix || config.embeddingQueryPrefix,
        embeddingDocumentPrefix: args.embeddingDocumentPrefix || config.embeddingDocumentPrefix,
        embeddingMaxInputTokens: args.embeddingMaxInputTokens || config.embeddingMaxInputTokens,
      });
      printJSON(result);
    } finally {
      await pool.end();
    }
  } else if (command === 'search') {
    const result = await searchProtocolKnowledgeGraph({
      databaseUrl: args.databaseUrl,
      query: args.query || args.q || args._.join(' '),
      limit: args.limit,
      embeddingProvider: args.embeddingProvider,
      openaiApiKey: args.openaiApiKey,
      openaiBaseUrl: args.openaiBaseUrl,
      ollamaBaseUrl: args.ollamaBaseUrl,
      embeddingModel: args.embeddingModel,
      embeddingDim: args.embeddingDim,
      embeddingQueryPrefix: args.embeddingQueryPrefix,
      embeddingDocumentPrefix: args.embeddingDocumentPrefix,
      embeddingMaxInputTokens: args.embeddingMaxInputTokens,
    });
    if (args.json) {
      printJSON(result);
    } else {
      printSearchResult(result);
    }
  } else if (command === 'history') {
    const result = await readKnowledgePageHistory({
      databaseUrl: args.databaseUrl,
      internalURI: args.uri || args.internalUri || args.internalURI,
      query: args.query || args.q || args._.join(' '),
      limit: args.limit,
    });
    if (args.json) {
      printJSON(result);
    } else {
      printHistoryResult(result);
    }
  } else if (command === 'embedding-index') {
    const result = await createEmbeddingHNSWIndex({
      databaseUrl: args.databaseUrl,
      embeddingProvider: args.embeddingProvider || args.provider,
      embeddingModel: args.embeddingModel || args.model,
      embeddingDimensions: args.embeddingDimensions || args.dimensions,
      m: args.m,
      efConstruction: args.efConstruction,
    });
    printJSON(result);
  } else if (command === 'embed-backfill') {
    const result = await backfillChunkEmbeddings({
      databaseUrl: args.databaseUrl,
      embeddingProvider: args.embeddingProvider || args.provider,
      embeddingModel: args.embeddingModel || args.model,
      ollamaBaseUrl: args.ollamaBaseUrl,
      openaiApiKey: args.openaiApiKey,
      openaiBaseUrl: args.openaiBaseUrl,
      embeddingDim: args.embeddingDim,
      embeddingQueryPrefix: args.embeddingQueryPrefix,
      embeddingDocumentPrefix: args.embeddingDocumentPrefix,
      embeddingMaxInputTokens: args.embeddingMaxInputTokens,
      all: Boolean(args.all),
      limit: args.limit,
      batchSize: args.batchSize,
      chunkType: args.chunkType,
      protocolSlug: args.protocolSlug || args.slug,
      onProgress: args.quiet ? undefined : (progress) => {
        console.log(JSON.stringify({ type: 'embedding_progress', ...progress }));
      },
    });
    printJSON(result);
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`protocol-kg-agent: ${error?.message || error}`);
  process.exitCode = 1;
}

function parseArgs(rawArgs) {
  const parsed = { _: [] };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const key = camelCase(arg.slice(2, eqIndex > -1 ? eqIndex : undefined));
    const value = eqIndex > -1 ? arg.slice(eqIndex + 1) : rawArgs[i + 1];
    if (eqIndex === -1 && (value === undefined || String(value).startsWith('--'))) {
      parsed[key] = true;
      continue;
    }
    if (eqIndex === -1) {
      i += 1;
    }
    if (parsed[key] === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(value);
    } else {
      parsed[key] = [parsed[key], value];
    }
  }
  return parsed;
}

function camelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, chr) => chr.toUpperCase());
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

async function loadConfig(configPath) {
  if (!configPath) {
    return {};
  }
  const absolute = path.resolve(FRONT_ROOT, configPath);
  const text = await fs.readFile(absolute, 'utf8');
  return JSON.parse(text);
}

function normalizeAddressArgs(values) {
  const list = Array.isArray(values) ? values : [values];
  return list
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function toList(value) {
  if (value === undefined || value === null || value === false) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function printJSON(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printSearchResult(result) {
  console.log(`Query: ${result.query}`);
  console.log('');
  console.log('Entities');
  if (result.entities.length === 0) {
    console.log('- none');
  } else {
    for (const entity of result.entities) {
      console.log(`- ${entity.type}: ${entity.canonical_name || entity.address || entity.id}`);
      if (entity.address) {
        console.log(`  address: ${entity.address}`);
      }
    }
  }
  console.log('');
  console.log('Chunks');
  if (result.chunks.length === 0) {
    console.log('- none');
  } else {
    for (const chunk of result.chunks) {
      console.log(`- ${chunk.chunk_type}: ${chunk.canonical_name || chunk.address || chunk.id}`);
      if (chunk.internal_uri) {
        console.log(`  page: ${chunk.internal_uri}`);
      }
      if (chunk.previous_internal_uri) {
        console.log(`  previous: ${chunk.previous_internal_uri}`);
      }
      if (chunk.modified_at) {
        console.log(`  modified: ${chunk.modified_at}`);
      }
      console.log(`  ${String(chunk.text || '').replace(/\s+/g, ' ').slice(0, 320)}`);
    }
  }
  console.log('');
  console.log('Semantic Chunks');
  if (!result.semanticChunks || result.semanticChunks.length === 0) {
    console.log('- none');
  } else {
    for (const chunk of result.semanticChunks) {
      console.log(`- ${chunk.chunk_type}: ${chunk.canonical_name || chunk.address || chunk.id}`);
      console.log(`  score: ${chunk.score}`);
      if (chunk.internal_uri) {
        console.log(`  page: ${chunk.internal_uri}`);
      }
      if (chunk.previous_internal_uri) {
        console.log(`  previous: ${chunk.previous_internal_uri}`);
      }
      if (chunk.modified_at) {
        console.log(`  modified: ${chunk.modified_at}`);
      }
      console.log(`  ${String(chunk.text || '').replace(/\s+/g, ' ').slice(0, 320)}`);
    }
  }
  console.log('');
  console.log('Edges');
  if (result.edges.length === 0) {
    console.log('- none');
  } else {
    for (const edge of result.edges) {
      console.log(`- ${edge.src_name} --${edge.relation_type}--> ${edge.dst_name} (${edge.confidence})`);
    }
  }
}

function printHistoryResult(result) {
  const label = result.internalURI || result.query;
  console.log(`History: ${label}`);
  if (!result.revisions || result.revisions.length === 0) {
    console.log('- none');
    return;
  }
  for (const revision of result.revisions) {
    console.log(`- rev ${revision.revision_number} ${revision.is_current ? '(current)' : '(historical)'}`);
    console.log(`  page: ${revision.page_internal_uri}`);
    console.log(`  revision: ${revision.revision_internal_uri}`);
    if (revision.revision_previous_internal_uri) {
      console.log(`  previous: ${revision.revision_previous_internal_uri}`);
    }
    if (revision.superseded_by_internal_uri) {
      console.log(`  superseded_by: ${revision.superseded_by_internal_uri}`);
    }
    console.log(`  modified: ${revision.revision_modified_at}`);
    console.log(`  valid: ${revision.valid_from} -> ${revision.valid_to || 'present'}`);
    console.log(`  hash: ${revision.content_hash}`);
  }
}

function printHelp() {
  console.log(`
Protocol Knowledge Graph Agent

Commands:
  migrate   Apply PostgreSQL + pgvector schema.
  enqueue   Add a protocol seed task to the pre-research queue.
  loop      Process queued tasks and grow the DB.
  ingest    Directly ingest one protocol seed without queueing.
  search    Search entities, full-text chunks, and neighboring edges.
  history   Show current and historical internal page revisions.
  embed-backfill
           Fill missing chunk embeddings in small batches.
  embedding-index
           Create a per-provider/model/dimension pgvector HNSW index.

Examples:
  npm run kg:migrate
  npm run kg:enqueue -- --protocol "Aerodrome" --chain base-mainnet --address 0x...
  npm run kg:enqueue -- --protocol "Test Protocol" --chain base-sepolia --address 0x...
  npm run kg:loop -- --once
  npm run kg:ingest -- --protocol "Aerodrome" --address 0x...
  npm run kg:search -- --query "fee controller router pool"
  npm run kg:history -- --uri "kg://..."
  npm run kg:embed-backfill -- --provider ollama --model nomic-embed-text --all --batchSize 10
  npm run kg:embedding-index -- --provider ollama --model nomic-embed-text --dimensions 768

Config JSON:
  {
    "protocol": "Example Protocol",
    "chain": "base-mainnet",
    "addresses": ["0x..."],
    "website": "https://...",
    "docsUrl": "https://...",
    "githubUrl": "https://..."
  }

Environment:
  KG_DATABASE_URL=postgres://...
  ETHERSCAN_API_KEY=...         # preferred for https://api.etherscan.io/v2/api
  BASESCAN_API_KEY=...          # accepted alias for older env setups
  BASE_RPC_URL=...
  BASE_SEPOLIA_RPC_URL=...
  KG_EMBEDDING_PROVIDER=ollama  # optional local embedding
  KG_OLLAMA_BASE_URL=http://localhost:11434
  KG_EMBEDDING_MODEL=nomic-embed-text
  KG_EMBEDDING_QUERY_PREFIX=
  KG_EMBEDDING_DOCUMENT_PREFIX=
  OPENAI_API_KEY=...            # optional alternative provider
  KG_EMBEDDING_DIM=1536         # OpenAI-only default dimension override
  KG_HNSW_M=16
  KG_HNSW_EF_CONSTRUCTION=64
`.trim());
}
