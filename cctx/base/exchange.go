package base

import (
	"errors"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/utils"
)

// Exchange defines the unified exchange interface.
type Exchange interface {
	// ID returns the exchange identifier.
	ID() string
	// Name returns the human-readable exchange name.
	Name() string
	// FetchMarkets lists markets with optional filtering params.
	FetchMarkets(params map[string]any) ([]models.Market, error)
	// FetchMarket returns a single market by identifier.
	FetchMarket(marketID string) (models.Market, error)
	// CreateOrder submits a new order.
	CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error)
	// CancelOrder cancels an order by ID.
	CancelOrder(orderID string, marketID *string) (models.Order, error)
	// FetchOrder retrieves an order by ID.
	FetchOrder(orderID string, marketID *string) (models.Order, error)
	// FetchOpenOrders returns open orders for a market or all markets.
	FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error)
	// FetchPositions returns positions for a market or all markets.
	FetchPositions(marketID *string, params map[string]any) ([]models.Position, error)
	// FetchBalance returns the available balance mapping.
	FetchBalance() (map[string]float64, error)
}

// Optional capability interfaces.
type MarketSlugFetcher interface {
	// FetchMarketsBySlug returns markets matching a slug.
	FetchMarketsBySlug(slug string) ([]models.Market, error)
}

type PositionsForMarketFetcher interface {
	// FetchPositionsForMarket returns positions for a given market object.
	FetchPositionsForMarket(market models.Market) ([]models.Position, error)
}

type OrderbookProvider interface {
	// GetOrderbook returns orderbook snapshot for a token ID.
	GetOrderbook(tokenID string) (map[string]any, error)
}

type MarketWebsocketProvider interface {
	// GetWebsocket returns a market data websocket.
	GetWebsocket() OrderbookWebSocket
}

type UserWebsocketProvider interface {
	// GetUserWebsocket returns a user data websocket.
	GetUserWebsocket() UserWebSocket
}

// BaseExchange provides shared helpers for exchanges.
type BaseExchange struct {
	// Config stores raw exchange configuration.
	Config map[string]any
	// APIKey is an exchange API key.
	APIKey string
	// APISecret is an exchange API secret.
	APISecret string
	// Timeout is the HTTP request timeout.
	Timeout time.Duration
	// Verbose toggles verbose logging.
	Verbose bool
	// RateLimit is the max requests per second.
	RateLimit int
	// MaxRetries is the number of retries for retryable errors.
	MaxRetries int
	// RetryDelay is the base delay between retries.
	RetryDelay time.Duration
	// RetryBackoff is the exponential backoff factor.
	//재시도 시 지수적으로 대기시간 늘림
	RetryBackoff float64
	// requestTimes holds timestamps for rate limiting.
	requestTimes []time.Time
	// requestTimesM guards requestTimes.
	requestTimesM sync.Mutex
	// self points to the concrete Exchange implementation.
	self Exchange
}

// NewBaseExchange builds a BaseExchange with defaults.
func NewBaseExchange(config map[string]any) BaseExchange {
	if config == nil {
		utils.DefaultLogger().Debugf("base.NewBaseExchange: config is nil")
	}
	timeout := 30 * time.Second
	if raw, ok := config["timeout"].(float64); ok && raw > 0 {
		timeout = time.Duration(raw * float64(time.Second))
	}
	rateLimit := 10
	if raw, ok := config["rate_limit"].(int); ok && raw > 0 {
		rateLimit = raw
	}
	if raw, ok := config["rate_limit"].(float64); ok && raw > 0 {
		rateLimit = int(raw)
	}
	maxRetries := 3
	if raw, ok := config["max_retries"].(int); ok && raw >= 0 {
		maxRetries = raw
	}
	if raw, ok := config["max_retries"].(float64); ok && raw >= 0 {
		maxRetries = int(raw)
	}
	retryDelay := 1.0
	if raw, ok := config["retry_delay"].(float64); ok && raw > 0 {
		retryDelay = raw
	}
	retryBackoff := 2.0
	if raw, ok := config["retry_backoff"].(float64); ok && raw > 0 {
		retryBackoff = raw
	}
	verbose, _ := config["verbose"].(bool)

	return BaseExchange{
		Config:       config,
		APIKey:       stringFromConfig(config, "api_key"),
		APISecret:    stringFromConfig(config, "api_secret"),
		Timeout:      timeout,
		Verbose:      verbose,
		RateLimit:    rateLimit,
		MaxRetries:   maxRetries,
		RetryDelay:   time.Duration(retryDelay * float64(time.Second)),
		RetryBackoff: retryBackoff,
	}
}

