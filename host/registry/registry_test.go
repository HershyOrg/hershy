package registry

import (
	"sync"
	"testing"

	"github.com/HershyOrg/hershy/program"
)

func TestPortAllocator_Allocate(t *testing.T) {
	// Use port range that doesn't conflict with running services
	pa := NewPortAllocator(29000, 29002)

	// Allocate first port
	port1, err := pa.Allocate()
	if err != nil {
		t.Fatalf("Failed to allocate port: %v", err)
	}
	if port1 != 29000 {
		t.Errorf("Expected port 29000, got %d", port1)
	}

	// Allocate second port
	port2, err := pa.Allocate()
	if err != nil {
		t.Fatalf("Failed to allocate port: %v", err)
	}
	if port2 != 29001 {
		t.Errorf("Expected port 29001, got %d", port2)
	}

	// Allocate third port
	port3, err := pa.Allocate()
	if err != nil {
		t.Fatalf("Failed to allocate port: %v", err)
	}
	if port3 != 29002 {
		t.Errorf("Expected port 29002, got %d", port3)
	}

	// Try to allocate when all ports are used
	_, err = pa.Allocate()
	if err == nil {
		t.Error("Expected error when all ports are allocated, got nil")
	}
}

func TestPortAllocator_Release(t *testing.T) {
	// Use port range that doesn't conflict with running services
	pa := NewPortAllocator(29000, 29002)

	// Allocate ports
	port1, _ := pa.Allocate()
	port2, _ := pa.Allocate()

	// Release port1
	if err := pa.Release(port1); err != nil {
		t.Errorf("Failed to release port %d: %v", port1, err)
	}

	// Verify port1 can be allocated again (may wrap around to 29002 first, then 29000)
	newPort, err := pa.Allocate()
	if err != nil {
		t.Fatalf("Failed to allocate after release: %v", err)
	}
	if newPort != 29002 && newPort != port1 {
		t.Errorf("Expected port 29002 or %d, got %d", port1, newPort)
	}

	// If we got 29002, allocate again to get the released port
	if newPort == 29002 {
		newPort2, err := pa.Allocate()
		if err != nil {
			t.Fatalf("Failed to allocate second time: %v", err)
		}
		if newPort2 != port1 {
			t.Errorf("Expected to reuse port %d, got %d", port1, newPort2)
		}
	}

	// Release port2
	if err := pa.Release(port2); err != nil {
		t.Errorf("Failed to release port %d: %v", port2, err)
	}

	// Try to release already released port
	if err := pa.Release(port2); err == nil {
		t.Error("Expected error when releasing already released port, got nil")
	}
}

func TestPortAllocator_InvalidPort(t *testing.T) {
	// Use port range that doesn't conflict with running services
	pa := NewPortAllocator(29000, 29002)

	// Try to release port outside range
	if err := pa.Release(28999); err == nil {
		t.Error("Expected error for port below range, got nil")
	}

	if err := pa.Release(29003); err == nil {
		t.Error("Expected error for port above range, got nil")
	}
}

func TestPortAllocator_Concurrent(t *testing.T) {
	// Use port range that doesn't conflict with running services
	pa := NewPortAllocator(29000, 29099)

	var wg sync.WaitGroup
	ports := make(chan int, 100)

	// Allocate 50 ports concurrently
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			port, err := pa.Allocate()
			if err != nil {
				t.Errorf("Failed to allocate port: %v", err)
				return
			}
			ports <- port
		}()
	}

	wg.Wait()
	close(ports)

	// Verify all ports are unique
	seen := make(map[int]bool)
	for port := range ports {
		if seen[port] {
			t.Errorf("Duplicate port allocated: %d", port)
		}
		seen[port] = true
	}

	if len(seen) != 50 {
		t.Errorf("Expected 50 unique ports, got %d", len(seen))
	}
}

