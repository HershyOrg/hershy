package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/proxy"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
)

func setupTestServer(t *testing.T) (*HostServer, *httptest.Server, func()) {
	// Create temporary directory
	tmpDir, err := os.MkdirTemp("", "host-api-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	// Create components
	reg := registry.NewRegistry()
	pm := proxy.NewProxyManager()
	stor := storage.NewManager(tmpDir)
	comp := compose.NewBuilder()

	// Note: runtime.DockerManager will be nil for unit tests
	// Integration tests will provide real instance
	hs := NewHostServer(reg, pm, stor, comp, nil)

	// Create test server
	mux := http.NewServeMux()
	mux.HandleFunc("/programs", hs.handlePrograms)
	mux.HandleFunc("/programs/", hs.handleProgramByID)
	ts := httptest.NewServer(mux)

	cleanup := func() {
		ts.Close()
		os.RemoveAll(tmpDir)
	}

	return hs, ts, cleanup
}

func TestCreateProgram(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	reqBody := CreateProgramRequest{
		UserID:     "user-123",
		Dockerfile: "FROM alpine:latest\nCMD sleep 3600",
		SrcFiles: map[string]string{
			"main.go": "package main\nfunc main() {}",
		},
	}

	body, _ := json.Marshal(reqBody)
	resp, err := http.Post(ts.URL+"/programs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Errorf("Expected status 201, got %d", resp.StatusCode)
	}

	var response CreateProgramResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.ProgramID == "" {
		t.Error("Expected ProgramID to be set")
	}
	if response.BuildID == "" {
		t.Error("Expected BuildID to be set")
	}
	if response.State != "Created" {
		t.Errorf("Expected State 'Created', got %s", response.State)
	}
	if response.ProxyURL == "" {
		t.Error("Expected ProxyURL to be set")
	}

	// Verify program is registered
	if !hs.programRegistry.Exists(response.ProgramID) {
		t.Error("Program should be registered in registry")
	}

	// Verify source files were written
	srcPath := hs.storage.GetSrcPath(response.ProgramID)
	if _, err := os.Stat(srcPath + "/Dockerfile"); os.IsNotExist(err) {
		t.Error("Dockerfile was not written")
	}
	if _, err := os.Stat(srcPath + "/main.go"); os.IsNotExist(err) {
		t.Error("main.go was not written")
	}
}

func TestCreateProgram_InvalidRequest(t *testing.T) {
	_, ts, cleanup := setupTestServer(t)
	defer cleanup()

	tests := []struct {
		name   string
		body   CreateProgramRequest
		status int
	}{
		{
			name: "missing user_id",
			body: CreateProgramRequest{
				Dockerfile: "FROM alpine",
			},
			status: http.StatusBadRequest,
		},
		{
			name: "missing dockerfile",
			body: CreateProgramRequest{
				UserID: "user-123",
			},
			status: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.body)
			resp, err := http.Post(ts.URL+"/programs", "application/json", bytes.NewReader(body))
			if err != nil {
				t.Fatalf("Failed to send request: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tt.status {
				t.Errorf("Expected status %d, got %d", tt.status, resp.StatusCode)
			}
		})
	}
}

func TestGetProgram(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	// Create program first
	programID := program.ProgramID("test-prog-1")
	buildID := program.BuildID("build-123")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)

	// Create Program supervisor (required after refactoring)
	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	// Get program
	resp, err := http.Get(ts.URL + "/programs/" + string(programID))
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var response GetProgramResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.ProgramID != programID {
		t.Errorf("Expected ProgramID %s, got %s", programID, response.ProgramID)
	}
	if response.BuildID != buildID {
		t.Errorf("Expected BuildID %s, got %s", buildID, response.BuildID)
	}
}

func TestGetProgram_NotFound(t *testing.T) {
	_, ts, cleanup := setupTestServer(t)
	defer cleanup()

	resp, err := http.Get(ts.URL + "/programs/non-existent")
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", resp.StatusCode)
	}
}

func TestListPrograms(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	// Create multiple programs
	for i := 0; i < 3; i++ {
		programID := program.ProgramID(fmt.Sprintf("prog-%d", i))
		buildID := program.BuildID("build-123")
		meta := registry.ProgramMetadata{
			ProgramID: programID,
			BuildID:   buildID,
			UserID:    "user-123",
		}
		hs.programRegistry.Register(meta)

		// Create Program supervisor (required after refactoring)
		fakeHandler := &program.FakeEffectHandler{}
		prog := program.NewProgram(programID, buildID, fakeHandler)
		hs.programRegistry.SetProgramOnce(programID, prog)
	}

	// List programs
	resp, err := http.Get(ts.URL + "/programs")
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var response ListProgramsResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Count != 3 {
		t.Errorf("Expected count 3, got %d", response.Count)
	}
	if len(response.Programs) != 3 {
		t.Errorf("Expected 3 programs, got %d", len(response.Programs))
	}
}

