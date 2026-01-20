package base

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"host/library/models"
	"host/library/utils"
)

// DeltaInfo describes position imbalance.
// 한 마켓 id에 대한 내 자산 Size의 편중 (Size가 float이 됨.)
type DeltaInfo struct {
	// Delta is the difference between max and min positions.
	Delta float64
	// MaxPosition is the maximum position size.
	MaxPosition float64
	// MinPosition is the minimum position size.
	MinPosition float64
	// MaxOutcome is the outcome with the max position.
	MaxOutcome string
}

// IsBalanced returns true if delta is near zero.
func (d DeltaInfo) IsBalanced() bool {
	return absFloat(d.Delta) < 0.01
}

// StrategyState is a unified state snapshot for strategies.
// 전략의 현재 상태 스냅샷
// 클라이언트로부터 추출된 마켓에 포지션, 오더, PNL임
// * 클라이언트만 가지고도 마켓에 대한 자신의 PNL추출이 가능함!
// * 굳이 Strategy구조체를 쓸 이유가 없음!
type StrategyState struct {
	// NAV is the net asset value.
	NAV float64
	// Cash is the available cash balance.
	// 거래소 계정 잔고
	// Cash는 거래소의 Fetch에 의존
	Cash float64
	// PositionsValue is the total positions value.
	// 현재 포지션의 평가액 합
	PositionsValue float64
	// Positions maps outcomes to sizes.
	// ex: "Yes":12.5
	Positions map[string]float64
	// DeltaInfo captures position imbalance.
	DeltaInfo DeltaInfo
	// OpenOrders is the count of open orders.
	// 미체결 주문
	// OpenOrders는 거래소가 Cash에서 뺄 수도 넣을수도 있음
	// 포지션엔 들어가지 않음.
	OpenOrders int
	// NavBreakdown is the detailed NAV breakdown.
	NavBreakdown *models.NAV
}

// NewStrategyStateFromClient builds a StrategyState from the client and market.
func NewStrategyStateFromClient(client *ExchangeClient, market models.Market, positions map[string]float64, openOrders int) StrategyState {
	// navData는 현재 마켓id에 대한 총자산임
	navData := client.CalculateNAV(&market)
	if positions == nil {
		positions = map[string]float64{}
		for _, pos := range client.GetPositions(market.ID) {
			positions[pos.Outcome] = pos.Size
		}
	}
	delta := CalculateDelta(positions)
	return StrategyState{
		NAV:            navData.NAV,
		Cash:           navData.Cash,
		PositionsValue: navData.PositionsValue,
		Positions:      positions,
		DeltaInfo:      delta,
		OpenOrders:     openOrders,
		NavBreakdown:   &navData,
	}
}

// ExchangeClient is a stateful wrapper around Exchange.
// * Client만 가지고도 마켓 PNL추적, 오더 트래킹이 전부 가능함
// * ExchangeClient의 MarketWebsocket, UserWebsocket은 잘 판단 후 적절히 덜어내기
// * 내 언어에서 ExchangeClient는 "액션을 제외하곤" 독자적 IO가 없는, 단지 메서드와 필드로 이뤄진 "값"이여야 함. (모니터링은 Watch가 담당)
type ExchangeClient struct {
	// exchange is the underlying exchange implementation.
	exchange Exchange
	// cacheTTL is the time-to-live for cached data.
	cacheTTL time.Duration
	// Logger handles exchange client logging.
	Logger *utils.Logger

	// balanceCache stores last known balances.
	//ex: "USDC":120.5
	balanceCache map[string]float64
	// balanceLastUpdated records the last balance refresh.
	balanceLastUpdated time.Time

	// positionsCache stores cached positions by market key.
	// ex: "market-1"->{Yes:10, No:2, 23:59:59}
	positionsCache map[string]positionsCacheEntry
	// midPriceCache stores mid prices by token ID.
	midPriceCache map[string]float64

	// trackFills enables order fill tracking.
	trackFills bool
	// orderTracker tracks order fill events.
	orderTracker *OrderTracker
	// userWS is the user websocket, when supported.
	//오더 트래킹이 주 목적인 웹소켓
	userWS UserWebSocket

	// marketWS is the market data websocket.
	marketWS OrderbookWebSocket
	// orderbookManager stores live orderbook snapshots.
	//토큰당 오더북 스냅샷 관리
	orderbookManager *models.OrderbookManager

	// pollingStop stops orderbook polling.
	pollingStop chan struct{}
	// pollingTokenIDs are token IDs being polled.
	pollingTokenIDs []string
	// mu guards mutable caches and state.
	mu sync.Mutex
}

