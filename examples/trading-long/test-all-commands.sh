#!/bin/bash

URL="http://localhost:19007/watcher/message"
CONTAINER="cbe01a1049ce"

send_command() {
    local cmd="$1"
    echo "📤 Sending command: '$cmd'"
    curl -s -X POST $URL \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"$cmd\"}"
    echo ""
    sleep 2
}

echo "🧪 Testing trading-long WatcherAPI Commands"
echo "==========================================="
echo ""

# Test commands
send_command "status"
send_command "portfolio"
send_command "trades"
send_command "help"

echo ""
echo "⏳ Waiting 3 seconds for all outputs..."
sleep 3

echo ""
echo "📋 Recent Logs (last 80 lines):"
echo "==========================================="
docker logs --tail 80 $CONTAINER 2>&1

