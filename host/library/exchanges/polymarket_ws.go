package exchanges

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"host/library/base"
	"host/library/models"
	"host/library/utils"

	"github.com/gorilla/websocket"
)

const (
	polymarketMarketWSURL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
	polymarketUserWSURL   = "wss://ws-subscriptions-clob.polymarket.com/ws/user"
)

// PolymarketWebSocket handles market data subscriptions.
type PolymarketWebSocket struct {
	// url is the websocket endpoint.
	url string
	// conn is the active websocket connection.
	conn *websocket.Conn
	// verbose toggles verbose logging.
	verbose bool
	// subscriptions maps token IDs to callbacks.
	subscriptions map[string]func(string, models.OrderbookData)
	// orderbookManager stores orderbook snapshots.
	orderbookManager *models.OrderbookManager
	// mu guards connection state.
	mu sync.Mutex
	// closed indicates connection state.
	closed bool
}

// NewPolymarketWebSocket creates a WebSocket client.
func NewPolymarketWebSocket(config map[string]any, _ *Polymarket) *PolymarketWebSocket {
	verbose := false
	if config != nil {
		if v, ok := config["verbose"].(bool); ok {
			verbose = v
		}
	}
	return &PolymarketWebSocket{
		url:              polymarketMarketWSURL,
		verbose:          verbose,
		subscriptions:    map[string]func(string, models.OrderbookData){},
		orderbookManager: models.NewOrderbookManager(),
	}
}

// Connect establishes the websocket connection.
func (p *PolymarketWebSocket) Connect(ctx context.Context) error {
	if p.url == "" {
		utils.DefaultLogger().Debugf("exchanges.PolymarketWebSocket.Connect: url empty")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn != nil {
		return nil
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, p.url, nil)
	if err != nil {
		return err
	}
	p.conn = conn
	p.closed = false
	go p.readLoop()
	return nil
}

// Disconnect closes the websocket connection.
func (p *PolymarketWebSocket) Disconnect(_ context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	if p.conn != nil {
		err := p.conn.Close()
		p.conn = nil
		return err
	}
	return nil
}

// WatchOrderbookByMarket subscribes to orderbook updates.
func (p *PolymarketWebSocket) WatchOrderbookByMarket(ctx context.Context, marketID string, tokenIDs []string, callback func(string, models.OrderbookData)) error {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.PolymarketWebSocket.WatchOrderbookByMarket: marketID empty")
	}
	if len(tokenIDs) == 0 {
		utils.DefaultLogger().Debugf("exchanges.PolymarketWebSocket.WatchOrderbookByMarket: tokenIDs empty")
	}
	if err := p.Connect(ctx); err != nil {
		return err
	}
	p.mu.Lock()
	for _, tokenID := range tokenIDs {
		tokenID := tokenID
		p.subscriptions[tokenID] = func(_ string, orderbook models.OrderbookData) {
			p.orderbookManager.Update(tokenID, orderbook)
			if callback != nil {
				callback(marketID, orderbook)
			}
		}
	}
	p.mu.Unlock()

	subscribe := map[string]any{
		"auth":       map[string]any{},
		"markets":    []string{},
		"assets_ids": tokenIDs,
		"type":       "market",
	}
	return p.writeJSON(subscribe)
}

// GetOrderbookManager returns the internal orderbook manager.
func (p *PolymarketWebSocket) GetOrderbookManager() *models.OrderbookManager {
	if p.orderbookManager == nil {
		p.orderbookManager = models.NewOrderbookManager()
	}
	return p.orderbookManager
}

// writeJSON sends a JSON payload on the websocket.
func (p *PolymarketWebSocket) writeJSON(payload any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn == nil {
		return errors.New("websocket not connected")
	}
	return p.conn.WriteJSON(payload)
}

// readLoop reads websocket messages and dispatches updates.
func (p *PolymarketWebSocket) readLoop() {
	for {
		p.mu.Lock()
		conn := p.conn
		closed := p.closed
		p.mu.Unlock()
		if closed || conn == nil {
			return
		}
		_, message, err := conn.ReadMessage()
		if err != nil {
			return
		}
		p.handleMessage(message)
	}
}

// handleMessage dispatches a raw websocket message.
func (p *PolymarketWebSocket) handleMessage(message []byte) {
	var payload any
	if err := json.Unmarshal(message, &payload); err != nil {
		return
	}
	switch data := payload.(type) {
	case []any:
		for _, item := range data {
			p.processItem(item)
		}
	default:
		p.processItem(payload)
	}
}

// processItem routes a parsed payload item.
func (p *PolymarketWebSocket) processItem(item any) {
	row := toMap(item)
	eventType := toString(row["event_type"])
	switch eventType {
	case "book":
		p.handleBook(row)
	case "price_change":
		p.handlePriceChange(row)
	}
}

// handleBook processes orderbook snapshots.
func (p *PolymarketWebSocket) handleBook(row map[string]any) {
	assetID := toString(row["asset_id"])
	marketID := toString(row["market"])
	bids := parseLevels(row["bids"])
	asks := parseLevels(row["asks"])
	orderbook := models.OrderbookData{
		Bids:      bids,
		Asks:      asks,
		Timestamp: toInt64(row["timestamp"]),
		AssetID:   assetID,
		MarketID:  marketID,
	}
	p.dispatch(assetID, orderbook)
}

