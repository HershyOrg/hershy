import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  buildWsAuthProof,
  buildEncryptedAccessGrant,
  decryptAccessGrantPayload,
  isEndpointAllowed,
  validateAndNormalizeAccessRequest,
  verifyAccessToken
} from '../src/accessGrant.mjs';

const wsServerRegistry = {
  'persistent-default': {
    id: 'persistent-default',
    mode: 'persistent',
    ws_url: 'wss://stream.example.com/ws/live',
    default_ttl_sec: 0,
    max_ttl_sec: 0
  },
  'session-default': {
    id: 'session-default',
    mode: 'session',
    ws_url: 'wss://stream.example.com/ws/session',
    default_ttl_sec: 600,
    max_ttl_sec: 3600
  }
};

test('validateAndNormalizeAccessRequest rejects unknown server_id', () => {
  const validation = validateAndNormalizeAccessRequest(
    {
      server_id: 'missing-server',
      requester_x25519_pubkey: 'CATEStRT-G5BC05cAzZq2yYolc2Xih3MBSirLSk9YAE',
      requested_endpoints: ['/watcher/watching-state']
    },
    { wsServerRegistry }
  );

  assert.equal(validation.ok, false);
  assert.match(validation.error, /unknown access.server_id/);
});

test('buildEncryptedAccessGrant creates decryptable access envelope', () => {
  const buyerPair = generateKeyPairSync('x25519');
  const buyerPub = buyerPair.publicKey.export({ format: 'jwk' }).x;

  const grant = buildEncryptedAccessGrant({
    jobId: 'job-123',
    programId: 'prog-123',
    accessRequest: {
      server_id: 'session-default',
      requester_x25519_pubkey: buyerPub,
      requested_endpoints: ['/watcher/watching-state', '/watcher/varState/btc_price'],
      session_ttl_sec: 900
    },
    wsServerRegistry,
    tokenIssuer: 'hershy-acp-seller',
    tokenSigningKey: 'test-secret-signing-key'
  });

  assert.equal(grant.server_mode, 'session');
  assert.equal(grant.session_ttl_sec, 900);
  assert.equal(grant.requested_endpoints.length, 2);
  assert.ok(grant.encrypted_payload.ciphertext.length > 0);

  const secret = decryptAccessGrantPayload({
    encryptedPayload: grant.encrypted_payload,
    recipientPrivateKey: buyerPair.privateKey
  });

  assert.equal(secret.program_id, 'prog-123');
  assert.equal(secret.server_id, 'session-default');
  assert.equal(secret.ws_url, 'wss://stream.example.com/ws/session');
  assert.equal(secret.requested_endpoints.length, 2);
  assert.ok(secret.access_token.startsWith('v1.'));

  const claims = verifyAccessToken(secret.access_token, {
    tokenSigningKey: 'test-secret-signing-key'
  });
  assert.equal(claims.program_id, 'prog-123');
  assert.equal(claims.server_id, 'session-default');
  assert.equal(claims.endpoints.length, 2);
});

test('validateAndNormalizeAccessRequest rejects session_ttl_sec on persistent server', () => {
  const buyerPair = generateKeyPairSync('x25519');
  const buyerPub = buyerPair.publicKey.export({ format: 'jwk' }).x;

  const validation = validateAndNormalizeAccessRequest(
    {
      server_id: 'persistent-default',
      requester_x25519_pubkey: buyerPub,
      requested_endpoints: ['/watcher/watching-state'],
      session_ttl_sec: 300
    },
    { wsServerRegistry }
  );

  assert.equal(validation.ok, false);
  assert.match(validation.error, /only valid for session servers/);
});

test('isEndpointAllowed supports exact and prefix wildcard', () => {
  assert.equal(
    isEndpointAllowed(
      ['/watcher/watching-state', '/watcher/varState/*'],
      '/watcher/watching-state'
    ),
    true
  );
  assert.equal(
    isEndpointAllowed(
      ['/watcher/watching-state', '/watcher/varState/*'],
      '/watcher/varState/btc_price'
    ),
    true
  );
  assert.equal(
    isEndpointAllowed(
      ['/watcher/watching-state', '/watcher/varState/*'],
      '/watcher/status'
    ),
    false
  );
});

test('buildEncryptedAccessGrant registers gateway session ws url', () => {
  const buyerPair = generateKeyPairSync('x25519');
  const buyerPub = buyerPair.publicKey.export({ format: 'jwk' }).x;
  let registrarArgs = null;

  const grant = buildEncryptedAccessGrant({
    jobId: 'job-456',
    programId: 'prog-456',
    accessRequest: {
      server_id: 'session-default',
      requester_x25519_pubkey: buyerPub,
      requested_endpoints: ['/watcher/watching-state'],
      session_ttl_sec: 600
    },
    wsServerRegistry,
    tokenIssuer: 'hershy-acp-seller',
    tokenSigningKey: 'test-secret-signing-key',
    gatewayWsUrl: 'wss://seller.example.com/access/ws',
    gatewaySessionRegistrar: (args) => {
      registrarArgs = args;
      return {
        session_id: args.grantId,
        ws_url: `wss://seller.example.com/access/ws/${args.grantId}`,
        http_url: null
      };
    }
  });

  assert.ok(registrarArgs);
  assert.equal(registrarArgs.serverId, 'session-default');
  assert.equal(registrarArgs.requestedEndpoints.length, 1);

  const secret = decryptAccessGrantPayload({
    encryptedPayload: grant.encrypted_payload,
    recipientPrivateKey: buyerPair.privateKey
  });
  assert.equal(secret.ws_url, `wss://seller.example.com/access/ws/${secret.grant_id}`);
  assert.equal(secret.ws_session.session_id, secret.grant_id);
  assert.equal(secret.ws_auth.mode, 'x25519-challenge-v1');
});

test('buildWsAuthProof generates deterministic proof from challenge', () => {
  const buyerPair = generateKeyPairSync('x25519');
  const serverEphemeral = generateKeyPairSync('x25519');
  const nonce = 'AAAAAAAAAAAAAAAAAAAAAA';

  const proofA = buildWsAuthProof({
    recipientPrivateKey: buyerPair.privateKey,
    serverEphemeralPublicKey: serverEphemeral.publicKey.export({ format: 'jwk' }).x,
    nonce,
    sessionId: 'session-1',
    endpoint: '/watcher/watching-state'
  });

  const proofB = buildWsAuthProof({
    recipientPrivateKey: buyerPair.privateKey,
    serverEphemeralPublicKey: serverEphemeral.publicKey.export({ format: 'jwk' }).x,
    nonce,
    sessionId: 'session-1',
    endpoint: '/watcher/watching-state'
  });

  assert.equal(proofA, proofB);
  assert.ok(proofA.length > 20);
});
