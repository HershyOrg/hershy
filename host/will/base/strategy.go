package base

import (
	"context"
	"fmt"
	"strings"
	"time"

	"host/will/models"
	"host/will/utils"
)

// Strategy provides common strategy helpers.
// 전략은 Exhange+Market에 의존함
// 즉, 하나의 마켓 기준 유저의 전략임
// * Strategy는 "벤치마크 후 대체"의 용도로 쓰기!
// * 같이 쓰지 말고, 대신 Ghost에 대해 벤치마크하기!
type Strategy struct {
	// Exchange is the underlying exchange implementation.
	Exchange Exchange
	// Client is the exchange client wrapper.
	Client *ExchangeClient
	// MarketID is the identifier of the target market.
	MarketID string
	// MaxPosition is the maximum allowable position size.
	//보유 가능한 최대 포지션 수량
	MaxPosition float64
	// OrderSize is the default order size.\
	//기본 주문 수량: ex) 매 틱 마다 5개씩 오더
	OrderSize float64
	// MaxDelta is the max allowed position imbalance.
	//포지션 불균형 허용치
	MaxDelta float64
	// CheckInterval is the loop interval for strategy ticks.
	//=OnTick의 인터발
	//* 내 경우엔 CheckInterval이 따로 존재 하지 말기
	//* 대신 BuildWatch에서 시간, 이벤트 다 받기
	//* 내 경우엔 Watcher가 이 역할이겠지.
	CheckInterval time.Duration
	// Logger handles strategy logging.
	Logger *utils.Logger

	// Market is the cached market object.
	Market *models.Market
	// OutcomeTokens maps outcomes to token IDs.
	OutcomeTokens []models.OutcomeToken
	// TickSize is the market tick size.
	// 마켓의 최소 가격 단위임. (ex: 0.1이 단위 시, 0.15주문 불가)
	TickSize float64
	// IsRunning indicates whether the strategy loop is active.
	IsRunning bool
	// positions caches outcome sizes.
	positions map[string]float64
	// openOrders caches open orders.
	openOrders []models.Order
	// deltaInfo caches position imbalance info.
	deltaInfo *DeltaInfo
	// nav caches the latest NAV breakdown.
	nav *models.NAV
	//* OnTick, OnStart, OnStop이 커스텀 모델
	// OnTick is called each loop tick.
	OnTick func()
	// OnStart is called when the strategy starts.
	OnStart func()
	// OnStop is called when the strategy stops.
	OnStop func()
}

// NewStrategy creates a Strategy with defaults.
// * 내 언어에선, 하나의 "Ghost"가 Exchange정보를 관리하기
// * "전략"의 개념은 따로 존재하지 않게 하기
func NewStrategy(exchange Exchange, marketID string) *Strategy {
	return &Strategy{
		Exchange:      exchange,
		Client:        NewExchangeClient(exchange, 2*time.Second, true),
		MarketID:      marketID,
		MaxPosition:   100,
		OrderSize:     5,
		MaxDelta:      20,
		CheckInterval: 5 * time.Second,
		Logger:        utils.SetupLogger("strategy", utils.LevelInfo),
		positions:     map[string]float64{},
		openOrders:    []models.Order{},
	}
}

// Setup initializes market data and token IDs.
//  SetUp을 통해 마켓을 관리함
func (s *Strategy) Setup() bool {
	_ = s.logger()
	market, err := s.Client.FetchMarket(s.MarketID)
	if err != nil {
		s.logger().Errorf("Failed to fetch market: %v", err)
		return false
	}
	if market == nil {
		s.logger().Errorf("Market not found: %s", s.MarketID)
		return false
	}
	s.Market = market
	tokenIDs := toStringSlice(market.Metadata["clobTokenIds"])
	if len(tokenIDs) == 0 {
		s.logger().Errorf("No token IDs found in market metadata")
		return false
	}
	s.TickSize = market.TickSize
	s.OutcomeTokens = make([]models.OutcomeToken, 0, len(market.Outcomes))
	for i, outcome := range market.Outcomes {
		if i >= len(tokenIDs) {
			break
		}
		s.OutcomeTokens = append(s.OutcomeTokens, models.OutcomeToken{
			MarketID: market.ID,
			Outcome:  outcome,
			TokenID:  tokenIDs[i],
		})
	}

	_ = s.Client.SetupOrderbookWebsocket(context.Background(), s.MarketID, tokenIDs)
	s.positions = s.Client.FetchPositionsDictForMarket(*market)
	s.logTraderProfile()
	s.logMarketInfo()
	return true
}

