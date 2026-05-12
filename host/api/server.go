package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/proxy"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
	"github.com/google/uuid"
)

// HostServer orchestrates program lifecycle and HTTP API
type HostServer struct {
	programRegistry *registry.Registry
	proxyManager    *proxy.ProxyManager
	storage         *storage.StorageManager
	compose         *compose.Builder
	runtime         *runtime.DockerManager
	watcherCatalog  *watcherEndpointCatalog
	server          *http.Server
	effectHandlerFn func() program.EffectHandler // Factory function for creating effect handlers
	defaultRuntime  string                       // Default container runtime (runsc or runc)
	listenAddr      string                       // Bind address (e.g. 127.0.0.1, 100.x.x.x)
	apiToken        string                       // Optional bearer/API token for /programs* endpoints
	proxyAllowlist  []string                     // Optional allowlist for /programs/{id}/proxy/* paths

	// Health check loop control
	healthCtx    context.Context
	healthCancel context.CancelFunc
}

// NewHostServer creates a new host server
func NewHostServer(
	reg *registry.Registry,
	pm *proxy.ProxyManager,
	stor *storage.StorageManager,
	comp *compose.Builder,
	rt *runtime.DockerManager,
) *HostServer {
	hs := &HostServer{
		programRegistry: reg,
		proxyManager:    pm,
		storage:         stor,
		compose:         comp,
		runtime:         rt,
		watcherCatalog:  newWatcherEndpointCatalog(),
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

// SetListenAddr sets bind address for HTTP server.
// Empty value means all interfaces.
func (hs *HostServer) SetListenAddr(addr string) {
	hs.listenAddr = strings.TrimSpace(addr)
}

// SetAPIToken enables token authentication for /programs* endpoints.
// Empty value disables token auth.
func (hs *HostServer) SetAPIToken(token string) {
	hs.apiToken = strings.TrimSpace(token)
}

// SetProxyPathAllowlist restricts /programs/{id}/proxy/* paths.
// Pattern format:
// - Exact path: /watcher/watching-state
// - Prefix wildcard: /watcher/varState/*
// Empty list disables path filtering.
func (hs *HostServer) SetProxyPathAllowlist(patterns []string) {
	normalized := make([]string, 0, len(patterns))
	for _, raw := range patterns {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}
		normalized = append(normalized, p)
	}
	hs.proxyAllowlist = normalized
}

func (hs *HostServer) isProxyPathAllowed(proxyPath string) bool {
	if len(hs.proxyAllowlist) == 0 {
		return true
	}

	for _, pattern := range hs.proxyAllowlist {
		if strings.HasSuffix(pattern, "*") {
			prefix := strings.TrimSuffix(pattern, "*")
			if strings.HasPrefix(proxyPath, prefix) {
				return true
			}
			continue
		}
		if proxyPath == pattern {
			return true
		}
	}

	return false
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

	// Web UI endpoints (/ui/programs/*)
	if err := setupWebUI(mux); err != nil {
		return fmt.Errorf("failed to setup web UI: %w", err)
	}

	// Program CRUD endpoints
	mux.HandleFunc("/programs", hs.withProgramAuth(hs.handlePrograms))
	mux.HandleFunc("/programs/", hs.withProgramAuth(hs.handleProgramByID))
	mux.HandleFunc("/watcher/endpoints", hs.withProgramAuth(hs.handleWatcherEndpoints))
	mux.HandleFunc("/watcher/endpoints/", hs.withProgramAuth(hs.handleWatcherEndpoints))

	addr := fmt.Sprintf(":%d", port)
	if hs.listenAddr != "" {
		addr = net.JoinHostPort(hs.listenAddr, strconv.Itoa(port))
	}

	hs.server = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	return hs.server.ListenAndServe()
}

func (hs *HostServer) withProgramAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if hs.apiToken == "" {
			next(w, r)
			return
		}

		token := strings.TrimSpace(r.Header.Get("X-Hershy-Api-Token"))
		if token == "" {
			authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
			const bearerPrefix = "Bearer "
			if strings.HasPrefix(authHeader, bearerPrefix) {
				token = strings.TrimSpace(authHeader[len(bearerPrefix):])
			}
		}

		if token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(hs.apiToken)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			hs.sendError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		next(w, r)
	}
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
	return hs.programRegistry.GetProgram(id)
}

// GetRuntime returns the Docker runtime manager (for testing)
func (hs *HostServer) GetRuntime() *runtime.DockerManager {
	return hs.runtime
}

