# Web UI Verification Report

**Generated**: 2026-02-09T03:04:41.866685

**Summary**: 17/26 tests passed

## ⚠️ 9 Tests Failed

## Page Verification Results

### ❌ Dashboard

- **URL**: `http://localhost:9000/ui/programs`
- **Checks**: 4/5 passed
- **Screenshot**: `/home/rlaaudgjs5638/hersh/host/screenshots/dashboard.png`

| Check | Result | Status |
|-------|--------|--------|
| React root exists | `True` | ✅ |
| Dashboard heading exists | `True` | ✅ |
| Programs count visible | `True` | ✅ |
| Create button exists | `False` | ❌ |
| Program cards rendered | `True` | ✅ |

### ✅ ProgramDetail

- **URL**: `http://localhost:9000/ui/programs/web-ui-test-build-84093552d9b9-25366318`
- **Checks**: 6/6 passed
- **Screenshot**: `/home/rlaaudgjs5638/hersh/host/screenshots/programdetail.png`

| Check | Result | Status |
|-------|--------|--------|
| React root exists | `True` | ✅ |
| Program ID displayed | `True` | ✅ |
| State badge exists | `True` | ✅ |
| Watcher button exists | `True` | ✅ |
| Action buttons exist | `True` | ✅ |
| Build ID displayed | `True` | ✅ |

### ❌ WatcherPage_Overview

- **URL**: `http://localhost:9000/ui/programs/web-ui-test-build-84093552d9b9-25366318/watcher`
- **Checks**: 4/7 passed
- **Screenshot**: `/home/rlaaudgjs5638/hersh/host/screenshots/watcherpage_overview.png`

| Check | Result | Status |
|-------|--------|--------|
| React root exists | `True` | ✅ |
| Watcher heading exists | `True` | ✅ |
| Tabs exist | `False` | ❌ |
| Overview tab active | `False` | ❌ |
| StatusCard exists | `True` | ✅ |
| ConfigCard exists | `False` | ❌ |
| CommandPanel exists | `True` | ✅ |

### ❌ WatcherPage_Signals

- **URL**: `http://localhost:9000/ui/programs/web-ui-test-build-84093552d9b9-25366318/watcher`
- **Checks**: 3/4 passed
- **Screenshot**: `/home/rlaaudgjs5638/hersh/host/screenshots/watcherpage_signals.png`

| Check | Result | Status |
|-------|--------|--------|
| Signals tab active | `False` | ❌ |
| SignalCard exists | `True` | ✅ |
| Signal metrics displayed | `True` | ✅ |
| DockerLogViewer exists | `True` | ✅ |

### ❌ WatcherPage_Advanced

- **URL**: `http://localhost:9000/ui/programs/web-ui-test-build-84093552d9b9-25366318/watcher`
- **Checks**: 0/4 passed
- **Screenshot**: `/home/rlaaudgjs5638/hersh/host/screenshots/watcherpage_advanced.png`

| Check | Result | Status |
|-------|--------|--------|
| Advanced tab active | `False` | ❌ |
| WatchingCard exists | `False` | ❌ |
| VarStateCard exists | `False` | ❌ |
| MemoCacheCard exists | `False` | ❌ |

