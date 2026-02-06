package exchanges

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"cctx/base"
	"cctx/models"
	"cctx/utils"
)

// Polymarket exchange implementation.
type Polymarket struct {
	// BaseExchange embeds shared exchange behavior.
	base.BaseExchange
	// BaseURL is the Gamma API base URL.
	BaseURL string
	// CLOBURL is the CLOB API base URL.
	CLOBURL string
	// DataURL is the data API base URL.
	DataURL string
	// PricesHistoryURL is the price history endpoint base.
	PricesHistoryURL string
	// SupportedIntervals are valid price history intervals.
	SupportedIntervals []string
	// Tag1H is the tag identifier for 1h markets.
	Tag1H string
	// ChainID is the chain ID for signing.
	ChainID int64
	// PrivateKey is the signer private key.
	PrivateKey string
	// APIPassphrase is the API passphrase.
	APIPassphrase string
	// Funder is the funder address.
	Funder string
	// httpClient handles HTTP requests.
	httpClient *http.Client
	// clobClient handles CLOB requests and signing.
	clobClient *clobClient
	// initErr stores initialization errors.
	initErr error
	// ws is the market websocket client.
	ws *PolymarketWebSocket
	// userWS is the user websocket client.
	userWS *PolymarketUserWebSocket
}

const (
	polymarketBaseURL = "https://gamma-api.polymarket.com"
	polymarketCLOBURL = "https://clob.polymarket.com"
	polymarketDataURL = "https://data-api.polymarket.com"
)

// PolymarketPublicTrade mirrors public trade data from Polymarket.
type PolymarketPublicTrade struct {
	// ProxyWallet is the proxy wallet address.
	ProxyWallet string
	// Side is the trade side.
	Side string
	// Asset is the asset identifier.
	Asset string
	// ConditionID is the condition identifier.
	ConditionID string
	// Size is the trade size.
	Size float64
	// Price is the trade price.
	Price float64
	// Timestamp is the trade time.
	Timestamp time.Time
	// Title is the market title.
	Title string
	// Slug is the market slug.
	Slug string
	// Icon is the market icon URL.
	Icon string
	// EventSlug is the event slug.
	EventSlug string
	// Outcome is the outcome label.
	Outcome string
	// OutcomeIndex is the outcome index.
	OutcomeIndex int
	// Name is the trader name.
	Name string
	// Pseudonym is the trader pseudonym.
	Pseudonym string
	// Bio is the trader bio.
	Bio string
	// ProfileImage is the profile image URL.
	ProfileImage string
	// ProfileImageOptimized is the optimized profile image URL.
	ProfileImageOptimized string
	// TransactionHash is the trade transaction hash.
	TransactionHash string
}

// PolymarketPricePoint represents a single price history point.
type PolymarketPricePoint struct {
	// Timestamp is the time of the price point.
	Timestamp time.Time
	// Price is the price at that time.
	Price float64
	// Raw holds the raw payload for reference.
	Raw map[string]any
}

// PolymarketTag represents a Polymarket tag.
type PolymarketTag struct {
	// ID is the tag identifier.
	ID string
	// Label is the tag label.
	Label string
	// Slug is the tag slug.
	Slug string
	// ForceShow indicates forced visibility.
	ForceShow *bool
	// ForceHide indicates forced hiding.
	ForceHide *bool
	// IsCarousel indicates carousel display.
	IsCarousel *bool
	// Published is the published timestamp string.
	Published string
	// CreatedAt is the creation timestamp string.
	CreatedAt string
	// UpdatedAt is the updated timestamp string.
	UpdatedAt string
	// Raw holds the raw payload for reference.
	Raw map[string]any
}

// NewPolymarket creates a new Polymarket exchange.
func NewPolymarket(config map[string]any) (base.Exchange, error) {
	if config == nil {
		utils.DefaultLogger().Debugf("exchanges.NewPolymarket: config is nil")
		return nil, fmt.Errorf("exchanges.NewPolymarket: config is nil")
	}
	ex := &Polymarket{
		BaseExchange:       base.NewBaseExchange(config),
		BaseURL:            polymarketBaseURL,
		CLOBURL:            polymarketCLOBURL,
		DataURL:            polymarketDataURL,
		PricesHistoryURL:   polymarketCLOBURL + "/prices-history",
		SupportedIntervals: []string{"1m", "1h", "6h", "1d", "1w", "max"},
		Tag1H:              "102175",
		ChainID:            137,
		httpClient:         &http.Client{Timeout: 30 * time.Second},
	}
	ex.BaseExchange.Bind(ex)

	ex.PrivateKey, _ = config["private_key"].(string)
	ex.APIPassphrase, _ = config["api_passphrase"].(string)
	ex.Funder, _ = config["funder"].(string)
	if raw, ok := config["chain_id"].(float64); ok {
		ex.ChainID = int64(raw)
	} else if raw, ok := config["chain_id"].(int); ok {
		ex.ChainID = int64(raw)
	}

	ex.initErr = ex.initClobClient()
	return ex, nil
}

// ID returns the exchange identifier.
func (p *Polymarket) ID() string {
	return "polymarket"
}

// Name returns the display name.
func (p *Polymarket) Name() string {
	return "Polymarket"
}

// FetchMarkets returns markets with optional filtering params.
func (p *Polymarket) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if params == nil {
		params = map[string]any{}
	}
	var markets []models.Market
	err := p.RetryOnFailure(func() error {
		response, err := p.fetchJSON(p.CLOBURL + "/sampling-markets")
		if err != nil {
			return err
		}
		items := toSlice(response)
		for _, item := range items {
			if market := p.parseSamplingMarket(item); market != nil {
				markets = append(markets, *market)
			}
		}
		return nil
	})
	if err != nil && len(markets) == 0 {
		return p.fetchMarketsGamma(params)
	}

	if active, ok := params["active"].(bool); ok && active {
		filtered := markets[:0]
		for _, market := range markets {
			if market.IsOpen() {
				filtered = append(filtered, market)
			}
		}
		markets = filtered
	}
	if limit, ok := toInt(params["limit"]); ok && limit > 0 && len(markets) > limit {
		markets = markets[:limit]
	}
	return markets, nil
}

