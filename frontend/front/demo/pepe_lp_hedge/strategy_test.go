package main

import (
	"context"
	"testing"
	"time"

	"github.com/HershyOrg/hersh"
)

func TestEstimateLPTargetsReflectPoolDrift(t *testing.T) {
	state := HedgeState{
		EntrySnapshot: MarketSnapshot{PEPEPrice: 1, ETHPrice: 100},
		BasePepeQty:   1000,
		BaseETHQty:    10,
	}

	pepeQty, ethQty := estimateLPTargets(state, MarketSnapshot{PEPEPrice: 1.5, ETHPrice: 100})
	if pepeQty >= state.BasePepeQty {
		t.Fatalf("expected PEPE quantity to shrink, got %.4f", pepeQty)
	}
	if ethQty <= state.BaseETHQty {
		t.Fatalf("expected ETH quantity to grow, got %.4f", ethQty)
	}
}

func TestPepeHedgeManagedFlow(t *testing.T) {
	cfg := DefaultHedgeConfig()
	cfg.FeedInterval = 40 * time.Millisecond
	cfg.MaintenanceInterval = 70 * time.Millisecond

	feed := DefaultPepeScenario(cfg.FeedInterval, true)

	parentCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	watcherCfg := hersh.DefaultWatcherConfig()
	watcherCfg.ServerPort = 0
	watcherCfg.DefaultTimeout = 3 * time.Second

	watcher := hersh.NewWatcher(watcherCfg, nil, parentCtx)

	done := make(chan struct{})
	var finalState HedgeState

	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return runPepeLPHedge(msg, ctx, feed, cfg)
	}, "PepeLPHedgeTest").Cleanup(func(ctx hersh.HershContext) {
		finalState = getHedgeState(ctx)
		close(done)
	})

	if err := watcher.Start(); err != nil {
		t.Fatalf("start watcher: %v", err)
	}

	time.Sleep(120 * time.Millisecond)
	if err := watcher.SendMessage("init"); err != nil {
		t.Fatalf("send init: %v", err)
	}

	time.Sleep(450 * time.Millisecond)
	if err := watcher.SendMessage("emergency-exit"); err != nil {
		t.Fatalf("send emergency exit: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		_ = watcher.Stop()
		t.Fatal("timed out waiting for hedge cleanup")
	}

	if finalState.Mode != HedgeModeClosed {
		t.Fatalf("expected final mode CLOSED, got %s", finalState.Mode)
	}
	if finalState.RebalanceCount < 1 {
		t.Fatalf("expected at least one rebalance, got %d", finalState.RebalanceCount)
	}
	if len(finalState.EventLog) < 2 {
		t.Fatalf("expected multiple hedge events, got %d", len(finalState.EventLog))
	}
}
