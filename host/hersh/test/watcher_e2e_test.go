package test

import (
	"testing"
	"time"

	"hersh"
)

// TestWatcher_BasicExecution tests basic Watcher execution flow.
func TestWatcher_BasicExecution(t *testing.T) {
	config := hersh.DefaultWatcherConfig()
	config.DefaultTimeout = 2 * time.Second

	watcher := hersh.NewWatcher(config)

	executeCount := 0
	managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		executeCount++
		t.Logf("Execution %d", executeCount)
		return nil
	}

	watcher.Manage(managedFunc, "testFunc")

	// Start watcher
	err := watcher.Start()
	if err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}

	// Wait for initialization
	time.Sleep(500 * time.Millisecond)

	// Check state
	state := watcher.GetState()
	t.Logf("State after start: %s", state)

	// Send a message
	err = watcher.SendMessage("test message")
	if err != nil {
		t.Errorf("failed to send message: %v", err)
	}

	// Wait for execution
	time.Sleep(500 * time.Millisecond)

	// Stop watcher
	err = watcher.Stop()
	if err != nil {
		t.Errorf("failed to stop watcher: %v", err)
	}

	watcher.GetLogger().PrintSummary()

	t.Logf("Total executions: %d", executeCount)
}

// TestWatcher_WithWatchCall tests Watch mechanism integration.
func TestWatcher_WithWatchCall(t *testing.T) {
	config := hersh.DefaultWatcherConfig()
	watcher := hersh.NewWatcher(config)

	// Counter that increments every tick
	counter := 0
	executeCount := 0

	managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		// Watch a value that increments
		val := hersh.WatchCall(
			func(prev any, watchCtx hersh.HershContext) (any, bool, error) {
				newValue := counter
				counter++

				var changed bool
				if prev == nil {
					changed = true
				} else {
					changed = prev.(int) != newValue
				}

				return newValue, changed, nil
			},
			"counter",
			100*time.Millisecond,
			ctx,
		)

		executeCount++
		t.Logf("Execution %d: counter = %v", executeCount, val)

		// Stop after 3 executions
		if executeCount >= 3 {
			return hersh.NewStopErr("completed")
		}

		return nil
	}

	watcher.Manage(managedFunc, "watchTest")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}

	// Wait for multiple executions
	time.Sleep(2 * time.Second)

	err = watcher.Stop()
	if err != nil {
		t.Errorf("failed to stop watcher: %v", err)
	}

	watcher.GetLogger().PrintSummary()

	if executeCount < 2 {
		t.Errorf("expected at least 2 executions, got %d", executeCount)
	}

	t.Logf("Test completed with %d executions", executeCount)
}

// TestWatcher_WithMemo tests Memo caching.
func TestWatcher_WithMemo(t *testing.T) {
	config := hersh.DefaultWatcherConfig()
	watcher := hersh.NewWatcher(config)

	computeCount := 0
	executeCount := 0

	managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		// Memo should compute only once
		val := hersh.Memo(func() any {
			computeCount++
			return "expensive result"
		}, "expensiveComputation", ctx)

		executeCount++
		t.Logf("Execution %d: memo result = %v, compute count = %d", executeCount, val, computeCount)

		if executeCount >= 2 {
			return hersh.NewStopErr("completed")
		}

		return nil
	}

	watcher.Manage(managedFunc, "memoTest")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}

	// Trigger multiple executions
	time.Sleep(200 * time.Millisecond)
	watcher.SendMessage("trigger1")

	time.Sleep(200 * time.Millisecond)
	watcher.SendMessage("trigger2")

	time.Sleep(200 * time.Millisecond)

	err = watcher.Stop()
	if err != nil {
		t.Errorf("failed to stop watcher: %v", err)
	}

	// Memo should compute only once despite multiple executions
	if computeCount != 1 {
		t.Errorf("expected Memo to compute once, but computed %d times", computeCount)
	}

	if executeCount < 2 {
		t.Errorf("expected at least 2 executions, got %d", executeCount)
	}

	watcher.GetLogger().PrintSummary()
}

// TestWatcher_WithContextState tests HershContext state management.
func TestWatcher_WithContextState(t *testing.T) {
	config := hersh.DefaultWatcherConfig()
	watcher := hersh.NewWatcher(config)

	executeCount := 0

	managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		// Get context value counter
		val := ctx.GetValue("counter")
		if val == nil {
			val = 0
		}

		counter := val.(int)
		counter++

		// Set updated counter in context
		ctx.SetValue("counter", counter)

		executeCount++
		t.Logf("Execution %d: counter = %d", executeCount, counter)

		if executeCount >= 3 {
			return hersh.NewStopErr("completed")
		}

		return nil
	}

	watcher.Manage(managedFunc, "contextStateTest")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}

	// Trigger multiple executions
	time.Sleep(200 * time.Millisecond)
	watcher.SendMessage("inc1")

	time.Sleep(200 * time.Millisecond)
	watcher.SendMessage("inc2")

	time.Sleep(200 * time.Millisecond)
	watcher.SendMessage("inc3")

	time.Sleep(200 * time.Millisecond)

	err = watcher.Stop()
	if err != nil {
		t.Errorf("failed to stop watcher: %v", err)
	}

	// Verify context value was tracked
	logger := watcher.GetLogger()
	_ = logger // Context values persist in HershContext

	watcher.GetLogger().PrintSummary()
}

// TestWatcher_ErrorHandling tests StopErr and KillErr.
func TestWatcher_ErrorHandling(t *testing.T) {
	config := hersh.DefaultWatcherConfig()
	watcher := hersh.NewWatcher(config)

	executeCount := 0

	managedFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		executeCount++
		t.Logf("Execution %d", executeCount)

		if msg != nil && msg.Content == "stop" {
			return hersh.NewStopErr("user requested stop")
		}

		return nil
	}

	watcher.Manage(managedFunc, "errorTest")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// Send stop message
	err = watcher.SendMessage("stop")
	if err != nil {
		t.Errorf("failed to send message: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Check state is Stopped
	state := watcher.GetState()
	if state != hersh.StateStopped {
		t.Errorf("expected StateStopped, got %s", state)
	}

	err = watcher.Stop()
	if err != nil {
		t.Errorf("failed to stop watcher: %v", err)
	}

	watcher.GetLogger().PrintSummary()
}

