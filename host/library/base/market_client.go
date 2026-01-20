package base

import (
	"context"
	"fmt"
	"strings"
	"time"

	"host/library/models"
	"host/library/utils"
)

// MarketClient provides market-scoped helpers without scheduling logic.
// 전략 실행이 아닌 "요청 대리자" 역할만 수행한다.
// * 명확한 제어를 위해서,
// * 내가 Strategy에서 스케쥴링 기능을 제외하고,
// * 대신 Exchange의 프록시 역할은 강화되로록 만든 구조체임.
type MarketClient struct {
	// Exchange is the underlying exchange implementation.
	Exchange Exchange
	// Client is the exchange client wrapper.
	Client *ExchangeClient
	// MarketID is the identifier of the target market.
	MarketID string
	// Logger handles market client logging.
	Logger *utils.Logger

	// Market is the cached market object.
	Market *models.Market
	// OutcomeTokens maps outcomes to token IDs.
	OutcomeTokens []models.OutcomeToken
	// TickSize is the market tick size.
	TickSize float64
	// IsRunning indicates whether the client loop is active.
	IsRunning bool
	// positions caches outcome sizes.
	positions map[string]float64
	// openOrders caches open orders.
	openOrders []models.Order
	// deltaInfo caches position imbalance info.
	deltaInfo *DeltaInfo
	// nav caches the latest NAV breakdown.
	nav *models.NAV
}

// NewMarketClient creates a MarketClient with defaults.
// ExchangeClient는 내부에서 생성된다.
func NewMarketClient(exchange Exchange, marketID string) *MarketClient {
	return &MarketClient{
		Exchange:   exchange,
		Client:     NewExchangeClient(exchange, 2*time.Second, true),
		MarketID:   marketID,
		Logger:     utils.SetupLogger("market_client", utils.LevelInfo),
		positions:  map[string]float64{},
		openOrders: []models.Order{},
	}
}

// NewMarketClientWithClient creates a MarketClient with a provided ExchangeClient.
func NewMarketClientWithClient(client *ExchangeClient, marketID string) *MarketClient {
	if client == nil {
		return NewMarketClient(nil, marketID)
	}
	return &MarketClient{
		Exchange:   client.exchange,
		Client:     client,
		MarketID:   marketID,
		Logger:     utils.SetupLogger("market_client", utils.LevelInfo),
		positions:  map[string]float64{},
		openOrders: []models.Order{},
	}
}

// Setup initializes market data and token IDs.
func (m *MarketClient) Setup() bool {
	_ = m.logger()
	market, err := m.Client.FetchMarket(m.MarketID)
	if err != nil {
		m.logger().Errorf("Failed to fetch market: %v", err)
		return false
	}
	if market == nil {
		m.logger().Errorf("Market not found: %s", m.MarketID)
		return false
	}
	m.Market = market
	tokenIDs := toStringSlice(market.Metadata["clobTokenIds"])
	if len(tokenIDs) == 0 {
		m.logger().Errorf("No token IDs found in market metadata")
		return false
	}
	m.TickSize = market.TickSize
	m.OutcomeTokens = make([]models.OutcomeToken, 0, len(market.Outcomes))
	for i, outcome := range market.Outcomes {
		if i >= len(tokenIDs) {
			break
		}
		m.OutcomeTokens = append(m.OutcomeTokens, models.OutcomeToken{
			MarketID: market.ID,
			Outcome:  outcome,
			TokenID:  tokenIDs[i],
		})
	}

	_ = m.Client.SetupOrderbookWebsocket(context.Background(), m.MarketID, tokenIDs)
	m.positions = m.Client.FetchPositionsDictForMarket(*market)
	m.logTraderProfile()
	m.logMarketInfo()
	return true
}

// logger returns the market client logger, initializing if needed.
func (m *MarketClient) logger() *utils.Logger {
	if m.Logger == nil {
		m.Logger = utils.SetupLogger("market_client", utils.LevelInfo)
	}
	return m.Logger
}

// logTraderProfile logs client profile metadata.
func (m *MarketClient) logTraderProfile() {
	m.logger().Infof("\n%s", utils.Bold("Trader Profile"))
}

