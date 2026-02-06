#!/bin/bash
program_id=$(cat .last-program-id)
container_id="78f9a539ce8323018b136dcb30a14aa3e5a499b4285c1ca9a9f16149f10d1694"

echo "🔍 Container Port Bindings:"
docker port $container_id

echo ""
echo "🌐 Testing Direct Localhost Access (localhost:19002):"
curl -s localhost:19002/watcher/status | python3 -m json.tool 2>/dev/null || curl -s localhost:19002/watcher/status

echo ""
echo ""
echo "🌐 Testing Host API Proxy (/programs/${program_id}/proxy/watcher/status):"
curl -s "localhost:9000/programs/${program_id}/proxy/watcher/status" | python3 -m json.tool 2>/dev/null || curl -s "localhost:9000/programs/${program_id}/proxy/watcher/status"
