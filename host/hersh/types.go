// Package hersh provides a reactive framework for Go with monitoring and control capabilities.
package hersh

import (
	"hersh/shared"
)

// Re-export core types for convenience
type (
	ManagerInnerState = shared.ManagerInnerState
	SignalPriority    = shared.SignalPriority
	Signal            = shared.Signal
	HershContext      = shared.HershContext
	Message           = shared.Message
	WatcherConfig     = shared.WatcherConfig
	RecoveryPolicy    = shared.RecoveryPolicy

	// Error types
	ControlError           = shared.ControlError
	StopError              = shared.StopError
	KillError              = shared.KillError
	CrashError             = shared.CrashError
	VarNotInitializedError = shared.VarNotInitializedError
)

// Re-export constants
const (
	StateReady       = shared.StateReady
	StateRunning     = shared.StateRunning
	StateInitRun     = shared.StateInitRun
	StateStopped     = shared.StateStopped
	StateKilled      = shared.StateKilled
	StateCrashed     = shared.StateCrashed
	StateWaitRecover = shared.StateWaitRecover

	PriorityManagerInner = shared.PriorityManagerInner
	PriorityUser         = shared.PriorityUser
	PriorityVar          = shared.PriorityVar
)

// Re-export functions
var (
	NewStopErr              = shared.NewStopErr
	NewKillErr              = shared.NewKillErr
	NewCrashErr             = shared.NewCrashErr
	NewVarNotInitializedErr = shared.NewVarNotInitializedErr
	DefaultRecoveryPolicy   = shared.DefaultRecoveryPolicy
	DefaultWatcherConfig    = shared.DefaultWatcherConfig
)
