# 전략 코드 생성 매핑 설명서

이 문서는 `strategy-codegen`이 검증된 `hershy-strategy-graph` JSON을 어떻게 `generated_strategy.go`로 바꾸는지 설명합니다.

핵심은 이겁니다.

`generated_strategy.go`는 실행 시점에 JSON을 다시 파싱하는 파일이 아닙니다. JSON 안에 있던 블록과 간선을 Go 값으로 박아 넣고, 그 값을 공통 `runner.Engine`에 넘겨서 Hershy 엔진 위에서 실행합니다.

## 전체 흐름

```text
strategy.json
  -> validator.Validate(graph)
  -> codegen.Generate(graph)
  -> generated_strategy.go
  -> runner.NewEngine(...)
  -> hersh.NewWatcher(...).Manage(engine.Run, ...)
```

생성 순서는 다음과 같습니다.

1. `strategy.json`을 읽습니다.
2. `validator.Validate`로 블록/간선 구조를 검증합니다.
3. 검증에 성공하면 `generated_strategy.go`를 만듭니다.
4. 생성된 Go 파일 안에 JSON 블록과 간선을 Go struct 값으로 박아 넣습니다.
5. `runner.NewEngine(...)`에 넘겨 실행 그래프를 만듭니다.
6. `hersh.NewWatcher`와 `watcher.Manage`로 Hershy 엔진 위에서 실행합니다.

검증에 실패하면 Go 코드는 생성되지 않습니다.

## 전략 메타데이터 매핑

JSON:

```json
{
  "strategy": {
    "id": "btc-basis",
    "name": "BTC Basis Strategy"
  }
}
```

생성 Go:

```go
const generatedStrategyName = "BTC Basis Strategy"
const generatedManagerName = "btc_basis"
```

의미:

- `generatedStrategyName`: 런타임 로그와 Hershy context의 `strategy_meta`에 들어갑니다.
- `generatedManagerName`: `watcher.Manage(..., generatedManagerName)`의 manager 이름으로 사용됩니다.

## 블록 인벤토리

모든 JSON 블록은 `generatedBlockInventory`에도 복사됩니다.

```go
var generatedBlockInventory = []struct {
    ID   string
    Type string
    Name string
}{
    {ID: "stream-btc", Type: "streaming", Name: "BTC Feed"},
    {ID: "entry-trigger", Type: "trigger", Name: "Entry Trigger"},
}
```

이 값은 전략 실행에는 직접 사용되지 않습니다.

용도는 감사와 디버깅입니다. 생성된 Go 파일만 봐도 원본 JSON에 어떤 블록 ID가 있었는지 확인할 수 있게 하기 위한 목록입니다.

## Streaming 블록 매핑

JSON:

```json
{
  "id": "stream-btc",
  "type": "streaming",
  "config": {
    "name": "BTC Feed",
    "sourceUrl": "wss://stream.binance.com:9443/ws/btcusdt@ticker",
    "updateIntervalMs": 1000,
    "fields": ["lastPrice", "volume"]
  }
}
```

생성 Go:

```go
var generatedStreams = []runner.StreamDef{
    {
        ID:         "stream-btc",
        Name:       "BTC Feed",
        Fields:     []string{"lastPrice", "volume"},
        IntervalMs: 1000,
        SourceURL:  "wss://stream.binance.com:9443/ws/btcusdt@ticker",
    },
}
```

실행 시에는 `runner.Engine.Run` 안에서 Hershy watched variable로 바뀝니다.

```go
val := hersh.WatchCall(
    ...,
    "stream_"+stream.ID,
    time.Duration(stream.IntervalMs)*time.Millisecond,
    ctx,
)
```

따라서 `stream-btc`라는 streaming 블록은 Hershy 안에서 `stream_stream-btc`라는 watched variable이 됩니다.

결과 값은 Hershy context에 다음 이름으로 저장됩니다.

```go
ctx.SetValue("stream_values", streamValues)
```

## Normal 블록 매핑

JSON:

```json
{
  "id": "basis",
  "type": "normal",
  "config": {
    "name": "Basis",
    "formula": "(perp::lastPrice - spot::lastPrice) / spot::lastPrice * 100"
  }
}
```

생성 Go:

```go
var generatedNormalConfigs = map[string]map[string]any{
    "basis": {
        "name":    "Basis",
        "formula": "(perp::lastPrice - spot::lastPrice) / spot::lastPrice * 100",
    },
}
```

실행 방식:

