package main

import (
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

type binanceKlineMsg struct {
	Stream string `json:"stream"`
	Data   struct {
		Event string `json:"e"`
		Kline struct {
			StartTime int64  `json:"t"`
			Interval  string `json:"i"`
			Open      string `json:"o"`
			Close     string `json:"c"`
			Volume    string `json:"v"`
		} `json:"k"`
	} `json:"data"`
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
			time.Sleep(200 * time.Millisecond)
			continue
		}

		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		var msg binanceKlineMsg
		if err := conn.ReadJSON(&msg); err != nil {
			if b.stopped.Load() {
				return
			}
			fmt.Printf("[WARN] websocket disconnected: %v; reconnecting in 5s\n", err)
			if err := b.reconnect(); err != nil {
				fmt.Printf("[WARN] reconnect failed: %v\n", err)
			}
			continue
		}
		if msg.Data.Event != "kline" {
			continue
		}
		open := parseFloatString(msg.Data.Kline.Open)
		closeP := parseFloatString(msg.Data.Kline.Close)
		vol := parseFloatString(msg.Data.Kline.Volume)
		if closeP <= 0 {
			continue
		}
		event := KlineEvent{
			Interval:    msg.Data.Kline.Interval,
			StartTimeMs: msg.Data.Kline.StartTime,
			Open:        open,
			Close:       closeP,
			Volume:      vol,
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