// Bind attaches the concrete exchange to the base helper.
func (b *BaseExchange) Bind(self Exchange) {
	b.self = self
}

// FindTradeableMarket finds a suitable market for trading.
func (b *BaseExchange) FindTradeableMarket(binary bool, limit int, minLiquidity float64) (*models.Market, error) {
	if b.self == nil {
		return nil, errors.New("exchange not bound")
	}
	if limit <= 0 {
		limit = 100
	}
	markets, err := b.self.FetchMarkets(map[string]any{"limit": limit})
	if err != nil {
		return nil, err
	}

	suitable := make([]models.Market, 0, len(markets))
	for _, market := range markets {
		if binary && !market.IsBinary() {
			continue
		}
		if !market.IsOpen() {
			continue
		}
		if market.Liquidity < minLiquidity {
			continue
		}
		if hasTokenIDs(market.Metadata) == false {
			continue
		}
		suitable = append(suitable, market)
	}

	if len(suitable) == 0 {
		return nil, nil
	}
	chosen := suitable[rand.Intn(len(suitable))]
	return &chosen, nil
}

// FindCryptoHourlyMarket finds a crypto hourly market using pattern matching.
func (b *BaseExchange) FindCryptoHourlyMarket(tokenSymbol string, minLiquidity float64, limit int) (*models.Market, *models.CryptoHourlyMarket, error) {
	return b.parseCryptoHourlyFromMarkets(tokenSymbol, "", minLiquidity, limit)
}

// parseCryptoHourlyFromMarkets scans markets to identify crypto hourly markets.
func (b *BaseExchange) parseCryptoHourlyFromMarkets(tokenSymbol, direction string, minLiquidity float64, limit int) (*models.Market, *models.CryptoHourlyMarket, error) {
	if b.self == nil {
		return nil, nil, errors.New("exchange not bound")
	}
	if limit <= 0 {
		limit = 100
	}
	markets, err := b.self.FetchMarkets(map[string]any{"limit": limit})
	if err != nil {
		return nil, nil, err
	}

	pattern := regexp.MustCompile(`(?i)(?:(?P<token1>BTC|ETH|SOL|BITCOIN|ETHEREUM|SOLANA)\s+.*?(?P<direction>above|below|over|under|reach)\s+[\$]?(?P<price1>[\d,]+(?:\.\d+)?))|(?:[\$]?(?P<price2>[\d,]+(?:\.\d+)?)\s+.*?(?P<token2>BTC|ETH|SOL|BITCOIN|ETHEREUM|SOLANA))`)

	for _, market := range markets {
		if !market.IsBinary() || !market.IsOpen() {
			continue
		}
		if market.Liquidity < minLiquidity {
			continue
		}
		if hasTokenIDs(market.Metadata) == false {
			continue
		}

		match := pattern.FindStringSubmatch(market.Question)
		if match == nil {
			continue
		}

		parsedToken := pickNamedGroup(pattern, match, "token1")
		if parsedToken == "" {
			parsedToken = pickNamedGroup(pattern, match, "token2")
		}
		parsedPrice := pickNamedGroup(pattern, match, "price1")
		if parsedPrice == "" {
			parsedPrice = pickNamedGroup(pattern, match, "price2")
		}
		parsedDirection := strings.ToLower(pickNamedGroup(pattern, match, "direction"))
		if parsedDirection == "" {
			parsedDirection = "reach"
		}

		parsedToken = strings.ToUpper(parsedToken)
		switch parsedToken {
		case "BITCOIN":
			parsedToken = "BTC"
		case "ETHEREUM":
			parsedToken = "ETH"
		case "SOLANA":
			parsedToken = "SOL"
		}

		normalizedDirection := parsedDirection
		switch parsedDirection {
		case "above", "over", "reach":
			normalizedDirection = "up"
		case "below", "under":
			normalizedDirection = "down"
		}

		priceValue := parseFloat(strings.ReplaceAll(parsedPrice, ",", ""))
		if tokenSymbol != "" && strings.ToUpper(tokenSymbol) != parsedToken {
			continue
		}
		if direction != "" && strings.ToLower(direction) != normalizedDirection {
			continue
		}

		expiry := time.Now().Add(time.Hour)
		if market.CloseTime != nil {
			expiry = *market.CloseTime
		}

		cryptoMarket := models.CryptoHourlyMarket{
			TokenSymbol: parsedToken,
			ExpiryTime:  expiry,
			StrikePrice: &priceValue,
			MarketType:  models.CryptoHourlyMarketTypeStrikePrice,
			Direction:   normalizedDirection,
		}
		selected := market
		return &selected, &cryptoMarket, nil
	}

	return nil, nil, nil
}

