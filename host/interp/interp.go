package interp

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

type LogEntry struct {
	Region  string
	Weather string
	At      time.Time
}

// ProcessLog stores weather lookups collected by the script.
type ProcessLog struct {
	mu      sync.Mutex
	entries []LogEntry
}

func (l *ProcessLog) Add(region, weather string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, LogEntry{
		Region:  region,
		Weather: weather,
		At:      time.Now(),
	})
}

func (l *ProcessLog) Snapshot() []LogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]LogEntry, len(l.entries))
	copy(out, l.entries)
	return out
}

// Process wraps a Yaegi interpreter instance and provides host-managed lifecycle.
type Process struct {
	script  string
	interp  *interp.Interpreter
	in      chan string
	done    chan struct{}
	log     *ProcessLog
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	running bool
}

// NewProcess builds a process for a given script source.
func NewProcess(script string) *Process {
	return &Process{script: script}
}

// Spawn creates a Yaegi interpreter, loads the script, and starts it on a goroutine.
func (p *Process) Spawn() error {
	p.mu.Lock()
	if p.running {
		p.mu.Unlock()
		return fmt.Errorf("process already running")
	}
	p.mu.Unlock()

	i := interp.New(interp.Options{})
	if err := i.Use(stdlib.Symbols); err != nil {
		return fmt.Errorf("load stdlib: %w", err)
	}
	// Expose host types to the script under the hostapi package name.
	if err := i.Use(interp.Exports{
		"hostapi/hostapi": map[string]reflect.Value{
			"ProcessLog": reflect.ValueOf((*ProcessLog)(nil)),
		},
	}); err != nil {
		return fmt.Errorf("export host types: %w", err)
	}
	if _, err := i.Eval(p.script); err != nil {
		return fmt.Errorf("eval script: %w", err)
	}
	runValue, err := i.Eval("main.Run")
	if err != nil {
		return fmt.Errorf("lookup Run: %w", err)
	}
	runFunc, ok := runValue.Interface().(func(context.Context, <-chan string, *ProcessLog, chan<- struct{}))
	if !ok {
		return fmt.Errorf("script Run has unexpected signature")
	}

	ctx, cancel := context.WithCancel(context.Background())
	p.mu.Lock()
	p.interp = i
	p.in = make(chan string)
	p.done = make(chan struct{}, 1)
	p.log = &ProcessLog{}
	p.ctx = ctx
	p.cancel = cancel
	p.running = true
	p.mu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("process panic: %v\n", r)
			}
		}()
		runFunc(ctx, p.in, p.log, p.done)
	}()
	return nil
}

// Send delivers a region name to the script.
func (p *Process) Send(region string) error {
	p.mu.Lock()
	if !p.running {
		p.mu.Unlock()
		return fmt.Errorf("process not running")
	}
	in := p.in
	ctx := p.ctx
	p.mu.Unlock()

	select {
	case in <- region:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("process stopped")
	}
}

// Kill signals cancellation and waits for the script to acknowledge exit.
func (p *Process) Kill(timeout time.Duration) error {
	p.mu.Lock()
	if !p.running {
		p.mu.Unlock()
		return nil
	}
	cancel := p.cancel
	done := p.done
	p.mu.Unlock()

	cancel()
	if timeout <= 0 {
		<-done
	} else {
		select {
		case <-done:
		case <-time.After(timeout):
			return fmt.Errorf("timeout waiting for process shutdown")
		}
	}

	p.mu.Lock()
	p.running = false
	p.mu.Unlock()
	return nil
}

// LogSnapshot returns a copy of the current log entries.
func (p *Process) LogSnapshot() []LogEntry {
	p.mu.Lock()
	log := p.log
	p.mu.Unlock()
	if log == nil {
		return nil
	}
	return log.Snapshot()
}

// demoScript is the Yaegi source used by RunProcessDemo.
const demoScript = `
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	hostapi "hostapi/hostapi"
)

func Run(ctx context.Context, in <-chan string, log *hostapi.ProcessLog, done chan<- struct{}) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	defer func() { done <- struct{}{} }()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fmt.Println("process Live")
		case region, ok := <-in:
			if !ok {
				return
			}
			weather := fetchWeather(ctx, region)
			log.Add(region, weather)
		}
	}
}

func fetchWeather(ctx context.Context, region string) string {
	client := http.Client{Timeout: 15 * time.Second}
	urlStr := "https://wttr.in/" + url.PathEscape(region) + "?format=3"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return "error: " + err.Error()
	}
	req.Header.Set("User-Agent", "curl/7.88.1")
	resp, err := client.Do(req)
	if err != nil {
		return "error: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "error: http " + resp.Status + " " + strings.TrimSpace(string(body))
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "error: " + err.Error()
	}
	return strings.TrimSpace(string(body))
}
`

// RunProcessDemo drives a script process for 10 seconds, then prints the log and exits.
func RunProcessDemo() error {
	proc := NewProcess(demoScript)
	if err := proc.Spawn(); err != nil {
		return err
	}

	labels := []string{"korea", "america"}
	sendTicker := time.NewTicker(2 * time.Second)
	stopTimer := time.NewTimer(10 * time.Second)
	defer sendTicker.Stop()

	idx := 0
	for {
		select {
		case <-sendTicker.C:
			label := labels[idx%len(labels)]
			if err := proc.Send(label); err != nil {
				return err
			}
			idx++
		case <-stopTimer.C:
			entries := proc.LogSnapshot()
			fmt.Println("process log:")
			for _, entry := range entries {
				fmt.Printf("- %s %s %s\n", entry.At.Format(time.RFC3339), entry.Region, entry.Weather)
			}
			return proc.Kill(5 * time.Second)
		}
	}
}
