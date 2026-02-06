package compose

import (
	"strings"
	"testing"

	"github.com/HershyOrg/hershy/program"
)

func TestGenerateSpec_LocalhostPublish(t *testing.T) {
	builder := NewBuilder()

	opts := BuildOpts{
		ProgramID:   program.ProgramID("test-prog-1"),
		ImageID:     "test-image:latest",
		StatePath:   "/tmp/test-state",
		NetworkMode: "none",
		Runtime:     "runsc",
		PublishPort: 19001,
	}

	spec, err := builder.GenerateSpec(opts)
	if err != nil {
		t.Fatalf("Failed to generate spec: %v", err)
	}

	// Verify service exists
	appService, ok := spec.Services["app"]
	if !ok {
		t.Fatal("App service not found")
	}

	// Verify localhost-only port binding
	if len(appService.Ports) != 1 {
		t.Errorf("Expected 1 port binding, got %d", len(appService.Ports))
	}

	expectedPort := "127.0.0.1:19001:8080"
	if appService.Ports[0] != expectedPort {
		t.Errorf("Expected port %s, got %s", expectedPort, appService.Ports[0])
	}

	// Verify basic security contracts
	if !appService.ReadOnly {
		t.Error("Root filesystem should be read-only")
	}

	if appService.Runtime != "runsc" {
		t.Errorf("Expected runtime runsc, got %s", appService.Runtime)
	}

	// Verify state volume
	stateVolumeFound := false
	for _, vol := range appService.Volumes {
		if strings.Contains(vol, "/state") && strings.HasSuffix(vol, ":rw") {
			stateVolumeFound = true
			break
		}
	}
	if !stateVolumeFound {
		t.Error("State volume (/state:rw) not found")
	}
}

func TestValidateSpec_LocalhostOnly(t *testing.T) {
	builder := NewBuilder()

	tests := []struct {
		name    string
		ports   []string
		wantErr bool
		errMsg  string
	}{
		{
			name:    "valid localhost-only",
			ports:   []string{"127.0.0.1:19001:8080"},
			wantErr: false,
		},
		{
			name:    "valid localhost-only upper range",
			ports:   []string{"127.0.0.1:29999:8080"},
			wantErr: false,
		},
		{
			name:    "invalid - external publish",
			ports:   []string{"0.0.0.0:19001:8080"},
			wantErr: true,
			errMsg:  "must be localhost-only",
		},
		{
			name:    "invalid - no localhost binding",
			ports:   []string{"19001:8080"},
			wantErr: true,
			errMsg:  "must be localhost-only",
		},
		{
			name:    "invalid - wrong target port",
			ports:   []string{"127.0.0.1:19001:9090"},
			wantErr: true,
			errMsg:  "must be localhost-only",
		},
		{
			name:    "invalid - no ports",
			ports:   []string{},
			wantErr: true,
			errMsg:  "exactly one port binding required",
		},
		{
			name:    "invalid - multiple ports",
			ports:   []string{"127.0.0.1:19001:8080", "127.0.0.1:19002:8080"},
			wantErr: true,
			errMsg:  "exactly one port binding required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := &ComposeSpec{
				Version: "3.8",
				Services: map[string]Service{
					"app": {
						Image:    "test:latest",
						Runtime:  "runsc",
						Ports:    tt.ports,
						Volumes:  []string{"/tmp/state:/state:rw"},
						ReadOnly: true,
						SecurityOpt: []string{"no-new-privileges:true"},
						NetworkMode: "none",
					},
				},
			}

			err := builder.ValidateSpec(spec)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error containing '%s', got nil", tt.errMsg)
				} else if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Expected error containing '%s', got '%s'", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Errorf("Expected no error, got %v", err)
				}
			}
		})
	}
}

func TestToDockerRunArgs_LocalhostPublish(t *testing.T) {
	builder := NewBuilder()

	spec := &ComposeSpec{
		Version: "3.8",
		Services: map[string]Service{
			"app": {
				Image:         "test-image:latest",
				Runtime:       "runsc",
				Ports:         []string{"127.0.0.1:19001:8080"},
				Volumes:       []string{"/tmp/state:/state:rw"},
				ReadOnly:      true,
				SecurityOpt:   []string{"no-new-privileges:true"},
				NetworkMode:   "none",
				ContainerName: "hersh-program-test-1",
				Environment: map[string]string{
					"HERSH_PROGRAM_ID": "test-1",
				},
			},
		},
	}

	args, err := builder.ToDockerRunArgs(spec)
	if err != nil {
		t.Fatalf("Failed to convert to docker run args: %v", err)
	}

	// Verify port publish argument exists
	portFound := false
	for i, arg := range args {
		if arg == "-p" && i+1 < len(args) {
			if args[i+1] == "127.0.0.1:19001:8080" {
				portFound = true
				break
			}
		}
	}

	if !portFound {
		t.Error("Localhost-only port publish (-p 127.0.0.1:19001:8080) not found in docker run args")
	}

	// Verify image is last
	if args[len(args)-1] != "test-image:latest" {
		t.Errorf("Expected image as last arg, got %s", args[len(args)-1])
	}
}
