package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
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

type Manager struct {
    hostBase string
    outDir   string
    interval time.Duration
    client   *http.Client

    mu      sync.Mutex
    running map[string]context.CancelFunc
}

func NewManager(hostBase, outDir string, interval time.Duration, client *http.Client) *Manager {
    return &Manager{
        hostBase: hostBase,
        outDir:   outDir,
        interval: interval,
        client:   client,
        running:  make(map[string]context.CancelFunc),
    }
}

func (m *Manager) Add(programID string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if _, ok := m.running[programID]; ok {
        return
    }
    m.running[programID] = nil
}

func (m *Manager) Remove(programID string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if cancel, ok := m.running[programID]; ok && cancel != nil {
        cancel()
    }
    delete(m.running, programID)
}

func (m *Manager) Run(ctx context.Context) {
    m.mu.Lock()
    for pid := range m.running {
        if m.running[pid] == nil {
            cctx, cancel := context.WithCancel(ctx)
            m.running[pid] = cancel
            go m.runPoller(cctx, pid)
        }
    }
    m.mu.Unlock()

    <-ctx.Done()
    m.mu.Lock()
    for _, cancel := range m.running {
        if cancel != nil {
            cancel()
        }
    }
    m.mu.Unlock()
}

func (m *Manager) AutoDiscover(ctx context.Context, d time.Duration) {
    ticker := time.NewTicker(d)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        ids, err := m.listPrograms(ctx)
        if err == nil {
            for _, id := range ids {
                m.Add(id)
            }
            m.mu.Lock()
            for pid, cancel := range m.running {
                if cancel == nil {
                    cctx, cancelFn := context.WithCancel(ctx)
                    m.running[pid] = cancelFn
                    go m.runPoller(cctx, pid)
                }
            }
            m.mu.Unlock()
        } else {
            log.Printf("discover error: %v", err)
        }
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
        }
    }
}

func (m *Manager) listPrograms(ctx context.Context) ([]string, error) {
    url := fmt.Sprintf("%s/programs", m.hostBase)
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := m.client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }

    // try several possible JSON shapes
    // 1) { "programs": [{ "program_id": "..." }, ...] }
    var wrapper struct {
        Programs []struct {
            ProgramID string `json:"program_id"`
        } `json:"programs"`
    }
    if err := json.Unmarshal(body, &wrapper); err == nil && len(wrapper.Programs) > 0 {
        ids := make([]string, 0, len(wrapper.Programs))
        for _, p := range wrapper.Programs {
            ids = append(ids, p.ProgramID)
        }
        return ids, nil
    }

    // 2) [ { "program_id": "..." }, ... ]
    var arr []struct{
        ProgramID string `json:"program_id"`
    }
    if err := json.Unmarshal(body, &arr); err == nil && len(arr) > 0 {
        ids := make([]string, 0, len(arr))
        for _, p := range arr {
            ids = append(ids, p.ProgramID)
        }
        return ids, nil
    }

    // 3) [ "id1", "id2", ... ]
    var sarr []string
    if err := json.Unmarshal(body, &sarr); err == nil && len(sarr) > 0 {
        return sarr, nil
    }

    // 4) try a generic map with programs key that may contain strings or objects
    var generic interface{}
    if err := json.Unmarshal(body, &generic); err == nil {
        if mmap, ok := generic.(map[string]interface{}); ok {
            if pval, ok := mmap["programs"]; ok {
                switch v := pval.(type) {
                case []interface{}:
                    ids := make([]string, 0, len(v))
                    for _, it := range v {
                        switch itv := it.(type) {
                        case string:
                            ids = append(ids, itv)
                        case map[string]interface{}:
                            if idv, ok := itv["program_id"].(string); ok {
                                ids = append(ids, idv)
                            }
                        }
                    }
                    if len(ids) > 0 {
                        return ids, nil
                    }
                }
            }
        }
    }

    // helpful debug: log body so operator can see what's coming back
    log.Printf("listPrograms: unexpected /programs response: %s", strings.TrimSpace(string(body)))
    return nil, fmt.Errorf("unable to parse /programs response")
}

