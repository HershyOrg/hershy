package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/HershyOrg/hershy/host/proxy"
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

	// Send start event
	if err := prog.SendEvent(program.UserStartRequested{ProgramID: programID}); err != nil {
		hs.sendError(w, http.StatusInternalServerError, fmt.Sprintf("failed to start program: %v", err))
		return
	}

	// Monitor state transitions and set up proxy when ready
	go hs.monitorProgramState(programID, meta.ProxyPort)

	response := LifecycleResponse{
		ProgramID: programID,
		State:     meta.State.String(),
		Message:   "program start initiated",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// monitorProgramState monitors program state and sets up proxy when ready
func (hs *HostServer) monitorProgramState(programID program.ProgramID, proxyPort int) {
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
				// Get container IP
				containerIP, err := hs.runtime.GetContainerIP(context.Background(), state.ContainerID)
				if err != nil {
					// Log error
					return
				}

				// Create and start proxy
				targetAddr := fmt.Sprintf("%s:8080", containerIP)
				proxyServer := proxy.NewProxyServer(programID, proxyPort, targetAddr)
				if err := hs.proxyManager.Add(proxyServer); err != nil {
					// Log error
					return
				}
				if err := proxyServer.Start(); err != nil {
					// Log error
					return
				}

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

	// Stop and remove proxy
	if err := hs.proxyManager.Remove(programID); err != nil {
		// Log but don't fail
	}

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
// 이는 이중 프록시 구조임. 
// 요청이 들어오면, 이를 "프록시 수신 호스트 포트"로 전달.
// 이후 "프록시 수신 호스트 포트"에서 "컨테이너 포트"로 재전달됨.
func (hs *HostServer) handleProxy(w http.ResponseWriter, r *http.Request, programID program.ProgramID, proxyPath string) {
	// Get proxy server
	proxyServer, err := hs.proxyManager.Get(programID)
	if err != nil {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("proxy not found: %v", err))
		return
	}

	if !proxyServer.IsRunning() {
		hs.sendError(w, http.StatusServiceUnavailable, "proxy not running")
		return
	}

	// Build target URL
	targetURL := fmt.Sprintf("http://localhost:%d%s", proxyServer.GetHostPort(), proxyPath)
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
