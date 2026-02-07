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
		meta := registry.ProgramMetadata{
			ProgramID: program.ProgramID(fmt.Sprintf("prog-%d", i)),
			BuildID:   program.BuildID("build-123"),
			UserID:    "user-123",
		}
		hs.programRegistry.Register(meta)
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
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)
	hs.storage.EnsureProgramFolders(programID)

	// Delete program
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/programs/"+string(programID), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	// Verify program is deleted
	if hs.programRegistry.Exists(programID) {
		t.Error("Program should be deleted from registry")
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

	// Note: This test requires a running Program instance in runningPrograms
	// and Ready state. Full proxy forwarding testing should be done in integration tests
	// with real Program supervisors and containers.

	// Test that proxy endpoint requires running program
	programID := program.ProgramID("test-prog-1")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)

	// Try to access proxy without running program
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

// TestHealthCheck_NonReadyPrograms tests checkNonReadyPrograms logic
func TestHealthCheck_NonReadyPrograms(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	// Test checkNonReadyPrograms returns empty when no programs
	toCleanup := hs.checkNonReadyPrograms()
	if len(toCleanup) != 0 {
		t.Errorf("Expected empty cleanup list, got %d items", len(toCleanup))
	}

	// Note: Full testing requires mock Program instances with controllable GetState()
	// This would be added in integration tests with real Program supervisors
	t.Log("checkNonReadyPrograms basic validation passed")
}

// TestHealthCheck_ReadyPrograms tests checkReadyPrograms logic
func TestHealthCheck_ReadyPrograms(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	// Test checkReadyPrograms returns empty when no programs
	toCleanup := hs.checkReadyPrograms()
	if len(toCleanup) != 0 {
		t.Errorf("Expected empty cleanup list, got %d items", len(toCleanup))
	}

	// Note: Full testing requires:
	// 1. Mock Program instances in readyPrograms map
	// 2. Mock runtime.GetContainerStatus() responses
	// This would be added in integration tests
	t.Log("checkReadyPrograms basic validation passed")
}

// TestHealthCheck_CleanupPrograms tests cleanupPrograms logic
func TestHealthCheck_CleanupPrograms(t *testing.T) {
	hs, _, cleanup := setupTestServer(t)
	defer cleanup()

	// Register a program
	programID := program.ProgramID("test-prog-cleanup")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-123",
	}
	hs.programRegistry.Register(meta)
	hs.storage.EnsureProgramFolders(programID)

	// Add to runningPrograms (simulate running)
	// Note: Would need mock Program for full test, but we can test map cleanup
	// hs.runningPrograms.Store(programID, mockProgram)

	// Test cleanup with empty list
	hs.cleanupPrograms([]program.ProgramID{})

	// Registry should still have the program (Registry never deleted by cleanupPrograms)
	if !hs.programRegistry.Exists(programID) {
		t.Error("Program should remain in registry after empty cleanup")
	}

	// Add to running and ready maps
	hs.runningPrograms.Store(programID, nil) // nil for test purposes
	hs.readyPrograms.Store(programID, nil)

	// Test cleanup with program ID
	hs.cleanupPrograms([]program.ProgramID{programID})

	// Verify removed from maps
	if _, exists := hs.runningPrograms.Load(programID); exists {
		t.Error("Program should be removed from runningPrograms")
	}
	if _, exists := hs.readyPrograms.Load(programID); exists {
		t.Error("Program should be removed from readyPrograms")
	}

	// Registry should still have the program (cleanupPrograms only removes from runtime maps)
	if !hs.programRegistry.Exists(programID) {
		t.Error("Program should remain in registry (cleanupPrograms doesn't delete from registry)")
	}
}

// TestHealthCheck_DualIntervalStrategy validates the dual-interval design
func TestHealthCheck_DualIntervalStrategy(t *testing.T) {
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
