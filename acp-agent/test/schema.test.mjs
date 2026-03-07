import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRequirement, validateDeliverable } from '../src/schemas.mjs';

test('parseRequirement accepts a valid template requirement', () => {
  const parsed = parseRequirement(
    {
      mode: 'template',
      template: 'simple-counter',
      user_id: 'buyer-1',
      auto_start: true,
      wait_ready: true,
      ready_timeout_sec: 300,
      access: {
        server_id: 'session-default',
        requester_x25519_pubkey: 'CATEStRT-G5BC05cAzZq2yYolc2Xih3MBSirLSk9YAE',
        requested_endpoints: ['/watcher/watching-state'],
        session_ttl_sec: 600
      }
    },
    {
      defaultTemplate: 'simple-counter',
      autoStartDefault: true,
      waitReadyDefault: true,
      readyTimeoutSecDefault: 300
    }
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.requirement.template, 'simple-counter');
});

test('parseRequirement rejects unknown template', () => {
  const parsed = parseRequirement(
    {
      mode: 'template',
      template: 'unknown-template',
      user_id: 'buyer-1',
      auto_start: true,
      wait_ready: true,
      ready_timeout_sec: 300,
      access: {
        server_id: 'session-default',
        requester_x25519_pubkey: 'CATEStRT-G5BC05cAzZq2yYolc2Xih3MBSirLSk9YAE',
        requested_endpoints: ['/watcher/watching-state'],
        session_ttl_sec: 600
      }
    },
    {
      defaultTemplate: 'simple-counter',
      autoStartDefault: true,
      waitReadyDefault: true,
      readyTimeoutSecDefault: 300
    }
  );

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /template/);
});

test('validateDeliverable accepts expected payload shape', () => {
  const validation = validateDeliverable({
    version: '1.0.0',
    status: 'ready',
    request: {
      mode: 'template',
      template: 'simple-counter',
      user_id: 'buyer-1',
      auto_start: true,
      wait_ready: true,
      ready_timeout_sec: 300,
      src_file_count: 3
    },
    program: {
      program_id: 'buyer-1-build-abc-1234abcd',
      build_id: 'build-abc',
      state: 'Ready',
      proxy_url: 'http://localhost:19001',
      image_id: '',
      container_id: '',
      error_msg: ''
    },
    links: {
      status_url: 'http://localhost:9000/programs/buyer-1-build-abc-1234abcd',
      logs_url: 'http://localhost:9000/programs/buyer-1-build-abc-1234abcd/logs',
      source_url: 'http://localhost:9000/programs/buyer-1-build-abc-1234abcd/source',
      watcher_proxy_base:
        'http://localhost:9000/programs/buyer-1-build-abc-1234abcd/proxy/watcher',
      stop_url: 'http://localhost:9000/programs/buyer-1-build-abc-1234abcd/stop',
      restart_url:
        'http://localhost:9000/programs/buyer-1-build-abc-1234abcd/restart'
    },
    access: {
      server_id: 'session-default',
      server_mode: 'session',
      requested_endpoints: ['/watcher/watching-state'],
      session_ttl_sec: 600,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      encrypted_payload: {
        alg: 'X25519-HKDF-SHA256-AES-256-GCM',
        key_format: 'x25519-raw-base64url',
        ephemeral_public_key: 'CATEStRT-G5BC05cAzZq2yYolc2Xih3MBSirLSk9YAE',
        salt: 'AAAAAAAAAAAAAAAAAAAAAA',
        iv: 'AAAAAAAAAAAAAAAA',
        aad: 'eyJ2IjoxfQ',
        ciphertext: 'AAECAw',
        tag: 'AAECAwQFBgcICQoLDA0ODw'
      },
      checksums: {
        encrypted_payload_sha256:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      }
    },
    checksums: {
      requirement_sha256: 'abc',
      source_sha256: 'def'
    },
    timestamps: {
      created_at: new Date().toISOString(),
      delivered_at: new Date().toISOString()
    }
  });

  assert.equal(validation.ok, true);
});

test('parseRequirement rejects requirement without access object', () => {
  const parsed = parseRequirement(
    {
      mode: 'template',
      template: 'simple-counter',
      user_id: 'buyer-1',
      auto_start: true,
      wait_ready: true,
      ready_timeout_sec: 300
    },
    {
      defaultTemplate: 'simple-counter',
      autoStartDefault: true,
      waitReadyDefault: true,
      readyTimeoutSecDefault: 300
    }
  );

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /access/);
});
