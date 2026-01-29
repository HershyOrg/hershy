package manager

import (
	"context"
	"fmt"
	"time"

	"hersh/shared"
)

// ReduceAction represents a state transition that occurred.
type ReduceAction struct {
	PrevState StateSnapshot
	Signal    shared.Signal
	NextState StateSnapshot
}

// Reducer manages state transitions based on signals.
// It implements priority-based signal processing.
type Reducer struct {
	state   *ManagerState
	signals *SignalChannels
	logger  ReduceLogger
}

// ReduceLogger handles logging of state transitions.
type ReduceLogger interface {
	LogReduce(action ReduceAction)
}

// NewReducer creates a new Reducer.
func NewReducer(state *ManagerState, signals *SignalChannels, logger ReduceLogger) *Reducer {
	return &Reducer{
		state:   state,
		signals: signals,
		logger:  logger,
	}
}

// RunWithEffects starts the reducer loop with synchronous effect execution.
// This is the main loop following the specification:
// 1. Wait for signal
// 2. Reduce (state transition)
// 3. Call EffectCommander synchronously
// 4. Call EffectHandler synchronously
// 5. If effect returns WatcherSig, process it recursively
// Priority: WatcherSig > UserSig > VarSig
func (r *Reducer) RunWithEffects(ctx context.Context, commander *EffectCommander, handler *EffectHandler) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-r.signals.NewSigAppended:
			// Process all available signals respecting priority
			r.processAvailableSignalsWithEffects(ctx, commander, handler)
		}
	}
}

// processAvailableSignalsWithEffects drains signal channels respecting priority.
// For each signal: Reduce → CommandEffect → ExecuteEffect → handle result WatcherSig.
func (r *Reducer) processAvailableSignalsWithEffects(ctx context.Context, commander *EffectCommander, handler *EffectHandler) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			// Try to process one signal, highest priority first
			if !r.tryProcessNextSignalWithEffects(commander, handler) {
				// No more signals to process
				return
			}
		}
	}
}

// tryProcessNextSignalWithEffects processes one signal following the specification:
// 1. Select signal by priority
// 2. Reduce (state transition)
// 3. CommandEffect (synchronous)
// 4. ExecuteEffect (synchronous)
// 5. If effect returns WatcherSig, inject it back into channel for recursive processing
// Returns true if a signal was processed, false if no signals available.
func (r *Reducer) tryProcessNextSignalWithEffects(commander *EffectCommander, handler *EffectHandler) bool {
	currentState := r.state.GetManagerInnerState()

	// Priority 1: WatcherSig (highest)
	select {
	case sig := <-r.signals.WatcherSigChan:
		r.reduceAndExecuteEffect(sig, commander, handler)
		return true
	default:
	}

	// Priority 2: UserSig
	if r.canProcessUserSig(currentState) {
		select {
		case sig := <-r.signals.UserSigChan:
			r.reduceAndExecuteEffect(sig, commander, handler)
			return true
		default:
		}
	}

	// Priority 3: VarSig (lowest)
	if r.canProcessVarSig(currentState) {
		select {
		case sig := <-r.signals.VarSigChan:
			r.reduceAndExecuteEffect(sig, commander, handler)
			return true
		default:
		}
	}

	return false
}

// reduceAndExecuteEffect performs the complete Reduce-Effect cycle:
// Reduce → CommandEffect → ExecuteEffect → handle result.
func (r *Reducer) reduceAndExecuteEffect(sig shared.Signal, commander *EffectCommander, handler *EffectHandler) {
	// 1. Reduce: perform state transition
	prevSnapshot := r.state.Snapshot()

	switch s := sig.(type) {
	case *WatcherSig:
		r.reduceWatcherSig(s)
	case *UserSig:
		r.reduceUserSig(s)
	case *VarSig:
		r.reduceVarSig(s)

		// Special case: After processing VarSig in InitRun, check if initialization is complete
		if r.state.GetManagerInnerState() == shared.StateInitRun {
			if handler.CheckInitializationComplete() {
				// All variables initialized - send WatcherSig to transition to Ready
				r.signals.SendWatcherSig(&WatcherSig{
					SignalTime:  time.Now(),
					TargetState: shared.StateReady,
					Reason:      "initialization complete (all variables initialized)",
				})
			}
		}
	default:
		return // Unknown signal type
	}

	// 2. Create action
	action := ReduceAction{
		PrevState: prevSnapshot,
		Signal:    sig,
		NextState: r.state.Snapshot(),
	}

	// Log the reduce action
	if r.logger != nil {
		r.logger.LogReduce(action)
	}

	// 3. CommandEffect (synchronous)
	effectDef := commander.CommandEffect(action)
	if effectDef == nil {
		return // No effect to execute
	}

	// 4. ExecuteEffect (synchronous)
	resultSig := handler.ExecuteEffect(effectDef)
	if resultSig == nil {
		return // No further state transition needed
	}

	// 5. Inject result WatcherSig back into channel for recursive processing
	r.signals.SendWatcherSig(resultSig)
}

// processAvailableSignals drains signal channels respecting priority.
func (r *Reducer) processAvailableSignals(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			// Try to process one signal, highest priority first
			if !r.tryProcessNextSignal() {
				// No more signals to process
				return
			}
		}
	}
}

