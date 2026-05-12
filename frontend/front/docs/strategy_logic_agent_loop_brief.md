# Strategy Logic Agent Loop Brief

이 문서는 아무 컨텍스트가 없는 AI에게 현재 문제 상황과 해결해야 할 방향을 설명하기 위한 브리프다. 목표는 트레이딩 전략 생성 AI가 단순히 블록을 나열하는 것이 아니라, 실제 전략 논리 흐름도를 기반으로 고급 보기 그래프와 런타임 JSON을 생성하도록 만드는 것이다.

## 제품 개요

Hershy 프론트엔드는 사용자가 자연어로 트레이딩 전략을 만들면 AI가 전략 그래프를 생성하고, 이를 두 가지 방식으로 보여준다.

- 쉬운 보기: 전략을 요약해서 보여주고, CEX/DEX 액션 파라미터만 조절하는 화면
- 고급 보기: 실제 데이터 흐름, 계산식, 조건, 액션을 직접 연결해서 보는 그래프 편집기

전략은 서버에서 JSON으로 생성되고, Go 기반 strategy-runner validator를 통과한 뒤 프론트 그래프로 변환된다.

## 현재 블록 모델

런타임 JSON의 주요 block type은 다음과 같다.

```text
streaming   외부 API/WSS/주기 데이터 피드
normal      고정값 또는 계산식/인디케이터 값
trigger     실행 조건. time 또는 condition
action      CEX/DEX 주문 실행
monitoring  차트/로그/관측용
```

connection kind는 다음을 사용한다.

```text
data-flow       streaming/normal -> normal/trigger
trigger-action  trigger -> action
action-input    streaming/normal -> action
stream-monitor  streaming -> monitoring
```

중요한 점은 `normal`이 두 가지 역할을 가질 수 있다는 것이다.

- 고정값 normal: `amount = 100`, `symbol = BTCUSDT`, `threshold = 0.005`
- 계산식 normal: `basis = (perpPrice - spotPrice) / spotPrice`

고정값 normal은 UI에서 별도 노드로 보여주기보다 연결된 액션/트리거의 파라미터로 흡수하는 것이 좋다. 반대로 계산식 normal은 전략 논리의 핵심이므로 고급 보기에서 반드시 별도 노드로 보여야 한다.

## 현재 문제

AI가 전략을 만들 때 논리 흐름을 생략하고 raw data feed를 action으로 바로 연결하는 문제가 있다.

예를 들어 현선갭 전략에서는 다음처럼 만들면 안 된다.

```text
BTC Spot Price Feed  ─┐
BTC Perp Price Feed  ─┼─> CEX Action
```

이 그래프에는 “현선갭을 계산한다”, “기준 이상이면 진입한다”라는 핵심 논리가 없다. 데이터가 들어오자마자 주문 액션으로 가기 때문에 전략이 아니라 단순 실행 배선이 된다.

올바른 흐름은 다음과 같아야 한다.

```text
BTC Spot Price Feed
        ↓
BTC Perp Price Feed
        ↓
Basis Formula
  basis = (perpPrice - spotPrice) / spotPrice
        ↓
Entry / Exit Trigger
  basis > entryThreshold
  basis < exitThreshold
        ↓
CEX Actions
  spot buy
  perp short
  close positions
```

즉 `streaming -> formula/indicator -> trigger -> action` 흐름이 강제되어야 한다.

## 시간 기반 전략 문제

DCA처럼 시간에 따라 실행되는 전략은 `normal interval + condition trigger`로 쪼개면 안 된다.

나쁜 예:

```text
normal: DCA Interval = 86400000
trigger: eventTime % DCA Interval < 1000
```

좋은 예:

```text
trigger:
  triggerType: "time"
  intervalMs: 86400000
```

UI 고급 보기에서는 이것을 `Time Trigger` 하나로 보여줘야 한다. `DCA interval`이라는 별도 인디케이터/normal 노드는 필요 없다.

## 원하는 에이전트 루프

단일 AI 호출로 바로 JSON을 만들게 하면 논리 흐름이 빠질 수 있다. 다음과 같은 다단계 에이전트 루프가 필요하다.

1. Intent Planner

사용자 프롬프트에서 전략 유형과 필요한 논리 단계를 추출한다.

예:

```text
요청: BTC spot/perp 현선갭이 0.5% 이상이면 진입하고 0.1% 이하이면 종료

필요 단계:
- spot price feed
- perp price feed
- basis formula
- entry trigger
- exit trigger
- spot buy action
- perp short action
- close actions
```

