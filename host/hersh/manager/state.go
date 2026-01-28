package manager

import (
	"sync"

	"hersh/core"
)

// VarState holds the state of all watched variables.
// map[varName]value
type VarState struct {
	mu     sync.RWMutex
	values map[string]any
}

// NewVarState creates a new VarState.
func NewVarState() *VarState {
	return &VarState{
		values: make(map[string]any),
	}
}

// Get retrieves a variable's value.
func (vs *VarState) Get(name string) (any, bool) {
	vs.mu.RLock()
	defer vs.mu.RUnlock()
	val, ok := vs.values[name]
	return val, ok
}

// Set updates a variable's value.
func (vs *VarState) Set(name string, value any) {
	vs.mu.Lock()
	defer vs.mu.Unlock()
	vs.values[name] = value
}

// BatchSet updates multiple variables atomically.
func (vs *VarState) BatchSet(updates map[string]any) {
	vs.mu.Lock()
	defer vs.mu.Unlock()
	for name, value := range updates {
		vs.values[name] = value
	}
}

// GetAll returns a snapshot of all variable values.
func (vs *VarState) GetAll() map[string]any {
	vs.mu.RLock()
	defer vs.mu.RUnlock()
	snapshot := make(map[string]any, len(vs.values))
	for k, v := range vs.values {
		snapshot[k] = v
	}
	return snapshot
}

// Clear removes all variables.
func (vs *VarState) Clear() {
	vs.mu.Lock()
	defer vs.mu.Unlock()
	vs.values = make(map[string]any)
}

// AllInitialized checks if all expected variables are initialized (non-nil).
func (vs *VarState) AllInitialized(expectedVars []string) bool {
	vs.mu.RLock()
	defer vs.mu.RUnlock()
	for _, varName := range expectedVars {
		if val, ok := vs.values[varName]; !ok || val == nil {
			return false
		}
	}
	return true
}

// UserState holds the current user message state.
type UserState struct {
	mu      sync.RWMutex
	message *core.Message
}

// NewUserState creates a new UserState.
func NewUserState() *UserState {
	return &UserState{}
}

// GetMessage retrieves the current message.
func (us *UserState) GetMessage() *core.Message {
	us.mu.RLock()
	defer us.mu.RUnlock()
	return us.message
}

// SetMessage updates the current message.
func (us *UserState) SetMessage(msg *core.Message) {
	us.mu.Lock()
	defer us.mu.Unlock()
	us.message = msg
}

// ConsumeMessage marks the message as consumed and returns it.
func (us *UserState) ConsumeMessage() *core.Message {
	us.mu.Lock()
	defer us.mu.Unlock()
	if us.message != nil {
		us.message.IsConsumed = true
		msg := us.message
		us.message = nil
		return msg
	}
	return nil
}

// ManagerState holds all state managed by the Manager.
type ManagerState struct {
	VarState     *VarState
	UserState    *UserState
	WatcherState core.WatcherState
	mu           sync.RWMutex
}

// NewManagerState creates a new ManagerState with initial WatcherState.
func NewManagerState(initialState core.WatcherState) *ManagerState {
	return &ManagerState{
		VarState:     NewVarState(),
		UserState:    NewUserState(),
		WatcherState: initialState,
	}
}

// GetWatcherState returns the current WatcherState.
func (ms *ManagerState) GetWatcherState() core.WatcherState {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	return ms.WatcherState
}

// SetWatcherState updates the WatcherState.
func (ms *ManagerState) SetWatcherState(state core.WatcherState) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.WatcherState = state
}

// Snapshot returns a complete state snapshot for logging.
type StateSnapshot struct {
	VarState     map[string]any
	UserMessage  *core.Message
	WatcherState core.WatcherState
}

// Snapshot creates a snapshot of all state.
func (ms *ManagerState) Snapshot() StateSnapshot {
	return StateSnapshot{
		VarState:     ms.VarState.GetAll(),
		UserMessage:  ms.UserState.GetMessage(),
		WatcherState: ms.GetWatcherState(),
	}
}
