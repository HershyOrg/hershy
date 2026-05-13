import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function firstDefined(env, names) {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function parseBoolean(raw, fallback) {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`invalid boolean value: ${raw}`);
}

function parseInteger(name, raw, fallback, { min, max } = {}) {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer: ${raw}`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`${name} must be >= ${min}: ${raw}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be <= ${max}: ${raw}`);
  }

  return parsed;
}

function normalizeWsUrl(name, raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  if (!/^wss?:\/\//i.test(value)) {
    throw new Error(`${name} must start with ws:// or wss://`);
  }
  return value.replace(/\/+$/, '');
}

function normalizeHttpUrl(name, raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${name} must start with http:// or https://`);
  }
  return value.replace(/\/+$/, '');
}

function parseJsonObject(name, raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }

  return parsed;
}

function parseWsServerRegistryFromJson(rawRegistry, defaults) {
  const registry = {};

  for (const [serverId, spec] of Object.entries(rawRegistry)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error(`ACP_WS_SERVER_REGISTRY_JSON.${serverId} must be an object`);
    }

    const mode = String(spec.mode || '').trim().toLowerCase();
    if (!['persistent', 'session'].includes(mode)) {
      throw new Error(
        `ACP_WS_SERVER_REGISTRY_JSON.${serverId}.mode must be 'persistent' or 'session'`
      );
    }

    const wsUrl = normalizeWsUrl(
      `ACP_WS_SERVER_REGISTRY_JSON.${serverId}.ws_url`,
      spec.ws_url
    );

    let defaultTtlSec = 0;
    let maxTtlSec = 0;
    if (mode === 'session') {
      defaultTtlSec = parseInteger(
        `ACP_WS_SERVER_REGISTRY_JSON.${serverId}.default_ttl_sec`,
        spec.default_ttl_sec,
        defaults.sessionDefaultTtlSec,
        { min: 30, max: 604800 }
      );
      maxTtlSec = parseInteger(
        `ACP_WS_SERVER_REGISTRY_JSON.${serverId}.max_ttl_sec`,
        spec.max_ttl_sec,
        defaults.sessionMaxTtlSec,
        { min: 30, max: 604800 }
      );
      if (defaultTtlSec > maxTtlSec) {
        throw new Error(
          `ACP_WS_SERVER_REGISTRY_JSON.${serverId}: default_ttl_sec must be <= max_ttl_sec`
        );
      }
    }

    registry[serverId] = {
      id: serverId,
      mode,
      ws_url: wsUrl,
      default_ttl_sec: defaultTtlSec,
      max_ttl_sec: maxTtlSec
    };
  }

  return registry;
}

function buildDefaultWsServerRegistry(env, defaults) {
  const registry = {};

  const persistentWsUrl = firstDefined(env, ['ACP_PERSISTENT_WS_URL']);
  if (persistentWsUrl) {
    registry['persistent-default'] = {
      id: 'persistent-default',
      mode: 'persistent',
      ws_url: normalizeWsUrl('ACP_PERSISTENT_WS_URL', persistentWsUrl),
      default_ttl_sec: 0,
      max_ttl_sec: 0
    };
  }

  const sessionWsUrl = firstDefined(env, ['ACP_SESSION_WS_URL']);
  if (sessionWsUrl) {
    registry['session-default'] = {
      id: 'session-default',
      mode: 'session',
      ws_url: normalizeWsUrl('ACP_SESSION_WS_URL', sessionWsUrl),
      default_ttl_sec: defaults.sessionDefaultTtlSec,
      max_ttl_sec: defaults.sessionMaxTtlSec
    };
  }

  return registry;
}

