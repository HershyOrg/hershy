# EVM Protocol Knowledge RAG

Updated: 2026-05-22

This pack lets the agent build a local protocol-level knowledge base from Base Mainnet or Base Sepolia proxy/contract addresses.

## What It Stores

- Protocol dossier markdown for strategy planning.
- Contract cards for proxy slots, implementation links, ABI surfaces, state reads, risks, and keywords.
- SQLite tables for protocols, contracts, versions, source files, proxy snapshots, ABI items, state snapshots, documents, and alerts.
- FTS search rows for protocol and contract cards.

## Required Inputs

Set secrets in `.env.local`:

```bash
ETHERSCAN_API_KEY=...
BASE_RPC_URL=https://your-base-rpc.example
```

`BASESCAN_API_KEY` is also accepted as a local alias for older BaseScan-style env setups. The preferred explorer path is Etherscan API V2:

```text
https://api.etherscan.io/v2/api?chainid=8453
```

Base Mainnet uses `chainid=8453`; Base Sepolia uses `chainid=84532`. The string `YourApiKeyToken` in Etherscan docs is only an example placeholder. `API Key Token` means your real API key string.

If a real API key or private RPC URL was exposed in chat, logs, or GitHub, delete it and rotate it before using this collector.

The ingestion code tries Etherscan V2 first and falls back to the legacy BaseScan-compatible endpoint.

## Ingest A Protocol

```bash
npm run evm:protocol-ingest -- \
  --protocol "Example Protocol" \
  --chain base-mainnet \
  --address 0x0000000000000000000000000000000000000000
```

For Base Sepolia, use:

```bash
npm run evm:protocol-ingest -- \
  --protocol "Example Protocol" \
  --chain base-sepolia \
  --address 0x0000000000000000000000000000000000000000
```

Multiple roots can be passed by repeating `--address` or by using a config file:

```json
{
  "protocol": "Example Protocol",
  "chain": "base-mainnet",
  "addresses": [
    "0x0000000000000000000000000000000000000000"
  ]
}
```

```bash
npm run evm:protocol-ingest -- --config ./protocols/example.base.json
```

## Search

```bash
npm run evm:protocol-search -- --query "oracle pause max leverage"
```

## Update Alerts

Rerun ingestion on a schedule. If proxy implementation, proxy admin, bytecode, source, ABI, or implementation references change, rows are added to `alerts`.

```bash
npm run evm:protocol-alerts -- --limit 20
```

## Agent Rules

- Treat the protocol dossier as the primary artifact.
- Treat contract cards as exact references for functions, events, proxy slots, state reads, and risks.
- If an alert exists for a protocol, re-run analysis before generating live execution strategies.
- Do not use unverified or failed source fetches as certified execution knowledge without review.
