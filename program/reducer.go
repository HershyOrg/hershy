package program

// Reduce is a pure function that handles state transitions
// Given current state and an event, it returns next state and effects to execute
func Reduce(state ProgramState, event Event) (ProgramState, []Effect) {
	switch state.State {
	case StateCreated:
		return reduceCreated(state, event)
	case StateBuilding:
		return reduceBuilding(state, event)
	case StateStarting:
		return reduceStarting(state, event)
	case StateReady:
		return reduceReady(state, event)
	case StateStopping:
		return reduceStopping(state, event)
	case StateStopped:
		return reduceStopped(state, event)
	case StateError:
		return reduceError(state, event)
	default:
		// Unknown state, stay in current state
		return state, nil
	}
}

func reduceCreated(state ProgramState, event Event) (ProgramState, []Effect) {
	switch evt := event.(type) {
	case UserStartRequested:
		// Transition to Building, request folder creation and build
		nextState := state
		nextState.State = StateBuilding
		nextState.PublishPort = evt.PublishPort // Set publish port from Host

		effects := []Effect{
			EnsureProgramFolders{ProgramID: state.ID},
			BuildRuntime{
				ProgramID:  state.ID,
				BuildID:    state.BuildID,
				SrcPath:    "", // Will be set by effect handler
				Dockerfile: "", // Will be set by effect handler
			},
		}

		return nextState, effects
	}

	// Invalid event for this state, stay in Created
	return state, nil
}

func reduceBuilding(state ProgramState, event Event) (ProgramState, []Effect) {
	switch evt := event.(type) {
	case FoldersEnsured:
		if !evt.Success {
			// Folder creation failed, transition to Error
			nextState := state
			nextState.State = StateError
			nextState.ErrorMsg = "Failed to ensure program folders: " + evt.Error
			return nextState, nil
		}
		// Folders ensured successfully, stay in Building (waiting for BuildFinished)
		return state, nil

	case BuildFinished:
		if evt.Success {
			// Build succeeded, transition to Starting
			nextState := state
			nextState.State = StateStarting
			nextState.ImageID = evt.ImageID

			effects := []Effect{
				StartRuntime{
					ProgramID:   state.ID,
					ImageID:     evt.ImageID,
					StatePath:   "", // Will be set by effect handler
					PublishPort: state.PublishPort,
				},
			}

			return nextState, effects
		} else {
			// Build failed, transition to Error
			nextState := state
			nextState.State = StateError
			nextState.ErrorMsg = "Build failed: " + evt.Error
			return nextState, nil
		}

	case UserStopRequested:
		// User requested stop during build, transition to Stopped
		nextState := state
		nextState.State = StateStopped
		return nextState, nil
	}

	return state, nil
}

func reduceStarting(state ProgramState, event Event) (ProgramState, []Effect) {
	switch evt := event.(type) {
	case RuntimeStarted:
		// Container started successfully, transition to Ready
		nextState := state
		nextState.State = StateReady
		nextState.ContainerID = evt.ContainerID
		return nextState, nil

	case StartFailed:
		// Container start failed, transition to Error
		nextState := state
		nextState.State = StateError
		nextState.ErrorMsg = "Runtime start failed: " + evt.Reason
		return nextState, nil

	case UserStopRequested:
		// User requested stop during startup, transition to Stopped
		nextState := state
		nextState.State = StateStopped
		return nextState, nil
	}

	return state, nil
}

func reduceReady(state ProgramState, event Event) (ProgramState, []Effect) {
	switch event.(type) {
	case UserStopRequested:
		// User requested stop, transition to Stopping
		nextState := state
		nextState.State = StateStopping

		effects := []Effect{
			StopRuntime{ContainerID: state.ContainerID},
		}

		return nextState, effects

	case UserRestartRequested:
		// User requested restart, stop then restart
		nextState := state
		nextState.State = StateStopping

		effects := []Effect{
			StopRuntime{ContainerID: state.ContainerID},
		}

		return nextState, effects

	case RuntimeExited:
		// Container exited unexpectedly, transition to Error
		nextState := state
		nextState.State = StateError
		nextState.ErrorMsg = "Runtime exited unexpectedly"
		return nextState, nil
	}

	return state, nil
}

func reduceStopping(state ProgramState, event Event) (ProgramState, []Effect) {
	switch evt := event.(type) {
	case StopFinished:
		if evt.Success {
			// Stop succeeded, transition to Stopped
			nextState := state
			nextState.State = StateStopped
			return nextState, nil
		} else {
			// Stop failed, transition to Error
			nextState := state
			nextState.State = StateError
			nextState.ErrorMsg = "Stop failed: " + evt.Error
			return nextState, nil
		}
	}

	return state, nil
}

func reduceStopped(state ProgramState, event Event) (ProgramState, []Effect) {
	switch event.(type) {
	case UserStartRequested:
		// User requested restart from stopped state
		// Transition back to Building (rebuild required)
		nextState := state
		nextState.State = StateBuilding
		nextState.ErrorMsg = "" // Clear any previous error

		effects := []Effect{
			EnsureProgramFolders{ProgramID: state.ID},
			BuildRuntime{
				ProgramID:  state.ID,
				BuildID:    state.BuildID,
				SrcPath:    "",
				Dockerfile: "",
			},
		}

		return nextState, effects
	}

	return state, nil
}

func reduceError(state ProgramState, event Event) (ProgramState, []Effect) {
	switch event.(type) {
	case UserStartRequested:
		// Allow retry from error state
		// Transition to Building
		nextState := state
		nextState.State = StateBuilding
		nextState.ErrorMsg = ""

		effects := []Effect{
			EnsureProgramFolders{ProgramID: state.ID},
			BuildRuntime{
				ProgramID:  state.ID,
				BuildID:    state.BuildID,
				SrcPath:    "",
				Dockerfile: "",
			},
		}

		return nextState, effects
	}

	return state, nil
}
