package gateio

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

const GateIOBaseURL = "https://api.gateio.ws"

// GateIO implements Gate API v4 spot trading using the shared cctx exchange model.
type GateIO struct {
	base.BaseExchange
	apiKey     string
	apiSecret  string
	baseURL    string
	httpClient *http.Client

	mu       sync.RWMutex
	pairInfo map[string]gateCurrencyPairInfo
}

type gateCurrencyPairInfo struct {
	PairID         string
	BaseAsset      string
	QuoteAsset     string
	TradeStatus    string
	TickSize       float64
	AmountStep     float64
	MinBaseAmount  float64
	MinQuoteAmount float64
}

type gateTicker struct {
	PairID      string
	LastPrice   float64
	BidPrice    float64
	BidQty      float64
	AskPrice    float64
	AskQty      float64
	BaseVolume  float64
	QuoteVolume float64
}

// NewGateIO creates a Gate.io spot exchange adapter.
func NewGateIO(config map[string]any) (base.Exchange, error) {
	if config == nil {
		config = map[string]any{}
	}
	resolvedConfig, err := secureconfig.ResolveMap(config)
	if err != nil {
		return nil, fmt.Errorf("cex.gateio.NewGateIO: resolve secure config: %w", err)
	}
	config = resolvedConfig

	ex := &GateIO{
		BaseExchange: base.NewBaseExchange(config),
		apiKey:       stringFromConfig(config, "api_key"),
		apiSecret:    firstNonEmpty(stringFromConfig(config, "api_secret"), stringFromConfig(config, "hmac_secret")),
		baseURL:      firstNonEmpty(stringFromConfig(config, "base_url"), stringFromConfig(config, "host"), GateIOBaseURL),
		pairInfo:     map[string]gateCurrencyPairInfo{},
	}
	ex.httpClient = &http.Client{Timeout: ex.Timeout}
	ex.BaseExchange.Bind(ex)
	return ex, nil
}

// ID returns the exchange identifier.
func (g *GateIO) ID() string {
	return "gateio"
}

// Name returns the display name.
func (g *GateIO) Name() string {
	return "Gate.io Spot"
}

// FetchMarkets returns Gate.io spot markets.
func (g *GateIO) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if symbol := strings.ToUpper(strings.TrimSpace(stringFromAny(params["symbol"]))); symbol != "" {
		market, err := g.FetchMarket(symbol)
		if err != nil {
			return nil, err
		}
		return []models.Market{market}, nil
	}

	infos, err := g.fetchAllPairInfo()
	if err != nil {
		return nil, err
	}
	tickers, err := g.fetchTickerMap("")
	if err != nil {
		return nil, err
	}

	quoteFilter := strings.ToUpper(strings.TrimSpace(stringFromAny(params["quote_asset"])))
	limit := intFromAny(params["limit"], 50)
	if limit <= 0 {
		limit = 50
	}

	keys := make([]string, 0, len(infos))
	for key := range infos {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	markets := make([]models.Market, 0, limit)
	for _, symbol := range keys {
		info := infos[symbol]
		if info.TradeStatus == "untradable" {
			continue
		}
		if quoteFilter != "" && info.QuoteAsset != quoteFilter {
			continue
		}
		ticker, ok := tickers[symbol]
		if !ok {
			continue
		}
		markets = append(markets, buildGateIOSpotMarket(info, ticker))
		if len(markets) >= limit {
			break
		}
	}
	return markets, nil
}

// FetchMarket returns a single Gate.io symbol as a spot market.
func (g *GateIO) FetchMarket(marketID string) (models.Market, error) {
	symbol := strings.ToUpper(strings.TrimSpace(marketID))
	if symbol == "" {
		return models.Market{}, base.MarketNotFound{Message: "gateio market symbol required"}
	}

	info, err := g.fetchPairInfo(symbol)
	if err != nil {
		return models.Market{}, err
	}
	ticker, err := g.fetchSingleTicker(symbol)
	if err != nil {
		return models.Market{}, err
	}
	return buildGateIOSpotMarket(info, ticker), nil
}

