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
	// Setup logging to /state directory
	stateDir := "/state"
	os.MkdirAll(stateDir, 0755)
	logFile, err := os.Create(filepath.Join(stateDir, "counter.log"))
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

	log.Println("🚀 Starting Simple Counter Demo")

	// Create config with WatcherAPI enabled
	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080 // Enable WatcherAPI on port 8080
	config.DefaultTimeout = 5 * time.Minute

	envVars := map[string]string{
		"DEMO_NAME":    "Simple Counter",
		"DEMO_VERSION": "1.0.0",
	}

	// Create context
	ctx := context.Background()

	// Create Watcher
	watcher := hersh.NewWatcher(config, envVars, ctx)

	// Register managed function
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		if msg.Content == "tick" {
			// Get counter from context value store
			counterVal := ctx.GetValue("COUNTER")
			counter := 0
			if counterVal != nil {
				counter = counterVal.(int)
			}
			counter++
			ctx.SetValue("COUNTER", counter)

			// Log the counter value
			logMsg := fmt.Sprintf("[%s] Counter: %d", time.Now().Format("15:04:05"), counter)
			log.Println(logMsg)
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
	log.Println("⏱️  Running for 2 minutes...")
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