// logMarketInfo logs the current market summary.
func (m *MarketClient) logMarketInfo() {
	if m.Market == nil {
		return
	}
	m.logger().Infof("\n%s %s", utils.Bold("Market:"), utils.Cyan(m.Market.Question))
	m.logger().Infof(
		"Outcomes: %s | Tick: %s | Vol: %s",
		utils.Magenta(fmt.Sprint(m.Outcomes())),
		utils.Yellow(fmt.Sprint(m.TickSize)),
		utils.Cyan(fmt.Sprintf("$%.0f", m.Market.Volume)),
	)
	for i, ot := range m.OutcomeTokens {
		price := m.Market.Prices[ot.Outcome]
		outcomeDisplay := ot.Outcome
		if len(outcomeDisplay) > 30 {
			outcomeDisplay = outcomeDisplay[:30] + "..."
		}
		m.logger().Infof("  [%d] %s: %s", i, utils.Magenta(outcomeDisplay), utils.Yellow(fmt.Sprintf("%.4f", price)))
	}
}

// RefreshState updates cached positions, orders, delta, and NAV.
func (m *MarketClient) RefreshState() {
	m.positions = m.GetPositions()
	m.openOrders = m.GetOpenOrders()
	delta := CalculateDelta(m.positions)
	m.deltaInfo = &delta
	if m.Market != nil {
		nav := m.Client.CalculateNAV(m.Market)
		m.nav = &nav
	}
}

// Positions returns current positions.
func (m *MarketClient) Positions() map[string]float64 {
	return m.positions
}

// OpenOrders returns open orders.
func (m *MarketClient) OpenOrders() []models.Order {
	return m.openOrders
}

// Delta returns current delta.
func (m *MarketClient) Delta() float64 {
	if m.deltaInfo == nil {
		return 0
	}
	return m.deltaInfo.Delta
}

// NAV returns current NAV.
func (m *MarketClient) NAV() float64 {
	if m.nav == nil {
		return 0
	}
	return m.nav.NAV
}

// Cash returns current cash.
func (m *MarketClient) Cash() float64 {
	if m.nav == nil {
		return 0
	}
	return m.nav.Cash
}

// Outcomes returns list of outcomes.
func (m *MarketClient) Outcomes() []string {
	out := make([]string, 0, len(m.OutcomeTokens))
	for _, ot := range m.OutcomeTokens {
		out = append(out, ot.Outcome)
	}
	return out
}

// TokenIDs returns list of token IDs.
func (m *MarketClient) TokenIDs() []string {
	out := make([]string, 0, len(m.OutcomeTokens))
	for _, ot := range m.OutcomeTokens {
		out = append(out, ot.TokenID)
	}
	return out
}

// LogStatus logs current status.
func (m *MarketClient) LogStatus() {
	m.RefreshState()
	posStr := utils.Gray("None")
	if len(m.positions) > 0 {
		parts := []string{}
		for outcome, size := range m.positions {
			abbrev := outcome
			if len(m.Outcomes()) == 2 {
				abbrev = outcome[:1]
			} else if len(outcome) > 8 {
				abbrev = outcome[:8]
			}
			parts = append(parts, fmt.Sprintf("%s %s", utils.Blue(fmt.Sprintf("%.0f", size)), utils.Magenta(abbrev)))
		}
		posStr = strings.Join(parts, " ")
	}

	deltaSide := ""
	if m.deltaInfo != nil && m.deltaInfo.Delta > 0 && m.deltaInfo.MaxOutcome != "" {
		side := FormatDeltaSide(*m.deltaInfo, m.Outcomes(), true)
		if side != "" {
			deltaSide = " " + utils.Magenta(side)
		}
	}

	m.logger().Infof(
		"\n[%s] %s %s | Cash: %s | Pos: %s | Delta: %s%s | Orders: %s",
		time.Now().Format("15:04:05"),
		utils.Bold("NAV:"),
		utils.Green(fmt.Sprintf("$%.2f", m.NAV())),
		utils.Cyan(fmt.Sprintf("$%.2f", m.Cash())),
		posStr,
		utils.Yellow(fmt.Sprintf("%.1f", m.Delta())),
		deltaSide,
		utils.Cyan(fmt.Sprintf("%d", len(m.openOrders))),
	)

	for _, order := range m.openOrders {
		sideColored := utils.Green(strings.ToUpper(string(order.Side)))
		if order.Side == models.OrderSideSell {
			sideColored = utils.Red(strings.ToUpper(string(order.Side)))
		}
		outcomeDisplay := order.Outcome
		if len(outcomeDisplay) > 15 {
			outcomeDisplay = outcomeDisplay[:15]
		}
		size := order.Size
		m.logger().Infof("  %s %s %s %.0f @ %s", utils.Gray("Open:"), utils.Magenta(outcomeDisplay), sideColored, size, utils.Yellow(fmt.Sprintf("%.4f", order.Price)))
	}
}

