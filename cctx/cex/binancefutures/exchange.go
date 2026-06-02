package binancefutures

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
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
	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

const (
	BinanceFuturesBaseURL = "https://fapi.binance.com"
	defaultRecvWindow     = int64(5000)
)

// BinanceFutures implements Binance USD-M futures trading.
type BinanceFutures struct {
	base.BaseExchange
	apiKey     string
	apiSecret  string
	baseURL    string
	recvWindow int64
	httpClient *http.Client

	mu         sync.RWMutex
	symbolInfo map[string]futuresSymbolInfo

	serverTimeOffsetMillis int64
	lastServerTimeSyncUnix int64
	timeSyncMu             sync.Mutex
}

type futuresSymbolInfo struct {
	Symbol      string
	Status      string
	Pair        string
	Contract    string
	BaseAsset   string
	QuoteAsset  string
	MarginAsset string
	TickSize    string
	MinQty      string
	MaxQty      string
	StepSize    string
	MinNotional string
}

type bookTicker struct {
	Symbol   string
	BidPrice float64
	BidQty   float64
	AskPrice float64
	AskQty   float64
}

var (
	_ base.Exchange      = (*BinanceFutures)(nil)
	_ base.FuturesTrader = (*BinanceFutures)(nil)
)

// NewBinanceFutures creates a Binance USD-M futures exchange adapter.
func NewBinanceFutures(config map[string]any) (base.Exchange, error) {
	if config == nil {
		config = map[string]any{}
	}
	resolvedConfig, err := secureconfig.ResolveMap(config)
	if err != nil {
		return nil, fmt.Errorf("cex.binancefutures.NewBinanceFutures: resolve secure config: %w", err)
	}
	config = resolvedConfig

	ex := &BinanceFutures{
		BaseExchange: base.NewBaseExchange(config),
		apiKey:       stringFromConfig(config, "api_key"),
		apiSecret:    firstNonEmpty(stringFromConfig(config, "api_secret"), stringFromConfig(config, "hmac_secret")),
		baseURL:      firstNonEmpty(stringFromConfig(config, "base_url"), stringFromConfig(config, "host"), BinanceFuturesBaseURL),
		recvWindow:   int64FromAny(config["recv_window"], defaultRecvWindow),
		symbolInfo:   map[string]futuresSymbolInfo{},
	}
	ex.httpClient = &http.Client{Timeout: ex.Timeout}
	ex.BaseExchange.Bind(ex)
	return ex, nil
}

// ID returns the exchange identifier.
func (b *BinanceFutures) ID() string {
	return "binance_futures"
}

// Name returns the display name.
func (b *BinanceFutures) Name() string {
	return "Binance USD-M Futures"
}

// FetchMarkets returns Binance USD-M perpetual markets.
func (b *BinanceFutures) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if params == nil {
		params = map[string]any{}
	}
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
	limit := intFromAny(params["limit"], 100)
	if limit <= 0 {
		limit = 100
	}

	keys := make([]string, 0, len(infos))
	for key := range infos {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	markets := make([]models.Market, 0, limit)
	for _, symbol := range keys {
		info := infos[symbol]
		if info.Status != "TRADING" || info.Contract != "PERPETUAL" {
			continue
		}
		if quoteFilter != "" && info.QuoteAsset != quoteFilter {
			continue
		}
		ticker, ok := tickers[symbol]
		if !ok {
			continue
		}
		markets = append(markets, buildMarket(info, ticker))
		if len(markets) >= limit {
			break
		}
	}
	return markets, nil
}

// FetchMarket returns a single futures market.
func (b *BinanceFutures) FetchMarket(marketID string) (models.Market, error) {
	symbol := strings.ToUpper(strings.TrimSpace(marketID))
	if symbol == "" {
		return models.Market{}, base.MarketNotFound{Message: "binance futures symbol required"}
	}

	info, err := b.fetchSymbolInfo(symbol)
	if err != nil {
		return models.Market{}, err
	}
	ticker, err := b.fetchSingleBookTicker(symbol)
	if err != nil {
		return models.Market{}, err
	}
	return buildMarket(info, ticker), nil
}

