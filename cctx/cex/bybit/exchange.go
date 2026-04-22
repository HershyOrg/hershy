package bybit

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

const (
	BybitBaseURL                  = "https://api.bybit.com"
	defaultBybitRecvWindow  int64 = 5000
	defaultBybitAccountType       = "UNIFIED"
)

// Bybit implements Bybit V5 spot trading using the shared cctx exchange model.
type Bybit struct {
	base.BaseExchange
	apiKey      string
	apiSecret   string
	baseURL     string
	accountType string
	recvWindow  int64
	httpClient  *http.Client

	mu         sync.RWMutex
	symbolInfo map[string]bybitSymbolInfo

	serverTimeOffsetMillis int64
	lastServerTimeSyncUnix int64
	timeSyncMu             sync.Mutex
}

type bybitSymbolInfo struct {
	Symbol      string
	Status      string
	BaseAsset   string
	QuoteAsset  string
	TickSize    float64
	QtyStep     float64
	MinOrderQty float64
	MinOrderAmt float64
}

type bybitTicker struct {
	Symbol    string
	BidPrice  float64
	BidQty    float64
	AskPrice  float64
	AskQty    float64
	LastPrice float64
}

// NewBybit creates a Bybit spot exchange adapter.
func NewBybit(config map[string]any) (base.Exchange, error) {
	if config == nil {
		config = map[string]any{}
	}
	resolvedConfig, err := secureconfig.ResolveMap(config)
	if err != nil {
		return nil, fmt.Errorf("cex.bybit.NewBybit: resolve secure config: %w", err)
	}
	config = resolvedConfig

	ex := &Bybit{
		BaseExchange: base.NewBaseExchange(config),
		apiKey:       stringFromConfig(config, "api_key"),
		apiSecret:    firstNonEmpty(stringFromConfig(config, "api_secret"), stringFromConfig(config, "hmac_secret")),
		baseURL:      firstNonEmpty(stringFromConfig(config, "base_url"), stringFromConfig(config, "host"), BybitBaseURL),
		accountType:  strings.ToUpper(firstNonEmpty(stringFromConfig(config, "account_type"), defaultBybitAccountType)),
		recvWindow:   int64FromConfig(config, "recv_window", defaultBybitRecvWindow),
		symbolInfo:   map[string]bybitSymbolInfo{},
	}
	ex.httpClient = &http.Client{Timeout: ex.Timeout}
	ex.BaseExchange.Bind(ex)
	return ex, nil
}

// ID returns the exchange identifier.
func (b *Bybit) ID() string {
	return "bybit"
}

// Name returns the display name.
func (b *Bybit) Name() string {
	return "Bybit Spot"
}

// FetchMarkets returns Bybit spot markets.
func (b *Bybit) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if symbol := strings.ToUpper(strings.TrimSpace(stringFromAny(params["symbol"]))); symbol != "" {
		market, err := b.FetchMarket(symbol)
		if err != nil {
			return nil, err
		}
		return []models.Market{market}, nil
	}

	infos, err := b.fetchAllSymbolInfo()
	if err != nil {
		return nil, err
	}
	tickers, err := b.fetchTickerMap("")
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
		if info.Status != "TRADING" {
			continue
		}
		if quoteFilter != "" && info.QuoteAsset != quoteFilter {
			continue
		}
		ticker, ok := tickers[symbol]
		if !ok {
			continue
		}
		markets = append(markets, buildBybitSpotMarket(info, ticker))
		if len(markets) >= limit {
			break
		}
	}
	return markets, nil
}

// FetchMarket returns a single Bybit symbol as a spot market.
func (b *Bybit) FetchMarket(marketID string) (models.Market, error) {
	symbol := strings.ToUpper(strings.TrimSpace(marketID))
	if symbol == "" {
		return models.Market{}, base.MarketNotFound{Message: "bybit market symbol required"}
	}

	info, err := b.fetchSymbolInfo(symbol)
	if err != nil {
		return models.Market{}, err
	}
	ticker, err := b.fetchSingleTicker(symbol)
	if err != nil {
		return models.Market{}, err
	}
	return buildBybitSpotMarket(info, ticker), nil
}