// tryProcessNextSignal attempts to process one signal following priority rules.
// Returns true if a signal was processed or skipped, false if no signals available.
// Signals are NEVER dropped - they are either processed or left in channel.
func (r *Reducer) tryProcessNextSignal() bool {
	currentState := r.state.GetManagerInnerState()

	// Priority 1: WatcherSig (highest)
	select {
	case sig := <-r.signals.WatcherSigChan:
		r.reduceWatcherSig(sig)
		return true
	default:
	}

	// Priority 2: UserSig
	// Check if current state can process UserSig
	if r.canProcessUserSig(currentState) {
		select {
		case sig := <-r.signals.UserSigChan:
			r.reduceUserSig(sig)
			return true
		default:
		}
	}
	// If cannot process, leave signal in channel (don't consume it)

	// Priority 3: VarSig (lowest)
	// Check if current state can process VarSig
	if r.canProcessVarSig(currentState) {
		select {
		case sig := <-r.signals.VarSigChan:
			r.reduceVarSig(sig)
			return true
		default:
		}
	}
	// If cannot process, leave signal in channel (don't consume it)

	// No signals available
	return false
}

// canProcessUserSig checks if current state can process UserSig.
func (r *Reducer) canProcessUserSig(state shared.ManagerInnerState) bool {
	return state == shared.StateReady
}

// canProcessVarSig checks if current state can process VarSig.
func (r *Reducer) canProcessVarSig(state shared.ManagerInnerState) bool {
	return state == shared.StateReady || state == shared.StateInitRun
}

// reduceVarSig handles VarSig according to transition rules.
// Only called when canProcessVarSig returns true.
// Logging is handled by reduceAndExecuteEffect.
func (r *Reducer) reduceVarSig(sig *VarSig) {
	currentState := r.state.GetManagerInnerState()

	switch currentState {
	case shared.StateReady:
		// Batch collect all VarSigs and update state
		updates := r.collectAllVarSigs(sig)
		r.state.VarState.BatchSet(updates)
		r.state.SetManagerInnerState(shared.StateRunning)

	case shared.StateInitRun:
		// During initialization, collect VarSigs to update state
		// This allows InitRun phase 2 to detect when all variables are initialized
		updates := r.collectAllVarSigs(sig)
		r.state.VarState.BatchSet(updates)
		// Don't change ManagerInnerState, just update VarState

	default:
		// Should never reach here due to canProcessVarSig check
		panic(fmt.Sprintf("reduceVarSig called in invalid state: %s", currentState))
	}
}

// collectAllVarSigs drains VarSigChan and returns all updates as a map.
func (r *Reducer) collectAllVarSigs(first *VarSig) map[string]any {
	updates := make(map[string]any)
	updates[first.TargetVarName] = first.NextState

	for {
		select {
		case sig := <-r.signals.VarSigChan:
			updates[sig.TargetVarName] = sig.NextState
		default:
			return updates
		}
	}
}

// reduceUserSig handles UserSig according to transition rules.
// Only called when canProcessUserSig returns true.
// Logging is handled by reduceAndExecuteEffect.
func (r *Reducer) reduceUserSig(sig *UserSig) {
	currentState := r.state.GetManagerInnerState()

	switch currentState {
	case shared.StateReady:
		r.state.UserState.SetMessage(sig.Message)
		r.state.SetManagerInnerState(shared.StateRunning)

	default:
		// Should never reach here due to canProcessUserSig check
		panic(fmt.Sprintf("reduceUserSig called in invalid state: %s", currentState))
	}
}

// reduceWatcherSig handles WatcherSig according to transition rules.
// Logging is handled by reduceAndExecuteEffect.
func (r *Reducer) reduceWatcherSig(sig *WatcherSig) {
	currentState := r.state.GetManagerInnerState()
	targetState := sig.TargetState

	// Ignore same-state transitions
	if currentState == targetState {
		return
	}

	// Validate transition
	if err := r.validateTransition(currentState, targetState); err != nil {
		// Log error but don't crash reducer
		fmt.Printf("Invalid transition: %v\n", err)
		return
	}

	// Special case: Crashed is terminal
	if currentState == shared.StateCrashed {
		return
	}

	// Special case: InitRun clears VarState
	if targetState == shared.StateInitRun {
		r.state.VarState.Clear()
	}

	// Perform transition
	r.state.SetManagerInnerState(targetState)
}

// validateTransition checks if a state transition is valid.
func (r *Reducer) validateTransition(from, to shared.ManagerInnerState) error {
	// Crashed is terminal
	if from == shared.StateCrashed {
		return fmt.Errorf("cannot transition from Crashed state")
	}

	// Some basic validation - full FSM rules would go here
	switch from {
	case shared.StateStopped:
		// From Stopped, only InitRun, Killed, Crashed, WaitRecover allowed
		if to != shared.StateInitRun && to != shared.StateKilled && to != shared.StateCrashed && to != shared.StateWaitRecover {
			return fmt.Errorf("invalid transition from Stopped to %s", to)
		}
	case shared.StateKilled:
		// From Killed, only Crashed or WaitRecover allowed
		if to != shared.StateCrashed && to != shared.StateWaitRecover {
			return fmt.Errorf("invalid transition from Killed to %s", to)
		}
	}

	return nil
}