2. Logic Graph Planner

런타임 JSON을 만들기 전에 사람이 이해할 수 있는 논리 흐름도를 먼저 만든다.

예:

```text
spot_feed.lastPrice + perp_feed.lastPrice
  -> basis_formula.value
  -> entry_trigger.true/false
  -> cex_spot_buy + cex_perp_short
```

이 단계에서 “raw feed가 action으로 바로 가도 되는가?”를 판단해야 한다. 계산/조건이 필요한 전략에서는 바로 가면 안 된다.

3. Strategy JSON Generator

논리 흐름도를 기반으로 JSON을 생성한다.

올바른 예:

```json
{
  "blocks": [
    {
      "id": "spot",
      "type": "streaming",
      "config": {
        "name": "BTC Spot Price",
        "sourceUrl": "wss://...",
        "updateIntervalMs": 1000,
        "fields": ["lastPrice"]
      }
    },
    {
      "id": "perp",
      "type": "streaming",
      "config": {
        "name": "BTC Perp Price",
        "sourceUrl": "wss://...",
        "updateIntervalMs": 1000,
        "fields": ["lastPrice"]
      }
    },
    {
      "id": "basis",
      "type": "normal",
      "config": {
        "name": "Spot Perp Basis",
        "expression": "(perp::lastPrice - spot::lastPrice) / spot::lastPrice",
        "outputBlocks": [{ "id": "value", "name": "basis", "type": "output" }]
      }
    },
    {
      "id": "entry",
      "type": "trigger",
      "config": {
        "name": "Entry Trigger",
        "triggerType": "condition",
        "condition": "basis > 0.005",
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
        "quote": 1000
      }
    }
  ],
  "connections": [
    { "id": "e1", "kind": "data-flow", "fromId": "spot", "toId": "basis" },
    { "id": "e2", "kind": "data-flow", "fromId": "perp", "toId": "basis" },
    { "id": "e3", "kind": "data-flow", "fromId": "basis", "toId": "entry" },
    { "id": "e4", "kind": "trigger-action", "fromId": "entry", "toId": "spot-buy" },
    { "id": "e5", "kind": "action-input", "fromId": "basis", "toId": "spot-buy" }
  ]
}
```

4. Logic Linter

JSON validator 이전에 전략 논리 검사를 수행한다. 이 검사는 단순 스키마 검사가 아니라 전략의 의미를 확인해야 한다.

필수 검사 예:

- action에 들어가기 전에 trigger가 있는가?
- trigger는 raw feed가 아니라 계산식/인디케이터/시간 조건을 기반으로 하는가?
- spot/perp, funding, spread, MA, RSI, volume 조건이 필요한 전략에서 formula/indicator node가 존재하는가?
- streaming feed가 action으로 바로 연결되어 있다면 그것이 정말 필요한 action input인지, 아니면 formula를 우회한 것인지 검사한다.
- time/DCA 전략은 `triggerType="time"`을 사용하는가?
- fixed parameter normal이 불필요하게 캔버스 노드로 노출되지 않는가?

5. Repair Loop

Logic Linter 또는 Go validator가 실패하면 AI에게 전체 JSON을 다시 고치게 한다. 단순히 누락된 edge를 자동 추가하면 안 된다. 자동 edge 추가는 논리를 왜곡할 수 있다.

Repair prompt에는 반드시 다음을 포함해야 한다.

```text
Do not bypass formula/indicator nodes.
If a strategy needs spread/basis/MA/RSI/funding calculation, create formula/indicator normal nodes and connect data-flow into trigger.
Raw market feeds must not directly trigger CEX/DEX actions unless the strategy is explicitly a pure market-data execution strategy.
```

6. UI Projection

검증된 runtime JSON을 프론트 고급 보기로 변환한다.

UI 규칙:

- streaming block: API/WSS endpoint와 생성 가능한 데이터 output block 표시
- normal with expression/formula/code: Indicator Logic 또는 Formula Node로 표시
- fixed normal: 별도 노드로 표시하지 않고 action/trigger 파라미터에 흡수
- triggerType=time: Time Trigger Node로 표시
- triggerType=condition: Condition Trigger 또는 Indicator Logic의 boolean output으로 표시
- action: CEX/DEX Action Node

## 현재 코드 위치

주요 파일:

```text
frontend/front/server.mjs
```

AI 호출, strategy JSON 파싱, 서버 정규화, Go validator 실행, repair loop, runtime artifact 생성이 들어 있다.