// CreateOrder submits a Bybit spot order.
func (b *Bybit) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(marketID, stringFromAny(params["symbol"]))))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "bybit symbol required"}
	}

	orderType := strings.Title(strings.ToLower(strings.TrimSpace(firstNonEmpty(stringFromAny(params["type"]), chooseOrderType(price)))))
	if orderType == "" {
		orderType = "Market"
	}

	body := map[string]any{
		"category":    "spot",
		"symbol":      symbol,
		"side":        bybitOrderSide(side),
		"orderType":   orderType,
		"isLeverage":  0,
		"orderFilter": firstNonEmpty(stringFromAny(params["orderFilter"]), "Order"),
	}

	if clientOrderID := strings.TrimSpace(firstNonEmpty(stringFromAny(params["orderLinkId"]), stringFromAny(params["newClientOrderId"]), stringFromAny(params["client_order_id"]))); clientOrderID != "" {
		body["orderLinkId"] = clientOrderID
	}

	quantity := formatDecimal(firstPositive(size, numberFromAny(params["quantity"])))
	quoteOrderQty := formatDecimal(firstPositive(numberFromAny(params["quoteOrderQty"]), numberFromAny(params["quote_order_qty"])))

	switch orderType {
	case "Limit":
		if quantity == "" || price <= 0 {
			return models.Order{}, base.InvalidOrder{Message: "bybit limit order requires quantity and price"}
		}
		body["qty"] = quantity
		body["price"] = formatDecimal(price)
		body["timeInForce"] = firstNonEmpty(stringFromAny(params["timeInForce"]), stringFromAny(params["time_in_force"]), "GTC")
	case "Market":
		switch {
		case quoteOrderQty != "":
			body["qty"] = quoteOrderQty
			body["marketUnit"] = "quoteCoin"
		case quantity != "":
			body["qty"] = quantity
			body["marketUnit"] = "baseCoin"
		default:
			return models.Order{}, base.InvalidOrder{Message: "bybit market order requires quantity or quoteOrderQty"}
		}
		body["timeInForce"] = firstNonEmpty(stringFromAny(params["timeInForce"]), stringFromAny(params["time_in_force"]), "IOC")
	default:
		if quantity == "" {
			return models.Order{}, base.InvalidOrder{Message: "bybit order requires quantity"}
		}
		body["qty"] = quantity
		if price > 0 {
			body["price"] = formatDecimal(price)
		}
		if tif := firstNonEmpty(stringFromAny(params["timeInForce"]), stringFromAny(params["time_in_force"])); tif != "" {
			body["timeInForce"] = tif
		}
	}

	if value := firstNonEmpty(stringFromAny(params["slippageToleranceType"]), stringFromAny(params["slippage_tolerance_type"])); value != "" {
		body["slippageToleranceType"] = value
	}
	if value := firstNonEmpty(stringFromAny(params["slippageTolerance"]), stringFromAny(params["slippage_tolerance"])); value != "" {
		body["slippageTolerance"] = value
	}

	payload, err := b.doSignedJSONRequest(http.MethodPost, "/v5/order/create", body)
	if err != nil {
		return models.Order{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "bybit create order response malformed"}
	}

	orderRef := firstNonEmpty(stringFromAny(root["orderId"]), stringFromAny(root["orderLinkId"]))
	if strings.TrimSpace(orderRef) == "" {
		return models.Order{}, base.ExchangeError{Message: "bybit create order missing order id"}
	}

	order, err := b.FetchOrder(orderRef, &symbol)
	if err == nil {
		return order, nil
	}

	info, _ := b.fetchSymbolInfo(symbol)
	now := time.Now().UTC()
	return models.Order{
		ID:        orderRef,
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Side:      side,
		Price:     price,
		Size:      firstPositive(size, numberFromAny(params["quantity"])),
		Status:    models.OrderStatusPending,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// CancelOrder cancels an existing Bybit spot order.
func (b *Bybit) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "bybit cancel requires symbol"}
	}
	if strings.TrimSpace(orderID) == "" {
		return models.Order{}, base.InvalidOrder{Message: "bybit cancel requires orderID"}
	}

	body := map[string]any{
		"category": "spot",
		"symbol":   symbol,
	}
	body["orderId"] = strings.TrimSpace(orderID)

	payload, err := b.doSignedJSONRequest(http.MethodPost, "/v5/order/cancel", body)
	if err != nil {
		return models.Order{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "bybit cancel response malformed"}
	}
	orderRef := firstNonEmpty(stringFromAny(root["orderId"]), strings.TrimSpace(orderID))
	if fetched, err := b.FetchOrder(orderRef, &symbol); err == nil {
		return fetched, nil
	}

	info, _ := b.fetchSymbolInfo(symbol)
	now := time.Now().UTC()
	return models.Order{
		ID:        orderRef,
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Status:    models.OrderStatusCancelled,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// FetchOrder returns an order by ID or client order ID.
func (b *Bybit) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "bybit fetch order requires symbol"}
	}
	if strings.TrimSpace(orderID) == "" {
		return models.Order{}, base.InvalidOrder{Message: "bybit fetch order requires orderID"}
	}

	if order, ok, err := b.fetchOrderFromEndpoint("/v5/order/realtime", symbol, "orderId", orderID); err != nil {
		return models.Order{}, err
	} else if ok {
		return order, nil
	}
	if order, ok, err := b.fetchOrderFromEndpoint("/v5/order/realtime", symbol, "orderLinkId", orderID); err != nil {
		return models.Order{}, err
	} else if ok {
		return order, nil
	}
	if order, ok, err := b.fetchOrderFromEndpoint("/v5/order/history", symbol, "orderId", orderID); err != nil {
		return models.Order{}, err
	} else if ok {
		return order, nil
	}
	if order, ok, err := b.fetchOrderFromEndpoint("/v5/order/history", symbol, "orderLinkId", orderID); err != nil {
		return models.Order{}, err
	} else if ok {
		return order, nil
	}
	return models.Order{}, base.MarketNotFound{Message: fmt.Sprintf("bybit order not found: %s", orderID)}
}