// handlePrograms handles /programs endpoint
func (hs *HostServer) handlePrograms(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		hs.createProgramMeta(w, r)
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
			hs.buildAndStartProgram(w, r, programID)
			return
		case "stop":
			hs.stopProgram(w, r, programID)
			return
		case "restart":
			hs.restartProgram(w, r, programID)
			return
		case "logs":
			hs.getContainerLogs(w, r, programID)
			return
		case "source":
			hs.getSourceCode(w, r, programID)
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

// createProgramMeta handles POST /programs
// 정적인 정보인 programMeta까지를 만들어 놓음.
// 동적 정보인 program은 실행 요청이 오면 만들고, 이미지빌드-컨테이너 실행함
func (hs *HostServer) createProgramMeta(w http.ResponseWriter, r *http.Request) {
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

	// Create Program supervisor (永久 보존)
	handler := hs.createEffectHandler()
	prog := program.NewProgram(programID, buildID, handler)

	// Store in Registry (최초 1회만)
	if err := hs.programRegistry.SetProgramOnce(programID, prog); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to set program: %v", err))
		return
	}

	// Start supervisor goroutine (event loop)
	ctx := context.Background()
	go func() {
		prog.Start(ctx)
	}()

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

	// Get Program supervisor (should always exist after createProgramMeta)
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusInternalServerError, "program supervisor not found")
		return
	}

	// Get real-time state from supervisor (Program never nil)
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
}

// listPrograms handles GET /programs
func (hs *HostServer) listPrograms(w http.ResponseWriter, r *http.Request) {
	metaList := hs.programRegistry.List()

	programs := make([]GetProgramResponse, 0, len(metaList))
	for _, meta := range metaList {
		proxyURL := fmt.Sprintf("http://localhost:%d", meta.PublishPort)

		// Get Program supervisor (should always exist)
		prog, exists := hs.programRegistry.GetProgram(meta.ProgramID)
		if !exists {
			// Skip programs without supervisor (shouldn't happen)
			continue
		}

		// Get real-time state from supervisor (Program never nil)
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
	}

	response := ListProgramsResponse{
		Programs: programs,
		Count:    len(programs),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// deleteProgram handles DELETE /programs/{id}
// Note: This does NOT remove the program from Registry (永久 보존)
// It only sends StopRequested event to transition to Stopped state
func (hs *HostServer) deleteProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	// Verify program exists
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusNotFound, "program not found")
		return
	}

	// Send stop event (transitions to Stopped state)
	if err := prog.SendEvent(program.UserStopRequested{ProgramID: programID}); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to send stop event: %v", err))
		return
	}

	// Remove published watcher endpoints immediately on explicit delete request.
	hs.watcherCatalog.remove(programID)

	// Program remains in Registry for restart capability
	// Files and metadata are preserved

	response := LifecycleResponse{
		ProgramID: programID,
		State:     program.StateStopping.String(),
		Message:   "program stop initiated (use Purge API to physically remove)",
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

// startHealthCheckLoop runs background health checks with single 5s interval
func (hs *HostServer) startHealthCheckLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	fmt.Println("[HealthCheck] 🚀 Starting health check (interval: 5s)")

	for {
		select {
		case <-ticker.C:
			// Check all programs with Registry state
			hs.checkAllPrograms()

		case <-hs.healthCtx.Done():
			fmt.Println("[HealthCheck] 🛑 Stopping health check loop")
			return
		}
	}
}

// checkAllPrograms checks all programs for container health
// Programs are永久保存 in Registry, so we only monitor their state
func (hs *HostServer) checkAllPrograms() {
	totalCount := 0
	readyCount := 0

	hs.programRegistry.RangeRunning(func(programID program.ProgramID, prog *program.Program) bool {
		state := prog.GetState()
		totalCount++

		// Log state transitions
		switch state.State {
		case program.StateReady:
			readyCount++

			meta, err := hs.programRegistry.Get(programID)
			if err == nil {
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				if err := hs.syncWatcherEndpointDescriptor(
					ctx,
					programID,
					meta.PublishPort,
					state.State.String(),
				); err != nil {
					fmt.Printf("[HealthCheck] watcher endpoint sync skipped for %s: %v\n", programID, err)
				}
				cancel()
			} else {
				hs.watcherCatalog.remove(programID)
			}

			// Health check Ready programs with containers
			if hs.runtime != nil && state.ContainerID != "" {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)

				status, err := hs.runtime.GetContainerStatus(ctx, state.ContainerID)
				cancel()

				if err != nil {
					fmt.Printf("[HealthCheck] ⚠️ Container %s not found: %v\n", state.ContainerID, err)
					prog.SendEvent(program.RuntimeExited{ExitCode: -1})
				} else if status != "running" {
					fmt.Printf("[HealthCheck] 📡 Container %s exited (status: %s)\n", state.ContainerID, status)
					prog.SendEvent(program.RuntimeExited{ExitCode: 0})
				}
			}

		case program.StateError:
			fmt.Printf("[HealthCheck] ❌ Program %s in Error state: %v\n", programID, state.ErrorMsg)
			hs.watcherCatalog.remove(programID)

		case program.StateStopped:
			fmt.Printf("[HealthCheck] 🛑 Program %s stopped (can be restarted)\n", programID)
			hs.watcherCatalog.remove(programID)

		default:
			hs.watcherCatalog.remove(programID)
		}

		return true
	})

	if totalCount > 0 {
		fmt.Printf("[HealthCheck] 🏥 Checked %d programs (%d ready)\n", totalCount, readyCount)
	}
}
