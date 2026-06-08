package exchanges

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/base"
)

var (
	evmDEXUniswapV3PoolABI = evmDEXMustParseABI(`[
		{"inputs":[],"name":"fee","outputs":[{"internalType":"uint24","name":"","type":"uint24"}],"stateMutability":"view","type":"function"},
		{"inputs":[],"name":"token0","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
		{"inputs":[],"name":"token1","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"}
	]`)
	evmDEXUniswapV3QuoterV2ABI = evmDEXMustParseABI(`[
		{"inputs":[{"components":[{"internalType":"address","name":"tokenIn","type":"address"},{"internalType":"address","name":"tokenOut","type":"address"},{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}],"internalType":"struct IQuoterV2.QuoteExactInputSingleParams","name":"params","type":"tuple"}],"name":"quoteExactInputSingle","outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"uint160","name":"sqrtPriceX96After","type":"uint160"},{"internalType":"uint32","name":"initializedTicksCrossed","type":"uint32"},{"internalType":"uint256","name":"gasEstimate","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}
	]`)
	evmDEXUniswapV3RouterABI = evmDEXMustParseABI(`[
		{"inputs":[{"components":[{"internalType":"address","name":"tokenIn","type":"address"},{"internalType":"address","name":"tokenOut","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMinimum","type":"uint256"},{"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}],"internalType":"struct IV3SwapRouter.ExactInputSingleParams","name":"params","type":"tuple"}],"name":"exactInputSingle","outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],"stateMutability":"payable","type":"function"}
	]`)
	evmDEXERC20ApprovalABI = evmDEXMustParseABI(`[
		{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}
	]`)
	erc20TransferTopic = common.HexToHash("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
	maxUint256         = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
)

const maxUniswapV3Fee = 1<<24 - 1

type uniswapV3QuoteExactInputSingleParams struct {
	TokenIn           common.Address
	TokenOut          common.Address
	AmountIn          *big.Int
	Fee               *big.Int
	SqrtPriceLimitX96 *big.Int
}

type uniswapV3SwapExactInputSingleParams struct {
	TokenIn           common.Address
	TokenOut          common.Address
	Fee               *big.Int
	Recipient         common.Address
	AmountIn          *big.Int
	AmountOutMinimum  *big.Int
	SqrtPriceLimitX96 *big.Int
}

var _ base.UniswapV3Executor = (*EVMDEX)(nil)

// FetchUniswapV3PoolInfo returns fee/token0/token1 for a Uniswap V3-compatible pool.
func (e *EVMDEX) FetchUniswapV3PoolInfo(request base.UniswapV3PoolRequest) (base.UniswapV3PoolInfo, error) {
	if !common.IsHexAddress(strings.TrimSpace(request.PoolAddress)) {
		return base.UniswapV3PoolInfo{}, base.InvalidOrder{Message: "invalid Uniswap V3 pool address"}
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return base.UniswapV3PoolInfo{}, err
	}
	pool := common.HexToAddress(request.PoolAddress)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	token0, err := e.callAddressView(ctx, route, pool, evmDEXUniswapV3PoolABI, "token0")
	if err != nil {
		return base.UniswapV3PoolInfo{}, fmtABIError("uniswap v3 token0", err)
	}
	token1, err := e.callAddressView(ctx, route, pool, evmDEXUniswapV3PoolABI, "token1")
	if err != nil {
		return base.UniswapV3PoolInfo{}, fmtABIError("uniswap v3 token1", err)
	}
	fee, err := e.callUint32View(ctx, route, pool, evmDEXUniswapV3PoolABI, "fee")
	if err != nil {
		return base.UniswapV3PoolInfo{}, fmtABIError("uniswap v3 fee", err)
	}

	return base.UniswapV3PoolInfo{
		Chain:       route.Chain,
		ChainID:     route.ChainID,
		PoolAddress: pool.Hex(),
		Token0:      token0.Hex(),
		Token1:      token1.Hex(),
		Fee:         fee,
	}, nil
}

// QuoteUniswapV3ExactInputSingle calls a Uniswap V3 QuoterV2 exact-input single-hop quote.
func (e *EVMDEX) QuoteUniswapV3ExactInputSingle(request base.UniswapV3QuoteExactInputSingleRequest) (base.UniswapV3QuoteExactInputSingle, error) {
	quoter, tokenIn, tokenOut, amountIn, sqrtPriceLimit, route, err := e.normalizeUniswapV3QuoteRequest(request)
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, err
	}
	params := uniswapV3QuoteExactInputSingleParams{
		TokenIn:           tokenIn,
		TokenOut:          tokenOut,
		AmountIn:          amountIn,
		Fee:               new(big.Int).SetUint64(uint64(request.Fee)),
		SqrtPriceLimitX96: sqrtPriceLimit,
	}
	payload, err := evmDEXUniswapV3QuoterV2ABI.Pack("quoteExactInputSingle", params)
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: fmt.Sprintf("pack quoteExactInputSingle: %v", err)}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	output, err := e.callEVMView(ctx, route, quoter, payload)
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, err
	}
	values, err := evmDEXUniswapV3QuoterV2ABI.Unpack("quoteExactInputSingle", output)
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: fmt.Sprintf("decode quoteExactInputSingle: %v", err)}
	}
	if len(values) != 4 {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: "decode quoteExactInputSingle: unexpected output count"}
	}
	amountOut, err := bigIntFromABIValue(values[0])
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: fmt.Sprintf("decode quote amountOut: %v", err)}
	}
	sqrtPriceAfter, err := bigIntFromABIValue(values[1])
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: fmt.Sprintf("decode quote sqrtPriceX96After: %v", err)}
	}
	ticksCrossed, err := uint32FromABIValue(values[2])
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: fmt.Sprintf("decode quote initializedTicksCrossed: %v", err)}
	}
	gasEstimate, err := bigIntFromABIValue(values[3])
	if err != nil {
		return base.UniswapV3QuoteExactInputSingle{}, base.ExchangeError{Message: fmt.Sprintf("decode quote gasEstimate: %v", err)}
	}

	return base.UniswapV3QuoteExactInputSingle{
		Chain:                   route.Chain,
		ChainID:                 route.ChainID,
		QuoterAddress:           quoter.Hex(),
		TokenIn:                 tokenIn.Hex(),
		TokenOut:                tokenOut.Hex(),
		Fee:                     request.Fee,
		AmountInWei:             amountIn.String(),
		AmountOutWei:            amountOut.String(),
		SqrtPriceX96AfterWei:    sqrtPriceAfter.String(),
		InitializedTicksCrossed: ticksCrossed,
		GasEstimate:             gasEstimate.String(),
	}, nil
}