// FetchOpenOrders returns open orders for a symbol or all symbols.
func (b *Bybit) FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("category", "spot")
	values.Set("openOnly", "0")
	if symbol := strings.ToUpper(strings.TrimSpace(deref(marketID))); symbol != "" {
		values.Set("symbol", symbol)
	}
	if limit := intFromAny(params["limit"], 0); limit > 0 {
		values.Set("limit", stringFromAny(limit))
	}

	payload, err := b.doSignedQueryRequest(http.MethodGet, "/v5/order/realtime", values)
	if err != nil {
		return nil, err
	}
	return b.parseOrderList(payload, "")
}

// FetchOrderHistory returns Bybit spot order history for one market or all spot symbols.
func (b *Bybit) FetchOrderHistory(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("category", "spot")
	if symbol := strings.ToUpper(strings.TrimSpace(deref(marketID))); symbol != "" {
		values.Set("symbol", symbol)
	}
	if limit := intFromAny(params["limit"], 20); limit > 0 {
		if limit > 50 {
			limit = 50
		}
		values.Set("limit", stringFromAny(limit))
	}
	if startTime := int64FromConfig(params, "start_time", 0); startTime > 0 {
		values.Set("startTime", stringFromAny(startTime))
	}
	if startTime := int64FromConfig(params, "startTime", 0); startTime > 0 && values.Get("startTime") == "" {
		values.Set("startTime", stringFromAny(startTime))
	}
	if endTime := int64FromConfig(params, "end_time", 0); endTime > 0 {
		values.Set("endTime", stringFromAny(endTime))
	}
	if endTime := int64FromConfig(params, "endTime", 0); endTime > 0 && values.Get("endTime") == "" {
		values.Set("endTime", stringFromAny(endTime))
	}
	if cursor := strings.TrimSpace(stringFromAny(params["cursor"])); cursor != "" {
		values.Set("cursor", cursor)
	}

	payload, err := b.doSignedQueryRequest(http.MethodGet, "/v5/order/history", values)
	if err != nil {
		return nil, err
	}
	return b.parseOrderList(payload, strings.ToUpper(strings.TrimSpace(deref(marketID))))
}

