import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

const ACCESS_GRANT_VERSION = '1.0.0';
const ENCRYPTION_ALGORITHM = 'X25519-HKDF-SHA256-AES-256-GCM';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(raw, fieldName) {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  const asBase64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${asBase64}${'='.repeat((4 - (asBase64.length % 4)) % 4)}`;
  let decoded;
  try {
    decoded = Buffer.from(padded, 'base64');
  } catch (error) {
    throw new Error(`${fieldName} must be base64url: ${error.message}`);
  }

  if (decoded.length === 0) {
    throw new Error(`${fieldName} must be base64url`);
  }

  return decoded;
}

function toInteger(name, raw) {
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function normalizeEndpointPath(endpointRaw) {
  const endpoint = String(endpointRaw || '').trim();
  if (!endpoint) {
    throw new Error('endpoint is required');
  }
  const asPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return asPath.split('?')[0].split('#')[0];
}

function uniqueEndpoints(rawEndpoints) {
  const dedup = new Set();
  for (const endpointRaw of rawEndpoints) {
    const endpoint = normalizeEndpointPath(endpointRaw);
    if (!endpoint) {
      continue;
    }
    dedup.add(endpoint);
  }
  return [...dedup];
}

function createRecipientKeyObject(requesterX25519Pubkey) {
  const decoded = fromBase64Url(
    requesterX25519Pubkey,
    'access.requester_x25519_pubkey'
  );
  if (decoded.length !== 32) {
    throw new Error(
      'access.requester_x25519_pubkey must be 32-byte X25519 public key (base64url)'
    );
  }

  return createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'X25519',
      x: toBase64Url(decoded)
    },
    format: 'jwk'
  });
}

export function validateAndNormalizeAccessRequest(accessRequest, { wsServerRegistry }) {
  if (!isObject(accessRequest)) {
    return {
      ok: false,
      error: 'access must be an object'
    };
  }

  const serverId = String(accessRequest.server_id || '').trim();
  if (!serverId) {
    return {
      ok: false,
      error: 'access.server_id is required'
    };
  }

  const server = wsServerRegistry?.[serverId];
  if (!server) {
    return {
      ok: false,
      error: `unknown access.server_id: ${serverId}`
    };
  }

  const endpoints = uniqueEndpoints(accessRequest.requested_endpoints || []);
  if (endpoints.length === 0) {
    return {
      ok: false,
      error: 'access.requested_endpoints must include at least one endpoint'
    };
  }

  let ttlSec = 0;
  try {
    if (server.mode === 'session') {
      const rawTtl =
        accessRequest.session_ttl_sec === undefined
          ? server.default_ttl_sec
          : accessRequest.session_ttl_sec;
      ttlSec = toInteger('access.session_ttl_sec', rawTtl);
      if (ttlSec <= 0) {
        return {
          ok: false,
          error: 'access.session_ttl_sec must be > 0 for session servers'
        };
      }
      if (ttlSec > server.max_ttl_sec) {
        return {
          ok: false,
          error: `access.session_ttl_sec exceeds server max (${server.max_ttl_sec})`
        };
      }
    } else if (accessRequest.session_ttl_sec !== undefined) {
      return {
        ok: false,
        error: 'access.session_ttl_sec is only valid for session servers'
      };
    }

    createRecipientKeyObject(accessRequest.requester_x25519_pubkey);
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }

  return {
    ok: true,
    access: {
      server_id: serverId,
      server_mode: server.mode,
      requester_x25519_pubkey: String(accessRequest.requester_x25519_pubkey).trim(),
      requested_endpoints: endpoints,
      session_ttl_sec: ttlSec
    },
    server
  };
}

function buildSignedToken({
  jobId,
  programId,
  serverId,
  serverMode,
  requestedEndpoints,
  issuedAtSec,
  expiresAtSec,
  tokenIssuer,
  tokenSigningKey
}) {
  const claims = {
    v: 1,
    iss: tokenIssuer,
    jti: toBase64Url(randomBytes(16)),
    job_id: String(jobId),
    program_id: String(programId),
    server_id: serverId,
    server_mode: serverMode,
    endpoints: requestedEndpoints,
    iat: issuedAtSec,
    exp: expiresAtSec || 0
  };
  const encodedClaims = toBase64Url(Buffer.from(JSON.stringify(claims), 'utf8'));

  if (!tokenSigningKey) {
    return `opaque.${toBase64Url(randomBytes(32))}`;
  }

  const signature = createHmac('sha256', tokenSigningKey)
    .update(encodedClaims)
    .digest();

  return `v1.${encodedClaims}.${toBase64Url(signature)}`;
}

function decodeTokenPart(raw, fieldName) {
  const decoded = fromBase64Url(raw, fieldName);
  return decoded.toString('utf8');
}

function signTokenPayload(encodedClaims, tokenSigningKey) {
  return createHmac('sha256', tokenSigningKey).update(encodedClaims).digest();
}

function ensureRecipientPrivateKeyObject(recipientPrivateKey) {
  if (!recipientPrivateKey) {
    throw new Error('recipientPrivateKey is required');
  }
  return recipientPrivateKey;
}

function createEphemeralPublicKeyObject(ephemeralPublicKeyBase64Url) {
  return createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'X25519',
      x: String(ephemeralPublicKeyBase64Url || '').trim()
    },
    format: 'jwk'
  });
}

function deriveWsProofKey({
  sharedSecret,
  nonce,
  sessionId,
  endpoint
}) {
  const info = Buffer.from(
    `hershy-acp-ws-auth:v1:${sessionId}:${normalizeEndpointPath(endpoint)}`,
    'utf8'
  );
  const keyMaterial = hkdfSync('sha256', sharedSecret, nonce, info, 32);
  return Buffer.isBuffer(keyMaterial)
    ? keyMaterial
    : Buffer.from(keyMaterial);
}

export function buildWsAuthProof({
  recipientPrivateKey,
  serverEphemeralPublicKey,
  nonce,
  sessionId,
  endpoint
}) {
  const privateKey = ensureRecipientPrivateKeyObject(recipientPrivateKey);
  const ephemeralPublicKey = createEphemeralPublicKeyObject(serverEphemeralPublicKey);
  const nonceBuffer = fromBase64Url(nonce, 'nonce');
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }

  const sharedSecret = diffieHellman({
    privateKey,
    publicKey: ephemeralPublicKey
  });
  const derivedKey = deriveWsProofKey({
    sharedSecret,
    nonce: nonceBuffer,
    sessionId: normalizedSessionId,
    endpoint
  });
  const payload = Buffer.from(
    `proof:${normalizedSessionId}:${normalizeEndpointPath(endpoint)}:${nonce}`,
    'utf8'
  );
  const proof = createHmac('sha256', derivedKey).update(payload).digest();
  return toBase64Url(proof);
}

export function verifyAccessToken(rawToken, { tokenSigningKey, nowSec } = {}) {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new Error('access token is required');
  }
  if (!tokenSigningKey) {
    throw new Error('token signing key is required for verification');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('invalid access token format');
  }

  const encodedClaims = parts[1];
  const providedSig = fromBase64Url(parts[2], 'access token signature');

  const expectedSig = signTokenPayload(encodedClaims, tokenSigningKey);
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new Error('invalid access token signature');
  }

  let claims;
  try {
    claims = JSON.parse(decodeTokenPart(encodedClaims, 'access token claims'));
  } catch (error) {
    throw new Error(`invalid access token payload: ${error.message}`);
  }
  if (!claims || typeof claims !== 'object') {
    throw new Error('invalid access token payload');
  }

  const checkedNow = Number.isInteger(nowSec)
    ? nowSec
    : Math.floor(Date.now() / 1000);
  const exp = Number.parseInt(String(claims.exp || '0'), 10);
  if (Number.isInteger(exp) && exp > 0 && checkedNow > exp) {
    throw new Error('access token expired');
  }

  return claims;
}

export function isEndpointAllowed(allowedEndpoints, requestedEndpoint) {
  const endpoint = normalizeEndpointPath(requestedEndpoint);
  if (!Array.isArray(allowedEndpoints) || allowedEndpoints.length === 0) {
    return false;
  }

  for (const patternRaw of allowedEndpoints) {
    const pattern = normalizeEndpointPath(patternRaw);
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (endpoint.startsWith(prefix)) {
        return true;
      }
      continue;
    }
    if (endpoint === pattern) {
      return true;
    }
  }

  return false;
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function buildEncryptedAccessGrant({
  jobId,
  programId,
  accessRequest,
  wsServerRegistry,
  tokenIssuer,
  tokenSigningKey,
  gatewayWsUrl = '',
  gatewayHttpUrl = '',
  gatewaySessionRegistrar,
  issuedAt = new Date()
}) {
  const normalized = validateAndNormalizeAccessRequest(accessRequest, {
    wsServerRegistry
  });
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const issuedAtDate = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  const issuedAtSec = Math.floor(issuedAtDate.getTime() / 1000);
  const expiresAtSec =
    normalized.access.server_mode === 'session'
      ? issuedAtSec + normalized.access.session_ttl_sec
      : 0;
  const expiresAtIso = expiresAtSec > 0 ? new Date(expiresAtSec * 1000).toISOString() : null;

  const accessToken = buildSignedToken({
    jobId,
    programId,
    serverId: normalized.access.server_id,
    serverMode: normalized.access.server_mode,
    requestedEndpoints: normalized.access.requested_endpoints,
    issuedAtSec,
    expiresAtSec,
    tokenIssuer,
    tokenSigningKey
  });

  const grantId = toBase64Url(randomBytes(12));
  let resolvedWsUrl = String(gatewayWsUrl || normalized.server.ws_url).trim();
  let resolvedHttpUrl = String(gatewayHttpUrl || '').trim();
  let gatewaySession = null;

  if (resolvedWsUrl && typeof gatewaySessionRegistrar === 'function') {
    gatewaySession = gatewaySessionRegistrar({
      grantId,
      jobId: String(jobId),
      programId: String(programId),
      serverId: normalized.access.server_id,
      serverMode: normalized.access.server_mode,
      requesterX25519Pubkey: normalized.access.requester_x25519_pubkey,
      requestedEndpoints: normalized.access.requested_endpoints,
      issuedAtSec,
      expiresAtSec
    });
    if (gatewaySession?.ws_url) {
      resolvedWsUrl = String(gatewaySession.ws_url).trim();
    }
    if (gatewaySession?.http_url) {
      resolvedHttpUrl = String(gatewaySession.http_url).trim();
    }
  }

  const secretPayload = {
    version: ACCESS_GRANT_VERSION,
    grant_id: grantId,
    ws_url: resolvedWsUrl,
    http_url: resolvedHttpUrl || null,
    access_token: accessToken,
    token_type: 'bearer',
    ws_auth: {
      mode: 'x25519-challenge-v1',
      proof_message_type: 'auth.proof'
    },
    server_id: normalized.access.server_id,
    server_mode: normalized.access.server_mode,
    requested_endpoints: normalized.access.requested_endpoints,
    job_id: String(jobId),
    program_id: String(programId),
    issued_at: issuedAtDate.toISOString(),
    expires_at: expiresAtIso,
    ws_session: gatewaySession || null
  };

  const recipientPublicKey = createRecipientKeyObject(
    normalized.access.requester_x25519_pubkey
  );

  const ephemeral = generateKeyPairSync('x25519');
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublicKey
  });

  const salt = randomBytes(16);
  const info = Buffer.from(
    `hershy-acp-access-grant:v1:${jobId}:${programId}:${normalized.access.server_id}`,
    'utf8'
  );
  const keyMaterial = hkdfSync('sha256', sharedSecret, salt, info, 32);
  const symmetricKey = Buffer.isBuffer(keyMaterial)
    ? keyMaterial
    : Buffer.from(keyMaterial);
  const iv = randomBytes(12);

  const aadObject = {
    v: 1,
    job_id: String(jobId),
    program_id: String(programId),
    server_id: normalized.access.server_id
  };
  const aad = Buffer.from(JSON.stringify(aadObject), 'utf8');

  const cipher = createCipheriv('aes-256-gcm', symmetricKey, iv);
  cipher.setAAD(aad);

  const plaintext = Buffer.from(JSON.stringify(secretPayload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const ephemeralPublicJwk = ephemeral.publicKey.export({ format: 'jwk' });

  return {
    server_id: normalized.access.server_id,
    server_mode: normalized.access.server_mode,
    requested_endpoints: normalized.access.requested_endpoints,
    session_ttl_sec: normalized.access.session_ttl_sec,
    issued_at: issuedAtDate.toISOString(),
    expires_at: expiresAtIso,
    encrypted_payload: {
      alg: ENCRYPTION_ALGORITHM,
      key_format: 'x25519-raw-base64url',
      ephemeral_public_key: ephemeralPublicJwk.x,
      salt: toBase64Url(salt),
      iv: toBase64Url(iv),
      aad: toBase64Url(aad),
      ciphertext: toBase64Url(ciphertext),
      tag: toBase64Url(tag)
    },
    checksums: {
      encrypted_payload_sha256: sha256Hex(
        Buffer.concat([salt, iv, aad, ciphertext, tag])
      )
    }
  };
}

export function decryptAccessGrantPayload({
  encryptedPayload,
  recipientPrivateKey
}) {
  if (!isObject(encryptedPayload)) {
    throw new Error('encryptedPayload must be an object');
  }

  const privateKey = ensureRecipientPrivateKeyObject(recipientPrivateKey);

  const ephemeralPublicKey = createEphemeralPublicKeyObject(
    encryptedPayload.ephemeral_public_key
  );

  const salt = fromBase64Url(encryptedPayload.salt, 'encryptedPayload.salt');
  const iv = fromBase64Url(encryptedPayload.iv, 'encryptedPayload.iv');
  const aad = fromBase64Url(encryptedPayload.aad, 'encryptedPayload.aad');
  const ciphertext = fromBase64Url(
    encryptedPayload.ciphertext,
    'encryptedPayload.ciphertext'
  );
  const tag = fromBase64Url(encryptedPayload.tag, 'encryptedPayload.tag');

  const sharedSecret = diffieHellman({
    privateKey,
    publicKey: ephemeralPublicKey
  });
  const aadParsed = JSON.parse(aad.toString('utf8'));
  const info = Buffer.from(
    `hershy-acp-access-grant:v1:${aadParsed.job_id}:${aadParsed.program_id}:${aadParsed.server_id}`,
    'utf8'
  );
  const keyMaterial = hkdfSync('sha256', sharedSecret, salt, info, 32);
  const symmetricKey = Buffer.isBuffer(keyMaterial)
    ? keyMaterial
    : Buffer.from(keyMaterial);

  const decipher = createDecipheriv('aes-256-gcm', symmetricKey, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString('utf8'));
}
