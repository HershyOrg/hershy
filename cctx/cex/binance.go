package cex

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

const (
	BinanceBaseURL          = "https://api.binance.com"
	defaultRecvWindow int64 = 5000
)

var stableQuoteAssets = map[string]bool{
	"USD":   true,
	"USDC":  true,
	"USDT":  true,
	"BUSD":  true,
	"FDUSD": true,
	"TUSD":  true,
}

// Binance implements Binance spot trading using the shared cctx exchange model.
type Binance struct {
	base.BaseExchange
	apiKey     string
	apiSecret  string
	baseURL    string
	recvWindow int64
	httpClient *http.Client

	mu         sync.RWMutex
	symbolInfo map[string]binanceSymbolInfo

	serverTimeOffsetMillis int64
	lastServerTimeSyncUnix int64
	timeSyncMu             sync.Mutex
}

type binanceSymbolInfo struct {
	Symbol     string
	Status     string
	BaseAsset  string
	QuoteAsset string
	TickSize   float64
	StepSize   float64
}

type binanceBookTicker struct {
	Symbol   string
	BidPrice float64
	BidQty   float64
	AskPrice float64
	AskQty   float64
}

// NewBinance creates a Binance spot exchange adapter.
func NewBinance(config map[string]any) (base.Exchange, error) {
	if config == nil {
		config = map[string]any{}
	}

	ex := &Binance{
		BaseExchange: base.NewBaseExchange(config),
		apiKey:       stringFromConfig(config, "api_key"),
		apiSecret:    firstNonEmpty(stringFromConfig(config, "api_secret"), stringFromConfig(config, "hmac_secret")),
		baseURL:      firstNonEmpty(stringFromConfig(config, "base_url"), stringFromConfig(config, "host"), BinanceBaseURL),
		recvWindow:   int64FromConfig(config, "recv_window", defaultRecvWindow),
		symbolInfo:   map[string]binanceSymbolInfo{},
	}
	ex.httpClient = &http.Client{Timeout: ex.Timeout}
	ex.BaseExchange.Bind(ex)
	return ex, nil
}

// ID returns the exchange identifier.
func (b *Binance) ID() string {
	return "binance"
}

// Name returns the display name.
func (b *Binance) Name() string {
	return "Binance Spot"
}

// FetchMarkets returns Binance spot markets.
func (b *Binance) FetchMarkets(params map[string]any) ([]models.Market, error) {
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
	tickers, err := b.fetchBookTickerMap("")
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
		markets = append(markets, buildSpotMarket(info, ticker))
		if len(markets) >= limit {
			break
		}
	}
	return markets, nil
}

// FetchMarket returns a single Binance symbol as a spot market.
func (b *Binance) FetchMarket(marketID string) (models.Market, error) {
	symbol := strings.ToUpper(strings.TrimSpace(marketID))
	if symbol == "" {
		return models.Market{}, base.MarketNotFound{Message: "binance market symbol required"}
	}

	info, err := b.fetchSymbolInfo(symbol)
	if err != nil {
		return models.Market{}, err
	}
	ticker, err := b.fetchSingleBookTicker(symbol)
	if err != nil {
		return models.Market{}, err
	}
	return buildSpotMarket(info, ticker), nil
}

