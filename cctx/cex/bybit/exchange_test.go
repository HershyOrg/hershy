package bybit

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/models"
)

func TestBybitFetchMarketBuildsSpotMarket(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v5/market/instruments-info":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{{
						"symbol":    "BTCUSDT",
						"status":    "Trading",
						"baseCoin":  "BTC",
						"quoteCoin": "USDT",
						"priceFilter": map[string]any{
							"tickSize": "0.10",
						},
						"lotSizeFilter": map[string]any{
							"basePrecision": "0.000001",
							"minOrderQty":   "0.00001",
							"minOrderAmt":   "5",
						},
					}},
				},
				"time": time.Now().UnixMilli(),
			})
		case "/v5/market/tickers":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{{
						"symbol":    "BTCUSDT",
						"bid1Price": "65000.1",
						"bid1Size":  "2.5",
						"ask1Price": "65000.3",
						"ask1Size":  "3.0",
						"lastPrice": "65000.2",
					}},
				},
				"time": time.Now().UnixMilli(),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewBybit(map[string]any{"base_url": server.URL})
	if err != nil {
		t.Fatalf("NewBybit error: %v", err)
	}

	ex, ok := raw.(*Bybit)
	if !ok {
		t.Fatalf("expected *Bybit, got %T", raw)
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

func TestBybitCreateOrderSignsJSONAndFetchesOrder(t *testing.T) {
	var seenBody map[string]any
	var seenHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v5/market/time":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"timeSecond": stringFromAny(time.Now().Unix()),
					"timeNano":   stringFromAny(time.Now().UnixNano()),
				},
				"time": time.Now().UnixMilli(),
			})
		case "/v5/order/create":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST, got %s", r.Method)
			}
			payload := mustReadBody(t, r)
			if err := json.Unmarshal([]byte(payload), &seenBody); err != nil {
				t.Fatalf("json.Unmarshal error: %v", err)
			}
			seenHeaders = r.Header.Clone()

			timestamp := r.Header.Get("X-BAPI-TIMESTAMP")
			recvWindow := r.Header.Get("X-BAPI-RECV-WINDOW")
			signature := r.Header.Get("X-BAPI-SIGN")
			expectedSig := buildHMACSHA256Hex("test-secret", timestamp+"test-key"+recvWindow+payload)
			if signature != expectedSig {
				t.Fatalf("unexpected signature: got %s want %s", signature, expectedSig)
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"orderId": "order-4242",
				},
				"time": time.Now().UnixMilli(),
			})
		case "/v5/order/realtime":
			if r.URL.Query().Get("symbol") != "BTCUSDT" {
				t.Fatalf("unexpected symbol: %s", r.URL.Query().Get("symbol"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{{
						"symbol":      "BTCUSDT",
						"orderId":     "order-4242",
						"side":        "Buy",
						"orderStatus": "New",
						"qty":         "0.01",
						"cumExecQty":  "0",
						"price":       "0",
						"createdTime": stringFromAny(time.UnixMilli(1710000000000).UnixMilli()),
						"updatedTime": stringFromAny(time.UnixMilli(1710000001000).UnixMilli()),
					}},
				},
				"time": time.Now().UnixMilli(),
			})
		case "/v5/market/instruments-info":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{{
						"symbol":    "BTCUSDT",
						"status":    "Trading",
						"baseCoin":  "BTC",
						"quoteCoin": "USDT",
						"priceFilter": map[string]any{
							"tickSize": "0.10",
						},
						"lotSizeFilter": map[string]any{
							"basePrecision": "0.000001",
							"minOrderQty":   "0.00001",
							"minOrderAmt":   "5",
						},
					}},
				},
				"time": time.Now().UnixMilli(),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewBybit(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewBybit error: %v", err)
	}

	ex := raw.(*Bybit)
	order, err := ex.CreateOrder("BTCUSDT", "", models.OrderSideBuy, 0, 0.01, map[string]any{
		"type": "MARKET",
	})
	if err != nil {
		t.Fatalf("CreateOrder error: %v", err)
	}

	if seenHeaders.Get("X-BAPI-API-KEY") != "test-key" {
		t.Fatalf("unexpected api key header: %s", seenHeaders.Get("X-BAPI-API-KEY"))
	}
	if seenHeaders.Get("X-BAPI-SIGN-TYPE") != "2" {
		t.Fatalf("unexpected sign type: %s", seenHeaders.Get("X-BAPI-SIGN-TYPE"))
	}
	if got := stringFromAny(seenBody["symbol"]); got != "BTCUSDT" {
		t.Fatalf("unexpected symbol: %s", got)
	}
	if got := stringFromAny(seenBody["marketUnit"]); got != "baseCoin" {
		t.Fatalf("unexpected marketUnit: %s", got)
	}
	if got := stringFromAny(seenBody["qty"]); got != "0.01" {
		t.Fatalf("unexpected qty: %s", got)
	}

	if order.ID != "order-4242" {
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

func TestBybitFetchOrderHistoryForSymbol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v5/market/time":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result":  map[string]any{},
				"time":    time.Now().UnixMilli(),
			})
		case "/v5/order/history":
			if got := r.URL.Query().Get("symbol"); got != "ETHUSDT" {
				t.Fatalf("unexpected symbol: %s", got)
			}
			if got := r.URL.Query().Get("limit"); got != "2" {
				t.Fatalf("unexpected limit: %s", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{
						{
							"symbol":      "ETHUSDT",
							"orderId":     "102",
							"side":        "Buy",
							"orderStatus": "Filled",
							"qty":         "0.003",
							"cumExecQty":  "0.003",
							"price":       "3500.0",
							"createdTime": "2000",
							"updatedTime": "2001",
						},
						{
							"symbol":      "ETHUSDT",
							"orderId":     "101",
							"side":        "Sell",
							"orderStatus": "New",
							"qty":         "0.002",
							"cumExecQty":  "0.000",
							"price":       "3400.0",
							"createdTime": "1000",
							"updatedTime": "1001",
						},
					},
				},
				"time": time.Now().UnixMilli(),
			})
		case "/v5/market/instruments-info":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{{
						"symbol":    "ETHUSDT",
						"status":    "Trading",
						"baseCoin":  "ETH",
						"quoteCoin": "USDT",
						"priceFilter": map[string]any{
							"tickSize": "0.01",
						},
						"lotSizeFilter": map[string]any{
							"basePrecision": "0.0001",
							"minOrderQty":   "0.0001",
							"minOrderAmt":   "5",
						},
					}},
				},
				"time": time.Now().UnixMilli(),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewBybit(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewBybit error: %v", err)
	}

	ex := raw.(*Bybit)
	marketID := "ETHUSDT"
	orders, err := ex.FetchOrderHistory(&marketID, map[string]any{"limit": 2})
	if err != nil {
		t.Fatalf("FetchOrderHistory error: %v", err)
	}
	if len(orders) != 2 {
		t.Fatalf("expected 2 orders, got %d", len(orders))
	}
	if orders[0].ID != "102" || orders[1].ID != "101" {
		t.Fatalf("unexpected order sort/order ids: %#v", orders)
	}
}

