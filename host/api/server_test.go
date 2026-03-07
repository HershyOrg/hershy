package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
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
	mux.HandleFunc("/watcher/endpoints", hs.handleWatcherEndpoints)
	mux.HandleFunc("/watcher/endpoints/", hs.handleWatcherEndpoints)
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

func TestProxyWatcherWatchingState(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	programID := program.ProgramID("watching-state-prog")
	buildID := program.BuildID("build-abc")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	if err := hs.programRegistry.Register(meta); err != nil {
		t.Fatalf("failed to register program: %v", err)
	}

	registeredMeta, err := hs.programRegistry.Get(programID)
	if err != nil {
		t.Fatalf("failed to load metadata: %v", err)
	}

	watcherMux := http.NewServeMux()
	watcherMux.HandleFunc("/watcher/watching", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherWatchingResponse{
			WatchedVars: []string{"stats_ticker", "btc_price", "rebalance_ticker"},
			Count:       3,
			Timestamp:   "2026-02-09T04:10:00Z",
		})
	})
	watcherMux.HandleFunc("/watcher/varState", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherVarStateResponse{
			Variables: map[string]interface{}{
				"stats_ticker": "2026-02-09T04:10:00Z",
				"btc_price":    71105.96,
			},
			Count:     2,
			Timestamp: "2026-02-09T04:10:01Z",
		})
	})

	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", registeredMeta.PublishPort))
	if err != nil {
		t.Fatalf("failed to bind mock watcher server: %v", err)
	}
	watcherServer := &http.Server{Handler: watcherMux}
	go watcherServer.Serve(ln)
	defer watcherServer.Shutdown(context.Background())

	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go prog.Start(ctx)

	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: registeredMeta.PublishPort,
	}); err != nil {
		t.Fatalf("failed to send start event: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if prog.GetState().State == program.StateReady {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if prog.GetState().State != program.StateReady {
		t.Fatalf("program did not reach ready state, got %s", prog.GetState().State)
	}

	resp, err := http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/watching-state")
	if err != nil {
		t.Fatalf("failed to request aggregated endpoint: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var payload WatcherWatchingStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}

	if payload.WatchedCount != 3 {
		t.Errorf("expected watchedCount=3, got %d", payload.WatchedCount)
	}
	if payload.InitializedCount != 2 {
		t.Errorf("expected initializedCount=2, got %d", payload.InitializedCount)
	}
	if len(payload.NotInitialized) != 1 || payload.NotInitialized[0] != "rebalance_ticker" {
		t.Errorf("unexpected notInitialized list: %+v", payload.NotInitialized)
	}
	if _, ok := payload.Variables["btc_price"]; !ok {
		t.Errorf("expected btc_price in variables, got %+v", payload.Variables)
	}
	if _, ok := payload.Variables["rebalance_ticker"]; ok {
		t.Errorf("rebalance_ticker should not exist in initialized variables")
	}
}

func TestProxyWatcherSingleVarState(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	programID := program.ProgramID("single-var-state-prog")
	buildID := program.BuildID("build-xyz")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	if err := hs.programRegistry.Register(meta); err != nil {
		t.Fatalf("failed to register program: %v", err)
	}

	registeredMeta, err := hs.programRegistry.Get(programID)
	if err != nil {
		t.Fatalf("failed to load metadata: %v", err)
	}

	watcherMux := http.NewServeMux()
	watcherMux.HandleFunc("/watcher/watching", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherWatchingResponse{
			WatchedVars: []string{"btc_price", "rebalance_ticker"},
			Count:       2,
			Timestamp:   "2026-02-09T04:10:00Z",
		})
	})
	watcherMux.HandleFunc("/watcher/varState", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherVarStateResponse{
			Variables: map[string]interface{}{
				"btc_price": 71105.96,
			},
			Count:     1,
			Timestamp: "2026-02-09T04:10:01Z",
		})
	})

	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", registeredMeta.PublishPort))
	if err != nil {
		t.Fatalf("failed to bind mock watcher server: %v", err)
	}
	watcherServer := &http.Server{Handler: watcherMux}
	go watcherServer.Serve(ln)
	defer watcherServer.Shutdown(context.Background())

	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go prog.Start(ctx)

	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: registeredMeta.PublishPort,
	}); err != nil {
		t.Fatalf("failed to send start event: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if prog.GetState().State == program.StateReady {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if prog.GetState().State != program.StateReady {
		t.Fatalf("program did not reach ready state, got %s", prog.GetState().State)
	}

	// initialized variable
	resp, err := http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/varState/btc_price")
	if err != nil {
		t.Fatalf("failed to request single var endpoint: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for initialized variable, got %d", resp.StatusCode)
	}
	var initializedResp WatcherSingleVarStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&initializedResp); err != nil {
		t.Fatalf("failed to decode initialized response: %v", err)
	}
	resp.Body.Close()
	if initializedResp.Name != "btc_price" || !initializedResp.Watched || !initializedResp.Initialized {
		t.Errorf("unexpected initialized response payload: %+v", initializedResp)
	}

	// watched but not initialized variable
	resp, err = http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/varState/rebalance_ticker")
	if err != nil {
		t.Fatalf("failed to request non-initialized variable: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for watched/non-initialized variable, got %d", resp.StatusCode)
	}
	var notInitializedResp WatcherSingleVarStateResponse
	if err := json.NewDecoder(resp.Body).Decode(&notInitializedResp); err != nil {
		t.Fatalf("failed to decode non-initialized response: %v", err)
	}
	resp.Body.Close()
	if notInitializedResp.Name != "rebalance_ticker" || !notInitializedResp.Watched || notInitializedResp.Initialized {
		t.Errorf("unexpected non-initialized response payload: %+v", notInitializedResp)
	}

	// variable not watched
	resp, err = http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/varState/eth_price")
	if err != nil {
		t.Fatalf("failed to request unknown variable: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown variable, got %d", resp.StatusCode)
	}
}