// CreateOrder submits a Binance spot order.
func (b *Binance) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(marketID, stringFromAny(params["symbol"]))))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "binance symbol required"}
	}
	useTestEndpoint := boolFromAny(params["test"]) || boolFromAny(params["test_order"]) || boolFromAny(params["dry_run"])

	orderType := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(params["type"]), chooseOrderType(price))))
	values := url.Values{}
	values.Set("symbol", symbol)
	values.Set("side", strings.ToUpper(string(side)))
	values.Set("type", orderType)

	quantity := formatDecimal(size)
	if quantity == "" {
		quantity = formatDecimal(numberFromAny(params["quantity"]))
	}
	quoteOrderQty := formatDecimal(firstPositive(numberFromAny(params["quoteOrderQty"]), numberFromAny(params["quote_order_qty"])))
	timeInForce := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(params["timeInForce"]), stringFromAny(params["time_in_force"]), "GTC")))

	switch orderType {
	case "LIMIT":
		if quantity == "" || price <= 0 {
			return models.Order{}, base.InvalidOrder{Message: "binance limit order requires quantity and price"}
		}
		values.Set("quantity", quantity)
		values.Set("price", formatDecimal(price))
		values.Set("timeInForce", timeInForce)
	case "MARKET":
		if quoteOrderQty == "" && quantity == "" {
			return models.Order{}, base.InvalidOrder{Message: "binance market order requires quantity or quoteOrderQty"}
		}
		if quoteOrderQty != "" {
			values.Set("quoteOrderQty", quoteOrderQty)
		}
		if quantity != "" {
			values.Set("quantity", quantity)
		}
	default:
		if quantity != "" {
			values.Set("quantity", quantity)
		}
		if price > 0 {
			values.Set("price", formatDecimal(price))
		}
		if timeInForce != "" {
			values.Set("timeInForce", timeInForce)
		}
	}

	if newClientOrderID := strings.TrimSpace(firstNonEmpty(stringFromAny(params["newClientOrderId"]), stringFromAny(params["client_order_id"]))); newClientOrderID != "" {
		values.Set("newClientOrderId", newClientOrderID)
	}

	endpoint := "/api/v3/order"
	if useTestEndpoint {
		endpoint = "/api/v3/order/test"
	}
	payload, err := b.doFormRequest(http.MethodPost, endpoint, values, true)
	if err != nil {
		return models.Order{}, err
	}
	if useTestEndpoint {
		info, _ := b.fetchSymbolInfo(symbol)
		now := time.Now().UTC()
		return models.Order{
			ID:        "test-order",
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
	return b.parseOrder(payload, symbol), nil
}

// CancelOrder cancels an existing Binance spot order.
func (b *Binance) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}
	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "binance cancel requires symbol"}
	}

	values := url.Values{}
	values.Set("symbol", symbol)
	switch {
	case strings.TrimSpace(orderID) == "":
		return models.Order{}, base.InvalidOrder{Message: "binance cancel requires orderID"}
	case isNumeric(orderID):
		values.Set("orderId", strings.TrimSpace(orderID))
	default:
		values.Set("origClientOrderId", strings.TrimSpace(orderID))
	}

	payload, err := b.doQueryRequest(http.MethodDelete, "/api/v3/order", values, true)
	if err != nil {
		return models.Order{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "binance cancel response malformed"}
	}
	return b.parseOrder(root, symbol), nil
}

// FetchOrder returns an order by ID.
func (b *Binance) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}
	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "binance fetch order requires symbol"}
	}

	values := url.Values{}
	values.Set("symbol", symbol)
	switch {
	case strings.TrimSpace(orderID) == "":
		return models.Order{}, base.InvalidOrder{Message: "binance fetch order requires orderID"}
	case isNumeric(orderID):
		values.Set("orderId", strings.TrimSpace(orderID))
	default:
		values.Set("origClientOrderId", strings.TrimSpace(orderID))
	}

	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/order", values, true)
	if err != nil {
		return models.Order{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "binance fetch order response malformed"}
	}
	return b.parseOrder(root, symbol), nil
}

// FetchOpenOrders returns open orders for a symbol or all symbols.
func (b *Binance) FetchOpenOrders(marketID *string, _ map[string]any) ([]models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol != "" {
		values.Set("symbol", symbol)
	}

	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/openOrders", values, true)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance openOrders response malformed"}
	}
	orders := make([]models.Order, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		orderSymbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(mapped["symbol"]), symbol)))
		orders = append(orders, b.parseOrder(mapped, orderSymbol))
	}
	return orders, nil
}