// FetchMarket returns a single market by ID.
func (p *Polymarket) FetchMarket(marketID string) (models.Market, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchMarket: marketID empty")
	}
	var market models.Market
	err := p.RetryOnFailure(func() error {
		data, err := p.fetchJSON(fmt.Sprintf("%s/markets/%s", p.BaseURL, marketID))
		if err != nil {
			return err
		}
		parsed := p.parseMarket(data)
		market = parsed
		return nil
	})
	if err != nil {
		return models.Market{}, base.MarketNotFound{Message: fmt.Sprintf("market %s not found", marketID)}
	}
	return market, nil
}

// FetchMarketsBySlug resolves markets by slug or URL.
func (p *Polymarket) FetchMarketsBySlug(slugOrURL string) ([]models.Market, error) {
	slug := parseMarketIdentifier(slugOrURL)
	if slug == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchMarketsBySlug: slug empty (input=%q)", slugOrURL)
		return nil, errors.New("empty slug provided")
	}
	url := fmt.Sprintf("%s/events?slug=%s", p.BaseURL, slug)
	data, err := p.fetchJSON(url)
	if err != nil {
		return nil, err
	}
	events := toSlice(data)
	if len(events) == 0 {
		return nil, base.MarketNotFound{Message: fmt.Sprintf("event not found: %s", slug)}
	}
	event, _ := events[0].(map[string]any)
	rawMarkets := toSlice(event["markets"])
	if len(rawMarkets) == 0 {
		return nil, base.MarketNotFound{Message: fmt.Sprintf("no markets found in event: %s", slug)}
	}
	markets := make([]models.Market, 0, len(rawMarkets))
	for _, item := range rawMarkets {
		parsed := p.parseMarket(item)
		if parsed.Metadata == nil {
			parsed.Metadata = map[string]any{}
		}
		parsed.Metadata["readable_id"] = []string{slug, parsed.ID}
		if tokens := parseTokenIDs(item); len(tokens) > 0 {
			parsed.Metadata["clobTokenIds"] = tokens
		}
		markets = append(markets, parsed)
	}
	return markets, nil
}

// CreateOrder submits a new order.
func (p *Polymarket) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.CreateOrder: marketID empty")
	}
	if outcome == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.CreateOrder: outcome empty")
	}
	if price == 0 || size == 0 {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.CreateOrder: price or size zero (price=%.6f size=%.6f)", price, size)
	}
	if p.initErr != nil {
		return models.Order{}, p.initErr
	}
	if p.clobClient == nil {
		return models.Order{}, base.AuthenticationError{Message: "CLOB client not initialized"}
	}
	tokenID := ""
	if params != nil {
		if raw, ok := params["token_id"].(string); ok {
			tokenID = raw
		}
	}
	if tokenID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.CreateOrder: token_id missing in params")
		return models.Order{}, base.InvalidOrder{Message: "token_id required in params"}
	}

	feeRate, _ := p.clobClient.getFeeRateBps(tokenID)
	tickSize, err := p.clobClient.getTickSize(tokenID)
	if err != nil || tickSize == 0 {
		tickSize = 0.01
	}
	negRisk, _ := p.clobClient.getNegRisk(tokenID)

	signed, err := p.clobClient.buildSignedOrder(orderArgs{
		TokenID:    tokenID,
		Price:      price,
		Size:       size,
		Side:       strings.ToUpper(string(side)),
		FeeRateBps: feeRate,
	}, tickSize, negRisk)
	if err != nil {
		return models.Order{}, base.InvalidOrder{Message: fmt.Sprintf("order placement failed: %v", err)}
	}
	result, err := p.clobClient.postOrder(signed, "GTC", false)
	if err != nil {
		return models.Order{}, base.InvalidOrder{Message: fmt.Sprintf("order placement failed: %v", err)}
	}
	orderID := ""
	if raw, ok := result["orderID"].(string); ok {
		orderID = raw
	} else if raw, ok := result["order_id"].(string); ok {
		orderID = raw
	}
	status := parseOrderStatus(result["status"])
	now := time.Now()
	return models.Order{
		ID:        orderID,
		MarketID:  marketID,
		Outcome:   outcome,
		Side:      side,
		Price:     price,
		Size:      size,
		Filled:    0,
		Status:    status,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// CancelOrder cancels an order by ID.
func (p *Polymarket) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if orderID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.CancelOrder: orderID empty")
	}
	if p.initErr != nil {
		return models.Order{}, p.initErr
	}
	if p.clobClient == nil {
		return models.Order{}, base.AuthenticationError{Message: "CLOB client not initialized"}
	}
	result, err := p.clobClient.cancelOrder(orderID)
	if err != nil {
		return models.Order{}, base.InvalidOrder{Message: fmt.Sprintf("failed to cancel order %s: %v", orderID, err)}
	}
	if order, ok := p.parseOrder(result); ok {
		return order, nil
	}
	return models.Order{
		ID:        orderID,
		MarketID:  derefString(marketID),
		Outcome:   "",
		Side:      models.OrderSideBuy,
		Price:     0,
		Size:      0,
		Filled:    0,
		Status:    models.OrderStatusCancelled,
		CreatedAt: time.Now(),
	}, nil
}

// FetchOrder fetches an order by ID.
func (p *Polymarket) FetchOrder(orderID string, _ *string) (models.Order, error) {
	if orderID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchOrder: orderID empty")
	}
	if p.initErr != nil {
		return models.Order{}, p.initErr
	}
	if p.clobClient == nil {
		return models.Order{}, base.AuthenticationError{Message: "CLOB client not initialized"}
	}
	headers, err := p.clobClient.level2Headers("GET", "/data/order/"+orderID, nil)
	if err != nil {
		return models.Order{}, err
	}
	resp, err := p.clobClient.doRequest("GET", "/data/order/"+orderID, nil, headers)
	if err != nil {
		return models.Order{}, err
	}
	var payload map[string]any
	if err := json.Unmarshal(resp, &payload); err != nil {
		return models.Order{}, err
	}
	order, _ := p.parseOrder(payload)
	return order, nil
}