// FetchPositions returns spot balances as positions.
func (b *Bybit) FetchPositions(marketID *string, _ map[string]any) ([]models.Position, error) {
	account, err := b.fetchBalanceSnapshot()
	if err != nil {
		return nil, err
	}

	targetSymbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if targetSymbol != "" {
		info, err := b.fetchSymbolInfo(targetSymbol)
		if err != nil {
			return nil, err
		}
		price, _ := b.fetchLastPrice(targetSymbol)
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

	infos, err := b.fetchAllSymbolInfo()
	if err != nil {
		return nil, err
	}
	prices, _ := b.fetchPriceMap()
	preferred := preferredBybitSymbolsByBaseAsset(infos)

	positions := []models.Position{}
	for asset, total := range account {
		if total <= 0 || stableQuoteAssets[asset] {
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

// FetchBalance returns best-effort wallet balances keyed by asset.
func (b *Bybit) FetchBalance() (map[string]float64, error) {
	return b.fetchBalanceSnapshot()
}

func (b *Bybit) ensureAuthenticated() error {
	if b.apiKey == "" || b.apiSecret == "" {
		return base.AuthenticationError{Message: "bybit api_key and api_secret required"}
	}
	return nil
}

func (b *Bybit) fetchAllSymbolInfo() (map[string]bybitSymbolInfo, error) {
	b.mu.RLock()
	if len(b.symbolInfo) > 0 {
		cached := copyBybitSymbolInfoMap(b.symbolInfo)
		b.mu.RUnlock()
		return cached, nil
	}
	b.mu.RUnlock()

	values := url.Values{}
	values.Set("category", "spot")
	payload, err := b.doPublicQueryRequest(http.MethodGet, "/v5/market/instruments-info", values)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit instruments response malformed"}
	}
	items, ok := root["list"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit instruments list missing"}
	}

	next := map[string]bybitSymbolInfo{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		info := parseBybitSymbolInfo(mapped)
		if info.Symbol == "" {
			continue
		}
		next[info.Symbol] = info
	}

	b.mu.Lock()
	b.symbolInfo = next
	b.mu.Unlock()
	return copyBybitSymbolInfoMap(next), nil
}

func (b *Bybit) fetchSymbolInfo(symbol string) (bybitSymbolInfo, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return bybitSymbolInfo{}, base.MarketNotFound{Message: "bybit symbol required"}
	}

	b.mu.RLock()
	if info, ok := b.symbolInfo[symbol]; ok {
		b.mu.RUnlock()
		return info, nil
	}
	b.mu.RUnlock()

	values := url.Values{}
	values.Set("category", "spot")
	values.Set("symbol", symbol)
	payload, err := b.doPublicQueryRequest(http.MethodGet, "/v5/market/instruments-info", values)
	if err != nil {
		return bybitSymbolInfo{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return bybitSymbolInfo{}, base.ExchangeError{Message: "bybit instruments response malformed"}
	}
	items, ok := root["list"].([]any)
	if !ok || len(items) == 0 {
		return bybitSymbolInfo{}, base.MarketNotFound{Message: fmt.Sprintf("bybit market not found: %s", symbol)}
	}
	mapped, ok := items[0].(map[string]any)
	if !ok {
		return bybitSymbolInfo{}, base.ExchangeError{Message: "bybit instrument payload malformed"}
	}
	info := parseBybitSymbolInfo(mapped)
	b.mu.Lock()
	b.symbolInfo[symbol] = info
	b.mu.Unlock()
	return info, nil
}

func (b *Bybit) fetchTickerMap(symbol string) (map[string]bybitTicker, error) {
	values := url.Values{}
	values.Set("category", "spot")
	if symbol != "" {
		values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))
	}
	payload, err := b.doPublicQueryRequest(http.MethodGet, "/v5/market/tickers", values)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit tickers response malformed"}
	}
	items, ok := root["list"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit tickers list missing"}
	}

	out := map[string]bybitTicker{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ticker := parseBybitTicker(mapped)
		if ticker.Symbol != "" {
			out[ticker.Symbol] = ticker
		}
	}
	return out, nil
}

func (b *Bybit) fetchSingleTicker(symbol string) (bybitTicker, error) {
	tickers, err := b.fetchTickerMap(symbol)
	if err != nil {
		return bybitTicker{}, err
	}
	ticker, ok := tickers[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return bybitTicker{}, base.MarketNotFound{Message: fmt.Sprintf("bybit ticker not found: %s", symbol)}
	}
	return ticker, nil
}

func (b *Bybit) fetchLastPrice(symbol string) (float64, error) {
	ticker, err := b.fetchSingleTicker(symbol)
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

func (b *Bybit) fetchPriceMap() (map[string]float64, error) {
	tickers, err := b.fetchTickerMap("")
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

func (b *Bybit) fetchBalanceSnapshot() (map[string]float64, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("accountType", b.accountType)
	payload, err := b.doSignedQueryRequest(http.MethodGet, "/v5/account/wallet-balance", values)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit wallet balance response malformed"}
	}
	lists, ok := root["list"].([]any)
	if !ok || len(lists) == 0 {
		return nil, base.ExchangeError{Message: "bybit wallet balance list missing"}
	}
	account, ok := lists[0].(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit wallet balance account malformed"}
	}
	coins, ok := account["coin"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit wallet balance coins missing"}
	}

	balances := map[string]float64{}
	for _, item := range coins {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		asset := strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["coin"])))
		if asset == "" {
			continue
		}
		amount := firstPositive(
			floatFromAny(mapped["availableToWithdraw"]),
			floatFromAny(mapped["walletBalance"]),
		)
		if amount > 0 {
			balances[asset] = amount
		}
	}
	return balances, nil
}
