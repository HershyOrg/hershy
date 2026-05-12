package liveexec

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Mode string

const (
	ModePaper   Mode = "paper"
	ModeTestnet Mode = "testnet"
	ModeLive    Mode = "live"
)

type Action struct {
	ID     string
	Name   string
	Kind   string
	Config map[string]any
}

type OrderRequest struct {
	Symbol        string
	Side          string
	Type          string
	TimeInForce   string
	Quantity      string
	QuoteOrderQty string
	Price         string
	ClientOrderID string
}

func ResolveMode() Mode {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("HERSHY_TRADING_MODE"))) {
	case "live", "real", "production":
		return ModeLive
	case "testnet", "sandbox":
		return ModeTestnet
	default:
		return ModePaper
	}
}

func ExecuteAction(ctx context.Context, action Action, inputs map[string]any, nowMs int64) (map[string]any, error) {
	mode := ResolveMode()
	if mode == ModePaper {
		return PaperActionResult(action, inputs, nowMs), nil
	}

	exchange := strings.ToLower(firstNonEmpty(asString(action.Config["exchange"]), asString(action.Config["venue"])))
	if exchange != "" && !strings.Contains(exchange, "binance") {
		return nil, fmt.Errorf("live execution only supports Binance spot actions for now: %s", exchange)
	}
	if !isCEXAction(action) {
		return nil, fmt.Errorf("live execution only supports CEX order actions for now: %s", action.Kind)
	}
	if mode == ModeLive && !envBool("HERSHY_LIVE_TRADING_ENABLED") {
		return nil, fmt.Errorf("live trading is locked; set HERSHY_LIVE_TRADING_ENABLED=true to allow real orders")
	}

	order, err := buildOrderRequest(action, inputs)
	if err != nil {
		return nil, err
	}
	if err := enforceOrderSafety(order, mode); err != nil {
		return nil, err
	}

	client, err := NewBinanceSpotClient(mode)
	if err != nil {
		return nil, err
	}
	return client.PlaceOrder(ctx, order)
}

func isCEXAction(action Action) bool {
	text := strings.ToLower(strings.Join([]string{
		action.Kind,
		asString(action.Config["actionType"]),
		asString(action.Config["type"]),
		asString(action.Config["name"]),
	}, " "))
	return strings.Contains(text, "cex") || strings.Contains(text, "order") || strings.Contains(text, "binance")
}

func buildOrderRequest(action Action, inputs map[string]any) (OrderRequest, error) {
	symbol := strings.ToUpper(firstNonEmpty(
		asString(action.Config["symbol"]),
		asString(action.Config["market"]),
		asString(action.Config["pair"]),
		findFirstInputString(inputs, "symbol", "market", "pair"),
	))
	side := strings.ToUpper(firstNonEmpty(
		asString(action.Config["side"]),
		asString(action.Config["orderSide"]),
		asString(action.Config["direction"]),
	))
	orderType := strings.ToUpper(firstNonEmpty(
		asString(action.Config["orderType"]),
		asString(action.Config["type"]),
		"MARKET",
	))

	req := OrderRequest{
		Symbol:        symbol,
		Side:          side,
		Type:          orderType,
		TimeInForce:   strings.ToUpper(firstNonEmpty(asString(action.Config["timeInForce"]), "GTC")),
		Quantity:      decimalString(action.Config["quantity"], action.Config["qty"], action.Config["baseQty"], action.Config["amount"]),
		QuoteOrderQty: decimalString(action.Config["quoteOrderQty"], action.Config["quoteQty"], action.Config["notional"], action.Config["quote"], action.Config["usdtAmount"]),
		Price:         decimalString(action.Config["price"], action.Config["limitPrice"], findFirstInputValue(inputs, "price", "lastPrice", "close")),
		ClientOrderID: firstNonEmpty(asString(action.Config["clientOrderId"]), "hershy_"+safeID(action.ID)+"_"+strconv.FormatInt(time.Now().UnixMilli(), 10)),
	}

	if req.Symbol == "" {
		return req, fmt.Errorf("binance order requires config.symbol")
	}
	if req.Side != "BUY" && req.Side != "SELL" {
		return req, fmt.Errorf("binance order requires side BUY or SELL")
	}
	if req.Type == "" {
		req.Type = "MARKET"
	}
	if req.Type == "LIMIT" && (req.Quantity == "" || req.Price == "") {
		return req, fmt.Errorf("LIMIT order requires quantity and price")
	}
	if req.Type == "MARKET" && req.Quantity == "" && req.QuoteOrderQty == "" {
		return req, fmt.Errorf("MARKET order requires quantity or quoteOrderQty")
	}
	return req, nil
}

