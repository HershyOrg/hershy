package runtime

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// MockRuntime is a mock implementation of the Runtime interface for testing.
// It simulates container operations without actually running containers.
type MockRuntime struct {
	mu sync.RWMutex

	// StartDelay simulates container startup time.
	StartDelay time.Duration

	// ShouldFail can be set to true to simulate runtime failures.
	ShouldFail bool

	// Containers tracks running containers.
	Containers map[ContainerID]*MockContainer
}

// MockContainer represents a mock container.
type MockContainer struct {
	Spec      ContainerSpec
	State     ContainerState
	StartTime time.Time
	ExitCode  int
}

// NewMockRuntime creates a new MockRuntime.
func NewMockRuntime() *MockRuntime {
	return &MockRuntime{
		StartDelay: 50 * time.Millisecond,
		Containers: make(map[ContainerID]*MockContainer),
	}
}

// Start simulates starting a container.
func (m *MockRuntime) Start(ctx context.Context, spec ContainerSpec) (ContainerID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.ShouldFail {
		return "", &RuntimeError{
			Operation: "start",
			Message:   "mock start failure",
		}
	}

	// Simulate startup time
	select {
	case <-time.After(m.StartDelay):
	case <-ctx.Done():
		return "", ctx.Err()
	}

	containerID := ContainerID(spec.ContainerID)
	if containerID == "" {
		containerID = ContainerID(fmt.Sprintf("mock-container-%d", time.Now().Unix()))
	}

	// Check if container already exists
	if _, exists := m.Containers[containerID]; exists {
		return "", &RuntimeError{
			Operation:   "start",
			ContainerID: containerID,
			Message:     "container already exists",
		}
	}

	// Create and start container
	container := &MockContainer{
		Spec:      spec,
		State:     StateRunning,
		StartTime: time.Now(),
	}

	m.Containers[containerID] = container

	return containerID, nil
}

// Stop simulates stopping a container.
func (m *MockRuntime) Stop(ctx context.Context, containerID ContainerID) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.ShouldFail {
		return &RuntimeError{
			Operation:   "stop",
			ContainerID: containerID,
			Message:     "mock stop failure",
		}
	}

	container, exists := m.Containers[containerID]
	if !exists {
		return &RuntimeError{
			Operation:   "stop",
			ContainerID: containerID,
			Message:     "container not found",
		}
	}

	container.State = StateStopped
	return nil
}

// Status simulates retrieving container status.
func (m *MockRuntime) Status(ctx context.Context, containerID ContainerID) (ContainerStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.ShouldFail {
		return ContainerStatus{}, &RuntimeError{
			Operation:   "status",
			ContainerID: containerID,
			Message:     "mock status failure",
		}
	}

	container, exists := m.Containers[containerID]
	if !exists {
		return ContainerStatus{}, &RuntimeError{
			Operation:   "status",
			ContainerID: containerID,
			Message:     "container not found",
		}
	}

	uptime := 0.0
	if container.State == StateRunning {
		uptime = time.Since(container.StartTime).Seconds()
	}

	return ContainerStatus{
		ID:       containerID,
		State:    container.State,
		Healthy:  container.State == StateRunning,
		Uptime:   uptime,
		ExitCode: container.ExitCode,
	}, nil
}

// Logs simulates retrieving container logs.
func (m *MockRuntime) Logs(ctx context.Context, containerID ContainerID, opts LogOptions) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.ShouldFail {
		return nil, &RuntimeError{
			Operation:   "logs",
			ContainerID: containerID,
			Message:     "mock logs failure",
		}
	}

	_, exists := m.Containers[containerID]
	if !exists {
		return nil, &RuntimeError{
			Operation:   "logs",
			ContainerID: containerID,
			Message:     "container not found",
		}
	}

	// Return mock logs
	mockLogs := fmt.Sprintf("[Mock Container %s] Logs\n", containerID)
	mockLogs += "Container started successfully\n"
	mockLogs += "WatcherServer listening on port 8080\n"

	return []byte(mockLogs), nil
}

// GetContainer returns a mock container (test helper).
func (m *MockRuntime) GetContainer(containerID ContainerID) (*MockContainer, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	container, ok := m.Containers[containerID]
	return container, ok
}
