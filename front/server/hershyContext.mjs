import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_HERSHY_CONTEXT_FILES,
  EXCHANGE_WEBSOCKET_RAG_FILES,
  EXCHANGE_WEBSOCKET_RAG_INDEX_FILE,
} from './dataStructures.mjs';
import {
  getAIBooleanEnv,
  getPositiveIntegerEnv,
  normalizeText,
} from './env.mjs';

const hershyContextCachePromises = new Map();

function trimForContext(text, limit) {
  const value = String(text ?? '');
  if (!Number.isFinite(limit) || limit <= 0 || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 32))}\n...(truncated ${value.length - limit} chars)`;
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

export function resolveHershyContextFileList(prompt = '') {
  const envList = normalizeText(process.env.AI_STRATEGY_HERSHY_CONTEXT_FILES);
  const candidates = envList
    ? envList.split(',').map((item) => normalizeText(item)).filter(Boolean)
    : DEFAULT_HERSHY_CONTEXT_FILES;

  return Array.from(new Set([
    ...resolveExchangeWebsocketRagFiles(prompt),
    ...candidates,
  ]));
}

export async function loadHershyLibraryContext(prompt = '', { repoRoot = process.cwd() } = {}) {
  if (!getAIBooleanEnv('AI_STRATEGY_ENABLE_HERSHY_CONTEXT', true)) {
    return '';
  }

  const files = resolveHershyContextFileList(prompt);
  const fileLimit = getPositiveIntegerEnv('AI_STRATEGY_HERSHY_CONTEXT_FILE_CHARS', 8000);
  const totalLimit = getPositiveIntegerEnv('AI_STRATEGY_HERSHY_CONTEXT_TOTAL_CHARS', 42000);
  const cacheKey = JSON.stringify({ repoRoot, files, fileLimit, totalLimit });

  if (!hershyContextCachePromises.has(cacheKey)) {
    hershyContextCachePromises.set(cacheKey, (async () => {
      const chunks = [];
      for (const relPath of files) {
        const absPath = path.resolve(repoRoot, relPath);
        try {
          const content = await fs.readFile(absPath, 'utf8');
          if (!normalizeText(content)) {
            continue;
          }
          chunks.push(`--- ${relPath} ---\n${trimForContext(content, fileLimit)}`);
        } catch {
          // Missing optional context files are ignored.
        }
      }
      return trimForContext(chunks.join('\n\n'), totalLimit);
    })());
  }

  return hershyContextCachePromises.get(cacheKey);
}