// CreateOrder submits a futures order using the generic exchange interface.
func (b *BinanceFutures) CreateOrder(marketID, _ string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if params == nil {
		params = map[string]any{}
	}
	orderType := base.FuturesOrderType(strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(params["type"]), chooseOrderType(price)))))
	quantity := firstNonEmpty(stringFromAny(params["quantity"]), formatFloat(size))
	request := base.FuturesOrderRequest{
		Symbol:           strings.ToUpper(strings.TrimSpace(firstNonEmpty(marketID, stringFromAny(params["symbol"])))),
		Side:             side,
		Type:             orderType,
		Quantity:         quantity,
		Price:            firstNonEmpty(stringFromAny(params["price"]), formatFloat(price)),
		TimeInForce:      strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(params["timeInForce"]), stringFromAny(params["time_in_force"]), "GTC"))),
		ReduceOnly:       boolFromAny(params["reduceOnly"]) || boolFromAny(params["reduce_only"]),
		PositionSide:     base.FuturesPositionSide(strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(params["positionSide"]), stringFromAny(params["position_side"]))))),
		ClientOrderID:    firstNonEmpty(stringFromAny(params["newClientOrderId"]), stringFromAny(params["client_order_id"])),
		NewOrderRespType: firstNonEmpty(stringFromAny(params["newOrderRespType"]), stringFromAny(params["new_order_resp_type"]), "RESULT"),
		Test:             boolFromAny(params["test"]) || boolFromAny(params["test_order"]) || boolFromAny(params["dry_run"]),
		Params:           params,
	}
	order, err := b.PlaceFuturesOrder(request)
	if err != nil {
		return models.Order{}, err
	}
	return futuresOrderToModel(order), nil
}

// CancelOrder cancels an existing futures order.
func (b *BinanceFutures) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}
	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "binance futures cancel requires symbol"}
	}
	values := url.Values{}
	values.Set("symbol", symbol)
	switch {
	case strings.TrimSpace(orderID) == "":
		return models.Order{}, base.InvalidOrder{Message: "binance futures cancel requires orderID"}
	case isNumeric(orderID):
		values.Set("orderId", strings.TrimSpace(orderID))
	default:
		values.Set("origClientOrderId", strings.TrimSpace(orderID))
	}

	payload, err := b.doQueryRequest(http.MethodDelete, "/fapi/v1/order", values, true)
	if err != nil {
		return models.Order{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return models.Order{}, base.ExchangeError{Message: "binance futures cancel response malformed"}
	}
	return futuresOrderToModel(parseFuturesOrder(root, symbol)), nil
}

// FetchOrder returns a futures order by ID.
func (b *BinanceFutures) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	order, err := b.FetchFuturesOrder(symbol, orderID)
	if err != nil {
		return models.Order{}, err
	}
	return futuresOrderToModel(order), nil
}

// FetchOpenOrders returns open futures orders.
func (b *BinanceFutures) FetchOpenOrders(marketID *string, _ map[string]any) ([]models.Order, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}
	values := url.Values{}
	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol != "" {
		values.Set("symbol", symbol)
	}

	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v1/openOrders", values, true)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance futures openOrders response malformed"}
	}
	orders := make([]models.Order, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		orders = append(orders, futuresOrderToModel(parseFuturesOrder(mapped, symbol)))
	}
	return orders, nil
}

// FetchPositions returns futures positions mapped to the generic position model.
func (b *BinanceFutures) FetchPositions(marketID *string, params map[string]any) ([]models.Position, error) {
	positions, err := b.FetchFuturesPositions(marketID, params)
	if err != nil {
		return nil, err
	}
	out := make([]models.Position, 0, len(positions))
	for _, position := range positions {
		size := math.Abs(floatFromAny(position.PositionAmount))
		if size <= 0 {
			continue
		}
		out = append(out, models.Position{
			MarketID:     position.Symbol,
			Outcome:      string(position.PositionSide),
			Size:         size,
			AveragePrice: floatFromAny(position.EntryPrice),
			CurrentPrice: floatFromAny(position.MarkPrice),
		})
	}
	return out, nil
}

