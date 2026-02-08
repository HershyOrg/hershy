#!/bin/bash
chromium-browser --remote-debugging-port=9222 --no-sandbox --disable-gpu --headless --remote-allow-origins='*' > /tmp/chromium.log 2>&1 &
sleep 3
curl -s http://localhost:9222/json/version