// FetchOpenOrders returns open orders for a market.
func (p *Polymarket) FetchOpenOrders(marketID *string, _ map[string]any) ([]models.Order, error) {
	if marketID != nil && *marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchOpenOrders: marketID empty")
	}
	if p.initErr != nil {
		return nil, p.initErr
	}
	if p.clobClient == nil {
		return nil, base.AuthenticationError{Message: "CLOB client not initialized"}
	}
	rawOrders, err := p.clobClient.getOrders()
	if err != nil {
		return nil, err
	}
	orders := []models.Order{}
	for _, raw := range rawOrders {
		if marketID != nil {
			if market, ok := raw["market"].(string); ok && market != *marketID {
				continue
			}
		}
		if order, ok := p.parseOrder(raw); ok {
			orders = append(orders, order)
		}
	}
	return orders, nil
}

// FetchPositions returns positions for a market or all markets.
func (p *Polymarket) FetchPositions(marketID *string, _ map[string]any) ([]models.Position, error) {
	if marketID == nil || *marketID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchPositions: marketID empty")
	}
	if p.initErr != nil {
		return nil, p.initErr
	}
	if marketID == nil || *marketID == "" {
		return []models.Position{}, nil
	}
	market, err := p.FetchMarket(*marketID)
	if err != nil {
		return nil, err
	}
	return p.FetchPositionsForMarket(market)
}

// FetchPositionsForMarket returns positions for a market object.
func (p *Polymarket) FetchPositionsForMarket(market models.Market) ([]models.Position, error) {
	if p.initErr != nil {
		return nil, p.initErr
	}
	if p.clobClient == nil {
		return nil, base.AuthenticationError{Message: "CLOB client not initialized"}
	}
	tokenIDs := parseTokenIDList(market.Metadata["clobTokenIds"])
	if len(tokenIDs) < 1 {
		return []models.Position{}, nil
	}
	positions := []models.Position{}
	for i, tokenID := range tokenIDs {
		balance, err := p.clobClient.getBalanceAllowance("CONDITIONAL", tokenID, signatureTypeEOA)
		if err != nil {
			continue
		}
		size := parseBalance(balance["balance"])
		if size <= 0 {
			continue
		}
		outcome := outcomeForIndex(market.Outcomes, i)
		currentPrice := market.Prices[outcome]
		positions = append(positions, models.Position{
			MarketID:     market.ID,
			Outcome:      outcome,
			Size:         size,
			AveragePrice: 0,
			CurrentPrice: currentPrice,
		})
	}
	return positions, nil
}

// FetchBalance returns account balance.
func (p *Polymarket) FetchBalance() (map[string]float64, error) {
	if p.initErr != nil {
		return nil, p.initErr
	}
	if p.clobClient == nil {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchBalance: clobClient nil")
		return nil, base.AuthenticationError{Message: "CLOB client not initialized"}
	}
	balance, err := p.clobClient.getBalanceAllowance("COLLATERAL", "", signatureTypeEOA)
	if err != nil {
		return nil, err
	}
	usdc := parseBalance(balance["balance"])
	return map[string]float64{"USDC": usdc}, nil
}

// GetWebsocket returns a market websocket client.
func (p *Polymarket) GetWebsocket() base.OrderbookWebSocket {
	if p.ws == nil {
		p.ws = NewPolymarketWebSocket(map[string]any{"verbose": p.Verbose}, p)
	}
	return p.ws
}

// GetUserWebsocket returns a user websocket client.
func (p *Polymarket) GetUserWebsocket() base.UserWebSocket {
	if p.clobClient == nil || p.clobClient.creds == nil {
		return nil
	}
	if p.userWS == nil {
		p.userWS = NewPolymarketUserWebSocket(
			p.clobClient.creds.APIKey,
			p.clobClient.creds.APISecret,
			p.clobClient.creds.APIPassphrase,
			p.Verbose,
		)
	}
	return p.userWS
}

// GetOrderbook returns an orderbook snapshot for a token.
func (p *Polymarket) GetOrderbook(tokenID string) map[string]any {
	if tokenID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.GetOrderbook: tokenID empty")
	}
	url := fmt.Sprintf("%s/book?token_id=%s", p.CLOBURL, tokenID)
	data, err := p.fetchJSON(url)
	if err != nil {
		return map[string]any{"bids": []any{}, "asks": []any{}}
	}
	if parsed, ok := data.(map[string]any); ok {
		return parsed
	}
	return map[string]any{"bids": []any{}, "asks": []any{}}
}

// FetchTokenIDs returns token IDs for a condition.
func (p *Polymarket) FetchTokenIDs(conditionID string) ([]string, error) {
	if conditionID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchTokenIDs: conditionID empty")
	}
	endpoints := []string{
		p.CLOBURL + "/simplified-markets",
		p.CLOBURL + "/sampling-simplified-markets",
		p.CLOBURL + "/markets",
	}
	for _, endpoint := range endpoints {
		data, err := p.fetchJSON(endpoint)
		if err != nil {
			continue
		}
		items := toSlice(data)
		for _, item := range items {
			row, _ := item.(map[string]any)
			if row == nil {
				continue
			}
			marketID := toString(row["condition_id"])
			if marketID == "" {
				marketID = toString(row["id"])
			}
			if marketID != conditionID {
				continue
			}
			if tokens := parseTokenIDs(row); len(tokens) > 0 {
				return tokens, nil
			}
		}
	}
	return nil, base.ExchangeError{Message: fmt.Sprintf("could not fetch token IDs for %s", conditionID)}
}

