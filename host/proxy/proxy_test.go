package proxy

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rlaaudgjs5638/hersh/program"
)

func TestProxyServer_CreateAndGetters(t *testing.T) {
	programID := program.ProgramID("test-prog-1")
	hostPort := 9000
	targetAddr := "172.17.0.2:8080"

	ps := NewProxyServer(programID, hostPort, targetAddr)

	if ps.GetProgramID() != programID {
		t.Errorf("Expected ProgramID %s, got %s", programID, ps.GetProgramID())
	}
	if ps.GetHostPort() != hostPort {
		t.Errorf("Expected HostPort %d, got %d", hostPort, ps.GetHostPort())
	}
	if ps.GetTargetAddr() != targetAddr {
		t.Errorf("Expected TargetAddr %s, got %s", targetAddr, ps.GetTargetAddr())
	}
	if ps.IsRunning() {
		t.Error("Expected IsRunning to be false initially")
	}
}

func TestProxyServer_StartStop(t *testing.T) {
	// Create mock backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	// Extract backend address (remove http://)
	backendAddr := strings.TrimPrefix(backend.URL, "http://")

	// Create proxy server
	programID := program.ProgramID("test-prog-1")
	ps := NewProxyServer(programID, 19000, backendAddr)

	// Start proxy
	if err := ps.Start(); err != nil {
		t.Fatalf("Failed to start proxy: %v", err)
	}

	if !ps.IsRunning() {
		t.Error("Expected IsRunning to be true after Start")
	}

	// Try to start again (should fail)
	if err := ps.Start(); err == nil {
		t.Error("Expected error when starting already running proxy")
	}

	// Stop proxy
	if err := ps.Stop(); err != nil {
		t.Fatalf("Failed to stop proxy: %v", err)
	}

	if ps.IsRunning() {
		t.Error("Expected IsRunning to be false after Stop")
	}

	// Stop again (should be idempotent)
	if err := ps.Stop(); err != nil {
		t.Error("Expected Stop to be idempotent")
	}
}

func TestProxyServer_ForwardRequest(t *testing.T) {
	// Create mock backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Echo request info
		w.Header().Set("X-Backend", "true")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Method=%s Path=%s Query=%s", r.Method, r.URL.Path, r.URL.RawQuery)
	}))
	defer backend.Close()

	backendAddr := strings.TrimPrefix(backend.URL, "http://")

	// Create and start proxy
	ps := NewProxyServer(program.ProgramID("test-prog-1"), 19001, backendAddr)
	if err := ps.Start(); err != nil {
		t.Fatalf("Failed to start proxy: %v", err)
	}
	defer ps.Stop()

	// Wait for server to be ready
	time.Sleep(200 * time.Millisecond)

	// Test GET request
	resp, err := http.Get("http://localhost:19001/test/path?foo=bar")
	if err != nil {
		t.Fatalf("Failed to send request through proxy: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	expectedBody := "Method=GET Path=/test/path Query=foo=bar"
	if string(body) != expectedBody {
		t.Errorf("Expected body %q, got %q", expectedBody, string(body))
	}

	if resp.Header.Get("X-Backend") != "true" {
		t.Error("Expected backend header to be preserved")
	}
}

func TestProxyServer_ForwardPOST(t *testing.T) {
	// Create mock backend server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, "Received: %s", string(body))
	}))
	defer backend.Close()

	backendAddr := strings.TrimPrefix(backend.URL, "http://")

	// Create and start proxy
	ps := NewProxyServer(program.ProgramID("test-prog-1"), 19002, backendAddr)
	if err := ps.Start(); err != nil {
		t.Fatalf("Failed to start proxy: %v", err)
	}
	defer ps.Stop()

	time.Sleep(200 * time.Millisecond)

	// Test POST request
	resp, err := http.Post("http://localhost:19002/api/data", "application/json", strings.NewReader(`{"key":"value"}`))
	if err != nil {
		t.Fatalf("Failed to send POST request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Errorf("Expected status 201, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	expectedBody := `Received: {"key":"value"}`
	if string(body) != expectedBody {
		t.Errorf("Expected body %q, got %q", expectedBody, string(body))
	}
}

func TestProxyServer_BackendError(t *testing.T) {
	// Create proxy pointing to non-existent backend
	ps := NewProxyServer(program.ProgramID("test-prog-1"), 19003, "localhost:9999")
	if err := ps.Start(); err != nil {
		t.Fatalf("Failed to start proxy: %v", err)
	}
	defer ps.Stop()

	time.Sleep(200 * time.Millisecond)

	// Request should fail with 502 Bad Gateway
	resp, err := http.Get("http://localhost:19003/test")
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("Expected status 502 Bad Gateway, got %d", resp.StatusCode)
	}
}

