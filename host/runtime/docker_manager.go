package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/moby/go-archive"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/program"
)

// DockerManager handles Docker image building and container lifecycle
type DockerManager struct {
	cli *client.Client
}

// NewDockerManager creates a new DockerManager
func NewDockerManager() (*DockerManager, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}

	return &DockerManager{
		cli: cli,
	}, nil
}

// Close closes the Docker client connection
func (m *DockerManager) Close() error {
	return m.cli.Close()
}

// BuildOpts contains options for building a Docker image
type BuildOpts struct {
	BuildID      program.BuildID
	ContextPath  string // Path to build context (src directory)
	Dockerfile   string // Path to Dockerfile (relative to context or absolute)
	Tags         []string
	NoCache      bool
	PullParent   bool
	BuildLogPath string // Optional path to save build logs
}

// BuildResult contains the result of a Docker build
type BuildResult struct {
	ImageID string
	BuildID program.BuildID
}

// Build builds a Docker image from source
func (m *DockerManager) Build(ctx context.Context, opts BuildOpts) (*BuildResult, error) {
	// Create build context tar
	buildCtx, err := archive.TarWithOptions(opts.ContextPath, &archive.TarOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to create build context: %w", err)
	}
	defer buildCtx.Close()

	// Prepare build options
	buildOptions := client.ImageBuildOptions{
		Tags:       opts.Tags,
		Dockerfile: filepath.Base(opts.Dockerfile),
		NoCache:    opts.NoCache,
		PullParent: opts.PullParent,
		Remove:     true, // Remove intermediate containers
	}

	// Start build
	resp, err := m.cli.ImageBuild(ctx, buildCtx, buildOptions)
	if err != nil {
		return nil, fmt.Errorf("failed to build image: %w", err)
	}
	defer resp.Body.Close()

	// Parse build output to get image ID
	var imageID string
	var buildLogWriter io.Writer

	// Optional build log writer
	if opts.BuildLogPath != "" {
		logFile, err := os.Create(opts.BuildLogPath)
		if err != nil {
			return nil, fmt.Errorf("failed to create build log file: %w", err)
		}
		defer logFile.Close()
		buildLogWriter = io.MultiWriter(logFile, os.Stdout)
	} else {
		buildLogWriter = os.Stdout
	}

	// Read build output
	decoder := json.NewDecoder(resp.Body)
	for {
		var message struct {
			Stream string `json:"stream"`
			Error  string `json:"error"`
			Aux    struct {
				ID string `json:"ID"`
			} `json:"aux"`
		}

		if err := decoder.Decode(&message); err == io.EOF {
			break
		} else if err != nil {
			return nil, fmt.Errorf("failed to decode build output: %w", err)
		}

		// Write stream to log
		if message.Stream != "" {
			fmt.Fprint(buildLogWriter, message.Stream)
		}

		// Check for errors
		if message.Error != "" {
			return nil, fmt.Errorf("build error: %s", message.Error)
		}

		// Extract image ID from aux
		if message.Aux.ID != "" {
			imageID = message.Aux.ID
		}
	}

	if imageID == "" {
		return nil, fmt.Errorf("failed to extract image ID from build output")
	}

	return &BuildResult{
		ImageID: imageID,
		BuildID: opts.BuildID,
	}, nil
}

// StartOpts contains options for starting a container
type StartOpts struct {
	ProgramID program.ProgramID
	Spec      *compose.ComposeSpec
}

// StartResult contains the result of starting a container
type StartResult struct {
	ContainerID string
	ProgramID   program.ProgramID
}

