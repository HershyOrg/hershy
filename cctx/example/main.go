package main

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"sync"
	"time"

	"cctx/base"
	"cctx/exchanges"
	"cctx/models"
	"cctx/utils"
)

type mockExchange struct {
	base.BaseExchange
	market    models.Market
	orders    map[string]models.Order
	positions []models.Position
	balance   map[string]float64
	orderbook map[string]map[string]any
	nextID    int
	ws        *mockWebSocket
	userWS    *mockUserWebSocket
	mu        sync.Mutex
}

type mockWebSocket struct {
	manager  *models.OrderbookManager
	exchange *mockExchange
	mu       sync.Mutex
	marketID string
	tokenIDs map[string]bool
	callback func(string, models.OrderbookData)
	started  bool
	stopCh   chan struct{}

	publishQueue chan string
	latency      time.Duration
	jitter       time.Duration
}

type mockUserWebSocket struct {
	callback func(base.Trade)
}

// newMockExchange builds a mock exchange with seeded market state.
func newMockExchange(config map[string]any) (base.Exchange, error) {
	ex := &mockExchange{
		BaseExchange: base.NewBaseExchange(config),
		orders:       map[string]models.Order{},
		balance:      map[string]float64{"USDC": 100},
		nextID:       1,
	}
	ex.market = models.Market{
		ID:        "mock-binary-1",
		Question:  "Will BTC be above $50k by Friday?",
		Outcomes:  []string{"Yes", "No"},
		Liquidity: 5000,
		Prices:    map[string]float64{"Yes": 0.6, "No": 0.4},
		Metadata: map[string]any{
			"clobTokenIds": []string{"token-yes-1", "token-no-1"},
			"tokens":       map[string]any{"Yes": "token-yes-1", "No": "token-no-1"},
		},
		TickSize: 0.01,
	}
	ex.positions = []models.Position{
		{
			MarketID:     ex.market.ID,
			Outcome:      "Yes",
			Size:         10,
			AveragePrice: 0.55,
			CurrentPrice: 0.6,
		},
	}
	ex.orderbook = map[string]map[string]any{
		"token-yes-1": {
			"bids": []any{
				map[string]any{"price": "0.60", "size": "50"},
			},
			"asks": []any{
				map[string]any{"price": "0.70", "size": "40"},
			},
		},
		"token-no-1": {
			"bids": []any{
				map[string]any{"price": "0.30", "size": "30"},
			},
			"asks": []any{
				map[string]any{"price": "0.40", "size": "20"},
			},
		},
	}
	//ex.ws=마켓 데이터용 웹소켓
	ex.ws = &mockWebSocket{
		manager:      models.NewOrderbookManager(),
		exchange:     ex,
		stopCh:       make(chan struct{}),
		publishQueue: make(chan string, 128),
		latency:      80 * time.Millisecond,
		jitter:       140 * time.Millisecond,
	}
	//ex.UserWs=주문 트래킹 소켓
	ex.userWS = &mockUserWebSocket{}
	ex.BaseExchange.Bind(ex)
	return ex, nil
}

// ID returns the exchange identifier.
func (m *mockExchange) ID() string {
	return "mock"
}

// Name returns the exchange display name.
func (m *mockExchange) Name() string {
	return "MockExchange"
}

// FetchMarkets returns the single mock market.
func (m *mockExchange) FetchMarkets(_ map[string]any) ([]models.Market, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return []models.Market{m.market}, nil
}

// FetchMarket returns the mock market snapshot.
func (m *mockExchange) FetchMarket(_ string) (models.Market, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.market, nil
}

// CreateOrder records a new order in the mock exchange.
func (m *mockExchange) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, _ map[string]any) (models.Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := fmt.Sprintf("order-%d", m.nextID)
	m.nextID++
	now := time.Now().UTC()
	order := models.Order{
		ID:        id,
		MarketID:  marketID,
		Outcome:   outcome,
		Side:      side,
		Price:     price,
		Size:      size,
		Status:    models.OrderStatusOpen,
		CreatedAt: now,
		UpdatedAt: &now,
	}
	m.orders[id] = order
	return order, nil
}

