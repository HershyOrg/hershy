package builder

import (
	"context"
	"fmt"
	"time"
)

// MockBuilder is a mock implementation of the Builder interface for testing.
// It simulates image building without actually building Docker images.
type MockBuilder struct {
	// BuildDelay simulates build time.
	BuildDelay time.Duration

	// ShouldFail can be set to true to simulate build failures.
	ShouldFail bool

	// BuiltImages tracks images that have been built.
	BuiltImages map[ImageID]BuildSpec
}

// NewMockBuilder creates a new MockBuilder.
func NewMockBuilder() *MockBuilder {
	return &MockBuilder{
		BuildDelay:  100 * time.Millisecond,
		BuiltImages: make(map[ImageID]BuildSpec),
	}
}

// Build simulates building a container image.
func (m *MockBuilder) Build(ctx context.Context, spec BuildSpec) (ImageID, error) {
	if m.ShouldFail {
		return "", &BuildError{
			Phase:   "build",
			Message: "mock build failure",
		}
	}

	// Simulate build time
	select {
	case <-time.After(m.BuildDelay):
	case <-ctx.Done():
		return "", ctx.Err()
	}

	// Generate mock image ID
	imageID := ImageID(fmt.Sprintf("mock-image-%s-%d", spec.ImageName, time.Now().Unix()))

	// Store built image
	m.BuiltImages[imageID] = spec

	return imageID, nil
}

// Remove simulates removing an image.
func (m *MockBuilder) Remove(ctx context.Context, imageID ImageID) error {
	if m.ShouldFail {
		return &BuildError{
			Phase:   "remove",
			Message: "mock remove failure",
		}
	}

	if _, exists := m.BuiltImages[imageID]; !exists {
		return &BuildError{
			Phase:   "remove",
			Message: "image not found",
		}
	}

	delete(m.BuiltImages, imageID)
	return nil
}

// GetBuiltImage returns the BuildSpec for a built image (test helper).
func (m *MockBuilder) GetBuiltImage(imageID ImageID) (BuildSpec, bool) {
	spec, ok := m.BuiltImages[imageID]
	return spec, ok
}