func enforceOrderSafety(order OrderRequest, mode Mode) error {
	maxNotional := envFloat("HERSHY_MAX_ORDER_NOTIONAL", 50)
	if maxNotional <= 0 {
		return nil
	}

	notional, ok := estimateNotional(order)
	if !ok {
		if mode == ModeLive {
			return fmt.Errorf("live order notional could not be estimated; set quoteOrderQty or quantity+price")
		}
		return nil
	}
	if notional > maxNotional {
		return fmt.Errorf("order notional %.8f exceeds HERSHY_MAX_ORDER_NOTIONAL %.8f", notional, maxNotional)
	}
	return nil
}

func estimateNotional(order OrderRequest) (float64, bool) {
	if quote, ok := parseFloat(order.QuoteOrderQty); ok && quote > 0 {
		return quote, true
	}
	qty, qtyOK := parseFloat(order.Quantity)
	price, priceOK := parseFloat(order.Price)
	if qtyOK && priceOK && qty > 0 && price > 0 {
		return qty * price, true
	}
	return 0, false
}

type BinanceSpotClient struct {
	BaseURL    string
	APIKey     string
	APISecret  string
	Mode       Mode
	HTTPClient *http.Client
}

func NewBinanceSpotClient(mode Mode) (*BinanceSpotClient, error) {
	apiKey := strings.TrimSpace(os.Getenv("BINANCE_API_KEY"))
	apiSecret := strings.TrimSpace(os.Getenv("BINANCE_API_SECRET"))
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("BINANCE_API_KEY and BINANCE_API_SECRET are required for %s trading", mode)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("BINANCE_BASE_URL")), "/")
	if baseURL == "" {
		if mode == ModeTestnet {
			baseURL = "https://testnet.binance.vision"
		} else {
			baseURL = "https://api.binance.com"
		}
	}

	return &BinanceSpotClient{
		BaseURL:    baseURL,
		APIKey:     apiKey,
		APISecret:  apiSecret,
		Mode:       mode,
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (c *BinanceSpotClient) PlaceOrder(ctx context.Context, order OrderRequest) (map[string]any, error) {
	values := url.Values{}
	values.Set("symbol", order.Symbol)
	values.Set("side", order.Side)
	values.Set("type", order.Type)
	if order.Type == "LIMIT" {
		values.Set("timeInForce", firstNonEmpty(order.TimeInForce, "GTC"))
	}
	if order.Quantity != "" {
		values.Set("quantity", order.Quantity)
	}
	if order.QuoteOrderQty != "" {
		values.Set("quoteOrderQty", order.QuoteOrderQty)
	}
	if order.Price != "" {
		values.Set("price", order.Price)
	}
	if order.ClientOrderID != "" {
		values.Set("newClientOrderId", order.ClientOrderID)
	}
	values.Set("recvWindow", firstNonEmpty(os.Getenv("BINANCE_RECV_WINDOW"), "5000"))
	values.Set("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))

	payload := values.Encode()
	signature := hmacSHA256Hex(payload, c.APISecret)
	values.Set("signature", signature)

	path := "/api/v3/order"
	if envBool("BINANCE_ORDER_TEST") {
		path = "/api/v3/order/test"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path+"?"+values.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-MBX-APIKEY", c.APIKey)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	result := map[string]any{
		"statusCode":    resp.StatusCode,
		"executionMode": string(c.Mode),
		"exchange":      "binance",
		"symbol":        order.Symbol,
		"side":          order.Side,
		"orderType":     order.Type,
		"timestamp":     time.Now().UnixMilli(),
	}
	if len(body) > 0 {
		var decoded map[string]any
		if err := json.Unmarshal(body, &decoded); err == nil {
			for k, v := range decoded {
				result[k] = v
			}
		} else {
			result["raw"] = string(body)
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result, fmt.Errorf("binance order rejected: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if result["status"] == nil {
		result["status"] = "SUBMITTED"
	}
	return result, nil
}

func hmacSHA256Hex(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func PaperActionResult(action Action, inputs map[string]any, nowMs int64) map[string]any {
	status := firstNonEmpty(asString(action.Config["paperStatus"]), asString(action.Config["status"]), "FILLED")
	amount := firstPositiveFloat(
		action.Config["filledQty"],
		action.Config["quantity"],
		action.Config["qty"],
		action.Config["amount"],
		action.Config["size"],
		action.Config["quoteOrderQty"],
		action.Config["quote"],
		action.Config["notional"],
	)
	if amount == 0 {
		amount = 1
	}
	price := firstPositiveFloat(action.Config["avgFillPrice"], action.Config["price"], findFirstInputValue(inputs, "lastPrice", "price", "close", "avgFillPrice", "executionPrice"))
	if price == 0 {
		price = round(100+rand.Float64()*10, 4)
	}

	result := map[string]any{
		"status":        status,
		"filledQty":     amount,
		"avgFillPrice":  price,
		"fee":           round(amount*price*0.0004, 8),
		"timestamp":     nowMs,
		"error":         "",
		"executionMode": string(ModePaper),
	}

	if strings.Contains(strings.ToLower(action.Kind), "dex") || strings.Contains(strings.ToLower(action.Kind), "swap") {
		result["txHash"] = fmt.Sprintf("paper-tx-%s-%d", action.ID, nowMs)
		result["amountIn"] = amount
		result["amountOut"] = amount
		result["executionPrice"] = price
		result["gasUsed"] = 0
		result["slippage"] = 0
	} else {
		result["orderId"] = fmt.Sprintf("paper-order-%s-%d", action.ID, nowMs)
	}

	return result
}

func findFirstInputString(inputs map[string]any, keys ...string) string {
	value := findFirstInputValue(inputs, keys...)
	return asString(value)
}

func findFirstInputValue(inputs map[string]any, keys ...string) any {
	for _, value := range inputs {
		if mapped, ok := value.(map[string]any); ok {
			for _, key := range keys {
				if mapped[key] != nil {
					return mapped[key]
				}
			}
		}
	}
	return nil
}

func decimalString(values ...any) string {
	for _, value := range values {
		switch v := value.(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		case float64:
			if v > 0 {
				return strconv.FormatFloat(v, 'f', -1, 64)
			}
		case float32:
			if v > 0 {
				return strconv.FormatFloat(float64(v), 'f', -1, 64)
			}
		case int:
			if v > 0 {
				return strconv.Itoa(v)
			}
		case int64:
			if v > 0 {
				return strconv.FormatInt(v, 10)
			}
		}
	}
	return ""
}

func firstPositiveFloat(values ...any) float64 {
	for _, value := range values {
		number, ok := parseAnyFloat(value)
		if ok && number > 0 {
			return number
		}
	}
	return 0
}

func parseAnyFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		return parseFloat(v)
	default:
		return 0, false
	}
}

func parseFloat(text string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	return value, err == nil
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func envBool(key string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return value == "1" || value == "true" || value == "yes" || value == "on"
}

func envFloat(key string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func safeID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "order"
	}
	return out
}

func round(value float64, places int) float64 {
	factor := math.Pow(10, float64(places))
	return math.Round(value*factor) / factor
}
