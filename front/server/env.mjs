import fsSync from 'node:fs';

export function resolvePort(raw, fallback) {
  const parsed = Number.parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeBaseURL(raw) {
  const value = String(raw || '').trim();
  return value.replace(/\/+$/, '') || 'http://localhost:9000';
}

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripEnvQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadServerEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }
  const content = fsSync.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = stripEnvQuotes(rawValue);
  }
}

export function loadServerEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      loadServerEnvFile(filePath);
    } catch (error) {
      console.warn(`[front] failed to load env file ${filePath}: ${error?.message || error}`);
    }
  }
}

export function getAIBooleanEnv(key, fallback = false) {
  const raw = normalizeText(process.env[key]).toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y' || raw === 'on';
}

export function getPositiveIntegerEnv(key, fallback) {
  const parsed = Number.parseInt(process.env[key] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
