import * as crypto from 'node:crypto';
import { initUserSession, sanitizeUserContextID } from '../contextManager.mjs';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringifyPrettyJSON(value) {
  return JSON.stringify(value, null, 2);
}

function trimForLog(text, limit) {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  if (!Number.isFinite(limit) || limit <= 0 || normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}\n...[truncated]`;
}

export function buildAnonymousUserID(req) {
  const seed = [
    normalizeText(req?.ip),
    normalizeText(req?.headers?.['x-forwarded-for']),
    normalizeText(req?.headers?.['user-agent']),
  ]
    .filter(Boolean)
    .join('|') || 'anonymous';
  const digest = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
  return `anon-${digest}`;
}

export function resolveRequestUserID(req) {
  const raw = normalizeText(
    req?.body?.user_id
      || req?.body?.userId
      || req?.headers?.['x-hershy-user-id']
      || req?.query?.user_id
      || req?.query?.userId,
  );
  return sanitizeUserContextID(raw || buildAnonymousUserID(req));
}

export async function prepareStrategyUserContext({
  req,
  connectedExchangeConnections,
  balanceSnapshots,
  source,
}) {
  const userId = resolveRequestUserID(req);
  return initUserSession({
    userId,
    exchangeConnections: Array.isArray(connectedExchangeConnections) ? connectedExchangeConnections : [],
    balanceSnapshots: Array.isArray(balanceSnapshots) ? balanceSnapshots : [],
    prompt: normalizeText(req?.body?.prompt),
    requestPath: normalizeText(req?.path),
    source: normalizeText(source) || 'strategy-ai',
  });
}

export function buildUserContextPromptSection(userContext) {
  const markdown = normalizeText(userContext?.markdownContent);
  if (!markdown) {
    return '';
  }
  const metadata = normalizeObject(userContext?.record);
  let text = `User-specific session context (generated from local session files, verify exchanges first):\n${trimForLog(markdown, 14000)}`;
  if (metadata) {
    text += `\n\nUser session metadata:\n${trimForLog(
      stringifyPrettyJSON({
        userId: normalizeText(metadata.userId),
        requestCount: metadata.requestCount,
        hasConnectedExchanges: metadata.hasConnectedExchanges,
        connectedExchangeCount: metadata.connectedExchangeCount,
        hasBalanceMyData: metadata.hasBalanceMyData,
        balanceSnapshotCount: metadata.balanceSnapshotCount,
        storageBackend: normalizeText(metadata.storageBackend),
        markdownPath: normalizeText(metadata.markdownPath),
      }),
      4000,
    )}`;
  }
  return text;
}
