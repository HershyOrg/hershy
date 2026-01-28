package hersh

import "fmt"

// Memo caches a computed value for the duration of the Watcher session.
// On first call, it computes and caches the value.
// On subsequent calls, it returns the cached value.
//
// Memo is synchronous and does NOT trigger re-execution.
// It's useful for expensive initialization that should happen once.
//
// Example:
//
//	client := hersh.Memo(func() any {
//	    return expensive.NewClient()
//	}, "apiClient", ctx).(*Client)
func Memo(computeValue func() any, memoName string, ctx HershContext) any {
	w := getCurrentWatcher()
	if w == nil {
		panic("Memo called outside of managed function")
	}

	w.mu.RLock()
	cached, exists := w.memoCache[memoName]
	w.mu.RUnlock()

	if exists {
		return cached
	}

	// Compute value
	value := computeValue()

	// Cache it
	w.mu.Lock()
	w.memoCache[memoName] = value
	w.mu.Unlock()

	// Log the memoization
	w.logger.LogEffect(fmt.Sprintf("Memo[%s] = %v", memoName, value))

	return value
}

// Global retrieves a global variable.
// Global variables are shared across all executions and can be modified.
//
// Unlike Memo, Global values can change between executions.
// Each access is logged for observability.
//
// Returns nil if the global doesn't exist.
func Global(globalName string, ctx HershContext) any {
	w := getCurrentWatcher()
	if w == nil {
		panic("Global called outside of managed function")
	}

	w.mu.RLock()
	value, exists := w.globalStore[globalName]
	w.mu.RUnlock()

	// Log access
	w.logger.LogEffect(fmt.Sprintf("Global[%s] read = %v", globalName, value))

	if !exists {
		return nil
	}

	return value
}

// SetGlobal sets a global variable.
// The change is logged for observability.
//
// Global variables persist across executions and can be modified by effects.
func SetGlobal(globalName string, value any, ctx HershContext) {
	w := getCurrentWatcher()
	if w == nil {
		panic("SetGlobal called outside of managed function")
	}

	w.mu.Lock()
	w.globalStore[globalName] = value
	w.mu.Unlock()

	// Log modification
	w.logger.LogEffect(fmt.Sprintf("Global[%s] set = %v", globalName, value))
}

// ClearMemo removes a memoized value, forcing recomputation on next Memo call.
func ClearMemo(memoName string, ctx HershContext) {
	w := getCurrentWatcher()
	if w == nil {
		panic("ClearMemo called outside of managed function")
	}

	w.mu.Lock()
	delete(w.memoCache, memoName)
	w.mu.Unlock()

	w.logger.LogEffect(fmt.Sprintf("Memo[%s] cleared", memoName))
}
