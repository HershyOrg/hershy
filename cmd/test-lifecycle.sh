#!/bin/bash

echo "🧪 Phase 10: Lifecycle Management Test"
echo "======================================="
echo ""

PROGRAM_ID="multi-user-1-build-ec5a5a719102-9c027775"

# Test 1: Stop
echo "Test 1: Stop Program"
echo "--------------------"
echo "Current state:"
curl -s localhost:9000/programs/$PROGRAM_ID | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'   State: {d[\"state\"]}, Container: {d[\"container_id\"]}')"

echo ""
echo "Sending stop command..."
curl -s -X POST localhost:9000/programs/$PROGRAM_ID/stop
echo ""
sleep 2

echo "After stop:"
curl -s localhost:9000/programs/$PROGRAM_ID | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'   State: {d[\"state\"]}')"
echo ""

# Verify container stopped
echo "Docker container status:"
docker ps -a | grep $PROGRAM_ID | awk '{print "   " $0}'
echo ""

# Test 2: Restart
echo "Test 2: Restart Program"
echo "-----------------------"
echo "Sending restart command..."
curl -s -X POST localhost:9000/programs/$PROGRAM_ID/restart
echo ""
sleep 5

echo "After restart:"
curl -s localhost:9000/programs/$PROGRAM_ID | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'   State: {d[\"state\"]}, Container: {d.get(\"container_id\", \"N/A\")[:12]}')"
echo ""

# Test WatcherAPI
echo "Testing WatcherAPI after restart:"
curl -s localhost:19002/watcher/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'   State: {d[\"state\"]}, Uptime: {d[\"uptime\"]}')"
echo ""

echo "======================================="
echo "✅ Lifecycle Test Complete"