// CreateOrder submits a Gate.io spot order.
func (g *GateIO) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(marketID, stringFromAny(params["symbol"]))))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "gateio symbol required"}
	}

	orderType := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringFromAny(params["type"]), chooseOrderType(price))))
	if orderType == "" {
		orderType = "market"
	}

	body := map[string]any{
		"currency_pair": symbol,
		"account":       firstNonEmpty(stringFromAny(params["account"]), "spot"),
		"side":          strings.ToLower(string(side)),
		"type":          orderType,
	}

	if clientOrderID := normalizeGateClientOrderID(firstNonEmpty(stringFromAny(params["text"]), stringFromAny(params["client_order_id"]), stringFromAny(params["newClientOrderId"]))); clientOrderID != "" {
		body["text"] = clientOrderID
	}

	quantity := formatDecimal(firstPositive(size, numberFromAny(params["quantity"])))
	quoteOrderQty := formatDecimal(firstPositive(numberFromAny(params["quoteOrderQty"]), numberFromAny(params["quote_order_qty"])))

	switch orderType {
	case "limit":
		if quantity == "" || price <= 0 {
			return models.Order{}, base.InvalidOrder{Message: "gateio limit order requires quantity and price"}
		}
		body["amount"] = quantity
		body["price"] = formatDecimal(price)
		body["time_in_force"] = strings.ToLower(firstNonEmpty(stringFromAny(params["time_in_force"]), stringFromAny(params["timeInForce"]), "gtc"))
	case "market":
		switch {
		case side == models.OrderSideBuy && quoteOrderQty != "":
			body["amount"] = quoteOrderQty
		case quantity != "":
			body["amount"] = quantity
		default:
			return models.Order{}, base.InvalidOrder{Message: "gateio market order requires quantity or quoteOrderQty"}
		}
		body["time_in_force"] = strings.ToLower(firstNonEmpty(stringFromAny(params["time_in_force"]), stringFromAny(params["timeInForce"]), "ioc"))
	default:
		if quantity == "" {
			return models.Order{}, base.InvalidOrder{Message: "gateio order requires quantity"}
		}
		body["amount"] = quantity
		if price > 0 {
			body["price"] = formatDecimal(price)
		}
		if tif := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringFromAny(params["time_in_force"]), stringFromAny(params["timeInForce"])))); tif != "" {
			body["time_in_force"] = tif
		}
	}

	payload, err := g.doSignedJSONRequest(http.MethodPost, "/api/v4/spot/orders", body)
	if err != nil {
		return models.Order{}, err
	}
	item, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "gateio create order response malformed"}
	}

	order := g.parseOrder(item)
	if order.ID == "" {
		return models.Order{}, base.ExchangeError{Message: "gateio create order missing order id"}
	}
	if fetched, err := g.FetchOrder(order.ID, &symbol); err == nil {
		return fetched, nil
	}
	return order, nil
}

// CancelOrder cancels an existing Gate.io spot order.
func (g *GateIO) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "gateio cancel requires symbol"}
	}
	if strings.TrimSpace(orderID) == "" {
		return models.Order{}, base.InvalidOrder{Message: "gateio cancel requires orderID"}
	}

	values := url.Values{}
	values.Set("currency_pair", symbol)
	if account := strings.TrimSpace("spot"); account != "" {
		values.Set("account", account)
	}

	payload, err := g.doSignedDeleteRequest("/api/v4/spot/orders/"+strings.TrimSpace(orderID), values)
	if err != nil {
		return models.Order{}, err
	}
	item, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "gateio cancel order response malformed"}
	}
	order := g.parseOrder(item)
	if order.ID == "" {
		order.ID = strings.TrimSpace(orderID)
		order.MarketID = symbol
		order.Status = models.OrderStatusCancelled
	}
	return order, nil
}

// FetchOrder returns an order by ID or client order ID.
func (g *GateIO) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "gateio fetch order requires symbol"}
	}
	if strings.TrimSpace(orderID) == "" {
		return models.Order{}, base.InvalidOrder{Message: "gateio fetch order requires orderID"}
	}

	values := url.Values{}
	values.Set("currency_pair", symbol)
	values.Set("account", "spot")

	payload, err := g.doSignedQueryRequest(http.MethodGet, "/api/v4/spot/orders/"+strings.TrimSpace(orderID), values)
	if err != nil {
		return models.Order{}, err
	}
	item, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "gateio fetch order response malformed"}
	}
	return g.parseOrder(item), nil
}

