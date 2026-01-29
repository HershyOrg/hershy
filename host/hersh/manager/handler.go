package manager

import (
	"context"
	"fmt"
	"sync"
	"time"

	"hersh/core"
)

// ManagedFunc is the type of function that can be managed by the Watcher.
// It receives a message and HershContext, and returns an error for control flow.
type ManagedFunc func(message *core.Message, ctx core.HershContext) error

// Cleaner provides cleanup functionality for managed functions.
type Cleaner interface {
	ClearRun(ctx core.HershContext) error
}

// EffectLogger logs effect execution results.
type EffectLogger interface {
	LogEffectResult(result *EffectResult)
	LogEffect(msg string)
	GetRecentResults(count int) []*EffectResult
}

// EffectHandler executes effects and manages the lifecycle of managed functions.
type EffectHandler struct {
	managedFunc      ManagedFunc
	cleaner          Cleaner
	state            *ManagerState
	signals          *SignalChannels
	effectCh         <-chan EffectDefinition
	logger           EffectLogger
	config           core.WatcherConfig
	expectedVars     []string // Variables registered by Watch calls
	rootCtx          context.Context
	rootCtxCancel    context.CancelFunc
	consecutiveFails int
	hershCtx         *hershContext // Persistent HershContext across executions
}

// NewEffectHandler creates a new EffectHandler.
func NewEffectHandler(
	managedFunc ManagedFunc,
	cleaner Cleaner,
	state *ManagerState,
	signals *SignalChannels,
	effectCh <-chan EffectDefinition,
	logger EffectLogger,
	config core.WatcherConfig,
) *EffectHandler {
	ctx, cancel := context.WithCancel(context.Background())

	// Create persistent HershContext
	hershCtx := &hershContext{
		Context:     ctx,
		watcherID:   "watcher-1", // TODO: Get from config
		message:     nil,
		valueStore:  make(map[string]any),
		logger:      logger.(*Logger),
	}

	return &EffectHandler{
		managedFunc:   managedFunc,
		cleaner:       cleaner,
		state:         state,
		signals:       signals,
		effectCh:      effectCh,
		logger:        logger,
		config:        config,
		expectedVars:  make([]string, 0),
		rootCtx:       ctx,
		rootCtxCancel: cancel,
		hershCtx:      hershCtx,
	}
}

// RegisterVar registers a variable name that Watch will monitor.
func (eh *EffectHandler) RegisterVar(varName string) {
	eh.expectedVars = append(eh.expectedVars, varName)
}

// SetWatcher sets the Watcher reference in the HershContext.
// This must be called before running any effects.
func (eh *EffectHandler) SetWatcher(watcher any) {
	eh.hershCtx.SetValue("__watcher__", watcher)
}

// GetHershContext returns the persistent HershContext.
func (eh *EffectHandler) GetHershContext() core.HershContext {
	return eh.hershCtx
}

// Run starts the effect handler loop.
func (eh *EffectHandler) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case effect := <-eh.effectCh:
			eh.executeEffect(effect)
		}
	}
}

// executeEffect executes the effect and sends appropriate signals.
func (eh *EffectHandler) executeEffect(effect EffectDefinition) {
	var result *EffectResult

	switch e := effect.(type) {
	case *RunScriptEffect:
		result = eh.runScript()
	case *InitRunScriptEffect:
		result = eh.initRunScript()
	case *ClearRunScriptEffect:
		result = eh.clearRunScript(e.HookState)
	case *JustKillEffect:
		result = eh.justKill()
	case *JustCrashEffect:
		result = eh.justCrash()
	case *RecoverEffect:
		result = eh.recover()
	default:
		result = &EffectResult{
			Effect:    effect,
			Success:   false,
			Error:     fmt.Errorf("unknown effect type: %T", effect),
			Timestamp: time.Now(),
		}
	}

	if eh.logger != nil {
		eh.logger.LogEffectResult(result)
	}
}

// runScript executes the managed function.
func (eh *EffectHandler) runScript() *EffectResult {
	result := &EffectResult{
		Effect:    &RunScriptEffect{},
		Timestamp: time.Now(),
	}

	// Create execution context with timeout
	execCtx, cancel := context.WithTimeout(eh.rootCtx, eh.config.DefaultTimeout)
	defer cancel()

	// Consume message
	msg := eh.state.UserState.ConsumeMessage()

	// Update persistent HershContext with new context and message
	eh.hershCtx.Context = execCtx
	eh.hershCtx.message = msg

	// Execute in goroutine with panic recovery
	done := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- fmt.Errorf("panic: %v", r)
			}
		}()
		done <- eh.managedFunc(msg, eh.hershCtx)
	}()

	// Wait for completion or timeout
	select {
	case err := <-done:
		if err != nil {
			result.Success = false
			result.Error = err
			eh.handleScriptError(err)
		} else {
			result.Success = true
			// Send Ready signal
			eh.signals.SendWatcherSig(&WatcherSig{
				SignalTime:  time.Now(),
				TargetState: core.StateReady,
				Reason:      "execution completed successfully",
			})
		}
	case <-execCtx.Done():
		result.Success = false
		result.Error = execCtx.Err()
		// Timeout - send Ready signal (will retry on next trigger)
		eh.signals.SendWatcherSig(&WatcherSig{
			SignalTime:  time.Now(),
			TargetState: core.StateReady,
			Reason:      "execution timeout",
		})
	}

	return result
}

