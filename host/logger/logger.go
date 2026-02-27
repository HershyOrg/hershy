//TODO logger Com통합

package logger

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
)

// IHershyLog-like structure
type LogEntry struct {
    Ts         string                 `json:"ts"`
    Level      string                 `json:"level"`
    LogType    string                 `json:"log_type"`
    Component  string                 `json:"component"`
    Msg        string                 `json:"msg"`
    ProgramID  *string                `json:"program_id,omitempty"`
    DurationMs *int64                 `json:"duration_ms,omitempty"`
    Vars       map[string]interface{} `json:"vars,omitempty"`
    Meta       map[string]interface{} `json:"meta,omitempty"`
}

type Logger struct {
    std       *log.Logger
    out       io.Writer
    file      *os.File
    Component string
}

// New creates a Logger that writes both a text-prefixed std logger (for compat)
// and structured JSON logs (IHershyLog) to stdout and an append file under storageRoot/logs/host.log.
func New(storageRoot, prefix, component string) (*Logger, error) {
    logDir := filepath.Join(storageRoot, "logs")
    if err := os.MkdirAll(logDir, 0o755); err != nil {
        return nil, fmt.Errorf("mkdir logs: %w", err)
    }
    fpath := filepath.Join(logDir, "host.log")
    f, err := os.OpenFile(fpath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
    if err != nil {
        return nil, fmt.Errorf("open log file: %w", err)
    }

    mw := io.MultiWriter(os.Stdout, f)
    std := log.New(mw, prefix, log.LstdFlags)

    // Ensure timestamps are UTC when formatting LstdFlags; consumer can still use JSON ts.
    time.Local = time.UTC

    return &Logger{
        std:       std,
        out:       mw,
        file:      f,
        Component: component,
    }, nil
}

// StdLogger returns the underlying *log.Logger for compatibility with existing code.
func (l *Logger) StdLogger() *log.Logger {
    return l.std
}

func (l *Logger) Close() error {
    if l.file == nil {
        return nil
    }
    return l.file.Close()
}

// Write writes a structured Hershy log entry (JSON line) and also prints a text line via std logger.
func (l *Logger) Write(entry LogEntry) error {
    if entry.Ts == "" {
        entry.Ts = time.Now().UTC().Format(time.RFC3339)
    }
    if entry.Component == "" {
        entry.Component = l.Component
    }
    // Also print a text fallback to the std logger for human-friendly logs
    l.std.Println(entry.Msg)

    b, err := json.Marshal(entry)
    if err != nil {
        return err
    }
    _, err = l.out.Write(append(b, '\n'))
    return err
}

// Convenience helpers
func (l *Logger) InfoSystem(msg string, vars map[string]interface{}) {
    _ = l.Write(LogEntry{
        Level:     "INFO",
        LogType:   "SYSTEM",
        Component: l.Component,
        Msg:       msg,
        Vars:      vars,
    })
}

func (l *Logger) ErrorSystem(msg string, vars map[string]interface{}) {
    _ = l.Write(LogEntry{
        Level:     "ERROR",
        LogType:   "SYSTEM",
        Component: l.Component,
        Msg:       msg,
        Vars:      vars,
    })
}