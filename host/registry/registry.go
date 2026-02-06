package registry

import (
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/program"
)

// ProgramMetadata holds metadata about a registered program
type ProgramMetadata struct {
	ProgramID   program.ProgramID `json:"program_id"`
	BuildID     program.BuildID   `json:"build_id"`
	UserID      string            `json:"user_id"`
	State       program.State     `json:"state"`
	ImageID     string            `json:"image_id,omitempty"`
	ContainerID string            `json:"container_id,omitempty"`
	ErrorMsg    string            `json:"error_msg,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	ProxyPort   int               `json:"proxy_port"` // Host가 할당한 프록시 포트
}

// PortAllocator manages port allocation for proxy servers
type PortAllocator struct {
	mu        sync.Mutex
	minPort   int
	maxPort   int
	allocated map[int]bool
	nextPort  int
}

// NewPortAllocator creates a new port allocator with the given range
func NewPortAllocator(minPort, maxPort int) *PortAllocator {
	return &PortAllocator{
		minPort:   minPort,
		maxPort:   maxPort,
		allocated: make(map[int]bool),
		nextPort:  minPort,
	}
}

// isPortAvailable checks if a port is actually available at the OS level
func isPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

// Allocate allocates a free port from the available range
func (pa *PortAllocator) Allocate() (int, error) {
	pa.mu.Lock()
	defer pa.mu.Unlock()

	// Try to find a free port starting from nextPort
	startPort := pa.nextPort
	for {
		if !pa.allocated[pa.nextPort] {
			// Map says not allocated, but check actual OS-level availability
			if isPortAvailable(pa.nextPort) {
				port := pa.nextPort
				pa.allocated[port] = true
				pa.nextPort++
				if pa.nextPort > pa.maxPort {
					pa.nextPort = pa.minPort
				}
				return port, nil
			}
			// Port is actually in use by another process, mark it and skip
			pa.allocated[pa.nextPort] = true
		}

		pa.nextPort++
		if pa.nextPort > pa.maxPort {
			pa.nextPort = pa.minPort
		}

		// If we've checked all ports, no free ports available
		if pa.nextPort == startPort {
			return 0, fmt.Errorf("no free ports available in range %d-%d", pa.minPort, pa.maxPort)
		}
	}
}

// Release releases a previously allocated port
func (pa *PortAllocator) Release(port int) error {
	pa.mu.Lock()
	defer pa.mu.Unlock()

	if port < pa.minPort || port > pa.maxPort {
		return fmt.Errorf("port %d is outside valid range %d-%d", port, pa.minPort, pa.maxPort)
	}

	if !pa.allocated[port] {
		return fmt.Errorf("port %d is not allocated", port)
	}

	delete(pa.allocated, port)
	return nil
}

// IsAllocated checks if a port is currently allocated
func (pa *PortAllocator) IsAllocated(port int) bool {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	return pa.allocated[port]
}

// AllocatedCount returns the number of allocated ports
func (pa *PortAllocator) AllocatedCount() int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	return len(pa.allocated)
}

// Registry manages program metadata and port allocation
type Registry struct {
	mu        sync.RWMutex
	programs  map[program.ProgramID]*ProgramMetadata
	portAlloc *PortAllocator
}

// NewRegistry creates a new registry with default port range (9000-9999)
func NewRegistry() *Registry {
	return &Registry{
		programs:  make(map[program.ProgramID]*ProgramMetadata),
		portAlloc: NewPortAllocator(9000, 9999),
	}
}

// NewRegistryWithPortRange creates a new registry with custom port range
func NewRegistryWithPortRange(minPort, maxPort int) *Registry {
	return &Registry{
		programs:  make(map[program.ProgramID]*ProgramMetadata),
		portAlloc: NewPortAllocator(minPort, maxPort),
	}
}

// Register registers a new program and allocates a proxy port
func (r *Registry) Register(meta ProgramMetadata) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.programs[meta.ProgramID]; exists {
		return fmt.Errorf("program %s already registered", meta.ProgramID)
	}

	// Allocate proxy port
	port, err := r.portAlloc.Allocate()
	if err != nil {
		return fmt.Errorf("failed to allocate port: %w", err)
	}

	meta.ProxyPort = port
	meta.CreatedAt = time.Now()
	meta.UpdatedAt = meta.CreatedAt

	r.programs[meta.ProgramID] = &meta
	return nil
}

// Get retrieves metadata for a specific program
func (r *Registry) Get(id program.ProgramID) (*ProgramMetadata, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	meta, exists := r.programs[id]
	if !exists {
		return nil, fmt.Errorf("program %s not found", id)
	}

	// Return a copy to prevent external modification
	metaCopy := *meta
	return &metaCopy, nil
}

// List returns all registered programs
func (r *Registry) List() []*ProgramMetadata {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*ProgramMetadata, 0, len(r.programs))
	for _, meta := range r.programs {
		metaCopy := *meta
		result = append(result, &metaCopy)
	}

	return result
}

// Update updates specific fields of a program's metadata
func (r *Registry) Update(id program.ProgramID, updates map[string]interface{}) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	meta, exists := r.programs[id]
	if !exists {
		return fmt.Errorf("program %s not found", id)
	}

	// Apply updates
	for key, value := range updates {
		switch key {
		case "state":
			if state, ok := value.(program.State); ok {
				meta.State = state
			}
		case "image_id":
			if imageID, ok := value.(string); ok {
				meta.ImageID = imageID
			}
		case "container_id":
			if containerID, ok := value.(string); ok {
				meta.ContainerID = containerID
			}
		default:
			return fmt.Errorf("unknown field: %s", key)
		}
	}

	meta.UpdatedAt = time.Now()
	return nil
}

// Delete removes a program from the registry and releases its port
func (r *Registry) Delete(id program.ProgramID) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	meta, exists := r.programs[id]
	if !exists {
		return fmt.Errorf("program %s not found", id)
	}

	// Release port
	if err := r.portAlloc.Release(meta.ProxyPort); err != nil {
		return fmt.Errorf("failed to release port: %w", err)
	}

	delete(r.programs, id)
	return nil
}

// Exists checks if a program is registered
func (r *Registry) Exists(id program.ProgramID) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, exists := r.programs[id]
	return exists
}

// Count returns the number of registered programs
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.programs)
}