// EnsureERC20Approval checks allowance and submits approve when needed.
func (e *EVMDEX) EnsureERC20Approval(request base.ERC20ApprovalRequest) (base.ERC20ApprovalResult, error) {
	token, spender, owner, requiredAmount, approveAmount, route, err := e.normalizeApprovalRequest(request)
	if err != nil {
		return base.ERC20ApprovalResult{}, err
	}
	allowance, err := e.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
		Chain:          request.Chain,
		TokenAddress:   token.Hex(),
		OwnerAddress:   owner.Hex(),
		SpenderAddress: spender.Hex(),
	})
	if err != nil {
		return base.ERC20ApprovalResult{}, err
	}
	allowanceBefore, err := parseExactWei(allowance.AllowanceWei)
	if err != nil {
		return base.ERC20ApprovalResult{}, base.ExchangeError{Message: fmt.Sprintf("decode allowance: %v", err)}
	}
	result := base.ERC20ApprovalResult{
		Chain:              route.Chain,
		ChainID:            route.ChainID,
		TokenAddress:       token.Hex(),
		OwnerAddress:       owner.Hex(),
		SpenderAddress:     spender.Hex(),
		RequiredAmountWei:  requiredAmount.String(),
		AllowanceBeforeWei: allowanceBefore.String(),
		ApproveAmountWei:   approveAmount.String(),
		AlreadyApproved:    allowanceBefore.Cmp(requiredAmount) >= 0,
		DryRun:             request.DryRun,
	}
	if result.AlreadyApproved || request.DryRun {
		return result, nil
	}

	payload, err := evmDEXERC20ApprovalABI.Pack("approve", spender, approveAmount)
	if err != nil {
		return base.ERC20ApprovalResult{}, base.ExchangeError{Message: fmt.Sprintf("pack erc20 approve: %v", err)}
	}
	tx, err := e.ExecuteEVMTransaction(base.EVMDEXRequest{
		Chain:           route.Chain,
		ContractAddress: token.Hex(),
		Calldata:        "0x" + common.Bytes2Hex(payload),
		FunctionName:    "approve",
		StateMutability: "nonpayable",
	})
	if err != nil {
		return base.ERC20ApprovalResult{}, err
	}
	result.TxHash = tx.TxHash
	if !request.WaitForReceipt {
		return result, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	receipt, err := e.waitForReceipt(ctx, route, tx.TxHash)
	if err != nil {
		return base.ERC20ApprovalResult{}, err
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return result, base.ExchangeError{Message: fmt.Sprintf("erc20 approve reverted: %s", tx.TxHash)}
	}
	return result, nil
}