type positionsCacheEntry struct {
	// positions is the cached positions slice.
	positions []models.Position
	// lastUpdated is the cache timestamp.
	lastUpdated time.Time
}

// NewExchangeClient creates a new ExchangeClient.
func NewExchangeClient(exchange Exchange, cacheTTL time.Duration, trackFills bool) *ExchangeClient {
	if cacheTTL == 0 {
		cacheTTL = 2 * time.Second
	}
	if exchange == nil {
		utils.DefaultLogger().Debugf("base.NewExchangeClient: exchange is nil")
	}
	client := &ExchangeClient{
		exchange:        exchange,
		cacheTTL:        cacheTTL,
		Logger:          utils.SetupLogger("exchange_client", utils.LevelInfo),
		balanceCache:    map[string]float64{},
		positionsCache:  map[string]positionsCacheEntry{},
		midPriceCache:   map[string]float64{},
		trackFills:      trackFills,
		pollingStop:     make(chan struct{}),
		pollingTokenIDs: nil,
	}
	if trackFills {
		client.setupOrderTracker()
	}
	return client
}

// setupOrderTracker wires the order tracker and user websocket.
func (c *ExchangeClient) setupOrderTracker() {
	c.orderTracker = NewOrderTracker(false)
	c.orderTracker.OnFill(CreateFillLogger(c.logger()))
	if provider, ok := c.exchange.(UserWebsocketProvider); ok {
		if ws := provider.GetUserWebsocket(); ws != nil {
			c.userWS = ws
			ws.OnTrade(c.orderTracker.HandleTrade)
			_ = ws.Start()
		} else {
			c.logger().Debugf("base.ExchangeClient.setupOrderTracker: user websocket is nil")
		}
	} else {
		c.logger().Debugf("base.ExchangeClient.setupOrderTracker: exchange lacks user websocket")
	}
}

// logger returns the exchange client logger, initializing if needed.
func (c *ExchangeClient) logger() *utils.Logger {
	if c.Logger == nil {
		c.Logger = utils.SetupLogger("exchange_client", utils.LevelInfo)
	}
	return c.Logger
}

// OnFill registers a callback for fill events.
func (c *ExchangeClient) OnFill(callback OrderCallback) *ExchangeClient {
	if c.orderTracker == nil {
		c.orderTracker = NewOrderTracker(false)
	}
	c.orderTracker.OnFill(callback)
	return c
}

// TrackOrder adds an order to tracking.
func (c *ExchangeClient) TrackOrder(order models.Order) {
	if c.orderTracker != nil {
		c.orderTracker.TrackOrder(order)
	}
}

// Exchange wrapper methods.
// FetchMarket returns a market by ID.
func (c *ExchangeClient) FetchMarket(marketID string) (*models.Market, error) {
	if marketID == "" {
		c.logger().Debugf("base.ExchangeClient.FetchMarket: marketID empty")
	}
	market, err := c.exchange.FetchMarket(marketID)
	if err != nil {
		return nil, err
	}
	return &market, nil
}

// FetchMarkets returns a list of markets.
func (c *ExchangeClient) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if params == nil {
		c.logger().Debugf("base.ExchangeClient.FetchMarkets: params nil")
		params = map[string]any{}
	}
	return c.exchange.FetchMarkets(params)
}

// FetchMarketsBySlug returns markets by slug if supported.
func (c *ExchangeClient) FetchMarketsBySlug(slug string) ([]models.Market, error) {
	if provider, ok := c.exchange.(MarketSlugFetcher); ok {
		return provider.FetchMarketsBySlug(slug)
	}
	return []models.Market{}, nil
}

// FetchBalance fetches balance from the exchange.
func (c *ExchangeClient) FetchBalance() (map[string]float64, error) {
	return c.exchange.FetchBalance()
}

