package exchanges

import (
	"bytes"
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/base"
)

const evmDEXDefaultQuoteProtocol = "uniswap_v2"

var (
	evmDEXERC20ABI = evmDEXMustParseABI(`[
		{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},
		{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
		{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
		{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
	]`)
	evmDEXUniswapV2RouterABI = evmDEXMustParseABI(`[
		{"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"}],"name":"getAmountsOut","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"view","type":"function"}
	]`)
)

// FetchERC20Metadata returns symbol and decimals for an ERC20 token.
func (e *EVMDEX) FetchERC20Metadata(request base.EVMERC20MetadataRequest) (base.EVMERC20Metadata, error) {
	token, route, err := e.normalizeERC20TokenRoute(request.Chain, request.TokenAddress)
	if err != nil {
		return base.EVMERC20Metadata{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	decimals, err := e.fetchERC20Decimals(ctx, route, token)
	if err != nil {
		return base.EVMERC20Metadata{}, err
	}
	symbol, err := e.fetchERC20Symbol(ctx, route, token)
	if err != nil {
		symbol = ""
	}

	return base.EVMERC20Metadata{
		Chain:        route.Chain,
		ChainID:      route.ChainID,
		TokenAddress: token.Hex(),
		Symbol:       symbol,
		Decimals:     decimals,
	}, nil
}

// FetchERC20Balance returns balanceOf(owner) with token metadata.
func (e *EVMDEX) FetchERC20Balance(request base.EVMERC20BalanceRequest) (base.EVMERC20Balance, error) {
	ownerAddress := firstNonEmptyString(request.OwnerAddress, e.address)
	if !common.IsHexAddress(strings.TrimSpace(ownerAddress)) {
		return base.EVMERC20Balance{}, base.InvalidOrder{Message: "invalid owner address"}
	}
	metadata, err := e.FetchERC20Metadata(base.EVMERC20MetadataRequest{
		Chain:        request.Chain,
		TokenAddress: request.TokenAddress,
	})
	if err != nil {
		return base.EVMERC20Balance{}, err
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return base.EVMERC20Balance{}, err
	}
	token := common.HexToAddress(metadata.TokenAddress)
	owner := common.HexToAddress(ownerAddress)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	payload, err := evmDEXERC20ABI.Pack("balanceOf", owner)
	if err != nil {
		return base.EVMERC20Balance{}, base.ExchangeError{Message: fmt.Sprintf("pack erc20 balanceOf: %v", err)}
	}
	output, err := e.callEVMView(ctx, route, token, payload)
	if err != nil {
		return base.EVMERC20Balance{}, err
	}
	balanceWei, err := unpackBigInt(evmDEXERC20ABI, "balanceOf", output)
	if err != nil {
		return base.EVMERC20Balance{}, base.ExchangeError{Message: fmt.Sprintf("decode erc20 balanceOf: %v", err)}
	}

	return base.EVMERC20Balance{
		EVMERC20Metadata: metadata,
		OwnerAddress:     owner.Hex(),
		BalanceWei:       balanceWei.String(),
		BalanceFormatted: formatBaseUnits(balanceWei, metadata.Decimals),
	}, nil
}

// FetchERC20Allowance returns allowance(owner, spender) with token metadata.
func (e *EVMDEX) FetchERC20Allowance(request base.EVMERC20AllowanceRequest) (base.EVMERC20Allowance, error) {
	ownerAddress := firstNonEmptyString(request.OwnerAddress, e.address)
	if !common.IsHexAddress(strings.TrimSpace(ownerAddress)) {
		return base.EVMERC20Allowance{}, base.InvalidOrder{Message: "invalid owner address"}
	}
	if !common.IsHexAddress(strings.TrimSpace(request.SpenderAddress)) {
		return base.EVMERC20Allowance{}, base.InvalidOrder{Message: "invalid spender address"}
	}
	metadata, err := e.FetchERC20Metadata(base.EVMERC20MetadataRequest{
		Chain:        request.Chain,
		TokenAddress: request.TokenAddress,
	})
	if err != nil {
		return base.EVMERC20Allowance{}, err
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return base.EVMERC20Allowance{}, err
	}
	token := common.HexToAddress(metadata.TokenAddress)
	owner := common.HexToAddress(ownerAddress)
	spender := common.HexToAddress(request.SpenderAddress)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	payload, err := evmDEXERC20ABI.Pack("allowance", owner, spender)
	if err != nil {
		return base.EVMERC20Allowance{}, base.ExchangeError{Message: fmt.Sprintf("pack erc20 allowance: %v", err)}
	}
	output, err := e.callEVMView(ctx, route, token, payload)
	if err != nil {
		return base.EVMERC20Allowance{}, err
	}
	allowanceWei, err := unpackBigInt(evmDEXERC20ABI, "allowance", output)
	if err != nil {
		return base.EVMERC20Allowance{}, base.ExchangeError{Message: fmt.Sprintf("decode erc20 allowance: %v", err)}
	}

	return base.EVMERC20Allowance{
		EVMERC20Metadata:   metadata,
		OwnerAddress:       owner.Hex(),
		SpenderAddress:     spender.Hex(),
		AllowanceWei:       allowanceWei.String(),
		AllowanceFormatted: formatBaseUnits(allowanceWei, metadata.Decimals),
	}, nil
}

// QuoteExactInput returns a Uniswap V2-compatible getAmountsOut quote.
func (e *EVMDEX) QuoteExactInput(request base.EVMDEXQuoteRequest) (base.EVMDEXQuote, error) {
	protocol := normalizeQuoteProtocol(request.Protocol)
	if protocol != evmDEXDefaultQuoteProtocol {
		return base.EVMDEXQuote{}, base.InvalidOrder{Message: fmt.Sprintf("unsupported dex quote protocol: %s", request.Protocol)}
	}
	if !common.IsHexAddress(strings.TrimSpace(request.RouterAddress)) {
		return base.EVMDEXQuote{}, base.InvalidOrder{Message: "invalid router address"}
	}
	if len(request.Path) < 2 {
		return base.EVMDEXQuote{}, base.InvalidOrder{Message: "quote path requires at least 2 token addresses"}
	}
	path := make([]common.Address, 0, len(request.Path))
	pathText := make([]string, 0, len(request.Path))
	for _, candidate := range request.Path {
		if !common.IsHexAddress(strings.TrimSpace(candidate)) {
			return base.EVMDEXQuote{}, base.InvalidOrder{Message: fmt.Sprintf("invalid quote path token address: %s", candidate)}
		}
		address := common.HexToAddress(candidate)
		path = append(path, address)
		pathText = append(pathText, address.Hex())
	}
	amountInWei, err := parseExactWei(request.AmountInWei)
	if err != nil {
		return base.EVMDEXQuote{}, base.InvalidOrder{Message: fmt.Sprintf("invalid amount_in_wei: %v", err)}
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return base.EVMDEXQuote{}, err
	}
	router := common.HexToAddress(request.RouterAddress)

	payload, err := evmDEXUniswapV2RouterABI.Pack("getAmountsOut", amountInWei, path)
	if err != nil {
		return base.EVMDEXQuote{}, base.ExchangeError{Message: fmt.Sprintf("pack getAmountsOut: %v", err)}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	output, err := e.callEVMView(ctx, route, router, payload)
	if err != nil {
		return base.EVMDEXQuote{}, err
	}
	amounts, err := unpackBigIntSlice(evmDEXUniswapV2RouterABI, "getAmountsOut", output)
	if err != nil {
		return base.EVMDEXQuote{}, base.ExchangeError{Message: fmt.Sprintf("decode getAmountsOut: %v", err)}
	}
	if len(amounts) == 0 {
		return base.EVMDEXQuote{}, base.ExchangeError{Message: "getAmountsOut returned no amounts"}
	}
	amountsText := make([]string, 0, len(amounts))
	for _, amount := range amounts {
		if amount == nil {
			amountsText = append(amountsText, "0")
			continue
		}
		amountsText = append(amountsText, amount.String())
	}
	amountOutWei := "0"
	if last := amounts[len(amounts)-1]; last != nil {
		amountOutWei = last.String()
	}

	return base.EVMDEXQuote{
		Chain:         route.Chain,
		ChainID:       route.ChainID,
		Protocol:      protocol,
		RouterAddress: router.Hex(),
		AmountInWei:   amountInWei.String(),
		AmountOutWei:  amountOutWei,
		Path:          pathText,
		AmountsWei:    amountsText,
	}, nil
}

func (e *EVMDEX) normalizeERC20TokenRoute(chain, tokenAddress string) (common.Address, evmChainRoute, error) {
	if !common.IsHexAddress(strings.TrimSpace(tokenAddress)) {
		return common.Address{}, evmChainRoute{}, base.InvalidOrder{Message: "invalid token address"}
	}
	route, err := e.resolveChainRoute(chain)
	if err != nil {
		return common.Address{}, evmChainRoute{}, err
	}
	return common.HexToAddress(tokenAddress), route, nil
}

func (e *EVMDEX) fetchERC20Symbol(ctx context.Context, route evmChainRoute, token common.Address) (string, error) {
	payload, err := evmDEXERC20ABI.Pack("symbol")
	if err != nil {
		return "", base.ExchangeError{Message: fmt.Sprintf("pack erc20 symbol: %v", err)}
	}
	output, err := e.callEVMView(ctx, route, token, payload)
	if err != nil {
		return "", err
	}
	values, err := evmDEXERC20ABI.Unpack("symbol", output)
	if err == nil && len(values) == 1 {
		if symbol, ok := values[0].(string); ok {
			return strings.TrimSpace(symbol), nil
		}
	}
	if symbol, ok := decodeBytes32Symbol(output); ok {
		return symbol, nil
	}
	if err != nil {
		return "", fmt.Errorf("decode erc20 symbol: %w", err)
	}
	return "", fmt.Errorf("decode erc20 symbol: unexpected output")
}

func (e *EVMDEX) fetchERC20Decimals(ctx context.Context, route evmChainRoute, token common.Address) (uint8, error) {
	payload, err := evmDEXERC20ABI.Pack("decimals")
	if err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("pack erc20 decimals: %v", err)}
	}
	output, err := e.callEVMView(ctx, route, token, payload)
	if err != nil {
		return 0, err
	}
	values, err := evmDEXERC20ABI.Unpack("decimals", output)
	if err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("decode erc20 decimals: %v", err)}
	}
	if len(values) != 1 {
		return 0, base.ExchangeError{Message: "decode erc20 decimals: unexpected output"}
	}
	decimals, err := uint8FromABIValue(values[0])
	if err != nil {
		return 0, base.ExchangeError{Message: fmt.Sprintf("decode erc20 decimals: %v", err)}
	}
	return decimals, nil
}