// CancelOrder marks a mock order as cancelled.
func (m *mockExchange) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	order := m.orders[orderID]
	order.Status = models.OrderStatusCancelled
	order.MarketID = deref(marketID)
	m.orders[orderID] = order
	return order, nil
}

// FetchOrder returns a mock order by ID.
func (m *mockExchange) FetchOrder(orderID string, _ *string) (models.Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.orders[orderID], nil
}

// FetchOpenOrders returns all open mock orders.
func (m *mockExchange) FetchOpenOrders(_ *string, _ map[string]any) ([]models.Order, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	open := []models.Order{}
	for _, order := range m.orders {
		if order.IsOpen() {
			open = append(open, order)
		}
	}
	return open, nil
}

// FetchPositions returns current mock positions.
func (m *mockExchange) FetchPositions(_ *string, _ map[string]any) ([]models.Position, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.positions, nil
}

// FetchBalance returns the mock balance snapshot.
func (m *mockExchange) FetchBalance() (map[string]float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.balance, nil
}

// GetOrderbook returns the mock orderbook for a token.
func (m *mockExchange) GetOrderbook(tokenID string) (map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if book, ok := m.orderbook[tokenID]; ok {
		return book, nil
	}
	return map[string]any{"bids": []any{}, "asks": []any{}}, nil
}

// GetWebsocket exposes the mock market websocket.
func (m *mockExchange) GetWebsocket() base.OrderbookWebSocket {
	if m.ws == nil {
		return nil
	}
	return m.ws
}

// GetUserWebsocket exposes the mock user websocket.
func (m *mockExchange) GetUserWebsocket() base.UserWebSocket {
	return m.userWS
}

// Connect prepares websocket state and starts publisher goroutine.
// *웹소켓 사용
func (w *mockWebSocket) Connect(_ context.Context) error {
	if w.manager == nil {
		w.manager = models.NewOrderbookManager()
	}
	w.startPublisher()
	return nil
}

// Disconnect stops the publisher goroutine.
// *웹소켓 사용
func (w *mockWebSocket) Disconnect(_ context.Context) error {
	w.stopPublisher()
	return nil
}

// WatchOrderbookByMarket registers subscriptions and pushes initial snapshots.
// *웹소켓 사용
func (w *mockWebSocket) WatchOrderbookByMarket(_ context.Context, marketID string, tokenIDs []string, callback func(string, models.OrderbookData)) error {
	w.mu.Lock()
	if w.tokenIDs == nil {
		w.tokenIDs = map[string]bool{}
	}
	for _, tokenID := range tokenIDs {
		w.tokenIDs[tokenID] = true
	}
	w.marketID = marketID
	w.callback = callback
	w.mu.Unlock()
	w.startPublisher()

	for _, tokenID := range tokenIDs {
		raw, _ := w.exchange.GetOrderbook(tokenID)
		orderbook := models.FromRESTResponse(raw, tokenID)
		orderbook.Timestamp = time.Now().UnixMilli()
		orderbook.MarketID = marketID
		w.manager.Update(tokenID, orderbook.ToData())
		if callback != nil {
			callback(marketID, orderbook.ToData())
		}
	}
	return nil
}

// GetOrderbookManager returns the websocket's orderbook manager.
func (w *mockWebSocket) GetOrderbookManager() *models.OrderbookManager {
	if w.manager == nil {
		w.manager = models.NewOrderbookManager()
	}
	return w.manager
}