// Describe returns exchange metadata and capabilities.
func (b *BaseExchange) Describe(id, name string) map[string]any {
	return map[string]any{
		"id":   id,
		"name": name,
		"has": map[string]bool{
			"fetch_markets":     true,
			"fetch_market":      true,
			"create_order":      true,
			"cancel_order":      true,
			"fetch_order":       true,
			"fetch_open_orders": true,
			"fetch_positions":   true,
			"fetch_balance":     true,
			"rate_limit":        true,
			"retry_logic":       true,
		},
	}
}

// CheckRateLimit enforces the rate limit.
func (b *BaseExchange) CheckRateLimit() {
	b.requestTimesM.Lock()
	defer b.requestTimesM.Unlock()

	now := time.Now()
	threshold := now.Add(-1 * time.Second)
	trimmed := b.requestTimes[:0]
	for _, ts := range b.requestTimes {
		if ts.After(threshold) {
			trimmed = append(trimmed, ts)
		}
	}
	b.requestTimes = trimmed
	if b.RateLimit > 0 && len(b.requestTimes) >= b.RateLimit {
		sleep := time.Second - now.Sub(b.requestTimes[0])
		if sleep > 0 {
			time.Sleep(sleep)
		}
	}
	b.requestTimes = append(b.requestTimes, time.Now())
}

// RetryOnFailure runs fn with retry logic for network/rate errors.
func (b *BaseExchange) RetryOnFailure(fn func() error) error {
	var lastErr error
	for attempt := 0; attempt <= b.MaxRetries; attempt++ {
		b.CheckRateLimit()
		if err := fn(); err != nil {
			lastErr = err
			if !isRetryable(err) {
				return err
			}
			if attempt < b.MaxRetries {
				delay := b.RetryDelay * time.Duration(b.RetryBackoff*float64(attempt))
				if delay <= 0 {
					delay = b.RetryDelay
				}
				delay = delay + time.Duration(rand.Float64()*float64(time.Second))
				time.Sleep(delay)
				continue
			}
			return lastErr
		}
		return nil
	}
	return lastErr
}

// CalculateSpread returns bid-ask spread for a market.
func (b *BaseExchange) CalculateSpread(market models.Market) *float64 {
	return market.Spread()
}

// CalculateImpliedProbability returns implied probability from price.
// 시장 효율성을 상정함. price==probablity
func (b *BaseExchange) CalculateImpliedProbability(price float64) float64 {
	return price
}

// CalculateExpectedValue calculates expected value for a given outcome.
// ==기대수익 = (확률*수익)-비용
// 현재는 효율적 시장가설에 입각한 기대수익이라 항상 수익이 0됨
func (b *BaseExchange) CalculateExpectedValue(market models.Market, outcome string, price float64) float64 {
	if !market.IsBinary() {
		return 0
	}
	probability := b.CalculateImpliedProbability(price)
	payoff := 0.0
	if len(market.Outcomes) > 0 && outcome == market.Outcomes[0] {
		payoff = 1.0
	}
	return probability*payoff - price
}

// GetOptimalOrderSize calculates order size based on liquidity.
func (b *BaseExchange) GetOptimalOrderSize(market models.Market, maxPositionSize float64) float64 {
	liquidityBased := market.Liquidity * 0.1
	if liquidityBased < maxPositionSize {
		return liquidityBased
	}
	return maxPositionSize
}

// stringFromConfig returns a string config value if present.
func stringFromConfig(config map[string]any, key string) string {
	value, ok := config[key]
	if !ok {
		return ""
	}
	if str, ok := value.(string); ok {
		return str
	}
	return ""
}

// hasTokenIDs reports whether metadata includes token IDs.
func hasTokenIDs(meta map[string]any) bool {
	if meta == nil {
		return true
	}
	raw, ok := meta["clobTokenIds"]
	if !ok {
		return true
	}
	switch value := raw.(type) {
	case []string:
		return len(value) > 0
	case []any:
		return len(value) > 0
	default:
		return true
	}
}

// pickNamedGroup returns a named regexp capture.
func pickNamedGroup(re *regexp.Regexp, match []string, name string) string {
	for i, groupName := range re.SubexpNames() {
		if groupName == name && i < len(match) {
			return match[i]
		}
	}
	return ""
}

// parseFloat parses a float string, returning 0 on failure.
func parseFloat(value string) float64 {
	if value == "" {
		return 0
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// isRetryable reports whether an error is retryable.
func isRetryable(err error) bool {
	var networkErr NetworkError
	var rateErr RateLimitError
	if errors.As(err, &networkErr) || errors.As(err, &rateErr) {
		return true
	}
	return false
}
