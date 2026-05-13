좋아. 지금 문제의 핵심은 **“JSON schema validation”이 아니라 “전략 의미 validation”이 빠져 있다**는 거야.

즉 validator는 이런 걸 볼 수 있어:

```text
이 block type이 맞나?
connection kind가 허용되나?
필수 config가 있나?
```

하지만 지금 필요한 건 이런 검사야:

```text
이 전략은 basis 전략인데 basis 계산 노드가 있는가?
action이 trigger 없이 실행되는 구조인가?
raw price feed가 formula를 우회해서 action으로 들어가고 있는가?
DCA인데 condition trigger로 억지 구현했는가?
```

그래서 구조는 이렇게 가는 게 맞아.

---

# 1. 전체 Agent Loop 구조

추천 구조는 다음이야.

```text
User Prompt
   ↓
Intent Planner
   ↓
Strategy Logic IR
   ↓
Logic Graph Planner
   ↓
Logic Linter on IR
   ↓
Runtime JSON Generator
   ↓
Logic Linter on Runtime JSON
   ↓
Go Validator
   ↓
Repair Loop
   ↓
Materialized Runtime Artifact
   ↓
UI Projection
```

중요한 점은 **JSON을 바로 만들지 말고, 중간 표현인 Strategy Logic IR을 반드시 만들게 해야 한다**는 거야.

---

# 2. Intermediate Representation 설계

런타임 JSON은 실행을 위한 구조고, AI가 생각하기에는 너무 저수준이야.

그래서 먼저 이런 IR을 만들게 하는 게 좋아.

```ts
type StrategyLogicIR = {
  strategyKind:
    | "spot_perp_basis"
    | "spread"
    | "moving_average"
    | "rsi"
    | "funding_rate"
    | "dca"
    | "rebalance"
    | "pure_execution"
    | "custom";

  assets: {
    base?: string;
    quote?: string;
    spotSymbol?: string;
    perpSymbol?: string;
    exchange?: string;
  };

  requiredDataFeeds: LogicFeed[];

  computedSignals: LogicSignal[];

  triggers: LogicTrigger[];

  actions: LogicAction[];

  flow: LogicEdge[];

  uiHints?: {
    hideFixedParams?: boolean;
    showFormulaNodes?: boolean;
    showTimeTriggerAsSingleNode?: boolean;
  };
};
```

예를 들어 spot/perp basis 전략은 IR에서 이렇게 나와야 해.

```json
{
  "strategyKind": "spot_perp_basis",
  "requiredDataFeeds": [
    {
      "id": "spot_price",
      "kind": "market_price",
      "source": "binance_spot",
      "symbol": "BTCUSDT",
      "outputs": ["lastPrice"]
    },
    {
      "id": "perp_price",
      "kind": "market_price",
      "source": "binance_futures",
      "symbol": "BTCUSDT",
      "outputs": ["lastPrice"]
    }
  ],
  "computedSignals": [
    {
      "id": "basis",
      "kind": "formula",
      "expression": "(perp_price.lastPrice - spot_price.lastPrice) / spot_price.lastPrice",
      "inputs": ["spot_price.lastPrice", "perp_price.lastPrice"],
      "outputs": ["value"]
    }
  ],
  "triggers": [
    {
      "id": "entry_trigger",
      "kind": "condition",
      "condition": "basis.value > 0.005",
      "inputs": ["basis.value"]
    },
    {
      "id": "exit_trigger",
      "kind": "condition",
      "condition": "basis.value < 0.001",
      "inputs": ["basis.value"]
    }
  ],
  "actions": [
    {
      "id": "spot_buy",
      "kind": "cex_order",
      "exchange": "Binance",
      "symbol": "BTCUSDT",
      "side": "BUY",
      "orderType": "MARKET",
      "quote": 1000
    },
    {
      "id": "perp_short",
      "kind": "cex_order",
      "exchange": "Binance Futures",
      "symbol": "BTCUSDT",
      "side": "SELL",
      "orderType": "MARKET",
      "quote": 1000
    }
  ],
  "flow": [
    { "from": "spot_price", "to": "basis", "kind": "data" },
    { "from": "perp_price", "to": "basis", "kind": "data" },
    { "from": "basis", "to": "entry_trigger", "kind": "signal" },
    { "from": "entry_trigger", "to": "spot_buy", "kind": "trigger" },
    { "from": "entry_trigger", "to": "perp_short", "kind": "trigger" }
  ]
}
```