func (m *Manager) runPoller(ctx context.Context, programID string) {
		endpoints := []string{
        "status",
        // "logs?type=all&limit=200",
        // "logs?type=effect&limit=200",
        // "logs?type=reduce&limit=200",
        // "logs?type=watch_error&limit=200",
        // "logs?type=context&limit=200",
        // "logs?type=state_fault&limit=200",
        "signals",
        "varState",
        "memoCache",
        "config",
    }
    outPath := filepath.Join(m.outDir, programID+".log")

    f, err := os.OpenFile(outPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
    if err != nil {
        log.Printf("open out file %s: %v", outPath, err)
        m.Remove(programID)
        return
    }
    defer f.Close()

    ticker := time.NewTicker(m.interval)
    defer ticker.Stop()

    m.singlePoll(ctx, programID, endpoints, f)

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            m.singlePoll(ctx, programID, endpoints, f)
        }
    }
}

func (m *Manager) singlePoll(ctx context.Context, programID string, endpoints []string, w io.Writer) {
    now := time.Now().UTC().Format(time.RFC3339Nano)
    for _, ep := range endpoints {
        url := fmt.Sprintf("%s/programs/%s/proxy/watcher/%s", m.hostBase, programID, ep)
        req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
        resp, err := m.client.Do(req)

        var raw json.RawMessage
        var errStr string
        if err != nil {
            errStr = err.Error()
            raw = json.RawMessage("null")
        } else {
            body, _ := io.ReadAll(resp.Body)
            resp.Body.Close()
            if resp.StatusCode >= 400 {
                errStr = fmt.Sprintf("status=%d", resp.StatusCode)
            }
            if len(body) == 0 {
                raw = json.RawMessage("null")
            } else {
                raw = json.RawMessage(body)
            }
        }

        // try to decode payload into generic interface{} for Meta to keep structured data
        var payload interface{}
        if err := json.Unmarshal(raw, &payload); err != nil {
            // keep raw string if not valid json
            payload = string(raw)
        }

        level := "INFO"
        if errStr != "" {
            level = "ERROR"
        }

        entry := LogEntry{
            Ts:        now,
            Level:     level,
            LogType:   "WATCHER",
            Component: "WatcherPoller",
            Msg:       ep,
            ProgramID: programID,
            Vars: map[string]interface{}{
                "endpoint": ep,
            },
            Meta: map[string]interface{}{
                "payload": payload,
                "error":   errStr,
            },
        }

        if b, err := json.Marshal(entry); err == nil {
            b = append(b, '\n')
            if _, werr := w.Write(b); werr != nil {
                log.Printf("write file err: %v", werr)
            }
        } else {
            log.Printf("marshal logentry err: %v", err)
        }
    }
}

// LokiPusher reads local files and pushes new lines to Loki
type lokiPush struct {
    Streams []struct {
        Stream map[string]string `json:"stream"`
        Values [][2]string       `json:"values"`
    } `json:"streams"`
}

type offsetStore map[string]int64

type LokiPusher struct {
    lokiURL string
    outDir  string
    client  *http.Client

    mu      sync.Mutex
    offsets offsetStore
}

func NewLokiPusher(lokiURL, outDir string, client *http.Client) *LokiPusher {
    return &LokiPusher{
        lokiURL: lokiURL,
        outDir:  outDir,
        client:  client,
        offsets: make(offsetStore),
    }
}

func (p *LokiPusher) Run(ctx context.Context) error {
    p.loadOffsets()

    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            p.saveOffsets()
            return nil
        case <-ticker.C:
            if err := p.scanAndPush(ctx); err != nil {
                log.Printf("loki pusher scan error: %v", err)
            }
        }
    }
}

func (p *LokiPusher) scanAndPush(ctx context.Context) error {
    glob := filepath.Join(p.outDir, "*.log")
    files, err := filepath.Glob(glob)
    if err != nil {
        return err
    }
    for _, f := range files {
        select {
        case <-ctx.Done():
            return nil
        default:
        }
        if err := p.pushFile(ctx, f); err != nil {
            log.Printf("pushFile %s error: %v", f, err)
        }
    }
    return p.saveOffsets()
}

