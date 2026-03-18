package exchanges

import (
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"
)

const testPolymarketPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

func TestSignClobAuthMatchesPythonClient(t *testing.T) {
	client, err := newClobClient("https://clob.polymarket.com", 80002, testPolymarketPrivateKey, nil, "")
	if err != nil {
		t.Fatalf("newClobClient() error = %v", err)
	}

	sig, err := signClobAuth(client.privateKey, client.address.Hex(), 80002, 10000000, 23)
	if err != nil {
		t.Fatalf("signClobAuth() error = %v", err)
	}

	const want = "0xf62319a987514da40e57e2f4d7529f7bac38f0355bd88bb5adbb3768d80de6c1682518e0af677d5260366425f4361e7b70c25ae232aff0ab2331e2b164a1aedc1b"
	if sig != want {
		t.Fatalf("signClobAuth() = %s, want %s", sig, want)
	}
}

func TestBuildHMACSignatureMatchesPythonClient(t *testing.T) {
	got, err := buildHMACSignature("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1000000, "test-sign", "/orders", []byte(`{"hash": "0x123"}`))
	if err != nil {
		t.Fatalf("buildHMACSignature() error = %v", err)
	}

	const want = "ZwAdJKvoYRlEKDkNMwd5BuwNNtg93kNaR_oU2HrfVvc="
	if got != want {
		t.Fatalf("buildHMACSignature() = %s, want %s", got, want)
	}
}

func TestBuildSignedOrderKeepsDefaultNonceAndUsesExpectedAmounts(t *testing.T) {
	client, err := newClobClient("https://clob.polymarket.com", 137, testPolymarketPrivateKey, nil, "")
	if err != nil {
		t.Fatalf("newClobClient() error = %v", err)
	}

	order, _, _, err := client.buildSignedOrder(orderArgs{
		TokenID:   "100",
		Price:     0.50,
		Size:      5.0,
		Side:      "BUY",
		OrderType: "GTC",
	}, 0.01, false)
	if err != nil {
		t.Fatalf("buildSignedOrder() error = %v", err)
	}

	if order.Nonce != "0" {
		t.Fatalf("order.Nonce = %s, want 0", order.Nonce)
	}
	if order.MakerAmount != "2500000" {
		t.Fatalf("order.MakerAmount = %s, want 2500000", order.MakerAmount)
	}
	if order.TakerAmount != "5000000" {
		t.Fatalf("order.TakerAmount = %s, want 5000000", order.TakerAmount)
	}
	if order.Side != "BUY" {
		t.Fatalf("order.Side = %s, want BUY", order.Side)
	}
	if order.Expiration != "0" {
		t.Fatalf("order.Expiration = %s, want 0", order.Expiration)
	}
}

func TestOrderTypedDataUsesPolymarketExchangeDomain(t *testing.T) {
	client, err := newClobClient("https://clob.polymarket.com", 137, testPolymarketPrivateKey, nil, "")
	if err != nil {
		t.Fatalf("newClobClient() error = %v", err)
	}

	typedData, err := client.orderTypedData(orderToSign{
		Salt:          big.NewInt(1),
		Maker:         client.address.Hex(),
		Signer:        client.address.Hex(),
		Taker:         zeroAddress(),
		TokenID:       big.NewInt(100),
		MakerAmount:   big.NewInt(2500000),
		TakerAmount:   big.NewInt(5000000),
		Expiration:    big.NewInt(0),
		Nonce:         big.NewInt(0),
		FeeRateBps:    big.NewInt(0),
		Side:          orderSideBuy,
		SignatureType: signatureTypeEOA,
	}, false)
	if err != nil {
		t.Fatalf("orderTypedData() error = %v", err)
	}

	if typedData.Domain.Name != orderDomainName {
		t.Fatalf("typedData.Domain.Name = %s, want %s", typedData.Domain.Name, orderDomainName)
	}
	if typedData.Domain.VerifyingContract != "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" {
		t.Fatalf("typedData.Domain.VerifyingContract = %s", typedData.Domain.VerifyingContract)
	}
}

func TestNewOrderRequestUsesPythonClientRequestShape(t *testing.T) {
	payloadBytes, err := json.Marshal(newOrderRequest(signedOrder{
		Salt:          1,
		Maker:         "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
		Signer:        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
		Taker:         zeroAddress(),
		TokenID:       "100",
		MakerAmount:   "2500000",
		TakerAmount:   "5000000",
		Expiration:    "0",
		Nonce:         "0",
		FeeRateBps:    "0",
		Side:          "BUY",
		SignatureType: signatureTypeEOA,
		Signature:     "0xdeadbeef",
	}, "owner-key", "GTC", false))
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	if _, exists := payload["signature"]; exists {
		t.Fatalf("unexpected top-level signature field in payload: %s", string(payloadBytes))
	}
	if _, exists := payload["signatureType"]; exists {
		t.Fatalf("unexpected top-level signatureType field in payload: %s", string(payloadBytes))
	}
	if payload["owner"] != "owner-key" {
		t.Fatalf("payload owner = %v, want owner-key", payload["owner"])
	}
	if payload["orderType"] != "GTC" {
		t.Fatalf("payload orderType = %v, want GTC", payload["orderType"])
	}
	postOnly, ok := payload["postOnly"].(bool)
	if !ok || postOnly {
		t.Fatalf("payload postOnly = %v, want false", payload["postOnly"])
	}
}

func TestShouldRetryWithGnosisSafe(t *testing.T) {
	p := &Polymarket{
		Funder: "0x7b552cb8ee15ef643bf0ce1d9a8abcbdfe8d3872",
		clobClient: &clobClient{
			sigType: signatureTypePolyProxy,
		},
	}

	if !p.shouldRetryWithGnosisSafe(errors.New(`clob request failed: 400 Bad Request: {"error":"invalid signature"}`)) {
		t.Fatalf("shouldRetryWithGnosisSafe() = false, want true")
	}
	if p.shouldRetryWithGnosisSafe(errors.New("clob request failed: 400 Bad Request: {\"error\":\"not enough balance / allowance\"}")) {
		t.Fatalf("shouldRetryWithGnosisSafe() = true for non-signature error")
	}
}

func TestResolveOrderExpiration(t *testing.T) {
	now := time.Unix(1700000000, 0)

	tests := []struct {
		name       string
		orderType  string
		expiration int64
		want       int64
	}{
		{name: "gtc uses zero", orderType: "GTC", expiration: 123, want: 0},
		{name: "ioc uses zero", orderType: "IOC", expiration: 123, want: 0},
		{name: "fok uses zero", orderType: "FOK", expiration: 123, want: 0},
		{name: "fak uses zero", orderType: "FAK", expiration: 123, want: 0},
		{name: "gtd keeps explicit expiration", orderType: "GTD", expiration: 123, want: 123},
		{name: "gtd defaults when missing", orderType: "GTD", expiration: 0, want: now.Add(90 * time.Second).Unix()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveOrderExpiration(tt.orderType, tt.expiration, now)
			if got != tt.want {
				t.Fatalf("resolveOrderExpiration(%q, %d) = %d, want %d", tt.orderType, tt.expiration, got, tt.want)
			}
		})
	}
}