// FindCryptoHourlyMarket finds crypto hourly markets with filters.
func (p *Polymarket) FindCryptoHourlyMarket(tokenSymbol string, minLiquidity float64, limit int, isActive bool, isExpired bool, params map[string]any) (*models.Market, *models.CryptoHourlyMarket, error) {
	tagID := p.Tag1H
	if params != nil {
		if raw, ok := params["tag_id"].(string); ok && raw != "" {
			tagID = raw
		}
	}
	all := []models.Market{}
	offset := 0
	pageSize := 100
	for len(all) < limit {
		query := map[string]string{
			"active":    "true",
			"closed":    "false",
			"limit":     fmt.Sprintf("%d", minInt(pageSize, limit-len(all))),
			"offset":    fmt.Sprintf("%d", offset),
			"order":     "volume",
			"ascending": "false",
		}
		if tagID != "" {
			query["tag_id"] = tagID
		}
		url := p.BaseURL + "/markets?" + encodeQuery(query)
		data, err := p.fetchJSON(url)
		if err != nil {
			break
		}
		items := toSlice(data)
		if len(items) == 0 {
			break
		}
		for _, item := range items {
			all = append(all, p.parseMarket(item))
		}
		offset += len(items)
		if len(items) < pageSize {
			break
		}
	}

	upDown := regexp.MustCompile(`(?i)(?P<token>Bitcoin|Ethereum|Solana|BTC|ETH|SOL|XRP)\s+Up or Down`)
	strike := regexp.MustCompile(`(?i)(?:(?P<token1>BTC|ETH|SOL|BITCOIN|ETHEREUM|SOLANA)\s+.*?(?P<direction>above|below|over|under|reach)\s+[\$]?(?P<price1>[\d,]+(?:\.\d+)?))|(?:[\$]?(?P<price2>[\d,]+(?:\.\d+)?)\s+.*?(?P<token2>BTC|ETH|SOL|BITCOIN|ETHEREUM|SOLANA))`)

	for _, market := range all {
		if !market.IsBinary() || !market.IsOpen() {
			continue
		}
		if market.Liquidity < minLiquidity {
			continue
		}
		if market.CloseTime != nil {
			now := time.Now()
			if market.CloseTime.Location() != time.UTC {
				now = time.Now().UTC()
			}
			remaining := market.CloseTime.Sub(now).Seconds()
			if isExpired && remaining > 0 {
				continue
			}
			if !isExpired && remaining <= 0 {
				continue
			}
			if isActive && !isExpired && remaining > 3600 {
				continue
			}
		}

		if match := upDown.FindStringSubmatch(market.Question); match != nil {
			token := normalizeToken(match[1])
			if tokenSymbol != "" && token != normalizeToken(tokenSymbol) {
				continue
			}
			expiry := time.Now().Add(time.Hour)
			if market.CloseTime != nil {
				expiry = *market.CloseTime
			}
			cryptoMarket := models.CryptoHourlyMarket{
				TokenSymbol: token,
				ExpiryTime:  expiry,
				MarketType:  models.CryptoHourlyMarketTypeUpDown,
			}
			return &market, &cryptoMarket, nil
		}

		if match := strike.FindStringSubmatch(market.Question); match != nil {
			token := normalizeToken(toString(firstNonEmpty(match[1], match[5])))
			priceStr := toString(firstNonEmpty(match[3], match[4]))
			price := parsePrice(priceStr)
			if tokenSymbol != "" && token != normalizeToken(tokenSymbol) {
				continue
			}
			expiry := time.Now().Add(time.Hour)
			if market.CloseTime != nil {
				expiry = *market.CloseTime
			}
			cryptoMarket := models.CryptoHourlyMarket{
				TokenSymbol: token,
				ExpiryTime:  expiry,
				StrikePrice: &price,
				MarketType:  models.CryptoHourlyMarketTypeStrikePrice,
			}
			return &market, &cryptoMarket, nil
		}
	}
	return nil, nil, nil
}

// FetchPriceHistory returns price history points.
func (p *Polymarket) FetchPriceHistory(market models.Market, outcome any, interval string, fidelity int) ([]PolymarketPricePoint, error) {
	if market.ID == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchPriceHistory: market ID empty")
	}
	if interval == "" {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchPriceHistory: interval empty")
	}
	if fidelity == 0 {
		utils.DefaultLogger().Debugf("exchanges.Polymarket.FetchPriceHistory: fidelity zero")
	}
	if !contains(p.SupportedIntervals, interval) {
		return nil, fmt.Errorf("unsupported interval: %s", interval)
	}
	tokenID, err := p.lookupTokenID(market, outcome)
	if err != nil {
		return nil, err
	}
	params := url.Values{
		"market":   []string{tokenID},
		"interval": []string{interval},
		"fidelity": []string{fmt.Sprintf("%d", fidelity)},
	}
	data, err := p.fetchJSON(p.PricesHistoryURL + "?" + params.Encode())
	if err != nil {
		return nil, err
	}
	payload := toMap(data)
	history := toSlice(payload["history"])
	points := make([]PolymarketPricePoint, 0, len(history))
	for _, row := range history {
		item := toMap(row)
		t := toInt64(item["t"])
		pv := toFloat(item["p"])
		if t == 0 {
			continue
		}
		points = append(points, PolymarketPricePoint{
			Timestamp: time.Unix(t, 0).UTC(),
			Price:     pv,
			Raw:       item,
		})
	}
	return points, nil
}

