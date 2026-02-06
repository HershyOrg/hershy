package program

import (
	"testing"
)

func TestReducer_Created_UserStartRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")

	nextState, effects := Reduce(state, UserStartRequested{ProgramID: "prog-1"})

	// Should transition to Building
	if nextState.State != StateBuilding {
		t.Errorf("Expected state Building, got %v", nextState.State)
	}

	// Should produce 2 effects: EnsureProgramFolders and BuildRuntime
	if len(effects) != 2 {
		t.Fatalf("Expected 2 effects, got %d", len(effects))
	}

	if _, ok := effects[0].(EnsureProgramFolders); !ok {
		t.Errorf("Expected first effect to be EnsureProgramFolders, got %T", effects[0])
	}

	if _, ok := effects[1].(BuildRuntime); !ok {
		t.Errorf("Expected second effect to be BuildRuntime, got %T", effects[1])
	}
}

func TestReducer_Created_InvalidEvent(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")

	nextState, effects := Reduce(state, UserStopRequested{ProgramID: "prog-1"})

	// Should stay in Created state
	if nextState.State != StateCreated {
		t.Errorf("Expected state Created, got %v", nextState.State)
	}

	// Should produce no effects
	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Building_FoldersEnsuredSuccess(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateBuilding

	nextState, effects := Reduce(state, FoldersEnsured{Success: true})

	// Should stay in Building state (waiting for BuildFinished)
	if nextState.State != StateBuilding {
		t.Errorf("Expected state Building, got %v", nextState.State)
	}

	// Should produce no effects
	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Building_FoldersEnsuredFailure(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateBuilding

	nextState, effects := Reduce(state, FoldersEnsured{Success: false, Error: "permission denied"})

	// Should transition to Error
	if nextState.State != StateError {
		t.Errorf("Expected state Error, got %v", nextState.State)
	}

	// Should have error message
	if nextState.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Building_BuildFinishedSuccess(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateBuilding

	nextState, effects := Reduce(state, BuildFinished{Success: true, ImageID: "img-123"})

	// Should transition to Starting
	if nextState.State != StateStarting {
		t.Errorf("Expected state Starting, got %v", nextState.State)
	}

	// Should set ImageID
	if nextState.ImageID != "img-123" {
		t.Errorf("Expected ImageID img-123, got %s", nextState.ImageID)
	}

	// Should produce StartRuntime effect
	if len(effects) != 1 {
		t.Fatalf("Expected 1 effect, got %d", len(effects))
	}

	if startEff, ok := effects[0].(StartRuntime); !ok {
		t.Errorf("Expected StartRuntime effect, got %T", effects[0])
	} else if startEff.ImageID != "img-123" {
		t.Errorf("Expected StartRuntime ImageID img-123, got %s", startEff.ImageID)
	}
}

func TestReducer_Building_BuildFinishedFailure(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateBuilding

	nextState, effects := Reduce(state, BuildFinished{Success: false, Error: "syntax error"})

	// Should transition to Error
	if nextState.State != StateError {
		t.Errorf("Expected state Error, got %v", nextState.State)
	}

	// Should have error message
	if nextState.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Building_UserStopRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateBuilding

	nextState, effects := Reduce(state, UserStopRequested{ProgramID: "prog-1"})

	// Should transition to Stopped
	if nextState.State != StateStopped {
		t.Errorf("Expected state Stopped, got %v", nextState.State)
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Starting_RuntimeStarted(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateStarting
	state.ImageID = "img-123"

	nextState, effects := Reduce(state, RuntimeStarted{ContainerID: "container-456"})

	// Should transition to Ready
	if nextState.State != StateReady {
		t.Errorf("Expected state Ready, got %v", nextState.State)
	}

	// Should set ContainerID
	if nextState.ContainerID != "container-456" {
		t.Errorf("Expected ContainerID container-456, got %s", nextState.ContainerID)
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Starting_StartFailed(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateStarting
	state.ImageID = "img-123"

	nextState, effects := Reduce(state, StartFailed{Reason: "port already in use"})

	// Should transition to Error
	if nextState.State != StateError {
		t.Errorf("Expected state Error, got %v", nextState.State)
	}

	// Should have error message
	if nextState.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Starting_UserStopRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateStarting

	nextState, effects := Reduce(state, UserStopRequested{ProgramID: "prog-1"})

	// Should transition to Stopped
	if nextState.State != StateStopped {
		t.Errorf("Expected state Stopped, got %v", nextState.State)
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Ready_UserStopRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateReady
	state.ContainerID = "container-456"

	nextState, effects := Reduce(state, UserStopRequested{ProgramID: "prog-1"})

	// Should transition to Stopping
	if nextState.State != StateStopping {
		t.Errorf("Expected state Stopping, got %v", nextState.State)
	}

	// Should produce StopRuntime effect
	if len(effects) != 1 {
		t.Fatalf("Expected 1 effect, got %d", len(effects))
	}

	if stopEff, ok := effects[0].(StopRuntime); !ok {
		t.Errorf("Expected StopRuntime effect, got %T", effects[0])
	} else if stopEff.ContainerID != "container-456" {
		t.Errorf("Expected StopRuntime ContainerID container-456, got %s", stopEff.ContainerID)
	}
}

func TestReducer_Ready_UserRestartRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateReady
	state.ContainerID = "container-456"

	nextState, effects := Reduce(state, UserRestartRequested{ProgramID: "prog-1"})

	// Should transition to Stopping
	if nextState.State != StateStopping {
		t.Errorf("Expected state Stopping, got %v", nextState.State)
	}

	// Should produce StopRuntime effect
	if len(effects) != 1 {
		t.Fatalf("Expected 1 effect, got %d", len(effects))
	}

	if _, ok := effects[0].(StopRuntime); !ok {
		t.Errorf("Expected StopRuntime effect, got %T", effects[0])
	}
}

func TestReducer_Ready_RuntimeExited(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateReady
	state.ContainerID = "container-456"

	nextState, effects := Reduce(state, RuntimeExited{ExitCode: 1})

	// Should transition to Error
	if nextState.State != StateError {
		t.Errorf("Expected state Error, got %v", nextState.State)
	}

	// Should have error message
	if nextState.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Stopping_StopFinishedSuccess(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateStopping

	nextState, effects := Reduce(state, StopFinished{Success: true})

	// Should transition to Stopped
	if nextState.State != StateStopped {
		t.Errorf("Expected state Stopped, got %v", nextState.State)
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Stopping_StopFinishedFailure(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateStopping

	nextState, effects := Reduce(state, StopFinished{Success: false, Error: "timeout"})

	// Should transition to Error
	if nextState.State != StateError {
		t.Errorf("Expected state Error, got %v", nextState.State)
	}

	// Should have error message
	if nextState.ErrorMsg == "" {
		t.Error("Expected error message to be set")
	}

	if len(effects) != 0 {
		t.Errorf("Expected no effects, got %d", len(effects))
	}
}

func TestReducer_Stopped_UserStartRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateStopped

	nextState, effects := Reduce(state, UserStartRequested{ProgramID: "prog-1"})

	// Should transition to Building (restart requires rebuild)
	if nextState.State != StateBuilding {
		t.Errorf("Expected state Building, got %v", nextState.State)
	}

	// Should produce 2 effects
	if len(effects) != 2 {
		t.Fatalf("Expected 2 effects, got %d", len(effects))
	}

	if _, ok := effects[0].(EnsureProgramFolders); !ok {
		t.Errorf("Expected first effect to be EnsureProgramFolders, got %T", effects[0])
	}

	if _, ok := effects[1].(BuildRuntime); !ok {
		t.Errorf("Expected second effect to be BuildRuntime, got %T", effects[1])
	}
}

func TestReducer_Error_UserStartRequested(t *testing.T) {
	state := NewProgramState("prog-1", "build-abc")
	state.State = StateError
	state.ErrorMsg = "previous error"

	nextState, effects := Reduce(state, UserStartRequested{ProgramID: "prog-1"})

	// Should transition to Building (retry)
	if nextState.State != StateBuilding {
		t.Errorf("Expected state Building, got %v", nextState.State)
	}

	// Should clear error message
	if nextState.ErrorMsg != "" {
		t.Errorf("Expected error message to be cleared, got %s", nextState.ErrorMsg)
	}

	// Should produce 2 effects
	if len(effects) != 2 {
		t.Fatalf("Expected 2 effects, got %d", len(effects))
	}
}

func TestReducer_FullSuccessFlow(t *testing.T) {
	// Test complete happy path: Created → Building → Starting → Ready → Stopping → Stopped

	state := NewProgramState("prog-1", "build-abc")

	// Created → UserStartRequested → Building
	state, effects := Reduce(state, UserStartRequested{ProgramID: "prog-1"})
	if state.State != StateBuilding {
		t.Fatalf("Expected Building, got %v", state.State)
	}
	if len(effects) != 2 {
		t.Fatalf("Expected 2 effects, got %d", len(effects))
	}

	// Building → FoldersEnsured(success) → Building (waiting)
	state, effects = Reduce(state, FoldersEnsured{Success: true})
	if state.State != StateBuilding {
		t.Fatalf("Expected Building, got %v", state.State)
	}

	// Building → BuildFinished(success) → Starting
	state, effects = Reduce(state, BuildFinished{Success: true, ImageID: "img-123"})
	if state.State != StateStarting {
		t.Fatalf("Expected Starting, got %v", state.State)
	}
	if len(effects) != 1 {
		t.Fatalf("Expected 1 effect, got %d", len(effects))
	}

	// Starting → RuntimeStarted → Ready
	state, effects = Reduce(state, RuntimeStarted{ContainerID: "container-456"})
	if state.State != StateReady {
		t.Fatalf("Expected Ready, got %v", state.State)
	}
	if state.ContainerID != "container-456" {
		t.Fatalf("Expected ContainerID container-456, got %s", state.ContainerID)
	}

	// Ready → UserStopRequested → Stopping
	state, effects = Reduce(state, UserStopRequested{ProgramID: "prog-1"})
	if state.State != StateStopping {
		t.Fatalf("Expected Stopping, got %v", state.State)
	}
	if len(effects) != 1 {
		t.Fatalf("Expected 1 effect, got %d", len(effects))
	}

	// Stopping → StopFinished(success) → Stopped
	state, effects = Reduce(state, StopFinished{Success: true})
	if state.State != StateStopped {
		t.Fatalf("Expected Stopped, got %v", state.State)
	}
}

func TestReducer_FullErrorFlow(t *testing.T) {
	// Test error path: Created → Building → Error → Building (retry)

	state := NewProgramState("prog-1", "build-abc")

	// Created → UserStartRequested → Building
	state, _ = Reduce(state, UserStartRequested{ProgramID: "prog-1"})
	if state.State != StateBuilding {
		t.Fatalf("Expected Building, got %v", state.State)
	}

	// Building → BuildFinished(failure) → Error
	state, _ = Reduce(state, BuildFinished{Success: false, Error: "build error"})
	if state.State != StateError {
		t.Fatalf("Expected Error, got %v", state.State)
	}
	if state.ErrorMsg == "" {
		t.Fatal("Expected error message to be set")
	}

	// Error → UserStartRequested → Building (retry)
	state, effects := Reduce(state, UserStartRequested{ProgramID: "prog-1"})
	if state.State != StateBuilding {
		t.Fatalf("Expected Building, got %v", state.State)
	}
	if state.ErrorMsg != "" {
		t.Fatalf("Expected error message to be cleared, got %s", state.ErrorMsg)
	}
	if len(effects) != 2 {
		t.Fatalf("Expected 2 effects, got %d", len(effects))
	}
}
