package exchanges

import (
	"context"
	"errors"
	"math"
	"sync"
	"time"

	"cctx/base"
	"cctx/models"
	"cctx/utils"
)

// WebSocketState represents websocket connection state.
type WebSocketState string

const (
	WebSocketDisconnected WebSocketState = "disconnected"
	WebSocketConnecting   WebSocketState = "connecting"
	WebSocketConnected    WebSocketState = "connected"
	WebSocketReconnecting WebSocketState = "reconnecting"
	WebSocketClosed       WebSocketState = "closed"
)

// OrderbookUpdate represents an orderbook update.
type OrderbookUpdate struct {
	// Slug is the market slug.
	Slug string
	// Bids are bid levels for the market.
	Bids []models.PriceLevel
	// Asks are ask levels for the market.
	Asks []models.PriceLevel
	// Timestamp is the update time.
	Timestamp time.Time
}

// PriceUpdate represents a price update.
type PriceUpdate struct {
	// MarketAddress is the market contract address.
	MarketAddress string
	// YesPrice is the current Yes price.
	YesPrice float64
	// NoPrice is the current No price.
	NoPrice float64
	// BlockNumber is the block number for the update.
	BlockNumber int64
	// Timestamp is the update time.
	Timestamp time.Time
}

// PositionUpdate represents a position update.
type PositionUpdate struct {
	// Account is the owner address.
	Account string
	// MarketAddress is the market contract address.
	MarketAddress string
	// TokenID is the token identifier.
	TokenID string
	// Balance is the token balance.
	Balance float64
	// OutcomeIndex is the outcome index.
	OutcomeIndex int
	// MarketType indicates AMM vs CLOB.
	MarketType string
}

// LimitlessTrade represents a trade/fill event.
type LimitlessTrade struct {
	// ID is the trade identifier.
	ID string
	// OrderID is the associated order identifier.
	OrderID string
	// MarketID is the market identifier.
	MarketID string
	// AssetID is the token identifier.
	AssetID string
	// Side is the trade side.
	Side string
	// Price is the trade price.
	Price float64
	// Size is the trade size.
	Size float64
	// Fee is the trade fee.
	Fee float64
	// Timestamp is the trade time.
	Timestamp time.Time
	// Outcome is the outcome label.
	Outcome string
	// Taker is the taker address.
	Taker string
	// Maker is the maker address.
	Maker string
	// TransactionHash is the tx hash.
	TransactionHash string
}

// LimitlessWebSocket is a stub implementation for orderbook updates.
type LimitlessWebSocket struct {
	// BaseOrderbookWebSocket embeds shared websocket behavior.
	base.BaseOrderbookWebSocket
	// State is the websocket connection state.
	State WebSocketState
	// exchange is the underlying Limitless exchange.
	exchange *Limitless
	// pollInterval is the polling interval for REST orderbooks.
	pollInterval time.Duration
	// cancel stops the polling loop.
	cancel context.CancelFunc
	// mu guards internal state.
	mu sync.Mutex
}


// NewLimitlessWebSocket creates a new polling websocket.
func NewLimitlessWebSocket(config map[string]any) *LimitlessWebSocket {
	ws := &LimitlessWebSocket{}
	if config != nil {
		if ex, ok := config["exchange"].(*Limitless); ok {
			ws.exchange = ex
		}
		if interval, ok := config["poll_interval"].(time.Duration); ok && interval > 0 {
			ws.pollInterval = interval
		}
	}
	if ws.pollInterval == 0 {
		ws.pollInterval = 2 * time.Second
	}
	return ws
}

// Connect marks the websocket as connected.
func (l *LimitlessWebSocket) Connect(ctx context.Context) error {
	l.State = WebSocketConnected
	return l.BaseOrderbookWebSocket.Connect(ctx)
}

// Disconnect marks the websocket as closed.
func (l *LimitlessWebSocket) Disconnect(ctx context.Context) error {
	l.State = WebSocketClosed
	l.mu.Lock()
	if l.cancel != nil {
		l.cancel()
		l.cancel = nil
	}
	l.mu.Unlock()
	return l.BaseOrderbookWebSocket.Disconnect(ctx)
}