// SwapUniswapV3ExactInputSingle submits a Uniswap V3 exactInputSingle swap.
func (e *EVMDEX) SwapUniswapV3ExactInputSingle(request base.UniswapV3SwapExactInputSingleRequest) (base.UniswapV3SwapExactInputSingleResult, error) {
	router, tokenIn, tokenOut, recipient, amountIn, amountOutMinimum, sqrtPriceLimit, valueWei, route, err := e.normalizeUniswapV3SwapRequest(request)
	if err != nil {
		return base.UniswapV3SwapExactInputSingleResult{}, err
	}
	result := base.UniswapV3SwapExactInputSingleResult{
		Chain:               route.Chain,
		ChainID:             route.ChainID,
		RouterAddress:       router.Hex(),
		TokenIn:             tokenIn.Hex(),
		TokenOut:            tokenOut.Hex(),
		Fee:                 request.Fee,
		Recipient:           recipient.Hex(),
		AmountInWei:         amountIn.String(),
		AmountOutMinimumWei: amountOutMinimum.String(),
		ValueWei:            valueWei.String(),
		DryRun:              request.DryRun,
	}
	if request.DryRun {
		return result, nil
	}

	params := uniswapV3SwapExactInputSingleParams{
		TokenIn:           tokenIn,
		TokenOut:          tokenOut,
		Fee:               new(big.Int).SetUint64(uint64(request.Fee)),
		Recipient:         recipient,
		AmountIn:          amountIn,
		AmountOutMinimum:  amountOutMinimum,
		SqrtPriceLimitX96: sqrtPriceLimit,
	}
	payload, err := evmDEXUniswapV3RouterABI.Pack("exactInputSingle", params)
	if err != nil {
		return base.UniswapV3SwapExactInputSingleResult{}, base.ExchangeError{Message: fmt.Sprintf("pack exactInputSingle: %v", err)}
	}
	txValue := ""
	if valueWei.Sign() > 0 {
		txValue = valueWei.String() + "wei"
	}
	tx, err := e.ExecuteEVMTransaction(base.EVMDEXRequest{
		Chain:           route.Chain,
		ContractAddress: router.Hex(),
		Calldata:        "0x" + common.Bytes2Hex(payload),
		Value:           txValue,
		FunctionName:    "exactInputSingle",
		StateMutability: "payable",
	})
	if err != nil {
		return base.UniswapV3SwapExactInputSingleResult{}, err
	}
	result.TxHash = tx.TxHash
	if !request.WaitForReceipt {
		return result, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	receipt, err := e.waitForReceipt(ctx, route, tx.TxHash)
	if err != nil {
		return base.UniswapV3SwapExactInputSingleResult{}, err
	}
	result.GasUsed = receipt.GasUsed
	result.ReceiptStatus = receipt.Status
	if receipt.EffectiveGasPrice != nil {
		result.EffectiveGasPriceWei = receipt.EffectiveGasPrice.String()
	}
	result.ObservedAmountOutWei = observedERC20TransfersTo(receipt, tokenOut, recipient).String()
	if receipt.Status != types.ReceiptStatusSuccessful {
		return result, base.ExchangeError{Message: fmt.Sprintf("uniswap v3 swap reverted: %s", tx.TxHash)}
	}
	return result, nil
}

func (e *EVMDEX) normalizeUniswapV3QuoteRequest(request base.UniswapV3QuoteExactInputSingleRequest) (common.Address, common.Address, common.Address, *big.Int, *big.Int, evmChainRoute, error) {
	if !common.IsHexAddress(strings.TrimSpace(request.QuoterAddress)) {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "invalid Uniswap V3 quoter address"}
	}
	if request.Fee == 0 {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "Uniswap V3 fee is required"}
	}
	if request.Fee > maxUniswapV3Fee {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "Uniswap V3 fee exceeds uint24"}
	}
	tokenIn, tokenOut, err := normalizeTokenPair(request.TokenIn, request.TokenOut)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, err
	}
	amountIn, err := parseExactWei(request.AmountInWei)
	if err != nil || amountIn.Sign() <= 0 {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid amount_in_wei: %v", err)}
	}
	sqrtPriceLimit, err := parseOptionalWei(request.SqrtPriceLimitX96Wei)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid sqrt_price_limit_x96_wei: %v", err)}
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, err
	}
	return common.HexToAddress(request.QuoterAddress), tokenIn, tokenOut, amountIn, sqrtPriceLimit, route, nil
}

