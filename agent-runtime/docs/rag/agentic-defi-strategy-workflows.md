# Agentic DeFi Strategy Workflows

Updated: 2026-05-23

This layer makes the protocol KG usable as a search engine inside a strategy agent loop. The key idea is that the agent should not improvise a workflow from scratch. It should select a workflow contract first, then derive the capabilities required to implement that contract.

```text
User intent
  -> strategy workflow planner
  -> execution domain router
  -> web strategy discovery
  -> implementation research plan
  -> on-chain / DB / API research
  -> evidence bundle
  -> AI contract reasoning analysis
  -> deterministic Hershy workflow graph
  -> optional live market state reads / solver modules
  -> Hershy workflow / strategy graph
```

## Planner

The planner lives in:

```text
server/strategyWorkflowAlgorithms.mjs
server/agentic_strategy_loop_py/native_langgraph.py
server/agenticWebResearch.mjs
scripts/strategy-workflow-planner.mjs
scripts/agentic-strategy-loop.mjs
```

Smoke test:

```bash
npm run strategy:workflow-plan -- \
  --prompt "Base에서 BTC ETH 유동성 공급하고 싶어. 최적 풀 찾아줘"
```

Run the full agentic loop:

```bash
npm run strategy:agent-loop -- \
  --prompt "Base에서 BTC ETH 유동성 공급하고 싶어. 최적 풀 찾아줘"
```

The full loop returns:

- the selected algorithm contract,
- the execution domain router decision,
- web discovery results used to concretize the strategy,
- implementation research tasks for KG/on-chain/API/docs,
- KG research results when the domain needs onchain evidence,
- an evidence bundle with internal KG page URIs,
- web/API source evidence,
- a Hershy `hershy-strategy-graph`,
- validator output from `examples/strategy-runner`.
- a `persistence` result with the saved `workflow_run`, `workflow_plan`, and `workflow_graph` IDs when `AGENT_WORKFLOW_PERSIST_RUNS=true`.

Web discovery is enabled by default:

```bash
npm run strategy:agent-loop -- \
  --prompt "Base에서 컨트랙트 분석해서 리스크 체크 워크플로우 만들어줘" \
  --web-provider duckduckgo
```

Production search providers can be configured with:

```text
AGENT_WEB_SEARCH_PROVIDER=brave|tavily|serper|duckduckgo
BRAVE_SEARCH_API_KEY=...
TAVILY_API_KEY=...
SERPER_API_KEY=...
```

The output is a JSON contract with:

- `selectedAlgorithm`: the strategy algorithm to follow.
- `executionDomain`: `cex_only`, `onchain_only`, or `hybrid_cex_onchain`.
- `intent`: chain, asset groups, risk profile, amount hints.
- `algorithmContract`: deterministic steps and forbidden shortcuts.
- `researchTasks`: KG searches the agent should run.
- `capabilityPlan`: open-ended capabilities the workflow needs, without forcing venue-specific labels.
- `adaptiveLabels`: per-run labels generated from the user prompt, web results, source domains, and implementation candidates.
- `toolContract`: tool functions the agent is allowed/expected to call.
- `workflow`: ordered phases.
- `scoringModel`: transparent ranking/profit formula.
- `outputSpec`: required final answer/workflow shape.

## Current Algorithms

### Generic Agentic Workflow

Used when no specialized trading/DeFi workflow matches.

Required flow:

```text
intent parsing
-> web strategy discovery
-> implementation research plan
-> optional context retrieval from KG/on-chain/API/docs
-> workflow contract
-> logic IR
-> optional monitoring/execution boundary
-> validation and safety
-> Hershy runtime graph
```

This is the default fallback. The agent loop must not assume CEX, DEX, or blockchain behavior unless the prompt or caller-selected execution domain requires it.

## Execution Domains

The planner routes the request into a broad execution domain, then builds a capability plan. The capability plan is deliberately open-ended so the agent is not forced into a fixed venue label too early.

```text
cex_only
  -> CEX market data, account state, order execution, risk monitor

onchain_only
  -> protocol KG, RPC/indexer state, solver, wallet execution

hybrid_cex_onchain
  -> centralized venue tools + protocol KG/RPC tools + cross-venue solver

general_automation
  -> generic workflow state, tool planning, validation, approval gate, risk monitor
```

Do not use fixed venue labels as reasoning gates. Venue/protocol-specific adapters should be selected later from evidence. The planner should emit stable internal capabilities for validation, then attach per-run `adaptiveLabels` generated from the prompt and web/KG/API evidence.

Example:

```text
Stable capability:
  liquidity_market_discovery

Adaptive labels for one run:
  Base
  BTC
  ETH
  Aerodrome docs
  docs.aerodrome.finance
  liquidity pool
  gauge
```

The stable capability lets code validate the workflow. The adaptive labels let the agent reason in terms of the current task instead of a fixed taxonomy.

## Run Persistence

