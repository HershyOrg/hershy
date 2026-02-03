// Package program provides the core orchestration logic for managing user containers.
// A Program builds a Docker image from a Dockerfile, runs it in a gVisor container,
// and provides an API to interact with the WatcherServer running inside the container.
package program

import (
	"context"
	"fmt"
	"sync"
	"time"

	"program/api"
	"program/builder"
	"program/proxy"
	"program/runtime"
)

// Program manages a user container's lifecycle: build → start → proxy → API.
type Program struct {
	mu sync.RWMutex

	// Identity
	ID      string
	Name    string
	Version string
	Port    int

	// Domain Components (interface-based dependency injection)
	builder builder.Builder
	runtime runtime.Runtime
	proxy   proxy.Proxy
	apiSrv  api.Server

	// State
	state       ProgramState
	imageID     string
	containerID string
	startTime   time.Time
}

// ProgramState represents the current state of the Program.
type ProgramState string

const (
	// StateCreated indicates the Program has been created but not built.
	StateCreated ProgramState = "created"

	// StateBuilding indicates the image is being built.
	StateBuilding ProgramState = "building"

	// StateBuilt indicates the image has been built successfully.
	StateBuilt ProgramState = "built"

	// StateStarting indicates the container is starting.
	StateStarting ProgramState = "starting"

	// StateRunning indicates the container is running.
	StateRunning ProgramState = "running"

	// StateStopped indicates the container has stopped.
	StateStopped ProgramState = "stopped"

	// StateError indicates an error has occurred.
	StateError ProgramState = "error"
)

// ProgramConfig specifies the configuration for creating a Program.
type ProgramConfig struct {
	// Name is the name of the Program.
	Name string

	// Version is the version of the Program.
	Version string

	// Port is the host port to expose (maps to container's 8080).
	Port int

	// DockerfilePath is the path to the Dockerfile.
	DockerfilePath string

	// ContextPath is the build context directory.
	ContextPath string

	// Resources specifies resource limits for the container.
	Resources ResourceSpec

	// Environment variables to pass to the container.
	Environment map[string]string
}

// ResourceSpec specifies resource limits.
type ResourceSpec struct {
	// CPULimit is the CPU limit (e.g., "500m").
	CPULimit string

	// MemoryLimit is the memory limit (e.g., "256Mi").
	MemoryLimit string
}

// NewProgram creates a new Program with the given configuration.
// The Program is created in the "created" state.
func NewProgram(config ProgramConfig, opts ...ProgramOption) (*Program, error) {
	if config.Name == "" {
		return nil, fmt.Errorf("program name is required")
	}
	if config.Port == 0 {
		return nil, fmt.Errorf("program port is required")
	}

	// Generate ID
	id := fmt.Sprintf("%s-%s-%d", config.Name, config.Version, time.Now().Unix())

	p := &Program{
		ID:      id,
		Name:    config.Name,
		Version: config.Version,
		Port:    config.Port,
		state:   StateCreated,
	}

	// Apply options (for dependency injection)
	for _, opt := range opts {
		opt(p)
	}

	// If no dependencies injected, use defaults (will be set by user)
	if p.builder == nil || p.runtime == nil || p.proxy == nil || p.apiSrv == nil {
		return nil, fmt.Errorf("program components not initialized (use WithBuilder, WithRuntime, WithProxy, WithAPIServer)")
	}

	return p, nil
}

// ProgramOption is a functional option for configuring a Program.
type ProgramOption func(*Program)

// WithBuilder injects a Builder implementation.
func WithBuilder(b builder.Builder) ProgramOption {
	return func(p *Program) {
		p.builder = b
	}
}

// WithRuntime injects a Runtime implementation.
func WithRuntime(r runtime.Runtime) ProgramOption {
	return func(p *Program) {
		p.runtime = r
	}
}

// WithProxy injects a Proxy implementation.
func WithProxy(pr proxy.Proxy) ProgramOption {
	return func(p *Program) {
		p.proxy = pr
	}
}

// WithAPIServer injects an API Server implementation.
func WithAPIServer(srv api.Server) ProgramOption {
	return func(p *Program) {
		p.apiSrv = srv
	}
}

