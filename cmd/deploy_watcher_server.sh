#!/bin/bash
set -e

echo "==========================="
echo "Deploy watcher-server"
echo "==========================="

HOST_PORT=9000
EXAMPLE_DIR="../examples/watcher-server"

# Read files
DOCKERFILE_CONTENT=$(cat "$EXAMPLE_DIR/Dockerfile" | jq -Rs .)
GO_MOD_CONTENT=$(cat "$EXAMPLE_DIR/go.mod" | jq -Rs .)
# watcher-server doesn't have go.sum initially - generate it
cd "$EXAMPLE_DIR"
go mod download 2>/dev/null || true
cd - > /dev/null

if [ -f "$EXAMPLE_DIR/go.sum" ]; then
    GO_SUM_CONTENT=$(cat "$EXAMPLE_DIR/go.sum" | jq -Rs .)
else
    GO_SUM_CONTENT='""'
fi

MAIN_GO=$(cat "$EXAMPLE_DIR/main.go" | jq -Rs .)

echo "Creating program..."
CREATE_RESP=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"final-test\",
        \"dockerfile\": $DOCKERFILE_CONTENT,
        \"src_files\": {
            \"main.go\": $MAIN_GO,
            \"go.mod\": $GO_MOD_CONTENT,
            \"go.sum\": $GO_SUM_CONTENT
        }
    }")

echo "$CREATE_RESP" | jq '.'
PROGRAM_ID=$(echo "$CREATE_RESP" | jq -r '.program_id')
PROXY_URL=$(echo "$CREATE_RESP" | jq -r '.proxy_url')

if [ "$PROGRAM_ID" = "null" ] || [ -z "$PROGRAM_ID" ]; then
    echo "❌ Failed to create program"
    exit 1
fi

echo ""
echo "✅ Program created: $PROGRAM_ID"
echo "   Proxy URL: $PROXY_URL"
echo ""
echo "Starting program..."
curl -s -X POST "http://localhost:$HOST_PORT/programs/$PROGRAM_ID/start" | jq '.'

echo ""
echo "Waiting for Ready state..."
for i in {1..12}; do
    sleep 5
    STATE=$(curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID" | jq -r '.state')
    echo "  [$i] State: $STATE"

    if [ "$STATE" = "Ready" ]; then
        echo ""
        echo "✅ Program Ready!"
        echo ""
        echo "Access Web UI:"
        echo "  Dashboard: http://localhost:9000/ui/programs"
        echo "  Detail: http://localhost:9000/ui/programs/$PROGRAM_ID"
        echo "  Watcher: http://localhost:9000/ui/programs/$PROGRAM_ID/watcher"
        echo ""
        echo "Test APIs:"
        echo "  curl $PROXY_URL/watcher/status"
        echo "  curl http://localhost:9000/programs/$PROGRAM_ID/logs"
        break
    fi

    if [ "$STATE" = "Error" ]; then
        echo "❌ Build failed"
        curl -s "http://localhost:9000/programs/$PROGRAM_ID" | jq '.'
        exit 1
    fi
done
