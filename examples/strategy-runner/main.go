package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
	"strategy-runner/runner"
)

func main() {
	strategyPath := flag.String("strategy", "/app/strategy.json", "Strategy JSON file path")
	debugEventsPath := flag.String("debug-events-path", "", "Reserved debug timeline path; structured recorder is disabled in this runner build")
	flag.Parse()

	engine, err := runner.LoadEngine(*strategyPath)
	if err != nil {
		log.Fatalf("[BOOT] failed to load strategy: %v", err)
	}
	if *debugEventsPath != "" {
		log.Printf("[BOOT] debug-events-path ignored by current runner: %s", *debugEventsPath)
	}

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute

	watcher := hersh.NewWatcher(config, map[string]string{"RUNNER": "strategy-runner"}, context.Background())
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return engine.Run(msg, ctx)
	}, "StrategyRunner")

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
