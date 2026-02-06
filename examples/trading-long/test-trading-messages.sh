#!/bin/bash

PROGRAM_ID="trading-user-build-7e418ec04c6a-4fae1d4b"
PROXY_URL="http://localhost:19007"

echo "🧪 Testing WatcherAPI Message Endpoints for trading-long"
echo "=========================================================="
echo ""

# Test 1: WatcherAPI Status
echo "📡 Test 1: WatcherAPI Status"
curl -s $PROXY_URL/watcher/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"   State: {d['state']}, Uptime: {d['uptime']}\")"
echo ""

# Test 2: Send 'status' command
echo "📤 Test 2: Sending 'status' command via message"
curl -s -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"status"}' | python3 -c "import sys,json; print(f\"   Response: {json.load(sys.stdin)}\")"
sleep 2
echo "   Checking logs for response..."
docker logs cbe01a1049ce 2>&1 | tail -30 | grep -A 10 "status" || echo "   (check docker logs manually)"
echo ""

# Test 3: Send 'prices' command
echo "📤 Test 3: Sending 'prices' command"
curl -s -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"prices"}'
sleep 2
echo "   Checking logs for prices output..."
docker logs cbe01a1049ce 2>&1 | tail -20 | grep -A 5 "Current Market Prices" || echo "   (check docker logs manually)"
echo ""

# Test 4: Send 'portfolio' command
echo "📤 Test 4: Sending 'portfolio' command"
curl -s -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"portfolio"}'
sleep 2
echo ""

# Test 5: Send 'stats' command
echo "📤 Test 5: Sending 'stats' command"
curl -s -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"stats"}'
sleep 2
echo ""

echo "=========================================================="
echo "📋 Full recent logs:"
echo "=========================================================="
docker logs cbe01a1049ce 2>&1 | tail -50