// Build builds the container image from the Dockerfile.
func (p *Program) Build(ctx context.Context, dockerfilePath, contextPath string) error {
	p.mu.Lock()
	if p.state != StateCreated && p.state != StateStopped {
		p.mu.Unlock()
		return fmt.Errorf("cannot build in state %s", p.state)
	}
	p.state = StateBuilding
	p.mu.Unlock()

	// Build image
	buildSpec := builder.BuildSpec{
		DockerfilePath: dockerfilePath,
		ContextPath:    contextPath,
		ImageName:      fmt.Sprintf("hersh-program-%s", p.Name),
		Tags:           []string{p.Version, "latest"},
	}

	imageID, err := p.builder.Build(ctx, buildSpec)
	if err != nil {
		p.mu.Lock()
		p.state = StateError
		p.mu.Unlock()
		return fmt.Errorf("build failed: %w", err)
	}

	p.mu.Lock()
	p.imageID = string(imageID)
	p.state = StateBuilt
	p.mu.Unlock()

	return nil
}

// Start starts the container.
func (p *Program) Start(ctx context.Context, resources ResourceSpec, env map[string]string) error {
	p.mu.Lock()
	if p.state != StateBuilt {
		p.mu.Unlock()
		return fmt.Errorf("cannot start in state %s (must build first)", p.state)
	}
	if p.imageID == "" {
		p.mu.Unlock()
		return fmt.Errorf("no image built")
	}
	p.state = StateStarting
	p.mu.Unlock()

	// Start container
	containerSpec := runtime.ContainerSpec{
		ImageID:     p.imageID,
		ContainerID: fmt.Sprintf("%s-container", p.ID),
		Port:        p.Port,
		Resources: runtime.ResourceLimits{
			CPULimit:    resources.CPULimit,
			MemoryLimit: resources.MemoryLimit,
		},
		Environment: env,
	}

	containerID, err := p.runtime.Start(ctx, containerSpec)
	if err != nil {
		p.mu.Lock()
		p.state = StateError
		p.mu.Unlock()
		return fmt.Errorf("start failed: %w", err)
	}

	p.mu.Lock()
	p.containerID = string(containerID)
	p.state = StateRunning
	p.startTime = time.Now()
	p.mu.Unlock()

	return nil
}

// Stop stops the container.
func (p *Program) Stop(ctx context.Context) error {
	p.mu.RLock()
	if p.state != StateRunning {
		p.mu.RUnlock()
		return fmt.Errorf("cannot stop in state %s", p.state)
	}
	containerID := runtime.ContainerID(p.containerID)
	p.mu.RUnlock()

	// Stop container
	if err := p.runtime.Stop(ctx, containerID); err != nil {
		return fmt.Errorf("stop failed: %w", err)
	}

	p.mu.Lock()
	p.state = StateStopped
	p.mu.Unlock()

	return nil
}

// GetState returns the current state of the Program.
func (p *Program) GetState() ProgramState {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.state
}

// GetInfo returns information about the Program.
func (p *Program) GetInfo() api.ProgramInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return api.ProgramInfo{
		ID:          p.ID,
		Name:        p.Name,
		Version:     p.Version,
		State:       string(p.state),
		Port:        p.Port,
		ContainerID: p.containerID,
		ImageID:     p.imageID,
	}
}

// GetStatus returns the current status of the Program.
func (p *Program) GetStatus(ctx context.Context) (api.ProgramStatus, error) {
	p.mu.RLock()
	state := p.state
	containerID := p.containerID
	startTime := p.startTime
	p.mu.RUnlock()

	status := api.ProgramStatus{
		State:   string(state),
		Healthy: false,
	}

	if state == StateRunning && containerID != "" {
		// Get container status
		containerStatus, err := p.runtime.Status(ctx, runtime.ContainerID(containerID))
		if err != nil {
			return status, fmt.Errorf("failed to get container status: %w", err)
		}

		status.ContainerState = string(containerStatus.State)
		status.Healthy = containerStatus.Healthy
		status.Uptime = time.Since(startTime).Seconds()

		// Get WatcherServer status
		watcherStatus, err := p.proxy.GetStatus()
		if err == nil {
			status.WatcherStatus = map[string]interface{}{
				"state":      watcherStatus.State,
				"isRunning":  watcherStatus.IsRunning,
				"watcherID":  watcherStatus.WatcherID,
				"uptime":     watcherStatus.Uptime,
				"lastUpdate": watcherStatus.LastUpdate,
			}
		}
	}

	return status, nil
}

// GetProxy returns the proxy for accessing the WatcherServer.
func (p *Program) GetProxy() proxy.Proxy {
	return p.proxy
}

// GetAPIServer returns the API server.
func (p *Program) GetAPIServer() api.Server {
	return p.apiSrv
}
