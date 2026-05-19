package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/exchanges"
	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/relayer"
)

const (
	defaultSessionPrivateKey = "0x2222222222222222222222222222222222222222222222222222222222222222"
	defaultSmartWallet       = "0x00000000000000000000000000000000000000cc"
	defaultTarget            = "0x00000000000000000000000000000000000000aa"
	defaultTxHash            = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

type capturedSubmitter struct {
	mu      sync.Mutex
	request base.SCWRelayRequest
	called  bool
}

func (s *capturedSubmitter) SubmitModuleExecute(_ context.Context, request base.SCWRelayRequest) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.request = request
	s.called = true
	return defaultTxHash, nil
}

func (s *capturedSubmitter) Request() (base.SCWRelayRequest, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.request, s.called
}

type outputEnvelope struct {
	WalletAddress     string                     `json:"wallet_address"`
	SessionKeyAddress string                     `json:"session_key_address"`
	RelayerURL        string                     `json:"relayer_url"`
	Result            map[string]any             `json:"result"`
	RelayRequest      base.SCWRelayRequest       `json:"relay_request"`
	Policy            relayer.SCWExecutionPolicy `json:"policy"`
}

func main() {
	var (
		chain             = flag.String("chain", envOrDefault("SCW_E2E_CHAIN", "giwa-sepolia"), "chain slug")
		chainID           = flag.Int64("chain-id", envOrDefaultInt64("SCW_E2E_CHAIN_ID", 91342), "chain id")
		rpcURL            = flag.String("rpc-url", envOrDefault("SCW_E2E_RPC_URL", "https://scw-e2e.invalid"), "rpc url recorded in executor metadata")
		smartWallet       = flag.String("smart-wallet", envOrDefault("SCW_E2E_SMART_WALLET", defaultSmartWallet), "smart wallet address")
		sessionPrivateKey = flag.String("session-private-key", envOrDefault("SCW_E2E_SESSION_PRIVATE_KEY", defaultSessionPrivateKey), "session private key for test signing")
		policyID          = flag.String("policy-id", envOrDefault("SCW_E2E_POLICY_ID", "policy-smoke"), "policy id")
		sessionKeyID      = flag.String("session-key-id", envOrDefault("SCW_E2E_SESSION_KEY_ID", "session-smoke"), "session key id")
		target            = flag.String("target", envOrDefault("SCW_E2E_TARGET", defaultTarget), "target contract address")
		calldata          = flag.String("calldata", envOrDefault("SCW_E2E_CALLDATA", "0xa9059cbb"), "target calldata")
		value             = flag.String("value", envOrDefault("SCW_E2E_VALUE", "0"), "native value in wei")
		gasLimit          = flag.Uint64("gas-limit", envOrDefaultUint64("SCW_E2E_GAS_LIMIT", 21000), "target execution gas limit")
	)
	flag.Parse()

	sessionAddress, err := deriveSessionAddress(*sessionPrivateKey)
	if err != nil {
		log.Fatalf("derive session address: %v", err)
	}
	if !common.IsHexAddress(strings.TrimSpace(*smartWallet)) {
		log.Fatalf("invalid smart wallet address: %s", *smartWallet)
	}
	if !common.IsHexAddress(strings.TrimSpace(*target)) {
		log.Fatalf("invalid target address: %s", *target)
	}

	policy := relayer.SCWExecutionPolicy{
		SmartWalletAddress:       common.HexToAddress(strings.TrimSpace(*smartWallet)).Hex(),
		SessionKeyAddress:        sessionAddress,
		PolicyID:                 strings.TrimSpace(*policyID),
		AllowedChainIDs:          []int64{*chainID},
		AllowedContractAddresses: []string{common.HexToAddress(strings.TrimSpace(*target)).Hex()},
		AllowedFunctionSelectors: []string{selectorFromCalldata(*calldata)},
		MaxValueWei:              strings.TrimSuffix(strings.TrimSpace(*value), "wei"),
		MaxGasLimit:              *gasLimit,
		DeadlineGracePeriod:      5 * time.Second,
	}

	submitter := &capturedSubmitter{}
	server := httptest.NewServer(&relayer.Server{
		PolicyStore: relayer.StaticPolicyStore{Policies: []relayer.SCWExecutionPolicy{policy}},
		Submitter:   submitter,
	})
	defer server.Close()

	raw, err := exchanges.NewEVMDEX(map[string]any{
		"signer_type":          "session_key",
		"smart_wallet_address": strings.TrimSpace(*smartWallet),
		"session_private_key":  strings.TrimSpace(*sessionPrivateKey),
		"session_key_id":       strings.TrimSpace(*sessionKeyID),
		"policy_id":            strings.TrimSpace(*policyID),
		"relayer_url":          server.URL,
		"rpc_urls": map[string]any{
			strings.TrimSpace(*chain): strings.TrimSpace(*rpcURL),
		},
		"chain_ids": map[string]any{
			strings.TrimSpace(*chain): *chainID,
		},
	})
	if err != nil {
		log.Fatalf("create evm_dex: %v", err)
	}

	order, err := raw.CreateOrder(strings.TrimSpace(*target), "scw", models.OrderSideBuy, 0, 1, map[string]any{
		"chain":         strings.TrimSpace(*chain),
		"calldata":      strings.TrimSpace(*calldata),
		"value_wei":     strings.TrimSpace(*value),
		"gas_limit":     strconv.FormatUint(*gasLimit, 10),
		"function_name": "scwSmoke",
	})
	if err != nil {
		log.Fatalf("execute scw order: %v", err)
	}

	relayRequest, ok := submitter.Request()
	if !ok {
		log.Fatal("relayer submitter was not called")
	}

	output, err := json.MarshalIndent(outputEnvelope{
		WalletAddress:     walletAddress(raw),
		SessionKeyAddress: sessionAddress,
		RelayerURL:        server.URL,
		Result: map[string]any{
			"order_id": order.ID,
			"status":   order.Status,
		},
		RelayRequest: relayRequest,
		Policy:       policy,
	}, "", "  ")
	if err != nil {
		log.Fatalf("marshal output: %v", err)
	}
	fmt.Println(string(output))
	fmt.Println("[scw-e2e] success")
}

func deriveSessionAddress(privateKeyHex string) (string, error) {
	signer, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(privateKeyHex), "0x"))
	if err != nil {
		return "", err
	}
	return crypto.PubkeyToAddress(signer.PublicKey).Hex(), nil
}

func selectorFromCalldata(calldata string) string {
	text := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(calldata), "0x"), "0X")
	if len(text) < 8 {
		return ""
	}
	return "0x" + strings.ToLower(text[:8])
}

func walletAddress(exchange base.Exchange) string {
	type walletAddresser interface {
		WalletAddress() string
	}
	addresser, ok := exchange.(walletAddresser)
	if !ok {
		return ""
	}
	return addresser.WalletAddress()
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envOrDefaultInt64(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envOrDefaultUint64(key string, fallback uint64) uint64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}
