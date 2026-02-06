package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rlaaudgjs5638/hersh/host"
	"github.com/rlaaudgjs5638/hersh/host/compose"
	"github.com/rlaaudgjs5638/hersh/host/runtime"
	"github.com/rlaaudgjs5638/hersh/host/storage"
	"github.com/rlaaudgjs5638/hersh/program"
)

func main() {
	fmt.Println("=== Phase 1-3 Validation Example ===")

	// Create temporary directory for this example
	tmpDir, err := os.MkdirTemp("", "hersh-validation-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tmpDir)

	fmt.Printf("Working directory: %s\n", tmpDir)

	// Phase 1: Test Program domain (Reducer + Event/Effect)
	fmt.Println("\n--- Phase 1: Testing Program Domain ---")
	testProgramDomain()

	// Phase 2: Test Supervisor (Event loop + FakeEffectHandler)
	fmt.Println("\n--- Phase 2: Testing Supervisor ---")
	testSupervisor(tmpDir)

	// Phase 3: Test Host Components
	fmt.Println("\n--- Phase 3: Testing Host Components ---")
	testHostComponents(tmpDir)

	fmt.Println("\n=== All validations passed! ===")
}

func testProgramDomain() {
	// Test state machine transitions
	state := program.NewProgramState("test-prog", "build-123")

	// Created -> UserStartRequested -> Building
	nextState, effects := program.Reduce(state, program.UserStartRequested{ProgramID: "test-prog"})
	if nextState.State != program.StateBuilding {
		panic(fmt.Sprintf("Expected Building, got %v", nextState.State))
	}
	if len(effects) != 2 {
		panic(fmt.Sprintf("Expected 2 effects, got %d", len(effects)))
	}
	fmt.Println("✓ State transition: Created -> Building")

	// Building -> BuildFinished(success) -> Starting
	nextState, effects = program.Reduce(nextState, program.BuildFinished{Success: true, ImageID: "img-123"})
	if nextState.State != program.StateStarting {
		panic(fmt.Sprintf("Expected Starting, got %v", nextState.State))
	}
	if len(effects) != 1 {
		panic(fmt.Sprintf("Expected 1 effect, got %d", len(effects)))
	}
	fmt.Println("✓ State transition: Building -> Starting")

	// Starting -> RuntimeStarted -> Ready
	nextState, effects = program.Reduce(nextState, program.RuntimeStarted{ContainerID: "container-456"})
	if nextState.State != program.StateReady {
		panic(fmt.Sprintf("Expected Ready, got %v", nextState.State))
	}
	if len(effects) != 0 {
		panic(fmt.Sprintf("Expected 0 effects, got %d", len(effects)))
	}
	fmt.Println("✓ State transition: Starting -> Ready")

	// Ready -> UserStopRequested -> Stopping
	nextState, effects = program.Reduce(nextState, program.UserStopRequested{ProgramID: "test-prog"})
	if nextState.State != program.StateStopping {
		panic(fmt.Sprintf("Expected Stopping, got %v", nextState.State))
	}
	if len(effects) != 1 {
		panic(fmt.Sprintf("Expected 1 effect, got %d", len(effects)))
	}
	fmt.Println("✓ State transition: Ready -> Stopping")

	// Stopping -> StopFinished(success) -> Stopped
	nextState, effects = program.Reduce(nextState, program.StopFinished{Success: true})
	if nextState.State != program.StateStopped {
		panic(fmt.Sprintf("Expected Stopped, got %v", nextState.State))
	}
	fmt.Println("✓ State transition: Stopping -> Stopped")
}

func testSupervisor(tmpDir string) {
	// Create FakeEffectHandler
	handler := program.NewFakeEffectHandler()
	handler.Delay = 10 * time.Millisecond

	// Create Program
	prog := program.NewProgram("test-supervisor", "build-abc", handler)

	// Start supervisor
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go prog.Start(ctx)

	// Send UserStartRequested
	if err := prog.SendEvent(program.UserStartRequested{ProgramID: "test-supervisor"}); err != nil {
		panic(err)
	}
	fmt.Println("✓ Event sent: UserStartRequested")

	// Wait for Ready state
	deadline := time.Now().Add(2 * time.Second)
	for {
		state := prog.GetState()
		if state.State == program.StateReady {
			break
		}
		if state.State == program.StateError {
			panic(fmt.Sprintf("Unexpected error state: %s", state.ErrorMsg))
		}
		if time.Now().After(deadline) {
			panic(fmt.Sprintf("Timeout waiting for Ready, current: %v", state.State))
		}
		time.Sleep(50 * time.Millisecond)
	}
	fmt.Println("✓ Supervisor reached Ready state")

	// Send UserStopRequested
	if err := prog.SendEvent(program.UserStopRequested{ProgramID: "test-supervisor"}); err != nil {
		panic(err)
	}

	// Wait for Stopped state
	deadline = time.Now().Add(1 * time.Second)
	for {
		state := prog.GetState()
		if state.State == program.StateStopped {
			break
		}
		if time.Now().After(deadline) {
			panic(fmt.Sprintf("Timeout waiting for Stopped, current: %v", state.State))
		}
		time.Sleep(50 * time.Millisecond)
	}
	fmt.Println("✓ Supervisor reached Stopped state")
}

func testHostComponents(tmpDir string) {
	// Test StorageManager
	storageMgr := storage.NewManager(tmpDir)
	programID := program.ProgramID("test-storage")

	if err := storageMgr.EnsureProgramFolders(programID); err != nil {
		panic(err)
	}
	fmt.Println("✓ StorageManager: Folders created")

	// Verify directories
	expectedDirs := []string{"src", "meta", "state", "compose", "logs", "runtime"}
	for _, dir := range expectedDirs {
		path := storageMgr.GetProgramPath(programID, dir)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			panic(fmt.Sprintf("Directory not created: %s", dir))
		}
	}
	fmt.Println("✓ StorageManager: All directories verified")

	// Test ComposeBuilder
	composeMgr := compose.NewBuilder()
	spec, err := composeMgr.GenerateSpec(compose.BuildOpts{
		ProgramID: programID,
		ImageID:   "alpine:latest",
		StatePath: storageMgr.GetStatePath(programID),
	})
	if err != nil {
		panic(err)
	}
	fmt.Println("✓ ComposeBuilder: Spec generated")

	// Validate security contracts
	if err := composeMgr.ValidateSpec(spec); err != nil {
		panic(fmt.Sprintf("Spec validation failed: %v", err))
	}
	fmt.Println("✓ ComposeBuilder: Security contracts validated")

	// Verify specific contracts
	appService := spec.Services["app"]
	if appService.Runtime != "runsc" {
		panic("Runtime is not runsc")
	}
	if !appService.ReadOnly {
		panic("Root filesystem is not read-only")
	}
	if len(appService.Ports) > 0 {
		panic("Ports are exposed (should be empty)")
	}
	fmt.Println("✓ ComposeBuilder: gVisor runtime enforced")
	fmt.Println("✓ ComposeBuilder: Read-only rootfs enforced")
	fmt.Println("✓ ComposeBuilder: No external ports exposed")

	// Test RealEffectHandler (without Docker)
	// We can only test that it creates correctly
	dockerMgr, err := runtime.NewDockerManager()
	if err != nil {
		fmt.Printf("⚠ Docker not available: %v (skipping Docker tests)\n", err)
		return
	}
	defer dockerMgr.Close()
	fmt.Println("✓ DockerManager: Created successfully")

	effectHandler := host.NewRealEffectHandler(storageMgr, composeMgr, dockerMgr)
	if effectHandler == nil {
		panic("Failed to create RealEffectHandler")
	}
	fmt.Println("✓ RealEffectHandler: Created successfully")

	// Test folder creation effect
	ctx := context.Background()
	result := effectHandler.Execute(ctx, program.EnsureProgramFolders{ProgramID: "test-effect"})
	if foldersResult, ok := result.(program.FoldersEnsured); !ok || !foldersResult.Success {
		panic("EnsureProgramFolders effect failed")
	}
	fmt.Println("✓ RealEffectHandler: EnsureProgramFolders works")

	// Verify the folders were created
	if !storageMgr.ProgramExists("test-effect") {
		panic("Program folders were not created by effect handler")
	}
	fmt.Println("✓ RealEffectHandler: Folders verified")

	// Test program path getters
	srcPath := storageMgr.GetSrcPath(programID)
	if !filepath.IsAbs(srcPath) {
		panic("GetSrcPath did not return absolute path")
	}
	fmt.Println("✓ StorageManager: Path getters return absolute paths")
}
