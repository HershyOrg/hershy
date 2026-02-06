package storage

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/rlaaudgjs5638/hersh/program"
)

// Manager handles program directory structure and file operations
type Manager struct {
	baseDir string // Base directory for all programs (e.g., "/var/lib/hersh/programs")
}

// NewManager creates a new StorageManager
func NewManager(baseDir string) *Manager {
	return &Manager{
		baseDir: baseDir,
	}
}

// EnsureProgramFolders creates the directory structure for a program
// Directory layout:
//   {baseDir}/{programID}/
//     ├─ src/        (user source code)
//     ├─ meta/       (metadata: meta.json, etc.)
//     ├─ state/      (persistent state - RW volume)
//     ├─ compose/    (generated compose spec)
//     ├─ logs/       (runtime logs)
//     └─ runtime/    (container/build metadata)
func (m *Manager) EnsureProgramFolders(id program.ProgramID) error {
	programDir := m.getProgramDir(id)

	subdirs := []string{
		"src",
		"meta",
		"state",
		"compose",
		"logs",
		"runtime",
	}

	for _, subdir := range subdirs {
		dirPath := filepath.Join(programDir, subdir)
		if err := os.MkdirAll(dirPath, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dirPath, err)
		}
	}

	return nil
}

// GetProgramPath returns the full path to a program's subdirectory
func (m *Manager) GetProgramPath(id program.ProgramID, subdir string) string {
	return filepath.Join(m.getProgramDir(id), subdir)
}

// GetSrcPath returns the path to program source directory
func (m *Manager) GetSrcPath(id program.ProgramID) string {
	return m.GetProgramPath(id, "src")
}

// GetMetaPath returns the path to program metadata directory
func (m *Manager) GetMetaPath(id program.ProgramID) string {
	return m.GetProgramPath(id, "meta")
}

// GetStatePath returns the path to program state directory (RW volume)
func (m *Manager) GetStatePath(id program.ProgramID) string {
	return m.GetProgramPath(id, "state")
}

// GetComposePath returns the path to program compose directory
func (m *Manager) GetComposePath(id program.ProgramID) string {
	return m.GetProgramPath(id, "compose")
}

// GetLogsPath returns the path to program logs directory
func (m *Manager) GetLogsPath(id program.ProgramID) string {
	return m.GetProgramPath(id, "logs")
}

// GetRuntimePath returns the path to program runtime metadata directory
func (m *Manager) GetRuntimePath(id program.ProgramID) string {
	return m.GetProgramPath(id, "runtime")
}

// ProgramExists checks if a program directory exists
func (m *Manager) ProgramExists(id program.ProgramID) bool {
	programDir := m.getProgramDir(id)
	info, err := os.Stat(programDir)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// DeleteProgram removes all program directories and files
func (m *Manager) DeleteProgram(id program.ProgramID) error {
	programDir := m.getProgramDir(id)
	return os.RemoveAll(programDir)
}

// getProgramDir returns the base directory for a specific program
func (m *Manager) getProgramDir(id program.ProgramID) string {
	return filepath.Join(m.baseDir, string(id))
}

// GetBaseDir returns the base directory for all programs
func (m *Manager) GetBaseDir() string {
	return m.baseDir
}
