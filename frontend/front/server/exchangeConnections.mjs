import * as crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeDelimitedStringArray(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)));
  }
  const text = normalizeText(value);
  if (!text) {
    return [];
  }
  return Array.from(new Set(text.split(/[,\n]/).map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeExchangeType(value) {
  const type = normalizeText(value).toUpperCase();
  return type === 'DEX' || type === 'RPC' ? type : 'CEX';
}

function normalizeEndpointURL(value, label, { strict = false } = {}) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
    return text;
  } catch {
    if (strict) {
      throw new Error(`${label} must be a valid URL starting with http://, https://, ws://, or wss://`);
    }
    return '';
  }
}

function normalizeCredentialText(value) {
  return String(value ?? '').trim();
}

function normalizeConnectionStatus(value, hasExecutionEndpoint, { autoConnectOnEndpoint = false } = {}) {
  const status = normalizeText(value);
  if (hasExecutionEndpoint && (autoConnectOnEndpoint || status === '연결됨' || status.toLowerCase() === 'connected')) {
    return '연결됨';
  }
  if (status === '대기' || status.toLowerCase() === 'pending') return '대기';
  return hasExecutionEndpoint && autoConnectOnEndpoint ? '연결됨' : '대기';
}

function parseJSON(rawText, label) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`failed to parse ${label}: ${error?.message || error}`);
  }
}

function stringifyPrettyJSON(value) {
  return JSON.stringify(value, null, 2);
}

function slugifyForPath(value, fallback = 'exchange') {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function redactURLForAI(rawURL) {
  const text = normalizeText(rawURL);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'configured';
  }
}

function normalizeCapabilityExchangeID(connection = {}) {
  const id = normalizeText(connection.id || connection.exchange || connection.name).toLowerCase();
  const name = normalizeText(connection.name || connection.exchange || connection.id).toLowerCase();
  const value = id || name;
  if (value.includes('binance')) return 'binance';
  if (value.includes('bybit')) return 'bybit';
  if (value.includes('okx')) return 'okx';
  if (value.includes('gate')) return 'gateio';
  if (value.includes('polymarket')) return 'polymarket';
  return value;
}

function buildCEXSpotOrderCapability(exchangeID) {
  return {
    id: 'cex.spot.order',
    description: 'Submit a signed spot order through the Hershy live runner.',
    runtimeAction: {
      blockType: 'action',
      config: {
        actionType: 'cex',
      },
    },
    supportedOrderTypes: ['MARKET', 'LIMIT'],
    supportedSides: ['BUY', 'SELL'],
    requiredFields: ['exchange', 'symbol', 'side', 'orderType'],
    runnerParameterNames: ['symbol', 'side', 'type', 'quantity', 'quoteOrderQty', 'price'],
    uiAliases: {
      orderType: 'runner parameter type',
      amount: 'runner parameter quantity or quoteOrderQty',
    },
    sizingFields: ['quantity', 'quoteOrderQty'],
    limitOrderRequiredFields: ['quantity', 'price'],
    marketOrderRequiredFields: ['quantity or quoteOrderQty'],
    optionalFields: [
      'timeInForce',
      'recvWindow',
      'newClientOrderId',
      'apiBaseUrl',
    ],
    outputFields: ['orderId', 'status', 'filledQty', 'avgFillPrice'],
    guardrails: [
      'Use only spot order fields supported by the runner.',
      'Do not generate futures/perpetual/margin orders unless the runner capability explicitly lists them.',
      'For follow-up sizing, use filledQty/avgFillPrice from action-result instead of requested quantity.',
    ],
    exchangeParameterNotes: {
      binance: 'MARKET accepts quantity or quoteOrderQty; LIMIT requires quantity and price.',
      bybit: 'MARKET maps quoteOrderQty to quoteCoin and quantity to baseCoin; LIMIT requires quantity and price.',
      okx: 'Uses cash tdMode for spot; MARKET maps quoteOrderQty to quote_ccy and quantity to base_ccy.',
      gateio: 'Uses spot account; MARKET buy can use quoteOrderQty, otherwise quantity.',
    }[exchangeID] || 'Spot order execution is available through the generic CEX runner adapter.',
  };
}

