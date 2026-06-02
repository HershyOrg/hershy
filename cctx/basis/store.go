package basis

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// PositionStore persists basis positions as JSON.
type PositionStore struct {
	path string
	mu   sync.Mutex
}

// NewPositionStore creates a file-backed position store.
func NewPositionStore(path string) (*PositionStore, error) {
	if path == "" {
		return nil, errors.New("basis position store path required")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create basis store dir: %w", err)
	}
	return &PositionStore{path: path}, nil
}

// Path returns the backing file path.
func (s *PositionStore) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

// Load returns every stored position.
func (s *PositionStore) Load() ([]Position, error) {
	if s == nil {
		return nil, errors.New("basis position store is nil")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

// Save atomically replaces the stored position list.
func (s *PositionStore) Save(positions []Position) error {
	if s == nil {
		return errors.New("basis position store is nil")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(positions)
}

// Active returns all open positions.
func (s *PositionStore) Active() ([]Position, error) {
	positions, err := s.Load()
	if err != nil {
		return nil, err
	}
	active := make([]Position, 0)
	for _, position := range positions {
		if position.IsOpen() {
			active = append(active, position)
		}
	}
	return active, nil
}

// Add appends a new position, rejecting duplicate IDs.
func (s *PositionStore) Add(position Position) error {
	if s == nil {
		return errors.New("basis position store is nil")
	}
	if position.ID == "" {
		return errors.New("basis position id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	positions, err := s.loadLocked()
	if err != nil {
		return err
	}
	for _, existing := range positions {
		if existing.ID == position.ID {
			return fmt.Errorf("basis position already exists: %s", position.ID)
		}
	}
	positions = append(positions, position)
	return s.saveLocked(positions)
}

// Update replaces an existing position by ID.
func (s *PositionStore) Update(position Position) error {
	if s == nil {
		return errors.New("basis position store is nil")
	}
	if position.ID == "" {
		return errors.New("basis position id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	positions, err := s.loadLocked()
	if err != nil {
		return err
	}
	for idx, existing := range positions {
		if existing.ID == position.ID {
			positions[idx] = position
			return s.saveLocked(positions)
		}
	}
	return fmt.Errorf("basis position not found: %s", position.ID)
}

func (s *PositionStore) loadLocked() ([]Position, error) {
	payload, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Position{}, nil
		}
		return nil, fmt.Errorf("read basis position store: %w", err)
	}
	if len(payload) == 0 {
		return []Position{}, nil
	}
	var positions []Position
	if err := json.Unmarshal(payload, &positions); err != nil {
		return nil, fmt.Errorf("decode basis position store: %w", err)
	}
	if positions == nil {
		return []Position{}, nil
	}
	return positions, nil
}

func (s *PositionStore) saveLocked(positions []Position) error {
	payload, err := json.MarshalIndent(positions, "", "  ")
	if err != nil {
		return fmt.Errorf("encode basis position store: %w", err)
	}
	payload = append(payload, '\n')
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create basis store dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".positions-*.json")
	if err != nil {
		return fmt.Errorf("create basis position temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write basis position temp file: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod basis position temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close basis position temp file: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("replace basis position store: %w", err)
	}
	return nil
}
