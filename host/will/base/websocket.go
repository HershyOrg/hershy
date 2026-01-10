package base

import (
	"context"
	"errors"

	"host/will/models"
)

// WebSocketState represents connection state.
type WebSocketState string

const (
	WebSocketDisconnected WebSocketState = "disconnected"
	WebSocketConnecting   WebSocketState = "connecting"
	WebSocketConnected    WebSocketState = "connected"
	WebSocketReconnecting WebSocketState = "reconnecting"
	WebSocketClosed       WebSocketState = "closed"
)

// OrderbookWebSocket defines a market data websocket interface.
type OrderbookWebSocket interface {
	// Connect establishes the websocket connection.
	Connect(ctx context.Context) error
	// Disconnect closes the websocket connection.
	Disconnect(ctx context.Context) error
	// WatchOrderbookByMarket subscribes to orderbook updates.
	WatchOrderbookByMarket(ctx context.Context, marketID string, tokenIDs []string, callback func(marketID string, orderbook models.OrderbookData)) error
	// GetOrderbookManager returns the internal orderbook manager.
	GetOrderbookManager() *models.OrderbookManager
}

// UserWebSocket defines a user data websocket interface.
type UserWebSocket interface {
	// OnTrade registers a trade callback.
	OnTrade(callback func(Trade))
	// Start begins receiving events.
	Start() error
	// Stop terminates the websocket.
	Stop() error
}

// BaseOrderbookWebSocket provides a minimal stub implementation.
type BaseOrderbookWebSocket struct {
	// State is the current connection state.
	State WebSocketState
	// Manager stores orderbook snapshots.
	Manager *models.OrderbookManager
	// Verbose toggles verbose logging.
	Verbose bool
}

// Connect marks the websocket as connected.
func (b *BaseOrderbookWebSocket) Connect(_ context.Context) error {
	b.State = WebSocketConnected
	if b.Manager == nil {
		b.Manager = models.NewOrderbookManager()
	}
	return nil
}

// Disconnect marks the websocket as closed.
func (b *BaseOrderbookWebSocket) Disconnect(_ context.Context) error {
	b.State = WebSocketClosed
	return nil
}

// WatchOrderbookByMarket returns not implemented by default.
func (b *BaseOrderbookWebSocket) WatchOrderbookByMarket(_ context.Context, _ string, _ []string, _ func(string, models.OrderbookData)) error {
	return errors.New("watch orderbook not implemented")
}

// GetOrderbookManager returns the manager.
func (b *BaseOrderbookWebSocket) GetOrderbookManager() *models.OrderbookManager {
	if b.Manager == nil {
		b.Manager = models.NewOrderbookManager()
	}
	return b.Manager
}
