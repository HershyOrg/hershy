# Hershy Strategy Logic Agent Loop — Codex Implementation Brief

이 문서는 Hershy의 트레이딩 전략 생성 AI 개선 작업을 Codex에게 전달하기 위한 구현 브리프다.

목표는 AI가 사용자의 자연어 전략을 단순히 런타임 JSON 블록으로 바로 변환하는 것이 아니라, 먼저 전략 논리 구조를 만들고, 그 논리 구조가 런타임 JSON과 고급 보기 그래프에 올바르게 반영되도록 하는 것이다.

특히 아래 문제가 핵심이다.

```text
AI가 raw market feed를 CEX/DEX action에 바로 연결한다.
예: spot price feed -> action
```

하지만 일반적인 전략은 다음 흐름을 가져야 한다.

```text
Data Feed
  -> Compute / Formula / Indicator
  -> Predicate / Trigger
  -> Action
```

그리고 action 이후의 반환값을 기반으로 후속 작업을 해야 하는 경우에는 다음처럼 확장해야 한다.

```text
Data / State
  -> Compute
  -> Predicate / Trigger
  -> Action
  -> Action Result / Event / State Update
  -> Compute
  -> Predicate / Trigger
  -> Next Action
```

---

## 1. StrategyLogicIR은 전략 템플릿 선택기가 아니다

`StrategyLogicIR`을 만들 때 주의할 점은, 미리 정해놓은 전략 중 하나를 선택하게 만들면 안 된다는 것이다.

잘못된 방향:

```ts
type StrategyKind =
  | "spot_perp_basis"
  | "moving_average"
  | "rsi"
  | "dca"
  | "funding_arbitrage"
  | "custom";
```

이렇게 하면 사용자의 전략이 조금만 복합적이거나 새로운 형태여도 기존 템플릿에 억지로 끼워 맞추게 된다.

올바른 방향은 다음이다.

```text
StrategyLogicIR = 전략 종류 선택 결과가 아니라,
사용자 의도를 분해한 논리 연산 그래프다.
```

즉 핵심은 `strategyKind`가 아니라 아래 요소들이다.

```text
- 어떤 데이터가 필요한가?
- 어떤 값을 계산해야 하는가?
- 어떤 조건을 평가해야 하는가?
- 어떤 trigger가 필요한가?
- trigger가 참일 때 어떤 action을 실행해야 하는가?
- action 결과를 다시 사용해야 하는가?
- 리스크, 종료, 실패 처리 조건은 무엇인가?
```

추천 IR 구조:

```ts
type StrategyLogicIR = {
  intentSummary: string;

  classification?: {
    primary?: string;
    tags: string[];
    confidence?: number;
  };

  requirements: StrategyRequirement[];
  nodes: LogicNode[];
  edges: LogicEdge[];
  invariants?: StrategyInvariant[];
  assumptions?: string[];
  unresolved?: string[];
};
```

`classification.primary`나 `classification.tags`는 있어도 된다. 하지만 이것은 source of truth가 아니라 linter와 UI 설명을 위한 hint여야 한다.

예:

```json
{
  "classification": {
    "primary": "spot_perp_basis",
    "tags": ["market_neutral", "basis", "threshold_entry", "threshold_exit"],
    "confidence": 0.82
  }
}
```

이 값이 있다고 해서 고정 템플릿으로 JSON을 생성하면 안 된다.

진짜 source of truth는 다음이다.

```text
requirements
nodes
edges
invariants
```

---

## 2. StrategyLogicIR은 요구사항 기반이어야 한다

전략 타입을 고정 enum으로 고르는 대신, 사용자 프롬프트에서 논리 요구사항을 추출해야 한다.

예: 사용자가 이렇게 말한 경우

```text
BTC 현물/선물 가격 차이가 0.5% 이상이면 현물을 사고 선물을 숏치고,
차이가 0.1% 이하로 줄어들면 둘 다 청산해.
```

IR은 다음 요구사항을 포함해야 한다.

```json
{
  "requirements": [
    {
      "id": "req_spot_price",
      "kind": "requires_data",
      "dataKind": "price",
      "reason": "Need spot price to compute spot/perp basis."
    },
    {
      "id": "req_perp_price",
      "kind": "requires_data",
      "dataKind": "price",
      "reason": "Need perp price to compute spot/perp basis."
    },
    {
      "id": "req_basis",
      "kind": "requires_computation",
      "semanticType": "basis",
      "inputs": ["spot_price", "perp_price"],
      "reason": "Entry and exit thresholds are based on basis, not raw price."
    },
    {
      "id": "req_entry_trigger",
      "kind": "requires_trigger",
      "triggerType": "condition",
      "reason": "Enter only when basis exceeds threshold."
    },
    {
      "id": "req_exit_trigger",
      "kind": "requires_trigger",
      "triggerType": "condition",
      "reason": "Exit only when basis compresses."
    }
  ]
}
```