function buildPolymarketOrderCapability() {
  return {
    id: 'polymarket.clob.order',
    description: 'Submit a signed Polymarket CLOB order through the Hershy live runner.',
    runtimeAction: {
      blockType: 'action',
      config: {
        actionType: 'cex',
        exchange: 'Polymarket',
      },
    },
    supportedOrderTypes: ['GTC', 'FAK', 'FOK'],
    supportedSides: ['BUY', 'SELL'],
    requiredFields: ['exchange', 'tokenId', 'side', 'price', 'size'],
    runnerParameterNames: ['tokenId', 'side', 'price', 'size', 'orderType', 'postOnly', 'chainId'],
    optionalFields: ['orderType', 'postOnly', 'chainId', 'clobHost'],
    outputFields: ['orderId', 'status', 'token_id', 'price', 'size', 'side'],
    guardrails: [
      'Use outcome tokenId, not market slug, when creating executable orders.',
      'Price must be positive and normally between 0 and 1 for prediction market outcomes.',
      'Do not invent token IDs; require research or user-provided market data.',
    ],
  };
}

function buildMarketDataCapability(exchangeID) {
  const streamKinds = ['cex-market'];
  if (exchangeID === 'polymarket') streamKinds.push('polymarket-market');
  return {
    id: 'market.data',
    description: 'Read public market data for charting, triggers, and monitoring.',
    supportedStreamKinds: streamKinds,
    requiredFields: exchangeID === 'polymarket'
      ? ['tokenId for polymarket-market or symbol for cex-market']
      : ['exchange', 'symbol'],
    outputs: ['lastPrice', 'bid', 'ask', 'volume', 'timestamp'],
  };
}

function buildAccountReadCapability(connection = {}) {
  const exchangeID = normalizeCapabilityExchangeID(connection);
  if (exchangeID !== 'binance') return null;
  return {
    id: 'binance.account.read',
    description: 'Run a signed Binance account read/auth test on the server.',
    endpoint: 'GET /api/v3/account or /fapi/v2/account through server-side signed request',
    supportedMarkets: ['spot', 'futures-auth-test'],
    requiredCredentials: ['apiKey', 'apiSecret'],
    guardrails: [
      'This is currently exposed as a server-side auth/account check, not a generated trading action block.',
      'Do not send raw API credentials to the AI prompt or generated strategy JSON.',
    ],
  };
}

function buildExchangeCapabilitiesForAI(connection = {}) {
  const exchangeID = normalizeCapabilityExchangeID(connection);
  const credentials = {
    apiKey: Boolean(connection.apiKeyEncrypted),
    apiSecret: Boolean(connection.apiSecretEncrypted),
    apiPassphrase: Boolean(connection.apiPassphraseEncrypted),
    privateKey: Boolean(connection.privateKeyEncrypted),
    funder: Boolean(normalizeText(connection.credentials?.funder)),
  };
  const actions = [];
  if (['binance', 'bybit', 'okx', 'gateio'].includes(exchangeID)) {
    actions.push(buildCEXSpotOrderCapability(exchangeID));
  } else if (exchangeID === 'polymarket') {
    actions.push(buildPolymarketOrderCapability());
  }
  const accountRead = buildAccountReadCapability(connection);
  if (accountRead) actions.push(accountRead);
  const requiredCredentialsByAction = {};
  actions.forEach((action) => {
    if (action.id === 'cex.spot.order') {
      requiredCredentialsByAction[action.id] = exchangeID === 'okx'
        ? ['apiKey', 'apiSecret', 'apiPassphrase']
        : ['apiKey', 'apiSecret'];
    } else if (action.id === 'polymarket.clob.order') {
      requiredCredentialsByAction[action.id] = ['privateKey', 'funder'];
    } else if (action.id === 'binance.account.read') {
      requiredCredentialsByAction[action.id] = ['apiKey', 'apiSecret'];
    }
  });

  return {
    execution: {
      canCreateActionBlocks: actions.length > 0,
      supportedActionIds: actions.map((action) => action.id),
      requiredCredentialsByAction,
      availableCredentials: credentials,
    },
    actions,
    marketData: buildMarketDataCapability(exchangeID),
  };
}

