// Package hersh provides a reactive framework for Go with monitoring and control capabilities.
package hersh

import (
	"hersh/core"
)

// Re-export core types for convenience
type (
	WatcherState   = core.WatcherState
	SignalPriority = core.SignalPriority
	Signal         = core.Signal
	HershContext   = core.HershContext
	Message        = core.Message
	WatcherConfig  = core.WatcherConfig
	RecoveryPolicy = core.RecoveryPolicy

	// Error types
	ControlError           = core.ControlError
	StopError              = core.StopError
	KillError              = core.KillError
	CrashError             = core.CrashError
	VarNotInitializedError = core.VarNotInitializedError
)

// Re-export constants
const (
	StateReady       = core.StateReady
	StateRunning     = core.StateRunning
	StateInitRun     = core.StateInitRun
	StateStopped     = core.StateStopped
	StateKilled      = core.StateKilled
	StateCrashed     = core.StateCrashed
	StateWaitRecover = core.StateWaitRecover

	PriorityWatcher = core.PriorityWatcher
	PriorityUser    = core.PriorityUser
	PriorityVar     = core.PriorityVar
)

// Re-export functions
var (
	NewStopErr              = core.NewStopErr
	NewKillErr              = core.NewKillErr
	NewCrashErr             = core.NewCrashErr
	NewVarNotInitializedErr = core.NewVarNotInitializedErr
	DefaultRecoveryPolicy   = core.DefaultRecoveryPolicy
	DefaultWatcherConfig    = core.DefaultWatcherConfig
)