이 IR의 목적은 명확해.

```text
AI가 먼저 “전략 논리”를 선언하게 만든다.
그 다음에만 runtime JSON을 만들 수 있게 한다.
```

---

# 3. Intent Planner가 해야 할 일

Intent Planner는 사용자 프롬프트에서 **전략 패턴**을 먼저 분류해야 해.

예:

```ts
type IntentPlan = {
  detectedStrategyKinds: string[];
  requiredConcepts: string[];
  requiredComputationNodes: string[];
  requiredTriggerTypes: string[];
  forbiddenShortcuts: string[];
};
```

예시:

```json
{
  "detectedStrategyKinds": ["spot_perp_basis"],
  "requiredConcepts": ["spot_price", "perp_price", "basis", "entry_condition", "exit_condition"],
  "requiredComputationNodes": ["basis_formula"],
  "requiredTriggerTypes": ["condition"],
  "forbiddenShortcuts": [
    "spot_price -> action",
    "perp_price -> action",
    "raw_market_feed -> cex_action_without_trigger"
  ]
}
```

DCA는 이렇게 나와야 함.

```json
{
  "detectedStrategyKinds": ["dca"],
  "requiredConcepts": ["time_interval", "buy_action"],
  "requiredComputationNodes": [],
  "requiredTriggerTypes": ["time"],
  "forbiddenShortcuts": [
    "normal_interval -> condition_trigger",
    "eventTime modulo interval expression"
  ]
}
```

---

# 4. Logic Linter 설계

Logic Linter는 두 번 돌리는 게 좋아.

```text
1차: Strategy Logic IR에 대해 검사
2차: Runtime JSON에 대해 검사
```

왜냐하면 IR은 논리 검사용이고, Runtime JSON은 실제 실행 구조 검사용이기 때문이야.

---

## 4.1 IR Linter Rule

추천 rule set은 이렇게 나눠.

```ts
type LogicLintSeverity = "error" | "warning" | "info";

type LogicLintIssue = {
  code: string;
  severity: LogicLintSeverity;
  message: string;
  evidence?: unknown;
  repairHint?: string;
};
```

---

## Rule A. 전략 타입별 필수 계산 노드 검사

```ts
const REQUIRED_SIGNAL_BY_STRATEGY_KIND = {
  spot_perp_basis: ["basis"],
  spread: ["spread"],
  moving_average: ["moving_average"],
  rsi: ["rsi"],
  funding_rate: ["funding_rate"],
};
```

검사:

```text
strategyKind = spot_perp_basis
=> computedSignals 안에 basis formula가 있어야 함
```

실패 예:

```json
{
  "code": "MISSING_BASIS_FORMULA",
  "severity": "error",
  "message": "Spot/perp basis strategy requires a basis formula node.",
  "repairHint": "Create a formula signal: (perpPrice - spotPrice) / spotPrice, then connect it to entry/exit triggers."
}
```

---

## Rule B. action은 반드시 trigger downstream이어야 함

검사:

```text
모든 action에 대해 upstream path에 trigger가 있는가?
```

나쁜 구조:

```text
spot_feed -> action
```

좋은 구조:

```text
spot_feed -> basis -> trigger -> action
```

실패:

```json
{
  "code": "ACTION_WITHOUT_TRIGGER",
  "severity": "error",
  "message": "Action spot_buy is not downstream of any trigger.",
  "repairHint": "Connect a condition or time trigger before this action. Do not connect raw feeds directly to actions."
}
```

---

## Rule C. raw feed가 action으로 직접 연결되는지 검사

단, 무조건 금지하면 안 돼.

일부 action에는 현재 가격, slippage, amount, route, pool address 같은 input이 필요할 수 있어.

그래서 edge를 구분해야 해.

```text
허용 가능:
basis -> action as action-input
position_size -> action as action-input
route_quote -> action as action-input

위험:
spot_price -> action
perp_price -> action
raw_orderbook -> action
```

