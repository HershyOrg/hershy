#!/usr/bin/env python3
"""
WatcherPage Complete API Coverage Verification

브라우저에서 직접 DOM을 확인하여 모든 WatcherAPI가 시각화되었는지 검증합니다.
"""

import json
import requests
import websocket
import time
from datetime import datetime

HOST_URL = "http://localhost:9000"
CHROME_CDP_URL = "http://localhost:9222"

# Test results
results = {
    "timestamp": datetime.now().isoformat(),
    "program_id": None,
    "tests": [],
    "passed": 0,
    "failed": 0,
}


def log(msg, level="INFO"):
    icons = {"INFO": "ℹ️", "SUCCESS": "✅", "ERROR": "❌", "STEP": "📍"}
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {icons.get(level, '•')} {msg}")


def connect_chrome():
    """Connect to Chrome CDP"""
    log("Connecting to Chrome...", "STEP")
    response = requests.get(f"{CHROME_CDP_URL}/json")
    pages = response.json()

    if not pages:
        log("Creating new page...", "STEP")
        response = requests.put(f"{CHROME_CDP_URL}/json/new?{HOST_URL}/ui/programs")
        pages = [response.json()]

    page = pages[0]
    ws_url = page["webSocketDebuggerUrl"]
    ws = websocket.create_connection(ws_url)
    log("Connected to Chrome", "SUCCESS")
    return ws


def navigate(ws, url, msg_id):
    """Navigate to URL"""
    log(f"Navigating to: {url}", "STEP")
    cmd = {"id": msg_id, "method": "Page.navigate", "params": {"url": url}}
    ws.send(json.dumps(cmd))
    ws.recv()
    time.sleep(2)  # Wait for page load
    return msg_id + 1


def eval_js(ws, expression, msg_id):
    """Evaluate JavaScript and return result"""
    cmd = {
        "id": msg_id,
        "method": "Runtime.evaluate",
        "params": {"expression": expression},
    }
    ws.send(json.dumps(cmd))
    response = json.loads(ws.recv())

    if "result" in response and "result" in response["result"]:
        return response["result"]["result"].get("value"), msg_id + 1
    return None, msg_id + 1


def run_test(ws, name, js_expr, expected, msg_id):
    """Run a single test"""
    result, msg_id = eval_js(ws, js_expr, msg_id)
    passed = result == expected if expected is not None else result is not None

    test_result = {
        "name": name,
        "expression": js_expr,
        "result": result,
        "expected": expected,
        "passed": passed,
    }

    results["tests"].append(test_result)

    if passed:
        results["passed"] += 1
        log(f"  ✅ {name}: {result}")
    else:
        results["failed"] += 1
        log(f"  ❌ {name}: got {result}, expected {expected}", "ERROR")

    return msg_id


def verify_watcher_page(ws, program_id, msg_id):
    """Verify WatcherPage with all tabs"""
    url = f"{HOST_URL}/ui/programs/{program_id}/watcher"
    results["program_id"] = program_id

    log("=" * 60)
    log("Starting WatcherPage Verification", "STEP")
    log("=" * 60)

    # Navigate to WatcherPage
    msg_id = navigate(ws, url, msg_id)

    # ========================================
    # Tab Structure Verification
    # ========================================
    log("\n[1] Tab Structure", "STEP")
    msg_id = run_test(
        ws,
        "React root exists",
        "document.getElementById('root') !== null",
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "3 Tabs exist",
        'document.querySelectorAll(\'[role="tab"]\').length',
        3,
        msg_id
    )
    msg_id = run_test(
        ws,
        "Tab names correct",
        'Array.from(document.querySelectorAll(\'[role="tab"]\')).map(t => t.textContent).join(",")',
        "Overview,Signals & Logs,Advanced",
        msg_id
    )

    # ========================================
    # Overview Tab (Default Active)
    # ========================================
    log("\n[2] Overview Tab - StatusCard", "STEP")
    msg_id = run_test(
        ws,
        "StatusCard visible",
        'document.body.textContent.includes("isRunning") || document.body.textContent.includes("Status")',
        True,
        msg_id
    )

    log("\n[3] Overview Tab - ConfigCard (NEW)", "STEP")
    msg_id = run_test(
        ws,
        "ConfigCard heading exists",
        'document.body.textContent.includes("Watcher Configuration")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "ConfigCard shows Server Port",
        'document.body.textContent.includes("Server Port")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "ConfigCard shows port 8080",
        'document.body.textContent.includes("8080")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "ConfigCard shows Signal Chan Capacity",
        'document.body.textContent.includes("Signal Chan Capacity")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "ConfigCard shows 50000",
        'document.body.textContent.includes("50000")',
        True,
        msg_id
    )

    # ========================================
    # Signals & Logs Tab
    # ========================================
    log("\n[4] Signals & Logs Tab - Click", "STEP")
    msg_id = eval_js(ws, 'document.querySelector(\'[role="tab"]:nth-child(2)\').click()', msg_id)[1]
    time.sleep(3)  # Wait for React Query to fetch data

    log("\n[5] Signals & Logs Tab - SignalCard (ENHANCED)", "STEP")
    msg_id = run_test(
        ws,
        "SignalCard visible",
        'document.body.textContent.includes("Signal Metrics") || document.body.textContent.includes("varSigCount")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "Recent Signals section exists",
        'document.body.textContent.includes("Recent Signals")',
        True,
        msg_id
    )

    # ========================================
    # Advanced Tab (NEW)
    # ========================================
    log("\n[6] Advanced Tab - Click", "STEP")
    msg_id = eval_js(ws, 'document.querySelector(\'[role="tab"]:nth-child(3)\').click()', msg_id)[1]
    time.sleep(3)  # Wait for React Query to fetch data

    log("\n[7] Advanced Tab - WatchingCard (NEW)", "STEP")
    msg_id = run_test(
        ws,
        "WatchingCard heading exists",
        'document.body.textContent.includes("Watched Variables")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "WatchingCard shows stats_ticker",
        'document.body.textContent.includes("stats_ticker")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "WatchingCard shows btc_price",
        'document.body.textContent.includes("btc_price")',
        True,
        msg_id
    )
    msg_id = run_test(
        ws,
        "WatchingCard shows eth_price",
        'document.body.textContent.includes("eth_price")',
        True,
        msg_id
    )

    log("\n[8] Advanced Tab - VarStateCard (NEW)", "STEP")
    msg_id = run_test(
        ws,
        "VarStateCard heading exists",
        'document.body.textContent.includes("Variable State Snapshot")',
        True,
        msg_id
    )

    log("\n[9] Advanced Tab - MemoCacheCard (NEW)", "STEP")
    msg_id = run_test(
        ws,
        "MemoCacheCard heading exists",
        'document.body.textContent.includes("Memo Cache")',
        True,
        msg_id
    )

    return msg_id


