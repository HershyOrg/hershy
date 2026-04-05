package cex

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/HershyOrg/hershy/cctx/models"
)

const realOrderConfirmationPhrase = "I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER"

func TestMain(m *testing.M) {
	loadEnvForBinanceTests()
	os.Exit(m.Run())
}

func TestFetchMarketBuildsSpotMarket(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/exchangeInfo":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"symbols": []map[string]any{{
					"symbol":     "BTCUSDT",
					"status":     "TRADING",
					"baseAsset":  "BTC",
					"quoteAsset": "USDT",
					"filters": []map[string]any{
						{"filterType": "PRICE_FILTER", "tickSize": "0.10"},
						{"filterType": "LOT_SIZE", "stepSize": "0.00001000"},
					},
				}},
			})
		case "/api/v3/ticker/bookTicker":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"symbol":   "BTCUSDT",
				"bidPrice": "65000.1",
				"bidQty":   "2.5",
				"askPrice": "65000.3",
				"askQty":   "3.0",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewBinance(map[string]any{"base_url": server.URL})
	if err != nil {
		t.Fatalf("NewBinance error: %v", err)
	}

	ex, ok := raw.(*Binance)
	if !ok {
		t.Fatalf("expected *Binance, got %T", raw)
	}

	market, err := ex.FetchMarket("BTCUSDT")
	if err != nil {
		t.Fatalf("FetchMarket error: %v", err)
	}

	if market.ID != "BTCUSDT" {
		t.Fatalf("unexpected market ID: %s", market.ID)
	}
	if got := market.Metadata["market_type"]; got != "spot" {
		t.Fatalf("unexpected market type: %#v", got)
	}
	if len(market.Outcomes) != 1 || market.Outcomes[0] != "BTC" {
		t.Fatalf("unexpected outcomes: %#v", market.Outcomes)
	}
	if market.TickSize != 0.1 {
		t.Fatalf("unexpected tick size: %v", market.TickSize)
	}
	if market.Prices["BTC"] <= 65000.1 || market.Prices["BTC"] >= 65000.3 {
		t.Fatalf("expected mid price between bid and ask, got %v", market.Prices["BTC"])
	}
}

func TestCreateOrderSignsBodyAndParsesResponse(t *testing.T) {
	var seenBody url.Values
	var seenAPIKey string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/exchangeInfo":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"symbols": []map[string]any{{
					"symbol":     "BTCUSDT",
					"status":     "TRADING",
					"baseAsset":  "BTC",
					"quoteAsset": "USDT",
					"filters":    []map[string]any{},
				}},
			})
		case "/api/v3/order":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST, got %s", r.Method)
			}
			payload := mustReadBody(t, r)
			values, err := url.ParseQuery(payload)
			if err != nil {
				t.Fatalf("ParseQuery error: %v", err)
			}
			seenBody = values
			seenAPIKey = r.Header.Get("X-MBX-APIKEY")

			signature := values.Get("signature")
			values.Del("signature")
			expectedSig := buildHMACSHA256Hex("test-secret", values.Encode())
			if signature != expectedSig {
				t.Fatalf("unexpected signature: got %s want %s", signature, expectedSig)
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"symbol":        "BTCUSDT",
				"orderId":       4242,
				"clientOrderId": "runner-order",
				"price":         "0.00000000",
				"origQty":       "0.00000000",
				"executedQty":   "0.00000000",
				"status":        "NEW",
				"side":          "BUY",
				"time":          float64(1710000000000),
				"updateTime":    float64(1710000001000),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewBinance(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewBinance error: %v", err)
	}

	ex := raw.(*Binance)
	order, err := ex.CreateOrder("BTCUSDT", "", models.OrderSideBuy, 0, 0, map[string]any{
		"type":          "MARKET",
		"quoteOrderQty": 25.0,
	})
	if err != nil {
		t.Fatalf("CreateOrder error: %v", err)
	}

	if seenAPIKey != "test-key" {
		t.Fatalf("unexpected api key header: %s", seenAPIKey)
	}
	if got := seenBody.Get("symbol"); got != "BTCUSDT" {
		t.Fatalf("unexpected symbol: %s", got)
	}
	if got := seenBody.Get("quoteOrderQty"); got != "25" {
		t.Fatalf("unexpected quoteOrderQty: %s", got)
	}
	if seenBody.Get("timestamp") == "" {
		t.Fatalf("expected timestamp in signed body")
	}
	if seenBody.Get("recvWindow") == "" {
		t.Fatalf("expected recvWindow in signed body")
	}

	if order.ID != "4242" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.MarketID != "BTCUSDT" {
		t.Fatalf("unexpected market id: %s", order.MarketID)
	}
	if order.Side != models.OrderSideBuy {
		t.Fatalf("unexpected side: %s", order.Side)
	}
	if order.Status != models.OrderStatusOpen {
		t.Fatalf("unexpected status: %s", order.Status)
	}
	if order.Outcome != "BTC" {
		t.Fatalf("unexpected outcome: %s", order.Outcome)
	}
}

