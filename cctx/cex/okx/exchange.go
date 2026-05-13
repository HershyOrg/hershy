package okx

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

const OKXBaseURL = "https://www.okx.com"

// OKX implements OKX V5 spot trading using the shared cctx exchange model.
type OKX struct {
	base.BaseExchange
	apiKey        string
	apiSecret     string
	apiPassphrase string
	baseURL       string
	simulated     bool
	httpClient    *http.Client

	mu         sync.RWMutex
	symbolInfo map[string]okxInstrumentInfo
}

type okxInstrumentInfo struct {
	InstID     string
	State      string
	BaseAsset  string
	QuoteAsset string
	TickSize   float64
	LotSize    float64
	MinSize    float64
}

type okxTicker struct {
	InstID    string
	BidPrice  float64
	BidQty    float64
	AskPrice  float64
	AskQty    float64
	LastPrice float64
}

// NewOKX creates an OKX spot exchange adapter.
func NewOKX(config map[string]any) (base.Exchange, error) {
	if config == nil {
		config = map[string]any{}
	}
	resolvedConfig, err := secureconfig.ResolveMap(config)
	if err != nil {
		return nil, fmt.Errorf("cex.okx.NewOKX: resolve secure config: %w", err)
	}
	config = resolvedConfig

	ex := &OKX{
		BaseExchange:  base.NewBaseExchange(config),
		apiKey:        stringFromConfig(config, "api_key"),
		apiSecret:     firstNonEmpty(stringFromConfig(config, "api_secret"), stringFromConfig(config, "hmac_secret")),
		apiPassphrase: firstNonEmpty(stringFromConfig(config, "api_passphrase"), stringFromConfig(config, "passphrase")),
		baseURL:       firstNonEmpty(stringFromConfig(config, "base_url"), stringFromConfig(config, "host"), OKXBaseURL),
		simulated:     boolFromAny(config["simulated"]) || boolFromAny(config["simulated_trading"]) || boolFromAny(config["demo_trading"]),
		symbolInfo:    map[string]okxInstrumentInfo{},
	}
	ex.httpClient = &http.Client{Timeout: ex.Timeout}
	ex.BaseExchange.Bind(ex)
	return ex, nil
}

// ID returns the exchange identifier.
func (o *OKX) ID() string {
	return "okx"
}

// Name returns the display name.
func (o *OKX) Name() string {
	return "OKX Spot"
}

// FetchMarkets returns OKX spot markets.
func (o *OKX) FetchMarkets(params map[string]any) ([]models.Market, error) {
	if symbol := strings.ToUpper(strings.TrimSpace(stringFromAny(params["symbol"]))); symbol != "" {
		market, err := o.FetchMarket(symbol)
		if err != nil {
			return nil, err
		}
		return []models.Market{market}, nil
	}

	infos, err := o.fetchAllSymbolInfo()
	if err != nil {
		return nil, err
	}
	tickers, err := o.fetchTickerMap("")
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
		if info.State != "LIVE" {
			continue
		}
		if quoteFilter != "" && info.QuoteAsset != quoteFilter {
			continue
		}
		ticker, ok := tickers[symbol]
		if !ok {
			continue
		}
		markets = append(markets, buildOKXSpotMarket(info, ticker))
		if len(markets) >= limit {
			break
		}
	}
	return markets, nil
}

// FetchMarket returns a single OKX instrument as a spot market.
func (o *OKX) FetchMarket(marketID string) (models.Market, error) {
	symbol := strings.ToUpper(strings.TrimSpace(marketID))
	if symbol == "" {
		return models.Market{}, base.MarketNotFound{Message: "okx market symbol required"}
	}

	info, err := o.fetchSymbolInfo(symbol)
	if err != nil {
		return models.Market{}, err
	}
	ticker, err := o.fetchSingleTicker(symbol)
	if err != nil {
		return models.Market{}, err
	}
	return buildOKXSpotMarket(info, ticker), nil
}

