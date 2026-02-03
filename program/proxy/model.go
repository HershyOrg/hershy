// Package proxy provides interfaces and models for proxying requests to the WatcherServer
// running inside a container.
package proxy

import "net/http"

// Proxy is the interface for proxying HTTP requests to the container's WatcherServer.
// The WatcherServer runs on port 8080 inside the container.
type Proxy interface {
	// ProxyRequest forwards an HTTP request to the WatcherServer.
	ProxyRequest(w http.ResponseWriter, r *http.Request) error

	// GetStatus retrieves the current status from the WatcherServer.
	GetStatus() (WatcherStatus, error)

	// SendMessage sends a message to the WatcherServer.
	SendMessage(content string) error

	// GetLogs retrieves logs from the WatcherServer.
	GetLogs(opts LogOptions) ([]LogEntry, error)
}

// WatcherStatus represents the status of the WatcherServer.
type WatcherStatus struct {
	// State is the current state of the watcher.
	State string

	// IsRunning indicates whether the watcher is running.
	IsRunning bool

	// WatcherID is the unique identifier of the watcher.
	WatcherID string

	// Uptime is the time the watcher has been running in seconds.
	Uptime float64

	// LastUpdate is the timestamp of the last update.
	LastUpdate string
}

// LogOptions specifies options for retrieving WatcherServer logs.
type LogOptions struct {
	// Type is the type of logs to retrieve.
	// Examples: "effect", "reduce", "context", "watch_error", "state_transition"
	Type string

	// Limit is the maximum number of log entries to retrieve.
	Limit int
}

// LogEntry represents a single log entry from the WatcherServer.
type LogEntry struct {
	// Timestamp is when the log entry was created.
	Timestamp string

	// Type is the type of log entry.
	Type string

	// Message is the log message.
	Message string

	// Data contains additional structured data.
	Data map[string]interface{}
}

// ProxyError represents an error that occurred during proxying.
type ProxyError struct {
	// Operation indicates which operation failed.
	// Examples: "proxy_request", "get_status", "send_message", "get_logs"
	Operation string

	// StatusCode is the HTTP status code if applicable.
	StatusCode int

	// Message is a human-readable error message.
	Message string

	// Cause is the underlying error.
	Cause error
}

// Error implements the error interface.
func (e *ProxyError) Error() string {
	if e.Cause != nil {
		return e.Operation + ": " + e.Message + " (" + e.Cause.Error() + ")"
	}
	return e.Operation + ": " + e.Message
}

// Unwrap returns the underlying error.
func (e *ProxyError) Unwrap() error {
	return e.Cause
}
