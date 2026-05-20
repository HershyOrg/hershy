package exchanges

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
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
		"private_key": "0x" + "1111111111111111" + "1111111111111111" + "1111111111111111" + "1111111111111111",
		"rpc_url":     "https://mainnet.example",
		"chain_id":    float64(8453),
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}

	ex := raw.(*EVMDEX)
	runner := &fakeCommandRunner{
		output: []byte("0x" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "\n"),
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

	if order.ID != "0x"+"aaaaaaaaaaaaaaaa"+"aaaaaaaaaaaaaaaa"+"aaaaaaaaaaaaaaaa"+"aaaaaaaaaaaaaaaa" {
		t.Fatalf("unexpected order id: %s", order.ID)
	}
	if order.Status != models.OrderStatusPending {
		t.Fatalf("unexpected order status: %s", order.Status)
	}
}

func TestEVMDEXExecuteCallUsesChainSpecificRPCURL(t *testing.T) {
	raw, err := NewEVMDEX(map[string]any{
		"private_key": "0x" + "1111111111111111" + "1111111111111111" + "1111111111111111" + "1111111111111111",
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
		output: []byte("0x" + "0000000000000000" + "0000000000000000" + "0000000000000000" + "0000000000000001" + "\n"),
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
		"private_key":   "0x" + "1111111111111111" + "1111111111111111" + "1111111111111111" + "1111111111111111",
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

func TestEVMDEXFetchERC20BalanceAndAllowanceUsesRPC(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode rpc request: %v", err)
		}
		result := erc20RPCResultForRequest(t, req)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result":  result,
		})
	}))
	defer server.Close()

	raw, err := NewEVMDEX(map[string]any{
		"private_key": "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_url":     server.URL,
		"chain_id":    float64(8453),
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}
	reader := raw.(base.EVMDEXReader)

	balance, err := reader.FetchERC20Balance(base.EVMERC20BalanceRequest{
		TokenAddress: "0x00000000000000000000000000000000000000aa",
		OwnerAddress: "0x00000000000000000000000000000000000000bb",
	})
	if err != nil {
		t.Fatalf("FetchERC20Balance error: %v", err)
	}
	if balance.TokenAddress != "0x00000000000000000000000000000000000000AA" {
		t.Fatalf("unexpected token address: %s", balance.TokenAddress)
	}
	if balance.Symbol != "USDC" || balance.Decimals != 6 {
		t.Fatalf("unexpected metadata: %#v", balance.EVMERC20Metadata)
	}
	if balance.BalanceWei != "1234567" || balance.BalanceFormatted != "1.234567" {
		t.Fatalf("unexpected balance: wei=%s formatted=%s", balance.BalanceWei, balance.BalanceFormatted)
	}

	allowance, err := reader.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
		TokenAddress:   "0x00000000000000000000000000000000000000aa",
		OwnerAddress:   "0x00000000000000000000000000000000000000bb",
		SpenderAddress: "0x00000000000000000000000000000000000000cc",
	})
	if err != nil {
		t.Fatalf("FetchERC20Allowance error: %v", err)
	}
	if allowance.AllowanceWei != "999000" || allowance.AllowanceFormatted != "0.999" {
		t.Fatalf("unexpected allowance: wei=%s formatted=%s", allowance.AllowanceWei, allowance.AllowanceFormatted)
	}
}

func TestEVMDEXQuoteExactInputUsesUniswapV2RouterRPC(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode rpc request: %v", err)
		}
		result := evmDEXPackOutputHex(t, evmDEXUniswapV2RouterABI.Methods["getAmountsOut"].Outputs, []*big.Int{
			big.NewInt(1000),
			big.NewInt(1900),
		})
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result":  result,
		})
	}))
	defer server.Close()

	raw, err := NewEVMDEX(map[string]any{
		"private_key": "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_urls": map[string]any{
			"base-mainnet": server.URL,
		},
		"chain_ids": map[string]any{
			"base-mainnet": float64(8453),
		},
	})
	if err != nil {
		t.Fatalf("NewEVMDEX error: %v", err)
	}
	reader := raw.(base.EVMDEXReader)

	quote, err := reader.QuoteExactInput(base.EVMDEXQuoteRequest{
		Chain:         "base mainnet",
		RouterAddress: "0x00000000000000000000000000000000000000dd",
		AmountInWei:   "1000",
		Path: []string{
			"0x00000000000000000000000000000000000000aa",
			"0x00000000000000000000000000000000000000bb",
		},
	})
	if err != nil {
		t.Fatalf("QuoteExactInput error: %v", err)
	}
	if quote.Protocol != "uniswap_v2" {
		t.Fatalf("unexpected protocol: %s", quote.Protocol)
	}
	if quote.Chain != "base-mainnet" || quote.ChainID != 8453 {
		t.Fatalf("unexpected route: chain=%s chain_id=%d", quote.Chain, quote.ChainID)
	}
	if quote.AmountInWei != "1000" || quote.AmountOutWei != "1900" {
		t.Fatalf("unexpected quote amounts: %#v", quote)
	}
	if len(quote.AmountsWei) != 2 || quote.AmountsWei[0] != "1000" || quote.AmountsWei[1] != "1900" {
		t.Fatalf("unexpected route amounts: %#v", quote.AmountsWei)
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
	if seenRequest.Nonce == "" {
		t.Fatalf("expected generated relay nonce")
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

func erc20RPCResultForRequest(t *testing.T, req map[string]any) string {
	t.Helper()
	params, ok := req["params"].([]any)
	if !ok || len(params) == 0 {
		t.Fatalf("unexpected rpc params: %#v", req["params"])
	}
	call, ok := params[0].(map[string]any)
	if !ok {
		t.Fatalf("unexpected eth_call payload: %#v", params[0])
	}
	data, ok := call["data"].(string)
	if !ok {
		data, ok = call["input"].(string)
	}
	if !ok || len(data) < 10 {
		t.Fatalf("unexpected eth_call data: %#v", call["data"])
	}
	switch data[:10] {
	case "0x" + hexEncode(evmDEXERC20ABI.Methods["symbol"].ID):
		return evmDEXPackOutputHex(t, evmDEXERC20ABI.Methods["symbol"].Outputs, "USDC")
	case "0x" + hexEncode(evmDEXERC20ABI.Methods["decimals"].ID):
		return evmDEXPackOutputHex(t, evmDEXERC20ABI.Methods["decimals"].Outputs, uint8(6))
	case "0x" + hexEncode(evmDEXERC20ABI.Methods["balanceOf"].ID):
		return evmDEXPackOutputHex(t, evmDEXERC20ABI.Methods["balanceOf"].Outputs, big.NewInt(1234567))
	case "0x" + hexEncode(evmDEXERC20ABI.Methods["allowance"].ID):
		return evmDEXPackOutputHex(t, evmDEXERC20ABI.Methods["allowance"].Outputs, big.NewInt(999000))
	default:
		t.Fatalf("unexpected selector: %s", data[:10])
		return "0x"
	}
}

func evmDEXPackOutputHex(t *testing.T, arguments abi.Arguments, values ...any) string {
	t.Helper()
	encoded, err := arguments.Pack(values...)
	if err != nil {
		t.Fatalf("pack abi output: %v", err)
	}
	return "0x" + hexEncode(encoded)
}

func hexEncode(data []byte) string {
	return hex.EncodeToString(data)
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
