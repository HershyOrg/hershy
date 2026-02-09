#!/bin/bash

# Chromium 설치 스크립트
# MCP Chrome DevTools를 사용하기 위한 WSL Chromium 설치

set -e

echo "🔧 Updating apt package list..."
sudo apt update

echo "📦 Installing Chromium browser..."
sudo apt install -y chromium-browser

echo "✅ Chromium installed successfully!"
chromium-browser --version

echo ""
echo "🚀 Launching Chromium in remote debugging mode..."
pkill -f chromium-browser 2>/dev/null || true
sleep 1

chromium-browser --remote-debugging-port=9222 --no-sandbox --disable-gpu --headless &
sleep 3

echo ""
echo "🔍 Testing Chrome DevTools Protocol..."
curl -s http://localhost:9222/json/version | python3 -m json.tool

echo ""
echo "✅ Chromium is ready for MCP Chrome DevTools!"
echo "   Remote debugging endpoint: http://localhost:9222"
