import { createClient } from 'redis';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTEXT_DIR = path.resolve(__dirname, 'contexts');
const USER_CONTEXT_PREFIX = 'user_context:';
const DEFAULT_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const memoryContextStore = new Map();

if (!fsSync.existsSync(CONTEXT_DIR)) {
  fsSync.mkdirSync(CONTEXT_DIR, { recursive: true });
}

let redisClient = null;
let redisConnectPromise = null;
let redisMode = 'pending';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function trimText(value, limit = 240) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 16))}...(truncated)`;
}

export function sanitizeUserContextID(rawValue) {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return normalized || 'anonymous';
}

function summarizeConnectedExchange(connection = {}) {
  const id = normalizeText(connection.id || connection.exchange || connection.name) || 'unknown';
  const name = normalizeText(connection.name || connection.exchange || connection.id) || id;
  const status = normalizeText(connection.status) || 'unknown';
  const type = normalizeText(connection.type) || 'unknown';
  return {
    id,
    name,
    status,
    type,
    credentials: {
      apiKey: Boolean(connection.apiKeyEncrypted || connection.credentials?.hasApiKey),
      apiSecret: Boolean(connection.apiSecretEncrypted || connection.credentials?.hasApiSecret),
      apiPassphrase: Boolean(connection.apiPassphraseEncrypted || connection.credentials?.hasApiPassphrase),
      privateKey: Boolean(connection.privateKeyEncrypted || connection.credentials?.hasPrivateKey),
      funder: Boolean(connection.credentials?.hasFunder || normalizeText(connection.credentials?.funder)),
      authStatus: normalizeText(connection.credentials?.authStatus) || '미검증',
    },
  };
}

function summarizeBalanceAsset(asset = {}) {
  const symbol = normalizeText(asset.asset).toUpperCase();
  if (!symbol) return null;
  const available = normalizeText(asset.available || asset.free || asset.total || '0');
  const total = normalizeText(asset.total || asset.marginBalance || asset.walletBalance || available);
  const availableUsd = Number(asset.availableUsd);
  const valueUsd = Number(asset.valueUsd);
  return {
    asset: symbol,
    available,
    total,
    ...(Number.isFinite(availableUsd) ? { availableUsd } : {}),
    ...(Number.isFinite(valueUsd) ? { valueUsd } : {}),
  };
}

function summarizeBalanceSnapshot(snapshot = {}) {
  const spendable = normalizeObject(snapshot.spendable) || {};
  const totals = normalizeObject(snapshot.totals) || {};
  const assets = (Array.isArray(snapshot.assets) ? snapshot.assets : [])
    .map(summarizeBalanceAsset)
    .filter(Boolean)
    .slice(0, 16);
  return {
    id: normalizeText(snapshot.id),
    exchangeId: normalizeText(snapshot.exchangeId || snapshot.connectionId),
    connectionId: normalizeText(snapshot.connectionId || snapshot.exchangeId),
    exchangeName: normalizeText(snapshot.exchangeName || snapshot.exchange),
    market: normalizeText(snapshot.market),
    accountType: normalizeText(snapshot.accountType),
    updatedAt: normalizeText(snapshot.updatedAt),
    totals,
    spendable,
    assets,
  };
}

function buildContextMarkdown({
  userId,
  prompt = '',
  requestPath = '',
  requestCount = 1,
  storageBackend = 'memory',
  connectedExchanges = [],
  balanceSnapshots = [],
  updatedAt = new Date().toISOString(),
}) {
  const lines = [
    `# Hershy User Context`,
    '',
    `- user_id: ${userId}`,
    `- updated_at: ${updatedAt}`,
    `- request_path: ${normalizeText(requestPath) || 'unknown'}`,
    `- request_count: ${requestCount}`,
    `- storage_backend: ${storageBackend}`,
    '',
    '## Mandatory Exchange Verification',
    'Before generating executable strategy actions, verify the connected exchanges listed below.',
    'Only use config.exchange or config.connectionId values that exactly match the verified exchanges in this file.',
    'If no exchange is connected, do not generate an executable trading strategy.',
    '',
    '## Connected Exchanges',
  ];

  if (connectedExchanges.length === 0) {
    lines.push('- none');
  } else {
    connectedExchanges.forEach((exchange) => {
      lines.push(`- id=${exchange.id} | name=${exchange.name} | status=${exchange.status} | type=${exchange.type}`);
      lines.push(
        `  credentials: apiKey=${exchange.credentials.apiKey}, apiSecret=${exchange.credentials.apiSecret}, apiPassphrase=${exchange.credentials.apiPassphrase}, privateKey=${exchange.credentials.privateKey}, funder=${exchange.credentials.funder}, authStatus=${exchange.credentials.authStatus}`,
      );
    });
  }

  lines.push('');
  lines.push('## CEX Balance MyData');
  if (balanceSnapshots.length === 0) {
    lines.push('- none');
  } else {
    balanceSnapshots.forEach((snapshot) => {
      lines.push(
        `- exchange=${snapshot.exchangeName || snapshot.exchangeId} | connectionId=${snapshot.connectionId} | market=${snapshot.market || snapshot.accountType} | updated_at=${snapshot.updatedAt || 'unknown'}`,
      );
      lines.push(
        `  spendable: preferredAsset=${normalizeText(snapshot.spendable?.preferredAsset) || 'none'}, preferredAvailable=${normalizeText(snapshot.spendable?.preferredAvailable) || '0'}, stableAvailableUsd=${snapshot.spendable?.totalStableAvailableUsd ?? snapshot.totals?.stableAvailableUsd ?? 0}`,
      );
      const assets = Array.isArray(snapshot.assets) ? snapshot.assets.slice(0, 8) : [];
      if (assets.length === 0) {
        lines.push('  assets: none');
      } else {
        lines.push(
          `  assets: ${assets.map((asset) => `${asset.asset} available=${asset.available} total=${asset.total}`).join('; ')}`,
        );
      }
    });
  }

  if (prompt) {
    lines.push('');
    lines.push('## Latest Prompt Preview');
    lines.push(trimText(prompt, 400));
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('- This file is generated per user session for AI prompt bootstrapping.');
  lines.push('- Exchange connectivity must be re-checked from the latest connected exchange list before execution.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function connectRedis() {
  if (redisMode === 'memory') {
    return null;
  }
  if (redisClient?.isOpen) {
    redisMode = 'redis';
    return redisClient;
  }
  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      let client = null;
      try {
        client = createClient({
          url: DEFAULT_REDIS_URL,
          socket: {
            connectTimeout: 1000,
            reconnectStrategy: false,
          },
        });
        client.on('error', (error) => {
          console.error('[contextManager] Redis client error:', error);
        });
        await client.connect();
        redisClient = client;
        redisMode = 'redis';
        console.log('[contextManager] Connected to Redis.');
        return redisClient;
      } catch (error) {
        if (client) {
          try {
            client.destroy();
          } catch {
            // Ignore cleanup errors.
          }
        }
        redisClient = null;
        redisMode = 'memory';
        console.warn(`[contextManager] Redis unavailable, falling back to memory store: ${error?.message || 'unknown error'}`);
        return null;
      } finally {
        redisConnectPromise = null;
      }
    })();
  }
  return redisConnectPromise;
}