// FetchBalance returns available futures balances keyed by asset.
func (b *BinanceFutures) FetchBalance() (map[string]float64, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}
	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v2/balance", nil, true)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance futures balance response malformed"}
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
		available := firstPositive(floatFromAny(mapped["availableBalance"]), floatFromAny(mapped["balance"]))
		if available > 0 {
			balances[asset] = available
		}
	}
	return balances, nil
}

// SetLeverage updates leverage for a futures symbol.
func (b *BinanceFutures) SetLeverage(symbol string, leverage int) (base.FuturesLeverageResult, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return base.FuturesLeverageResult{}, err
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" || leverage <= 0 {
		return base.FuturesLeverageResult{}, base.InvalidOrder{Message: "binance futures leverage requires symbol and positive leverage"}
	}
	values := url.Values{}
	values.Set("symbol", symbol)
	values.Set("leverage", strconv.Itoa(leverage))

	payload, err := b.doFormRequest(http.MethodPost, "/fapi/v1/leverage", values, true)
	if err != nil {
		return base.FuturesLeverageResult{}, err
	}
	return base.FuturesLeverageResult{
		Symbol:           strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["symbol"]), symbol))),
		Leverage:         intFromAny(payload["leverage"], leverage),
		MaxNotionalValue: stringFromAny(payload["maxNotionalValue"]),
		Raw:              payload,
	}, nil
}

// PlaceFuturesOrder submits a typed futures order.
func (b *BinanceFutures) PlaceFuturesOrder(request base.FuturesOrderRequest) (base.FuturesOrder, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return base.FuturesOrder{}, err
	}
	symbol := strings.ToUpper(strings.TrimSpace(request.Symbol))
	if symbol == "" {
		return base.FuturesOrder{}, base.InvalidOrder{Message: "binance futures symbol required"}
	}
	orderType := base.FuturesOrderType(strings.ToUpper(strings.TrimSpace(string(request.Type))))
	if orderType == "" {
		orderType = base.FuturesOrderTypeMarket
	}
	quantity := strings.TrimSpace(request.Quantity)
	if quantity == "" {
		return base.FuturesOrder{}, base.InvalidOrder{Message: "binance futures order requires quantity"}
	}

	values := url.Values{}
	values.Set("symbol", symbol)
	values.Set("side", strings.ToUpper(string(request.Side)))
	values.Set("type", string(orderType))
	values.Set("quantity", quantity)

	switch orderType {
	case base.FuturesOrderTypeLimit:
		if strings.TrimSpace(request.Price) == "" {
			return base.FuturesOrder{}, base.InvalidOrder{Message: "binance futures limit order requires price"}
		}
		values.Set("price", strings.TrimSpace(request.Price))
		values.Set("timeInForce", strings.ToUpper(strings.TrimSpace(firstNonEmpty(request.TimeInForce, "GTC"))))
	case base.FuturesOrderTypeMarket:
	default:
		if strings.TrimSpace(request.Price) != "" {
			values.Set("price", strings.TrimSpace(request.Price))
		}
		if strings.TrimSpace(request.TimeInForce) != "" {
			values.Set("timeInForce", strings.ToUpper(strings.TrimSpace(request.TimeInForce)))
		}
	}
	if request.ReduceOnly {
		values.Set("reduceOnly", "true")
	}
	if request.PositionSide != "" {
		values.Set("positionSide", string(request.PositionSide))
	}
	if request.ClientOrderID != "" {
		values.Set("newClientOrderId", request.ClientOrderID)
	}
	if request.NewOrderRespType != "" {
		values.Set("newOrderRespType", request.NewOrderRespType)
	}
	for key, value := range request.Params {
		switch key {
		case "symbol", "side", "type", "quantity", "price", "timeInForce", "time_in_force", "reduceOnly", "reduce_only", "positionSide", "position_side", "newClientOrderId", "client_order_id", "newOrderRespType", "new_order_resp_type", "test", "test_order", "dry_run":
			continue
		default:
			if encoded := stringFromAny(value); encoded != "" {
				values.Set(key, encoded)
			}
		}
	}

	endpoint := "/fapi/v1/order"
	if request.Test {
		endpoint = "/fapi/v1/order/test"
	}
	payload, err := b.doFormRequest(http.MethodPost, endpoint, values, true)
	if err != nil {
		return base.FuturesOrder{}, err
	}
	if request.Test {
		now := time.Now().UnixMilli()
		return base.FuturesOrder{
			ID:              "test-order",
			Symbol:          symbol,
			Side:            request.Side,
			Type:            orderType,
			Status:          "TEST",
			Quantity:        quantity,
			Price:           request.Price,
			ReduceOnly:      request.ReduceOnly,
			PositionSide:    request.PositionSide,
			CreatedAtMillis: now,
			UpdatedAtMillis: now,
			Raw:             payload,
		}, nil
	}
	return parseFuturesOrder(payload, symbol), nil
}

