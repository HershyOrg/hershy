package host

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
)

// RealEffectHandler implements program.EffectHandler using real Docker and filesystem operations
type RealEffectHandler struct {
	storage        *storage.Manager
	compose        *compose.Builder
	runtime        *runtime.DockerManager
	defaultRuntime string // Default container runtime (runsc or runc)
}

// NewRealEffectHandler creates a new RealEffectHandler
func NewRealEffectHandler(storage *storage.Manager, compose *compose.Builder, runtime *runtime.DockerManager) *RealEffectHandler {
	return &RealEffectHandler{
		storage:        storage,
		compose:        compose,
		runtime:        runtime,
		defaultRuntime: "runsc", // Default to gVisor
	}
}

// SetDefaultRuntime sets the default container runtime
func (h *RealEffectHandler) SetDefaultRuntime(runtime string) {
	h.defaultRuntime = runtime
}

// Execute implements program.EffectHandler
func (h *RealEffectHandler) Execute(ctx context.Context, eff program.Effect) program.Event {
	switch e := eff.(type) {
	case program.EnsureProgramFolders:
		return h.handleEnsureProgramFolders(ctx, e)

	case program.BuildRuntime:
		return h.handleBuildRuntime(ctx, e)

	case program.StartRuntime:
		return h.handleStartRuntime(ctx, e)

	case program.StopRuntime:
		return h.handleStopRuntime(ctx, e)

	case program.FetchRuntimeStatus:
		return h.handleFetchRuntimeStatus(ctx, e)

	default:
		// Unknown effect type, return nil
		return nil
	}
}

// handleEnsureProgramFolders creates program directory structure
func (h *RealEffectHandler) handleEnsureProgramFolders(ctx context.Context, eff program.EnsureProgramFolders) program.Event {
	if err := h.storage.EnsureProgramFolders(eff.ProgramID); err != nil {
		return program.FoldersEnsured{
			Success: false,
			Error:   err.Error(),
		}
	}

	return program.FoldersEnsured{
		Success: true,
	}
}

// handleBuildRuntime builds Docker image from source
func (h *RealEffectHandler) handleBuildRuntime(ctx context.Context, eff program.BuildRuntime) program.Event {
	// Determine source path
	srcPath := eff.SrcPath
	if srcPath == "" {
		srcPath = h.storage.GetSrcPath(eff.ProgramID)
	}

	// Determine Dockerfile path
	dockerfilePath := eff.Dockerfile
	if dockerfilePath == "" {
		dockerfilePath = filepath.Join(srcPath, "Dockerfile")
	}

	// Prepare build tags
	tags := []string{
		string(eff.BuildID),
		fmt.Sprintf("%s:latest", eff.ProgramID),
	}

	// Build options
	buildOpts := runtime.BuildOpts{
		BuildID:      eff.BuildID,
		ContextPath:  srcPath,
		Dockerfile:   dockerfilePath,
		Tags:         tags,
		NoCache:      false,
		PullParent:   true,
		BuildLogPath: filepath.Join(h.storage.GetLogsPath(eff.ProgramID), "build.log"),
	}

	// Execute build
	result, err := h.runtime.Build(ctx, buildOpts)
	if err != nil {
		return program.BuildFinished{
			Success: false,
			Error:   err.Error(),
		}
	}

	return program.BuildFinished{
		Success: true,
		ImageID: result.ImageID,
	}
}

// handleStartRuntime starts container from built image
func (h *RealEffectHandler) handleStartRuntime(ctx context.Context, eff program.StartRuntime) program.Event {
	fmt.Printf("[EFFECT] StartRuntime for %s (image: %s)\n", eff.ProgramID, eff.ImageID)

	// Get state path
	statePath := eff.StatePath
	if statePath == "" {
		statePath = h.storage.GetStatePath(eff.ProgramID)
	}
	fmt.Printf("[EFFECT]   State path: %s\n", statePath)

	// Generate compose spec with security contracts
	composeOpts := compose.BuildOpts{
		ProgramID:   eff.ProgramID,
		ImageID:     eff.ImageID,
		StatePath:   statePath,
		NetworkMode: "bridge", // Use bridge network for container-to-host communication
		Runtime:     h.defaultRuntime,
	}
	fmt.Printf("[EFFECT]   Compose opts: runtime=%s, network=%s\n", composeOpts.Runtime, composeOpts.NetworkMode)

	spec, err := h.compose.GenerateSpec(composeOpts)
	if err != nil {
		errMsg := fmt.Sprintf("failed to generate compose spec: %v", err)
		fmt.Printf("[EFFECT] ❌ %s\n", errMsg)
		return program.StartFailed{
			Reason: errMsg,
		}
	}
	fmt.Printf("[EFFECT] ✅ Compose spec generated\n")

	// Validate spec against security contracts
	if err := h.compose.ValidateSpec(spec); err != nil {
		errMsg := fmt.Sprintf("compose spec validation failed: %v", err)
		fmt.Printf("[EFFECT] ❌ %s\n", errMsg)
		return program.StartFailed{
			Reason: errMsg,
		}
	}
	fmt.Printf("[EFFECT] ✅ Compose spec validated\n")

	// Start container
	startOpts := runtime.StartOpts{
		ProgramID: eff.ProgramID,
		Spec:      spec,
	}

	fmt.Printf("[EFFECT]   Starting Docker container...\n")
	result, err := h.runtime.Start(ctx, startOpts)
	if err != nil {
		errMsg := fmt.Sprintf("Docker container start failed: %v", err)
		fmt.Printf("[EFFECT] ❌ %s\n", errMsg)
		return program.StartFailed{
			Reason: errMsg,
		}
	}

	fmt.Printf("[EFFECT] ✅ Container started: %s\n", result.ContainerID)
	return program.RuntimeStarted{
		ContainerID: result.ContainerID,
	}
}

// handleStopRuntime stops and removes container
func (h *RealEffectHandler) handleStopRuntime(ctx context.Context, eff program.StopRuntime) program.Event {
	if err := h.runtime.Stop(ctx, eff.ContainerID); err != nil {
		return program.StopFinished{
			Success: false,
			Error:   err.Error(),
		}
	}

	return program.StopFinished{
		Success: true,
	}
}

// handleFetchRuntimeStatus fetches container status
func (h *RealEffectHandler) handleFetchRuntimeStatus(ctx context.Context, eff program.FetchRuntimeStatus) program.Event {
	status, err := h.runtime.GetContainerStatus(ctx, eff.ContainerID)
	if err != nil {
		// Container not found or error
		return program.RuntimeExited{
			ExitCode: -1,
		}
	}

	// Check if container has exited
	if status != "running" {
		return program.RuntimeExited{
			ExitCode: 0, // We don't have exit code info in this simple implementation
		}
	}

	// Container is still running, return nil (no event)
	return nil
}
