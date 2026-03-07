import {
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

import { isEndpointAllowed, verifyAccessToken } from './accessGrant.mjs';

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function parseBearerToken(request, url) {
  const authHeader = String(request.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(url.searchParams.get('access_token') || '').trim();
}

function normalizeEndpointPath(pathname) {
  const endpoint = String(pathname || '').trim();
  if (!endpoint) {
    return '/';
  }
  const withPrefix = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return withPrefix.split('?')[0].split('#')[0];
}

function rejectUnauthorized(response, message, code = 401) {
  sendJson(response, code, {
    error: code === 403 ? 'forbidden' : 'unauthorized',
    code,
    message
  });
}

function removeReservedQueryParams(url) {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete('access_token');
  cleaned.searchParams.delete('endpoint');
  return cleaned;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function validateGatewayRequest({
  token,
  endpoint,
  tokenSigningKey
}) {
  const claims = verifyAccessToken(token, { tokenSigningKey });
  if (!isEndpointAllowed(claims.endpoints, endpoint)) {
    throw new Error(`endpoint not allowed: ${endpoint}`);
  }
  return claims;
}

function buildUpstreamWsUrl(baseWsUrl, endpoint) {
  const base = new URL(baseWsUrl);
  const normalizedEndpoint = normalizeEndpointPath(endpoint);
  if (normalizedEndpoint !== '/') {
    const basePath = base.pathname.replace(/\/+$/, '');
    base.pathname = `${basePath}${normalizedEndpoint}`;
  }
  return base.toString();
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
  const decoded = Buffer.from(padded, 'base64');
  if (decoded.length === 0) {
    throw new Error(`${fieldName} must be base64url`);
  }
  return decoded;
}

function createRecipientKeyObject(requesterX25519Pubkey) {
  const decoded = fromBase64Url(
    requesterX25519Pubkey,
    'requester_x25519_pubkey'
  );
  if (decoded.length !== 32) {
    throw new Error('requester_x25519_pubkey must be a 32-byte X25519 key');
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

function parseSessionGatewayPath(pathname) {
  const prefix = '/access/ws/';
  if (!String(pathname || '').startsWith(prefix)) {
    return null;
  }

  const rest = String(pathname).slice(prefix.length);
  if (!rest) {
    return null;
  }

  const slashIndex = rest.indexOf('/');
  const rawSession = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest;
  if (!rawSession) {
    return null;
  }

  let sessionId;
  try {
    sessionId = decodeURIComponent(rawSession);
  } catch {
    return null;
  }

  const endpointRaw = slashIndex >= 0 ? rest.slice(slashIndex) : '/';
  return {
    sessionId,
    endpoint: normalizeEndpointPath(endpointRaw)
  };
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

function expectedWsProof({
  requesterX25519Pubkey,
  serverEphemeralPrivateKey,
  nonce,
  nonceBase64Url,
  sessionId,
  endpoint
}) {
  const recipientKey = createRecipientKeyObject(requesterX25519Pubkey);
  const sharedSecret = diffieHellman({
    privateKey: serverEphemeralPrivateKey,
    publicKey: recipientKey
  });
  const derivedKey = deriveWsProofKey({
    sharedSecret,
    nonce,
    sessionId,
    endpoint
  });
  const payload = Buffer.from(
    `proof:${sessionId}:${normalizeEndpointPath(endpoint)}:${nonceBase64Url}`,
    'utf8'
  );
  return createHmac('sha256', derivedKey).update(payload).digest();
}

function writeUpgradeError(socket, code, status, message) {
  const body = String(message || 'upgrade rejected');
  socket.write(
    `HTTP/1.1 ${code} ${status}\r\n` +
      'Content-Type: text/plain\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
  socket.destroy();
}

function extractWsServer(accessGateway, serverId) {
  const serverSpec = accessGateway.wsServerRegistry?.[serverId];
  if (!serverSpec || !serverSpec.ws_url) {
    throw new Error('invalid upstream ws server');
  }
  return serverSpec;
}

async function proxyGatewayHttpRequest({
  request,
  response,
  url,
  endpoint,
  claims,
  hostBaseUrl,
  hostApiToken
}) {
  const method = String(request.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    sendJson(response, 405, {
      error: 'method not allowed',
      code: 405,
      message: 'gateway supports GET and POST'
    });
    return;
  }

  const cleanedUrl = removeReservedQueryParams(url);
  const targetPath = `/programs/${encodeURIComponent(claims.program_id)}/proxy${endpoint}`;
  const targetUrl = `${trimTrailingSlash(hostBaseUrl)}${targetPath}${cleanedUrl.search || ''}`;

  const headers = {
    Accept: String(request.headers.accept || 'application/json')
  };
  if (hostApiToken) {
    headers['X-Hershy-Api-Token'] = hostApiToken;
  }
  if (method === 'POST') {
    headers['Content-Type'] = String(
      request.headers['content-type'] || 'application/json'
    );
  }

  let body;
  if (method === 'POST') {
    body = await readRequestBody(request);
  }

  const upstreamResponse = await fetch(targetUrl, {
    method,
    headers,
    body
  });

  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (key.toLowerCase() === 'transfer-encoding') {
      continue;
    }
    response.setHeader(key, value);
  }
  response.statusCode = upstreamResponse.status;
  const payload = Buffer.from(await upstreamResponse.arrayBuffer());
  response.end(payload);
}

function relayWebSocket({
  clientSocket,
  upstreamUrl,
  readyPayload,
  expiresAtSec = 0
}) {
  const upstreamSocket = new WebSocket(upstreamUrl);
  let closed = false;
  let expiryTimer = null;

  const closeAll = (code = 1011, reason = 'gateway closed') => {
    if (closed) {
      return;
    }
    closed = true;
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    if (upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.close(code, reason);
    } else if (upstreamSocket.readyState === WebSocket.CONNECTING) {
      upstreamSocket.terminate();
    }
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(code, reason);
    } else if (clientSocket.readyState === WebSocket.CONNECTING) {
      clientSocket.terminate();
    }
  };

  if (expiresAtSec > 0) {
    const delayMs = Math.max(0, expiresAtSec * 1000 - Date.now());
    expiryTimer = setTimeout(() => {
      closeAll(4001, 'session expired');
    }, delayMs);
  }

  upstreamSocket.on('open', () => {
    clientSocket.send(JSON.stringify(readyPayload));
  });

  upstreamSocket.on('message', (data, isBinary) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(data, { binary: isBinary });
    }
  });

  clientSocket.on('message', (data, isBinary) => {
    if (upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.send(data, { binary: isBinary });
    }
  });

  upstreamSocket.on('close', () => closeAll(1000, 'upstream closed'));
  clientSocket.on('close', () => closeAll(1000, 'client closed'));
  upstreamSocket.on('error', () => closeAll(1011, 'upstream error'));
  clientSocket.on('error', () => closeAll(1011, 'client error'));
}

function authenticateSessionSocket({
  clientSocket,
  session,
  endpoint
}) {
  const serverEphemeral = generateKeyPairSync('x25519');
  const nonce = randomBytes(16);
  const nonceBase64Url = toBase64Url(nonce);
  const sessionId = String(session.session_id || '').trim();

  const expectedProof = expectedWsProof({
    requesterX25519Pubkey: session.requester_x25519_pubkey,
    serverEphemeralPrivateKey: serverEphemeral.privateKey,
    nonce,
    nonceBase64Url,
    sessionId,
    endpoint
  });

  const challenge = {
    type: 'auth.challenge',
    alg: 'x25519-hkdf-sha256-hmac-sha256-v1',
    nonce: nonceBase64Url,
    session_id: sessionId,
    endpoint: normalizeEndpointPath(endpoint),
    server_ephemeral_public_key: serverEphemeral.publicKey.export({ format: 'jwk' }).x,
    expires_at:
      session.expires_at_sec > 0
        ? new Date(session.expires_at_sec * 1000).toISOString()
        : null
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let challengeResendTimer = null;
    let timeout = null;

    const settle = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (challengeResendTimer) {
        clearInterval(challengeResendTimer);
        challengeResendTimer = null;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      clientSocket.off('message', onMessage);
      clientSocket.off('close', onClose);
      clientSocket.off('error', onError);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const sendChallenge = () => {
      if (clientSocket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        clientSocket.send(JSON.stringify(challenge));
      } catch (error) {
        settle(new Error(`failed to send auth challenge: ${error.message}`));
      }
    };
    sendChallenge();
    challengeResendTimer = setInterval(sendChallenge, 2000);

    timeout = setTimeout(() => {
      settle(new Error('authentication timeout'));
    }, 10000);

    const onClose = () => settle(new Error('client disconnected before authentication'));
    const onError = () => settle(new Error('client socket error during authentication'));

    const onMessage = (data, isBinary) => {
      if (isBinary) {
        settle(new Error('authentication proof must be JSON text'));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(Buffer.from(data).toString('utf8'));
      } catch (error) {
        settle(new Error(`invalid authentication payload: ${error.message}`));
        return;
      }

      if (!parsed || parsed.type !== 'auth.proof') {
        settle(new Error('expected auth.proof message'));
        return;
      }

      let providedProof;
      try {
        providedProof = fromBase64Url(parsed.proof, 'auth.proof.proof');
      } catch (error) {
        settle(error);
        return;
      }

      if (
        providedProof.length !== expectedProof.length ||
        !timingSafeEqual(providedProof, expectedProof)
      ) {
        settle(new Error('invalid auth proof'));
        return;
      }

      settle(null);
    };

    clientSocket.on('message', onMessage);
    clientSocket.once('close', onClose);
    clientSocket.once('error', onError);
  });
}

function attachAccessGatewayUpgrade({
  server,
  accessGateway
}) {
  const gatewayWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (!accessGateway?.enabled) {
      socket.destroy();
      return;
    }

    let url;
    try {
      url = new URL(request.url || '/', 'http://127.0.0.1');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname === '/access/ws') {
      const token = parseBearerToken(request, url);
      const endpoint = normalizeEndpointPath(url.searchParams.get('endpoint') || '/');
      let claims;
      try {
        claims = validateGatewayRequest({
          token,
          endpoint,
          tokenSigningKey: accessGateway.tokenSigningKey
        });
      } catch (error) {
        writeUpgradeError(socket, 401, 'Unauthorized', error.message);
        return;
      }

      let upstreamServer;
      try {
        upstreamServer = extractWsServer(accessGateway, claims.server_id);
      } catch (error) {
        writeUpgradeError(socket, 502, 'Bad Gateway', error.message);
        return;
      }

      gatewayWss.handleUpgrade(request, socket, head, (clientSocket) => {
        relayWebSocket({
          clientSocket,
          upstreamUrl: buildUpstreamWsUrl(upstreamServer.ws_url, endpoint),
          readyPayload: {
            type: 'gateway.ready',
            endpoint,
            server_id: claims.server_id
          }
        });
      });
      return;
    }

    const sessionPath = parseSessionGatewayPath(url.pathname);
    if (!sessionPath || !accessGateway.sessionStore) {
      socket.destroy();
      return;
    }

    let session;
    try {
      session = accessGateway.sessionStore.getSession(sessionPath.sessionId);
    } catch (error) {
      writeUpgradeError(socket, 400, 'Bad Request', error.message);
      return;
    }
    if (!session) {
      writeUpgradeError(socket, 404, 'Not Found', 'websocket session not found or expired');
      return;
    }

    if (!isEndpointAllowed(session.requested_endpoints, sessionPath.endpoint)) {
      writeUpgradeError(socket, 403, 'Forbidden', 'endpoint not allowed for this session');
      return;
    }

    let upstreamServer;
    try {
      upstreamServer = extractWsServer(accessGateway, session.server_id);
    } catch (error) {
      writeUpgradeError(socket, 502, 'Bad Gateway', error.message);
      return;
    }

    gatewayWss.handleUpgrade(request, socket, head, (clientSocket) => {
      authenticateSessionSocket({
        clientSocket,
        session,
        endpoint: sessionPath.endpoint
      })
        .then(() => {
          relayWebSocket({
            clientSocket,
            upstreamUrl: buildUpstreamWsUrl(upstreamServer.ws_url, sessionPath.endpoint),
            expiresAtSec: session.expires_at_sec,
            readyPayload: {
              type: 'gateway.ready',
              endpoint: sessionPath.endpoint,
              server_id: session.server_id,
              session_id: session.session_id
            }
          });
        })
        .catch((error) => {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(
              JSON.stringify({
                type: 'gateway.error',
                code: 'unauthorized',
                message: error.message
              })
            );
          }
          clientSocket.close(4003, 'unauthorized');
        });
    });
  });
}

