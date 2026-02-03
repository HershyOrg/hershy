package api

import (
	"encoding/json"
	"net/http"
	"sync"
)

// MockServer is a mock implementation of the Server interface for testing.
type MockServer struct {
	mu      sync.RWMutex
	running bool
	port    int

	// Handler for custom behavior
	Handler Handler
}

// NewMockServer creates a new MockServer.
func NewMockServer(handler Handler) *MockServer {
	return &MockServer{
		Handler: handler,
	}
}

// Start simulates starting the API server.
func (m *MockServer) Start(port int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return nil // Already running (no-op for mock)
	}

	m.port = port
	m.running = true
	return nil
}

// Stop simulates stopping the API server.
func (m *MockServer) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running {
		return nil // Already stopped
	}

	m.running = false
	return nil
}

// RegisterHandlers registers HTTP handlers.
func (m *MockServer) RegisterHandlers(mux *http.ServeMux) {
	if m.Handler != nil {
		mux.HandleFunc("GET /info", m.Handler.HandleInfo)
		mux.HandleFunc("GET /status", m.Handler.HandleStatus)
		mux.HandleFunc("GET /container/health", m.Handler.HandleContainerHealth)
		mux.HandleFunc("POST /stop", m.Handler.HandleStop)
		mux.HandleFunc("/watcher/", m.Handler.HandleWatcherProxy)
	}
}

// IsRunning returns whether the server is running (test helper).
func (m *MockServer) IsRunning() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.running
}

// GetPort returns the port the server is running on (test helper).
func (m *MockServer) GetPort() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.port
}

// MockHandler is a mock implementation of the Handler interface.
type MockHandler struct {
	Info            ProgramInfo
	Status          ProgramStatus
	ContainerHealth ContainerHealth
	StopCalled      bool
	ProxyCalled     bool
}

// NewMockHandler creates a new MockHandler with default values.
func NewMockHandler() *MockHandler {
	return &MockHandler{
		Info: ProgramInfo{
			ID:      "mock-program-001",
			Name:    "mock-program",
			Version: "1.0.0",
			State:   "running",
			Port:    9090,
		},
		Status: ProgramStatus{
			State:          "running",
			ContainerState: "running",
			Healthy:        true,
			Uptime:         10.5,
		},
		ContainerHealth: ContainerHealth{
			Healthy: true,
			Running: true,
			Uptime:  10.5,
		},
	}
}

// HandleInfo returns program information.
func (h *MockHandler) HandleInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Info)
}

// HandleStatus returns program status.
func (h *MockHandler) HandleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Status)
}

// HandleContainerHealth returns container health.
func (h *MockHandler) HandleContainerHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.ContainerHealth)
}

// HandleStop handles stop requests.
func (h *MockHandler) HandleStop(w http.ResponseWriter, r *http.Request) {
	h.StopCalled = true
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(StopResponse{
		Status:  "stopping",
		Message: "Program stop initiated",
	})
}

// HandleWatcherProxy handles watcher proxy requests.
func (h *MockHandler) HandleWatcherProxy(w http.ResponseWriter, r *http.Request) {
	h.ProxyCalled = true
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "proxied",
		"path":    r.URL.Path,
		"message": "Mock proxy response",
	})
}
