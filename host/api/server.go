package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/proxy"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
)

// HostServer orchestrates program lifecycle and HTTP API
type HostServer struct {
	programRegistry *registry.Registry
	proxyManager    *proxy.ProxyManager
	storage         *storage.Manager
	compose         *compose.Builder
	runtime         *runtime.DockerManager
	runningPrograms *sync.Map // program.ProgramID -> *program.Program (all running programs)
	readyPrograms   *sync.Map // program.ProgramID -> *program.Program (Ready state only, for slow health check)
	server          *http.Server
	effectHandlerFn func() program.EffectHandler // Factory function for creating effect handlers
	defaultRuntime  string                       // Default container runtime (runsc or runc)

	// Health check loop control
	healthCtx    context.Context
	healthCancel context.CancelFunc
 }

// NewHostServer creates a new host server
func NewHostServer(
	reg *registry.Registry,
	pm *proxy.ProxyManager,
	stor *storage.Manager,
	comp *compose.Builder,
	rt *runtime.DockerManager,
) *HostServer {
	runningProgs := &sync.Map{}
	readyProgs := &sync.Map{}

	hs := &HostServer{
		programRegistry: reg,
		proxyManager:    pm,
		storage:         stor,
		compose:         comp,
		runtime:         rt,
		runningPrograms: runningProgs,
		readyPrograms:   readyProgs,
		defaultRuntime:  "runc", // Default to runc, can be changed via SetDefaultRuntime
	}

	// Start health check loop
	hs.healthCtx, hs.healthCancel = context.WithCancel(context.Background())
	go hs.startHealthCheckLoop()

	return hs
}

// SetEffectHandlerFactory sets the factory function for creating effect handlers
func (hs *HostServer) SetEffectHandlerFactory(fn func() program.EffectHandler) {
	hs.effectHandlerFn = fn
}

// SetDefaultRuntime sets the default container runtime (runsc or runc)
func (hs *HostServer) SetDefaultRuntime(runtime string) {
	hs.defaultRuntime = runtime
}

// createEffectHandler creates a new effect handler using the factory function
func (hs *HostServer) createEffectHandler() program.EffectHandler {
	if hs.effectHandlerFn != nil {
		return hs.effectHandlerFn()
	}
	// Fallback: create default fake handler for testing
	return &program.FakeEffectHandler{}
}

// Start starts the HTTP API server
func (hs *HostServer) Start(port int) error {
	mux := http.NewServeMux()

	// Program CRUD endpoints
	mux.HandleFunc("/programs", hs.handlePrograms)
	mux.HandleFunc("/programs/", hs.handleProgramByID)

	hs.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	return hs.server.ListenAndServe()
}

// Stop stops the HTTP API server
func (hs *HostServer) Stop(ctx context.Context) error {
	// Stop health check loop
	hs.healthCancel()

	// Then stop HTTP server
	return hs.server.Shutdown(ctx)
}

// GetProgram returns the program supervisor for a given program ID (for testing)
func (hs *HostServer) GetProgram(id program.ProgramID) (*program.Program, bool) {
	value, exists := hs.runningPrograms.Load(id)
	if !exists {
		return nil, false
	}
	return value.(*program.Program), true
}

// GetRuntime returns the Docker runtime manager (for testing)
func (hs *HostServer) GetRuntime() *runtime.DockerManager {
	return hs.runtime
}

