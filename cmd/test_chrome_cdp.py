#!/usr/bin/env python3
"""
Chrome DevTools Protocol 직접 테스트
MCP가 연결되지 않을 때 대체 방법으로 CDP를 직접 사용
"""

import json
import requests
import websocket
import time

# 1. DevTools API로 페이지 목록 가져오기
print("🔍 Getting Chrome DevTools pages...")
response = requests.get("http://localhost:9222/json")
pages = response.json()
print(f"Found {len(pages)} page(s)")

if not pages:
    print("❌ No pages found. Creating new page...")
    new_page = requests.put("http://localhost:9222/json/new?http://localhost:9000/ui/programs")
    pages = [new_page.json()]

# 첫 번째 페이지 선택
page = pages[0]
print(f"\n📄 Page: {page['title']}")
print(f"   URL: {page['url']}")
print(f"   WebSocket: {page['webSocketDebuggerUrl']}")

# 2. WebSocket 연결
ws_url = page['webSocketDebuggerUrl']
print(f"\n🔌 Connecting to WebSocket...")

ws = websocket.create_connection(ws_url)
print("✅ Connected!")

# 3. Page.navigate로 우리 웹사이트로 이동
msg_id = 1
navigate_cmd = {
    "id": msg_id,
    "method": "Page.navigate",
    "params": {"url": "http://localhost:9000/ui/programs"}
}

print(f"\n🚀 Navigating to http://localhost:9000/ui/programs...")
ws.send(json.dumps(navigate_cmd))

# 응답 받기
response = ws.recv()
print(f"✅ Navigate response: {response}")

# 4. 페이지 로드 대기
time.sleep(2)

# 5. DOM 정보 가져오기
msg_id += 1
get_document_cmd = {
    "id": msg_id,
    "method": "DOM.getDocument"
}

ws.send(json.dumps(get_document_cmd))
dom_response = json.loads(ws.recv())
print(f"\n📋 DOM Document received")

# 6. 페이지 타이틀 가져오기
msg_id += 1
eval_cmd = {
    "id": msg_id,
    "method": "Runtime.evaluate",
    "params": {"expression": "document.title"}
}

ws.send(json.dumps(eval_cmd))
title_response = json.loads(ws.recv())
if 'result' in title_response and 'result' in title_response['result']:
    title = title_response['result']['result']['value']
    print(f"📌 Page Title: {title}")

# 7. React root 확인
msg_id += 1
eval_cmd = {
    "id": msg_id,
    "method": "Runtime.evaluate",
    "params": {"expression": "document.getElementById('root') !== null"}
}

ws.send(json.dumps(eval_cmd))
root_response = json.loads(ws.recv())
if 'result' in root_response and 'result' in root_response['result']:
    has_root = root_response['result']['result']['value']
    print(f"⚛️  React root exists: {has_root}")

# 8. 페이지 스크린샷
msg_id += 1
screenshot_cmd = {
    "id": msg_id,
    "method": "Page.captureScreenshot",
    "params": {"format": "png"}
}

ws.send(json.dumps(screenshot_cmd))
screenshot_response = json.loads(ws.recv())
if 'result' in screenshot_response and 'data' in screenshot_response['result']:
    import base64
    screenshot_data = screenshot_response['result']['data']
    with open('/tmp/chrome_screenshot.png', 'wb') as f:
        f.write(base64.b64decode(screenshot_data))
    print("📸 Screenshot saved to /tmp/chrome_screenshot.png")

print("\n✅ Chrome DevTools Protocol test complete!")

ws.close()
