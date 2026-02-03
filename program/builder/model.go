// Package builder provides interfaces and models for building container images from Dockerfiles.
package builder

import "context"

// Builder is the interface for building container images from Dockerfiles.
// It abstracts the underlying build system (Docker, Buildah, Kaniko, etc.).
type Builder interface {
	// Build builds a container image from a Dockerfile.
	// Returns the ImageID of the built image.
	Build(ctx context.Context, spec BuildSpec) (ImageID, error)

	// Remove removes a built image from the system.
	Remove(ctx context.Context, imageID ImageID) error
}

// BuildSpec specifies the parameters for building a container image.
type BuildSpec struct {
	// DockerfilePath is the path to the Dockerfile (relative to ContextPath).
	DockerfilePath string

	// ContextPath is the build context directory path.
	ContextPath string

	// ImageName is the name to tag the built image.
	ImageName string

	// Tags are additional tags to apply to the image.
	Tags []string
}

// ImageID is a unique identifier for a built container image.
type ImageID string

// String returns the string representation of ImageID.
func (id ImageID) String() string {
	return string(id)
}

// BuildResult contains information about a successful build.
type BuildResult struct {
	// ImageID is the unique identifier of the built image.
	ImageID ImageID

	// ImageName is the name of the built image.
	ImageName string

	// BuildTime is the time taken to build the image in seconds.
	BuildTime float64

	// Size is the size of the built image in bytes.
	Size int64
}

// BuildError represents an error that occurred during the build process.
type BuildError struct {
	// Phase indicates which phase of the build failed.
	// Examples: "parse", "build", "tag", "push"
	Phase string

	// Message is a human-readable error message.
	Message string

	// Cause is the underlying error.
	Cause error
}

// Error implements the error interface.
func (e *BuildError) Error() string {
	if e.Cause != nil {
		return e.Phase + ": " + e.Message + " (" + e.Cause.Error() + ")"
	}
	return e.Phase + ": " + e.Message
}

// Unwrap returns the underlying error.
func (e *BuildError) Unwrap() error {
	return e.Cause
}
