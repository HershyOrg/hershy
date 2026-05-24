import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringifyPrettyJSON(value) {
  return JSON.stringify(value, null, 2);
}

function parseJSON(rawText, label) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`failed to parse ${label}: ${error?.message || error}`);
  }
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function snapshotKey(snapshot = {}) {
  return [
    normalizeText(snapshot.connectionId || snapshot.exchangeId || snapshot.exchangeName || snapshot.exchange),
    normalizeText(snapshot.market || snapshot.accountType || 'spot'),
  ].join(':');
}

function sanitizeBalanceAssetForAI(asset = {}) {
  const symbol = normalizeText(asset.asset).toUpperCase();
  if (!symbol) return null;
  return {
    asset: symbol,
    available: normalizeText(asset.available || asset.free || asset.total || '0'),
    free: normalizeText(asset.free || asset.available || '0'),
    locked: normalizeText(asset.locked || '0'),
    total: normalizeText(asset.total || asset.marginBalance || asset.walletBalance || '0'),
    ...(Number.isFinite(asset.availableUsd) ? { availableUsd: asset.availableUsd } : {}),
    ...(Number.isFinite(asset.valueUsd) ? { valueUsd: asset.valueUsd } : {}),
  };
}

function sanitizeBalanceSnapshotForAI(snapshot = {}) {
  const assets = (Array.isArray(snapshot.assets) ? snapshot.assets : [])
    .map(sanitizeBalanceAssetForAI)
    .filter(Boolean)
    .sort((left, right) => toFiniteNumber(right.valueUsd || right.availableUsd) - toFiniteNumber(left.valueUsd || left.availableUsd))
    .slice(0, 20);
  return {
    id: normalizeText(snapshot.id),
    exchangeId: normalizeText(snapshot.exchangeId || snapshot.connectionId),
    connectionId: normalizeText(snapshot.connectionId || snapshot.exchangeId),
    exchangeName: normalizeText(snapshot.exchangeName || snapshot.exchange),
    market: normalizeText(snapshot.market),
    accountType: normalizeText(snapshot.accountType),
    updatedAt: normalizeText(snapshot.updatedAt),
    source: normalizeText(snapshot.source),
    totals: normalizeObject(snapshot.totals) || {},
    spendable: normalizeObject(snapshot.spendable) || {},
    assets,
    policy: 'Read-only balance MyData. Never expose API secrets. Re-query server-side immediately before live execution.',
  };
}

export function createMyDataStore({ localStateDir, sanitizeUserContextID }) {
  const usersDir = path.join(localStateDir, 'users');

  function resolveUserMyDataDir(userId) {
    return path.join(usersDir, sanitizeUserContextID(userId), 'mydata');
  }

  function resolveBalancesPath(userId) {
    return path.join(resolveUserMyDataDir(userId), 'balances.json');
  }

  async function readBalanceSnapshots(userId) {
    const normalizedUserId = sanitizeUserContextID(userId);
    const filePath = resolveBalancesPath(normalizedUserId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = parseJSON(raw, 'balance MyData');
      return Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async function writeBalanceSnapshots(userId, snapshots) {
    const normalizedUserId = sanitizeUserContextID(userId);
    const filePath = resolveBalancesPath(normalizedUserId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `${stringifyPrettyJSON({
        userId: normalizedUserId,
        updatedAt: new Date().toISOString(),
        snapshots: Array.isArray(snapshots) ? snapshots : [],
      })}\n`,
      'utf8',
    );
  }

  async function upsertBalanceSnapshot(userId, snapshot) {
    const normalizedUserId = sanitizeUserContextID(userId);
    const current = await readBalanceSnapshots(normalizedUserId);
    const key = snapshotKey(snapshot);
    const next = [
      ...current.filter((item) => snapshotKey(item) !== key),
      snapshot,
    ].sort((left, right) => normalizeText(right.updatedAt).localeCompare(normalizeText(left.updatedAt)));
    await writeBalanceSnapshots(normalizedUserId, next);
    return {
      userId: normalizedUserId,
      snapshot,
      snapshots: next,
    };
  }

  function buildBalanceMyDataForAI(snapshots) {
    return (Array.isArray(snapshots) ? snapshots : [])
      .map(sanitizeBalanceSnapshotForAI)
      .filter((snapshot) => snapshot.connectionId || snapshot.exchangeId)
      .slice(0, 8);
  }

  return {
    buildBalanceMyDataForAI,
    readBalanceSnapshots,
    upsertBalanceSnapshot,
  };
}
