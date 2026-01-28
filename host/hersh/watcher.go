package hersh

import (
	"context"
	"fmt"
	"sync"
	"time"

	"hersh/manager"
)

// Watcher is the core reactive framework engine.
// It manages reactive state through Watch, executes managed functions,
// and provides fault tolerance through supervision.
type Watcher struct {
	config  WatcherConfig
	logger  *manager.Logger
	manager *WatcherManager

	// State
	mu           sync.RWMutex
	isRunning    bool
	watchRegistry map[string]*WatchHandle
	memoCache     map[string]any
	globalStore   map[string]any

	// Lifecycle
	ctx    context.Context
	cancel context.CancelFunc
}

// WatcherManager encapsulates all Manager components.
type WatcherManager struct {
	state     *manager.ManagerState
	signals   *manager.SignalChannels
	reducer   *manager.Reducer
	commander *manager.EffectCommander
	handler   *manager.EffectHandler
}

// WatchHandle represents a registered Watch variable.
type WatchHandle struct {
	VarName      string
	ComputeFunc  func(prev any, ctx context.Context) (any, bool, error)
	Tick         time.Duration
	cancelFunc   context.CancelFunc
	currentValue any
}

// NewWatcher creates a new Watcher with the given configuration.
func NewWatcher(config WatcherConfig) *Watcher {
	if config.DefaultTimeout == 0 {
		config = DefaultWatcherConfig()
	}

	ctx, cancel := context.WithCancel(context.Background())

	w := &Watcher{
		config:        config,
		logger:        manager.NewLogger(1000),
		watchRegistry: make(map[string]*WatchHandle),
		memoCache:     make(map[string]any),
		globalStore:   make(map[string]any),
		ctx:           ctx,
		cancel:        cancel,
	}

	return w
}

// Manage registers a function to be managed by the Watcher.
// Returns a CleanupBuilder for optional cleanup registration.
func (w *Watcher) Manage(fn manager.ManagedFunc, name string) *CleanupBuilder {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.isRunning {
		panic("cannot call Manage after Watcher is already running")
	}

	// Wrap the managed function to set currentWatcher
	wrappedFn := func(msg *Message, ctx HershContext) error {
		setCurrentWatcher(w)
		defer setCurrentWatcher(nil)
		return fn(msg, ctx)
	}

	// Initialize Manager components (start in Ready, will transition to InitRun on Start)
	state := manager.NewManagerState(StateReady)
	signals := manager.NewSignalChannels(100)
	reducer := manager.NewReducer(state, signals, w.logger)
	commander := manager.NewEffectCommander(reducer.ActionChannel())

	handler := manager.NewEffectHandler(
		wrappedFn,
		nil, // Cleaner will be set via CleanupBuilder
		state,
		signals,
		commander.EffectChannel(),
		w.logger,
		w.config,
	)

	w.manager = &WatcherManager{
		state:     state,
		signals:   signals,
		reducer:   reducer,
		commander: commander,
		handler:   handler,
	}

	return &CleanupBuilder{
		watcher:     w,
		managedFunc: wrappedFn,
	}
}

// Start begins the Watcher's execution.
// It starts all Manager components and enters InitRun state.
func (w *Watcher) Start() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.isRunning {
		return fmt.Errorf("watcher already running")
	}

	if w.manager == nil {
		return fmt.Errorf("no managed function registered")
	}

	// Start Manager components
	go w.manager.reducer.Run(w.ctx)
	go w.manager.commander.Run(w.ctx)
	go w.manager.handler.Run(w.ctx)

	// Send InitRun signal to start initialization
	w.manager.signals.SendWatcherSig(&manager.WatcherSig{
		SignalTime:  time.Now(),
		TargetState: StateInitRun,
		Reason:      "watcher start",
	})

	w.isRunning = true

	return nil
}

// Stop gracefully stops the Watcher.
func (w *Watcher) Stop() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.isRunning {
		return fmt.Errorf("watcher not running")
	}

	// Send Stop signal
	w.manager.signals.SendWatcherSig(&manager.WatcherSig{
		SignalTime:  time.Now(),
		TargetState: StateStopped,
		Reason:      "user requested stop",
	})

	// Wait a bit for cleanup to complete
	time.Sleep(100 * time.Millisecond)

	// Cancel all Watch goroutines
	w.stopAllWatches()

	// Cancel context
	w.cancel()

	w.isRunning = false

	return nil
}

// SendMessage sends a user message to the managed function.
func (w *Watcher) SendMessage(content string) error {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if !w.isRunning {
		return fmt.Errorf("watcher not running")
	}

	msg := &Message{
		Content:    content,
		IsConsumed: false,
		ReceivedAt: time.Now(),
	}

	w.manager.signals.SendUserSig(&manager.UserSig{
		ReceivedTime: time.Now(),
		Message:      msg,
	})

	return nil
}

// GetState returns the current WatcherState.
func (w *Watcher) GetState() WatcherState {
	if w.manager == nil {
		return StateReady
	}
	return w.manager.state.GetWatcherState()
}

// GetLogger returns the Watcher's logger for inspection.
func (w *Watcher) GetLogger() *manager.Logger {
	return w.logger
}

// registerWatch registers a Watch variable.
// This is called by Watch/WatchCall/WatchFlow functions.
func (w *Watcher) registerWatch(varName string, handle *WatchHandle) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.watchRegistry[varName] = handle

	// Register with EffectHandler for initialization tracking
	if w.manager != nil {
		w.manager.handler.RegisterVar(varName)
	}
}

// stopAllWatches stops all Watch goroutines.
func (w *Watcher) stopAllWatches() {
	for _, handle := range w.watchRegistry {
		if handle.cancelFunc != nil {
			handle.cancelFunc()
		}
	}
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
		watcherID: "watcher-1", // TODO: Use actual ID
	}

	if cb.watcher.manager != nil {
		// Update handler with cleaner
		cb.watcher.manager.handler = manager.NewEffectHandler(
			cb.managedFunc, // Use stored managed func
			cleaner,
			cb.watcher.manager.state,
			cb.watcher.manager.signals,
			cb.watcher.manager.commander.EffectChannel(),
			cb.watcher.logger,
			cb.watcher.config,
		)
	}

	return cb.watcher
}

// cleanupAdapter adapts the user's cleanup function to the Cleaner interface.
type cleanupAdapter struct {
	cleanupFn func(ctx HershContext)
	watcherID string
}

func (ca *cleanupAdapter) ClearRun(ctx context.Context) error {
	hershCtx := &hershContextImpl{
		Context:   ctx,
		watcherID: ca.watcherID,
		message:   nil,
	}

	ca.cleanupFn(hershCtx)
	return nil
}

// hershContextImpl implements HershContext.
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
