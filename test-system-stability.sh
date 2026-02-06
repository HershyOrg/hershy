#!/bin/bash

echo "🧪 Phase 9: System Stability Test"
echo "=================================="
echo ""

# Get all programs
programs=$(curl -s localhost:9000/programs)
count=$(echo "$programs" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")

echo "📊 Testing $count programs simultaneously"
echo ""

# Test 1: Concurrent WatcherAPI Status
echo "Test 1: Concurrent WatcherAPI Status Access"
echo "--------------------------------------------"

for port in 19001 19002 19003 19004 19007 19008; do
    (
        result=$(curl -s localhost:$port/watcher/status 2>&1)
        if [ $? -eq 0 ]; then
            state=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])" 2>/dev/null)
            if [ -n "$state" ]; then
                echo "   ✅ Port $port: $state"
            else
                echo "   ⚠️  Port $port: Response error"
            fi
        else
            echo "   ❌ Port $port: Connection failed"
        fi
    ) &
done
wait
echo ""

# Test 2: Port Isolation
echo "Test 2: Port Isolation Verification"
echo "------------------------------------"
docker ps --filter "name=hersh-program" --format "{{.Names}}\t{{.Ports}}" | grep "127.0.0.1" | while read line; do
    echo "   ✅ $line"
done
echo ""

# Test 3: Resource Usage
echo "Test 3: Resource Usage"
echo "----------------------"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
    $(docker ps --filter "name=hersh-program" -q) | head -7
echo ""

# Test 4: Storage Usage
echo "Test 4: Storage Usage"
echo "---------------------"
storage_size=$(du -sh /home/rlaaudgjs5638/hersh/cmd/host/host-storage 2>/dev/null | awk '{print $1}')
echo "   Host Storage: $storage_size"
echo ""

echo "=================================="
echo "✅ System Stability Test Complete"