// SearchMarkets returns markets filtered by query params.
func (p *Polymarket) SearchMarkets(params map[string]any) ([]models.Market, error) {
	limit := getIntParam(params, "limit", 200)
	offset := getIntParam(params, "offset", 0)
	order := getStringParam(params, "order", "id")
	ascending := getBoolParam(params, "ascending", false)
	closed := getBoolParam(params, "closed", false)
	tagID := getStringParam(params, "tag_id", "")
	binary := getBoolPtr(params, "binary")
	minLiquidity := getFloatParam(params, "min_liquidity", 0)
	query := getStringParam(params, "query", "")
	keywords := getStringSlice(params, "keywords")
	outcomes := getStringSlice(params, "outcomes")
	categories := getStringSlice(params, "categories")

	totalLimit := limit
	pageSize := minInt(200, totalLimit)
	collected := []models.Market{}

	for len(collected) < totalLimit {
		queryParams := map[string]string{
			"limit":     fmt.Sprintf("%d", minInt(pageSize, totalLimit-len(collected))),
			"offset":    fmt.Sprintf("%d", offset),
			"order":     order,
			"ascending": fmt.Sprintf("%t", ascending),
			"closed":    fmt.Sprintf("%t", closed),
		}
		if tagID != "" {
			queryParams["tag_id"] = tagID
		}
		url := p.BaseURL + "/markets?" + encodeQuery(queryParams)
		data, err := p.fetchJSON(url)
		if err != nil {
			return nil, err
		}
		items := toSlice(data)
		if len(items) == 0 {
			break
		}
		for _, item := range items {
			collected = append(collected, p.parseMarket(item))
		}
		offset += len(items)
		if len(items) < pageSize {
			break
		}
	}

	filtered := []models.Market{}
	for _, market := range collected {
		if binary != nil && market.IsBinary() != *binary {
			continue
		}
		if market.Liquidity < minLiquidity {
			continue
		}
		if len(outcomes) > 0 {
			lowerOutcomes := lowerSlice(market.Outcomes)
			if !containsAll(lowerOutcomes, lowerSlice(outcomes)) {
				continue
			}
		}
		if len(categories) > 0 {
			if !containsAny(p.extractCategories(market), lowerSlice(categories)) {
				continue
			}
		}
		if query != "" || len(keywords) > 0 {
			text := p.buildSearchText(market)
			if query != "" && !strings.Contains(text, strings.ToLower(query)) {
				continue
			}
			if len(keywords) > 0 {
				match := true
				for _, keyword := range keywords {
					if !strings.Contains(text, strings.ToLower(keyword)) {
						match = false
						break
					}
				}
				if !match {
					continue
				}
			}
		}
		filtered = append(filtered, market)
		if len(filtered) >= totalLimit {
			break
		}
	}
	return filtered, nil
}

// FetchPublicTrades returns public trade history.
func (p *Polymarket) FetchPublicTrades(params map[string]any) ([]PolymarketPublicTrade, error) {
	limit := getIntParam(params, "limit", 100)
	offset := getIntParam(params, "offset", 0)
	if offset < 0 || offset > 10000 {
		return nil, errors.New("offset must be between 0 and 10000")
	}
	queryParams := map[string]string{
		"takerOnly": "true",
	}
	if raw, ok := params["taker_only"].(bool); ok && !raw {
		queryParams["takerOnly"] = "false"
	}
	if market, ok := params["market"].(string); ok && market != "" {
		queryParams["market"] = market
	}
	if eventID, ok := params["event_id"].(int); ok && eventID > 0 {
		queryParams["eventId"] = fmt.Sprintf("%d", eventID)
	}
	if user, ok := params["user"].(string); ok && user != "" {
		queryParams["user"] = user
	}
	if side, ok := params["side"].(string); ok && side != "" {
		queryParams["side"] = side
	}
	if filterType, ok := params["filter_type"].(string); ok && filterType != "" {
		if amount, ok := params["filter_amount"].(float64); ok {
			queryParams["filterType"] = filterType
			queryParams["filterAmount"] = fmt.Sprintf("%f", amount)
		}
	}

	totalLimit := limit
	pageSize := minInt(500, totalLimit)
	offsetCursor := offset
	trades := []PolymarketPublicTrade{}

	for len(trades) < totalLimit {
		queryParams["limit"] = fmt.Sprintf("%d", minInt(pageSize, totalLimit-len(trades)))
		queryParams["offset"] = fmt.Sprintf("%d", offsetCursor)
		endpoint := p.DataURL + "/trades?" + encodeQuery(queryParams)
		data, err := p.fetchJSON(endpoint)
		if err != nil {
			return nil, err
		}
		items := toSlice(data)
		if len(items) == 0 {
			break
		}
		for _, item := range items {
			row := toMap(item)
			trades = append(trades, parsePublicTrade(row))
		}
		offsetCursor += len(items)
		if len(items) < pageSize {
			break
		}
	}
	return trades, nil
}

// GetTagBySlug fetches a tag by slug.
func (p *Polymarket) GetTagBySlug(slug string) (*PolymarketTag, error) {
	if slug == "" {
		return nil, errors.New("slug must be non-empty")
	}
	data, err := p.fetchJSON(fmt.Sprintf("%s/tags/slug/%s", p.BaseURL, slug))
	if err != nil {
		return nil, err
	}
	row := toMap(data)
	return &PolymarketTag{
		ID:         toString(row["id"]),
		Label:      toString(row["label"]),
		Slug:       toString(row["slug"]),
		ForceShow:  toBoolPtr(row["force_show"]),
		ForceHide:  toBoolPtr(row["force_hide"]),
		IsCarousel: toBoolPtr(row["is_carousel"]),
		Published:  toString(row["published_at"]),
		CreatedAt:  toString(row["created_at"]),
		UpdatedAt:  toString(row["updated_at"]),
		Raw:        row,
	}, nil
}

// initClobClient initializes the CLOB client.
func (p *Polymarket) initClobClient() error {
	if p.PrivateKey == "" {
		return nil
	}
	clob, err := newClobClient(p.CLOBURL, p.ChainID, p.PrivateKey, nil, p.Funder)
	if err != nil {
		return err
	}
	if p.APIKey != "" && p.APISecret != "" && p.APIPassphrase != "" {
		clob.setCreds(&apiCreds{
			APIKey:        p.APIKey,
			APISecret:     p.APISecret,
			APIPassphrase: p.APIPassphrase,
		})
	} else {
		creds, err := clob.createOrDeriveAPIKey()
		if err != nil {
			return err
		}
		clob.setCreds(creds)
	}
	p.clobClient = clob
	return nil
}

