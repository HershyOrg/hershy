package proxy

import (
	"encoding/json"
	"net/http"
	"time"
)

// MockProxy is a mock implementation of the Proxy interface for testing.
// It simulates proxying requests to a WatcherServer.
type MockProxy struct {
	// ContainerPort is the port to proxy to (simulated).
	ContainerPort int

	// ShouldFail can be set to true to simulate proxy failures.
	ShouldFail bool

	// MockStatus is the status to return from GetStatus.
	MockStatus WatcherStatus

	// SentMessages tracks messages sent via SendMessage.
	SentMessages []string
}

// NewMockProxy creates a new MockProxy.
func NewMockProxy(containerPort int) *MockProxy {
	return &MockProxy{
		ContainerPort: containerPort,
		MockStatus: WatcherStatus{
			State:      "Ready",
			IsRunning:  true,
			WatcherID:  "mock-watcher-id",
			Uptime:     10.5,
			LastUpdate: time.Now().Format(time.RFC3339),
		},
		SentMessages: make([]string, 0),
	}
}

// ProxyRequest simulates proxying an HTTP request.
func (m *MockProxy) ProxyRequest(w http.ResponseWriter, r *http.Request) error {
	if m.ShouldFail {
		return &ProxyError{
			Operation:  "proxy_request",
			StatusCode: http.StatusBadGateway,
			Message:    "mock proxy failure",
		}
	}

	// Simulate different responses based on path
	switch r.URL.Path {
	case "/watcher/status":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(m.MockStatus)

	case "/watcher/signals":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"varSigCount":     0,
			"userSigCount":    0,
			"watcherSigCount": 0,
			"totalPending":    0,
		})

	default:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"message": "mock proxy response",
		})
	}

	return nil
}

// GetStatus simulates retrieving WatcherServer status.
func (m *MockProxy) GetStatus() (WatcherStatus, error) {
	if m.ShouldFail {
		return WatcherStatus{}, &ProxyError{
			Operation: "get_status",
			Message:   "mock get status failure",
		}
	}

	return m.MockStatus, nil
}

// SendMessage simulates sending a message to WatcherServer.
func (m *MockProxy) SendMessage(content string) error {
	if m.ShouldFail {
		return &ProxyError{
			Operation: "send_message",
			Message:   "mock send message failure",
		}
	}

	m.SentMessages = append(m.SentMessages, content)
	return nil
}

// GetLogs simulates retrieving logs from WatcherServer.
func (m *MockProxy) GetLogs(opts LogOptions) ([]LogEntry, error) {
	if m.ShouldFail {
		return nil, &ProxyError{
			Operation: "get_logs",
			Message:   "mock get logs failure",
		}
	}

	// Return mock log entries
	return []LogEntry{
		{
			Timestamp: time.Now().Format(time.RFC3339),
			Type:      opts.Type,
			Message:   "Mock log entry 1",
			Data:      map[string]interface{}{"mock": true},
		},
		{
			Timestamp: time.Now().Format(time.RFC3339),
			Type:      opts.Type,
			Message:   "Mock log entry 2",
			Data:      map[string]interface{}{"mock": true},
		},
	}, nil
}