func TestParseBPSField(t *testing.T) {
	tests := []struct {
		name  string
		value any
		want  int
		ok    bool
	}{
		{name: "string", value: "1000", want: 1000, ok: true},
		{name: "float64", value: 1000.0, want: 1000, ok: true},
		{name: "int", value: 1000, want: 1000, ok: true},
		{name: "int64", value: int64(1000), want: 1000, ok: true},
		{name: "invalid", value: "oops", want: 0, ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseBPSField(tt.value)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("parseBPSField(%v) = (%d, %t), want (%d, %t)", tt.value, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestBalanceAllowanceLogLine(t *testing.T) {
	t.Run("collateral uses summary log", func(t *testing.T) {
		got := balanceAllowanceLogLine("COLLATERAL", "", 2, map[string]any{
			"balance": "13549249",
			"allowances": map[string]any{
				"0x1": "115792089237316195423570985008687907853269984665640564039457584007913083428436",
			},
		})
		if !strings.Contains(got, "asset=COLLATERAL") || !strings.Contains(got, "balance=13.549249") || !strings.Contains(got, "allowance=") || !strings.Contains(got, "signature_type=2") {
			t.Fatalf("balanceAllowanceLogLine() = %q, want collateral summary fields", got)
		}
	})

	t.Run("zero conditional balance is silent", func(t *testing.T) {
		got := balanceAllowanceLogLine("CONDITIONAL", "12345678901234567890", 2, map[string]any{
			"balance": "0",
		})
		if got != "" {
			t.Fatalf("balanceAllowanceLogLine() = %q, want empty string", got)
		}
	})

	t.Run("non-zero conditional balance is abbreviated", func(t *testing.T) {
		got := balanceAllowanceLogLine("CONDITIONAL", "12345678901234567890", 2, map[string]any{
			"balance": "5000000",
		})
		want := "[DEBUG] balance asset=CONDITIONAL token=12345678...567890 balance=5.000000 signature_type=2"
		if got != want {
			t.Fatalf("balanceAllowanceLogLine() = %q, want %q", got, want)
		}
	})
}