// handlePriceChange processes price change events.
func (p *PolymarketWebSocket) handlePriceChange(row map[string]any) {
	changes := toSlice(row["price_changes"])
	if len(changes) == 0 {
		return
	}
	change := toMap(changes[0])
	assetID := toString(change["asset_id"])
	marketID := toString(row["market"])
	bestBid := toFloat(change["best_bid"])
	bestAsk := toFloat(change["best_ask"])
	bids := []models.PriceLevel{}
	asks := []models.PriceLevel{}
	if bestBid > 0 {
		bids = append(bids, models.PriceLevel{Price: bestBid, Size: 0})
	}
	if bestAsk > 0 {
		asks = append(asks, models.PriceLevel{Price: bestAsk, Size: 0})
	}
	orderbook := models.OrderbookData{
		Bids:      bids,
		Asks:      asks,
		Timestamp: toInt64(row["timestamp"]),
		AssetID:   assetID,
		MarketID:  marketID,
	}
	p.dispatch(assetID, orderbook)
}

// dispatch sends an orderbook update to subscribers.
func (p *PolymarketWebSocket) dispatch(assetID string, orderbook models.OrderbookData) {
	p.mu.Lock()
	callback := p.subscriptions[assetID]
	p.mu.Unlock()
	if callback != nil {
		callback(assetID, orderbook)
	}
}

// parseLevels converts raw levels into price levels.
func parseLevels(raw any) []models.PriceLevel {
	items := toSlice(raw)
	out := []models.PriceLevel{}
	for _, item := range items {
		row := toMap(item)
		price := toFloat(row["price"])
		size := toFloat(row["size"])
		if price > 0 && size >= 0 {
			out = append(out, models.PriceLevel{Price: price, Size: size})
		}
	}
	return out
}

// PolymarketUserWebSocket handles user trade updates.
type PolymarketUserWebSocket struct {
	// apiKey is the API key for user auth.
	apiKey string
	// apiSecret is the API secret for user auth.
	apiSecret string
	// apiPassphrase is the API passphrase for user auth.
	apiPassphrase string
	// verbose toggles verbose logging.
	verbose bool
	// conn is the active websocket connection.
	conn *websocket.Conn
	// callbacks are trade event handlers.
	callbacks []func(base.Trade)
	// mu guards connection state.
	mu sync.Mutex
	// stop signals shutdown.
	stop chan struct{}
}

// NewPolymarketUserWebSocket creates a user websocket client.
func NewPolymarketUserWebSocket(apiKey, apiSecret, apiPassphrase string, verbose bool) *PolymarketUserWebSocket {
	return &PolymarketUserWebSocket{
		apiKey:        apiKey,
		apiSecret:     apiSecret,
		apiPassphrase: apiPassphrase,
		verbose:       verbose,
		stop:          make(chan struct{}),
	}
}

// OnTrade registers a trade callback.
func (p *PolymarketUserWebSocket) OnTrade(callback func(base.Trade)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.callbacks = append(p.callbacks, callback)
}

// Start connects and starts the user websocket.
func (p *PolymarketUserWebSocket) Start() error {
	p.mu.Lock()
	if p.conn != nil {
		p.mu.Unlock()
		return nil
	}
	conn, _, err := websocket.DefaultDialer.Dial(polymarketUserWSURL, nil)
	if err != nil {
		p.mu.Unlock()
		return err
	}
	p.conn = conn
	p.mu.Unlock()

	auth := map[string]any{
		"auth": map[string]any{
			"apiKey":     p.apiKey,
			"secret":     p.apiSecret,
			"passphrase": p.apiPassphrase,
			"timestamp":  time.Now().Unix(),
		},
		"type": "user",
	}
	if err := conn.WriteJSON(auth); err != nil {
		return err
	}
	go p.readLoop()
	return nil
}

// Stop closes the user websocket.
func (p *PolymarketUserWebSocket) Stop() error {
	close(p.stop)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn != nil {
		err := p.conn.Close()
		p.conn = nil
		return err
	}
	return nil
}

// readLoop reads and processes user websocket messages.
func (p *PolymarketUserWebSocket) readLoop() {
	for {
		select {
		case <-p.stop:
			return
		default:
		}
		p.mu.Lock()
		conn := p.conn
		p.mu.Unlock()
		if conn == nil {
			return
		}
		_, message, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var payload any
		if err := json.Unmarshal(message, &payload); err != nil {
			continue
		}
		switch data := payload.(type) {
		case []any:
			for _, item := range data {
				p.processUserItem(item)
			}
		default:
			p.processUserItem(payload)
		}
	}
}

// processUserItem parses a user payload item into a trade.
func (p *PolymarketUserWebSocket) processUserItem(item any) {
	row := toMap(item)
	msgType := strings.ToUpper(toString(row["type"]))
	if msgType != "TRADE" {
		return
	}
	orderID := toString(firstNonEmpty(row["taker_order_id"], row["maker_order_id"]))
	price := toFloat(row["price"])
	size := toFloat(row["size"])
	if size <= 0 {
		return
	}
	trade := base.Trade{
		OrderID:  orderID,
		MarketID: toString(row["market"]),
		Outcome:  toString(row["outcome"]),
		Price:    price,
		Size:     size,
	}
	p.emit(trade)
}

// emit sends a trade to all registered callbacks.
func (p *PolymarketUserWebSocket) emit(trade base.Trade) {
	p.mu.Lock()
	callbacks := append([]func(base.Trade){}, p.callbacks...)
	p.mu.Unlock()
	for _, callback := range callbacks {
		callback(trade)
	}
}
