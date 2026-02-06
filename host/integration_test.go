//go:build integration
// +build integration

package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/host/api"
	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/proxy"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
)

func setupIntegrationTest(t *testing.T) (*api.HostServer, string, func()) {
	// Create temporary directory
	tmpDir, err := os.MkdirTemp("", "host-integration-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	// Create components
	reg := registry.NewRegistry()
	pm := proxy.NewProxyManager()
	stor := storage.NewManager(tmpDir)
	comp := compose.NewBuilder()

	// Create Docker manager
	dockerMgr, err := runtime.NewDockerManager()
	if err != nil {
		t.Fatalf("Failed to create Docker manager: %v", err)
	}

	hs := api.NewHostServer(reg, pm, stor, comp, dockerMgr)

	// Set effect handler factory to create RealEffectHandler
	hs.SetEffectHandlerFactory(func() program.EffectHandler {
		handler := NewRealEffectHandler(stor, comp, dockerMgr)
		handler.SetDefaultRuntime("runc") // Use runc for testing
		return handler
	})

	// Start HTTP server in background
	go func() {
		if err := hs.Start(18080); err != nil && err != http.ErrServerClosed {
			t.Logf("HTTP server error: %v", err)
		}
	}()

	// Wait for server to start
	time.Sleep(200 * time.Millisecond)

	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		hs.Stop(ctx)
		dockerMgr.Close()
		os.RemoveAll(tmpDir)
	}

	return hs, tmpDir, cleanup
}

