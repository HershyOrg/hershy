package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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

	containerID := ""
	logSource := "runtime_file"

	if prog, exists := hs.programRegistry.GetProgram(programID); exists {
		state := prog.GetState()
		containerID = state.ContainerID
		if state.ContainerID != "" {
			logs, err := hs.runtime.GetContainerLogs(context.Background(), state.ContainerID, 200)
			if err == nil {
				response := map[string]interface{}{
					"program_id":   programID,
					"container_id": state.ContainerID,
					"logs":         logs,
					"source":       "docker",
					"timestamp":    time.Now().Format(time.RFC3339),
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(response)
				return
			}
		}
	}

	runtimeLogPath := hs.storage.GetRuntimeLogPath(programID)
	data, err := os.ReadFile(runtimeLogPath)
	if err != nil {
		if os.IsNotExist(err) {
			hs.sendError(w, http.StatusNotFound, "runtime log not found")
			return
		}
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to read runtime log: %v", err))
		return
	}

	response := map[string]interface{}{
		"program_id":   programID,
		"container_id": containerID,
		"logs":         tailLines(string(data), 200),
		"source":       logSource,
		"timestamp":    time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func tailLines(text string, limit int) string {
	if limit <= 0 || text == "" {
		return text
	}

	trimmed := strings.TrimRight(text, "\n")
	if trimmed == "" {
		return ""
	}

	lines := strings.Split(trimmed, "\n")
	if len(lines) <= limit {
		return trimmed
	}
	return strings.Join(lines[len(lines)-limit:], "\n")
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
