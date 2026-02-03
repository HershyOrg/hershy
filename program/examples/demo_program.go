// demo_program.go demonstrates how to use the Program API to build and run a user container.
//
// This demo uses Mock implementations to simulate the entire workflow without requiring
// Docker or gVisor. It shows:
// 1. Creating a Program with mock components
// 2. Building an image from a Dockerfile
// 3. Starting the container
// 4. Querying status
// 5. Using the proxy to communicate with WatcherServer
// 6. Stopping the container
//
// Usage:
//   go run examples/demo_program.go
package main

import (
	"context"
	"fmt"
	"time"

	"program"
	"program/api"
	"program/builder"
	"program/proxy"
	"program/runtime"
)

func main() {
	fmt.Println("╔══════════════════════════════════════════════════════════╗")
	fmt.Println("║       Program Demo - Container Manager Workflow         ║")
	fmt.Println("╚══════════════════════════════════════════════════════════╝")
	fmt.Println()

	// 1. Create Program with mock components
	fmt.Println("📦 Step 1: Creating Program...")
	fmt.Println("   Using mock components (no Docker/gVisor required)")

	config := program.ProgramConfig{
		Name:           "demo-program",
		Version:        "1.0.0",
		Port:           9091,
		DockerfilePath: "Dockerfile",
		ContextPath:    "./examples/simple",
	}

	// Create mock components
	mockBuilder := builder.NewMockBuilder()
	mockRuntime := runtime.NewMockRuntime()
	mockProxy := proxy.NewMockProxy(config.Port)
	mockHandler := api.NewMockHandler()
	mockAPIServer := api.NewMockServer(mockHandler)

	// Create Program with dependency injection
	prog, err := program.NewProgram(config,
		program.WithBuilder(mockBuilder),
		program.WithRuntime(mockRuntime),
		program.WithProxy(mockProxy),
		program.WithAPIServer(mockAPIServer),
	)
	if err != nil {
		panic(err)
	}

	fmt.Printf("   ✅ Program created: %s (version %s)\n", prog.Name, prog.Version)
	fmt.Printf("   ✅ State: %s\n", prog.GetState())
	fmt.Println()

	// 2. Build image
	fmt.Println("🔨 Step 2: Building container image...")
	fmt.Println("   Dockerfile: examples/simple/Dockerfile")

	ctx := context.Background()
	err = prog.Build(ctx, config.DockerfilePath, config.ContextPath)
	if err != nil {
		panic(err)
	}

	info := prog.GetInfo()
	fmt.Printf("   ✅ Build complete\n")
	fmt.Printf("   ✅ Image ID: %s\n", info.ImageID)
	fmt.Printf("   ✅ State: %s\n", prog.GetState())
	fmt.Println()

	// 3. Start container
	fmt.Println("🚀 Step 3: Starting container...")

	resources := program.ResourceSpec{
		CPULimit:    "500m",
		MemoryLimit: "256Mi",
	}
	env := map[string]string{
		"PROGRAM_NAME":    config.Name,
		"PROGRAM_VERSION": config.Version,
		"TEST_ENV":        "demo-value",
	}

	err = prog.Start(ctx, resources, env)
	if err != nil {
		panic(err)
	}

	info = prog.GetInfo()
	fmt.Printf("   ✅ Container started\n")
	fmt.Printf("   ✅ Container ID: %s\n", info.ContainerID)
	fmt.Printf("   ✅ State: %s\n", prog.GetState())
	fmt.Println()

	// Give container time to "start"
	time.Sleep(200 * time.Millisecond)

	// 4. Query status
	fmt.Println("📊 Step 4: Querying Program status...")

	status, err := prog.GetStatus(ctx)
	if err != nil {
		panic(err)
	}

	fmt.Printf("   Program State: %s\n", status.State)
	fmt.Printf("   Container State: %s\n", status.ContainerState)
	fmt.Printf("   Healthy: %t\n", status.Healthy)
	fmt.Printf("   Uptime: %.2f seconds\n", status.Uptime)
	if status.WatcherStatus != nil {
		fmt.Printf("   WatcherServer:\n")
		fmt.Printf("     - State: %v\n", status.WatcherStatus["state"])
		fmt.Printf("     - Running: %v\n", status.WatcherStatus["isRunning"])
		fmt.Printf("     - Watcher ID: %v\n", status.WatcherStatus["watcherID"])
	}
	fmt.Println()

	// 5. Use proxy to communicate with WatcherServer
	fmt.Println("🔌 Step 5: Communicating with WatcherServer...")

	proxyRef := prog.GetProxy()

	// Get WatcherServer status
	watcherStatus, err := proxyRef.GetStatus()
	if err != nil {
		panic(err)
	}
	fmt.Printf("   WatcherServer Status:\n")
	fmt.Printf("     - State: %s\n", watcherStatus.State)
	fmt.Printf("     - Running: %t\n", watcherStatus.IsRunning)
	fmt.Printf("     - Uptime: %.2f seconds\n", watcherStatus.Uptime)

	// Send a message to WatcherServer
	fmt.Println("\n   Sending message 'status' to WatcherServer...")
	err = proxyRef.SendMessage("status")
	if err != nil {
		panic(err)
	}
	fmt.Println("   ✅ Message sent successfully")

	// Check sent messages (mock feature)
	if mockProxy.SentMessages != nil && len(mockProxy.SentMessages) > 0 {
		fmt.Printf("   📨 Sent messages: %v\n", mockProxy.SentMessages)
	}
	fmt.Println()

	// 6. Get logs
	fmt.Println("📜 Step 6: Retrieving logs...")

	logs, err := proxyRef.GetLogs(proxy.LogOptions{
		Type:  "effect",
		Limit: 3,
	})
	if err != nil {
		panic(err)
	}
	fmt.Printf("   Retrieved %d log entries\n", len(logs))
	for i, log := range logs {
		fmt.Printf("     [%d] %s: %s\n", i+1, log.Type, log.Message)
	}
	fmt.Println()

	// 7. Stop container
	fmt.Println("🛑 Step 7: Stopping container...")

	err = prog.Stop(ctx)
	if err != nil {
		panic(err)
	}

	fmt.Printf("   ✅ Container stopped\n")
	fmt.Printf("   ✅ State: %s\n", prog.GetState())
	fmt.Println()

	// Final summary
	fmt.Println("╔══════════════════════════════════════════════════════════╗")
	fmt.Println("║                   Demo Complete! ✨                      ║")
	fmt.Println("╚══════════════════════════════════════════════════════════╝")
	fmt.Println()
	fmt.Println("Summary:")
	fmt.Println("  ✅ Program created with dependency injection")
	fmt.Println("  ✅ Image built from Dockerfile")
	fmt.Println("  ✅ Container started with resource limits")
	fmt.Println("  ✅ Status queried (Program + Container + WatcherServer)")
	fmt.Println("  ✅ Proxy used to communicate with WatcherServer")
	fmt.Println("  ✅ Logs retrieved from WatcherServer")
	fmt.Println("  ✅ Container stopped gracefully")
	fmt.Println()
	fmt.Println("Next Steps:")
	fmt.Println("  1. Implement real Docker/gVisor components")
	fmt.Println("  2. Integrate with Host (registry, discovery)")
	fmt.Println("  3. Add Program API server (HTTP endpoints)")
	fmt.Println("  4. Test with actual user Dockerfiles")
}
