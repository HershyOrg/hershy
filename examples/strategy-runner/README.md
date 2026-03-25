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
