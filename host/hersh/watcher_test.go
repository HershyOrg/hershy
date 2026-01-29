package hersh

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// TestWatchCall_BasicFunctionality tests basic WatchCall behavior
func TestWatchCall_BasicFunctionality(t *testing.T) {
	config := DefaultWatcherConfig()
	config.DefaultTimeout = 5 * time.Second

	watcher := NewWatcher(config)

	executeCount := int32(0)
	varValue := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		atomic.AddInt32(&executeCount, 1)

		// WatchCall with compute function
		val := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				newVal := atomic.AddInt32(&varValue, 1)
				if prev == nil {
					return newVal, true, nil
				}
				return newVal, newVal != prev.(int32), nil
			},
			"testVar",
			100*time.Millisecond,
			ctx,
		)

		if val != nil {
			t.Logf("WatchCall returned: %v", val)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Wait for several watch cycles
	time.Sleep(500 * time.Millisecond)

	// Verify that managed function was executed
	executions := atomic.LoadInt32(&executeCount)
	if executions < 1 {
		t.Errorf("Expected at least 1 execution, got %d", executions)
	}

	// Verify that varValue was incremented
	finalVarValue := atomic.LoadInt32(&varValue)
	if finalVarValue < 2 {
		t.Errorf("Expected varValue to be incremented at least twice, got %d", finalVarValue)
	}

	t.Logf("Test complete - executions: %d, varValue: %d", executions, finalVarValue)
}

// TestWatchCall_ValuePersistence tests that WatchCall values persist across executions
func TestWatchCall_ValuePersistence(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	observedValues := make([]any, 0)
	executionCount := 0

	managedFunc := func(msg *Message, ctx HershContext) error {
		executionCount++

		val := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				return executionCount, true, nil
			},
			"counter",
			50*time.Millisecond,
			ctx,
		)

		if val != nil {
			observedValues = append(observedValues, val)
			t.Logf("Execution %d: observed value = %v", executionCount, val)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(400 * time.Millisecond)

	if len(observedValues) < 2 {
		t.Errorf("Expected at least 2 observed values, got %d", len(observedValues))
	}

	// Verify that values increase over time (persistence)
	for i := 1; i < len(observedValues); i++ {
		if observedValues[i].(int) <= observedValues[i-1].(int) {
			t.Errorf("Expected increasing values, got %v -> %v", observedValues[i-1], observedValues[i])
		}
	}

	t.Logf("Test complete - observed values: %v", observedValues)
}

// TestWatchCall_NoChangeDoesNotTrigger tests that unchanged values don't trigger re-execution
func TestWatchCall_NoChangeDoesNotTrigger(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	executeCount := int32(0)
	computeCallCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		atomic.AddInt32(&executeCount, 1)

		val := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				atomic.AddInt32(&computeCallCount, 1)
				// Always return same value
				return 42, false, nil // changed=false
			},
			"staticVar",
			50*time.Millisecond,
			ctx,
		)

		t.Logf("Execution %d: val = %v", atomic.LoadInt32(&executeCount), val)
		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(400 * time.Millisecond)

	executions := atomic.LoadInt32(&executeCount)
	computeCalls := atomic.LoadInt32(&computeCallCount)

	// Compute should be called multiple times
	if computeCalls < 3 {
		t.Errorf("Expected at least 3 compute calls, got %d", computeCalls)
	}

	// But executions should be minimal (only initial run)
	if executions > 3 {
		t.Errorf("Expected at most 3 executions for unchanged value, got %d", executions)
	}

	t.Logf("Test complete - executions: %d, compute calls: %d", executions, computeCalls)
}

