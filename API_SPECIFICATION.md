# Hersh System API Specification

Complete API documentation for Hersh Host Server and WatcherServer.

**Version**: 1.0.0
**Last Updated**: 2026-02-09

---

## Table of Contents

1. [Host API](#host-api) - Program lifecycle management
2. [WatcherServer API](#watcherserver-api) - Runtime monitoring and control
3. [Web UI Routes](#web-ui-routes) - Frontend routing

---

## Host API

Base URL: `http://localhost:9000`

The Host API manages program lifecycle, builds, and container orchestration.

### 1. Create Program

Creates a new program with source code and Dockerfile.

**Endpoint**: `POST /programs`

**Request Body**:
```json
{
  "user_id": "string",
  "dockerfile": "string (Dockerfile content)",
  "src_files": {
    "filename.go": "file content",
    "go.mod": "module content",
    "go.sum": "checksum content"
  }
}
```

**Response** (201 Created):
```json
{
  "program_id": "user-build-hash-uuid",
  "build_id": "build-hash",
  "state": "Created",
  "proxy_url": "http://localhost:19001",
  "created_at": "2026-02-09T04:07:33.576893179+09:00"
}
```

**Notes**:
- Creating a program does NOT automatically start it
- Source files are stored in `{storage}/{program_id}/src/`
- Program state starts as "Created"

---

### 2. Start Program

Triggers Docker build and starts the container.

**Endpoint**: `POST /programs/{id}/start`

**Response** (200 OK):
```json
{
  "program_id": "user-build-hash-uuid",
  "state": "starting",
  "message": "program start initiated"
}
```

**State Transitions**:
```
Created → Building → Built → Starting → Ready
```

**Error States**:
- Cannot start from states other than "Created" or "Stopped"
- Returns 409 Conflict if invalid state

---

### 3. Stop Program

Stops a running container gracefully.

**Endpoint**: `POST /programs/{id}/stop`

**Response** (200 OK):
```json
{
  "program_id": "user-build-hash-uuid",
  "state": "Stopping",
  "message": "program stop initiated"
}
```

**State Transition**: `Ready → Stopping → Stopped`

---

### 4. Restart Program

Stops and restarts a running program.

**Endpoint**: `POST /programs/{id}/restart`

**Response** (200 OK):
```json
{
  "program_id": "user-build-hash-uuid",
  "state": "restarting",
  "message": "program restart initiated"
}
```

**State Transition**: `Ready → Stopping → Stopped → Starting → Ready`

---

### 5. Get Program Details

Retrieves current program state and metadata.

**Endpoint**: `GET /programs/{id}`

**Response** (200 OK):
```json
{
  "program_id": "user-build-hash-uuid",
  "build_id": "build-hash",
  "user_id": "demo-user",
  "state": "Ready",
  "image_id": "sha256:abc123...",
  "container_id": "abc123def456",
  "proxy_url": "http://localhost:19001",
  "error_msg": null,
  "created_at": "2026-02-09T04:07:33.576893179+09:00",
  "updated_at": "2026-02-09T04:08:45.123456789+09:00"
}
```

**Program States**:
- `Created`: Program metadata created, not started
- `Building`: Docker image being built
- `Built`: Image built successfully
- `Starting`: Container starting
- `Ready`: Container running, WatcherAPI available
- `Stopping`: Container being stopped
- `Stopped`: Container stopped cleanly
- `Error`: Build or runtime error occurred

---

### 6. List All Programs

Returns all programs in the registry.

**Endpoint**: `GET /programs`

**Response** (200 OK):
```json
{
  "programs": [
    {
      "program_id": "user-build-hash-uuid",
      "build_id": "build-hash",
      "user_id": "demo-user",
      "state": "Ready",
      "proxy_url": "http://localhost:19001",
      "created_at": "2026-02-09T04:07:33Z",
      "updated_at": "2026-02-09T04:08:45Z"
    }
  ],
  "count": 1
}
```

---

### 7. Delete Program

Removes program and all associated resources.

**Endpoint**: `DELETE /programs/{id}`

**Response** (200 OK):
```json
{
  "message": "program deleted successfully"
}
```

**Cleanup Actions**:
- Stops container if running
- Removes Docker container and image
- Deletes all storage directories
- Removes from registry

---

### 8. Get Container Logs

Retrieves Docker container logs (last 200 lines).

**Endpoint**: `GET /programs/{id}/logs`

**Response** (200 OK):
```json
{
  "program_id": "user-build-hash-uuid",
  "container_id": "abc123def456",
  "logs": "2026-02-09T04:08:50Z Starting application...\n2026-02-09T04:08:51Z Server ready\n",
  "timestamp": "2026-02-09T04:10:00Z"
}
```

---

### 9. Get Source Code

Retrieves all source files used for program build.

**Endpoint**: `GET /programs/{id}/source`

**Response** (200 OK):
```json
{
  "program_id": "user-build-hash-uuid",
  "files": {
    "Dockerfile": "FROM golang:1.23...",
    "main.go": "package main\n\nimport...",
    "go.mod": "module example.com/app...",
    "go.sum": "github.com/..."
  },
  "retrieved_at": "2026-02-09T04:10:00Z"
}
```

**Use Cases**:
- View deployed code from Web UI
- Verify source integrity
- Debug deployment issues
- Code review after deployment

---

### 10. WatcherAPI Proxy

Proxies requests to container's WatcherAPI server.

**Endpoint**: `GET /programs/{id}/proxy/watcher/*`

**Example**:
```bash
GET /programs/{id}/proxy/watcher/status
→ Proxied to: http://localhost:19001/watcher/status
```

**Notes**:
- Only available when program state is "Ready"
- Returns 503 Service Unavailable if not ready
- Timeout: 30 seconds

---

## WatcherServer API

Base URL (via proxy): `http://localhost:9000/programs/{id}/proxy/watcher`
Direct URL (container): `http://localhost:{publishPort}/watcher`: 
외부에서의 Direct URL 포트로의 접근은 차단됨. 보안상 이유로 로컬 인바운드만 허용시켜놨음.

The WatcherServer API provides runtime monitoring, state inspection, and control.

### 1. Get Status

Returns Watcher runtime status and uptime.

**Endpoint**: `GET /watcher/status`

**Response** (200 OK):
```json
{
  "state": "Ready",
  "isRunning": true,
  "watcherID": "effect Handler ctx",
  "uptime": "5m30.123456789s",
  "lastUpdate": "2026-02-09T04:10:00Z"
}
```

**States**:
- `NotRun`: Watcher not started yet
- `InitRun`: Initialization phase
- `Ready`: Running normally
- `Stopping`: Shutdown initiated
- `Stopped`: Cleanly stopped

---

### 2. Get Logs

Retrieves internal Watcher logs.

**Endpoint**: `GET /watcher/logs?type={type}&limit={n}`

**Query Parameters**:
- `type` (optional): Log type filter
  - `all` (default): All logs
  - `effect`: Effect execution logs
  - `reduce`: Reducer logs
  - `watch_error`: Watch callback errors
  - `context`: HershContext operations
  - `state_fault`: State transition faults
- `limit` (optional): Max entries (default: 100)

**Response** (200 OK):
```json
{
  "effectLogs": [
    {
      "timestamp": "2026-02-09T04:08:50Z",
      "type": "EffectExecuted",
      "details": "..."
    }
  ],
  "reduceLogs": [...],
  "watchErrorLogs": [...],
  "contextLogs": [...],
  "stateFaultLogs": [...]
}
```

**Example Usage**:
```bash
# Get last 50 effect logs
GET /watcher/logs?type=effect&limit=50

# Get all recent logs
GET /watcher/logs?limit=200
```

---

### 3. Get Signals

Returns signal queue metrics and recent signals.

**Endpoint**: `GET /watcher/signals`

**Response** (200 OK):
```json
{
  "varSigCount": 3,
  "userSigCount": 1,
  "watcherSigCount": 0,
  "totalPending": 4,
  "recentSignals": [
    {
      "type": "var",
      "content": "stats_ticker updated",
      "createdAt": "2026-02-09T04:10:00Z"
    },
    {
      "type": "user",
      "content": "status",
      "createdAt": "2026-02-09T04:10:01Z"
    }
  ],
  "timestamp": "2026-02-09T04:10:02Z"
}
```

**Signal Types**:
- `var`: Variable change signals (WatchCall)
- `user`: User messages (SendMessage)
- `watcher`: Internal Watcher signals

**Signal Priority**: `WatcherSig > UserSig > VarSig`

**Recent Signals**: Last 30 signals (peeked from queue)

---

### 4. Send Message

Sends a message to the running Watcher program.

**Endpoint**: `POST /watcher/message`

**Request Body**:
```json
{
  "content": "status"
}
```

**Response** (200 OK):
```json
{
  "status": "message sent"
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "message content cannot be empty"
}
```

**Message Handling**:
Messages are delivered to the `Manage()` function via `msg.Content`:

```go
watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
    if msg != nil && msg.Content != "" {
        switch msg.Content {
        case "status":
            fmt.Println("Status requested!")
        case "stop":
            fmt.Println("Stop requested!")
        }
    }
    return nil
}, "MyProgram")
```

**Use Cases**:
- Send commands to running programs
- Trigger status reports
- Request data exports
- Control program behavior

---

### 5. Get Watching Variables

Returns list of all watched variables (WatchCall).

**Endpoint**: `GET /watcher/watching`

**Response** (200 OK):
```json
{
  "watchedVars": [
    "stats_ticker",
    "btc_price",
    "eth_price",
    "rebalance_ticker"
  ],
  "count": 4,
  "timestamp": "2026-02-09T04:10:00Z"
}
```

**Notes**:
- Shows all variables registered with `WatchCall`
- Variables may not be initialized yet

---

### 6. Get Memo Cache

Returns all memoized computation results.

**Endpoint**: `GET /watcher/memoCache`

**Response** (200 OK):
```json
{
  "entries": {
    "fibonacci_10": 55,
    "expensive_calc_abc": {
      "result": 42,
      "metadata": "..."
    }
  },
  "count": 2,
  "timestamp": "2026-02-09T04:10:00Z"
}
```

**Notes**:
- Returns all cached `Memo()` results
- May be empty if no memoization used
- Useful for debugging cached computations

---

### 7. Get Variable State

Returns current values of all watched variables.

**Endpoint**: `GET /watcher/varState`

**Response** (200 OK):
```json
{
  "variables": {
    "btc_price": 71105.96,
    "eth_price": 2108.85,
    "rebalance_ticker": "2026-02-08T18:22:57.439940305Z",
    "stats_ticker": "2026-02-08T18:31:00.23511076Z"
  },
  "count": 4,
  "timestamp": "2026-02-09T04:10:00Z"
}
```

**Notes**:
- Only shows initialized variables
- Variables in `/watcher/watching` but not here are "Not Initialized"

---

### 8. Get Configuration

Returns Watcher configuration settings.

**Endpoint**: `GET /watcher/config`

**Response** (200 OK):
```json
{
  "config": {
    "serverPort": 8080,
    "signalChanCapacity": 50000,
    "maxLogEntries": 50000,
    "maxMemoEntries": 1000
  },
  "timestamp": "2026-02-09T04:10:00Z"
}
```

**Configuration Parameters**:
- `serverPort`: WatcherAPI server port (default: 8080)
- `signalChanCapacity`: Signal queue buffer size (default: 50000)
- `maxLogEntries`: Maximum log entries retained (default: 50000)
- `maxMemoEntries`: Maximum memo cache entries (default: 1000)

---

## Web UI Routes

Base URL: `http://localhost:9000/ui`

The Web UI provides visual management and monitoring interface.

### Routes

#### 1. Dashboard

**URL**: `/ui/programs`

**Description**: List all programs with status cards

**Features**:
- Create new program (modal)
- View program cards with state badges
- Quick actions: Start, Stop, Restart, Delete
- Navigate to program detail

---

#### 2. Program Detail

**URL**: `/ui/programs/{id}`

**Description**: Program details and lifecycle management

**Sections**:
- Program metadata (ID, state, user_id)
- Build information (build_id, image_id)
- Container information (container_id)
- Network & timestamps (proxy_url, created_at, updated_at)
- **Source Code** (collapsible, NEW)
  - File browser with syntax highlighting
  - Copy button for each file
- Error details (if error state)

**Actions**:
- Start program
- Stop program
- Restart program
- Delete program
- View Watcher Interface (button)

---

#### 3. Watcher Interface

**URL**: `/ui/programs/{id}/watcher`

**Description**: Real-time monitoring and control interface

**Tab Structure** (NEW - 2 tabs):

**Overview Tab**:
- Watcher Configuration (ConfigCard)
  - Server Port: 8080
  - Signal Chan Capacity: 50000
  - Max Log Entries: 50000
  - Max Memo Entries: 1000
- Watched Variables & State (IntegratedWatchingCard - NEW)
  - Table showing: Variable Name | Current Value | Status
  - Status: "✅ Initialized" or "⚠️ Not Initialized"
  - Real-time updates every 5 seconds
- Memo Cache (MemoCacheCard)
  - Key-value pairs with expandable JSON
- Command Panel
  - Text input for custom commands
  - Quick command buttons (Status, Portfolio, Trades, Prices)

**Signals & Logs Tab**:
- Signal Metrics (SignalCard)
  - VarSig, UserSig, WatcherSig counts
  - Recent Signals list (last 30)
  - Color-coded badges by type
- Docker Container Logs (DockerLogViewer)
  - Last 200 lines
  - Auto-scroll toggle (default: OFF - NEW)
  - Refresh button
- Watcher Internal Logs (LogViewer - collapsible)
  - Effect logs, Reduce logs, etc.

**Design Improvements** (NEW):
- Clear tab hover effects (background color change)
- Active tab with bottom border (2px primary color)
- Cursor pointer on tabs
- Improved visibility and clickability

---

## Error Responses

All APIs return consistent error format:

```json
{
  "error": "Error Type",
  "code": 404,
  "message": "Detailed error message"
}
```

**Common HTTP Status Codes**:
- `200 OK`: Success
- `201 Created`: Resource created
- `400 Bad Request`: Invalid request body/parameters
- `404 Not Found`: Resource not found
- `409 Conflict`: Invalid state transition
- `500 Internal Server Error`: Server error
- `503 Service Unavailable`: Service not ready

---

## Security Contracts

All deployed programs must adhere to these security contracts:

1. **Localhost-only Port Binding**: Containers bind to `127.0.0.1` only
2. **Read-only Rootfs**: Container filesystem is read-only except `/state`
3. **Port 8080 Restriction**: WatcherAPI accessible only via assigned PublishPort
4. **Network Isolation**: Containers use `bridge` network

**Port Range**: WatcherAPI proxied to `localhost:19001-29999`

---

## Architecture Overview

```
User → Host API:9000 → Program (state machine)
                       ↓
                Docker Container:8080 (WatcherAPI)
                       ↓
                localhost:19001-29999 (PublishPort)
```

**Three-Layer Architecture**:
- **hersh/**: Reactive framework (Reducer-Effect pattern, WatchCall, Memo)
- **program/**: Pure domain logic (state machine, no IO)
- **host/**: IO implementation (Docker SDK, filesystem, HTTP API)

---

## Rate Limits & Performance

**Host API**:
- No explicit rate limits
- Docker build timeout: 5 minutes
- Container start timeout: 30 seconds

**WatcherAPI**:
- Proxy timeout: 30 seconds
- Signal queue capacity: 50000 (configurable)
- Log retention: 50000 entries (configurable)

**Web UI**:
- Auto-refresh intervals:
  - Program list: 5 seconds
  - Program detail: 5 seconds
  - Watcher status: 2 seconds
  - Signals: 2 seconds
  - Container logs: 2 seconds

---

## Example Workflows

### Deploy and Monitor Program

```bash
# 1. Create program
curl -X POST http://localhost:9000/programs \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo-user",
    "dockerfile": "FROM golang:1.23...",
    "src_files": {
      "main.go": "package main...",
      "go.mod": "module example.com/app..."
    }
  }'

# Response: {"program_id": "demo-user-build-abc-123", ...}

# 2. Start program
curl -X POST http://localhost:9000/programs/demo-user-build-abc-123/start

# 3. Wait for Ready state (check every 2 seconds)
curl http://localhost:9000/programs/demo-user-build-abc-123

# 4. Access WatcherAPI
curl http://localhost:9000/programs/demo-user-build-abc-123/proxy/watcher/status

# 5. Send command
curl -X POST http://localhost:9000/programs/demo-user-build-abc-123/proxy/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content": "status"}'

# 6. View source code
curl http://localhost:9000/programs/demo-user-build-abc-123/source

# 7. Stop program
curl -X POST http://localhost:9000/programs/demo-user-build-abc-123/stop
```

---

## Changelog

### v1.0.0 (2026-02-09)

**New Features**:
- Added `GET /programs/{id}/source` - Source code retrieval
- Added WatcherAPI endpoints: `/watcher/watching`, `/watcher/memoCache`, `/watcher/varState`, `/watcher/config`
- Enhanced Web UI with 2-tab structure (Overview, Signals & Logs)
- Added IntegratedWatchingCard (watching + varState combined)
- Improved tab visibility with hover/active styles
- Added SourceCodeViewer component with file browser

**Breaking Changes**:
- None (backward compatible)

**Improvements**:
- DockerLogViewer auto-scroll default changed to OFF
- Tab structure simplified from 3 tabs to 2 tabs
- Enhanced signal metrics with recent signals list

---

## Support & Documentation

- **GitHub**: https://github.com/HershyOrg/hershy
- **Examples**: `/examples/trading-long`, `/examples/simple-counter`, `/examples/watcher-server`
- **Deployment Guide**: `/DEPLOYMENT_GUIDE.md`
- **Architecture**: `/CLAUDE.md`

---

**Last Updated**: 2026-02-09
**API Version**: 1.0.0
