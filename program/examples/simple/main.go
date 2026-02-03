// Simple example of using hersh.Watcher inside a container.
// This program will be built into a Docker image and run in a gVisor container by Program.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"hersh"
)

func main() {
	fmt.Println("=== Simple Hersh Program ===")
	fmt.Println("This program runs inside a gVisor container")
	fmt.Println()

	// Create watcher with environment variables
	envVars := make(map[string]string)
	for _, env := range []string{"PROGRAM_NAME", "PROGRAM_VERSION", "TEST_ENV"} {
		if val := os.Getenv(env); val != "" {
			envVars[env] = val
			fmt.Printf("Environment: %s=%s\n", env, val)
		}
	}

	config := hersh.DefaultWatcherConfig()
	config.DefaultTimeout = 10 * time.Second

	watcher := hersh.NewWatcher(config, envVars, nil)

	// Simple counter function
	counter := 0
	managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		counter++
		fmt.Printf("[Execution %d] Timestamp: %s\n", counter, time.Now().Format("15:04:05"))

		// Handle messages
		if msg != nil {
			fmt.Printf("  Received message: '%s'\n", msg.Content)

			switch msg.Content {
			case "status":
				fmt.Printf("  Status: Running for %d executions\n", counter)

			case "stop":
				fmt.Println("  Stopping watcher...")
				return hersh.NewStopErr("user requested stop")

			default:
				fmt.Printf("  Unknown command: %s\n", msg.Content)
			}
		}

		return nil
	}

	// Register function with cleanup
	watcher.Manage(managedFunc, "simpleCounter").Cleanup(func(ctx hersh.HershContext) {
		fmt.Println("\n[Cleanup] Simple program shutting down")
		fmt.Printf("[Cleanup] Total executions: %d\n", counter)
	})

	// Start watcher
	fmt.Println("\nStarting watcher...")
	err := watcher.Start()
	if err != nil {
		panic(err)
	}

	fmt.Println("✅ Watcher started successfully")
	fmt.Println("📡 WatcherServer running on port 8080")
	fmt.Println("   Try: curl http://localhost:8080/watcher/status")
	fmt.Println()

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	fmt.Println("Press Ctrl+C to stop...")
	<-sigChan

	fmt.Println("\n🛑 Shutdown signal received")

	// Stop watcher
	err = watcher.Stop()
	if err != nil {
		fmt.Printf("Error stopping watcher: %v\n", err)
	}

	fmt.Println("=== Program Complete ===")
}
