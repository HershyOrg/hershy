# Agentic Workflow Dynamic Labeling Question

Updated: 2026-05-23

## Short Summary

I am building an agent loop for Hershy that takes a user prompt, researches the web, searches an internal protocol/contract knowledge graph, inspects APIs/on-chain/DB evidence, and then generates an executable or approval-gated workflow graph.

The key design problem is:

```text
If I hard-code labels like dex_submodule, dex_lp_pool_selection, cex_only, or yield_allocator too early,
the agent's reasoning can become fixed around those categories.

Instead, I want the agent to create the right labels dynamically for each user request,
based on the prompt, web search results, KG evidence, API/docs sources, and discovered implementation targets.
```

I want advice on how to design this properly.

## Product Context

The system is called Hershy.

The goal is to let users describe workflows or trading/automation intents in natural language, for example:

```text
Base에서 BTC ETH 유동성 공급하고 싶어. 최적의 풀 찾아줘.

Base에서 컨트랙트 분석해서 리스크 체크 워크플로우 만들어줘.

매일 아침 시장 리서치 보고서 만들어서 알림 보내줘.

Binance와 Base 온체인 시장 사이에서 가격 차이를 감시하고 싶어.
```

The agent should not immediately execute anything. It should:

```text
1. Interpret the user prompt.
2. Search the web to concretize the strategy/workflow.
3. Discover relevant docs, APIs, protocols, contracts, and data sources.
4. Search an internal Entity-centric Hybrid Retrieval Graph / KG.
5. Research on-chain, DB, and API evidence as needed.
6. Build an evidence bundle.
7. Generate a Hershy workflow graph.
8. Keep the graph in draft/paper/user-approved state before execution.
```

## Current Architecture

The current agent loop roughly does this:

```text
user prompt
-> initial workflow plan
-> web strategy discovery
-> implementation research plan
-> KG / API / on-chain research
-> evidence bundle
-> Hershy strategy/workflow graph
-> validator
```

The internal knowledge system is intended to be:

```text
Entity DB
+ Chunk DB
+ Full-text search
+ Semantic vector search
+ Knowledge graph edges
+ Raw evidence store
+ historical revisions
```

Important KG requirements:

```text
- Every page/chunk/fact should have updated_at.
- When a page changes, the previous page goes into historical data.
- Current search should prefer current pages.
- Old pages remain available through previous_internal_uri / revision URI.
- Every claim should cite evidence.
```

## The Specific Design Problem

At first I had labels/modules like:

```text
dex_submodule
dex_lp_pool_selection
dex_arbitrage_scan
yield_allocator
scheduled_dca
cex_only
onchain_only
hybrid_cex_onchain
```

But these can bias the agent.

For example, if the agent sees `dex_submodule`, it may force the problem into a DEX-shaped solution even when the user really needs a more general liquidity-market, venue, API, bridge, accounting, or risk workflow.

So I changed the direction toward:

```text
stable internal capabilities
+ adaptive per-run labels
```

### Stable Internal Capabilities

These are minimal internal concepts used for validation and orchestration, not for forcing the agent's reasoning:

```text
prompt_interpretation
web_strategy_discovery
workflow_validation
approval_gate
entity_evidence_retrieval
chain_state_read
contract_interaction_simulation
liquidity_market_discovery
liquidity_market_state_read
allocation_candidate_ranking
tradable_graph_discovery
path_quote_and_simulation
opportunity_filtering
yield_market_discovery
risk_adjusted_market_ranking
schedule_trigger_planning
venue_action_planning
```

These are still somewhat fixed, but they are meant to be low-level capabilities rather than product categories.

### Adaptive Labels

For each run, the agent dynamically creates labels from:

```text
- user prompt
- detected assets/chains/venues
- web search result titles/snippets/domains
- docs/API/GitHub/explorer candidates
- KG entities/chunks/edges
- implementation research targets
```

For example, for:

```text
Base에서 BTC ETH 유동성 공급하고 싶어. 최적의 풀 찾아줘.
```

adaptive labels might be:

```text
Base
BTC
ETH
유동성
공급
Aerodrome
Uniswap
liquidity pool
gauge
docs.aerodrome.finance
```

For:

```text
매일 아침 시장 리서치 보고서 만들어서 알림 보내줘.
```

adaptive labels might be:

```text
매일
아침
시장
리서치
보고서
알림
news API
calendar trigger
notification channel
```

The intent is:

```text
Do not force the agent into fixed categories first.
Let evidence and the user's prompt generate the labels for this specific workflow.
```

