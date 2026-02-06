#!/bin/bash
# Run full integration tests including Docker build and execution

set -e

echo "======================================================================"
echo "  Hersh Integration Test Suite"
echo "======================================================================"
echo ""

# Check if Docker is running
if ! docker ps >/dev/null 2>&1; then
    echo "❌ Docker daemon is not running!"
    echo ""
    echo "To start Docker, run:"
    echo "  sudo bash scripts/start-docker.sh"
    echo ""
    exit 1
fi

echo "✅ Docker daemon is running"
echo ""

# Phase 1: Unit Tests
echo "======================================================================"
echo "Phase 1: Program Unit Tests (Reducer)"
echo "======================================================================"
cd /home/rlaaudgjs5638/hersh/program
go test -v -run TestReduce 2>&1 | tail -5
echo ""

# Phase 2: Integration Tests (Supervisor)
echo "======================================================================"
echo "Phase 2: Program Integration Tests (Supervisor)"
echo "======================================================================"
go test -v -run TestSupervisor 2>&1 | tail -5
echo ""

# Phase 3: Host Tests (without Docker)
echo "======================================================================"
echo "Phase 3: Host Tests (Storage & Compose)"
echo "======================================================================"
cd /home/rlaaudgjs5638/hersh/host
go test -v -tags=integration -run "TestStorageManager|TestComposeBuilder" 2>&1 | tail -8
echo ""

# Phase 4: Full Docker Integration Test
echo "======================================================================"
echo "Phase 4: Full Docker Integration Test (Build → Run → Stop)"
echo "======================================================================"
echo "⚠️  This test will:"
echo "  - Build a Docker image from Dockerfile"
echo "  - Start a container with gVisor/runc runtime"
echo "  - Verify container is running"
echo "  - Stop and cleanup container"
echo ""
echo "This may take 2-3 minutes..."
echo ""

go test -v -tags=integration -run TestRealEffectHandler_FullLifecycle -timeout 10m

echo ""
echo "======================================================================"
echo "✅ All Integration Tests Completed!"
echo "======================================================================"
