package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// WatcherAPIHandlers provides HTTP handlers for WatcherServer API
type WatcherAPIHandlers struct {
	// Using interface{} to avoid circular dependency with hersh package
	getState      func() string
	isRunning     func() bool
	getWatcherID  func() string
	getLogger     func() LoggerInterface
	getSignals    func() SignalsInterface
	sendMessage   func(string) error
	startTime     time.Time
}

// LoggerInterface defines methods needed from manager.Logger
type LoggerInterface interface {
	GetEffectLog() []interface{}
	GetReduceLog() []interface{}
	GetWatchErrorLog() []interface{}
	GetContextLog() []interface{}
	GetStateTransitionFaultLog() []interface{}
}

// SignalsInterface defines methods needed from manager.SignalChannels
type SignalsInterface interface {
	GetVarSigCount() int
	GetUserSigCount() int
	GetWatcherSigCount() int
}

// NewWatcherAPIHandlers creates a new API handlers instance
func NewWatcherAPIHandlers(
	getState func() string,
	isRunning func() bool,
	getWatcherID func() string,
	getLogger func() LoggerInterface,
	getSignals func() SignalsInterface,
	sendMessage func(string) error,
) *WatcherAPIHandlers {
	return &WatcherAPIHandlers{
		getState:     getState,
		isRunning:    isRunning,
		getWatcherID: getWatcherID,
		getLogger:    getLogger,
		getSignals:   getSignals,
		sendMessage:  sendMessage,
		startTime:    time.Now(),
	}
}

// HandleStatus handles GET /watcher/status
func (h *WatcherAPIHandlers) HandleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	uptime := time.Since(h.startTime).String()

	response := StatusResponse{
		State:      h.getState(),
		IsRunning:  h.isRunning(),
		WatcherID:  h.getWatcherID(),
		Uptime:     uptime,
		LastUpdate: time.Now(),
	}

	json.NewEncoder(w).Encode(response)
}

// HandleLogs handles GET /watcher/logs?type=X&limit=N
func (h *WatcherAPIHandlers) HandleLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	logType := r.URL.Query().Get("type")
	if logType == "" {
		logType = "all"
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	logger := h.getLogger()
	response := LogsResponse{}

	switch logType {
	case "effect":
		logs := logger.GetEffectLog()
		response.EffectLogs = h.limitEffectLogs(logs, limit)
	case "reduce":
		logs := logger.GetReduceLog()
		response.ReduceLogs = h.limitReduceLogs(logs, limit)
	case "watch_error":
		logs := logger.GetWatchErrorLog()
		response.WatchErrorLogs = h.limitWatchErrorLogs(logs, limit)
	case "context":
		logs := logger.GetContextLog()
		response.ContextLogs = h.limitContextLogs(logs, limit)
	case "state_fault":
		logs := logger.GetStateTransitionFaultLog()
		response.StateFaultLogs = h.limitStateFaultLogs(logs, limit)
	case "all":
		response.EffectLogs = h.limitEffectLogs(logger.GetEffectLog(), limit)
		response.ReduceLogs = h.limitReduceLogs(logger.GetReduceLog(), limit)
		response.WatchErrorLogs = h.limitWatchErrorLogs(logger.GetWatchErrorLog(), limit)
		response.ContextLogs = h.limitContextLogs(logger.GetContextLog(), limit)
		response.StateFaultLogs = h.limitStateFaultLogs(logger.GetStateTransitionFaultLog(), limit)
	default:
		http.Error(w, fmt.Sprintf("invalid log type: %s", logType), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(response)
}

// Helper functions to limit log entries
func (h *WatcherAPIHandlers) limitEffectLogs(logs []interface{}, limit int) []interface{} {
	if len(logs) > limit {
		return logs[len(logs)-limit:]
	}
	return logs
}

func (h *WatcherAPIHandlers) limitReduceLogs(logs []interface{}, limit int) []interface{} {
	if len(logs) > limit {
		return logs[len(logs)-limit:]
	}
	return logs
}

func (h *WatcherAPIHandlers) limitWatchErrorLogs(logs []interface{}, limit int) []interface{} {
	if len(logs) > limit {
		return logs[len(logs)-limit:]
	}
	return logs
}

func (h *WatcherAPIHandlers) limitContextLogs(logs []interface{}, limit int) []interface{} {
	if len(logs) > limit {
		return logs[len(logs)-limit:]
	}
	return logs
}

func (h *WatcherAPIHandlers) limitStateFaultLogs(logs []interface{}, limit int) []interface{} {
	if len(logs) > limit {
		return logs[len(logs)-limit:]
	}
	return logs
}

// HandleSignals handles GET /watcher/signals
func (h *WatcherAPIHandlers) HandleSignals(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	signals := h.getSignals()

	varCount := signals.GetVarSigCount()
	userCount := signals.GetUserSigCount()
	watcherCount := signals.GetWatcherSigCount()

	response := SignalsResponse{
		VarSigCount:     varCount,
		UserSigCount:    userCount,
		WatcherSigCount: watcherCount,
		TotalPending:    varCount + userCount + watcherCount,
		Timestamp:       time.Now(),
	}

	json.NewEncoder(w).Encode(response)
}

// HandleMessage handles POST /watcher/message
func (h *WatcherAPIHandlers) HandleMessage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req MessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp := ErrorResponse{Error: fmt.Sprintf("invalid request body: %v", err)}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errResp)
		return
	}

	if req.Content == "" {
		errResp := ErrorResponse{Error: "message content cannot be empty"}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errResp)
		return
	}

	if err := h.sendMessage(req.Content); err != nil {
		errResp := ErrorResponse{Error: fmt.Sprintf("failed to send message: %v", err)}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(errResp)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "message sent"})
}
