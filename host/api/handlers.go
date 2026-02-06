package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/HershyOrg/hershy/program"
)

// startProgram handles POST /programs/{id}/start
func (hs *HostServer) startProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
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
	hs.mu.Lock()
	if _, exists := hs.runningPrograms[programID]; exists {
		hs.mu.Unlock()
		hs.sendError(w, http.StatusConflict, "program already running")
		return
	}
	hs.mu.Unlock()

	// Create effect handler using factory function
	handler := hs.createEffectHandler()

	// Create and start program supervisor
	prog := program.NewProgram(programID, meta.BuildID, handler)

	hs.mu.Lock()
	hs.runningPrograms[programID] = prog
	hs.mu.Unlock()

	// Start supervisor in background
	ctx := context.Background()
	go prog.Start(ctx)

	// Send start event with publish port
	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: meta.PublishPort,
	}); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to start program: %v", err))
		return
	}

	// Monitor state transitions (no proxy setup needed - container publishes directly)
	go hs.monitorProgramState(programID, meta.PublishPort)

	response := LifecycleResponse{
		ProgramID: programID,
		State:     meta.State.String(),
		Message:   "program start initiated",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// monitorProgramState monitors program state and updates registry
// Note: No proxy setup needed - container publishes directly to localhost:publishPort
func (hs *HostServer) monitorProgramState(programID program.ProgramID, publishPort int) {
	hs.mu.RLock()
	prog, exists := hs.runningPrograms[programID]
	hs.mu.RUnlock()

	if !exists {
		return
	}

	// Poll state until Ready or Error
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	timeout := time.After(5 * time.Minute)

	for {
		select {
		case <-ticker.C:
			state := prog.GetState()

			// Update registry
			updates := map[string]interface{}{
				"state": state.State,
			}
			if state.ImageID != "" {
				updates["image_id"] = state.ImageID
			}
			if state.ContainerID != "" {
				updates["container_id"] = state.ContainerID
			}
			if state.ErrorMsg != "" {
				updates["error_msg"] = state.ErrorMsg
			}
			hs.programRegistry.Update(programID, updates)

			if state.State == program.StateReady {
				log.Printf("[PROGRAM-READY] ✅ Program %s reached StateReady, accessible on localhost:%d",
					programID, publishPort)
				// Container is publishing directly to localhost:publishPort
				// No proxy server needed
				return
			}

			if state.State == program.StateError || state.State == program.StateStopped {
				return
			}

		case <-timeout:
			return
		}
	}
}

// stopProgram handles POST /programs/{id}/stop
func (hs *HostServer) stopProgram(w http.ResponseWriter, r *http.Request, programID program.ProgramID) {
	if r.Method != http.MethodPost {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Check if program is running
	hs.mu.Lock()
	prog, exists := hs.runningPrograms[programID]
	if !exists {
		hs.mu.Unlock()
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}
	hs.mu.Unlock()

	// Send stop event
	stopEvent := program.UserStopRequested{ProgramID: programID}
	if err := prog.SendEvent(stopEvent); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to send stop event: %v", err))
		return
	}

	// No proxy cleanup needed - container publishes directly

	// Monitor stop completion and cleanup
	go func() {
		// Wait for Stopped state (with timeout)
		timeout := time.After(30 * time.Second)
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				state := prog.GetState()
				if state.State == program.StateStopped {
					// Update registry first to reflect Stopped state
					hs.programRegistry.Update(programID, map[string]interface{}{
						"state": program.StateStopped,
					})

					// Remove from programs map
					hs.mu.Lock()
					delete(hs.runningPrograms, programID)
					hs.mu.Unlock()
					return
				}
			case <-timeout:
				// Force cleanup after timeout
				hs.mu.Lock()
				delete(hs.runningPrograms, programID)
				hs.mu.Unlock()
				return
			}
		}
	}()

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
	hs.mu.Lock()
	prog, exists := hs.runningPrograms[programID]
	if !exists {
		hs.mu.Unlock()
		hs.sendError(w, http.StatusNotFound, "program not running")
		return
	}
	hs.mu.Unlock()

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

	// Check if program is ready
	if meta.State != program.StateReady {
		hs.sendError(w, http.StatusServiceUnavailable, fmt.Sprintf("program not ready (current state: %s)", meta.State))
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