func TestProxyManager_AddRemove(t *testing.T) {
	pm := NewProxyManager()

	programID := program.ProgramID("test-prog-1")
	ps := NewProxyServer(programID, 9000, "localhost:8080")

	// Add proxy
	if err := pm.Add(ps); err != nil {
		t.Fatalf("Failed to add proxy: %v", err)
	}

	if pm.Count() != 1 {
		t.Errorf("Expected count 1, got %d", pm.Count())
	}

	// Try to add duplicate
	if err := pm.Add(ps); err == nil {
		t.Error("Expected error when adding duplicate proxy")
	}

	// Get proxy
	retrieved, err := pm.Get(programID)
	if err != nil {
		t.Fatalf("Failed to get proxy: %v", err)
	}
	if retrieved.GetProgramID() != programID {
		t.Error("Retrieved proxy has wrong program ID")
	}

	// Remove proxy
	if err := pm.Remove(programID); err != nil {
		t.Fatalf("Failed to remove proxy: %v", err)
	}

	if pm.Count() != 0 {
		t.Errorf("Expected count 0 after removal, got %d", pm.Count())
	}

	// Try to remove non-existent
	if err := pm.Remove(programID); err == nil {
		t.Error("Expected error when removing non-existent proxy")
	}
}

func TestProxyManager_GetProxyURL(t *testing.T) {
	pm := NewProxyManager()

	programID := program.ProgramID("test-prog-1")
	ps := NewProxyServer(programID, 9005, "localhost:8080")
	pm.Add(ps)

	url, err := pm.GetProxyURL(programID)
	if err != nil {
		t.Fatalf("Failed to get proxy URL: %v", err)
	}

	expectedURL := "http://localhost:9005"
	if url != expectedURL {
		t.Errorf("Expected URL %s, got %s", expectedURL, url)
	}

	// Get URL for non-existent proxy
	_, err = pm.GetProxyURL(program.ProgramID("non-existent"))
	if err == nil {
		t.Error("Expected error for non-existent program")
	}
}

func TestProxyManager_List(t *testing.T) {
	pm := NewProxyManager()

	// Add multiple proxies
	for i := 0; i < 5; i++ {
		programID := program.ProgramID(fmt.Sprintf("prog-%d", i))
		ps := NewProxyServer(programID, 9100+i, "localhost:8080")
		pm.Add(ps)
	}

	proxies := pm.List()
	if len(proxies) != 5 {
		t.Errorf("Expected 5 proxies, got %d", len(proxies))
	}
}

func TestProxyManager_StopAll(t *testing.T) {
	// Create mock backend
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendAddr := strings.TrimPrefix(backend.URL, "http://")

	pm := NewProxyManager()

	// Add and start multiple proxies
	for i := 0; i < 3; i++ {
		programID := program.ProgramID(fmt.Sprintf("prog-%d", i))
		ps := NewProxyServer(programID, 19100+i, backendAddr)
		ps.Start()
		pm.Add(ps)
	}

	// Stop all
	if err := pm.StopAll(); err != nil {
		t.Fatalf("Failed to stop all proxies: %v", err)
	}

	// Verify all are stopped
	for _, ps := range pm.List() {
		if ps.IsRunning() {
			t.Errorf("Proxy %s still running after StopAll", ps.GetProgramID())
		}
	}
}

func TestProxyManager_Concurrent(t *testing.T) {
	pm := NewProxyManager()

	var wg sync.WaitGroup

	// Add 20 proxies concurrently
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			programID := program.ProgramID(fmt.Sprintf("prog-%d", i))
			ps := NewProxyServer(programID, 19200+i, "localhost:8080")
			if err := pm.Add(ps); err != nil {
				t.Errorf("Failed to add proxy: %v", err)
			}
		}(i)
	}

	wg.Wait()

	if pm.Count() != 20 {
		t.Errorf("Expected 20 proxies, got %d", pm.Count())
	}

	// Get all proxies concurrently
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			programID := program.ProgramID(fmt.Sprintf("prog-%d", i))
			if _, err := pm.Get(programID); err != nil {
				t.Errorf("Failed to get proxy: %v", err)
			}
		}(i)
	}

	wg.Wait()
}
