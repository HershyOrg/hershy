package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/HershyOrg/hershy/hersh"
)

func main() {
	// Setup logging
	logDir := "logs"
	os.MkdirAll(logDir, 0755)
	logFile, err := os.Create(filepath.Join(logDir, "watcher-server.log"))
	if err != nil {
		fmt.Printf("⚠️  Failed to create log file: %v\n", err)
		logFile = nil
	}
	if logFile != nil {
		defer logFile.Close()
		log.SetOutput(io.MultiWriter(os.Stdout, logFile))
	} else {
		log.SetOutput(os.Stdout)
	}

	log.Println("🚀 Starting Hersh WatcherServer Demo")

	// Create config with ServerPort enabled
	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080 // Enable WatcherAPI on port 8080
	config.DefaultTimeout = 10 * time.Minute

	envVars := map[string]string{
		"DEMO_NAME":    "WatcherServer Demo",
		"DEMO_VERSION": "1.0.0",
		"COUNTER":      "0", // Initialize counter in envVars
	}

	// Create context
	ctx := context.Background()

	// Create Watcher
	watcher := hersh.NewWatcher(config, envVars, ctx)

	// Register managed function
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		// Simple counter that increments every second
		if msg.Content == "tick" {
			// Get counter from context value store (not envVars - they're immutable)
			counterVal := ctx.GetValue("COUNTER")
			counter := 0
			if counterVal != nil {
				counter = counterVal.(int)
			}
			counter++
			ctx.SetValue("COUNTER", counter)

			// Write to /state file (create directory if needed)
			stateDir := "/state"
			os.MkdirAll(stateDir, 0755)
			stateFile := filepath.Join(stateDir, "counter.txt")
			if err := os.WriteFile(stateFile, []byte(fmt.Sprintf("%d\n", counter)), 0644); err != nil {
				log.Printf("⚠️  Failed to write state file: %v\n", err)
			}

			log.Printf("📊 Counter: %d (state file updated)\n", counter)
		}
		return nil
	}, "Counter").Cleanup(func(ctx hersh.HershContext) {
		log.Println("🧹 Cleanup called")
	})

	// Start Watcher
	log.Println("▶️  Starting Watcher with API server on :8080")
	if err := watcher.Start(); err != nil {
		log.Printf("❌ Failed to start: %v\n", err)
		os.Exit(1)
	}

	// Start WatcherAPI server
	apiServer, err := watcher.StartAPIServer()
	if err != nil {
		log.Printf("❌ Failed to start API server: %v\n", err)
		os.Exit(1)
	}
	log.Println("✅ WatcherAPI server started on :8080")

	// Send tick messages every second
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			watcher.SendMessage("tick")
		}
	}()

	// Run for 2 minutes then stop
	time.Sleep(2 * time.Minute)

	log.Println("\n⏰ Demo completed, shutting down...")
	if apiServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		apiServer.Shutdown(shutdownCtx)
	}
	watcher.Stop()
	log.Println("👋 Goodbye!")
}