중요 함수:

```text
buildAIStrategySystemPrompt()
buildStrategyRepairSystemPrompt()
normalizeStrategyGraphForRunner()
validateRepairAndMaterializeStrategy()
inferRunnerConnectionKind()
forceTimeTriggersIntoTriggerBlocks()
```

```text
frontend/front/lib/easyViewAgent.ts
```

runtime strategy graph를 쉬운 보기/고급 보기 React Flow 모델로 변환한다.

중요 함수:

```text
createEasyViewFromStrategyGraph()
createAdvancedViewFromStrategyGraph()
buildAdvancedGraphFromStrategyGraph()
buildTimeTriggerNodeData()
buildFunctionNodeData()
```

```text
examples/strategy-runner/validator/validator.go
```

Go validator. 현재 `data-flow`를 지원해야 한다.

```text
examples/strategy-runner/main.go
```

런타임 실행기. streaming 값을 만들고, normal expression을 계산하고, trigger를 평가하고, action을 paper event로 실행한다.

## 현재 이미 적용된 방향

다음 방향은 이미 일부 반영되어 있다.

- 시간 기반 전략은 `triggerType="time"`을 쓰도록 서버 프롬프트와 정규화 강화
- `TimeTriggerNode`는 초 단위가 아니라 일/시간/분/초 UI로 표시
- `data-flow` connection kind 추가
- spot/perp basis 같은 전략은 formula normal node를 거쳐야 한다고 AI 프롬프트에 명시
- Go validator가 `data-flow`를 인정하도록 확장
- Go runner가 normal expression을 최소 산술식으로 평가하도록 확장

하지만 더 강한 에이전트 루프가 필요하다. 특히 AI가 생성한 JSON을 그대로 validator로 넘기기 전에, 별도의 Logic Linter가 의미 검사를 해야 한다.

## 해결해야 할 핵심 과제

1. 전략 논리 흐름도를 먼저 생성하고, 그 흐름도에서 JSON을 만들도록 강제한다.

2. Logic Linter를 만든다.

최소 검사:

```text
spot/perp keywords present -> basis formula node required
moving average keywords present -> MA formula/indicator node required
RSI keywords present -> RSI formula/indicator node required
funding/spread keywords present -> formula node required
DCA/time keywords present -> triggerType=time required
action node must be downstream of trigger
formula dependencies must use data-flow
```

3. Repair Loop를 의미 기반으로 바꾼다.

현재 repair는 validator 실패를 고치는 데 집중한다. 앞으로는 Logic Linter 실패도 repair 입력으로 들어가야 한다.

4. UI와 런타임의 표현 차이를 명확히 관리한다.

런타임 JSON은 제한된 block type을 쓰더라도, UI 고급 보기에서는 사람이 이해할 수 있게 다음처럼 보여야 한다.

```text
Price Feed -> Formula/Indicator -> Trigger -> Action
```

5. 자동 edge 보강을 조심한다.

자동으로 `streaming -> action`을 추가하면 validator는 통과할 수 있지만 전략 논리가 망가질 수 있다. 액션에 필요한 input이 formula output이라면 `formula -> action`으로 연결해야 한다.

## ChatGPT에게 물어볼 질문

다음 질문을 다른 AI에게 던지면 된다.

```text
우리는 트레이딩 전략 생성 AI를 만들고 있다. 현재 AI가 JSON graph를 직접 만들면 raw market feed를 CEX action에 바로 연결하는 문제가 있다. 예를 들어 spot/perp basis 전략은 spot/perp price feed -> basis formula -> trigger -> action 흐름이어야 하는데, AI가 price feed -> action으로 우회한다.

런타임 block type은 streaming, normal, trigger, action, monitoring이고, connection kind는 data-flow, trigger-action, action-input, stream-monitor다. normal은 고정값 또는 expression/formula 계산 노드로 쓸 수 있다.

우리는 AI agent loop를 설계하고 싶다. 목표는 사용자 프롬프트에서 먼저 논리 흐름도를 만들고, 그 흐름도를 기반으로 JSON을 생성하며, Logic Linter가 전략 의미를 검사하고, 실패 시 AI repair를 반복하는 것이다.

어떤 agent loop 구조, intermediate representation, logic lint rules, repair prompt, validator integration을 설계해야 raw data feed가 action으로 바로 가는 오류를 막고, formula/indicator -> trigger -> action 흐름을 강제할 수 있을까?
```