function parseWsServerRegistry(env, defaults) {
  const rawJson = firstDefined(env, ['ACP_WS_SERVER_REGISTRY_JSON']);
  if (rawJson) {
    const parsed = parseJsonObject('ACP_WS_SERVER_REGISTRY_JSON', rawJson);
    return parseWsServerRegistryFromJson(parsed, defaults);
  }

  return buildDefaultWsServerRegistry(env, defaults);
}

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  const walletPrivateKey = firstDefined(env, [
    'WHITELISTED_WALLET_PRIVATE_KEY',
    'ACP_WALLET_PRIVATE_KEY'
  ]);
  if (!walletPrivateKey) {
    throw new Error('missing WHITELISTED_WALLET_PRIVATE_KEY (or ACP_WALLET_PRIVATE_KEY)');
  }

  const sellerAgentWalletAddress = firstDefined(env, [
    'SELLER_AGENT_WALLET_ADDRESS',
    'ACP_AGENT_WALLET_ADDRESS'
  ]);
  if (!sellerAgentWalletAddress) {
    throw new Error('missing SELLER_AGENT_WALLET_ADDRESS (or ACP_AGENT_WALLET_ADDRESS)');
  }

  const sessionEntityKeyRaw = firstDefined(env, [
    'ACP_SESSION_ENTITY_KEY_ID',
    'SELLER_ENTITY_ID'
  ]);
  if (!sessionEntityKeyRaw) {
    throw new Error('missing ACP_SESSION_ENTITY_KEY_ID (or SELLER_ENTITY_ID)');
  }

  const sessionEntityKeyId = parseInteger(
    'ACP_SESSION_ENTITY_KEY_ID',
    sessionEntityKeyRaw,
    undefined,
    { min: 1 }
  );

  const hostUrl = trimTrailingSlash(
    firstDefined(env, ['HERSHY_HOST_URL']) || 'http://localhost:9000'
  );

  const accessSessionDefaultTtlSec = parseInteger(
    'ACP_ACCESS_SESSION_DEFAULT_TTL_SEC',
    env.ACP_ACCESS_SESSION_DEFAULT_TTL_SEC,
    900,
    { min: 30, max: 604800 }
  );
  const accessSessionMaxTtlSec = parseInteger(
    'ACP_ACCESS_SESSION_MAX_TTL_SEC',
    env.ACP_ACCESS_SESSION_MAX_TTL_SEC,
    3600,
    { min: 30, max: 604800 }
  );
  if (accessSessionDefaultTtlSec > accessSessionMaxTtlSec) {
    throw new Error(
      'ACP_ACCESS_SESSION_DEFAULT_TTL_SEC must be <= ACP_ACCESS_SESSION_MAX_TTL_SEC'
    );
  }

  const wsServerRegistry = parseWsServerRegistry(env, {
    sessionDefaultTtlSec: accessSessionDefaultTtlSec,
    sessionMaxTtlSec: accessSessionMaxTtlSec
  });
  if (Object.keys(wsServerRegistry).length === 0) {
    throw new Error(
      'no WS server registry configured: set ACP_WS_SERVER_REGISTRY_JSON or ACP_PERSISTENT_WS_URL/ACP_SESSION_WS_URL'
    );
  }

  const accessGatewayEnabled = parseBoolean(env.ACP_ACCESS_GATEWAY_ENABLE, false);
  const accessGatewayWsPublicUrlRaw = firstDefined(env, ['ACP_ACCESS_GATEWAY_WS_URL']);
  const accessGatewayHttpPublicUrlRaw = firstDefined(env, ['ACP_ACCESS_GATEWAY_HTTP_URL']);

  let accessGatewayWsPublicUrl = '';
  if (accessGatewayWsPublicUrlRaw) {
    accessGatewayWsPublicUrl = normalizeWsUrl(
      'ACP_ACCESS_GATEWAY_WS_URL',
      accessGatewayWsPublicUrlRaw
    );
  }

  let accessGatewayHttpPublicUrl = '';
  if (accessGatewayHttpPublicUrlRaw) {
    accessGatewayHttpPublicUrl = normalizeHttpUrl(
      'ACP_ACCESS_GATEWAY_HTTP_URL',
      accessGatewayHttpPublicUrlRaw
    );
  }

  const accessTokenSigningKey = firstDefined(env, ['ACP_ACCESS_TOKEN_SIGNING_KEY']);
  const resourceServerPort = parseInteger('ACP_RESOURCE_PORT', env.ACP_RESOURCE_PORT, 0, {
    min: 0,
    max: 65535
  });

  if (accessGatewayEnabled) {
    if (resourceServerPort <= 0) {
      throw new Error('ACP_ACCESS_GATEWAY_ENABLE requires ACP_RESOURCE_PORT > 0');
    }
    if (!accessTokenSigningKey) {
      throw new Error('ACP_ACCESS_GATEWAY_ENABLE requires ACP_ACCESS_TOKEN_SIGNING_KEY');
    }
    if (!accessGatewayWsPublicUrl) {
      throw new Error('ACP_ACCESS_GATEWAY_ENABLE requires ACP_ACCESS_GATEWAY_WS_URL');
    }
  }

  return {
    walletPrivateKey,
    sellerAgentWalletAddress,
    sessionEntityKeyId,
    acpNetwork: firstDefined(env, ['ACP_NETWORK']) || 'base-sepolia',
    skipSocketConnection: parseBoolean(env.ACP_SKIP_SOCKET_CONNECTION, false),
    hostUrl,
    hostApiToken: firstDefined(env, ['HERSHY_HOST_API_TOKEN', 'ACP_HOST_API_TOKEN']),
    wsServerRegistry,
    accessSessionDefaultTtlSec,
    accessSessionMaxTtlSec,
    accessGatewayEnabled,
    accessGatewayWsPublicUrl,
    accessGatewayHttpPublicUrl,
    accessTokenSigningKey,
    accessTokenIssuer: firstDefined(env, ['ACP_ACCESS_TOKEN_ISSUER']) || 'hershy-acp-seller',
    defaultTemplate: firstDefined(env, ['ACP_DEFAULT_TEMPLATE']) || 'simple-counter',
    autoStartDefault: parseBoolean(env.ACP_AUTO_START_DEFAULT, true),
    waitReadyDefault: parseBoolean(env.ACP_WAIT_READY_DEFAULT, true),
    readyTimeoutSecDefault: parseInteger(
      'ACP_READY_TIMEOUT_SEC_DEFAULT',
      env.ACP_READY_TIMEOUT_SEC_DEFAULT,
      300,
      { min: 10, max: 3600 }
    ),
    hostPollIntervalMs: parseInteger(
      'ACP_HOST_POLL_INTERVAL_MS',
      env.ACP_HOST_POLL_INTERVAL_MS,
      2500,
      { min: 500, max: 60000 }
    ),
    allowCustomSource: parseBoolean(env.ACP_ALLOW_CUSTOM_SOURCE, false),
    resourceServerPort,
    templateBaseDir: resolve(
      firstDefined(env, ['HERSHY_TEMPLATE_BASE_DIR']) || REPO_ROOT
    )
  };
}
