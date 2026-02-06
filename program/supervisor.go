package program

import (
	"context"
	"errors"
	"sync"
)

var (
	// ErrEventQueueFull is returned when the event queue is full
	ErrEventQueueFull = errors.New("event queue full")

	// ErrProgramStopped is returned when sending event to stopped program
	ErrProgramStopped = errors.New("program stopped")
)

const (
	// DefaultEventQueueSize is the default buffer size for event queue
	DefaultEventQueueSize = 1000
)

// Program is a goroutine-based state machine that processes events sequentially
type Program struct {
	id         ProgramID
	state      ProgramState
	eventQueue chan Event
	handler    EffectHandler

	mu      sync.RWMutex
	stopped bool
}

// NewProgram creates a new Program instance
func NewProgram(id ProgramID, buildID BuildID, handler EffectHandler) *Program {
	return &Program{
		id:         id,
		state:      NewProgramState(id, buildID),
		eventQueue: make(chan Event, DefaultEventQueueSize),
		handler:    handler,
		stopped:    false,
	}
}

// Start runs the event loop goroutine
// This blocks until ctx is cancelled or the program is stopped
func (p *Program) Start(ctx context.Context) {
	defer func() {
		p.mu.Lock()
		p.stopped = true
		close(p.eventQueue)
		p.mu.Unlock()
	}()

	for {
		select {
		case event, ok := <-p.eventQueue:
			if !ok {
				// Event queue closed
				return
			}

			// Process event through reducer
			nextState, effects := Reduce(p.state, event)

			// Update state
			p.mu.Lock()
			p.state = nextState
			p.mu.Unlock()

			// Execute effects and enqueue result events
			for _, eff := range effects {
				// Check context before executing effect
				select {
				case <-ctx.Done():
					return
				default:
				}

				// Execute effect
				resultEvent := p.handler.Execute(ctx, eff)

				// Enqueue result event if not nil
				if resultEvent != nil {
					select {
					case p.eventQueue <- resultEvent:
						// Event enqueued successfully
					case <-ctx.Done():
						return
					}
				}
			}

		case <-ctx.Done():
			return
		}
	}
}

// SendEvent enqueues an event for processing
// Returns error if queue is full or program is stopped
func (p *Program) SendEvent(event Event) error {
	p.mu.RLock()
	if p.stopped {
		p.mu.RUnlock()
		return ErrProgramStopped
	}
	p.mu.RUnlock()

	select {
	case p.eventQueue <- event:
		return nil
	default:
		return ErrEventQueueFull
	}
}

// GetState returns the current state (thread-safe)
func (p *Program) GetState() ProgramState {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.state
}

// GetID returns the program ID
func (p *Program) GetID() ProgramID {
	return p.id
}

// IsStopped returns whether the program has stopped
func (p *Program) IsStopped() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.stopped
}
