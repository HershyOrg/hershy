package exchanges

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

const (
	EVMDEXDefaultCastBinary  = "cast"
	EVMDEXDefaultChainID     = 1
	EVMDEXDefaultNativeAsset = "ETH"
)

type commandRunner interface {
	LookPath(file string) (string, error)
	CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error)
}

type osCommandRunner struct{}

func (osCommandRunner) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}

func (osCommandRunner) CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// EVMDEX is a generic EVM DEX executor backed by Foundry cast.
type EVMDEX struct {
	base.BaseExchange

	privateKey   string
	rpcURL       string
	rpcURLs      map[string]string
	chainID      int64
	castBinary   string
	nativeSymbol string

	signer  *ecdsa.PrivateKey
	address string
	runner  commandRunner
}

// NewEVMDEX creates a generic EVM DEX executor exchange.
func NewEVMDEX(config map[string]any) (base.Exchange, error) {
	if config == nil {
		return nil, fmt.Errorf("exchanges.NewEVMDEX: config is nil")
	}
	resolvedConfig, err := secureconfig.ResolveMap(config)
	if err != nil {
		return nil, fmt.Errorf("exchanges.NewEVMDEX: resolve secure config: %w", err)
	}
	config = resolvedConfig
	ex := &EVMDEX{
		BaseExchange: base.NewBaseExchange(config),
		privateKey:   firstNonEmptyString(stringFromConfig(config, "private_key"), stringFromConfig(config, "privateKey")),
		rpcURL:       firstNonEmptyString(stringFromConfig(config, "rpc_url"), stringFromConfig(config, "rpcUrl")),
		rpcURLs:      rpcURLsFromConfig(firstNonNil(config["rpc_urls"], config["rpcUrls"])),
		castBinary:   firstNonEmptyString(stringFromConfig(config, "cast_binary"), stringFromConfig(config, "castBinary")),
		nativeSymbol: firstNonEmptyString(stringFromConfig(config, "native_symbol"), stringFromConfig(config, "nativeSymbol")),
		runner:       osCommandRunner{},
	}
	if ex.castBinary == "" {
		ex.castBinary = EVMDEXDefaultCastBinary
	}
	if ex.nativeSymbol == "" {
		ex.nativeSymbol = EVMDEXDefaultNativeAsset
	}
	if raw, ok := firstNonNil(config["chain_id"], config["chainId"]).(float64); ok && raw > 0 {
		ex.chainID = int64(raw)
	} else if raw, ok := firstNonNil(config["chain_id"], config["chainId"]).(int64); ok && raw > 0 {
		ex.chainID = raw
	} else if raw, ok := firstNonNil(config["chain_id"], config["chainId"]).(int); ok && raw > 0 {
		ex.chainID = int64(raw)
	} else {
		ex.chainID = EVMDEXDefaultChainID
	}
	ex.BaseExchange.Bind(ex)
	if err := ex.initSigner(); err != nil {
		return nil, err
	}
	return ex, nil
}

// ID returns the exchange identifier.
func (e *EVMDEX) ID() string {
	return "evm_dex"
}

// Name returns the display name.
func (e *EVMDEX) Name() string {
	return "EVM DEX"
}

// WalletAddress returns the configured signer address.
func (e *EVMDEX) WalletAddress() string {
	return e.address
}

// FetchMarkets is not supported for the generic executor.
func (e *EVMDEX) FetchMarkets(params map[string]any) ([]models.Market, error) {
	_ = params
	return nil, base.ExchangeError{Message: "evm_dex does not support market discovery"}
}

// FetchMarket returns a virtual contract-backed market when the address is valid.
func (e *EVMDEX) FetchMarket(marketID string) (models.Market, error) {
	if !common.IsHexAddress(strings.TrimSpace(marketID)) {
		return models.Market{}, base.MarketNotFound{Message: fmt.Sprintf("invalid contract address: %s", marketID)}
	}
	address := common.HexToAddress(strings.TrimSpace(marketID)).Hex()
	return models.Market{
		ID:       address,
		Question: fmt.Sprintf("EVM contract %s", address),
		Outcomes: []string{"execute"},
		Metadata: map[string]any{
			"contract_address": address,
			"executor":         e.ID(),
			"chain_id":         e.chainID,
			"readable_id":      []string{address},
		},
	}, nil
}

