import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import {
  buildEncryptedAccessGrant,
  buildWsAuthProof,
  decryptAccessGrantPayload
} from '../src/accessGrant.mjs';
import { createAccessGatewaySessionStore } from '../src/accessGatewaySessionStore.mjs';
import { startResourceServer } from '../src/resourceServer.mjs';

async function startServer(server) {
  if (server.listening) {
    return;
  }
  await once(server, 'listening');
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function onceWsOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function onceWsMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, isBinary) => {
      cleanup();
      if (isBinary) {
        reject(new Error('expected text websocket message'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.from(data).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('socket closed before message'));
    };
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.on('message', onMessage);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function waitForWsClosed(socket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await once(socket, 'close');
}

async function expectWsHandshakeFailure(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const onUnexpected = (_request, response) => {
      cleanup();
      assert.equal(response.statusCode, 404);
      resolve();
    };
    const onError = (error) => {
      cleanup();
      if (/Unexpected server response: 404/.test(String(error.message))) {
        resolve();
        return;
      }
      reject(error);
    };
    const onOpen = () => {
      cleanup();
      socket.close();
      reject(new Error('expected websocket handshake failure'));
    };
    const cleanup = () => {
      socket.off('unexpected-response', onUnexpected);
      socket.off('error', onError);
      socket.off('open', onOpen);
    };
    socket.once('unexpected-response', onUnexpected);
    socket.once('error', onError);
    socket.once('open', onOpen);
  });
}

test('resource server gateway validates token and proxies allowed endpoint', async () => {
  const hostServer = http.createServer((req, res) => {
    if (req.url === '/programs/prog-123/proxy/watcher/watching-state') {
      const payload = JSON.stringify({
        watchedVars: ['btc_price'],
        variables: { btc_price: 70000 }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  hostServer.listen(0, '127.0.0.1');
  await startServer(hostServer);
  const hostPort = hostServer.address().port;

  const buyerPair = generateKeyPairSync('x25519');
  const requesterPubkey = buyerPair.publicKey.export({ format: 'jwk' }).x;
  const tokenSigningKey = 'gateway-test-signing-key';
  const wsServerRegistry = {
    'session-default': {
      id: 'session-default',
      mode: 'session',
      ws_url: 'ws://127.0.0.1:65534/upstream',
      default_ttl_sec: 600,
      max_ttl_sec: 3600
    }
  };

  const grant = buildEncryptedAccessGrant({
    jobId: 'job-123',
    programId: 'prog-123',
    accessRequest: {
      server_id: 'session-default',
      requester_x25519_pubkey: requesterPubkey,
      requested_endpoints: ['/watcher/watching-state'],
      session_ttl_sec: 600
    },
    wsServerRegistry,
    tokenIssuer: 'hershy-acp-seller',
    tokenSigningKey
  });

  const secret = decryptAccessGrantPayload({
    encryptedPayload: grant.encrypted_payload,
    recipientPrivateKey: buyerPair.privateKey
  });

  const gatewayServer = startResourceServer({
    port: 0,
    getHealth: () => ({ ok: true }),
    getCatalog: () => ({ ok: true }),
    getSample: () => ({ ok: true }),
    accessGateway: {
      enabled: true,
      tokenSigningKey,
      wsServerRegistry,
      hostBaseUrl: `http://127.0.0.1:${hostPort}`,
      hostApiToken: ''
    }
  });
  await startServer(gatewayServer);
  const gatewayPort = gatewayServer.address().port;

  const okResponse = await fetch(
    `http://127.0.0.1:${gatewayPort}/access/http/watcher/watching-state?access_token=${encodeURIComponent(secret.access_token)}`
  );
  assert.equal(okResponse.status, 200);
  const okBody = await okResponse.json();
  assert.deepEqual(okBody.variables, { btc_price: 70000 });

  const deniedResponse = await fetch(
    `http://127.0.0.1:${gatewayPort}/access/http/watcher/status?access_token=${encodeURIComponent(secret.access_token)}`
  );
  assert.equal(deniedResponse.status, 401);

  await closeServer(gatewayServer);
  await closeServer(hostServer);
});

test('resource server gateway serves session websocket endpoint with x25519 proof and expiry', async () => {
  const upstreamWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await startServer(upstreamWss);
  const upstreamPort = upstreamWss.address().port;
  upstreamWss.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      socket.send(data, { binary: isBinary });
    });
  });

  const wsServerRegistry = {
    'session-default': {
      id: 'session-default',
      mode: 'session',
      ws_url: `ws://127.0.0.1:${upstreamPort}/upstream`,
      default_ttl_sec: 600,
      max_ttl_sec: 3600
    }
  };

  const buyerPair = generateKeyPairSync('x25519');
  const requesterPubkey = buyerPair.publicKey.export({ format: 'jwk' }).x;
  const sessionStore = createAccessGatewaySessionStore();
  const issuedAtSec = Math.floor(Date.now() / 1000);
  sessionStore.registerSession({
    sessionId: 'sess-test-123',
    programId: 'prog-123',
    serverId: 'session-default',
    requestedEndpoints: ['/watcher/watching-state'],
    requesterX25519Pubkey: requesterPubkey,
    issuedAtSec,
    expiresAtSec: issuedAtSec + 3,
    gatewayWsUrl: 'ws://localhost/access/ws'
  });

  const gatewayServer = startResourceServer({
    port: 0,
    getHealth: () => ({ ok: true }),
    getCatalog: () => ({ ok: true }),
    getSample: () => ({ ok: true }),
    accessGateway: {
      enabled: true,
      tokenSigningKey: 'unused',
      wsServerRegistry,
      hostBaseUrl: 'http://127.0.0.1:0',
      hostApiToken: '',
      sessionStore
    }
  });
  await startServer(gatewayServer);
  const gatewayPort = gatewayServer.address().port;

  const wsUrl =
    `ws://127.0.0.1:${gatewayPort}` +
    '/access/ws/sess-test-123/watcher/watching-state';
  const socket = new WebSocket(wsUrl);
  await onceWsOpen(socket);

  const challenge = await onceWsMessage(socket);
  assert.equal(challenge.type, 'auth.challenge');

  const proof = buildWsAuthProof({
    recipientPrivateKey: buyerPair.privateKey,
    serverEphemeralPublicKey: challenge.server_ephemeral_public_key,
    nonce: challenge.nonce,
    sessionId: 'sess-test-123',
    endpoint: '/watcher/watching-state'
  });
  socket.send(
    JSON.stringify({
      type: 'auth.proof',
      proof
    })
  );

  const ready = await onceWsMessage(socket);
  assert.equal(ready.type, 'gateway.ready');
  assert.equal(ready.session_id, 'sess-test-123');

  socket.send(JSON.stringify({ type: 'ping' }));
  const echoed = await onceWsMessage(socket);
  assert.equal(echoed.type, 'ping');

  await new Promise((resolve) => setTimeout(resolve, 3400));
  if (socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
  await waitForWsClosed(socket);
  await expectWsHandshakeFailure(wsUrl);

  sessionStore.close();
  await closeServer(gatewayServer);
  await closeServer(upstreamWss);
});
