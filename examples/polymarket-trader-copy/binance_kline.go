package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const binanceWSURL = "wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1s/btcusdt@kline_1h"

type BinanceKlineStream struct {
	events    chan any
	connected atomic.Bool
	wsConn    *websocket.Conn
	mu        sync.RWMutex
	stopChan  chan struct{}
	stopped   atomic.Bool
	url       string
}

func NewBinanceKlineStream(url string) *BinanceKlineStream {
	if strings.TrimSpace(url) == "" {
		url = binanceWSURL
	}
	return &BinanceKlineStream{
		events:   make(chan any, 1000),
		stopChan: make(chan struct{}),
		url:      url,
	}
}

func (b *BinanceKlineStream) Events() <-chan any {
	return b.events
}

func (b *BinanceKlineStream) Connect() error {
	if b.stopped.Load() {
		return fmt.Errorf("stream already stopped")
	}
	conn, _, err := websocket.DefaultDialer.Dial(b.url, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to Binance: %w", err)
	}
	b.mu.Lock()
	b.wsConn = conn
	b.mu.Unlock()
	b.connected.Store(true)

	// Seed one placeholder event so WatchFlow variable is initialized immediately.
	// Strategy code ignores unknown intervals, so this only affects watcher UI state.
	seed := KlineEvent{
		Interval:    "init",
		StartTimeMs: time.Now().UnixMilli(),
	}
	select {
	case b.events <- any(seed):
	default:
	}

	go b.receiveLoop()
	return nil
}

func (b *BinanceKlineStream) Stop() {
	if b.stopped.Load() {
		return
	}
	b.stopped.Store(true)
	close(b.stopChan)
	b.mu.Lock()
	if b.wsConn != nil {
		_ = b.wsConn.Close()
		b.wsConn = nil
	}
	b.mu.Unlock()
	close(b.events)
}

func (b *BinanceKlineStream) receiveLoop() {
	defer b.connected.Store(false)
	for {
		select {
		case <-b.stopChan:
			return
		default:
		}

		b.mu.RLock()
		conn := b.wsConn
		b.mu.RUnlock()
		if conn == nil {
			if err := b.reconnect(); err != nil {
				if b.stopped.Load() {
					return
				}
				fmt.Printf("[WARN] reconnect failed: %v\n", err)
			}
			continue
		}

		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		_, payload, err := conn.ReadMessage()
		if err != nil {
			if b.stopped.Load() {
				return
			}
			fmt.Printf("[WARN] websocket disconnected: %v; reconnecting in 5s\n", err)
			if err := b.reconnect(); err != nil {
				fmt.Printf("[WARN] reconnect failed: %v\n", err)
			}
			continue
		}

		event, ok := parseKlinePayload(payload)
		if !ok {
			continue
		}
		select {
		case b.events <- any(event):
		default:
		}
	}
}

func (b *BinanceKlineStream) reconnect() error {
	if b.stopped.Load() {
		return fmt.Errorf("stream stopped")
	}
	b.connected.Store(false)
	b.mu.Lock()
	if b.wsConn != nil {
		_ = b.wsConn.Close()
		b.wsConn = nil
	}
	b.mu.Unlock()
	time.Sleep(5 * time.Second)
	conn, _, err := websocket.DefaultDialer.Dial(b.url, nil)
	if err != nil {
		return fmt.Errorf("failed to reconnect to Binance: %w", err)
	}
	b.mu.Lock()
	b.wsConn = conn
	b.mu.Unlock()
	b.connected.Store(true)
	return nil
}

func parseFloatString(value string) float64 {
	v := 0.0
	_, _ = fmt.Sscanf(value, "%f", &v)
	return v
}

func anyToString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	default:
		return ""
	}
}

func parseFloatAny(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		return parseFloatString(v)
	default:
		return 0
	}
}

func parseInt64Any(value any) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case float32:
		return int64(v)
	case string:
		out := int64(0)
		_, _ = fmt.Sscanf(v, "%d", &out)
		return out
	default:
		return 0
	}
}

func parseKlinePayload(payload []byte) (KlineEvent, bool) {
	var root map[string]any
	if err := json.Unmarshal(payload, &root); err != nil {
		return KlineEvent{}, false
	}
	data, ok := root["data"].(map[string]any)
	if !ok {
		return KlineEvent{}, false
	}
	if anyToString(data["e"]) != "kline" {
		return KlineEvent{}, false
	}
	kline, ok := data["k"].(map[string]any)
	if !ok {
		return KlineEvent{}, false
	}
	event := KlineEvent{
		Interval:    anyToString(kline["i"]),
		StartTimeMs: parseInt64Any(kline["t"]),
		Open:        parseFloatAny(kline["o"]),
		Close:       parseFloatAny(kline["c"]),
		Volume:      parseFloatAny(kline["v"]),
	}
	if event.Interval == "" || event.StartTimeMs == 0 || event.Close <= 0 {
		return KlineEvent{}, false
	}
	return event, true
}