// fetchMarketsGamma fetches markets from Gamma API.
func (p *Polymarket) fetchMarketsGamma(params map[string]any) ([]models.Market, error) {
	query := map[string]string{}
	if _, ok := params["active"]; !ok && params["closed"] == nil {
		query["active"] = "true"
		query["closed"] = "false"
	}
	for key, value := range params {
		switch v := value.(type) {
		case string:
			query[key] = v
		case int:
			query[key] = fmt.Sprintf("%d", v)
		case float64:
			query[key] = fmt.Sprintf("%f", v)
		case bool:
			query[key] = fmt.Sprintf("%t", v)
		}
	}
	url := p.BaseURL + "/markets"
	if len(query) > 0 {
		url += "?" + encodeQuery(query)
	}
	data, err := p.fetchJSON(url)
	if err != nil {
		return nil, err
	}
	items := toSlice(data)
	markets := make([]models.Market, 0, len(items))
	for _, item := range items {
		markets = append(markets, p.parseMarket(item))
	}
	return markets, nil
}

// fetchJSON fetches and decodes a JSON payload.
func (p *Polymarket) fetchJSON(rawURL string) (any, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, base.NetworkError{Message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, base.RateLimitError{Message: "rate limit"}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, base.ExchangeError{Message: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	var payload any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// parseSamplingMarket parses sampling markets payload.
func (p *Polymarket) parseSamplingMarket(data any) *models.Market {
	row := toMap(data)
	conditionID := toString(row["condition_id"])
	if conditionID == "" {
		return nil
	}
	tokens := toSlice(row["tokens"])
	tokenIDs := []string{}
	outcomes := []string{}
	prices := map[string]float64{}
	for _, token := range tokens {
		tokenRow := toMap(token)
		if id := toString(tokenRow["token_id"]); id != "" {
			tokenIDs = append(tokenIDs, id)
		}
		outcome := toString(tokenRow["outcome"])
		if outcome != "" {
			outcomes = append(outcomes, outcome)
		}
		if price := toFloat(tokenRow["price"]); price > 0 && outcome != "" {
			prices[outcome] = price
		}
	}
	minTick := toFloat(row["minimum_tick_size"])
	if minTick == 0 {
		minTick = 0.01
	}
	meta := copyMap(row)
	meta["clobTokenIds"] = tokenIDs
	meta["condition_id"] = conditionID
	meta["minimum_tick_size"] = minTick
	question := toString(row["question"])
	return &models.Market{
		ID:          conditionID,
		Question:    question,
		Outcomes:    fallbackOutcomes(outcomes),
		CloseTime:   nil,
		Volume:      0,
		Liquidity:   0,
		Prices:      prices,
		Metadata:    meta,
		TickSize:    minTick,
		Description: toString(row["description"]),
	}
}

// parseMarket parses market payload into models.Market.
func (p *Polymarket) parseMarket(data any) models.Market {
	row := toMap(data)
	outcomes := parseOutcomes(row["outcomes"])
	prices := parseOutcomePrices(outcomes, row["outcomePrices"], row["bestBid"], row["bestAsk"])
	closeTime := parseDatetime(row["endDate"])
	volume := toFloat(row["volumeNum"])
	if volume == 0 {
		volume = toFloat(row["volume"])
	}
	liquidity := toFloat(row["liquidityNum"])
	if liquidity == 0 {
		liquidity = toFloat(row["liquidity"])
	}
	meta := copyMap(row)
	if matchID := toString(row["groupItemTitle"]); matchID != "" {
		meta["match_id"] = matchID
	}
	tokenIDs := parseTokenIDs(row)
	if len(tokenIDs) > 0 {
		meta["clobTokenIds"] = tokenIDs
	}
	minTick := toFloat(row["minimum_tick_size"])
	if minTick == 0 {
		minTick = 0.01
	}
	meta["minimum_tick_size"] = minTick
	return models.Market{
		ID:          toString(row["id"]),
		Question:    toString(row["question"]),
		Outcomes:    outcomes,
		CloseTime:   closeTime,
		Volume:      volume,
		Liquidity:   liquidity,
		Prices:      prices,
		Metadata:    meta,
		TickSize:    minTick,
		Description: toString(row["description"]),
	}
}

// parseOrder parses an order payload into models.Order.
func (p *Polymarket) parseOrder(data map[string]any) (models.Order, bool) {
	if data == nil {
		return models.Order{}, false
	}
	orderID := toString(firstNonEmpty(data["id"], data["orderID"]))
	size := toFloat(firstNonEmpty(data["size"], data["original_size"], data["amount"], data["original_amount"]))
	filled := toFloat(firstNonEmpty(data["filled"], data["matched"], data["matched_amount"]))
	createdAt := parseDatetime(data["created_at"])
	updatedAt := parseDatetime(data["updated_at"])
	status := parseOrderStatus(data["status"])
	side := parseOrderSide(data["side"])
	order := models.Order{
		ID:        orderID,
		MarketID:  toString(data["market_id"]),
		Outcome:   toString(data["outcome"]),
		Side:      side,
		Price:     toFloat(data["price"]),
		Size:      size,
		Filled:    filled,
		Status:    status,
		CreatedAt: time.Now(),
	}
	if createdAt != nil {
		order.CreatedAt = *createdAt
	}
	if updatedAt != nil {
		order.UpdatedAt = updatedAt
	}
	return order, true
}

// lookupTokenID resolves a token ID for an outcome.
func (p *Polymarket) lookupTokenID(market models.Market, outcome any) (string, error) {
	tokenIDs := parseTokenIDList(market.Metadata["clobTokenIds"])
	if len(tokenIDs) == 0 {
		return "", base.ExchangeError{Message: "cannot fetch price history without token IDs"}
	}
	index := 0
	switch val := outcome.(type) {
	case int:
		index = val
	case string:
		for i, name := range market.Outcomes {
			if name == val {
				index = i
				break
			}
		}
	}
	if index < 0 || index >= len(tokenIDs) {
		return "", base.ExchangeError{Message: "outcome index out of range"}
	}
	return tokenIDs[index], nil
}

// extractCategories returns category labels from market metadata.
func (p *Polymarket) extractCategories(market models.Market) []string {
	meta := market.Metadata
	out := []string{}
	if value, ok := meta["category"].(string); ok && value != "" {
		out = append(out, strings.ToLower(value))
	}
	for _, key := range []string{"categories", "topics"} {
		raw := meta[key]
		switch items := raw.(type) {
		case string:
			out = append(out, strings.ToLower(items))
		case []any:
			for _, item := range items {
				if str, ok := item.(string); ok {
					out = append(out, strings.ToLower(str))
				}
			}
		}
	}
	return out
}

// buildSearchText builds a lowercased search string for a market.
func (p *Polymarket) buildSearchText(market models.Market) string {
	meta := market.Metadata
	fields := []string{market.Question, toString(meta["description"])}
	extraKeys := []string{
		"slug", "category", "subtitle", "seriesSlug", "series", "seriesTitle", "seriesDescription",
		"tags", "topics", "categories",
	}
	for _, key := range extraKeys {
		value := meta[key]
		switch v := value.(type) {
		case string:
			fields = append(fields, v)
		case []any:
			for _, item := range v {
				fields = append(fields, fmt.Sprintf("%v", item))
			}
		}
	}
	return strings.ToLower(strings.Join(fields, " "))
}

// parsePublicTrade parses a public trade payload.
func parsePublicTrade(row map[string]any) PolymarketPublicTrade {
	ts := toInt64(row["timestamp"])
	if ts == 0 {
		ts = time.Now().Unix()
	}
	return PolymarketPublicTrade{
		ProxyWallet:           toString(row["proxyWallet"]),
		Side:                  toString(row["side"]),
		Asset:                 toString(row["asset"]),
		ConditionID:           toString(row["conditionId"]),
		Size:                  toFloat(row["size"]),
		Price:                 toFloat(row["price"]),
		Timestamp:             time.Unix(ts, 0).UTC(),
		Title:                 toString(row["title"]),
		Slug:                  toString(row["slug"]),
		Icon:                  toString(row["icon"]),
		EventSlug:             toString(row["eventSlug"]),
		Outcome:               toString(row["outcome"]),
		OutcomeIndex:          int(toInt64(row["outcomeIndex"])),
		Name:                  toString(row["name"]),
		Pseudonym:             toString(row["pseudonym"]),
		Bio:                   toString(row["bio"]),
		ProfileImage:          toString(row["profileImage"]),
		ProfileImageOptimized: toString(row["profileImageOptimized"]),
		TransactionHash:       toString(row["transactionHash"]),
	}
}

// parseOrderStatus converts a status value to OrderStatus.
func parseOrderStatus(value any) models.OrderStatus {
	status := strings.ToLower(toString(value))
	switch status {
	case "pending":
		return models.OrderStatusPending
	case "open", "live":
		return models.OrderStatusOpen
	case "filled", "matched":
		return models.OrderStatusFilled
	case "partially_filled":
		return models.OrderStatusPartiallyFilled
	case "cancelled":
		return models.OrderStatusCancelled
	case "rejected":
		return models.OrderStatusRejected
	default:
		return models.OrderStatusOpen
	}
}

// parseOrderSide converts a side value to OrderSide.
func parseOrderSide(value any) models.OrderSide {
	side := strings.ToLower(toString(value))
	if side == "sell" {
		return models.OrderSideSell
	}
	return models.OrderSideBuy
}

// parseDatetime parses time from various formats.
func parseDatetime(value any) *time.Time {
	switch v := value.(type) {
	case string:
		if v == "" {
			return nil
		}
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return &t
		}
	case float64:
		if v > 0 {
			t := time.Unix(int64(v), 0)
			return &t
		}
	case int:
		if v > 0 {
			t := time.Unix(int64(v), 0)
			return &t
		}
	}
	return nil
}

// parseOutcomes extracts outcome labels from a payload.
func parseOutcomes(value any) []string {
	switch v := value.(type) {
	case string:
		var out []string
		if err := json.Unmarshal([]byte(v), &out); err == nil {
			return out
		}
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, toString(item))
		}
		return out
	}
	return nil
}