Agentic workflow runs are persisted to the KG Postgres DB by default:

```text
AGENT_WORKFLOW_PERSIST_RUNS=true
```

The MVP persistence schema stores:

```text
workflow_runs
workflow_evidence
adaptive_labels
label_clusters
entity_label_links
capabilities
capability_label_links
workflow_research_tasks
tool_candidates
adapter_selections
workflow_plans
workflow_graphs
```

The current loop writes an end-of-run snapshot: prompt, initial/final workflow plan, web/API/KG evidence, adaptive labels, capability links, research tasks, tool candidates, provisional adapter selections, the generated graph, and validation output. Later this can become event-sourced with per-phase writes.

Adapter selections in the MVP are provisional: they record the best current candidate for a capability, but do not imply live execution. Execution-capable adapters still need probe results, fresh evidence, policy checks, and user approval.

Contract reasoning is handled by a run-scoped AI reasoning layer when contract evidence exists:

```text
AGENT_CONTRACT_REASONING_ENABLED=true
AI_CONTRACT_REASONING_PROVIDER=deepseek|ollama|gemini|openai
AI_CONTRACT_REASONING_MODEL=...
```

The reasoning worker reads only the supplied KG/web/API evidence and writes `agent_reasoning_contract_analysis` records into the workflow run trace. It does not mutate canonical KG entities, pages, chunks, facts, or edges. Promotion into KG must be handled by a separate curation/ingestion loop.

It summarizes contract role, admin/governance, proxy/upgradeability, fees/caps/leverage/pause, oracle/feed hints, asset flow, strategy relevance, risks, and unknowns. It must mark unproven facts as unknown instead of inventing them.

Trace the saved runs with:

```bash
npm run strategy:trace -- list
npm run strategy:trace -- show --run-id <workflow_run_id>
npm run strategy:trace -- evidence --run-id <workflow_run_id>
npm run strategy:trace -- reasoning --run-id <workflow_run_id>
npm run strategy:trace -- labels --run-id <workflow_run_id>
npm run strategy:trace -- adapters --run-id <workflow_run_id>
```

The trace views are:

- Run History: recent `workflow_runs`, prompts, statuses, and saved trace counts.
- Evidence Trace: `workflow_evidence` records used by the run, including web/KG/API source URIs and previous internal URIs when available.
- Reasoning Trace: run-scoped AI judgments produced from evidence; these are not canonical KG writes.
- Label Trace: `adaptive_labels` generated from the prompt and evidence for that one run.
- Adapter Decision Trace: `adapter_selections`, showing which tool candidate was selected for each capability and why.

### DEX LP Pool Selection

Used for prompts like:

```text
BTC ETH 유동성 공급하고 싶어
Base에서 좋은 LP 풀 찾아줘
```

Required flow:

```text
intent parsing
-> KG DEX/token retrieval
-> pool discovery from factories/events
-> live state reads
-> score/rank pools
-> deposit/stake/monitor/rebalance/exit workflow
```

The LLM must not rank pools from names alone. Pool quality must come from live state and evidence.

### DEX Arbitrage Scan

Used for prompts like:

```text
Base DEX 아비트라지 찾아줘
WETH/USDC/cbBTC 차익 기회 찾아줘
```

Required flow:

```text
token universe
-> KG router/quoter/factory retrieval
-> live token-pool graph
-> bounded path/cycle search
-> quote/simulation/gas filter
-> execution workflow with stale-block guard
```

The LLM must not decide profitability. Profitability must come from quotes/simulation/gas math.

### Yield Allocator

Used for prompts like:

```text
Base에서 USDC 수익률 좋은 곳 찾아줘
ETH 예치 수익률 비교해줘
```

Required flow:

```text
asset/risk parsing
-> KG yield market retrieval
-> live APR/cap/liquidity/pause/oracle/admin reads
-> risk-adjusted ranking
-> deposit/claim/exit workflow
```

### Scheduled DCA

Used for prompts like:

```text
매일 100달러씩 BTC 사줘
weekly ETH DCA
```

Required flow:

```text
cadence and asset parsing
-> init capital readiness
-> time trigger
-> scheduled order execution
-> fill/risk monitoring
```

The cadence must be represented as a time trigger, not an `eventTime % interval` formula node.

## Server Integration

`server.mjs` now injects `strategyWorkflowPlan` into the orchestration plan. The strategy generation prompt receives an explicit “Algorithmic strategy workflow contract” section.

Current boundary:

```text
The agent loop now materializes the workflow algorithm as a Hershy graph.
Live readers, pool rankers, arbitrage solvers, and execution adapters remain submodules.
The graph can reference those phases before their runtime engines are implemented.
```

Hard rule:

```text
LLM = planner/explainer/workflow assembler
KG = protocol and contract evidence search
live tools = current state
solver/ranker = numbers and opportunity decisions
```

If a required live-state or solver tool is missing, the agent should return an incomplete-workflow report instead of pretending a final recommendation is available.
