# Host-Program Deployment Guide

**Version**: 1.0
**Date**: 2026-02-07
**Target**: Developers deploying Hersh programs to Host server

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Deployment Workflow](#deployment-workflow)
3. [Example: Deploying trading-long](#example-deploying-trading-long)
4. [Common Issues and Solutions](#common-issues-and-solutions)
5. [API Reference](#api-reference)

---

## Prerequisites

### Host Server

- Host server running on `localhost:9000` (or configured address)
- Docker runtime available (runc or gVisor)
- Port range `19001-29999` available for program publishing

### Your Program

- Dockerfile that:
  - Uses multi-stage build (builder + runtime)
  - Copies `go.mod` and `go.sum`
  - Exposes port `8080` for WatcherAPI
  - Uses Hersh framework `github.com/HershyOrg/hershy/hersh`
- Go source files using Hersh framework
- Complete `go.mod` and `go.sum` files

---

## Deployment Workflow

### Step 1: Prepare go.mod and go.sum

**Create go.mod**:

```bash
cat > go.mod << 'EOF'
module your-program-name

go 1.24.13

require (
    github.com/HershyOrg/hershy/hersh v0.1.3
    # Add other dependencies here
)
EOF
```

**Generate complete go.sum**:

```bash
# Download dependencies
go mod download

# Build locally to populate go.sum with hashes
go get your-program-name

# Verify go.sum contains h1 hashes
cat go.sum
# Should show lines like:
# github.com/HershyOrg/hershy/hersh v0.1.3 h1:leugIvj969WHuzqrmfRnQTUXC0j4i3GTcJWsusJ5F00=
# github.com/HershyOrg/hershy/hersh v0.1.3/go.mod h1:0TEZ5QOq4+hzWAd/hNbpNbG5EUIgiT0bpwEi98va8A0=
```

**Important**: `go.sum` must include both `.mod` and `h1:` hash lines for all dependencies.

### Step 2: Verify Dockerfile

**Required Dockerfile structure**:

```dockerfile
FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# ⭐ CRITICAL: Copy go.mod AND go.sum
COPY go.mod go.sum ./
COPY *.go ./

# Download dependencies from Go proxy
RUN go mod download

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o your-program .

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /build/your-program /app/

# Create /state directory (writable in read-only rootfs)
RUN mkdir -p /state

# WatcherAPI port
EXPOSE 8080

CMD ["/app/your-program"]
```

**Common mistake**: Forgetting to `COPY go.sum` will cause build failures:

```
missing go.sum entry for module providing package ...
```

### Step 3: Deploy to Host

**API Endpoint**: `POST http://localhost:9000/programs`

**Request Format**:

```json
{
    "user_id": "your-user-id",
    "dockerfile": "<dockerfile contents>",
    "src_files": {
        "main.go": "<main.go contents>",
        "go.mod": "<go.mod contents>",
        "go.sum": "<go.sum contents>",
        "other.go": "<other.go contents>"
    }
}
```

**Python Example**:

```python
import requests

HOST = "http://localhost:9000"

# Read all files
with open("Dockerfile") as f:
    dockerfile = f.read()
with open("main.go") as f:
    main = f.read()
with open("go.mod") as f:
    gomod = f.read()
with open("go.sum") as f:
    gosum = f.read()

# Create payload
payload = {
    "user_id": "my-user",
    "dockerfile": dockerfile,
    "src_files": {
        "main.go": main,
        "go.mod": gomod,
        "go.sum": gosum
    }
}

# Deploy
response = requests.post(f"{HOST}/programs", json=payload)
result = response.json()

print(f"Program ID: {result['program_id']}")
print(f"State: {result['state']}")  # Created
print(f"Proxy URL: {result['proxy_url']}")  # http://localhost:19XXX
```

**Response** (HTTP 201 Created):

```json
{
    "program_id": "my-user-build-abc123-def456",
    "build_id": "build-abc123",
    "state": "Created",
    "proxy_url": "http://localhost:19005",
    "created_at": "2026-02-07T07:30:00Z"
}
```

### Step 4: Start the Program

**Important**: Creating a program only registers it. You must explicitly start it.

**API Endpoint**: `POST http://localhost:9000/programs/{program_id}/start`

**Python Example**:

```python
program_id = result["program_id"]

# Start the program
response = requests.post(f"{HOST}/programs/{program_id}/start")
print(response.json())  # {"program_id": "...", "state": "Created", "message": "program start initiated"}
```

**State Transitions**:

```
Created → Building → Built → Starting → Running → Ready
```

### Step 5: Monitor Build Progress

**API Endpoint**: `GET http://localhost:9000/programs/{program_id}`

**Python Example**:

```python
import time

# Poll for Ready state
for i in range(60):
    time.sleep(2)
    prog = requests.get(f"{HOST}/programs/{program_id}").json()
    state = prog["state"]

    if state == "Ready":
        print(f"✅ Program Ready!")
        print(f"   Container: {prog['container_id']}")
        print(f"   Proxy URL: {prog['proxy_url']}")
        break
    elif state == "Error":
        print(f"❌ Build failed")
        break
    else:
        print(f"[{i*2}s] State: {state}")
```

### Step 6: Access WatcherAPI

Once the program reaches `Ready` state, access it via the assigned `proxy_url`:

**Direct Access**:

```bash
# Get status
curl http://localhost:19005/watcher/status

# Get state
curl http://localhost:19005/watcher/state

# Send message
curl -X POST http://localhost:19005/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"your-command"}'
```

**Via Host Proxy** (alternative):

```bash
curl http://localhost:9000/programs/{program_id}/proxy/watcher/status
```

---

## Example: Deploying trading-long

This is a **real deployment scenario** from our testing.

### Problem Encountered

Initial deployment failed with:

```
missing go.sum entry for module providing package github.com/gorilla/websocket
```

### Root Cause

The `go.sum` file was incomplete. It only had:

```
github.com/HershyOrg/hershy/hersh v0.1.3/go.mod h1:...
```

But was missing the `h1:` hash line and the transitive dependency `gorilla/websocket`.

### Solution Steps

**1. Fix go.mod**:

```bash
cd /home/user/hersh/examples/trading-long

cat > go.mod << 'EOF'
module trading-long

go 1.24.13

require (
    github.com/HershyOrg/hershy/hersh v0.1.3
    github.com/gorilla/websocket v1.5.3
)
EOF
```

**2. Generate complete go.sum**:

```bash
# Remove incomplete go.sum
rm go.sum

# Download dependencies
go mod download

# Trigger hash generation
go get trading-long

# Verify completeness
cat go.sum
```

**Expected output**:

```
github.com/HershyOrg/hershy/hersh v0.1.3 h1:leugIvj969WHuzqrmfRnQTUXC0j4i3GTcJWsusJ5F00=
github.com/HershyOrg/hershy/hersh v0.1.3/go.mod h1:0TEZ5QOq4+hzWAd/hNbpNbG5EUIgiT0bpwEi98va8A0=
github.com/gorilla/websocket v1.5.3 h1:saDtZ6Pbx/0u+bgYQ3q96pZgCzfhKXGPqt7kZ72aNNg=
github.com/gorilla/websocket v1.5.3/go.mod h1:YR8l580nyteQvAITg2hZ9XVh4b55+EU/adAjf1fMHhE=
```

**3. Fix Dockerfile**:

```dockerfile
# Before (WRONG - missing go.sum):
COPY go.mod ./
COPY *.go ./

# After (CORRECT - includes go.sum):
COPY go.mod go.sum ./
COPY *.go ./
```

**4. Verify local build**:

```bash
go build -o trading-sim .
# Should build successfully
```

**5. Deploy to Host**:

```python
import requests
import time

HOST = "http://localhost:9000"

# Read all necessary files
files = {
    "Dockerfile": open("Dockerfile").read(),
    "main.go": open("main.go").read(),
    "go.mod": open("go.mod").read(),
    "go.sum": open("go.sum").read(),
    "commands.go": open("commands.go").read(),
    "binance_stream.go": open("binance_stream.go").read(),
    "stats.go": open("stats.go").read(),
    "trading_sim.go": open("trading_sim.go").read()
}

# Deploy
payload = {
    "user_id": "trading-user",
    "dockerfile": files["Dockerfile"],
    "src_files": {k: v for k, v in files.items() if k != "Dockerfile"}
}

response = requests.post(f"{HOST}/programs", json=payload)
program_id = response.json()["program_id"]
print(f"Created: {program_id}")

# Start
requests.post(f"{HOST}/programs/{program_id}/start")
print("Started, monitoring build...")

# Monitor
for i in range(90):
    time.sleep(2)
    prog = requests.get(f"{HOST}/programs/{program_id}").json()
    state = prog["state"]

    if state == "Ready":
        print(f"\n✅ READY!")
        print(f"   Container: {prog['container_id']}")
        print(f"   Proxy: {prog['proxy_url']}")
        break
    elif state == "Error":
        print(f"\n❌ Build FAILED")
        break
    elif i % 10 == 0:
        print(f"   [{i*2}s] {state}")
```

**6. Test WatcherAPI Message**:

```bash
# trading-long supports commands via WatcherAPI
curl -X POST http://localhost:19007/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"status"}'

# Check Docker logs for output
docker logs <container_id> --tail 20
```

**Output** (in Docker logs):

```
────────────────────────────────────────────────────────────────
📊 Quick Status Summary
────────────────────────────────────────────────────────────────
💼 Portfolio Value: $10,245.67 (+2.46%)
📈 Total Trades: 142
💰 BTC: $71,250.00 | ETH: $2,078.50
🌐 WebSocket: Connected (15,234 messages)
────────────────────────────────────────────────────────────────
```

### Deployment Result

- ✅ Build time: ~40 seconds (layers cached after first build)
- ✅ Program reached Ready state
- ✅ WatcherAPI accessible on `localhost:19007`
- ✅ All commands working: status, portfolio, trades, prices, help

---

## Common Issues and Solutions

### Issue 1: "missing go.sum entry"

**Symptom**:

```
main.go:16:2: missing go.sum entry for module providing package ...
```

**Solution**:

1. Run `go get your-module-name` to populate go.sum
2. Verify go.sum contains both `.mod` and `h1:` lines
3. Ensure Dockerfile copies go.sum: `COPY go.mod go.sum ./`

### Issue 2: "dockerfile is required"

**Symptom**:

```json
{"error":"Bad Request","code":400,"message":"dockerfile is required"}
```

**Solution**:
Check your JSON payload has the correct key: `"dockerfile"` (lowercase), not `"Dockerfile"`.

### Issue 3: Program stuck in "Building" state

**Symptom**:
Program remains in "Building" for >2 minutes.

**Solution**:

1. Check Host server logs: `tail -f /path/to/host-server.log`
2. Look for Docker build errors
3. Common causes:
   - Network issues downloading Go modules
   - Missing dependencies in go.mod
   - Dockerfile syntax errors

### Issue 4: Container exits immediately after starting

**Symptom**:
Program reaches "Ready" but WatcherAPI is not accessible.

**Solution**:

1. Check container logs: `docker logs <container_id>`
2. Common causes:
   - Program crashes on startup
   - WatcherAPI not started (missing `watcher.StartAPIServer()`)
   - Port 8080 not exposed in Dockerfile

### Issue 5: "program not running" on restart

**Symptom**:

```json
{"error":"Not Found","code":404,"message":"program not running"}
```

**Solution**:
Use `/programs/{id}/start` instead of `/programs/{id}/restart` when program is in `Stopped` state.

**Lifecycle Commands**:

- `Stopped` state → use `/start`
- `Running/Ready` state → use `/restart` or `/stop` then `/start`

---

## API Reference

### POST /programs

Create a new program (does NOT start it).

**Request**:

```json
{
    "user_id": "string (required)",
    "dockerfile": "string (required)",
    "src_files": {
        "filename": "content",
        ...
    }
}
```

**Response** (201 Created):

```json
{
    "program_id": "user-build-hash-uuid",
    "build_id": "build-hash",
    "state": "Created",
    "proxy_url": "http://localhost:19XXX",
    "created_at": "timestamp"
}
```

### POST /programs//start

Start a program (triggers build if needed).

**Response** (200 OK):

```json
{
    "program_id": "...",
    "state": "Created",
    "message": "program start initiated"
}
```

**State transitions**: `Created` → `Building` → `Built` → `Starting` → `Running` → `Ready`

### GET /programs/

Get program status.

**Response** (200 OK):

```json
{
    "program_id": "...",
    "build_id": "...",
    "user_id": "...",
    "state": "Ready",
    "image_id": "sha256:...",
    "container_id": "...",
    "proxy_url": "http://localhost:19XXX",
    "created_at": "...",
    "updated_at": "..."
}
```

### GET /programs

List all programs.

**Response** (200 OK):

```json
{
    "programs": [...],
    "count": 6
}
```

### POST /programs//stop

Stop a running program.

**Response** (200 OK):

```json
{
    "program_id": "...",
    "state": "Stopping",
    "message": "program stop initiated"
}
```

### POST /programs//restart

Restart a running program.

**Response** (200 OK):

```json
{
    "program_id": "...",
    "state": "...",
    "message": "program restart initiated"
}
```

**Note**: Only works if program is currently running. Use `/start` for stopped programs.

### DELETE /programs/

Delete a program (stops container and removes from registry).

**Response** (200 OK):

```json
{
    "message": "program deleted successfully"
}
```

### WatcherAPI Endpoints

All WatcherAPI endpoints are accessible via `proxy_url`:

**GET {proxy_url}/watcher/status**

```json
{
    "state": "Ready",
    "isRunning": true,
    "watcherID": "...",
    "uptime": "5m30s",
    "lastUpdate": "2026-02-07T..."
}
```

**GET {proxy_url}/watcher/state**

```json
{
    "currentState": "Ready",
    "previousState": "InitRun",
    ...
}
```

**POST {proxy_url}/watcher/message**

Send a message to the program:

```bash
curl -X POST {proxy_url}/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"your-command"}'
```

**Response**:

```json
{
    "status": "message sent"
}
```

The program receives the message in its `Manage()` function via `msg.Content`.

---

## Security Contracts

All programs deployed to Host follow these security contracts:

### 1. Localhost-only Port Binding

- Containers bind port 8080 to `127.0.0.1:19001-29999` ONLY
- No external network exposure
- Accessible only from localhost or via Host API proxy

### 2. Read-only Rootfs

- Container filesystem is read-only (enforced by runc)
- Only `/state` directory is writable
- Prevents container escape via file system manipulation

### 3. Network Isolation

- Containers use `bridge` network mode
- Isolated from each other
- No container-to-container communication

### 4. Port 8080 Restriction

- Port 8080 is used exclusively for WatcherAPI
- Not directly accessible from outside container
- Only accessible via assigned PublishPort (19001-29999)

---

## Best Practices

1. **Always test local build first**: `go build .` should succeed before deploying
2. **Use multi-stage Dockerfile**: Reduces final image size and attack surface
3. **Include go.sum in Dockerfile**: `COPY go.mod go.sum ./`
4. **Create /state directory**: For persistent data in read-only containers
5. **Expose port 8080**: Required for WatcherAPI
6. **Start WatcherAPI server**: Call `watcher.StartAPIServer()` in main()
7. **Handle messages in Manage()**: Check `msg.Content` and handle commands
8. **Use graceful shutdown**: Handle SIGTERM/SIGINT for clean stops
9. **Monitor build logs**: Check Host server logs for build errors
10. **Test WatcherAPI after deployment**: Verify endpoints work before production use

---

## Next Steps

- Read [CLAUDE.md](./CLAUDE.md) for project architecture details
- Read [TEST_REPORT_PHASE7-11.md](./TEST_REPORT_PHASE7-11.md) for test results
- Check [examples/](./examples/) for reference implementations:
  - `simple-counter`: Basic counter with WatcherAPI
  - `trading-long`: Complex trading simulator with commands
  - `watcher-server`: Minimal WatcherAPI server

---

**Document Version**: 1.0
**Last Updated**: 2026-02-07
**Feedback**: Open an issue or PR on GitHub
