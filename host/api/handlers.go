package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/program"
)

// buildAndStartProgram handles POST /programs/{id}/start
// Program은 동적인 정보이므로, 시작 요청을 받으면 그때 생성 후 리듀서루틴 시작함.
func (hs *HostServer) buildAndStartProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	if r.Method != http.MethodPost {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Check if program exists
	meta, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	// Get existing Program (created in createProgramMeta)
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusInternalServerError, "program not registered")
		return
	}

	// Check current state
	state := prog.GetState()
	if state.State != program.StateCreated && state.State != program.StateStopped {
		hs.sendError(w, http.StatusConflict, fmt.Sprintf("program cannot start from state: %s", state.State))
		return
	}

	// Send start event with publish port
	fmt.Printf("[START] Sending UserStartRequested for %s (port: %d)\n", programID, meta.PublishPort)
	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: meta.PublishPort,
	}); err != nil {
		fmt.Printf("[START-ERROR] Failed to send start event for %s: %v\n", programID, err)
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to start program: %v", err))
		return
	}

	// Reset published watcher endpoints until new runtime state is discovered.
	hs.watcherCatalog.remove(programID)

	// Health check loop will automatically detect and monitor this program

	response := LifecycleResponse{
		ProgramID: programID,
		State:     "starting",
		Message:   "program start initiated",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// stopProgram handles POST /programs/{id}/stop
func (hs *HostServer) stopProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	if r.Method != http.MethodPost {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Check if program is running
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}

	// Send stop event
	stopEvent := program.UserStopRequested{ProgramID: programID}
	if err := prog.SendEvent(stopEvent); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to send stop event: %v", err))
		return
	}

	// Remove published watcher endpoints immediately on explicit stop request.
	hs.watcherCatalog.remove(programID)

	// HealthMonitor will handle cleanup automatically after detecting Stopped state

	response := LifecycleResponse{
		ProgramID: programID,
		State:     program.StateStopping.String(),
		Message:   "program stop initiated",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// restartProgram handles POST /programs/{id}/restart
func (hs *HostServer) restartProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	if r.Method != http.MethodPost {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Check if program is running
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}

	// Send restart event
	if err := prog.SendEvent(program.UserRestartRequested{ProgramID: programID}); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to restart program: %v", err))
		return
	}

	// Remove published watcher endpoints while restart is in progress.
	hs.watcherCatalog.remove(programID)

	response := LifecycleResponse{
		ProgramID: programID,
		State:     program.StateStopping.String(),
		Message:   "program restart initiated",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleProxy handles requests to /programs/{id}/proxy/*
// Direct proxy to container's published localhost port
func (hs *HostServer) handleProxy(w http.ResponseWriter, r *http.Request, programID program.ProgramID, proxyPath string) {
	// Get program metadata for publish port
	meta, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	// Check if program is running and in Ready state
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusServiceUnavailable, "program not running")
		return
	}
	state := prog.GetState()
	if state.State != program.StateReady {
		hs.sendError(w, http.StatusServiceUnavailable, fmt.Sprintf("program not ready (current state: %s)", state.State))
		return
	}

	if !hs.isProxyPathAllowed(proxyPath) {
		hs.sendError(w, http.StatusForbidden, fmt.Sprintf("proxy path not allowed: %s", proxyPath))
		return
	}

	// Aggregated watcher endpoint served by host.
	// This avoids making two client round-trips for /watcher/watching + /watcher/varState.
	if proxyPath == "/watcher/watching-state" {
		hs.getWatcherWatchingState(w, r, meta.PublishPort)
		return
	}
	if strings.HasPrefix(proxyPath, "/watcher/varState/") {
		hs.getWatcherSingleVarState(w, r, meta.PublishPort, proxyPath)
		return
	}

	// Build target URL (direct to container's published port)
	targetURL := fmt.Sprintf("http://localhost:%d%s", meta.PublishPort, proxyPath)
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	// Create proxy request
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create proxy request: %v", err))
		return
	}

	// Copy headers
	for key, values := range r.Header {
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}

	// Forward request
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(proxyReq)
	if err != nil {
		hs.sendError(w, http.StatusBadGateway, fmt.Sprintf("failed to forward request: %v", err))
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Write status code
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	io.Copy(w, resp.Body)
}

func (hs *HostServer) getWatcherWatchingState(w http.ResponseWriter, r *http.Request, publishPort int) {
	if r.Method != http.MethodGet {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	watchingURL := fmt.Sprintf("http://localhost:%d/watcher/watching", publishPort)
	varStateURL := fmt.Sprintf("http://localhost:%d/watcher/varState", publishPort)

	var watching WatcherWatchingResponse
	if err := hs.fetchWatcherJSON(r.Context(), client, watchingURL, &watching); err != nil {
		hs.sendError(w, http.StatusBadGateway, err.Error())
		return
	}

	var varState WatcherVarStateResponse
	if err := hs.fetchWatcherJSON(r.Context(), client, varStateURL, &varState); err != nil {
		hs.sendError(w, http.StatusBadGateway, err.Error())
		return
	}

	variables := make(map[string]interface{}, len(watching.WatchedVars))
	notInitialized := make([]string, 0)
	for _, varName := range watching.WatchedVars {
		value, ok := varState.Variables[varName]
		if !ok {
			notInitialized = append(notInitialized, varName)
			continue
		}
		variables[varName] = value
	}

	response := WatcherWatchingStateResponse{
		WatchedVars:       watching.WatchedVars,
		Variables:         variables,
		WatchedCount:      len(watching.WatchedVars),
		InitializedCount:  len(variables),
		NotInitialized:    notInitialized,
		WatchingTimestamp: watching.Timestamp,
		VarStateTimestamp: varState.Timestamp,
		Timestamp:         time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (hs *HostServer) getWatcherSingleVarState(w http.ResponseWriter, r *http.Request, publishPort int, proxyPath string) {
	if r.Method != http.MethodGet {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	rawVarName := strings.TrimPrefix(proxyPath, "/watcher/varState/")
	if rawVarName == "" {
		hs.sendError(w, http.StatusBadRequest, "variable name is required")
		return
	}

	decodedVarName, err := url.PathUnescape(rawVarName)
	if err != nil || strings.TrimSpace(decodedVarName) == "" {
		hs.sendError(w, http.StatusBadRequest, "invalid variable name")
		return
	}
	varName := strings.TrimSpace(decodedVarName)

	client := &http.Client{Timeout: 10 * time.Second}
	watchingURL := fmt.Sprintf("http://localhost:%d/watcher/watching", publishPort)
	varStateURL := fmt.Sprintf("http://localhost:%d/watcher/varState", publishPort)

	var watching WatcherWatchingResponse
	if err := hs.fetchWatcherJSON(r.Context(), client, watchingURL, &watching); err != nil {
		hs.sendError(w, http.StatusBadGateway, err.Error())
		return
	}

	var varState WatcherVarStateResponse
	if err := hs.fetchWatcherJSON(r.Context(), client, varStateURL, &varState); err != nil {
		hs.sendError(w, http.StatusBadGateway, err.Error())
		return
	}

	watched := false
	for _, watchedName := range watching.WatchedVars {
		if watchedName == varName {
			watched = true
			break
		}
	}
	if !watched {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("variable not watched: %s", varName))
		return
	}

	value, initialized := varState.Variables[varName]
	response := WatcherSingleVarStateResponse{
		Name:              varName,
		Watched:           true,
		Initialized:       initialized,
		WatchingTimestamp: watching.Timestamp,
		VarStateTimestamp: varState.Timestamp,
		Timestamp:         time.Now().Format(time.RFC3339),
	}
	if initialized {
		response.Value = value
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (hs *HostServer) fetchWatcherJSON(
	ctx context.Context,
	client *http.Client,
	targetURL string,
	dst interface{},
) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return fmt.Errorf("failed to build upstream request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call upstream %s: %w", targetURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf(
			"upstream %s returned status %d: %s",
			targetURL,
			resp.StatusCode,
			string(body),
		)
	}

	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return fmt.Errorf("failed to decode upstream response from %s: %w", targetURL, err)
	}

	return nil
}

// getContainerLogs handles GET /programs/{id}/logs
func (hs *HostServer) getContainerLogs(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	if r.Method != http.MethodGet {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Check if program exists in registry
	_, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	// Get running program to access ContainerID from ProgramState
	prog, exists := hs.programRegistry.GetProgram(programID)
	if !exists {
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}
	state := prog.GetState()

	// Check if container exists
	if state.ContainerID == "" {
		hs.sendError(w, http.StatusNotFound, "container not started yet")
		return
	}

	// Get logs from Docker runtime
	logs, err := hs.runtime.GetContainerLogs(context.Background(), state.ContainerID, 200)
	if err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to get container logs: %v", err))
		return
	}

	// Return logs as JSON
	response := map[string]interface{}{
		"program_id":   programID,
		"container_id": state.ContainerID,
		"logs":         logs,
		"timestamp":    time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// getSourceCode handles GET /programs/{id}/source
// Returns Dockerfile and source files used for program build
func (hs *HostServer) getSourceCode(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	if r.Method != http.MethodGet {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Check if program exists in registry
	_, err := hs.programRegistry.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("program not found: %v", err))
		return
	}

	// Read source files from storage
	// Storage structure: {storageRoot}/{programID}/src/*
	srcDir := hs.storage.GetSrcDir(programID)

	files, err := hs.storage.ReadAllFiles(srcDir)
	if err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to read source files: %v", err))
		return
	}

	// Return source code response
	response := SourceCodeResponse{
		ProgramID:   programID,
		Files:       files,
		RetrievedAt: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