// FetchPositions fetches positions for a market or all markets.
func (c *ExchangeClient) FetchPositions(marketID string) ([]models.Position, error) {
	if marketID == "" {
		c.logger().Debugf("base.ExchangeClient.FetchPositions: marketID empty")
		return c.exchange.FetchPositions(nil, nil)
	}
	return c.exchange.FetchPositions(&marketID, nil)
}

// FetchPositionsForMarket fetches positions for a market object.
func (c *ExchangeClient) FetchPositionsForMarket(market models.Market) ([]models.Position, error) {
	if market.ID == "" {
		c.logger().Debugf("base.ExchangeClient.FetchPositionsForMarket: market ID empty")
	}
	if provider, ok := c.exchange.(PositionsForMarketFetcher); ok {
		return provider.FetchPositionsForMarket(market)
	}
	return c.exchange.FetchPositions(&market.ID, nil)
}

// CreateOrder submits an order and tracks it.
func (c *ExchangeClient) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if marketID == "" {
		c.logger().Debugf("base.ExchangeClient.CreateOrder: marketID empty")
	}
	if outcome == "" {
		c.logger().Debugf("base.ExchangeClient.CreateOrder: outcome empty")
	}
	if price == 0 || size == 0 {
		c.logger().Debugf("base.ExchangeClient.CreateOrder: price or size zero (price=%.6f size=%.6f)", price, size)
	}
	if params == nil {
		c.logger().Debugf("base.ExchangeClient.CreateOrder: params nil")
		params = map[string]any{}
	}
	order, err := c.exchange.CreateOrder(marketID, outcome, side, price, size, params)
	if err != nil {
		return models.Order{}, err
	}
	c.TrackOrder(order)
	return order, nil
}

// GetOrderbook returns a token orderbook snapshot.
func (c *ExchangeClient) GetOrderbook(tokenID string) map[string]any {
	if tokenID == "" {
		c.logger().Debugf("base.ExchangeClient.GetOrderbook: tokenID empty")
	}
	if provider, ok := c.exchange.(OrderbookProvider); ok {
		data, err := provider.GetOrderbook(tokenID)
		if err == nil {
			return data
		}
	}
	return map[string]any{"bids": []any{}, "asks": []any{}}
}

// GetWebsocket returns the market websocket if supported.
func (c *ExchangeClient) GetWebsocket() OrderbookWebSocket {
	if provider, ok := c.exchange.(MarketWebsocketProvider); ok {
		return provider.GetWebsocket()
	}
	return nil
}

// setupOrderbookPolling starts REST polling for orderbooks.
// 디폴트 500ms
func (c *ExchangeClient) setupOrderbookPolling(tokenIDs []string, interval time.Duration) bool {
	if interval == 0 {
		interval = 500 * time.Millisecond
	}
	c.orderbookManager = models.NewOrderbookManager()
	c.pollingTokenIDs = tokenIDs

	for _, tokenID := range tokenIDs {
		rest := c.GetOrderbook(tokenID)
		orderbook := models.FromRESTResponse(rest, tokenID)
		c.orderbookManager.Update(tokenID, orderbook.ToData())
		c.UpdateMidPriceFromOrderbook(tokenID, orderbook.ToData())
	}

	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				for _, tokenID := range c.pollingTokenIDs {
					rest := c.GetOrderbook(tokenID)
					orderbook := models.FromRESTResponse(rest, tokenID)
					c.orderbookManager.Update(tokenID, orderbook.ToData())
					c.UpdateMidPriceFromOrderbook(tokenID, orderbook.ToData())
				}
			case <-c.pollingStop:
				return
			}
		}
	}()

	c.logger().Infof("Orderbook polling started for %d tokens", len(tokenIDs))
	return true
}

