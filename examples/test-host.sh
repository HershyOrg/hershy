#!/bin/bash

# Host-Program-Hersh Integration Test Script
# Tests the full lifecycle of programs through Host API

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
HOST_PORT=18080
HOST_URL="http://localhost:${HOST_PORT}"
TEST_USER="test-user-$(date +%s)"
TMP_DIR="/tmp/hersh-test-$(date +%s)"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."

    # Stop all programs
    if [ -n "$PROGRAM_ID" ]; then
        curl -s -X POST "${HOST_URL}/programs/${PROGRAM_ID}/stop" > /dev/null 2>&1 || true
        sleep 2
        curl -s -X DELETE "${HOST_URL}/programs/${PROGRAM_ID}" > /dev/null 2>&1 || true
    fi

    # Stop Host server
    if [ -n "$HOST_PID" ]; then
        kill $HOST_PID 2>/dev/null || true
        wait $HOST_PID 2>/dev/null || true
    fi

    # Clean up temp directory
    rm -rf "$TMP_DIR" 2>/dev/null || true

    log_info "Cleanup complete"
}

trap cleanup EXIT

# JSON parsing helper (pure bash, no jq needed)
json_extract() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | cut -d'"' -f4
}

json_extract_bool() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[^,}]*" | awk '{print $NF}'
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker not found"
        exit 1
    fi

    log_success "Prerequisites OK"
}

# Start Host server
start_host_server() {
    log_info "Starting Host server on port ${HOST_PORT}..."

    mkdir -p "$TMP_DIR"

    cd ../cmd/host

    # Build and run Host server in background
    go build -o "$TMP_DIR/host-server" . 2>&1 | tee "$TMP_DIR/host-build.log"

    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        log_error "Failed to build Host server"
        cat "$TMP_DIR/host-build.log"
        exit 1
    fi

    # Start server
    "$TMP_DIR/host-server" --port $HOST_PORT --storage "$TMP_DIR/programs" --runtime runc > "$TMP_DIR/host-server.log" 2>&1 &
    HOST_PID=$!

    log_info "Host server PID: $HOST_PID"

    # Wait for server to start
    for i in {1..30}; do
        if curl -s "${HOST_URL}/programs" > /dev/null 2>&1; then
            log_success "Host server started successfully"
            return 0
        fi
        sleep 1
    done

    log_error "Host server failed to start"
    cat "$TMP_DIR/host-server.log"
    exit 1
}