// FetchOrderHistory returns historical orders for a symbol or, when marketID is nil, best-effort history across symbols.
func (b *Binance) FetchOrderHistory(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol != "" {
		return b.fetchOrderHistoryForSymbol(symbol, params)
	}

	infos, err := b.fetchAllSymbolInfo()
	if err != nil {
		return nil, err
	}

	quoteFilter := strings.ToUpper(strings.TrimSpace(stringFromAny(params["quote_asset"])))
	baseFilter := strings.ToUpper(strings.TrimSpace(stringFromAny(params["base_asset"])))

	keys := make([]string, 0, len(infos))
	for key, info := range infos {
		if info.Symbol == "" || info.Status != "TRADING" {
			continue
		}
		if quoteFilter != "" && info.QuoteAsset != quoteFilter {
			continue
		}
		if baseFilter != "" && info.BaseAsset != baseFilter {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if maxSymbols := intFromAny(params["max_symbols"], 0); maxSymbols > 0 && len(keys) > maxSymbols {
		keys = keys[:maxSymbols]
	}

	orders := make([]models.Order, 0)
	for _, key := range keys {
		history, err := b.fetchOrderHistoryForSymbol(key, params)
		if err != nil {
			return nil, err
		}
		orders = append(orders, history...)
	}

	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, nil
}

// FetchPositions returns spot balances as positions.
func (b *Binance) FetchPositions(marketID *string, _ map[string]any) ([]models.Position, error) {
	account, err := b.fetchAccount()
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
		total := balanceTotal(account, info.BaseAsset)
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
	preferred := preferredSymbolsByBaseAsset(infos)
	prices, _ := b.fetchPriceMap()

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

func (b *Binance) fetchOrderHistoryForSymbol(symbol string, params map[string]any) ([]models.Order, error) {
	values := url.Values{}
	values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))

	limit := intFromAny(params["limit"], 100)
	if limit > 0 {
		if limit > 1000 {
			limit = 1000
		}
		values.Set("limit", strconv.Itoa(limit))
	}

	if orderID := strings.TrimSpace(firstNonEmpty(stringFromAny(params["orderId"]), stringFromAny(params["order_id"]), stringFromAny(params["from_order_id"]))); orderID != "" {
		values.Set("orderId", orderID)
	}
	if startTime := int64FromConfig(params, "start_time", 0); startTime > 0 {
		values.Set("startTime", strconv.FormatInt(startTime, 10))
	}
	if startTime := int64FromConfig(params, "startTime", 0); startTime > 0 && values.Get("startTime") == "" {
		values.Set("startTime", strconv.FormatInt(startTime, 10))
	}
	if endTime := int64FromConfig(params, "end_time", 0); endTime > 0 {
		values.Set("endTime", strconv.FormatInt(endTime, 10))
	}
	if endTime := int64FromConfig(params, "endTime", 0); endTime > 0 && values.Get("endTime") == "" {
		values.Set("endTime", strconv.FormatInt(endTime, 10))
	}

	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/allOrders", values, true)
	if err != nil {
		return nil, err
	}

	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance allOrders response malformed"}
	}

	orders := make([]models.Order, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		orders = append(orders, b.parseOrder(mapped, symbol))
	}

	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, nil
}

// FetchBalance returns available balances keyed by asset.
func (b *Binance) FetchBalance() (map[string]float64, error) {
	account, err := b.fetchAccount()
	if err != nil {
		return nil, err
	}
	return account, nil
}

// GetOrderbook fetches the current book depth for a symbol.
func (b *Binance) GetOrderbook(symbol string) (map[string]any, error) {
	values := url.Values{}
	values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))
	values.Set("limit", "20")

	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/depth", values, false)
	if err != nil {
		return nil, err
	}
	book, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance depth response malformed"}
	}

	return map[string]any{
		"bids": normalizeDepthLevels(book["bids"]),
		"asks": normalizeDepthLevels(book["asks"]),
	}, nil
}

func (b *Binance) ensureAuthenticated() error {
	if b.apiKey == "" || b.apiSecret == "" {
		return base.AuthenticationError{Message: "binance api_key and api_secret required"}
	}
	return nil
}

func (b *Binance) fetchAllSymbolInfo() (map[string]binanceSymbolInfo, error) {
	b.mu.RLock()
	if len(b.symbolInfo) > 0 {
		cached := copySymbolInfoMap(b.symbolInfo)
		b.mu.RUnlock()
		return cached, nil
	}
	b.mu.RUnlock()

	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/exchangeInfo", nil, false)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance exchangeInfo response malformed"}
	}

	items, ok := root["symbols"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance exchangeInfo symbols missing"}
	}

	next := map[string]binanceSymbolInfo{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		info := parseSymbolInfo(mapped)
		if info.Symbol == "" {
			continue
		}
		next[info.Symbol] = info
	}

	b.mu.Lock()
	b.symbolInfo = next
	b.mu.Unlock()
	return copySymbolInfoMap(next), nil
}