// SetupOrderbookWebsocket connects market WebSocket or falls back to polling.
// 각 토큰들의 오더북을 1회 초기화함
func (c *ExchangeClient) SetupOrderbookWebsocket(ctx context.Context, marketID string, tokenIDs []string) bool {
	ws := c.GetWebsocket()
	if ws == nil {
		c.logger().Debugf("Exchange does not support WebSocket, using polling")
		return c.setupOrderbookPolling(tokenIDs, 500*time.Millisecond)
	}
	c.marketWS = ws
	c.orderbookManager = ws.GetOrderbookManager()
	//일단 토큰들을 한번 초기화함
	for _, tokenID := range tokenIDs {
		rest := c.GetOrderbook(tokenID)
		orderbook := models.FromRESTResponse(rest, tokenID)
		if c.orderbookManager != nil {
			c.orderbookManager.Update(tokenID, orderbook.ToData())
		}
		c.UpdateMidPriceFromOrderbook(tokenID, orderbook.ToData())
	}

	callback := func(_ string, orderbook models.OrderbookData) {
		if orderbook.AssetID != "" {
			c.UpdateMidPriceFromOrderbook(orderbook.AssetID, orderbook)
		}
	}

	if err := ws.Connect(ctx); err != nil {
		c.logger().Warnf("WebSocket connection failed: %v", err)
		return c.setupOrderbookPolling(tokenIDs, 500*time.Millisecond)
	}
	if err := ws.WatchOrderbookByMarket(ctx, marketID, tokenIDs, callback); err != nil {
		c.logger().Warnf("WebSocket subscribe failed: %v", err)
		return c.setupOrderbookPolling(tokenIDs, 500*time.Millisecond)
	}
	c.logger().Infof("WebSocket orderbook connected")
	return true
}

// GetBestBidAsk returns best bid and ask for a token ID.
func (c *ExchangeClient) GetBestBidAsk(tokenID string) (*float64, *float64) {
	if tokenID == "" {
		c.logger().Debugf("base.ExchangeClient.GetBestBidAsk: tokenID empty")
	}
	if c.orderbookManager != nil && c.orderbookManager.HasData(tokenID) {
		return c.orderbookManager.GetBestBidAsk(tokenID)
	}
	orderbook := c.GetOrderbook(tokenID)
	bids, _ := orderbook["bids"].([]any)
	asks, _ := orderbook["asks"].([]any)
	bestBid := parsePriceLevel(bids)
	bestAsk := parsePriceLevel(asks)
	return bestBid, bestAsk
}

// Stop stops order tracking, websockets, and polling.
// Stop stops order tracking, websockets, and polling.
func (c *ExchangeClient) Stop(ctx context.Context) {
	if ctx == nil {
		c.logger().Debugf("base.ExchangeClient.Stop: ctx is nil")
	}
	if c.orderTracker != nil {
		c.orderTracker.Stop()
	}
	if c.userWS != nil {
		_ = c.userWS.Stop()
	}
	if c.marketWS != nil {
		_ = c.marketWS.Disconnect(ctx)
	}
	if c.pollingStop != nil {
		close(c.pollingStop)
	}
}

// GetBalance returns cached balance with stale marker.
func (c *ExchangeClient) GetBalance() map[string]float64 {
	c.mu.Lock()
	defer c.mu.Unlock()

	stale := false
	if time.Since(c.balanceLastUpdated) > c.cacheTTL {
		if err := c.updateBalanceCache(); err != nil {
			c.logger().Warnf("Balance update failed: %v", err)
			stale = true
		}
	}

	result := map[string]float64{}
	for k, v := range c.balanceCache {
		result[k] = v
	}
	if stale {
		result["_stale"] = 1
	}
	return result
}

// GetPositions returns cached positions.
// GetPositions returns cached positions.
func (c *ExchangeClient) GetPositions(marketID string) []models.Position {
	c.mu.Lock()
	defer c.mu.Unlock()

	if marketID == "" {
		c.logger().Debugf("base.ExchangeClient.GetPositions: marketID empty")
	}
	cacheKey := cacheKeyForMarket(marketID)
	if entry, ok := c.positionsCache[cacheKey]; ok {
		if time.Since(entry.lastUpdated) <= c.cacheTTL {
			return copyPositions(entry.positions)
		}
	}

	if err := c.updatePositionsCache(marketID); err != nil {
		c.logger().Warnf("Positions update failed: %v", err)
	}
	if entry, ok := c.positionsCache[cacheKey]; ok {
		return copyPositions(entry.positions)
	}
	return nil
}

// GetPositionsDict returns positions as outcome->size.
// GetPositionsDict returns positions as outcome->size.
func (c *ExchangeClient) GetPositionsDict(marketID string) map[string]float64 {
	out := map[string]float64{}
	for _, pos := range c.GetPositions(marketID) {
		out[pos.Outcome] = pos.Size
	}
	return out
}