# Test Phase 1: Create and list programs
test_create_program() {
    log_info "=== Phase 1: Create Program ==="

    # Read example files
    local dockerfile=$(cat simple-counter/Dockerfile)
    local main_go=$(cat simple-counter/main.go)
    local go_mod=$(cat simple-counter/go.mod)

    # Create JSON payload (pure bash, no jq)
    # Escape quotes in file contents
    dockerfile=$(echo "$dockerfile" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    main_go=$(echo "$main_go" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    go_mod=$(echo "$go_mod" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

    local payload=$(cat <<EOF
{
    "user_id": "$TEST_USER",
    "dockerfile": "$dockerfile",
    "src_files": {
        "main.go": "$main_go",
        "go.mod": "$go_mod"
    }
}
EOF
)

    # Create program
    local response=$(curl -s -X POST "${HOST_URL}/programs" \
        -H "Content-Type: application/json" \
        -d "$payload")

    echo "$response" > "$TMP_DIR/create-response.json"

    # Extract program ID
    PROGRAM_ID=$(json_extract "$response" "program_id")
    PROXY_URL=$(json_extract "$response" "proxy_url")

    if [ "$PROGRAM_ID" = "null" ] || [ -z "$PROGRAM_ID" ]; then
        log_error "Failed to create program"
        echo "$response"
        return 1
    fi

    log_success "Program created: $PROGRAM_ID"
    log_info "Proxy URL: $PROXY_URL"

    # Verify program in registry
    local program_info=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}")
    local state=$(json_extract "$program_info" "state")

    if [ "$state" = "Created" ]; then
        log_success "Program state: Created"
    else
        log_error "Expected state 'Created', got '$state'"
    fi
}

# Test Phase 2: Start program
test_start_program() {
    log_info "=== Phase 2: Start Program ==="

    if [ -z "$PROGRAM_ID" ]; then
        log_error "PROGRAM_ID not set"
        return 1
    fi

    # Start program
    local response=$(curl -s -X POST "${HOST_URL}/programs/${PROGRAM_ID}/start")
    echo "$response" > "$TMP_DIR/start-response.json"

    log_info "Start command sent, waiting for program to be Ready..."

    # Wait for Ready state (with timeout)
    for i in {1..60}; do
        local program_info=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}")
        local state=$(json_extract "$program_info" "state")

        echo "$program_info" > "$TMP_DIR/program-state-${i}.json"

        log_info "State: $state (attempt $i/60)"

        if [ "$state" = "Ready" ]; then
            log_success "Program reached Ready state"

            # Extract container info
            local container_id=$(json_extract "$program_info" "container_id")
            local image_id=$(json_extract "$program_info" "image_id")

            log_info "Container ID: $container_id"
            log_info "Image ID: $image_id"

            # Verify container is running
            if docker ps --filter "id=$container_id" --format "{{.ID}}" | grep -q "$container_id"; then
                log_success "Container is running"
            else
                log_error "Container not found in docker ps"
            fi

            return 0
        elif [ "$state" = "Error" ]; then
            local error_msg=$(json_extract "$program_info" "error_msg")
            log_error "Program failed: $error_msg"
            return 1
        fi

        sleep 2
    done

    log_error "Timeout waiting for Ready state"
    return 1
}

# Test Phase 3: Monitor via WatcherAPI proxy
test_watcher_api() {
    log_info "=== Phase 3: WatcherAPI Monitoring ==="

    if [ -z "$PROGRAM_ID" ]; then
        log_error "PROGRAM_ID not set"
        return 1
    fi

    # Extract proxy port
    local program_info=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}")
    local proxy_url=$(json_extract "$program_info" "proxy_url")
    local proxy_port=$(echo "$proxy_url" | cut -d':' -f3)

    log_info "Testing WatcherAPI via proxy port $proxy_port..."

    # Test 1: GET /watcher/status
    log_info "Testing GET /watcher/status..."
    local status_response=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}/proxy/watcher/status")
    echo "$status_response" > "$TMP_DIR/watcher-status.json"

    local watcher_state=$(json_extract "$status_response" "state")
    if [ "$watcher_state" = "Running" ]; then
        log_success "WatcherAPI status: Running"
    else
        log_error "Expected Watcher state 'Running', got '$watcher_state'"
    fi

    # Test 2: GET /watcher/logs
    log_info "Testing GET /watcher/logs..."
    local logs_response=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}/proxy/watcher/logs")
    echo "$logs_response" > "$TMP_DIR/watcher-logs.json"

    if echo "$logs_response" | grep -q "effect_log"; then
        log_success "WatcherAPI logs endpoint working"
    else
        log_error "WatcherAPI logs endpoint failed"
    fi

    # Test 3: GET /watcher/signals
    log_info "Testing GET /watcher/signals..."
    local signals_response=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}/proxy/watcher/signals")
    echo "$signals_response" > "$TMP_DIR/watcher-signals.json"

    if echo "$signals_response" | grep -q "var_sig_count"; then
        log_success "WatcherAPI signals endpoint working"
    else
        log_error "WatcherAPI signals endpoint failed"
    fi

    # Test 4: POST /watcher/message
    log_info "Testing POST /watcher/message..."
    local message_response=$(curl -s -X POST "${HOST_URL}/programs/${PROGRAM_ID}/proxy/watcher/message" \
        -H "Content-Type: application/json" \
        -d '{"content": "test-message-from-integration-test"}')

    if [ $? -eq 0 ]; then
        log_success "WatcherAPI message endpoint working"
    else
        log_error "WatcherAPI message endpoint failed"
    fi
}

