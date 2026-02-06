package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"hersh"
)

func main() {
	fmt.Println("🚀 Starting Hersh WatcherServer Demo")

	// Create config with ServerPort enabled
	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080 // Enable WatcherAPI on port 8080
	config.DefaultTimeout = 10 * time.Minute

	envVars := map[string]string{
		"DEMO_NAME":    "WatcherServer Demo",
		"DEMO_VERSION": "1.0.0",
	}

	// Create context
	ctx := context.Background()

	// Create Watcher
	watcher := hersh.NewWatcher(config, envVars, ctx)

	// Register managed function
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		// Simple counter that increments every second
		if msg.Content == "tick" {
			counter := ctx.GetEnvInt("COUNTER", 0)
			counter++
			ctx.SetEnv("COUNTER", fmt.Sprintf("%d", counter))

			// Write to /state file
			stateFile := "/state/counter.txt"
			if err := os.WriteFile(stateFile, []byte(fmt.Sprintf("%d\n", counter)), 0644); err != nil {
				fmt.Printf("⚠️  Failed to write state file: %v\n", err)
			}

			fmt.Printf("📊 Counter: %d (state file updated)\n", counter)
		}
		return nil
	}, "Counter").Cleanup(func(ctx hersh.HershContext) {
		fmt.Println("🧹 Cleanup called")
	})

	// Start Watcher
	fmt.Println("▶️  Starting Watcher with API server on :8080")
	if err := watcher.Start(); err != nil {
		fmt.Printf("❌ Failed to start: %v\n", err)
		os.Exit(1)
	}

	// Start WatcherAPI server
	apiServer, err := watcher.StartAPIServer()
	if err != nil {
		fmt.Printf("❌ Failed to start API server: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("✅ WatcherAPI server started on :8080")

	// Send tick messages every second
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			watcher.SendMessage("tick")
		}
	}()

	// Run for 5 minutes then stop
	time.Sleep(5 * time.Minute)

	fmt.Println("\n⏰ Demo completed, shutting down...")
	if apiServer != nil {
		apiServer.Stop()
	}
	watcher.Stop()
}
