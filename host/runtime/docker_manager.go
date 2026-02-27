package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"

	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/logger"
	"github.com/HershyOrg/hershy/program"
	nat "github.com/docker/go-connections/nat"
	"github.com/moby/go-archive"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

// DockerManager handles Docker image building and container lifecycle
type DockerManager struct {
	cli *client.Client
	logger *logger.Logger
}

// NewDockerManager creates a new DockerManager
func NewDockerManager() (*DockerManager, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}

	l := logger.New("DockerManager", io.Discard, "")
  l.ConsolePrint = false

	return &DockerManager{
		cli: cli,
		logger:l,
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

	// 로그 드라이버 (docker stdout을 파일로 저장)
	LogDriver string
	LogPath string
	FollowLogs bool
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

	// Parse port bindings (e.g., "127.0.0.1:19001:8080")
	portBindings := nat.PortMap{}
	exposedPorts := nat.PortSet{}

	for _, portMapping := range appService.Ports {
		// Use nat.ParsePortSpec to parse port mappings
		portSpecs, err := nat.ParsePortSpec(portMapping)
		if err != nil {
			continue // Invalid format, skip
		}

		for _, portSpec := range portSpecs {
			// Add to exposed ports
			exposedPorts[portSpec.Port] = struct{}{}

			// Add to port bindings
			portBindings[portSpec.Port] = []nat.PortBinding{portSpec.Binding}
		}
	}

	// Convert nat types to network types
	networkExposedPorts := network.PortSet{}
	for port := range exposedPorts {
		networkPort, err := network.ParsePort(string(port))
		if err != nil {
			fmt.Printf("DockerManagerError: %s\n", err.Error())
			continue // Skip invalid ports
		}
		networkExposedPorts[networkPort] = struct{}{}
	}

	networkPortBindings := network.PortMap{}
	for port, bindings := range portBindings {
		networkPort, err := network.ParsePort(string(port))
		if err != nil {
			continue // Skip invalid ports
		}

		networkBindings := make([]network.PortBinding, len(bindings))
		for i, binding := range bindings {
			// Parse HostIP to netip.Addr
			var hostIP netip.Addr
			if binding.HostIP != "" {
				parsedIP, err := netip.ParseAddr(binding.HostIP)
				if err == nil {
					hostIP = parsedIP
				}
			}

			networkBindings[i] = network.PortBinding{
				HostIP:   hostIP,
				HostPort: binding.HostPort,
			}
		}
		networkPortBindings[networkPort] = networkBindings
	}

	// Create container configuration
	config := &container.Config{
		Image:        appService.Image,
		Env:          env,
		ExposedPorts: networkExposedPorts,
	}

	// Create host configuration
	hostConfig := &container.HostConfig{
		Runtime:        appService.Runtime,
		Binds:          binds,
		ReadonlyRootfs: appService.ReadOnly,
		SecurityOpt:    appService.SecurityOpt,
		NetworkMode:    container.NetworkMode(appService.NetworkMode),
		PortBindings:   networkPortBindings,
	}
	// Configure Docker log driver 
	hostConfig.LogConfig = container.LogConfig{
			Type: "json-file", // 명시적으로 json-file 지정
			Config: map[string]string{
					"max-size": "10m",
					"max-file": "3",
			},
	}

	// - create the logs directory and truncate/create the file 
	if opts.LogPath != "" {
        // opts.LogPath가 파일 경로인지 판단
        if filepath.Ext(opts.LogPath) != "" {
            // 파일 경로이면 해당 디렉터리만 생성하고 파일 생성/트렁케이트
            dir := filepath.Dir(opts.LogPath)
            if err := os.MkdirAll(dir, 0755); err != nil {
                fmt.Printf("DockerManager: failed to create log dir %s: %v\n", dir, err)
            } else {
                if f, err := os.Create(opts.LogPath); err != nil {
                    fmt.Printf("DockerManager: failed to create runtime log file %s: %v\n", opts.LogPath, err)
                } else {
                    f.Close()
                    // opts.LogPath는 이미 파일 경로이므로 변경하지 않음
                }
            }
        } else {
            // 디렉터리로 전달된 경우 기존 동작 유지
            logDir := filepath.Join(opts.LogPath, "programs", string(opts.ProgramID), "runtime")
            if err := os.MkdirAll(logDir, 0755); err != nil {
                fmt.Printf("DockerManager: failed to create log dir %s: %v\n", logDir, err)
            } else {
                p := filepath.Join(logDir, "runtime.log")
                if f, err := os.Create(p); err != nil {
                    fmt.Printf("DockerManager: failed to create runtime log file %s: %v\n", p, err)
                } else {
                    f.Close()
                    opts.LogPath = p
                }
            }
        }
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

	if opts.LogPath != ""{
		if !opts.FollowLogs {
        opts.FollowLogs = true
    }
		go func(containerID,path string){
			childLg := logger.New("DockerManager", io.Discard, path)
			childLg.ConsolePrint = false
			childLg.SetDefaultLogType("PROGRAM")

			defer childLg.Close()

      logOpts := client.ContainerLogsOptions{
        ShowStdout: true,
        ShowStderr: true,
        Follow:     opts.FollowLogs,
        Timestamps: true,
      }

		
			reader, err := m.cli.ContainerLogs(context.Background(), containerID, logOpts)
			if err != nil {
       	childLg.Emit(logger.LogEntry{
					Level:     "ERROR",
					Msg:       fmt.Sprintf("failed to stream logs: %v", err),
					Vars: map[string]interface{}{"container_id": containerID},
				})
        return
    	}
      defer reader.Close()

			stdoutR, stdoutW := io.Pipe()
			stderrR, stderrW := io.Pipe()

			writeJSON := func(level, stream, line string) {
				childLg.Emit(logger.LogEntry{
					Level:     level,
					Msg:       line,
					Vars: map[string]interface{}{
						"stream":       stream,
						"container_id": containerID,
					},
				})
			}
			// stdout scanner
      go func() {
        sc := bufio.NewScanner(stdoutR)
        for sc.Scan() {
          writeJSON("INFO", "stdout", sc.Text())
        }
        if err := sc.Err(); err != nil {
					writeJSON("ERROR", "stdout", fmt.Sprintf("stdout scanner error: %v", err))
        }
      }()
			// stderr scanner
      go func() {
        sc := bufio.NewScanner(stderrR)
        for sc.Scan() {
					writeJSON("INFO", "stderr", sc.Text())
        }
        if err := sc.Err(); err != nil {
					writeJSON("ERROR", "stderr", fmt.Sprintf("stderr scanner error: %v", err))
        }
    	}()

			// stdout, stderr 분리
			if _, err := demuxDockerStream(stdoutW, stderrW, reader); err != nil {
				childLg.Emit(logger.LogEntry{
					Level:     "ERROR",
					Msg:       fmt.Sprintf("error demuxing logs: %v", err),
					Vars: map[string]interface{}{"container_id": containerID, "stream": "demux"},
				})
			}
			stdoutW.Close()
      stderrW.Close()
		}(resp.ID,opts.LogPath)
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
	return m.GetContainerLogs(ctx, containerID, 100)
}

// GetContainerLogs retrieves logs from a container with custom tail lines
func (m *DockerManager) GetContainerLogs(ctx context.Context, containerID string, tailLines int) (string, error) {
	tail := fmt.Sprintf("%d", tailLines)
	options := client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: true,
		Tail:       tail,
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

func demuxDockerStream(stdout io.Writer, stderr io.Writer, src io.Reader) (int64, error) {
	var total int64
	header := make([]byte, 8)
	for {
		_, err := io.ReadFull(src, header)
		if err == io.EOF {
			return total, nil
		}
		if err != nil {
			return total, err
		}
		stream := header[0]
		size := binary.BigEndian.Uint32(header[4:])
		if size == 0 {
			continue
		}
		buf := make([]byte, int(size))
		_, err = io.ReadFull(src, buf)
		if err != nil {
			return total, err
		}
		var n int
		switch stream {
		case 1:
			n, _ = stdout.Write(buf)
		case 2:
			n, _ = stderr.Write(buf)
		default:
			n, _ = stdout.Write(buf)
		}
		total += int64(n)
	}
}