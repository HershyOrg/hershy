package api

import (
	"time"

	"github.com/HershyOrg/hershy/program"
)

// CreateProgramRequest represents the request body for creating a program
type CreateProgramRequest struct {
	UserID     string            `json:"user_id"`
	Dockerfile string            `json:"dockerfile"`
	SrcFiles   map[string]string `json:"src_files"` // filename -> content
}

// CreateProgramResponse represents the response after creating a program
type CreateProgramResponse struct {
	ProgramID program.ProgramID `json:"program_id"`
	BuildID   program.BuildID   `json:"build_id"`
	State     string            `json:"state"`
	ProxyURL  string            `json:"proxy_url"`
	CreatedAt time.Time         `json:"created_at"`
}

// GetProgramResponse represents the response for getting program details
type GetProgramResponse struct {
	ProgramID   program.ProgramID `json:"program_id"`
	BuildID     program.BuildID   `json:"build_id"`
	UserID      string            `json:"user_id"`
	State       string            `json:"state"`
	ImageID     string            `json:"image_id,omitempty"`
	ContainerID string            `json:"container_id,omitempty"`
	ProxyURL    string            `json:"proxy_url"`
	ErrorMsg    string            `json:"error_msg,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// ListProgramsResponse represents the response for listing all programs
type ListProgramsResponse struct {
	Programs []GetProgramResponse `json:"programs"`
	Count    int                  `json:"count"`
}

// LifecycleResponse represents the response for lifecycle operations
type LifecycleResponse struct {
	ProgramID program.ProgramID `json:"program_id"`
	State     string            `json:"state"`
	Message   string            `json:"message"`
}

// SourceCodeResponse represents the response for getting program source code
type SourceCodeResponse struct {
	ProgramID   program.ProgramID `json:"program_id"`
	Files       map[string]string `json:"files"` // filename -> content
	RetrievedAt time.Time         `json:"retrieved_at"`
}

// WatcherWatchingResponse mirrors WatcherAPI /watcher/watching response.
type WatcherWatchingResponse struct {
	WatchedVars []string `json:"watchedVars"`
	Count       int      `json:"count"`
	Timestamp   string   `json:"timestamp"`
}

// WatcherVarStateResponse mirrors WatcherAPI /watcher/varState response.
type WatcherVarStateResponse struct {
	Variables map[string]interface{} `json:"variables"`
	Count     int                    `json:"count"`
	Timestamp string                 `json:"timestamp"`
}

// WatcherWatchingStateResponse returns watched variable names with current values.
type WatcherWatchingStateResponse struct {
	WatchedVars       []string               `json:"watchedVars"`
	Variables         map[string]interface{} `json:"variables"`
	WatchedCount      int                    `json:"watchedCount"`
	InitializedCount  int                    `json:"initializedCount"`
	NotInitialized    []string               `json:"notInitialized"`
	WatchingTimestamp string                 `json:"watchingTimestamp"`
	VarStateTimestamp string                 `json:"varStateTimestamp"`
	Timestamp         string                 `json:"timestamp"`
}

// WatcherSingleVarStateResponse returns the state of a single watched variable.
type WatcherSingleVarStateResponse struct {
	Name              string      `json:"name"`
	Value             interface{} `json:"value,omitempty"`
	Watched           bool        `json:"watched"`
	Initialized       bool        `json:"initialized"`
	WatchingTimestamp string      `json:"watchingTimestamp"`
	VarStateTimestamp string      `json:"varStateTimestamp"`
	Timestamp         string      `json:"timestamp"`
}

// WatcherEndpointDescriptor describes active watcher query endpoints for a program.
type WatcherEndpointDescriptor struct {
	ProgramID                program.ProgramID `json:"program_id"`
	ProgramState             string            `json:"program_state"`
	ProxyBase                string            `json:"proxy_base"`
	WatchingStateEndpoint    string            `json:"watching_state_endpoint"`
	VarStateEndpointTemplate string            `json:"var_state_endpoint_template"`
	VarStateEndpoints        map[string]string `json:"var_state_endpoints"`
	WatchedVars              []string          `json:"watched_vars"`
	WatchedCount             int               `json:"watched_count"`
	WatcherTimestamp         string            `json:"watcher_timestamp"`
	CatalogUpdatedAt         string            `json:"catalog_updated_at"`
}

// WatcherEndpointCatalogResponse aggregates active watcher endpoint descriptors.
type WatcherEndpointCatalogResponse struct {
	Endpoints []WatcherEndpointDescriptor `json:"endpoints"`
	Count     int                         `json:"count"`
	Timestamp string                      `json:"timestamp"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}
