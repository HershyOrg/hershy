package basis

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

func TestExecutorOpenAndClose(t *testing.T) {
	store, err := NewPositionStore(filepath.Join(t.TempDir(), "positions.json"))
	if err != nil {
		t.Fatalf("NewPositionStore: %v", err)
	}
	dex := &fakeDEX{}
	futures := &fakeFutures{}
	executor := &Executor{
		DEX:     dex,
		Futures: futures,
		Store:   store,
		Now:     func() time.Time { return time.Unix(1700000000, 0).UTC() },
	}

	open, err := executor.Open(OpenRequest{
		ID:              "TEST-1",
		Asset:           "TEST",
		Chain:           "bsc",
		NotionalQuote:   "10",
		EntryDEXPrice:   "1",
		EntryCEXBid:     "1.1",
		EntryGapPct:     "10",
		PoolAddress:     "0x0000000000000000000000000000000000000004",
		QuoterAddress:   "0x0000000000000000000000000000000000000001",
		RouterAddress:   "0x0000000000000000000000000000000000000002",
		TokenAddress:    "0x000000000000000000000000000000000000000a",
		QuoteAddress:    "0x000000000000000000000000000000000000000b",
		QuoteSymbol:     "USDT",
		AmountInWei:     "1000",
		SlippageBps:     100,
		FuturesSymbol:   "TESTUSDT",
		FuturesQuantity: "2.1234",
		Leverage:        2,
		RecordDryRun:    true,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if open.Position.ID != "TEST-1" || open.Position.Spot.UniswapV3Fee != 2500 {
		t.Fatalf("unexpected open position: %#v", open.Position)
	}
	if dex.lastSwap.AmountOutMinimumWei != "1980" {
		t.Fatalf("open min out = %s, want 1980", dex.lastSwap.AmountOutMinimumWei)
	}
	if futures.lastOrder.Side != models.OrderSideSell || futures.lastOrder.Quantity != "2.123" {
		t.Fatalf("unexpected futures open order: %#v", futures.lastOrder)
	}
	active, err := store.Active()
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active = %#v, want one", active)
	}

	closeResult, err := executor.Close(CloseRequest{
		PositionID:     "TEST-1",
		Reason:         "force",
		SlippageBps:    100,
		RecordDryRun:   true,
		WaitForReceipt: false,
	})
	if err != nil {
		t.Fatalf("Close: %v", err)
	}
	if closeResult.Position.Status != PositionStatusClosed || closeResult.Position.CloseReason != "force" {
		t.Fatalf("unexpected closed position: %#v", closeResult.Position)
	}
	if dex.lastSwap.AmountOutMinimumWei != "891" {
		t.Fatalf("close min out = %s, want 891", dex.lastSwap.AmountOutMinimumWei)
	}
	if futures.lastOrder.Side != models.OrderSideBuy || !futures.lastOrder.ReduceOnly {
		t.Fatalf("unexpected futures close order: %#v", futures.lastOrder)
	}
	active, err = store.Active()
	if err != nil {
		t.Fatalf("Active after close: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("active after close = %#v, want none", active)
	}
}

func TestSlippageFloorWei(t *testing.T) {
	got, err := SlippageFloorWei("12345", 100)
	if err != nil {
		t.Fatalf("SlippageFloorWei: %v", err)
	}
	if got != "12221" {
		t.Fatalf("got %s, want 12221", got)
	}
}

type fakeDEX struct {
	lastSwap base.UniswapV3SwapExactInputSingleRequest
	swaps    int
}

func (f *fakeDEX) FetchUniswapV3PoolInfo(request base.UniswapV3PoolRequest) (base.UniswapV3PoolInfo, error) {
	return base.UniswapV3PoolInfo{
		Chain:       request.Chain,
		ChainID:     56,
		PoolAddress: request.PoolAddress,
		Token0:      "0x000000000000000000000000000000000000000A",
		Token1:      "0x000000000000000000000000000000000000000b",
		Fee:         2500,
	}, nil
}

func (f *fakeDEX) QuoteUniswapV3ExactInputSingle(request base.UniswapV3QuoteExactInputSingleRequest) (base.UniswapV3QuoteExactInputSingle, error) {
	amountOut := "2000"
	if request.TokenIn == "0x000000000000000000000000000000000000000a" || request.TokenIn == "0x000000000000000000000000000000000000000A" {
		amountOut = "900"
	}
	return base.UniswapV3QuoteExactInputSingle{
		Chain:         request.Chain,
		ChainID:       56,
		QuoterAddress: request.QuoterAddress,
		TokenIn:       request.TokenIn,
		TokenOut:      request.TokenOut,
		Fee:           request.Fee,
		AmountInWei:   request.AmountInWei,
		AmountOutWei:  amountOut,
	}, nil
}

func (f *fakeDEX) EnsureERC20Approval(request base.ERC20ApprovalRequest) (base.ERC20ApprovalResult, error) {
	return base.ERC20ApprovalResult{
		Chain:             request.Chain,
		ChainID:           56,
		TokenAddress:      request.TokenAddress,
		SpenderAddress:    request.SpenderAddress,
		RequiredAmountWei: request.AmountWei,
		ApproveAmountWei:  request.AmountWei,
		AlreadyApproved:   true,
		DryRun:            request.DryRun,
	}, nil
}

func (f *fakeDEX) SwapUniswapV3ExactInputSingle(request base.UniswapV3SwapExactInputSingleRequest) (base.UniswapV3SwapExactInputSingleResult, error) {
	f.swaps++
	f.lastSwap = request
	return base.UniswapV3SwapExactInputSingleResult{
		Chain:               request.Chain,
		ChainID:             56,
		RouterAddress:       request.RouterAddress,
		TokenIn:             request.TokenIn,
		TokenOut:            request.TokenOut,
		Fee:                 request.Fee,
		AmountInWei:         request.AmountInWei,
		AmountOutMinimumWei: request.AmountOutMinimumWei,
		TxHash:              "0xswap",
	}, nil
}

type fakeFutures struct {
	lastOrder base.FuturesOrderRequest
}

func (f *fakeFutures) SetLeverage(symbol string, leverage int) (base.FuturesLeverageResult, error) {
	return base.FuturesLeverageResult{Symbol: symbol, Leverage: leverage}, nil
}

func (f *fakeFutures) PlaceFuturesOrder(request base.FuturesOrderRequest) (base.FuturesOrder, error) {
	f.lastOrder = request
	return base.FuturesOrder{
		ID:               "order-1",
		Symbol:           request.Symbol,
		Side:             request.Side,
		Type:             request.Type,
		Quantity:         request.Quantity,
		ExecutedQuantity: request.Quantity,
		ReduceOnly:       request.ReduceOnly,
		PositionSide:     request.PositionSide,
		Raw:              map[string]any{"id": "order-1"},
	}, nil
}

func (f *fakeFutures) FetchFuturesOrder(symbol, orderID string) (base.FuturesOrder, error) {
	return base.FuturesOrder{ID: orderID, Symbol: symbol}, nil
}

func (f *fakeFutures) FetchFuturesPositions(symbol *string, params map[string]any) ([]base.FuturesPosition, error) {
	return nil, nil
}

func (f *fakeFutures) FuturesQuantityRules(symbol string) (base.FuturesQuantityRules, error) {
	return base.FuturesQuantityRules{Symbol: symbol, StepSize: "0.001"}, nil
}

func (f *fakeFutures) RoundFuturesQuantity(symbol string, quantity string) (string, error) {
	if quantity == "2.1234" {
		return "2.123", nil
	}
	return quantity, nil
}
