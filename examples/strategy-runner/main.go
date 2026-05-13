package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
	"strategy-runner/runner"
)

func main() {
	strategyPath := flag.String("strategy", "/app/strategy.json", "Strategy JSON file path")
	debugEventsPath := flag.String("debug-events-path", defaultDebugEventsPath(), "Structured debug timeline path (.json for state, .jsonl for legacy stream)")
	flag.Parse()

	engine, err := runner.LoadEngine(*strategyPath)
	if err != nil {
		log.Fatalf("[BOOT] failed to load strategy: %v", err)
	}
	engine.SetRecorder(openDebugRecorder(*debugEventsPath, engine.strategyName))

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute

	watcher := hersh.NewWatcher(config, map[string]string{"RUNNER": "strategy-runner"}, context.Background())
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return engine.Run(msg, ctx)
	}, "StrategyRunner").Cleanup(func(ctx hersh.HershContext) {
		engine.Close()
	})

	if err := watcher.Start(); err != nil {
		log.Fatalf("[BOOT] watcher start failed: %v", err)
	}

	log.Printf(
		"[BOOT] strategy-runner started: strategy=%q streams=%d triggers=%d actions=%d",
		engine.StrategyName(),
		engine.StreamCount(),
		engine.TriggerCount(),
		engine.ActionCount(),
	)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigChan)

	for {
		select {
		case <-sigChan:
			_ = watcher.Stop()
			return
		}
	}
}
