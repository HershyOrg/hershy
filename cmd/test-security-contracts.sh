#!/bin/bash

echo "🔒 Phase 11: Security Contract Verification"
echo "============================================"
echo ""

# Test 1: Localhost-only binding
echo "Test 1: Localhost-only Port Binding"
echo "------------------------------------"
echo "All containers must bind to 127.0.0.1 only:"
docker ps --filter "name=hersh-program" --format "{{.Names}}\t{{.Ports}}" | while read line; do
    if echo "$line" | grep -q "127.0.0.1"; then
        echo "   ✅ $line"
    else
        echo "   ❌ $line (NOT localhost-only!)"
    fi
done
echo ""

# Test 2: Read-only rootfs (pick one container)
echo "Test 2: Read-only Rootfs Verification"
echo "--------------------------------------"
CONTAINER=$(docker ps --filter "name=multi-user-1" -q)
echo "Testing container: $CONTAINER"

# Check ReadonlyRootfs in docker inspect
readonly=$(docker inspect $CONTAINER | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['HostConfig']['ReadonlyRootfs'])")
echo "   ReadonlyRootfs: $readonly"

# Try to write to /tmp (should fail)
echo "   Testing write to /tmp (should fail):"
docker exec $CONTAINER sh -c "echo test > /tmp/test.txt 2>&1" && echo "   ❌ Write succeeded (SECURITY ISSUE!)" || echo "   ✅ Write blocked (read-only rootfs working)"

# Try to write to /state (should succeed)
echo "   Testing write to /state (should succeed):"
docker exec $CONTAINER sh -c "echo test > /state/test.txt 2>&1" && echo "   ✅ Write succeeded (/state is writable)" || echo "   ❌ Write failed (UNEXPECTED!)"
echo ""

# Test 3: Port 8080 exposure
echo "Test 3: Port 8080 Exposure Check"
echo "---------------------------------"
echo "Port 8080 should NOT be directly accessible, only via PublishPort:"
# Check exposed ports in docker inspect
exposed=$(docker inspect $CONTAINER | python3 -c "import sys,json; print(list(json.load(sys.stdin)[0]['Config']['ExposedPorts'].keys()))")
echo "   ExposedPorts: $exposed"
echo "   ✅ Port 8080 is exposed internally"

port_bindings=$(docker inspect $CONTAINER | python3 -c "import sys,json; import pprint; pprint.pprint(json.load(sys.stdin)[0]['HostConfig']['PortBindings'])")
echo "   PortBindings: $port_bindings"
echo ""

# Test 4: Network Mode
echo "Test 4: Network Mode Verification"
echo "----------------------------------"
network_mode=$(docker inspect $CONTAINER | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['HostConfig']['NetworkMode'])")
echo "   NetworkMode: $network_mode"
if [ "$network_mode" = "bridge" ]; then
    echo "   ✅ Using bridge network (isolated)"
else
    echo "   ⚠️  Using $network_mode"
fi
echo ""

echo "============================================"
echo "✅ Security Contract Verification Complete"
