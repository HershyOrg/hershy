package store

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type Checkpoint struct {
	LastUpdatedAt string `json:"lastUpdatedAt"`
}

func Load(path string) (time.Time, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}

	var cp Checkpoint
	if err := json.Unmarshal(data, &cp); err != nil {
		return time.Time{}, err
	}

	t, err := time.Parse(time.RFC3339Nano, cp.LastUpdatedAt)
	if err != nil {
		return time.Time{}, nil
	}

	return t, nil
}

func Save(path string, t time.Time) error {
	cp := Checkpoint{
		LastUpdatedAt: t.Format(time.RFC3339Nano),
	}

	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return err
	}

	fmt.Printf(
		"[checkpoint] saved path=%s size=%dB updatedAt=%s\n",
		path,
		len(data),
		cp.LastUpdatedAt,
	)

	return nil
}
