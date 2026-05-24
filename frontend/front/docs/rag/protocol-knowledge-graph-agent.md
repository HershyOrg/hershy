# Protocol Knowledge Graph Agent

Updated: 2026-05-22

This is the pre-research loop for building the protocol encyclopedia before strategy generation. It is separate from the local SQLite contract-card collector.

## Shape

The DB is an entity-centric hybrid retrieval graph:

- `entities`: canonical protocols, contracts, functions, events, chains, addresses.
- `artifacts`: raw evidence such as explorer source, ABI, docs, source files, traces.
- `knowledge_pages`: latest internal page for each retrievable unit.
- `knowledge_page_revisions`: immutable historical page bodies, including previous/superseded internal page addresses.
- `chunks`: AI-readable source/doc/ABI/summary chunks with PostgreSQL FTS and a legacy single embedding slot.
- `chunk_embeddings`: provider/model/dimension-specific pgvector embeddings for each chunk; use this for multi-model semantic search.
- `edges`: graph relations such as `HAS_CONTRACT`, `HAS_FUNCTION`, `EMITS`, `PROXY_TO_IMPLEMENTATION`, `DEPLOYED_ON`.
- `facts`: short evidence-backed statements for LLM context packs.
- `protocols`, `deployments`, `contract_symbols`, `contract_storage`, `onchain_events`, `contract_instances`: blockchain-specific normalized tables.
- `agent_research_tasks`, `agent_research_runs`: queue and run history for the pre-research loop.

Every retrievable page stores:

- `modified_at`: the content modification timestamp.
- `internal_uri`: the latest internal page address.
- `previous_internal_uri`: the previous revision address, like a previous git commit pointer.
- historical bodies in `knowledge_page_revisions`.

When a page changes, the previous revision is kept with `is_current=false`, `valid_to`, and `superseded_by_internal_uri`. The linked old chunks are also marked `is_current=false`, so default search returns the latest knowledge first while preserving historical evidence.

## Setup

PostgreSQL must have `pgvector` available.

```bash
KG_DATABASE_URL=postgres://postgres:postgres@localhost:5432/hershy_kg
ETHERSCAN_API_KEY=...
BASE_RPC_URL=https://your-base-rpc.example

# Optional local semantic embeddings
KG_EMBEDDING_PROVIDER=ollama
KG_OLLAMA_BASE_URL=http://localhost:11434
KG_EMBEDDING_MODEL=nomic-embed-text
KG_EMBEDDING_QUERY_PREFIX=
KG_EMBEDDING_DOCUMENT_PREFIX=

# Optional hosted alternative
OPENAI_API_KEY=...
```

Explorer lookups use Etherscan API V2 first:

```text
https://api.etherscan.io/v2/api
```

Base Mainnet is `chainid=8453`; Base Sepolia is `chainid=84532`. `BASESCAN_API_KEY` is still accepted as a local alias, but `ETHERSCAN_API_KEY` is the preferred env name for V2. The docs placeholder `YourApiKeyToken` is not a real key; replace it with your actual API key only in `.env.local` or another ignored secret store.

If a real API key or private RPC URL was exposed in chat, logs, or GitHub, delete it and rotate it before running the loop.

Supported EVM chain slugs for contract ingestion currently include:

- `ethereum`
- `base-mainnet`
- `arbitrum`
- `optimism`
- `polygon`
- `avalanche`
- `bsc`
- `gnosis`
- `scroll`
- `linea`
- `celo`
- `base-sepolia`

Apply schema:

```bash
npm run kg:migrate
```

## Top 100 Protocol Registry

Build a current DeFiLlama TVL-prioritized registry for address research:

```bash
npm run protocols:top100
```

This writes:

- `protocols/registries/defillama-top-100.json`
- `docs/rag/defillama-top-100-protocols.md`

Import the registry into the KG:

```bash
npm run protocols:import-registry
```

The import creates/updates:

- `protocols` and `entities` rows with `rank`, `primaryChain`, `chains`, `chainTvls`, and `addressResearchStatus`.
- one `knowledge_pages` row per protocol at `kg://protocols/<slug>/registry/defillama-candidate`.
- one current `protocol_registry_summary` chunk per protocol, ready for FTS and semantic embedding.

These records are candidates only. Their deployment addresses are intentionally marked `pending`; contract ingestion should only run after official deployment addresses are verified.

Build the Base-only registry, ranked by `chainTvls.Base` instead of total protocol TVL:

```bash
npm run protocols:base-top100
npm run protocols:import-registry -- --registry protocols/registries/defillama-base-top-100.json
```

This writes:

- `protocols/registries/defillama-base-top-100.json`
- `docs/rag/defillama-base-top-100-protocols.md`

The Base registry uses separate internal pages such as `kg://protocols/aave-v3/registry/defillama-base-candidate`, so it does not overwrite the global TVL registry page. Imported metadata includes `selectedChain: "Base"` and `selectedChainTvl`.

Embed the candidate summaries locally:

```bash
npm run kg:embed-backfill -- \
  --provider ollama \
  --model nomic-embed-text \
  --limit 150 \
  --batchSize 10
```

