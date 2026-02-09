package program

import "fmt"

// ProgramID uniquely identifies a program instance
// Format: "{userID}-{buildID}-{uuid}"
type ProgramID string

func (p ProgramID) String() string {
	return string(p)
}

// BuildID identifies a specific build configuration
// Format: "build-{sha256[:12]}"
type BuildID string

func (b BuildID) String() string {
	return string(b)
}

// UserID identifies the user who created the program
type UserID string

func (u UserID) String() string {
	return string(u)
}

// State represents the current state of a Program
type State int

const (
	StateCreated State = iota
	StateBuilding
	StateStarting
	StateReady
	StateStopping
	StateStopped
	StateError
) 

func (s State) String() string {
	switch s {
	case StateCreated:
		return "Created"
	case StateBuilding:
		return "Building"
	case StateStarting:
		return "Starting"
	case StateReady:
		return "Ready"
	case StateStopping:
		return "Stopping"
	case StateStopped:
		return "Stopped"
	case StateError:
		return "Error"
	default:
		return fmt.Sprintf("Unknown(%d)", s)
	}
}

// ProgramState holds the complete state of a Program
type ProgramState struct {
	ID          ProgramID
	State       State
	BuildID     BuildID
	ImageID     string // Set after successful build
	ContainerID string // Set after successful runtime start
	PublishPort int    // Localhost-only publish port (set by Host, 19001-29999)
	ErrorMsg    string // Set when State == StateError
}

// NewProgramState creates an initial ProgramState in Created state
func NewProgramState(id ProgramID, buildID BuildID) ProgramState {
	return ProgramState{
		ID:      id,
		State:   StateCreated,
		BuildID: buildID,
	}
}