그 다음 linter는 다음을 검사해야 한다.

```text
requirements에 requires_computation: basis가 있음
그런데 nodes에 basis 계산 노드가 없음
=> error
```

이 방식은 “미리 정한 전략 중 하나를 선택”하는 것이 아니라, “프롬프트에서 도출된 요구사항이 graph에 반영됐는지 검사”하는 방식이다.

---

## 3. Primitive operation도 전부 미리 규정할 필요는 없다

`basis`, `RSI`, `MA`, `funding arbitrage`, `grid` 같은 구체 primitive를 전부 미리 열거하면 안 된다.

잘못된 방향:

```ts
type PrimitiveOperation =
  | "compute_basis"
  | "compute_rsi"
  | "compute_sma"
  | "compute_ema"
  | "compute_spread"
  | "compute_funding_rate"
  | "compute_zscore";
```

이렇게 하면 새로운 계산 로직이 나올 때마다 primitive를 추가해야 한다.

대신 미리 규정해야 하는 것은 구체 indicator 이름이 아니라 그래프 문법이다.

고정해야 하는 node category:

```text
- data_feed
- compute
- predicate
- trigger
- action
- risk_control
- monitoring
```

추천 구조:

```ts
type LogicNode =
  | DataFeedNode
  | ComputeNode
  | PredicateNode
  | TriggerNode
  | ActionNode
  | RiskControlNode
  | MonitoringNode;
```

핵심 원칙:

```text
Logic Node Category: 고정
Semantic Type: 개방
Runtime Capability: 제한
```

예:

```json
{
  "id": "basis",
  "nodeCategory": "compute",
  "semanticType": "basis",
  "label": "Spot/Perp Basis",
  "expression": "(perpPrice - spotPrice) / spotPrice",
  "inputs": ["spot.lastPrice", "perp.lastPrice"],
  "outputs": ["value"]
}
```

새로운 커스텀 계산도 같은 구조로 표현 가능해야 한다.

```json
{
  "id": "volatility_spike",
  "nodeCategory": "compute",
  "semanticType": "custom_volatility_ratio",
  "label": "Volatility Spike Ratio",
  "expression": "stddev(close, 5) / stddev(close, 20)",
  "inputs": ["ohlcv.close"],
  "outputs": ["value"]
}
```

즉 `semanticType`은 고정 enum이 아니라 open string으로 둔다.

다만 runner가 실제로 실행할 수 있어야 하므로 expression function, data source, action type은 capability registry로 제한한다.

예:

```ts
type RunnerCapabilities = {
  expressionFunctions: string[];
  dataSources: string[];
  actionTypes: string[];
};
```

예:

```json
{
  "expressionFunctions": ["abs", "min", "max", "sma", "ema", "rsi", "stddev", "zscore"],
  "dataSources": ["binance_spot_ticker", "binance_futures_ticker", "ohlcv"],
  "actionTypes": ["cex_order", "dex_swap", "close_position", "notify"]
}
```

Linter는 이렇게 말할 수 있어야 한다.

```text
이 전략의 논리는 맞지만 runner가 super_magic_alpha_signal()을 지원하지 않음.
지원 함수 조합 또는 explicit expression으로 다시 작성해야 함.
```

---

## 4. Trigger와 Action은 runtime 때문에 더 제한해야 한다

`compute`와 `predicate`는 open-ended expression으로 둘 수 있지만, `trigger`와 `action`은 runner가 실행해야 하므로 어느 정도 고정해야 한다.

추천 TriggerNode:

```ts
type TriggerNode = {
  id: string;
  nodeCategory: "trigger";
  triggerType: "condition" | "time" | "event";
  predicateId?: string;
  intervalMs?: number;
  schedule?: string;
};
```

추천 ActionNode:

```ts
type ActionNode = {
  id: string;
  nodeCategory: "action";
  actionType: "cex_order" | "dex_swap" | "close_position" | "cancel_order" | "notify" | "custom";
  config: Record<string, unknown>;
};
```

`custom`은 paper mode나 UI preview에서는 허용할 수 있지만, live trading에서는 실행 불가 또는 사용자 승인 필요로 처리하는 것이 안전하다.

---

## 5. Action은 끝점이 아니라 output을 내는 node다

