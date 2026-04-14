# strategy-runner

Minimal JSON-to-Hersh runner skeleton.

## Local run

```bash
cd examples/strategy-runner
go run . --strategy ./strategy.sample.json
```

Structured debug timeline state is written to `state/debug/timeline.json` by default.
Use a `.json` path for timestamp-keyed state output, or `.jsonl` for the legacy event stream.

```bash
go run . --strategy ./strategy.sample.json --debug-events-path ./tmp/timeline.json
```

Watcher API:

- `http://localhost:8080/watcher/status`
- `http://localhost:8080/watcher/varState`

## Notes

- This runner is intentionally minimal and uses synthetic stream snapshots.
- It interprets `streaming`, `normal`, `trigger`, `action`, `monitoring` blocks.
- `trigger-action` connections emit compact structured debug timeline entries for each action lifecycle.
- `runtime.auth.binance` can enable live Binance spot orders for `actionType: "cex"` and `exchange: "Binance"`.
- The bundled `strategy.sample.json` keeps `authenticated: false` so it stays safe by default.
