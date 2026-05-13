package gateio

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

func TestGateIOFetchMarketBuildsSpotMarket(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v4/spot/currency_pairs/BTC_USDT":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":               "BTC_USDT",
				"base":             "BTC",
				"quote":            "USDT",
				"amount_precision": 6,
				"precision":        2,
				"min_base_amount":  "0.0001",
				"min_quote_amount": "5",
				"trade_status":     "tradable",
			})
		case "/api/v4/spot/tickers":
			if got := r.URL.Query().Get("currency_pair"); got != "BTC_USDT" {
				t.Fatalf("unexpected currency_pair: %s", got)
			}
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"currency_pair": "BTC_USDT",
				"highest_bid":   "65000.1",
				"lowest_ask":    "65000.3",
				"last":          "65000.2",
				"base_volume":   "12.5",
				"quote_volume":  "812500.0",
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewGateIO(map[string]any{"base_url": server.URL})
	if err != nil {
		t.Fatalf("NewGateIO error: %v", err)
	}

	ex, ok := raw.(*GateIO)
	if !ok {
		t.Fatalf("expected *GateIO, got %T", raw)
	}

	market, err := ex.FetchMarket("BTC_USDT")
	if err != nil {
		t.Fatalf("FetchMarket error: %v", err)
	}
	if market.ID != "BTC_USDT" {
		t.Fatalf("unexpected market ID: %s", market.ID)
	}
	if got := market.Metadata["market_type"]; got != "spot" {
		t.Fatalf("unexpected market type: %#v", got)
	}
	if len(market.Outcomes) != 1 || market.Outcomes[0] != "BTC" {
		t.Fatalf("unexpected outcomes: %#v", market.Outcomes)
	}
	if market.TickSize != 0.01 {
		t.Fatalf("unexpected tick size: %v", market.TickSize)
	}
	if market.Prices["BTC"] <= 65000.1 || market.Prices["BTC"] >= 65000.3 {
		t.Fatalf("expected mid price between bid and ask, got %v", market.Prices["BTC"])
	}
}

func TestGateIOCreateOrderSignsJSONAndFetchesOrder(t *testing.T) {
	var seenBody map[string]any
	var seenHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v4/spot/orders":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST, got %s", r.Method)
			}
			payload := mustReadBody(t, r)
			if err := json.Unmarshal([]byte(payload), &seenBody); err != nil {
				t.Fatalf("json.Unmarshal error: %v", err)
			}
			seenHeaders = r.Header.Clone()

			query := r.URL.RawQuery
			expectedSig := buildHMACSHA512Hex("test-secret", "POST\n"+"/api/v4/spot/orders"+"\n"+query+"\n"+sha512Hex(payload)+"\n"+r.Header.Get("Timestamp"))
			if r.Header.Get("SIGN") != expectedSig {
				t.Fatalf("unexpected signature: got=%s want=%s", r.Header.Get("SIGN"), expectedSig)
			}

			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":            "gate-order-4242",
				"currency_pair": "BTC_USDT",
				"status":        "open",
				"type":          "market",
				"account":       "spot",
				"side":          "buy",
				"amount":        "50",
				"price":         "0",
				"left":          "50",
				"filled_amount": "0",
				"create_time":   "1710000000",
				"update_time":   "1710000001",
			})
		case "/api/v4/spot/orders/gate-order-4242":
			if r.Method != http.MethodGet {
				t.Fatalf("expected GET, got %s", r.Method)
			}
			if got := r.URL.Query().Get("currency_pair"); got != "BTC_USDT" {
				t.Fatalf("unexpected currency_pair: %s", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":             "gate-order-4242",
				"currency_pair":  "BTC_USDT",
				"status":         "closed",
				"finish_as":      "filled",
				"type":           "market",
				"account":        "spot",
				"side":           "buy",
				"amount":         "50",
				"left":           "0",
				"filled_amount":  "0.00076923",
				"filled_total":   "50",
				"avg_deal_price": "65000",
				"create_time":    "1710000000",
				"update_time":    "1710000002",
			})
		case "/api/v4/spot/currency_pairs/BTC_USDT":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":               "BTC_USDT",
				"base":             "BTC",
				"quote":            "USDT",
				"amount_precision": 6,
				"precision":        2,
				"min_base_amount":  "0.0001",
				"min_quote_amount": "5",
				"trade_status":     "tradable",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewGateIO(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewGateIO error: %v", err)
	}

	ex := raw.(*GateIO)
	order, err := ex.CreateOrder("BTC_USDT", "", models.OrderSideBuy, 0, 0, map[string]any{
		"type":            "market",
		"quote_order_qty": 50,
	})
	if err != nil {
		t.Fatalf("CreateOrder error: %v", err)
	}

	if seenHeaders.Get("KEY") != "test-key" {
		t.Fatalf("unexpected api key header: %s", seenHeaders.Get("KEY"))
	}
	if seenHeaders.Get("Timestamp") == "" {
		t.Fatalf("expected Timestamp header")
	}
	if got := stringFromAny(seenBody["currency_pair"]); got != "BTC_USDT" {
		t.Fatalf("unexpected currency_pair: %s", got)
	}
	if got := stringFromAny(seenBody["amount"]); got != "50" {
		t.Fatalf("unexpected amount: %s", got)
	}
	if order.ID != "gate-order-4242" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.MarketID != "BTC_USDT" {
		t.Fatalf("unexpected market id: %s", order.MarketID)
	}
	if order.Side != models.OrderSideBuy {
		t.Fatalf("unexpected side: %s", order.Side)
	}
	if order.Status != models.OrderStatusFilled {
		t.Fatalf("unexpected status: %s", order.Status)
	}
}

