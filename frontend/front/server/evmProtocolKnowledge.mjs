import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
} from 'viem';

const ETHERSCAN_V2_ENDPOINT = 'https://api.etherscan.io/v2/api';
const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const EIP1967_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

export const EVM_KNOWLEDGE_CHAIN_CONFIGS = {
  'base-mainnet': {
    slug: 'base-mainnet',
    chainId: 8453,
    displayName: 'Base Mainnet',
    explorerAddressBase: 'https://basescan.org/address',
    legacyExplorerEndpoint: 'https://api.basescan.org/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'BASESCAN_API_KEY', 'BASE_MAINNET_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['BASE_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_MAINNET_RPC_HTTP_URL', 'RPC_URL'],
  },
  'base-sepolia': {
    slug: 'base-sepolia',
    chainId: 84532,
    displayName: 'Base Sepolia',
    explorerAddressBase: 'https://sepolia.basescan.org/address',
    legacyExplorerEndpoint: 'https://api-sepolia.basescan.org/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'BASESCAN_API_KEY', 'BASE_SEPOLIA_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['BASE_SEPOLIA_RPC_URL', 'BASE_SEPOLIA_RPC_HTTP_URL', 'RPC_URL'],
  },
};

const COMMON_STATE_NAME_RE = /^(name|symbol|decimals|totalSupply|owner|admin|governor|governance|guardian|paused|isPaused|pauseGuardian|factory|router|vault|pool|token|underlying|asset|weth|usdc|oracle|priceOracle|priceFeed|sequencerUptimeFeed|fee|feeBps|swapFee|protocolFee|maxFee|maxLeverage|minLeverage|maxCap|cap|debtCeiling|collateralFactor|liquidationThreshold|liquidationBonus|keeper|manager|controller|treasury|feeRecipient)$/i;
const STRATEGY_FUNCTION_RE = /(swap|exactInput|deposit|withdraw|mint|burn|borrow|repay|open|close|increase|decrease|liquidat|stake|unstake|claim|harvest|rebalance|execute|place|order|settle|flash|quote|collect)/i;
const RISK_FUNCTION_RE = /(pause|unpause|upgrade|set[A-Z]|configure|govern|admin|owner|fee|oracle|cap|limit|leverage|liquidat|emergency)/;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeChainSlug(raw) {
  const value = normalizeText(raw).toLowerCase().replace(/_/g, '-');
  if (!value || value === 'base' || value === '8453') {
    return 'base-mainnet';
  }
  if (value === 'base-sepolia' || value === 'basesepolia' || value === '84532') {
    return 'base-sepolia';
  }
  return EVM_KNOWLEDGE_CHAIN_CONFIGS[value] ? value : '';
}

function normalizeAddress(raw) {
  const value = normalizeText(raw);
  if (!value || !isAddress(value, { strict: false })) {
    return '';
  }
  try {
    return getAddress(value);
  } catch {
    return value.toLowerCase();
  }
}

function addressKey(raw) {
  return normalizeText(raw).toLowerCase();
}

function slugify(value, fallback = 'protocol') {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || fallback;
}

function nowISO() {
  return new Date().toISOString();
}

function stringifyJSON(value) {
  return JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ), 2);
}

function compactJSON(value) {
  return JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ));
}