func (b *Binance) fetchSymbolInfo(symbol string) (binanceSymbolInfo, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return binanceSymbolInfo{}, base.MarketNotFound{Message: "binance symbol required"}
	}

	b.mu.RLock()
	if info, ok := b.symbolInfo[symbol]; ok {
		b.mu.RUnlock()
		return info, nil
	}
	b.mu.RUnlock()

	values := url.Values{}
	values.Set("symbol", symbol)
	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/exchangeInfo", values, false)
	if err != nil {
		return binanceSymbolInfo{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return binanceSymbolInfo{}, base.ExchangeError{Message: "binance exchangeInfo response malformed"}
	}
	items, ok := root["symbols"].([]any)
	if !ok || len(items) == 0 {
		return binanceSymbolInfo{}, base.MarketNotFound{Message: fmt.Sprintf("binance market not found: %s", symbol)}
	}
	mapped, ok := items[0].(map[string]any)
	if !ok {
		return binanceSymbolInfo{}, base.ExchangeError{Message: "binance exchangeInfo symbol payload malformed"}
	}

	info := parseSymbolInfo(mapped)
	b.mu.Lock()
	b.symbolInfo[symbol] = info
	b.mu.Unlock()
	return info, nil
}

func (b *Binance) fetchBookTickerMap(symbol string) (map[string]binanceBookTicker, error) {
	values := url.Values{}
	if symbol != "" {
		values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))
	}
	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/ticker/bookTicker", values, false)
	if err != nil {
		return nil, err
	}

	out := map[string]binanceBookTicker{}
	switch typed := payload.(type) {
	case map[string]any:
		ticker := parseBookTicker(typed)
		if ticker.Symbol != "" {
			out[ticker.Symbol] = ticker
		}
	case []any:
		for _, item := range typed {
			mapped, ok := item.(map[string]any)
			if !ok {
				continue
			}
			ticker := parseBookTicker(mapped)
			if ticker.Symbol != "" {
				out[ticker.Symbol] = ticker
			}
		}
	default:
		return nil, base.ExchangeError{Message: "binance bookTicker response malformed"}
	}
	return out, nil
}

func (b *Binance) fetchSingleBookTicker(symbol string) (binanceBookTicker, error) {
	tickers, err := b.fetchBookTickerMap(symbol)
	if err != nil {
		return binanceBookTicker{}, err
	}
	ticker, ok := tickers[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return binanceBookTicker{}, base.MarketNotFound{Message: fmt.Sprintf("binance ticker not found: %s", symbol)}
	}
	return ticker, nil
}

func (b *Binance) fetchLastPrice(symbol string) (float64, error) {
	values := url.Values{}
	values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))

	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/ticker/price", values, false)
	if err != nil {
		return 0, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return 0, base.ExchangeError{Message: "binance ticker price response malformed"}
	}
	return floatFromAny(root["price"]), nil
}

func (b *Binance) fetchPriceMap() (map[string]float64, error) {
	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/ticker/price", nil, false)
	if err != nil {
		return nil, err
	}

	out := map[string]float64{}
	items, ok := payload.([]any)
	if !ok {
		return out, nil
	}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		symbol := strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["symbol"])))
		if symbol == "" {
			continue
		}
		out[symbol] = floatFromAny(mapped["price"])
	}
	return out, nil
}

func (b *Binance) fetchAccount() (map[string]float64, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}
	payload, err := b.doQueryRequest(http.MethodGet, "/api/v3/account", nil, true)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance account response malformed"}
	}
	items, ok := root["balances"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance account balances missing"}
	}

	balances := map[string]float64{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		asset := strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["asset"])))
		if asset == "" {
			continue
		}
		free := floatFromAny(mapped["free"])
		if free > 0 {
			balances[asset] = free
		}
	}
	return balances, nil
}