export function startResourceServer({
  port,
  getHealth,
  getCatalog,
  getSample,
  accessGateway
}) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (request.method === 'GET' && url.pathname === '/resources/health') {
      sendJson(response, 200, getHealth());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/resources/catalog') {
      sendJson(response, 200, getCatalog());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/resources/sample') {
      sendJson(response, 200, getSample());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      sendJson(response, 200, {
        name: 'hershy-acp-resource-server',
        endpoints: [
          '/resources/health',
          '/resources/catalog',
          '/resources/sample',
          '/access/http/*',
          '/access/ws?endpoint=/...',
          '/access/ws/{sessionId}/{endpoint-path}'
        ]
      });
      return;
    }

    if (accessGateway?.enabled && url.pathname.startsWith('/access/http/')) {
      const endpoint = normalizeEndpointPath(
        url.pathname.replace(/^\/access\/http/, '')
      );
      const token = parseBearerToken(request, url);

      let claims;
      try {
        claims = validateGatewayRequest({
          token,
          endpoint,
          tokenSigningKey: accessGateway.tokenSigningKey
        });
      } catch (error) {
        rejectUnauthorized(response, error.message, 401);
        return;
      }

      try {
        await proxyGatewayHttpRequest({
          request,
          response,
          url,
          endpoint,
          claims,
          hostBaseUrl: accessGateway.hostBaseUrl,
          hostApiToken: accessGateway.hostApiToken
        });
      } catch (error) {
        sendJson(response, 502, {
          error: 'bad gateway',
          code: 502,
          message: error.message
        });
      }
      return;
    }

    if (accessGateway?.enabled && request.method === 'GET' && url.pathname === '/access/validate') {
      const token = parseBearerToken(request, url);
      const endpoint = normalizeEndpointPath(url.searchParams.get('endpoint') || '/');
      try {
        const claims = validateGatewayRequest({
          token,
          endpoint,
          tokenSigningKey: accessGateway.tokenSigningKey
        });
        sendJson(response, 200, {
          ok: true,
          endpoint,
          claims
        });
      } catch (error) {
        rejectUnauthorized(response, error.message, 401);
      }
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });

  if (accessGateway?.enabled) {
    attachAccessGatewayUpgrade({ server, accessGateway });
  }

  server.listen(port, '0.0.0.0');
  return server;
}