// Publish emits an orderbook update for a subscribed token.
// *웹소켓 사용
func (w *mockWebSocket) Publish(tokenID string) {
	w.mu.Lock()
	callback := w.callback
	marketID := w.marketID
	subscribed := w.tokenIDs != nil && w.tokenIDs[tokenID]
	w.mu.Unlock()

	if !subscribed {
		return
	}

	raw, _ := w.exchange.GetOrderbook(tokenID)
	orderbook := models.FromRESTResponse(raw, tokenID)
	orderbook.Timestamp = time.Now().UnixMilli()
	orderbook.MarketID = marketID
	w.GetOrderbookManager().Update(tokenID, orderbook.ToData())
	if callback != nil {
		callback(marketID, orderbook.ToData())
	}
}

// Enqueue schedules a token for websocket publishing.
// *웹소켓 사용
func (w *mockWebSocket) Enqueue(tokenID string) {
	if tokenID == "" {
		return
	}
	select {
	case w.publishQueue <- tokenID:
	default:
	}
}

// startPublisher streams queued/heartbeat updates with latency.
// *웹소켓 사용
func (w *mockWebSocket) startPublisher() {
	w.mu.Lock()
	if w.started {
		w.mu.Unlock()
		return
	}
	w.started = true
	w.stopCh = make(chan struct{})
	stopCh := w.stopCh
	w.mu.Unlock()

	go func() {
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		ticker := time.NewTicker(150 * time.Millisecond)
		defer ticker.Stop()

		lastHeartbeat := time.Now()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				pending := w.drainQueue()
				if len(pending) == 0 && time.Since(lastHeartbeat) >= time.Second {
					pending = w.snapshotSubscribed()
					lastHeartbeat = time.Now()
				}
				if len(pending) == 0 {
					continue
				}
				for _, tokenID := range pending {
					sleepWithJitter(rng, w.latency, w.jitter)
					w.Publish(tokenID)
				}
			}
		}
	}()
}

// stopPublisher terminates the publisher goroutine.
// *웹소켓 사용
func (w *mockWebSocket) stopPublisher() {
	w.mu.Lock()
	if !w.started {
		w.mu.Unlock()
		return
	}
	w.started = false
	stopCh := w.stopCh
	w.mu.Unlock()
	close(stopCh)
}

// drainQueue deduplicates queued publish requests.
func (w *mockWebSocket) drainQueue() []string {
	seen := map[string]bool{}
	for {
		select {
		case tokenID := <-w.publishQueue:
			seen[tokenID] = true
		default:
			out := make([]string, 0, len(seen))
			for tokenID := range seen {
				out = append(out, tokenID)
			}
			return out
		}
	}
}

// snapshotSubscribed returns current subscriptions for heartbeats.
// *웹소켓 사용
func (w *mockWebSocket) snapshotSubscribed() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]string, 0, len(w.tokenIDs))
	for tokenID := range w.tokenIDs {
		out = append(out, tokenID)
	}
	return out
}

// OnTrade registers a fill callback.
// *웹소켓 사용
func (m *mockUserWebSocket) OnTrade(callback func(base.Trade)) {
	m.callback = callback
}

// Start begins user websocket processing (mock no-op).
// *웹소켓 사용
func (m *mockUserWebSocket) Start() error {
	return nil
}

// Stop ends user websocket processing (mock no-op).
// *웹소켓 사용
func (m *mockUserWebSocket) Stop() error {
	return nil
}

// EmitTrade pushes a fill event to the user callback.
// *웹소켓 사용
func (m *mockUserWebSocket) EmitTrade(trade base.Trade) {
	if m.callback != nil {
		m.callback(trade)
	}
}

// updateOrderbook updates the internal orderbook and notifies websocket.
func (m *mockExchange) updateOrderbook(tokenID string, bids, asks []any) {
	m.mu.Lock()
	m.orderbook[tokenID] = map[string]any{
		"bids": bids,
		"asks": asks,
	}
	ws := m.ws
	m.mu.Unlock()
	if ws != nil {
		ws.Enqueue(tokenID)
	}
}

// updateMarketPrices refreshes the mock mid prices.
func (m *mockExchange) updateMarketPrices(yesPrice float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.market.Prices == nil {
		m.market.Prices = map[string]float64{}
	}
	m.market.Prices["Yes"] = yesPrice
	m.market.Prices["No"] = 1 - yesPrice
}

