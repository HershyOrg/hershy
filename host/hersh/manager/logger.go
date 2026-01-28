package manager

import (
	"fmt"
	"sync"
	"time"
)

// Logger implements both ReduceLogger and EffectLogger interfaces.
type Logger struct {
	mu             sync.RWMutex
	reduceLog      []ReduceLogEntry
	effectLog      []EffectLogEntry
	effectResults  []*EffectResult
	errorLog       []ErrorLogEntry
	maxEntries     int
}

// ReduceLogEntry represents a single reduce log entry.
type ReduceLogEntry struct {
	LogID     uint64
	Timestamp time.Time
	Action    ReduceAction
}

// EffectLogEntry represents a user log message from effect execution.
type EffectLogEntry struct {
	LogID     uint64
	Timestamp time.Time
	Message   string
}

// ErrorLogEntry represents an error that occurred in the Watcher.
type ErrorLogEntry struct {
	LogID     uint64
	Timestamp time.Time
	Error     error
	Context   string
}

// NewLogger creates a new Logger with specified max entries per log type.
func NewLogger(maxEntries int) *Logger {
	return &Logger{
		reduceLog:     make([]ReduceLogEntry, 0, maxEntries),
		effectLog:     make([]EffectLogEntry, 0, maxEntries),
		effectResults: make([]*EffectResult, 0, maxEntries),
		errorLog:      make([]ErrorLogEntry, 0, maxEntries),
		maxEntries:    maxEntries,
	}
}

// LogReduce logs a reduce action (implements ReduceLogger).
func (l *Logger) LogReduce(action ReduceAction) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := ReduceLogEntry{
		LogID:     uint64(len(l.reduceLog)) + 1,
		Timestamp: time.Now(),
		Action:    action,
	}

	l.reduceLog = append(l.reduceLog, entry)
	if len(l.reduceLog) > l.maxEntries {
		l.reduceLog = l.reduceLog[1:]
	}
}

// LogEffect logs a user message from effect execution (implements EffectLogger).
func (l *Logger) LogEffect(msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := EffectLogEntry{
		LogID:     uint64(len(l.effectLog)) + 1,
		Timestamp: time.Now(),
		Message:   msg,
	}

	l.effectLog = append(l.effectLog, entry)
	if len(l.effectLog) > l.maxEntries {
		l.effectLog = l.effectLog[1:]
	}
}

// LogEffectResult logs an effect execution result (implements EffectLogger).
func (l *Logger) LogEffectResult(result *EffectResult) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.effectResults = append(l.effectResults, result)
	if len(l.effectResults) > l.maxEntries {
		l.effectResults = l.effectResults[1:]
	}
}

// GetRecentResults returns the N most recent effect results (implements EffectLogger).
func (l *Logger) GetRecentResults(count int) []*EffectResult {
	l.mu.RLock()
	defer l.mu.RUnlock()

	if count > len(l.effectResults) {
		count = len(l.effectResults)
	}

	results := make([]*EffectResult, count)
	start := len(l.effectResults) - count
	copy(results, l.effectResults[start:])

	return results
}

// LogError logs an error with context.
func (l *Logger) LogError(err error, context string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := ErrorLogEntry{
		LogID:     uint64(len(l.errorLog)) + 1,
		Timestamp: time.Now(),
		Error:     err,
		Context:   context,
	}

	l.errorLog = append(l.errorLog, entry)
	if len(l.errorLog) > l.maxEntries {
		l.errorLog = l.errorLog[1:]
	}
}

// GetReduceLog returns a copy of the reduce log.
func (l *Logger) GetReduceLog() []ReduceLogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	logCopy := make([]ReduceLogEntry, len(l.reduceLog))
	copy(logCopy, l.reduceLog)
	return logCopy
}

// GetEffectLog returns a copy of the effect log.
func (l *Logger) GetEffectLog() []EffectLogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	logCopy := make([]EffectLogEntry, len(l.effectLog))
	copy(logCopy, l.effectLog)
	return logCopy
}

// GetErrorLog returns a copy of the error log.
func (l *Logger) GetErrorLog() []ErrorLogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	logCopy := make([]ErrorLogEntry, len(l.errorLog))
	copy(logCopy, l.errorLog)
	return logCopy
}

// PrintSummary prints a summary of all logs.
func (l *Logger) PrintSummary() {
	l.mu.RLock()
	defer l.mu.RUnlock()

	fmt.Printf("\n=== Logger Summary ===\n")
	fmt.Printf("Reduce Log Entries: %d\n", len(l.reduceLog))
	fmt.Printf("Effect Log Entries: %d\n", len(l.effectLog))
	fmt.Printf("Effect Results: %d\n", len(l.effectResults))
	fmt.Printf("Error Log Entries: %d\n", len(l.errorLog))

	if len(l.errorLog) > 0 {
		fmt.Printf("\nRecent Errors:\n")
		start := len(l.errorLog) - 5
		if start < 0 {
			start = 0
		}
		for _, entry := range l.errorLog[start:] {
			fmt.Printf("  [%s] %s: %v\n", entry.Timestamp.Format(time.RFC3339), entry.Context, entry.Error)
		}
	}
}
