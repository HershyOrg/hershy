package manager

import (
	"context"
	"fmt"
	"time"

	"hersh/core"
)

// EffectDefinition defines the type of effect to execute.
type EffectDefinition interface {
	Type() EffectType
	String() string
}

// EffectType categorizes different effect types.
type EffectType uint8

const (
	EffectRunScript EffectType = iota
	EffectClearRunScript
	EffectInitRunScript
	EffectJustKill
	EffectJustCrash
	EffectRecover
)

func (et EffectType) String() string {
	switch et {
	case EffectRunScript:
		return "RunScript"
	case EffectClearRunScript:
		return "ClearRunScript"
	case EffectInitRunScript:
		return "InitRunScript"
	case EffectJustKill:
		return "JustKill"
	case EffectJustCrash:
		return "JustCrash"
	case EffectRecover:
		return "Recover"
	default:
		return "Unknown"
	}
}

// RunScriptEffect executes the managed function.
type RunScriptEffect struct{}

func (e *RunScriptEffect) Type() EffectType { return EffectRunScript }
func (e *RunScriptEffect) String() string   { return "RunScript" }

// ClearRunScriptEffect executes cleanup with hook information.
type ClearRunScriptEffect struct {
	HookState core.WatcherState // Which state triggered this cleanup
}

func (e *ClearRunScriptEffect) Type() EffectType { return EffectClearRunScript }
func (e *ClearRunScriptEffect) String() string {
	return fmt.Sprintf("ClearRunScript{hook=%s}", e.HookState)
}

// InitRunScriptEffect initializes and runs the managed function.
type InitRunScriptEffect struct{}

func (e *InitRunScriptEffect) Type() EffectType { return EffectInitRunScript }
func (e *InitRunScriptEffect) String() string   { return "InitRunScript" }

// JustKillEffect transitions to Killed without cleanup.
type JustKillEffect struct{}

func (e *JustKillEffect) Type() EffectType { return EffectJustKill }
func (e *JustKillEffect) String() string   { return "JustKill" }

// JustCrashEffect transitions to Crashed without cleanup.
type JustCrashEffect struct{}

func (e *JustCrashEffect) Type() EffectType { return EffectJustCrash }
func (e *JustCrashEffect) String() string   { return "JustCrash" }

// RecoverEffect attempts recovery or crashes.
type RecoverEffect struct{}

func (e *RecoverEffect) Type() EffectType { return EffectRecover }
func (e *RecoverEffect) String() string   { return "Recover" }

// EffectCommander monitors ReduceActions and commands effects.
type EffectCommander struct {
	actionCh <-chan ReduceAction
	effectCh chan EffectDefinition
}

// NewEffectCommander creates a new EffectCommander.
func NewEffectCommander(actionCh <-chan ReduceAction) *EffectCommander {
	return &EffectCommander{
		actionCh: actionCh,
		effectCh: make(chan EffectDefinition, 100),
	}
}

// EffectChannel returns the channel that emits EffectDefinitions.
func (ec *EffectCommander) EffectChannel() <-chan EffectDefinition {
	return ec.effectCh
}

// Run starts the effect commander loop.
func (ec *EffectCommander) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case action := <-ec.actionCh:
			ec.commandEffect(action)
		}
	}
}

// commandEffect determines which effect to trigger based on state transition.
func (ec *EffectCommander) commandEffect(action ReduceAction) {
	prevState := action.PrevState.WatcherState
	nextState := action.NextState.WatcherState

	// Ignore same-state transitions
	if prevState == nextState {
		return
	}

	effect := ec.determineEffect(prevState, nextState)
	if effect != nil {
		ec.effectCh <- effect
	}
}

// determineEffect implements the trigger rules from the design.
func (ec *EffectCommander) determineEffect(prevState, nextState core.WatcherState) EffectDefinition {
	switch prevState {
	case core.StateRunning:
		return ec.fromRunning(nextState)
	case core.StateReady:
		return ec.fromReady(nextState)
	case core.StateInitRun:
		return ec.fromInitRun(nextState)
	case core.StateStopped:
		return ec.fromStopped(nextState)
	case core.StateKilled:
		return ec.fromKilled(nextState)
	case core.StateCrashed:
		return nil // Terminal state, ignore
	case core.StateWaitRecover:
		return ec.fromWaitRecover(nextState)
	}
	return nil
}

func (ec *EffectCommander) fromRunning(nextState core.WatcherState) EffectDefinition {
	switch nextState {
	case core.StateRunning:
		return nil // Ignore
	case core.StateReady:
		return nil // Ignore (normal completion handled by EffectHandler)
	case core.StateInitRun:
		return &InitRunScriptEffect{}
	case core.StateStopped, core.StateKilled, core.StateCrashed:
		return &ClearRunScriptEffect{HookState: nextState}
	case core.StateWaitRecover:
		return &RecoverEffect{}
	}
	return nil
}

func (ec *EffectCommander) fromReady(nextState core.WatcherState) EffectDefinition {
	switch nextState {
	case core.StateReady:
		return nil
	case core.StateRunning:
		return &RunScriptEffect{}
	case core.StateInitRun:
		return &InitRunScriptEffect{}
	case core.StateKilled, core.StateStopped, core.StateCrashed:
		return &ClearRunScriptEffect{HookState: nextState}
	case core.StateWaitRecover:
		return &RecoverEffect{}
	}
	return nil
}

func (ec *EffectCommander) fromInitRun(nextState core.WatcherState) EffectDefinition {
	switch nextState {
	case core.StateInitRun:
		return nil
	case core.StateRunning:
		return &RunScriptEffect{}
	case core.StateReady:
		return nil // Normal completion
	case core.StateKilled, core.StateStopped, core.StateCrashed:
		return &ClearRunScriptEffect{HookState: nextState}
	case core.StateWaitRecover:
		return &RecoverEffect{}
	}
	return nil
}

func (ec *EffectCommander) fromStopped(nextState core.WatcherState) EffectDefinition {
	switch nextState {
	case core.StateStopped:
		return nil
	case core.StateInitRun:
		return &InitRunScriptEffect{}
	case core.StateKilled:
		return &JustKillEffect{}
	case core.StateCrashed:
		return &JustCrashEffect{}
	case core.StateReady, core.StateRunning:
		return nil // Invalid, ignore
	case core.StateWaitRecover:
		return &RecoverEffect{}
	}
	return nil
}

func (ec *EffectCommander) fromKilled(nextState core.WatcherState) EffectDefinition {
	switch nextState {
	case core.StateKilled:
		return nil
	case core.StateCrashed:
		return &JustCrashEffect{}
	case core.StateWaitRecover:
		return &RecoverEffect{}
	default:
		return nil // All other transitions ignored
	}
}

func (ec *EffectCommander) fromWaitRecover(nextState core.WatcherState) EffectDefinition {
	switch nextState {
	case core.StateWaitRecover:
		return &RecoverEffect{}
	case core.StateCrashed:
		return &ClearRunScriptEffect{HookState: core.StateCrashed}
	case core.StateInitRun:
		return &InitRunScriptEffect{}
	default:
		return &RecoverEffect{}
	}
}

// EffectResult represents the result of executing an effect.
type EffectResult struct {
	Effect    EffectDefinition
	Success   bool
	Error     error
	Timestamp time.Time
}

func (er *EffectResult) String() string {
	status := "Ok"
	if !er.Success {
		status = fmt.Sprintf("Err(%v)", er.Error)
	}
	return fmt.Sprintf("EffectResult{effect=%s, status=%s, time=%s}",
		er.Effect, status, er.Timestamp.Format(time.RFC3339))
}
