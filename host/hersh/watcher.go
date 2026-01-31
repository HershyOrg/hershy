package hersh

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"hersh/manager"
)

// Watcher is the core reactive framework engine.
// It manages reactive state through Watch, executes managed functions,
// and provides fault tolerance through supervision.
type Watcher struct {
	config  WatcherConfig
	manager *manager.Manager

	// Environment variables (immutable after initialization)
	// Can only be set during NewWatcher and accessed via GetEnv.
	envVarMap map[string]string

	// State
	isRunning atomic.Bool

	// Lifecycle
	rootCtx    context.Context
	rootCancel context.CancelFunc
}

// NewWatcher creates a new Watcher with the given configuration and environment variables.
// The Manager is initialized during Watcher construction.
// envVars are immutable after initialization and can only be accessed via GetEnv.
// If envVars is nil, an empty map is created.
func NewWatcher(config WatcherConfig, envVars map[string]string) *Watcher {
	if config.DefaultTimeout == 0 {
		config = DefaultWatcherConfig()
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Initialize Manager with config (no managed function yet)
	mgr := manager.NewManager(config)

	// Deep copy envVars to ensure immutability
	envCopy := make(map[string]string)
	if envVars != nil {
		for k, v := range envVars {
			envCopy[k] = v
		}
	}

	w := &Watcher{
		config:     config,
		manager:    mgr,
		envVarMap:  envCopy,
		rootCtx:    ctx,
		rootCancel: cancel,
	}

	// Set watcher reference in Manager's handler
	mgr.GetEffectHandler().SetWatcher(w)

	return w
}

// Manage registers a function to be managed by the Watcher.
// Returns a CleanupBuilder for optional cleanup registration.
func (w *Watcher) Manage(fn manager.ManagedFunc, name string) *CleanupBuilder {
	if w.isRunning.Load() {
		panic("cannot call Manage after Watcher is already running")
	}

	if w.manager.HasManagedFunc() {
		panic("managed function already registered")
	}

	// Wrap the managed function
	wrappedFn := func(msg *Message, ctx HershContext) error {
		return fn(msg, ctx)
	}

	// Register managed function with the Manager
	// Cleaner will be set via CleanupBuilder
	w.manager.SetManagedFunc(wrappedFn, nil)

	return &CleanupBuilder{
		watcher:     w,
		managedFunc: wrappedFn,
	}
}

// Start begins the Watcher's execution.
// It starts all Manager components, enters InitRun state, and waits for Ready state.
func (w *Watcher) Start() error {
	if !w.isRunning.CompareAndSwap(false, true) {
		return fmt.Errorf("watcher already running")
	}

	if !w.manager.HasManagedFunc() {
		w.isRunning.Store(false) // Reset on error
		return fmt.Errorf("no managed function registered")
	}

	// Start Manager components
	w.manager.Start(w.rootCtx)

	// Send InitRun signal to start initialization
	w.manager.GetSignals().SendWatcherSig(&manager.WatcherSig{
		SignalTime:  time.Now(),
		TargetState: StateInitRun,
		Reason:      "watcher start",
	})

	// Wait for initialization to complete using channel (deterministic, no timeouts)
	// The Manager will transition to Ready state when all variables are initialized
	readyChan := w.manager.GetState().WaitReady()
	<-readyChan

	// Check final state - it should be Ready, but could be Crashed/Killed if init failed
	finalState := w.manager.GetState().GetManagerInnerState()
	if finalState == StateReady {
		return nil
	}

	// Initialization failed
	return fmt.Errorf("initialization failed: watcher entered %s state", finalState)
}

// Stop gracefully stops the Watcher.
func (w *Watcher) Stop() error {
	// Check if Manager is already in a terminal state
	// This handles cases where StopError/KillError automatically stopped the Manager
	currentState := w.manager.GetState().GetManagerInnerState()
	if currentState == StateStopped || currentState == StateKilled || currentState == StateCrashed {
		return fmt.Errorf("watcher already stopped (state: %s)", currentState)
	}

	if !w.isRunning.Load() {
		return fmt.Errorf("watcher not running")
	}

	// Send Stop signal
	w.manager.GetSignals().SendWatcherSig(&manager.WatcherSig{
		SignalTime:  time.Now(),
		TargetState: StateStopped,
		Reason:      "user requested stop",
	})

	// Wait for actual cleanup completion using channels (deterministic, no timeouts)
	// 1. Wait for cleanup to actually complete
	cleanupDone := w.manager.GetEffectHandler().GetCleanupDone()
	<-cleanupDone

	// 2. Wait for Manager to reach Stopped state
	stoppedChan := w.manager.GetState().WaitStopped()
	<-stoppedChan

	// 3. Finalize Watcher shutdown
	w.stopAllWatches()
	w.rootCancel()
	w.isRunning.Store(false)

	return nil
}

// SendMessage sends a user message to the managed function.
func (w *Watcher) SendMessage(content string) error {
	if !w.isRunning.Load() {
		return fmt.Errorf("watcher not running")
	}

	msg := &Message{
		Content:    content,
		IsConsumed: false,
		ReceivedAt: time.Now(),
	}

	w.manager.GetSignals().SendUserSig(&manager.UserSig{
		ReceivedTime: time.Now(),
		UserMessage:  msg,
	})

	return nil
}

// GetState returns the current WatcherState.
func (w *Watcher) GetState() ManagerInnerState {
	return w.manager.GetState().GetManagerInnerState()
}

// GetLogger returns the Watcher's logger for inspection.
func (w *Watcher) GetLogger() *manager.Logger {
	return w.manager.GetLogger()
}

// GetEnv returns the environment variable value for the given key.
// The second return value (ok) is true if the key exists, false otherwise.
// This method is safe for concurrent access as envVarMap is immutable after initialization.
func (w *Watcher) GetEnv(key string) (string, bool) {
	val, ok := w.envVarMap[key]
	return val, ok
}

// registerWatch registers a Watch variable.
// This is called by Watch/WatchCall/WatchFlow functions.
func (w *Watcher) registerWatch(varName string, handle manager.WatchHandle) {
	watchRegistry := w.manager.GetWatchRegistry()
	watchRegistry.Store(varName, handle)

	// Register with EffectHandler for initialization tracking
	w.manager.GetEffectHandler().RegisterVar(varName)
}

// stopAllWatches stops all Watch goroutines.
func (w *Watcher) stopAllWatches() {
	watchRegistry := w.manager.GetWatchRegistry()
	watchRegistry.Range(func(key, value any) bool {
		handle := value.(manager.WatchHandle)
		if cancelFunc := handle.GetCancelFunc(); cancelFunc != nil {
			cancelFunc()
		}
		return true // continue iteration
	})
}

// CleanupBuilder provides a fluent interface for registering cleanup.
type CleanupBuilder struct {
	watcher     *Watcher
	managedFunc manager.ManagedFunc
}

// Cleanup registers a cleanup function to be called on Stop/Kill/Crash.
func (cb *CleanupBuilder) Cleanup(cleanupFn func(ctx HershContext)) *Watcher {
	cleaner := &cleanupAdapter{
		cleanupFn: cleanupFn,
	}

	// Update cleaner in the Manager
	cb.watcher.manager.SetManagedFunc(cb.managedFunc, cleaner)

	return cb.watcher
}

// cleanupAdapter adapts the user's cleanup function to the Cleaner interface.
type cleanupAdapter struct {
	cleanupFn func(ctx HershContext)
}

func (ca *cleanupAdapter) ClearRun(ctx HershContext) error {
	// Simply call the cleanup function with HershContext
	ca.cleanupFn(ctx)
	return nil
}

// hershContextImpl implements HershContext (simple fallback version).
type hershContextImpl struct {
	context.Context
	watcherID string
	message   *Message
}

func (hc *hershContextImpl) WatcherID() string {
	return hc.watcherID
}

func (hc *hershContextImpl) Message() *Message {
	return hc.message
}

func (hc *hershContextImpl) GetValue(key string) any {
	// Fallback implementation returns nil
	return nil
}

func (hc *hershContextImpl) SetValue(key string, value any) {
	// Fallback implementation does nothing
}

func (hc *hershContextImpl) UpdateValue(key string, updateFn func(current any) any) any {
	// Fallback implementation - call updateFn with nil and return result
	return updateFn(nil)
}
