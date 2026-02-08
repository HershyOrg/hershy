# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hersh** is a reactive framework and container orchestration system for Go. The project consists of three main layers:

1. **hersh/** - Reactive framework library (Reducer-Effect pattern, WatchCall, Memo, WatcherAPI)
2. **program/** - Program domain layer (pure state machine logic using Reducer-Effect pattern)
3. **host/** - Host components (IO layer: Docker runtime, storage, HTTP API server)

### Architecture

```
User Dockerfile → Host API:9000 → Program (state machine) → Docker/gVisor Container → WatcherAPI:8080
                                                              ↓
                                                    localhost:19001-29999 (PublishPort)
```

**Three-Layer Architecture**:

- **hersh/** = Reactive framework (library users import)
- **program/** = Pure domain logic (state transitions, no IO)
- **host/** = IO implementation (Docker SDK, filesystem, HTTP server)

## Common Commands

### Running Tests

```bash
# Hersh framework tests (80+ tests)
cd hersh && go test ./... -v
cd hersh && go test ./... -race  # with race detector
cd hersh && go test ./... -cover # with coverage

# Program domain tests (28+ tests, no Docker required)
cd program && go test ./... -v
cd program && go test ./... -race -cover

# Host integration tests (requires Docker)
cd host && go test ./... -v
cd host && go test -tags=integration ./... -v

# Run single test
cd hersh && go test -run TestWatchCall_BasicFunctionality -v
cd program && go test -run TestReducer_FullSuccessFlow -v
```

### Running Examples

```bash
# Simple counter example
cd hersh/demo && go run example_simple.go

# WatchCall reactive variable example
cd hersh/demo && go run example_watchcall.go

# Trading simulation (requires binance stream)
cd hersh/demo && go run example_trading.go market_client.go

# Run with timeout (recommended for long-running demos)
timeout 15 go run hersh/demo/example_simple.go
timeout 15 go run hersh/demo/example_watchcall.go
timeout 10 go run hersh/demo/example_trading.go hersh/demo/market_client.go
```

### Running Host Server

```bash
# Start Host server (default: port 9000, runc runtime)
cd host && go run cmd/main.go

# With custom configuration
cd host && go run cmd/main.go -port 9000 -storage ./host-storage -runtime runc

# With gVisor runtime (requires runsc installed)
cd host && go run cmd/main.go -runtime runsc
```

### End-to-End Testing

```bash
# Run all example programs E2E test (requires Host running)
./cmd/test_examples_e2e.sh

# Test lifecycle management
./cmd/test-lifecycle.sh

# Test security contracts
./cmd/test-security-contracts.sh

# Test system stability (6 concurrent programs)
./cmd/test-system-stability.sh

# Test WatcherAPI message system
./cmd/test-watcher-api.sh
```

### Building and Deployment

```bash
# Build Host server binary
cd host && go build -o host-server cmd/main.go

# Run built binary
./host/host-server -port 9000

# Deploy example programs (requires Host running on :9000)
cd examples/simple-counter && ./deploy-to-host.sh
cd examples/trading-long && ./e2e_test.sh
```

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

### Reducer-Effect Pattern (Both Hersh & Program)

Both **hersh/** and **program/** implement the Reducer-Effect pattern:

- **Pure Reducers**: State transitions are pure functions (no side effects)
- **Effect Declarations**: Reducers return effects to be executed
- **Effect Handlers**: Separate IO layer executes effects (dependency injection)
- **Event Loop**: Goroutine-based event processing (supervisor pattern)

**Benefits**:

- Deterministic: No race conditions, predictable state transitions
- Testable: Pure reducers + mock effect handlers = fast unit tests
- Observable: All state changes are explicit and traceable
- Recoverable: Built-in fault tolerance with retry policies

### Domain-Driven Design (DDD)

**Separation of Concerns**:

- **Domain Layer** (program/): Pure business logic, state machine
- **Infrastructure Layer** (host/): IO operations (Docker, filesystem, HTTP)
- **Application Layer** (hersh/): Framework library for user programs

**Interface-Based Design**:

- `EffectHandler` interface enables mock testing
- Dependency injection at component boundaries
- Clear contracts between layers

### Deployment Model

**2-Step Deployment Process**:

1. `POST /programs` - Create program (returns program_id, proxy_url)
2. `POST /programs/{id}/start` - Trigger build and start

**Important**: Creating a program does NOT automatically start it.

**See**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for complete deployment instructions.

## Package Structure

### Core Packages

```
hersh/                      # Reactive framework library
├── watcher.go              # Core Watcher (state management, lifecycle)
├── watcher_api.go          # HTTP API server (port 8080)
├── watch.go                # WatchCall reactive variables
├── memo.go                 # Memo caching mechanism
├── types.go                # Core types (WatcherConfig, Message, etc)
├── manager/                # Reducer-Effect implementation
│   ├── manager.go          # Manager orchestrator
│   ├── reducer.go          # Pure state transition logic
│   ├── effect.go           # Effect definitions
│   ├── effect_handler.go   # Effect execution interface
│   ├── signal.go           # Signal-based reactivity
│   └── state.go            # State management
├── hctx/                   # HershContext (key-value state)
│   └── context.go
├── api/                    # WatcherAPI HTTP handlers
│   ├── types.go            # Request/response types
│   └── handlers.go         # HTTP endpoints
├── demo/                   # Usage examples
│   ├── example_simple.go   # Basic Watcher example
│   ├── example_watchcall.go # WatchCall example
│   ├── example_trading.go  # Trading simulator example
│   └── market_client.go    # Market data client
└── test/                   # Integration tests
    ├── concurrent_watch_test.go
    ├── recovery_test.go
    └── manager_integration_test.go

program/                    # Program domain (pure state machine)
├── types.go                # ProgramID, State, ProgramState
├── event.go                # User and system events
├── effect.go               # Side effects (build, start, stop)
├── reducer.go              # Pure state transitions
├── supervisor.go           # Event loop goroutine
├── effect_handler.go       # Effect execution interface
└── fake_handler.go         # Test implementation (mock)

host/                       # Host components (IO layer)
├── cmd/
│   └── main.go             # Host server entrypoint
├── api/                    # HTTP API server
│   ├── server.go           # Main HTTP server
│   ├── handlers.go         # REST endpoints
│   └── types.go            # Request/response types
├── registry/               # Program registry (in-memory)
│   └── registry.go
├── proxy/                  # WatcherAPI proxy manager
│   └── proxy.go
├── storage/                # Filesystem management
│   └── manager.go          # Program storage (src/, logs/, state/)
├── compose/                # Docker Compose spec generation
│   └── builder.go          # ComposeSpec with security contracts
├── runtime/                # Docker runtime integration
│   └── docker_manager.go   # Docker SDK wrapper
└── effect_handler.go       # Real IO implementation

examples/                   # Example programs for deployment
├── simple-counter/         # Basic counter with WatcherAPI
│   ├── main.go
│   ├── Dockerfile
│   ├── go.mod, go.sum
│   └── deploy-to-host.sh
├── trading-long/           # Trading simulator with commands
│   ├── main.go
│   ├── binance_stream.go
│   ├── commands.go
│   ├── stats.go
│   ├── trading_sim.go
│   ├── Dockerfile
│   ├── go.mod, go.sum
│   └── e2e_test.sh
└── watcher-server/         # Minimal WatcherAPI server
    ├── main.go
    ├── Dockerfile
    └── go.mod, go.sum

cmd/                        # Test scripts
├── test_examples_e2e.sh    # E2E test for all examples
├── test-lifecycle.sh       # Lifecycle management test
├── test-security-contracts.sh # Security validation
├── test-system-stability.sh   # Concurrent programs test
└── test-watcher-api.sh     # WatcherAPI message test
```

## High-Level Architecture

### 1. Hersh Framework: Reducer-Effect Pattern

**Core Concept**: Synchronous, deterministic state management with reactive variables.

**Key Components**:
- **Watcher**: Main reactive engine (manages state, lifecycle, WatchCall, Memo)
- **Manager**: Implements Reducer-Effect pattern (Reducer → Effect → Handler)
- **WatchCall**: Reactive variables that trigger callbacks on change
- **Memo**: Caching mechanism for expensive computations
- **WatcherAPI**: HTTP server on port 8080 for external control

**Signal Processing Priority**: `WatcherSig > UserSig > VarSig`

**State Lifecycle**: `NotRun → InitRun → Ready → Stopping → Stopped`

**Example**:
```go
watcher := hersh.NewWatcher(config, envVars, nil)

// WatchCall: reactive variable
counter := hersh.NewWatchCall(0)
counter.Watch(func(newVal int) {
    fmt.Printf("Counter changed: %d\n", newVal)
})

// Start Watcher
watcher.Run()

// Manage function: main reducer
watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
    // Handle WatcherAPI messages
    if msg != nil && msg.Content == "increment" {
        counter.Set(counter.Get() + 1)
    }
    return nil
}, "MyProgram")

// Start WatcherAPI server
watcher.StartAPIServer(8080)
```

### 2. Program Domain: Pure State Machine

**Core Concept**: Domain-Driven Design with pure state transitions, no IO.

**State Machine**: `Created → Building → Starting → Ready → Stopping → Stopped → Error`

**Event → Reducer → Effect Flow**:
1. User sends event (e.g., `UserStartRequested`)
2. Reducer computes new state + effects (pure function)
3. Supervisor executes effects via EffectHandler
4. System events feed back (e.g., `BuildFinished`)

**Key Files**:
- `types.go`: ProgramID, BuildID, State, ProgramState
- `event.go`: UserEvent (Start/Stop/Restart), SystemEvent (BuildFinished, RuntimeStarted)
- `effect.go`: EnsureFolders, BuildRuntime, StartRuntime, StopRuntime
- `reducer.go`: Pure state transition logic (300+ lines)
- `supervisor.go`: Event loop goroutine (channels + select)
- `effect_handler.go`: Interface for IO operations

**Testing**: 28+ tests, 100% mock-based (no Docker required).

**Example**:
```go
handler := program.NewFakeEffectHandler()
prog := program.NewProgram(programID, buildID, handler)
prog.Start(ctx)

// Send user event
prog.SendEvent(program.UserStartRequested{ProgramID: id})

// Query state (thread-safe)
state := prog.GetState()
fmt.Printf("State: %s\n", state.State) // "Building"
```

### 3. Host Components: IO Layer

**Core Concept**: Real-world IO operations (Docker, filesystem, HTTP API).

**Components**:
- **API Server**: HTTP REST API on port 9000 (handlers.go, server.go)
- **Registry**: In-memory program registry (thread-safe map)
- **ProxyManager**: Manages WatcherAPI proxies (localhost:19001-29999)
- **StorageManager**: Filesystem operations (program folders, logs, state)
- **ComposeBuilder**: Docker Compose spec generation with security contracts
- **DockerManager**: Docker SDK wrapper (build, start, stop, inspect)
- **RealEffectHandler**: Implements EffectHandler using real components

**Security Contracts** (enforced by ComposeBuilder):
1. Localhost-only port binding (`127.0.0.1:19001-29999`)
2. Read-only rootfs (except `/state`)
3. Port 8080 restriction (WatcherAPI only)
4. Network isolation (`bridge` mode)

**API Endpoints**:
- `POST /programs` - Create program
- `POST /programs/{id}/start` - Start program
- `POST /programs/{id}/stop` - Stop program
- `POST /programs/{id}/restart` - Restart program
- `GET /programs/{id}` - Get program status
- `GET /programs` - List all programs
- `DELETE /programs/{id}` - Delete program

**WatcherAPI Proxy**:
- `GET {proxy_url}/watcher/status` - Watcher status
- `GET {proxy_url}/watcher/state` - Watcher state details
- `GET {proxy_url}/watcher/vars` - Environment variables
- `POST {proxy_url}/watcher/message` - Send message to program

## Testing Strategy

### Unit Tests (Fast, No Docker)

**Hersh Framework** (80+ tests):
- `watcher_test.go`: Lifecycle, context cancellation
- `test/concurrent_watch_test.go`: Concurrent WatchCall
- `test/recovery_test.go`: Fault tolerance and recovery
- `test/manager_integration_test.go`: Manager integration
- `manager/reducer_test.go`: Reducer state transitions
- `manager/effect_test.go`: Effect handling

**Program Domain** (28+ tests):
- `reducer_test.go`: State machine transitions (19 tests)
- `supervisor_test.go`: Event loop and lifecycle (9 tests)
- All tests use `FakeEffectHandler` (no Docker)

**Host Components** (6+ tests):
- `compose/builder_test.go`: ComposeSpec generation
- `api/server_test.go`: HTTP API handlers
- `registry/registry_test.go`: Registry operations
- `proxy/proxy_test.go`: Proxy management

### Integration Tests (Requires Docker)

**Host Integration** (`host/host_test.go`, `host/integration_test.go`):
- Real Docker builds and container lifecycle
- Security contract validation
- End-to-end program deployment

### End-to-End Tests (Bash Scripts)

**E2E Test Suite** (`cmd/` directory):
- `test_examples_e2e.sh`: Deploy all examples, verify lifecycle
- `test-lifecycle.sh`: Start/stop/restart operations
- `test-security-contracts.sh`: Port binding, rootfs, isolation
- `test-system-stability.sh`: 6 concurrent programs
- `test-watcher-api.sh`: Message handling validation

**Example Deployment Tests** (`examples/` directory):
- `simple-counter/deploy-to-host.sh`: Basic deployment
- `trading-long/e2e_test.sh`: Complex program with commands
- `watcher-server/`: Minimal WatcherAPI server

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