// Start starts a container from a compose spec
func (m *DockerManager) Start(ctx context.Context, opts StartOpts) (*StartResult, error) {
	if opts.Spec == nil {
		return nil, fmt.Errorf("compose spec is required")
	}

	appService, ok := opts.Spec.Services["app"]
	if !ok {
		return nil, fmt.Errorf("app service not found in spec")
	}

	// Parse volumes
	var binds []string
	for _, vol := range appService.Volumes {
		binds = append(binds, vol)
	}

	// Parse environment variables
	var env []string
	for key, value := range appService.Environment {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}

	// Create container configuration
	config := &container.Config{
		Image: appService.Image,
		Env:   env,
	}

	// Create host configuration
	hostConfig := &container.HostConfig{
		Runtime:        appService.Runtime,
		Binds:          binds,
		ReadonlyRootfs: appService.ReadOnly,
		SecurityOpt:    appService.SecurityOpt,
		NetworkMode:    container.NetworkMode(appService.NetworkMode),
	}

	// Create container using new API
	createOpts := client.ContainerCreateOptions{
		Config:     config,
		HostConfig: hostConfig,
		Name:       appService.ContainerName,
	}

	resp, err := m.cli.ContainerCreate(ctx, createOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to create container: %w", err)
	}

	// Start container using new API
	startOpts := client.ContainerStartOptions{}
	_, err = m.cli.ContainerStart(ctx, resp.ID, startOpts)
	if err != nil {
		// Clean up container if start fails
		m.cli.ContainerRemove(ctx, resp.ID, client.ContainerRemoveOptions{Force: true})
		return nil, fmt.Errorf("failed to start container: %w", err)
	}

	return &StartResult{
		ContainerID: resp.ID,
		ProgramID:   opts.ProgramID,
	}, nil
}

// Stop stops and removes a container
func (m *DockerManager) Stop(ctx context.Context, containerID string) error {
	// Stop container with timeout
	timeout := 10 // seconds
	stopOpts := client.ContainerStopOptions{
		Timeout: &timeout,
	}

	_, err := m.cli.ContainerStop(ctx, containerID, stopOpts)
	if err != nil {
		// If container is not found or already stopped, continue to remove
		// We don't have IsErrNotFound in new API, so just log and continue
	}

	// Remove container
	_, err = m.cli.ContainerRemove(ctx, containerID, client.ContainerRemoveOptions{
		Force: true,
	})
	if err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}

	return nil
}

// GetContainerStatus returns the current status of a container
func (m *DockerManager) GetContainerStatus(ctx context.Context, containerID string) (string, error) {
	inspect, err := m.cli.ContainerInspect(ctx, containerID, client.ContainerInspectOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to inspect container: %w", err)
	}

	return string(inspect.Container.State.Status), nil
}

// GetContainerIP returns the IP address of a container
func (m *DockerManager) GetContainerIP(ctx context.Context, containerID string) (string, error) {
	inspect, err := m.cli.ContainerInspect(ctx, containerID, client.ContainerInspectOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to inspect container: %w", err)
	}

	// Try to get IP from networks
	if inspect.Container.NetworkSettings != nil {
		for _, network := range inspect.Container.NetworkSettings.Networks {
			if network.IPAddress.IsValid() && !network.IPAddress.IsUnspecified() {
				return network.IPAddress.String(), nil
			}
		}
	}

	return "", fmt.Errorf("container has no IP address")
}

// IsContainerRunning checks if a container is running
func (m *DockerManager) IsContainerRunning(ctx context.Context, containerID string) (bool, error) {
	status, err := m.GetContainerStatus(ctx, containerID)
	if err != nil {
		return false, err
	}

	return status == "running", nil
}

// GetLogs retrieves logs from a container
func (m *DockerManager) GetLogs(ctx context.Context, containerID string) (string, error) {
	options := client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: true,
		Tail:       "100", // Last 100 lines
	}

	reader, err := m.cli.ContainerLogs(ctx, containerID, options)
	if err != nil {
		return "", fmt.Errorf("failed to get container logs: %w", err)
	}
	defer reader.Close()

	// Read logs
	var buf bytes.Buffer
	_, err = io.Copy(&buf, reader)
	if err != nil {
		return "", fmt.Errorf("failed to read container logs: %w", err)
	}

	return buf.String(), nil
}