// handleScriptError processes errors from managed function execution.
func (eh *EffectHandler) handleScriptError(err error) {
	switch err.(type) {
	case *core.KillError:
		eh.signals.SendWatcherSig(&WatcherSig{
			SignalTime:  time.Now(),
			TargetState: core.StateKilled,
			Reason:      err.Error(),
		})
	case *core.StopError:
		eh.signals.SendWatcherSig(&WatcherSig{
			SignalTime:  time.Now(),
			TargetState: core.StateStopped,
			Reason:      err.Error(),
		})
	default:
		// Regular error - go back to Ready
		eh.signals.SendWatcherSig(&WatcherSig{
			SignalTime:  time.Now(),
			TargetState: core.StateReady,
			Reason:      fmt.Sprintf("error: %v", err),
		})
	}
}

// initRunScript performs initialization run.
func (eh *EffectHandler) initRunScript() *EffectResult {
	result := &EffectResult{
		Effect:    &InitRunScriptEffect{},
		Timestamp: time.Now(),
	}

	// Phase 1: Run once to trigger Watch registrations
	phase1Result := eh.runScriptOnce()
	if phase1Result.Error != nil {
		// Check if it's VarNotInitializedError (expected during init)
		if _, ok := phase1Result.Error.(*core.VarNotInitializedError); !ok {
			// Unexpected error
			result.Success = false
			result.Error = phase1Result.Error
			eh.handleScriptError(phase1Result.Error)
			return result
		}
	}

	// Phase 2: Wait for all variables to initialize (max 5 minutes)
	// If no variables to initialize, transition to Ready immediately
	if len(eh.expectedVars) == 0 {
		result.Success = true
		eh.signals.SendWatcherSig(&WatcherSig{
			SignalTime:  time.Now(),
			TargetState: core.StateReady,
			Reason:      "initialization complete (no variables to watch)",
		})
		return result
	}

	initCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-initCtx.Done():
			// Timeout - crash
			result.Success = false
			result.Error = fmt.Errorf("initialization timeout: not all variables initialized")
			eh.signals.SendWatcherSig(&WatcherSig{
				SignalTime:  time.Now(),
				TargetState: core.StateCrashed,
				Reason:      "initialization timeout",
			})
			return result
		case <-ticker.C:
			// Check if all variables are initialized
			if eh.state.VarState.AllInitialized(eh.expectedVars) {
				// Success - transition to Ready
				result.Success = true
				eh.signals.SendWatcherSig(&WatcherSig{
					SignalTime:  time.Now(),
					TargetState: core.StateReady,
					Reason:      "initialization complete",
				})
				return result
			}
		}
	}
}

// runScriptOnce executes the managed function once (for initialization).
func (eh *EffectHandler) runScriptOnce() *EffectResult {
	result := &EffectResult{
		Timestamp: time.Now(),
	}

	execCtx, cancel := context.WithTimeout(eh.rootCtx, eh.config.DefaultTimeout)
	defer cancel()

	// Update persistent HershContext
	eh.hershCtx.Context = execCtx
	eh.hershCtx.message = nil

	done := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- fmt.Errorf("panic: %v", r)
			}
		}()
		done <- eh.managedFunc(nil, eh.hershCtx)
	}()

	select {
	case err := <-done:
		result.Error = err
		result.Success = err == nil
	case <-execCtx.Done():
		result.Error = execCtx.Err()
		result.Success = false
	}

	return result
}

// clearRunScript executes cleanup.
func (eh *EffectHandler) clearRunScript(hookState core.WatcherState) *EffectResult {
	result := &EffectResult{
		Effect:    &ClearRunScriptEffect{HookState: hookState},
		Timestamp: time.Now(),
	}

	// Cancel root context
	eh.rootCtxCancel()

	// Create new root context
	eh.rootCtx, eh.rootCtxCancel = context.WithCancel(context.Background())

	// Execute cleanup using persistent HershContext
	if eh.cleaner != nil {
		// Update context with 5-minute timeout for cleanup
		cleanCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		eh.hershCtx.Context = cleanCtx

		err := eh.cleaner.ClearRun(eh.hershCtx)
		if err != nil {
			result.Success = false
			result.Error = err
		} else {
			result.Success = true
		}
	} else {
		result.Success = true
	}

	// Send signal to transition to hook state
	eh.signals.SendWatcherSig(&WatcherSig{
		SignalTime:  time.Now(),
		TargetState: hookState,
		Reason:      fmt.Sprintf("cleanup completed for %s", hookState),
	})

	return result
}