// CreateOrder submits an OKX spot order.
func (o *OKX) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(marketID, stringFromAny(params["symbol"]))))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "okx symbol required"}
	}

	orderType := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringFromAny(params["type"]), chooseOrderType(price))))
	if orderType == "" {
		orderType = "market"
	}

	body := map[string]any{
		"instId":  symbol,
		"tdMode":  firstNonEmpty(stringFromAny(params["tdMode"]), stringFromAny(params["td_mode"]), "cash"),
		"side":    strings.ToLower(string(side)),
		"ordType": orderType,
	}
	if clientOrderID := strings.TrimSpace(firstNonEmpty(stringFromAny(params["clOrdId"]), stringFromAny(params["client_order_id"]), stringFromAny(params["newClientOrderId"]))); clientOrderID != "" {
		body["clOrdId"] = clientOrderID
	}

	quantity := formatDecimal(firstPositive(size, numberFromAny(params["quantity"])))
	quoteOrderQty := formatDecimal(firstPositive(numberFromAny(params["quoteOrderQty"]), numberFromAny(params["quote_order_qty"])))

	switch orderType {
	case "limit":
		if quantity == "" || price <= 0 {
			return models.Order{}, base.InvalidOrder{Message: "okx limit order requires quantity and price"}
		}
		body["sz"] = quantity
		body["px"] = formatDecimal(price)
	case "market":
		switch {
		case quoteOrderQty != "":
			body["sz"] = quoteOrderQty
			body["tgtCcy"] = "quote_ccy"
		case quantity != "":
			body["sz"] = quantity
			body["tgtCcy"] = "base_ccy"
		default:
			return models.Order{}, base.InvalidOrder{Message: "okx market order requires quantity or quoteOrderQty"}
		}
	default:
		if quantity == "" {
			return models.Order{}, base.InvalidOrder{Message: "okx order requires quantity"}
		}
		body["sz"] = quantity
		if price > 0 {
			body["px"] = formatDecimal(price)
		}
	}

	payload, err := o.doSignedJSONRequest(http.MethodPost, "/api/v5/trade/order", body)
	if err != nil {
		return models.Order{}, err
	}
	item, err := okxFirstItem(payload, "okx create order")
	if err != nil {
		return models.Order{}, err
	}
	if sCode := strings.TrimSpace(firstNonEmpty(stringFromAny(item["sCode"]), stringFromAny(item["code"]))); sCode != "" && sCode != "0" {
		return models.Order{}, classifyOKXEnvelopeError(sCode, firstNonEmpty(stringFromAny(item["sMsg"]), stringFromAny(item["msg"])), "/api/v5/trade/order")
	}

	orderRef := firstNonEmpty(stringFromAny(item["ordId"]), stringFromAny(item["clOrdId"]))
	if strings.TrimSpace(orderRef) == "" {
		return models.Order{}, base.ExchangeError{Message: "okx create order missing order id"}
	}

	if order, err := o.FetchOrder(orderRef, &symbol); err == nil {
		return order, nil
	}

	info, _ := o.fetchSymbolInfo(symbol)
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

// CancelOrder cancels an existing OKX spot order.
func (o *OKX) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "okx cancel requires symbol"}
	}
	if strings.TrimSpace(orderID) == "" {
		return models.Order{}, base.InvalidOrder{Message: "okx cancel requires orderID"}
	}

	body := map[string]any{
		"instId": symbol,
	}
	if isNumeric(orderID) {
		body["ordId"] = strings.TrimSpace(orderID)
	} else {
		body["clOrdId"] = strings.TrimSpace(orderID)
	}

	payload, err := o.doSignedJSONRequest(http.MethodPost, "/api/v5/trade/cancel-order", body)
	if err != nil {
		return models.Order{}, err
	}
	item, err := okxFirstItem(payload, "okx cancel order")
	if err != nil {
		return models.Order{}, err
	}
	if sCode := strings.TrimSpace(firstNonEmpty(stringFromAny(item["sCode"]), stringFromAny(item["code"]))); sCode != "" && sCode != "0" {
		return models.Order{}, classifyOKXEnvelopeError(sCode, firstNonEmpty(stringFromAny(item["sMsg"]), stringFromAny(item["msg"])), "/api/v5/trade/cancel-order")
	}

	orderRef := firstNonEmpty(stringFromAny(item["ordId"]), strings.TrimSpace(orderID))
	if fetched, err := o.FetchOrder(orderRef, &symbol); err == nil {
		return fetched, nil
	}

	info, _ := o.fetchSymbolInfo(symbol)
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
func (o *OKX) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return models.Order{}, err
	}

	symbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if symbol == "" {
		return models.Order{}, base.InvalidOrder{Message: "okx fetch order requires symbol"}
	}
	if strings.TrimSpace(orderID) == "" {
		return models.Order{}, base.InvalidOrder{Message: "okx fetch order requires orderID"}
	}

	values := url.Values{}
	values.Set("instId", symbol)
	if isNumeric(orderID) {
		values.Set("ordId", strings.TrimSpace(orderID))
	} else {
		values.Set("clOrdId", strings.TrimSpace(orderID))
	}

	payload, err := o.doSignedQueryRequest(http.MethodGet, "/api/v5/trade/order", values)
	if err != nil {
		return models.Order{}, err
	}
	item, err := okxFirstItem(payload, "okx fetch order")
	if err != nil {
		return models.Order{}, err
	}
	return o.parseOrder(item, symbol), nil
}