// FetchOpenOrders returns open orders for a symbol or all symbols.
func (g *GateIO) FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return nil, err
	}

	if symbol := strings.ToUpper(strings.TrimSpace(deref(marketID))); symbol != "" {
		values := url.Values{}
		values.Set("currency_pair", symbol)
		values.Set("status", "open")
		values.Set("account", "spot")
		if limit := intFromAny(params["limit"], 0); limit > 0 {
			if limit > 100 {
				limit = 100
			}
			values.Set("limit", stringFromAny(limit))
		}
		if page := intFromAny(params["page"], 0); page > 0 {
			values.Set("page", stringFromAny(page))
		}
		payload, err := g.doSignedQueryRequest(http.MethodGet, "/api/v4/spot/orders", values)
		if err != nil {
			return nil, err
		}
		return g.parseOrderList(payload)
	}

	values := url.Values{}
	values.Set("account", "spot")
	if limit := intFromAny(params["limit"], 0); limit > 0 {
		values.Set("limit", stringFromAny(limit))
	}
	if page := intFromAny(params["page"], 0); page > 0 {
		values.Set("page", stringFromAny(page))
	}
	payload, err := g.doSignedQueryRequest(http.MethodGet, "/api/v4/spot/open_orders", values)
	if err != nil {
		return nil, err
	}
	return g.parseOpenOrderGroups(payload)
}

// FetchOrderHistory returns Gate.io spot order history for one market or all spot symbols.
func (g *GateIO) FetchOrderHistory(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("status", "finished")
	values.Set("account", "spot")
	if symbol := strings.ToUpper(strings.TrimSpace(deref(marketID))); symbol != "" {
		values.Set("currency_pair", symbol)
	}
	if limit := intFromAny(params["limit"], 20); limit > 0 {
		values.Set("limit", stringFromAny(limit))
	}
	if page := intFromAny(params["page"], 0); page > 0 {
		values.Set("page", stringFromAny(page))
	}
	if from := strings.TrimSpace(stringFromAny(params["from"])); from != "" {
		values.Set("from", from)
	}
	if to := strings.TrimSpace(stringFromAny(params["to"])); to != "" {
		values.Set("to", to)
	}
	if side := strings.ToLower(strings.TrimSpace(stringFromAny(params["side"]))); side != "" {
		values.Set("side", side)
	}

	payload, err := g.doSignedQueryRequest(http.MethodGet, "/api/v4/spot/orders", values)
	if err != nil {
		return nil, err
	}
	return g.parseOrderList(payload)
}

// FetchPositions returns spot balances as positions.
func (g *GateIO) FetchPositions(marketID *string, _ map[string]any) ([]models.Position, error) {
	account, err := g.fetchBalanceSnapshot()
	if err != nil {
		return nil, err
	}

	targetSymbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if targetSymbol != "" {
		info, err := g.fetchPairInfo(targetSymbol)
		if err != nil {
			return nil, err
		}
		price, _ := g.fetchLastPrice(targetSymbol)
		total := account[info.BaseAsset]
		if total <= 0 {
			return []models.Position{}, nil
		}
		return []models.Position{{
			MarketID:     targetSymbol,
			Outcome:      info.BaseAsset,
			Size:         total,
			AveragePrice: 0,
			CurrentPrice: price,
		}}, nil
	}

	infos, err := g.fetchAllPairInfo()
	if err != nil {
		return nil, err
	}
	prices, _ := g.fetchPriceMap()
	preferred := preferredGateSymbolsByBaseAsset(infos)

	positions := []models.Position{}
	for asset, total := range account {
		if total <= 0 || gateStableQuoteAssets[asset] {
			continue
		}
		symbol := preferred[asset]
		if symbol == "" {
			continue
		}
		info := infos[symbol]
		positions = append(positions, models.Position{
			MarketID:     symbol,
			Outcome:      info.BaseAsset,
			Size:         total,
			AveragePrice: 0,
			CurrentPrice: prices[symbol],
		})
	}
	return positions, nil
}

// FetchBalance returns available + locked wallet balances keyed by asset.
func (g *GateIO) FetchBalance() (map[string]float64, error) {
	return g.fetchBalanceSnapshot()
}

func (g *GateIO) ensureAuthenticated() error {
	if g.apiKey == "" || g.apiSecret == "" {
		return base.AuthenticationError{Message: "gateio api_key and api_secret required"}
	}
	return nil
}