// CreateOrder submits a state-changing contract transaction using raw calldata.
func (e *EVMDEX) CreateOrder(marketID, outcome string, side models.OrderSide, price, size float64, params map[string]any) (models.Order, error) {
	request, mode, err := e.buildRequest(marketID, params)
	if err != nil {
		return models.Order{}, err
	}
	now := time.Now().UTC()

	if mode == "call" {
		result, err := e.ExecuteEVMCall(request)
		if err != nil {
			return models.Order{}, err
		}
		callID := fmt.Sprintf("call-%d", now.UnixNano())
		_ = result
		return models.Order{
			ID:        callID,
			MarketID:  common.HexToAddress(request.ContractAddress).Hex(),
			Outcome:   outcome,
			Side:      side,
			Price:     price,
			Size:      size,
			Filled:    size,
			Status:    models.OrderStatusFilled,
			CreatedAt: now,
			UpdatedAt: &now,
		}, nil
	}

	result, err := e.ExecuteEVMTransaction(request)
	if err != nil {
		return models.Order{}, err
	}
	return models.Order{
		ID:        result.TxHash,
		MarketID:  common.HexToAddress(request.ContractAddress).Hex(),
		Outcome:   outcome,
		Side:      side,
		Price:     price,
		Size:      size,
		Filled:    0,
		Status:    models.OrderStatusPending,
		CreatedAt: now,
		UpdatedAt: &now,
	}, nil
}

// CancelOrder is not supported for raw on-chain transactions.
func (e *EVMDEX) CancelOrder(orderID string, marketID *string) (models.Order, error) {
	_ = orderID
	_ = marketID
	return models.Order{}, base.ExchangeError{Message: "evm_dex does not support canceling submitted transactions"}
}

// FetchOrder is not supported for raw on-chain transactions.
func (e *EVMDEX) FetchOrder(orderID string, marketID *string) (models.Order, error) {
	_ = orderID
	_ = marketID
	return models.Order{}, base.ExchangeError{Message: "evm_dex does not support fetching transaction-backed orders"}
}

// FetchOpenOrders is not supported for the generic executor.
func (e *EVMDEX) FetchOpenOrders(marketID *string, params map[string]any) ([]models.Order, error) {
	_ = marketID
	_ = params
	return nil, base.ExchangeError{Message: "evm_dex does not support open order tracking"}
}

// FetchPositions is not supported for the generic executor.
func (e *EVMDEX) FetchPositions(marketID *string, params map[string]any) ([]models.Position, error) {
	_ = marketID
	_ = params
	return nil, base.ExchangeError{Message: "evm_dex does not support position discovery"}
}

// FetchBalance returns the native token balance for the configured wallet.
func (e *EVMDEX) FetchBalance() (map[string]float64, error) {
	rpcURL, err := e.resolveRPCURL("")
	if err != nil {
		return nil, err
	}
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, base.NetworkError{Message: fmt.Sprintf("eth rpc dial failed: %v", err)}
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	balanceWei, err := client.BalanceAt(ctx, common.HexToAddress(e.address), nil)
	if err != nil {
		return nil, base.NetworkError{Message: fmt.Sprintf("eth_getBalance failed: %v", err)}
	}
	return map[string]float64{
		e.nativeSymbol: weiToFloat64(balanceWei, 18),
	}, nil
}