func TestStringFromAnyFormatsWholeFloatIDsWithoutExponent(t *testing.T) {
	got := stringFromAny(float64(45506619600))
	if got != "45506619600" {
		t.Fatalf("unexpected string value: %s", got)
	}
}

func mustReadBody(t *testing.T, r *http.Request) string {
	t.Helper()
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("ReadFrom error: %v", err)
	}
	return string(payload)
}

func TestLiveFetchMarketFromBinance(t *testing.T) {
	if os.Getenv("BINANCE_LIVE") != "1" {
		t.Skip("set BINANCE_LIVE=1 to run live Binance public API test")
	}

	symbol := envOrDefault("BINANCE_SYMBOL", "BTCUSDT")
	raw, err := NewBinance(nil)
	if err != nil {
		t.Fatalf("NewBinance error: %v", err)
	}

	ex := raw.(*Binance)
	market, err := ex.FetchMarket(symbol)
	if err != nil {
		t.Fatalf("FetchMarket live error: %v", err)
	}

	if market.ID != symbol {
		t.Fatalf("unexpected market ID: got=%s want=%s", market.ID, symbol)
	}
	if market.Metadata["market_type"] != "spot" {
		t.Fatalf("unexpected market type: %#v", market.Metadata["market_type"])
	}
	if len(market.Outcomes) != 1 {
		t.Fatalf("expected one outcome, got %#v", market.Outcomes)
	}
	if market.Prices[market.Outcomes[0]] <= 0 {
		t.Fatalf("expected positive price, got %#v", market.Prices)
	}
}

func TestLiveSignedTestOrderAgainstBinance(t *testing.T) {
	if os.Getenv("BINANCE_LIVE_SIGNED") != "1" {
		t.Skip("set BINANCE_LIVE_SIGNED=1 to run live Binance signed test-order API test")
	}

	apiKey := strings.TrimSpace(os.Getenv("BINANCE_API_KEY"))
	apiSecret := strings.TrimSpace(os.Getenv("BINANCE_API_SECRET"))
	if apiKey == "" || apiSecret == "" {
		t.Skip("BINANCE_API_KEY and BINANCE_API_SECRET are required for signed live test")
	}

	symbol := envOrDefault("BINANCE_SYMBOL", "BTCUSDT")
	raw, err := NewBinance(map[string]any{
		"api_key":    apiKey,
		"api_secret": apiSecret,
	})
	if err != nil {
		t.Fatalf("NewBinance error: %v", err)
	}

	side := envOrderSideOrDefault("BINANCE_TEST_SIDE", models.OrderSideBuy)
	size := envFloatOrDefault("BINANCE_TEST_QTY", 0)
	params := map[string]any{
		"type": "MARKET",
		"test": true,
	}
	if size > 0 {
		params["quantity"] = size
	} else if quoteOrderQty := envFloatOrDefault("BINANCE_TEST_QUOTE_ORDER_QTY", 0); quoteOrderQty > 0 {
		params["quoteOrderQty"] = quoteOrderQty
	}

	ex := raw.(*Binance)
	order, err := ex.CreateOrder(symbol, "", side, 0, size, params)
	if err != nil {
		t.Fatalf("CreateOrder live test-order error: %v", err)
	}

	if order.ID != "test-order" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.MarketID != symbol {
		t.Fatalf("unexpected market id: got=%s want=%s", order.MarketID, symbol)
	}
	if order.Side != side {
		t.Fatalf("unexpected side: %s", order.Side)
	}
}

