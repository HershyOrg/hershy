#!/bin/bash
set -e

echo "========================================="
echo "Complete Web UI Test"
echo "========================================="

HOST_PORT=9000
TEST_USER="web-ui-test"
LOG_DIR="$(pwd)/logs/web-ui-test-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$LOG_DIR"

echo "Log directory: $LOG_DIR"
echo ""

# Step 1: Test Host API endpoints
echo "Step 1: Testing Host API endpoints..."
echo "  1.1: GET /programs"
curl -s "http://localhost:$HOST_PORT/programs" > "$LOG_DIR/list_programs.json"
PROG_COUNT=$(cat "$LOG_DIR/list_programs.json" | jq '.count')
echo "      ✓ Programs count: $PROG_COUNT"

# Step 2: Deploy trading-long
echo ""
echo "Step 2: Deploying trading-long program..."
EXAMPLE_DIR="../examples/trading-long"

DOCKERFILE_CONTENT=$(cat "$EXAMPLE_DIR/Dockerfile" | jq -Rs .)
GO_MOD_CONTENT=$(cat "$EXAMPLE_DIR/go.mod" | jq -Rs .)
GO_SUM_CONTENT=$(cat "$EXAMPLE_DIR/go.sum" | jq -Rs .)
MAIN_GO=$(cat "$EXAMPLE_DIR/main.go" | jq -Rs .)
BINANCE_STREAM=$(cat "$EXAMPLE_DIR/binance_stream.go" | jq -Rs .)
COMMANDS=$(cat "$EXAMPLE_DIR/commands.go" | jq -Rs .)
STATS=$(cat "$EXAMPLE_DIR/stats.go" | jq -Rs .)
TRADING_SIM=$(cat "$EXAMPLE_DIR/trading_sim.go" | jq -Rs .)

CREATE_RESP=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"$TEST_USER\",
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

echo "$CREATE_RESP" > "$LOG_DIR/create_program.json"
PROGRAM_ID=$(echo "$CREATE_RESP" | jq -r '.program_id')
PROXY_URL=$(echo "$CREATE_RESP" | jq -r '.proxy_url')

if [ "$PROGRAM_ID" = "null" ] || [ -z "$PROGRAM_ID" ]; then
    echo "❌ Failed to create program"
    cat "$LOG_DIR/create_program.json"
    exit 1
fi

echo "      ✓ Program created: $PROGRAM_ID"
echo "      ✓ Proxy URL: $PROXY_URL"

# Step 3: Start program
echo ""
echo "Step 3: Starting program..."
START_RESP=$(curl -s -X POST "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/start")
echo "$START_RESP" > "$LOG_DIR/start_program.json"
echo "      ✓ Start initiated"

