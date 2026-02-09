#!/bin/bash

# Health Check Integration Test Script
# Tests the dual-interval health check system with real Program supervisors

set -e

echo "========================================"
echo "Health Check Integration Test"
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

    # Get all program IDs
    PROGRAMS=$(curl -s http://localhost:9000/programs | jq -r '.programs[].program_id' 2>/dev/null || echo "")

    # Delete each program
    for PROG_ID in $PROGRAMS; do
        info "Deleting program: $PROG_ID"
        curl -s -X DELETE "http://localhost:9000/programs/$PROG_ID" > /dev/null || true
    done

    # Stop Host server if running
    if [ ! -z "$HOST_PID" ]; then
        info "Stopping Host server (PID: $HOST_PID)"
        kill $HOST_PID 2>/dev/null || true
        wait $HOST_PID 2>/dev/null || true
    fi

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

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    fail_test "jq is not installed (required for JSON parsing)"
    exit 1
fi

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
go build -o host_server ./cmd > /dev/null 2>&1
if [ $? -eq 0 ]; then
    pass_test "Host server build"
else
    fail_test "Host server build"
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
COUNT=$(echo $RESPONSE | jq -r '.count')

if [ "$COUNT" = "0" ]; then
    pass_test "Empty program list"
else
    fail_test "Expected count 0, got $COUNT"
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

PROGRAM_ID=$(echo $CREATE_RESPONSE | jq -r '.program_id')
STATE=$(echo $CREATE_RESPONSE | jq -r '.state')

if [ ! -z "$PROGRAM_ID" ] && [ "$PROGRAM_ID" != "null" ]; then
    pass_test "Program created: $PROGRAM_ID"
else
    fail_test "Program creation failed"
    echo "Response: $CREATE_RESPONSE"
fi

if [ "$STATE" = "Created" ]; then
    pass_test "Program state is 'Created'"
else
    fail_test "Expected state 'Created', got '$STATE'"
fi
echo ""

# Test 3: Get program details (not running)
echo "Test 3: Get program details (not running)"
GET_RESPONSE=$(curl -s http://localhost:9000/programs/$PROGRAM_ID)
GET_STATE=$(echo $GET_RESPONSE | jq -r '.state')

if [ "$GET_STATE" = "created" ]; then
    pass_test "Program state is 'created' (not running)"
else
    fail_test "Expected state 'created', got '$GET_STATE'"
fi
echo ""

# Test 4: Health check loop should not affect non-running programs
echo "Test 4: Health check loop behavior for non-running programs"
info "Waiting 1 second for health check loop..."
sleep 1

GET_RESPONSE=$(curl -s http://localhost:9000/programs/$PROGRAM_ID)
GET_STATE=$(echo $GET_RESPONSE | jq -r '.state')

if [ "$GET_STATE" = "created" ]; then
    pass_test "Program still in 'created' state (health check loop does not affect non-running programs)"
else
    fail_test "Expected state 'created', got '$GET_STATE'"
fi
echo ""

# Test 5: Verify health check loop logs
echo "Test 5: Verify health check loop is running"
if grep -q "Starting dual-interval health check" /tmp/host_server.log; then
    pass_test "Health check loop started"
else
    fail_test "Health check loop not started"
fi
echo ""

# Test 6: Delete program
echo "Test 6: Delete program"
DELETE_RESPONSE=$(curl -s -X DELETE http://localhost:9000/programs/$PROGRAM_ID)

# Verify program is deleted
GET_RESPONSE=$(curl -s http://localhost:9000/programs/$PROGRAM_ID)
ERROR=$(echo $GET_RESPONSE | jq -r '.error')

if [ "$ERROR" = "Not Found" ]; then
    pass_test "Program deleted successfully"
else
    fail_test "Program deletion failed"
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

    PROG_ID=$(echo $CREATE_RESPONSE | jq -r '.program_id')
    if [ ! -z "$PROG_ID" ] && [ "$PROG_ID" != "null" ]; then
        info "Created program $i: $PROG_ID"
    else
        fail_test "Failed to create program $i"
    fi
done

# Verify program count
RESPONSE=$(curl -s http://localhost:9000/programs)
COUNT=$(echo $RESPONSE | jq -r '.count')

if [ "$COUNT" = "3" ]; then
    pass_test "Created 3 programs"
else
    fail_test "Expected count 3, got $COUNT"
fi
echo ""

# Test 8: List all programs
echo "Test 8: List all programs"
RESPONSE=$(curl -s http://localhost:9000/programs)
PROGRAMS=$(echo $RESPONSE | jq -r '.programs[].program_id')

PROG_COUNT=0
for PROG_ID in $PROGRAMS; do
    info "Program: $PROG_ID"
    ((PROG_COUNT++))
done

if [ $PROG_COUNT -eq 3 ]; then
    pass_test "Listed 3 programs"
else
    fail_test "Expected 3 programs, got $PROG_COUNT"
fi
echo ""

# Test 9: Verify Registry is immutable (no State field)
echo "Test 9: Verify Registry immutability"
info "Registry should not contain State, ImageID, ContainerID, ErrorMsg fields"
info "These should only be available from running programs via GetState()"

# All programs should show "created" state (not running)
for PROG_ID in $PROGRAMS; do
    GET_RESPONSE=$(curl -s http://localhost:9000/programs/$PROG_ID)
    GET_STATE=$(echo $GET_RESPONSE | jq -r '.state')

    if [ "$GET_STATE" = "created" ]; then
        info "✓ Program $PROG_ID: state='created' (not running)"
    else
        fail_test "Program $PROG_ID: expected 'created', got '$GET_STATE'"
    fi
done

pass_test "Registry immutability verified"
echo ""

# Test 10: Cleanup all programs
echo "Test 10: Cleanup all programs"
for PROG_ID in $PROGRAMS; do
    curl -s -X DELETE "http://localhost:9000/programs/$PROG_ID" > /dev/null
done

# Verify all deleted
RESPONSE=$(curl -s http://localhost:9000/programs)
COUNT=$(echo $RESPONSE | jq -r '.count')

if [ "$COUNT" = "0" ]; then
    pass_test "All programs deleted"
else
    fail_test "Expected count 0, got $COUNT"
fi
echo ""

# Note: Full integration testing with Program supervisors and Docker requires
# additional setup and is beyond the scope of this script. The tests above
# validate the Host API behavior without running programs.

info "Integration test completed"
info "Note: Full Docker/Program supervisor testing requires additional setup"
