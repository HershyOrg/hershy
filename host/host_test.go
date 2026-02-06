//go:build integration
// +build integration

package host

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
)

func TestRealEffectHandler_FullLifecycle(t *testing.T) {
	// Skip if Docker is not available
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	// Create temporary directory for test
	tmpDir, err := os.MkdirTemp("", "hersh-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create storage manager
	storageMgr := storage.NewManager(tmpDir)

	// Create compose builder
	composeMgr := compose.NewBuilder()

	// Create Docker manager
	dockerMgr, err := runtime.NewDockerManager()
	if err != nil {
		t.Fatalf("Failed to create Docker manager: %v", err)
	}
	defer dockerMgr.Close()

	// Create effect handler
	handler := NewRealEffectHandler(storageMgr, composeMgr, dockerMgr)
	// Use runc for integration testing (gVisor may not be installed)
	handler.SetDefaultRuntime("runc")

	// Create test program
	programID := program.ProgramID("test-prog-integration")
	buildID := program.BuildID("build-test-123")

	// Create program instance
	prog := program.NewProgram(programID, buildID, handler)

	// Create test Dockerfile and source
	srcPath := storageMgr.GetSrcPath(programID)
	os.MkdirAll(srcPath, 0755)

	// Write a simple Dockerfile
	dockerfileContent := `FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY . .
CMD ["sleep", "3600"]
`
	if err := os.WriteFile(filepath.Join(srcPath, "Dockerfile"), []byte(dockerfileContent), 0644); err != nil {
		t.Fatalf("Failed to write Dockerfile: %v", err)
	}

	// Write a dummy file
	if err := os.WriteFile(filepath.Join(srcPath, "test.txt"), []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Start program supervisor
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	go prog.Start(ctx)

	// Send start event
	if err := prog.SendEvent(program.UserStartRequested{ProgramID: programID}); err != nil {
		t.Fatalf("Failed to send start event: %v", err)
	}

	// Wait for Ready state (this may take a while due to Docker build)
	deadline := time.Now().Add(3 * time.Minute)
	for {
		state := prog.GetState()
		if state.State == program.StateReady {
			t.Logf("Program reached Ready state")
			break
		}
		if state.State == program.StateError {
			t.Fatalf("Program entered Error state: %s", state.ErrorMsg)
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Ready state, current state: %v", state.State)
		}
		time.Sleep(2 * time.Second)
	}

	// Verify state
	state := prog.GetState()
	if state.State != program.StateReady {
		t.Errorf("Expected Ready state, got %v", state.State)
	}
	if state.ImageID == "" {
		t.Error("Expected ImageID to be set")
	}
	if state.ContainerID == "" {
		t.Error("Expected ContainerID to be set")
	}

	// Verify container is running
	running, err := dockerMgr.IsContainerRunning(ctx, state.ContainerID)
	if err != nil {
		t.Errorf("Failed to check container status: %v", err)
	}
	if !running {
		t.Error("Expected container to be running")
	}

	// Send stop event
	if err := prog.SendEvent(program.UserStopRequested{ProgramID: programID}); err != nil {
		t.Fatalf("Failed to send stop event: %v", err)
	}

	// Wait for Stopped state
	deadline = time.Now().Add(30 * time.Second)
	for {
		state := prog.GetState()
		if state.State == program.StateStopped {
			t.Logf("Program reached Stopped state")
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Timeout waiting for Stopped state, current state: %v", state.State)
		}
		time.Sleep(1 * time.Second)
	}

	// Verify final state
	state = prog.GetState()
	if state.State != program.StateStopped {
		t.Errorf("Expected Stopped state, got %v", state.State)
	}
}

func TestComposeBuilder_ValidateContracts(t *testing.T) {
	builder := compose.NewBuilder()

	t.Run("Valid spec", func(t *testing.T) {
		spec, err := builder.GenerateSpec(compose.BuildOpts{
			ProgramID: "test-prog",
			ImageID:   "alpine:latest",
			StatePath: "/tmp/state",
		})
		if err != nil {
			t.Fatalf("Failed to generate spec: %v", err)
		}

		if err := builder.ValidateSpec(spec); err != nil {
			t.Errorf("Validation failed for valid spec: %v", err)
		}
	})

	t.Run("Port 8080 published", func(t *testing.T) {
		spec, _ := builder.GenerateSpec(compose.BuildOpts{
			ProgramID: "test-prog",
			ImageID:   "alpine:latest",
			StatePath: "/tmp/state",
		})

		// Violate contract: publish port 8080
		appService := spec.Services["app"]
		appService.Ports = []string{"8080:8080"}
		spec.Services["app"] = appService

		if err := builder.ValidateSpec(spec); err != compose.ErrPort8080Published {
			t.Errorf("Expected ErrPort8080Published, got %v", err)
		}
	})

	t.Run("Invalid runtime", func(t *testing.T) {
		spec, _ := builder.GenerateSpec(compose.BuildOpts{
			ProgramID: "test-prog",
			ImageID:   "alpine:latest",
			StatePath: "/tmp/state",
		})

		// Violate contract: use invalid runtime
		appService := spec.Services["app"]
		appService.Runtime = "invalid"
		spec.Services["app"] = appService

		if err := builder.ValidateSpec(spec); err != compose.ErrInvalidRuntime {
			t.Errorf("Expected ErrInvalidRuntime, got %v", err)
		}
	})

	t.Run("Root filesystem not read-only", func(t *testing.T) {
		spec, _ := builder.GenerateSpec(compose.BuildOpts{
			ProgramID: "test-prog",
			ImageID:   "alpine:latest",
			StatePath: "/tmp/state",
		})

		// Violate contract: make root filesystem writable
		appService := spec.Services["app"]
		appService.ReadOnly = false
		spec.Services["app"] = appService

		if err := builder.ValidateSpec(spec); err != compose.ErrRootFsNotReadOnly {
			t.Errorf("Expected ErrRootFsNotReadOnly, got %v", err)
		}
	})
}

func TestStorageManager(t *testing.T) {
	// Create temporary directory
	tmpDir, err := os.MkdirTemp("", "hersh-storage-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	manager := storage.NewManager(tmpDir)

	programID := program.ProgramID("test-storage-prog")

	// Test EnsureProgramFolders
	if err := manager.EnsureProgramFolders(programID); err != nil {
		t.Fatalf("Failed to ensure program folders: %v", err)
	}

	// Verify directories were created
	expectedDirs := []string{"src", "meta", "state", "compose", "logs", "runtime"}
	for _, dir := range expectedDirs {
		path := manager.GetProgramPath(programID, dir)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Directory %s was not created", dir)
		}
	}

	// Test ProgramExists
	if !manager.ProgramExists(programID) {
		t.Error("ProgramExists returned false for existing program")
	}

	// Test DeleteProgram
	if err := manager.DeleteProgram(programID); err != nil {
		t.Fatalf("Failed to delete program: %v", err)
	}

	if manager.ProgramExists(programID) {
		t.Error("ProgramExists returned true after deletion")
	}
}
