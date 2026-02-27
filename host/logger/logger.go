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
    ConsolePrint bool
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
                mw = out 
            }
        } else {
            fmt.Fprintf(os.Stderr, "logger: failed mkdir for %s: %v\n", filePath, err)
            mw = out
        }
    } else {
        mw = out
    }
    return &Logger{
        std:       log.New(mw, "", 0),
        out:       mw,
        file:      f,
        Component: component,
        ConsolePrint: true, // 기본은 화면에 Msg 출력
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
        if l.ConsolePrint {
            fmt.Fprintln(os.Stdout, entry.Msg)
        }
        return
    }

    if l.ConsolePrint {
        fmt.Fprintln(os.Stdout, entry.Msg)
    }
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