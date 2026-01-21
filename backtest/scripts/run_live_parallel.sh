#!/usr/bin/env bash
set -euo pipefail

# Live trading runner for 3 strategies using the same model.
# WARNING: This places real orders. Use at your own risk.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REQUIRED_ENV=(
  POLY_PRIVATE_KEY
  POLY_FUNDER
  POLY_API_KEY
  POLY_API_SECRET
  POLY_API_PASSPHRASE
)

missing=0
for key in "${REQUIRED_ENV[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "[ERROR] Missing env var: $key" >&2
    missing=1
  fi
done
if [[ $missing -eq 1 ]]; then
  echo "Set required env vars and re-run." >&2
  exit 1
fi

# Allocate per-strategy max spend (USDC). Adjust as needed.
MAX_USDC_PER_STRAT=${MAX_USDC_PER_STRAT:-200}
RESERVE_USDC=${RESERVE_USDC:-0}
ORDER_TYPE=${ORDER_TYPE:-FAK}
SLUG_PREFIX=${SLUG_PREFIX:-bitcoin-up-or-down}
THETA=${THETA:-0.5}

RUN_TAG=${RUN_TAG:-$(date -u +%Y%m%dT%H%M%SZ)}

run_one() {
  local name=$1
  local entry_high=$2
  local entry_low=$3
  local log_path="src/out/live_${name}_${RUN_TAG}.log"

  nohup .venv/bin/python src/polymarket_trader.py \
    --auto-slug \
    --slug-prefix "$SLUG_PREFIX" \
    --entry-high "$entry_high" \
    --entry-low "$entry_low" \
    --theta "$THETA" \
    --order-type "$ORDER_TYPE" \
    --max-usdc "$MAX_USDC_PER_STRAT" \
    --reserve-usdc "$RESERVE_USDC" \
    > "$log_path" 2>&1 &
  echo "$!"
}

echo "[BOOT] starting live strategies (max_usdc=$MAX_USDC_PER_STRAT, reserve_usdc=$RESERVE_USDC)"
PID_96_04=$(run_one "96_04" 0.96 0.04)
PID_80_20=$(run_one "80_20" 0.80 0.20)
PID_60_40=$(run_one "60_40" 0.60 0.40)

echo "[OK] 0.96/0.04 pid=$PID_96_04 log=src/out/live_96_04_${RUN_TAG}.log"
echo "[OK] 0.80/0.20 pid=$PID_80_20 log=src/out/live_80_20_${RUN_TAG}.log"
echo "[OK] 0.60/0.40 pid=$PID_60_40 log=src/out/live_60_40_${RUN_TAG}.log"

echo "To stop: kill $PID_96_04 $PID_80_20 $PID_60_40"
