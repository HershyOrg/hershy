package program

// Effect represents side effects that must be executed by the Host
type Effect interface {
	isEffect()
}

// EnsureProgramFolders requests creation of program directory structure
type EnsureProgramFolders struct {
	ProgramID ProgramID
}

func (EnsureProgramFolders) isEffect() {}

// BuildRuntime requests building a Docker image from source
type BuildRuntime struct {
	ProgramID  ProgramID
	BuildID    BuildID
	SrcPath    string // Path to source directory
	Dockerfile string // Dockerfile content or path
}

func (BuildRuntime) isEffect() {}

// StartRuntime requests starting a container from built image
type StartRuntime struct {
	ProgramID   ProgramID
	ImageID     string
	StatePath   string // Path to /state volume
	PublishPort int    // Localhost-only publish port (19001-29999)
}

func (StartRuntime) isEffect() {}

// StopRuntime requests stopping a running container
type StopRuntime struct {
	ContainerID string
}

func (StopRuntime) isEffect() {}

// // FetchRuntimeStatus requests current status of a container
// type FetchRuntimeStatus struct {
// 	ContainerID string
// }

// func (FetchRuntimeStatus) isEffect() {}
