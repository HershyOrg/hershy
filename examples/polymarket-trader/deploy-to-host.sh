#!/bin/bash
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$EXAMPLE_DIR/../.." && pwd)"

HOST_URL="${HOST_URL:-http://localhost:9000}"
USER_ID="${USER_ID:-test-user-$(date +%s)}"

MODEL_PATH="${MODEL_PATH:-$ROOT_DIR/backtest/src/out/prob_model_logit_all.json}"
SLUG="${SLUG:-}"
AUTO_SLUG="${AUTO_SLUG:-}"
SLUG_PREFIX="${SLUG_PREFIX:-}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "❌ MODEL_PATH not found: $MODEL_PATH" >&2
  echo "   Set MODEL_PATH to a valid model JSON file." >&2
  exit 1
fi

if [[ -z "$SLUG" ]]; then
  case "${AUTO_SLUG,,}" in
    1|true|yes) ;;
    *)
      echo "❌ Provide SLUG or set AUTO_SLUG=1 with SLUG_PREFIX." >&2
      exit 1
      ;;
  esac
fi

if [[ ! -d "$ROOT_DIR/cctx" ]]; then
  echo "❌ cctx module not found at: $ROOT_DIR/cctx" >&2
  exit 1
fi

CCTX_TAR="$(mktemp)"
CCTX_B64="$(mktemp)"
cleanup() {
  rm -f "$CCTX_TAR" "$CCTX_B64"
}
trap cleanup EXIT

tar -czf "$CCTX_TAR" -C "$ROOT_DIR/cctx" .
base64 < "$CCTX_TAR" > "$CCTX_B64"

create_resp=$(
EXAMPLE_DIR="$EXAMPLE_DIR" \
MODEL_PATH="$MODEL_PATH" \
CCTX_B64="$CCTX_B64" \
USER_ID="$USER_ID" \
SLUG="$SLUG" \
AUTO_SLUG="$AUTO_SLUG" \
SLUG_PREFIX="$SLUG_PREFIX" \
EXTRA_ARGS="$EXTRA_ARGS" \
python3 - <<'PY' | curl -s -X POST "$HOST_URL/programs" \
  -H "Content-Type: application/json" \
  --data-binary @-
import json
import os
import shlex
from pathlib import Path

example_dir = Path(os.environ["EXAMPLE_DIR"])
model_path = Path(os.environ["MODEL_PATH"])
model_name = model_path.name
cctx_b64_path = Path(os.environ["CCTX_B64"])

cmd = ["/app/polymarket-trader", "--model-path", f"/app/{model_name}"]
slug = os.environ.get("SLUG", "")
auto_slug = os.environ.get("AUTO_SLUG", "")
slug_prefix = os.environ.get("SLUG_PREFIX", "")
extra_args = os.environ.get("EXTRA_ARGS", "")

if slug:
    cmd += ["--slug", slug]
elif auto_slug.lower() in ("1", "true", "yes"):
    cmd.append("--auto-slug")
    if slug_prefix:
        cmd += ["--slug-prefix", slug_prefix]

if extra_args:
    cmd += shlex.split(extra_args)

dockerfile = f"""FROM golang:1.24-alpine AS builder

WORKDIR /build

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
COPY *.go ./
COPY cctx.tgz.b64 ./

RUN mkdir -p /build/cctx \
    && base64 -d cctx.tgz.b64 | tar -xz -C /build/cctx

RUN go mod edit -replace github.com/HershyOrg/hershy/cctx=./cctx
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o polymarket-trader .

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /build/polymarket-trader /app/
COPY {model_name} /app/

EXPOSE 8080

CMD {json.dumps(cmd)}
"""

files = {}
for path in example_dir.glob("*.go"):
    files[path.name] = path.read_text(encoding="utf-8")

files["go.mod"] = (example_dir / "go.mod").read_text(encoding="utf-8")
files["go.sum"] = (example_dir / "go.sum").read_text(encoding="utf-8")
files[model_name] = model_path.read_text(encoding="utf-8")
files["cctx.tgz.b64"] = cctx_b64_path.read_text(encoding="utf-8")

payload = {
    "user_id": os.environ["USER_ID"],
    "dockerfile": dockerfile,
    "src_files": files,
}

print(json.dumps(payload))
PY
)

echo "$create_resp" | python3 -m json.tool 2>/dev/null || echo "$create_resp"

program_id=$(echo "$create_resp" | python3 -c 'import json,sys
try:
    data=json.load(sys.stdin)
    print(data.get("program_id",""))
except Exception:
    print("")')

if [[ -z "$program_id" ]]; then
  echo "❌ Failed to create program" >&2
  exit 1
fi

echo ""
echo "✅ Program created: $program_id"

echo ""
echo "📊 Starting program..."
start_resp=$(curl -s -X POST "$HOST_URL/programs/$program_id/start")
echo "$start_resp" | python3 -m json.tool 2>/dev/null || echo "$start_resp"

echo ""
echo "⏳ Monitor progress:"
echo "   curl $HOST_URL/programs/$program_id"
echo ""
echo "🔗 Access WatcherAPI (once Ready):"
echo "   curl $HOST_URL/programs/$program_id/proxy/watcher/status"