기존 단순 흐름:

```text
Data -> Compute -> Predicate/Trigger -> Action
```

하지만 action 이후 반환값을 기반으로 추가 작업을 해야 한다면 다음처럼 확장해야 한다.

```text
Data / State
  -> Compute
  -> Predicate / Trigger
  -> Action
  -> Action Result / Event / State Update
  -> Compute
  -> Predicate / Trigger
  -> Next Action
```

예를 들어 CEX 주문 action은 다음 값을 반환할 수 있다.

```text
orderId
status
filledQty
avgFillPrice
fee
error
timestamp
```

DEX swap action은 다음 값을 반환할 수 있다.

```text
txHash
status
amountIn
amountOut
executionPrice
gasUsed
slippage
error
```

따라서 action 이후 그래프는 다음처럼 표현되어야 한다.

```text
Entry Trigger
  -> Spot Buy Action
  -> Spot Buy Result
  -> filledQty / avgFillPrice / status
  -> Hedge Size Formula
  -> Fill Confirmed Trigger
  -> Perp Short Action
```

중요한 원칙:

```text
Action result도 다시 data다.
하지만 action result가 곧바로 다음 action을 실행하면 안 된다.
반드시 compute/predicate/trigger를 거쳐야 한다.
```

---

## 6. 확정 결정: 선택 A — `action-result` connection kind 추가

이번 구현에서는 선택 A를 따른다.

현재 connection kind:

```text
data-flow       streaming/normal -> normal/trigger
trigger-action  trigger -> action
action-input    streaming/normal -> action
stream-monitor  streaming -> monitoring
```

여기에 다음을 추가한다.

```text
action-result   action -> normal/trigger/monitoring
```

의미:

```text
Action의 반환값이 normal 계산 노드, trigger 조건, monitoring 노드의 입력으로 들어간다.
```

예:

```json
{
  "id": "e-action-result-1",
  "kind": "action-result",
  "fromId": "spot-buy",
  "toId": "hedge-size"
}
```

추천 허용 관계:

```text
trigger -> action         trigger-action
normal -> action          action-input
streaming -> action       action-input, 단 제한적으로만 허용
action -> normal          action-result
action -> trigger         action-result
action -> monitoring      action-result
```

금지 또는 강한 경고:

```text
action -> action 직접 연결
```

---

## 7. Runtime JSON 예시: action result 기반 후속 action

아래는 spot buy의 결과를 기반으로 perp short 수량을 계산하는 예시다.

```json
{
  "blocks": [
    {
      "id": "entry-trigger",
      "type": "trigger",
      "config": {
        "name": "Entry Trigger",
        "triggerType": "condition",
        "condition": "basis.value >= 0.005",
        "intervalMs": 1000
      }
    },
    {
      "id": "spot-buy",
      "type": "action",
      "config": {
        "name": "Buy Spot BTC",
        "actionType": "cex",
        "exchange": "Binance",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "orderType": "MARKET",
        "quote": 1000,
        "outputBlocks": [
          { "id": "orderId", "name": "orderId", "type": "output" },
          { "id": "status", "name": "status", "type": "output" },
          { "id": "filledQty", "name": "filledQty", "type": "output" },
          { "id": "avgFillPrice", "name": "avgFillPrice", "type": "output" }
        ]
      }
    },
    {
      "id": "hedge-size",
      "type": "normal",
      "config": {
        "name": "Perp Hedge Size",
        "expression": "spot-buy::filledQty",
        "outputBlocks": [
          { "id": "value", "name": "hedgeSize", "type": "output" }
        ]
      }
    },
    {
      "id": "spot-fill-confirmed",
      "type": "trigger",
      "config": {
        "name": "Spot Fill Confirmed",
        "triggerType": "condition",
        "condition": "spot-buy::status == 'FILLED' && spot-buy::filledQty > 0",
        "intervalMs": 1000
      }
    },
    {
      "id": "perp-short",
      "type": "action",
      "config": {
        "name": "Short Perp BTC",
        "actionType": "cex",
        "exchange": "Binance Futures",
        "symbol": "BTCUSDT",
        "side": "SELL",
        "orderType": "MARKET"
      }
    }
  ],
  "connections": [
    {
      "id": "e1",
      "kind": "trigger-action",
      "fromId": "entry-trigger",
      "toId": "spot-buy"
    },
    {
      "id": "e2",
      "kind": "action-result",
      "fromId": "spot-buy",
      "toId": "hedge-size"
    },
    {
      "id": "e3",
      "kind": "action-result",
      "fromId": "spot-buy",
      "toId": "spot-fill-confirmed"
    },
    {
      "id": "e4",
      "kind": "action-input",
      "fromId": "hedge-size",
      "toId": "perp-short"
    },
    {
      "id": "e5",
      "kind": "trigger-action",
      "fromId": "spot-fill-confirmed",
      "toId": "perp-short"
    }
  ]
}
```