// logger returns the strategy logger, initializing if needed.
func (s *Strategy) logger() *utils.Logger {
	if s.Logger == nil {
		s.Logger = utils.SetupLogger("strategy", utils.LevelInfo)
	}
	return s.Logger
}

// logTraderProfile logs strategy profile metadata.
func (s *Strategy) logTraderProfile() {
	s.logger().Infof("\n%s", utils.Bold("Trader Profile"))
}

// logMarketInfo logs the current market summary.
func (s *Strategy) logMarketInfo() {
	if s.Market == nil {
		return
	}
	s.logger().Infof("\n%s %s", utils.Bold("Market:"), utils.Cyan(s.Market.Question))
	s.logger().Infof(
		"Outcomes: %s | Tick: %s | Vol: %s",
		utils.Magenta(fmt.Sprint(s.Outcomes())),
		utils.Yellow(fmt.Sprint(s.TickSize)),
		utils.Cyan(fmt.Sprintf("$%.0f", s.Market.Volume)),
	)
	for i, ot := range s.OutcomeTokens {
		price := s.Market.Prices[ot.Outcome]
		outcomeDisplay := ot.Outcome
		if len(outcomeDisplay) > 30 {
			outcomeDisplay = outcomeDisplay[:30] + "..."
		}
		s.logger().Infof("  [%d] %s: %s", i, utils.Magenta(outcomeDisplay), utils.Yellow(fmt.Sprintf("%.4f", price)))
	}
}

// RefreshState updates cached positions, orders, delta, and NAV.
func (s *Strategy) RefreshState() {
	s.positions = s.GetPositions()
	s.openOrders = s.GetOpenOrders()
	delta := CalculateDelta(s.positions)
	s.deltaInfo = &delta
	if s.Market != nil {
		nav := s.Client.CalculateNAV(s.Market)
		s.nav = &nav
	}
}

// Positions returns current positions.
func (s *Strategy) Positions() map[string]float64 {
	return s.positions
}

// OpenOrders returns open orders.
func (s *Strategy) OpenOrders() []models.Order {
	return s.openOrders
}

// Delta returns current delta.
func (s *Strategy) Delta() float64 {
	if s.deltaInfo == nil {
		return 0
	}
	return s.deltaInfo.Delta
}

// NAV returns current NAV.
func (s *Strategy) NAV() float64 {
	if s.nav == nil {
		return 0
	}
	return s.nav.NAV
}

// Cash returns current cash.
func (s *Strategy) Cash() float64 {
	if s.nav == nil {
		return 0
	}
	return s.nav.Cash
}

// Outcomes returns list of outcomes.
func (s *Strategy) Outcomes() []string {
	out := make([]string, 0, len(s.OutcomeTokens))
	for _, ot := range s.OutcomeTokens {
		out = append(out, ot.Outcome)
	}
	return out
}

// TokenIDs returns list of token IDs.
func (s *Strategy) TokenIDs() []string {
	out := make([]string, 0, len(s.OutcomeTokens))
	for _, ot := range s.OutcomeTokens {
		out = append(out, ot.TokenID)
	}
	return out
}

