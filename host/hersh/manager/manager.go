package manager

import (
	"context"
	"time"

	"hersh/shared"
)

// WatchHandle represents a registered Watch variable.
type WatchHandle struct {
	VarName      string
	ComputeFunc  func(prev any, ctx shared.HershContext) (any, bool, error)
	Tick         time.Duration
	CancelFunc   context.CancelFunc
	CurrentValue any
	HershCtx     shared.HershContext // Context for compute function
}

// Manager encapsulates all Manager components.
// It orchestrates the Reducer-Effect pattern for reactive execution.
type Manager struct {
	logger *Logger

	state   *ManagerState
	signals *SignalChannels

	reducer   *Reducer
	commander *EffectCommander
	handler   *EffectHandler

	memoCache     map[string]any
	watchRegistry map[string]*WatchHandle
}

// NewManager creates a new WatcherManager with core components initialized.
// The Manager creates and owns its logger internally.
// ManagedFunc should be set later via SetManagedFunc().
func NewManager(config shared.WatcherConfig) *Manager {
	// Initialize logger (Manager owns its logger)
	logger := NewLogger(1000)

	// Initialize Manager components (start in Ready, will transition to InitRun on Start)
	state := NewManagerState(shared.StateReady)
	signals := NewSignalChannels(100)

	// Create reducer (no longer needs ActionChannel)
	reducer := NewReducer(state, signals, logger)

	// Create commander (now synchronous, no channels)
	commander := NewEffectCommander()

	// Create handler (no longer needs effectCh)
	handler := NewEffectHandler(
		nil, // ManagedFunc to be set later
		nil, // Cleaner to be set later
		state,
		signals,
		logger,
		config,
	)

	return &Manager{
		logger:        logger,
		state:         state,
		signals:       signals,
		reducer:       reducer,
		commander:     commander,
		handler:       handler,
		memoCache:     make(map[string]any),
		watchRegistry: make(map[string]*WatchHandle),
	}
}

// Start starts the Reducer loop (synchronous architecture).
// Only Reducer runs in a goroutine now - it calls Commander and Handler synchronously.
func (wm *Manager) Start(ctx context.Context) {
	// Pass commander and handler to reducer so it can call them synchronously
	go wm.reducer.RunWithEffects(ctx, wm.commander, wm.handler)
}

// GetState returns the current ManagerState.
func (wm *Manager) GetState() *ManagerState {
	return wm.state
}

// GetSignals returns the SignalChannels.
func (wm *Manager) GetSignals() *SignalChannels {
	return wm.signals
}

// GetHandler returns the EffectHandler.
func (wm *Manager) GetHandler() *EffectHandler {
	return wm.handler
}

// GetLogger returns the Manager's logger.
func (wm *Manager) GetLogger() *Logger {
	return wm.logger
}

// SetManagedFunc sets the managed function and cleaner.
// This should be called after Manager initialization, typically by Watcher.Manage().
func (wm *Manager) SetManagedFunc(managedFunc ManagedFunc, cleaner Cleaner) {
	wm.handler.SetManagedFunc(managedFunc)
	wm.handler.SetCleaner(cleaner)
}

// HasManagedFunc returns whether a managed function has been registered.
func (wm *Manager) HasManagedFunc() bool {
	return wm.handler.HasManagedFunc()
}

// GetMemoCache returns the memo cache.
func (wm *Manager) GetMemoCache() map[string]any {
	return wm.memoCache
}

// GetWatchRegistry returns the watch registry.
func (wm *Manager) GetWatchRegistry() map[string]*WatchHandle {
	return wm.watchRegistry
}
