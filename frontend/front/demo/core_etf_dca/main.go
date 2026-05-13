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
	cfg := DefaultCoreETFDCAConfig()
	parentCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	watcherCfg := hersh.DefaultWatcherConfig()
	watcherCfg.ServerPort = 0
	watcherCfg.DefaultTimeout = 15 * time.Second

	watcher := hersh.NewWatcher(watcherCfg, map[string]string{
		"STRATEGY": "core-etf-dca",
	}, parentCtx)

	done := make(chan struct{})
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return runCoreETFDCA(msg, ctx, cfg)
	}, "CoreETFDCA").Cleanup(func(ctx hersh.HershContext) {
		state := getCoreDCAState(ctx)
		fmt.Printf("\n[cleanup] core ETF DCA finished after %d execution(s), reserve=$%.2f\n", state.ExecutionCount, state.ReserveBalance)
		close(done)
	})

	if err := watcher.Start(); err != nil {
		panic(err)
	}

	fmt.Println("Core ETF DCA demo started")
	fmt.Printf("  simulated month: %s\n", cfg.SimulatedMonth)
	fmt.Printf("  monthly budget: $%.2f\n", cfg.MonthlyBudget)
	fmt.Println("  commands: status, stop")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigChan)

	go func() {
		<-time.After(1500 * time.Millisecond)
		_ = watcher.SendMessage("status")
	}()

	select {
	case <-done:
	case <-sigChan:
		_ = watcher.Stop()
	case <-parentCtx.Done():
		<-done
	}
}
