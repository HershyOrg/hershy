package exchanges

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ethereum/go-ethereum/common"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

type fakeCommandCall struct {
	name string
	args []string
}

type fakeCommandRunner struct {
	pathErr error
	output  []byte
	err     error
	calls   []fakeCommandCall
}

func (f *fakeCommandRunner) LookPath(file string) (string, error) {
	return file, f.pathErr
}

func (f *fakeCommandRunner) CombinedOutput(_ context.Context, name string, args ...string) ([]byte, error) {
	copied := make([]string, len(args))
	copy(copied, args)
	f.calls = append(f.calls, fakeCommandCall{name: name, args: copied})
	return f.output, f.err
}

func TestEVMDEXCreateOrderBuildsCastSendCommand(t *testing.T) {
	raw, err := NewEVMDEX(map[string]any{
		"private_key": "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_url":     "https://mainnet.example",
		"chain_id":    float64(8453),
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}

	ex := raw.(*EVMDEX)
	runner := &fakeCommandRunner{
		output: []byte("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"),
	}
	ex.runner = runner

	contractAddress := "0x00000000000000000000000000000000000000aa"
	order, err := ex.CreateOrder(contractAddress, "swap", models.OrderSideBuy, 0, 1, map[string]any{
		"calldata":  "0xa9059cbb",
		"value_wei": "5",
		"gas_limit": "21000",
	})
	if err != nil {
		t.Fatalf("CreateOrder error: %v", err)
	}

	if len(runner.calls) != 1 {
		t.Fatalf("expected 1 cast call, got %d", len(runner.calls))
	}
	call := runner.calls[0]
	if call.name != ex.castBinary {
		t.Fatalf("unexpected command name: %s", call.name)
	}
	expectedArgs := []string{
		"send",
		common.HexToAddress(contractAddress).Hex(),
		"0xa9059cbb",
		"--private-key", ex.privateKey,
		"--rpc-url", "https://mainnet.example",
		"--async",
		"--value", "5wei",
		"--gas-limit", "21000",
	}
	if len(call.args) != len(expectedArgs) {
		t.Fatalf("unexpected arg count: got=%d want=%d args=%v", len(call.args), len(expectedArgs), call.args)
	}
	for index, expected := range expectedArgs {
		if call.args[index] != expected {
			t.Fatalf("unexpected arg at %d: got=%q want=%q full=%v", index, call.args[index], expected, call.args)
		}
	}

	if order.ID != "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.Status != models.OrderStatusPending {
		t.Fatalf("unexpected order status: %s", order.Status)
	}
}

func TestEVMDEXExecuteCallUsesChainSpecificRPCURL(t *testing.T) {
	raw, err := NewEVMDEX(map[string]any{
		"private_key": "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_urls": map[string]any{
			"base-mainnet": "https://base.example",
		},
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}

	ex := raw.(*EVMDEX)
	runner := &fakeCommandRunner{
		output: []byte("0x0000000000000000000000000000000000000000000000000000000000000001\n"),
	}
	ex.runner = runner

	result, err := ex.ExecuteEVMCall(base.EVMDEXRequest{
		Chain:           "base mainnet",
		ContractAddress: "0x00000000000000000000000000000000000000bb",
		Calldata:        "0x70a08231",
	})
	if err != nil {
		t.Fatalf("ExecuteEVMCall error: %v", err)
	}

	if result.RPCURL != "https://base.example" {
		t.Fatalf("unexpected rpc url: %s", result.RPCURL)
	}
	if len(runner.calls) != 1 {
		t.Fatalf("expected 1 cast call, got %d", len(runner.calls))
	}
	call := runner.calls[0]
	if got := call.args[4]; got != "--rpc-url" {
		t.Fatalf("unexpected rpc flag position: %v", call.args)
	}
	if got := call.args[5]; got != "https://base.example" {
		t.Fatalf("unexpected chain-specific rpc url: %s", got)
	}
}

func TestEVMDEXFetchBalanceUsesRPC(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode rpc request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result":  "0xde0b6b3a7640000",
		})
	}))
	defer server.Close()

	raw, err := NewEVMDEX(map[string]any{
		"private_key":   "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_url":       server.URL,
		"native_symbol": "ETH",
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}

	ex := raw.(*EVMDEX)
	balance, err := ex.FetchBalance()
	if err != nil {
		t.Fatalf("FetchBalance error: %v", err)
	}

	if got := balance["ETH"]; got != 1 {
		t.Fatalf("unexpected ETH balance: %v", got)
	}
}
