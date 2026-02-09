package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/HershyOrg/hersh"
)

// testNewAPIs calls all new WatcherAPI endpoints and logs results
func testNewAPIs() {
	baseURL := "http://localhost:8080"

	// 1. GET /watcher/watching
	resp, err := http.Get(baseURL + "/watcher/watching")
	if err == nil && resp != nil {
		var watching map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&watching)
		resp.Body.Close()
		log.Printf("📋 Watching: %+v\n", watching)
	}

	// 2. GET /watcher/memoCache
	resp, err = http.Get(baseURL + "/watcher/memoCache")
	if err == nil && resp != nil {
		var memoCache map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&memoCache)
		resp.Body.Close()
		log.Printf("💾 MemoCache: %+v\n", memoCache)
	}

	// 3. GET /watcher/varState
	resp, err = http.Get(baseURL + "/watcher/varState")
	if err == nil && resp != nil {
		var varState map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&varState)
		resp.Body.Close()
		log.Printf("📊 VarState: %+v\n", varState)
	}

	// 4. GET /watcher/config
	resp, err = http.Get(baseURL + "/watcher/config")
	if err == nil && resp != nil {
		var config map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&config)
		resp.Body.Close()
		log.Printf("⚙️  Config: %+v\n", config)
	}

	// 5. GET /watcher/signals (improved with recent signals)
	resp, err = http.Get(baseURL + "/watcher/signals")
	if err == nil && resp != nil {
		var signals map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&signals)
		resp.Body.Close()
		log.Printf("📡 Signals: %+v\n", signals)
	}
}

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
		if msg != nil && msg.Content == "tick" {
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

	// Start ticker BEFORE Watcher.Start()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			watcher.SendMessage("tick")
		}
	}()

	// Start Watcher (includes WatcherAPI server)
	log.Println("▶️  Starting Watcher with API server on :8080")
	if err := watcher.Start(); err != nil {
		log.Printf("❌ Failed to start: %v\n", err)
		os.Exit(1)
	}
	log.Println("✅ Watcher started successfully")

	// Wait for API server to be ready
	time.Sleep(2 * time.Second)

	// Start API testing goroutine
	go func() {
		apiTicker := time.NewTicker(10 * time.Second)
		defer apiTicker.Stop()

		// Test immediately once
		log.Println("\n🧪 Testing new WatcherAPI endpoints...")
		testNewAPIs()

		// Then test every 10 seconds
		for range apiTicker.C {
			log.Println("\n🧪 Testing new WatcherAPI endpoints...")
			testNewAPIs()
		}
	}()

	// Run for 2 minutes then stop
	time.Sleep(2 * time.Minute)

	log.Println("\n⏰ Demo completed, shutting down...")
	watcher.Stop() // Stop() automatically shuts down apiServer
	log.Println("👋 Goodbye!")
}
