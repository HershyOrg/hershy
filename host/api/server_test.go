package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/rlaaudgjs5638/hersh/host/compose"
	"github.com/rlaaudgjs5638/hersh/host/proxy"
	"github.com/rlaaudgjs5638/hersh/host/registry"
	"github.com/rlaaudgjs5638/hersh/host/storage"
	"github.com/rlaaudgjs5638/hersh/program"
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
		State:     program.StateCreated,
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
			State:     program.StateCreated,
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
		State:     program.StateCreated,
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

	// Create mock WatcherAPI backend
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status": "running",
			"path":   r.URL.Path,
		})
	}))
	defer backend.Close()

	// Create program and proxy
	programID := program.ProgramID("test-prog-1")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   program.BuildID("build-123"),
		UserID:    "user-123",
		State:     program.StateReady,
	}
	hs.programRegistry.Register(meta)

	// Get assigned port
	registered, _ := hs.programRegistry.Get(programID)
	proxyPort := registered.ProxyPort

	// Create and start proxy pointing to mock backend
	backendAddr := backend.URL[len("http://"):]
	proxyServer := proxy.NewProxyServer(programID, proxyPort, backendAddr)
	hs.proxyManager.Add(proxyServer)
	proxyServer.Start()

	// Wait for proxy to start
	time.Sleep(200 * time.Millisecond)

	// Test proxy forwarding through API
	resp, err := http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/status")
	if err != nil {
		t.Fatalf("Failed to send request through proxy: %v", err)
	}
	defer resp.Body.Close()

	// Read body once
	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", resp.StatusCode, string(bodyBytes))
		return
	}

	t.Logf("Response body: %s", string(bodyBytes))

	var response map[string]string
	if err := json.Unmarshal(bodyBytes, &response); err != nil {
		t.Fatalf("Failed to decode response: %v. Body: %s", err, string(bodyBytes))
	}

	if response["status"] != "running" {
		t.Errorf("Expected status 'running', got %q. Full response: %+v", response["status"], response)
	}
	if response["path"] != "/watcher/status" {
		t.Errorf("Expected path '/watcher/status', got %q. Full response: %+v", response["path"], response)
	}
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