특히 전략이 `pure_execution`이 아니면 raw market feed direct action input은 warning 또는 error로 보는 게 좋아.

```ts
function isRawFeedToActionBypass(edge, graph) {
  return (
    from.type === "streaming" &&
    to.type === "action" &&
    edge.kind === "action-input" &&
    graph.strategyKind !== "pure_execution"
  );
}
```

실패:

```json
{
  "code": "RAW_FEED_ACTION_BYPASS",
  "severity": "error",
  "message": "Raw market feed is connected directly to action, bypassing formula/trigger logic.",
  "repairHint": "Route market feed into formula/indicator nodes first. Actions must be triggered by condition/time triggers."
}
```

---

## Rule D. condition trigger는 raw feed가 아니라 signal을 참조해야 함

basis 전략에서 이런 건 나쁨.

```json
{
  "condition": "perp.lastPrice > spot.lastPrice"
}
```

가능은 하지만 UI/논리상 좋지 않음.

원하는 건:

```json
{
  "condition": "basis.value > entryThreshold"
}
```

검사:

```text
condition trigger의 condition string이 raw feed field만 직접 참조하고,
전략 타입상 formula가 필요한 경우 error
```

예:

```json
{
  "code": "TRIGGER_BYPASSES_SIGNAL",
  "severity": "error",
  "message": "Condition trigger directly compares raw feed fields instead of using the required computed signal.",
  "repairHint": "Create a basis/spread/indicator normal node and make the trigger depend on that node."
}
```

---

## Rule E. time strategy는 triggerType=time이어야 함

DCA, scheduled rebalance, periodic execution은 반드시 time trigger.

나쁜 예:

```json
{
  "type": "normal",
  "config": {
    "name": "DCA Interval",
    "value": 86400000
  }
}
```

```json
{
  "type": "trigger",
  "config": {
    "triggerType": "condition",
    "condition": "eventTime % 86400000 < 1000"
  }
}
```

좋은 예:

```json
{
  "type": "trigger",
  "config": {
    "triggerType": "time",
    "intervalMs": 86400000
  }
}
```

실패:

```json
{
  "code": "DCA_MUST_USE_TIME_TRIGGER",
  "severity": "error",
  "message": "DCA/time-based strategies must use triggerType='time'.",
  "repairHint": "Replace interval normal + modulo condition with a single time trigger block."
}
```

---

## Rule F. fixed normal은 UI 노출 대상이 아님

고정값 normal은 런타임에는 있어도 될 수 있지만, advanced view에서는 숨기는 게 맞아.

검사 기준:

```text
normal block에 expression/code/formula가 없다
value만 있다
다른 계산 노드가 아니라 action/trigger parameter로만 쓰인다
=> fixed parameter normal
```

처리:

```text
Logic error는 아님.
UI projection hint로 hide 처리.
```

```json
{
  "code": "FIXED_NORMAL_SHOULD_BE_PARAMETER",
  "severity": "warning",
  "message": "Fixed normal block should be absorbed into action/trigger parameters in advanced UI.",
  "repairHint": "Do not display this as a standalone formula node."
}
```

---

# 5. Runtime JSON Linter

IR이 좋아도 JSON 생성 과정에서 망가질 수 있으니 Runtime JSON도 검사해야 해.

핵심 함수는 이런 식이면 돼.

```ts
function lintRuntimeStrategyGraph(graph: StrategyGraph): LogicLintIssue[] {
  const issues: LogicLintIssue[] = [];

  issues.push(...lintActionsHaveTriggerUpstream(graph));
  issues.push(...lintNoRawFeedActionBypass(graph));
  issues.push(...lintRequiredFormulaNodes(graph));
  issues.push(...lintConditionTriggersUseSignals(graph));
  issues.push(...lintTimeStrategiesUseTimeTrigger(graph));
  issues.push(...lintFormulaDependenciesUseDataFlow(graph));
  issues.push(...lintFixedNormalVisibility(graph));

  return issues;
}
```

---

# 6. Graph Traversal 기반 검사

가장 중요한 건 `action`의 upstream path를 보는 거야.