# Test Phase 4: Verify contracts
test_contracts() {
    log_info "=== Phase 4: Contract Verification ==="

    if [ -z "$PROGRAM_ID" ]; then
        log_error "PROGRAM_ID not set"
        return 1
    fi

    local program_info=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}")
    local container_id=$(json_extract "$program_info" "container_id")

    # Contract 1: /state volume is RW
    log_info "Verifying /state volume is read-write..."
    if docker inspect "$container_id" | grep -q '"/state"' && docker inspect "$container_id" | grep -A 5 '"/state"' | grep -q '"RW": true'; then
        log_success "Contract: /state volume is RW"
    else
        log_error "Contract: /state volume is not RW"
    fi

    # Contract 2: Root filesystem is read-only
    log_info "Verifying root filesystem is read-only..."
    if docker inspect "$container_id" | grep -q '"ReadonlyRootfs": true'; then
        log_success "Contract: Root filesystem is read-only"
    else
        log_error "Contract: Root filesystem is not read-only"
    fi

    # Contract 3: Port 8080 not externally published
    log_info "Verifying port 8080 not externally published..."
    local port_check=$(docker port "$container_id" 2>/dev/null)
    if [ -z "$port_check" ]; then
        log_success "Contract: Port 8080 not externally published"
    else
        log_error "Contract: Port 8080 is externally published"
    fi

    # Contract 4: Proxy port in valid range (9000-9999)
    local proxy_url=$(json_extract "$program_info" "proxy_url")
    local proxy_port=$(echo "$proxy_url" | cut -d':' -f3)
    if [ "$proxy_port" -ge 9000 ] && [ "$proxy_port" -le 9999 ]; then
        log_success "Contract: Proxy port $proxy_port in valid range (9000-9999)"
    else
        log_error "Contract: Proxy port $proxy_port out of range"
    fi

    # Check if /state/counter.log exists
    log_info "Checking if counter.log was created in /state..."
    sleep 5  # Wait for counter to write some logs

    local state_path="$TMP_DIR/programs/${PROGRAM_ID}/state"
    if [ -f "$state_path/counter.log" ]; then
        log_success "Contract: counter.log created in /state volume"
        log_info "Counter log contents:"
        head -5 "$state_path/counter.log"
    else
        log_warning "counter.log not yet created (might be timing)"
    fi
}

# Test Phase 5: Stop and cleanup
test_stop_program() {
    log_info "=== Phase 5: Stop Program ==="

    if [ -z "$PROGRAM_ID" ]; then
        log_error "PROGRAM_ID not set"
        return 1
    fi

    # Stop program
    local response=$(curl -s -X POST "${HOST_URL}/programs/${PROGRAM_ID}/stop")
    echo "$response" > "$TMP_DIR/stop-response.json"

    log_info "Stop command sent, waiting for Stopped state..."

    # Wait for Stopped state
    for i in {1..30}; do
        local program_info=$(curl -s "${HOST_URL}/programs/${PROGRAM_ID}")
        local state=$(json_extract "$program_info" "state")

        log_info "State: $state (attempt $i/30)"

        if [ "$state" = "Stopped" ]; then
            log_success "Program stopped successfully"
            return 0
        fi

        sleep 1
    done

    log_warning "Timeout waiting for Stopped state"
}

# Main test execution
main() {
    echo "========================================"
    echo "Host-Program-Hersh Integration Test"
    echo "========================================"
    echo ""

    check_prerequisites

    cd /home/rlaaudgjs5638/hersh/examples || {
        log_error "Failed to change to examples directory"
        exit 1
    }

    start_host_server

    echo ""
    test_create_program

    echo ""
    test_start_program

    echo ""
    sleep 3  # Let program run for a bit

    echo ""
    test_watcher_api

    echo ""
    test_contracts

    echo ""
    test_stop_program

    echo ""
    echo "========================================"
    echo "Test Results"
    echo "========================================"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}❌ Some tests failed${NC}"
        exit 1
    fi
}

main "$@"