// justKill sends Kill signal without cleanup.
func (eh *EffectHandler) justKill() *EffectResult {
	eh.signals.SendWatcherSig(&WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateKilled,
		Reason:      "kill requested",
	})
	return &EffectResult{
		Effect:    &JustKillEffect{},
		Success:   true,
		Timestamp: time.Now(),
	}
}

// justCrash sends Crash signal without cleanup.
func (eh *EffectHandler) justCrash() *EffectResult {
	eh.signals.SendWatcherSig(&WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateCrashed,
		Reason:      "crash requested",
	})
	return &EffectResult{
		Effect:    &JustCrashEffect{},
		Success:   true,
		Timestamp: time.Now(),
	}
}

// recover implements the recovery logic (Erlang Supervisor pattern).
func (eh *EffectHandler) recover() *EffectResult {
	result := &EffectResult{
		Effect:    &RecoverEffect{},
		Timestamp: time.Now(),
	}

	// Check recent failure count
	recentResults := eh.logger.GetRecentResults(6)
	consecutiveFails := 0
	for _, r := range recentResults {
		if !r.Success {
			consecutiveFails++
		} else {
			break
		}
	}

	if consecutiveFails >= eh.config.RecoveryPolicy.MaxConsecutiveFailures {
		// Too many failures - crash
		result.Success = false
		result.Error = fmt.Errorf("max consecutive failures reached: %d", consecutiveFails)
		eh.signals.SendWatcherSig(&WatcherSig{
			SignalTime:  time.Now(),
			TargetState: core.StateCrashed,
			Reason:      "max consecutive failures exceeded",
		})
		return result
	}

	// Calculate backoff delay
	delay := eh.calculateBackoff(consecutiveFails)
	time.Sleep(delay)

	// Attempt recovery - send InitRun signal
	result.Success = true
	eh.signals.SendWatcherSig(&WatcherSig{
		SignalTime:  time.Now(),
		TargetState: core.StateInitRun,
		Reason:      fmt.Sprintf("recovery attempt after %d failures", consecutiveFails),
	})

	return result
}

// calculateBackoff calculates exponential backoff delay.
func (eh *EffectHandler) calculateBackoff(failures int) time.Duration {
	delay := eh.config.RecoveryPolicy.BaseRetryDelay
	for i := 0; i < failures; i++ {
		delay *= 2
		if delay > eh.config.RecoveryPolicy.MaxRetryDelay {
			return eh.config.RecoveryPolicy.MaxRetryDelay
		}
	}
	return delay
}

// hershContext implements HershContext interface (simplified version).
type hershContext struct {
	context.Context
	watcherID   string
	message     *core.Message
	valueStore  map[string]any
	valuesMutex sync.RWMutex
	logger      *Logger
}

func (hc *hershContext) WatcherID() string {
	return hc.watcherID
}

func (hc *hershContext) Message() *core.Message {
	return hc.message
}

func (hc *hershContext) GetValue(key string) any {
	hc.valuesMutex.RLock()
	defer hc.valuesMutex.RUnlock()
	return hc.valueStore[key]
}

func (hc *hershContext) SetValue(key string, value any) {
	hc.valuesMutex.Lock()
	defer hc.valuesMutex.Unlock()

	oldValue := hc.valueStore[key]
	hc.valueStore[key] = value

	// Log the state change
	if hc.logger != nil {
		if oldValue == nil {
			hc.logger.LogContextValue(key, nil, value, "initialized")
		} else {
			hc.logger.LogContextValue(key, oldValue, value, "updated")
		}
	}
}

func (hc *hershContext) UpdateValue(key string, updateFn func(current any) any) any {
	hc.valuesMutex.Lock()
	defer hc.valuesMutex.Unlock()

	// Get current value
	currentValue := hc.valueStore[key]

	// Create a deep copy to pass to updateFn
	// This ensures the user cannot accidentally mutate the stored state
	currentCopy := core.DeepCopy(currentValue)

	// Call the update function with the copy
	newValue := updateFn(currentCopy)

	// Store the new value
	oldValue := hc.valueStore[key]
	hc.valueStore[key] = newValue

	// Log the state change
	if hc.logger != nil {
		if oldValue == nil {
			hc.logger.LogContextValue(key, nil, newValue, "initialized")
		} else {
			hc.logger.LogContextValue(key, oldValue, newValue, "updated")
		}
	}

	return newValue
}
