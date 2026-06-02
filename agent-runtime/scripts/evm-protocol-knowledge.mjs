#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ingestEVMProtocolKnowledge,
  readEVMProtocolAlerts,
  searchEVMProtocolKnowledge,
} from '../server/evmProtocolKnowledge.mjs';

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
  if (command === 'ingest' || command === 'scan') {
    const config = await loadConfig(args.config);
    const addresses = normalizeAddressArgs([
      ...(config.addresses || []),
      ...toList(args.address),
      ...toList(args.addresses),
    ]);
    const result = await ingestEVMProtocolKnowledge({
      cwd: FRONT_ROOT,
      protocolName: args.protocol || args.name || config.protocol || config.protocolName,
      protocolSlug: args.slug || config.slug || config.protocolSlug,
      chain: args.chain || config.chain || 'base-mainnet',
      addresses,
      explorerApiKey: args.explorerApiKey || args.apiKey || config.explorerApiKey,
      rpcUrl: args.rpcUrl || args.rpc || config.rpcUrl,
      dbPath: args.db || config.dbPath,
      docsDir: args.docsDir || config.docsDir,
    });
    printJSON(result);
  } else if (command === 'search') {
    const query = args.query || args.q || args._.join(' ');
    const rows = searchEVMProtocolKnowledge({
      cwd: FRONT_ROOT,
      query,
      dbPath: args.db,
      limit: args.limit,
    });
    if (args.json) {
      printJSON(rows);
    } else {
      printSearchRows(rows);
    }
  } else if (command === 'alerts') {
    const rows = readEVMProtocolAlerts({
      cwd: FRONT_ROOT,
      dbPath: args.db,
      limit: args.limit,
    });
    if (args.json) {
      printJSON(rows);
    } else {
      printAlerts(rows);
    }
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`evm-protocol-knowledge: ${error?.message || error}`);
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

function printSearchRows(rows) {
  if (rows.length === 0) {
    console.log('No matching protocol knowledge found.');
    return;
  }
  for (const row of rows) {
    console.log(`${row.kind} | ${row.title}`);
    console.log(`  path: ${row.path}`);
    console.log(`  score: ${row.score}`);
    console.log(`  ${String(row.snippet || '').replace(/\s+/g, ' ').slice(0, 360)}`);
    console.log('');
  }
}

function printAlerts(rows) {
  if (rows.length === 0) {
    console.log('No protocol knowledge alerts found.');
    return;
  }
  for (const row of rows) {
    console.log(`#${row.id} [${row.severity}] ${row.kind}: ${row.title}`);
    console.log(`  protocol: ${row.protocolName}`);
    if (row.address) {
      console.log(`  address: ${row.address}`);
    }
    console.log(`  created: ${row.createdAt}`);
    console.log(`  ${row.body}`);
    console.log('');
  }
}

function printHelp() {
  console.log(`
EVM protocol knowledge CLI

Commands:
  ingest   Fetch Base/EVM contract source, proxy slots, bytecode, ABI, state reads, docs, and SQLite rows.
  scan     Alias for ingest; rerun to create alerts when proxy/source/ABI/bytecode changes.
  search   Search generated protocol and contract cards.
  alerts   Print recent update alerts.

Examples:
  npm run evm:protocol-ingest -- --protocol "Aerodrome" --chain base-mainnet --address 0x...
  npm run evm:protocol-ingest -- --protocol "Test Protocol" --chain base-sepolia --address 0x...
  npm run evm:protocol-ingest -- --config ./protocols/aerodrome.base.json
  npm run evm:protocol-search -- --query "oracle max leverage pause"
  npm run evm:protocol-alerts -- --limit 20

Config JSON:
  {
    "protocol": "Example Protocol",
    "chain": "base-mainnet",
    "addresses": ["0x..."],
    "dbPath": ".local/evm-protocol-knowledge.sqlite",
    "docsDir": "docs/rag/evm-protocols"
  }

Environment:
  ETHERSCAN_API_KEY             # preferred for https://api.etherscan.io/v2/api
  BASESCAN_API_KEY              # accepted alias for older env setups
  BASE_RPC_URL
  BASE_SEPOLIA_RPC_URL
  EVM_KNOWLEDGE_DB
  EVM_KNOWLEDGE_DOCS_DIR
`.trim());
}