```ts
function getUpstreamNodes(graph, nodeId) {
  const reverseAdj = new Map<string, string[]>();

  for (const edge of graph.connections) {
    if (!reverseAdj.has(edge.toId)) reverseAdj.set(edge.toId, []);
    reverseAdj.get(edge.toId)!.push(edge.fromId);
  }

  const visited = new Set<string>();
  const stack = [...(reverseAdj.get(nodeId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;

    visited.add(current);

    for (const parent of reverseAdj.get(current) ?? []) {
      stack.push(parent);
    }
  }

  return [...visited];
}
```

검사:

```ts
function lintActionsHaveTriggerUpstream(graph) {
  const issues = [];

  for (const action of graph.blocks.filter(b => b.type === "action")) {
    const upstreamIds = getUpstreamNodes(graph, action.id);
    const hasTrigger = upstreamIds.some(id => {
      const node = graph.blocks.find(b => b.id === id);
      return node?.type === "trigger";
    });

    if (!hasTrigger) {
      issues.push({
        code: "ACTION_WITHOUT_TRIGGER",
        severity: "error",
        message: `Action ${action.id} has no upstream trigger.`,
        repairHint: "Actions must be downstream of a condition or time trigger."
      });
    }
  }

  return issues;
}
```

---

# 7. Required Formula Rule

프롬프트 또는 IR에서 strategyKind를 보존하는 게 중요해.

Runtime JSON에 metadata를 넣어두는 걸 추천해.

```json
{
  "metadata": {
    "strategyKind": "spot_perp_basis",
    "requiredSignals": ["basis"],
    "sourcePrompt": "BTC spot/perp basis..."
  },
  "blocks": []
}
```

그러면 linter가 쉽게 검사할 수 있어.

```ts
function lintRequiredFormulaNodes(graph) {
  const issues = [];
  const requiredSignals = graph.metadata?.requiredSignals ?? [];

  for (const signal of requiredSignals) {
    const exists = graph.blocks.some(block => {
      if (block.type !== "normal") return false;

      const name = block.config?.name?.toLowerCase() ?? "";
      const expression = block.config?.expression?.toLowerCase() ?? "";

      return name.includes(signal) || expression.includes(signal);
    });

    if (!exists) {
      issues.push({
        code: `MISSING_${signal.toUpperCase()}_FORMULA`,
        severity: "error",
        message: `Required computed signal '${signal}' is missing.`,
        repairHint: `Create a normal expression node for '${signal}' and connect its data-flow into relevant triggers.`
      });
    }
  }

  return issues;
}
```

---

# 8. Connection Kind 규칙

런타임에서 connection kind는 이렇게 강제하는 게 좋아.

```text
streaming -> normal       data-flow
normal -> normal          data-flow
normal -> trigger         data-flow
streaming -> trigger      data-flow, 단 pure/raw threshold 전략만 제한적으로 허용
trigger -> action         trigger-action
normal -> action          action-input
streaming -> action       action-input, 단 매우 제한적으로 허용
streaming -> monitoring   stream-monitor
```

개인적으로는 `streaming -> action`을 기본 금지하고, 정말 필요한 경우에만 action config 안에 명시적으로 허용하는 게 좋아.

예:

```json
{
  "id": "cex_order",
  "type": "action",
  "config": {
    "allowRawFeedInputs": false
  }
}
```

또는 edge에 reason을 넣어.

```json
{
  "id": "e5",
  "kind": "action-input",
  "fromId": "spot",
  "toId": "spot-buy",
  "reason": "mark price used only for slippage guard, not execution trigger"
}
```

이렇게 하면 linter가 판단 가능해져.

```text
raw feed -> action이 있더라도
reason이 slippage_guard / quote_preview / monitoring_context면 warning
reason이 없으면 error
```

---

# 9. Repair Loop Prompt

repair prompt는 단순히 “validator 에러 고쳐라”가 아니라 **lint issue를 구조화해서 넣어야 해.**

추천 repair 입력:

```json
{
  "originalUserPrompt": "...",
  "intentPlan": {},
  "logicIR": {},
  "runtimeJson": {},
  "logicLintIssues": [
    {
      "code": "RAW_FEED_ACTION_BYPASS",
      "severity": "error",
      "message": "spot price feed is connected directly to spot-buy action.",
      "repairHint": "Route spot and perp feeds into basis formula first. Then basis -> trigger -> action."
    }
  ],
  "goValidatorErrors": []
}
```