export async function initRedis() {
  return connectRedis();
}

async function writeContextValue(userId, value) {
  const client = await connectRedis();
  const key = `${USER_CONTEXT_PREFIX}${userId}`;
  if (client) {
    try {
      await client.set(key, JSON.stringify(value));
      return 'redis';
    } catch (error) {
      console.warn(`[contextManager] Redis set failed, using memory store instead: ${error?.message || 'unknown error'}`);
      redisMode = 'memory';
      redisClient = null;
    }
  }

  memoryContextStore.set(key, JSON.stringify(value));
  return 'memory';
}

async function readContextValue(userId) {
  const key = `${USER_CONTEXT_PREFIX}${userId}`;
  const client = await connectRedis();
  if (client) {
    try {
      return await client.get(key);
    } catch (error) {
      console.warn(`[contextManager] Redis get failed, reading memory store instead: ${error?.message || 'unknown error'}`);
      redisMode = 'memory';
      redisClient = null;
    }
  }
  return memoryContextStore.get(key) || null;
}

export async function saveUserContext(userId, contextData) {
  const normalizedUserId = sanitizeUserContextID(userId);
  const backend = await writeContextValue(normalizedUserId, contextData);
  return { backend, userId: normalizedUserId };
}

export async function getUserContext(userId) {
  const normalizedUserId = sanitizeUserContextID(userId);
  const data = await readContextValue(normalizedUserId);
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getUserContextMarkdownPath(userId) {
  return path.join(CONTEXT_DIR, `${sanitizeUserContextID(userId)}_exchange_context.md`);
}

export async function readUserContextMarkdown(userId) {
  const filePath = getUserContextMarkdownPath(userId);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { filePath, content };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { filePath, content: '' };
    }
    throw error;
  }
}