## Current Question

What is the best architecture for dynamic labeling in an agentic workflow builder?

I want the answer to cover both:

```text
1. Practical implementation I can build now.
2. Enterprise-grade design that will still work later.
```

## Questions I Want Answered

### 1. Should I Keep Stable Capabilities At All?

Should I keep a small set of stable internal capabilities for validation and routing?

Or should even capabilities be generated dynamically?

What is the right boundary between:

```text
stable internal capability
vs
dynamic run-specific label
vs
tool adapter
vs
workflow step
```

### 2. How Should Adaptive Labels Be Generated?

Should adaptive labels be generated by:

```text
- deterministic rules
- LLM extraction
- embedding clustering
- KG entity linking
- search result clustering
- hybrid of all of the above
```

What is the best pipeline?

### 3. How Do I Prevent Label Drift?

Dynamic labels can become messy.

Examples of bad labels:

```text
하고
싶어
최적의
blog spam domains
generic words like API, docs, official
```

How should I normalize, filter, merge, score, and dedupe labels?

Should labels have:

```text
label
normalized_label
type
source
confidence
evidence_ids
created_at
scope
valid_for_run_id
```

### 4. How Should Labels Connect To Tools?

The agent needs to eventually decide which tools/adapters to call.

For example:

```text
adaptive labels:
  Aerodrome
  Base
  liquidity pool
  gauge

possible tools:
  KG search
  Base RPC
  Etherscan API
  Aerodrome subgraph/API
  pool state reader
  market ranker
```

How should labels map to tools without becoming hard-coded modules again?

Should there be a separate:

```text
capability -> tool candidate -> evidence -> adapter selection
```

layer?

### 5. How Should This Work With A Knowledge Graph?

The system already has:

```text
entities
artifacts
chunks
edges
facts
revisions
embeddings
full-text search
```

Should adaptive labels become entities in the KG?

Or should they remain run-scoped metadata?

Maybe:

```text
run_label
entity_label_link
label_evidence
label_cluster
```

How should historical labels be handled?

### 6. How Should The Agent Use Labels During Planning?

Should the agent:

```text
1. generate labels first
2. use labels to decide research tasks
3. update labels after web/KG/API evidence
4. use final labels to generate workflow graph
```

Or should labels be a side product of research rather than a control structure?

### 7. How Do I Avoid Premature Strategy Templates?

I do not want the system to say:

```text
This is LP -> use LP template.
This is arb -> use arb template.
This is DCA -> use DCA template.
```

too early.

But I also need enough structure to produce a reliable workflow graph.

How can the system avoid premature templates while still producing deterministic, valid workflows?

### 8. What Should The Final Data Model Look Like?

Please propose a schema for:

```text
workflow_run
workflow_plan
adaptive_label
capability
capability_label_link
research_task
evidence
tool_candidate
adapter_selection
workflow_graph
```

Important fields:

```text
source
confidence
evidence_ids
created_at
updated_at
run_id
label_scope
valid_from
valid_to
superseded_by
```

### 9. What Should The Agent Loop Algorithm Be?

Please propose pseudocode for the full loop:

```text
prompt
-> intent sketch
-> web search
-> initial adaptive labels
-> KG/API/on-chain research tasks
-> evidence bundle
-> refined adaptive labels
-> capability graph
-> tool/adapter candidates
-> workflow plan
-> Hershy graph
-> validation
-> user approval gate
```

### 10. What Are The Biggest Risks?

Please identify risks such as:

```text
- label drift
- tool over-selection
- premature routing
- hallucinated adapters
- stale evidence
- spammy web sources
- non-deterministic graph output
- inability to reproduce why a label existed
```

And suggest mitigations.

## Desired Answer Format

Please answer in this format:

```text
1. Recommended architecture
2. Data model
3. Label generation pipeline
4. Tool/adapter selection pipeline
5. Agent loop pseudocode
6. How to use KG and evidence
7. How to avoid fixed taxonomy bias
8. MVP implementation plan
9. Enterprise-scale version
10. Failure modes and mitigations
```

## What I Do Not Want

I do not want a generic answer like:

```text
Use RAG and embeddings.
Use a router.
Use a vector DB.
```

I need a concrete design for an agentic workflow builder where:

```text
- labels are generated dynamically per run,
- stable concepts exist only where necessary for validation,
- every label and decision has evidence,
- the agent can still generate a valid workflow graph,
- web/KG/API/on-chain research can refine the plan before graph generation.
```

