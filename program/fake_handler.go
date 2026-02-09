package program

import (
	"context"
	"time"
)

// FakeEffectHandler is a test implementation of EffectHandler
// It simulates effect execution with configurable delays
type FakeEffectHandler struct {
	// Delay simulates effect execution time
	Delay time.Duration

	// FailBuild causes BuildRuntime to fail
	FailBuild bool

	// FailStart causes StartRuntime to fail
	FailStart bool

	// FailStop causes StopRuntime to fail
	FailStop bool

	// FailFolders causes EnsureProgramFolders to fail
	FailFolders bool
}

// NewFakeEffectHandler creates a FakeEffectHandler with default settings
func NewFakeEffectHandler() *FakeEffectHandler {
	return &FakeEffectHandler{
		Delay: 0,
	}
}

// Execute implements EffectHandler interface
func (h *FakeEffectHandler) Execute(ctx context.Context, eff Effect) Event {
	// Simulate execution delay
	if h.Delay > 0 {
		select {
		case <-time.After(h.Delay):
		case <-ctx.Done():
			return nil
		}
	}

	switch e := eff.(type) {
	case EnsureProgramFolders:
		if h.FailFolders {
			return FoldersEnsured{
				Success: false,
				Error:   "fake folder creation failure",
			}
		}
		return FoldersEnsured{Success: true}

	case BuildRuntime:
		if h.FailBuild {
			return BuildFinished{
				Success: false,
				Error:   "fake build failure",
			}
		}
		return BuildFinished{
			Success: true,
			ImageID: "fake-image-" + string(e.BuildID),
		}

	case StartRuntime:
		if h.FailStart {
			return StartFailed{
				Reason: "fake start failure",
			}
		}
		return RuntimeStarted{
			ContainerID: "fake-container-" + string(e.ProgramID),
		}

	case StopRuntime:
		if h.FailStop {
			return StopFinished{
				Success: false,
				Error:   "fake stop failure",
			}
		}
		return StopFinished{Success: true}

	// case FetchRuntimeStatus:
	// 	// Not implemented in fake handler
	// 	return nil

	default:
		return nil
	}
}
