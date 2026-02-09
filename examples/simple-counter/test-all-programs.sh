#!/bin/bash

echo "🔍 Testing WatcherAPI for all programs:"
echo ""

for port in 19001 19002 19003 19004; do
    echo "Port $port:"
    response=$(curl -s localhost:$port/watcher/status)
    if [ $? -eq 0 ]; then
        state=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
        uptime=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['uptime'])")
        echo "   ✅ State: $state, Uptime: $uptime"
    else
        echo "   ❌ Connection failed"
    fi
    echo ""
done

echo "🐳 Docker containers:"
docker ps --filter "name=build-ec5a5a719102" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
