package main

import (
	"context"
	"testing"
	"time"

	"github.com/HershyOrg/hersh"
)

func TestAllocateDCAReflectsDemoWeights(t *testing.T) {
	cfg := DefaultCoreETFDCAConfig()
	plan := allocateDCA(cfg.MonthlyBudget, cfg.AllocationRules, time.Unix(0, 0))

	if len(plan.Allocations) != 6 {
		t.Fatalf("expected 6 allocations, got %d", len(plan.Allocations))
	}
	if plan.ExecutableBudget != 450 {
		t.Fatalf("expected executable budget 450, got %.2f", plan.ExecutableBudget)
	}
	if plan.ReserveBudget != 50 {
		t.Fatalf("expected reserve budget 50, got %.2f", plan.ReserveBudget)
	}

	orders := buildDCAOrders(plan, cfg.Exchange, time.Unix(0, 0))
	if len(orders) != 3 {
		t.Fatalf("expected 3 executable orders, got %d", len(orders))
	}
	if orders[0].Notional != 275 {
		t.Fatalf("expected BTC order $275, got %.2f", orders[0].Notional)
	}
}

func TestCoreETFDCAManagedFlow(t *testing.T) {
	cfg := DefaultCoreETFDCAConfig()
	cfg.SimulatedMonth = 50 * time.Millisecond
	cfg.AutoStopAfterExecutions = 2

	parentCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	watcherCfg := hersh.DefaultWatcherConfig()
	watcherCfg.ServerPort = 0
	watcherCfg.DefaultTimeout = 2 * time.Second

	watcher := hersh.NewWatcher(watcherCfg, nil, parentCtx)

	done := make(chan struct{})
	var finalState CoreETFDCAState

	watcher.Manage(func(msg *hersh.Message, ctx hersh.ManageContext) error {
		return runCoreETFDCA(msg, ctx, cfg)
	}, "CoreETFDCATest").Cleanup(func(ctx hersh.ManageContext) {
		finalState = getCoreDCAState(ctx)
		close(done)
	})

	if err := watcher.Start(); err != nil {
		t.Fatalf("start watcher: %v", err)
	}

	select {
	case <-done:
	case <-time.After(1500 * time.Millisecond):
		_ = watcher.Stop()
		t.Fatal("timed out waiting for DCA demo to stop")
	}

	if finalState.ExecutionCount != 2 {
		t.Fatalf("expected 2 executions, got %d", finalState.ExecutionCount)
	}
	if len(finalState.Log) != 2 {
		t.Fatalf("expected 2 log entries, got %d", len(finalState.Log))
	}
	if finalState.ReserveBalance != 100 {
		t.Fatalf("expected reserve balance 100, got %.2f", finalState.ReserveBalance)
	}
}