export function createExchangeConnectionManager({
  localStateDir,
  defaultExchangeConnections,
  supportedExchangeConnectionIDs,
  sanitizeUserContextID,
}) {
  const userStateDir = path.join(localStateDir, 'users');
  const legacyExchangeConnectionsPath = path.join(localStateDir, 'exchange-connections.json');

  function getExchangeCredentialEncryptionKey() {
    const configured = normalizeCredentialText(process.env.EXCHANGE_SECRET_KEY);
    const source = configured || `hershy-local-exchange-key:${os.hostname()}:${os.userInfo().username}:${localStateDir}`;
    return crypto.createHash('sha256').update(source).digest();
  }

  function encryptExchangeCredential(value) {
    const text = normalizeCredentialText(value);
    if (!text) return '';

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getExchangeCredentialEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  function decryptExchangeCredential(value) {
    const text = normalizeCredentialText(value);
    if (!text) return '';
    const [version, ivText, authTagText, encryptedText] = text.split(':');
    if (version !== 'v1' || !ivText || !authTagText || !encryptedText) {
      throw new Error('stored exchange credential is not encrypted with the current format');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getExchangeCredentialEncryptionKey(),
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  function credentialLast4FromEncrypted(encryptedValue) {
    try {
      const raw = decryptExchangeCredential(encryptedValue);
      return raw ? raw.slice(-4) : '';
    } catch {
      return '';
    }
  }

  function buildExchangeCredentialState({
    rawApiKey,
    rawApiSecret,
    rawApiPassphrase,
    rawPrivateKey,
    rawFunder,
    rawChainId,
    apiKeyEncrypted,
    apiSecretEncrypted,
    apiPassphraseEncrypted,
    privateKeyEncrypted,
    funder,
    chainId,
    baseCredentials = {},
  }) {
    const apiKeyLast4 = rawApiKey
      ? rawApiKey.slice(-4)
      : normalizeText(baseCredentials.apiKeyLast4) || credentialLast4FromEncrypted(apiKeyEncrypted);
    const privateKeyLast4 = rawPrivateKey
      ? rawPrivateKey.slice(-4)
      : normalizeText(baseCredentials.privateKeyLast4) || credentialLast4FromEncrypted(privateKeyEncrypted);
    const hasApiKey = Boolean(apiKeyEncrypted);
    const hasApiSecret = Boolean(apiSecretEncrypted);
    const hasApiPassphrase = Boolean(apiPassphraseEncrypted);
    const hasPrivateKey = Boolean(privateKeyEncrypted);
    const hasFunder = Boolean(normalizeText(funder) || normalizeText(baseCredentials.funder));
    const hasAnyL2 = hasApiKey || hasApiSecret || hasApiPassphrase;
    const hasL2Bundle = hasApiKey && hasApiSecret && hasApiPassphrase;
    return {
      ...baseCredentials,
      hasApiKey,
      hasApiSecret,
      hasApiPassphrase,
      hasPrivateKey,
      hasFunder,
      hasAnyL2,
      hasL2Bundle,
      apiKeyLast4,
      privateKeyLast4,
      funder: normalizeText(funder) || normalizeText(baseCredentials.funder),
      chainId: normalizeText(chainId) || normalizeText(baseCredentials.chainId),
      updatedAt:
        rawApiKey || rawApiSecret || rawApiPassphrase || rawPrivateKey || rawFunder || rawChainId
          ? new Date().toISOString()
          : normalizeText(baseCredentials.updatedAt),
      authStatus: normalizeText(baseCredentials.authStatus) || '미검증',
      authMarket: normalizeText(baseCredentials.authMarket),
      lastAuthCheckAt: normalizeText(baseCredentials.lastAuthCheckAt),
      lastAuthError: normalizeText(baseCredentials.lastAuthError),
    };
  }

  function normalizeExchangeConnection(raw, fallback = {}, options = {}) {
    const body = normalizeObject(raw) || {};
    const base = normalizeObject(fallback) || {};
    const name = normalizeText(body.name || base.name);
    const id = slugifyForPath(body.id || base.id || name, `exchange-${Date.now()}`);
    const strictURLs = options.strictURLs === true;
    const rawApiUrl = normalizeText(body.apiUrl || body.api_url || body.restUrl || body.rest_url || base.apiUrl);
    const apiUrl = normalizeEndpointURL(rawApiUrl, 'REST API URL', { strict: strictURLs && Boolean(rawApiUrl) });
    const rawRestUrl = normalizeText(body.restUrl || body.rest_url || apiUrl || base.restUrl);
    const restUrl = normalizeEndpointURL(rawRestUrl, 'REST API URL', { strict: strictURLs && Boolean(rawRestUrl) });
    const rawWsUrl = normalizeText(body.wsUrl || body.ws_url || body.websocketUrl || body.websocket_url || base.wsUrl);
    const wsUrl = normalizeEndpointURL(rawWsUrl, 'WebSocket URL', { strict: strictURLs && Boolean(rawWsUrl) });
    const rawRpcUrl = normalizeText(body.rpcUrl || body.rpc_url || base.rpcUrl);
    const rpcUrl = normalizeEndpointURL(rawRpcUrl, 'RPC URL', { strict: strictURLs && Boolean(rawRpcUrl) });
    const rawMarketDataUrl = normalizeText(
      body.marketDataUrl || body.market_data_url || body.publicUrl || body.public_url || base.marketDataUrl,
    );
    const marketDataUrl = normalizeEndpointURL(rawMarketDataUrl, 'Market data URL', {
      strict: strictURLs && Boolean(rawMarketDataUrl),
    });
    const rawApiKey = normalizeCredentialText(body.apiKey || body.api_key || body.binanceApiKey || body.binance_api_key);
    const rawApiSecret = normalizeCredentialText(
      body.apiSecret || body.api_secret || body.secretKey || body.secret_key || body.binanceApiSecret || body.binance_api_secret,
    );
    const rawApiPassphrase = normalizeCredentialText(body.apiPassphrase || body.api_passphrase);
    const rawPrivateKey = normalizeCredentialText(body.privateKey || body.private_key);
    const rawFunder = normalizeText(body.funder || body.funderAddress || body.funder_address || body?.credentials?.funder);
    const rawChainId = normalizeText(
      body.chainId || body.chain_id || body?.credentials?.chainId || body?.credentials?.chain_id,
    );
    const funder = rawFunder || normalizeText(base?.credentials?.funder);
    const chainId = rawChainId || normalizeText(base?.credentials?.chainId || base?.credentials?.chain_id);
    const apiKeyEncrypted = rawApiKey
      ? encryptExchangeCredential(rawApiKey)
      : normalizeText(body.apiKeyEncrypted || body.api_key_encrypted || base.apiKeyEncrypted || base.api_key_encrypted);
    const apiSecretEncrypted = rawApiSecret
      ? encryptExchangeCredential(rawApiSecret)
      : normalizeText(
          body.apiSecretEncrypted || body.api_secret_encrypted || base.apiSecretEncrypted || base.api_secret_encrypted,
        );
    const apiPassphraseEncrypted = rawApiPassphrase
      ? encryptExchangeCredential(rawApiPassphrase)
      : normalizeText(
          body.apiPassphraseEncrypted
            || body.api_passphrase_encrypted
            || base.apiPassphraseEncrypted
            || base.api_passphrase_encrypted,
        );
    const privateKeyEncrypted = rawPrivateKey
      ? encryptExchangeCredential(rawPrivateKey)
      : normalizeText(
          body.privateKeyEncrypted || body.private_key_encrypted || base.privateKeyEncrypted || base.private_key_encrypted,
        );
    const hasAnyEndpoint = Boolean(apiUrl || restUrl || wsUrl || rpcUrl || marketDataUrl);
    const hasExecutionEndpoint = Boolean(apiUrl || restUrl || rpcUrl);
    const now = new Date().toISOString();

    if (!name) {
      throw new Error('exchange name is required');
    }
    if (!hasAnyEndpoint && !base.id) {
      throw new Error('apiUrl, wsUrl, rpcUrl, or marketDataUrl is required');
    }
    if (strictURLs && !hasExecutionEndpoint) {
      throw new Error('REST API URL or RPC URL is required for executable AI strategy generation');
    }

    return {
      ...base,
      id,
      name,
      type: normalizeExchangeType(body.type || base.type),
      status: normalizeConnectionStatus(body.status || base.status, hasExecutionEndpoint, {
        autoConnectOnEndpoint: options.autoConnectOnEndpoint === true,
      }),
      scopes: normalizeDelimitedStringArray(body.scopes),
      color: normalizeText(body.color || base.color) || 'slate',
      apiUrl,
      restUrl,
      wsUrl,
      rpcUrl,
      marketDataUrl,
      apiKeyEncrypted,
      apiSecretEncrypted,
      apiPassphraseEncrypted,
      privateKeyEncrypted,
      credentials: buildExchangeCredentialState({
        rawApiKey,
        rawApiSecret,
        rawApiPassphrase,
        rawPrivateKey,
        rawFunder,
        rawChainId,
        apiKeyEncrypted,
        apiSecretEncrypted,
        apiPassphraseEncrypted,
        privateKeyEncrypted,
        funder,
        chainId,
        baseCredentials: normalizeObject(body.credentials) || normalizeObject(base.credentials) || {},
      }),
      updatedAt: now,
      createdAt: normalizeText(base.createdAt) || now,
    };
  }

  function serializeExchangeConnection(connection) {
    const serialized = {
      ...connection,
      credentials: buildExchangeCredentialState({
        rawApiKey: '',
        rawApiSecret: '',
        rawApiPassphrase: '',
        rawPrivateKey: '',
        rawFunder: '',
        rawChainId: '',
        apiKeyEncrypted: connection.apiKeyEncrypted,
        apiSecretEncrypted: connection.apiSecretEncrypted,
        apiPassphraseEncrypted: connection.apiPassphraseEncrypted,
        privateKeyEncrypted: connection.privateKeyEncrypted,
        funder: '',
        chainId: '',
        baseCredentials: normalizeObject(connection.credentials) || {},
      }),
    };
    delete serialized.apiKey;
    delete serialized.apiKeyEncrypted;
    delete serialized.api_key;
    delete serialized.api_key_encrypted;
    delete serialized.apiSecret;
    delete serialized.apiSecretEncrypted;
    delete serialized.api_secret;
    delete serialized.api_secret_encrypted;
    delete serialized.apiPassphrase;
    delete serialized.apiPassphraseEncrypted;
    delete serialized.api_passphrase;
    delete serialized.api_passphrase_encrypted;
    delete serialized.privateKey;
    delete serialized.privateKeyEncrypted;
    delete serialized.private_key;
    delete serialized.private_key_encrypted;
    delete serialized.secretKey;
    delete serialized.secret_key;
    delete serialized.binanceApiKey;
    delete serialized.binance_api_key;
    delete serialized.binanceApiSecret;
    delete serialized.binance_api_secret;
    return serialized;
  }

  function serializeExchangeConnections(connections) {
    return (Array.isArray(connections) ? connections : [])
      .filter((connection) => supportedExchangeConnectionIDs.has(normalizeText(connection?.id)))
      .map(serializeExchangeConnection);
  }

  function resolveUserStateDir(userId) {
    return path.join(userStateDir, sanitizeUserContextID(userId));
  }

  function resolveUserExchangeConnectionsPath(userId) {
    return path.join(resolveUserStateDir(userId), 'exchange-connections.json');
  }

  function mergeExchangeConnections(savedConnections = []) {
    const byId = new Map(
      defaultExchangeConnections.map((connection) => [connection.id, normalizeExchangeConnection(connection, connection)]),
    );
    for (const saved of savedConnections) {
      if (!supportedExchangeConnectionIDs.has(normalizeText(saved?.id))) {
        continue;
      }
      const existing = byId.get(normalizeText(saved?.id));
      const normalized = normalizeExchangeConnection(saved, existing || {}, { autoConnectOnEndpoint: true });
      byId.set(normalized.id, normalized);
    }
    return Array.from(byId.values());
  }

  async function readLegacyExchangeConnections() {
    try {
      const raw = await fs.readFile(legacyExchangeConnectionsPath, 'utf8');
      const parsed = parseJSON(raw, 'exchange connections');
      return Array.isArray(parsed?.connections) ? parsed.connections : [];
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async function retireLegacyExchangeConnectionsFile(userId) {
    try {
      await fs.access(legacyExchangeConnectionsPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const retiredPath = path.join(
      localStateDir,
      `exchange-connections.migrated-to-${sanitizeUserContextID(userId)}.json`,
    );

    try {
      await fs.rename(legacyExchangeConnectionsPath, retiredPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  async function writeSavedExchangeConnections(userId, connections) {
    const normalizedUserId = sanitizeUserContextID(userId);
    const filePath = resolveUserExchangeConnectionsPath(normalizedUserId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `${stringifyPrettyJSON({ userId: normalizedUserId, connections })}\n`,
      'utf8',
    );
  }

  async function readSavedExchangeConnections(userId, { allowLegacyMigration = true } = {}) {
    const normalizedUserId = sanitizeUserContextID(userId);
    const filePath = resolveUserExchangeConnectionsPath(normalizedUserId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = parseJSON(raw, 'exchange connections');
      return Array.isArray(parsed?.connections) ? parsed.connections : [];
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      if (!allowLegacyMigration) {
        return [];
      }

      const legacyConnections = await readLegacyExchangeConnections();
      if (legacyConnections.length === 0) {
        return [];
      }

      await writeSavedExchangeConnections(normalizedUserId, legacyConnections);
      await retireLegacyExchangeConnectionsFile(normalizedUserId);
      return legacyConnections;
    }
  }

  async function loadExchangeConnections(userId) {
    return mergeExchangeConnections(await readSavedExchangeConnections(userId));
  }

  async function upsertExchangeConnection(userId, raw) {
    const savedConnections = await readSavedExchangeConnections(userId);
    const allConnections = mergeExchangeConnections(savedConnections);
    const rawID = normalizeText(raw?.id);
    const rawName = normalizeText(raw?.name);
    const existing = allConnections.find(
      (connection) => connection.id === rawID || connection.name.toLowerCase() === rawName.toLowerCase(),
    );
    const normalized = normalizeExchangeConnection(raw, existing || {}, {
      strictURLs: true,
      autoConnectOnEndpoint: true,
    });
    const nextSaved = [
      ...savedConnections.filter((connection) => normalizeText(connection?.id) !== normalized.id),
      normalized,
    ];
    await writeSavedExchangeConnections(userId, nextSaved);
    return normalized;
  }

  async function patchExchangeConnection(userId, id, patch) {
    const normalizedID = normalizeText(id);
    const savedConnections = await readSavedExchangeConnections(userId);
    const allConnections = mergeExchangeConnections(savedConnections);
    const existing = allConnections.find((connection) => connection.id === normalizedID);
    if (!existing) {
      throw new Error('exchange connection not found');
    }

    const normalized = normalizeExchangeConnection(
      {
        ...existing,
        ...(normalizeObject(patch) || {}),
        credentials: {
          ...(normalizeObject(existing.credentials) || {}),
          ...(normalizeObject(patch?.credentials) || {}),
        },
      },
      existing,
      { autoConnectOnEndpoint: true },
    );
    const nextSaved = [
      ...savedConnections.filter((connection) => normalizeText(connection?.id) !== normalized.id),
      normalized,
    ];
    await writeSavedExchangeConnections(userId, nextSaved);
    return normalized;
  }

  function getConnectedExchangeConnections(connections) {
    return (Array.isArray(connections) ? connections : [])
      .filter((connection) => supportedExchangeConnectionIDs.has(normalizeText(connection?.id)))
      .filter((connection) => normalizeText(connection.status) === '연결됨');
  }

  function resolveExchangeCredentialPair(connection) {
    const apiKey = decryptExchangeCredential(connection.apiKeyEncrypted);
    const apiSecret = decryptExchangeCredential(connection.apiSecretEncrypted);
    if (!apiKey || !apiSecret) {
      throw new Error('Binance API Key and Secret must be saved before signed requests can be used');
    }
    return { apiKey, apiSecret };
  }

  function buildSignedBinanceQuery(params, apiSecret) {
    const searchParams = new URLSearchParams();
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, value]) => searchParams.append(key, String(value)));
    const query = searchParams.toString();
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    searchParams.append('signature', signature);
    return searchParams.toString();
  }

  function getBinanceBaseURL(connection, market) {
    const configured = normalizeText(connection.apiUrl || connection.restUrl);
    if (configured) return configured;
    return market === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  }

  async function binanceSignedRestRequest(
    connection,
    {
      market = 'spot',
      method = 'GET',
      endpoint = '/api/v3/account',
      params = {},
    } = {},
  ) {
    const { apiKey, apiSecret } = resolveExchangeCredentialPair(connection);
    const url = new URL(endpoint, getBinanceBaseURL(connection, market));
    url.search = buildSignedBinanceQuery(
      {
        recvWindow: 5000,
        timestamp: Date.now(),
        ...params,
      },
      apiSecret,
    );

    const response = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
    });
    const rawText = await response.text();
    const data = parseJSON(rawText, 'Binance response');
    if (!response.ok) {
      const message = normalizeText(data?.msg || data?.message) || `HTTP ${response.status}`;
      throw new Error(`${message} (${response.status})`);
    }
    return { status: response.status, data };
  }

  async function testBinanceSignedConnection(connection, { market = 'spot' } = {}) {
    const name = normalizeText(connection.name || connection.id).toLowerCase();
    if (!name.includes('binance')) {
      throw new Error('Binance signed request test is only available for Binance connections');
    }
    return binanceSignedRestRequest(connection, {
      market,
      endpoint: market === 'futures' ? '/fapi/v2/account' : '/api/v3/account',
    });
  }

  function buildConnectedExchangeContextForAI(connections) {
    return getConnectedExchangeConnections(connections).map((connection) => ({
      id: connection.id,
      name: connection.name,
      type: connection.type,
      configuredEndpoints: {
        api: Boolean(connection.apiUrl || connection.restUrl),
        websocket: Boolean(connection.wsUrl),
        rpc: Boolean(connection.rpcUrl),
        marketData: Boolean(connection.marketDataUrl),
      },
      endpointHosts: {
        api: redactURLForAI(connection.apiUrl || connection.restUrl),
        websocket: redactURLForAI(connection.wsUrl),
        rpc: redactURLForAI(connection.rpcUrl),
        marketData: redactURLForAI(connection.marketDataUrl),
      },
      credentials: {
        apiKey: Boolean(connection.apiKeyEncrypted),
        apiSecret: Boolean(connection.apiSecretEncrypted),
        apiPassphrase: Boolean(connection.apiPassphraseEncrypted),
        privateKey: Boolean(connection.privateKeyEncrypted),
        funder: Boolean(normalizeText(connection.credentials?.funder)),
        l2Bundle: Boolean(connection.credentials?.hasL2Bundle),
        authStatus: normalizeText(connection.credentials?.authStatus) || '미검증',
      },
      capabilities: buildExchangeCapabilitiesForAI(connection),
    }));
  }

  return {
    buildConnectedExchangeContextForAI,
    getConnectedExchangeConnections,
    loadExchangeConnections,
    patchExchangeConnection,
    serializeExchangeConnection,
    serializeExchangeConnections,
    testBinanceSignedConnection,
    upsertExchangeConnection,
  };
}