// FetchOpenOrders returns open orders for a symbol or all symbols.
func (o *OKX) FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("instType", "SPOT")
	if symbol := strings.ToUpper(strings.TrimSpace(deref(marketID))); symbol != "" {
		values.Set("instId", symbol)
	}
	if limit := intFromAny(params["limit"], 0); limit > 0 {
		values.Set("limit", stringFromAny(limit))
	}

	payload, err := o.doSignedQueryRequest(http.MethodGet, "/api/v5/trade/orders-pending", values)
	if err != nil {
		return nil, err
	}
	return o.parseOrderList(payload, "")
}

// FetchOrderHistory returns OKX spot order history for one market or all spot symbols.
func (o *OKX) FetchOrderHistory(marketID *string, params map[string]any) ([]models.Order, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("instType", "SPOT")
	if symbol := strings.ToUpper(strings.TrimSpace(deref(marketID))); symbol != "" {
		values.Set("instId", symbol)
	}
	if limit := intFromAny(params["limit"], 20); limit > 0 {
		if limit > 100 {
			limit = 100
		}
		values.Set("limit", stringFromAny(limit))
	}
	if after := strings.TrimSpace(firstNonEmpty(stringFromAny(params["after"]), stringFromAny(params["cursor_after"]))); after != "" {
		values.Set("after", after)
	}
	if before := strings.TrimSpace(firstNonEmpty(stringFromAny(params["before"]), stringFromAny(params["cursor_before"]))); before != "" {
		values.Set("before", before)
	}

	payload, err := o.doSignedQueryRequest(http.MethodGet, "/api/v5/trade/orders-history-archive", values)
	if err != nil {
		return nil, err
	}
	return o.parseOrderList(payload, strings.ToUpper(strings.TrimSpace(deref(marketID))))
}

// FetchPositions returns spot balances as positions.
func (o *OKX) FetchPositions(marketID *string, _ map[string]any) ([]models.Position, error) {
	account, err := o.fetchBalanceSnapshot()
	if err != nil {
		return nil, err
	}

	targetSymbol := strings.ToUpper(strings.TrimSpace(deref(marketID)))
	if targetSymbol != "" {
		info, err := o.fetchSymbolInfo(targetSymbol)
		if err != nil {
			return nil, err
		}
		price, _ := o.fetchLastPrice(targetSymbol)
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

	infos, err := o.fetchAllSymbolInfo()
	if err != nil {
		return nil, err
	}
	prices, _ := o.fetchPriceMap()
	preferred := preferredOKXSymbolsByBaseAsset(infos)

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
func (o *OKX) FetchBalance() (map[string]float64, error) {
	return o.fetchBalanceSnapshot()
}

func (o *OKX) ensureAuthenticated() error {
	if o.apiKey == "" || o.apiSecret == "" || o.apiPassphrase == "" {
		return base.AuthenticationError{Message: "okx api_key, api_secret, and api_passphrase required"}
	}
	return nil
}

func (o *OKX) fetchAllSymbolInfo() (map[string]okxInstrumentInfo, error) {
	o.mu.RLock()
	if len(o.symbolInfo) > 0 {
		cached := copyOKXSymbolInfoMap(o.symbolInfo)
		o.mu.RUnlock()
		return cached, nil
	}
	o.mu.RUnlock()

	values := url.Values{}
	values.Set("instType", "SPOT")
	payload, err := o.doPublicQueryRequest(http.MethodGet, "/api/v5/public/instruments", values)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "okx instruments response malformed"}
	}

	next := map[string]okxInstrumentInfo{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		info := parseOKXInstrumentInfo(mapped)
		if info.InstID == "" {
			continue
		}
		next[info.InstID] = info
	}

	o.mu.Lock()
	o.symbolInfo = next
	o.mu.Unlock()
	return copyOKXSymbolInfoMap(next), nil
}

