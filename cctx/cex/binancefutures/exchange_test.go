package binancefutures

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

func TestFetchMarketsAndRoundQuantity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/fapi/v1/exchangeInfo":
			_, _ = w.Write([]byte(`{
				"symbols": [{
					"symbol": "BTCUSDT",
					"pair": "BTCUSDT",
					"contractType": "PERPETUAL",
					"status": "TRADING",
					"baseAsset": "BTC",
					"quoteAsset": "USDT",
					"marginAsset": "USDT",
					"filters": [
						{"filterType": "PRICE_FILTER", "tickSize": "0.10"},
						{"filterType": "LOT_SIZE", "minQty": "0.001", "maxQty": "1000", "stepSize": "0.00100000"},
						{"filterType": "MIN_NOTIONAL", "notional": "5"}
					]
				}]
			}`))
		case "/fapi/v1/ticker/bookTicker":
			_, _ = w.Write([]byte(`{"symbol":"BTCUSDT","bidPrice":"100.00","bidQty":"2","askPrice":"102.00","askQty":"3"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	exchange, err := NewBinanceFutures(map[string]any{"base_url": server.URL})
	if err != nil {
		t.Fatalf("NewBinanceFutures: %v", err)
	}
	markets, err := exchange.FetchMarkets(map[string]any{"symbol": "BTCUSDT"})
	if err != nil {
		t.Fatalf("FetchMarkets: %v", err)
	}
	if len(markets) != 1 || markets[0].ID != "BTCUSDT" {
		t.Fatalf("unexpected markets: %#v", markets)
	}
	if got := markets[0].Prices["BTC"]; got != 101 {
		t.Fatalf("mid price = %v, want 101", got)
	}
	trader := exchange.(base.FuturesTrader)
	rounded, err := trader.RoundFuturesQuantity("BTCUSDT", "0.123456")
	if err != nil {
		t.Fatalf("RoundFuturesQuantity: %v", err)
	}
	if rounded != "0.123" {
		t.Fatalf("rounded = %s, want 0.123", rounded)
	}
}

func TestPlaceFuturesOrderSignsForm(t *testing.T) {
	const secret = "test-secret"
	var seenForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/fapi/v1/time":
			_, _ = w.Write([]byte(`{"serverTime": 1700000000000}`))
		case "/fapi/v1/order/test":
			if r.Header.Get("X-MBX-APIKEY") != "test-key" {
				t.Fatalf("missing api key header")
			}
			if err := r.ParseForm(); err != nil {
				t.Fatalf("ParseForm: %v", err)
			}
			seenForm = r.Form
			signature := seenForm.Get("signature")
			if signature == "" {
				t.Fatalf("missing signature")
			}
			unsigned := cloneValues(seenForm)
			unsigned.Del("signature")
			mac := hmac.New(sha256.New, []byte(secret))
			_, _ = mac.Write([]byte(unsigned.Encode()))
			if expected := hex.EncodeToString(mac.Sum(nil)); signature != expected {
				t.Fatalf("signature = %s, want %s", signature, expected)
			}
			_, _ = w.Write([]byte(`{}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	exchange, err := NewBinanceFutures(map[string]any{
		"api_key":     "test-key",
		"api_secret":  secret,
		"base_url":    server.URL,
		"recv_window": 5000,
	})
	if err != nil {
		t.Fatalf("NewBinanceFutures: %v", err)
	}
	trader := exchange.(base.FuturesTrader)
	order, err := trader.PlaceFuturesOrder(base.FuturesOrderRequest{
		Symbol:        "ethusdt",
		Side:          models.OrderSideSell,
		Type:          base.FuturesOrderTypeMarket,
		Quantity:      "0.01",
		ReduceOnly:    true,
		PositionSide:  base.FuturesPositionSideShort,
		ClientOrderID: "basis-test",
		Test:          true,
	})
	if err != nil {
		t.Fatalf("PlaceFuturesOrder: %v", err)
	}
	if order.ID != "test-order" || order.Symbol != "ETHUSDT" {
		t.Fatalf("unexpected test order: %#v", order)
	}
	assertFormValue(t, seenForm, "symbol", "ETHUSDT")
	assertFormValue(t, seenForm, "side", "SELL")
	assertFormValue(t, seenForm, "type", "MARKET")
	assertFormValue(t, seenForm, "quantity", "0.01")
	assertFormValue(t, seenForm, "reduceOnly", "true")
	assertFormValue(t, seenForm, "positionSide", "SHORT")
	assertFormValue(t, seenForm, "newClientOrderId", "basis-test")
}

func assertFormValue(t *testing.T, values url.Values, key string, want string) {
	t.Helper()
	if got := strings.TrimSpace(values.Get(key)); got != want {
		t.Fatalf("%s = %q, want %q; form=%s", key, got, want, fmt.Sprint(values))
	}
}
