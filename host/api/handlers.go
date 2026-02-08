package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

	// Check if already running
	if _, exists := hs.runningPrograms.Load(programID); exists {
		hs.sendError(w, http.StatusConflict, "program already running")
		return
	}

	// Create effect handler using factory function
	handler := hs.createEffectHandler()

	// Create and start program supervisor
	prog := program.NewProgram(programID, meta.BuildID, handler)
	fmt.Printf("[START-DEBUG] Created Program supervisor for %s\n", programID)

	// Store in runningPrograms (sync.Map is thread-safe)
	hs.runningPrograms.Store(programID, prog)
	fmt.Printf("[START-DEBUG] Stored %s in runningPrograms\n", programID)

	// Start supervisor in background
	ctx := context.Background()
	go func() {
		fmt.Printf("[START-DEBUG] Starting supervisor goroutine for %s\n", programID)
		prog.Start(ctx)
		fmt.Printf("[START-DEBUG] Supervisor goroutine completed for %s\n", programID)
	}()

	// Send start event with publish port
	fmt.Printf("[START-DEBUG] Sending UserStartRequested event for %s (port: %d)\n", programID, meta.PublishPort)
	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: meta.PublishPort,
	}); err != nil {
		fmt.Printf("[START-ERROR] Failed to send start event for %s: %v\n", programID, err)
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to start program: %v", err))
		return
	}
	fmt.Printf("[START-DEBUG] UserStartRequested event sent successfully for %s\n", programID)

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
	value, exists := hs.runningPrograms.Load(programID)
	if !exists {
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}

	prog := value.(*program.Program)

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
	value, exists := hs.runningPrograms.Load(programID)
	if !exists {
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}

	prog := value.(*program.Program)

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
	value, exists := hs.runningPrograms.Load(programID)
	if !exists {
		hs.sendError(w, http.StatusServiceUnavailable, "program not running")
		return
	}

	prog := value.(*program.Program)
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
