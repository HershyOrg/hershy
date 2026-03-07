# Hershy ACP Seller Integration

This directory adds an ACP Seller runtime that sells Hershy program instances.

When an ACP buyer creates a paid job, the seller:
1. Validates requirement JSON in `REQUEST` phase.
2. Accepts or rejects the job.
3. In `TRANSACTION` phase, provisions a Hershy program through Host API.
4. Delivers program metadata and lifecycle links via `job.deliver(...)`.

## Why Node SDK

`codex/ACP.md` suggests Python first, but this repo integration uses the official Node package `@virtuals-protocol/acp-node` so the runtime can be executed directly in this workspace.

## Directory

```text
acp-agent/
  src/
    main.mjs
    config.mjs
    seller.mjs
    hostClient.mjs
    templates.mjs
    schemas.mjs
    resourceServer.mjs
  offerings/
    hershy-program-instance-job.json
    hershy-resource-offerings.json
  buyer_test/
    buyer.mjs
  test/
    schema.test.mjs
    templates.test.mjs
  ops/
    docker-compose.yml
    systemd.service
```

## Prerequisites

- Node.js 20+
- Running Hershy Host API (`http://localhost:9000` by default)
- ACP Seller agent created in Virtuals ACP registry
- Seller wallet/session key already whitelisted in ACP

## Install

```bash
cd acp-agent
npm install
```

## Environment

Copy and edit:

```bash
cp .env.example .env
```

Required values:

- `WHITELISTED_WALLET_PRIVATE_KEY`: private key for whitelisted dev wallet
- `ACP_SESSION_ENTITY_KEY_ID`: numeric session entity key id
- `SELLER_AGENT_WALLET_ADDRESS`: seller agent wallet address
- `HERSHY_HOST_URL`: Hershy Host API URL (default `http://localhost:9000`)
- `HERSHY_HOST_API_TOKEN`: token that must match Host server token (recommended)

Optional:

- `ACP_NETWORK`: `base-sepolia` (default) or `base`
- `ACP_DEFAULT_TEMPLATE`: default template when buyer omits `template`
- `ACP_ALLOW_CUSTOM_SOURCE`: allow buyer-supplied source code (`false` by default)
- `ACP_RESOURCE_PORT`: local resource endpoint server port (`0` to disable)
- `ACP_WS_SERVER_REGISTRY_JSON`: JSON registry for access servers (overrides default ws envs)
- `ACP_PERSISTENT_WS_URL`: default always-on ws endpoint (`persistent-default`)
- `ACP_SESSION_WS_URL`: default session ws endpoint (`session-default`)
- `ACP_ACCESS_SESSION_DEFAULT_TTL_SEC`: default session ttl seconds (default: `900`)
- `ACP_ACCESS_SESSION_MAX_TTL_SEC`: max session ttl seconds (default: `3600`)
- `ACP_ACCESS_TOKEN_SIGNING_KEY`: optional HMAC key used to sign access token embedded in encrypted payload
- `ACP_ACCESS_TOKEN_ISSUER`: token issuer claim (default: `hershy-acp-seller`)
- `ACP_ACCESS_GATEWAY_ENABLE`: enable token-verifying gateway on resource server (`false` default)
- `ACP_ACCESS_GATEWAY_WS_URL`: public websocket gateway URL to embed in deliverable secret
- `ACP_ACCESS_GATEWAY_HTTP_URL`: public HTTP gateway base URL for query endpoints

## Run Seller

```bash
npm run start
```

## Locked-Down Access (Recommended)

Run Host API with bind+token so only your agent can access:

```bash
HERSHY_HOST_API_TOKEN='<long-random-token>' \
go run host/cmd/main.go -port 9000 -bind 127.0.0.1 -api-token '<long-random-token>'
```

Then set the same token in `acp-agent/.env`:

```bash
HERSHY_HOST_URL=http://localhost:9000
HERSHY_HOST_API_TOKEN=<long-random-token>
```

For VPS-to-local topology, bind Host to your private tunnel IP (Tailscale/WireGuard), not `0.0.0.0`.

## ACP Offering Schema

Use `offerings/hershy-program-instance-job.json` when creating/importing a job offering.

Requirement shape (summary):