// FetchFuturesOrder returns a typed futures order by exchange order ID or client order ID.
func (b *BinanceFutures) FetchFuturesOrder(symbol, orderID string) (base.FuturesOrder, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return base.FuturesOrder{}, err
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return base.FuturesOrder{}, base.InvalidOrder{Message: "binance futures fetch order requires symbol"}
	}
	values := url.Values{}
	values.Set("symbol", symbol)
	switch {
	case strings.TrimSpace(orderID) == "":
		return base.FuturesOrder{}, base.InvalidOrder{Message: "binance futures fetch order requires orderID"}
	case isNumeric(orderID):
		values.Set("orderId", strings.TrimSpace(orderID))
	default:
		values.Set("origClientOrderId", strings.TrimSpace(orderID))
	}

	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v1/order", values, true)
	if err != nil {
		return base.FuturesOrder{}, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return base.FuturesOrder{}, base.ExchangeError{Message: "binance futures fetch order response malformed"}
	}
	return parseFuturesOrder(root, symbol), nil
}

// FetchFuturesPositions returns Binance position risk rows.
func (b *BinanceFutures) FetchFuturesPositions(symbol *string, _ map[string]any) ([]base.FuturesPosition, error) {
	if err := b.ensureAuthenticated(); err != nil {
		return nil, err
	}
	values := url.Values{}
	if symbol != nil && strings.TrimSpace(*symbol) != "" {
		values.Set("symbol", strings.ToUpper(strings.TrimSpace(*symbol)))
	}
	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v2/positionRisk", values, true)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance futures positionRisk response malformed"}
	}
	positions := make([]base.FuturesPosition, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		positions = append(positions, parseFuturesPosition(mapped))
	}
	return positions, nil
}

// FuturesQuantityRules returns LOT_SIZE and notional rules for a symbol.
func (b *BinanceFutures) FuturesQuantityRules(symbol string) (base.FuturesQuantityRules, error) {
	info, err := b.fetchSymbolInfo(symbol)
	if err != nil {
		return base.FuturesQuantityRules{}, err
	}
	return base.FuturesQuantityRules{
		Symbol:      info.Symbol,
		MinQty:      info.MinQty,
		MaxQty:      info.MaxQty,
		StepSize:    info.StepSize,
		MinNotional: info.MinNotional,
	}, nil
}

// RoundFuturesQuantity floors a quantity to the symbol's LOT_SIZE step.
func (b *BinanceFutures) RoundFuturesQuantity(symbol string, quantity string) (string, error) {
	rules, err := b.FuturesQuantityRules(symbol)
	if err != nil {
		return "", err
	}
	return roundDownToStep(quantity, rules.StepSize)
}

// GetOrderbook fetches current futures depth for a symbol.
func (b *BinanceFutures) GetOrderbook(symbol string) (map[string]any, error) {
	values := url.Values{}
	values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))
	values.Set("limit", "20")

	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v1/depth", values, false)
	if err != nil {
		return nil, err
	}
	book, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance futures depth response malformed"}
	}
	return map[string]any{
		"bids": normalizeDepthLevels(book["bids"]),
		"asks": normalizeDepthLevels(book["asks"]),
	}, nil
}

func (b *BinanceFutures) ensureAuthenticated() error {
	if b.apiKey == "" || b.apiSecret == "" {
		return base.AuthenticationError{Message: "binance futures api_key and api_secret required"}
	}
	return nil
}

