# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hersh** is a reactive framework and container orchestration system for Go. The project consists of three main layers:

1. **hersh/** - Reactive framework library (Reducer-Effect pattern, WatchCall, Memo, WatcherAPI)
2. **program/** - Container manager (builds Dockerfile → runs gVisor container → proxies WatcherAPI)
3. **host/** - Thin registry (Program discovery, metadata storage only)

### Architecture

```
User Dockerfile → Program (build/run/proxy) → gVisor Container (hersh.Watcher + WatcherAPI:8080) ← Host Registry
```

**Program = Self-contained system**: Handles Dockerfile → Image → gVisor → WatcherServer proxy → API
**Host = Thin layer**: Program metadata registry only (조회/검색)

## Implementation Guide

Before implementation, you must create a plan and have it reviewed.

Implementation shall be carried out in a single Phase, and the Phase must be defined as As Is → To Be.

Break the Phase down step by step, create a plan, and then implement accordingly.

Follow Domain-Driven Design (DDD) principles and use granular, semantically meaningful types.

During implementation, you must validate the work by following the Verification Guide.

## Verification Guide

After implementation, run and verify all builds and tests within the package.

Confirm that the implementation matches the Phase's As Is and To Be defined in the plan.

Confirm that you did not "shortcut" by pretending to implement the To Be without actually doing so.

## Core Design Principles

### 1. Hersh Framework: Reducer-Effect Pattern

Hersh implements a **synchronous Reducer-Effect architecture** where all state transitions are deterministic and effects execute synchronously after state changes. This design ensures:

- **Deterministic execution**: No race conditions, predictable behavior
- **Synchronous flow**: Reducer → Commander → Handler (sequential, not concurrent)
- **Signal-based reactivity**: Priority-ordered signal processing (WatcherSig > UserSig > VarSig)
- **Fault tolerance**: Built-in recovery policies with exponential backoff

**Key Components**:
- `hersh.Watcher`: Core reactive engine (state management, lifecycle)
- `WatchCall`: Reactive variable monitoring (triggers on change)
- `Memo`: Expensive computation caching
- `WatcherAPI`: HTTP server (port 8080) for external control

### 2. Program: Domain-Driven Design

Program uses **interface-based dependency injection** with 4 domain layers:

- `builder.Builder`: Dockerfile → Image (Docker BuildKit)
- `runtime.Runtime`: Image → Container (gVisor runsc)
- `proxy.Proxy`: WatcherAPI HTTP proxy (container:8080 → host)
- `api.Server`: Program HTTP API (lifecycle, status, proxy endpoints)

**State Machine**: `Created → Building → Built → Starting → Running → Stopped`

**Mock implementations** enable testing without Docker/gVisor.

### 3. Responsibility Separation

**User provides**: Dockerfile + source code (using hersh library)
**Program manages**: Build → Run → Proxy → Expose API
**Host tracks**: Program metadata (name, version, endpoint, state)

## Package Structure

```
hersh/                  # Reactive framework library
├── watcher.go          # Core Watcher implementation
├── watcher_api.go      # HTTP API server (8080)
├── manager/            # Reducer-Effect implementation
├── hctx/               # HershContext (state management)
└── demo/               # Usage examples

program/                # Container manager
├── program.go          # Core orchestrator (324 lines)
├── builder/            # Image building domain
│   ├── model.go        # Builder interface
│   └── mock_builder.go # Mock implementation
├── runtime/            # Container runtime domain
│   ├── model.go        # Runtime interface
│   └── mock_runtime.go # Mock implementation
├── proxy/              # WatcherAPI proxy domain
│   ├── model.go        # Proxy interface
│   └── mock_proxy.go   # Mock implementation
├── api/                # Program API domain
│   ├── model.go        # Server/Handler interfaces
│   └── mock_server.go  # Mock implementation
└── examples/           # Usage examples
    ├── simple/         # Basic hersh.Watcher example
    └── demo_program.go # Program usage demo

host/                   # Program registry (future)
└── main.go             # Thin HTTP registry server
```

## Testing Strategy

1. **hersh**: 80+ unit tests (WatchCall, Memo, Lifecycle, Recovery)
2. **program**: Mock-based testing (no Docker/gVisor required)
3. **Integration**: Real Docker/gVisor (future phase)

Run tests: `cd <package> && go test ./... -v`

## Host-Program Integration

### Architecture Overview

The Host-Program architecture has evolved to a **2-layer localhost-only publish model**:

```
Client → Host API:9000 → localhost:19001-29999 → Container:8080 (WatcherAPI)
```

**Key Changes from Original Design**:
- **No ProxyServer layer**: Programs expose WatcherAPI directly on localhost
- **Host is thin registry**: Metadata only, no proxying logic
- **Localhost-only security**: All containers bind to 127.0.0.1 only
- **Sequential port allocation**: PublishPort range 19001-29999

### Deployment Workflow

**2-Step Process**:
1. `POST /programs` - Create program (State: Created)
2. `POST /programs/{id}/start` - Trigger build and start (State: Building → Ready)

**Important**: Creating a program does NOT automatically start it. You must explicitly call `/start`.

**See**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for detailed deployment instructions including:
- go.mod/go.sum generation
- Dockerfile requirements
- API request examples
- Common issues and solutions

### WatcherAPI Message System

Programs can receive and process messages via WatcherAPI's `/watcher/message` endpoint.

#### Sending Messages to Programs

**Endpoint**: `POST {proxy_url}/watcher/message`

**Request Format**:
```json
{
    "content": "your-command-here"
}
```

**Example** (using curl):
```bash
# Get program's proxy_url (e.g., http://localhost:19007)
curl http://localhost:9000/programs/{program_id}

# Send message to program
curl -X POST http://localhost:19007/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"status"}'
```

**Response**:
```json
{
    "status": "message sent"
}
```

#### Handling Messages in Your Program

Messages are delivered to your `Manage()` function via `msg.Content`:

```go
watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
    // Handle WatcherAPI messages
    if msg != nil && msg.Content != "" {
        switch msg.Content {
        case "status":
            fmt.Println("Status requested!")
            // Print status information
        case "stop":
            fmt.Println("Stop requested!")
            // Initiate graceful shutdown
        default:
            fmt.Printf("Unknown command: %s\n", msg.Content)
        }
    }

    return nil
}, "MyProgram")
```

#### Example: trading-long

The `trading-long` example demonstrates a full command handler:

```go
// In mainReducer (called by Manage)
if msg != nil && msg.Content != "" {
    commandHandler.HandleCommand(msg.Content)
}

// CommandHandler processes commands
func (ch *CommandHandler) HandleCommand(cmd string) {
    switch cmd {
    case "status", "s":
        ch.stats.PrintStatus(ch.bs, ch.ts)
    case "portfolio", "p":
        ch.stats.PrintPortfolio(ch.ts)
    case "trades", "t":
        ch.stats.PrintRecentTrades(ch.ts, 10)
    case "prices":
        ch.printPrices()
    // ... more commands
    }
}
```

**Sending commands to trading-long**:
```bash
# Request portfolio information
curl -X POST http://localhost:19007/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"portfolio"}'

# Check Docker logs for output
docker logs <container_id> --tail 30
```

**Output** (in Docker logs):
```
════════════════════════════════════════════════════════════════
💼 Portfolio Details
════════════════════════════════════════════════════════════════
Date         Symbol Type Price        Amount       Value      Reason
22:40:20     BTC    BUY  $   71252.01 0.001404 $     100.00 golden_cross
22:40:21     ETH    BUY  $    2078.50 0.048110 $     100.00 golden_cross
...
════════════════════════════════════════════════════════════════
```

#### Example: watcher-server

The `watcher-server` example demonstrates automatic and manual message handling:

```go
// Automatic: Send tick every second
ticker := time.NewTicker(1 * time.Second)
go func() {
    for range ticker.C {
        watcher.SendMessage("tick")
    }
}()

// Handle in Manage()
watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
    if msg.Content == "tick" {
        counter := ctx.GetValue("COUNTER").(int)
        counter++
        ctx.SetValue("COUNTER", counter)

        // Write to /state file
        os.WriteFile("/state/counter.txt", []byte(fmt.Sprintf("%d\n", counter)), 0644)

        log.Printf("📊 Counter: %d (state file updated)\n", counter)
    }
    return nil
}, "Counter")
```

**Manual tick**:
```bash
curl -X POST http://localhost:19008/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"tick"}'
```

### Security Contracts

All programs deployed to Host must adhere to these security contracts:

1. **Localhost-only Port Binding**: Containers bind to `127.0.0.1` only (verified via `docker inspect`)
2. **Read-only Rootfs**: Container filesystem is read-only except `/state` directory (enforced by runc)
3. **Port 8080 Restriction**: WatcherAPI port 8080 is only accessible via assigned PublishPort
4. **Network Isolation**: Containers use `bridge` network, isolated from each other

**Verification**: See [TEST_REPORT_PHASE7-11.md](./TEST_REPORT_PHASE7-11.md) for detailed security testing results.

### API Reference

#### Host API Endpoints

- `POST /programs` - Create program (returns program_id and proxy_url)
- `POST /programs/{id}/start` - Start program (triggers build if needed)
- `POST /programs/{id}/stop` - Stop running program
- `POST /programs/{id}/restart` - Restart running program
- `GET /programs/{id}` - Get program status
- `GET /programs` - List all programs
- `DELETE /programs/{id}` - Delete program

#### WatcherAPI Endpoints (via proxy_url)

- `GET {proxy_url}/watcher/status` - Get Watcher status
- `GET {proxy_url}/watcher/state` - Get Watcher state details
- `GET {proxy_url}/watcher/vars` - Get environment variables
- `POST {proxy_url}/watcher/message` - Send message to program

**See**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for complete API reference with request/response examples.

### Example Programs

- **simple-counter**: [examples/simple-counter/](./examples/simple-counter/) - Basic counter with WatcherAPI
- **trading-long**: [examples/trading-long/](./examples/trading-long/) - Trading simulator with command handling
- **watcher-server**: [examples/watcher-server/](./examples/watcher-server/) - Minimal WatcherAPI server with state persistence

Each example includes:
- Complete source code
- Dockerfile
- go.mod/go.sum
- Deployment instructions

### Testing and Verification

**Test Reports**:
- [TEST_REPORT_PHASE4-6.md](./TEST_REPORT_PHASE4-6.md) - Initial integration testing
- [TEST_REPORT_PHASE7-11.md](./TEST_REPORT_PHASE7-11.md) - Comprehensive testing with WatcherAPI messages

**Key Test Results**:
- ✅ 20/20 test cases passed (100% coverage)
- ✅ 6 concurrent programs stable
- ✅ WatcherAPI message system validated
- ✅ All security contracts enforced
- ✅ Lifecycle management working (stop/start/restart)

**Production Readiness**: ✅ **READY**
