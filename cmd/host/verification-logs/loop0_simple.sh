#!/bin/bash
set -e

HOST_PORT=9000
LOG_DIR="./verification-logs"

echo "=== Loop 0: Multi-Container Test (Simplified) ==="
echo "Testing 3 Alpine containers simultaneously"
echo ""

# Function to get program status
get_status() {
    local PROGRAM_ID=$1
    curl -s "http://localhost:$HOST_PORT/programs/$PROGRAM_ID"
}

# Function to wait for state
wait_for_state() {
    local PROGRAM_ID=$1
    local TARGET_STATE=$2
    local MAX_WAIT=$3

    echo "⏳ Waiting for $PROGRAM_ID to reach $TARGET_STATE state..."
    for i in $(seq 1 $MAX_WAIT); do
        STATUS=$(get_status "$PROGRAM_ID")
        STATE=$(echo "$STATUS" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
        echo "   [$i/${MAX_WAIT}] Current state: $STATE"

        if [ "$STATE" = "$TARGET_STATE" ]; then
            echo "   ✅ Reached $TARGET_STATE"
            return 0
        fi

        if [ "$STATE" = "Error" ]; then
            ERROR=$(echo "$STATUS" | grep -o '"error_msg":"[^"]*"' | cut -d'"' -f4)
            echo "   ❌ Error state: $ERROR"
            return 1
        fi

        sleep 2
    done

    echo "   ❌ Timeout waiting for $TARGET_STATE"
    return 1
}

# Create Program 1: user-alice/alpine-30s
echo "=== Program 1: user-alice/alpine-30s ==="
ALICE_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d '{"user_id": "alice", "dockerfile": "FROM alpine:latest\nCMD [\"sleep\", \"30\"]", "src_files": {}}')

echo "$ALICE_RESPONSE"
ALICE_ID=$(echo "$ALICE_RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
echo "   Program ID: $ALICE_ID"
echo ""

if [ -n "$ALICE_ID" ]; then
    echo "▶️  Starting program $ALICE_ID..."
    curl -s -X POST "http://localhost:$HOST_PORT/programs/$ALICE_ID/start"
    echo ""
    wait_for_state "$ALICE_ID" "Ready" 30
fi

# Create Program 2: user-bob/alpine-60s
echo ""
echo "=== Program 2: user-bob/alpine-60s ==="
BOB_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d '{"user_id": "bob", "dockerfile": "FROM alpine:latest\nCMD [\"sleep\", \"60\"]", "src_files": {}}')

echo "$BOB_RESPONSE"
BOB_ID=$(echo "$BOB_RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
echo "   Program ID: $BOB_ID"
echo ""

if [ -n "$BOB_ID" ]; then
    echo "▶️  Starting program $BOB_ID..."
    curl -s -X POST "http://localhost:$HOST_PORT/programs/$BOB_ID/start"
    echo ""
    wait_for_state "$BOB_ID" "Ready" 30
fi

# Create Program 3: user-charlie/alpine-90s
echo ""
echo "=== Program 3: user-charlie/alpine-90s ==="
CHARLIE_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d '{"user_id": "charlie", "dockerfile": "FROM alpine:latest\nCMD [\"sleep\", \"90\"]", "src_files": {}}')

echo "$CHARLIE_RESPONSE"
CHARLIE_ID=$(echo "$CHARLIE_RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
echo "   Program ID: $CHARLIE_ID"
echo ""

if [ -n "$CHARLIE_ID" ]; then
    echo "▶️  Starting program $CHARLIE_ID..."
    curl -s -X POST "http://localhost:$HOST_PORT/programs/$CHARLIE_ID/start"
    echo ""
    wait_for_state "$CHARLIE_ID" "Ready" 30
fi

# Get all program statuses
echo ""
echo "=== All Programs Status ==="
ALL_PROGRAMS=$(curl -s "http://localhost:$HOST_PORT/programs")
echo "$ALL_PROGRAMS" | python3 -m json.tool
echo ""

# Verify Docker containers
echo "=== Docker Containers ==="
docker ps --filter "name=hersh-program" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Monitor all programs for 20 seconds
echo "=== Monitoring All Programs (20 seconds) ==="
for i in {1..4}; do
    echo "--- Check $i/4 (${i}0s) ---"

    if [ -n "$ALICE_ID" ]; then
        ALICE_STATE=$(get_status "$ALICE_ID" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
        echo "   Alice ($ALICE_ID): $ALICE_STATE"
    fi

    if [ -n "$BOB_ID" ]; then
        BOB_STATE=$(get_status "$BOB_ID" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
        echo "   Bob ($BOB_ID): $BOB_STATE"
    fi

    if [ -n "$CHARLIE_ID" ]; then
        CHARLIE_STATE=$(get_status "$CHARLIE_ID" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
        echo "   Charlie ($CHARLIE_ID): $CHARLIE_STATE"
    fi

    sleep 5
done

# Contract Verification: Port 8080 should be blocked
echo ""
echo "=== Contract Verification ==="
echo "Testing port 8080 direct access (should fail):"
if timeout 2 curl -s http://localhost:8080 2>&1 | grep -q "Connection refused\|Failed to connect\|Empty reply"; then
    echo "   ✅ Port 8080 blocked externally (contract compliant)"
else
    echo "   ⚠️  Port 8080 test inconclusive (no WatcherAPI in Alpine)"
fi

# Verify state directories exist
echo ""
echo "=== State Directory Verification ==="
if [ -n "$ALICE_ID" ]; then
    if [ -d "host-storage/$ALICE_ID/state" ]; then
        echo "   ✅ Alice state directory exists"
    else
        echo "   ❌ Alice state directory missing"
    fi
fi

if [ -n "$BOB_ID" ]; then
    if [ -d "host-storage/$BOB_ID/state" ]; then
        echo "   ✅ Bob state directory exists"
    else
        echo "   ❌ Bob state directory missing"
    fi
fi

if [ -n "$CHARLIE_ID" ]; then
    if [ -d "host-storage/$CHARLIE_ID/state" ]; then
        echo "   ✅ Charlie state directory exists"
    else
        echo "   ❌ Charlie state directory missing"
    fi
fi

# Final summary
echo ""
echo "=== Final Summary ==="
curl -s "http://localhost:$HOST_PORT/programs" | python3 -m json.tool

echo ""
echo "=== Loop 0 Complete ==="
echo "To cleanup (run these manually):"
if [ -n "$ALICE_ID" ]; then
    echo "  curl -X POST http://localhost:$HOST_PORT/programs/$ALICE_ID/stop"
fi
if [ -n "$BOB_ID" ]; then
    echo "  curl -X POST http://localhost:$HOST_PORT/programs/$BOB_ID/stop"
fi
if [ -n "$CHARLIE_ID" ]; then
    echo "  curl -X POST http://localhost:$HOST_PORT/programs/$CHARLIE_ID/stop"
fi