func TestBybitSignedQueryUsesExpectedSignature(t *testing.T) {
	var seenHeaders http.Header
	var seenQuery url.Values
	serverTime := time.Now().Add(90 * time.Second).UnixMilli()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v5/market/time":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result":  map[string]any{},
				"time":    serverTime,
			})
		case "/v5/order/history":
			seenHeaders = r.Header.Clone()
			seenQuery = r.URL.Query()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"retCode": 0,
				"retMsg":  "OK",
				"result": map[string]any{
					"list": []map[string]any{},
				},
				"time": time.Now().UnixMilli(),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewBybit(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewBybit error: %v", err)
	}

	ex := raw.(*Bybit)
	marketID := "ETHUSDT"
	_, err = ex.FetchOrderHistory(&marketID, map[string]any{"limit": 2})
	if err != nil {
		t.Fatalf("FetchOrderHistory error: %v", err)
	}

	tsRaw := strings.TrimSpace(seenHeaders.Get("X-BAPI-TIMESTAMP"))
	if tsRaw == "" {
		t.Fatalf("expected X-BAPI-TIMESTAMP header")
	}
	ts, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		t.Fatalf("parse timestamp: %v", err)
	}
	if diff := ts - serverTime; diff < -2000 || diff > 2000 {
		t.Fatalf("expected signed timestamp near server time: got=%d server=%d diff=%d", ts, serverTime, diff)
	}

	query := url.Values{}
	for key, values := range seenQuery {
		copied := make([]string, len(values))
		copy(copied, values)
		query[key] = copied
	}
	expectedSig := buildHMACSHA256Hex(
		"test-secret",
		seenHeaders.Get("X-BAPI-TIMESTAMP")+"test-key"+seenHeaders.Get("X-BAPI-RECV-WINDOW")+query.Encode(),
	)
	if seenHeaders.Get("X-BAPI-SIGN") != expectedSig {
		t.Fatalf("unexpected query signature: got=%s want=%s", seenHeaders.Get("X-BAPI-SIGN"), expectedSig)
	}
	if !strings.EqualFold(seenHeaders.Get("X-BAPI-SIGN-TYPE"), "2") {
		t.Fatalf("unexpected sign type: %s", seenHeaders.Get("X-BAPI-SIGN-TYPE"))
	}
}

func mustReadBody(t *testing.T, r *http.Request) string {
	t.Helper()
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("ReadAll error: %v", err)
	}
	return string(payload)
}