export async function initUserSession({
  userId,
  exchangeConnections = [],
  balanceSnapshots = [],
  prompt = '',
  requestPath = '',
  source = '',
}) {
  const normalizedUserId = sanitizeUserContextID(userId);
  const previousContext = await getUserContext(normalizedUserId);
  const updatedAt = new Date().toISOString();
  const connectedExchanges = (Array.isArray(exchangeConnections) ? exchangeConnections : [])
    .map((connection) => summarizeConnectedExchange(connection))
    .filter((exchange, index, items) => items.findIndex((item) => item.id === exchange.id) === index);
  const balanceMyData = (Array.isArray(balanceSnapshots) ? balanceSnapshots : [])
    .map(summarizeBalanceSnapshot)
    .filter((snapshot) => snapshot.connectionId || snapshot.exchangeId)
    .slice(0, 8);

  const contextRecord = {
    userId: normalizedUserId,
    source: normalizeText(source) || normalizeText(previousContext?.source) || 'unknown',
    initializedAt: normalizeText(previousContext?.initializedAt) || updatedAt,
    updatedAt,
    requestPath: normalizeText(requestPath) || normalizeText(previousContext?.requestPath),
    requestCount: Number(previousContext?.requestCount || 0) + 1,
    promptPreview: trimText(prompt, 400),
    hasConnectedExchanges: connectedExchanges.length > 0,
    connectedExchangeCount: connectedExchanges.length,
    connectedExchanges,
    hasBalanceMyData: balanceMyData.length > 0,
    balanceSnapshotCount: balanceMyData.length,
    balanceMyData,
  };

  const markdownPath = getUserContextMarkdownPath(normalizedUserId);
  let storageBackend = normalizeText(previousContext?.storageBackend) || 'memory';
  let markdownContent = buildContextMarkdown({
    userId: normalizedUserId,
    prompt,
    requestPath,
    requestCount: contextRecord.requestCount,
    storageBackend,
    connectedExchanges,
    balanceSnapshots: balanceMyData,
    updatedAt,
  });

  await fs.writeFile(markdownPath, markdownContent, 'utf8');
  const saveResult = await saveUserContext(normalizedUserId, {
    ...contextRecord,
    markdownPath,
    storageBackend,
  });
  storageBackend = saveResult.backend;

  markdownContent = buildContextMarkdown({
    userId: normalizedUserId,
    prompt,
    requestPath,
    requestCount: contextRecord.requestCount,
    storageBackend,
    connectedExchanges,
    balanceSnapshots: balanceMyData,
    updatedAt,
  });
  await fs.writeFile(markdownPath, markdownContent, 'utf8');

  const finalRecord = {
    ...contextRecord,
    markdownPath,
    storageBackend,
  };

  await saveUserContext(normalizedUserId, finalRecord);

  return {
    userId: normalizedUserId,
    markdownPath,
    markdownContent,
    record: finalRecord,
  };
}