func TestRegistry_Register(t *testing.T) {
	r := NewRegistry()

	meta := ProgramMetadata{
		ProgramID: program.ProgramID("test-prog-1"),
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-1",
	}

	// Register program
	if err := r.Register(meta); err != nil {
		t.Fatalf("Failed to register program: %v", err)
	}

	// Verify program is registered
	if !r.Exists(meta.ProgramID) {
		t.Error("Program should exist after registration")
	}

	// Verify proxy port was allocated
	registered, err := r.Get(meta.ProgramID)
	if err != nil {
		t.Fatalf("Failed to get registered program: %v", err)
	}
	if registered.PublishPort == 0 {
		t.Error("PublishPort should be allocated")
	}
	if registered.PublishPort < 19001 || registered.PublishPort > 29999 {
		t.Errorf("PublishPort %d is outside valid range", registered.PublishPort)
	}

	// Try to register duplicate
	if err := r.Register(meta); err == nil {
		t.Error("Expected error when registering duplicate program, got nil")
	}
}

func TestRegistry_Get(t *testing.T) {
	r := NewRegistry()

	meta := ProgramMetadata{
		ProgramID: program.ProgramID("test-prog-1"),
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-1",
	}

	r.Register(meta)

	// Get existing program
	retrieved, err := r.Get(meta.ProgramID)
	if err != nil {
		t.Fatalf("Failed to get program: %v", err)
	}
	if retrieved.ProgramID != meta.ProgramID {
		t.Errorf("Expected ProgramID %s, got %s", meta.ProgramID, retrieved.ProgramID)
	}

	// Get non-existent program
	_, err = r.Get(program.ProgramID("non-existent"))
	if err == nil {
		t.Error("Expected error when getting non-existent program, got nil")
	}

	// Verify returned copy doesn't affect registry
	retrieved.UserID = "modified"
	updated, _ := r.Get(meta.ProgramID)
	if updated.UserID == "modified" {
		t.Error("Modifying returned metadata should not affect registry")
	}
}

func TestRegistry_List(t *testing.T) {
	r := NewRegistry()

	// List empty registry
	if programs := r.List(); len(programs) != 0 {
		t.Errorf("Expected empty list, got %d programs", len(programs))
	}

	// Register multiple programs
	for i := 0; i < 5; i++ {
		meta := ProgramMetadata{
			ProgramID: program.ProgramID(string(rune('a' + i))),
			BuildID:   program.BuildID("build-123"),
			UserID:    "user-1",
		}
		r.Register(meta)
	}

	// List all programs
	programs := r.List()
	if len(programs) != 5 {
		t.Errorf("Expected 5 programs, got %d", len(programs))
	}
}

func TestRegistry_Delete(t *testing.T) {
	r := NewRegistry()

	meta := ProgramMetadata{
		ProgramID: program.ProgramID("test-prog-1"),
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-1",
	}

	r.Register(meta)

	// Get port before deletion
	registered, _ := r.Get(meta.ProgramID)
	port := registered.PublishPort

	// Delete program
	if err := r.Delete(meta.ProgramID); err != nil {
		t.Fatalf("Failed to delete program: %v", err)
	}

	// Verify program is deleted
	if r.Exists(meta.ProgramID) {
		t.Error("Program should not exist after deletion")
	}

	// Verify port is released
	if r.portAlloc.IsAllocated(port) {
		t.Error("Port should be released after program deletion")
	}

	// Try to delete non-existent program
	if err := r.Delete(meta.ProgramID); err == nil {
		t.Error("Expected error when deleting non-existent program, got nil")
	}
}

func TestRegistry_Concurrent(t *testing.T) {
	r := NewRegistry()

	var wg sync.WaitGroup

	// Register 20 programs concurrently
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			meta := ProgramMetadata{
				ProgramID: program.ProgramID(string(rune('a' + i))),
				BuildID:   program.BuildID("build-123"),
				UserID:    "user-1",
			}
			if err := r.Register(meta); err != nil {
				t.Errorf("Failed to register program: %v", err)
			}
		}(i)
	}

	wg.Wait()

	// Verify all programs are registered
	if count := r.Count(); count != 20 {
		t.Errorf("Expected 20 programs, got %d", count)
	}

	// Get all programs concurrently
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := program.ProgramID(string(rune('a' + i)))
			if _, err := r.Get(id); err != nil {
				t.Errorf("Failed to get program %s: %v", id, err)
			}
		}(i)
	}

	wg.Wait()
}