func (b *BinanceFutures) fetchAllSymbolInfo() (map[string]futuresSymbolInfo, error) {
	b.mu.RLock()
	if len(b.symbolInfo) > 0 {
		cached := copySymbolInfoMap(b.symbolInfo)
		b.mu.RUnlock()
		return cached, nil
	}
	b.mu.RUnlock()

	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v1/exchangeInfo", nil, false)
	if err != nil {
		return nil, err
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance futures exchangeInfo response malformed"}
	}
	items, ok := root["symbols"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "binance futures exchangeInfo symbols missing"}
	}

	next := map[string]futuresSymbolInfo{}
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

func (b *BinanceFutures) fetchSymbolInfo(symbol string) (futuresSymbolInfo, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return futuresSymbolInfo{}, base.MarketNotFound{Message: "binance futures symbol required"}
	}
	b.mu.RLock()
	if info, ok := b.symbolInfo[symbol]; ok {
		b.mu.RUnlock()
		return info, nil
	}
	b.mu.RUnlock()

	infos, err := b.fetchAllSymbolInfo()
	if err != nil {
		return futuresSymbolInfo{}, err
	}
	info, ok := infos[symbol]
	if !ok {
		return futuresSymbolInfo{}, base.MarketNotFound{Message: fmt.Sprintf("binance futures market not found: %s", symbol)}
	}
	return info, nil
}

func (b *BinanceFutures) fetchBookTickerMap(symbol string) (map[string]bookTicker, error) {
	values := url.Values{}
	if symbol != "" {
		values.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))
	}
	payload, err := b.doQueryRequest(http.MethodGet, "/fapi/v1/ticker/bookTicker", values, false)
	if err != nil {
		return nil, err
	}
	out := map[string]bookTicker{}
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
		return nil, base.ExchangeError{Message: "binance futures bookTicker response malformed"}
	}
	return out, nil
}

func (b *BinanceFutures) fetchSingleBookTicker(symbol string) (bookTicker, error) {
	tickers, err := b.fetchBookTickerMap(symbol)
	if err != nil {
		return bookTicker{}, err
	}
	ticker, ok := tickers[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return bookTicker{}, base.MarketNotFound{Message: fmt.Sprintf("binance futures ticker not found: %s", symbol)}
	}
	return ticker, nil
}

func (b *BinanceFutures) doQueryRequest(method, endpoint string, values url.Values, signed bool) (any, error) {
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

func (b *BinanceFutures) doFormRequest(method, endpoint string, values url.Values, signed bool) (map[string]any, error) {
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
		return nil, base.ExchangeError{Message: "binance futures response malformed"}
	}
	return root, nil
}

func (b *BinanceFutures) performRequest(buildRequest func() (*http.Request, error), endpoint string) (any, error) {
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
			return base.RateLimitError{Message: "binance futures rate limited"}
		}
		if resp.StatusCode >= 400 {
			return classifyError(resp.StatusCode, endpoint, payload)
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

func (b *BinanceFutures) withSignature(values url.Values) url.Values {
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

func (b *BinanceFutures) currentTimestampMillis() int64 {
	return time.Now().UnixMilli() + atomic.LoadInt64(&b.serverTimeOffsetMillis)
}

func (b *BinanceFutures) syncServerTimeOffsetBestEffort() {
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

func (b *BinanceFutures) fetchServerTimeOffsetMillis() (int64, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(b.baseURL, "/")+"/fapi/v1/time", nil)
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
		return 0, classifyError(resp.StatusCode, "/fapi/v1/time", payload)
	}
	root := map[string]any{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("decode server time response: %v", err)}
	}
	serverMillis := int64(floatFromAny(root["serverTime"]))
	if serverMillis <= 0 {
		return 0, base.ExchangeError{Message: "binance futures server time missing"}
	}
	return serverMillis - time.Now().UnixMilli(), nil
}

