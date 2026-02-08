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
	stateDir := "/state"
	os.MkdirAll(stateDir, 0755)
	logFile, err := os.Create(filepath.Join(stateDir, "counter.log"))
	if err != nil {
		fmt.Printf("Warning: Failed to create log file: %v\n", err)
		logFile = nil
	}
	if logFile != nil {
		defer logFile.Close()
		log.SetOutput(io.MultiWriter(os.Stdout, logFile))
	} else {
		log.SetOutput(os.Stdout)
	}

	log.Println("Starting Simple Counter")

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute

	envVars := map[string]string{
		"DEMO_NAME":    "Simple Counter",
		"DEMO_VERSION": "1.0.0",
	}

	ctx := context.Background()
	watcher := hersh.NewWatcher(config, envVars, ctx)

	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		if msg.Content == "tick" {
			counterVal := ctx.GetValue("COUNTER")
			counter := 0
			if counterVal != nil {
				counter = counterVal.(int)
			}
			counter++
			ctx.SetValue("COUNTER", counter)
			logMsg := fmt.Sprintf("[%s] Counter: %d", time.Now().Format("15:04:05"), counter)
			log.Println(logMsg)
		}
		return nil
	}, "Counter").Cleanup(func(ctx hersh.HershContext) {
		log.Println("Cleanup called")
	})

	log.Println("Starting Watcher")
	if err := watcher.Start(); err != nil {
		log.Printf("Failed to start: %v\n", err)
		os.Exit(1)
	}
	log.Println("Watcher started")

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			watcher.SendMessage("tick")
		}
	}()

	log.Println("Running indefinitely...")
	select {}
}