repair system prompt 핵심 문구:

```text
You are repairing a trading strategy graph.

You must preserve the user's original strategy intent.

Do not fix the graph by adding shortcut edges.

Do not bypass formula or indicator nodes.

If the strategy requires spread, basis, moving average, RSI, funding, volatility, volume, or other derived signals, create explicit normal expression nodes.

Raw market feeds must flow into formula/indicator nodes first, then into condition triggers.

Actions must be downstream of triggers.

Use trigger-action only from trigger blocks to action blocks.

Use data-flow for streaming/normal inputs into formula or trigger blocks.

Use action-input only for parameters required by the action, and never as a substitute for trigger logic.

For DCA, scheduled, periodic, interval, or rebalance strategies, use triggerType="time". Do not implement time logic using modulo expressions in condition triggers.

Return the full corrected JSON. Do not return patches.
```

---

# 10. 자동 edge 보강은 제한해야 함

지금 가장 위험한 건 이거야.

```text
validator 통과를 위해 누락된 edge를 자동 추가
```

이러면 이런 일이 생김.

```text
spot_feed -> action
```

validator는 좋아하지만 전략 의미는 망가짐.

그래서 자동 edge 보강은 아래 정도만 허용하는 게 좋아.

## 허용 가능

```text
monitoring 누락 edge
metadata 보강
fixed parameter absorption
UI-only layout position 보강
id 정규화
connection kind 명확화
```

## 금지해야 함

```text
streaming -> action 자동 추가
trigger -> action 자동 추가
formula -> trigger 자동 추가
raw feed -> trigger 자동 추가
```

왜냐하면 이건 전략 의미를 바꾸기 때문이야.

대신 누락되면 repair loop로 보내야 함.

---

# 11. server.mjs에 넣을 추천 구조

현재 파일 기준으로는 이런 흐름을 추천해.

```ts
async function validateRepairAndMaterializeStrategy(rawAiOutput, userPrompt) {
  const intentPlan = await buildIntentPlan(userPrompt);

  const logicIR = await buildLogicIR({
    userPrompt,
    intentPlan
  });

  const irLintIssues = lintStrategyLogicIR(logicIR);

  if (hasBlockingIssues(irLintIssues)) {
    const repairedIR = await repairLogicIR({
      userPrompt,
      intentPlan,
      logicIR,
      issues: irLintIssues
    });

    return validateRepairAndMaterializeStrategyFromIR(repairedIR, userPrompt);
  }

  let runtimeGraph = await generateRuntimeJsonFromIR({
    userPrompt,
    intentPlan,
    logicIR
  });

  runtimeGraph = normalizeStrategyGraphForRunner(runtimeGraph);

  const runtimeLogicIssues = lintRuntimeStrategyGraph(runtimeGraph, {
    userPrompt,
    intentPlan,
    logicIR
  });

  if (hasBlockingIssues(runtimeLogicIssues)) {
    runtimeGraph = await repairRuntimeGraph({
      userPrompt,
      intentPlan,
      logicIR,
      runtimeGraph,
      issues: runtimeLogicIssues
    });
  }

  runtimeGraph = normalizeStrategyGraphForRunner(runtimeGraph);

  const validatorResult = await runGoValidator(runtimeGraph);

  if (!validatorResult.ok) {
    runtimeGraph = await repairRuntimeGraph({
      userPrompt,
      intentPlan,
      logicIR,
      runtimeGraph,
      issues: [],
      validatorErrors: validatorResult.errors
    });
  }

  const finalLogicIssues = lintRuntimeStrategyGraph(runtimeGraph, {
    userPrompt,
    intentPlan,
    logicIR
  });

  if (hasBlockingIssues(finalLogicIssues)) {
    throw new Error("Strategy logic validation failed after repair.");
  }

  return materializeRuntimeArtifact(runtimeGraph);
}
```

---

# 12. easyViewAgent.ts 쪽 UI Projection 규칙

`createAdvancedViewFromStrategyGraph()`에서는 runtime block을 그대로 보여주지 말고, semantic projection을 해야 해.

