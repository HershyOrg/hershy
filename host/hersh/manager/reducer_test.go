package manager

import (
	"context"
	"testing"
	"time"

	"hersh/core"
)

// mockReduceLogger implements ReduceLogger for testing.
type mockReduceLogger struct {
	actions []ReduceAction
}

func (m *mockReduceLogger) LogReduce(action ReduceAction) {
	m.actions = append(m.actions, action)
}

func TestReducer_VarSigTransition(t *testing.T) {
	state := NewManagerState(core.StateReady)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Start reducer
	go reducer.Run(ctx)

	// Send VarSig
	sig := &VarSig{
		ComputedTime:  time.Now(),
		TargetVarName: "testVar",
		PrevState:     nil,
		NextState:     42,
	}
	signals.SendVarSig(sig)

	// Wait for processing
	time.Sleep(50 * time.Millisecond)

	// Verify state transition
	if state.GetWatcherState() != core.StateRunning {
		t.Errorf("expected StateRunning, got %s", state.GetWatcherState())
	}

	// Verify variable was set
	val, ok := state.VarState.Get("testVar")
	if !ok {
		t.Fatal("expected testVar to exist")
	}
	if val != 42 {
		t.Errorf("expected 42, got %v", val)
	}

	// Verify action was logged
	if len(logger.actions) != 1 {
		t.Fatalf("expected 1 logged action, got %d", len(logger.actions))
	}
	if logger.actions[0].PrevState.WatcherState != core.StateReady {
		t.Errorf("expected prev state Ready, got %s", logger.actions[0].PrevState.WatcherState)
	}
	if logger.actions[0].NextState.WatcherState != core.StateRunning {
		t.Errorf("expected next state Running, got %s", logger.actions[0].NextState.WatcherState)
	}
}

func TestReducer_UserSigTransition(t *testing.T) {
	state := NewManagerState(core.StateReady)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go reducer.Run(ctx)

	// Send UserSig
	msg := &core.Message{
		Content:    "test message",
		IsConsumed: false,
		ReceivedAt: time.Now(),
	}
	sig := &UserSig{
		ReceivedTime: time.Now(),
		Message:      msg,
	}
	signals.SendUserSig(sig)

	time.Sleep(50 * time.Millisecond)

	// Verify state transition
	if state.GetWatcherState() != core.StateRunning {
		t.Errorf("expected StateRunning, got %s", state.GetWatcherState())
	}

	// Verify message was set
	currentMsg := state.UserState.GetMessage()
	if currentMsg == nil {
		t.Fatal("expected message to exist")
	}
	if currentMsg.Content != "test message" {
		t.Errorf("expected 'test message', got %s", currentMsg.Content)
	}

	// Verify action was logged
	if len(logger.actions) != 1 {
		t.Fatalf("expected 1 logged action, got %d", len(logger.actions))
	}
}

func TestReducer_WatcherSigTransition(t *testing.T) {
	state := NewManagerState(core.StateRunning)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go reducer.Run(ctx)

	// Send WatcherSig to transition to Ready
	sig := &WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateReady,
		Reason:      "execution completed",
	}
	signals.SendWatcherSig(sig)

	time.Sleep(50 * time.Millisecond)

	// Verify state transition
	if state.GetWatcherState() != core.StateReady {
		t.Errorf("expected StateReady, got %s", state.GetWatcherState())
	}

	// Verify action was logged
	if len(logger.actions) != 1 {
		t.Fatalf("expected 1 logged action, got %d", len(logger.actions))
	}
}

func TestReducer_PriorityOrdering(t *testing.T) {
	state := NewManagerState(core.StateReady)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Send signals in reverse priority order (Var, User, Watcher)
	varSig := &VarSig{
		ComputedTime:  time.Now(),
		TargetVarName: "var1",
		NextState:     1,
	}
	userSig := &UserSig{
		ReceivedTime: time.Now(),
		Message:      &core.Message{Content: "user"},
	}
	watcherSig := &WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateInitRun,
		Reason:      "init",
	}

	// Send in this order: Var, User, Watcher
	signals.SendVarSig(varSig)
	signals.SendUserSig(userSig)
	signals.SendWatcherSig(watcherSig)

	// Process ONE signal
	go func() {
		reducer.processAvailableSignals(ctx)
		cancel()
	}()

	time.Sleep(50 * time.Millisecond)

	// WatcherSig should be processed first due to priority
	if len(logger.actions) < 1 {
		t.Fatal("expected at least 1 action")
	}
	firstAction := logger.actions[0]
	if _, ok := firstAction.Signal.(*WatcherSig); !ok {
		t.Errorf("expected WatcherSig to be processed first, got %T", firstAction.Signal)
	}
}

func TestReducer_BatchVarSigCollection(t *testing.T) {
	state := NewManagerState(core.StateReady)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Send multiple VarSigs
	for i := 1; i <= 5; i++ {
		sig := &VarSig{
			ComputedTime:  time.Now(),
			TargetVarName: "var" + string(rune('0'+i)),
			NextState:     i * 10,
		}
		signals.SendVarSig(sig)
	}

	go reducer.Run(ctx)

	time.Sleep(50 * time.Millisecond)

	// All 5 variables should be set in one batch
	for i := 1; i <= 5; i++ {
		varName := "var" + string(rune('0'+i))
		val, ok := state.VarState.Get(varName)
		if !ok {
			t.Errorf("expected %s to exist", varName)
			continue
		}
		if val != i*10 {
			t.Errorf("expected %d, got %v", i*10, val)
		}
	}

	// State should be Running
	if state.GetWatcherState() != core.StateRunning {
		t.Errorf("expected StateRunning, got %s", state.GetWatcherState())
	}
}

func TestReducer_CrashedIsTerminal(t *testing.T) {
	state := NewManagerState(core.StateCrashed)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go reducer.Run(ctx)

	// Try to transition from Crashed
	sig := &WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateReady,
		Reason:      "attempt recovery",
	}
	signals.SendWatcherSig(sig)

	time.Sleep(50 * time.Millisecond)

	// State should remain Crashed
	if state.GetWatcherState() != core.StateCrashed {
		t.Errorf("expected StateCrashed, got %s", state.GetWatcherState())
	}

	// No action should be logged
	if len(logger.actions) != 0 {
		t.Errorf("expected 0 logged actions, got %d", len(logger.actions))
	}
}

func TestReducer_InitRunClearsVarState(t *testing.T) {
	state := NewManagerState(core.StateReady)
	signals := NewSignalChannels(10)
	logger := &mockReduceLogger{}
	reducer := NewReducer(state, signals, logger)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Set some variables
	state.VarState.Set("var1", 1)
	state.VarState.Set("var2", 2)

	go reducer.Run(ctx)

	// Send InitRun signal
	sig := &WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateInitRun,
		Reason:      "initialization",
	}
	signals.SendWatcherSig(sig)

	time.Sleep(50 * time.Millisecond)

	// VarState should be cleared
	snapshot := state.VarState.GetAll()
	if len(snapshot) != 0 {
		t.Errorf("expected empty VarState, got %d variables", len(snapshot))
	}

	// State should be InitRun
	if state.GetWatcherState() != core.StateInitRun {
		t.Errorf("expected StateInitRun, got %s", state.GetWatcherState())
	}
}