func TestLivePlaceRealOrderAgainstBinance(t *testing.T) {
	if os.Getenv("BINANCE_LIVE_EXECUTE") != "1" {
		t.Skip("set BINANCE_LIVE_EXECUTE=1 to run a real Binance order")
	}

	if strings.TrimSpace(os.Getenv("BINANCE_REAL_ORDER_CONFIRM")) != realOrderConfirmationPhrase {
		t.Skip(fmt.Sprintf("set BINANCE_REAL_ORDER_CONFIRM=%s to acknowledge that this places a real order", realOrderConfirmationPhrase))
	}

	apiKey := strings.TrimSpace(os.Getenv("BINANCE_API_KEY"))
	apiSecret := strings.TrimSpace(os.Getenv("BINANCE_API_SECRET"))
	if apiKey == "" || apiSecret == "" {
		t.Skip("BINANCE_API_KEY and BINANCE_API_SECRET are required for real live order test")
	}

	symbol := envOrDefault("BINANCE_REAL_SYMBOL", "ETHUSDT")
	side := envOrderSideOrDefault("BINANCE_REAL_SIDE", models.OrderSideSell)
	size := envFloatOrDefault("BINANCE_REAL_QTY", 0.0027)
	if size <= 0 {
		t.Fatalf("BINANCE_REAL_QTY must be greater than zero")
	}

	raw, err := NewBinance(map[string]any{
		"api_key":    apiKey,
		"api_secret": apiSecret,
	})
	if err != nil {
		t.Fatalf("NewBinance error: %v", err)
	}

	ex := raw.(*Binance)
	order, err := ex.CreateOrder(symbol, "", side, 0, size, map[string]any{
		"type": "MARKET",
	})
	if err != nil {
		t.Fatalf("CreateOrder live real-order error: %v", err)
	}

	if strings.TrimSpace(order.ID) == "" {
		t.Fatalf("expected non-empty real order id")
	}
	if order.MarketID != symbol {
		t.Fatalf("unexpected market id: got=%s want=%s", order.MarketID, symbol)
	}
	if order.Side != side {
		t.Fatalf("unexpected side: %s", order.Side)
	}
	if order.Status == models.OrderStatusRejected || order.Status == models.OrderStatusCancelled {
		t.Fatalf("unexpected terminal failure status: %s", order.Status)
	}

	t.Logf("real order submitted: id=%s market=%s side=%s size=%.8f filled=%.8f status=%s", order.ID, order.MarketID, order.Side, order.Size, order.Filled, order.Status)
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envFloatOrDefault(key string, fallback float64) float64 {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := strconv.ParseFloat(value, 64); err == nil {
			return parsed
		}
	}
	return fallback
}

func envOrderSideOrDefault(key string, fallback models.OrderSide) models.OrderSide {
	switch strings.ToUpper(strings.TrimSpace(os.Getenv(key))) {
	case "BUY":
		return models.OrderSideBuy
	case "SELL":
		return models.OrderSideSell
	default:
		return fallback
	}
}

func loadEnvForBinanceTests() {
	for _, path := range candidateEnvPaths() {
		loadEnvFile(path)
	}
}

func candidateEnvPaths() []string {
	cwd, err := os.Getwd()
	if err != nil {
		return []string{
			filepath.Join("..", ".env"),
			filepath.Join("..", "..", ".env"),
			".env",
		}
	}

	return []string{
		filepath.Join(cwd, ".env"),
		filepath.Join(cwd, "..", ".env"),
		filepath.Join(cwd, "..", "..", ".env"),
	}
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}

		key = strings.TrimSpace(key)
		if key == "" || os.Getenv(key) != "" {
			continue
		}

		value = strings.Trim(strings.TrimSpace(value), `"'`)
		_ = os.Setenv(key, value)
	}
}