func (e *EVMDEX) callEVMView(ctx context.Context, route evmChainRoute, to common.Address, payload []byte) ([]byte, error) {
	client, err := ethclient.DialContext(ctx, route.RPCURL)
	if err != nil {
		return nil, base.NetworkError{Message: fmt.Sprintf("eth rpc dial failed: %v", err)}
	}
	defer client.Close()

	output, err := client.CallContract(ctx, ethereum.CallMsg{
		To:   &to,
		Data: payload,
	}, nil)
	if err != nil {
		return nil, base.NetworkError{Message: fmt.Sprintf("eth_call failed: %v", err)}
	}
	return output, nil
}

func normalizeQuoteProtocol(raw string) string {
	text := normalizeChainSlug(raw)
	switch text {
	case "", "uniswap-v2", "uniswapv2", "v2":
		return evmDEXDefaultQuoteProtocol
	default:
		return strings.ReplaceAll(text, "-", "_")
	}
}

func parseExactWei(raw string) (*big.Int, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, fmt.Errorf("amount required")
	}
	text = strings.TrimSuffix(strings.TrimSuffix(text, "wei"), "WEI")
	value := new(big.Int)
	if _, ok := value.SetString(text, 10); !ok {
		return nil, fmt.Errorf("invalid integer: %s", raw)
	}
	if value.Sign() < 0 {
		return nil, fmt.Errorf("amount cannot be negative")
	}
	return value, nil
}