// ExecuteEVMCall performs a read-only call via Foundry cast.
func (e *EVMDEX) ExecuteEVMCall(request base.EVMDEXRequest) (base.EVMDEXResult, error) {
	if err := e.ensureCastReady(); err != nil {
		return base.EVMDEXResult{}, err
	}
	normalized, rpcURL, err := e.normalizeRequest(request)
	if err != nil {
		return base.EVMDEXResult{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	output, err := e.runner.CombinedOutput(ctx, e.castBinary, "call", normalized.ContractAddress, "--data", normalized.Calldata, "--rpc-url", rpcURL)
	if err != nil {
		return base.EVMDEXResult{}, base.ExchangeError{Message: fmt.Sprintf("cast call failed: %s", strings.TrimSpace(string(output)))}
	}
	return base.EVMDEXResult{
		Mode:      "call",
		Transport: "foundry",
		Chain:     normalized.Chain,
		ChainID:   e.chainID,
		RPCURL:    rpcURL,
		From:      e.address,
		To:        normalized.ContractAddress,
		Calldata:  normalized.Calldata,
		Value:     normalized.Value,
		RawOutput: strings.TrimSpace(string(output)),
	}, nil
}

// ExecuteEVMTransaction submits a state-changing transaction via Foundry cast.
func (e *EVMDEX) ExecuteEVMTransaction(request base.EVMDEXRequest) (base.EVMDEXResult, error) {
	if err := e.ensureCastReady(); err != nil {
		return base.EVMDEXResult{}, err
	}
	normalized, rpcURL, err := e.normalizeRequest(request)
	if err != nil {
		return base.EVMDEXResult{}, err
	}

	args := []string{
		"send",
		normalized.ContractAddress,
		normalized.Calldata,
		"--private-key", e.privateKey,
		"--rpc-url", rpcURL,
		"--async",
	}
	if normalized.Value != "" {
		args = append(args, "--value", normalized.Value)
	}
	if normalized.GasLimit > 0 {
		args = append(args, "--gas-limit", strconv.FormatUint(normalized.GasLimit, 10))
	}
	if gasPrice := normalizeFoundryGasPrice(normalized.MaxFeePerGas); gasPrice != "" {
		args = append(args, "--gas-price", gasPrice)
	}
	if priorityFee := normalizeFoundryGasPrice(normalized.MaxPriorityFeePerGas); priorityFee != "" {
		args = append(args, "--priority-gas-price", priorityFee)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	output, err := e.runner.CombinedOutput(ctx, e.castBinary, args...)
	if err != nil {
		return base.EVMDEXResult{}, base.ExchangeError{Message: fmt.Sprintf("cast send failed: %s", strings.TrimSpace(string(output)))}
	}
	txHash := extractTxHash(string(output))
	if txHash == "" {
		return base.EVMDEXResult{}, base.ExchangeError{Message: fmt.Sprintf("cast send returned no tx hash: %s", strings.TrimSpace(string(output)))}
	}

	return base.EVMDEXResult{
		Mode:      "transaction",
		Transport: "foundry",
		Chain:     normalized.Chain,
		ChainID:   e.chainID,
		RPCURL:    rpcURL,
		From:      e.address,
		To:        normalized.ContractAddress,
		Calldata:  normalized.Calldata,
		Value:     normalized.Value,
		TxHash:    txHash,
	}, nil
}

func (e *EVMDEX) initSigner() error {
	if strings.TrimSpace(e.privateKey) == "" {
		return base.AuthenticationError{Message: "private_key required for evm_dex"}
	}
	signer, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(e.privateKey), "0x"))
	if err != nil {
		return base.AuthenticationError{Message: fmt.Sprintf("invalid private key: %v", err)}
	}
	e.signer = signer
	e.address = crypto.PubkeyToAddress(signer.PublicKey).Hex()
	return nil
}

func (e *EVMDEX) ensureCastReady() error {
	if e.runner == nil {
		e.runner = osCommandRunner{}
	}
	if _, err := e.runner.LookPath(e.castBinary); err != nil {
		return base.ExchangeError{Message: fmt.Sprintf("foundry cast binary not found: %s", e.castBinary)}
	}
	return nil
}

func (e *EVMDEX) buildRequest(marketID string, params map[string]any) (base.EVMDEXRequest, string, error) {
	to := strings.TrimSpace(marketID)
	if !common.IsHexAddress(to) {
		to = strings.TrimSpace(anyString(params["contract_address"]))
	}
	if !common.IsHexAddress(to) {
		to = strings.TrimSpace(anyString(params["contractAddress"]))
	}
	if !common.IsHexAddress(to) {
		to = strings.TrimSpace(anyString(params["to"]))
	}
	if !common.IsHexAddress(to) {
		return base.EVMDEXRequest{}, "", base.InvalidOrder{Message: "contract address required in marketID, contract_address, or to"}
	}
	calldata := strings.TrimSpace(anyString(params["calldata"]))
	if calldata == "" {
		calldata = strings.TrimSpace(anyString(params["data"]))
	}
	if calldata == "" {
		return base.EVMDEXRequest{}, "", base.InvalidOrder{Message: "calldata required in params"}
	}
	value := strings.TrimSpace(anyString(params["value"]))
	if value == "" {
		if rawWei := strings.TrimSpace(anyString(params["value_wei"])); rawWei != "" {
			value = rawWei + "wei"
		}
	}
	if value == "" {
		if rawWei := strings.TrimSpace(anyString(params["valueWei"])); rawWei != "" {
			value = rawWei + "wei"
		}
	}

	mode := strings.ToLower(strings.TrimSpace(anyString(params["mode"])))
	if mode == "" {
		if simulate, ok := params["simulate"].(bool); ok && simulate {
			mode = "call"
		}
	}
	if mode == "" {
		stateMutability := strings.ToLower(strings.TrimSpace(anyString(params["state_mutability"])))
		if stateMutability == "view" || stateMutability == "pure" {
			mode = "call"
		} else {
			mode = "transaction"
		}
	}

	gasLimit, err := parseUint64Param(params["gas_limit"], params["gasLimit"])
	if err != nil {
		return base.EVMDEXRequest{}, "", base.InvalidOrder{Message: err.Error()}
	}
	return base.EVMDEXRequest{
		Chain:                firstNonEmptyString(strings.TrimSpace(anyString(params["chain"])), strings.TrimSpace(anyString(params["chainSlug"]))),
		ContractAddress:      to,
		Calldata:             calldata,
		Value:                value,
		GasLimit:             gasLimit,
		MaxFeePerGas:         firstNonEmptyString(strings.TrimSpace(anyString(params["max_fee_per_gas"])), strings.TrimSpace(anyString(params["maxFeePerGas"]))),
		MaxPriorityFeePerGas: firstNonEmptyString(strings.TrimSpace(anyString(params["max_priority_fee_per_gas"])), strings.TrimSpace(anyString(params["maxPriorityFeePerGas"]))),
		FunctionName:         firstNonEmptyString(strings.TrimSpace(anyString(params["function_name"])), strings.TrimSpace(anyString(params["functionName"]))),
		StateMutability:      firstNonEmptyString(strings.TrimSpace(anyString(params["state_mutability"])), strings.TrimSpace(anyString(params["stateMutability"]))),
	}, mode, nil
}

func (e *EVMDEX) normalizeRequest(request base.EVMDEXRequest) (base.EVMDEXRequest, string, error) {
	if !common.IsHexAddress(strings.TrimSpace(request.ContractAddress)) {
		return base.EVMDEXRequest{}, "", base.InvalidOrder{Message: "invalid contract address"}
	}
	calldata, err := normalizeHexData(request.Calldata)
	if err != nil {
		return base.EVMDEXRequest{}, "", base.InvalidOrder{Message: fmt.Sprintf("invalid calldata: %v", err)}
	}
	rpcURL, err := e.resolveRPCURL(request.Chain)
	if err != nil {
		return base.EVMDEXRequest{}, "", err
	}
	request.ContractAddress = common.HexToAddress(strings.TrimSpace(request.ContractAddress)).Hex()
	request.Calldata = calldata
	request.Chain = normalizeChainSlug(request.Chain)
	return request, rpcURL, nil
}

func (e *EVMDEX) resolveRPCURL(chain string) (string, error) {
	if chainSlug := normalizeChainSlug(chain); chainSlug != "" {
		if rpcURL, ok := e.rpcURLs[chainSlug]; ok && strings.TrimSpace(rpcURL) != "" {
			return strings.TrimSpace(rpcURL), nil
		}
	}
	if strings.TrimSpace(e.rpcURL) != "" {
		return strings.TrimSpace(e.rpcURL), nil
	}
	if len(e.rpcURLs) == 1 {
		for _, rpcURL := range e.rpcURLs {
			if strings.TrimSpace(rpcURL) != "" {
				return strings.TrimSpace(rpcURL), nil
			}
		}
	}
	if len(e.rpcURLs) > 1 {
		keys := make([]string, 0, len(e.rpcURLs))
		for key := range e.rpcURLs {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		return "", base.InvalidOrder{Message: fmt.Sprintf("rpc url required; available chain keys: %s", strings.Join(keys, ", "))}
	}
	return "", base.InvalidOrder{Message: "rpc_url or rpc_urls required for evm_dex"}
}

func rpcURLsFromConfig(raw any) map[string]string {
	out := map[string]string{}
	switch typed := raw.(type) {
	case map[string]string:
		for key, value := range typed {
			if strings.TrimSpace(value) != "" {
				out[normalizeChainSlug(key)] = strings.TrimSpace(value)
			}
		}
	case map[string]any:
		for key, value := range typed {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				out[normalizeChainSlug(key)] = strings.TrimSpace(text)
			}
		}
	}
	return out
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizeChainSlug(raw string) string {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return ""
	}
	var builder strings.Builder
	lastDash := false
	for _, char := range text {
		isAlphaNum := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if isAlphaNum {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func normalizeHexData(raw string) (string, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "", errors.New("empty hex data")
	}
	text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	if len(text)%2 != 0 {
		text = "0" + text
	}
	if _, err := hex.DecodeString(text); err != nil {
		return "", err
	}
	return "0x" + strings.ToLower(text), nil
}

func parseUint64Param(values ...any) (uint64, error) {
	for _, value := range values {
		switch typed := value.(type) {
		case nil:
			continue
		case uint64:
			return typed, nil
		case int:
			if typed < 0 {
				return 0, errors.New("gas limit cannot be negative")
			}
			return uint64(typed), nil
		case int64:
			if typed < 0 {
				return 0, errors.New("gas limit cannot be negative")
			}
			return uint64(typed), nil
		case float64:
			if typed < 0 {
				return 0, errors.New("gas limit cannot be negative")
			}
			return uint64(typed), nil
		case string:
			text := strings.TrimSpace(typed)
			if text == "" {
				continue
			}
			parsed, err := strconv.ParseUint(text, 10, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid gas limit: %s", text)
			}
			return parsed, nil
		}
	}
	return 0, nil
}

func normalizeFoundryGasPrice(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if strings.ContainsAny(text, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
		return text
	}
	return text + "gwei"
}

func extractTxHash(raw string) string {
	fields := strings.Fields(strings.TrimSpace(raw))
	for _, field := range fields {
		candidate := strings.Trim(strings.TrimSpace(field), `"'`)
		if len(candidate) != 66 || !strings.HasPrefix(candidate, "0x") {
			continue
		}
		if _, err := hex.DecodeString(candidate[2:]); err == nil {
			return candidate
		}
	}
	return ""
}

func weiToFloat64(value *big.Int, decimals int) float64 {
	if value == nil {
		return 0
	}
	if decimals < 0 {
		decimals = 0
	}
	scale := new(big.Float).SetFloat64(1)
	for range decimals {
		scale.Mul(scale, big.NewFloat(10))
	}
	raw := new(big.Float).SetInt(value)
	raw.Quo(raw, scale)
	floatValue, _ := raw.Float64()
	return floatValue
}
