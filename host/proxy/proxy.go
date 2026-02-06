package proxy

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/program"
)

// ProxyServer represents a reverse proxy server for a single program
type ProxyServer struct {
	programID  program.ProgramID
	hostPort   int    //  9000-9999 (외부 접근) Host port to listen on
	targetAddr string // "172.17.0.2:8080" (내부 전달) Container address (e.g., "172.17.0.2:8080")
	server     *http.Server
	handler    http.Handler
	mu         sync.Mutex
	running    bool
}

// NewProxyServer creates a new proxy server instance
func NewProxyServer(programID program.ProgramID, hostPort int, targetAddr string) *ProxyServer {
	ps := &ProxyServer{
		programID:  programID,
		hostPort:   hostPort,
		targetAddr: targetAddr,
	}

	// Create reverse proxy handler
	ps.handler = http.HandlerFunc(ps.proxyHandler)

	return ps
}

// proxyHandler handles HTTP requests and forwards them to the container
func (ps *ProxyServer) proxyHandler(w http.ResponseWriter, r *http.Request) {
	// Build target URL
	targetURL := &url.URL{
		Scheme:   "http",
		Host:     ps.targetAddr,
		Path:     r.URL.Path,
		RawQuery: r.URL.RawQuery,
	}

	// Create proxy request
	// 호스트 요청을 프록시로 포워딩
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create proxy request: %v", err), http.StatusInternalServerError)
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
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
		},
	}

	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to forward request: %v", err), http.StatusBadGateway)
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
	if _, err := io.Copy(w, resp.Body); err != nil {
		// Can't send error response after headers are written
		// TODO Log error in production
		return
	}
}

// Start starts the proxy server (non-blocking)
func (ps *ProxyServer) Start() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if ps.running {
		return fmt.Errorf("proxy server already running")
	}

	//호스트포트로 리스닝 시작
	ps.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", ps.hostPort),
		Handler: ps.handler,
	}

	// Start server in goroutine
	go func() {
		if err := ps.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			// Log error in production
			ps.mu.Lock()
			ps.running = false
			ps.mu.Unlock()
		}
	}()

	ps.running = true

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	return nil
}

// Stop stops the proxy server
func (ps *ProxyServer) Stop() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if !ps.running {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := ps.server.Shutdown(ctx); err != nil {
		return fmt.Errorf("failed to shutdown proxy server: %w", err)
	}

	ps.running = false
	return nil
}

// IsRunning returns whether the proxy server is running
func (ps *ProxyServer) IsRunning() bool {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	return ps.running
}

// GetProgramID returns the program ID this proxy serves
func (ps *ProxyServer) GetProgramID() program.ProgramID {
	return ps.programID
}

// GetHostPort returns the host port this proxy listens on
func (ps *ProxyServer) GetHostPort() int {
	return ps.hostPort
}

// GetTargetAddr returns the container address this proxy forwards to
func (ps *ProxyServer) GetTargetAddr() string {
	return ps.targetAddr
}

// ProxyManager manages multiple proxy servers
type ProxyManager struct {
	mu      sync.RWMutex
	proxies map[program.ProgramID]*ProxyServer
}

// NewProxyManager creates a new proxy manager
func NewProxyManager() *ProxyManager {
	return &ProxyManager{
		proxies: make(map[program.ProgramID]*ProxyServer),
	}
}

// Add adds a proxy server to the manager
func (pm *ProxyManager) Add(server *ProxyServer) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if _, exists := pm.proxies[server.programID]; exists {
		return fmt.Errorf("proxy for program %s already exists", server.programID)
	}

	pm.proxies[server.programID] = server
	return nil
}

// Remove removes a proxy server from the manager
func (pm *ProxyManager) Remove(programID program.ProgramID) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	server, exists := pm.proxies[programID]
	if !exists {
		return fmt.Errorf("proxy for program %s not found", programID)
	}

	// Stop server if running
	if server.IsRunning() {
		if err := server.Stop(); err != nil {
			return fmt.Errorf("failed to stop proxy: %w", err)
		}
	}

	delete(pm.proxies, programID)
	return nil
}

// Get retrieves a proxy server by program ID
func (pm *ProxyManager) Get(programID program.ProgramID) (*ProxyServer, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	server, exists := pm.proxies[programID]
	if !exists {
		return nil, fmt.Errorf("proxy for program %s not found", programID)
	}

	return server, nil
}

// GetProxyURL returns the proxy URL for a program
func (pm *ProxyManager) GetProxyURL(programID program.ProgramID) (string, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	server, exists := pm.proxies[programID]
	if !exists {
		return "", fmt.Errorf("proxy for program %s not found", programID)
	}

	return fmt.Sprintf("http://localhost:%d", server.hostPort), nil
}

// List returns all proxy servers
func (pm *ProxyManager) List() []*ProxyServer {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	result := make([]*ProxyServer, 0, len(pm.proxies))
	for _, server := range pm.proxies {
		result = append(result, server)
	}

	return result
}

// StopAll stops all proxy servers
func (pm *ProxyManager) StopAll() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	var errors []error
	for _, server := range pm.proxies {
		if server.IsRunning() {
			if err := server.Stop(); err != nil {
				errors = append(errors, err)
			}
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("failed to stop some proxies: %v", errors)
	}

	return nil
}

// Count returns the number of proxy servers
func (pm *ProxyManager) Count() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return len(pm.proxies)
}