Then ensure the HNSW index exists:

```bash
npm run kg:embedding-index -- \
  --provider ollama \
  --model nomic-embed-text \
  --dimensions 768
```

## Queue-Based Pre-Research

Add a protocol seed:

```bash
npm run kg:enqueue -- \
  --protocol "Example Protocol" \
  --chain base-mainnet \
  --address 0x0000000000000000000000000000000000000000
```

Base Sepolia seeds use `--chain base-sepolia`.

Process queued work:

```bash
npm run kg:loop -- --once
```

For a batch:

```bash
npm run kg:loop -- --max-jobs 25
```

You can also ingest directly without queueing:

```bash
npm run kg:ingest -- \
  --protocol "Example Protocol" \
  --chain base-mainnet \
  --address 0x0000000000000000000000000000000000000000
```

## Config File

```json
{
  "protocol": "Example Protocol",
  "chain": "base-mainnet",
  "addresses": [
    "0x0000000000000000000000000000000000000000"
  ],
  "website": "https://example.org",
  "docsUrl": "https://docs.example.org",
  "githubUrl": "https://github.com/example/protocol",
  "category": "dex"
}
```

```bash
npm run kg:enqueue -- --config ./protocols/example.base.json
```

## Search

```bash
npm run kg:search -- --query "fee controller router pool"
```

The search command returns:

- exact entity hits,
- FTS chunk hits,
- graph neighbor edges around matched entities.

Inspect page history:

```bash
npm run kg:history -- --uri "kg://..."
```

or search histories by title/URI text:

```bash
npm run kg:history -- --query "SwapRouter summary"
```

## Loop Phases

Each `INGEST_PROTOCOL_SEED` task does:

1. Resolve protocol and chain entities.
2. Fetch BaseScan/Etherscan source and ABI for seed addresses.
3. Read EIP-1967 proxy slots, bytecode hash, and selected no-argument state getters through RPC.
4. Store raw artifacts and chunked evidence.
5. Extract ABI symbols and Solidity source chunks.
6. Upsert current knowledge pages and move replaced pages into historical revisions.
7. Upsert graph edges and evidence-backed facts.
8. Optionally embed chunks when `KG_EMBEDDING_PROVIDER=ollama` or `OPENAI_API_KEY` is configured.

## Local Embeddings

OpenAI API keys are not required for semantic vector search. Run a local embedding model through Ollama:

```bash
ollama pull nomic-embed-text
KG_EMBEDDING_PROVIDER=ollama
KG_OLLAMA_BASE_URL=http://localhost:11434
KG_EMBEDDING_MODEL=nomic-embed-text
```

Then embedded chunks will store one row per model in `chunk_embeddings`:

- `chunk_id`
- `provider`
- `model`
- `dimensions`
- `embedding`

`kg:search` embeds the query with the same provider/model and only compares `chunk_embeddings` rows with matching dimensions. This avoids mixing OpenAI 1536-dimensional vectors with local 384/768/1024-dimensional vectors. The legacy columns on `chunks` may mirror the latest/default embedding, but enterprise-style A/B tests should use `chunk_embeddings`.

Built-in prefix profiles:

- `nomic-*`: query `search_query: `, document `search_document: `
- `mxbai-*`: query `Represent this sentence for searching relevant passages: `, document empty
- `bge-*`: query `Represent this sentence for searching relevant passages: `, document empty
- `e5-*`: query `query: `, document `passage: `
- `qwen3-embedding*`: no default prefix; override with `KG_EMBEDDING_QUERY_PREFIX` / `KG_EMBEDDING_DOCUMENT_PREFIX` if your benchmark needs one

Recommended first setup:

```bash
ollama pull nomic-embed-text
KG_EMBEDDING_PROVIDER=ollama
KG_EMBEDDING_MODEL=nomic-embed-text
```

Benchmark alternatives:

```bash
ollama pull mxbai-embed-large
ollama pull qwen3-embedding:0.6b
```

Backfill missing embeddings for a model and create a per-model HNSW index after you know the stored dimension:

```bash
npm run kg:embed-backfill -- \
  --provider ollama \
  --model nomic-embed-text \
  --all \
  --batchSize 10

npm run kg:embedding-index -- \
  --provider ollama \
  --model nomic-embed-text \
  --dimensions 768
```

Use `--limit 100` only for a small smoke test. Use `--all` for a full backfill. Backfill is intentionally separate from ingestion so source/ABI evidence can be stored quickly and embeddings can run in recoverable batches.

## Agent Rules

- Start retrieval from `entities`, then expand through `edges`, then fetch `chunks` and `artifacts` as evidence.
- Default retrieval should filter `chunks.is_current=true` and order by relevance, then `modified_at DESC`.
- Historical retrieval should explicitly query `knowledge_page_revisions` or `chunks.is_current=false`.
- Use vector search as a semantic supplement, not the source of truth.
- Treat `facts` as answer-ready claims only when evidence chunks are present or confidence is high.
- Keep graph expansion depth bounded: default 1-2 hops, architecture analysis 2-3 hops.