func buildMarket(info futuresSymbolInfo, ticker bookTicker) models.Market {
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
		Question:  fmt.Sprintf("%s/%s USD-M Perpetual", info.BaseAsset, info.QuoteAsset),
		Outcomes:  []string{info.BaseAsset},
		Liquidity: liquidity,
		Prices:    map[string]float64{info.BaseAsset: mid},
		Metadata: map[string]any{
			"market_type":  "futures",
			"venue":        "binance_usdm",
			"symbol":       info.Symbol,
			"pair":         info.Pair,
			"contract":     info.Contract,
			"base_asset":   info.BaseAsset,
			"quote_asset":  info.QuoteAsset,
			"margin_asset": info.MarginAsset,
			"status":       info.Status,
			"step_size":    info.StepSize,
			"min_qty":      info.MinQty,
			"max_qty":      info.MaxQty,
			"min_notional": info.MinNotional,
			"clobTokenIds": []string{info.Symbol},
			"tokens":       map[string]any{info.BaseAsset: info.Symbol},
		},
		TickSize: floatFromAny(info.TickSize),
	}
}

func parseSymbolInfo(data map[string]any) futuresSymbolInfo {
	info := futuresSymbolInfo{
		Symbol:      strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		Status:      strings.ToUpper(strings.TrimSpace(stringFromAny(data["status"]))),
		Pair:        strings.ToUpper(strings.TrimSpace(stringFromAny(data["pair"]))),
		Contract:    strings.ToUpper(strings.TrimSpace(stringFromAny(data["contractType"]))),
		BaseAsset:   strings.ToUpper(strings.TrimSpace(stringFromAny(data["baseAsset"]))),
		QuoteAsset:  strings.ToUpper(strings.TrimSpace(stringFromAny(data["quoteAsset"]))),
		MarginAsset: strings.ToUpper(strings.TrimSpace(stringFromAny(data["marginAsset"]))),
	}
	filters, _ := data["filters"].([]any)
	for _, item := range filters {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["filterType"]))) {
		case "PRICE_FILTER":
			info.TickSize = stringFromAny(mapped["tickSize"])
		case "LOT_SIZE":
			info.MinQty = stringFromAny(mapped["minQty"])
			info.MaxQty = stringFromAny(mapped["maxQty"])
			info.StepSize = stringFromAny(mapped["stepSize"])
		case "MIN_NOTIONAL", "NOTIONAL":
			info.MinNotional = firstNonEmpty(stringFromAny(mapped["notional"]), stringFromAny(mapped["minNotional"]))
		}
	}
	return info
}

func parseBookTicker(data map[string]any) bookTicker {
	return bookTicker{
		Symbol:   strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		BidPrice: floatFromAny(data["bidPrice"]),
		BidQty:   floatFromAny(data["bidQty"]),
		AskPrice: floatFromAny(data["askPrice"]),
		AskQty:   floatFromAny(data["askQty"]),
	}
}

func parseFuturesOrder(payload map[string]any, fallbackSymbol string) base.FuturesOrder {
	return base.FuturesOrder{
		ID:               firstNonEmpty(stringFromAny(payload["orderId"]), stringFromAny(payload["orderID"])),
		ClientOrderID:    stringFromAny(payload["clientOrderId"]),
		Symbol:           strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["symbol"]), fallbackSymbol))),
		Side:             parseOrderSide(stringFromAny(payload["side"])),
		Type:             base.FuturesOrderType(strings.ToUpper(strings.TrimSpace(stringFromAny(payload["type"])))),
		Status:           strings.ToUpper(strings.TrimSpace(stringFromAny(payload["status"]))),
		Quantity:         firstNonEmpty(stringFromAny(payload["origQty"]), stringFromAny(payload["quantity"])),
		ExecutedQuantity: stringFromAny(payload["executedQty"]),
		AveragePrice:     firstNonEmpty(stringFromAny(payload["avgPrice"]), stringFromAny(payload["averagePrice"])),
		Price:            stringFromAny(payload["price"]),
		ReduceOnly:       boolFromAny(payload["reduceOnly"]),
		PositionSide:     base.FuturesPositionSide(strings.ToUpper(strings.TrimSpace(stringFromAny(payload["positionSide"])))),
		CreatedAtMillis:  int64FromAny(payload["time"], 0),
		UpdatedAtMillis:  int64FromAny(payload["updateTime"], 0),
		Raw:              payload,
	}
}

