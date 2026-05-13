package binance

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

const (
	BinanceBaseURL          = "https://api.binance.com"
	defaultRecvWindow int64 = 5000
)

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
	resolvedConfig, err := secureconfig.ResolveMap(config)
	if err != nil {
		return nil, fmt.Errorf("cex.binance.NewBinance: resolve secure config: %w", err)
	}
	config = resolvedConfig

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
