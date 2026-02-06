package api

import (
	"time"

	"github.com/rlaaudgjs5638/hersh/program"
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

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}
