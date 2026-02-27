//TODO 편하게 쓰기위한 작업 필요함
// EX) Level, LogType 강제화 등등

package logger

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"time"
)

type LogEntry struct {
    Ts         string                 `json:"ts"`
    Level      string                 `json:"level"`
    LogType    string                 `json:"log_type"`
    Component  string                 `json:"component"`
    Msg        string                 `json:"msg"`
    ProgramID  string                 `json:"program_id,omitempty"`
    DurationMs *int64                 `json:"duration_ms,omitempty"`
    Vars       map[string]interface{} `json:"vars,omitempty"`
    Meta       map[string]interface{} `json:"meta,omitempty"`
}

type Logger struct {
    std       *log.Logger
    out       io.Writer
    file      *os.File
    Component string
    DefaultLogType string
}


func New(component string, out io.Writer, filePath string) *Logger {
    var f *os.File
    var mw io.Writer
    if filePath != "" {
        // If a filePath is provided, write only to the file (no console output).
        if err := os.MkdirAll(filepathDir(filePath), 0755); err == nil {
            if file, err := os.OpenFile(filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
                f = file
                mw = f
            } else {
                fmt.Fprintf(os.Stderr, "logger: failed open file %s: %v\n", filePath, err)
                mw = out // fallback to provided writer on failure
            }
        } else {
            fmt.Fprintf(os.Stderr, "logger: failed mkdir for %s: %v\n", filePath, err)
            mw = out
        }
    } else {
        // No file path -> use provided writer (e.g. os.Stdout)
        mw = out
    }
    return &Logger{
        std:       log.New(mw, "", 0),
        out:       mw,
        file:      f,
        Component: component,
    }
}

func (l *Logger) Emit(entry LogEntry) {
    if entry.Ts == "" {
        entry.Ts = time.Now().UTC().Format(time.RFC3339Nano)
    }
    if entry.Component == "" {
        entry.Component = l.Component
    }
    if entry.LogType == "" && l.DefaultLogType != "" {
        entry.LogType = l.DefaultLogType
    }
    b, err := json.Marshal(entry)
    if err != nil {
        fmt.Fprintf(os.Stderr, "logger: marshal error: %v\n", err)
        return
    }
    //TODO 화면 출력 옵셔널 OR 삭제 예정
    fmt.Fprintf(os.Stdout, "[%s]: %s\n", entry.LogType, entry.Msg)

    l.std.Print(string(b))
}


func (l *Logger) Close() {
    if l.file != nil {
        l.file.Close()
    }
}

func filepathDir(p string) string {
    for i := len(p) - 1; i >= 0; i-- {
        if os.IsPathSeparator(p[i]) {
            return p[:i]
        }
    }
    return "."
}
func (l *Logger) SetDefaultLogType(t string) {
    l.DefaultLogType = t
}