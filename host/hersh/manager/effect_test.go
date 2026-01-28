package manager

import (
	"context"
	"testing"
	"time"

	"hersh/core"
)

func TestEffectCommander_RunScriptEffect(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Ready -> Running transition
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateReady},
		NextState: StateSnapshot{WatcherState: core.StateRunning},
	}
	actionCh <- action

	// Should emit RunScriptEffect
	select {
	case effect := <-commander.EffectChannel():
		if _, ok := effect.(*RunScriptEffect); !ok {
			t.Errorf("expected RunScriptEffect, got %T", effect)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for effect")
	}
}

func TestEffectCommander_InitRunScriptEffect(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Ready -> InitRun transition
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateReady},
		NextState: StateSnapshot{WatcherState: core.StateInitRun},
	}
	actionCh <- action

	// Should emit InitRunScriptEffect
	select {
	case effect := <-commander.EffectChannel():
		if _, ok := effect.(*InitRunScriptEffect); !ok {
			t.Errorf("expected InitRunScriptEffect, got %T", effect)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for effect")
	}
}

func TestEffectCommander_ClearRunScriptEffect(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Running -> Stopped transition
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateRunning},
		NextState: StateSnapshot{WatcherState: core.StateStopped},
	}
	actionCh <- action

	// Should emit ClearRunScriptEffect
	select {
	case effect := <-commander.EffectChannel():
		clearEffect, ok := effect.(*ClearRunScriptEffect)
		if !ok {
			t.Fatalf("expected ClearRunScriptEffect, got %T", effect)
		}
		if clearEffect.HookState != core.StateStopped {
			t.Errorf("expected hook state Stopped, got %s", clearEffect.HookState)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for effect")
	}
}

func TestEffectCommander_JustKillEffect(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Stopped -> Killed transition
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateStopped},
		NextState: StateSnapshot{WatcherState: core.StateKilled},
	}
	actionCh <- action

	// Should emit JustKillEffect
	select {
	case effect := <-commander.EffectChannel():
		if _, ok := effect.(*JustKillEffect); !ok {
			t.Errorf("expected JustKillEffect, got %T", effect)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for effect")
	}
}

func TestEffectCommander_JustCrashEffect(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Killed -> Crashed transition
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateKilled},
		NextState: StateSnapshot{WatcherState: core.StateCrashed},
	}
	actionCh <- action

	// Should emit JustCrashEffect
	select {
	case effect := <-commander.EffectChannel():
		if _, ok := effect.(*JustCrashEffect); !ok {
			t.Errorf("expected JustCrashEffect, got %T", effect)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for effect")
	}
}

func TestEffectCommander_RecoverEffect(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Running -> WaitRecover transition
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateRunning},
		NextState: StateSnapshot{WatcherState: core.StateWaitRecover},
	}
	actionCh <- action

	// Should emit RecoverEffect
	select {
	case effect := <-commander.EffectChannel():
		if _, ok := effect.(*RecoverEffect); !ok {
			t.Errorf("expected RecoverEffect, got %T", effect)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for effect")
	}
}

func TestEffectCommander_IgnoreSameState(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Ready -> Ready transition (no change)
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateReady},
		NextState: StateSnapshot{WatcherState: core.StateReady},
	}
	actionCh <- action

	// Should NOT emit any effect
	select {
	case effect := <-commander.EffectChannel():
		t.Errorf("expected no effect, got %T", effect)
	case <-time.After(100 * time.Millisecond):
		// Expected timeout
	}
}

func TestEffectCommander_CrashedIsTerminal(t *testing.T) {
	actionCh := make(chan ReduceAction, 10)
	commander := NewEffectCommander(actionCh)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go commander.Run(ctx)

	// Send Crashed -> Ready transition (should be ignored)
	action := ReduceAction{
		PrevState: StateSnapshot{WatcherState: core.StateCrashed},
		NextState: StateSnapshot{WatcherState: core.StateReady},
	}
	actionCh <- action

	// Should NOT emit any effect
	select {
	case effect := <-commander.EffectChannel():
		t.Errorf("expected no effect from Crashed state, got %T", effect)
	case <-time.After(100 * time.Millisecond):
		// Expected timeout
	}
}