// LogStatus logs current status.
func (s *Strategy) LogStatus() {
	s.RefreshState()
	posStr := utils.Gray("None")
	if len(s.positions) > 0 {
		parts := []string{}
		for outcome, size := range s.positions {
			abbrev := outcome
			if len(s.Outcomes()) == 2 {
				abbrev = outcome[:1]
			} else if len(outcome) > 8 {
				abbrev = outcome[:8]
			}
			parts = append(parts, fmt.Sprintf("%s %s", utils.Blue(fmt.Sprintf("%.0f", size)), utils.Magenta(abbrev)))
		}
		posStr = strings.Join(parts, " ")
	}

	deltaSide := ""
	if s.deltaInfo != nil && s.deltaInfo.Delta > 0 && s.deltaInfo.MaxOutcome != "" {
		side := FormatDeltaSide(*s.deltaInfo, s.Outcomes(), true)
		if side != "" {
			deltaSide = " " + utils.Magenta(side)
		}
	}

	s.logger().Infof(
		"\n[%s] %s %s | Cash: %s | Pos: %s | Delta: %s%s | Orders: %s",
		time.Now().Format("15:04:05"),
		utils.Bold("NAV:"),
		utils.Green(fmt.Sprintf("$%.2f", s.NAV())),
		utils.Cyan(fmt.Sprintf("$%.2f", s.Cash())),
		posStr,
		utils.Yellow(fmt.Sprintf("%.1f", s.Delta())),
		deltaSide,
		utils.Cyan(fmt.Sprintf("%d", len(s.openOrders))),
	)

	for _, order := range s.openOrders {
		sideColored := utils.Green(strings.ToUpper(string(order.Side)))
		if order.Side == models.OrderSideSell {
			sideColored = utils.Red(strings.ToUpper(string(order.Side)))
		}
		outcomeDisplay := order.Outcome
		if len(outcomeDisplay) > 15 {
			outcomeDisplay = outcomeDisplay[:15]
		}
		size := order.Size
		s.logger().Infof("  %s %s %s %.0f @ %s", utils.Gray("Open:"), utils.Magenta(outcomeDisplay), sideColored, size, utils.Yellow(fmt.Sprintf("%.4f", order.Price)))
	}

	if s.Delta() > s.MaxDelta {
		s.logger().Warnf("Delta (%.2f) > max (%.2f) - reducing exposure", s.Delta(), s.MaxDelta)
	}
}

// LogOrder logs order placement.
func (s *Strategy) LogOrder(side models.OrderSide, size float64, outcome string, price float64, action string) {
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
	s.logger().Infof("    %s %s %.0f %s @ %s", utils.Gray(action), sideColored, size, utils.Magenta(outcomeDisplay), utils.Yellow(fmt.Sprintf("%.4f", price)))
}

// LogCancel logs order cancellation.
func (s *Strategy) LogCancel(side models.OrderSide, price float64) {
	sideColored := utils.Green("BUY")
	if side == models.OrderSideSell {
		sideColored = utils.Red("SELL")
	}
	s.logger().Infof("    %s %s @ %s", utils.Gray("x Cancel"), sideColored, utils.Yellow(fmt.Sprintf("%.4f", price)))
}

// GetPositions returns current positions as dict.
func (s *Strategy) GetPositions() map[string]float64 {
	if s.Market == nil {
		return map[string]float64{}
	}
	return s.Client.FetchPositionsDictForMarket(*s.Market)
}

// GetOpenOrders fetches open orders.
func (s *Strategy) GetOpenOrders() []models.Order {
	orders, err := s.Client.FetchOpenOrders(s.MarketID)
	if err != nil {
		s.logger().Warnf("Failed to fetch open orders: %v", err)
		return nil
	}
	return orders
}