// matchOrders produces mock fills based on top-of-book prices.
func (m *mockExchange) matchOrders(outcome string, bestBid, bestAsk float64) []base.Trade {
	m.mu.Lock()
	defer m.mu.Unlock()

	trades := []base.Trade{}
	for id, order := range m.orders {
		if order.Outcome != outcome || !order.IsOpen() {
			continue
		}
		remaining := order.Size - order.Filled
		if remaining <= 0 {
			continue
		}
		var fillPrice float64
		shouldFill := false
		if order.Side == models.OrderSideBuy && bestAsk > 0 && bestAsk <= order.Price {
			shouldFill = true
			fillPrice = bestAsk
		}
		if order.Side == models.OrderSideSell && bestBid > 0 && bestBid >= order.Price {
			shouldFill = true
			fillPrice = bestBid
		}
		if !shouldFill {
			continue
		}
		fillSize := remaining
		if remaining > 1 {
			fillSize = remaining / 2
		}
		order.Filled += fillSize
		if order.Filled >= order.Size {
			order.Status = models.OrderStatusFilled
		} else {
			order.Status = models.OrderStatusPartiallyFilled
		}
		now := time.Now().UTC()
		order.UpdatedAt = &now
		m.orders[id] = order
		m.applyFillLocked(order, fillPrice, fillSize)
		trades = append(trades, base.Trade{
			OrderID:  order.ID,
			MarketID: order.MarketID,
			Outcome:  order.Outcome,
			Price:    fillPrice,
			Size:     fillSize,
		})
	}
	return trades
}

// applyFillLocked updates positions and balances for a fill.
func (m *mockExchange) applyFillLocked(order models.Order, price, size float64) {
	if size <= 0 {
		return
	}
	if m.balance == nil {
		m.balance = map[string]float64{}
	}
	if order.Side == models.OrderSideBuy {
		m.balance["USDC"] -= price * size
	} else {
		m.balance["USDC"] += price * size
	}

	index := -1
	for i := range m.positions {
		if m.positions[i].MarketID == order.MarketID && m.positions[i].Outcome == order.Outcome {
			index = i
			break
		}
	}

	if index == -1 {
		if order.Side == models.OrderSideSell {
			return
		}
		m.positions = append(m.positions, models.Position{
			MarketID:     order.MarketID,
			Outcome:      order.Outcome,
			Size:         size,
			AveragePrice: price,
			CurrentPrice: price,
		})
		return
	}

	pos := m.positions[index]
	if order.Side == models.OrderSideBuy {
		totalCost := pos.AveragePrice*pos.Size + price*size
		pos.Size += size
		if pos.Size > 0 {
			pos.AveragePrice = totalCost / pos.Size
		}
		pos.CurrentPrice = price
		m.positions[index] = pos
		return
	}

	if order.Side == models.OrderSideSell {
		pos.Size -= size
		if pos.Size <= 0 {
			pos.Size = 0
			pos.AveragePrice = 0
		}
		pos.CurrentPrice = price
		m.positions[index] = pos
	}
}

// main wires the mock exchange, market simulation, and strategy runner.
func main() {
	exchange, err := base.CreateExchange("polymarket", newMockExchange, nil, map[string]string{"api_key": "mock-key"}, true, false)
	if err != nil {
		panic(err)
	}
	mock := exchange.(*mockExchange)

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		runMarketSimulation(ctx, mock, "mock-binary-1", "token-yes-1", "token-no-1")
	}()
	go func() {
		defer wg.Done()
		runOrderStrategy(ctx, exchange, time.Now().Add(10*time.Second))
	}()
	wg.Wait()

	if os.Getenv("RUN_POLYMARKET_EXAMPLE") == "1" {
		runPolymarketExample()
	}
}