추천 규칙:

```ts
function shouldShowAsAdvancedNode(block) {
  if (block.type === "streaming") return true;
  if (block.type === "trigger") return true;
  if (block.type === "action") return true;
  if (block.type === "monitoring") return true;

  if (block.type === "normal") {
    return isFormulaNormal(block) || isIndicatorNormal(block);
  }

  return false;
}
```

```ts
function isFormulaNormal(block) {
  return Boolean(
    block.config?.expression ||
    block.config?.formula ||
    block.config?.code
  );
}
```

```ts
function isFixedNormal(block) {
  return (
    block.type === "normal" &&
    !block.config?.expression &&
    !block.config?.formula &&
    !block.config?.code &&
    block.config?.value !== undefined
  );
}
```

고급 보기에서는:

```text
fixed normal 숨김
formula normal 표시
time trigger는 TimeTriggerNode로 표시
condition trigger는 ConditionTriggerNode로 표시
action은 ActionNode로 표시
streaming은 DataFeedNode로 표시
```

---

# 13. 제일 중요한 정책

이걸 시스템 프롬프트와 linter 양쪽에 박아야 해.

```text
A valid trading strategy graph is not just a wiring graph.

For non-pure-execution strategies, the canonical structure is:

Data Feed
  -> Computed Signal / Formula / Indicator
  -> Trigger
  -> Action

Raw market data must not directly cause actions.

If an action needs market data as an execution parameter, that edge must be marked as action-input and must not replace trigger logic.
```

이 문장이 사실상 핵심 정책이야.

---

# 14. 최소 구현 순서

당장 구현한다면 순서는 이게 좋아.

## 1단계

`metadata.strategyKind`, `metadata.requiredSignals`를 runtime JSON에 추가.

```json
{
  "metadata": {
    "strategyKind": "spot_perp_basis",
    "requiredSignals": ["basis"],
    "requiredTriggerTypes": ["condition"]
  }
}
```

## 2단계

`lintRuntimeStrategyGraph()`부터 만든다.

최소 rule:

```text
ACTION_WITHOUT_TRIGGER
RAW_FEED_ACTION_BYPASS
MISSING_REQUIRED_FORMULA
DCA_MUST_USE_TIME_TRIGGER
FORMULA_DEPENDENCY_MUST_USE_DATA_FLOW
```

## 3단계

Logic Linter 실패를 repair loop 입력으로 넣는다.

```text
Go validator 전에 logic linter 실행
logic linter 실패 시 AI repair
repair 후 다시 logic linter
그 다음 Go validator
```

## 4단계

AI에게 JSON 전에 IR을 출력하게 한다.

처음부터 완벽한 별도 agent로 나누지 않아도 돼.

일단 한 번의 AI 호출에서:

```json
{
  "intentPlan": {},
  "logicIR": {},
  "runtimeGraph": {}
}
```

이렇게 출력하게 만들고, 서버에서 `runtimeGraph`만 사용하되 `intentPlan`, `logicIR`을 linter context로 쓰면 돼.

## 5단계

나중에 안정화되면 호출을 분리.

```text
Planner call
Graph call
Repair call
```

---

# 15. 결론

너희 케이스에서 가장 좋은 구조는 이거야.

```text
User Prompt
→ Intent Plan
→ Strategy Logic IR
→ IR Linter
→ Runtime JSON
→ Runtime Logic Linter
→ Go Validator
→ Semantic Repair Loop
→ UI Projection
```

핵심은 **Go validator가 하기 전에 Logic Linter가 먼저 의미 검사를 해야 한다**는 것.

그리고 가장 중요한 금지 규칙은 이거야.

```text
raw feed -> action은 기본적으로 금지.
formula/indicator -> trigger -> action을 강제.
time 전략은 triggerType="time"으로 표현.
fixed normal은 UI 노드가 아니라 parameter로 흡수.
자동 edge 보강으로 전략 의미를 고치려 하지 말고, AI repair로 전체 JSON을 다시 생성.
```

이렇게 만들면 AI가 단순히 블록을 나열하는 게 아니라, **전략 논리 흐름을 먼저 설계하고 그 흐름에 맞는 런타임 JSON을 생성하는 구조**가 돼.
