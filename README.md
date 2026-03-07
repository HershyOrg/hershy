# Hershy

**Container orchestration system for Go using reactive state management**

Hershy is a container orchestration system that manages Docker/gVisor containers using the **[Hersh](https://github.com/HershyOrg/hersh)** reactive framework.

## 🏗️ Architecture

```
User Dockerfile → Host API:9000 → Program (state machine) → Docker/gVisor Container → WatcherAPI:8080
                                                              ↓
                                                    localhost:19001-29999 (PublishPort)
```

### Main Components

### 1. **[Hersh Framework](https://github.com/HershyOrg/hersh)** (External Library)
- **Repository**: `github.com/HershyOrg/hersh@v0.2.0`
- **Managed Execution**: Single managed function with reactive triggers
- **WatchCall**: Polling-based reactive variables
- **WatchFlow**: Channel-based reactive variables
- **Memo**: Session-scoped caching
- **HershContext**: Persistent state storage
- **WatcherAPI**: HTTP server for external control (port 8080)

### 2. **program/** - Program Domain (Pure State Machine)
- Pure state transitions (no IO)
- State machine: `Created → Building → Starting → Ready → Stopping → Stopped`
- Reducer-Effect pattern
- 28+ tests, 100% mock-based

### 3. **host/** - Host Components (IO Layer)
- Docker runtime integration
- Filesystem management
- HTTP API server (port 9000)
- WatcherAPI proxy manager

## ✨ Key Features

### Security-First Design
- **gVisor runtime enforced**: All containers run with gVisor (`runsc`) by default
- **Read-only root filesystem**: Containers cannot modify system files
- **Isolated state directory**: `/state` is the only writable volume
- **No external port exposure**: `:8080` is never published externally
- **Reverse proxy only**: All access via Host proxy

### Reducer-Effect Pattern
- **Deterministic execution**: No race conditions, predictable behavior
- **Synchronous flow**: Reducer → Effect → Event (sequential, not concurrent)
- **Signal-based reactivity**: Priority-ordered signal processing
- **Fault tolerance**: Built-in recovery with exponential backoff

### Domain-Driven Design
- **Program domain**: Pure state transitions (reducer.go)
- **Host components**: Real-world IO operations (Docker, filesystem)
- **Interface-based**: Easy testing with mock implementations
- **State machine**: `Created → Building → Starting → Ready → Stopping → Stopped`

## 📦 Project Structure

```
hershy/
├── program/                    # Program Domain (Pure State Machine)
│   ├── types.go               # ProgramID, State, ProgramState
│   ├── event.go               # User and system events
│   ├── effect.go              # Side effects to be executed
│   ├── reducer.go             # Pure state transition logic
│   ├── supervisor.go          # Goroutine-based event loop
│   ├── effect_handler.go      # Effect execution interface
│   └── fake_handler.go        # Test implementation (mock)
│
├── host/                       # Host Components (IO Layer)
│   ├── cmd/main.go            # Host server entrypoint
│   ├── api/                   # HTTP API server (port 9000)
│   ├── registry/              # Program registry (in-memory)
│   ├── proxy/                 # WatcherAPI proxy manager
│   ├── storage/               # Filesystem management
│   ├── compose/               # Docker Compose spec generation
│   ├── runtime/               # Docker runtime integration
│   └── effect_handler.go      # Real IO implementation
│
└── examples/                   # Example programs (use Hersh framework)
    ├── simple-counter/         # Basic counter with WatcherAPI
    ├── trading-long/           # Trading simulator
    └── watcher-server/         # Minimal WatcherAPI server
```

## ACP Integration

ACP seller integration is available at `acp-agent/`.

- Uses `@virtuals-protocol/acp-node` to run a Seller agent
- Provisions Hershy program instances via Host API (`/programs`, `/start`, `/status`)
- Includes offering schemas and buyer smoke script

See `acp-agent/README.md` for setup and execution.

**Note**: Hersh framework is now a separate library at [github.com/HershyOrg/hersh](https://github.com/HershyOrg/hersh)

## 🚀 Quick Start

### Prerequisites
- Go 1.24+
- Docker 20.10+
- gVisor (runsc) - optional for testing, required for production

### Installing Hersh

User programs require the Hersh framework:

```bash
go get github.com/HershyOrg/hersh@v0.2.0
```

See [Hersh documentation](https://github.com/HershyOrg/hersh) for complete API reference, examples, and usage guides.

### Run Tests

```bash
# Program domain tests (28+ tests, no Docker required)
cd program && go test ./... -v
cd program && go test ./... -race -cover

# Host integration tests (requires Docker)
cd host && go test ./... -v
cd host && go test -tags=integration ./... -v
```

### Run Example Programs

```bash
# Start Host server (default: port 9000, runc runtime)
cd host && go run cmd/main.go

# Secure Host API (bind + token)
HERSHY_HOST_API_TOKEN='<long-random-token>' \
cd host && go run cmd/main.go -bind 127.0.0.1 -port 9000 -api-token '<long-random-token>'

# Deploy example programs (requires Host running on :9000)
cd examples/simple-counter && ./deploy-to-host.sh
cd examples/trading-long && ./e2e_test.sh
cd examples/watcher-server && ./deploy-to-host.sh
```

## 🔒 Security Contracts

Host enforces the following security contracts for all Programs:

| Contract | Enforcement | Rationale |
|----------|-------------|-----------|
| **gVisor Runtime** | `runtime: runsc` | Kernel-level isolation |
| **Read-only Root FS** | `read_only: true` | Prevent system tampering |
| **Single RW Volume** | `/state:rw` only | Controlled persistent data |
| **No Port Exposure** | `:8080` internal only | Prevent direct access |
| **Reverse Proxy** | Host-managed | Centralized access control |

## 📋 State Machine

```
Created
  ↓ UserStartRequested
Building (EnsureProgramFolders, BuildRuntime)
  ↓ BuildFinished(success)
Starting (StartRuntime)
  ↓ RuntimeStarted
Ready
  ↓ UserStopRequested
Stopping (StopRuntime)
  ↓ StopFinished(success)
Stopped

Error ← (any failure)
  ↓ UserStartRequested (retry)
Building
```

## 🧪 Testing

### Test Coverage

| Package | Coverage | Tests |
|---------|----------|-------|
| program/ | 82.7% | 28 tests |
| host/storage | N/A | Integration |
| host/compose | N/A | Integration |
| host/runtime | N/A | Integration |

### Test Categories

1. **Unit Tests** (`program/*_test.go`)
   - Reducer state transitions (19 tests)
   - Supervisor event loop (9 tests)
   - Race condition detection

2. **Integration Tests** (`host/host_test.go`)
   - Real Docker builds (requires Docker)
   - Container lifecycle
   - Security contract validation

3. **Validation Example** (`examples/validation`)
   - End-to-end flow verification
   - All three phases tested

## 🛠️ Development Principles

### SOLID Principles
- **Single Responsibility**: Each component has one reason to change
- **Open/Closed**: Extensible via interfaces, closed for modification
- **Liskov Substitution**: FakeEffectHandler ↔ RealEffectHandler
- **Interface Segregation**: Minimal, focused interfaces
- **Dependency Inversion**: Depend on abstractions (EffectHandler)

### Core Design Patterns
- **Reducer-Effect**: Predictable state management
- **Event Sourcing**: All changes via events
- **Goroutine per Program**: Isolated, serialized processing
- **Mock-based Testing**: Fast, reliable unit tests

## 📚 API Reference

### Program Domain

```go
// Create a new program
prog := program.NewProgram(programID, buildID, effectHandler)

// Start event loop
ctx := context.Background()
go prog.Start(ctx)

// Send events
prog.SendEvent(program.UserStartRequested{ProgramID: id})

// Query state (thread-safe)
state := prog.GetState()
```

### Host Components

```go
// Storage
storage := storage.NewManager("/var/lib/hersh/programs")
storage.EnsureProgramFolders(programID)

// Compose
compose := compose.NewBuilder()
spec, _ := compose.GenerateSpec(compose.BuildOpts{...})
compose.ValidateSpec(spec) // Enforces security contracts

// Docker
docker, _ := runtime.NewDockerManager()
result, _ := docker.Build(ctx, runtime.BuildOpts{...})
docker.Start(ctx, runtime.StartOpts{Spec: spec})
docker.Stop(ctx, containerID)
```

### Effect Handler

```go
// Create real handler
handler := host.NewRealEffectHandler(storage, compose, docker)

// Or use fake for testing
handler := program.NewFakeEffectHandler()
handler.Delay = 10 * time.Millisecond
handler.FailBuild = false
```

## 🔮 Future Work (Phase 4)

- **Registry**: Multi-program management with persistence
- **HTTP API**: RESTful endpoints for CRUD + lifecycle
- **Reverse Proxy**: `/programs/{id}/watcher/*` routing
- **Authentication**: User/token-based access control
- **Metrics**: Prometheus-compatible telemetry

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please ensure:
- Tests pass: `go test ./program -race`
- Coverage ≥80%: `go test ./program -cover`
- Code formatted: `go fmt ./...`
- Linter clean: `go vet ./...`

## 📖 Documentation

- [CLAUDE.md](CLAUDE.md) - Project overview and implementation guide
- [API Reference](docs/API.md) - Detailed API documentation (TBD)
- [Front AI Provider Guide](host/AI_PROVIDER_GUIDE.md) - AI provider setup for front standalone endpoint `/api/ai/strategy-draft`
- [Front Standalone Guide](frontend/front/README.md) - Run AI development UI as a standalone server (`:9090`)
- [Examples](examples/) - Usage examples and validation

---

**Built with ❤️ using Go and the Reducer-Effect pattern**