// TestWatchFlow_ChannelBased tests WatchFlow with channel-based reactive programming
func TestWatchFlow_ChannelBased(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	sourceChan := make(chan any, 10)
	receivedValues := make([]any, 0)
	executeCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		atomic.AddInt32(&executeCount, 1)

		val := WatchFlow(sourceChan, "flowVar", ctx)

		if val != nil {
			receivedValues = append(receivedValues, val)
			t.Logf("Execution %d: received value = %v", atomic.LoadInt32(&executeCount), val)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	// Send initial value to allow initialization to complete
	go func() {
		time.Sleep(50 * time.Millisecond)
		sourceChan <- 0
	}()

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Send more values through channel
	go func() {
		for i := 1; i <= 5; i++ {
			time.Sleep(100 * time.Millisecond)
			sourceChan <- i
			t.Logf("Sent value: %d", i)
		}
	}()

	time.Sleep(800 * time.Millisecond)

	executions := atomic.LoadInt32(&executeCount)
	if executions < 3 {
		t.Errorf("Expected at least 3 executions, got %d", executions)
	}

	if len(receivedValues) < 3 {
		t.Errorf("Expected at least 3 received values, got %d", len(receivedValues))
	}

	t.Logf("Test complete - executions: %d, received values: %v", executions, receivedValues)
}

// TestWatchFlow_ChannelClosed tests WatchFlow behavior when channel is closed
func TestWatchFlow_ChannelClosed(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	sourceChan := make(chan any, 5)
	receivedValues := make([]any, 0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		val := WatchFlow(sourceChan, "flowVar", ctx)
		if val != nil {
			receivedValues = append(receivedValues, val)
		}
		return nil
	}

	watcher.Manage(managedFunc, "test")

	// Send initial value before Start to allow initialization
	go func() {
		time.Sleep(50 * time.Millisecond)
		sourceChan <- 1
		time.Sleep(100 * time.Millisecond)
		sourceChan <- 2
		time.Sleep(100 * time.Millisecond)
		close(sourceChan)
		t.Log("Channel closed")
	}()

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(500 * time.Millisecond)

	// Should have received values before channel closed
	if len(receivedValues) < 1 {
		t.Errorf("Expected at least 1 received value before channel close, got %d", len(receivedValues))
	}

	t.Logf("Test complete - received values: %v", receivedValues)
}

// TestMemo_BasicCaching tests basic Memo caching functionality
func TestMemo_BasicCaching(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	computeCount := int32(0)
	executeCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		atomic.AddInt32(&executeCount, 1)

		// Memo should compute only once
		val := Memo(func() any {
			count := atomic.AddInt32(&computeCount, 1)
			t.Logf("Computing expensive value: call %d", count)
			return "expensive-result"
		}, "cachedValue", ctx)

		if val != "expensive-result" {
			t.Errorf("Expected 'expensive-result', got %v", val)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Trigger multiple executions
	time.Sleep(100 * time.Millisecond)
	watcher.SendMessage("msg1")
	time.Sleep(100 * time.Millisecond)
	watcher.SendMessage("msg2")
	time.Sleep(200 * time.Millisecond)

	executions := atomic.LoadInt32(&executeCount)
	computes := atomic.LoadInt32(&computeCount)

	// Managed function should execute multiple times
	if executions < 3 {
		t.Errorf("Expected at least 3 executions, got %d", executions)
	}

	// But Memo compute should only happen once
	if computes != 1 {
		t.Errorf("Expected exactly 1 compute call (cached), got %d", computes)
	}

	t.Logf("Test complete - executions: %d, compute calls: %d", executions, computes)
}

// TestMemo_ClearMemo tests ClearMemo functionality
func TestMemo_ClearMemo(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	computeCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		if msg != nil && msg.Content == "clear" {
			ClearMemo("counter", ctx)
			t.Log("Memo cleared")
			return nil
		}

		val := Memo(func() any {
			count := atomic.AddInt32(&computeCount, 1)
			return count
		}, "counter", ctx)

		t.Logf("Memo value: %v", val)
		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(100 * time.Millisecond)

	// First access - should compute
	watcher.SendMessage("access1")
	time.Sleep(100 * time.Millisecond)

	// Second access - should use cache (no compute)
	watcher.SendMessage("access2")
	time.Sleep(100 * time.Millisecond)

	computes1 := atomic.LoadInt32(&computeCount)
	if computes1 != 1 {
		t.Errorf("Expected 1 compute before clear, got %d", computes1)
	}

	// Clear memo
	watcher.SendMessage("clear")
	time.Sleep(100 * time.Millisecond)

	// Third access - should recompute
	watcher.SendMessage("access3")
	time.Sleep(100 * time.Millisecond)

	computes2 := atomic.LoadInt32(&computeCount)
	if computes2 != 2 {
		t.Errorf("Expected 2 computes after clear, got %d", computes2)
	}

	t.Logf("Test complete - total compute calls: %d", computes2)
}

// TestWatcher_MultipleWatchVariables tests multiple Watch variables working together
func TestWatcher_MultipleWatchVariables(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	counter1 := int32(0)
	counter2 := int32(0)
	executeCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		atomic.AddInt32(&executeCount, 1)

		val1 := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				return atomic.AddInt32(&counter1, 1), true, nil
			},
			"var1",
			80*time.Millisecond,
			ctx,
		)

		val2 := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				return atomic.AddInt32(&counter2, 2), true, nil
			},
			"var2",
			80*time.Millisecond,
			ctx,
		)

		if val1 != nil && val2 != nil {
			t.Logf("Execution %d: var1=%v, var2=%v", atomic.LoadInt32(&executeCount), val1, val2)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(500 * time.Millisecond)

	executions := atomic.LoadInt32(&executeCount)
	if executions < 3 {
		t.Errorf("Expected at least 3 executions, got %d", executions)
	}

	c1 := atomic.LoadInt32(&counter1)
	c2 := atomic.LoadInt32(&counter2)

	if c1 < 3 {
		t.Errorf("Expected counter1 >= 3, got %d", c1)
	}

	if c2 < 6 {
		t.Errorf("Expected counter2 >= 6, got %d", c2)
	}

	t.Logf("Test complete - executions: %d, counter1: %d, counter2: %d", executions, c1, c2)
}

