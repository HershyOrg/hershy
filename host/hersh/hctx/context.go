// Package ctx provides HershContext implementation for the hersh framework.
package hctx

import (
	"context"
	"sync"

	"hersh/shared"
)

// Logger interface for context value logging.
type Logger interface {
	LogContextValue(key string, oldValue, newValue any, operation string)
}

// HershContext implements core.HershContext interface.
// This is a concrete implementation that manages execution context,
// messages, watcher reference, and user-defined values.
type HershContext struct {
	context.Context
	watcherID   string
	message     *shared.Message
	watcher     any // Watcher reference (stored as any to avoid circular dependency with hersh package)
	valueStore  map[string]any
	valuesMutex sync.RWMutex
	logger      Logger
}

// New creates a new HershContext with the given parameters.
func New(ctx context.Context, watcherID string, logger Logger) *HershContext {
	return &HershContext{
		Context:    ctx,
		watcherID:  watcherID,
		message:    nil,
		watcher:    nil,
		valueStore: make(map[string]any),
		logger:     logger,
	}
}

func (hc *HershContext) WatcherID() string {
	return hc.watcherID
}

func (hc *HershContext) Message() *shared.Message {
	return hc.message
}

func (hc *HershContext) GetValue(key string) any {
	hc.valuesMutex.RLock()
	defer hc.valuesMutex.RUnlock()
	return hc.valueStore[key]
}

func (hc *HershContext) SetValue(key string, value any) {
	hc.valuesMutex.Lock()
	defer hc.valuesMutex.Unlock()

	oldValue := hc.valueStore[key]
	hc.valueStore[key] = value

	// Log the state change
	if hc.logger != nil {
		hc.logger.LogContextValue(key, oldValue, value, "initialized")
		if oldValue != nil {
			hc.logger.LogContextValue(key, oldValue, value, "updated")
		}
	}
}

func (hc *HershContext) UpdateValue(key string, updateFn func(current any) any) any {
	hc.valuesMutex.Lock()
	defer hc.valuesMutex.Unlock()

	// Get current value
	currentValue := hc.valueStore[key]

	// Create a deep copy to pass to updateFn
	currentCopy := shared.DeepCopy(currentValue)

	// Call the update function with the copy
	newValue := updateFn(currentCopy)

	// Store the new value
	oldValue := hc.valueStore[key]
	hc.valueStore[key] = newValue

	// Log the state change
	if hc.logger != nil {
		if oldValue == nil {
			hc.logger.LogContextValue(key, nil, newValue, "initialized")
		} else {
			hc.logger.LogContextValue(key, oldValue, newValue, "updated")
		}
	}

	return newValue
}

// SetWatcher sets the watcher reference.
// This is called internally by the framework.
func (hc *HershContext) SetWatcher(watcher any) {
	hc.watcher = watcher
}

// GetWatcher returns the watcher reference as any.
// Use this from manager package which doesn't know about hersh.Watcher type.
func (hc *HershContext) GetWatcher() any {
	return hc.watcher
}

// SetMessage updates the current message.
// This is called internally by the framework during execution.
func (hc *HershContext) SetMessage(msg *shared.Message) {
	hc.message = msg
}

// UpdateContext replaces the underlying context.
// This is used by EffectHandler when creating execution contexts with timeouts.
func (hc *HershContext) UpdateContext(ctx context.Context) {
	hc.Context = ctx
}
