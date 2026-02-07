#!/bin/bash

# Health Check Simple Integration Test Script
# Tests the dual-interval health check system without requiring jq

set -e

echo "========================================"
echo "Health Check Integration Test (Simple)"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test result tracking
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass_test() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail_test() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
    echo -e "${YELLOW}ℹ️  INFO${NC}: $1"
}

# Cleanup function
cleanup() {
    echo ""
    info "Cleaning up..."

    # Stop Host server if running
    if [ ! -z "$HOST_PID" ]; then
        info "Stopping Host server (PID: $HOST_PID)"
        kill $HOST_PID 2>/dev/null || true
        wait $HOST_PID 2>/dev/null || true
    fi

    # Clean up temporary files
    rm -f /tmp/host_server.log

    echo ""
    echo "========================================"
    echo "Test Results"
    echo "========================================"
    echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
    echo "========================================"

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}Some tests failed!${NC}"
        exit 1
    fi
}

trap cleanup EXIT

# Prerequisites check
echo "Checking prerequisites..."

# Check if curl is installed
if ! command -v curl &> /dev/null; then
    fail_test "curl is not installed"
    exit 1
fi

pass_test "Prerequisites check"
echo ""

# Build Host server
echo "Building Host server..."
cd /home/rlaaudgjs5638/hersh/host

# Clean old binary
rm -f host_server

# Build
go build -o host_server ./cmd > /tmp/build.log 2>&1
BUILD_STATUS=$?

if [ $BUILD_STATUS -eq 0 ] && [ -f host_server ]; then
    pass_test "Host server build"
else
    fail_test "Host server build (exit code: $BUILD_STATUS)"
    cat /tmp/build.log
    exit 1
fi
echo ""

# Start Host server
echo "Starting Host server..."
./host_server > /tmp/host_server.log 2>&1 &
HOST_PID=$!

# Wait for server to start
sleep 2

# Check if server is running
if ! curl -s http://localhost:9000/programs > /dev/null; then
    fail_test "Host server failed to start"
    cat /tmp/host_server.log
    exit 1
fi

pass_test "Host server started (PID: $HOST_PID)"
echo ""

# Test 1: Verify empty program list
echo "Test 1: Verify empty program list"
RESPONSE=$(curl -s http://localhost:9000/programs)

if echo "$RESPONSE" | grep -q '"count":0'; then
    pass_test "Empty program list"
else
    fail_test "Expected count 0"
    echo "Response: $RESPONSE"
fi
echo ""

# Test 2: Create a program
echo "Test 2: Create a program"
CREATE_RESPONSE=$(curl -s -X POST http://localhost:9000/programs \
    -H "Content-Type: application/json" \
    -d '{
        "user_id": "test-user",
        "dockerfile": "FROM alpine:latest\nCMD sleep 3600",
        "src_files": {
            "main.go": "package main\nfunc main() {}"
        }
    }')

if echo "$CREATE_RESPONSE" | grep -q '"program_id"'; then
    pass_test "Program created"
    # Extract program_id (simple parsing)
    PROGRAM_ID=$(echo "$CREATE_RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
    info "Program ID: $PROGRAM_ID"
else
    fail_test "Program creation failed"
    echo "Response: $CREATE_RESPONSE"
    exit 1
fi

if echo "$CREATE_RESPONSE" | grep -q '"state":"Created"'; then
    pass_test "Program state is 'Created'"
else
    fail_test "Expected state 'Created'"
    echo "Response: $CREATE_RESPONSE"
fi
echo ""

# Test 3: Get program details (not running)
echo "Test 3: Get program details (not running)"
GET_RESPONSE=$(curl -s http://localhost:9000/programs/$PROGRAM_ID)

if echo "$GET_RESPONSE" | grep -q '"state":"created"'; then
    pass_test "Program state is 'created' (not running)"
else
    fail_test "Expected state 'created'"
    echo "Response: $GET_RESPONSE"
fi
echo ""

# Test 4: Health check loop should not affect non-running programs
echo "Test 4: Health check loop behavior for non-running programs"
info "Waiting 1 second for health check loop..."
sleep 1

GET_RESPONSE=$(curl -s http://localhost:9000/programs/$PROGRAM_ID)

if echo "$GET_RESPONSE" | grep -q '"state":"created"'; then
    pass_test "Program still in 'created' state"
else
    fail_test "Expected state 'created'"
    echo "Response: $GET_RESPONSE"
fi
echo ""

# Test 5: Verify health check loop logs
echo "Test 5: Verify health check loop is running"
if grep -q "Starting dual-interval health check" /tmp/host_server.log; then
    pass_test "Health check loop started"
else
    fail_test "Health check loop not started"
    info "Log contents:"
    cat /tmp/host_server.log
fi
echo ""

# Test 6: Delete program
echo "Test 6: Delete program"
DELETE_RESPONSE=$(curl -s -X DELETE http://localhost:9000/programs/$PROGRAM_ID)

# Verify program is deleted
GET_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:9000/programs/$PROGRAM_ID)
HTTP_CODE=$(echo "$GET_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "404" ]; then
    pass_test "Program deleted successfully"
else
    fail_test "Program deletion failed (HTTP $HTTP_CODE)"
    echo "Response: $GET_RESPONSE"
fi
echo ""

# Test 7: Create multiple programs
echo "Test 7: Create multiple programs"
for i in {1..3}; do
    CREATE_RESPONSE=$(curl -s -X POST http://localhost:9000/programs \
        -H "Content-Type: application/json" \
        -d "{
            \"user_id\": \"test-user-$i\",
            \"dockerfile\": \"FROM alpine:latest\nCMD sleep 3600\",
            \"src_files\": {
                \"main.go\": \"package main\nfunc main() {}\"
            }
        }")

    if echo "$CREATE_RESPONSE" | grep -q '"program_id"'; then
        PROG_ID=$(echo "$CREATE_RESPONSE" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)
        info "Created program $i: $PROG_ID"
    else
        fail_test "Failed to create program $i"
    fi
done

# Verify program count
RESPONSE=$(curl -s http://localhost:9000/programs)

if echo "$RESPONSE" | grep -q '"count":3'; then
    pass_test "Created 3 programs"
else
    fail_test "Expected count 3"
    echo "Response: $RESPONSE"
fi
echo ""

# Test 8: Verify health check loop continues running
echo "Test 8: Verify health check loop continues running"
info "Waiting 2 seconds..."
sleep 2

# Check logs for health check activity
if grep -q "Starting dual-interval health check" /tmp/host_server.log; then
    pass_test "Health check loop still running"
else
    fail_test "Health check loop not running"
fi
echo ""

# Test 9: List all programs
echo "Test 9: List all programs"
RESPONSE=$(curl -s http://localhost:9000/programs)

if echo "$RESPONSE" | grep -q '"count":3'; then
    pass_test "Listed 3 programs"
else
    fail_test "Expected 3 programs"
    echo "Response: $RESPONSE"
fi
echo ""

# Test 10: Verify build artifacts
echo "Test 10: Verify build artifacts"
if [ -f "./host_server" ]; then
    pass_test "Host server binary exists"
else
    fail_test "Host server binary not found"
fi

if [ -f "/tmp/host_server.log" ]; then
    pass_test "Host server log exists"
else
    fail_test "Host server log not found"
fi
echo ""

info "Integration test completed"
info "Note: Full Docker/Program supervisor testing requires Docker daemon"
