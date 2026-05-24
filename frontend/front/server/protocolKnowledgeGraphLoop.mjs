import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  toEventSelector,
  toFunctionSelector,
} from 'viem';

const { Pool } = pg;

const ETHERSCAN_V2_ENDPOINT = 'https://api.etherscan.io/v2/api';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_EMBEDDING_DIM = 1536;
const MIXEDBREAD_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const EIP1967_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

export const KG_CHAIN_CONFIGS = {
  ethereum: {
    slug: 'ethereum',
    chainId: 1,
    displayName: 'Ethereum',
    explorerAddressBase: 'https://etherscan.io/address',
    legacyExplorerEndpoint: 'https://api.etherscan.io/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'ETHEREUM_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['ETHEREUM_RPC_URL', 'ETH_RPC_URL', 'MAINNET_RPC_URL', 'RPC_URL'],
  },
  'base-mainnet': {
    slug: 'base-mainnet',
    chainId: 8453,
    displayName: 'Base Mainnet',
    explorerAddressBase: 'https://basescan.org/address',
    legacyExplorerEndpoint: 'https://api.basescan.org/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'BASESCAN_API_KEY', 'BASE_MAINNET_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['BASE_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_MAINNET_RPC_HTTP_URL', 'RPC_URL'],
  },
  arbitrum: {
    slug: 'arbitrum',
    chainId: 42161,
    displayName: 'Arbitrum One',
    explorerAddressBase: 'https://arbiscan.io/address',
    legacyExplorerEndpoint: 'https://api.arbiscan.io/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'ARBISCAN_API_KEY', 'ARBITRUM_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['ARBITRUM_RPC_URL', 'ARBITRUM_ONE_RPC_URL', 'RPC_URL'],
  },
  optimism: {
    slug: 'optimism',
    chainId: 10,
    displayName: 'Optimism',
    explorerAddressBase: 'https://optimistic.etherscan.io/address',
    legacyExplorerEndpoint: 'https://api-optimistic.etherscan.io/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'OPTIMISM_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['OPTIMISM_RPC_URL', 'OP_RPC_URL', 'RPC_URL'],
  },
  polygon: {
    slug: 'polygon',
    chainId: 137,
    displayName: 'Polygon',
    explorerAddressBase: 'https://polygonscan.com/address',
    legacyExplorerEndpoint: 'https://api.polygonscan.com/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'POLYGONSCAN_API_KEY', 'POLYGON_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['POLYGON_RPC_URL', 'MATIC_RPC_URL', 'RPC_URL'],
  },
  avalanche: {
    slug: 'avalanche',
    chainId: 43114,
    displayName: 'Avalanche C-Chain',
    explorerAddressBase: 'https://snowtrace.io/address',
    legacyExplorerEndpoint: 'https://api.snowtrace.io/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'SNOWTRACE_API_KEY', 'AVALANCHE_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['AVALANCHE_RPC_URL', 'AVAX_RPC_URL', 'RPC_URL'],
  },
  bsc: {
    slug: 'bsc',
    chainId: 56,
    displayName: 'BNB Smart Chain',
    explorerAddressBase: 'https://bscscan.com/address',
    legacyExplorerEndpoint: 'https://api.bscscan.com/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'BSCSCAN_API_KEY', 'BSC_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['BSC_RPC_URL', 'BINANCE_RPC_URL', 'RPC_URL'],
  },
  gnosis: {
    slug: 'gnosis',
    chainId: 100,
    displayName: 'Gnosis Chain',
    explorerAddressBase: 'https://gnosisscan.io/address',
    legacyExplorerEndpoint: 'https://api.gnosisscan.io/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'GNOSISSCAN_API_KEY', 'GNOSIS_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['GNOSIS_RPC_URL', 'XDAI_RPC_URL', 'RPC_URL'],
  },
  scroll: {
    slug: 'scroll',
    chainId: 534352,
    displayName: 'Scroll',
    explorerAddressBase: 'https://scrollscan.com/address',
    legacyExplorerEndpoint: 'https://api.scrollscan.com/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'SCROLLSCAN_API_KEY', 'SCROLL_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['SCROLL_RPC_URL', 'RPC_URL'],
  },
  linea: {
    slug: 'linea',
    chainId: 59144,
    displayName: 'Linea',
    explorerAddressBase: 'https://lineascan.build/address',
    legacyExplorerEndpoint: 'https://api.lineascan.build/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'LINEASCAN_API_KEY', 'LINEA_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['LINEA_RPC_URL', 'RPC_URL'],
  },
  celo: {
    slug: 'celo',
    chainId: 42220,
    displayName: 'Celo',
    explorerAddressBase: 'https://celoscan.io/address',
    legacyExplorerEndpoint: 'https://api.celoscan.io/api',
    apiKeyEnv: ['ETHERSCAN_API_KEY', 'CELOSCAN_API_KEY', 'CELO_EXPLORER_API_KEY', 'EXPLORER_API_KEY'],
    rpcEnv: ['CELO_RPC_URL', 'RPC_URL'],
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

const STRATEGY_FUNCTION_RE = /(swap|exactInput|deposit|withdraw|mint|burn|borrow|repay|open|close|increase|decrease|liquidat|stake|unstake|claim|harvest|rebalance|execute|place|order|settle|flash|quote|collect)/i;
const ADMIN_RISK_RE = /(pause|unpause|upgrade|set[A-Z]|configure|govern|admin|owner|fee|oracle|cap|limit|leverage|liquidat|emergency)/;
const STATE_GETTER_RE = /^(name|symbol|decimals|totalSupply|owner|admin|governor|governance|guardian|paused|isPaused|factory|router|vault|pool|token|underlying|asset|weth|usdc|oracle|priceOracle|priceFeed|fee|feeBps|protocolFee|maxFee|maxLeverage|maxCap|cap|liquidationThreshold|treasury|feeRecipient)$/i;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeChainSlug(raw) {
  const value = normalizeText(raw).toLowerCase().replace(/_/g, '-');
  if (['eth', 'ethereum-mainnet', 'mainnet', '1'].includes(value)) {
    return 'ethereum';
  }
  if (!value || value === 'base' || value === '8453') {
    return 'base-mainnet';
  }
  if (['arbitrum-one', 'arb', '42161'].includes(value)) {
    return 'arbitrum';
  }
  if (['op', 'optimism-mainnet', '10'].includes(value)) {
    return 'optimism';
  }
  if (['matic', 'polygon-mainnet', '137'].includes(value)) {
    return 'polygon';
  }
  if (['avax', 'avalanche-c-chain', '43114'].includes(value)) {
    return 'avalanche';
  }
  if (['bnb', 'bnb-chain', 'binance', 'binance-smart-chain', '56'].includes(value)) {
    return 'bsc';
  }
  if (['xdai', 'gnosis-chain', '100'].includes(value)) {
    return 'gnosis';
  }
  if (value === '534352') {
    return 'scroll';
  }
  if (value === '59144') {
    return 'linea';
  }
  if (value === '42220') {
    return 'celo';
  }
  if (value === 'base-sepolia' || value === 'basesepolia' || value === '84532') {
    return 'base-sepolia';
  }
  return KG_CHAIN_CONFIGS[value] ? value : '';
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

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stringifyJSON(value) {
  return JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ));
}

function tokenEstimate(text) {
  return Math.ceil(String(text || '').length / 4);
}

function firstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || '';
}

function resolveKGEnv(chainSlug, env = process.env) {
  const chain = KG_CHAIN_CONFIGS[normalizeChainSlug(chainSlug)];
  if (!chain) {
    return { explorerApiKey: '', rpcUrl: '' };
  }
  const explorerApiKey = chain.apiKeyEnv.map((key) => normalizeText(env[key])).find(Boolean) || '';
  const rpcUrl = chain.rpcEnv.map((key) => normalizeText(env[key])).find(Boolean) || '';
  return { explorerApiKey, rpcUrl };
}

export function createKGPool(options = {}) {
  const connectionString = normalizeText(options.databaseUrl || process.env.KG_DATABASE_URL || process.env.DATABASE_URL);
  if (!connectionString) {
    throw new Error(
      'KG_DATABASE_URL or DATABASE_URL is required for the protocol knowledge graph DB. '
      + 'For local dev, put KG_DATABASE_URL=postgres://postgres:postgres@localhost:5433/hershy_kg in frontend/front/.env.local, '
      + 'then start a pgvector Postgres with `npm run kg:db:up` from /home/admin/hershy.',
    );
  }
  const sslMode = normalizeText(options.ssl || process.env.KG_DATABASE_SSL).toLowerCase();
  return new Pool({
    connectionString,
    max: Number(options.poolSize || process.env.KG_DATABASE_POOL_SIZE || 8),
    ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined,
  });
}