func (o *OKX) fetchSymbolInfo(symbol string) (okxInstrumentInfo, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return okxInstrumentInfo{}, base.MarketNotFound{Message: "okx symbol required"}
	}

	o.mu.RLock()
	if info, ok := o.symbolInfo[symbol]; ok {
		o.mu.RUnlock()
		return info, nil
	}
	o.mu.RUnlock()

	values := url.Values{}
	values.Set("instType", "SPOT")
	values.Set("instId", symbol)
	payload, err := o.doPublicQueryRequest(http.MethodGet, "/api/v5/public/instruments", values)
	if err != nil {
		return okxInstrumentInfo{}, err
	}
	items, ok := payload.([]any)
	if !ok || len(items) == 0 {
		return okxInstrumentInfo{}, base.MarketNotFound{Message: fmt.Sprintf("okx market not found: %s", symbol)}
	}
	mapped, ok := items[0].(map[string]any)
	if !ok {
		return okxInstrumentInfo{}, base.ExchangeError{Message: "okx instrument payload malformed"}
	}
	info := parseOKXInstrumentInfo(mapped)

	o.mu.Lock()
	o.symbolInfo[symbol] = info
	o.mu.Unlock()
	return info, nil
}

func (o *OKX) fetchTickerMap(symbol string) (map[string]okxTicker, error) {
	values := url.Values{}
	endpoint := "/api/v5/market/tickers"
	if symbol != "" {
		endpoint = "/api/v5/market/ticker"
		values.Set("instId", strings.ToUpper(strings.TrimSpace(symbol)))
	} else {
		values.Set("instType", "SPOT")
	}
	payload, err := o.doPublicQueryRequest(http.MethodGet, endpoint, values)
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "okx ticker response malformed"}
	}

	out := map[string]okxTicker{}
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ticker := parseOKXTicker(mapped)
		if ticker.InstID != "" {
			out[ticker.InstID] = ticker
		}
	}
	return out, nil
}

func (o *OKX) fetchSingleTicker(symbol string) (okxTicker, error) {
	tickers, err := o.fetchTickerMap(symbol)
	if err != nil {
		return okxTicker{}, err
	}
	ticker, ok := tickers[strings.ToUpper(strings.TrimSpace(symbol))]
	if !ok {
		return okxTicker{}, base.MarketNotFound{Message: fmt.Sprintf("okx ticker not found: %s", symbol)}
	}
	return ticker, nil
}

func (o *OKX) fetchLastPrice(symbol string) (float64, error) {
	ticker, err := o.fetchSingleTicker(symbol)
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

func (o *OKX) fetchPriceMap() (map[string]float64, error) {
	tickers, err := o.fetchTickerMap("")
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

func (o *OKX) fetchBalanceSnapshot() (map[string]float64, error) {
	if err := o.ensureAuthenticated(); err != nil {
		return nil, err
	}

	payload, err := o.doSignedQueryRequest(http.MethodGet, "/api/v5/account/balance", url.Values{})
	if err != nil {
		return nil, err
	}
	items, ok := payload.([]any)
	if !ok || len(items) == 0 {
		return nil, base.ExchangeError{Message: "okx balance response malformed"}
	}
	account, ok := items[0].(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "okx balance account malformed"}
	}

	var details []any
	if rawDetails, ok := account["details"].([]any); ok && len(rawDetails) > 0 {
		details = rawDetails
	} else {
		details = items
	}

	balances := map[string]float64{}
	for _, item := range details {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		asset := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(mapped["ccy"]), stringFromAny(mapped["coin"]))))
		if asset == "" {
			continue
		}
		amount := firstPositive(
			floatFromAny(mapped["availBal"]),
			floatFromAny(mapped["eq"]),
			floatFromAny(mapped["bal"]),
		)
		if amount > 0 {
			balances[asset] = amount
		}
	}
	return balances, nil
}

func okxFirstItem(payload any, context string) (map[string]any, error) {
	items, ok := payload.([]any)
	if !ok || len(items) == 0 {
		return nil, base.ExchangeError{Message: context + " missing data"}
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: context + " malformed"}
	}
	return item, nil
}
