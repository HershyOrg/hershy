#!/bin/bash

# Test watcher-server only
set -e

HOST_URL="http://localhost:9000"

echo "=========================================="
echo "watcher-server Standalone Test"
echo "=========================================="

# Start Host server
echo "Starting Host server..."
nohup ./host_server > /tmp/host_watcher_test.log 2>&1 &
HOST_PID=$!
sleep 3

# Deploy watcher-server
echo "Deploying watcher-server..."
python3 create_deploy_payload.py watcher-server ../examples/watcher-server > /tmp/watcher_payload.json
WATCHER_ID=$(curl -s -X POST "${HOST_URL}/programs" -H "Content-Type: application/json" -d @/tmp/watcher_payload.json | jq -r '.program_id')
echo "Program ID: $WATCHER_ID"

# Start
echo "Starting watcher-server..."
curl -s -X POST "${HOST_URL}/programs/${WATCHER_ID}/start"
echo ""

# Wait for Ready state
echo "Waiting for Ready state..."
for i in {1..60}; do
    STATE=$(curl -s "${HOST_URL}/programs/${WATCHER_ID}" | jq -r '.state')
    echo "  State: $STATE"
    if [ "$STATE" = "Ready" ]; then
        echo "✅ Ready!"
        break
    fi
    sleep 3
done

# Get proxy URL
PROXY_URL=$(curl -s "${HOST_URL}/programs/${WATCHER_ID}" | jq -r '.proxy_url')
echo "Proxy URL: $PROXY_URL"

# Wait for WatcherAPI
echo "Waiting for WatcherAPI..."
for i in {1..15}; do
    if curl -s --max-time 2 "${PROXY_URL}/watcher/status" > /dev/null 2>&1; then
        echo "✅ WatcherAPI ready!"
        break
    fi
    echo -n "."
    sleep 2
done
echo ""

# Wait for ticker to process messages (5 seconds for automatic ticker)
echo "Waiting 5 seconds for automatic ticker..."
sleep 5

# Get container ID
CONTAINER_ID=$(docker ps --filter "name=hersh-program-${WATCHER_ID}" --format "{{.ID}}" | head -1)
echo "Container ID: $CONTAINER_ID"

# Check logs
echo "Container logs (last 20 lines):"
docker logs "$CONTAINER_ID" 2>&1 | tail -20

# Check /state directory
echo ""
echo "/state directory contents:"
docker exec "$CONTAINER_ID" ls -la /state 2>&1 || echo "Failed to list /state"

# Check counter.txt
echo ""
echo "counter.txt content:"
docker exec "$CONTAINER_ID" cat /state/counter.txt 2>&1 || echo "❌ counter.txt not found!"

# Cleanup
echo ""
echo "Cleaning up..."
curl -s -X POST "${HOST_URL}/programs/${WATCHER_ID}/stop"
sleep 2
curl -s -X DELETE "${HOST_URL}/programs/${WATCHER_ID}"
kill $HOST_PID 2>/dev/null || true
docker rm -f "$CONTAINER_ID" 2>/dev/null || true

echo "=========================================="
echo "Test completed!"
echo "=========================================="