export async function applyKGMigrations(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const migrationsDir = path.resolve(options.cwd || process.cwd(), options.migrationsDir || 'db/migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  const applied = [];
  try {
    for (const fileName of files) {
      const sql = await fs.readFile(path.join(migrationsDir, fileName), 'utf8');
      await pool.query(sql);
      applied.push(fileName);
    }
    return { ok: true, applied };
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
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
      return { explorer: candidate.name, endpoint: candidate.endpoint, payload };
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
  if (rawABI && rawABI !== 'Contract source code not verified') {
    try {
      abi = JSON.parse(rawABI);
    } catch {
      abi = [];
    }
  }
  if (!Array.isArray(abi) || abi.length === 0) {
    try {
      const abiLookup = await fetchExplorerAction(chainConfig, 'getabi', address, apiKey);
      const abiText = normalizeText(abiLookup.payload?.result);
      if (abiText.startsWith('[')) {
        abi = JSON.parse(abiText);
      }
    } catch {
      abi = [];
    }
  }

  const sourceCode = normalizeText(item.SourceCode);
  return {
    address,
    verified: Boolean(sourceCode || abi.length > 0),
    explorer: sourceLookup.explorer,
    endpoint: sourceLookup.endpoint,
    contractName: normalizeText(item.ContractName),
    compilerVersion: normalizeText(item.CompilerVersion),
    sourceCode,
    source: parseSourceCode(sourceCode, normalizeText(item.ContractName) || address),
    abi,
    raw: item,
    proxyFlag: normalizeText(item.Proxy) === '1',
    implementation: normalizeAddress(item.Implementation),
  };
}

function parseSourceCode(sourceCode, contractName) {
  const raw = normalizeText(sourceCode);
  if (!raw) {
    return { format: 'none', files: [] };
  }
  const attempts = [raw];
  if (raw.startsWith('{{') && raw.endsWith('}}')) {
    attempts.push(raw.slice(1, -1));
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && parsed.sources && typeof parsed.sources === 'object') {
        return {
          format: 'standard-json',
          files: Object.entries(parsed.sources).map(([filePath, file]) => ({
            path: filePath,
            content: normalizeText(file?.content),
          })),
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return {
    format: 'single-file',
    files: [{
      path: `${slugify(contractName, 'contract')}.sol`,
      content: raw,
    }],
  };
}

async function rpcRequest(rpcUrl, method, params = []) {
  if (!rpcUrl) {
    throw new Error(`RPC URL is required for ${method}`);
  }
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RPC ${method} HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  const json = JSON.parse(text);
  if (json.error) {
    throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
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
    slots: {},
  };
  if (!rpcUrl) {
    return { ...empty, proxyType: 'unknown-no-rpc' };
  }
  const [implementationSlot, adminSlot, beaconSlot] = await Promise.all([
    rpcRequest(rpcUrl, 'eth_getStorageAt', [address, EIP1967_IMPLEMENTATION_SLOT, 'latest']).catch(() => ''),
    rpcRequest(rpcUrl, 'eth_getStorageAt', [address, EIP1967_ADMIN_SLOT, 'latest']).catch(() => ''),
    rpcRequest(rpcUrl, 'eth_getStorageAt', [address, EIP1967_BEACON_SLOT, 'latest']).catch(() => ''),
  ]);
  const implementationAddress = storageWordToAddress(implementationSlot);
  const adminAddress = storageWordToAddress(adminSlot);
  const beaconAddress = storageWordToAddress(beaconSlot);
  let proxyType = 'none';
  if (beaconAddress) {
    proxyType = 'beacon/eip1967';
  } else if (implementationAddress && adminAddress) {
    proxyType = 'transparent/eip1967';
  } else if (implementationAddress) {
    proxyType = 'uups/eip1967';
  }
  return {
    isProxy: Boolean(implementationAddress || beaconAddress),
    proxyType,
    implementationAddress,
    adminAddress,
    beaconAddress,
    slots: {
      implementation: implementationSlot,
      admin: adminSlot,
      beacon: beaconSlot,
    },
  };
}

async function getRuntimeContext(rpcUrl, address) {
  if (!rpcUrl) {
    return { blockNumber: null, bytecodeHash: '', proxyInfo: await resolveProxyInfo('', address) };
  }
  const [blockHex, bytecode, proxyInfo] = await Promise.all([
    rpcRequest(rpcUrl, 'eth_blockNumber', []),
    rpcRequest(rpcUrl, 'eth_getCode', [address, 'latest']),
    resolveProxyInfo(rpcUrl, address),
  ]);
  return {
    blockNumber: Number(BigInt(blockHex)),
    bytecodeHash: sha256Hex(bytecode || ''),
    proxyInfo,
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

function selectorForABIItem(item, signature) {
  try {
    if (item?.type === 'function') {
      return toFunctionSelector(signature);
    }
    if (item?.type === 'event') {
      return toEventSelector(signature);
    }
  } catch {
    return '';
  }
  return '';
}

function uriPart(value) {
  return encodeURIComponent(normalizeText(value) || 'unknown').replace(/%/g, '~');
}

function makePageURI({ protocolSlug, chainSlug, address, kind, parts = [] }) {
  return [
    'kg:/',
    'protocols',
    uriPart(protocolSlug),
    chainSlug,
    'contracts',
    addressKey(address),
    kind,
    ...parts.map(uriPart),
  ].join('/');
}

function splitABI(abi) {
  const list = Array.isArray(abi) ? abi : [];
  return {
    functions: list.filter((item) => item?.type === 'function'),
    events: list.filter((item) => item?.type === 'event'),
    errors: list.filter((item) => item?.type === 'error'),
  };
}

function detectRole(sourceRecord, abi) {
  const name = normalizeText(sourceRecord?.contractName).toLowerCase();
  const signatures = splitABI(abi).functions.map(formatABISignature).join(' ').toLowerCase();
  if (/oracle|feed|aggregator/.test(name) || /latestrounddata|oracle|pricefeed/.test(signatures)) return 'oracle-or-price-feed';
  if (/router/.test(name) || /exactinput|swapexact|multicall|route/.test(signatures)) return 'router-or-entrypoint';
  if (/vault|pool/.test(name) || /deposit|withdraw|collateral|liquidity/.test(signatures)) return 'vault-or-pool';
  if (/position|perp|margin/.test(name) || /openposition|closeposition|liquidat|leverage/.test(signatures)) return 'position-manager';
  if (/factory/.test(name) || /createpool|deploy|getpool/.test(signatures)) return 'factory';
  if (/govern|admin|timelock/.test(name) || /queue|execute|propose|cancel/.test(signatures)) return 'governance-or-admin';
  if (/token|erc20/.test(name) || /transfer\(address,uint256\)|approve\(address,uint256\)|totalSupply\(\)/i.test(signatures)) return 'token';
  return 'contract';
}

function buildContractSummary({ protocolName, chainConfig, address, sourceRecord, runtimeContext, role, abi, stateValues = [] }) {
  const { functions, events } = splitABI(abi);
  const strategyHooks = functions
    .filter((fn) => STRATEGY_FUNCTION_RE.test(fn.name || ''))
    .slice(0, 40)
    .map(formatABISignature);
  const riskHooks = functions
    .filter((fn) => ADMIN_RISK_RE.test(fn.name || ''))
    .slice(0, 40)
    .map(formatABISignature);
  const lines = [
    `Protocol: ${protocolName}`,
    `Chain: ${chainConfig.displayName} (${chainConfig.chainId})`,
    `Contract: ${sourceRecord.contractName || address}`,
    `Address: ${address}`,
    `Role: ${role}`,
    `Verified: ${sourceRecord.verified}`,
    `Compiler: ${sourceRecord.compilerVersion || 'unknown'}`,
    `Proxy: ${runtimeContext.proxyInfo?.proxyType || 'none'}`,
    `Implementation: ${runtimeContext.proxyInfo?.implementationAddress || sourceRecord.implementation || 'none'}`,
    `Admin: ${runtimeContext.proxyInfo?.adminAddress || 'none'}`,
    `Bytecode SHA256: ${runtimeContext.bytecodeHash || 'unknown'}`,
    '',
    'Strategy hooks:',
    ...(strategyHooks.length > 0 ? strategyHooks.map((item) => `- ${item}`) : ['- none detected']),
    '',
    'Risk/admin hooks:',
    ...(riskHooks.length > 0 ? riskHooks.map((item) => `- ${item}`) : ['- none detected']),
    '',
    'Events:',
    ...events.slice(0, 40).map((item) => `- ${formatABISignature(item)}`),
    '',
    'State snapshot:',
    ...(stateValues.length > 0 ? stateValues.slice(0, 40).map((item) => `- ${item.name}: ${item.valueText}`) : ['- none read']),
  ];
  return `${lines.join('\n')}\n`;
}

async function readImportantState({ rpcUrl, address, abi }) {
  if (!rpcUrl) {
    return [];
  }
  const values = [];
  const functions = splitABI(abi).functions
    .filter((fn) => {
      const inputs = Array.isArray(fn.inputs) ? fn.inputs : [];
      const outputs = Array.isArray(fn.outputs) ? fn.outputs : [];
      return ['view', 'pure'].includes(fn.stateMutability) && inputs.length === 0 && outputs.length > 0 && STATE_GETTER_RE.test(fn.name || '');
    })
    .slice(0, 60);
  for (const fn of functions) {
    try {
      const data = encodeFunctionData({ abi: [fn], functionName: fn.name });
      const result = await rpcRequest(rpcUrl, 'eth_call', [{ to: address, data }, 'latest']);
      const decoded = decodeFunctionResult({ abi: [fn], functionName: fn.name, data: result });
      values.push({
        name: fn.name,
        signature: formatABISignature(fn),
        value: decoded,
        valueText: Array.isArray(decoded) ? decoded.map(String).join(', ') : String(decoded),
      });
    } catch {
      // Some view functions revert behind proxies or require initialized state.
    }
  }
  return values;
}

function extractSolidityChunks(filePath, content) {
  const text = String(content || '');
  if (!text.trim()) {
    return [];
  }
  const matches = Array.from(text.matchAll(/\b(function|modifier|event|error|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g));
  if (matches.length === 0) {
    return [{
      chunkType: 'solidity_file',
      headingPath: [filePath],
      text: text.slice(0, 16_000),
      name: path.basename(filePath),
      ordinal: 1,
    }];
  }
  const chunks = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const end = matches[index + 1]?.index || Math.min(text.length, start + 16_000);
    chunks.push({
      chunkType: `solidity_${match[1]}`,
      headingPath: [filePath, `${match[1]} ${match[2]}`],
      text: text.slice(start, end).trim(),
      name: match[2],
      ordinal: index + 1,
    });
  }
  return chunks;
}

function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }
  return `[${embedding.map((item) => Number(item).toFixed(8)).join(',')}]`;
}

function normalizeVectorDimensions(value) {
  const dimensions = Number(value);
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 2000) {
    throw new Error('embedding dimensions must be an integer between 1 and 2000 for pgvector HNSW vector indexes');
  }
  return dimensions;
}

function sqlStringLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function sqlIdentifier(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'embedding';
  return `"${normalized}"`;
}

function detectEmbeddingProfile(modelName) {
  const model = normalizeText(modelName).toLowerCase();
  if (model.includes('nomic')) {
    return {
      family: 'nomic',
      queryPrefix: 'search_query: ',
      documentPrefix: 'search_document: ',
      maxInputTokens: 2048,
      notes: 'Nomic embedding models expect search_query/search_document prefixes for retrieval.',
    };
  }
  if (model.includes('mxbai') || model.includes('mixedbread')) {
    return {
      family: 'mxbai',
      queryPrefix: MIXEDBREAD_QUERY_PREFIX,
      documentPrefix: '',
      maxInputTokens: 512,
      notes: 'Mixedbread retrieval uses a query prefix and plain documents.',
    };
  }
  if (model.includes('bge')) {
    return {
      family: 'bge',
      queryPrefix: BGE_QUERY_PREFIX,
      documentPrefix: '',
      maxInputTokens: 512,
      notes: 'BGE v1.5 generally uses a retrieval instruction for short queries and plain passages.',
    };
  }
  if (/\be5\b|e5-/.test(model)) {
    return {
      family: 'e5',
      queryPrefix: 'query: ',
      documentPrefix: 'passage: ',
      maxInputTokens: 512,
      notes: 'E5 models require query/passages prefixes.',
    };
  }
  if (model.includes('qwen3-embedding') || model.includes('qwen3')) {
    return {
      family: 'qwen3',
      queryPrefix: '',
      documentPrefix: '',
      maxInputTokens: 32768,
      notes: 'Qwen3 embedding supports code-heavy retrieval; prefix policy is left configurable.',
    };
  }
  return {
    family: 'generic',
    queryPrefix: '',
    documentPrefix: '',
    maxInputTokens: 512,
    notes: 'Generic embedding profile; configure prefixes explicitly if the model requires them.',
  };
}

function resolveEmbeddingConfig(options = {}) {
  const explicitProvider = normalizeText(options.embeddingProvider || process.env.KG_EMBEDDING_PROVIDER).toLowerCase();
  const openaiApiKey = normalizeText(options.openaiApiKey || process.env.OPENAI_API_KEY);
  const ollamaBaseUrl = normalizeText(
    options.ollamaBaseUrl ||
    process.env.KG_OLLAMA_BASE_URL ||
    process.env.OLLAMA_EMBEDDING_BASE_URL ||
    process.env.OLLAMA_BASE_URL,
  );
  const provider = explicitProvider || (ollamaBaseUrl ? 'ollama' : openaiApiKey ? 'openai' : 'none');
  if (provider === 'ollama') {
    const model = normalizeText(options.embeddingModel || process.env.KG_EMBEDDING_MODEL || process.env.OLLAMA_EMBEDDING_MODEL) || DEFAULT_OLLAMA_EMBEDDING_MODEL;
    const profile = detectEmbeddingProfile(model);
    return {
      provider,
      model,
      ollamaBaseUrl: ollamaBaseUrl || 'http://localhost:11434',
      profile,
      queryPrefix: firstNonEmpty(options.embeddingQueryPrefix, process.env.KG_EMBEDDING_QUERY_PREFIX, profile.queryPrefix),
      documentPrefix: firstNonEmpty(options.embeddingDocumentPrefix, process.env.KG_EMBEDDING_DOCUMENT_PREFIX, profile.documentPrefix),
      maxInputTokens: Number(options.embeddingMaxInputTokens || process.env.KG_EMBEDDING_MAX_INPUT_TOKENS || profile.maxInputTokens || 0),
    };
  }
  if (provider === 'openai') {
    const model = normalizeText(options.embeddingModel || process.env.KG_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL;
    const profile = detectEmbeddingProfile(model);
    return {
      provider,
      model,
      openaiApiKey,
      openaiBaseUrl: normalizeText(options.openaiBaseUrl || process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1',
      dimensions: Number(options.embeddingDim || process.env.KG_EMBEDDING_DIM || DEFAULT_EMBEDDING_DIM),
      profile,
      queryPrefix: firstNonEmpty(options.embeddingQueryPrefix, process.env.KG_EMBEDDING_QUERY_PREFIX, profile.queryPrefix),
      documentPrefix: firstNonEmpty(options.embeddingDocumentPrefix, process.env.KG_EMBEDDING_DOCUMENT_PREFIX, profile.documentPrefix),
      maxInputTokens: Number(options.embeddingMaxInputTokens || process.env.KG_EMBEDDING_MAX_INPUT_TOKENS || profile.maxInputTokens || 0),
    };
  }
  return {
    provider: 'none',
    model: '',
    dimensions: 0,
    profile: detectEmbeddingProfile(''),
    queryPrefix: '',
    documentPrefix: '',
    maxInputTokens: 0,
  };
}

function emptyEmbeddingResult(texts, config = {}) {
  return {
    embeddings: texts.map(() => null),
    provider: config.provider || 'none',
    model: config.model || '',
    dimensions: 0,
    queryPrefix: config.queryPrefix || '',
    documentPrefix: config.documentPrefix || '',
    maxInputTokens: config.maxInputTokens || 0,
    profile: config.profile || detectEmbeddingProfile(config.model),
  };
}

async function embedTexts(texts, options = {}) {
  const config = resolveEmbeddingConfig(options);
  const inputType = normalizeText(options.embeddingInputType || options.inputType) === 'query' ? 'query' : 'document';
  const preparedTexts = texts.map((text) => prepareEmbeddingText(text, config, inputType));
  if (texts.length === 0 || config.provider === 'none') {
    return emptyEmbeddingResult(texts, config);
  }
  if (config.provider === 'ollama') {
    return embedTextsWithOllama(preparedTexts, config);
  }
  if (config.provider === 'openai') {
    return embedTextsWithOpenAI(preparedTexts, config);
  }
  return emptyEmbeddingResult(texts, config);
}

function prepareEmbeddingText(text, config, inputType) {
  const prefix = inputType === 'query' ? config.queryPrefix : config.documentPrefix;
  const prefixed = `${prefix || ''}${String(text || '')}`;
  const maxInputTokens = Number(config.maxInputTokens || 0);
  if (!maxInputTokens) {
    return prefixed;
  }
  const maxChars = Math.max(256, maxInputTokens * 4);
  if (prefixed.length <= maxChars) {
    return prefixed;
  }
  return prefixed.slice(0, maxChars);
}

async function embedTextsWithOpenAI(texts, config) {
  if (!config.openaiApiKey || texts.length === 0) {
    return emptyEmbeddingResult(texts, config);
  }
  const response = await fetch(`${config.openaiBaseUrl.replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      dimensions: config.dimensions,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`embedding request failed: ${response.status} ${body.slice(0, 240)}`);
  }
  const payload = JSON.parse(body);
  const embeddings = texts.map((_text, index) => payload?.data?.[index]?.embedding || null);
  return {
    embeddings,
    provider: 'openai',
    model: config.model,
    dimensions: embeddings.find(Boolean)?.length || config.dimensions || 0,
    queryPrefix: config.queryPrefix || '',
    documentPrefix: config.documentPrefix || '',
    maxInputTokens: config.maxInputTokens || 0,
    profile: config.profile,
  };
}

async function embedTextsWithOllama(texts, config) {
  const baseURL = config.ollamaBaseUrl.replace(/\/+$/, '');
  const embedResponse = await fetch(`${baseURL}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      input: texts,
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch((error) => ({ ok: false, error }));

  if (embedResponse?.ok) {
    const payload = await embedResponse.json();
    const embeddings = Array.isArray(payload.embeddings)
      ? payload.embeddings
      : Array.isArray(payload.embedding)
        ? [payload.embedding]
        : [];
    if (embeddings.length === texts.length) {
      return {
        embeddings,
        provider: 'ollama',
        model: config.model,
        dimensions: embeddings.find(Boolean)?.length || 0,
        queryPrefix: config.queryPrefix || '',
        documentPrefix: config.documentPrefix || '',
        maxInputTokens: config.maxInputTokens || 0,
        profile: config.profile,
      };
    }
  }

  const embeddings = [];
  for (const text of texts) {
    const response = await fetch(`${baseURL}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: text,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`ollama embedding request failed: ${response.status} ${body.slice(0, 240)}`);
    }
    const payload = JSON.parse(body);
    embeddings.push(payload.embedding || null);
  }
  return {
    embeddings,
    provider: 'ollama',
    model: config.model,
    dimensions: embeddings.find(Boolean)?.length || 0,
    queryPrefix: config.queryPrefix || '',
    documentPrefix: config.documentPrefix || '',
    maxInputTokens: config.maxInputTokens || 0,
    profile: config.profile,
  };
}

async function upsertEntity(client, input) {
  const type = normalizeText(input.type);
  const chainID = input.chainId || null;
  const address = normalizeAddress(input.address);
  if (address) {
    const existing = await client.query(
      'SELECT id FROM entities WHERE type = $1 AND chain_id = $2 AND lower(address) = lower($3) LIMIT 1',
      [type, chainID, address],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE entities
         SET canonical_name = COALESCE($2, canonical_name),
             aliases = (SELECT ARRAY(SELECT DISTINCT unnest(entities.aliases || $3::text[]))),
             metadata = entities.metadata || $4::jsonb,
             confidence = GREATEST(entities.confidence, $5),
             updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, input.canonicalName || null, input.aliases || [], input.metadata || {}, input.confidence || 1],
      );
      return existing.rows[0].id;
    }
  } else {
    const existing = await client.query(
      'SELECT id FROM entities WHERE type = $1 AND lower(coalesce(canonical_name, \'\')) = lower($2) LIMIT 1',
      [type, normalizeText(input.canonicalName)],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE entities
         SET aliases = (SELECT ARRAY(SELECT DISTINCT unnest(entities.aliases || $2::text[]))),
             metadata = entities.metadata || $3::jsonb,
             confidence = GREATEST(entities.confidence, $4),
             updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, input.aliases || [], input.metadata || {}, input.confidence || 1],
      );
      return existing.rows[0].id;
    }
  }

  const result = await client.query(
    `INSERT INTO entities (type, canonical_name, aliases, chain_id, address, metadata, confidence)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id`,
    [type, input.canonicalName || null, input.aliases || [], chainID, address || null, input.metadata || {}, input.confidence || 1],
  );
  return result.rows[0].id;
}

async function upsertProtocol(client, input) {
  const entityID = await upsertEntity(client, {
    type: 'protocol',
    canonicalName: input.name,
    aliases: input.aliases || [],
    metadata: input.metadata || {},
    confidence: input.confidence || 0.9,
  });
  const slug = slugify(input.slug || input.name);
  const result = await client.query(
    `INSERT INTO protocols (entity_id, name, slug, website, docs_url, github_url, category, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (slug) DO UPDATE SET
       entity_id = excluded.entity_id,
       name = excluded.name,
       website = COALESCE(excluded.website, protocols.website),
       docs_url = COALESCE(excluded.docs_url, protocols.docs_url),
       github_url = COALESCE(excluded.github_url, protocols.github_url),
       category = COALESCE(excluded.category, protocols.category),
       status = excluded.status,
       metadata = protocols.metadata || excluded.metadata,
       updated_at = now()
     RETURNING id, entity_id, slug`,
    [
      entityID,
      input.name,
      slug,
      input.website || null,
      input.docsUrl || null,
      input.githubUrl || null,
      input.category || null,
      input.status || 'candidate',
      input.metadata || {},
    ],
  );
  return result.rows[0];
}

async function upsertArtifact(client, input) {
  const result = await client.query(
    `INSERT INTO artifacts (entity_id, type, uri, content_hash, raw_text, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (type, uri, content_hash) DO UPDATE SET
       entity_id = COALESCE(excluded.entity_id, artifacts.entity_id),
       metadata = artifacts.metadata || excluded.metadata,
       fetched_at = now()
     RETURNING id`,
    [
      input.entityID || null,
      input.type,
      input.uri,
      input.contentHash || sha256Hex(input.rawText || ''),
      input.rawText || '',
      input.metadata || {},
    ],
  );
  return result.rows[0].id;
}

async function upsertEmbeddingModel(client, input) {
  if (!input.provider || !input.model || !input.dimensions) {
    return null;
  }
  const result = await client.query(
    `INSERT INTO embedding_models (
       provider, model, dimensions, query_prefix, document_prefix,
       max_input_tokens, distance_metric, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'cosine', $7::jsonb)
     ON CONFLICT (provider, model, dimensions) DO UPDATE SET
       query_prefix = excluded.query_prefix,
       document_prefix = excluded.document_prefix,
       max_input_tokens = COALESCE(excluded.max_input_tokens, embedding_models.max_input_tokens),
       metadata = embedding_models.metadata || excluded.metadata,
       updated_at = now()
     RETURNING id`,
    [
      input.provider,
      input.model,
      input.dimensions,
      input.queryPrefix || '',
      input.documentPrefix || '',
      input.maxInputTokens || null,
      {
        family: input.profile?.family || 'generic',
        notes: input.profile?.notes || '',
      },
    ],
  );
  return result.rows[0].id;
}

async function upsertChunkEmbedding(client, input) {
  const embeddingLiteral = vectorLiteral(input.embedding);
  if (!input.chunkID || !embeddingLiteral || !input.provider || !input.model || !input.dimensions) {
    return null;
  }
  const result = await client.query(
    `INSERT INTO chunk_embeddings (
       chunk_id, embedding_model_id, provider, model, dimensions, embedding, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)
     ON CONFLICT (chunk_id, provider, model, dimensions) DO UPDATE SET
       embedding_model_id = COALESCE(excluded.embedding_model_id, chunk_embeddings.embedding_model_id),
       embedding = excluded.embedding,
       metadata = chunk_embeddings.metadata || excluded.metadata,
       updated_at = now()
     RETURNING id`,
    [
      input.chunkID,
      input.embeddingModelID || null,
      input.provider,
      input.model,
      input.dimensions,
      embeddingLiteral,
      input.metadata || {},
    ],
  );
  return result.rows[0].id;
}

function makeRevisionInternalURI(internalURI, revisionNumber, contentHash) {
  return `${internalURI}?rev=${revisionNumber}-${String(contentHash || '').slice(0, 12)}`;
}

async function upsertKnowledgePage(client, input) {
  const internalURI = normalizeText(input.internalURI);
  const body = normalizeText(input.body);
  if (!internalURI || !body) {
    throw new Error('knowledge page internalURI and body are required');
  }
  const modifiedAt = new Date().toISOString();
  const contentHash = input.contentHash || sha256Hex(body);
  const existing = await client.query(
    `SELECT pages.*,
            revisions.internal_uri AS current_revision_internal_uri,
            revisions.revision_number AS current_revision_number
     FROM knowledge_pages pages
     LEFT JOIN knowledge_page_revisions revisions ON revisions.id = pages.current_revision_id
     WHERE pages.internal_uri = $1
     LIMIT 1`,
    [internalURI],
  );

  if (!existing.rows[0]) {
    const pageResult = await client.query(
      `INSERT INTO knowledge_pages (
         entity_id, page_kind, internal_uri, title, content_hash,
         previous_internal_uri, modified_at, metadata
       )
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::jsonb)
       RETURNING id`,
      [
        input.entityID || null,
        input.pageKind,
        internalURI,
        input.title,
        contentHash,
        modifiedAt,
        input.metadata || {},
      ],
    );
    const revisionURI = makeRevisionInternalURI(internalURI, 1, contentHash);
    const revisionResult = await client.query(
      `INSERT INTO knowledge_page_revisions (
         page_id, revision_number, internal_uri, previous_internal_uri,
         title, body, content_hash, artifact_id, modified_at, metadata
       )
       VALUES ($1, 1, $2, NULL, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        pageResult.rows[0].id,
        revisionURI,
        input.title,
        body,
        contentHash,
        input.artifactID || null,
        modifiedAt,
        input.metadata || {},
      ],
    );
    await client.query(
      `UPDATE knowledge_pages
       SET current_revision_id = $2,
           updated_at = now()
       WHERE id = $1`,
      [pageResult.rows[0].id, revisionResult.rows[0].id],
    );
    return {
      pageID: pageResult.rows[0].id,
      revisionID: revisionResult.rows[0].id,
      internalURI,
      revisionInternalURI: revisionURI,
      previousInternalURI: '',
      modifiedAt,
      changed: true,
    };
  }

  const page = existing.rows[0];
  if (page.content_hash === contentHash) {
    await client.query(
      `UPDATE knowledge_pages
       SET entity_id = COALESCE($2, entity_id),
           title = $3,
           metadata = knowledge_pages.metadata || $4::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [page.id, input.entityID || null, input.title, input.metadata || {}],
    );
    return {
      pageID: page.id,
      revisionID: page.current_revision_id,
      internalURI,
      revisionInternalURI: page.current_revision_internal_uri,
      previousInternalURI: page.previous_internal_uri || '',
      modifiedAt: page.modified_at,
      changed: false,
    };
  }

  const previousRevisionURI = page.current_revision_internal_uri || page.previous_internal_uri || '';
  const nextRevisionNumber = Number(page.current_revision_number || 0) + 1;
  const revisionURI = makeRevisionInternalURI(internalURI, nextRevisionNumber, contentHash);

  if (page.current_revision_id) {
    await client.query(
      `UPDATE knowledge_page_revisions
       SET is_current = false,
           valid_to = $2,
           superseded_by_internal_uri = $3
       WHERE id = $1`,
      [page.current_revision_id, modifiedAt, revisionURI],
    );
    await client.query(
      `UPDATE chunks
       SET is_current = false,
           valid_to = $2,
           updated_at = now()
       WHERE page_revision_id = $1`,
      [page.current_revision_id, modifiedAt],
    );
  }

  const revisionResult = await client.query(
    `INSERT INTO knowledge_page_revisions (
       page_id, revision_number, internal_uri, previous_internal_uri,
       title, body, content_hash, artifact_id, modified_at, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [
      page.id,
      nextRevisionNumber,
      revisionURI,
      previousRevisionURI || null,
      input.title,
      body,
      contentHash,
      input.artifactID || null,
      modifiedAt,
      input.metadata || {},
    ],
  );
  await client.query(
    `UPDATE knowledge_pages
     SET entity_id = COALESCE($2, entity_id),
         title = $3,
         current_revision_id = $4,
         content_hash = $5,
         previous_internal_uri = $6,
         modified_at = $7,
         metadata = knowledge_pages.metadata || $8::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      page.id,
      input.entityID || null,
      input.title,
      revisionResult.rows[0].id,
      contentHash,
      previousRevisionURI || null,
      modifiedAt,
      input.metadata || {},
    ],
  );

  return {
    pageID: page.id,
    revisionID: revisionResult.rows[0].id,
    internalURI,
    revisionInternalURI: revisionURI,
    previousInternalURI: previousRevisionURI,
    modifiedAt,
    changed: true,
  };
}

async function upsertChunk(client, input) {
  const text = normalizeText(input.text);
  if (!text) {
    return null;
  }
  const contentHash = input.contentHash || sha256Hex(text);
  const embeddingLiteral = vectorLiteral(input.embedding);
  const result = await client.query(
    `INSERT INTO chunks (
       artifact_id, entity_id, page_id, page_revision_id, embedding_model_id,
       chunk_type, text, content_hash, heading_path, token_count,
       embedding, embedding_provider, embedding_model, embedding_dimensions,
       is_current, modified_at, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, $13, $14, true, $15, $16::jsonb)
     ON CONFLICT (page_revision_id, chunk_type, content_hash)
       WHERE page_revision_id IS NOT NULL AND content_hash <> ''
     DO UPDATE SET
       entity_id = COALESCE(excluded.entity_id, chunks.entity_id),
       text = excluded.text,
       heading_path = excluded.heading_path,
       token_count = excluded.token_count,
       embedding = COALESCE(excluded.embedding, chunks.embedding),
       embedding_model_id = COALESCE(excluded.embedding_model_id, chunks.embedding_model_id),
       embedding_provider = COALESCE(excluded.embedding_provider, chunks.embedding_provider),
       embedding_model = COALESCE(excluded.embedding_model, chunks.embedding_model),
       embedding_dimensions = COALESCE(excluded.embedding_dimensions, chunks.embedding_dimensions),
       is_current = true,
       modified_at = excluded.modified_at,
       metadata = chunks.metadata || excluded.metadata,
       updated_at = now()
     RETURNING id`,
    [
      input.artifactID || null,
      input.entityID || null,
      input.pageID || null,
      input.pageRevisionID || null,
      input.embeddingModelID || null,
      input.chunkType,
      text,
      contentHash,
      input.headingPath || [],
      tokenEstimate(text),
      embeddingLiteral,
      embeddingLiteral ? (input.embeddingProvider || null) : null,
      embeddingLiteral ? (input.embeddingModel || null) : null,
      embeddingLiteral ? (input.embeddingDimensions || null) : null,
      input.modifiedAt || new Date().toISOString(),
      input.metadata || {},
    ],
  );
  return result.rows[0].id;
}

async function upsertEdge(client, input) {
  const result = await client.query(
    `INSERT INTO edges (
       src_entity_id, dst_entity_id, relation_type, evidence_chunk_id,
       confidence, valid_from, valid_to, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      input.srcEntityID,
      input.dstEntityID,
      input.relationType,
      input.evidenceChunkID || null,
      input.confidence || 1,
      input.validFrom || null,
      input.validTo || null,
      input.metadata || {},
    ],
  );
  if (result.rows[0]) {
    return result.rows[0].id;
  }
  const existing = await client.query(
    `SELECT id FROM edges
     WHERE src_entity_id = $1
       AND dst_entity_id = $2
       AND relation_type = $3
       AND coalesce(evidence_chunk_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     LIMIT 1`,
    [input.srcEntityID, input.dstEntityID, input.relationType, input.evidenceChunkID || null],
  );
  return existing.rows[0]?.id || null;
}

async function upsertFact(client, input) {
  const result = await client.query(
    `INSERT INTO facts (
       subject_entity_id, predicate, object_entity_id, object_value,
       evidence_chunk_ids, confidence, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      input.subjectEntityID,
      input.predicate,
      input.objectEntityID || null,
      input.objectValue || null,
      input.evidenceChunkIDs || [],
      input.confidence || 1,
      input.metadata || {},
    ],
  );
  return result.rows[0]?.id || null;
}

async function insertContractSymbol(client, input) {
  await client.query(
    `INSERT INTO contract_symbols (
       contract_entity_id, symbol_type, name, selector, signature,
       state_mutability, source_chunk_id, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      input.contractEntityID,
      input.symbolType,
      input.name || null,
      input.selector || null,
      input.signature || null,
      input.stateMutability || null,
      input.sourceChunkID || null,
      input.metadata || {},
    ],
  );
}

async function upsertDeployment(client, input) {
  const existing = await client.query(
    `SELECT id FROM deployments
     WHERE chain_id = $1
       AND lower(address) = lower($2)
       AND protocol_id = $3
     LIMIT 1`,
    [input.chainID, input.address, input.protocolID],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE deployments
       SET contract_entity_id = $2,
           version = COALESCE($3, version),
           source = COALESCE($4, source),
           verified = $5,
           proxy_type = $6,
           implementation_address = $7,
           implementation_entity_id = $8,
           deployer_address = COALESCE($9, deployer_address),
           creation_tx_hash = COALESCE($10, creation_tx_hash),
           metadata = deployments.metadata || $11::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        input.contractEntityID,
        input.version || null,
        input.source || null,
        Boolean(input.verified),
        input.proxyType || null,
        input.implementationAddress || null,
        input.implementationEntityID || null,
        input.deployerAddress || null,
        input.creationTxHash || null,
        input.metadata || {},
      ],
    );
    return;
  }
  await client.query(
    `INSERT INTO deployments (
       protocol_id, chain_id, address, contract_entity_id, version, source,
       verified, proxy_type, implementation_address, implementation_entity_id,
       deployer_address, creation_tx_hash, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      input.protocolID,
      input.chainID,
      input.address,
      input.contractEntityID,
      input.version || null,
      input.source || null,
      Boolean(input.verified),
      input.proxyType || null,
      input.implementationAddress || null,
      input.implementationEntityID || null,
      input.deployerAddress || null,
      input.creationTxHash || null,
      input.metadata || {},
    ],
  );
}

export async function enqueueProtocolResearchTask(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const protocolName = normalizeText(options.protocolName || options.protocol || options.name);
  if (!protocolName) {
    throw new Error('protocolName is required');
  }
  const addresses = Array.from(new Set((options.addresses || [])
    .flatMap((item) => String(item || '').split(','))
    .map(normalizeAddress)
    .filter(Boolean)));
  if (addresses.length === 0) {
    throw new Error('at least one address is required');
  }
  try {
    const result = await pool.query(
      `INSERT INTO agent_research_tasks (task_type, priority, payload, max_attempts)
       VALUES ('INGEST_PROTOCOL_SEED', $1, $2::jsonb, $3)
       RETURNING id`,
      [
        Number(options.priority || 100),
        {
          protocolName,
          protocolSlug: options.protocolSlug || options.slug || slugify(protocolName),
          chain: normalizeChainSlug(options.chain || 'base-mainnet'),
          addresses,
          website: options.website || '',
          docsUrl: options.docsUrl || '',
          githubUrl: options.githubUrl || '',
          category: options.category || '',
          notes: options.notes || '',
        },
        Number(options.maxAttempts || 3),
      ],
    );
    return { ok: true, taskID: result.rows[0].id };
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

async function acquireTask(client, workerID) {
  await client.query('BEGIN');
  const result = await client.query(
    `SELECT *
     FROM agent_research_tasks
     WHERE status = 'queued'
       AND next_run_at <= now()
       AND attempts < max_attempts
     ORDER BY priority ASC, created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1`,
  );
  const task = result.rows[0];
  if (!task) {
    await client.query('COMMIT');
    return null;
  }
  await client.query(
    `UPDATE agent_research_tasks
     SET status = 'running',
         attempts = attempts + 1,
         locked_by = $2,
         locked_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [task.id, workerID],
  );
  await client.query('COMMIT');
  return task;
}

async function completeTask(client, taskID, summary) {
  await client.query(
    `UPDATE agent_research_tasks
     SET status = 'done',
         locked_by = NULL,
         locked_at = NULL,
         updated_at = now()
     WHERE id = $1`,
    [taskID],
  );
  await client.query(
    `UPDATE agent_research_runs
     SET status = 'done',
         finished_at = now(),
         summary = $2::jsonb
     WHERE task_id = $1
       AND finished_at IS NULL`,
    [taskID, summary || {}],
  );
}

async function failTask(client, task, error) {
  const shouldRetry = Number(task.attempts || 0) + 1 < Number(task.max_attempts || 3);
  await client.query(
    `UPDATE agent_research_tasks
     SET status = $2,
         locked_by = NULL,
         locked_at = NULL,
         last_error = $3,
         next_run_at = CASE WHEN $2 = 'queued' THEN now() + interval '5 minutes' ELSE next_run_at END,
         updated_at = now()
     WHERE id = $1`,
    [task.id, shouldRetry ? 'queued' : 'failed', error?.message || String(error)],
  );
  await client.query(
    `UPDATE agent_research_runs
     SET status = $2,
         finished_at = now(),
         error = $3
     WHERE task_id = $1
       AND finished_at IS NULL`,
    [task.id, shouldRetry ? 'retry' : 'failed', error?.message || String(error)],
  );
}

export async function runProtocolKnowledgeAgentLoop(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const workerID = options.workerID || `kg-agent-${process.pid}`;
  const maxJobs = Number(options.maxJobs || (options.once ? 1 : 10));
  const summaries = [];
  try {
    for (let index = 0; index < maxJobs; index += 1) {
      const client = await pool.connect();
      let task = null;
      try {
        task = await acquireTask(client, workerID);
        if (!task) {
          break;
        }
        await client.query(
          `INSERT INTO agent_research_runs (task_id, status, summary)
           VALUES ($1, 'running', '{}'::jsonb)`,
          [task.id],
        );
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The transaction may already be closed.
        }
        summaries.push({ taskID: task?.id || '', ok: false, error: error?.message || String(error) });
        continue;
      } finally {
        client.release();
      }

      try {
        const summary = await processProtocolKnowledgeTask(pool, task, options);
        const doneClient = await pool.connect();
        try {
          await completeTask(doneClient, task.id, summary);
        } finally {
          doneClient.release();
        }
        summaries.push({ taskID: task.id, ok: true, summary });
      } catch (error) {
        const failClient = await pool.connect();
        try {
          await failTask(failClient, task, error);
        } finally {
          failClient.release();
        }
        summaries.push({ taskID: task.id, ok: false, error: error?.message || String(error) });
      }
    }
    return { ok: true, workerID, processed: summaries.length, summaries };
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

async function processProtocolKnowledgeTask(pool, task, options) {
  if (task.task_type !== 'INGEST_PROTOCOL_SEED') {
    throw new Error(`unsupported task type: ${task.task_type}`);
  }
  return ingestProtocolSeedToGraph(pool, {
    ...(task.payload || {}),
    explorerApiKey: options.explorerApiKey,
    rpcUrl: options.rpcUrl,
    embeddingProvider: options.embeddingProvider,
    embeddingModel: options.embeddingModel,
    embeddingDim: options.embeddingDim,
    embeddingQueryPrefix: options.embeddingQueryPrefix,
    embeddingDocumentPrefix: options.embeddingDocumentPrefix,
    embeddingMaxInputTokens: options.embeddingMaxInputTokens,
    openaiApiKey: options.openaiApiKey,
    openaiBaseUrl: options.openaiBaseUrl,
    ollamaBaseUrl: options.ollamaBaseUrl,
  });
}

export async function ingestProtocolSeedToGraph(poolOrOptions, inputMaybe = {}) {
  const pool = poolOrOptions?.query ? poolOrOptions : createKGPool(poolOrOptions);
  const ownsPool = !poolOrOptions?.query;
  const input = poolOrOptions?.query ? inputMaybe : poolOrOptions;
  const chainSlug = normalizeChainSlug(input.chain || 'base-mainnet');
  const chainConfig = KG_CHAIN_CONFIGS[chainSlug];
  if (!chainConfig) {
    throw new Error(`unsupported chain: ${input.chain}`);
  }
  const protocolName = normalizeText(input.protocolName || input.protocol);
  if (!protocolName) {
    throw new Error('protocolName is required');
  }
  const addresses = Array.from(new Set((input.addresses || [])
    .flatMap((item) => String(item || '').split(','))
    .map(normalizeAddress)
    .filter(Boolean)));
  if (addresses.length === 0) {
    throw new Error('at least one address is required');
  }
  const env = resolveKGEnv(chainSlug);
  const explorerApiKey = firstNonEmpty(input.explorerApiKey, env.explorerApiKey);
  const rpcUrl = firstNonEmpty(input.rpcUrl, env.rpcUrl);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const protocol = await upsertProtocol(client, {
      name: protocolName,
      slug: input.protocolSlug || input.slug || protocolName,
      website: input.website,
      docsUrl: input.docsUrl,
      githubUrl: input.githubUrl,
      category: input.category,
      status: 'researched',
      metadata: {
        notes: input.notes || '',
        chain: chainSlug,
        seedAddresses: addresses,
      },
    });
    const chainEntityID = await upsertEntity(client, {
      type: 'chain',
      canonicalName: chainConfig.displayName,
      aliases: [chainSlug, String(chainConfig.chainId)],
      chainId: chainConfig.chainId,
      metadata: { chainSlug },
    });
    await upsertEdge(client, {
      srcEntityID: protocol.entity_id,
      dstEntityID: chainEntityID,
      relationType: 'DEPLOYED_ON',
      confidence: 1,
    });

    const processed = [];
    for (const rootAddress of addresses) {
      const result = await ingestContractAddress({
        client,
        protocol,
        protocolName,
        chainConfig,
        rootAddress,
        explorerApiKey,
        rpcUrl,
        embeddingOptions: input,
      });
      processed.push(result);
    }
    await client.query('COMMIT');
    return {
      protocol: protocolName,
      chain: chainSlug,
      addresses: processed.map((item) => item.address),
      contracts: processed.length,
      chunks: processed.reduce((total, item) => total + item.chunks, 0),
      edges: processed.reduce((total, item) => total + item.edges, 0),
      facts: processed.reduce((total, item) => total + item.facts, 0),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    if (ownsPool) {
      await pool.end();
    }
  }
}

async function ingestContractAddress({
  client,
  protocol,
  protocolName,
  chainConfig,
  rootAddress,
  explorerApiKey,
  rpcUrl,
  embeddingOptions,
}) {
  const rootSource = await fetchExplorerContract(chainConfig, rootAddress, explorerApiKey);
  const runtimeContext = await getRuntimeContext(rpcUrl, rootAddress);
  const implementationAddress = normalizeAddress(runtimeContext.proxyInfo?.implementationAddress || rootSource.implementation);
  let implementationSource = null;
  if (implementationAddress && addressKey(implementationAddress) !== addressKey(rootAddress)) {
    implementationSource = await fetchExplorerContract(chainConfig, implementationAddress, explorerApiKey).catch(() => null);
  }
  const analysisSource = implementationSource || rootSource;
  const runtimeABI = implementationSource?.abi?.length ? implementationSource.abi : rootSource.abi;
  const stateValues = await readImportantState({ rpcUrl, address: rootAddress, abi: runtimeABI });
  const role = detectRole(analysisSource, runtimeABI);

  const contractName = analysisSource.contractName || rootSource.contractName || rootAddress;
  const contractEntityID = await upsertEntity(client, {
    type: 'contract',
    canonicalName: contractName,
    aliases: [rootSource.contractName, analysisSource.contractName, rootAddress].filter(Boolean),
    chainId: chainConfig.chainId,
    address: rootAddress,
    metadata: {
      role,
      verified: rootSource.verified,
      explorer: `${chainConfig.explorerAddressBase}/${rootAddress}`,
      proxy: runtimeContext.proxyInfo,
    },
    confidence: rootSource.verified ? 0.95 : 0.65,
  });
  let implementationEntityID = null;
  if (implementationAddress) {
    implementationEntityID = await upsertEntity(client, {
      type: 'contract',
      canonicalName: implementationSource?.contractName || `Implementation ${implementationAddress}`,
      aliases: [implementationAddress, implementationSource?.contractName].filter(Boolean),
      chainId: chainConfig.chainId,
      address: implementationAddress,
      metadata: { role: 'implementation', verified: Boolean(implementationSource?.verified) },
      confidence: implementationSource?.verified ? 0.95 : 0.7,
    });
  }

  await upsertDeployment(client, {
    protocolID: protocol.id,
    chainID: chainConfig.chainId,
    address: rootAddress,
    contractEntityID,
    source: rootSource.explorer,
    verified: rootSource.verified,
    proxyType: runtimeContext.proxyInfo?.proxyType,
    implementationAddress,
    implementationEntityID,
    metadata: {
      blockNumber: runtimeContext.blockNumber,
      bytecodeHash: runtimeContext.bytecodeHash,
      compilerVersion: analysisSource.compilerVersion,
      role,
    },
  });

  let edgeCount = 0;
  let factCount = 0;
  await upsertEdge(client, {
    srcEntityID: protocol.entity_id,
    dstEntityID: contractEntityID,
    relationType: 'HAS_CONTRACT',
    confidence: 0.95,
    metadata: { chain: chainConfig.slug, address: rootAddress, role },
  });
  edgeCount += 1;

  if (implementationEntityID) {
    await upsertEdge(client, {
      srcEntityID: contractEntityID,
      dstEntityID: implementationEntityID,
      relationType: 'PROXY_TO_IMPLEMENTATION',
      confidence: 0.98,
      metadata: { proxyType: runtimeContext.proxyInfo?.proxyType },
    });
    edgeCount += 1;
  }

  const sourceArtifactID = await upsertArtifact(client, {
    entityID: contractEntityID,
    type: 'etherscan_source',
    uri: `etherscan-v2:${chainConfig.chainId}:${rootAddress}:source`,
    rawText: stringifyJSON(rootSource.raw),
    metadata: {
      explorer: rootSource.explorer,
      verified: rootSource.verified,
      contractName: rootSource.contractName,
    },
  });

  const summaryText = buildContractSummary({
    protocolName,
    chainConfig,
    address: rootAddress,
    sourceRecord: analysisSource,
    runtimeContext,
    role,
    abi: runtimeABI,
    stateValues,
  });
  const embeddingTexts = [summaryText];
  const deferredChunks = [{
    artifactID: sourceArtifactID,
    entityID: contractEntityID,
    pageKind: 'contract_summary',
    title: `${protocolName} ${contractName} contract summary`,
    internalURI: makePageURI({
      protocolSlug: protocol.slug,
      chainSlug: chainConfig.slug,
      address: rootAddress,
      kind: 'summary',
    }),
    chunkType: 'contract_summary',
    text: summaryText,
    headingPath: [protocolName, contractName, 'summary'],
    metadata: { role, address: rootAddress, chain: chainConfig.slug },
  }];

  const { functions, events, errors } = splitABI(runtimeABI);
  for (const item of [...functions, ...events, ...errors]) {
    const signature = formatABISignature(item);
    const symbolType = item.type;
    const text = `${symbolType} ${signature}\nstateMutability: ${item.stateMutability || ''}\ninputs: ${stringifyJSON(item.inputs || [])}\noutputs: ${stringifyJSON(item.outputs || [])}`;
    const selector = selectorForABIItem(item, signature) || sha256Hex(signature).slice(0, 10);
    embeddingTexts.push(text);
    deferredChunks.push({
      artifactID: sourceArtifactID,
      entityID: contractEntityID,
      pageKind: `abi_${symbolType}`,
      title: `${contractName} ${symbolType} ${signature}`,
      internalURI: makePageURI({
        protocolSlug: protocol.slug,
        chainSlug: chainConfig.slug,
        address: rootAddress,
        kind: 'abi',
        parts: [symbolType, selector],
      }),
      chunkType: `abi_${symbolType}`,
      text,
      headingPath: [protocolName, contractName, 'abi', signature],
      metadata: {
        symbolType,
        signature,
        strategyRelevant: STRATEGY_FUNCTION_RE.test(item.name || ''),
        riskRelevant: ADMIN_RISK_RE.test(item.name || ''),
      },
      abiItem: item,
    });
  }

  for (const file of analysisSource.source?.files || []) {
    const artifactID = await upsertArtifact(client, {
      entityID: contractEntityID,
      type: 'solidity_source',
      uri: `etherscan-v2:${chainConfig.chainId}:${rootAddress}:source:${file.path}`,
      rawText: file.content,
      metadata: { filePath: file.path, contractName },
    });
    for (const chunk of extractSolidityChunks(file.path, file.content)) {
      embeddingTexts.push(chunk.text);
      deferredChunks.push({
        artifactID,
        entityID: contractEntityID,
        pageKind: chunk.chunkType,
        title: `${contractName} ${chunk.headingPath.join(' / ')}`,
        internalURI: makePageURI({
          protocolSlug: protocol.slug,
          chainSlug: chainConfig.slug,
          address: rootAddress,
          kind: 'source',
          parts: [sha256Hex(file.path).slice(0, 12), chunk.chunkType, `${chunk.ordinal || 1}-${chunk.name || 'chunk'}`],
        }),
        chunkType: chunk.chunkType,
        text: chunk.text,
        headingPath: [protocolName, contractName, ...chunk.headingPath],
        metadata: { filePath: file.path, name: chunk.name, ordinal: chunk.ordinal || 1 },
      });
    }
  }

  const embeddingResult = await embedTexts(embeddingTexts, {
    ...embeddingOptions,
    embeddingInputType: 'document',
  })
    .catch(() => emptyEmbeddingResult(embeddingTexts));
  const embeddingModelID = embeddingResult.provider !== 'none' && embeddingResult.dimensions > 0
    ? await upsertEmbeddingModel(client, embeddingResult)
    : null;
  let chunkCount = 0;
  let embeddingIndex = 0;
  for (const chunk of deferredChunks) {
    const page = await upsertKnowledgePage(client, {
      entityID: chunk.entityID,
      artifactID: chunk.artifactID,
      pageKind: chunk.pageKind || chunk.chunkType,
      internalURI: chunk.internalURI,
      title: chunk.title || chunk.headingPath?.join(' / ') || chunk.chunkType,
      body: chunk.text,
      metadata: {
        ...(chunk.metadata || {}),
        chunkType: chunk.chunkType,
        headingPath: chunk.headingPath || [],
      },
    });
    const chunkID = await upsertChunk(client, {
      ...chunk,
      pageID: page.pageID,
      pageRevisionID: page.revisionID,
      modifiedAt: page.modifiedAt,
      embedding: embeddingResult.embeddings[embeddingIndex] || null,
      embeddingModelID,
      embeddingProvider: embeddingResult.provider,
      embeddingModel: embeddingResult.model,
      embeddingDimensions: embeddingResult.dimensions,
      metadata: {
        ...(chunk.metadata || {}),
        pageInternalURI: page.internalURI,
        pageRevisionInternalURI: page.revisionInternalURI,
        previousInternalURI: page.previousInternalURI,
        modifiedAt: page.modifiedAt,
        isLatestPage: true,
      },
    });
    embeddingIndex += 1;
    if (chunkID) {
      chunkCount += 1;
      await upsertChunkEmbedding(client, {
        chunkID,
        embedding: embeddingResult.embeddings[embeddingIndex - 1] || null,
        embeddingModelID,
        provider: embeddingResult.provider,
        model: embeddingResult.model,
        dimensions: embeddingResult.dimensions,
        metadata: {
          source: 'ingest',
          pageInternalURI: page.internalURI,
          pageRevisionInternalURI: page.revisionInternalURI,
        },
      });
    }
    if (chunk.abiItem) {
      const abiItem = chunk.abiItem;
      const signature = formatABISignature(abiItem);
      const selector = selectorForABIItem(abiItem, signature);
      await insertContractSymbol(client, {
        contractEntityID,
        symbolType: abiItem.type,
        name: abiItem.name,
        selector,
        signature,
        stateMutability: abiItem.stateMutability,
        sourceChunkID: chunkID,
        metadata: {
          inputs: abiItem.inputs || [],
          outputs: abiItem.outputs || [],
        },
      });

      if (abiItem.type === 'function') {
        const fnEntityID = await upsertEntity(client, {
          type: 'function',
          canonicalName: `${contractName}.${signature}`,
          aliases: [abiItem.name, signature].filter(Boolean),
          chainId: chainConfig.chainId,
          metadata: { signature, selector, contractAddress: rootAddress },
          confidence: 0.95,
        });
        await upsertEdge(client, {
          srcEntityID: contractEntityID,
          dstEntityID: fnEntityID,
          relationType: 'HAS_FUNCTION',
          evidenceChunkID: chunkID,
          confidence: 0.95,
        });
        edgeCount += 1;
      } else if (abiItem.type === 'event') {
        const eventEntityID = await upsertEntity(client, {
          type: 'event',
          canonicalName: `${contractName}.${signature}`,
          aliases: [abiItem.name, signature].filter(Boolean),
          chainId: chainConfig.chainId,
          metadata: { signature, selector, contractAddress: rootAddress },
          confidence: 0.95,
        });
        await upsertEdge(client, {
          srcEntityID: contractEntityID,
          dstEntityID: eventEntityID,
          relationType: 'EMITS',
          evidenceChunkID: chunkID,
          confidence: 0.9,
        });
        edgeCount += 1;
      }
    }
  }

  await upsertFact(client, {
    subjectEntityID: contractEntityID,
    predicate: 'has_protocol_role',
    objectValue: role,
    confidence: 0.8,
    metadata: { inferredFrom: 'abi-and-name' },
  });
  factCount += 1;
  if (runtimeContext.proxyInfo?.isProxy) {
    await upsertFact(client, {
      subjectEntityID: contractEntityID,
      predicate: 'is_upgradeable_proxy',
      objectValue: runtimeContext.proxyInfo.proxyType,
      confidence: 0.98,
      metadata: { slots: runtimeContext.proxyInfo.slots },
    });
    factCount += 1;
  }
  for (const state of stateValues) {
    await upsertFact(client, {
      subjectEntityID: contractEntityID,
      predicate: `state.${state.name}`,
      objectValue: state.valueText,
      confidence: 0.9,
      metadata: { signature: state.signature },
    });
    factCount += 1;
  }

  return {
    address: rootAddress,
    role,
    chunks: chunkCount,
    edges: edgeCount,
    facts: factCount,
  };
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
  return tokens.map((token) => `${token}:*`).join(' | ');
}

export async function searchProtocolKnowledgeGraph(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const query = normalizeText(options.query);
  if (!query) {
    throw new Error('query is required');
  }
  const limit = Math.max(1, Math.min(Number(options.limit) || 12, 50));
  try {
    const client = await pool.connect();
    try {
      const ftsQuery = buildFTSQuery(query);
      const chunks = ftsQuery
        ? (await client.query(
          `SELECT chunks.id, chunks.chunk_type, chunks.text, chunks.heading_path,
                  chunks.modified_at, pages.internal_uri, pages.previous_internal_uri,
                  revisions.internal_uri AS revision_internal_uri,
                  entities.type AS entity_type, entities.canonical_name, entities.address,
                  ts_rank_cd(chunks.fts, to_tsquery('simple', $1)) AS score
           FROM chunks
           LEFT JOIN entities ON entities.id = chunks.entity_id
           LEFT JOIN knowledge_pages pages ON pages.id = chunks.page_id
           LEFT JOIN knowledge_page_revisions revisions ON revisions.id = chunks.page_revision_id
           WHERE chunks.fts @@ to_tsquery('simple', $1)
             AND chunks.is_current = true
           ORDER BY score DESC, chunks.modified_at DESC
           LIMIT $2`,
          [ftsQuery, limit],
        )).rows
        : [];
      const queryEmbeddingResult = await embedTexts([query], {
        ...options,
        embeddingInputType: 'query',
      })
        .catch(() => emptyEmbeddingResult([query]));
      const queryEmbedding = queryEmbeddingResult.embeddings[0];
      const queryEmbeddingDimensions = queryEmbedding
        ? normalizeVectorDimensions(queryEmbeddingResult.dimensions)
        : 0;
      const semanticChunks = queryEmbedding
        ? (await client.query(
          `SELECT chunks.id, chunks.chunk_type, chunks.text, chunks.heading_path,
                  chunks.modified_at, pages.internal_uri, pages.previous_internal_uri,
                  revisions.internal_uri AS revision_internal_uri,
                  entities.type AS entity_type, entities.canonical_name, entities.address,
                  chunk_embeddings.provider AS embedding_provider,
                  chunk_embeddings.model AS embedding_model,
                  chunk_embeddings.dimensions AS embedding_dimensions,
                  (1 - ((chunk_embeddings.embedding::vector(${queryEmbeddingDimensions})) <=> ($1::vector(${queryEmbeddingDimensions})))) AS score
           FROM chunks
           JOIN chunk_embeddings ON chunk_embeddings.chunk_id = chunks.id
           LEFT JOIN entities ON entities.id = chunks.entity_id
           LEFT JOIN knowledge_pages pages ON pages.id = chunks.page_id
           LEFT JOIN knowledge_page_revisions revisions ON revisions.id = chunks.page_revision_id
           WHERE chunks.is_current = true
             AND chunk_embeddings.provider = $3
             AND chunk_embeddings.model = $4
             AND chunk_embeddings.dimensions = $5
           ORDER BY (chunk_embeddings.embedding::vector(${queryEmbeddingDimensions})) <=> ($1::vector(${queryEmbeddingDimensions})), chunks.modified_at DESC
           LIMIT $2`,
          [
            vectorLiteral(queryEmbedding),
            limit,
            queryEmbeddingResult.provider,
            queryEmbeddingResult.model,
            queryEmbeddingResult.dimensions,
          ],
        )).rows
        : [];
      const entities = (await client.query(
        `SELECT id, type, canonical_name, aliases, chain_id, address, metadata
         FROM entities
         WHERE canonical_name ILIKE $1
            OR address ILIKE $1
            OR EXISTS (SELECT 1 FROM unnest(aliases) alias WHERE alias ILIKE $1)
         ORDER BY updated_at DESC
         LIMIT $2`,
        [`%${query}%`, limit],
      )).rows;
      const entityIDs = entities.map((item) => item.id);
      const edges = entityIDs.length > 0
        ? (await client.query(
          `SELECT edges.id, edges.relation_type, edges.confidence,
                  src.canonical_name AS src_name, src.type AS src_type,
                  dst.canonical_name AS dst_name, dst.type AS dst_type
           FROM edges
           JOIN entities src ON src.id = edges.src_entity_id
           JOIN entities dst ON dst.id = edges.dst_entity_id
           WHERE edges.src_entity_id = ANY($1::uuid[])
              OR edges.dst_entity_id = ANY($1::uuid[])
           ORDER BY edges.confidence DESC, edges.updated_at DESC
           LIMIT $2`,
          [entityIDs, limit * 2],
        )).rows
        : [];
      return { query, chunks, semanticChunks, entities, edges };
    } finally {
      client.release();
    }
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

export async function readKnowledgePageHistory(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const internalURI = normalizeText(options.internalURI || options.uri);
  const query = normalizeText(options.query || options.q);
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  if (!internalURI && !query) {
    throw new Error('internalURI or query is required');
  }
  try {
    const client = await pool.connect();
    try {
      const rows = internalURI
        ? (await client.query(
          `SELECT pages.internal_uri AS page_internal_uri,
                  pages.previous_internal_uri AS page_previous_internal_uri,
                  pages.modified_at AS page_modified_at,
                  revisions.revision_number,
                  revisions.internal_uri AS revision_internal_uri,
                  revisions.previous_internal_uri AS revision_previous_internal_uri,
                  revisions.superseded_by_internal_uri,
                  revisions.modified_at AS revision_modified_at,
                  revisions.valid_from,
                  revisions.valid_to,
                  revisions.is_current,
                  revisions.content_hash,
                  revisions.title
           FROM knowledge_pages pages
           JOIN knowledge_page_revisions revisions ON revisions.page_id = pages.id
           WHERE pages.internal_uri = $1
              OR revisions.internal_uri = $1
           ORDER BY revisions.revision_number DESC
           LIMIT $2`,
          [internalURI, limit],
        )).rows
        : (await client.query(
          `SELECT pages.internal_uri AS page_internal_uri,
                  pages.previous_internal_uri AS page_previous_internal_uri,
                  pages.modified_at AS page_modified_at,
                  revisions.revision_number,
                  revisions.internal_uri AS revision_internal_uri,
                  revisions.previous_internal_uri AS revision_previous_internal_uri,
                  revisions.superseded_by_internal_uri,
                  revisions.modified_at AS revision_modified_at,
                  revisions.valid_from,
                  revisions.valid_to,
                  revisions.is_current,
                  revisions.content_hash,
                  revisions.title
           FROM knowledge_pages pages
           JOIN knowledge_page_revisions revisions ON revisions.page_id = pages.id
           WHERE pages.title ILIKE $1
              OR pages.internal_uri ILIKE $1
              OR revisions.internal_uri ILIKE $1
           ORDER BY pages.modified_at DESC, revisions.revision_number DESC
           LIMIT $2`,
          [`%${query}%`, limit],
        )).rows;
      return { internalURI, query, revisions: rows };
    } finally {
      client.release();
    }
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

export async function backfillChunkEmbeddings(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const all = Boolean(options.all);
  const limit = all ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.min(Number(options.limit) || 100, 5000));
  const batchSize = Math.max(1, Math.min(Number(options.batchSize) || 8, 64));
  const chunkType = normalizeText(options.chunkType);
  const protocolSlug = normalizeText(options.protocolSlug || options.slug);
  const embeddingConfig = resolveEmbeddingConfig({
    ...options,
    embeddingProvider: options.embeddingProvider || options.provider,
    embeddingModel: options.embeddingModel || options.model,
  });
  if (embeddingConfig.provider === 'none') {
    throw new Error('embedding provider is required for backfill');
  }

  let processed = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  let dimensions = 0;
  const errors = [];

  try {
    while (processed < limit) {
      const remaining = limit - processed;
      const pageFilter = [];
      const params = [
        embeddingConfig.provider,
        embeddingConfig.model,
        Math.min(batchSize, remaining),
      ];
      if (chunkType) {
        params.push(chunkType);
        pageFilter.push(`chunks.chunk_type = $${params.length}`);
      }
      if (protocolSlug) {
        params.push(`kg://protocols/${protocolSlug}/%`);
        pageFilter.push(`pages.internal_uri LIKE $${params.length}`);
      }
      const whereExtra = pageFilter.length ? `AND ${pageFilter.join(' AND ')}` : '';
      const client = await pool.connect();
      let rows = [];
      try {
        const result = await client.query(
          `SELECT chunks.id, chunks.text, chunks.chunk_type, pages.internal_uri
           FROM chunks
           LEFT JOIN knowledge_pages pages ON pages.id = chunks.page_id
           WHERE chunks.is_current = true
             AND NOT EXISTS (
               SELECT 1
               FROM chunk_embeddings existing_embeddings
               WHERE existing_embeddings.chunk_id = chunks.id
                 AND existing_embeddings.provider = $1
                 AND existing_embeddings.model = $2
             )
             ${whereExtra}
           ORDER BY
             CASE chunks.chunk_type
               WHEN 'contract_summary' THEN 0
               WHEN 'abi_function' THEN 1
               WHEN 'abi_event' THEN 2
               WHEN 'solidity_function' THEN 3
               ELSE 4
             END,
             chunks.modified_at DESC,
             chunks.id
           LIMIT $3`,
          params,
        );
        rows = result.rows;
      } finally {
        client.release();
      }
      if (rows.length === 0) {
        break;
      }

      let embeddingResult;
      try {
        embeddingResult = await embedTexts(rows.map((row) => row.text), {
          ...options,
          embeddingProvider: embeddingConfig.provider,
          embeddingModel: embeddingConfig.model,
          embeddingInputType: 'document',
        });
      } catch (error) {
        failed += rows.length;
        errors.push(error?.message || String(error));
        processed += rows.length;
        options.onProgress?.({ processed, embedded, skipped, failed, dimensions, lastError: errors.at(-1) });
        continue;
      }

      const embeddingRows = rows.map((row, index) => ({
        ...row,
        embedding: embeddingResult.embeddings[index],
      }));
      const validRows = embeddingRows.filter((row) => Array.isArray(row.embedding) && row.embedding.length > 0);
      skipped += embeddingRows.length - validRows.length;
      dimensions = embeddingResult.dimensions || validRows[0]?.embedding?.length || dimensions;

      const writeClient = await pool.connect();
      try {
        await writeClient.query('BEGIN');
        const embeddingModelID = validRows.length > 0
          ? await upsertEmbeddingModel(writeClient, {
            ...embeddingResult,
            dimensions,
          })
          : null;
        for (const row of validRows) {
          await writeClient.query(
            `UPDATE chunks
             SET embedding = $2::vector,
                 embedding_model_id = $3,
                 embedding_provider = $4,
                 embedding_model = $5,
                 embedding_dimensions = $6,
                 updated_at = now()
             WHERE id = $1`,
            [
              row.id,
              vectorLiteral(row.embedding),
              embeddingModelID,
              embeddingResult.provider,
              embeddingResult.model,
              row.embedding.length,
            ],
          );
          await upsertChunkEmbedding(writeClient, {
            chunkID: row.id,
            embedding: row.embedding,
            embeddingModelID,
            provider: embeddingResult.provider,
            model: embeddingResult.model,
            dimensions: row.embedding.length,
            metadata: {
              source: 'backfill',
              chunkType: row.chunk_type,
              pageInternalURI: row.internal_uri,
            },
          });
          embedded += 1;
        }
        await writeClient.query('COMMIT');
      } catch (error) {
        await writeClient.query('ROLLBACK');
        failed += validRows.length;
        errors.push(error?.message || String(error));
      } finally {
        writeClient.release();
      }
      processed += rows.length;
      options.onProgress?.({ processed, embedded, skipped, failed, dimensions, remaining: Math.max(0, limit - processed) });
    }

    return {
      ok: failed === 0,
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
      dimensions,
      all,
      processed,
      embedded,
      skipped,
      failed,
      errors: errors.slice(-5),
    };
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

export async function createEmbeddingHNSWIndex(options = {}) {
  const pool = options.pool || createKGPool(options);
  const ownsPool = !options.pool;
  const provider = normalizeText(options.embeddingProvider || options.provider || process.env.KG_EMBEDDING_PROVIDER || 'ollama');
  const model = normalizeText(options.embeddingModel || options.model || process.env.KG_EMBEDDING_MODEL || DEFAULT_OLLAMA_EMBEDDING_MODEL);
  const dimensions = normalizeVectorDimensions(options.embeddingDimensions || options.dimensions || process.env.KG_EMBEDDING_DIM || 768);
  const indexName = sqlIdentifier(`idx_chunk_embeddings_${provider}_${model}_${dimensions}_hnsw`);
  const providerLiteral = sqlStringLiteral(provider);
  const modelLiteral = sqlStringLiteral(model);
  const m = Number(options.m || process.env.KG_HNSW_M || 16);
  const efConstruction = Number(options.efConstruction || process.env.KG_HNSW_EF_CONSTRUCTION || 64);
  try {
    const client = await pool.connect();
    try {
      const sql = `
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON chunk_embeddings
        USING hnsw ((embedding::vector(${dimensions})) vector_cosine_ops)
        WITH (m = ${m}, ef_construction = ${efConstruction})
        WHERE provider = ${providerLiteral}
          AND model = ${modelLiteral}
          AND dimensions = ${dimensions}
      `;
      await client.query(sql);
      return {
        ok: true,
        indexName: indexName.replace(/"/g, ''),
        provider,
        model,
        dimensions,
        m,
        efConstruction,
      };
    } finally {
      client.release();
    }
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}