// assertNear panics if actual deviates beyond tolerance.
func assertNear(actual, expected, tolerance float64, label string) {
	diff := actual - expected
	if diff < 0 {
		diff = -diff
	}
	if diff > tolerance {
		panic(fmt.Sprintf("%s failed: got %.4f expected %.4f", label, actual, expected))
	}
}

// deref returns the value or empty string.
func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// waitForEvent waits for a fill event or times out.
func waitForEvent(ch <-chan string) string {
	select {
	case event := <-ch:
		return event
	case <-time.After(2 * time.Second):
		panic("fill event not received")
	}
}

// flushLogs prints buffered logs for each logger.
func flushLogs(loggers ...*utils.Logger) {
	for _, logger := range loggers {
		if logger != nil {
			logger.Print()
		}
	}
}

// runPolymarketExample demonstrates a real exchange call.
func runPolymarketExample() {
	params := map[string]string{
		"private_key": "0x0000000000000000000000000000000000000000000000000000000000000000",
		"funder":      "0x0000000000000000000000000000000000000000",
		"api_key":     "mock-api-key",
	}
	exchange, err := base.CreateExchange("polymarket", exchanges.NewPolymarket, nil, params, true, false)
	if err != nil {
		panic(err)
	}

	client := base.NewExchangeClient(exchange, 2*time.Second, false)
	order, err := client.CreateOrder(
		"market-id",
		"Yes",
		models.OrderSideBuy,
		0.55,
		5,
		map[string]any{"token_id": "token-id"},
	)
	if err != nil {
		panic(err)
	}
	fmt.Printf("Polymarket order created: %s\n", order.ID)
}

type orderPlan struct {
	label   string
	outcome string
	side    models.OrderSide
	limit   float64
	size    float64
	tokenID string
}

type marketStep struct {
	label       string
	yesBid      float64
	yesAsk      float64
	noBid       float64
	noAsk       float64
	pause       time.Duration
	widenSpread bool
}

// runMarketSimulation mutates mock market state over time.
func runMarketSimulation(ctx context.Context, mock *mockExchange, marketID, yesTokenID, noTokenID string) {
	fmt.Printf("Market simulation started for %s\n", marketID)
	steps := []marketStep{
		{label: "tighten", yesBid: 0.59, yesAsk: 0.65, noBid: 0.32, noAsk: 0.38, pause: 500 * time.Millisecond},
		{label: "hit buys", yesBid: 0.58, yesAsk: 0.60, noBid: 0.33, noAsk: 0.36, pause: 700 * time.Millisecond},
		{label: "hit sells", yesBid: 0.71, yesAsk: 0.73, noBid: 0.39, noAsk: 0.42, pause: 700 * time.Millisecond},
		{label: "slippage", yesBid: 0.45, yesAsk: 0.72, noBid: 0.22, noAsk: 0.50, pause: 800 * time.Millisecond, widenSpread: true},
		{label: "recover", yesBid: 0.62, yesAsk: 0.66, noBid: 0.34, noAsk: 0.37, pause: 700 * time.Millisecond},
	}

	for _, step := range steps {
		if !sleepOrDone(ctx, step.pause) {
			return
		}
		yesBids, yesAsks := buildOrderbook(step.yesBid, step.yesAsk)
		noBids, noAsks := buildOrderbook(step.noBid, step.noAsk)
		mock.updateOrderbook(yesTokenID, yesBids, yesAsks)
		mock.updateOrderbook(noTokenID, noBids, noAsks)
		mock.updateMarketPrices((step.yesBid + step.yesAsk) / 2)
		fmt.Printf("Market step: %s (Yes %.2f/%.2f, No %.2f/%.2f)\n", step.label, step.yesBid, step.yesAsk, step.noBid, step.noAsk)

		for _, trade := range mock.matchOrders("Yes", step.yesBid, step.yesAsk) {
			mock.userWS.EmitTrade(trade)
		}
		for _, trade := range mock.matchOrders("No", step.noBid, step.noAsk) {
			mock.userWS.EmitTrade(trade)
		}
	}
}