// parseOutcomePrices builds outcome price mappings.
func parseOutcomePrices(outcomes []string, pricesRaw any, bestBidRaw any, bestAskRaw any) map[string]float64 {
	prices := map[string]float64{}
	var priceList []any
	switch v := pricesRaw.(type) {
	case string:
		_ = json.Unmarshal([]byte(v), &priceList)
	case []any:
		priceList = v
	}
	if len(outcomes) == len(priceList) {
		for i, outcome := range outcomes {
			price := toFloat(priceList[i])
			if price > 0 {
				prices[outcome] = price
			}
		}
	}
	if len(prices) == 0 && len(outcomes) == 2 {
		bid := toFloat(bestBidRaw)
		ask := toFloat(bestAskRaw)
		if bid > 0 && ask > 0 {
			prices[outcomes[0]] = ask
			prices[outcomes[1]] = 1.0 - bid
		}
	}
	return prices
}

// parseTokenIDs extracts token IDs from a payload.
func parseTokenIDs(data any) []string {
	row := toMap(data)
	if tokens, ok := row["tokens"].([]any); ok && len(tokens) > 0 {
		return extractTokenIDs(tokens)
	}
	if tokens := row["clobTokenIds"]; tokens != nil {
		return parseTokenIDList(tokens)
	}
	if tokenID := toString(row["tokenID"]); tokenID != "" {
		return []string{tokenID}
	}
	return nil
}

// parseTokenIDList parses a list of token IDs.
func parseTokenIDList(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if str := toString(item); str != "" {
				out = append(out, str)
			}
		}
		return out
	case string:
		var out []string
		if err := json.Unmarshal([]byte(v), &out); err == nil {
			return out
		}
		if v != "" {
			return []string{v}
		}
	}
	return nil
}