---

## 8. 비동기 action 결과 처리

실전에서 action 반환값은 두 종류다.

```text
1. 즉시 반환값
   - order accepted
   - tx submitted
   - orderId
   - txHash

2. 나중에 확정되는 결과
   - filled
   - partially filled
   - rejected
   - canceled
   - tx confirmed
   - tx reverted
```

따라서 action이 반환됐다고 해서 바로 다음 action을 실행하면 안 된다.

더 실전적인 구조:

```text
Entry Trigger
  -> Submit Order Action
  -> orderId / txHash
  -> Order Status Feed or Tx Receipt Feed
  -> Fill/Confirm Predicate
  -> Next Trigger
  -> Next Action
```

예:

```text
spot_buy action
  -> orderId
  -> order_status_feed
  -> filledQty
  -> hedge_size_formula
  -> fill_confirmed_trigger
  -> perp_short action
```

즉 action result를 직접 다음 action으로 연결하는 것이 아니라, 필요하면 order status / position state / wallet state 같은 후속 데이터 흐름을 만든다.

---

## 9. Logic Linter 규칙

Logic Linter는 JSON schema validator 이전에 실행되어야 한다.

최소 rule:

```text
1. action은 반드시 upstream trigger를 가져야 한다.
2. raw market feed가 action으로 직접 연결되면 안 된다.
   단, 명시적으로 action-input이고 execution parameter로 필요한 경우만 제한적으로 허용한다.
3. condition trigger는 raw feed가 아니라 compute/predicate signal에 기반해야 한다.
4. DCA/time/periodic 전략은 triggerType="time"을 사용해야 한다.
5. fixed normal은 고급 보기에서 별도 node로 노출하지 않고 parameter로 흡수한다.
6. formula/indicator dependency는 data-flow로 연결되어야 한다.
7. action-result는 action -> normal/trigger/monitoring에만 허용한다.
8. action -> action 직접 연결은 금지하거나 error 처리한다.
9. action-result 기반 후속 action에는 반드시 trigger가 있어야 한다.
10. async action result를 후속 action에 사용하려면 confirmation trigger 또는 status check가 있어야 한다.
11. partial fill 가능한 action의 후속 size 계산은 requestedQty가 아니라 filledQty 기반이어야 한다.
12. retry loop에는 maxRetries, cooldownMs, idempotencyKey, timeoutMs 중 필요한 안전장치가 있어야 한다.
```

예상 lint issue shape:

```ts
type LogicLintIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  evidence?: unknown;
  repairHint?: string;
};
```

예:

```json
{
  "code": "ACTION_DIRECTLY_CHAINED",
  "severity": "error",
  "message": "Action spot-buy is directly connected to action perp-short.",
  "repairHint": "Route spot-buy outputs into a fill confirmation trigger and hedge size formula before perp-short."
}
```

예:

```json
{
  "code": "RAW_FEED_ACTION_BYPASS",
  "severity": "error",
  "message": "Raw market feed is connected directly to an action, bypassing formula/trigger logic.",
  "repairHint": "Route market feed into formula/indicator nodes first, then into condition triggers."
}
```

---

## 10. Repair Loop 원칙

Logic Linter 또는 Go validator가 실패하면 AI repair loop에 전체 JSON을 다시 고치게 해야 한다.

주의:

```text
자동으로 누락 edge를 추가해서 고치면 안 된다.
특히 streaming -> action edge 자동 추가는 전략 논리를 망가뜨릴 수 있다.
```

허용 가능한 자동 보강:

```text
- metadata 보강
- UI layout position 보강
- monitoring edge 보강
- fixed parameter absorption
- id normalization
- connection kind 명확화
```

금지해야 하는 자동 보강:

```text
- streaming -> action 자동 추가
- action -> action 자동 추가
- trigger -> action 자동 추가
- formula -> trigger 자동 추가
- raw feed -> trigger 자동 추가
```

이런 것은 전략 의미를 바꾸므로 repair agent가 전체 graph를 다시 생성해야 한다.

Repair prompt에 반드시 포함할 내용:

