#!/usr/bin/env python3
"""
Web UI Production Verification Script

Comprehensive CDP-based verification of all web UI pages with trading-long deployment.
Tests all Host and WatcherAPI endpoints through the UI.

Features:
- Production build verification
- Host server startup
- trading-long deployment
- Navigation through all pages and tabs
- DOM structure validation
- API data rendering checks
- Screenshot capture
- JSON + Markdown report generation
"""

import json
import requests
import websocket
import time
import subprocess
import sys
import os
from datetime import datetime
from pathlib import Path

# Configuration
HOST_URL = "http://localhost:9000"
CHROME_CDP_URL = "http://localhost:9222"
PROJECT_ROOT = Path(__file__).parent.parent
WEB_DIR = PROJECT_ROOT / "host" / "api" / "web"
OUTPUT_DIR = PROJECT_ROOT / "host"
SCREENSHOT_DIR = OUTPUT_DIR / "screenshots"

# Create output directories
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

# Test results storage
test_results = {
    "timestamp": datetime.now().isoformat(),
    "total_tests": 0,
    "passed_tests": 0,
    "failed_tests": 0,
    "pages": [],
}


def log(message, level="INFO"):
    """Log message with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    prefix = {
        "INFO": "ℹ️",
        "SUCCESS": "✅",
        "ERROR": "❌",
        "WARNING": "⚠️",
        "STEP": "📍",
    }.get(level, "•")
    print(f"[{timestamp}] {prefix} {message}")


def run_command(cmd, cwd=None, check=True):
    """Run shell command and return output"""
    log(f"Running: {cmd}", "STEP")
    result = subprocess.run(
        cmd,
        shell=True,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if check and result.returncode != 0:
        log(f"Command failed: {result.stderr}", "ERROR")
        sys.exit(1)
    return result.stdout.strip()


def wait_for_server(url, timeout=30, interval=1):
    """Wait for server to be ready"""
    log(f"Waiting for server: {url}")
    start = time.time()
    while time.time() - start < timeout:
        try:
            response = requests.get(url, timeout=2)
            if response.status_code < 500:
                log(f"Server ready: {url}", "SUCCESS")
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(interval)
    log(f"Timeout waiting for server: {url}", "ERROR")
    return False


def build_production():
    """Build production web UI"""
    log("Building production web UI...", "STEP")
    try:
        run_command("npm install", cwd=WEB_DIR)
        run_command("npm run build", cwd=WEB_DIR)
        log("Production build successful", "SUCCESS")
        return True
    except Exception as e:
        log(f"Build failed: {e}", "ERROR")
        return False


def deploy_trading_long():
    """Deploy trading-long example and return program_id"""
    log("Deploying trading-long example...", "STEP")

    # Read deployment files
    example_dir = PROJECT_ROOT / "examples" / "trading-long"

    with open(example_dir / "main.go") as f:
        main_go = f.read()
    with open(example_dir / "binance_stream.go") as f:
        binance_stream_go = f.read()
    with open(example_dir / "commands.go") as f:
        commands_go = f.read()
    with open(example_dir / "stats.go") as f:
        stats_go = f.read()
    with open(example_dir / "trading_sim.go") as f:
        trading_sim_go = f.read()
    with open(example_dir / "go.mod") as f:
        go_mod = f.read()
    with open(example_dir / "go.sum") as f:
        go_sum = f.read()
    with open(example_dir / "Dockerfile") as f:
        dockerfile = f.read()

    # Create program
    payload = {
        "user_id": "web-ui-test",
        "dockerfile": dockerfile,
        "src_files": {
            "main.go": main_go,
            "binance_stream.go": binance_stream_go,
            "commands.go": commands_go,
            "stats.go": stats_go,
            "trading_sim.go": trading_sim_go,
            "go.mod": go_mod,
            "go.sum": go_sum,
        },
    }

    response = requests.post(f"{HOST_URL}/programs", json=payload)
    if response.status_code != 201:
        log(f"Failed to create program: {response.text}", "ERROR")
        return None

    data = response.json()
    program_id = data["program_id"]
    log(f"Program created: {program_id}", "SUCCESS")

    # Start program
    response = requests.post(f"{HOST_URL}/programs/{program_id}/start")
    if response.status_code != 200:
        log(f"Failed to start program: {response.text}", "ERROR")
        return None

    log("Program start initiated", "SUCCESS")

    # Wait for Ready state
    log("Waiting for program to reach Ready state...")
    for attempt in range(120):  # 120 attempts = 120 seconds
        response = requests.get(f"{HOST_URL}/programs/{program_id}")
        if response.status_code == 200:
            state = response.json()["state"]
            if state == "Ready":
                log(f"Program is Ready (took {attempt + 1}s)", "SUCCESS")
                return program_id
            elif state == "Error":
                error_msg = response.json().get("error_msg", "Unknown error")
                log(f"Program failed: {error_msg}", "ERROR")
                return None
            if attempt % 10 == 0 or attempt < 5:  # Log every 10 seconds or first 5
                log(f"Program state: {state} (attempt {attempt + 1}/120)")
        time.sleep(1)

    log("Timeout waiting for Ready state", "ERROR")
    return None


def connect_to_chrome():
    """Connect to Chrome via CDP"""
    log("Connecting to Chrome DevTools Protocol...", "STEP")

    # Get pages
    response = requests.get(f"{CHROME_CDP_URL}/json")
    pages = response.json()

    if not pages:
        log("No pages found, creating new one...", "WARNING")
        response = requests.put(f"{CHROME_CDP_URL}/json/new?{HOST_URL}/ui/programs")
        pages = [response.json()]

    page = pages[0]
    ws_url = page["webSocketDebuggerUrl"]

    log(f"Connecting to WebSocket: {ws_url}")
    ws = websocket.create_connection(ws_url)
    log("Connected to Chrome", "SUCCESS")

    return ws


def navigate_to(ws, url, msg_id):
    """Navigate to URL"""
    log(f"Navigating to: {url}", "STEP")
    cmd = {
        "id": msg_id,
        "method": "Page.navigate",
        "params": {"url": url},
    }
    ws.send(json.dumps(cmd))
    response = json.loads(ws.recv())
    time.sleep(2)  # Wait for page load
    return msg_id + 1


def evaluate_js(ws, expression, msg_id):
    """Evaluate JavaScript expression"""
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


def capture_screenshot(ws, filename, msg_id):
    """Capture screenshot"""
    cmd = {
        "id": msg_id,
        "method": "Page.captureScreenshot",
        "params": {"format": "png"},
    }
    ws.send(json.dumps(cmd))
    response = json.loads(ws.recv())

    if "result" in response and "data" in response["result"]:
        import base64
        screenshot_data = response["result"]["data"]
        filepath = SCREENSHOT_DIR / filename
        with open(filepath, "wb") as f:
            f.write(base64.b64decode(screenshot_data))
        log(f"Screenshot saved: {filepath}", "SUCCESS")

    return msg_id + 1


def verify_page(ws, page_name, url, checks, msg_id):
    """Verify page with DOM checks"""
    log(f"Verifying page: {page_name}", "STEP")

    page_result = {
        "name": page_name,
        "url": url,
        "checks": [],
        "passed": 0,
        "failed": 0,
    }

    # Navigate
    msg_id = navigate_to(ws, url, msg_id)

    # Run checks
    for check_name, js_expression, expected in checks:
        result, msg_id = evaluate_js(ws, js_expression, msg_id)
        passed = result == expected if expected is not None else result is not None

        page_result["checks"].append({
            "name": check_name,
            "expression": js_expression,
            "result": result,
            "expected": expected,
            "passed": passed,
        })

        if passed:
            page_result["passed"] += 1
            test_results["passed_tests"] += 1
            log(f"  ✅ {check_name}: {result}")
        else:
            page_result["failed"] += 1
            test_results["failed_tests"] += 1
            log(f"  ❌ {check_name}: got {result}, expected {expected}", "ERROR")

        test_results["total_tests"] += 1

    # Capture screenshot
    screenshot_name = f"{page_name.lower().replace(' ', '_')}.png"
    msg_id = capture_screenshot(ws, screenshot_name, msg_id)
    page_result["screenshot"] = str(SCREENSHOT_DIR / screenshot_name)

    test_results["pages"].append(page_result)

    return msg_id


def generate_reports():
    """Generate JSON and Markdown reports"""
    log("Generating reports...", "STEP")

    # JSON report
    json_path = OUTPUT_DIR / "web_ui_verification.json"
    with open(json_path, "w") as f:
        json.dump(test_results, f, indent=2)
    log(f"JSON report saved: {json_path}", "SUCCESS")

    # Markdown report
    md_path = OUTPUT_DIR / "WEB_UI_VERIFICATION_REPORT.md"
    with open(md_path, "w") as f:
        f.write("# Web UI Verification Report\n\n")
        f.write(f"**Generated**: {test_results['timestamp']}\n\n")
        f.write(f"**Summary**: {test_results['passed_tests']}/{test_results['total_tests']} tests passed\n\n")

        if test_results["passed_tests"] == test_results["total_tests"]:
            f.write("## ✅ All Tests Passed!\n\n")
        else:
            f.write(f"## ⚠️ {test_results['failed_tests']} Tests Failed\n\n")

        f.write("## Page Verification Results\n\n")
        for page in test_results["pages"]:
            status = "✅" if page["failed"] == 0 else "❌"
            f.write(f"### {status} {page['name']}\n\n")
            f.write(f"- **URL**: `{page['url']}`\n")
            f.write(f"- **Checks**: {page['passed']}/{page['passed'] + page['failed']} passed\n")
            f.write(f"- **Screenshot**: `{page['screenshot']}`\n\n")

            f.write("| Check | Result | Status |\n")
            f.write("|-------|--------|--------|\n")
            for check in page["checks"]:
                status_icon = "✅" if check["passed"] else "❌"
                result_str = str(check["result"])[:50]
                f.write(f"| {check['name']} | `{result_str}` | {status_icon} |\n")
            f.write("\n")

    log(f"Markdown report saved: {md_path}", "SUCCESS")


def main():
    """Main verification flow"""
    log("Starting Web UI Production Verification", "STEP")
    log("=" * 60)

    # Step 1: Build production
    if not build_production():
        log("Build failed, aborting", "ERROR")
        sys.exit(1)

    # Step 2: Wait for Host server (assume it's already running)
    if not wait_for_server(f"{HOST_URL}/programs"):
        log("Host server not running. Please start it first:", "ERROR")
        log("  cd host && go run cmd/main.go", "INFO")
        sys.exit(1)

    # Step 3: Deploy trading-long
    program_id = deploy_trading_long()
    if not program_id:
        log("Failed to deploy trading-long", "ERROR")
        sys.exit(1)

    # Step 4: Connect to Chrome
    ws = connect_to_chrome()
    msg_id = 1

    # Step 5: Verify all pages
    log("Starting page verification...", "STEP")
    log("=" * 60)

    # Page 1: Dashboard
    checks_dashboard = [
        ("React root exists", "document.getElementById('root') !== null", True),
        ("Dashboard heading exists", "document.querySelector('h1')?.textContent.includes('Programs Dashboard')", True),
        ("Programs count visible", "document.body.textContent.includes('programs')", True),
        ("Create button exists", "document.querySelector('button')?.textContent.includes('Create')", True),
        ("Program cards rendered", "document.querySelectorAll('[data-program-id], .bg-card').length > 0", True),
    ]
    msg_id = verify_page(ws, "Dashboard", f"{HOST_URL}/ui/programs", checks_dashboard, msg_id)

    # Page 2: ProgramDetail
    program_detail_url = f"{HOST_URL}/ui/programs/{program_id}"
    checks_detail = [
        ("React root exists", "document.getElementById('root') !== null", True),
        ("Program ID displayed", f"document.body.textContent.includes('{program_id}')", True),
        ("State badge exists", "document.body.textContent.includes('Ready') || document.body.textContent.includes('Running')", True),
        ("Watcher button exists", "Array.from(document.querySelectorAll('a, button')).some(el => el.textContent.includes('Watcher'))", True),
        ("Action buttons exist", "document.querySelectorAll('button').length >= 2", True),
        ("Build ID displayed", "document.body.textContent.includes('build-')", True),
    ]
    msg_id = verify_page(ws, "ProgramDetail", program_detail_url, checks_detail, msg_id)

    # Page 3: WatcherPage - Overview Tab
    watcher_url = f"{HOST_URL}/ui/programs/{program_id}/watcher"
    checks_watcher_overview = [
        ("React root exists", "document.getElementById('root') !== null", True),
        ("Watcher heading exists", "document.querySelector('h1')?.textContent.includes('Watcher Interface')", True),
        ("Tabs exist", "document.querySelectorAll('[role=\"tab\"]').length === 3", True),
        ("Overview tab active", "document.querySelector('[role=\"tab\"][data-state=\"active\"]')?.textContent === 'Overview'", True),
        ("StatusCard exists", "document.body.textContent.includes('Status') || document.body.textContent.includes('isRunning')", True),
        ("ConfigCard exists", "document.body.textContent.includes('Configuration') || document.body.textContent.includes('Server Port')", True),
        ("CommandPanel exists", "document.body.textContent.includes('Command') || document.querySelector('input[type=\"text\"]') !== null", True),
    ]
    msg_id = verify_page(ws, "WatcherPage_Overview", watcher_url, checks_watcher_overview, msg_id)

    # Page 4: WatcherPage - Signals & Logs Tab
    time.sleep(1)
    msg_id = evaluate_js(ws, "document.querySelector('[role=\"tab\"]:nth-child(2)').click()", msg_id)[1]
    time.sleep(1)
    checks_watcher_signals = [
        ("Signals tab active", "document.querySelector('[role=\"tab\"][data-state=\"active\"]')?.textContent === 'Signals & Logs'", True),
        ("SignalCard exists", "document.body.textContent.includes('Signal') || document.body.textContent.includes('varSigCount')", True),
        ("Signal metrics displayed", "document.body.textContent.match(/\\d+/) !== null", True),
        ("DockerLogViewer exists", "document.body.textContent.includes('Log') || document.body.textContent.includes('Container')", True),
    ]
    msg_id = verify_page(ws, "WatcherPage_Signals", watcher_url, checks_watcher_signals, msg_id)

    # Page 5: WatcherPage - Advanced Tab
    time.sleep(1)
    msg_id = evaluate_js(ws, "document.querySelector('[role=\"tab\"]:nth-child(3)').click()", msg_id)[1]
    time.sleep(1)
    checks_watcher_advanced = [
        ("Advanced tab active", "document.querySelector('[role=\"tab\"][data-state=\"active\"]')?.textContent === 'Advanced'", True),
        ("WatchingCard exists", "document.body.textContent.includes('Watched Variables') || document.body.textContent.includes('watchedVars')", True),
        ("VarStateCard exists", "document.body.textContent.includes('Variable State') || document.body.textContent.includes('variables')", True),
        ("MemoCacheCard exists", "document.body.textContent.includes('Memo Cache') || document.body.textContent.includes('entries')", True),
    ]
    msg_id = verify_page(ws, "WatcherPage_Advanced", watcher_url, checks_watcher_advanced, msg_id)

    # Step 6: Generate reports
    ws.close()
    generate_reports()

    # Step 7: Print summary
    log("=" * 60)
    log("Verification Complete!", "SUCCESS")
    log(f"Total Tests: {test_results['total_tests']}")
    log(f"Passed: {test_results['passed_tests']}", "SUCCESS")
    log(f"Failed: {test_results['failed_tests']}", "ERROR" if test_results['failed_tests'] > 0 else "SUCCESS")
    log(f"Success Rate: {100 * test_results['passed_tests'] / test_results['total_tests']:.1f}%")
    log("=" * 60)

    if test_results['failed_tests'] == 0:
        log("🎉 All tests passed! Production ready!", "SUCCESS")
        sys.exit(0)
    else:
        log("⚠️ Some tests failed. Check reports for details.", "WARNING")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nVerification interrupted by user", "WARNING")
        sys.exit(1)
    except Exception as e:
        log(f"Unexpected error: {e}", "ERROR")
        import traceback
        traceback.print_exc()
        sys.exit(1)
