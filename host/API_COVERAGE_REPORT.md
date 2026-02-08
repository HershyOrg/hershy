
# WatcherPage API Coverage Report

Generated: 2026-02-09T03:43:16.783248
Program ID: test-user-build-91e9ff33cfb0-8148021f

## Test Summary
- **Total Tests**: 17
- **Passed**: 9 ✅
- **Failed**: 8 ❌
- **Success Rate**: 52.9%

## API Coverage Matrix

| API Endpoint | UI Component | Tab/Location | Status |
|--------------|--------------|--------------|--------|
| GET /watcher/status | StatusCard | Overview | ✅ |
| GET /watcher/config | ConfigCard | Overview | ✅ |
| GET /watcher/signals | SignalCard (enhanced) | Signals & Logs | ❌ |
| GET /watcher/logs | LogViewer | Signals & Logs | ✅ |
| POST /watcher/message | CommandPanel | Overview | ✅ |
| GET /watcher/watching | WatchingCard | Advanced | ❌ |
| GET /watcher/memoCache | MemoCacheCard | Advanced | ❌ |
| GET /watcher/varState | VarStateCard | Advanced | ❌ |

## Detailed Test Results

### ✅ React root exists
- **Result**: `True`
- **Expected**: `True`

### ✅ 3 Tabs exist
- **Result**: `3`
- **Expected**: `3`

### ✅ Tab names correct
- **Result**: `Overview,Signals & Logs,Advanced`
- **Expected**: `Overview,Signals & Logs,Advanced`

### ✅ StatusCard visible
- **Result**: `True`
- **Expected**: `True`

### ✅ ConfigCard heading exists
- **Result**: `True`
- **Expected**: `True`

### ✅ ConfigCard shows Server Port
- **Result**: `True`
- **Expected**: `True`

### ✅ ConfigCard shows port 8080
- **Result**: `True`
- **Expected**: `True`

### ✅ ConfigCard shows Signal Chan Capacity
- **Result**: `True`
- **Expected**: `True`

### ✅ ConfigCard shows 50000
- **Result**: `True`
- **Expected**: `True`

### ❌ SignalCard visible
- **Result**: `False`
- **Expected**: `True`

### ❌ Recent Signals section exists
- **Result**: `False`
- **Expected**: `True`

### ❌ WatchingCard heading exists
- **Result**: `False`
- **Expected**: `True`

### ❌ WatchingCard shows stats_ticker
- **Result**: `False`
- **Expected**: `True`

### ❌ WatchingCard shows btc_price
- **Result**: `False`
- **Expected**: `True`

### ❌ WatchingCard shows eth_price
- **Result**: `False`
- **Expected**: `True`

### ❌ VarStateCard heading exists
- **Result**: `False`
- **Expected**: `True`

### ❌ MemoCacheCard heading exists
- **Result**: `False`
- **Expected**: `True`

