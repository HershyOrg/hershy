# strategy-runner

Minimal JSON-to-Hersh runner skeleton.

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