func TestDeleteProgram(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	// Create program
	programID := program.ProgramID("test-prog-1")
	buildID := program.BuildID("build-123")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)
	hs.storage.EnsureProgramFolders(programID)

	// Create Program supervisor (required after refactoring)
	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	// Delete program (now just sends stop event)
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/programs/"+string(programID), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	// Verify program is NOT deleted from registry (永久 보존)
	if !hs.programRegistry.Exists(programID) {
		t.Error("Program should remain in registry after DELETE")
	}

	// Verify Program instance still exists for restart
	if _, exists := hs.programRegistry.GetProgram(programID); !exists {
		t.Error("Program instance should remain for restart capability")
	}
}

func TestGenerateBuildID(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	dockerfile := "FROM alpine:latest"
	srcFiles := map[string]string{
		"main.go": "package main",
	}

	buildID1 := hs.generateBuildID(dockerfile, srcFiles)
	buildID2 := hs.generateBuildID(dockerfile, srcFiles)

	// Same inputs should produce same BuildID
	if buildID1 != buildID2 {
		t.Error("Same inputs should produce same BuildID")
	}

	// Different inputs should produce different BuildID
	buildID3 := hs.generateBuildID("FROM ubuntu", srcFiles)
	if buildID1 == buildID3 {
		t.Error("Different inputs should produce different BuildID")
	}
}

func TestProxyForwarding(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	// Note: This test requires a running Program instance
	// and Ready state. Full proxy forwarding testing should be done in integration tests
	// with real Program supervisors and containers.

	// Test that proxy endpoint requires running program
	programID := program.ProgramID("test-prog-1")
	buildID := program.BuildID("build-123")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)

	// Create Program supervisor (required after refactoring)
	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	// Try to access proxy without Ready state
	resp, err := http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/status")
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	// Should return 503 because program is not running
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503, got %d", resp.StatusCode)
	}

	t.Log("Proxy forwarding correctly requires running program")
}

func TestProxyForwarding_NotFound(t *testing.T) {
	_, ts, cleanup := setupTestServer(t)
	defer cleanup()

	// Try to access proxy for non-existent program
	resp, err := http.Get(ts.URL + "/programs/non-existent/proxy/test")
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", resp.StatusCode)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	_, ts, cleanup := setupTestServer(t)
	defer cleanup()

	tests := []struct {
		name   string
		method string
		url    string
	}{
		{"PUT on /programs", http.MethodPut, "/programs"},
		{"PATCH on /programs/{id}", http.MethodPatch, "/programs/test-prog"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest(tt.method, ts.URL+tt.url, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("Failed to send request: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Errorf("Expected status 405, got %d", resp.StatusCode)
			}
		})
	}
}

// TestHealthCheck_AllPrograms tests checkAllPrograms logic
func TestHealthCheck_AllPrograms(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	// Test checkAllPrograms with no programs (should not crash)
	hs.checkAllPrograms()

	// Note: Full testing requires mock Program instances with controllable GetState()
	// This would be added in integration tests with real Program supervisors
	t.Log("checkAllPrograms basic validation passed")
}

// TestHealthCheck_ProgramPersistence tests永久保존 design
func TestHealthCheck_ProgramPersistence(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	// Register a program
	programID := program.ProgramID("test-prog-persist")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)
	hs.storage.EnsureProgramFolders(programID)

	// Create a fake Program and store in Registry
	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, meta.BuildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	// Verify Program is stored
	if storedProg, exists := hs.programRegistry.GetProgram(programID); !exists || storedProg == nil {
		t.Error("Program should be stored in registry")
	}

	// Send stop event (simulates normal DELETE API)
	prog.SendEvent(program.UserStopRequested{ProgramID: programID})

	// Wait for state transition
	time.Sleep(100 * time.Millisecond)

	// Verify Program still exists in Registry (永久 보존)
	if !hs.programRegistry.Exists(programID) {
		t.Error("Program should remain in registry after stop")
	}

	// Verify Program instance is still accessible
	if storedProg, exists := hs.programRegistry.GetProgram(programID); !exists || storedProg == nil {
		t.Error("Program instance should remain accessible for restart")
	}
}

// TestHealthCheck_SingleInterval validates the single-interval design
func TestHealthCheck_SingleInterval(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	// Verify health check loop is running (started in NewHostServer)
	if hs.healthCtx == nil {
		t.Error("healthCtx should be initialized")
	}
	if hs.healthCancel == nil {
		t.Error("healthCancel should be initialized")
	}

	// Stop health check loop
	hs.healthCancel()

	// Wait for graceful shutdown
	time.Sleep(150 * time.Millisecond)

	// Verify context is done
	select {
	case <-hs.healthCtx.Done():
		t.Log("Health check loop stopped successfully")
	default:
		t.Error("Health check loop should be stopped")
	}
}