// runOrderStrategy sets up, monitors, and finalizes strategy execution.
func runOrderStrategy(ctx context.Context, exchange base.Exchange, endTime time.Time) {
	// Part 1) Setup
	exClient := base.NewExchangeClient(exchange, 0, true)
	marketClient, fillEvents := setupMarketClient(exClient)
	go trackFillEvents(ctx, fillEvents)
	autoCancelOrders := true
	defer exClient.Stop(context.Background())

	plans := []orderPlan{
		{label: "mean-revert-yes", outcome: "Yes", side: models.OrderSideBuy, limit: 0.58, size: 2, tokenID: marketClient.GetTokenID("Yes")},
		{label: "take-profit-yes", outcome: "Yes", side: models.OrderSideSell, limit: 0.72, size: 2, tokenID: marketClient.GetTokenID("Yes")},
		{label: "mean-revert-no", outcome: "No", side: models.OrderSideBuy, limit: 0.36, size: 2, tokenID: marketClient.GetTokenID("No")},
		{label: "take-profit-no", outcome: "No", side: models.OrderSideSell, limit: 0.40, size: 1, tokenID: marketClient.GetTokenID("No")},
	}
	placed := map[string]models.Order{}
	slippageThreshold := 0.12

	// Part 2) Monitor & place orders
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			if autoCancelOrders {
				cancelOpenOrders(marketClient, "context done")
			}
			printStrategySummary(marketClient, "context done")
			return
		case <-ticker.C:
			if time.Now().After(endTime) {
				if autoCancelOrders {
					cancelOpenOrders(marketClient, "strategy window elapsed")
				}
				printStrategySummary(marketClient, "strategy window elapsed")
				return
			}
			for _, plan := range plans {
				if _, ok := placed[plan.label]; ok {
					continue
				}
				bestBid, bestAsk := marketClient.GetBestBidAsk(plan.tokenID)
				if shouldPlace(plan, bestBid, bestAsk) {
					order, err := marketClient.CreateOrder(plan.outcome, plan.side, plan.limit, plan.size, plan.tokenID, nil)
					if err == nil {
						placed[plan.label] = order
						fmt.Printf("Strategy order placed: %s %s %.2f @ %.2f\n", plan.label, plan.side, order.Size, order.Price)
					}
				}
			}

			if shouldCancelForSlippage(marketClient, slippageThreshold) {
				openOrders, err := marketClient.FetchOpenOrders()
				if err == nil && len(openOrders) > 0 {
					for _, order := range openOrders {
						cancelled, err := marketClient.CancelOrder(order.ID)
						if err == nil {
							fmt.Printf("Cancelled for slippage: %s (%s %.2f @ %.2f)\n", cancelled.ID, cancelled.Side, cancelled.Size, cancelled.Price)
						}
					}
				}
			}
		}
	}
}

// setupMarketClient configures the strategy and seed orders.
func setupMarketClient(exClient *base.ExchangeClient) (*base.MarketClient, chan string) {

	client := base.NewMarketClientWithClient(exClient, "mock-binary-1")

	fillEvents := make(chan string, 32)
	// *웹소켓 사용
	client.Client.OnFill(func(event base.OrderEvent, order models.Order, fillSize float64) {
		fillEvents <- fmt.Sprintf("%s:%s:%.0f/%.0f", event, order.ID, fillSize, order.Filled)
	})

	// *웹소켓 사용
	if !client.Setup() {
		panic("strategy setup failed")
	}

	mustOrder := func(outcome string, side models.OrderSide, price, size float64, tokenID, label string) models.Order {
		order, err := client.CreateOrder(outcome, side, price, size, tokenID, nil)
		if err != nil {
			panic(err)
		}
		if order.ID == "" || !order.IsOpen() {
			panic(label)
		}
		return order
	}

	seedOrders := []models.Order{
		mustOrder("Yes", models.OrderSideBuy, 0.6, 5, "token-yes-1", "seed order 1 failed"),
		mustOrder("No", models.OrderSideBuy, 0.4, 4, "token-no-1", "seed order 2 failed"),
		mustOrder("Yes", models.OrderSideSell, 0.71, 3, "token-yes-1", "seed order 3 failed"),
		mustOrder("No", models.OrderSideSell, 0.38, 2, "token-no-1", "seed order 4 failed"),
	}
	for _, order := range seedOrders {
		fmt.Printf("Seeded order: %s %s %.2f @ %.2f\n", order.Outcome, order.Side, order.Size, order.Price)
	}

	return client, fillEvents
}