// GetOrdersForOutcome returns buy and sell orders for an outcome.
func (s *Strategy) GetOrdersForOutcome(outcome string) ([]models.Order, []models.Order) {
	buy := []models.Order{}
	sell := []models.Order{}
	for _, order := range s.openOrders {
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
func (s *Strategy) CancelAllOrders() int {
	cancelled := s.Client.CancelAllOrders(s.MarketID)
	if cancelled > 0 {
		s.logger().Infof("Cancelled %s orders", utils.Cyan(fmt.Sprintf("%d", cancelled)))
	}
	return cancelled
}

// CancelStaleOrders cancels orders not at target price.
func (s *Strategy) CancelStaleOrders(orders []models.Order, targetPrice float64, tolerance float64) bool {
	cancelled := false
	for _, order := range orders {
		if absFloat(order.Price-targetPrice) >= tolerance {
			if _, err := s.Client.CancelOrder(order.ID, s.MarketID); err == nil {
				s.LogCancel(order.Side, order.Price)
				cancelled = true
			}
		}
	}
	return cancelled
}

// HasOrderAtPrice checks if any order is at the given price.
func (s *Strategy) HasOrderAtPrice(orders []models.Order, price float64, tolerance float64) bool {
	for _, order := range orders {
		if absFloat(order.Price-price) < tolerance {
			return true
		}
	}
	return false
}

// GetOrderbook returns an orderbook for a token.
func (s *Strategy) GetOrderbook(tokenID string) map[string]any {
	return s.Client.GetOrderbook(tokenID)
}

// GetBestBidAsk returns best bid/ask for a token.
func (s *Strategy) GetBestBidAsk(tokenID string) (*float64, *float64) {
	return s.Client.GetBestBidAsk(tokenID)
}

// RoundPrice rounds price to tick size.
func (s *Strategy) RoundPrice(price float64) float64 {
	rounded, err := utils.RoundToTickSize(price, s.TickSize)
	if err != nil {
		return price
	}
	return rounded
}

// GetTokenID returns token ID for an outcome.
func (s *Strategy) GetTokenID(outcome string) string {
	for _, ot := range s.OutcomeTokens {
		if ot.Outcome == outcome {
			return ot.TokenID
		}
	}
	return ""
}

// CreateOrder submits an order.
func (s *Strategy) CreateOrder(outcome string, side models.OrderSide, price, size float64, tokenID string, params map[string]any) (models.Order, error) {
	if tokenID == "" {
		tokenID = s.GetTokenID(outcome)
	}
	if params == nil {
		params = map[string]any{}
	}
	if tokenID != "" {
		params["token_id"] = tokenID
	}
	return s.Client.CreateOrder(s.MarketID, outcome, side, s.RoundPrice(price), size, params)
}

// PlaceBBOOrders places best bid/offer orders.
func (s *Strategy) PlaceBBOOrders(getBBO func(tokenID string) (*float64, *float64)) {
	if getBBO == nil {
		getBBO = s.GetBestBidAsk
	}
	for _, ot := range s.OutcomeTokens {
		s.placeBBOForOutcome(ot.Outcome, ot.TokenID, getBBO)
	}
}

// placeBBOForOutcome places best bid/offer orders for one outcome.
func (s *Strategy) placeBBOForOutcome(outcome, tokenID string, getBBO func(string) (*float64, *float64)) {
	bestBid, bestAsk := getBBO(tokenID)
	if bestBid == nil || bestAsk == nil {
		return
	}
	ourBid := s.RoundPrice(*bestBid)
	ourAsk := s.RoundPrice(*bestAsk)
	if ourBid >= ourAsk {
		return
	}
	position := s.positions[outcome]
	buyOrders, sellOrders := s.GetOrdersForOutcome(outcome)

	if s.deltaInfo != nil && s.Delta() > s.MaxDelta {
		if position == s.deltaInfo.MaxPosition {
			return
		}
	}

	if !s.HasOrderAtPrice(buyOrders, ourBid, 0.001) {
		s.CancelStaleOrders(buyOrders, ourBid, 0.001)
		if position+s.OrderSize <= s.MaxPosition && s.Cash() >= s.OrderSize {
			if _, err := s.CreateOrder(outcome, models.OrderSideBuy, ourBid, s.OrderSize, tokenID, nil); err == nil {
				s.LogOrder(models.OrderSideBuy, s.OrderSize, outcome, ourBid, "")
			}
		}
	}

	if !s.HasOrderAtPrice(sellOrders, ourAsk, 0.001) {
		s.CancelStaleOrders(sellOrders, ourAsk, 0.001)
		if position >= s.OrderSize {
			if _, err := s.CreateOrder(outcome, models.OrderSideSell, ourAsk, s.OrderSize, tokenID, nil); err == nil {
				s.LogOrder(models.OrderSideSell, s.OrderSize, outcome, ourAsk, "")
			}
		}
	}
}

// LiquidatePositions sells all positions at best bid.
func (s *Strategy) LiquidatePositions() {
	positions := s.GetPositions()
	if len(positions) == 0 {
		s.logger().Infof("No positions to liquidate")
		return
	}
	s.logger().Infof("%s", utils.Bold("Liquidating positions..."))
	for outcome, size := range positions {
		if size <= 0 {
			continue
		}
		tokenID := s.GetTokenID(outcome)
		if tokenID == "" {
			continue
		}
		bestBid, _ := s.GetBestBidAsk(tokenID)
		if bestBid == nil || *bestBid <= 0 {
			continue
		}
		sellSize := float64(int(size))
		if sellSize <= 0 {
			continue
		}
		if _, err := s.CreateOrder(outcome, models.OrderSideSell, *bestBid, sellSize, tokenID, nil); err == nil {
			s.LogOrder(models.OrderSideSell, sellSize, outcome, *bestBid, "LIQUIDATE")
		}
	}
}

// Cleanup cancels orders, liquidates positions, and stops the client.
func (s *Strategy) Cleanup(ctx context.Context) {
	s.logger().Infof("\n%s", utils.Bold("Cleaning up..."))
	s.CancelAllOrders()
	s.LiquidatePositions()
	time.Sleep(3 * time.Second)
	s.Client.Stop(ctx)
}

// Run starts the strategy loop.
// * Strategy가 Will+ Ghost중임
// * Strategy에서 내가 반드시 덜어내야 하는 부분. 실행은 Ghost에 맡겨야 함
// ! 단 내 경우에도, Strategy참고 해서, "종료 시간"을 기입하게 하기
// ! 물론 이후엔 내 스케쥴링 연구 바탕으로 이런거 필요 없겠지만. 지금 여기서 실험해 두기
func (s *Strategy) Run(durationMinutes float64) {
	s.logger().Infof(
		"\n%s MaxPos=%s | Size=%s | MaxDelta=%s | Interval=%s",
		utils.Bold("Strategy:"),
		utils.Blue(fmt.Sprintf("%.0f", s.MaxPosition)),
		utils.Yellow(fmt.Sprintf("%.0f", s.OrderSize)),
		utils.Yellow(fmt.Sprintf("%.0f", s.MaxDelta)),
		utils.Gray(fmt.Sprintf("%.0fs", s.CheckInterval.Seconds())),
	)

	if !s.Setup() {
		s.logger().Errorf("Setup failed. Exiting.")
		return
	}

	if s.OnStart != nil {
		s.OnStart()
	}

	s.IsRunning = true
	start := time.Now()
	var end time.Time
	if durationMinutes > 0 {
		end = start.Add(time.Duration(durationMinutes * float64(time.Minute)))
	}

	for s.IsRunning {
		//* 이 Strategy는 "종료 시간"을 명시한다!
		if !end.IsZero() && time.Now().After(end) {
			break
		}
		if s.OnTick != nil {
			s.OnTick()
		}
		time.Sleep(s.CheckInterval)
	}

	s.IsRunning = false
	if s.OnStop != nil {
		s.OnStop()
	}
	s.Cleanup(context.Background())
	s.logger().Infof("Strategy stopped")
}

// Stop signals the strategy to stop.
func (s *Strategy) Stop() {
	s.IsRunning = false
}

// absFloat returns the absolute value of a float.
func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

// toStringSlice converts a generic slice to a string slice.
func toStringSlice(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		return out
	default:
		return nil
	}
}
