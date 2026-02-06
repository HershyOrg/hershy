# Hersh

**Hersh** is a reactive framework and container orchestration system for Go, implementing a Reducer-Effect pattern with gVisor-based security isolation.

## 🏗️ Architecture

Hersh consists of three main layers:

```
User Dockerfile → Program (build/run/proxy) → gVisor Container (hersh.Watcher + WatcherAPI:8080) ← Host Registry
```

### 1. **hersh/** - Reactive Framework Library
- **Reducer-Effect pattern**: Deterministic state management with synchronous effects
- **WatchCall**: Reactive variable monitoring
- **Memo**: Expensive computation caching
- **WatcherAPI**: HTTP server for external control (port 8080)

### 2. **program/** - Container Manager
- Builds Dockerfile → Docker image
- Runs gVisor container
- Proxies WatcherAPI endpoints
- Self-contained orchestration system

### 3. **host/** - Thin Registry
- Program discovery and metadata storage
- No runtime management (delegated to Program)

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
hersh/
├── program/                    # Program Domain (Core Logic)
│   ├── types.go               # ProgramID, State, ProgramState
│   ├── event.go               # User and system events
│   ├── effect.go              # Side effects to be executed
│   ├── reducer.go             # Pure state transition logic
│   ├── supervisor.go          # Goroutine-based event loop
│   ├── effect_handler.go      # Effect execution interface
│   ├── fake_handler.go        # Test implementation
│   └── *_test.go              # 28 tests, 82.7% coverage
│
├── host/                       # Host Components (IO Layer)
│   ├── storage/
│   │   └── manager.go         # Filesystem management
│   ├── compose/
│   │   └── builder.go         # ComposeSpec generation + security contracts
│   ├── runtime/
│   │   └── docker_manager.go # Docker SDK wrapper
│   ├── effect_handler.go      # Real IO integration
│   └── host_test.go           # Integration tests
│
├── hersh/                      # Reactive Framework (Future)
│   ├── watcher.go
│   └── watcher_api.go
│
└── examples/
    ├── validation/             # Validation example
    └── integration-test/       # Integration test files
```

## 🚀 Quick Start

### Prerequisites
- Go 1.21+
- Docker 20.10+
- gVisor (runsc) - optional for testing, required for production

### Run Tests

```bash
# Unit tests (no Docker required)
go test ./program -v -race

# Integration tests (Docker required)
go test -tags=integration ./host -v

# All tests with coverage
go test ./program -cover
```

### Run Validation Example

```bash
cd examples/validation
go run main.go
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
- [Examples](examples/) - Usage examples and validation

---

**Built with ❤️ using Go and the Reducer-Effect pattern**