// handlePrograms handles /programs endpoint
func (hs *HostServer) handlePrograms(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		hs.createProgram(w, r)
	case http.MethodGet:
		hs.listPrograms(w, r)
	default:
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleProgramByID handles /programs/{id} endpoint and sub-routes
func (hs *HostServer) handleProgramByID(w http.ResponseWriter, r *http.Request) {
	// Extract program ID from path
	path := strings.TrimPrefix(r.URL.Path, "/programs/")
	parts := strings.SplitN(path, "/", 2)
	programID := program.ProgramID(parts[0])

	// Check if it's a proxy request
	if len(parts) > 1 && strings.HasPrefix(parts[1], "proxy") {
		// Extract proxy path (everything after /programs/{id}/proxy)
		proxyPath := strings.TrimPrefix(r.URL.Path, fmt.Sprintf("/programs/%s/proxy", programID))
		hs.handleProxy(w, r, programID, proxyPath)
		return
	}

	// Check if it's a lifecycle operation
	if len(parts) > 1 {
		action := parts[1]
		switch action {
		case "start":
			hs.startProgram(w, r, programID)
			return
		case "stop":
			hs.stopProgram(w, r, programID)
			return
		case "restart":
			hs.restartProgram(w, r, programID)
			return
		}
	}

	// Otherwise, it's a single program operation
	switch r.Method {
	case http.MethodGet:
		hs.getProgram(w, r, programID)
	case http.MethodDelete:
		hs.deleteProgram(w, r, programID)
	default:
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// createProgram handles POST /programs
func (hs *HostServer) createProgram(w http.ResponseWriter, r *http.Request) {
	var req CreateProgramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hs.sendError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	// Validate request
	if req.UserID == "" {
		hs.sendError(w, http.StatusBadRequest, "user_id is required")
		return
	}
	if req.Dockerfile == "" {
		hs.sendError(w, http.StatusBadRequest, "dockerfile is required")
		return
	}

	// Generate BuildID (hash of Dockerfile + src files)
	buildID := hs.generateBuildID(req.Dockerfile, req.SrcFiles)

	// Generate ProgramID (userID-buildID-uuid)
	programUUID := uuid.New().String()[:8]
	programID := program.ProgramID(fmt.Sprintf("%s-%s-%s", req.UserID, buildID, programUUID))

	// Register program in registry (immutable metadata only)
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    req.UserID,
	}

	if err := hs.programRegistry.Register(meta); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to register program: %v", err))
		return
	}

	// Get assigned publish port
	registered, _ := hs.programRegistry.Get(programID)
	proxyURL := fmt.Sprintf("http://localhost:%d", registered.PublishPort)

	// Write source files to storage
	if err := hs.storage.EnsureProgramFolders(programID); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create folders: %v", err))
		return
	}

	srcPath := hs.storage.GetSrcPath(programID)
	for filename, content := range req.SrcFiles {
		filePath := filepath.Join(srcPath, filename)
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to write file: %v", err))
			return
		}
	}

	// Write Dockerfile
	dockerfilePath := filepath.Join(srcPath, "Dockerfile")
	if err := os.WriteFile(dockerfilePath, []byte(req.Dockerfile), 0644); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to write Dockerfile: %v", err))
		return
	}

	// Send response
	response := CreateProgramResponse{
		ProgramID: programID,
		BuildID:   buildID,
		State:     program.StateCreated.String(),
		ProxyURL:  proxyURL,
		CreatedAt: registered.CreatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// getProgram handles GET /programs/{id}
func (hs *HostServer) getProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	// Get metadata from registry
	meta, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	proxyURL := fmt.Sprintf("http://localhost:%d", meta.PublishPort)

	// Check if program is running (has active supervisor)
	value, isRunning := hs.runningPrograms.Load(programID)

	if isRunning {
		// Running program: get real-time state from supervisor
		prog := value.(*program.Program)
		state := prog.GetState()

		response := GetProgramResponse{
			ProgramID:   state.ID,
			BuildID:     state.BuildID,
			UserID:      meta.UserID,
			State:       state.State.String(),
			ImageID:     state.ImageID,
			ContainerID: state.ContainerID,
			ErrorMsg:    state.ErrorMsg,
			ProxyURL:    proxyURL,
			CreatedAt:   meta.CreatedAt,
			UpdatedAt:   time.Now(), // Real-time query
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Not running: return created state (registry metadata only)
	response := GetProgramResponse{
		ProgramID:   meta.ProgramID,
		BuildID:     meta.BuildID,
		UserID:      meta.UserID,
		State:       "created", // Fixed value
		ImageID:     "",
		ContainerID: "",
		ErrorMsg:    "",
		ProxyURL:    proxyURL,
		CreatedAt:   meta.CreatedAt,
		UpdatedAt:   meta.CreatedAt, // Same as created
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// listPrograms handles GET /programs
func (hs *HostServer) listPrograms(w http.ResponseWriter, r *http.Request) {
	metaList := hs.programRegistry.List()

	programs := make([]GetProgramResponse, 0, len(metaList))
	for _, meta := range metaList {
		proxyURL := fmt.Sprintf("http://localhost:%d", meta.PublishPort)

		// Check if program is running for real-time state
		value, isRunning := hs.runningPrograms.Load(meta.ProgramID)

		if isRunning {
			// Running: get real-time state
			prog := value.(*program.Program)
			state := prog.GetState()

			programs = append(programs, GetProgramResponse{
				ProgramID:   state.ID,
				BuildID:     state.BuildID,
				UserID:      meta.UserID,
				State:       state.State.String(),
				ImageID:     state.ImageID,
				ContainerID: state.ContainerID,
				ErrorMsg:    state.ErrorMsg,
				ProxyURL:    proxyURL,
				CreatedAt:   meta.CreatedAt,
				UpdatedAt:   time.Now(),
			})
		} else {
			// Not running: created state
			programs = append(programs, GetProgramResponse{
				ProgramID:   meta.ProgramID,
				BuildID:     meta.BuildID,
				UserID:      meta.UserID,
				State:       "created",
				ImageID:     "",
				ContainerID: "",
				ErrorMsg:    "",
				ProxyURL:    proxyURL,
				CreatedAt:   meta.CreatedAt,
				UpdatedAt:   meta.CreatedAt,
			})
		}
	}

	response := ListProgramsResponse{
		Programs: programs,
		Count:    len(programs),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// deleteProgram handles DELETE /programs/{id}
func (hs *HostServer) deleteProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	// Verify program exists
	if !hs.programRegistry.Exists(programID) {
		hs.sendError(w, http.StatusNotFound, "program not found")
		return
	}

	// Stop program if running
	if value, exists := hs.runningPrograms.Load(programID); exists {
		prog := value.(*program.Program)
		prog.SendEvent(program.UserStopRequested{ProgramID: programID})

		// Wait a bit for graceful shutdown
		time.Sleep(5 * time.Second)

		// HealthMonitor will handle cleanup automatically
	}

	// No proxy cleanup needed - container publishes directly

	// Delete program files
	if err := hs.storage.DeleteProgram(programID); err != nil {
		// Log but don't fail
	}

	// Unregister from registry (releases port)
	if err := hs.programRegistry.Delete(programID); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete program: %v", err))
		return
	}

	response := LifecycleResponse{
		ProgramID: programID,
		State:     "deleted",
		Message:   "program deleted successfully",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// generateBuildID generates a build ID from Dockerfile and source files
func (hs *HostServer) generateBuildID(dockerfile string, srcFiles map[string]string) program.BuildID {
	hasher := sha256.New()
	hasher.Write([]byte(dockerfile))
	for filename, content := range srcFiles {
		hasher.Write([]byte(filename))
		hasher.Write([]byte(content))
	}
	hash := hex.EncodeToString(hasher.Sum(nil))
	return program.BuildID("build-" + hash[:12])
}

// sendError sends an error response
func (hs *HostServer) sendError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   http.StatusText(code),
		Code:    code,
		Message: message,
	})
}

// Health check methods

// startHealthCheckLoop runs background health checks with dual-interval strategy
func (hs *HostServer) startHealthCheckLoop() {
	fastTicker := time.NewTicker(100 * time.Millisecond)
	slowTicker := time.NewTicker(5 * time.Second)
	defer fastTicker.Stop()
	defer slowTicker.Stop()

	fmt.Println("[HealthCheck] 🚀 Starting dual-interval health check (fast: 100ms, slow: 5s)")

	for {
		select {
		case <-fastTicker.C:
			// Fast check: runningPrograms for non-Ready programs
			toCleanup := hs.checkNonReadyPrograms()
			if len(toCleanup) > 0 {
				hs.cleanupPrograms(toCleanup)
			}

		case <-slowTicker.C:
			// Slow check: readyPrograms for container health
			toCleanup := hs.checkReadyPrograms()
			if len(toCleanup) > 0 {
				hs.cleanupPrograms(toCleanup)
			}

		case <-hs.healthCtx.Done():
			fmt.Println("[HealthCheck] 🛑 Stopping health check loop")
			return
		}
	}
}

// checkNonReadyPrograms checks programs in runningPrograms for Ready transition or cleanup
func (hs *HostServer) checkNonReadyPrograms() []program.ProgramID {
	var toCleanup []program.ProgramID
	checkCount := 0

	hs.runningPrograms.Range(func(key, value interface{}) bool {
		programID := key.(program.ProgramID)
		prog := value.(*program.Program)
		state := prog.GetState()
		checkCount++

		// DEBUG: 모든 프로그램 상태 로깅
		fmt.Printf("[HealthCheck-DEBUG] Checking %s: State=%s, ImageID=%s, ContainerID=%s, Error=%v\n",
			programID, state.State, state.ImageID, state.ContainerID, state.ErrorMsg)

		// Ready 도달 → readyPrograms로 이동
		if state.State == program.StateReady {
			hs.readyPrograms.Store(programID, prog)
			fmt.Printf("[HealthCheck] ✅ Program %s reached Ready state\n", programID)
			return true
		}

		// Error/Stopped → cleanup 대상
		if state.State == program.StateError || state.State == program.StateStopped {
			fmt.Printf("[HealthCheck-CLEANUP] ❌ Program %s marked for cleanup: State=%s, Error=%v\n",
				programID, state.State, state.ErrorMsg)
			toCleanup = append(toCleanup, programID)
		}

		return true
	})

	if checkCount > 0 {
		fmt.Printf("[HealthCheck-DEBUG] Checked %d non-ready programs, %d marked for cleanup\n", checkCount, len(toCleanup))
	}

	return toCleanup
}

// checkReadyPrograms checks Ready programs for container health
func (hs *HostServer) checkReadyPrograms() []program.ProgramID {
	var toCleanup []program.ProgramID
	readyCount := 0

	hs.readyPrograms.Range(func(key, value interface{}) bool {
		programID := key.(program.ProgramID)
		prog := value.(*program.Program)
		state := prog.GetState()

		// Ready 벗어남 → readyPrograms에서 제거
		if state.State != program.StateReady {
			hs.readyPrograms.Delete(programID)
			fmt.Printf("[HealthCheck] ⚠️ Program %s left Ready state: %s\n", programID, state.State)

			if state.State == program.StateError || state.State == program.StateStopped {
				toCleanup = append(toCleanup, programID)
			}
			return true
		}

		readyCount++

		// 컨테이너 헬스체크
		if state.ContainerID == "" {
			fmt.Printf("[HealthCheck] ⚠️ Ready program %s has no containerID\n", programID)
			return true
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		status, err := hs.runtime.GetContainerStatus(ctx, state.ContainerID)

		if err != nil {
			fmt.Printf("[HealthCheck] ⚠️ Container %s not found: %v\n", state.ContainerID, err)
			prog.SendEvent(program.RuntimeExited{ExitCode: -1})
			toCleanup = append(toCleanup, programID)
		} else if status != "running" {
			fmt.Printf("[HealthCheck] 📡 Container %s has exited (status: %s)\n", state.ContainerID, status)
			prog.SendEvent(program.RuntimeExited{ExitCode: 0})
			toCleanup = append(toCleanup, programID)
		}

		return true
	})

	if readyCount > 0 {
		fmt.Printf("[HealthCheck] 🏥 Health checked %d ready programs\n", readyCount)
	}

	return toCleanup
}

// cleanupPrograms removes programs from runningPrograms and readyPrograms
func (hs *HostServer) cleanupPrograms(programIDs []program.ProgramID) {
	for _, programID := range programIDs {
		// runningPrograms에서 제거
		hs.runningPrograms.Delete(programID)

		// readyPrograms에서도 제거 (있을 경우)
		hs.readyPrograms.Delete(programID)

		fmt.Printf("[HealthCheck] 🧹 Cleaned up %s from running/ready programs\n", programID)
	}

	if len(programIDs) > 0 {
		fmt.Printf("[HealthCheck] ✅ Total cleaned up: %d programs\n", len(programIDs))
	}
}