// printStrategySummary reports final strategy state.
func printStrategySummary(client *base.MarketClient, reason string) {
	fmt.Printf("Strategy stopping: %s\n", reason)
	openOrders, err := client.FetchOpenOrders()
	if err == nil {
		fmt.Printf("Open orders: %d\n", len(openOrders))
	}
	state := base.NewStrategyStateFromClient(client.Client, *client.Market, client.Positions(), len(openOrders))
	fmt.Printf("Final NAV: %.2f (cash %.2f, positions %.2f)\n", state.NAV, state.Cash, state.PositionsValue)
	flushLogs(client.Logger, client.Client.Logger, utils.DefaultLogger())
}

// cancelOpenOrders cancels outstanding orders at shutdown.
func cancelOpenOrders(client *base.MarketClient, reason string) {
	openOrders, err := client.FetchOpenOrders()
	if err != nil || len(openOrders) == 0 {
		return
	}
	for _, order := range openOrders {
		cancelled, err := client.CancelOrder(order.ID)
		if err == nil {
			fmt.Printf("Auto-cancelled (%s): %s (%s %.2f @ %.2f)\n", reason, cancelled.ID, cancelled.Side, cancelled.Size, cancelled.Price)
		}
	}
}

// shouldPlace decides if a plan should place based on BBO.
func shouldPlace(plan orderPlan, bestBid, bestAsk *float64) bool {
	if plan.side == models.OrderSideBuy {
		return bestAsk != nil && *bestAsk <= plan.limit
	}
	return bestBid != nil && *bestBid >= plan.limit
}

// shouldCancelForSlippage triggers cancellation on wide spreads.
func shouldCancelForSlippage(client *base.MarketClient, threshold float64) bool {
	for _, token := range client.OutcomeTokens {
		bestBid, bestAsk := client.GetBestBidAsk(token.TokenID)
		if bestBid == nil || bestAsk == nil {
			continue
		}
		if (*bestAsk - *bestBid) >= threshold {
			return true
		}
	}
	return false
}

// buildOrderbook builds layered bids/asks around top of book.
func buildOrderbook(bestBid, bestAsk float64) ([]any, []any) {
	bids := []any{
		priceLevel(bestBid, 25),
		priceLevel(bestBid-0.01, 20),
		priceLevel(bestBid-0.02, 15),
	}
	asks := []any{
		priceLevel(bestAsk, 30),
		priceLevel(bestAsk+0.01, 25),
		priceLevel(bestAsk+0.02, 20),
	}
	return bids, asks
}

// priceLevel formats a price level for mock orderbooks.
func priceLevel(price, size float64) map[string]any {
	return map[string]any{
		"price": fmt.Sprintf("%.2f", price),
		"size":  fmt.Sprintf("%.0f", size),
	}
}

// trackFillEvents prints fill events until context ends.
func trackFillEvents(ctx context.Context, fillEvents <-chan string) {
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-fillEvents:
			fmt.Printf("Tracked fill: %s\n", event)
		}
	}
}

// sleepOrDone delays unless context is cancelled.
func sleepOrDone(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// sleepWithJitter introduces latency with random jitter.
func sleepWithJitter(rng *rand.Rand, base, jitter time.Duration) {
	delay := base
	if jitter > 0 {
		delay += time.Duration(rng.Int63n(int64(jitter)))
	}
	if delay > 0 {
		time.Sleep(delay)
	}
}
