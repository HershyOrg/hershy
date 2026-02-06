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
	runningPrograms map[program.ProgramID]*program.Program // Running program supervisors
	mu              sync.RWMutex
	server          *http.Server
	effectHandlerFn func() program.EffectHandler // Factory function for creating effect handlers
	defaultRuntime  string                       // Default container runtime (runsc or runc)
}

// NewHostServer creates a new host server
func NewHostServer(
	reg *registry.Registry,
	pm *proxy.ProxyManager,
	stor *storage.Manager,
	comp *compose.Builder,
	rt *runtime.DockerManager,
) *HostServer {
	return &HostServer{
		programRegistry: reg,
		proxyManager:    pm,
		storage:         stor,
		compose:         comp,
		runtime:         rt,
		runningPrograms: make(map[program.ProgramID]*program.Program),
		defaultRuntime:  "runc", // Default to runc, can be changed via SetDefaultRuntime
	}
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

	// Debug endpoints
	mux.HandleFunc("/debug/proxy/", hs.handleDebugProxy)

	hs.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	return hs.server.ListenAndServe()
}

// Stop stops the HTTP API server
func (hs *HostServer) Stop(ctx context.Context) error {
	return hs.server.Shutdown(ctx)
}

// GetProgram returns the program supervisor for a given program ID (for testing)
func (hs *HostServer) GetProgram(id program.ProgramID) (*program.Program, bool) {
	hs.mu.RLock()
	defer hs.mu.RUnlock()
	prog, exists := hs.runningPrograms[id]
	return prog, exists
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

	// Register program in registry
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    req.UserID,
		State:     program.StateCreated,
	}

	if err := hs.programRegistry.Register(meta); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to register program: %v", err))
		return
	}

	// Get assigned proxy port
	registered, _ := hs.programRegistry.Get(programID)
	proxyURL := fmt.Sprintf("http://localhost:%d", registered.ProxyPort)

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
	// First check if program is running (has active supervisor)
	hs.mu.RLock()
	prog, isRunning := hs.runningPrograms[programID]
	hs.mu.RUnlock()

	// Get metadata from registry
	meta, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	// If program is running, get real-time state from supervisor
	if isRunning {
		state := prog.GetState()

		// Update response with live state
		proxyURL := fmt.Sprintf("http://localhost:%d", meta.ProxyPort)
		response := GetProgramResponse{
			ProgramID:   state.ID,
			BuildID:     state.BuildID,
			UserID:      meta.UserID,
			State:       state.State.String(),
			ImageID:     state.ImageID,
			ContainerID: state.ContainerID,
			ProxyURL:    proxyURL,
			ErrorMsg:    state.ErrorMsg,
			CreatedAt:   meta.CreatedAt,
			UpdatedAt:   meta.UpdatedAt,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Program not running, return registry data
	proxyURL := fmt.Sprintf("http://localhost:%d", meta.ProxyPort)

	response := GetProgramResponse{
		ProgramID:   meta.ProgramID,
		BuildID:     meta.BuildID,
		UserID:      meta.UserID,
		State:       meta.State.String(),
		ImageID:     meta.ImageID,
		ContainerID: meta.ContainerID,
		ProxyURL:    proxyURL,
		ErrorMsg:    meta.ErrorMsg,
		CreatedAt:   meta.CreatedAt,
		UpdatedAt:   meta.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// listPrograms handles GET /programs
func (hs *HostServer) listPrograms(w http.ResponseWriter, r *http.Request) {
	metaList := hs.programRegistry.List()

	programs := make([]GetProgramResponse, 0, len(metaList))
	for _, meta := range metaList {
		proxyURL := fmt.Sprintf("http://localhost:%d", meta.ProxyPort)
		programs = append(programs, GetProgramResponse{
			ProgramID:   meta.ProgramID,
			BuildID:     meta.BuildID,
			UserID:      meta.UserID,
			State:       meta.State.String(),
			ImageID:     meta.ImageID,
			ContainerID: meta.ContainerID,
			ProxyURL:    proxyURL,
			ErrorMsg:    meta.ErrorMsg,
			CreatedAt:   meta.CreatedAt,
			UpdatedAt:   meta.UpdatedAt,
		})
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
	// Get program metadata
	meta, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	// Stop program if running
	hs.mu.Lock()
	if prog, exists := hs.runningPrograms[programID]; exists {
		prog.SendEvent(program.UserStopRequested{ProgramID: programID})
		//TODO 굉장히 위험.
		// Wait a bit for graceful shutdown
		time.Sleep(10 * time.Second)
		delete(hs.runningPrograms, programID)
	}
	hs.mu.Unlock()

	// Stop and remove proxy
	if err := hs.proxyManager.Remove(programID); err != nil {
		// Log but don't fail
	}

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
		State:     meta.State.String(),
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
