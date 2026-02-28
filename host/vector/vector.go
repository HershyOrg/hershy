package vector

import (
	"os"
	"os/exec"
)

type Manager struct {
	composePath string
}

func NewManager(path string) *Manager {
	return &Manager{
		composePath: path,
	}
}


func (m *Manager) Start() {
	cmd := exec.Command("docker", "compose", "-f", m.composePath, "up", "-d")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		// m.logger.Printf("⚠️ Vector start failed: %v", err)
	}
}

func (m *Manager) Stop() {
	cmd := exec.Command("docker", "compose", "-f", m.composePath, "down")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
// m.logger.Printf("⚠️ Vector start failed: %v", err)
	}
}