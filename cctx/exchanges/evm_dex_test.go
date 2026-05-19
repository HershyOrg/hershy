package exchanges

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

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
		"chain_ids": map[string]any{
			"base-mainnet": float64(8453),
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
	if result.Chain != "base-mainnet" {
		t.Fatalf("unexpected chain: %s", result.Chain)
	}
	if result.ChainID != 8453 {
		t.Fatalf("unexpected chain id: %d", result.ChainID)
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

func TestEVMDEXExecuteCallUsesSingleChainRouteWhenRequestOmitsChain(t *testing.T) {
	raw, err := NewEVMDEX(map[string]any{
		"private_key": "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_urls": map[string]any{
			"giwa-sepolia": "https://sepolia-rpc.giwa.io",
		},
		"chain_ids": map[string]any{
			"giwa-sepolia": float64(91342),
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
		ContractAddress: "0x00000000000000000000000000000000000000bb",
		Calldata:        "0x70a08231",
	})
	if err != nil {
		t.Fatalf("ExecuteEVMCall error: %v", err)
	}

	if result.Chain != "giwa-sepolia" {
		t.Fatalf("unexpected chain: %s", result.Chain)
	}
	if result.ChainID != 91342 {
		t.Fatalf("unexpected chain id: %d", result.ChainID)
	}
	if result.RPCURL != "https://sepolia-rpc.giwa.io" {
		t.Fatalf("unexpected rpc url: %s", result.RPCURL)
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

func TestEVMDEXCreateOrderUsesSCWRelayerWithSessionKeySignature(t *testing.T) {
	sessionPrivateKey := "0x2222222222222222222222222222222222222222222222222222222222222222"
	sessionSigner, err := crypto.HexToECDSA(sessionPrivateKey[2:])
	if err != nil {
		t.Fatalf("session signer parse error: %v", err)
	}
	sessionAddress := crypto.PubkeyToAddress(sessionSigner.PublicKey).Hex()

	var seenRequest base.SCWRelayRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer relay-secret" {
			t.Fatalf("unexpected authorization header: %s", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&seenRequest); err != nil {
			t.Fatalf("decode relay request: %v", err)
		}
		digest, err := base.SCWRelayTypedDataHash(seenRequest)
		if err != nil {
			t.Fatalf("relay typed data hash: %v", err)
		}
		signature, err := decodeRecoverableSignature(seenRequest.Signature)
		if err != nil {
			t.Fatalf("decode relay signature: %v", err)
		}
		pubKey, err := crypto.SigToPub(digest, signature)
		if err != nil {
			t.Fatalf("recover relay signer: %v", err)
		}
		if got := crypto.PubkeyToAddress(*pubKey).Hex(); got != sessionAddress {
			t.Fatalf("unexpected recovered session signer: got=%s want=%s", got, sessionAddress)
		}
		_ = json.NewEncoder(w).Encode(base.SCWRelayResponse{
			RelayID: "relay-123",
			TxHash:  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			Status:  "submitted",
		})
	}))
	defer server.Close()

	raw, err := NewEVMDEX(map[string]any{
		"signer_type":          "session_key",
		"smart_wallet_address": "0x00000000000000000000000000000000000000cc",
		"session_private_key":  sessionPrivateKey,
		"session_key_id":       "session-1",
		"policy_id":            "policy-1",
		"relayer_url":          server.URL,
		"relayer_auth_token":   "relay-secret",
		"rpc_urls": map[string]any{
			"base-mainnet": "https://base.example",
		},
		"chain_id": float64(1),
		"chain_ids": map[string]any{
			"base-mainnet": float64(8453),
		},
		"strategy_id":              "strategy-42",
		"session_deadline_seconds": float64(600),
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}

	ex := raw.(*EVMDEX)
	ex.runner = &fakeCommandRunner{}

	order, err := ex.CreateOrder("0x00000000000000000000000000000000000000aa", "swap", models.OrderSideBuy, 0, 1, map[string]any{
		"calldata":      "0xa9059cbb",
		"chain":         "base-mainnet",
		"value_wei":     "5",
		"gas_limit":     "21000",
		"function_name": "swapExactTokensForTokens",
	})
	if err != nil {
		t.Fatalf("CreateOrder error: %v", err)
	}

	if order.ID != "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.Status != models.OrderStatusPending {
		t.Fatalf("unexpected order status: %s", order.Status)
	}
	if ex.WalletAddress() != common.HexToAddress("0x00000000000000000000000000000000000000cc").Hex() {
		t.Fatalf("unexpected wallet address: %s", ex.WalletAddress())
	}
	if seenRequest.SmartWalletAddress != ex.WalletAddress() {
		t.Fatalf("unexpected smart wallet address: %s", seenRequest.SmartWalletAddress)
	}
	if seenRequest.SessionKeyAddress != sessionAddress {
		t.Fatalf("unexpected session key address: %s", seenRequest.SessionKeyAddress)
	}
	if seenRequest.Chain != "base-mainnet" {
		t.Fatalf("unexpected relay chain: %s", seenRequest.Chain)
	}
	if seenRequest.ChainID != 8453 {
		t.Fatalf("unexpected relay chain id: %d", seenRequest.ChainID)
	}
	if seenRequest.PolicyID != "policy-1" || seenRequest.SessionKeyID != "session-1" || seenRequest.StrategyID != "strategy-42" {
		t.Fatalf("unexpected relay metadata: %#v", seenRequest)
	}
	if seenRequest.ContractAddress != "0x00000000000000000000000000000000000000AA" {
		t.Fatalf("unexpected relay contract address: %s", seenRequest.ContractAddress)
	}
	if seenRequest.Calldata != "0xa9059cbb" {
		t.Fatalf("unexpected relay calldata: %s", seenRequest.Calldata)
	}
	if seenRequest.Value != "5wei" {
		t.Fatalf("unexpected relay value: %s", seenRequest.Value)
	}
	if seenRequest.GasLimit != 21000 {
		t.Fatalf("unexpected relay gas limit: %d", seenRequest.GasLimit)
	}
	if seenRequest.Signature == "" {
		t.Fatalf("expected non-empty relay signature")
	}
}

func decodeRecoverableSignature(raw string) ([]byte, error) {
	signature := common.FromHex(raw)
	if len(signature) != crypto.SignatureLength {
		return nil, base.InvalidOrder{Message: "invalid relay signature length"}
	}
	switch signature[64] {
	case 27, 28:
		signature[64] -= 27
	case 0, 1:
	default:
		return nil, base.InvalidOrder{Message: "invalid relay recovery id"}
	}
	return signature, nil
}
