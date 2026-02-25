package vector

import (
	"log"
	"os"
	"os/exec"
)

type Manager struct {
	composePath string
	logger      *log.Logger
}

func NewManager(path string, logger *log.Logger) *Manager {
	return &Manager{
		composePath: path,
		logger:      logger,
	}
}


func (m *Manager) Start() {
	m.logger.Println("🐳 Starting Vector Logging Agent (Docker)...")
	cmd := exec.Command("docker", "compose", "-f", m.composePath, "up", "-d")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		m.logger.Printf("⚠️ Vector start failed: %v", err)
	}
}

func (m *Manager) Stop() {
	m.logger.Println("🛑 Stopping Vector Logging Agent...")
	cmd := exec.Command("docker", "compose", "-f", m.composePath, "down")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		m.logger.Printf("⚠️ Vector stop failed: %v", err)
	}
}