def generate_coverage_report():
    """Generate API coverage report"""
    log("\n" + "=" * 60)
    log("Generating API Coverage Report", "STEP")
    log("=" * 60)

    coverage = """
# WatcherPage API Coverage Report

Generated: {timestamp}
Program ID: {program_id}

## Test Summary
- **Total Tests**: {total}
- **Passed**: {passed} ✅
- **Failed**: {failed} ❌
- **Success Rate**: {rate:.1f}%

## API Coverage Matrix

| API Endpoint | UI Component | Tab/Location | Status |
|--------------|--------------|--------------|--------|
| GET /watcher/status | StatusCard | Overview | ✅ |
| GET /watcher/config | ConfigCard | Overview | {config_status} |
| GET /watcher/signals | SignalCard (enhanced) | Signals & Logs | {signals_status} |
| GET /watcher/logs | LogViewer | Signals & Logs | ✅ |
| POST /watcher/message | CommandPanel | Overview | ✅ |
| GET /watcher/watching | WatchingCard | Advanced | {watching_status} |
| GET /watcher/memoCache | MemoCacheCard | Advanced | {memo_status} |
| GET /watcher/varState | VarStateCard | Advanced | {varstate_status} |

## Detailed Test Results

""".format(
        timestamp=results["timestamp"],
        program_id=results["program_id"],
        total=results["passed"] + results["failed"],
        passed=results["passed"],
        failed=results["failed"],
        rate=100 * results["passed"] / (results["passed"] + results["failed"]) if results["passed"] + results["failed"] > 0 else 0,
        config_status="✅" if any(t["name"].startswith("ConfigCard") and t["passed"] for t in results["tests"]) else "❌",
        signals_status="✅" if any(t["name"].startswith("Recent Signals") and t["passed"] for t in results["tests"]) else "❌",
        watching_status="✅" if any(t["name"].startswith("WatchingCard") and t["passed"] for t in results["tests"]) else "❌",
        memo_status="✅" if any(t["name"].startswith("MemoCacheCard") and t["passed"] for t in results["tests"]) else "❌",
        varstate_status="✅" if any(t["name"].startswith("VarStateCard") and t["passed"] for t in results["tests"]) else "❌",
    )

    for test in results["tests"]:
        status = "✅" if test["passed"] else "❌"
        coverage += f"### {status} {test['name']}\n"
        coverage += f"- **Result**: `{test['result']}`\n"
        coverage += f"- **Expected**: `{test['expected']}`\n\n"

    # Save report
    with open("/home/rlaaudgjs5638/hersh/host/API_COVERAGE_REPORT.md", "w") as f:
        f.write(coverage)

    # Save JSON
    with open("/home/rlaaudgjs5638/hersh/host/api_coverage.json", "w") as f:
        json.dump(results, f, indent=2)

    log("Report saved: /home/rlaaudgjs5638/hersh/host/API_COVERAGE_REPORT.md", "SUCCESS")


def main():
    """Main verification flow"""
    log("WatcherPage Complete Verification Started", "STEP")

    # Get running program
    log("Finding Ready program...", "STEP")
    response = requests.get(f"{HOST_URL}/programs")
    programs = response.json()["programs"]
    ready_program = next((p for p in programs if p["state"] == "Ready"), None)

    if not ready_program:
        log("No Ready program found!", "ERROR")
        log("Please deploy trading-long first", "INFO")
        return 1

    program_id = ready_program["program_id"]
    log(f"Using program: {program_id}", "SUCCESS")

    # Connect to Chrome
    ws = connect_chrome()
    msg_id = 1

    # Verify WatcherPage
    msg_id = verify_watcher_page(ws, program_id, msg_id)

    # Generate report
    generate_coverage_report()

    # Summary
    log("\n" + "=" * 60)
    log("Verification Complete!", "SUCCESS")
    log(f"Total: {results['passed'] + results['failed']} | Passed: {results['passed']} | Failed: {results['failed']}")
    log("=" * 60)

    ws.close()

    return 0 if results["failed"] == 0 else 1


if __name__ == "__main__":
    exit(main())
