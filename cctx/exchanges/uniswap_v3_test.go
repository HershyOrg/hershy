package exchanges

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/HershyOrg/hershy/cctx/base"
)

func TestNormalizeUniswapV3SwapRequest(t *testing.T) {
	ex := &EVMDEX{
		address: "0x00000000000000000000000000000000000000aa",
		rpcURL:  "http://127.0.0.1:8545",
		chainID: 56,
	}
	router, tokenIn, tokenOut, recipient, amountIn, minOut, sqrtLimit, valueWei, route, err := ex.normalizeUniswapV3SwapRequest(base.UniswapV3SwapExactInputSingleRequest{
		Chain:               "bsc",
		RouterAddress:       "0x0000000000000000000000000000000000000001",
		TokenIn:             "0x0000000000000000000000000000000000000002",
		TokenOut:            "0x0000000000000000000000000000000000000003",
		Fee:                 2500,
		AmountInWei:         "1000",
		AmountOutMinimumWei: "900",
	})
	if err != nil {
		t.Fatalf("normalizeUniswapV3SwapRequest: %v", err)
	}
	if router.Hex() != "0x0000000000000000000000000000000000000001" {
		t.Fatalf("router = %s", router.Hex())
	}
	if tokenIn == tokenOut {
		t.Fatalf("token pair was not normalized")
	}
	if recipient.Hex() != "0x00000000000000000000000000000000000000AA" {
		t.Fatalf("recipient = %s", recipient.Hex())
	}
	if amountIn.String() != "1000" || minOut.String() != "900" || sqrtLimit.Sign() != 0 || valueWei.Sign() != 0 {
		t.Fatalf("amounts = %s %s %s %s", amountIn, minOut, sqrtLimit, valueWei)
	}
	if route.Chain != "bsc" || route.ChainID != 56 {
		t.Fatalf("route = %#v", route)
	}
}

func TestPackUniswapV3ExactInputSingleParams(t *testing.T) {
	tokenIn := common.HexToAddress("0x0000000000000000000000000000000000000001")
	tokenOut := common.HexToAddress("0x0000000000000000000000000000000000000002")
	recipient := common.HexToAddress("0x0000000000000000000000000000000000000003")

	quotePayload, err := evmDEXUniswapV3QuoterV2ABI.Pack("quoteExactInputSingle", uniswapV3QuoteExactInputSingleParams{
		TokenIn:           tokenIn,
		TokenOut:          tokenOut,
		AmountIn:          big.NewInt(5_000_000_000_000_000_000),
		Fee:               big.NewInt(3000),
		SqrtPriceLimitX96: big.NewInt(0),
	})
	if err != nil {
		t.Fatalf("pack quoteExactInputSingle: %v", err)
	}
	if len(quotePayload) <= 4 {
		t.Fatalf("quote payload too short: %d", len(quotePayload))
	}

	swapPayload, err := evmDEXUniswapV3RouterABI.Pack("exactInputSingle", uniswapV3SwapExactInputSingleParams{
		TokenIn:           tokenIn,
		TokenOut:          tokenOut,
		Fee:               big.NewInt(3000),
		Recipient:         recipient,
		AmountIn:          big.NewInt(5_000_000_000_000_000_000),
		AmountOutMinimum:  big.NewInt(1),
		SqrtPriceLimitX96: big.NewInt(0),
	})
	if err != nil {
		t.Fatalf("pack exactInputSingle: %v", err)
	}
	if len(swapPayload) <= 4 {
		t.Fatalf("swap payload too short: %d", len(swapPayload))
	}
}

