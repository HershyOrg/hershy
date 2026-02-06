package program

import (
	"context"
	"testing"
	"time"
)

func TestSupervisor_FullLifecycle_Success(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.Delay = 10 * time.Millisecond

	prog := NewProgram("test-prog-1", "build-abc", handler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start the supervisor goroutine
	go prog.Start(ctx)

	// Send UserStartRequested event
	err := prog.SendEvent(UserStartRequested{ProgramID: prog.id})
	if err != nil {
		t.Fatalf("Failed to send event: %v", err)
	}

	// Wait for Ready state
	deadline := time.Now().Add(2 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateReady {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Ready state, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify state
	state := prog.GetState()
	if state.State != StateReady {
		t.Errorf("Expected Ready state, got %v", state.State)
	}
	if state.ImageID == "" {
		t.Error("Expected ImageID to be set")
	}
	if state.ContainerID == "" {
		t.Error("Expected ContainerID to be set")
	}

	// Send UserStopRequested event
	err = prog.SendEvent(UserStopRequested{ProgramID: prog.id})
	if err != nil {
		t.Fatalf("Failed to send stop event: %v", err)
	}

	// Wait for Stopped state
	deadline = time.Now().Add(1 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateStopped {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Stopped state, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify final state
	state = prog.GetState()
	if state.State != StateStopped {
		t.Errorf("Expected Stopped state, got %v", state.State)
	}

	// Cancel context to stop supervisor
	cancel()
	time.Sleep(100 * time.Millisecond)

	// Verify program is stopped
	if !prog.IsStopped() {
		t.Error("Expected program to be stopped")
	}
}

func TestSupervisor_BuildFailure(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.FailBuild = true

	prog := NewProgram("test-prog-2", "build-def", handler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go prog.Start(ctx)

	// Send UserStartRequested event
	err := prog.SendEvent(UserStartRequested{ProgramID: prog.id})
	if err != nil {
		t.Fatalf("Failed to send event: %v", err)
	}

	// Wait for Error state
	deadline := time.Now().Add(2 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateError {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Error state, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify error state
	state := prog.GetState()
	if state.State != StateError {
		t.Errorf("Expected Error state, got %v", state.State)
	}
	if state.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}
}

func TestSupervisor_StartFailure(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.FailStart = true

	prog := NewProgram("test-prog-3", "build-ghi", handler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go prog.Start(ctx)

	// Send UserStartRequested event
	err := prog.SendEvent(UserStartRequested{ProgramID: prog.id})
	if err != nil {
		t.Fatalf("Failed to send event: %v", err)
	}

	// Wait for Error state
	deadline := time.Now().Add(2 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateError {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Error state, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify error state
	state := prog.GetState()
	if state.State != StateError {
		t.Errorf("Expected Error state, got %v", state.State)
	}
	if state.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}
}

func TestSupervisor_RetryAfterError(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.FailBuild = true

	prog := NewProgram("test-prog-4", "build-jkl", handler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go prog.Start(ctx)

	// Send UserStartRequested event (will fail)
	err := prog.SendEvent(UserStartRequested{ProgramID: prog.id})
	if err != nil {
		t.Fatalf("Failed to send event: %v", err)
	}

	// Wait for Error state
	deadline := time.Now().Add(2 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateError {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Error state, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Fix the handler and retry
	handler.FailBuild = false

	err = prog.SendEvent(UserStartRequested{ProgramID: prog.id})
	if err != nil {
		t.Fatalf("Failed to send retry event: %v", err)
	}

	// Wait for Ready state
	deadline = time.Now().Add(2 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateReady {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Ready state after retry, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify state
	state := prog.GetState()
	if state.State != StateReady {
		t.Errorf("Expected Ready state after retry, got %v", state.State)
	}
}

func TestSupervisor_EventQueueFull(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.Delay = 1 * time.Second // Long delay to fill queue

	prog := NewProgram("test-prog-5", "build-mno", handler)

	// Don't start the supervisor, so events won't be processed
	// This will cause the queue to fill up

	// Send events until queue is full
	var err error
	for i := 0; i < DefaultEventQueueSize+10; i++ {
		err = prog.SendEvent(UserStartRequested{ProgramID: prog.id})
		if err != nil {
			break
		}
	}

	// Should eventually get ErrEventQueueFull
	if err != ErrEventQueueFull {
		t.Errorf("Expected ErrEventQueueFull, got %v", err)
	}
}

func TestSupervisor_SendEventAfterStop(t *testing.T) {
	handler := NewFakeEffectHandler()
	prog := NewProgram("test-prog-6", "build-pqr", handler)

	ctx, cancel := context.WithCancel(context.Background())

	go prog.Start(ctx)

	// Stop the program immediately
	cancel()
	time.Sleep(100 * time.Millisecond)

	// Try to send event after stop
	err := prog.SendEvent(UserStartRequested{ProgramID: prog.id})
	if err != ErrProgramStopped {
		t.Errorf("Expected ErrProgramStopped, got %v", err)
	}
}

func TestSupervisor_ConcurrentStateReads(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.Delay = 10 * time.Millisecond

	prog := NewProgram("test-prog-7", "build-stu", handler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go prog.Start(ctx)

	// Send start event
	prog.SendEvent(UserStartRequested{ProgramID: prog.id})

	// Concurrently read state from multiple goroutines
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				_ = prog.GetState()
				time.Sleep(1 * time.Millisecond)
			}
			done <- true
		}()
	}

	// Wait for all readers to finish
	for i := 0; i < 10; i++ {
		<-done
	}

	// Test should pass without data races (run with -race flag)
}

func TestSupervisor_StopDuringBuild(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.Delay = 100 * time.Millisecond

	prog := NewProgram("test-prog-8", "build-vwx", handler)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go prog.Start(ctx)

	// Send start event
	prog.SendEvent(UserStartRequested{ProgramID: prog.id})

	// Wait a bit for build to start
	time.Sleep(50 * time.Millisecond)

	// Send stop event during build
	prog.SendEvent(UserStopRequested{ProgramID: prog.id})

	// Wait for Stopped state
	deadline := time.Now().Add(1 * time.Second)
	for {
		state := prog.GetState()
		if state.State == StateStopped {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Stopped state, current state: %v", state.State)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify state
	state := prog.GetState()
	if state.State != StateStopped {
		t.Errorf("Expected Stopped state, got %v", state.State)
	}
}

func TestSupervisor_ContextCancellation(t *testing.T) {
	handler := NewFakeEffectHandler()
	handler.Delay = 10 * time.Millisecond

	prog := NewProgram("test-prog-9", "build-yz", handler)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Start supervisor with short timeout
	go prog.Start(ctx)

	// Send start event
	prog.SendEvent(UserStartRequested{ProgramID: prog.id})

	// Wait for context timeout
	time.Sleep(200 * time.Millisecond)

	// Program should be stopped
	if !prog.IsStopped() {
		t.Error("Expected program to be stopped after context cancellation")
	}
}
