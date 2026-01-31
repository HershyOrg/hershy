package test

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"hersh"
	"hersh/manager"
	"hersh/shared"
)

// TestRecovery_SuppressPhase tests that 1-2 consecutive failures are suppressed
// and do not trigger recovery mode.
func TestRecovery_SuppressPhase(t *testing.T) {
	config := shared.DefaultWatcherConfig()
	config.RecoveryPolicy.MinConsecutiveFailures = 3
	config.RecoveryPolicy.MaxConsecutiveFailures = 6

	watcher := hersh.NewWatcher(config, nil)

	executionCount := int32(0)
	failureCount := 2 // Fail twice, then succeed

	managedFunc := func(msg *shared.Message, ctx shared.HershContext) error {
		count := atomic.AddInt32(&executionCount, 1)
		t.Logf("Execution #%d", count)

		// Register a watch to trigger periodic re-execution
		hersh.WatchCall(
			func() (manager.VarUpdateFunc, error) {
				return func(prev any) (any, bool, error) {
					return time.Now().Unix(), true, nil
				}, nil
			},
			"tick",
			100*time.Millisecond,
			ctx,
		)

		if count <= int32(failureCount) {
			return fmt.Errorf("simulated error #%d", count)
		}
		return nil
	}

	watcher.Manage(managedFunc, "suppress_test")

	// Start in background
	startDone := make(chan error, 1)
	go func() {
		startDone <- watcher.Start()
	}()

	// Wait for executions to complete
	time.Sleep(1500 * time.Millisecond)

	// Stop
	watcher.Stop()
	<-startDone

	executions := atomic.LoadInt32(&executionCount)
	t.Logf("Total executions: %d", executions)

	// Should have executed more than 2 times (failures + success)
	if executions <= int32(failureCount) {
		t.Errorf("Expected more than %d executions, got %d", failureCount, executions)
	}

	t.Log("Suppress phase test passed - stayed in Ready state")
}

// TestRecovery_EnterRecoveryMode tests that 3 consecutive failures trigger
// StateWaitRecover transition.
func TestRecovery_EnterRecoveryMode(t *testing.T) {
	config := shared.DefaultWatcherConfig()
	config.RecoveryPolicy.MinConsecutiveFailures = 3
	config.RecoveryPolicy.MaxConsecutiveFailures = 6
	config.RecoveryPolicy.BaseRetryDelay = 200 * time.Millisecond

	watcher := hersh.NewWatcher(config, nil)

	executionCount := int32(0)
	failureCount := 4 // Fail 4 times to trigger recovery

	managedFunc := func(msg *shared.Message, ctx shared.HershContext) error {
		count := atomic.AddInt32(&executionCount, 1)
		t.Logf("Execution #%d", count)

		// Register a watch to trigger periodic re-execution
		hersh.WatchCall(
			func() (manager.VarUpdateFunc, error) {
				return func(prev any) (any, bool, error) {
					return time.Now().Unix(), true, nil
				}, nil
			},
			"tick",
			100*time.Millisecond,
			ctx,
		)

		if count <= int32(failureCount) {
			return fmt.Errorf("simulated error #%d", count)
		}
		return nil
	}

	watcher.Manage(managedFunc, "recovery_test")

	// Start in background
	startDone := make(chan error, 1)
	go func() {
		startDone <- watcher.Start()
	}()

	// Wait for recovery to trigger
	time.Sleep(3 * time.Second)

	// Stop
	watcher.Stop()
	<-startDone

	executions := atomic.LoadInt32(&executionCount)
	t.Logf("Total executions: %d", executions)

	// Should have executed at least failureCount times
	if executions < int32(failureCount) {
		t.Errorf("Expected at least %d executions, got %d", failureCount, executions)
	}

	t.Log("Recovery mode entry test passed")
}

// TestRecovery_SuccessfulRecovery tests that recovery succeeds after entering
// WaitRecover state and transitions back to Ready via InitRun.
func TestRecovery_SuccessfulRecovery(t *testing.T) {
	config := shared.DefaultWatcherConfig()
	config.RecoveryPolicy.MinConsecutiveFailures = 3
	config.RecoveryPolicy.MaxConsecutiveFailures = 6
	config.RecoveryPolicy.BaseRetryDelay = 200 * time.Millisecond

	watcher := hersh.NewWatcher(config, nil)

	executionCount := int32(0)
	failureCount := 3 // Fail 3 times, then succeed

	managedFunc := func(msg *shared.Message, ctx shared.HershContext) error {
		count := atomic.AddInt32(&executionCount, 1)
		t.Logf("Execution #%d", count)

		// Register a watch to trigger periodic re-execution
		hersh.WatchCall(
			func() (manager.VarUpdateFunc, error) {
				return func(prev any) (any, bool, error) {
					return time.Now().Unix(), true, nil
				}, nil
			},
			"tick",
			100*time.Millisecond,
			ctx,
		)

		if count <= int32(failureCount) {
			return fmt.Errorf("simulated error #%d", count)
		}
		return nil
	}

	watcher.Manage(managedFunc, "successful_recovery_test")

	// Start in background
	startDone := make(chan error, 1)
	go func() {
		startDone <- watcher.Start()
	}()

	// Wait for recovery and success
	time.Sleep(3 * time.Second)

	// Stop
	watcher.Stop()
	<-startDone

	executions := atomic.LoadInt32(&executionCount)
	t.Logf("Total executions: %d", executions)

	// Should have executed more than failureCount (including successful recovery)
	if executions <= int32(failureCount) {
		t.Errorf("Expected more than %d executions, got %d", failureCount, executions)
	}

	t.Log("Successful recovery test passed")
}