func TestPackUniswapV3SinglePairAdapterActions(t *testing.T) {
	tests := []struct {
		name       string
		action     base.UniswapV3AdapterAction
		amountIn   *big.Int
		minOut     *big.Int
		methodName string
	}{
		{
			name:       "open",
			action:     base.UniswapV3AdapterActionOpenPosition,
			amountIn:   big.NewInt(1000),
			minOut:     big.NewInt(900),
			methodName: "openPosition",
		},
		{
			name:       "close",
			action:     base.UniswapV3AdapterActionClosePosition,
			amountIn:   big.NewInt(1000),
			minOut:     big.NewInt(900),
			methodName: "closePosition",
		},
		{
			name:       "emergency",
			action:     base.UniswapV3AdapterActionEmergencyExit,
			amountIn:   big.NewInt(0),
			minOut:     big.NewInt(900),
			methodName: "emergencyExit",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload, functionName, err := packUniswapV3AdapterAction(test.action, test.amountIn, test.minOut)
			if err != nil {
				t.Fatalf("packUniswapV3AdapterAction: %v", err)
			}
			if functionName != test.methodName {
				t.Fatalf("functionName = %s, want %s", functionName, test.methodName)
			}
			method := evmDEXUniswapV3SinglePairAdapterABI.Methods[test.methodName]
			if len(payload) <= 4 || common.Bytes2Hex(payload[:4]) != common.Bytes2Hex(method.ID) {
				t.Fatalf("unexpected selector: got=0x%s want=0x%s", common.Bytes2Hex(payload[:4]), common.Bytes2Hex(method.ID))
			}
		})
	}
}

func TestNormalizeUniswapV3AdapterActionRequest(t *testing.T) {
	ex := &EVMDEX{
		address: "0x00000000000000000000000000000000000000aa",
		rpcURL:  "http://127.0.0.1:8545",
		chainID: 56,
	}
	adapter, action, amountIn, minOut, observedTokenOut, recipient, valueWei, route, err := ex.normalizeUniswapV3AdapterActionRequest(base.UniswapV3AdapterActionRequest{
		Chain:                   "bsc",
		AdapterAddress:          "0x0000000000000000000000000000000000000001",
		Action:                  base.UniswapV3AdapterActionOpenPosition,
		AmountInWei:             "1000",
		AmountOutMinimumWei:     "900",
		ObservedTokenOutAddress: "0x0000000000000000000000000000000000000002",
	})
	if err != nil {
		t.Fatalf("normalizeUniswapV3AdapterActionRequest: %v", err)
	}
	if adapter.Hex() != "0x0000000000000000000000000000000000000001" {
		t.Fatalf("adapter = %s", adapter.Hex())
	}
	if action != base.UniswapV3AdapterActionOpenPosition {
		t.Fatalf("action = %s", action)
	}
	if amountIn.String() != "1000" || minOut.String() != "900" || valueWei.Sign() != 0 {
		t.Fatalf("amounts = %s %s %s", amountIn, minOut, valueWei)
	}
	if observedTokenOut.Hex() != "0x0000000000000000000000000000000000000002" {
		t.Fatalf("observed token out = %s", observedTokenOut.Hex())
	}
	if recipient.Hex() != "0x00000000000000000000000000000000000000AA" {
		t.Fatalf("recipient = %s", recipient.Hex())
	}
	if route.Chain != "bsc" || route.ChainID != 56 {
		t.Fatalf("route = %#v", route)
	}
}

func TestObservedERC20TransfersTo(t *testing.T) {
	token := common.HexToAddress("0x0000000000000000000000000000000000000001")
	recipient := common.HexToAddress("0x0000000000000000000000000000000000000002")
	other := common.HexToAddress("0x0000000000000000000000000000000000000003")
	receipt := &types.Receipt{Logs: []*types.Log{
		{
			Address: token,
			Topics:  []common.Hash{erc20TransferTopic, common.BytesToHash(other.Bytes()), common.BytesToHash(recipient.Bytes())},
			Data:    big.NewInt(123).Bytes(),
		},
		{
			Address: token,
			Topics:  []common.Hash{erc20TransferTopic, common.BytesToHash(other.Bytes()), common.BytesToHash(recipient.Bytes())},
			Data:    big.NewInt(7).Bytes(),
		},
		{
			Address: token,
			Topics:  []common.Hash{erc20TransferTopic, common.BytesToHash(other.Bytes()), common.BytesToHash(other.Bytes())},
			Data:    big.NewInt(999).Bytes(),
		},
	}}
	if got := observedERC20TransfersTo(receipt, token, recipient); got.String() != "130" {
		t.Fatalf("observed = %s, want 130", got)
	}
}