func (g *GateIO) fetchAllPairInfo() (map[string]gateCurrencyPairInfo, error) {
	g.mu.RLock()
	if len(g.pairInfo) > 0 {
		cached := copyGatePairInfoMap(g.pairInfo)
		g.mu.RUnlock()
		return cached, nil
	}
	g.mu.RUnlock()

	payload, err := g.doPublicQueryRequest(http.MethodGet, "/api/v4/spot/currency_pairs", url.Values{})
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "gateio currency pairs response malformed"}
	}

	next := map[string]gateCurrencyPairInfo{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		info := parseGateCurrencyPairInfo(mapped)
		if info.PairID == "" {
			continue
		}
		next[info.PairID] = info
	}

	g.mu.Lock()
	g.pairInfo = next
	g.mu.Unlock()
	return copyGatePairInfoMap(next), nil
}

func (g *GateIO) fetchPairInfo(symbol string) (gateCurrencyPairInfo, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return gateCurrencyPairInfo{}, base.MarketNotFound{Message: "gateio symbol required"}
	}

	g.mu.RLock()
	if info, ok := g.pairInfo[symbol]; ok {
		g.mu.RUnlock()
		return info, nil
	}
	g.mu.RUnlock()

	payload, err := g.doPublicQueryRequest(http.MethodGet, "/api/v4/spot/currency_pairs/"+symbol, url.Values{})
	if err != nil {
		return gateCurrencyPairInfo{}, err
	}
	mapped, ok := payload.(map[string]any)
	if !ok {
		return gateCurrencyPairInfo{}, base.ExchangeError{Message: "gateio currency pair payload malformed"}
	}
	info := parseGateCurrencyPairInfo(mapped)
	if info.PairID == "" {
		return gateCurrencyPairInfo{}, base.MarketNotFound{Message: fmt.Sprintf("gateio market not found: %s", symbol)}
	}

	g.mu.Lock()
	g.pairInfo[symbol] = info
	g.mu.Unlock()
	return info, nil
}

func (g *GateIO) fetchTickerMap(symbol string) (map[string]gateTicker, error) {
	values := url.Values{}
	if symbol != "" {
		values.Set("currency_pair", strings.ToUpper(strings.TrimSpace(symbol)))
	}
	payload, err := g.doPublicQueryRequest(http.MethodGet, "/api/v4/spot/tickers", values)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "gateio ticker response malformed"}
	}

	out := map[string]gateTicker{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ticker := parseGateTicker(mapped)
		if ticker.PairID != "" {
			out[ticker.PairID] = ticker
		}
	}
	return out, nil
}

func (g *GateIO) fetchSingleTicker(symbol string) (gateTicker, error) {
	tickers, err := g.fetchTickerMap(symbol)
	if err != nil {
		return gateTicker{}, err
	}
	ticker, ok := tickers[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return gateTicker{}, base.MarketNotFound{Message: fmt.Sprintf("gateio ticker not found: %s", symbol)}
	}
	return ticker, nil
}

func (g *GateIO) fetchLastPrice(symbol string) (float64, error) {
	ticker, err := g.fetchSingleTicker(symbol)
	if err != nil {
		return 0, err
	}
	if ticker.LastPrice > 0 {
		return ticker.LastPrice, nil
	}
	if ticker.BidPrice > 0 && ticker.AskPrice > 0 {
		return (ticker.BidPrice + ticker.AskPrice) / 2, nil
	}
	return ticker.BidPrice, nil
}

func (g *GateIO) fetchPriceMap() (map[string]float64, error) {
	tickers, err := g.fetchTickerMap("")
	if err != nil {
		return nil, err
	}
	out := make(map[string]float64, len(tickers))
	for symbol, ticker := range tickers {
		switch {
		case ticker.LastPrice > 0:
			out[symbol] = ticker.LastPrice
		case ticker.BidPrice > 0 && ticker.AskPrice > 0:
			out[symbol] = (ticker.BidPrice + ticker.AskPrice) / 2
		default:
			out[symbol] = ticker.BidPrice
		}
	}
	return out, nil
}

func (g *GateIO) fetchBalanceSnapshot() (map[string]float64, error) {
	if err := g.ensureAuthenticated(); err != nil {
		return nil, err
	}

	payload, err := g.doSignedQueryRequest(http.MethodGet, "/api/v4/spot/accounts", url.Values{})
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "gateio balance response malformed"}
	}

	balances := map[string]float64{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		asset := strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["currency"])))
		if asset == "" {
			continue
		}
		total := floatFromAny(mapped["available"]) + floatFromAny(mapped["locked"])
		if total > 0 {
			balances[asset] = total
		}
	}
	return balances, nil
}
