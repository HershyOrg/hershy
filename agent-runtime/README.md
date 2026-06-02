# Hershy Agent Runtime

This folder owns the non-UI agent loop, research, RAG, KG, protocol registry, and agent workflow tooling that used to live under `front`.

Frontend code should call this runtime through HTTP and exchange only DTO payloads such as strategy graph results. The frontend repo should not import these modules directly.

Moved from `front`:

- `server/agentic*.mjs`
- `server/protocolKnowledgeGraphLoop.mjs`
- `server/evmProtocolKnowledge.mjs`
- `server/agentic_strategy_loop_py/`
- `scripts/`
- `db/migrations/`
- `protocols/`
- `docs/rag/`
- `requirements.txt`
- `legacy-go-bot/`
- agent loop overview docs

The frontend adapter looks for:

```bash
AGENT_RUNTIME_BASE_URL=http://localhost:<runtime-port>
```

For frontend-only development, use the mock server:

```bash
npm run dev:mock
```
