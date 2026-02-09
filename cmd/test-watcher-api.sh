#!/bin/bash
program_id="test-user-build-ec5a5a719102-18728430"
container_id="75b02199528aa20620cb2ba9364952023e5be344fbfb85f65d1d544235184db9"

echo "🔍 Container Port Bindings:"
docker port $container_id

echo ""
echo "🌐 Testing Direct Localhost Access (localhost:19001):"
curl -s localhost:19001/watcher/status

echo ""
echo ""
echo "🌐 Testing Host API Proxy:"
curl -s "localhost:9000/programs/${program_id}/proxy/watcher/status"