func TestGateIOFetchOrderHistoryForSymbol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v4/spot/orders":
			if got := r.URL.Query().Get("currency_pair"); got != "ETH_USDT" {
				t.Fatalf("unexpected currency_pair: %s", got)
			}
			if got := r.URL.Query().Get("status"); got != "finished" {
				t.Fatalf("unexpected status: %s", got)
			}
			if got := r.URL.Query().Get("limit"); got != "2" {
				t.Fatalf("unexpected limit: %s", got)
			}
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{
					"id":             "102",
					"currency_pair":  "ETH_USDT",
					"status":         "closed",
					"finish_as":      "filled",
					"side":           "buy",
					"amount":         "0.003",
					"filled_amount":  "0.003",
					"avg_deal_price": "3500",
					"create_time":    "2000",
					"update_time":    "2001",
				},
				{
					"id":             "101",
					"currency_pair":  "ETH_USDT",
					"status":         "cancelled",
					"side":           "sell",
					"amount":         "0.002",
					"filled_amount":  "0",
					"avg_deal_price": "3400",
					"create_time":    "1000",
					"update_time":    "1001",
				},
			})
		case "/api/v4/spot/currency_pairs/ETH_USDT":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":               "ETH_USDT",
				"base":             "ETH",
				"quote":            "USDT",
				"amount_precision": 4,
				"precision":        2,
				"min_base_amount":  "0.0001",
				"min_quote_amount": "5",
				"trade_status":     "tradable",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewGateIO(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewGateIO error: %v", err)
	}

	ex := raw.(*GateIO)
	marketID := "ETH_USDT"
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

func TestGateIOSignedQueryUsesExpectedSignature(t *testing.T) {
	var seenHeaders http.Header
	var seenQuery url.Values

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v4/spot/open_orders":
			seenHeaders = r.Header.Clone()
			seenQuery = r.URL.Query()
			_ = json.NewEncoder(w).Encode([]map[string]any{})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	raw, err := NewGateIO(map[string]any{
		"base_url":   server.URL,
		"api_key":    "test-key",
		"api_secret": "test-secret",
	})
	if err != nil {
		t.Fatalf("NewGateIO error: %v", err)
	}

	ex := raw.(*GateIO)
	_, err = ex.FetchOpenOrders(nil, map[string]any{"limit": 2, "page": 3})
	if err != nil {
		t.Fatalf("FetchOpenOrders error: %v", err)
	}

	tsRaw := strings.TrimSpace(seenHeaders.Get("Timestamp"))
	if tsRaw == "" {
		t.Fatalf("expected Timestamp header")
	}

	query := url.Values{}
	for key, values := range seenQuery {
		copied := make([]string, len(values))
		copy(copied, values)
		query[key] = copied
	}
	queryString := query.Encode()
	expectedSig := buildHMACSHA512Hex("test-secret", "GET\n"+"/api/v4/spot/open_orders"+"\n"+queryString+"\n"+gateEmptyBodySHA512Hex+"\n"+tsRaw)
	if seenHeaders.Get("SIGN") != expectedSig {
		t.Fatalf("unexpected query signature: got=%s want=%s", seenHeaders.Get("SIGN"), expectedSig)
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