func unpackBigInt(contractABI abi.ABI, method string, output []byte) (*big.Int, error) {
	values, err := contractABI.Unpack(method, output)
	if err != nil {
		return nil, err
	}
	if len(values) != 1 {
		return nil, fmt.Errorf("unexpected output count: %d", len(values))
	}
	value, ok := values[0].(*big.Int)
	if !ok || value == nil {
		return nil, fmt.Errorf("unexpected integer output type: %T", values[0])
	}
	return value, nil
}

func unpackBigIntSlice(contractABI abi.ABI, method string, output []byte) ([]*big.Int, error) {
	values, err := contractABI.Unpack(method, output)
	if err != nil {
		return nil, err
	}
	if len(values) != 1 {
		return nil, fmt.Errorf("unexpected output count: %d", len(values))
	}
	amounts, ok := values[0].([]*big.Int)
	if !ok {
		return nil, fmt.Errorf("unexpected uint256[] output type: %T", values[0])
	}
	return amounts, nil
}

func uint8FromABIValue(value any) (uint8, error) {
	switch typed := value.(type) {
	case uint8:
		return typed, nil
	case uint16:
		if typed <= 255 {
			return uint8(typed), nil
		}
	case uint64:
		if typed <= 255 {
			return uint8(typed), nil
		}
	case *big.Int:
		if typed != nil && typed.Sign() >= 0 && typed.BitLen() <= 8 {
			return uint8(typed.Uint64()), nil
		}
	}
	return 0, fmt.Errorf("unexpected uint8 output type: %T", value)
}

func decodeBytes32Symbol(output []byte) (string, bool) {
	if len(output) != 32 {
		return "", false
	}
	text := strings.TrimSpace(string(bytes.TrimRight(output, "\x00")))
	if text == "" {
		return "", false
	}
	return text, true
}

func formatBaseUnits(value *big.Int, decimals uint8) string {
	if value == nil {
		return "0"
	}
	if decimals == 0 {
		return value.String()
	}
	scale := new(big.Int).Exp(big.NewInt(10), new(big.Int).SetUint64(uint64(decimals)), nil)
	integer := new(big.Int).Quo(new(big.Int).Set(value), scale)
	fraction := new(big.Int).Mod(new(big.Int).Set(value), scale)
	if fraction.Sign() == 0 {
		return integer.String()
	}
	fractionText := fraction.String()
	for len(fractionText) < int(decimals) {
		fractionText = "0" + fractionText
	}
	fractionText = strings.TrimRight(fractionText, "0")
	if fractionText == "" {
		return integer.String()
	}
	return integer.String() + "." + fractionText
}

func evmDEXMustParseABI(raw string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}
