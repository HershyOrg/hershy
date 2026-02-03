// Package runtime provides interfaces and models for managing container runtime.
// It abstracts the underlying runtime (gVisor, Docker, containerd, etc.).
package runtime

import "context"

// Runtime is the interface for managing container lifecycle.
type Runtime interface {
	// Start starts a container with the given specification.
	// Returns the ContainerID of the started container.
	Start(ctx context.Context, spec ContainerSpec) (ContainerID, error)

	// Stop stops a running container.
	Stop(ctx context.Context, containerID ContainerID) error

	// Status retrieves the current status of a container.
	Status(ctx context.Context, containerID ContainerID) (ContainerStatus, error)

	// Logs retrieves logs from a container.
	Logs(ctx context.Context, containerID ContainerID, opts LogOptions) ([]byte, error)
}

// ContainerSpec specifies the parameters for starting a container.
type ContainerSpec struct {
	// ImageID is the ID of the image to run.
	ImageID string

	// ContainerID is the desired ID for the container.
	ContainerID string

	// Port is the host port to map to container's port 8080 (WatcherServer).
	Port int

	// Resources specifies resource limits for the container.
	Resources ResourceLimits

	// Environment is a map of environment variables.
	Environment map[string]string
}

// ResourceLimits specifies resource constraints for a container.
type ResourceLimits struct {
	// CPULimit is the CPU limit (e.g., "500m" for 0.5 cores).
	CPULimit string

	// MemoryLimit is the memory limit (e.g., "256Mi").
	MemoryLimit string
}

// ContainerID is a unique identifier for a container.
type ContainerID string

// String returns the string representation of ContainerID.
func (id ContainerID) String() string {
	return string(id)
}

// ContainerStatus represents the current status of a container.
type ContainerStatus struct {
	// ID is the container identifier.
	ID ContainerID

	// State is the current state of the container.
	State ContainerState

	// Healthy indicates whether the container is healthy.
	Healthy bool

	// Uptime is the time the container has been running in seconds.
	Uptime float64

	// ExitCode is the exit code if the container has stopped.
	ExitCode int
}

// ContainerState represents the state of a container.
type ContainerState string

const (
	// StateStarting indicates the container is starting up.
	StateStarting ContainerState = "starting"

	// StateRunning indicates the container is running.
	StateRunning ContainerState = "running"

	// StateStopped indicates the container has stopped.
	StateStopped ContainerState = "stopped"

	// StateError indicates the container encountered an error.
	StateError ContainerState = "error"
)

// LogOptions specifies options for retrieving container logs.
type LogOptions struct {
	// Tail is the number of lines to retrieve from the end.
	// 0 means all logs.
	Tail int

	// Follow indicates whether to stream logs continuously.
	Follow bool
}

// RuntimeError represents an error that occurred during runtime operations.
type RuntimeError struct {
	// Operation indicates which operation failed.
	// Examples: "start", "stop", "status", "logs"
	Operation string

	// ContainerID is the ID of the container involved.
	ContainerID ContainerID

	// Message is a human-readable error message.
	Message string

	// Cause is the underlying error.
	Cause error
}

// Error implements the error interface.
func (e *RuntimeError) Error() string {
	if e.Cause != nil {
		return e.Operation + " [" + e.ContainerID.String() + "]: " + e.Message + " (" + e.Cause.Error() + ")"
	}
	return e.Operation + " [" + e.ContainerID.String() + "]: " + e.Message
}

// Unwrap returns the underlying error.
func (e *RuntimeError) Unwrap() error {
	return e.Cause
}