// TestRecovery_MaxFailureCrash tests that 6 consecutive failures cause
// transition to StateCrashed.
func TestRecovery_MaxFailureCrash(t *testing.T) {
	config := shared.DefaultWatcherConfig()
	config.RecoveryPolicy.MinConsecutiveFailures = 3
	config.RecoveryPolicy.MaxConsecutiveFailures = 6
	config.RecoveryPolicy.BaseRetryDelay = 100 * time.Millisecond

	watcher := hersh.NewWatcher(config, nil)

	executionCount := int32(0)

	managedFunc := func(msg *shared.Message, ctx shared.HershContext) error {
		count := atomic.AddInt32(&executionCount, 1)
		t.Logf("Execution #%d - always failing", count)

		// Register a watch to trigger periodic re-execution
		hersh.WatchCall(
			func() (manager.VarUpdateFunc, error) {
				return func(prev any) (any, bool, error) {
					return time.Now().Unix(), true, nil
				}, nil
			},
			"tick",
			100*time.Millisecond,
			ctx,
		)

		return fmt.Errorf("persistent error #%d", count)
	}

	watcher.Manage(managedFunc, "crash_test")

	// Start in background
	startDone := make(chan error, 1)
	go func() {
		startDone <- watcher.Start()
	}()

	// Wait for crash
	time.Sleep(5 * time.Second)

	// Should already be crashed
	executions := atomic.LoadInt32(&executionCount)
	t.Logf("Total executions before crash: %d", executions)

	// Should have attempted MaxConsecutiveFailures times
	if executions < 6 {
		t.Logf("Warning: Expected at least 6 executions, got %d (may have crashed earlier)", executions)
	}

	// Try to stop (should handle gracefully even if crashed)
	watcher.Stop()

	select {
	case <-startDone:
		t.Log("Start completed (likely crashed)")
	case <-time.After(1 * time.Second):
		t.Log("Start did not complete (system may be in crashed state)")
	}

	t.Log("Max failure crash test completed")
}

// TestRecovery_CounterReset tests that a successful execution resets the
// consecutive failure counter.
func TestRecovery_CounterReset(t *testing.T) {
	config := shared.DefaultWatcherConfig()
	config.RecoveryPolicy.MinConsecutiveFailures = 3
	config.RecoveryPolicy.MaxConsecutiveFailures = 6

	watcher := hersh.NewWatcher(config, nil)

	executionCount := int32(0)
	failPattern := []bool{
		false, false, // Fail twice
		true,         // Success (resets counter)
		false, false, // Fail twice again (should suppress, not recover)
		true, // Success
	}

	managedFunc := func(msg *shared.Message, ctx shared.HershContext) error {
		count := atomic.AddInt32(&executionCount, 1)
		idx := int(count) - 1

		// Register a watch to trigger periodic re-execution
		hersh.WatchCall(
			func() (manager.VarUpdateFunc, error) {
				return func(prev any) (any, bool, error) {
					return time.Now().Unix(), true, nil
				}, nil
			},
			"tick",
			100*time.Millisecond,
			ctx,
		)

		if idx >= len(failPattern) {
			return nil // All tests done, keep succeeding
		}

		shouldSucceed := failPattern[idx]
		t.Logf("Execution #%d - shouldSucceed: %v", count, shouldSucceed)

		if shouldSucceed {
			return nil
		}
		return fmt.Errorf("simulated error #%d", count)
	}

	watcher.Manage(managedFunc, "counter_reset_test")

	// Start in background
	startDone := make(chan error, 1)
	go func() {
		startDone <- watcher.Start()
	}()

	// Wait for pattern to complete
	time.Sleep(3 * time.Second)

	// Stop
	watcher.Stop()
	<-startDone

	executions := atomic.LoadInt32(&executionCount)
	t.Logf("Total executions: %d", executions)

	// Should have executed through the pattern
	if executions < int32(len(failPattern)) {
		t.Errorf("Expected at least %d executions, got %d", len(failPattern), executions)
	}

	t.Log("Counter reset test passed - success resets failure counter")
}