func (b *Binance) doQueryRequest(method, endpoint string, values url.Values, signed bool) (any, error) {
	query := cloneValues(values)
	if signed {
		if err := b.ensureAuthenticated(); err != nil {
			return nil, err
		}
		query = b.withSignature(query)
	}

	reqURL := strings.TrimRight(b.baseURL, "/") + endpoint
	if encoded := query.Encode(); encoded != "" {
		reqURL += "?" + encoded
	}

	return b.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, reqURL, nil)
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		if signed {
			req.Header.Set("X-MBX-APIKEY", b.apiKey)
		}
		return req, nil
	}, endpoint)
}

func (b *Binance) doFormRequest(method, endpoint string, values url.Values, signed bool) (map[string]any, error) {
	form := cloneValues(values)
	if signed {
		if err := b.ensureAuthenticated(); err != nil {
			return nil, err
		}
		form = b.withSignature(form)
	}

	encodedForm := form.Encode()
	payload, err := b.performRequest(func() (*http.Request, error) {
		req, err := http.NewRequest(method, strings.TrimRight(b.baseURL, "/")+endpoint, strings.NewReader(encodedForm))
		if err != nil {
			return nil, base.ExchangeError{Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if signed {
			req.Header.Set("X-MBX-APIKEY", b.apiKey)
		}
		return req, nil
	}, endpoint)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance response malformed"}
	}
	return root, nil
}

func (b *Binance) performRequest(buildRequest func() (*http.Request, error), endpoint string) (any, error) {
	var out any
	err := b.RetryOnFailure(func() error {
		req, err := buildRequest()
		if err != nil {
			return err
		}
		resp, err := b.httpClient.Do(req)
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		defer resp.Body.Close()

		payload, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		if err != nil {
			return base.NetworkError{Message: err.Error()}
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return base.RateLimitError{Message: "binance rate limited"}
		}
		if resp.StatusCode >= 400 {
			return classifyBinanceError(resp.StatusCode, endpoint, payload)
		}
		if len(strings.TrimSpace(string(payload))) == 0 {
			out = map[string]any{}
			return nil
		}
		if err := json.Unmarshal(payload, &out); err != nil {
			return base.ExchangeError{Message: fmt.Sprintf("decode response: %v", err)}
		}
		return nil
	})
	return out, err
}

func (b *Binance) withSignature(values url.Values) url.Values {
	b.syncServerTimeOffsetBestEffort()

	out := cloneValues(values)
	out.Set("timestamp", strconv.FormatInt(b.currentTimestampMillis(), 10))
	if _, ok := out["recvWindow"]; !ok && b.recvWindow > 0 {
		out.Set("recvWindow", strconv.FormatInt(b.recvWindow, 10))
	}
	signature := buildHMACSHA256Hex(b.apiSecret, out.Encode())
	out.Set("signature", signature)
	return out
}

func (b *Binance) currentTimestampMillis() int64 {
	return time.Now().UnixMilli() + atomic.LoadInt64(&b.serverTimeOffsetMillis)
}

func (b *Binance) syncServerTimeOffsetBestEffort() {
	const minSyncInterval = 30 * time.Second

	lastSyncUnix := atomic.LoadInt64(&b.lastServerTimeSyncUnix)
	if lastSyncUnix > 0 && time.Since(time.Unix(lastSyncUnix, 0)) < minSyncInterval {
		return
	}

	b.timeSyncMu.Lock()
	defer b.timeSyncMu.Unlock()

	lastSyncUnix = atomic.LoadInt64(&b.lastServerTimeSyncUnix)
	if lastSyncUnix > 0 && time.Since(time.Unix(lastSyncUnix, 0)) < minSyncInterval {
		return
	}

	offsetMillis, err := b.fetchServerTimeOffsetMillis()
	atomic.StoreInt64(&b.lastServerTimeSyncUnix, time.Now().Unix())
	if err != nil {
		return
	}
	atomic.StoreInt64(&b.serverTimeOffsetMillis, offsetMillis)
}

func (b *Binance) fetchServerTimeOffsetMillis() (int64, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(b.baseURL, "/")+"/api/v3/time", nil)
	if err != nil {
		return 0, base.ExchangeError{Message: err.Error()}
	}
	req.Header.Set("Accept", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return 0, base.NetworkError{Message: err.Error()}
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, base.NetworkError{Message: err.Error()}
	}
	if resp.StatusCode >= 400 {
		return 0, classifyBinanceError(resp.StatusCode, "/api/v3/time", payload)
	}

	root := map[string]any{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("decode server time response: %v", err)}
	}

	serverMillis := int64(floatFromAny(root["serverTime"]))
	if serverMillis <= 0 {
		return 0, base.ExchangeError{Message: "binance server time missing"}
	}

	return serverMillis - time.Now().UnixMilli(), nil
}

