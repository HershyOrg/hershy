package manager

import (
	"context"
	"fmt"

	"hersh/core"
)

// ReduceAction represents a state transition that occurred.
type ReduceAction struct {
	PrevState StateSnapshot
	Signal    core.Signal
	NextState StateSnapshot
}

// Reducer manages state transitions based on signals.
// It implements priority-based signal processing.
type Reducer struct {
	state    *ManagerState
	signals  *SignalChannels
	actionCh chan ReduceAction // Actions sent to EffectCommander
	logger   ReduceLogger
}

// ReduceLogger handles logging of state transitions.
type ReduceLogger interface {
	LogReduce(action ReduceAction)
}

// NewReducer creates a new Reducer.
func NewReducer(state *ManagerState, signals *SignalChannels, logger ReduceLogger) *Reducer {
	return &Reducer{
		state:    state,
		signals:  signals,
		actionCh: make(chan ReduceAction, 100),
		logger:   logger,
	}
}

// ActionChannel returns the channel that emits ReduceActions.
func (r *Reducer) ActionChannel() <-chan ReduceAction {
	return r.actionCh
}

// Run starts the reducer loop. It processes signals with priority ordering.
// Priority: WatcherSig > UserSig > VarSig
func (r *Reducer) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-r.signals.NewSigAppended:
			// Process all available signals respecting priority
			r.processAvailableSignals(ctx)
		}
	}
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
// Returns true if a signal was processed, false if no signals available.
func (r *Reducer) tryProcessNextSignal() bool {
	// Priority 1: WatcherSig (highest)
	select {
	case sig := <-r.signals.WatcherSigChan:
		r.reduceWatcherSig(sig)
		return true
	default:
	}

	// Priority 2: UserSig
	select {
	case sig := <-r.signals.UserSigChan:
		r.reduceUserSig(sig)
		return true
	default:
	}

	// Priority 3: VarSig (lowest)
	select {
	case sig := <-r.signals.VarSigChan:
		r.reduceVarSig(sig)
		return true
	default:
	}

	// No signals available
	return false
}

// reduceVarSig handles VarSig according to transition rules.
func (r *Reducer) reduceVarSig(sig *VarSig) {
	currentState := r.state.GetWatcherState()
	prevSnapshot := r.state.Snapshot()

	switch currentState {
	case core.StateReady:
		// Batch collect all VarSigs and update state
		updates := r.collectAllVarSigs(sig)
		r.state.VarState.BatchSet(updates)
		r.state.SetWatcherState(core.StateRunning)

		action := ReduceAction{
			PrevState: prevSnapshot,
			Signal:    sig,
			NextState: r.state.Snapshot(),
		}
		r.logAndEmitAction(action)

	case core.StateInitRun:
		// During initialization, collect VarSigs to update state
		// This allows InitRun phase 2 to detect when all variables are initialized
		updates := r.collectAllVarSigs(sig)
		r.state.VarState.BatchSet(updates)

		// Don't change WatcherState, just update VarState
		action := ReduceAction{
			PrevState: prevSnapshot,
			Signal:    sig,
			NextState: r.state.Snapshot(),
		}
		r.logAndEmitAction(action)

	case core.StateRunning, core.StateStopped, core.StateKilled, core.StateCrashed, core.StateWaitRecover:
		// Skip signal - don't consume it (put it back? No, just drop for now)
		// In real implementation, we might want to buffer these
		return
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
func (r *Reducer) reduceUserSig(sig *UserSig) {
	currentState := r.state.GetWatcherState()
	prevSnapshot := r.state.Snapshot()

	switch currentState {
	case core.StateReady:
		r.state.UserState.SetMessage(sig.Message)
		r.state.SetWatcherState(core.StateRunning)

		action := ReduceAction{
			PrevState: prevSnapshot,
			Signal:    sig,
			NextState: r.state.Snapshot(),
		}
		r.logAndEmitAction(action)

	case core.StateRunning, core.StateStopped, core.StateKilled, core.StateCrashed, core.StateInitRun, core.StateWaitRecover:
		// Skip signal
		return
	}
}

// reduceWatcherSig handles WatcherSig according to transition rules.
func (r *Reducer) reduceWatcherSig(sig *WatcherSig) {
	currentState := r.state.GetWatcherState()
	prevSnapshot := r.state.Snapshot()
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
	if currentState == core.StateCrashed {
		return
	}

	// Special case: InitRun clears VarState
	if targetState == core.StateInitRun {
		r.state.VarState.Clear()
	}

	// Perform transition
	r.state.SetWatcherState(targetState)

	action := ReduceAction{
		PrevState: prevSnapshot,
		Signal:    sig,
		NextState: r.state.Snapshot(),
	}
	r.logAndEmitAction(action)
}

// validateTransition checks if a state transition is valid.
func (r *Reducer) validateTransition(from, to core.WatcherState) error {
	// Crashed is terminal
	if from == core.StateCrashed {
		return fmt.Errorf("cannot transition from Crashed state")
	}

	// Some basic validation - full FSM rules would go here
	switch from {
	case core.StateStopped:
		// From Stopped, only InitRun, Killed, Crashed, WaitRecover allowed
		if to != core.StateInitRun && to != core.StateKilled && to != core.StateCrashed && to != core.StateWaitRecover {
			return fmt.Errorf("invalid transition from Stopped to %s", to)
		}
	case core.StateKilled:
		// From Killed, only Crashed or WaitRecover allowed
		if to != core.StateCrashed && to != core.StateWaitRecover {
			return fmt.Errorf("invalid transition from Killed to %s", to)
		}
	}

	return nil
}

// logAndEmitAction logs the action and sends it to the EffectCommander.
func (r *Reducer) logAndEmitAction(action ReduceAction) {
	if r.logger != nil {
		r.logger.LogReduce(action)
	}
	r.actionCh <- action
}
