package hersh

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"hersh/api"
	"hersh/manager"
)

// WatcherAPIServer provides HTTP API for Watcher monitoring and control
type WatcherAPIServer struct {
	watcher  *Watcher
	server   *http.Server
	handlers *api.WatcherAPIHandlers
}

// loggerAdapter adapts manager.Logger to api.LoggerInterface
type loggerAdapter struct {
	logger *manager.Logger
}

func (la *loggerAdapter) GetEffectLog() []interface{} {
	logs := la.logger.GetEffectLog()
	result := make([]interface{}, len(logs))
	for i, log := range logs {
		result[i] = log
	}
	return result
}

func (la *loggerAdapter) GetReduceLog() []interface{} {
	logs := la.logger.GetReduceLog()
	result := make([]interface{}, len(logs))
	for i, log := range logs {
		result[i] = log
	}
	return result
}

func (la *loggerAdapter) GetWatchErrorLog() []interface{} {
	logs := la.logger.GetWatchErrorLog()
	result := make([]interface{}, len(logs))
	for i, log := range logs {
		result[i] = log
	}
	return result
}

func (la *loggerAdapter) GetContextLog() []interface{} {
	logs := la.logger.GetContextLog()
	result := make([]interface{}, len(logs))
	for i, log := range logs {
		result[i] = log
	}
	return result
}

func (la *loggerAdapter) GetStateTransitionFaultLog() []interface{} {
	logs := la.logger.GetStateTransitionFaultLog()
	result := make([]interface{}, len(logs))
	for i, log := range logs {
		result[i] = log
	}
	return result
}

// signalsAdapter adapts manager.SignalChannels to api.SignalsInterface
type signalsAdapter struct {
	signals *manager.SignalChannels
}

func (sa *signalsAdapter) GetVarSigCount() int {
	return len(sa.signals.VarSigChan)
}

func (sa *signalsAdapter) GetUserSigCount() int {
	return len(sa.signals.UserSigChan)
}

func (sa *signalsAdapter) GetWatcherSigCount() int {
	return len(sa.signals.WatcherSigChan)
}

// StartAPIServer starts the HTTP API server (non-blocking)
func (w *Watcher) StartAPIServer() (*WatcherAPIServer, error) {
	if w.config.ServerPort == 0 {
		return nil, nil // API disabled
	}

	// Create adapters
	loggerAdp := &loggerAdapter{logger: w.manager.GetLogger()}
	signalsAdp := &signalsAdapter{signals: w.manager.GetSignals()}

	// Create handlers with closures
	handlers := api.NewWatcherAPIHandlers(
		func() string {
			return w.GetState().String()
		},
		func() bool {
			return w.isRunning.Load()
		},
		func() string {
			return w.manager.GetEffectHandler().GetHershContext().WatcherID()
		},
		func() api.LoggerInterface {
			return loggerAdp
		},
		func() api.SignalsInterface {
			return signalsAdp
		},
		func(content string) error {
			return w.SendMessage(content)
		},
	)

	mux := http.NewServeMux()

	// Register routes
	mux.HandleFunc("GET /watcher/status", handlers.HandleStatus)
	mux.HandleFunc("GET /watcher/logs", handlers.HandleLogs)
	mux.HandleFunc("GET /watcher/signals", handlers.HandleSignals)
	mux.HandleFunc("POST /watcher/message", handlers.HandleMessage)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", w.config.ServerPort),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	apiServer := &WatcherAPIServer{
		watcher:  w,
		server:   server,
		handlers: handlers,
	}

	// Start server in background goroutine
	go func() {
		fmt.Printf("[WatcherAPI] Starting HTTP server on :%d\n", w.config.ServerPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("[WatcherAPI] Server error: %v\n", err)
		}
	}()

	// Give server time to start
	time.Sleep(100 * time.Millisecond)

	return apiServer, nil
}

// Shutdown gracefully shuts down the API server
func (s *WatcherAPIServer) Shutdown(ctx context.Context) error {
	if s == nil || s.server == nil {
		return nil
	}

	fmt.Println("[WatcherAPI] Shutting down HTTP server...")
	return s.server.Shutdown(ctx)
}

// Close immediately closes the API server without waiting for connections
func (s *WatcherAPIServer) Close() error {
	if s == nil || s.server == nil {
		return nil
	}

	fmt.Println("[WatcherAPI] Force closing HTTP server...")
	return s.server.Close()
}
