package utils

import (
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarning
	LevelError
	LevelCritical
)

// Logger provides simple leveled logging with colored timestamp output.
type Logger struct {
	name   string
	level  Level
	out    io.Writer
	mu     sync.Mutex
	buffer []string
}

// SetupLogger creates a configured logger with colored output.
func SetupLogger(name string, level Level) *Logger {
	if name == "" {
		name = "root"
	}
	return &Logger{
		name:  name,
		level: level,
		out:   os.Stdout,
	}
}

// defaultLogger is a shared logger instance.
var defaultLogger = SetupLogger("dr_manhattan", LevelInfo)

// DefaultLogger returns the shared logger instance.
func DefaultLogger() *Logger {
	return defaultLogger
}
func (l *Logger) Debugf(format string, args ...any) {
	l.logf(LevelDebug, format, args...)
}

func (l *Logger) Infof(format string, args ...any) {
	l.logf(LevelInfo, format, args...)
}

func (l *Logger) Warnf(format string, args ...any) {
	l.logf(LevelWarning, format, args...)
}

func (l *Logger) Errorf(format string, args ...any) {
	l.logf(LevelError, format, args...)
}

func (l *Logger) Criticalf(format string, args ...any) {
	l.logf(LevelCritical, format, args...)
}

func (l *Logger) logf(level Level, format string, args ...any) {
	if level < l.level {
		return
	}

	message := fmt.Sprintf(format, args...)
	line := l.formatLine(level, message)

	l.mu.Lock()
	defer l.mu.Unlock()
	l.buffer = append(l.buffer, line)
}

func (l *Logger) formatLine(level Level, message string) string {
	timestamp := time.Now().Format("15:04:05")
	ts := Gray("[" + timestamp + "]")

	switch level {
	case LevelWarning:
		return fmt.Sprintf("%s ! %s\n", ts, message)
	case LevelError:
		return fmt.Sprintf("%s x %s\n", ts, message)
	case LevelCritical:
		return fmt.Sprintf("%s !! %s\n", ts, message)
	default:
		return fmt.Sprintf("%s %s\n", ts, message)
	}
}

// Print flushes buffered log lines to the output.
func (l *Logger) Print() {
	l.mu.Lock()
	if len(l.buffer) == 0 {
		l.mu.Unlock()
		return
	}
	lines := append([]string(nil), l.buffer...)
	l.buffer = nil
	l.mu.Unlock()

	for _, line := range lines {
		_, _ = io.WriteString(l.out, line)
	}
}

// Color helpers use ANSI escape codes for terminal output.
const (
	ansiReset   = "\033[0m"
	ansiBold    = "\033[1m"
	ansiDim     = "\033[2m"
	ansiRed     = "\033[31m"
	ansiGreen   = "\033[32m"
	ansiYellow  = "\033[33m"
	ansiBlue    = "\033[34m"
	ansiMagenta = "\033[35m"
	ansiCyan    = "\033[36m"
	ansiGray    = "\033[90m"
)

// Colorize wraps text with a color code.
func Colorize(text, color string) string {
	if text == "" {
		return ""
	}
	return color + text + ansiReset
}

// Green returns green colored text.
func Green(text string) string {
	return Colorize(text, ansiGreen)
}

// Red returns red colored text.
func Red(text string) string {
	return Colorize(text, ansiRed)
}

// Yellow returns yellow colored text.
func Yellow(text string) string {
	return Colorize(text, ansiYellow)
}

// Blue returns blue colored text.
func Blue(text string) string {
	return Colorize(text, ansiBlue)
}

// Cyan returns cyan colored text.
func Cyan(text string) string {
	return Colorize(text, ansiCyan)
}

// Magenta returns magenta colored text.
func Magenta(text string) string {
	return Colorize(text, ansiMagenta)
}

// Gray returns gray colored text.
func Gray(text string) string {
	return Colorize(text, ansiGray)
}

// Bold returns bold text.
func Bold(text string) string {
	return ansiBold + text + ansiReset
}

// Dim returns dim text.
func Dim(text string) string {
	return ansiDim + text + ansiReset
}