func (b *Binance) parseOrder(payload map[string]any, fallbackSymbol string) models.Order {
	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["symbol"]), fallbackSymbol)))
	info, _ := b.fetchSymbolInfo(symbol)

	price := floatFromAny(payload["price"])
	if price <= 0 {
		price = floatFromAny(payload["stopPrice"])
	}
	if price <= 0 {
		price = floatFromAny(payload["fillsPrice"])
	}

	size := floatFromAny(payload["origQty"])
	if size <= 0 {
		size = floatFromAny(payload["executedQty"])
	}

	filled := floatFromAny(payload["executedQty"])
	createdAt := unixMillisFromAny(payload["time"])
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	updatedAt := unixMillisFromAny(payload["updateTime"])
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}

	return models.Order{
		ID:        firstNonEmpty(stringFromAny(payload["orderId"]), stringFromAny(payload["clientOrderId"])),
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Side:      parseOrderSide(stringFromAny(payload["side"])),
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    parseOrderStatus(stringFromAny(payload["status"])),
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
	}
}

func buildSpotMarket(info binanceSymbolInfo, ticker binanceBookTicker) models.Market {
	mid := ticker.BidPrice
	if ticker.AskPrice > 0 {
		if ticker.BidPrice > 0 {
			mid = (ticker.BidPrice + ticker.AskPrice) / 2
		} else {
			mid = ticker.AskPrice
		}
	}

	liquidity := ticker.BidPrice*ticker.BidQty + ticker.AskPrice*ticker.AskQty
	return models.Market{
		ID:        info.Symbol,
		Question:  fmt.Sprintf("%s/%s Spot", info.BaseAsset, info.QuoteAsset),
		Outcomes:  []string{info.BaseAsset},
		Liquidity: liquidity,
		Prices:    map[string]float64{info.BaseAsset: mid},
		Metadata: map[string]any{
			"market_type":  "spot",
			"symbol":       info.Symbol,
			"base_asset":   info.BaseAsset,
			"quote_asset":  info.QuoteAsset,
			"status":       info.Status,
			"clobTokenIds": []string{info.Symbol},
			"tokens":       map[string]any{info.BaseAsset: info.Symbol},
		},
		TickSize: info.TickSize,
	}
}

func parseSymbolInfo(data map[string]any) binanceSymbolInfo {
	info := binanceSymbolInfo{
		Symbol:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		Status:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["status"]))),
		BaseAsset:  strings.ToUpper(strings.TrimSpace(stringFromAny(data["baseAsset"]))),
		QuoteAsset: strings.ToUpper(strings.TrimSpace(stringFromAny(data["quoteAsset"]))),
	}

	filters, _ := data["filters"].([]any)
	for _, item := range filters {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["filterType"]))) {
		case "PRICE_FILTER":
			info.TickSize = floatFromAny(mapped["tickSize"])
		case "LOT_SIZE":
			info.StepSize = floatFromAny(mapped["stepSize"])
		}
	}
	return info
}

func parseBookTicker(data map[string]any) binanceBookTicker {
	return binanceBookTicker{
		Symbol:   strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		BidPrice: floatFromAny(data["bidPrice"]),
		BidQty:   floatFromAny(data["bidQty"]),
		AskPrice: floatFromAny(data["askPrice"]),
		AskQty:   floatFromAny(data["askQty"]),
	}
}

func parseOrderStatus(status string) models.OrderStatus {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "NEW":
		return models.OrderStatusOpen
	case "PARTIALLY_FILLED":
		return models.OrderStatusPartiallyFilled
	case "FILLED":
		return models.OrderStatusFilled
	case "CANCELED", "PENDING_CANCEL", "EXPIRED", "EXPIRED_IN_MATCH":
		return models.OrderStatusCancelled
	case "REJECTED":
		return models.OrderStatusRejected
	default:
		return models.OrderStatusPending
	}
}

