package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
)

func main() {
	cfg := DefaultHedgeConfig()
	feed := DefaultPepeScenario(cfg.FeedInterval, true)

	parentCtx, cancel := context.WithTimeout(context.Background(), 14*time.Second)
	defer cancel()

	watcherCfg := hersh.DefaultWatcherConfig()
	watcherCfg.ServerPort = 0
	watcherCfg.DefaultTimeout = 15 * time.Second

	watcher := hersh.NewWatcher(watcherCfg, map[string]string{
		"STRATEGY": "pepe-lp-hedge",
	}, parentCtx)

	done := make(chan struct{})
	watcher.Manage(func(msg *hersh.Message, ctx hersh.ManageContext) error {
		return runPepeLPHedge(msg, ctx, feed, cfg)
	}, "PepeLPHedge").Cleanup(func(ctx hersh.ManageContext) {
		state := getHedgeState(ctx)
		fmt.Printf(
			"\n[cleanup] hedge mode=%s maintenance=%d rebalance=%d events=%d\n",
			state.Mode,
			state.MaintenanceCount,
			state.RebalanceCount,
			len(state.EventLog),
		)
		close(done)
	})

	if err := watcher.Start(); err != nil {
		panic(err)
	}

	fmt.Println("PEPE/WETH LP hedge demo started")
	fmt.Println("  commands: init, status, emergency-exit, stop")

	go func() {
		<-time.After(600 * time.Millisecond)
		_ = watcher.SendMessage("init")

		<-time.After(4 * time.Second)
		_ = watcher.SendMessage("status")

		<-time.After(3 * time.Second)
		_ = watcher.SendMessage("emergency-exit")
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigChan)

	select {
	case <-done:
	case <-sigChan:
		_ = watcher.Stop()
	case <-parentCtx.Done():
		<-done
	}
}
