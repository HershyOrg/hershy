#!/bin/bash
set -e

HOST_PORT=9000
LOG_DIR="./verification-logs"

echo "=== Loop 0: Multi-Container Real-World Scenario ==="
echo "Testing 3 programs simultaneously with different users"
echo ""

# Function to JSON escape a string
json_escape() {
    python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

# Function to create program from directory
create_program_from_dir() {
    local USER_ID=$1
    local SOURCE_DIR=$2
    local PROGRAM_NAME=$3

    echo "📦 Creating program for user: $USER_ID ($PROGRAM_NAME)"

    # Read Dockerfile
    if [ ! -f "$SOURCE_DIR/Dockerfile" ]; then
        echo "   ❌ Dockerfile not found in $SOURCE_DIR"
        return 1
    fi

    DOCKERFILE_CONTENT=$(cat "$SOURCE_DIR/Dockerfile" | json_escape)

    # Read source files (*.go and go.mod files)
    SRC_FILES="{"
    FIRST=true
    for file in "$SOURCE_DIR"/*.go "$SOURCE_DIR/go.mod" "$SOURCE_DIR/go.sum"; do
        if [ -f "$file" ]; then
            FILENAME=$(basename "$file")
            CONTENT=$(cat "$file" | json_escape)
            if [ "$FIRST" = true ]; then
                SRC_FILES="${SRC_FILES}\"${FILENAME}\":${CONTENT}"
                FIRST=false
            else
                SRC_FILES="${SRC_FILES},\"${FILENAME}\":${CONTENT}"
            fi
        fi
    done
    SRC_FILES="${SRC_FILES}}"

    # Create JSON request
    REQUEST_JSON=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "dockerfile": $DOCKERFILE_CONTENT,
  "src_files": $SRC_FILES
}
EOF
)

    # Send request
    RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
        -H "Content-Type: application/json" \
        -d "$REQUEST_JSON")

    echo "$RESPONSE"

    # Extract program ID from response
    PROGRAM_ID=$(echo "$RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
    echo "   Program ID: $PROGRAM_ID"

    # Save response
    mkdir -p "$LOG_DIR"
    echo "$RESPONSE" > "$LOG_DIR/${USER_ID}_${PROGRAM_NAME}_create.json"
    echo ""

    # Return program ID
    echo "$PROGRAM_ID"
}

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
        STATE=$(get_status "$PROGRAM_ID" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
        echo "   [$i/${MAX_WAIT}] Current state: $STATE"

        if [ "$STATE" = "$TARGET_STATE" ]; then
            echo "   ✅ Reached $TARGET_STATE"
            return 0
        fi

        sleep 2
    done

    echo "   ❌ Timeout waiting for $TARGET_STATE"
    return 1
}

# Create Program 1: user-alice/watcher-server
echo "=== Program 1: user-alice/watcher-server ==="
ALICE_ID=$(create_program_from_dir "alice" "/home/rlaaudgjs5638/hersh/examples/watcher-server" "watcher-server")
if [ -n "$ALICE_ID" ]; then
    echo "▶️  Starting program $ALICE_ID..."
    START_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs/$ALICE_ID/start")
    echo "$START_RESPONSE"
    wait_for_state "$ALICE_ID" "Ready" 60
fi

# Create Program 2: user-bob/simple-counter
echo ""
echo "=== Program 2: user-bob/simple-counter ==="
BOB_ID=$(create_program_from_dir "bob" "/home/rlaaudgjs5638/hersh/examples/simple-counter" "simple-counter")
if [ -n "$BOB_ID" ]; then
    echo "▶️  Starting program $BOB_ID..."
    START_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs/$BOB_ID/start")
    echo "$START_RESPONSE"
    wait_for_state "$BOB_ID" "Ready" 60
fi

# Create Program 3: user-charlie/alpine (minimal container)
echo ""
echo "=== Program 3: user-charlie/alpine ==="
mkdir -p /tmp/alpine-test
cat > /tmp/alpine-test/Dockerfile <<'EOF'
FROM alpine:latest
CMD ["sleep", "300"]
EOF

# Alpine doesn't need source files, create minimal request
ALPINE_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs" \
    -H "Content-Type: application/json" \
    -d '{"user_id": "charlie", "dockerfile": "FROM alpine:latest\nCMD [\"sleep\", \"300\"]", "src_files": {}}')

echo "$ALPINE_RESPONSE"
CHARLIE_ID=$(echo "$ALPINE_RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
echo "   Program ID: $CHARLIE_ID"

if [ -n "$CHARLIE_ID" ]; then
    echo "▶️  Starting program $CHARLIE_ID..."
    START_RESPONSE=$(curl -s -X POST "http://localhost:$HOST_PORT/programs/$CHARLIE_ID/start")
    echo "$START_RESPONSE"
    wait_for_state "$CHARLIE_ID" "Ready" 30
fi

# Get all program statuses
echo ""
echo "=== All Programs Status ==="
curl -s "http://localhost:$HOST_PORT/programs" > "$LOG_DIR/all_programs.json"
cat "$LOG_DIR/all_programs.json"
echo ""

# Test WatcherAPI access for programs with WatcherServer
echo ""
echo "=== Testing WatcherAPI Access ==="

# Get proxy URLs
if [ -n "$ALICE_ID" ]; then
    ALICE_INFO=$(get_status "$ALICE_ID")
    ALICE_PROXY=$(echo "$ALICE_INFO" | grep -o '"proxy_url":"[^"]*"' | cut -d'"' -f4)
    echo "Alice Proxy URL: $ALICE_PROXY"
fi

if [ -n "$BOB_ID" ]; then
    BOB_INFO=$(get_status "$BOB_ID")
    BOB_PROXY=$(echo "$BOB_INFO" | grep -o '"proxy_url":"[^"]*"' | cut -d'"' -f4)
    echo "Bob Proxy URL: $BOB_PROXY"
fi

# Test Alice's WatcherAPI
if [ -n "$ALICE_PROXY" ]; then
    echo ""
    echo "📊 Alice's Watcher Status:"
    curl -s "$ALICE_PROXY/watcher/status" > "$LOG_DIR/alice_watcher_status.json"
    cat "$LOG_DIR/alice_watcher_status.json"
    echo ""
fi

# Test Bob's WatcherAPI
if [ -n "$BOB_PROXY" ]; then
    echo ""
    echo "📊 Bob's Watcher Status:"
    curl -s "$BOB_PROXY/watcher/status" > "$LOG_DIR/bob_watcher_status.json"
    cat "$LOG_DIR/bob_watcher_status.json"
    echo ""
fi

# Monitor all programs for 30 seconds
echo ""
echo "=== Monitoring All Programs (30 seconds) ==="
for i in {1..6}; do
    echo "--- Check $i/6 (${i}0s) ---"

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
if curl -s --max-time 2 http://localhost:8080/watcher/status 2>&1 | grep -q "Connection refused\|Failed to connect"; then
    echo "   ✅ Port 8080 blocked externally (contract compliant)"
else
    echo "   ❌ Port 8080 accessible (contract violation!)"
fi

# Final summary
echo ""
echo "=== Final Summary ==="
curl -s "http://localhost:$HOST_PORT/programs" > "$LOG_DIR/final_programs.json"
cat "$LOG_DIR/final_programs.json"

echo ""
echo "=== Loop 0 Complete ==="
echo "Logs saved to: $LOG_DIR/"
echo ""
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
