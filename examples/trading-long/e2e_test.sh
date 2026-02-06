#!/bin/bash
set -e

echo "========================================="
echo "E2E Test: trading-long (5-min auto-stop)"
echo "========================================="

HOST_PORT=9000
PROGRAM_ID="trading-sim1"
EXAMPLE_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$EXAMPLE_DIR/logs"

rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

cleanup() {
    echo ""
    echo "Cleanup..."
    curl -s -X DELETE "http://localhost:$HOST_PORT/programs/$PROGRAM_ID" 2>/dev/null || true
    sleep 2
    kill $HOST_PID 2>/dev/null || true

    # 컨테이너 로그 수집
    CONTAINER_ID=$(docker ps -a --filter "name=hersh-program-$PROGRAM_ID" --format "{{.ID}}" | head -1)
    if [ -n "$CONTAINER_ID" ]; then
        docker logs "$CONTAINER_ID" > "$LOG_DIR/container.log" 2>&1 || true

        # /state 로그 복사
        docker cp "$CONTAINER_ID:/state/trading.log" "$LOG_DIR/trading.log" 2>/dev/null || true
    fi

    echo "Logs: $LOG_DIR"
}
trap cleanup EXIT

# Step 1: Host 서버 시작
echo ""
echo "Step 1: Starting Host server..."
cd ../../cmd/host
./host --port "$HOST_PORT" --storage ./test-storage --runtime runc \
    > "$LOG_DIR/host.log" 2>&1 &
HOST_PID=$!
echo "   Host PID: $HOST_PID"
sleep 3

# Step 2: Program 생성
echo ""
echo "Step 2: Creating trading program..."

# Read files
DOCKERFILE_CONTENT=$(cat "$EXAMPLE_DIR/Dockerfile" | jq -Rs .)
GO_MOD_CONTENT=$(cat "$EXAMPLE_DIR/go.mod" | jq -Rs .)
GO_SUM_CONTENT=$(cat "$EXAMPLE_DIR/go.sum" | jq -Rs .)

# Read all .go files
MAIN_GO=$(cat "$EXAMPLE_DIR/main.go" | jq -Rs .)
BINANCE_STREAM=$(cat "$EXAMPLE_DIR/binance_stream.go" | jq -Rs .)
COMMANDS=$(cat "$EXAMPLE_DIR/commands.go" | jq -Rs .)
STATS=$(cat "$EXAMPLE_DIR/stats.go" | jq -Rs .)
TRADING_SIM=$(cat "$EXAMPLE_DIR/trading_sim.go" | jq -Rs .)

CREATE_RESP=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"test-user\",
        \"dockerfile\": $DOCKERFILE_CONTENT,
        \"src_files\": {
            \"main.go\": $MAIN_GO,
            \"binance_stream.go\": $BINANCE_STREAM,
            \"commands.go\": $COMMANDS,
            \"stats.go\": $STATS,
            \"trading_sim.go\": $TRADING_SIM,
            \"go.mod\": $GO_MOD_CONTENT,
            \"go.sum\": $GO_SUM_CONTENT
        }
    }")

echo "$CREATE_RESP" | jq '.' | tee "$LOG_DIR/create_response.json"
PROGRAM_ID=$(echo "$CREATE_RESP" | jq -r '.program_id')

if [ "$PROGRAM_ID" = "null" ] || [ -z "$PROGRAM_ID" ]; then
    echo "   ❌ Failed to create program"
    exit 1
fi

echo "   Program ID: $PROGRAM_ID"

# Step 3: 빌드 대기 (60초 - 복잡한 빌드)
echo ""
echo "Step 3: Waiting for build (60s)..."
sleep 60

# Step 4: 상태 확인
echo ""
echo "Step 4: Checking program status..."
for i in {1..20}; do
    PROG_INFO=$(curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID")
    STATE=$(echo "$PROG_INFO" | jq -r '.state')
    echo "   Attempt $i: $STATE"

    if [ "$STATE" = "Ready" ]; then
        echo "   ✅ Program Ready!"
        echo "$PROG_INFO" | jq '.' > "$LOG_DIR/program_ready.json"
        break
    fi

    if [ "$STATE" = "Error" ]; then
        echo "   ❌ Build failed!"
        echo "$PROG_INFO" | jq '.'
        exit 1
    fi

    sleep 10
done

if [ "$STATE" != "Ready" ]; then
    echo "   ❌ Program never reached Ready state"
    exit 1
fi

# Step 5: 5분 모니터링 (자동 종료 대기)
echo ""
echo "Step 5: Monitoring for 5 minutes (auto-stop)..."
echo "Time(s),Program State,Watcher State,Uptime,Signals" > "$LOG_DIR/monitoring.csv"

PROXY_URL=$(echo "$PROG_INFO" | jq -r '.proxyURL')
echo "   Proxy URL: $PROXY_URL"

for i in {1..30}; do
    sleep 10

    # Program 상태
    PROG_STATE=$(curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID" 2>/dev/null | jq -r '.state')

    # WatcherAPI 상태
    WATCHER_STATUS=$(curl -s "$PROXY_URL/watcher/status" 2>/dev/null)
    if [ $? -eq 0 ]; then
        WATCHER_STATE=$(echo "$WATCHER_STATUS" | jq -r '.state')
        UPTIME=$(echo "$WATCHER_STATUS" | jq -r '.uptime')

        SIGNALS=$(curl -s "$PROXY_URL/watcher/signals" 2>/dev/null)
        TOTAL=$(echo "$SIGNALS" | jq -r '.totalPending // 0')

        echo "$((i*10)),$PROG_STATE,$WATCHER_STATE,$UPTIME,$TOTAL" >> "$LOG_DIR/monitoring.csv"
        printf "   [%03ds] Program: %-10s | Watcher: %-10s | Uptime: %s | Signals: %d\n" \
            $((i*10)) "$PROG_STATE" "$WATCHER_STATE" "$UPTIME" "$TOTAL"

        # 로그 스냅샷 (30초마다)
        if [ $((i % 3)) -eq 0 ]; then
            curl -s "$PROXY_URL/watcher/logs?type=all&limit=20" \
                > "$LOG_DIR/watcher_logs_${i}.json" 2>/dev/null
        fi
    else
        echo "$((i*10)),$PROG_STATE,CONNECTION_FAILED,-,-" >> "$LOG_DIR/monitoring.csv"
        printf "   [%03ds] Program: %-10s | Watcher: CONNECTION_FAILED\n" \
            $((i*10)) "$PROG_STATE"
    fi

    # 자동 종료 감지
    if [ "$PROG_STATE" = "Stopped" ]; then
        echo ""
        echo "   ✅ Program auto-stopped after $(($i*10))s"
        break
    fi
done

echo ""
echo "========================================="
echo "✅ E2E Test Completed!"
echo "========================================="
echo ""
echo "Logs:"
echo "  - Host:       $LOG_DIR/host.log"
echo "  - Container:  $LOG_DIR/container.log"
echo "  - Trading:    $LOG_DIR/trading.log"
echo "  - Monitoring: $LOG_DIR/monitoring.csv"
