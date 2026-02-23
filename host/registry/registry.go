package registry

import (
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/program"
)

// ProgramMetadata holds immutable metadata about a registered program
// Runtime state (State, ImageID, ContainerID, ErrorMsg) is managed by Program supervisor
type ProgramMetadata struct {
	ProgramID   program.ProgramID `json:"program_id"`
	BuildID     program.BuildID   `json:"build_id"`
	UserID      string            `json:"user_id"`
	PublishPort int               `json:"publish_port"` // Localhost-only publish port (19001-29999)
	CreatedAt   time.Time         `json:"created_at"`
}

// RegistryEntry holds both metadata and runtime Program instance
type RegistryEntry struct {
	Metadata ProgramMetadata
	Program  *program.Program // nil if not running
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

// isPortAvailable checks if a port is available for localhost publishing.
// Host publishes containers to 127.0.0.1:port, so availability must be
// verified against that exact bind target.
func isPortAvailable(port int) bool {
	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
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

// Registry manages program metadata, runtime instances, and port allocation
type Registry struct {
	mu        sync.RWMutex
	programs  map[program.ProgramID]*RegistryEntry
	portAlloc *PortAllocator
}

// NewRegistry creates a new registry with default port range (19001-29999)
func NewRegistry() *Registry {
	return &Registry{
		programs:  make(map[program.ProgramID]*RegistryEntry),
		portAlloc: NewPortAllocator(19001, 29999),
	}
}

// NewRegistryWithPortRange creates a new registry with custom port range
func NewRegistryWithPortRange(minPort, maxPort int) *Registry {
	return &Registry{
		programs:  make(map[program.ProgramID]*RegistryEntry),
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

	// Allocate publish port
	port, err := r.portAlloc.Allocate()
	if err != nil {
		return fmt.Errorf("failed to allocate port: %w", err)
	}

	meta.PublishPort = port
	meta.CreatedAt = time.Now()

	entry := &RegistryEntry{
		Metadata: meta,
		Program:  nil, // Not running yet
	}

	r.programs[meta.ProgramID] = entry
	return nil
}

// Get retrieves metadata for a specific program
func (r *Registry) Get(id program.ProgramID) (*ProgramMetadata, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	entry, exists := r.programs[id]
	if !exists {
		return nil, fmt.Errorf("program %s not found", id)
	}

	// Return a copy to prevent external modification
	metaCopy := entry.Metadata
	return &metaCopy, nil
}

// List returns all registered programs
func (r *Registry) List() []*ProgramMetadata {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*ProgramMetadata, 0, len(r.programs))
	for _, entry := range r.programs {
		metaCopy := entry.Metadata
		result = append(result, &metaCopy)
	}

	return result
}

// Purge physically removes a program from the registry and releases its port
// This is an admin-only operation. Normal DELETE API should not call this.
// Programs should remain in registry for lifecycle tracking and restart capability.
// Use this only for permanent removal (e.g., admin cleanup, testing)
func (r *Registry) Purge(id program.ProgramID) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	entry, exists := r.programs[id]
	if !exists {
		return fmt.Errorf("program %s not found", id)
	}

	// Release port
	if err := r.portAlloc.Release(entry.Metadata.PublishPort); err != nil {
		return fmt.Errorf("failed to release port: %w", err)
	}

	delete(r.programs, id)
	return nil
}

// SetProgram updates the Program instance for a registered program
// This is used internally by cleanup operations (not recommended for normal use)
func (r *Registry) SetProgram(id program.ProgramID, prog *program.Program) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	entry, exists := r.programs[id]
	if !exists {
		return fmt.Errorf("program %s not found in registry", id)
	}

	entry.Program = prog
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

// SetProgramOnce sets the Program instance for a registered program (only once during creation)
func (r *Registry) SetProgramOnce(id program.ProgramID, prog *program.Program) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	entry, exists := r.programs[id]
	if !exists {
		return fmt.Errorf("program %s not found in registry", id)
	}

	if entry.Program != nil {
		return fmt.Errorf("program %s already has a Program instance", id)
	}

	entry.Program = prog
	return nil
}

// GetProgram retrieves the Program instance for a specific program
// Program is never nil after SetProgramOnce is called
func (r *Registry) GetProgram(id program.ProgramID) (*program.Program, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	entry, exists := r.programs[id]
	if !exists {
		return nil, false
	}

	// Program should never be nil (set during createProgramMeta)
	return entry.Program, true
}

// RangeAll iterates over all registered programs
func (r *Registry) RangeAll(fn func(id program.ProgramID, meta *ProgramMetadata, prog *program.Program) bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for id, entry := range r.programs {
		if !fn(id, &entry.Metadata, entry.Program) {
			break
		}
	}
}

// RangeRunning iterates over programs with non-nil Program instances
func (r *Registry) RangeRunning(fn func(id program.ProgramID, prog *program.Program) bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for id, entry := range r.programs {
		if entry.Program != nil {
			if !fn(id, entry.Program) {
				break
			}
		}
	}
}

// RangeByState iterates over programs with specific State
func (r *Registry) RangeByState(state program.State, fn func(id program.ProgramID, prog *program.Program) bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for id, entry := range r.programs {
		if entry.Program != nil {
			progState := entry.Program.GetState()
			if progState.State == state {
				if !fn(id, entry.Program) {
					break
				}
			}
		}
	}
}
