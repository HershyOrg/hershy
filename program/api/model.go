// Package api provides interfaces and models for the Program HTTP API server.
// The API exposes endpoints for managing the Program and proxying to the WatcherServer.
package api

import "net/http"

// Server is the interface for the Program HTTP API server.
type Server interface {
	// Start starts the API server on the specified port.
	Start(port int) error

	// Stop stops the API server gracefully.
	Stop() error

	// RegisterHandlers registers HTTP handlers with the provided ServeMux.
	RegisterHandlers(mux *http.ServeMux)
}

// Handler provides HTTP handlers for Program API endpoints.
type Handler interface {
	// HandleInfo returns information about the Program.
	// GET /info
	HandleInfo(w http.ResponseWriter, r *http.Request)

	// HandleStatus returns the current status of the Program.
	// GET /status
	HandleStatus(w http.ResponseWriter, r *http.Request)

	// HandleContainerHealth returns the health status of the container.
	// GET /container/health
	HandleContainerHealth(w http.ResponseWriter, r *http.Request)

	// HandleStop stops the Program.
	// POST /stop
	HandleStop(w http.ResponseWriter, r *http.Request)

	// HandleWatcherProxy proxies requests to the WatcherServer.
	// * /watcher/*
	HandleWatcherProxy(w http.ResponseWriter, r *http.Request)
}

// ProgramInfo contains metadata about the Program.
type ProgramInfo struct {
	// ID is the unique identifier of the Program.
	ID string `json:"id"`

	// Name is the name of the Program.
	Name string `json:"name"`

	// Version is the version of the Program.
	Version string `json:"version"`

	// State is the current state of the Program.
	State string `json:"state"`

	// Port is the port the Program API is listening on.
	Port int `json:"port"`

	// ContainerID is the ID of the running container.
	ContainerID string `json:"container_id,omitempty"`

	// ImageID is the ID of the container image.
	ImageID string `json:"image_id,omitempty"`
}

// ProgramStatus contains the current status of the Program.
type ProgramStatus struct {
	// State is the current state of the Program.
	State string `json:"state"`

	// ContainerState is the state of the container.
	ContainerState string `json:"container_state,omitempty"`

	// Healthy indicates whether the container is healthy.
	Healthy bool `json:"healthy"`

	// Uptime is the time the Program has been running in seconds.
	Uptime float64 `json:"uptime"`

	// WatcherStatus contains the status of the WatcherServer.
	WatcherStatus map[string]interface{} `json:"watcher_status,omitempty"`
}

// ContainerHealth contains the health status of the container.
type ContainerHealth struct {
	// Healthy indicates whether the container is healthy.
	Healthy bool `json:"healthy"`

	// Running indicates whether the container is running.
	Running bool `json:"running"`

	// Uptime is the time the container has been running in seconds.
	Uptime float64 `json:"uptime,omitempty"`

	// Error contains error information if the container is unhealthy.
	Error string `json:"error,omitempty"`
}

// StopResponse is the response for a stop request.
type StopResponse struct {
	// Status is the status of the stop operation.
	Status string `json:"status"`

	// Message provides additional information.
	Message string `json:"message,omitempty"`
}