func parseFuturesPosition(payload map[string]any) base.FuturesPosition {
	return base.FuturesPosition{
		Symbol:           strings.ToUpper(strings.TrimSpace(stringFromAny(payload["symbol"]))),
		PositionSide:     base.FuturesPositionSide(strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["positionSide"]), "BOTH")))),
		PositionAmount:   stringFromAny(payload["positionAmt"]),
		EntryPrice:       stringFromAny(payload["entryPrice"]),
		MarkPrice:        stringFromAny(payload["markPrice"]),
		UnrealizedProfit: stringFromAny(payload["unRealizedProfit"]),
		Leverage:         intFromAny(payload["leverage"], 0),
		LiquidationPrice: stringFromAny(payload["liquidationPrice"]),
		MarginType:       strings.ToLower(strings.TrimSpace(stringFromAny(payload["marginType"]))),
		UpdateTimeMillis: int64FromAny(payload["updateTime"], 0),
		Raw:              payload,
	}
}

func futuresOrderToModel(order base.FuturesOrder) models.Order {
	createdAt := time.Now().UTC()
	if order.CreatedAtMillis > 0 {
		createdAt = time.UnixMilli(order.CreatedAtMillis).UTC()
	}
	updatedAt := createdAt
	if order.UpdatedAtMillis > 0 {
		updatedAt = time.UnixMilli(order.UpdatedAtMillis).UTC()
	}
	return models.Order{
		ID:        order.ID,
		MarketID:  order.Symbol,
		Outcome:   string(order.PositionSide),
		Side:      order.Side,
		Price:     floatFromAny(firstNonEmpty(order.Price, order.AveragePrice)),
		Size:      floatFromAny(order.Quantity),
		Filled:    floatFromAny(order.ExecutedQuantity),
		Status:    parseOrderStatus(order.Status),
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
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

func classifyError(statusCode int, endpoint string, payload []byte) error {
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

func chooseOrderType(price float64) string {
	if price > 0 {
		return string(base.FuturesOrderTypeLimit)
	}
	return string(base.FuturesOrderTypeMarket)
}

func formatFloat(value float64) string {
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
	case string:
		out, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err == nil {
			return out
		}
	case json.Number:
		out, _ := typed.Float64()
		return out
	}
	return 0
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

func int64FromAny(value any, fallback int64) int64 {
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
	return stringFromAny(config[key])
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

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func isNumeric(value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	_, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return err == nil
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
			"price": formatFloat(price),
			"size":  formatFloat(size),
		})
	}
	return levels
}

func copySymbolInfoMap(source map[string]futuresSymbolInfo) map[string]futuresSymbolInfo {
	out := make(map[string]futuresSymbolInfo, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}

func roundDownToStep(quantity, step string) (string, error) {
	q, ok := new(big.Rat).SetString(strings.TrimSpace(quantity))
	if !ok || q.Sign() < 0 {
		return "", base.InvalidOrder{Message: fmt.Sprintf("invalid quantity: %s", quantity)}
	}
	s, ok := new(big.Rat).SetString(strings.TrimSpace(step))
	if !ok || s.Sign() <= 0 {
		return "", base.ExchangeError{Message: fmt.Sprintf("invalid step size: %s", step)}
	}
	units := new(big.Rat).Quo(q, s)
	floored := new(big.Int).Quo(units.Num(), units.Denom())
	result := new(big.Rat).Mul(new(big.Rat).SetInt(floored), s)
	return trimDecimalString(result.FloatString(decimalScale(step))), nil
}

func decimalScale(value string) int {
	value = strings.TrimSpace(strings.ToLower(value))
	if idx := strings.Index(value, "e"); idx >= 0 {
		value = value[:idx]
	}
	dot := strings.Index(value, ".")
	if dot < 0 {
		return 0
	}
	frac := strings.TrimRight(value[dot+1:], "0")
	return len(frac)
}

func trimDecimalString(value string) string {
	value = strings.TrimSpace(value)
	if !strings.Contains(value, ".") {
		return value
	}
	value = strings.TrimRight(value, "0")
	value = strings.TrimRight(value, ".")
	if value == "" {
		return "0"
	}
	return value
}
