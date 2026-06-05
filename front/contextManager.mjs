import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTEXT_DIR = path.resolve(__dirname, '.local', 'contexts');
const memoryContextStore = new Map();

if (!fsSync.existsSync(CONTEXT_DIR)) {
  fsSync.mkdirSync(CONTEXT_DIR, { recursive: true });
}

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

export function getUserContextRecordPath(userId) {
  return path.join(CONTEXT_DIR, `${sanitizeUserContextID(userId)}_exchange_context.json`);
}

export async function saveUserContext(userId, contextData) {
  const normalizedUserId = sanitizeUserContextID(userId);
  const recordPath = getUserContextRecordPath(normalizedUserId);
  const record = {
    ...normalizeObject(contextData),
    userId: normalizedUserId,
    recordPath,
    storageBackend: 'file',
  };
  memoryContextStore.set(normalizedUserId, record);
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { backend: 'file', userId: normalizedUserId, recordPath };
}

export async function getUserContext(userId) {
  const normalizedUserId = sanitizeUserContextID(userId);
  const cached = memoryContextStore.get(normalizedUserId);
  if (cached) return cached;

  const recordPath = getUserContextRecordPath(normalizedUserId);
  try {
    const data = await fs.readFile(recordPath, 'utf8');
    const parsed = normalizeObject(JSON.parse(data));
    if (!parsed) return null;
    memoryContextStore.set(normalizedUserId, parsed);
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
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
  let storageBackend = 'file';
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