// extractTokenIDs extracts token IDs from token objects.
func extractTokenIDs(tokens []any) []string {
	out := []string{}
	for _, token := range tokens {
		row := toMap(token)
		if id := toString(row["token_id"]); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// outcomeForIndex returns the outcome for an index.
func outcomeForIndex(outcomes []string, index int) string {
	if index < len(outcomes) {
		return outcomes[index]
	}
	if index == 0 {
		return "Yes"
	}
	return "No"
}

// parseBalance parses a numeric balance value.
func parseBalance(value any) float64 {
	switch v := value.(type) {
	case string:
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			return parsed / 1e6
		}
	case float64:
		return v / 1e6
	}
	return 0
}

// normalizeToken normalizes token strings (BTC/ETH/SOL).
func normalizeToken(token string) string {
	token = strings.ToUpper(token)
	switch token {
	case "BITCOIN":
		return "BTC"
	case "ETHEREUM":
		return "ETH"
	case "SOLANA":
		return "SOL"
	default:
		return token
	}
}

// parseMarketIdentifier normalizes a market identifier or URL.
func parseMarketIdentifier(identifier string) string {
	if identifier == "" {
		return ""
	}
	if strings.HasPrefix(identifier, "http") {
		identifier = strings.Split(identifier, "?")[0]
		parts := strings.Split(strings.TrimRight(identifier, "/"), "/")
		for i, part := range parts {
			if part == "event" && i+1 < len(parts) {
				return parts[i+1]
			}
		}
		return parts[len(parts)-1]
	}
	return identifier
}

// encodeQuery encodes query params.
func encodeQuery(values map[string]string) string {
	query := url.Values{}
	for key, value := range values {
		query.Set(key, value)
	}
	return query.Encode()
}

// minInt returns the minimum of two ints.
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// parsePrice parses a price string.
func parsePrice(value string) float64 {
	value = strings.ReplaceAll(value, ",", "")
	if value == "" {
		return 0
	}
	parsed, _ := strconv.ParseFloat(value, 64)
	return parsed
}

// firstNonEmpty returns the first non-empty value.
func firstNonEmpty(values ...any) any {
	for _, value := range values {
		switch v := value.(type) {
		case string:
			if v != "" {
				return v
			}
		default:
			if v != nil {
				return v
			}
		}
	}
	return nil
}

// toSlice converts a value to a slice.
func toSlice(value any) []any {
	switch v := value.(type) {
	case []any:
		return v
	case []models.Market:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = item
		}
		return out
	default:
		return nil
	}
}

// toMap converts a value to map[string]any.
func toMap(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if row, ok := value.(map[string]any); ok {
		return row
	}
	return map[string]any{}
}

// toString converts a value to string.
func toString(value any) string {
	if value == nil {
		return ""
	}
	if str, ok := value.(string); ok {
		return str
	}
	return fmt.Sprintf("%v", value)
}

// toFloat converts a value to float64.
func toFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		parsed, _ := strconv.ParseFloat(v, 64)
		return parsed
	default:
		return 0
	}
}

// toInt converts a value to int.
func toInt(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case float64:
		return int(v), true
	default:
		return 0, false
	}
}

// toInt64 converts a value to int64.
func toInt64(value any) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		parsed, _ := strconv.ParseInt(v, 10, 64)
		return parsed
	default:
		return 0
	}
}

// toBoolPtr converts a value to *bool.
func toBoolPtr(value any) *bool {
	if value == nil {
		return nil
	}
	if b, ok := value.(bool); ok {
		return &b
	}
	return nil
}

// copyMap makes a shallow copy of a map.
func copyMap(value map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range value {
		out[k] = v
	}
	return out
}

// fallbackOutcomes returns default outcomes when missing.
func fallbackOutcomes(outcomes []string) []string {
	if len(outcomes) > 0 {
		return outcomes
	}
	return []string{"Yes", "No"}
}

// derefString dereferences a string pointer.
func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// getIntParam reads an int parameter from a map.
func getIntParam(params map[string]any, key string, defaultValue int) int {
	if params == nil {
		return defaultValue
	}
	switch v := params[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return defaultValue
}

// getFloatParam reads a float parameter from a map.
func getFloatParam(params map[string]any, key string, defaultValue float64) float64 {
	if params == nil {
		return defaultValue
	}
	switch v := params[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return defaultValue
}

// getBoolParam reads a bool parameter from a map.
func getBoolParam(params map[string]any, key string, defaultValue bool) bool {
	if params == nil {
		return defaultValue
	}
	if v, ok := params[key].(bool); ok {
		return v
	}
	return defaultValue
}

// getBoolPtr reads a bool pointer parameter from a map.
func getBoolPtr(params map[string]any, key string) *bool {
	if params == nil {
		return nil
	}
	if v, ok := params[key].(bool); ok {
		return &v
	}
	return nil
}

// getStringParam reads a string parameter from a map.
func getStringParam(params map[string]any, key string, defaultValue string) string {
	if params == nil {
		return defaultValue
	}
	if v, ok := params[key].(string); ok {
		return v
	}
	return defaultValue
}

// getStringSlice reads a string slice parameter from a map.
func getStringSlice(params map[string]any, key string) []string {
	if params == nil {
		return nil
	}
	switch v := params[key].(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, toString(item))
		}
		return out
	default:
		return nil
	}
}

// contains reports whether a string list contains a value.
func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// lowerSlice lowercases all strings.
func lowerSlice(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, strings.ToLower(value))
	}
	return out
}

// containsAll reports whether all needles are in haystack.
func containsAll(haystack []string, needles []string) bool {
	for _, needle := range needles {
		if !contains(haystack, needle) {
			return false
		}
	}
	return true
}

// containsAny reports whether any needle is in haystack.
func containsAny(haystack []string, needles []string) bool {
	for _, needle := range needles {
		if contains(haystack, needle) {
			return true
		}
	}
	return false
}
