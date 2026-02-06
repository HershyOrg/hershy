# Hersh API Documentation

Complete API reference for the Hersh reactive framework and container orchestration system.

---

## Table of Contents

- [Program Domain API](#program-domain-api)
- [Host Components API](#host-components-api)
- [Event & Effect Reference](#event--effect-reference)
- [State Machine](#state-machine)
- [Error Handling](#error-handling)

---

## Program Domain API

### Types

#### `ProgramID`
```go
type ProgramID string
```
Unique identifier for a program instance.
Format: `{userID}-{buildID}-{uuid}`

#### `BuildID`
```go
type BuildID string
```
Identifies a specific build configuration.
Format: `build-{sha256[:12]}`

#### `State`
```go
type State int

const (
    StateCreated  State = iota
    StateBuilding
    StateStarting
    StateReady
    StateStopping
    StateStopped
    StateError
)
```

#### `ProgramState`
```go
type ProgramState struct {
    ID          ProgramID
    State       State
    BuildID     BuildID
    ImageID     string  // Set after successful build
    ContainerID string  // Set after successful runtime start
    ErrorMsg    string  // Set when State == StateError
}
```

### Functions

#### `NewProgramState`
```go
func NewProgramState(id ProgramID, buildID BuildID) ProgramState
```
Creates an initial `ProgramState` in `Created` state.

#### `Reduce`
```go
func Reduce(state ProgramState, event Event) (ProgramState, []Effect)
```
Pure reducer function that handles state transitions.
**Parameters:**
- `state`: Current program state
- `event`: Incoming event

**Returns:**
- `ProgramState`: Next state
- `[]Effect`: Effects to be executed

**Thread-safe**: Yes (pure function, no side effects)

### Program (Supervisor)

#### `NewProgram`
```go
func NewProgram(id ProgramID, buildID BuildID, handler EffectHandler) *Program
```
Creates a new Program instance.

**Parameters:**
- `id`: Unique program identifier
- `buildID`: Build configuration identifier
- `handler`: Effect execution handler (real or fake)

#### `Program.Start`
```go
func (p *Program) Start(ctx context.Context)
```
Runs the event loop goroutine. **Blocks** until context is cancelled.

**Event Loop Logic:**
```go
for event := range eventQueue {
    nextState, effects := Reduce(state, event)
    state = nextState
    for _, eff := range effects {
        resultEvent := handler.Execute(ctx, eff)
        if resultEvent != nil {
            eventQueue <- resultEvent
        }
    }
}
```

#### `Program.SendEvent`
```go
func (p *Program) SendEvent(event Event) error
```
Enqueues an event for processing.

**Returns:**
- `ErrEventQueueFull`: Queue buffer is full (1000 events)
- `ErrProgramStopped`: Program has stopped

**Thread-safe**: Yes

#### `Program.GetState`
```go
func (p *Program) GetState() ProgramState
```
Returns current state (read-only copy).

**Thread-safe**: Yes (uses RWMutex)

#### `Program.GetID`
```go
func (p *Program) GetID() ProgramID
```
Returns program ID.

#### `Program.IsStopped`
```go
func (p *Program) IsStopped() bool
```
Returns whether the program has stopped.

**Thread-safe**: Yes

### EffectHandler Interface

```go
type EffectHandler interface {
    Execute(ctx context.Context, eff Effect) Event
}
```

Implementations:
- **FakeEffectHandler**: Test implementation with configurable delays/failures
- **RealEffectHandler**: Production implementation using Docker + filesystem

#### FakeEffectHandler

```go
func NewFakeEffectHandler() *FakeEffectHandler

type FakeEffectHandler struct {
    Delay       time.Duration  // Simulates execution time
    FailBuild   bool           // Causes BuildRuntime to fail
    FailStart   bool           // Causes StartRuntime to fail
    FailStop    bool           // Causes StopRuntime to fail
    FailFolders bool           // Causes EnsureProgramFolders to fail
}
```

**Example:**
```go
handler := NewFakeEffectHandler()
handler.Delay = 10 * time.Millisecond
handler.FailBuild = false

prog := NewProgram("test-prog", "build-123", handler)
```

---

## Host Components API

### Storage Manager

#### `NewManager`
```go
func NewManager(baseDir string) *Manager
```
Creates a new StorageManager.

**Parameters:**
- `baseDir`: Base directory for all programs (e.g., `/var/lib/hersh/programs`)

#### `Manager.EnsureProgramFolders`
```go
func (m *Manager) EnsureProgramFolders(id ProgramID) error
```
Creates directory structure:
```
{baseDir}/{programID}/
├─ src/        (user source code)
├─ meta/       (metadata)
├─ state/      (persistent state - RW volume)
├─ compose/    (generated compose spec)
├─ logs/       (runtime logs)
└─ runtime/    (container metadata)
```

#### Path Getters
```go
func (m *Manager) GetSrcPath(id ProgramID) string
func (m *Manager) GetMetaPath(id ProgramID) string
func (m *Manager) GetStatePath(id ProgramID) string
func (m *Manager) GetComposePath(id ProgramID) string
func (m *Manager) GetLogsPath(id ProgramID) string
func (m *Manager) GetRuntimePath(id ProgramID) string
```
All return **absolute paths**.

#### Utility Functions
```go
func (m *Manager) ProgramExists(id ProgramID) bool
func (m *Manager) DeleteProgram(id ProgramID) error
```

### Compose Builder

#### `NewBuilder`
```go
func NewBuilder() *Builder
```

#### `Builder.GenerateSpec`
```go
func (b *Builder) GenerateSpec(opts BuildOpts) (*ComposeSpec, error)

type BuildOpts struct {
    ProgramID   ProgramID
    ImageID     string  // Docker image ID or tag
    StatePath   string  // Host path to state directory
    NetworkMode string  // Default: "none"
    Runtime     string  // Default: "runsc" (gVisor)
}
```

**Generated Security Contracts:**
- Runtime: `runsc` (gVisor) by default
- Ports: Empty (`:8080` never exposed)
- Volumes: `/state:rw` only
- ReadOnly rootfs: `true`
- SecurityOpt: `no-new-privileges:true`

#### `Builder.ValidateSpec`
```go
func (b *Builder) ValidateSpec(spec *ComposeSpec) error
```

**Validation Rules:**
- ❌ `:8080` external publish forbidden → `ErrPort8080Published`
- ❌ Runtime must be `runsc` or `runc` → `ErrInvalidRuntime`
- ❌ Root filesystem must be read-only → `ErrRootFsNotReadOnly`
- ❌ `/state` volume must be `:rw` → `ErrStateVolumeNotRW`

#### `Builder.ToDockerRunArgs`
```go
func (b *Builder) ToDockerRunArgs(spec *ComposeSpec) ([]string, error)
```
Converts ComposeSpec to `docker run` arguments.

### Docker Manager

#### `NewDockerManager`
```go
func NewDockerManager() (*DockerManager, error)
```
Creates Docker client using environment variables.

#### `DockerManager.Build`
```go
func (m *DockerManager) Build(ctx context.Context, opts BuildOpts) (*BuildResult, error)

type BuildOpts struct {
    BuildID      BuildID
    ContextPath  string    // Path to build context (src directory)
    Dockerfile   string    // Path to Dockerfile
    Tags         []string
    NoCache      bool
    PullParent   bool
    BuildLogPath string    // Optional: save build logs
}

type BuildResult struct {
    ImageID string
    BuildID BuildID
}
```

#### `DockerManager.Start`
```go
func (m *DockerManager) Start(ctx context.Context, opts StartOpts) (*StartResult, error)

type StartOpts struct {
    ProgramID ProgramID
    Spec      *ComposeSpec
}

type StartResult struct {
    ContainerID string
    ProgramID   ProgramID
}
```

#### `DockerManager.Stop`
```go
func (m *DockerManager) Stop(ctx context.Context, containerID string) error
```
Stops and removes container (10 second timeout).

#### Utility Functions
```go
func (m *DockerManager) GetContainerStatus(ctx context.Context, containerID string) (string, error)
func (m *DockerManager) GetContainerIP(ctx context.Context, containerID string) (string, error)
func (m *DockerManager) IsContainerRunning(ctx context.Context, containerID string) (bool, error)
```

### RealEffectHandler

#### `NewRealEffectHandler`
```go
func NewRealEffectHandler(
    storage *storage.Manager,
    compose *compose.Builder,
    runtime *runtime.DockerManager,
) *RealEffectHandler
```

#### `RealEffectHandler.SetDefaultRuntime`
```go
func (h *RealEffectHandler) SetDefaultRuntime(runtime string)
```
Sets default container runtime (`runsc` or `runc`).
Default: `runsc`

#### `RealEffectHandler.Execute`
```go
func (h *RealEffectHandler) Execute(ctx context.Context, eff Effect) Event
```

**Effect → Event Mapping:**

| Effect | Result Event |
|--------|--------------|
| `EnsureProgramFolders` | `FoldersEnsured{Success, Error}` |
| `BuildRuntime` | `BuildFinished{Success, ImageID, Error}` |
| `StartRuntime` | `RuntimeStarted{ContainerID}` or `StartFailed{Reason}` |
| `StopRuntime` | `StopFinished{Success, Error}` |
| `FetchRuntimeStatus` | `RuntimeExited{ExitCode}` or `nil` |

---

## Event & Effect Reference

### Events

#### User-Triggered Events

```go
type UserStartRequested struct {
    ProgramID ProgramID
}

type UserStopRequested struct {
    ProgramID ProgramID
}

type UserRestartRequested struct {
    ProgramID ProgramID
}
```

#### Host Result Events

```go
type FoldersEnsured struct {
    Success bool
    Error   string
}

type BuildFinished struct {
    Success bool
    ImageID string  // Set when Success == true
    Error   string  // Set when Success == false
}

type RuntimeStarted struct {
    ContainerID string
}

type StartFailed struct {
    Reason string
}

type RuntimeExited struct {
    ExitCode int
}

type StopFinished struct {
    Success bool
    Error   string
}
```

### Effects

```go
type EnsureProgramFolders struct {
    ProgramID ProgramID
}

type BuildRuntime struct {
    ProgramID  ProgramID
    BuildID    BuildID
    SrcPath    string  // Path to source directory
    Dockerfile string  // Dockerfile path
}

type StartRuntime struct {
    ProgramID ProgramID
    ImageID   string
    StatePath string  // Path to /state volume
}

type StopRuntime struct {
    ContainerID string
}

type FetchRuntimeStatus struct {
    ContainerID string
}
```

---

## State Machine

### State Transitions

```
Created
  │
  ├─ UserStartRequested → Building
  │
Building
  │
  ├─ FoldersEnsured(success) → Building (waiting)
  ├─ BuildFinished(success) → Starting
  ├─ BuildFinished(failure) → Error
  └─ UserStopRequested → Stopped
  │
Starting
  │
  ├─ RuntimeStarted → Ready
  ├─ StartFailed → Error
  └─ UserStopRequested → Stopped
  │
Ready
  │
  ├─ UserStopRequested → Stopping
  ├─ UserRestartRequested → Stopping
  └─ RuntimeExited → Error
  │
Stopping
  │
  ├─ StopFinished(success) → Stopped
  └─ StopFinished(failure) → Error
  │
Stopped
  │
  └─ UserStartRequested → Building (rebuild)
  │
Error
  │
  └─ UserStartRequested → Building (retry)
```

### Effects by State

| State | Triggered Effects |
|-------|-------------------|
| Created → Building | `EnsureProgramFolders`, `BuildRuntime` |
| Building → Starting | `StartRuntime` |
| Ready → Stopping | `StopRuntime` |
| Stopped → Building | `EnsureProgramFolders`, `BuildRuntime` |
| Error → Building | `EnsureProgramFolders`, `BuildRuntime` |

---

## Error Handling

### Error Types

```go
var (
    ErrEventQueueFull   = errors.New("event queue full")
    ErrProgramStopped   = errors.New("program stopped")
    ErrPort8080Published = errors.New("port 8080 external publish is forbidden")
    ErrInvalidRuntime   = errors.New("runtime must be runsc (gVisor)")
    ErrStateVolumeNotRW = errors.New("state volume must be read-write")
    ErrRootFsNotReadOnly = errors.New("root filesystem must be read-only")
)
```

### Error States

When a Program enters `StateError`:
- `ErrorMsg` field contains error description
- Can retry with `UserStartRequested`
- No automatic recovery (manual intervention required)

### Error Recovery Pattern

```go
// Check if program is in error state
state := prog.GetState()
if state.State == program.StateError {
    log.Printf("Error: %s", state.ErrorMsg)

    // Retry
    prog.SendEvent(program.UserStartRequested{ProgramID: state.ID})
}
```

---

## Best Practices

### 1. Context Management
Always pass context to control lifecycle:
```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
defer cancel()

go prog.Start(ctx)
```

### 2. Event Queue Sizing
Default queue size is 1000. Monitor for `ErrEventQueueFull`:
```go
if err := prog.SendEvent(event); err == program.ErrEventQueueFull {
    // Back off or increase queue size
}
```

### 3. Security Validation
Always validate ComposeSpec before execution:
```go
spec, _ := compose.GenerateSpec(opts)
if err := compose.ValidateSpec(spec); err != nil {
    // Handle security contract violation
}
```

### 4. Graceful Shutdown
```go
// Send stop event
prog.SendEvent(program.UserStopRequested{ProgramID: id})

// Wait for Stopped state
for prog.GetState().State != program.StateStopped {
    time.Sleep(100 * time.Millisecond)
}

// Cancel context to stop supervisor
cancel()
```

### 5. Testing with Fakes
```go
handler := program.NewFakeEffectHandler()
handler.Delay = 10 * time.Millisecond

// Test error scenarios
handler.FailBuild = true
prog := program.NewProgram("test", "build", handler)
// ... expect StateError
```

---

## Examples

### Complete Lifecycle Example

```go
package main

import (
    "context"
    "time"

    "github.com/rlaaudgjs5638/hersh/host"
    "github.com/rlaaudgjs5638/hersh/host/compose"
    "github.com/rlaaudgjs5638/hersh/host/runtime"
    "github.com/rlaaudgjs5638/hersh/host/storage"
    "github.com/rlaaudgjs5638/hersh/program"
)

func main() {
    // Setup
    storage := storage.NewManager("/var/lib/hersh/programs")
    compose := compose.NewBuilder()
    docker, _ := runtime.NewDockerManager()
    defer docker.Close()

    handler := host.NewRealEffectHandler(storage, compose, docker)

    // Create program
    prog := program.NewProgram("my-prog", "build-123", handler)

    // Start supervisor
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go prog.Start(ctx)

    // Start program
    prog.SendEvent(program.UserStartRequested{ProgramID: "my-prog"})

    // Wait for Ready
    for prog.GetState().State != program.StateReady {
        time.Sleep(1 * time.Second)
    }

    // Use program...

    // Stop program
    prog.SendEvent(program.UserStopRequested{ProgramID: "my-prog"})

    // Wait for Stopped
    for prog.GetState().State != program.StateStopped {
        time.Sleep(100 * time.Millisecond)
    }
}
```

---

**For more examples, see [examples/](../examples/) directory.**