- `config.value`가 있으면 고정값 normal block입니다.
- `config.expression`, `config.formula`, `config.logic`, `config.code`가 있으면 계산식 normal block입니다.
- 계산은 `runner.Engine.computeNormalValues(...)`에서 처리됩니다.

계산된 값은 Hershy context에 저장됩니다.

```go
ctx.SetValue("normal_values", normalValues)
```

즉 normal 블록은 Go 함수 하나로 펼쳐지는 것이 아니라, Go map에 config가 들어가고 runner가 이를 계산합니다.

## Trigger 블록 매핑

JSON:

```json
{
  "id": "entry-trigger",
  "type": "trigger",
  "config": {
    "name": "Entry Trigger",
    "triggerType": "condition",
    "condition": "basis > 0.5"
  }
}
```

생성 Go:

```go
var generatedTriggers = []runner.TriggerDef{
    {
        ID:        "entry-trigger",
        Name:      "Entry Trigger",
        Type:      "condition",
        Condition: "basis > 0.5",
        IntervalMs: 1000,
    },
}
```

실행 방식:

- `manual`: watcher message가 `trigger:<trigger-id>` 또는 `trigger:all`이면 발동합니다.
- `time`: `intervalMs`가 지났을 때 발동합니다.
- `condition`: 조건이 false에서 true로 바뀌는 순간, 즉 rising edge에서 발동합니다.

Trigger 관련 상태는 Hershy context에 저장됩니다.

```go
ctx.SetValue("trigger_prev_state", nextCond)
ctx.SetValue("trigger_last_fire_ms", lastFire)
ctx.SetValue("trigger_fires", triggerFire)
```

## Action 블록 매핑

JSON:

```json
{
  "id": "buy-btc",
  "type": "action",
  "config": {
    "name": "Buy BTC",
    "actionType": "cex",
    "exchange": "Binance",
    "symbol": "BTCUSDT",
    "side": "BUY",
    "orderType": "MARKET",
    "quoteOrderQty": "25"
  }
}
```

생성 Go:

```go
var generatedActions = []runner.ActionDef{
    {
        ID:   "buy-btc",
        Name: "Buy BTC",
        Kind: "cex",
        Config: map[string]any{
            "name":          "Buy BTC",
            "actionType":    "cex",
            "exchange":      "Binance",
            "symbol":        "BTCUSDT",
            "side":          "BUY",
            "orderType":     "MARKET",
            "quoteOrderQty": "25",
        },
    },
}
```

실행 시에는 `runner.Engine.Run`에서 action이 실행됩니다.

```go
result, err := liveexec.ExecuteAction(context.Background(), liveexec.Action{
    ID:     action.ID,
    Name:   action.Name,
    Kind:   action.Kind,
    Config: action.Config,
}, inputs, nowMs)
```

기본 실행 모드는 paper입니다.

```bash
HERSHY_TRADING_MODE=paper
```

Binance testnet 주문은 다음 환경변수가 필요합니다.

```bash
HERSHY_TRADING_MODE=testnet
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
```

실거래 주문은 추가로 live unlock이 필요합니다.

```bash
HERSHY_TRADING_MODE=live
HERSHY_LIVE_TRADING_ENABLED=true
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
```

주문 결과는 Hershy context에 저장됩니다.

```go
ctx.SetValue("last_action", event)
ctx.SetValue("action_events", actionEvents)
ctx.SetValue("action_results", actionResults)
```

## Monitoring 블록 매핑

JSON:

```json
{
  "id": "order-monitor",
  "type": "monitoring",
  "config": {
    "name": "Order Monitor",
    "fields": ["status", "avgFillPrice"]
  }
}
```

생성 Go:

```go
var generatedMonitors = []runner.MonitorDef{
    {
        ID:     "order-monitor",
        Name:   "Order Monitor",
        Fields: []string{"status", "avgFillPrice"},
    },
}
```

실행 방식:

- `stream-monitor` 간선이 있으면 특정 stream 값을 monitor에 연결합니다.
- `action-result` 간선이 있으면 action 결과를 monitor에 연결합니다.
- monitor 값은 Hershy context에 `monitor_<monitor-id>`로 저장됩니다.

예:

```go
ctx.SetValue("monitor_"+monitor.ID, monitorValue)
```

## Connection 간선 매핑

모든 JSON connection은 `generatedConnections`로 복사됩니다.

JSON:

```json
{
  "id": "edge-entry-buy",
  "kind": "trigger-action",
  "fromId": "entry-trigger",
  "toId": "buy-btc"
}
```

생성 Go:

```go
var generatedConnections = []runner.ConnectionDef{
    {
        ID:     "edge-entry-buy",
        Kind:   "trigger-action",
        FromID: "entry-trigger",
        ToID:   "buy-btc",
    },
}
```

