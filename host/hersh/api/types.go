// Package api provides HTTP API types and handlers for WatcherServer.
package api

import (
	"time"
)

// StatusResponse represents the response for GET /watcher/status
type StatusResponse struct {
	State      string    `json:"state"`
	IsRunning  bool      `json:"isRunning"`
	WatcherID  string    `json:"watcherID"`
	Uptime     string    `json:"uptime"`
	LastUpdate time.Time `json:"lastUpdate"`
}

// LogsResponse represents the response for GET /watcher/logs
type LogsResponse struct {
	EffectLogs     []interface{} `json:"effectLogs,omitempty"`
	ReduceLogs     []interface{} `json:"reduceLogs,omitempty"`
	WatchErrorLogs []interface{} `json:"watchErrorLogs,omitempty"`
	ContextLogs    []interface{} `json:"contextLogs,omitempty"`
	StateFaultLogs []interface{} `json:"stateFaultLogs,omitempty"`
}

// SignalsResponse represents the response for GET /watcher/signals
type SignalsResponse struct {
	VarSigCount     int       `json:"varSigCount"`
	UserSigCount    int       `json:"userSigCount"`
	WatcherSigCount int       `json:"watcherSigCount"`
	TotalPending    int       `json:"totalPending"`
	Timestamp       time.Time `json:"timestamp"`
}

// MessageRequest represents the request body for POST /watcher/message
type MessageRequest struct {
	Content string `json:"content"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}
