// Package manager implements the Manager component of the hersh framework.
// Manager handles state management through Reducer and Effect System.
package manager

import (
	"fmt"
	"time"

	"hersh/core"
)

// VarSig represents a change in a watched variable's state.
type VarSig struct {
	ComputedTime  time.Time
	TargetVarName string
	PrevState     any
	NextState     any
}

func (s *VarSig) Priority() core.SignalPriority {
	return core.PriorityVar
}

func (s *VarSig) CreatedAt() time.Time {
	return s.ComputedTime
}

func (s *VarSig) String() string {
	return fmt.Sprintf("VarSig{var=%s, prev=%v, next=%v, time=%s}",
		s.TargetVarName, s.PrevState, s.NextState, s.ComputedTime.Format(time.RFC3339))
}

// UserSig represents a change in the user message state.
type UserSig struct {
	ReceivedTime time.Time
	Message      *core.Message
}

func (s *UserSig) Priority() core.SignalPriority {
	return core.PriorityUser
}

func (s *UserSig) CreatedAt() time.Time {
	return s.ReceivedTime
}

func (s *UserSig) String() string {
	msgContent := ""
	if s.Message != nil {
		msgContent = s.Message.Content
	}
	return fmt.Sprintf("UserSig{msg=%s, time=%s}",
		msgContent, s.ReceivedTime.Format(time.RFC3339))
}

// WatcherSig represents a change in the Watcher's state.
type WatcherSig struct {
	SignalTime time.Time
	TargetState core.WatcherState
	Reason     string // Why this transition is happening
}

func (s *WatcherSig) Priority() core.SignalPriority {
	return core.PriorityWatcher
}

func (s *WatcherSig) CreatedAt() time.Time {
	return s.SignalTime
}

func (s *WatcherSig) String() string {
	return fmt.Sprintf("WatcherSig{target=%s, reason=%s, time=%s}",
		s.TargetState, s.Reason, s.SignalTime.Format(time.RFC3339))
}

// SignalChannels holds all signal channels for the Manager.
type SignalChannels struct {
	VarSigChan     chan *VarSig
	UserSigChan    chan *UserSig
	WatcherSigChan chan *WatcherSig
	NewSigAppended chan struct{} // Notifies when any signal is added
}

// NewSignalChannels creates a new SignalChannels with buffered channels.
func NewSignalChannels(bufferSize int) *SignalChannels {
	return &SignalChannels{
		VarSigChan:     make(chan *VarSig, bufferSize),
		UserSigChan:    make(chan *UserSig, bufferSize),
		WatcherSigChan: make(chan *WatcherSig, bufferSize),
		NewSigAppended: make(chan struct{}, bufferSize*3), // Can hold all possible signals
	}
}

// SendVarSig sends a VarSig and notifies of new signal.
func (sc *SignalChannels) SendVarSig(sig *VarSig) {
	sc.VarSigChan <- sig
	select {
	case sc.NewSigAppended <- struct{}{}:
	default:
		// Channel full, signal will still be processed
	}
}

// SendUserSig sends a UserSig and notifies of new signal.
func (sc *SignalChannels) SendUserSig(sig *UserSig) {
	sc.UserSigChan <- sig
	select {
	case sc.NewSigAppended <- struct{}{}:
	default:
	}
}

// SendWatcherSig sends a WatcherSig and notifies of new signal.
func (sc *SignalChannels) SendWatcherSig(sig *WatcherSig) {
	sc.WatcherSigChan <- sig
	select {
	case sc.NewSigAppended <- struct{}{}:
	default:
	}
}

// Close closes all signal channels.
func (sc *SignalChannels) Close() {
	close(sc.VarSigChan)
	close(sc.UserSigChan)
	close(sc.WatcherSigChan)
	close(sc.NewSigAppended)
}