// FetchPositionsDict fetches fresh positions.
// FetchPositionsDict fetches fresh positions.
func (c *ExchangeClient) FetchPositionsDict(marketID string) map[string]float64 {
	out := map[string]float64{}
	positions, err := c.FetchPositions(marketID)
	if err != nil {
		c.logger().Warnf("Failed to fetch positions: %v", err)
		return out
	}
	for _, pos := range positions {
		out[pos.Outcome] = pos.Size
	}
	return out
}

// FetchPositionsDictForMarket fetches positions for a market.
// FetchPositionsDictForMarket fetches positions for a market.
func (c *ExchangeClient) FetchPositionsDictForMarket(market models.Market) map[string]float64 {
	out := map[string]float64{}
	positions, err := c.FetchPositionsForMarket(market)
	if err != nil {
		c.logger().Warnf("Failed to fetch positions for market: %v", err)
		return out
	}
	for _, pos := range positions {
		out[pos.Outcome] = pos.Size
	}
	return out
}

// FetchOpenOrders fetches open orders from exchange.
func (c *ExchangeClient) FetchOpenOrders(marketID string) ([]models.Order, error) {
	if marketID == "" {
		c.logger().Debugf("base.ExchangeClient.FetchOpenOrders: marketID empty")
		return c.exchange.FetchOpenOrders(nil, nil)
	}
	return c.exchange.FetchOpenOrders(&marketID, nil)
}

// CancelOrder cancels a single order.
func (c *ExchangeClient) CancelOrder(orderID, marketID string) (models.Order, error) {
	if orderID == "" {
		c.logger().Debugf("base.ExchangeClient.CancelOrder: orderID empty")
	}
	if marketID == "" {
		return c.exchange.CancelOrder(orderID, nil)
	}
	return c.exchange.CancelOrder(orderID, &marketID)
}

// CancelAllOrders cancels all open orders for a market.
// CancelAllOrders cancels all open orders for a market.
func (c *ExchangeClient) CancelAllOrders(marketID string) int {
	orders, err := c.FetchOpenOrders(marketID)
	if err != nil {
		c.logger().Warnf("Failed to fetch open orders: %v", err)
		return 0
	}
	cancelled := 0
	for _, order := range orders {
		if _, err := c.CancelOrder(order.ID, marketID); err == nil {
			cancelled++
		}
	}
	return cancelled
}

// LiquidatePositions sells all positions at best bid.
// 즉, 시장가에 마켓 포지션 청산하는 함수임.
func (c *ExchangeClient) LiquidatePositions(market models.Market, getBestBid func(tokenID string) *float64, tickSize float64) int {
	positions := c.FetchPositionsDict(market.ID)
	if len(positions) == 0 {
		return 0
	}
	tokenIDs := toStringSlice(market.Metadata["clobTokenIds"])
	outcomes := market.Outcomes
	liquidated := 0

	for outcome, size := range positions {
		if size <= 0 {
			continue
		}
		tokenID := ""
		for i, out := range outcomes {
			if out == outcome && i < len(tokenIDs) {
				tokenID = tokenIDs[i]
				break
			}
		}
		if tokenID == "" {
			continue
		}
		bestBid := getBestBid(tokenID)
		if bestBid == nil || *bestBid <= 0 {
			continue
		}
		price, err := utils.RoundToTickSize(*bestBid, tickSize)
		if err != nil {
			price = *bestBid
		}
		sellSize := float64(int(size))
		if sellSize <= 0 {
			continue
		}
		_, err = c.exchange.CreateOrder(market.ID, outcome, models.OrderSideSell, price, sellSize, map[string]any{"token_id": tokenID})
		if err == nil {
			liquidated++
		}
	}
	return liquidated
}

// RefreshAccountState refreshes both balance and positions.
// RefreshAccountState refreshes both balance and positions.
func (c *ExchangeClient) RefreshAccountState(marketID string) {
	_ = c.updateBalanceCache()
	_ = c.updatePositionsCache(marketID)
}