func parseOrderSide(side string) models.OrderSide {
	switch strings.ToUpper(strings.TrimSpace(side)) {
	case "SELL":
		return models.OrderSideSell
	default:
		return models.OrderSideBuy
	}
}

func classifyBinanceError(statusCode int, endpoint string, payload []byte) error {
	type errBody struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	var parsed errBody
	_ = json.Unmarshal(payload, &parsed)
	message := strings.TrimSpace(parsed.Msg)
	if message == "" {
		message = strings.TrimSpace(string(payload))
	}
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return base.AuthenticationError{Message: message}
	case parsed.Code == -2015 || parsed.Code == -2014 || parsed.Code == -1022:
		return base.AuthenticationError{Message: message}
	case parsed.Code == -2010 || parsed.Code == -1013 || parsed.Code == -1100 || strings.Contains(endpoint, "/order"):
		return base.InvalidOrder{Message: message}
	default:
		return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", statusCode, message)}
	}
}

func preferredSymbolsByBaseAsset(infos map[string]binanceSymbolInfo) map[string]string {
	out := map[string]string{}
	for _, info := range infos {
		if info.Symbol == "" || info.BaseAsset == "" || info.Status != "TRADING" {
			continue
		}
		prev, exists := out[info.BaseAsset]
		if !exists || quoteAssetPriority(info.QuoteAsset) < quoteAssetPriority(infos[prev].QuoteAsset) {
			out[info.BaseAsset] = info.Symbol
		}
	}
	return out
}

func quoteAssetPriority(asset string) int {
	switch strings.ToUpper(strings.TrimSpace(asset)) {
	case "USDT":
		return 0
	case "USDC":
		return 1
	case "FDUSD":
		return 2
	case "BUSD":
		return 3
	case "TUSD":
		return 4
	default:
		return 100
	}
}

func normalizeDepthLevels(raw any) []any {
	rows, ok := raw.([]any)
	if !ok {
		return []any{}
	}

	levels := make([]any, 0, len(rows))
	for _, row := range rows {
		values, ok := row.([]any)
		if !ok || len(values) < 2 {
			continue
		}
		price := floatFromAny(values[0])
		size := floatFromAny(values[1])
		if price <= 0 || size <= 0 {
			continue
		}
		levels = append(levels, map[string]any{
			"price": formatDecimal(price),
			"size":  formatDecimal(size),
		})
	}
	return levels
}

func cloneValues(values url.Values) url.Values {
	out := url.Values{}
	for key, list := range values {
		copied := make([]string, len(list))
		copy(copied, list)
		out[key] = copied
	}
	return out
}

func buildHMACSHA256Hex(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func copySymbolInfoMap(source map[string]binanceSymbolInfo) map[string]binanceSymbolInfo {
	out := make(map[string]binanceSymbolInfo, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}

func balanceTotal(account map[string]float64, asset string) float64 {
	return account[strings.ToUpper(strings.TrimSpace(asset))]
}

func chooseOrderType(price float64) string {
	if price > 0 {
		return "LIMIT"
	}
	return "MARKET"
}

func formatDecimal(value float64) string {
	if value <= 0 {
		return ""
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func floatFromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		out, _ := typed.Float64()
		return out
	case string:
		out, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err == nil {
			return out
		}
	}
	return 0
}

func numberFromAny(value any) float64 {
	return floatFromAny(value)
}

func intFromAny(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		out, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return out
		}
	}
	return fallback
}

func int64FromConfig(config map[string]any, key string, fallback int64) int64 {
	value, ok := config[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case string:
		out, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if err == nil {
			return out
		}
	}
	return fallback
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		default:
			return false
		}
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return false
	}
}

func stringFromConfig(config map[string]any, key string) string {
	value, ok := config[key]
	if !ok {
		return ""
	}
	return stringFromAny(value)
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func unixMillisFromAny(value any) time.Time {
	ms := int64(floatFromAny(value))
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstPositive(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func isNumeric(value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	_, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return err == nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