// LogOrder logs order placement.
func (m *MarketClient) LogOrder(side models.OrderSide, size float64, outcome string, price float64, action string) {
	if action == "" {
		action = "->"
	}
	sideColored := utils.Green("BUY")
	if side == models.OrderSideSell {
		sideColored = utils.Red("SELL")
	}
	outcomeDisplay := outcome
	if len(outcomeDisplay) > 15 {
		outcomeDisplay = outcomeDisplay[:15]
	}
	m.logger().Infof("    %s %s %.0f %s @ %s", utils.Gray(action), sideColored, size, utils.Magenta(outcomeDisplay), utils.Yellow(fmt.Sprintf("%.4f", price)))
}

// LogCancel logs order cancellation.
func (m *MarketClient) LogCancel(side models.OrderSide, price float64) {
	sideColored := utils.Green("BUY")
	if side == models.OrderSideSell {
		sideColored = utils.Red("SELL")
	}
	m.logger().Infof("    %s %s @ %s", utils.Gray("x Cancel"), sideColored, utils.Yellow(fmt.Sprintf("%.4f", price)))
}

// GetPositions returns current positions as dict.
func (m *MarketClient) GetPositions() map[string]float64 {
	if m.Market == nil {
		return map[string]float64{}
	}
	return m.Client.FetchPositionsDictForMarket(*m.Market)
}

// GetOpenOrders fetches open orders.
func (m *MarketClient) GetOpenOrders() []models.Order {
	orders, err := m.Client.FetchOpenOrders(m.MarketID)
	if err != nil {
		m.logger().Warnf("Failed to fetch open orders: %v", err)
		return nil
	}
	return orders
}

// GetOrdersForOutcome returns buy and sell orders for an outcome.
func (m *MarketClient) GetOrdersForOutcome(outcome string) ([]models.Order, []models.Order) {
	buy := []models.Order{}
	sell := []models.Order{}
	for _, order := range m.openOrders {
		if order.Outcome != outcome {
			continue
		}
		if order.Side == models.OrderSideBuy {
			buy = append(buy, order)
		} else {
			sell = append(sell, order)
		}
	}
	return buy, sell
}

// CancelAllOrders cancels all open orders.
func (m *MarketClient) CancelAllOrders() int {
	cancelled := m.Client.CancelAllOrders(m.MarketID)
	if cancelled > 0 {
		m.logger().Infof("Cancelled %s orders", utils.Cyan(fmt.Sprintf("%d", cancelled)))
	}
	return cancelled
}

// FetchPositions fetches positions for the current market.
func (m *MarketClient) FetchPositions() ([]models.Position, error) {
	return m.Client.FetchPositions(m.MarketID)
}

// FetchPositionsDict fetches positions as outcome->size.
func (m *MarketClient) FetchPositionsDict() map[string]float64 {
	return m.Client.FetchPositionsDict(m.MarketID)
}

// FetchOpenOrders fetches open orders for the current market.
func (m *MarketClient) FetchOpenOrders() ([]models.Order, error) {
	return m.Client.FetchOpenOrders(m.MarketID)
}

// CancelOrder cancels a single order for the current market.
func (m *MarketClient) CancelOrder(orderID string) (models.Order, error) {
	return m.Client.CancelOrder(orderID, m.MarketID)
}

// FetchBalance fetches the latest account balance.
func (m *MarketClient) FetchBalance() (map[string]float64, error) {
	return m.Client.FetchBalance()
}

// CancelStaleOrders cancels orders not at target price.
func (m *MarketClient) CancelStaleOrders(orders []models.Order, targetPrice float64, tolerance float64) bool {
	cancelled := false
	for _, order := range orders {
		if absFloat(order.Price-targetPrice) >= tolerance {
			if _, err := m.Client.CancelOrder(order.ID, m.MarketID); err == nil {
				m.LogCancel(order.Side, order.Price)
				cancelled = true
			}
		}
	}
	return cancelled
}

// HasOrderAtPrice checks if any order is at the given price.
func (m *MarketClient) HasOrderAtPrice(orders []models.Order, price float64, tolerance float64) bool {
	for _, order := range orders {
		if absFloat(order.Price-price) < tolerance {
			return true
		}
	}
	return false
}

// GetOrderbook returns an orderbook for a token.
func (m *MarketClient) GetOrderbook(tokenID string) map[string]any {
	return m.Client.GetOrderbook(tokenID)
}

// GetBestBidAsk returns best bid/ask for a token.
func (m *MarketClient) GetBestBidAsk(tokenID string) (*float64, *float64) {
	return m.Client.GetBestBidAsk(tokenID)
}