func (p *LokiPusher) pushFile(ctx context.Context, path string) error {
    program := strings.TrimSuffix(filepath.Base(path), ".log")

    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()

    p.mu.Lock()
    offset := p.offsets[path]
    p.mu.Unlock()

    if _, err := f.Seek(offset, io.SeekStart); err != nil {
        return err
    }

    reader := bufio.NewReader(f)
    var values [][2]string
    var lastPos = offset
    for {
        line, err := reader.ReadBytes('\n')
        if err != nil {
            if err == io.EOF {
                pos, _ := f.Seek(0, io.SeekCurrent)
                lastPos = pos
                break
            }
            return err
        }

        trim := strings.TrimRight(string(line), "\n")
        ts := time.Now()
        // try to parse LogEntry and use its Ts if present
        var parsed LogEntry
        if err := json.Unmarshal([]byte(trim), &parsed); err == nil && parsed.Ts != "" {
            if t, perr := time.Parse(time.RFC3339Nano, parsed.Ts); perr == nil {
                ts = t
            }
        }
        tsStr := fmt.Sprintf("%d", ts.UnixNano())

        values = append(values, [2]string{tsStr, trim})

        if len(values) >= 1000 {
            if err := p.sendToLoki(ctx, program, values); err != nil {
                return err
            }
            values = values[:0]
        }
    }

    if len(values) > 0 {
        if err := p.sendToLoki(ctx, program, values); err != nil {
            return err
        }
    }

    p.mu.Lock()
    p.offsets[path] = lastPos
    p.mu.Unlock()

    return nil
}

func (p *LokiPusher) sendToLoki(ctx context.Context, program string, values [][2]string) error {
    var payload lokiPush
    stream := struct {
        Stream map[string]string `json:"stream"`
        Values [][2]string       `json:"values"`
    }{
        Stream: map[string]string{
            "job":     "watcher",
            "program": program,
        },
        Values: values,
    }
    payload.Streams = append(payload.Streams, stream)

    b, err := json.Marshal(payload)
    if err != nil {
        return err
    }

    req, err := http.NewRequestWithContext(ctx, "POST", p.lokiURL, bytes.NewReader(b))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")

    resp, err := p.client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode >= 300 {
        body, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("loki push status=%d body=%s", resp.StatusCode, string(body))
    }
    return nil
}

func (p *LokiPusher) offsetsPath() string {
    return filepath.Join(p.outDir, ".offsets.json")
}

func (p *LokiPusher) loadOffsets() {
    path := p.offsetsPath()
    f, err := os.Open(path)
    if err != nil {
        return
    }
    defer f.Close()
    dec := json.NewDecoder(f)
    var m offsetStore
    if err := dec.Decode(&m); err == nil {
        p.mu.Lock()
        for k, v := range m {
            p.offsets[k] = v
        }
        p.mu.Unlock()
    }
}

func (p *LokiPusher) saveOffsets() error {
    path := p.offsetsPath()
    tmp := path + ".tmp"
    f, err := os.Create(tmp)
    if err != nil {
        return err
    }
    enc := json.NewEncoder(f)
    p.mu.Lock()
    if err := enc.Encode(p.offsets); err != nil {
        p.mu.Unlock()
        f.Close()
        os.Remove(tmp)
        return err
    }
    p.mu.Unlock()
    f.Close()
    return os.Rename(tmp, path)
}

func main() {
    var hostBase string
    var outDir string
    var interval int
    var discover bool
    var pushToLoki bool
    var lokiURL string

    flag.StringVar(&hostBase, "host", "", "Host API base URL (overrides HOST env)")
    flag.StringVar(&outDir, "out", "/var/log/watcher", "Output directory for watcher logs")
    flag.IntVar(&interval, "interval", 10, "Poll interval seconds")
    flag.BoolVar(&discover, "discover", true, "Auto discover programs via /programs")
    flag.BoolVar(&pushToLoki, "push", false, "enable pushing collected logs to Loki")
    flag.StringVar(&lokiURL, "loki", "", "Loki push URL (overrides LOKI_URL env), e.g. http://localhost:3100/loki/api/v1/push")
    flag.Parse()

    if hostBase == "" {
        hostBase = os.Getenv("HOST")
        if hostBase == "" {
            hostBase = "http://localhost:9000"
        }
    }

    if lokiURL == "" {
        lokiURL = os.Getenv("LOKI_URL")
        if lokiURL == "" {
            lokiURL = "http://localhost:3100/loki/api/v1/push"
        }
    }

    if err := os.MkdirAll(outDir, 0755); err != nil {
        log.Fatalf("mkdir out dir: %v", err)
    }

    client := &http.Client{Timeout: 10 * time.Second}
    manager := NewManager(hostBase, outDir, time.Duration(interval)*time.Second, client)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    for _, id := range flag.Args() {
        manager.Add(id)
    }

    if discover {
        go manager.AutoDiscover(ctx, 10*time.Second)
    }

    go manager.Run(ctx)

    if pushToLoki {
        p := NewLokiPusher(lokiURL, outDir, client)
        go func() {
            if err := p.Run(ctx); err != nil {
                log.Printf("loki pusher stopped: %v", err)
            }
        }()
    }

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh
    cancel()
    time.Sleep(500 * time.Millisecond)
}