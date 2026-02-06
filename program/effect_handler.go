package program

import "context"

// EffectHandler executes effects and returns result events
// Implementations must be safe for concurrent use
type EffectHandler interface {
	// Execute performs the effect and returns the resulting event
	// Returns nil if the effect produces no event (shouldn't happen in practice)
	Execute(ctx context.Context, eff Effect) Event
}