// CalculateNAV calculates NAV using cached mid prices.
func (c *ExchangeClient) CalculateNAV(market *models.Market) models.NAV {
	var positions []models.Position
	if market != nil {
		positions, _ = c.FetchPositionsForMarket(*market)
	} else {
		positions = c.GetPositions("")
	}

	balance := c.GetBalance()
	var prices map[string]map[string]float64
	if market != nil {
		mid := c.GetMidPrices(*market)
		if len(mid) > 0 {
			prices = map[string]map[string]float64{market.ID: mid}
		}
	}
	return c.calculateNavInternal(positions, prices, balance)
}

// calculateNavInternal computes NAV using positions, prices, and balances.
func (c *ExchangeClient) calculateNavInternal(positions []models.Position, prices map[string]map[string]float64, balance map[string]float64) models.NAV {
	cash := balance["USDC"] + balance["USD"]
	positionsValue := 0.0
	breakdown := []models.PositionBreakdown{}

	for _, pos := range positions {
		if pos.Size <= 0 {
			continue
		}
		midPrice := pos.CurrentPrice
		if prices != nil {
			if marketPrices, ok := prices[pos.MarketID]; ok {
				if price, ok := marketPrices[pos.Outcome]; ok {
					midPrice = price
				}
			}
		}
		value := pos.Size * midPrice
		positionsValue += value
		breakdown = append(breakdown, models.PositionBreakdown{
			MarketID: pos.MarketID,
			Outcome:  pos.Outcome,
			Size:     pos.Size,
			MidPrice: midPrice,
			Value:    value,
		})
	}

	return models.NAV{
		NAV:            cash + positionsValue,
		Cash:           cash,
		PositionsValue: positionsValue,
		Positions:      breakdown,
	}
}

// UpdateMidPrice caches a mid price for a token.
// UpdateMidPrice caches a mid price for a token.
func (c *ExchangeClient) UpdateMidPrice(tokenID string, midPrice float64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.midPriceCache[tokenID] = midPrice
}

// UpdateMidPriceFromOrderbook calculates mid price from orderbook.
// UpdateMidPriceFromOrderbook calculates mid price from orderbook.
func (c *ExchangeClient) UpdateMidPriceFromOrderbook(tokenID string, orderbook models.OrderbookData) *float64 {
	if len(orderbook.Bids) == 0 || len(orderbook.Asks) == 0 {
		return nil
	}
	bestBid := orderbook.Bids[0].Price
	bestAsk := orderbook.Asks[0].Price
	if bestBid <= 0 || bestAsk <= 0 {
		return nil
	}
	mid := (bestBid + bestAsk) / 2
	c.UpdateMidPrice(tokenID, mid)
	return &mid
}

// GetMidPrice returns cached mid price for token.
// GetMidPrice returns cached mid price for token.
func (c *ExchangeClient) GetMidPrice(tokenID string) *float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	price, ok := c.midPriceCache[tokenID]
	if !ok {
		return nil
	}
	return &price
}

// GetMidPrices returns mid prices for a market.
// GetMidPrices returns mid prices for a market.
func (c *ExchangeClient) GetMidPrices(market models.Market) map[string]float64 {
	midPrices := map[string]float64{}
	tokenIDs := toStringSlice(market.Metadata["clobTokenIds"])
	tokens := toStringMap(market.Metadata["tokens"])

	yesToken := ""
	if len(tokens) > 0 {
		if value, ok := tokens["yes"]; ok {
			yesToken = value
		} else if value, ok := tokens["Yes"]; ok {
			yesToken = value
		}
	} else if len(tokenIDs) > 0 {
		yesToken = tokenIDs[0]
	}

	var yesMid *float64
	if yesToken != "" {
		yesMid = c.GetMidPrice(yesToken)
	}
	if yesMid == nil {
		yesMid = c.GetMidPrice(market.ID)
	}

	if yesMid != nil {
		if market.IsBinary() {
			midPrices["Yes"] = *yesMid
			midPrices["No"] = 1.0 - *yesMid
		} else if len(market.Outcomes) > 0 {
			midPrices[market.Outcomes[0]] = *yesMid
		}
		return midPrices
	}

	for _, outcome := range market.Outcomes {
		if price, ok := market.Prices[outcome]; ok {
			midPrices[outcome] = price
		}
	}
	return midPrices
}