func (e *EVMDEX) normalizeUniswapV3SwapRequest(request base.UniswapV3SwapExactInputSingleRequest) (common.Address, common.Address, common.Address, common.Address, *big.Int, *big.Int, *big.Int, *big.Int, evmChainRoute, error) {
	if !common.IsHexAddress(strings.TrimSpace(request.RouterAddress)) {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "invalid Uniswap V3 router address"}
	}
	if request.Fee == 0 {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "Uniswap V3 fee is required"}
	}
	if request.Fee > maxUniswapV3Fee {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "Uniswap V3 fee exceeds uint24"}
	}
	tokenIn, tokenOut, err := normalizeTokenPair(request.TokenIn, request.TokenOut)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, err
	}
	recipientText := firstNonEmptyString(request.Recipient, e.address)
	if !common.IsHexAddress(strings.TrimSpace(recipientText)) {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "invalid Uniswap V3 recipient address"}
	}
	amountIn, err := parseExactWei(request.AmountInWei)
	if err != nil || amountIn.Sign() <= 0 {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid amount_in_wei: %v", err)}
	}
	amountOutMinimum, err := parseExactWei(request.AmountOutMinimumWei)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid amount_out_minimum_wei: %v", err)}
	}
	sqrtPriceLimit, err := parseOptionalWei(request.SqrtPriceLimitX96Wei)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid sqrt_price_limit_x96_wei: %v", err)}
	}
	valueWei, err := parseOptionalWei(request.ValueWei)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid value_wei: %v", err)}
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, common.Address{}, nil, nil, nil, nil, evmChainRoute{}, err
	}
	return common.HexToAddress(request.RouterAddress), tokenIn, tokenOut, common.HexToAddress(recipientText), amountIn, amountOutMinimum, sqrtPriceLimit, valueWei, route, nil
}

func (e *EVMDEX) normalizeApprovalRequest(request base.ERC20ApprovalRequest) (common.Address, common.Address, common.Address, *big.Int, *big.Int, evmChainRoute, error) {
	if !common.IsHexAddress(strings.TrimSpace(request.TokenAddress)) {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "invalid token address"}
	}
	if !common.IsHexAddress(strings.TrimSpace(request.SpenderAddress)) {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "invalid spender address"}
	}
	ownerText := firstNonEmptyString(request.OwnerAddress, e.address)
	if !common.IsHexAddress(strings.TrimSpace(ownerText)) {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "invalid owner address"}
	}
	requiredAmount, err := parseExactWei(request.AmountWei)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid amount_wei: %v", err)}
	}
	approveAmount := new(big.Int).Set(maxUint256)
	if strings.TrimSpace(request.ApproveWei) != "" {
		approveAmount, err = parseExactWei(request.ApproveWei)
		if err != nil {
			return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: fmt.Sprintf("invalid approve_wei: %v", err)}
		}
		if approveAmount.Cmp(requiredAmount) < 0 {
			return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, base.InvalidOrder{Message: "approve_wei must be greater than or equal to amount_wei"}
		}
	}
	route, err := e.resolveChainRoute(request.Chain)
	if err != nil {
		return common.Address{}, common.Address{}, common.Address{}, nil, nil, evmChainRoute{}, err
	}
	return common.HexToAddress(request.TokenAddress), common.HexToAddress(request.SpenderAddress), common.HexToAddress(ownerText), requiredAmount, approveAmount, route, nil
}

func normalizeTokenPair(tokenInRaw, tokenOutRaw string) (common.Address, common.Address, error) {
	if !common.IsHexAddress(strings.TrimSpace(tokenInRaw)) {
		return common.Address{}, common.Address{}, base.InvalidOrder{Message: "invalid token_in address"}
	}
	if !common.IsHexAddress(strings.TrimSpace(tokenOutRaw)) {
		return common.Address{}, common.Address{}, base.InvalidOrder{Message: "invalid token_out address"}
	}
	tokenIn := common.HexToAddress(tokenInRaw)
	tokenOut := common.HexToAddress(tokenOutRaw)
	if tokenIn == tokenOut {
		return common.Address{}, common.Address{}, base.InvalidOrder{Message: "token_in and token_out must differ"}
	}
	return tokenIn, tokenOut, nil
}

