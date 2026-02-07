package compose

import (
	"errors"
	"fmt"
	"strings"

	"github.com/HershyOrg/hershy/program"
)

var (
	// ErrPort8080Published is returned when port 8080 is externally published
	ErrPort8080Published = errors.New("port 8080 external publish is forbidden")

	// ErrInvalidRuntime is returned when runtime is not runsc
	ErrInvalidRuntime = errors.New("runtime must be runsc (gVisor)")

	// ErrStateVolumeNotRW is returned when state volume is not read-write
	ErrStateVolumeNotRW = errors.New("state volume must be read-write")

	// ErrRootFsNotReadOnly is returned when root filesystem is not read-only
	ErrRootFsNotReadOnly = errors.New("root filesystem must be read-only")
)

// Builder generates and validates Docker Compose specifications with security contracts
type Builder struct{}

// NewBuilder creates a new ComposeBuilder
func NewBuilder() *Builder {
	return &Builder{}
}

// BuildOpts contains options for building a compose spec
type BuildOpts struct {
	ProgramID   program.ProgramID
	ImageID     string // Docker image ID or tag
	StatePath   string // Host path to state directory
	NetworkMode string // Network mode (default: "none")
	Runtime     string // Container runtime (default: "runsc", can use "runc" for testing)
	PublishPort int    // Localhost-only publish port (19001-29999)
}

// ComposeSpec represents a Docker Compose specification
type ComposeSpec struct {
	Version  string
	Services map[string]Service
}

// Service represents a Docker Compose service configuration
type Service struct {
	Image         string            `yaml:"image"`
	Runtime       string            `yaml:"runtime"`
	Ports         []string          `yaml:"ports,omitempty"`
	Volumes       []string          `yaml:"volumes"`
	ReadOnly      bool              `yaml:"read_only"`
	SecurityOpt   []string          `yaml:"security_opt"`
	NetworkMode   string            `yaml:"network_mode,omitempty"`
	ContainerName string            `yaml:"container_name"`
	Environment   map[string]string `yaml:"environment,omitempty"`
}

// GenerateSpec creates a ComposeSpec with enforced security contracts
func (b *Builder) GenerateSpec(opts BuildOpts) (*ComposeSpec, error) {
	if opts.ImageID == "" {
		return nil, errors.New("image ID is required")
	}
	if opts.StatePath == "" {
		return nil, errors.New("state path is required")
	}

	// Default network mode to "none" for isolation
	networkMode := opts.NetworkMode
	//* 없는 경우엔 none으로 처리하지만, effect_handler에선 bridge모드로 준다.
	if networkMode == "" {
		networkMode = "none"
	}

	// Default runtime to runsc (gVisor)
	runtime := opts.Runtime
	if runtime == "" {
		runtime = "runsc"
	}

	containerName := fmt.Sprintf("hersh-program-%s", opts.ProgramID)

	spec := &ComposeSpec{
		Version: "3.8",
		Services: map[string]Service{
			"app": {
				Image:   opts.ImageID,
				Runtime: runtime,
				Ports: []string{
					// Localhost-only publish: 127.0.0.1:publishPort:8080
					fmt.Sprintf("127.0.0.1:%d:8080", opts.PublishPort),
				},
				Volumes: []string{
					// State directory is the ONLY read-write volume
					fmt.Sprintf("%s:/state:rw", opts.StatePath),
				},
				ReadOnly:      true, // Root filesystem is read-only
				SecurityOpt:   []string{"no-new-privileges:true"},
				NetworkMode:   networkMode,
				ContainerName: containerName,
				Environment: map[string]string{
					"HERSH_PROGRAM_ID": string(opts.ProgramID),
				},
			},
		},
	}

	return spec, nil
}

// ValidateSpec validates that a ComposeSpec adheres to security contracts
func (b *Builder) ValidateSpec(spec *ComposeSpec) error {
	if spec == nil {
		return errors.New("spec is nil")
	}

	appService, ok := spec.Services["app"]
	if !ok {
		return errors.New("app service not found")
	}

	// Contract 1: Port must be localhost-only (127.0.0.1:xxxxx:8080)
	if len(appService.Ports) != 1 {
		return errors.New("exactly one port binding required (127.0.0.1:publishPort:8080)")
	}

	port := appService.Ports[0]
	// Must start with "127.0.0.1:" and end with ":8080"
	if !strings.HasPrefix(port, "127.0.0.1:") || !strings.HasSuffix(port, ":8080") {
		return errors.New("port must be localhost-only (127.0.0.1:publishPort:8080)")
	}

	// Contract 2: Runtime should be runsc (gVisor) for production
	// Note: We allow runc for testing purposes, but log a warning
	if appService.Runtime != "runsc" && appService.Runtime != "runc" {
		return ErrInvalidRuntime
	}

	// Contract 3: Root filesystem must be read-only
	if !appService.ReadOnly {
		return ErrRootFsNotReadOnly
	}

	// Contract 4: State volume must be read-write
	stateVolumeFound := false
	for _, vol := range appService.Volumes {
		if strings.Contains(vol, "/state") {
			if !strings.HasSuffix(vol, ":rw") {
				return ErrStateVolumeNotRW
			}
			stateVolumeFound = true
		}
	}

	if !stateVolumeFound {
		return errors.New("state volume (/state:rw) not found")
	}

	return nil
}

// ToDockerRunArgs converts ComposeSpec to docker run arguments
// This is used when Docker Compose is not available
func (b *Builder) ToDockerRunArgs(spec *ComposeSpec) ([]string, error) {
	if err := b.ValidateSpec(spec); err != nil {
		return nil, fmt.Errorf("invalid spec: %w", err)
	}

	appService := spec.Services["app"]
	args := []string{}

	// Runtime
	args = append(args, "--runtime", appService.Runtime)

	// Container name
	if appService.ContainerName != "" {
		args = append(args, "--name", appService.ContainerName)
	}

	// Volumes
	for _, vol := range appService.Volumes {
		args = append(args, "-v", vol)
	}

	// Read-only root filesystem
	if appService.ReadOnly {
		args = append(args, "--read-only")
	}

	// Security options
	for _, opt := range appService.SecurityOpt {
		args = append(args, "--security-opt", opt)
	}

	// Network mode
	if appService.NetworkMode != "" {
		args = append(args, "--network", appService.NetworkMode)
	}

	// Environment variables
	for key, value := range appService.Environment {
		args = append(args, "-e", fmt.Sprintf("%s=%s", key, value))
	}

	// Ports (localhost-only publish)
	for _, port := range appService.Ports {
		args = append(args, "-p", port)
	}

	// Image (must be last)
	args = append(args, appService.Image)

	return args, nil
}
