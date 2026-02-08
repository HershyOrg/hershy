#!/bin/bash
set -e

echo "========================================="
echo "Deploy trading-long for UI Test"
echo "========================================="

HOST_PORT=9000
EXAMPLE_DIR="../examples/trading-long"
USER_ID="ui-test-user"

# Read files
echo "Reading source files..."
DOCKERFILE_CONTENT=$(cat "$EXAMPLE_DIR/Dockerfile" | jq -Rs .)
GO_MOD_CONTENT=$(cat "$EXAMPLE_DIR/go.mod" | jq -Rs .)
GO_SUM_CONTENT=$(cat "$EXAMPLE_DIR/go.sum" | jq -Rs .)
MAIN_GO=$(cat "$EXAMPLE_DIR/main.go" | jq -Rs .)
BINANCE_STREAM=$(cat "$EXAMPLE_DIR/binance_stream.go" | jq -Rs .)
COMMANDS=$(cat "$EXAMPLE_DIR/commands.go" | jq -Rs .)
STATS=$(cat "$EXAMPLE_DIR/stats.go" | jq -Rs .)
TRADING_SIM=$(cat "$EXAMPLE_DIR/trading_sim.go" | jq -Rs .)

echo "Creating program..."
CREATE_RESP=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"$USER_ID\",
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

echo "$CREATE_RESP" | jq '.'
PROGRAM_ID=$(echo "$CREATE_RESP" | jq -r '.program_id')

if [ "$PROGRAM_ID" = "null" ] || [ -z "$PROGRAM_ID" ]; then
    echo "❌ Failed to create program"
    exit 1
fi

echo ""
echo "✅ Program created: $PROGRAM_ID"
echo ""
echo "Next steps:"
echo "1. Start program: curl -X POST http://localhost:$HOST_PORT/programs/$PROGRAM_ID/start"
echo "2. Open Dashboard: http://localhost:9000/ui/programs"
echo "3. Wait for Ready state (check every 10s)"
echo "4. Open WatcherPage: http://localhost:9000/ui/programs/$PROGRAM_ID/watcher"