// TestFullLifecycle_SingleProgram tests complete program lifecycle
func TestFullLifecycle_SingleProgram(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	_, _, cleanup := setupIntegrationTest(t)
	defer cleanup()

	baseURL := "http://localhost:18080"

	// Step 1: Create program
	t.Log("Step 1: Creating program...")
	createReq := api.CreateProgramRequest{
		UserID: "user-test-1",
		Dockerfile: `FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY test.sh /app/
CMD ["/bin/sh", "/app/test.sh"]`,
		SrcFiles: map[string]string{
			"test.sh": `#!/bin/sh
echo "Program is running"
sleep 3600`,
		},
	}

	body, _ := json.Marshal(createReq)
	resp, err := http.Post(baseURL+"/programs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("Failed to create program: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		t.Fatalf("Expected status 201, got %d. Body: %s", resp.StatusCode, string(bodyBytes))
	}

	var createResp api.CreateProgramResponse
	if err := json.NewDecoder(resp.Body).Decode(&createResp); err != nil {
		t.Fatalf("Failed to decode create response: %v", err)
	}

	programID := createResp.ProgramID
	t.Logf("Program created: %s", programID)
	t.Logf("Proxy URL: %s", createResp.ProxyURL)

	// Step 2: Get program (should be in Created state)
	t.Log("Step 2: Getting program details...")
	resp, err = http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
	if err != nil {
		t.Fatalf("Failed to get program: %v", err)
	}
	defer resp.Body.Close()

	var getResp api.GetProgramResponse
	json.NewDecoder(resp.Body).Decode(&getResp)
	if getResp.State != "Created" {
		t.Errorf("Expected state 'Created', got %s", getResp.State)
	}

	// Step 3: Start program
	t.Log("Step 3: Starting program (this may take 2-3 minutes)...")
	resp, err = http.Post(fmt.Sprintf("%s/programs/%s/start", baseURL, programID), "application/json", nil)
	if err != nil {
		t.Fatalf("Failed to start program: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		t.Fatalf("Expected status 200, got %d. Body: %s", resp.StatusCode, string(bodyBytes))
	}

	// Step 4: Wait for Ready state
	t.Log("Step 4: Waiting for program to reach Ready state...")
	deadline := time.Now().Add(5 * time.Minute)
	var finalState string
	for time.Now().Before(deadline) {
		resp, err := http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
		if err != nil {
			t.Fatalf("Failed to get program: %v", err)
		}

		var getResp api.GetProgramResponse
		json.NewDecoder(resp.Body).Decode(&getResp)
		resp.Body.Close()

		finalState = getResp.State
		t.Logf("Current state: %s", finalState)

		if finalState == "Ready" {
			t.Log("Program is Ready!")
			break
		}

		if finalState == "Error" {
			t.Fatalf("Program entered Error state")
		}

		time.Sleep(5 * time.Second)
	}

	if finalState != "Ready" {
		t.Fatalf("Program did not reach Ready state within timeout. Final state: %s", finalState)
	}

	// Step 5: Verify program details
	t.Log("Step 5: Verifying program details...")
	resp, err = http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
	if err != nil {
		t.Fatalf("Failed to get program: %v", err)
	}
	defer resp.Body.Close()

	json.NewDecoder(resp.Body).Decode(&getResp)

	if getResp.ImageID == "" {
		t.Error("ImageID should be set")
	}
	if getResp.ContainerID == "" {
		t.Error("ContainerID should be set")
	}
	t.Logf("ImageID: %s", getResp.ImageID)
	t.Logf("ContainerID: %s", getResp.ContainerID)

	// Step 6: Test proxy access (if WatcherAPI is running)
	t.Log("Step 6: Testing proxy access...")
	// Note: This will fail if container doesn't have WatcherAPI on :8080
	// This is expected for the test.sh container
	resp, err = http.Get(fmt.Sprintf("%s/programs/%s/proxy/test", baseURL, programID))
	if err != nil {
		t.Logf("Proxy request failed (expected): %v", err)
	} else {
		resp.Body.Close()
		t.Logf("Proxy responded with status: %d", resp.StatusCode)
	}

	// Step 7: Stop program
	t.Log("Step 7: Stopping program...")
	resp, err = http.Post(fmt.Sprintf("%s/programs/%s/stop", baseURL, programID), "application/json", nil)
	if err != nil {
		t.Fatalf("Failed to stop program: %v", err)
	}
	defer resp.Body.Close()

	// Wait for program to stop
	time.Sleep(3 * time.Second)

	// Step 8: Delete program
	t.Log("Step 8: Deleting program...")
	req, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/programs/%s", baseURL, programID), nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Failed to delete program: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	// Step 9: Verify program is deleted
	t.Log("Step 9: Verifying program is deleted...")
	resp, err = http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
	if err != nil {
		t.Fatalf("Failed to get program: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Expected status 404 after deletion, got %d", resp.StatusCode)
	}

	t.Log("✅ Full lifecycle test completed successfully!")
}

// TestProgramWithFileSystem tests program with /state volume operations
func TestProgramWithFileSystem(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	_, tmpDir, cleanup := setupIntegrationTest(t)
	defer cleanup()

	baseURL := "http://localhost:18080"

	// Create program with filesystem operations
	t.Log("Creating program with filesystem operations...")
	createReq := api.CreateProgramRequest{
		UserID: "user-test-fs",
		Dockerfile: `FROM alpine:latest
WORKDIR /app
COPY test.sh /app/
CMD ["/bin/sh", "/app/test.sh"]`,
		SrcFiles: map[string]string{
			"test.sh": `#!/bin/sh
echo "Testing filesystem..."

# Test 1: Write to /state (should succeed)
echo "test data" > /state/test.txt
if [ $? -eq 0 ]; then
    echo "✅ Write to /state succeeded"
else
    echo "❌ Write to /state failed"
    exit 1
fi

# Test 2: Read from /state
cat /state/test.txt
if [ $? -eq 0 ]; then
    echo "✅ Read from /state succeeded"
else
    echo "❌ Read from /state failed"
    exit 1
fi

# Test 3: Try to write to root filesystem (should fail)
echo "fail" > /test.txt 2>&1
if [ $? -ne 0 ]; then
    echo "✅ Root filesystem is read-only (expected)"
else
    echo "❌ Root filesystem is writable (unexpected)"
    exit 1
fi

echo "All filesystem tests passed!"
sleep 3600`,
		},
	}

	body, _ := json.Marshal(createReq)
	resp, err := http.Post(baseURL+"/programs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("Failed to create program: %v", err)
	}
	defer resp.Body.Close()

	var createResp api.CreateProgramResponse
	json.NewDecoder(resp.Body).Decode(&createResp)
	programID := createResp.ProgramID
	t.Logf("Program created: %s", programID)

	// Start program
	t.Log("Starting program...")
	http.Post(fmt.Sprintf("%s/programs/%s/start", baseURL, programID), "application/json", nil)

	// Wait for Ready state
	t.Log("Waiting for Ready state...")
	deadline := time.Now().Add(5 * time.Minute)
	var finalState string
	for time.Now().Before(deadline) {
		resp, _ := http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
		var getResp api.GetProgramResponse
		json.NewDecoder(resp.Body).Decode(&getResp)
		resp.Body.Close()

		finalState = getResp.State
		if finalState == "Ready" || finalState == "Error" {
			break
		}
		time.Sleep(3 * time.Second)
	}

	if finalState != "Ready" {
		t.Fatalf("Program did not reach Ready state. Final state: %s", finalState)
	}

	// Verify /state file was created on host
	t.Log("Verifying /state volume on host...")
	statePath := filepath.Join(tmpDir, string(programID), "state", "test.txt")
	if _, err := os.Stat(statePath); os.IsNotExist(err) {
		t.Error("/state/test.txt was not created on host filesystem")
	} else {
		content, _ := os.ReadFile(statePath)
		t.Logf("/state/test.txt content: %s", string(content))
		if string(content) != "test data\n" {
			t.Errorf("Expected 'test data', got %q", string(content))
		}
	}

	// Cleanup
	http.Post(fmt.Sprintf("%s/programs/%s/stop", baseURL, programID), "application/json", nil)
	time.Sleep(2 * time.Second)
	req, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/programs/%s", baseURL, programID), nil)
	http.DefaultClient.Do(req)

	t.Log("✅ Filesystem test completed successfully!")
}

// TestMultiplePrograms_ParallelExecution tests multiple programs running simultaneously
func TestMultiplePrograms_ParallelExecution(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	_, _, cleanup := setupIntegrationTest(t)
	defer cleanup()

	baseURL := "http://localhost:18080"

	// Create 3 programs
	programIDs := make([]program.ProgramID, 3)
	proxyPorts := make([]int, 3)

	for i := 0; i < 3; i++ {
		t.Logf("Creating program %d...", i+1)
		createReq := api.CreateProgramRequest{
			UserID: fmt.Sprintf("user-multi-%d", i),
			Dockerfile: `FROM alpine:latest
WORKDIR /app
COPY test.sh /app/
CMD ["/bin/sh", "/app/test.sh"]`,
			SrcFiles: map[string]string{
				"test.sh": fmt.Sprintf(`#!/bin/sh
echo "Program %d is running"
sleep 3600`, i),
			},
		}

		body, _ := json.Marshal(createReq)
		resp, err := http.Post(baseURL+"/programs", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("Failed to create program %d: %v", i, err)
		}

		var createResp api.CreateProgramResponse
		json.NewDecoder(resp.Body).Decode(&createResp)
		resp.Body.Close()

		programIDs[i] = createResp.ProgramID
		// Extract port from proxy URL
		fmt.Sscanf(createResp.ProxyURL, "http://localhost:%d", &proxyPorts[i])
		t.Logf("Program %d created: %s (port %d)", i+1, programIDs[i], proxyPorts[i])
	}

	// Verify all ports are unique
	portSet := make(map[int]bool)
	for _, port := range proxyPorts {
		if portSet[port] {
			t.Errorf("Duplicate port allocated: %d", port)
		}
		portSet[port] = true
	}
	t.Logf("All ports are unique: %v", proxyPorts)

	// Start all programs in parallel
	t.Log("Starting all programs...")
	for i, programID := range programIDs {
		go func(i int, id program.ProgramID) {
			http.Post(fmt.Sprintf("%s/programs/%s/start", baseURL, id), "application/json", nil)
		}(i, programID)
	}

	// Wait for all to reach Ready state
	t.Log("Waiting for all programs to reach Ready state...")
	deadline := time.Now().Add(10 * time.Minute)
	allReady := false

	for time.Now().Before(deadline) && !allReady {
		allReady = true
		for i, programID := range programIDs {
			resp, _ := http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
			var getResp api.GetProgramResponse
			json.NewDecoder(resp.Body).Decode(&getResp)
			resp.Body.Close()

			t.Logf("Program %d state: %s", i+1, getResp.State)

			if getResp.State != "Ready" {
				allReady = false
			}
		}

		if !allReady {
			time.Sleep(5 * time.Second)
		}
	}

	if !allReady {
		t.Fatal("Not all programs reached Ready state within timeout")
	}

	t.Log("✅ All programs are Ready!")

	// All programs registered and running
	t.Log("All programs are registered and running via API")

	// Stop and delete all programs
	t.Log("Cleaning up programs...")
	for _, programID := range programIDs {
		http.Post(fmt.Sprintf("%s/programs/%s/stop", baseURL, programID), "application/json", nil)
	}

	time.Sleep(3 * time.Second)

	for _, programID := range programIDs {
		req, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/programs/%s", baseURL, programID), nil)
		http.DefaultClient.Do(req)
	}

	t.Log("✅ Multiple programs test completed successfully!")
}

// TestStatePersistence tests state file persistence across container restarts
func TestStatePersistence(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	hs, tmpDir, cleanup := setupIntegrationTest(t)
	defer cleanup()

	baseURL := "http://localhost:18080"

	// Create program that writes and reads state
	t.Log("Creating program with state persistence...")
	createReq := api.CreateProgramRequest{
		UserID: "user-persist-test",
		Dockerfile: `FROM alpine:latest
WORKDIR /app
COPY persist.sh /app/
CMD ["/bin/sh", "/app/persist.sh"]`,
		SrcFiles: map[string]string{
			"persist.sh": `#!/bin/sh
echo "=== State Persistence Test ==="
echo "Container started at: $(date)"

# List /state directory contents before check
echo "--- /state directory before check ---"
ls -la /state/ || echo "Failed to list /state"

# Check if state file exists from previous run
if [ -f /state/counter.txt ]; then
    COUNTER=$(cat /state/counter.txt)
    echo "✅ Found existing counter file: $COUNTER"
    COUNTER=$((COUNTER + 1))
    echo "Incrementing counter to: $COUNTER"
else
    COUNTER=1
    echo "⚠️  No existing counter file, starting at 1"
fi

# Write new counter value with sync
echo $COUNTER > /state/counter.txt
sync
echo "Wrote counter: $COUNTER to /state/counter.txt"

# Verify write immediately
VERIFY=$(cat /state/counter.txt)
echo "Verified counter in container: $VERIFY"

# Write timestamp with sync
date > /state/timestamp.txt
sync
echo "Wrote timestamp to /state/timestamp.txt"

# List /state directory contents after write
echo "--- /state directory after write ---"
ls -la /state/

# Keep container running
echo "Container ready and running"
sleep 3600`,
		},
	}

	body, _ := json.Marshal(createReq)
	resp, err := http.Post(baseURL+"/programs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("Failed to create program: %v", err)
	}
	defer resp.Body.Close()

	var createResp api.CreateProgramResponse
	json.NewDecoder(resp.Body).Decode(&createResp)
	programID := createResp.ProgramID
	t.Logf("Program created: %s", programID)

	// Helper function to get container logs
	getContainerLogs := func(runLabel string) {
		prog, exists := hs.GetProgram(programID)
		if !exists {
			t.Logf("[%s] Program not found in registry", runLabel)
			return
		}

		state := prog.GetState()
		if state.ContainerID == "" {
			t.Logf("[%s] No container ID yet", runLabel)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		dockerMgr := hs.GetRuntime()
		logs, err := dockerMgr.GetLogs(ctx, state.ContainerID)
		if err != nil {
			t.Logf("[%s] Failed to get container logs: %v", runLabel, err)
			return
		}

		t.Logf("[%s] === Container Logs (ContainerID: %s) ===", runLabel, state.ContainerID[:12])
		t.Logf("[%s]\n%s", runLabel, logs)
		t.Logf("[%s] === End Container Logs ===", runLabel)
	}

	// First run: Start and verify state file
	t.Log("=== FIRST RUN ===")
	startTime1 := time.Now()
	t.Logf("First run started at: %s", startTime1.Format(time.RFC3339))

	http.Post(fmt.Sprintf("%s/programs/%s/start", baseURL, programID), "application/json", nil)

	// Wait for Ready
	var firstContainerID string
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		resp, _ := http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
		var getResp api.GetProgramResponse
		json.NewDecoder(resp.Body).Decode(&getResp)
		resp.Body.Close()

		t.Logf("First run state: %s", getResp.State)
		if getResp.State == "Ready" {
			firstContainerID = getResp.ContainerID
			readyTime1 := time.Now()
			t.Logf("First run reached Ready at: %s (took %v)", readyTime1.Format(time.RFC3339), readyTime1.Sub(startTime1))
			break
		}
		time.Sleep(3 * time.Second)
	}

	// Wait for container to fully initialize and execute script
	time.Sleep(5 * time.Second)

	// Get first run logs
	getContainerLogs("FIRST RUN")

	// Verify first counter value on host
	counterPath := filepath.Join(tmpDir, string(programID), "state", "counter.txt")
	content1, err := os.ReadFile(counterPath)
	if err != nil {
		t.Fatalf("Failed to read counter on first run: %v", err)
	}
	t.Logf("First run counter (from host): %q", string(content1))

	if string(content1) != "1\n" {
		t.Errorf("Expected counter '1', got %q", string(content1))
	}

	// Verify /state directory on host
	stateDirPath := filepath.Join(tmpDir, string(programID), "state")
	entries, _ := os.ReadDir(stateDirPath)
	t.Logf("Host /state directory contents after first run:")
	for _, entry := range entries {
		info, _ := entry.Info()
		t.Logf("  - %s (size: %d, modified: %s)", entry.Name(), info.Size(), info.ModTime().Format(time.RFC3339))
	}

	// Stop program
	t.Log("=== STOPPING PROGRAM ===")
	stopTime := time.Now()
	t.Logf("Stop requested at: %s", stopTime.Format(time.RFC3339))

	http.Post(fmt.Sprintf("%s/programs/%s/stop", baseURL, programID), "application/json", nil)

	// Wait for Stopped state
	deadline = time.Now().Add(30 * time.Second)
	var finalStopState string
	for time.Now().Before(deadline) {
		resp, _ := http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
		var getResp api.GetProgramResponse
		json.NewDecoder(resp.Body).Decode(&getResp)
		resp.Body.Close()

		finalStopState = getResp.State
		t.Logf("Stop phase state: %s", finalStopState)

		if finalStopState == "Stopped" {
			break
		}
		time.Sleep(1 * time.Second)
	}

	stoppedTime := time.Now()
	t.Logf("Stop completed at: %s (took %v), final state: %s", stoppedTime.Format(time.RFC3339), stoppedTime.Sub(stopTime), finalStopState)

	if finalStopState != "Stopped" {
		t.Errorf("⚠️  Program did not reach Stopped state, got: %s", finalStopState)
	}

	// Verify /state still exists on host after stop
	entries, _ = os.ReadDir(stateDirPath)
	t.Logf("Host /state directory contents after stop:")
	for _, entry := range entries {
		info, _ := entry.Info()
		t.Logf("  - %s (size: %d, modified: %s)", entry.Name(), info.Size(), info.ModTime().Format(time.RFC3339))
	}

	// Second run: Restart and verify counter incremented
	t.Log("=== SECOND RUN ===")
	startTime2 := time.Now()
	t.Logf("Second run started at: %s", startTime2.Format(time.RFC3339))

	startResp, err := http.Post(fmt.Sprintf("%s/programs/%s/start", baseURL, programID), "application/json", nil)
	if err != nil {
		t.Fatalf("Failed to send second start request: %v", err)
	}
	startBody, _ := io.ReadAll(startResp.Body)
	startResp.Body.Close()
	t.Logf("Second start response (status %d): %s", startResp.StatusCode, string(startBody))

	// Wait for Ready again
	var secondContainerID string
	deadline = time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		resp, _ := http.Get(fmt.Sprintf("%s/programs/%s", baseURL, programID))
		var getResp api.GetProgramResponse
		json.NewDecoder(resp.Body).Decode(&getResp)
		resp.Body.Close()

		t.Logf("Second run state: %s", getResp.State)
		if getResp.State == "Ready" {
			secondContainerID = getResp.ContainerID
			readyTime2 := time.Now()
			t.Logf("Second run reached Ready at: %s (took %v)", readyTime2.Format(time.RFC3339), readyTime2.Sub(startTime2))
			break
		}
		time.Sleep(3 * time.Second)
	}

	// Compare container IDs
	t.Logf("First container ID:  %s", firstContainerID[:12])
	t.Logf("Second container ID: %s", secondContainerID[:12])
	if firstContainerID == secondContainerID {
		t.Error("⚠️  Container IDs are identical - same container reused (expected new container)")
	} else {
		t.Log("✅ New container created for second run")
	}

	// Wait for container to fully initialize and execute script
	time.Sleep(5 * time.Second)

	// Get second run logs
	getContainerLogs("SECOND RUN")

	// Verify second counter value (should be 2)
	content2, err := os.ReadFile(counterPath)
	if err != nil {
		t.Fatalf("Failed to read counter on second run: %v", err)
	}
	t.Logf("Second run counter (from host): %q", string(content2))

	if string(content2) != "2\n" {
		t.Errorf("❌ Expected counter '2' after restart, got %q", string(content2))
		t.Error("Root cause: Container script did not detect existing /state/counter.txt file")
	} else {
		t.Log("✅ Counter successfully incremented from 1 → 2")
	}

	// Verify timestamp file also persisted
	timestampPath := filepath.Join(tmpDir, string(programID), "state", "timestamp.txt")
	if _, err := os.Stat(timestampPath); os.IsNotExist(err) {
		t.Error("Timestamp file not found after restart")
	} else {
		timestamp, _ := os.ReadFile(timestampPath)
		t.Logf("✅ Timestamp file persisted: %s", string(timestamp))
	}

	// Final /state directory listing
	entries, _ = os.ReadDir(stateDirPath)
	t.Logf("Final host /state directory contents:")
	for _, entry := range entries {
		info, _ := entry.Info()
		t.Logf("  - %s (size: %d, modified: %s)", entry.Name(), info.Size(), info.ModTime().Format(time.RFC3339))
	}

	// Cleanup
	t.Log("Cleaning up...")
	http.Post(fmt.Sprintf("%s/programs/%s/stop", baseURL, programID), "application/json", nil)
	time.Sleep(2 * time.Second)
	req, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/programs/%s", baseURL, programID), nil)
	http.DefaultClient.Do(req)

	t.Log("=== TEST SUMMARY ===")
	if string(content2) == "2\n" {
		t.Log("✅ State persistence test PASSED")
		t.Logf("   Counter incremented from 1 → 2 across container restart")
	} else {
		t.Log("❌ State persistence test FAILED")
		t.Logf("   Counter remained at %q (expected 2)", string(content2))
	}
}