// TestWatcher_WatchAndMemo tests Watch and Memo working together
func TestWatcher_WatchAndMemo(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	watchCounter := int32(0)
	memoComputeCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		// Watch value changes frequently
		watchVal := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				return atomic.AddInt32(&watchCounter, 1), true, nil
			},
			"frequentVar",
			50*time.Millisecond,
			ctx,
		)

		// Memo computes once
		memoVal := Memo(func() any {
			atomic.AddInt32(&memoComputeCount, 1)
			return "cached-config"
		}, "config", ctx)

		if watchVal != nil && memoVal != nil {
			t.Logf("Watch value: %v, Memo value: %v", watchVal, memoVal)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(400 * time.Millisecond)

	watchCount := atomic.LoadInt32(&watchCounter)
	memoCount := atomic.LoadInt32(&memoComputeCount)

	// Watch should be called many times
	if watchCount < 5 {
		t.Errorf("Expected watchCounter >= 5, got %d", watchCount)
	}

	// Memo should be computed only once
	if memoCount != 1 {
		t.Errorf("Expected memoComputeCount = 1, got %d", memoCount)
	}

	t.Logf("Test complete - watch count: %d, memo compute count: %d", watchCount, memoCount)
}

// TestWatcher_HershContextAccess tests accessing Watcher through HershContext
func TestWatcher_HershContextAccess(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	contextValid := false

	managedFunc := func(msg *Message, ctx HershContext) error {
		// Verify we can access watcher from context
		watcherFromCtx := ctx.GetValue("__watcher__")
		if watcherFromCtx != nil {
			contextValid = true
			t.Log("Successfully accessed watcher from HershContext")
		}

		// Use Watch to verify context is working
		val := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				return 42, true, nil
			},
			"contextTest",
			100*time.Millisecond,
			ctx,
		)

		if val != nil {
			t.Logf("Watch value: %v", val)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(300 * time.Millisecond)

	if !contextValid {
		t.Error("Failed to access watcher from HershContext")
	}

	t.Log("Test complete - HershContext access verified")
}

// TestWatcher_StopCancelsWatches tests that Stop() stops the watcher gracefully
func TestWatcher_StopCancelsWatches(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	watchCallCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				atomic.AddInt32(&watchCallCount, 1)
				return time.Now().Unix(), true, nil
			},
			"activeCheck",
			50*time.Millisecond,
			ctx,
		)

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}

	// Let it run for a bit
	time.Sleep(200 * time.Millisecond)
	callsBeforeStop := atomic.LoadInt32(&watchCallCount)

	// Stop watcher
	err = watcher.Stop()
	if err != nil {
		t.Fatalf("Failed to stop watcher: %v", err)
	}

	// Wait and verify no more watch calls happen
	time.Sleep(300 * time.Millisecond)
	callsAfterStop := atomic.LoadInt32(&watchCallCount)

	// After stop, watch should stop running (calls should not increase significantly)
	// Allow some buffer for in-flight operations (up to 4 additional calls)
	if callsAfterStop > callsBeforeStop+4 {
		t.Errorf("Watch continued running after Stop: before=%d, after=%d", callsBeforeStop, callsAfterStop)
	}

	t.Logf("Test complete - calls before stop: %d, calls after stop: %d", callsBeforeStop, callsAfterStop)
}

// TestWatchCall_ErrorHandling tests error handling in WatchCall compute function
func TestWatchCall_ErrorHandling(t *testing.T) {
	config := DefaultWatcherConfig()
	watcher := NewWatcher(config)

	errorCount := int32(0)
	successCount := int32(0)

	managedFunc := func(msg *Message, ctx HershContext) error {
		val := WatchCall(
			func(prev any, ctx HershContext) (any, bool, error) {
				count := atomic.AddInt32(&errorCount, 1)
				if count%2 == 0 {
					// Return error on even calls
					return nil, false, context.DeadlineExceeded
				}
				atomic.AddInt32(&successCount, 1)
				return count, true, nil
			},
			"errorVar",
			100*time.Millisecond,
			ctx,
		)

		if val != nil {
			t.Logf("Received value despite errors: %v", val)
		}

		return nil
	}

	watcher.Manage(managedFunc, "test")

	err := watcher.Start()
	if err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	time.Sleep(600 * time.Millisecond)

	errors := atomic.LoadInt32(&errorCount)
	successes := atomic.LoadInt32(&successCount)

	if errors < 4 {
		t.Errorf("Expected at least 4 error attempts, got %d", errors)
	}

	if successes < 2 {
		t.Errorf("Expected at least 2 successful calls, got %d", successes)
	}

	t.Logf("Test complete - errors: %d, successes: %d", errors, successes)
}
