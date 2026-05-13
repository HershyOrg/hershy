package okx

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/HershyOrg/hershy/cctx/models"
)

func TestOKXFetchMarketBuildsSpotMarket(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v5/public/instruments":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{{
					"instId":   "BTC-USDT",
					"state":    "live",
					"baseCcy":  "BTC",
					"quoteCcy": "USDT",
					"tickSz":   "0.10",
					"lotSz":    "0.00000001",
					"minSz":    "0.00001",
				}},
			})
		case "/api/v5/market/ticker":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{{
					"instId": "BTC-USDT",
					"bidPx":  "65000.1",
					"bidSz":  "2.5",
					"askPx":  "65000.3",
					"askSz":  "3.0",
					"last":   "65000.2",
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewOKX(map[string]any{"base_url": server.URL})
	if err != nil {
		t.Fatalf("NewOKX error: %v", err)
	}

	ex, ok := raw.(*OKX)
	if !ok {
		t.Fatalf("expected *OKX, got %T", raw)
	}

	market, err := ex.FetchMarket("BTC-USDT")
	if err != nil {
		t.Fatalf("FetchMarket error: %v", err)
	}
	if market.ID != "BTC-USDT" {
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

func TestOKXCreateOrderSignsJSONAndFetchesOrder(t *testing.T) {
	var seenBody map[string]any
	var seenHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v5/trade/order":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code": "0",
					"msg":  "",
					"data": []map[string]any{{
						"instId":    "BTC-USDT",
						"ordId":     "okx-order-4242",
						"side":      "buy",
						"state":     "live",
						"sz":        "0.01",
						"accFillSz": "0",
						"px":        "0",
						"cTime":     "1710000000000",
						"uTime":     "1710000001000",
					}},
				})
				return
			}
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST, got %s", r.Method)
			}

			payload := mustReadBody(t, r)
			if err := json.Unmarshal([]byte(payload), &seenBody); err != nil {
				t.Fatalf("json.Unmarshal error: %v", err)
			}
			seenHeaders = r.Header.Clone()

			timestamp := r.Header.Get("OK-ACCESS-TIMESTAMP")
			expectedSig := buildHMACSHA256Base64("test-secret", timestamp+"POST"+"/api/v5/trade/order"+payload)
			if r.Header.Get("OK-ACCESS-SIGN") != expectedSig {
				t.Fatalf("unexpected signature: got=%s want=%s", r.Header.Get("OK-ACCESS-SIGN"), expectedSig)
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{{
					"ordId": "okx-order-4242",
					"sCode": "0",
					"sMsg":  "",
				}},
			})
		case "/api/v5/public/instruments":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{{
					"instId":   "BTC-USDT",
					"state":    "live",
					"baseCcy":  "BTC",
					"quoteCcy": "USDT",
					"tickSz":   "0.10",
					"lotSz":    "0.00000001",
					"minSz":    "0.00001",
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewOKX(map[string]any{
		"base_url":       server.URL,
		"api_key":        "test-key",
		"api_secret":     "test-secret",
		"api_passphrase": "test-passphrase",
		"simulated":      true,
	})
	if err != nil {
		t.Fatalf("NewOKX error: %v", err)
	}

	ex := raw.(*OKX)
	order, err := ex.CreateOrder("BTC-USDT", "", models.OrderSideBuy, 0, 0.01, map[string]any{
		"type": "market",
	})
	if err != nil {
		t.Fatalf("CreateOrder error: %v", err)
	}

	if seenHeaders.Get("OK-ACCESS-KEY") != "test-key" {
		t.Fatalf("unexpected api key header: %s", seenHeaders.Get("OK-ACCESS-KEY"))
	}
	if seenHeaders.Get("OK-ACCESS-PASSPHRASE") != "test-passphrase" {
		t.Fatalf("unexpected passphrase header: %s", seenHeaders.Get("OK-ACCESS-PASSPHRASE"))
	}
	if seenHeaders.Get("x-simulated-trading") != "1" {
		t.Fatalf("unexpected simulated header: %s", seenHeaders.Get("x-simulated-trading"))
	}
	if got := stringFromAny(seenBody["instId"]); got != "BTC-USDT" {
		t.Fatalf("unexpected instId: %s", got)
	}
	if got := stringFromAny(seenBody["tgtCcy"]); got != "base_ccy" {
		t.Fatalf("unexpected tgtCcy: %s", got)
	}
	if got := stringFromAny(seenBody["sz"]); got != "0.01" {
		t.Fatalf("unexpected size: %s", got)
	}
	if order.ID != "okx-order-4242" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.MarketID != "BTC-USDT" {
		t.Fatalf("unexpected market id: %s", order.MarketID)
	}
	if order.Side != models.OrderSideBuy {
		t.Fatalf("unexpected side: %s", order.Side)
	}
	if order.Status != models.OrderStatusOpen {
		t.Fatalf("unexpected status: %s", order.Status)
	}
}

func TestOKXFetchOrderHistoryForSymbol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v5/trade/orders-history-archive":
			if got := r.URL.Query().Get("instId"); got != "ETH-USDT" {
				t.Fatalf("unexpected instId: %s", got)
			}
			if got := r.URL.Query().Get("instType"); got != "SPOT" {
				t.Fatalf("unexpected instType: %s", got)
			}
			if got := r.URL.Query().Get("limit"); got != "2" {
				t.Fatalf("unexpected limit: %s", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{
					{
						"instId":    "ETH-USDT",
						"ordId":     "102",
						"side":      "buy",
						"state":     "filled",
						"sz":        "0.003",
						"accFillSz": "0.003",
						"px":        "3500.0",
						"cTime":     "2000",
						"uTime":     "2001",
					},
					{
						"instId":    "ETH-USDT",
						"ordId":     "101",
						"side":      "sell",
						"state":     "live",
						"sz":        "0.002",
						"accFillSz": "0",
						"px":        "3400.0",
						"cTime":     "1000",
						"uTime":     "1001",
					},
				},
			})
		case "/api/v5/public/instruments":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{{
					"instId":   "ETH-USDT",
					"state":    "live",
					"baseCcy":  "ETH",
					"quoteCcy": "USDT",
					"tickSz":   "0.01",
					"lotSz":    "0.0001",
					"minSz":    "0.0001",
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewOKX(map[string]any{
		"base_url":       server.URL,
		"api_key":        "test-key",
		"api_secret":     "test-secret",
		"api_passphrase": "test-passphrase",
	})
	if err != nil {
		t.Fatalf("NewOKX error: %v", err)
	}

	ex := raw.(*OKX)
	marketID := "ETH-USDT"
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

func TestOKXSignedQueryUsesExpectedSignature(t *testing.T) {
	var seenHeaders http.Header
	var seenQuery url.Values

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v5/trade/orders-pending":
			seenHeaders = r.Header.Clone()
			seenQuery = r.URL.Query()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "0",
				"msg":  "",
				"data": []map[string]any{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewOKX(map[string]any{
		"base_url":       server.URL,
		"api_key":        "test-key",
		"api_secret":     "test-secret",
		"api_passphrase": "test-passphrase",
	})
	if err != nil {
		t.Fatalf("NewOKX error: %v", err)
	}

	ex := raw.(*OKX)
	marketID := "ETH-USDT"
	_, err = ex.FetchOpenOrders(&marketID, map[string]any{"limit": 2})
	if err != nil {
		t.Fatalf("FetchOpenOrders error: %v", err)
	}

	tsRaw := strings.TrimSpace(seenHeaders.Get("OK-ACCESS-TIMESTAMP"))
	if tsRaw == "" {
		t.Fatalf("expected OK-ACCESS-TIMESTAMP header")
	}

	query := url.Values{}
	for key, values := range seenQuery {
		copied := make([]string, len(values))
		copy(copied, values)
		query[key] = copied
	}
	requestPath := "/api/v5/trade/orders-pending?" + query.Encode()
	expectedSig := buildHMACSHA256Base64("test-secret", tsRaw+"GET"+requestPath)
	if seenHeaders.Get("OK-ACCESS-SIGN") != expectedSig {
		t.Fatalf("unexpected query signature: got=%s want=%s", seenHeaders.Get("OK-ACCESS-SIGN"), expectedSig)
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