```json
{
  "mode": "template",
  "template": "simple-counter",
  "user_id": "buyer-123",
  "auto_start": true,
  "wait_ready": true,
  "ready_timeout_sec": 300,
  "access": {
    "server_id": "session-default",
    "requester_x25519_pubkey": "<buyer-x25519-pubkey-base64url>",
    "requested_endpoints": ["/watcher/watching-state", "/watcher/varState/btc_price"],
    "session_ttl_sec": 600
  }
}
```

Supported templates:

- `simple-counter`
- `watcher-server`
- `trading-long`

Deliverable includes:

- `program.program_id`, `build_id`, `state`, `proxy_url`
- Host lifecycle links (`status_url`, `logs_url`, `source_url`, `watcher_proxy_base`)
- `access`: encrypted websocket access grant (`X25519-HKDF-SHA256-AES-256-GCM`)
- Requirement/source checksums for traceability

## Access Gateway (Token Verification)

If you enable `ACP_ACCESS_GATEWAY_ENABLE=true`, the existing resource server process also exposes:

- `GET/POST /access/http/{endpoint-path}`: validates token signature/expiry/scope then proxies to Host watcher endpoint
- `WS /access/ws?endpoint=/...&access_token=...`: validates token and relays websocket stream to configured upstream server (legacy mode)
- `WS /access/ws/{sessionId}/{endpoint-path}`: per-deliverable websocket endpoint with X25519 challenge auth
- `GET /access/validate`: quick token/endpoint validation probe

No extra process is needed. The gateway runs on the same `ACP_RESOURCE_PORT`.

### Session WS lifecycle

When gateway is enabled and seller issues an access grant:

1. Seller creates a dedicated websocket session endpoint (`/access/ws/{sessionId}/...`) for that grant.
2. Endpoint metadata is encrypted to buyer using buyer `requester_x25519_pubkey`.
3. Buyer connects to endpoint path for a specific stream (example: `/watcher/varState/btc_price`).
4. Gateway sends `auth.challenge` with nonce + ephemeral X25519 key.
5. Buyer replies with `auth.proof` built from buyer private key.
6. Gateway relays data only after proof verification.
7. At expiry, session endpoint is removed and active sockets are closed.

This means endpoint URL alone is not enough; client must prove possession of the X25519 private key paired with `requester_x25519_pubkey`.

### Buyer request flow after program is ready

After buyer receives `deliverable`, decrypt `deliverable.access.encrypted_payload` using buyer X25519 private key.

Decrypted secret contains:

- `ws_url`: base session ws URL (example: `wss://seller.example.com/access/ws/<sessionId>`)
- `requested_endpoints`: allowed endpoint list
- `ws_auth.mode`: `x25519-challenge-v1`
- `expires_at`: session expiry

To request a specific stream endpoint:

1. connect to: `ws_url + "/watcher/watching-state"` (or any allowed endpoint)
2. receive server message:

```json
{
  "type": "auth.challenge",
  "nonce": "...",
  "server_ephemeral_public_key": "...",
  "session_id": "...",
  "endpoint": "/watcher/watching-state"
}
```

3. generate proof from buyer private key and send:

```json
{
  "type": "auth.proof",
  "proof": "<base64url-hmac>"
}
```

Use helper `buildWsAuthProof(...)` from `src/accessGrant.mjs` to build this value.

4. after `gateway.ready`, stream starts relaying from upstream watcher WS.

## Resource Endpoints

If `ACP_RESOURCE_PORT > 0`:

- `GET /resources/health`
- `GET /resources/catalog`
- `GET /resources/sample`

Use `offerings/hershy-resource-offerings.json` as reference metadata for ACP resource offerings.

## Buyer E2E Smoke Script

`buyer_test/buyer.mjs` is an optional script for sandbox verification.

Required buyer env vars:

- `BUYER_WHITELISTED_WALLET_PRIVATE_KEY`
- `BUYER_SESSION_ENTITY_KEY_ID`
- `BUYER_AGENT_WALLET_ADDRESS`
- `SELLER_AGENT_WALLET_ADDRESS`

Run:

```bash
node buyer_test/buyer.mjs
# or with custom requirement file
node buyer_test/buyer.mjs ./path/to/requirement.json
```

## Tests

```bash
npm test
npm run check
```

## Notes

- `onEvaluate` is intentionally omitted for auto-approval flow.
- Transaction processing is idempotent per `job.id` to avoid duplicate provisioning.
- Custom source provisioning is disabled by default for safety.