// WatchOrderbookByMarket polls the REST orderbook and updates the manager.
func (l *LimitlessWebSocket) WatchOrderbookByMarket(ctx context.Context, marketID string, tokenIDs []string, callback func(string, models.OrderbookData)) error {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.LimitlessWebSocket.WatchOrderbookByMarket: marketID empty")
	}
	if len(tokenIDs) == 0 {
		utils.DefaultLogger().Debugf("exchanges.LimitlessWebSocket.WatchOrderbookByMarket: tokenIDs empty")
	}
	if l.exchange == nil {
		return errors.New("limitless websocket missing exchange")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	l.mu.Lock()
	if l.cancel != nil {
		l.cancel()
	}
	localCtx, cancel := context.WithCancel(ctx)
	l.cancel = cancel
	l.mu.Unlock()

	yesToken := ""
	noToken := ""
	if len(tokenIDs) > 0 {
		yesToken = tokenIDs[0]
	}
	if len(tokenIDs) > 1 {
		noToken = tokenIDs[1]
	}

	updateOnce := func() {
		raw, err := l.exchange.GetOrderbook(marketID)
		if err != nil {
			return
		}
		orderbook := models.FromRESTResponse(raw, yesToken)
		orderbook.Timestamp = time.Now().UnixMilli()
		orderbook.MarketID = marketID
		if yesToken != "" {
			l.GetOrderbookManager().Update(yesToken, orderbook.ToData())
		}
		if noToken != "" {
			noBids := invertLevels(orderbook.Asks, true)
			noAsks := invertLevels(orderbook.Bids, false)
			noData := models.OrderbookData{
				Bids:      noBids,
				Asks:      noAsks,
				Timestamp: orderbook.Timestamp,
				AssetID:   noToken,
				MarketID:  marketID,
			}
			l.GetOrderbookManager().Update(noToken, noData)
		}
		if callback != nil {
			callback(marketID, orderbook.ToData())
		}
	}

	go func() {
		ticker := time.NewTicker(l.pollInterval)
		defer ticker.Stop()
		updateOnce()
		for {
			select {
			case <-localCtx.Done():
				return
			case <-ticker.C:
				updateOnce()
			}
		}
	}()
	return nil
}

// GetOrderbookManager returns the manager.
func (l *LimitlessWebSocket) GetOrderbookManager() *models.OrderbookManager {
	return l.BaseOrderbookWebSocket.GetOrderbookManager()
}

// LimitlessUserWebSocket is a stub user websocket.
type LimitlessUserWebSocket struct {
	// callback handles incoming trade events.
	callback func(base.Trade)
}

// NewLimitlessUserWebSocket creates a user websocket stub.
func NewLimitlessUserWebSocket(_ map[string]any) *LimitlessUserWebSocket {
	return &LimitlessUserWebSocket{}
}

// OnTrade registers the trade callback.
func (l *LimitlessUserWebSocket) OnTrade(callback func(base.Trade)) {
	l.callback = callback
}

// Start starts the websocket (no-op).
func (l *LimitlessUserWebSocket) Start() error {
	return nil
}

// Stop stops the websocket (no-op).
func (l *LimitlessUserWebSocket) Stop() error {
	return nil
}

// invertLevels converts yes-side levels to no-side levels.
func invertLevels(levels []models.PriceLevel, descending bool) []models.PriceLevel {
	if len(levels) == 0 {
		return nil
	}
	out := make([]models.PriceLevel, 0, len(levels))
	for _, level := range levels {
		price := math.Round((1-level.Price)*1000) / 1000
		out = append(out, models.PriceLevel{
			Price: price,
			Size:  level.Size,
		})
	}
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if descending && out[j].Price > out[i].Price {
				out[i], out[j] = out[j], out[i]
			}
			if !descending && out[j].Price < out[i].Price {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}