func TestProxyPathAllowlist(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	hs.SetProxyPathAllowlist([]string{
		"/watcher/watching-state",
		"/watcher/varState/*",
	})

	programID := program.ProgramID("allowlist-prog")
	buildID := program.BuildID("build-allow")
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	if err := hs.programRegistry.Register(meta); err != nil {
		t.Fatalf("failed to register program: %v", err)
	}

	registeredMeta, err := hs.programRegistry.Get(programID)
	if err != nil {
		t.Fatalf("failed to load metadata: %v", err)
	}

	watcherMux := http.NewServeMux()
	watcherMux.HandleFunc("/watcher/watching", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherWatchingResponse{
			WatchedVars: []string{"btc_price"},
			Count:       1,
			Timestamp:   "2026-02-09T04:10:00Z",
		})
	})
	watcherMux.HandleFunc("/watcher/varState", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherVarStateResponse{
			Variables: map[string]interface{}{
				"btc_price": 71105.96,
			},
			Count:     1,
			Timestamp: "2026-02-09T04:10:01Z",
		})
	})
	watcherMux.HandleFunc("/watcher/status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"state": "Ready",
		})
	})

	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", registeredMeta.PublishPort))
	if err != nil {
		t.Fatalf("failed to bind mock watcher server: %v", err)
	}
	watcherServer := &http.Server{Handler: watcherMux}
	go watcherServer.Serve(ln)
	defer watcherServer.Shutdown(context.Background())

	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	hs.programRegistry.SetProgramOnce(programID, prog)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go prog.Start(ctx)

	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: registeredMeta.PublishPort,
	}); err != nil {
		t.Fatalf("failed to send start event: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if prog.GetState().State == program.StateReady {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if prog.GetState().State != program.StateReady {
		t.Fatalf("program did not reach ready state, got %s", prog.GetState().State)
	}

	resp, err := http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/status")
	if err != nil {
		t.Fatalf("failed to request blocked path: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for blocked path, got %d", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/watching-state")
	if err != nil {
		t.Fatalf("failed to request allowed watching-state path: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for allowed watching-state path, got %d", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/programs/" + string(programID) + "/proxy/watcher/varState/btc_price")
	if err != nil {
		t.Fatalf("failed to request allowed varState path: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for allowed varState path, got %d", resp.StatusCode)
	}
}

func setupReadyWatcherProgram(
	t *testing.T,
	hs *HostServer,
	programID program.ProgramID,
	watchedVars []string,
	variables map[string]interface{},
) (func(), int) {
	t.Helper()

	buildID := program.BuildID("build-" + string(programID))
	meta := registry.ProgramMetadata{
		ProgramID: programID,
		BuildID:   buildID,
		UserID:    "user-123",
	}
	if err := hs.programRegistry.Register(meta); err != nil {
		t.Fatalf("failed to register program: %v", err)
	}

	registeredMeta, err := hs.programRegistry.Get(programID)
	if err != nil {
		t.Fatalf("failed to load metadata: %v", err)
	}

	watcherMux := http.NewServeMux()
	watcherMux.HandleFunc("/watcher/watching", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherWatchingResponse{
			WatchedVars: watchedVars,
			Count:       len(watchedVars),
			Timestamp:   "2026-03-07T10:10:00Z",
		})
	})
	watcherMux.HandleFunc("/watcher/varState", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(WatcherVarStateResponse{
			Variables: variables,
			Count:     len(variables),
			Timestamp: "2026-03-07T10:10:01Z",
		})
	})

	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", registeredMeta.PublishPort))
	if err != nil {
		t.Fatalf("failed to bind mock watcher server: %v", err)
	}
	watcherServer := &http.Server{Handler: watcherMux}
	go watcherServer.Serve(ln)

	fakeHandler := &program.FakeEffectHandler{}
	prog := program.NewProgram(programID, buildID, fakeHandler)
	if err := hs.programRegistry.SetProgramOnce(programID, prog); err != nil {
		t.Fatalf("failed to set program: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	go prog.Start(ctx)

	if err := prog.SendEvent(program.UserStartRequested{
		ProgramID:   programID,
		PublishPort: registeredMeta.PublishPort,
	}); err != nil {
		t.Fatalf("failed to send start event: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if prog.GetState().State == program.StateReady {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if prog.GetState().State != program.StateReady {
		t.Fatalf("program did not reach ready state, got %s", prog.GetState().State)
	}

	cleanup := func() {
		cancel()
		watcherServer.Shutdown(context.Background())
	}
	return cleanup, registeredMeta.PublishPort
}

func TestWatcherEndpointCatalog_AutoSyncAndRemoveOnStop(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	programID := program.ProgramID("watcher-catalog-stop")
	programCleanup, _ := setupReadyWatcherProgram(
		t,
		hs,
		programID,
		[]string{"rebalance_ticker", "btc_price"},
		map[string]interface{}{
			"btc_price": 72510.15,
		},
	)
	defer programCleanup()

	hs.checkAllPrograms()

	resp, err := http.Get(ts.URL + "/watcher/endpoints/" + string(programID))
	if err != nil {
		t.Fatalf("failed to query watcher endpoint descriptor: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var descriptor WatcherEndpointDescriptor
	if err := json.NewDecoder(resp.Body).Decode(&descriptor); err != nil {
		t.Fatalf("failed to decode descriptor: %v", err)
	}
	resp.Body.Close()

	if descriptor.ProgramID != programID {
		t.Fatalf("expected programID %s, got %s", programID, descriptor.ProgramID)
	}
	if descriptor.WatchingStateEndpoint != "/programs/"+string(programID)+"/proxy/watcher/watching-state" {
		t.Fatalf("unexpected watching state endpoint: %s", descriptor.WatchingStateEndpoint)
	}
	if descriptor.VarStateEndpoints["btc_price"] != "/programs/"+string(programID)+"/proxy/watcher/varState/btc_price" {
		t.Fatalf("unexpected btc_price endpoint: %s", descriptor.VarStateEndpoints["btc_price"])
	}
	if descriptor.VarStateEndpoints["rebalance_ticker"] != "/programs/"+string(programID)+"/proxy/watcher/varState/rebalance_ticker" {
		t.Fatalf("unexpected rebalance_ticker endpoint: %s", descriptor.VarStateEndpoints["rebalance_ticker"])
	}

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/programs/"+string(programID)+"/stop", nil)
	stopResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("failed to request stop: %v", err)
	}
	stopResp.Body.Close()
	if stopResp.StatusCode != http.StatusOK {
		t.Fatalf("expected stop status 200, got %d", stopResp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/watcher/endpoints/" + string(programID))
	if err != nil {
		t.Fatalf("failed to query watcher endpoint descriptor after stop: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after stop, got %d", resp.StatusCode)
	}
}

func TestWatcherEndpointCatalog_RemoveOnDelete(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	programID := program.ProgramID("watcher-catalog-delete")
	programCleanup, _ := setupReadyWatcherProgram(
		t,
		hs,
		programID,
		[]string{"btc_price"},
		map[string]interface{}{
			"btc_price": 73000.00,
		},
	)
	defer programCleanup()

	hs.checkAllPrograms()

	resp, err := http.Get(ts.URL + "/watcher/endpoints/" + string(programID))
	if err != nil {
		t.Fatalf("failed to query watcher endpoint descriptor: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 before delete, got %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/programs/"+string(programID), nil)
	deleteResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("failed to request delete: %v", err)
	}
	deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("expected delete status 200, got %d", deleteResp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/watcher/endpoints/" + string(programID))
	if err != nil {
		t.Fatalf("failed to query watcher endpoint descriptor after delete: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", resp.StatusCode)
	}
}

func TestWatcherEndpointCatalog_ListActivePrograms(t *testing.T) {
	hs, ts, cleanup := setupTestServer(t)
	defer cleanup()

	activeID := program.ProgramID("watcher-catalog-active")
	activeCleanup, _ := setupReadyWatcherProgram(
		t,
		hs,
		activeID,
		[]string{"btc_price", "stats_ticker"},
		map[string]interface{}{
			"btc_price": 71000.00,
		},
	)
	defer activeCleanup()

	// Registered but not ready -> should not appear.
	idleID := program.ProgramID("watcher-catalog-idle")
	if err := hs.programRegistry.Register(registry.ProgramMetadata{
		ProgramID: idleID,
		BuildID:   program.BuildID("build-idle"),
		UserID:    "user-123",
	}); err != nil {
		t.Fatalf("failed to register idle program: %v", err)
	}
	idleProg := program.NewProgram(idleID, program.BuildID("build-idle"), &program.FakeEffectHandler{})
	if err := hs.programRegistry.SetProgramOnce(idleID, idleProg); err != nil {
		t.Fatalf("failed to set idle program: %v", err)
	}
	idleCtx, idleCancel := context.WithCancel(context.Background())
	defer idleCancel()
	go idleProg.Start(idleCtx)

	hs.checkAllPrograms()

	resp, err := http.Get(ts.URL + "/watcher/endpoints")
	if err != nil {
		t.Fatalf("failed to query watcher endpoint catalog: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var catalog WatcherEndpointCatalogResponse
	if err := json.NewDecoder(resp.Body).Decode(&catalog); err != nil {
		t.Fatalf("failed to decode catalog: %v", err)
	}
	if catalog.Count != 1 {
		t.Fatalf("expected count=1, got %d", catalog.Count)
	}
	if len(catalog.Endpoints) != 1 || catalog.Endpoints[0].ProgramID != activeID {
		t.Fatalf("unexpected catalog entries: %+v", catalog.Endpoints)
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