`runner.NewEngine`은 이 간선들을 실행용 인덱스로 바꿉니다.

```text
trigger-action -> triggerToActions[from] = append(..., to)
trigger-input  -> triggerInputs[to] = append(..., from)
action-input   -> actionInputs[to] = append(..., from)
data-flow      -> dataInputs[to] = append(..., from)
action-result  -> actionResultInputs[to] = append(..., from)
stream-monitor -> monitor.StreamID = from
```

예를 들어:

```json
{
  "kind": "trigger-action",
  "fromId": "entry-trigger",
  "toId": "buy-btc"
}
```

이 간선은 내부적으로 다음 의미가 됩니다.

```text
entry-trigger가 fired 되면 buy-btc action을 실행한다
```

그리고:

```json
{
  "kind": "action-input",
  "fromId": "basis",
  "toId": "buy-btc"
}
```

이 간선은 내부적으로 다음 의미가 됩니다.

```text
buy-btc action 실행 시 basis 값을 input으로 넣는다
```

## Engine 생성 지점

생성된 Go 파일은 항상 다음 함수를 포함합니다.

```go
func buildGeneratedEngine() (*runner.Engine, error) {
    return runner.NewEngine(
        generatedStrategyName,
        generatedStreams,
        generatedNormalConfigs,
        generatedTriggers,
        generatedActions,
        generatedMonitors,
        generatedConnections,
    )
}
```

여기가 JSON에서 생성된 Go struct 값들이 실제 실행 엔진으로 들어가는 지점입니다.

즉 일대일 대응은 다음 형태입니다.

```text
JSON blocks      -> generatedStreams / generatedNormalConfigs / generatedTriggers / generatedActions / generatedMonitors
JSON connections -> generatedConnections
generated values -> runner.NewEngine(...)
runner.Engine    -> Hershy watcher 안에서 실행
```

## Hershy 실행 지점

`generated_strategy.go`의 `main`은 Hershy watcher를 직접 띄웁니다.

```go
config := hersh.DefaultWatcherConfig()
config.ServerPort = 8080
config.DefaultTimeout = 5 * time.Minute

watcher := hersh.NewWatcher(config, map[string]string{
    "RUNNER": "generated-strategy",
}, context.Background())

watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
    return engine.Run(msg, ctx)
}, generatedManagerName)

watcher.Start()
```

따라서 생성된 전략은 Hershy watcher API로 볼 수 있습니다.

```text
/watcher/status
/watcher/varState
/watcher/watching
/watcher/signals
```

Host Program으로 등록된 경우에는 host proxy를 통해 접근합니다.

```text
/programs/{program_id}/proxy/watcher/status
/programs/{program_id}/proxy/watcher/varState
```

## 일대일 대응을 확인하는 방법

생성된 `generated_strategy.go`가 원본 JSON과 맞는지 확인하려면 다음을 보면 됩니다.

1. 모든 JSON block ID가 `generatedBlockInventory`에 있는지 확인합니다.
2. 모든 `streaming` 블록이 `generatedStreams`에 있는지 확인합니다.
3. 모든 `normal` 블록이 `generatedNormalConfigs`에 있는지 확인합니다.
4. 모든 `trigger` 블록이 `generatedTriggers`에 있는지 확인합니다.
5. 모든 `action` 블록이 `generatedActions`에 있는지 확인합니다.
6. 모든 `monitoring` 블록이 `generatedMonitors`에 있는지 확인합니다.
7. 모든 JSON connection이 `generatedConnections`에 있는지 확인합니다.
8. `buildGeneratedEngine`이 모든 generated 값을 `runner.NewEngine`에 넘기는지 확인합니다.
9. `main`이 `hersh.NewWatcher`를 만들고 `watcher.Manage(engine.Run, ...)`를 호출하는지 확인합니다.

## 현재 구조의 한계

현재 codegen은 JSON 블록을 Go struct 값으로 일대일 생성합니다.

하지만 각 블록을 완전히 독립적인 Go 함수로 펼치지는 않습니다.

현재 구조:

```text
JSON block
  -> Go struct value
  -> runner.Engine에서 실행
```

아직 아닌 구조:

```text
JSON block
  -> 블록별 전용 Go 함수
  -> 함수 간 직접 호출 코드
```

즉 지금은 `strategy.json`을 런타임에 파싱하지 않도록 Go 코드에 박아 넣는 방식이고, 실행 로직은 공통 `runner.Engine`이 담당합니다.