function parseJSON(value, fallback = null) {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function explorerURL(chainConfig, address) {
  return `${chainConfig.explorerAddressBase}/${address}`;
}

function ensureDirSync(dirPath) {
  if (!fsSync.existsSync(dirPath)) {
    fsSync.mkdirSync(dirPath, { recursive: true });
  }
}

async function writeFileEnsured(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function firstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || '';
}

export function resolveEVMKnowledgeEnv(chainSlug, env = process.env) {
  const chain = EVM_KNOWLEDGE_CHAIN_CONFIGS[normalizeChainSlug(chainSlug)];
  if (!chain) {
    return { explorerApiKey: '', rpcUrl: '' };
  }
  const explorerApiKey = chain.apiKeyEnv.map((key) => normalizeText(env[key])).find(Boolean) || '';
  const rpcUrl = chain.rpcEnv.map((key) => normalizeText(env[key])).find(Boolean) || '';
  return { explorerApiKey, rpcUrl };
}

export function getDefaultEVMKnowledgePaths(cwd = process.cwd()) {
  return {
    dbPath: path.resolve(cwd, process.env.EVM_KNOWLEDGE_DB || '.local/evm-protocol-knowledge.sqlite'),
    docsDir: path.resolve(cwd, process.env.EVM_KNOWLEDGE_DOCS_DIR || 'docs/rag/evm-protocols'),
  };
}

export function openEVMKnowledgeDB(dbPath) {
  ensureDirSync(path.dirname(dbPath));
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS protocols (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      chain_slug TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY,
      protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      chain_slug TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      label TEXT,
      role TEXT,
      explorer_url TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(chain_slug, address)
    );

    CREATE TABLE IF NOT EXISTS contract_versions (
      id INTEGER PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      observed_at TEXT NOT NULL,
      block_number INTEGER,
      contract_name TEXT,
      compiler_version TEXT,
      source_format TEXT,
      bytecode_sha256 TEXT,
      source_sha256 TEXT,
      abi_sha256 TEXT,
      is_proxy INTEGER NOT NULL DEFAULT 0,
      proxy_type TEXT,
      implementation_address TEXT,
      source_json TEXT,
      abi_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS proxy_snapshots (
      id INTEGER PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      observed_at TEXT NOT NULL,
      block_number INTEGER,
      implementation_address TEXT,
      admin_address TEXT,
      beacon_address TEXT,
      proxy_type TEXT,
      slots_json TEXT,
      changed INTEGER NOT NULL DEFAULT 0,
      diff_json TEXT
    );

    CREATE TABLE IF NOT EXISTS abi_items (
      id INTEGER PRIMARY KEY,
      contract_version_id INTEGER NOT NULL REFERENCES contract_versions(id) ON DELETE CASCADE,
      chain_slug TEXT NOT NULL,
      address TEXT NOT NULL,
      item_type TEXT NOT NULL,
      name TEXT,
      signature TEXT,
      state_mutability TEXT,
      inputs_json TEXT,
      outputs_json TEXT
    );

    CREATE TABLE IF NOT EXISTS source_files (
      id INTEGER PRIMARY KEY,
      contract_version_id INTEGER NOT NULL REFERENCES contract_versions(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS state_snapshots (
      id INTEGER PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      observed_at TEXT NOT NULL,
      block_number INTEGER,
      values_json TEXT,
      errors_json TEXT
    );

    CREATE TABLE IF NOT EXISTS contract_relations (
      id INTEGER PRIMARY KEY,
      protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      from_contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      to_contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      metadata_json TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(protocol_id, from_contract_id, to_contract_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      metadata_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY,
      protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      diff_json TEXT,
      created_at TEXT NOT NULL,
      acknowledged_at TEXT
    );
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
      USING fts5(kind, title, body, path, metadata);
    `);
  } catch {
    // FTS5 may be unavailable in some Node builds. Search will fall back to LIKE.
  }

  return db;
}

function upsertProtocol(db, input) {
  const createdAt = nowISO();
  const row = db.prepare(`
    INSERT INTO protocols (slug, name, chain_slug, chain_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      chain_slug = excluded.chain_slug,
      chain_id = excluded.chain_id,
      updated_at = excluded.updated_at
    RETURNING id, slug, name, chain_slug, chain_id
  `).get(input.slug, input.name, input.chainSlug, input.chainId, createdAt, createdAt);
  return row;
}

function upsertContract(db, protocol, chainConfig, input) {
  const timestamp = nowISO();
  const address = normalizeAddress(input.address);
  const row = db.prepare(`
    INSERT INTO contracts (
      protocol_id, chain_slug, chain_id, address, label, role, explorer_url,
      first_seen_at, last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chain_slug, address) DO UPDATE SET
      protocol_id = excluded.protocol_id,
      label = COALESCE(excluded.label, contracts.label),
      role = COALESCE(excluded.role, contracts.role),
      explorer_url = excluded.explorer_url,
      last_seen_at = excluded.last_seen_at
    RETURNING id, protocol_id, chain_slug, chain_id, address, label, role, explorer_url
  `).get(
    protocol.id,
    chainConfig.slug,
    chainConfig.chainId,
    address,
    input.label || '',
    input.role || '',
    explorerURL(chainConfig, address),
    timestamp,
    timestamp,
  );
  return row;
}

function insertRelation(db, protocol, fromID, toID, relationType, metadata = {}) {
  db.prepare(`
    INSERT INTO contract_relations (
      protocol_id, from_contract_id, to_contract_id, relation_type, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(protocol_id, from_contract_id, to_contract_id, relation_type) DO UPDATE SET
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(protocol.id, fromID, toID, relationType, compactJSON(metadata), nowISO());
}

function insertAlert(db, protocolID, contractID, input) {
  db.prepare(`
    INSERT INTO alerts (
      protocol_id, contract_id, severity, kind, title, body, diff_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    protocolID,
    contractID || null,
    input.severity || 'info',
    input.kind,
    input.title,
    input.body,
    compactJSON(input.diff || {}),
    nowISO(),
  );
}

function getPreviousVersion(db, contractID) {
  return db.prepare(`
    SELECT * FROM contract_versions
    WHERE contract_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(contractID);
}

function getPreviousProxySnapshot(db, contractID) {
  return db.prepare(`
    SELECT * FROM proxy_snapshots
    WHERE contract_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(contractID);
}

function insertDocument(db, protocolID, contractID, input) {
  const timestamp = nowISO();
  const row = db.prepare(`
    INSERT INTO documents (protocol_id, contract_id, kind, title, path, body, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      protocol_id = excluded.protocol_id,
      contract_id = excluded.contract_id,
      kind = excluded.kind,
      title = excluded.title,
      body = excluded.body,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
    RETURNING id
  `).get(
    protocolID,
    contractID || null,
    input.kind,
    input.title,
    input.path,
    input.body,
    compactJSON(input.metadata || {}),
    timestamp,
  );

  try {
    db.prepare('DELETE FROM knowledge_fts WHERE path = ?').run(input.path);
    db.prepare('INSERT INTO knowledge_fts (kind, title, body, path, metadata) VALUES (?, ?, ?, ?, ?)').run(
      input.kind,
      input.title,
      input.body,
      input.path,
      compactJSON(input.metadata || {}),
    );
  } catch {
    // FTS is optional.
  }
  return row;
}

function insertContractVersion(db, contract, input) {
  const row = db.prepare(`
    INSERT INTO contract_versions (
      contract_id, observed_at, block_number, contract_name, compiler_version, source_format,
      bytecode_sha256, source_sha256, abi_sha256, is_proxy, proxy_type, implementation_address,
      source_json, abi_json, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    contract.id,
    input.observedAt,
    input.blockNumber || null,
    input.contractName || '',
    input.compilerVersion || '',
    input.sourceFormat || '',
    input.bytecodeHash || '',
    input.sourceHash || '',
    input.abiHash || '',
    input.isProxy ? 1 : 0,
    input.proxyType || '',
    input.implementationAddress || '',
    compactJSON(input.source || {}),
    compactJSON(input.abi || []),
    compactJSON(input.metadata || {}),
  );
  return row.id;
}

function insertABIItems(db, versionID, chainSlug, address, abi) {
  const statement = db.prepare(`
    INSERT INTO abi_items (
      contract_version_id, chain_slug, address, item_type, name, signature,
      state_mutability, inputs_json, outputs_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of abi || []) {
    if (!item || !['function', 'event', 'error'].includes(item.type)) {
      continue;
    }
    statement.run(
      versionID,
      chainSlug,
      address,
      item.type,
      normalizeText(item.name),
      formatABISignature(item),
      normalizeText(item.stateMutability),
      compactJSON(item.inputs || []),
      compactJSON(item.outputs || []),
    );
  }
}

function insertSourceFiles(db, versionID, sourceRecord) {
  const files = sourceRecord?.source?.files || [];
  const statement = db.prepare(`
    INSERT INTO source_files (contract_version_id, source_path, sha256, content)
    VALUES (?, ?, ?, ?)
  `);
  for (const file of files) {
    const content = file.content || '';
    statement.run(
      versionID,
      normalizeText(file.path) || 'Contract.sol',
      sha256Hex(content),
      content,
    );
  }
}

function insertStateSnapshot(db, contract, input) {
  db.prepare(`
    INSERT INTO state_snapshots (
      contract_id, observed_at, block_number, values_json, errors_json
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    contract.id,
    input.observedAt,
    input.blockNumber || null,
    compactJSON(input.values || []),
    compactJSON(input.errors || []),
  );
}

function diffObjects(previous, current, fields) {
  const diff = {};
  for (const field of fields) {
    const before = normalizeText(previous?.[field]);
    const after = normalizeText(current?.[field]);
    if (before !== after) {
      diff[field] = { before, after };
    }
  }
  return diff;
}

function hasUsableProxyBaseline(previousProxy) {
  if (!previousProxy) {
    return false;
  }
  if (previousProxy.proxy_type === 'unknown-no-rpc') {
    return false;
  }
  return Boolean(
    previousProxy.block_number ||
    previousProxy.implementation_address ||
    previousProxy.admin_address ||
    previousProxy.beacon_address ||
    previousProxy.proxy_type,
  );
}

function hasUsableVersionBaseline(previousVersion) {
  if (!previousVersion) {
    return false;
  }
  const abi = parseJSON(previousVersion.abi_json, []);
  const metadata = parseJSON(previousVersion.metadata_json, {});
  return Boolean(
    previousVersion.block_number ||
    previousVersion.contract_name ||
    (Array.isArray(abi) && abi.length > 0) ||
    previousVersion.implementation_address ||
    metadata?.fetchError === '',
  );
}

async function fetchJSONWithTimeout(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 25_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON response: ${text.slice(0, 240)}`);
  }
}

async function fetchExplorerAction(chainConfig, action, address, apiKey) {
  const candidates = [
    {
      name: 'etherscan-v2',
      endpoint: ETHERSCAN_V2_ENDPOINT,
      params: {
        chainid: String(chainConfig.chainId),
        module: 'contract',
        action,
        address,
      },
    },
    {
      name: `${chainConfig.slug}-legacy`,
      endpoint: chainConfig.legacyExplorerEndpoint,
      params: {
        module: 'contract',
        action,
        address,
      },
    },
  ];

  const errors = [];
  for (const candidate of candidates) {
    const params = new URLSearchParams(candidate.params);
    if (apiKey) {
      params.set('apikey', apiKey);
    }
    try {
      const payload = await fetchJSONWithTimeout(`${candidate.endpoint}?${params.toString()}`);
      const result = payload?.result;
      const status = normalizeText(payload?.status);
      const message = normalizeText(payload?.message);
      if (status === '0' && typeof result === 'string' && !result.trim().startsWith('[')) {
        throw new Error(result || message || 'explorer status=0');
      }
      return {
        explorer: candidate.name,
        endpoint: candidate.endpoint,
        payload,
      };
    } catch (error) {
      errors.push(`${candidate.name}: ${error?.message || error}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function fetchExplorerContract(chainConfig, address, apiKey) {
  const sourceLookup = await fetchExplorerAction(chainConfig, 'getsourcecode', address, apiKey);
  const result = sourceLookup.payload?.result;
  if (!Array.isArray(result) || result.length === 0 || !result[0] || typeof result[0] !== 'object') {
    throw new Error(`invalid getsourcecode result for ${address}`);
  }

  const item = result[0];
  const rawABI = normalizeText(item.ABI);
  let abi = [];
  let abiError = '';
  if (rawABI && rawABI !== 'Contract source code not verified') {
    try {
      abi = JSON.parse(rawABI);
    } catch (error) {
      abiError = `ABI parse failed: ${error?.message || error}`;
    }
  }

  if (!Array.isArray(abi) || abi.length === 0) {
    try {
      const abiLookup = await fetchExplorerAction(chainConfig, 'getabi', address, apiKey);
      const abiText = normalizeText(abiLookup.payload?.result);
      if (abiText && abiText.startsWith('[')) {
        abi = JSON.parse(abiText);
      }
    } catch (error) {
      abiError = abiError || `getabi failed: ${error?.message || error}`;
    }
  }

  const sourceCode = normalizeText(item.SourceCode);
  const source = parseSourceCode(sourceCode, normalizeText(item.ContractName) || address);
  const implementation = normalizeAddress(item.Implementation);
  const proxyFlag = normalizeText(item.Proxy) === '1';

  return {
    address,
    verified: Boolean(sourceCode || abi.length > 0),
    explorer: sourceLookup.explorer,
    endpoint: sourceLookup.endpoint,
    contractName: normalizeText(item.ContractName),
    compilerVersion: normalizeText(item.CompilerVersion),
    optimizationUsed: normalizeText(item.OptimizationUsed),
    runs: normalizeText(item.Runs),
    evmVersion: normalizeText(item.EVMVersion),
    licenseType: normalizeText(item.LicenseType),
    proxyFlag,
    implementation,
    abi,
    abiError,
    raw: item,
    source,
  };
}

function parseSourceCode(sourceCode, contractName) {
  const raw = normalizeText(sourceCode);
  if (!raw) {
    return {
      format: 'none',
      files: [],
      raw: '',
    };
  }

  const attempts = [];
  attempts.push(raw);
  if (raw.startsWith('{{') && raw.endsWith('}}')) {
    attempts.push(raw.slice(1, -1));
  }
  if (raw.startsWith('{') && raw.endsWith('}')) {
    attempts.push(raw);
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && parsed.sources && typeof parsed.sources === 'object') {
        return {
          format: 'standard-json',
          language: normalizeText(parsed.language),
          settings: parsed.settings || {},
          files: Object.entries(parsed.sources).map(([filePath, file]) => ({
            path: filePath,
            content: normalizeText(file?.content),
            keccak256: normalizeText(file?.keccak256),
          })),
          raw,
        };
      }
    } catch {
      // Try the next format.
    }
  }

  return {
    format: 'single-file',
    files: [{
      path: `${slugify(contractName, 'contract')}.sol`,
      content: raw,
      keccak256: '',
    }],
    raw,
  };
}

async function rpcRequest(rpcUrl, method, params = []) {
  if (!rpcUrl) {
    throw new Error(`RPC URL is required for ${method}`);
  }
  const payload = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RPC ${method} HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RPC ${method} invalid JSON: ${text.slice(0, 240)}`);
  }
  if (json.error) {
    throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
}

function hexToNumber(hex) {
  if (!hex || typeof hex !== 'string') {
    return null;
  }
  return Number(BigInt(hex));
}

function storageWordToAddress(value) {
  const hex = normalizeText(value).replace(/^0x/, '').padStart(64, '0');
  if (!hex || /^0+$/.test(hex)) {
    return '';
  }
  return normalizeAddress(`0x${hex.slice(-40)}`);
}

async function resolveProxyInfo(rpcUrl, address) {
  const empty = {
    isProxy: false,
    proxyType: 'none',
    implementationAddress: '',
    adminAddress: '',
    beaconAddress: '',
    beaconImplementationAddress: '',
    slots: {},
  };
  if (!rpcUrl) {
    return empty;
  }

  const [implementationSlot, adminSlot, beaconSlot] = await Promise.all([
    rpcRequest(rpcUrl, 'eth_getStorageAt', [address, EIP1967_IMPLEMENTATION_SLOT, 'latest']).catch((error) => ({ error })),
    rpcRequest(rpcUrl, 'eth_getStorageAt', [address, EIP1967_ADMIN_SLOT, 'latest']).catch((error) => ({ error })),
    rpcRequest(rpcUrl, 'eth_getStorageAt', [address, EIP1967_BEACON_SLOT, 'latest']).catch((error) => ({ error })),
  ]);

  const implementationAddress = typeof implementationSlot === 'string' ? storageWordToAddress(implementationSlot) : '';
  const adminAddress = typeof adminSlot === 'string' ? storageWordToAddress(adminSlot) : '';
  const beaconAddress = typeof beaconSlot === 'string' ? storageWordToAddress(beaconSlot) : '';
  let beaconImplementationAddress = '';

  if (beaconAddress) {
    try {
      const data = encodeFunctionData({
        abi: [{
          type: 'function',
          name: 'implementation',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'address' }],
        }],
        functionName: 'implementation',
      });
      const result = await rpcRequest(rpcUrl, 'eth_call', [{ to: beaconAddress, data }, 'latest']);
      beaconImplementationAddress = normalizeAddress(
        decodeFunctionResult({
          abi: [{
            type: 'function',
            name: 'implementation',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ type: 'address' }],
          }],
          functionName: 'implementation',
          data: result,
        }),
      );
    } catch {
      beaconImplementationAddress = '';
    }
  }

  const finalImplementation = implementationAddress || beaconImplementationAddress;
  let proxyType = 'none';
  if (beaconAddress) {
    proxyType = 'beacon/eip1967';
  } else if (implementationAddress && adminAddress) {
    proxyType = 'transparent/eip1967';
  } else if (implementationAddress) {
    proxyType = 'uups/eip1967';
  }

  return {
    isProxy: Boolean(finalImplementation || beaconAddress),
    proxyType,
    implementationAddress: finalImplementation,
    adminAddress,
    beaconAddress,
    beaconImplementationAddress,
    slots: {
      implementation: typeof implementationSlot === 'string' ? implementationSlot : '',
      implementationError: implementationSlot?.error?.message || '',
      admin: typeof adminSlot === 'string' ? adminSlot : '',
      adminError: adminSlot?.error?.message || '',
      beacon: typeof beaconSlot === 'string' ? beaconSlot : '',
      beaconError: beaconSlot?.error?.message || '',
    },
  };
}

function formatABISignature(item) {
  const name = normalizeText(item?.name);
  if (!name) {
    return item?.type || '';
  }
  const inputs = Array.isArray(item.inputs) ? item.inputs : [];
  return `${name}(${inputs.map((input) => normalizeText(input?.type) || 'bytes').join(',')})`;
}

function splitABI(abi) {
  const list = Array.isArray(abi) ? abi : [];
  return {
    functions: list.filter((item) => item?.type === 'function'),
    events: list.filter((item) => item?.type === 'event'),
    errors: list.filter((item) => item?.type === 'error'),
  };
}

function summarizeFunction(item) {
  return {
    name: normalizeText(item.name),
    signature: formatABISignature(item),
    stateMutability: normalizeText(item.stateMutability) || 'nonpayable',
    inputs: item.inputs || [],
    outputs: item.outputs || [],
  };
}

function detectContractRole(sourceRecord, abi) {
  const name = `${sourceRecord?.contractName || ''}`.toLowerCase();
  const { functions } = splitABI(abi);
  const signatures = functions.map(formatABISignature).join(' ').toLowerCase();
  if (/oracle|feed|aggregator/.test(name) || /latestrounddata|price|oracle/.test(signatures)) {
    return 'oracle-or-price-feed';
  }
  if (/router/.test(name) || /exactinput|swapexact|multicall|route/.test(signatures)) {
    return 'router-or-entrypoint';
  }
  if (/vault|pool/.test(name) || /deposit|withdraw|collateral|liquidity/.test(signatures)) {
    return 'vault-or-pool';
  }
  if (/position|perp|margin/.test(name) || /openposition|closeposition|liquidat|leverage/.test(signatures)) {
    return 'position-manager';
  }
  if (/factory/.test(name) || /createpool|deploy|getpool/.test(signatures)) {
    return 'factory';
  }
  if (/token|erc20/.test(name) || /transfer\(address,uint256\)|approve\(address,uint256\)|totalSupply\(\)/i.test(signatures)) {
    return 'token';
  }
  if (/govern|admin|timelock/.test(name) || /queue|execute|propose|cancel/.test(signatures)) {
    return 'governance-or-admin';
  }
  return 'contract';
}

function classifyStateFunction(name) {
  const lower = normalizeText(name).toLowerCase();
  if (/oracle|feed|price|sequencer/.test(lower)) {
    return 'oracle';
  }
  if (/owner|admin|govern|guardian|manager|controller|keeper/.test(lower)) {
    return 'authority';
  }
  if (/pause/.test(lower)) {
    return 'safety';
  }
  if (/fee|cap|limit|leverage|threshold|bonus|factor|ceiling/.test(lower)) {
    return 'risk-parameter';
  }
  if (/token|asset|weth|usdc|underlying|vault|router|factory|pool/.test(lower)) {
    return 'dependency';
  }
  return 'metadata';
}

function selectStateReadFunctions(abi, limit = 80) {
  const { functions } = splitABI(abi);
  const candidates = [];
  for (const fn of functions) {
    const name = normalizeText(fn.name);
    const inputs = Array.isArray(fn.inputs) ? fn.inputs : [];
    const outputs = Array.isArray(fn.outputs) ? fn.outputs : [];
    const mutability = normalizeText(fn.stateMutability);
    if (!name || inputs.length > 0 || outputs.length === 0 || !['view', 'pure'].includes(mutability)) {
      continue;
    }
    const signature = formatABISignature(fn);
    const score = (
      COMMON_STATE_NAME_RE.test(name) ? 100 : 0
    ) + (
      /owner|admin|oracle|fee|cap|pause|leverage|liquidation/i.test(name) ? 40 : 0
    ) + (
      outputs.length <= 2 ? 10 : 0
    );
    if (score <= 0 && candidates.length > limit / 2) {
      continue;
    }
    candidates.push({ fn, name, signature, score });
  }
  return candidates
    .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature))
    .slice(0, limit)
    .map((item) => item.fn);
}

async function readContractState({ rpcUrl, callAddress, abi, maxReads = 80 }) {
  const selected = selectStateReadFunctions(abi, maxReads);
  const values = [];
  const errors = [];
  for (const fn of selected) {
    const signature = formatABISignature(fn);
    try {
      const data = encodeFunctionData({
        abi: [fn],
        functionName: fn.name,
      });
      const result = await rpcRequest(rpcUrl, 'eth_call', [{ to: callAddress, data }, 'latest']);
      const decoded = decodeFunctionResult({
        abi: [fn],
        functionName: fn.name,
        data: result,
      });
      values.push({
        name: fn.name,
        signature,
        category: classifyStateFunction(fn.name),
        outputs: fn.outputs || [],
        value: decoded,
      });
    } catch (error) {
      errors.push({
        name: fn.name,
        signature,
        error: error?.message || String(error),
      });
    }
  }
  return { values, errors };
}

function formatStateValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(formatStateValue).join(', ')}]`;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value && typeof value === 'object') {
    return compactJSON(value);
  }
  return String(value);
}

function sourceSummary(sourceRecord) {
  const files = sourceRecord?.source?.files || [];
  return {
    verified: Boolean(sourceRecord?.verified),
    contractName: sourceRecord?.contractName || '',
    compilerVersion: sourceRecord?.compilerVersion || '',
    sourceFormat: sourceRecord?.source?.format || 'none',
    sourceFiles: files.map((file) => ({
      path: file.path,
      sha256: sha256Hex(file.content || ''),
      bytes: Buffer.byteLength(file.content || ''),
    })),
  };
}

function buildRiskNotes({ proxyInfo, sourceRecord, abi, stateValues }) {
  const notes = [];
  const { functions } = splitABI(abi);
  if (proxyInfo?.isProxy) {
    notes.push(`Upgradeable proxy detected: ${proxyInfo.proxyType}. Watch implementation/admin slot changes before strategy execution.`);
  }
  if (proxyInfo?.adminAddress) {
    notes.push(`Proxy admin authority: ${proxyInfo.adminAddress}. Treat upgrades as strategy-invalidating until reanalysis is complete.`);
  }
  if ((sourceRecord?.raw?.Proxy === '1' || sourceRecord?.proxyFlag) && !proxyInfo?.implementationAddress) {
    notes.push('Explorer marks this contract as a proxy, but no implementation was resolved from EIP-1967 slots.');
  }
  if (functions.some((fn) => /^pause|^unpause|paused$/i.test(fn.name))) {
    notes.push('Pause controls are present. Strategies should read pause state before submitting transactions.');
  }
  if (functions.some((fn) => /oracle|priceFeed|sequencer/i.test(fn.name))) {
    notes.push('Oracle or feed surfaces are present. Strategies should validate freshness and feed dependencies.');
  }
  if (functions.some((fn) => RISK_FUNCTION_RE.test(fn.name || '') && !['view', 'pure'].includes(fn.stateMutability))) {
    notes.push('Admin/configuration write functions exist. Fee, cap, leverage, oracle, or limit changes may alter strategy behavior.');
  }
  if ((stateValues || []).some((item) => item.category === 'risk-parameter')) {
    notes.push('Risk parameters were readable via no-arg view functions and are stored in the latest state snapshot.');
  }
  if (notes.length === 0) {
    notes.push('No obvious proxy/admin/oracle/pause risk was detected from ABI-level analysis. This is not a formal audit.');
  }
  return notes;
}

function buildStrategyHooks(abi) {
  const { functions } = splitABI(abi);
  return functions
    .filter((fn) => STRATEGY_FUNCTION_RE.test(fn.name || ''))
    .map(summarizeFunction)
    .slice(0, 40);
}

function buildKeywordList({ protocolName, chainSlug, sourceRecord, role, abi, stateValues }) {
  const { functions, events } = splitABI(abi);
  const words = new Set([
    protocolName,
    chainSlug,
    sourceRecord?.contractName,
    role,
  ].filter(Boolean));
  for (const fn of functions) {
    if (fn.name) words.add(fn.name);
  }
  for (const event of events) {
    if (event.name) words.add(event.name);
  }
  for (const state of stateValues || []) {
    if (state.name) words.add(state.name);
    if (state.category) words.add(state.category);
  }
  return Array.from(words).map(normalizeText).filter(Boolean).slice(0, 160);
}

function buildContractCard({
  protocolName,
  chainConfig,
  contract,
  sourceRecord,
  analysisSourceRecord,
  abi,
  bytecodeHash,
  blockNumber,
  proxyInfo,
  role,
  stateRead,
  observedAt,
  callAddress,
}) {
  const { functions, events } = splitABI(abi);
  const readFns = functions.filter((fn) => ['view', 'pure'].includes(fn.stateMutability)).map(summarizeFunction);
  const writeFns = functions.filter((fn) => !['view', 'pure'].includes(fn.stateMutability)).map(summarizeFunction);
  const strategyHooks = buildStrategyHooks(abi);
  const riskNotes = buildRiskNotes({ proxyInfo, sourceRecord, abi, stateValues: stateRead.values });
  const keywords = buildKeywordList({
    protocolName,
    chainSlug: chainConfig.slug,
    sourceRecord: analysisSourceRecord || sourceRecord,
    role,
    abi,
    stateValues: stateRead.values,
  });

  const lines = [
    `# Contract Card: ${sourceRecord?.contractName || contract.label || contract.address}`,
    '',
    '## Identity',
    `- protocol: ${protocolName}`,
    `- chain: ${chainConfig.displayName} (${chainConfig.chainId})`,
    `- address: ${contract.address}`,
    `- call_address: ${callAddress || contract.address}`,
    `- explorer: ${contract.explorer_url}`,
    `- observed_at: ${observedAt}`,
    `- observed_block: ${blockNumber || 'unknown'}`,
    `- role: ${role}`,
    `- bytecode_sha256: ${bytecodeHash || 'unknown'}`,
    '',
    '## Proxy',
    `- is_proxy: ${Boolean(proxyInfo?.isProxy)}`,
    `- proxy_type: ${proxyInfo?.proxyType || 'none'}`,
    `- implementation: ${proxyInfo?.implementationAddress || sourceRecord?.implementation || 'none'}`,
    `- admin: ${proxyInfo?.adminAddress || 'none'}`,
    `- beacon: ${proxyInfo?.beaconAddress || 'none'}`,
    '',
    '## Source',
    `- verified: ${Boolean(sourceRecord?.verified)}`,
    `- contract_name: ${sourceRecord?.contractName || 'unknown'}`,
    `- analysis_contract_name: ${analysisSourceRecord?.contractName || sourceRecord?.contractName || 'unknown'}`,
    `- compiler: ${sourceRecord?.compilerVersion || 'unknown'}`,
    `- source_format: ${sourceRecord?.source?.format || 'none'}`,
    `- source_files: ${(sourceRecord?.source?.files || []).length}`,
    '',
    '## Protocol Role',
    describeRole(role),
    '',
    '## Strategy-Relevant Hooks',
  ];

  if (strategyHooks.length === 0) {
    lines.push('- none detected from ABI names');
  } else {
    for (const fn of strategyHooks.slice(0, 30)) {
      lines.push(`- ${fn.signature} [${fn.stateMutability}]`);
    }
  }

  lines.push('', '## Write Functions');
  if (writeFns.length === 0) {
    lines.push('- none');
  } else {
    for (const fn of writeFns.slice(0, 60)) {
      lines.push(`- ${fn.signature} [${fn.stateMutability}]`);
    }
  }

  lines.push('', '## Read Functions');
  if (readFns.length === 0) {
    lines.push('- none');
  } else {
    for (const fn of readFns.slice(0, 60)) {
      lines.push(`- ${fn.signature} [${fn.stateMutability}]`);
    }
  }

  lines.push('', '## Events');
  if (events.length === 0) {
    lines.push('- none');
  } else {
    for (const event of events.slice(0, 50)) {
      lines.push(`- ${formatABISignature(event)}`);
    }
  }

  lines.push('', '## State Snapshot Highlights');
  if (stateRead.values.length === 0) {
    lines.push('- no no-argument state getters were read');
  } else {
    for (const item of stateRead.values.slice(0, 50)) {
      lines.push(`- ${item.signature} [${item.category}]: ${formatStateValue(item.value)}`);
    }
  }
  if (stateRead.errors.length > 0) {
    lines.push('', '## State Read Errors');
    for (const item of stateRead.errors.slice(0, 20)) {
      lines.push(`- ${item.signature}: ${item.error}`);
    }
  }

  lines.push('', '## Risks And Watchpoints');
  for (const note of riskNotes) {
    lines.push(`- ${note}`);
  }

  lines.push('', '## Keywords');
  lines.push(keywords.join(', '));
  lines.push('');

  return {
    body: `${lines.join('\n')}\n`,
    metadata: {
      protocolName,
      chain: chainConfig.slug,
      address: contract.address,
      role,
      proxy: proxyInfo,
      keywords,
      strategyHooks,
      riskNotes,
    },
  };
}

function describeRole(role) {
  switch (role) {
    case 'router-or-entrypoint':
      return 'User-facing entrypoint or routing contract. Strategy agents should prefer this surface for execution planning, then inspect downstream vault/pool dependencies.';
    case 'vault-or-pool':
      return 'Accounting, custody, collateral, or liquidity surface. Strategy agents should inspect balance, share, collateral, and withdrawal semantics carefully.';
    case 'position-manager':
      return 'Position lifecycle surface. Strategy agents should identify open, close, collateral, liquidation, and leverage constraints before execution.';
    case 'oracle-or-price-feed':
      return 'Price or oracle surface. Strategy agents should validate freshness, sequencer assumptions, decimals, and fallback behavior.';
    case 'factory':
      return 'Deployment or registry surface. Strategy agents can use it to discover pools/markets but should avoid treating it as an execution venue by itself.';
    case 'governance-or-admin':
      return 'Governance or administrative surface. Strategy agents should use it for risk context and update monitoring, not normal trade execution.';
    case 'token':
      return 'Token contract surface. Strategy agents should inspect decimals, approvals, balances, and transfer behavior.';
    default:
      return 'Generic protocol contract. Strategy agents should use function, event, dependency, and state sections to infer its role.';
  }
}

function buildProtocolCard({ protocol, chainConfig, analyzedContracts, observedAt, blockNumber }) {
  const riskNotes = new Set();
  const strategyHooks = [];
  const proxyRows = [];
  const contractRows = [];

  for (const item of analyzedContracts) {
    contractRows.push(`- ${item.contract.address} | ${item.role} | ${item.sourceRecord?.contractName || item.contract.label || 'unknown'}`);
    if (item.proxyInfo?.isProxy) {
      proxyRows.push(`- ${item.contract.address} -> ${item.proxyInfo.implementationAddress || 'unknown'} (${item.proxyInfo.proxyType}) admin=${item.proxyInfo.adminAddress || 'none'}`);
    }
    for (const note of item.riskNotes || []) {
      riskNotes.add(note);
    }
    for (const hook of item.strategyHooks || []) {
      strategyHooks.push(`- ${item.contract.address} :: ${hook.signature} [${hook.stateMutability}]`);
    }
  }

  const lines = [
    `# Protocol Dossier: ${protocol.name}`,
    '',
    '## Identity',
    `- slug: ${protocol.slug}`,
    `- chain: ${chainConfig.displayName} (${chainConfig.chainId})`,
    `- observed_at: ${observedAt}`,
    `- observed_block: ${blockNumber || 'unknown'}`,
    `- contracts_analyzed: ${analyzedContracts.length}`,
    '',
    '## Contract Map',
    ...contractRows,
    '',
    '## Proxy Map',
    ...(proxyRows.length > 0 ? proxyRows : ['- no EIP-1967 proxies detected']),
    '',
    '## Strategy Hooks',
    ...(strategyHooks.length > 0 ? strategyHooks.slice(0, 100) : ['- none detected from ABI names']),
    '',
    '## Risk Register',
    ...(riskNotes.size > 0 ? Array.from(riskNotes) : ['- no risk notes generated']),
    '',
    '## Agent Retrieval Notes',
    '- Use this protocol dossier as the primary artifact for strategy planning.',
    '- Use contract cards for exact function surfaces, state getters, proxy slots, and update watchpoints.',
    '- Re-run ingestion before live execution when alerts indicate implementation, admin, bytecode, ABI, or source changes.',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

async function getRuntimeContext(rpcUrl, address) {
  if (!rpcUrl) {
    return {
      blockNumber: null,
      bytecode: '',
      bytecodeHash: '',
      proxyInfo: {
        isProxy: false,
        proxyType: 'unknown-no-rpc',
        implementationAddress: '',
        adminAddress: '',
        beaconAddress: '',
        slots: {},
      },
    };
  }
  const [blockHex, bytecode, proxyInfo] = await Promise.all([
    rpcRequest(rpcUrl, 'eth_blockNumber', []),
    rpcRequest(rpcUrl, 'eth_getCode', [address, 'latest']),
    resolveProxyInfo(rpcUrl, address),
  ]);
  return {
    blockNumber: hexToNumber(blockHex),
    bytecode,
    bytecodeHash: sha256Hex(bytecode || ''),
    proxyInfo,
  };
}

function makeSourceHash(sourceRecord) {
  return sha256Hex(compactJSON(sourceSummary(sourceRecord)));
}

function makeABIHash(abi) {
  return sha256Hex(compactJSON(abi || []));
}

async function safeFetchExplorerContract(chainConfig, address, apiKey) {
  try {
    return await fetchExplorerContract(chainConfig, address, apiKey);
  } catch (error) {
    return {
      address,
      verified: false,
      explorer: '',
      endpoint: '',
      contractName: '',
      compilerVersion: '',
      optimizationUsed: '',
      runs: '',
      evmVersion: '',
      licenseType: '',
      proxyFlag: false,
      implementation: '',
      abi: [],
      abiError: '',
      raw: {},
      source: { format: 'none', files: [], raw: '' },
      fetchError: error?.message || String(error),
    };
  }
}

async function analyzeAndStoreContract({
  db,
  protocol,
  chainConfig,
  address,
  label,
  sourceRecord,
  analysisSourceRecord,
  runtimeABI,
  runtimeContext,
  rpcUrl,
  callAddress,
  skipState = false,
}) {
  const observedAt = nowISO();
  const abi = Array.isArray(runtimeABI) ? runtimeABI : [];
  const analysisSource = analysisSourceRecord || sourceRecord;
  const role = detectContractRole(analysisSource, abi);
  const contract = upsertContract(db, protocol, chainConfig, {
    address,
    label,
    role,
  });
  const previousVersion = getPreviousVersion(db, contract.id);
  const previousProxy = getPreviousProxySnapshot(db, contract.id);
  const sourceHash = makeSourceHash(sourceRecord);
  const abiHash = makeABIHash(abi);
  const proxyInfo = runtimeContext.proxyInfo || {};
  const versionID = insertContractVersion(db, contract, {
    observedAt,
    blockNumber: runtimeContext.blockNumber,
    contractName: analysisSource?.contractName || sourceRecord?.contractName || '',
    compilerVersion: analysisSource?.compilerVersion || sourceRecord?.compilerVersion || '',
    sourceFormat: sourceRecord?.source?.format || 'none',
    bytecodeHash: runtimeContext.bytecodeHash,
    sourceHash,
    abiHash,
    isProxy: proxyInfo.isProxy || sourceRecord?.proxyFlag,
    proxyType: proxyInfo.proxyType,
    implementationAddress: proxyInfo.implementationAddress || sourceRecord?.implementation || '',
    source: sourceSummary(sourceRecord),
    abi,
    metadata: {
      label,
      explorer: sourceRecord?.explorer,
      endpoint: sourceRecord?.endpoint,
      fetchError: sourceRecord?.fetchError || '',
      abiError: sourceRecord?.abiError || '',
      analysisSource: sourceSummary(analysisSource),
      callAddress,
    },
  });
  insertABIItems(db, versionID, chainConfig.slug, contract.address, abi);
  insertSourceFiles(db, versionID, sourceRecord);

  const proxyDiff = diffObjects(previousProxy, {
    implementation_address: proxyInfo.implementationAddress || '',
    admin_address: proxyInfo.adminAddress || '',
    beacon_address: proxyInfo.beaconAddress || '',
    proxy_type: proxyInfo.proxyType || '',
  }, ['implementation_address', 'admin_address', 'beacon_address', 'proxy_type']);
  const proxyChanged = hasUsableProxyBaseline(previousProxy) && Object.keys(proxyDiff).length > 0;
  db.prepare(`
    INSERT INTO proxy_snapshots (
      contract_id, observed_at, block_number, implementation_address, admin_address,
      beacon_address, proxy_type, slots_json, changed, diff_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contract.id,
    observedAt,
    runtimeContext.blockNumber || null,
    proxyInfo.implementationAddress || '',
    proxyInfo.adminAddress || '',
    proxyInfo.beaconAddress || '',
    proxyInfo.proxyType || '',
    compactJSON(proxyInfo.slots || {}),
    proxyChanged ? 1 : 0,
    compactJSON(proxyDiff),
  );
  if (proxyChanged) {
    insertAlert(db, protocol.id, contract.id, {
      severity: 'high',
      kind: 'proxy_changed',
      title: `Proxy changed for ${contract.address}`,
      body: `Proxy metadata changed for ${contract.address}. Re-run strategy analysis before execution.`,
      diff: proxyDiff,
    });
  }

  const versionDiff = diffObjects(previousVersion, {
    bytecode_sha256: runtimeContext.bytecodeHash || '',
    source_sha256: sourceHash,
    abi_sha256: abiHash,
    implementation_address: proxyInfo.implementationAddress || sourceRecord?.implementation || '',
  }, ['bytecode_sha256', 'source_sha256', 'abi_sha256', 'implementation_address']);
  if (previousVersion && !previousVersion.block_number) {
    delete versionDiff.bytecode_sha256;
  }
  if (!hasUsableProxyBaseline(previousProxy)) {
    delete versionDiff.implementation_address;
  }
  const versionChanged = hasUsableVersionBaseline(previousVersion) && Object.keys(versionDiff).length > 0;
  if (versionChanged) {
    insertAlert(db, protocol.id, contract.id, {
      severity: 'medium',
      kind: 'contract_changed',
      title: `Contract analysis input changed for ${contract.address}`,
      body: `Bytecode, source, ABI, or implementation reference changed for ${contract.address}.`,
      diff: versionDiff,
    });
  }

  let stateRead = { values: [], errors: [] };
  if (!skipState && rpcUrl && abi.length > 0) {
    stateRead = await readContractState({
      rpcUrl,
      callAddress: callAddress || contract.address,
      abi,
    });
    insertStateSnapshot(db, contract, {
      observedAt,
      blockNumber: runtimeContext.blockNumber,
      values: stateRead.values,
      errors: stateRead.errors,
    });
  }

  const card = buildContractCard({
    protocolName: protocol.name,
    chainConfig,
    contract,
    sourceRecord,
    analysisSourceRecord: analysisSource,
    abi,
    bytecodeHash: runtimeContext.bytecodeHash,
    blockNumber: runtimeContext.blockNumber,
    proxyInfo,
    role,
    stateRead,
    observedAt,
    callAddress,
  });

  return {
    contract,
    versionID,
    role,
    sourceRecord,
    analysisSourceRecord: analysisSource,
    abi,
    runtimeContext,
    proxyInfo,
    stateRead,
    card,
    riskNotes: card.metadata.riskNotes,
    strategyHooks: card.metadata.strategyHooks,
  };
}

export async function ingestEVMProtocolKnowledge(options = {}) {
  const protocolName = normalizeText(options.protocolName || options.protocol || options.name);
  if (!protocolName) {
    throw new Error('protocolName is required');
  }
  const chainSlug = normalizeChainSlug(options.chain || options.chainSlug || 'base-mainnet');
  const chainConfig = EVM_KNOWLEDGE_CHAIN_CONFIGS[chainSlug];
  if (!chainConfig) {
    throw new Error(`unsupported chain: ${options.chain || options.chainSlug}`);
  }
  const addresses = Array.from(new Set((options.addresses || [])
    .flatMap((item) => String(item || '').split(','))
    .map(normalizeAddress)
    .filter(Boolean)));
  if (addresses.length === 0) {
    throw new Error('at least one contract/proxy address is required');
  }

  const env = resolveEVMKnowledgeEnv(chainSlug, options.env || process.env);
  const explorerApiKey = firstNonEmpty(options.explorerApiKey, env.explorerApiKey);
  const rpcUrl = firstNonEmpty(options.rpcUrl, env.rpcUrl);
  const defaults = getDefaultEVMKnowledgePaths(options.cwd || process.cwd());
  const dbPath = path.resolve(options.cwd || process.cwd(), options.dbPath || defaults.dbPath);
  const docsDir = path.resolve(options.cwd || process.cwd(), options.docsDir || defaults.docsDir);
  const db = openEVMKnowledgeDB(dbPath);
  const protocolSlug = slugify(options.protocolSlug || protocolName);
  const protocol = upsertProtocol(db, {
    slug: protocolSlug,
    name: protocolName,
    chainSlug: chainConfig.slug,
    chainId: chainConfig.chainId,
  });

  const observedAt = nowISO();
  const analyzedContracts = [];
  const rootManifests = [];
  let latestBlockNumber = null;

  try {
    for (const rootAddress of addresses) {
      const rootSource = await safeFetchExplorerContract(chainConfig, rootAddress, explorerApiKey);
      const rootContext = await getRuntimeContext(rpcUrl, rootAddress);
      latestBlockNumber = rootContext.blockNumber || latestBlockNumber;
      const implementationAddress = normalizeAddress(
        rootContext.proxyInfo?.implementationAddress || rootSource.implementation,
      );

      let implementationSource = null;
      let implementationContext = null;
      if (implementationAddress && addressKey(implementationAddress) !== addressKey(rootAddress)) {
        implementationSource = await safeFetchExplorerContract(chainConfig, implementationAddress, explorerApiKey);
        implementationContext = await getRuntimeContext(rpcUrl, implementationAddress);
      }

      const runtimeABI = implementationSource?.abi?.length ? implementationSource.abi : rootSource.abi;
      const rootAnalysis = await analyzeAndStoreContract({
        db,
        protocol,
        chainConfig,
        address: rootAddress,
        label: implementationAddress ? 'proxy entrypoint' : 'protocol contract',
        sourceRecord: rootSource,
        analysisSourceRecord: implementationSource || rootSource,
        runtimeABI,
        runtimeContext: rootContext,
        rpcUrl,
        callAddress: rootAddress,
      });
      analyzedContracts.push(rootAnalysis);

      let implementationAnalysis = null;
      if (implementationSource && implementationContext) {
        implementationAnalysis = await analyzeAndStoreContract({
          db,
          protocol,
          chainConfig,
          address: implementationAddress,
          label: `implementation for ${rootAddress}`,
          sourceRecord: implementationSource,
          analysisSourceRecord: implementationSource,
          runtimeABI: implementationSource.abi,
          runtimeContext: implementationContext,
          rpcUrl,
          callAddress: implementationAddress,
          skipState: true,
        });
        analyzedContracts.push(implementationAnalysis);
        insertRelation(db, protocol, rootAnalysis.contract.id, implementationAnalysis.contract.id, 'proxy_implements', {
          proxyType: rootContext.proxyInfo?.proxyType,
          observedAt,
        });
      }

      rootManifests.push({
        rootAddress,
        implementationAddress,
        proxyType: rootContext.proxyInfo?.proxyType || 'none',
        rootContractID: rootAnalysis.contract.id,
        implementationContractID: implementationAnalysis?.contract.id || null,
      });
    }

    const protocolDir = path.join(docsDir, protocol.slug);
    const contractsDir = path.join(protocolDir, 'contracts');
    await fs.mkdir(contractsDir, { recursive: true });

    for (const item of analyzedContracts) {
      const relPath = path.relative(options.cwd || process.cwd(), path.join(contractsDir, `${addressKey(item.contract.address)}.md`));
      await writeFileEnsured(path.join(contractsDir, `${addressKey(item.contract.address)}.md`), item.card.body);
      insertDocument(db, protocol.id, item.contract.id, {
        kind: 'contract-card',
        title: `Contract Card: ${item.sourceRecord?.contractName || item.contract.address}`,
        path: relPath,
        body: item.card.body,
        metadata: item.card.metadata,
      });
    }

    const protocolCard = buildProtocolCard({
      protocol,
      chainConfig,
      analyzedContracts,
      observedAt,
      blockNumber: latestBlockNumber,
    });
    const protocolCardPath = path.join(protocolDir, 'protocol-card.md');
    await writeFileEnsured(protocolCardPath, protocolCard);
    insertDocument(db, protocol.id, null, {
      kind: 'protocol-card',
      title: `Protocol Dossier: ${protocol.name}`,
      path: path.relative(options.cwd || process.cwd(), protocolCardPath),
      body: protocolCard,
      metadata: {
        protocol: protocol.name,
        slug: protocol.slug,
        chain: chainConfig.slug,
        rootAddresses: addresses,
      },
    });

    const manifest = {
      protocol: {
        id: protocol.id,
        slug: protocol.slug,
        name: protocol.name,
        chain: chainConfig.slug,
        chainId: chainConfig.chainId,
      },
      generatedAt: observedAt,
      observedBlock: latestBlockNumber,
      roots: rootManifests,
      contracts: analyzedContracts.map((item) => ({
        address: item.contract.address,
        role: item.role,
        contractName: item.sourceRecord?.contractName || '',
        proxy: {
          isProxy: Boolean(item.proxyInfo?.isProxy),
          type: item.proxyInfo?.proxyType || '',
          implementation: item.proxyInfo?.implementationAddress || '',
          admin: item.proxyInfo?.adminAddress || '',
          beacon: item.proxyInfo?.beaconAddress || '',
        },
      })),
    };
    const functionIndex = analyzedContracts.flatMap((item) => splitABI(item.abi).functions.map((fn) => ({
      address: item.contract.address,
      role: item.role,
      name: fn.name,
      signature: formatABISignature(fn),
      stateMutability: fn.stateMutability,
      strategyRelevant: STRATEGY_FUNCTION_RE.test(fn.name || ''),
      riskRelevant: RISK_FUNCTION_RE.test(fn.name || ''),
    })));
    const stateSnapshot = analyzedContracts.map((item) => ({
      address: item.contract.address,
      role: item.role,
      values: item.stateRead.values,
      errors: item.stateRead.errors,
    }));

    await writeFileEnsured(path.join(protocolDir, 'manifest.json'), `${stringifyJSON(manifest)}\n`);
    await writeFileEnsured(path.join(protocolDir, 'function-index.json'), `${stringifyJSON(functionIndex)}\n`);
    await writeFileEnsured(path.join(protocolDir, 'state-snapshot.json'), `${stringifyJSON(stateSnapshot)}\n`);

    return {
      ok: true,
      dbPath,
      docsDir: protocolDir,
      protocol,
      chain: chainConfig.slug,
      observedBlock: latestBlockNumber,
      analyzedContracts: analyzedContracts.length,
      rootAddresses: addresses,
      documents: analyzedContracts.length + 1,
    };
  } finally {
    db.close();
  }
}

function buildFTSQuery(query) {
  const tokens = normalizeText(query)
    .split(/[^a-zA-Z0-9_.$:-]+/)
    .map((item) => item.replace(/"/g, ''))
    .filter((item) => item.length >= 2)
    .slice(0, 12);
  if (tokens.length === 0) {
    return '';
  }
  return tokens.map((token) => `"${token}"`).join(' OR ');
}

export function searchEVMProtocolKnowledge(options = {}) {
  const query = normalizeText(options.query);
  if (!query) {
    throw new Error('query is required');
  }
  const defaults = getDefaultEVMKnowledgePaths(options.cwd || process.cwd());
  const dbPath = path.resolve(options.cwd || process.cwd(), options.dbPath || defaults.dbPath);
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const db = openEVMKnowledgeDB(dbPath);
  try {
    const ftsQuery = buildFTSQuery(query);
    if (ftsQuery) {
      try {
        const rows = db.prepare(`
          SELECT kind, title, path, snippet(knowledge_fts, 2, '[', ']', '...', 24) AS snippet,
                 bm25(knowledge_fts) AS score
          FROM knowledge_fts
          WHERE knowledge_fts MATCH ?
          ORDER BY score
          LIMIT ?
        `).all(ftsQuery, limit);
        if (rows.length > 0) {
          return rows.map((row) => ({
            kind: row.kind,
            title: row.title,
            path: row.path,
            snippet: row.snippet,
            score: row.score,
          }));
        }
      } catch {
        // Fall through to LIKE search.
      }
    }

    const like = `%${query.replace(/[%_]/g, '')}%`;
    const rows = db.prepare(`
      SELECT kind, title, path, substr(body, 1, 480) AS snippet, 0 AS score
      FROM documents
      WHERE title LIKE ? OR body LIKE ? OR metadata_json LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(like, like, like, limit);
    return rows.map((row) => ({
      kind: row.kind,
      title: row.title,
      path: row.path,
      snippet: row.snippet,
      score: row.score,
    }));
  } finally {
    db.close();
  }
}

export function readEVMProtocolAlerts(options = {}) {
  const defaults = getDefaultEVMKnowledgePaths(options.cwd || process.cwd());
  const dbPath = path.resolve(options.cwd || process.cwd(), options.dbPath || defaults.dbPath);
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const db = openEVMKnowledgeDB(dbPath);
  try {
    return db.prepare(`
      SELECT alerts.id, alerts.severity, alerts.kind, alerts.title, alerts.body,
             alerts.diff_json, alerts.created_at, contracts.address, protocols.name AS protocol_name
      FROM alerts
      JOIN protocols ON protocols.id = alerts.protocol_id
      LEFT JOIN contracts ON contracts.id = alerts.contract_id
      ORDER BY alerts.id DESC
      LIMIT ?
    `).all(limit).map((row) => ({
      id: row.id,
      severity: row.severity,
      kind: row.kind,
      title: row.title,
      body: row.body,
      diff: parseJSON(row.diff_json, {}),
      createdAt: row.created_at,
      address: row.address || '',
      protocolName: row.protocol_name || '',
    }));
  } finally {
    db.close();
  }
}