// updateBalanceCache refreshes the balance cache.
func (c *ExchangeClient) updateBalanceCache() error {
	balance, err := c.exchange.FetchBalance()
	if err != nil {
		return err
	}
	c.balanceCache = balance
	c.balanceLastUpdated = time.Now()
	return nil
}

// updatePositionsCache refreshes the positions cache.
func (c *ExchangeClient) updatePositionsCache(marketID string) error {
	var positions []models.Position
	var err error
	if marketID == "" {
		positions, err = c.exchange.FetchPositions(nil, nil)
	} else {
		positions, err = c.exchange.FetchPositions(&marketID, nil)
	}
	if err != nil {
		return err
	}
	cacheKey := cacheKeyForMarket(marketID)
	c.positionsCache[cacheKey] = positionsCacheEntry{
		positions:   positions,
		lastUpdated: time.Now(),
	}
	return nil
}

// CalculateDelta computes delta from positions.
func CalculateDelta(positions map[string]float64) DeltaInfo {
	if len(positions) == 0 {
		return DeltaInfo{}
	}
	maxPos := -1.0
	minPos := 0.0
	maxOutcome := ""
	first := true
	for outcome, size := range positions {
		if first {
			maxPos = size
			minPos = size
			first = false
		}
		if size > maxPos {
			maxPos = size
			maxOutcome = outcome
		}
		if size < minPos {
			minPos = size
		}
	}
	return DeltaInfo{
		Delta:       maxPos - minPos,
		MaxPosition: maxPos,
		MinPosition: minPos,
		MaxOutcome:  maxOutcome,
	}
}

// FormatPositionsCompact formats positions for display.
func FormatPositionsCompact(positions map[string]float64, outcomes []string, abbreviate bool) string {
	if len(positions) == 0 {
		return "None"
	}
	parts := make([]string, 0, len(positions))
	for outcome, size := range positions {
		abbrev := outcome
		if abbreviate && len(outcomes) == 2 {
			abbrev = outcome[:1]
		} else if abbreviate && len(outcomes) > 2 {
			if len(outcome) > 8 {
				abbrev = outcome[:8]
			}
		}
		parts = append(parts, fmt.Sprintf("%.0f %s", size, abbrev))
	}
	return strings.Join(parts, " ")
}

// FormatDeltaSide formats delta side for display.
func FormatDeltaSide(deltaInfo DeltaInfo, outcomes []string, abbreviate bool) string {
	if deltaInfo.Delta <= 0 || deltaInfo.MaxOutcome == "" {
		return ""
	}
	if abbreviate && len(outcomes) == 2 {
		return deltaInfo.MaxOutcome[:1]
	}
	if abbreviate && len(outcomes) > 2 && len(deltaInfo.MaxOutcome) > 8 {
		return deltaInfo.MaxOutcome[:8]
	}
	return deltaInfo.MaxOutcome
}

// parsePriceLevel extracts the best price from orderbook levels.
func parsePriceLevel(levels []any) *float64 {
	if len(levels) == 0 {
		return nil
	}
	level := levels[0]
	switch value := level.(type) {
	case map[string]any:
		price, ok := toFloat(value["price"])
		if !ok || price <= 0 {
			return nil
		}
		return &price
	case []any:
		if len(value) == 0 {
			return nil
		}
		price, ok := toFloat(value[0])
		if !ok || price <= 0 {
			return nil
		}
		return &price
	case []float64:
		if len(value) == 0 || value[0] <= 0 {
			return nil
		}
		return &value[0]
	case float64:
		if value <= 0 {
			return nil
		}
		return &value
	default:
		return nil
	}
}

// toFloat parses numeric values into float64.
func toFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// cacheKeyForMarket returns the cache key for a market.
func cacheKeyForMarket(marketID string) string {
	if marketID == "" {
		return "__all__"
	}
	return marketID
}

// copyPositions makes a shallow copy of positions.
func copyPositions(positions []models.Position) []models.Position {
	out := make([]models.Position, len(positions))
	copy(out, positions)
	return out
}

// toStringMap converts a generic map to a string map.
func toStringMap(value any) map[string]string {
	switch v := value.(type) {
	case map[string]string:
		return v
	case map[string]any:
		out := map[string]string{}
		for key, item := range v {
			if str, ok := item.(string); ok {
				out[key] = str
			}
		}
		return out
	default:
		return nil
	}
}
