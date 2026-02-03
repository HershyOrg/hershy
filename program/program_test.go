package program

import (
	"context"
	"testing"
	"time"

	"program/api"
	"program/builder"
	"program/proxy"
	"program/runtime"
)

func TestNewProgram(t *testing.T) {
	config := ProgramConfig{
		Name:    "test-program",
		Version: "1.0.0",
		Port:    9091,
	}

	prog, err := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(proxy.NewMockProxy(9091)),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)

	if err != nil {
		t.Fatalf("NewProgram failed: %v", err)
	}

	if prog.Name != "test-program" {
		t.Errorf("Expected name=test-program, got %s", prog.Name)
	}

	if prog.GetState() != StateCreated {
		t.Errorf("Expected state=created, got %s", prog.GetState())
	}
}

func TestProgram_BuildWorkflow(t *testing.T) {
	config := ProgramConfig{
		Name:    "build-test",
		Version: "1.0.0",
		Port:    9092,
	}

	prog, err := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(proxy.NewMockProxy(9092)),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)
	if err != nil {
		t.Fatalf("NewProgram failed: %v", err)
	}

	ctx := context.Background()

	// Initial state should be "created"
	if prog.GetState() != StateCreated {
		t.Errorf("Initial state should be 'created', got %s", prog.GetState())
	}

	// Build
	err = prog.Build(ctx, "Dockerfile", ".")
	if err != nil {
		t.Fatalf("Build failed: %v", err)
	}

	// State should be "built"
	if prog.GetState() != StateBuilt {
		t.Errorf("After build, state should be 'built', got %s", prog.GetState())
	}

	// Image ID should be set
	info := prog.GetInfo()
	if info.ImageID == "" {
		t.Error("ImageID should be set after build")
	}
}

func TestProgram_FullLifecycle(t *testing.T) {
	config := ProgramConfig{
		Name:    "lifecycle-test",
		Version: "1.0.0",
		Port:    9093,
	}

	prog, err := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(proxy.NewMockProxy(9093)),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)
	if err != nil {
		t.Fatalf("NewProgram failed: %v", err)
	}

	ctx := context.Background()

	// 1. Build
	t.Log("Step 1: Building...")
	err = prog.Build(ctx, "Dockerfile", ".")
	if err != nil {
		t.Fatalf("Build failed: %v", err)
	}

	if prog.GetState() != StateBuilt {
		t.Fatalf("Expected state=built, got %s", prog.GetState())
	}

	// 2. Start
	t.Log("Step 2: Starting...")
	resources := ResourceSpec{
		CPULimit:    "500m",
		MemoryLimit: "256Mi",
	}
	env := map[string]string{"TEST_ENV": "value"}

	err = prog.Start(ctx, resources, env)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	if prog.GetState() != StateRunning {
		t.Fatalf("Expected state=running, got %s", prog.GetState())
	}

	// Give it a moment to "start"
	time.Sleep(100 * time.Millisecond)

	// 3. Get Status
	t.Log("Step 3: Getting status...")
	status, err := prog.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}

	if status.State != "running" {
		t.Errorf("Expected status.State=running, got %s", status.State)
	}

	if !status.Healthy {
		t.Error("Expected status.Healthy=true")
	}

	// 4. Stop
	t.Log("Step 4: Stopping...")
	err = prog.Stop(ctx)
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	if prog.GetState() != StateStopped {
		t.Fatalf("Expected state=stopped, got %s", prog.GetState())
	}

	t.Log("✅ Full lifecycle test passed")
}

func TestProgram_StateMachine(t *testing.T) {
	config := ProgramConfig{
		Name:    "state-test",
		Version: "1.0.0",
		Port:    9094,
	}

	prog, err := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(proxy.NewMockProxy(9094)),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)
	if err != nil {
		t.Fatalf("NewProgram failed: %v", err)
	}

	ctx := context.Background()

	// Cannot start before build
	resources := ResourceSpec{CPULimit: "500m", MemoryLimit: "256Mi"}
	err = prog.Start(ctx, resources, nil)
	if err == nil {
		t.Error("Start should fail before build")
	}

	// Build
	prog.Build(ctx, "Dockerfile", ".")

	// Cannot build again while built
	err = prog.Build(ctx, "Dockerfile", ".")
	if err == nil {
		t.Error("Build should fail when already built")
	}

	// Start
	prog.Start(ctx, resources, nil)

	// Cannot stop before build/start
	prog2, _ := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(proxy.NewMockProxy(9095)),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)
	err = prog2.Stop(ctx)
	if err == nil {
		t.Error("Stop should fail when not running")
	}

	t.Log("✅ State machine test passed")
}

func TestProgram_GetInfo(t *testing.T) {
	config := ProgramConfig{
		Name:    "info-test",
		Version: "2.0.0",
		Port:    9096,
	}

	prog, err := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(proxy.NewMockProxy(9096)),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)
	if err != nil {
		t.Fatalf("NewProgram failed: %v", err)
	}

	info := prog.GetInfo()

	if info.Name != "info-test" {
		t.Errorf("Expected Name=info-test, got %s", info.Name)
	}

	if info.Version != "2.0.0" {
		t.Errorf("Expected Version=2.0.0, got %s", info.Version)
	}

	if info.Port != 9096 {
		t.Errorf("Expected Port=9096, got %d", info.Port)
	}

	if info.State != "created" {
		t.Errorf("Expected State=created, got %s", info.State)
	}
}

func TestProgram_ProxyAccess(t *testing.T) {
	config := ProgramConfig{
		Name:    "proxy-test",
		Version: "1.0.0",
		Port:    9097,
	}

	mockProxy := proxy.NewMockProxy(9097)
	prog, err := NewProgram(config,
		WithBuilder(builder.NewMockBuilder()),
		WithRuntime(runtime.NewMockRuntime()),
		WithProxy(mockProxy),
		WithAPIServer(api.NewMockServer(api.NewMockHandler())),
	)
	if err != nil {
		t.Fatalf("NewProgram failed: %v", err)
	}

	// Get proxy
	proxyRef := prog.GetProxy()
	if proxyRef == nil {
		t.Fatal("GetProxy returned nil")
	}

	// Send message through proxy
	err = proxyRef.SendMessage("test-message")
	if err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	// Check message was recorded
	if len(mockProxy.SentMessages) != 1 {
		t.Errorf("Expected 1 sent message, got %d", len(mockProxy.SentMessages))
	}

	if mockProxy.SentMessages[0] != "test-message" {
		t.Errorf("Expected message='test-message', got %s", mockProxy.SentMessages[0])
	}
}
