#!/bin/bash

# Chromium을 MCP Chrome DevTools용으로 시작
# --remote-allow-origins=* 플래그가 필수!

echo "🚀 Starting Chromium for MCP Chrome DevTools..."

chromium-browser \
  --remote-debugging-port=9222 \
  --no-sandbox \
  --disable-gpu \
  --headless \
  --remote-allow-origins='*' \
  &

sleep 3

echo ""
echo "🔍 Testing Chrome DevTools Protocol..."
curl -s http://localhost:9222/json/version | python3 -m json.tool

echo ""
echo "✅ Chromium is ready for MCP!"
echo "   Remote debugging: http://localhost:9222"
echo "   Allowed origins: * (all)"
