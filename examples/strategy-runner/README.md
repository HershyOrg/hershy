# strategy-runner

Minimal JSON-to-Hersh runner skeleton.

## Hershy -> JSON conversion grammar (validation target)

This runner expects a converted JSON graph with these rules:

- Root `kind` must be `hershy-strategy-graph` when present.
- `blocks` must contain unique `id` values.
- Supported block `type`: `streaming`, `normal`, `trigger`, `action`, `monitoring`.
- `streaming` block should include `config.updateIntervalMs`.
- If `trigger.config.triggerType == "condition"`, `trigger.config.condition` must be non-empty.
- `connections` should connect valid block IDs.
- Supported connection `kind` and shape:
 	- `trigger-action`: `trigger -> action`
 	- `action-input`: `(streaming|normal) -> action`
 	- `stream-monitor`: `streaming -> monitoring`

Completeness checks (important for watcher/manager execution graph):

- At least one `streaming`, one `trigger`, and one `action` block must exist.
- Every `trigger` must connect to at least one `action` via `trigger-action`.
- Every `action` must have both:
  - incoming `trigger-action`
  - incoming `action-input` data
- Every `monitoring` block must have incoming `stream-monitor`.
- Every `streaming` block must be consumed by `action-input` or `stream-monitor`.
- Every `normal` block must be consumed by at least one `action-input`.
- No isolated blocks and no disconnected graph components are allowed.

## Validate converted JSON

```bash
cd examples/strategy-runner
go run ./cmd/strategy-validate --file ./strategy.sample.json
```

Exit code:

- `0`: valid
- `1`: invalid (grammar/reference errors found)
- `2`: file or JSON parse error

## Generate one-to-one Hershy Go source

```bash
cd examples/strategy-runner
go run ./cmd/strategy-codegen --file ./strategy.sample.json --out ./generated_strategy.go
go test .
```

The generated Go source keeps every JSON block and connection as explicit Go runner definitions:

- `streaming` -> `runner.StreamDef`, executed through `hersh.WatchCall`
- `normal` -> `generatedNormalConfigs`, evaluated by the runner
- `trigger` -> `runner.TriggerDef`
- `action` -> `runner.ActionDef`, executed by paper/testnet/live adapters
- `connections` -> `runner.ConnectionDef`

See [CODEGEN_MAPPING.md](./CODEGEN_MAPPING.md) for the full JSON-to-Go mapping.

## Local run

```bash
cd examples/strategy-runner
go run . --strategy ./strategy.sample.json
```

Watcher API:

- `http://localhost:8080/watcher/status`
- `http://localhost:8080/watcher/varState`

## Notes

- This runner is intentionally minimal and uses synthetic stream snapshots.
- It interprets `streaming`, `normal`, `trigger`, `action`, `monitoring` blocks.
- `trigger-action` connections fire actions in paper mode.
- Trading mode defaults to paper. Set `HERSHY_TRADING_MODE=testnet` for Binance Spot testnet or `HERSHY_TRADING_MODE=live` plus `HERSHY_LIVE_TRADING_ENABLED=true` for live orders.
- Binance live/testnet execution requires `BINANCE_API_KEY` and `BINANCE_API_SECRET`. `HERSHY_MAX_ORDER_NOTIONAL` defaults to `50` as a guardrail.