```text
You are repairing a trading strategy graph.

Preserve the user's original strategy intent.

Do not fix the graph by adding shortcut edges.
Do not bypass formula or indicator nodes.

If the strategy requires spread, basis, moving average, RSI, funding, volatility, volume, or other derived signals, create explicit normal expression nodes.

Raw market feeds must flow into formula/indicator nodes first, then into condition triggers.

Actions must be downstream of triggers.

Use trigger-action only from trigger blocks to action blocks.
Use data-flow for streaming/normal inputs into formula or trigger blocks.
Use action-input only for parameters required by the action, and never as a substitute for trigger logic.

For action outputs, use action-result from action blocks to normal, trigger, or monitoring blocks.
Do not connect action directly to action.
If a later action depends on an earlier action's result, add a confirmation trigger and any required formula nodes first.

For DCA, scheduled, periodic, interval, or rebalance strategies, use triggerType="time".
Do not implement time logic using modulo expressions in condition triggers.

Return the full corrected JSON. Do not return patches.
```

---

## 11. UI Projection 규칙

고급 보기에서는 runtime block을 그대로 보여주지 말고 semantic projection을 해야 한다.

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
action output port 표시
```

Action node는 output port를 보여줘야 한다.

예:

```text
[Spot Buy Action]
outputs:
- orderId
- status
- filledQty
- avgFillPrice
```

시각적 흐름:

```text
Basis Formula
   ↓
Entry Trigger
   ↓
Spot Buy Action
   ├─ status ─────→ Fill Confirmed Trigger ──→ Perp Short Action
   ├─ filledQty ──→ Hedge Size Formula ──────→ Perp Short Action
   └─ avgPrice ───→ Actual Entry Basis Formula
```

---

## 12. 구현 위치

현재 관련 파일:

```text
front/server.mjs
```

중요 함수:

```text
buildAIStrategySystemPrompt()
buildStrategyRepairSystemPrompt()
normalizeStrategyGraphForRunner()
validateRepairAndMaterializeStrategy()
inferRunnerConnectionKind()
forceTimeTriggersIntoTriggerBlocks()
```

추가/수정할 후보:

```text
buildStrategyLogicIRPrompt()
lintStrategyLogicIR()
lintRuntimeStrategyGraph()
repairRuntimeGraphWithLogicIssues()
inferRunnerConnectionKind()에 action-result 추가
normalizeStrategyGraphForRunner()에서 action outputBlocks 보존
validateRepairAndMaterializeStrategy()에서 Go validator 이전 logic linter 실행
```

고급 보기 관련 파일:

```text
front/features/strategy-graph/easyViewAgent.ts
```

중요 함수:

```text
createEasyViewFromStrategyGraph()
createAdvancedViewFromStrategyGraph()
buildAdvancedGraphFromStrategyGraph()
buildTimeTriggerNodeData()
buildFunctionNodeData()
```

추가/수정할 후보:

```text
buildActionNodeData()에서 output port 표시
buildAdvancedGraphFromStrategyGraph()에서 action-result edge 처리
fixed normal 숨김
formula normal 표시
action-result edge를 action output port에서 normal/trigger/monitoring으로 연결
```

Go validator:

```text
examples/strategy-runner/validator/validator.go
```

수정:

```text
connection kind에 action-result 추가
허용 관계 추가:
- action -> normal
- action -> trigger
- action -> monitoring
금지 관계:
- action -> action
```

Go runner:

```text
examples/strategy-runner/main.go
```

수정:

```text
action execution result를 runtime state에 저장
normal expression에서 action result field 참조 가능하게 처리
trigger condition에서 action result field 참조 가능하게 처리
예: spot-buy::filledQty, spot-buy::status
```

---

## 13. 최종 설계 원칙

핵심 설계 원칙은 다음이다.

```text
닫힌 전략 템플릿을 만들지 않는다.
닫힌 primitive enum도 만들지 않는다.

대신 고정된 graph grammar를 둔다.
semanticType은 open string으로 둔다.
compute/predicate는 expression 기반으로 표현한다.
trigger/action은 runner capability에 맞게 제한한다.
action result는 다시 data로 취급한다.
후속 action은 반드시 compute/predicate/trigger를 거쳐야 한다.
```

최종 canonical flow:

```text
Data Feed
  -> Compute / Formula / Indicator
  -> Predicate / Trigger
  -> Action
  -> Action Result / Event / State Update
  -> Compute / Predicate / Trigger
  -> Next Action
```

한 줄 요약:

```text
Hershy는 전략 템플릿 선택기가 아니라, 자연어 전략을 검증 가능한 semantic strategy graph로 컴파일하는 시스템이어야 한다.
```
