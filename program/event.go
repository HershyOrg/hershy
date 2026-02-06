package program

// Event represents state transitions triggered by user actions or effect results
type Event interface {
	isEvent()
}

// User-triggered events

// UserStartRequested is sent when user requests to start a program
type UserStartRequested struct {
	ProgramID ProgramID
}

func (UserStartRequested) isEvent() {}

// UserStopRequested is sent when user requests to stop a program
type UserStopRequested struct {
	ProgramID ProgramID
}

func (UserStopRequested) isEvent() {}

// UserRestartRequested is sent when user requests to restart a program
type UserRestartRequested struct {
	ProgramID ProgramID
}

func (UserRestartRequested) isEvent() {}

// Host effect result events

// FoldersEnsured is the result of EnsureProgramFolders effect
type FoldersEnsured struct {
	Success bool
	Error   string
}

func (FoldersEnsured) isEvent() {}

// BuildFinished is the result of BuildRuntime effect
type BuildFinished struct {
	Success bool
	ImageID string // Set when Success == true
	Error   string // Set when Success == false
}

func (BuildFinished) isEvent() {}

// RuntimeStarted is the result of successful StartRuntime effect
type RuntimeStarted struct {
	ContainerID string
}

func (RuntimeStarted) isEvent() {}

// RuntimeExited is sent when container exits unexpectedly
type RuntimeExited struct {
	ExitCode int
}

func (RuntimeExited) isEvent() {}

// StartFailed is sent when StartRuntime effect fails
type StartFailed struct {
	Reason string
}

func (StartFailed) isEvent() {}

// StopFinished is the result of StopRuntime effect
type StopFinished struct {
	Success bool
	Error   string
}

func (StopFinished) isEvent() {}
