// Package core contains shared types used across the hersh framework.
// This package breaks the import cycle between hersh and manager packages.
package core

import (
	"context"
	"time"
)

// WatcherState represents the state of a Watcher.
// States form a finite state machine with specific transition rules.
type WatcherState uint8

const (
	// StateReady indicates the Watcher is ready to execute on next signal
	StateReady WatcherState = iota
	// StateRunning indicates the Watcher is currently executing
	StateRunning
	// StateInitRun indicates the Watcher is initializing (first run)
	StateInitRun
	// StateStopped indicates the Watcher stopped normally and can be restarted
	StateStopped
	// StateKilled indicates the Watcher was killed and is permanently stopped
	StateKilled
	// StateCrashed indicates the Watcher crashed irrecoverably
	StateCrashed
	// StateWaitRecover indicates the Watcher is waiting for recovery decision
	StateWaitRecover
)

func (s WatcherState) String() string {
	switch s {
	case StateReady:
		return "Ready"
	case StateRunning:
		return "Running"
	case StateInitRun:
		return "InitRun"
	case StateStopped:
		return "Stopped"
	case StateKilled:
		return "Killed"
	case StateCrashed:
		return "Crashed"
	case StateWaitRecover:
		return "WaitRecover"
	default:
		return "Unknown"
	}
}

// SignalPriority defines the priority order for signal processing.
// Lower numeric values indicate higher priority.
type SignalPriority uint8

const (
	// PriorityWatcher is the highest priority (Watcher state control)
	PriorityWatcher SignalPriority = 0
	// PriorityUser is medium priority (user messages)
	PriorityUser SignalPriority = 1
	// PriorityVar is the lowest priority (watched variable changes)
	PriorityVar SignalPriority = 2
)

// Signal is the interface that all signal types must implement.
// Signals trigger state transitions in the Watcher.
type Signal interface {
	Priority() SignalPriority
	CreatedAt() time.Time
	String() string
}

// Message represents a user-sent message to a managed function.
type Message struct {
	Content    string
	IsConsumed bool
	ReceivedAt time.Time
}

// String returns the message content.
func (m *Message) String() string {
	if m == nil {
		return ""
	}
	return m.Content
}

// HershContext provides runtime context for managed functions.
// It includes cancellation, deadlines, and access to Watcher features.
type HershContext interface {
	context.Context

	// WatcherID returns the unique identifier of the current Watcher
	WatcherID() string

	// Message returns the current user message (nil if none)
	Message() *Message
}

// WatcherConfig holds configuration for creating a new Watcher.
type WatcherConfig struct {
	// ScheduleInfo contains scheduling information for the Watcher
	ScheduleInfo string

	// UserInfo contains user identification and metadata
	UserInfo string

	// ServerPort is the port number for the Watcher server
	ServerPort int

	// DefaultTimeout is the default timeout for managed function execution
	DefaultTimeout time.Duration

	// RecoveryPolicy defines how the Watcher handles failures
	RecoveryPolicy RecoveryPolicy
}

// RecoveryPolicy defines fault tolerance behavior.
type RecoveryPolicy struct {
	// MaxConsecutiveFailures before crashing (default: 6)
	MaxConsecutiveFailures int

	// BaseRetryDelay is the initial delay before retry (exponential backoff)
	BaseRetryDelay time.Duration

	// MaxRetryDelay caps the maximum retry delay
	MaxRetryDelay time.Duration
}

// DefaultRecoveryPolicy returns sensible defaults.
func DefaultRecoveryPolicy() RecoveryPolicy {
	return RecoveryPolicy{
		MaxConsecutiveFailures: 6,
		BaseRetryDelay:         1 * time.Second,
		MaxRetryDelay:          5 * time.Minute,
	}
}

// DefaultWatcherConfig returns default configuration.
func DefaultWatcherConfig() WatcherConfig {
	return WatcherConfig{
		ServerPort:     8080,
		DefaultTimeout: 1 * time.Minute,
		RecoveryPolicy: DefaultRecoveryPolicy(),
	}
}