func parseOptionalWei(raw string) (*big.Int, error) {
	if strings.TrimSpace(raw) == "" {
		return big.NewInt(0), nil
	}
	return parseExactWei(raw)
}

func (e *EVMDEX) callAddressView(ctx context.Context, route evmChainRoute, contract common.Address, contractABI abi.ABI, method string) (common.Address, error) {
	payload, err := contractABI.Pack(method)
	if err != nil {
		return common.Address{}, err
	}
	output, err := e.callEVMView(ctx, route, contract, payload)
	if err != nil {
		return common.Address{}, err
	}
	values, err := contractABI.Unpack(method, output)
	if err != nil {
		return common.Address{}, err
	}
	if len(values) != 1 {
		return common.Address{}, fmt.Errorf("unexpected output count: %d", len(values))
	}
	address, ok := values[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("unexpected address output type: %T", values[0])
	}
	return address, nil
}

func (e *EVMDEX) callUint32View(ctx context.Context, route evmChainRoute, contract common.Address, contractABI abi.ABI, method string) (uint32, error) {
	payload, err := contractABI.Pack(method)
	if err != nil {
		return 0, err
	}
	output, err := e.callEVMView(ctx, route, contract, payload)
	if err != nil {
		return 0, err
	}
	values, err := contractABI.Unpack(method, output)
	if err != nil {
		return 0, err
	}
	if len(values) != 1 {
		return 0, fmt.Errorf("unexpected output count: %d", len(values))
	}
	return uint32FromABIValue(values[0])
}

func (e *EVMDEX) waitForReceipt(ctx context.Context, route evmChainRoute, txHash string) (*types.Receipt, error) {
	if !isHexHash(txHash) {
		return nil, base.ExchangeError{Message: fmt.Sprintf("invalid tx hash: %s", txHash)}
	}
	client, err := ethclient.DialContext(ctx, route.RPCURL)
	if err != nil {
		return nil, base.NetworkError{Message: fmt.Sprintf("eth rpc dial failed: %v", err)}
	}
	defer client.Close()

	hash := common.HexToHash(txHash)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		receipt, err := client.TransactionReceipt(ctx, hash)
		if err == nil {
			return receipt, nil
		}
		if err != ethereum.NotFound {
			return nil, base.NetworkError{Message: fmt.Sprintf("eth_getTransactionReceipt failed: %v", err)}
		}
		select {
		case <-ctx.Done():
			return nil, base.NetworkError{Message: fmt.Sprintf("wait for receipt timed out: %v", ctx.Err())}
		case <-ticker.C:
		}
	}
}

func observedERC20TransfersTo(receipt *types.Receipt, token common.Address, recipient common.Address) *big.Int {
	total := big.NewInt(0)
	if receipt == nil {
		return total
	}
	recipientTopic := common.BytesToHash(recipient.Bytes())
	for _, log := range receipt.Logs {
		if log == nil || log.Address != token || len(log.Topics) < 3 {
			continue
		}
		if log.Topics[0] != erc20TransferTopic || log.Topics[2] != recipientTopic {
			continue
		}
		if len(log.Data) == 0 {
			continue
		}
		total.Add(total, new(big.Int).SetBytes(log.Data))
	}
	return total
}

func bigIntFromABIValue(value any) (*big.Int, error) {
	typed, ok := value.(*big.Int)
	if !ok || typed == nil {
		return nil, fmt.Errorf("unexpected integer output type: %T", value)
	}
	return typed, nil
}

func uint32FromABIValue(value any) (uint32, error) {
	switch typed := value.(type) {
	case uint8:
		return uint32(typed), nil
	case uint16:
		return uint32(typed), nil
	case uint32:
		return typed, nil
	case uint64:
		if typed <= uint64(^uint32(0)) {
			return uint32(typed), nil
		}
	case *big.Int:
		if typed != nil && typed.Sign() >= 0 && typed.BitLen() <= 32 {
			return uint32(typed.Uint64()), nil
		}
	}
	return 0, fmt.Errorf("unexpected uint32 output type: %T", value)
}

func fmtABIError(label string, err error) error {
	return base.ExchangeError{Message: fmt.Sprintf("%s: %v", label, err)}
}

func isHexHash(value string) bool {
	text := strings.TrimSpace(value)
	if strings.HasPrefix(text, "0x") || strings.HasPrefix(text, "0X") {
		text = text[2:]
	}
	if len(text) != 64 {
		return false
	}
	for _, char := range text {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
			continue
		}
		return false
	}
	return true
}
