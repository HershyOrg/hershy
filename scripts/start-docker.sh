#!/bin/bash
# Start Docker daemon and verify it's running

set -e

echo "Starting Docker daemon..."
sudo systemctl start docker

echo "Waiting for Docker to be ready..."
sleep 2

echo "Checking Docker status..."
sudo systemctl status docker --no-pager | head -10

echo ""
echo "Testing Docker access..."
docker ps

echo ""
echo "✅ Docker daemon is running and accessible!"
echo ""
echo "You can now run integration tests:"
echo "  cd host && go test -v -run TestRealEffectHandler_FullLifecycle"