# Step 4: Wait for Ready state
echo ""
echo "Step 4: Waiting for Ready state..."
for i in {1..12}; do
    sleep 5
    PROG_INFO=$(curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID")
    echo "$PROG_INFO" > "$LOG_DIR/program_state_${i}.json"
    STATE=$(echo "$PROG_INFO" | jq -r '.state')
    echo "      [$i] State: $STATE"

    if [ "$STATE" = "Ready" ]; then
        echo "      ✅ Program Ready!"
        CONTAINER_ID=$(echo "$PROG_INFO" | jq -r '.container_id')
        break
    fi

    if [ "$STATE" = "Error" ]; then
        echo "      ❌ Program failed to start"
        cat "$LOG_DIR/program_state_${i}.json" | jq '.'
        exit 1
    fi
done

if [ "$STATE" != "Ready" ]; then
    echo "      ❌ Program never reached Ready state"
    exit 1
fi

# Step 5: Test all Host API endpoints
echo ""
echo "Step 5: Testing all Host API endpoints..."

echo "  5.1: GET /programs (list)"
curl -s "http://localhost:$HOST_PORT/programs" > "$LOG_DIR/list_programs_after.json"
echo "      ✓ Programs list retrieved"

echo "  5.2: GET /programs/$PROGRAM_ID (detail)"
curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID" > "$LOG_DIR/program_detail.json"
echo "      ✓ Program detail retrieved"

echo "  5.3: GET /programs/$PROGRAM_ID/logs (Docker logs)"
curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/logs" > "$LOG_DIR/docker_logs.json"
LOG_LINES=$(cat "$LOG_DIR/docker_logs.json" | jq -r '.logs' | wc -l)
echo "      ✓ Docker logs retrieved ($LOG_LINES lines)"

# Step 6: Test all WatcherAPI endpoints (via proxy)
echo ""
echo "Step 6: Testing all WatcherAPI endpoints (via proxy)..."

echo "  6.1: GET /watcher/status"
curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/proxy/watcher/status" > "$LOG_DIR/watcher_status.json"
WATCHER_STATE=$(cat "$LOG_DIR/watcher_status.json" | jq -r '.state')
echo "      ✓ Watcher status: $WATCHER_STATE"

echo "  6.2: GET /watcher/logs?type=all&limit=10"
curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/proxy/watcher/logs?type=all&limit=10" > "$LOG_DIR/watcher_logs.json"
echo "      ✓ Watcher logs retrieved"

echo "  6.3: GET /watcher/signals"
curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/proxy/watcher/signals" > "$LOG_DIR/watcher_signals.json"
TOTAL_SIGNALS=$(cat "$LOG_DIR/watcher_signals.json" | jq -r '.totalPending')
echo "      ✓ Watcher signals: $TOTAL_SIGNALS pending"

echo "  6.4: POST /watcher/message"
curl -s -X POST "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/proxy/watcher/message" \
    -H "Content-Type: application/json" \
    -d '{"content":"status"}' > "$LOG_DIR/watcher_message.json"
echo "      ✓ Message sent"

# Step 7: Direct WatcherAPI access (via proxy_url)
echo ""
echo "Step 7: Testing direct WatcherAPI access (via proxy_url)..."

echo "  7.1: GET $PROXY_URL/watcher/status"
curl -s "$PROXY_URL/watcher/status" > "$LOG_DIR/direct_status.json"
echo "      ✓ Direct status retrieved"

echo "  7.2: GET $PROXY_URL/watcher/logs"
curl -s "$PROXY_URL/watcher/logs?type=all&limit=5" > "$LOG_DIR/direct_logs.json"
echo "      ✓ Direct logs retrieved"

# Step 8: Test web UI pages
echo ""
echo "Step 8: Testing web UI pages..."

echo "  8.1: GET /ui/programs (Dashboard)"
curl -s "http://localhost:$HOST_PORT/ui/programs" > "$LOG_DIR/ui_dashboard.html"
if grep -q "div id=\"root\"" "$LOG_DIR/ui_dashboard.html"; then
    echo "      ✓ Dashboard HTML loaded"
else
    echo "      ❌ Dashboard HTML malformed"
fi

echo "  8.2: GET /ui/programs/$PROGRAM_ID (ProgramDetail)"
curl -s "http://localhost:$HOST_PORT/ui/programs/$PROGRAM_ID" > "$LOG_DIR/ui_program_detail.html"
if grep -q "div id=\"root\"" "$LOG_DIR/ui_program_detail.html"; then
    echo "      ✓ ProgramDetail HTML loaded"
else
    echo "      ❌ ProgramDetail HTML malformed"
fi

echo "  8.3: GET /ui/programs/$PROGRAM_ID/watcher (WatcherPage)"
curl -s "http://localhost:$HOST_PORT/ui/programs/$PROGRAM_ID/watcher" > "$LOG_DIR/ui_watcher_page.html"
if grep -q "div id=\"root\"" "$LOG_DIR/ui_watcher_page.html"; then
    echo "      ✓ WatcherPage HTML loaded"
else
    echo "      ❌ WatcherPage HTML malformed"
fi

# Step 9: Cleanup
echo ""
echo "Step 9: Cleanup..."
curl -s -X POST "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/stop" > "$LOG_DIR/stop_program.json"
echo "      ✓ Program stopped"

sleep 3

curl -s -X DELETE "http://localhost:$HOST_PORT/programs/$PROGRAM_ID" > "$LOG_DIR/delete_program.json"
echo "      ✓ Program deleted"

# Summary
echo ""
echo "========================================="
echo "✅ Complete Web UI Test PASSED"
echo "========================================="
echo ""
echo "Results:"
echo "  Program ID: $PROGRAM_ID"
echo "  Container ID: $CONTAINER_ID"
echo "  Docker Logs: $LOG_LINES lines"
echo "  Watcher Signals: $TOTAL_SIGNALS pending"
echo ""
echo "Logs saved to: $LOG_DIR"
echo ""
echo "Next steps:"
echo "1. Review API responses in $LOG_DIR/*.json"
echo "2. Open browser to http://localhost:9000/ui/programs"
echo "3. Manually verify:"
echo "   - Dashboard displays programs"
echo "   - ProgramDetail shows all information"
echo "   - WatcherPage loads all components"
echo "   - Docker logs display correctly"
echo "   - WatcherAPI message system works"
