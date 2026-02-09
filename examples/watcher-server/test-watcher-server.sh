#!/bin/bash

PROXY_URL="http://localhost:19008"
CONTAINER="15269d3b4e29"

echo "🧪 Testing watcher-server WatcherAPI"
echo "====================================="
echo ""

# Test 1: WatcherAPI Status
echo "📡 Test 1: WatcherAPI Status"
curl -s $PROXY_URL/watcher/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"   State: {d['state']}, Uptime: {d['uptime']}\")"
echo ""

# Test 2: WatcherAPI Vars (check COUNTER)
echo "📡 Test 2: WatcherAPI Vars (check COUNTER)"
curl -s $PROXY_URL/watcher/vars | python3 -m json.tool | head -15
echo ""

# Test 3: Send 'tick' message manually
echo "📤 Test 3: Sending manual 'tick' message"
curl -s -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"tick"}'
echo ""
sleep 2

# Test 4: Check logs for counter
echo "📋 Recent logs:"
docker logs --tail 15 $CONTAINER 2>&1