// RoundPrice rounds price to tick size.
func (m *MarketClient) RoundPrice(price float64) float64 {
	rounded, err := utils.RoundToTickSize(price, m.TickSize)
	if err != nil {
		return price
	}
	return rounded
}

// GetTokenID returns token ID for an outcome.
func (m *MarketClient) GetTokenID(outcome string) string {
	for _, ot := range m.OutcomeTokens {
		if ot.Outcome == outcome {
			return ot.TokenID
		}
	}
	return ""
}

// CreateOrder submits an order.
func (m *MarketClient) CreateOrder(outcome string, side models.OrderSide, price, size float64, tokenID string, params map[string]any) (models.Order, error) {
	if tokenID == "" {
		tokenID = m.GetTokenID(outcome)
	}
	if params == nil {
		params = map[string]any{}
	}
	if tokenID != "" {
		params["token_id"] = tokenID
	}
	return m.Client.CreateOrder(m.MarketID, outcome, side, m.RoundPrice(price), size, params)
}

// PlaceBBOOrders places best bid/offer orders.
func (m *MarketClient) PlaceBBOOrders(orderSize, maxPosition, maxDelta float64, getBBO func(tokenID string) (*float64, *float64)) {
	if getBBO == nil {
		getBBO = m.GetBestBidAsk
	}
	for _, ot := range m.OutcomeTokens {
		m.placeBBOForOutcome(ot.Outcome, ot.TokenID, orderSize, maxPosition, maxDelta, getBBO)
	}
}

// placeBBOForOutcome places best bid/offer orders for one outcome.
func (m *MarketClient) placeBBOForOutcome(outcome, tokenID string, orderSize, maxPosition, maxDelta float64, getBBO func(string) (*float64, *float64)) {
	bestBid, bestAsk := getBBO(tokenID)
	if bestBid == nil || bestAsk == nil {
		return
	}
	ourBid := m.RoundPrice(*bestBid)
	ourAsk := m.RoundPrice(*bestAsk)
	if ourBid >= ourAsk {
		return
	}
	position := m.positions[outcome]
	buyOrders, sellOrders := m.GetOrdersForOutcome(outcome)

	if maxDelta > 0 && m.deltaInfo != nil && m.Delta() > maxDelta {
		if position == m.deltaInfo.MaxPosition {
			return
		}
	}

	if !m.HasOrderAtPrice(buyOrders, ourBid, 0.001) {
		m.CancelStaleOrders(buyOrders, ourBid, 0.001)
		if orderSize > 0 && position+orderSize <= maxPosition && m.Cash() >= orderSize {
			if _, err := m.CreateOrder(outcome, models.OrderSideBuy, ourBid, orderSize, tokenID, nil); err == nil {
				m.LogOrder(models.OrderSideBuy, orderSize, outcome, ourBid, "")
			}
		}
	}

	if !m.HasOrderAtPrice(sellOrders, ourAsk, 0.001) {
		m.CancelStaleOrders(sellOrders, ourAsk, 0.001)
		if orderSize > 0 && position >= orderSize {
			if _, err := m.CreateOrder(outcome, models.OrderSideSell, ourAsk, orderSize, tokenID, nil); err == nil {
				m.LogOrder(models.OrderSideSell, orderSize, outcome, ourAsk, "")
			}
		}
	}
}

// LiquidatePositions sells all positions at best bid.
func (m *MarketClient) LiquidatePositions() {
	positions := m.GetPositions()
	if len(positions) == 0 {
		m.logger().Infof("No positions to liquidate")
		return
	}
	m.logger().Infof("%s", utils.Bold("Liquidating positions..."))
	for outcome, size := range positions {
		if size <= 0 {
			continue
		}
		tokenID := m.GetTokenID(outcome)
		if tokenID == "" {
			continue
		}
		bestBid, _ := m.GetBestBidAsk(tokenID)
		if bestBid == nil || *bestBid <= 0 {
			continue
		}
		sellSize := float64(int(size))
		if sellSize <= 0 {
			continue
		}
		if _, err := m.CreateOrder(outcome, models.OrderSideSell, *bestBid, sellSize, tokenID, nil); err == nil {
			m.LogOrder(models.OrderSideSell, sellSize, outcome, *bestBid, "LIQUIDATE")
		}
	}
}

// Cleanup cancels orders, liquidates positions, and stops the client.
func (m *MarketClient) Cleanup(ctx context.Context) {
	m.logger().Infof("\n%s", utils.Bold("Cleaning up..."))
	m.CancelAllOrders()
	m.LiquidatePositions()
	time.Sleep(3 * time.Second)
	m.Client.Stop(ctx)
}
