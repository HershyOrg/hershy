package hersh

import (
	"context"
	"fmt"
	"time"

	"hersh/manager"
)

// getWatcherFromContext extracts the Watcher from HershContext.
func getWatcherFromContext(ctx HershContext) *Watcher {
	w := ctx.GetValue("__watcher__")
	if w == nil {
		return nil
	}
	return w.(*Watcher)
}

// WatchCall monitors a value by calling a compute function periodically.
// Returns the current value or nil if not yet initialized.
//
// The compute function receives:
// - prev: the previous value (nil on first call)
// - ctx: HershContext for state access and cancellation
//
// The compute function returns:
// - next: the new value
// - changed: whether the value changed
// - error: any error that occurred
func WatchCall(
	computeNextState func(prev any, ctx HershContext) (any, bool, error),
	varName string,
	tick time.Duration,
	runCtx HershContext,
) any {
	w := getWatcherFromContext(runCtx)
	if w == nil {
		panic("WatchCall called with invalid HershContext")
	}

	w.mu.RLock()
	watchRegistry := w.manager.GetWatchRegistry()
	handle, exists := watchRegistry[varName]
	w.mu.RUnlock()

	if !exists {
		// First call - register and start watching
		ctx, cancel := context.WithCancel(w.ctx)

		handle = &manager.WatchHandle{
			VarName:      varName,
			ComputeFunc:  computeNextState,
			Tick:         tick,
			CancelFunc:   cancel,
			CurrentValue: nil,
			HershCtx:     runCtx, // Store HershContext for compute function
		}

		w.registerWatch(varName, handle)

		// Start watching in background
		go watchLoop(w, handle, ctx)

		// Return nil on first call (not yet initialized)
		return nil
	}

	// Get current value from VarState
	if w.manager != nil {
		val, ok := w.manager.GetState().VarState.Get(varName)
		if !ok {
			// Not initialized yet
			return nil
		}
		return val
	}

	return handle.CurrentValue
}

// watchLoop runs the Watch monitoring loop.
func watchLoop(w *Watcher, handle *manager.WatchHandle, ctx context.Context) {
	ticker := time.NewTicker(handle.Tick)
	defer ticker.Stop()

	prevValue := handle.CurrentValue

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Compute next value using HershContext
			nextValue, changed, err := handle.ComputeFunc(prevValue, handle.HershCtx)

			if err != nil {
				// Log error but continue watching
				if w.manager != nil {
					w.manager.GetLogger().LogError(err, fmt.Sprintf("watch error for %s", handle.VarName))
				}
				continue
			}

			if changed || prevValue == nil {
				// Send VarSig
				if w.manager != nil {
					w.manager.GetSignals().SendVarSig(&manager.VarSig{
						ComputedTime:  time.Now(),
						TargetVarName: handle.VarName,
						PrevState:     prevValue,
						NextState:     nextValue,
					})
				}

				handle.CurrentValue = nextValue
				prevValue = nextValue
			}
		}
	}
}

// WatchFlow monitors a channel and emits VarSig when values arrive.
// This is for event-driven reactive programming.
//
// Returns the latest value from the channel or nil if none received.
func WatchFlow(
	sourceChan <-chan any,
	varName string,
	runCtx HershContext,
) any {
	w := getWatcherFromContext(runCtx)
	if w == nil {
		panic("WatchFlow called with invalid HershContext")
	}

	w.mu.RLock()
	watchRegistry := w.manager.GetWatchRegistry()
	handle, exists := watchRegistry[varName]
	w.mu.RUnlock()

	if !exists {
		// First call - register and start watching
		ctx, cancel := context.WithCancel(w.ctx)

		handle = &manager.WatchHandle{
			VarName:      varName,
			ComputeFunc:  nil, // Not used for WatchFlow
			Tick:         0,
			CancelFunc:   cancel,
			CurrentValue: nil,
			HershCtx:     runCtx, // Store HershContext
		}

		w.registerWatch(varName, handle)

		// Start watching channel
		go watchFlowLoop(w, handle, sourceChan, ctx)

		return nil
	}

	// Get current value
	if w.manager != nil {
		val, ok := w.manager.GetState().VarState.Get(varName)
		if !ok {
			return nil
		}
		return val
	}

	return handle.CurrentValue
}

// watchFlowLoop monitors a channel and sends VarSig on updates.
func watchFlowLoop(w *Watcher, handle *manager.WatchHandle, sourceChan <-chan any, ctx context.Context) {
	prevValue := handle.CurrentValue

	for {
		select {
		case <-ctx.Done():
			return
		case nextValue, ok := <-sourceChan:
			if !ok {
				// Channel closed
				return
			}

			// Send VarSig
			if w.manager != nil {
				w.manager.GetSignals().SendVarSig(&manager.VarSig{
					ComputedTime:  time.Now(),
					TargetVarName: handle.VarName,
					PrevState:     prevValue,
					NextState:     nextValue,
				})
			}

			handle.CurrentValue = nextValue
			prevValue = nextValue
		}
	}
}

// Watch is a convenience wrapper that creates a channel-based watch.
// Deprecated: Use WatchCall or WatchFlow directly.
func Watch(varName string, initialValue any, runCtx HershContext) any {
	// For backward compatibility, just return WatchCall with a simple function
	return WatchCall(
		func(prev any, ctx HershContext) (any, bool, error) {
			if prev == nil {
				return initialValue, true, nil
			}
			return prev, false, nil
		},
		varName,
		1*time.Second,
		runCtx,
	)
}
