package basis_test

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/basis"
	"github.com/HershyOrg/hershy/cctx/models"
)

const (
	scenarioChain          = "bsc"
	scenarioAsset          = "TEST"
	scenarioUSDT           = "0x55d398326f99059fF775485246999027B3197955"
	scenarioAssetToken     = "0x1111111111111111111111111111111111111111"
	scenarioPool           = "0x2222222222222222222222222222222222222222"
	scenarioQuoterV2       = "0x78D78E420Da98ad378D7799bE8f4AF69033EB077"
	scenarioSwapRouter02   = "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2"
	scenarioAmountUSDTWei  = "10000000000000000000"
	scenarioSpotTokenOut   = "125000000000000000000"
	scenarioCloseUSDTOut   = "10100000000000000000"
	scenarioFuturesSymbol  = "TESTUSDT"
	scenarioRequestedShort = "125.123456789"
	scenarioRoundedShort   = "125.123"
)

func TestBSCUniswapV3BinanceFuturesBasisScenario(t *testing.T) {
	store, err := basis.NewPositionStore(filepath.Join(t.TempDir(), "positions.json"))
	if err != nil {
		t.Fatalf("NewPositionStore: %v", err)
	}

	recorder := &scenarioRecorder{}
	dex := &scenarioDEX{recorder: recorder}
	futures := &scenarioFutures{recorder: recorder}
	executor := &basis.Executor{
		DEX:     dex,
		Futures: futures,
		Store:   store,
		Now:     func() time.Time { return time.Unix(1_700_000_000, 0).UTC() },
	}

	openResult, err := executor.Open(basis.OpenRequest{
		ID:                  "basis-test-1",
		Asset:               scenarioAsset,
		Chain:               scenarioChain,
		NotionalQuote:       "10",
		EntryDEXPrice:       "0.08",
		EntryCEXBid:         "0.088",
		EntryGapPct:         "10",
		DEXID:               "uniswap_v3",
		PoolAddress:         scenarioPool,
		QuoterAddress:       scenarioQuoterV2,
		RouterAddress:       scenarioSwapRouter02,
		TokenAddress:        scenarioAssetToken,
		QuoteAddress:        scenarioUSDT,
		QuoteSymbol:         "USDT",
		AmountInWei:         scenarioAmountUSDTWei,
		SlippageBps:         100,
		FuturesExchange:     "binance_futures",
		FuturesSymbol:       scenarioFuturesSymbol,
		FuturesQuantity:     scenarioRequestedShort,
		FuturesPositionSide: base.FuturesPositionSideShort,
		Leverage:            1,
		DryRun:              true,
		RecordDryRun:        true,
		Metadata: map[string]any{
			"source": "scenario_test",
		},
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	assertEqual(t, openResult.Position.Status, basis.PositionStatusOpen, "open status")
	assertEqual(t, openResult.Position.Spot.TokenQtyWei, scenarioSpotTokenOut, "spot token qty")
	assertEqual(t, openResult.Position.Spot.EntryTxHash, "0xspot-entry", "spot entry tx")
	assertEqual(t, openResult.Position.Futures.EntryOrderID, "short-entry", "futures entry order")
	assertEqual(t, openResult.Position.Futures.Quantity, scenarioRoundedShort, "rounded futures qty")
	assertEqual(t, openResult.Swap.AmountOutMinimumWei, "123750000000000000000", "entry min token out")
	assertEqual(t, futures.orders[0].Side, models.OrderSideSell, "entry futures side")
	assertEqual(t, futures.orders[0].PositionSide, base.FuturesPositionSideShort, "entry futures position side")
	assertEqual(t, futures.orders[0].Test, true, "entry futures dry-run test flag")

	active, err := store.Active()
	if err != nil {
		t.Fatalf("Active after open: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active positions after open = %d, want 1", len(active))
	}

	closeResult, err := executor.Close(basis.CloseRequest{
		PositionID:   "basis-test-1",
		Reason:       "gap_converged:0.8",
		SlippageBps:  100,
		DryRun:       true,
		RecordDryRun: true,
	})
	if err != nil {
		t.Fatalf("Close: %v", err)
	}

	assertEqual(t, closeResult.Position.Status, basis.PositionStatusClosed, "close status")
	assertEqual(t, closeResult.Position.CloseReason, "gap_converged:0.8", "close reason")
	assertEqual(t, closeResult.Position.Spot.ExitTxHash, "0xspot-exit", "spot exit tx")
	assertEqual(t, closeResult.Position.Futures.ExitOrderID, "short-exit", "futures exit order")
	assertEqual(t, closeResult.Swap.AmountOutMinimumWei, "9999000000000000000", "exit min quote out")
	assertEqual(t, futures.orders[1].Side, models.OrderSideBuy, "exit futures side")
	assertEqual(t, futures.orders[1].ReduceOnly, true, "exit futures reduce-only")

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load final positions: %v", err)
	}
	if len(loaded) != 1 || loaded[0].Status != basis.PositionStatusClosed {
		t.Fatalf("final stored positions = %#v, want one closed position", loaded)
	}

	expectedFlow := []string{
		"dex.pool",
		"dex.quote.entry",
		"dex.approve.quote",
		"dex.swap.entry",
		"futures.round_qty",
		"futures.order.sell",
		"dex.quote.exit",
		"dex.approve.asset",
		"dex.swap.exit",
		"futures.order.buy",
	}
	if !reflect.DeepEqual(recorder.events, expectedFlow) {
		t.Fatalf("scenario flow mismatch\n got: %#v\nwant: %#v", recorder.events, expectedFlow)
	}

	t.Logf("scenario flow: %v", recorder.events)
	t.Logf("opened position: id=%s spot_qty_wei=%s futures_qty=%s", openResult.Position.ID, openResult.Position.Spot.TokenQtyWei, openResult.Position.Futures.Quantity)
	t.Logf("closed position: id=%s reason=%s", closeResult.Position.ID, closeResult.Position.CloseReason)
}

type scenarioRecorder struct {
	events []string
}

func (r *scenarioRecorder) record(event string) {
	r.events = append(r.events, event)
}

type scenarioDEX struct {
	recorder  *scenarioRecorder
	approvals []base.ERC20ApprovalRequest
	swaps     []base.UniswapV3SwapExactInputSingleRequest
}

func (d *scenarioDEX) FetchUniswapV3PoolInfo(request base.UniswapV3PoolRequest) (base.UniswapV3PoolInfo, error) {
	d.recorder.record("dex.pool")
	return base.UniswapV3PoolInfo{
		Chain:       request.Chain,
		ChainID:     56,
		PoolAddress: request.PoolAddress,
		Token0:      scenarioAssetToken,
		Token1:      scenarioUSDT,
		Fee:         2500,
	}, nil
}

func (d *scenarioDEX) QuoteUniswapV3ExactInputSingle(request base.UniswapV3QuoteExactInputSingleRequest) (base.UniswapV3QuoteExactInputSingle, error) {
	amountOut := ""
	switch {
	case request.TokenIn == scenarioUSDT && request.TokenOut == scenarioAssetToken:
		d.recorder.record("dex.quote.entry")
		amountOut = scenarioSpotTokenOut
	case request.TokenIn == scenarioAssetToken && request.TokenOut == scenarioUSDT:
		d.recorder.record("dex.quote.exit")
		amountOut = scenarioCloseUSDTOut
	default:
		return base.UniswapV3QuoteExactInputSingle{}, fmt.Errorf("unexpected quote pair: %s -> %s", request.TokenIn, request.TokenOut)
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

func (d *scenarioDEX) EnsureERC20Approval(request base.ERC20ApprovalRequest) (base.ERC20ApprovalResult, error) {
	d.approvals = append(d.approvals, request)
	switch request.TokenAddress {
	case scenarioUSDT:
		d.recorder.record("dex.approve.quote")
	case scenarioAssetToken:
		d.recorder.record("dex.approve.asset")
	default:
		return base.ERC20ApprovalResult{}, fmt.Errorf("unexpected approval token: %s", request.TokenAddress)
	}
	return base.ERC20ApprovalResult{
		Chain:              request.Chain,
		ChainID:            56,
		TokenAddress:       request.TokenAddress,
		SpenderAddress:     request.SpenderAddress,
		RequiredAmountWei:  request.AmountWei,
		AllowanceBeforeWei: request.AmountWei,
		ApproveAmountWei:   request.AmountWei,
		AlreadyApproved:    true,
		DryRun:             request.DryRun,
	}, nil
}

func (d *scenarioDEX) SwapUniswapV3ExactInputSingle(request base.UniswapV3SwapExactInputSingleRequest) (base.UniswapV3SwapExactInputSingleResult, error) {
	d.swaps = append(d.swaps, request)
	txHash := ""
	switch {
	case request.TokenIn == scenarioUSDT && request.TokenOut == scenarioAssetToken:
		d.recorder.record("dex.swap.entry")
		txHash = "0xspot-entry"
	case request.TokenIn == scenarioAssetToken && request.TokenOut == scenarioUSDT:
		d.recorder.record("dex.swap.exit")
		txHash = "0xspot-exit"
	default:
		return base.UniswapV3SwapExactInputSingleResult{}, fmt.Errorf("unexpected swap pair: %s -> %s", request.TokenIn, request.TokenOut)
	}
	return base.UniswapV3SwapExactInputSingleResult{
		Chain:               request.Chain,
		ChainID:             56,
		RouterAddress:       request.RouterAddress,
		TokenIn:             request.TokenIn,
		TokenOut:            request.TokenOut,
		Fee:                 request.Fee,
		AmountInWei:         request.AmountInWei,
		AmountOutMinimumWei: request.AmountOutMinimumWei,
		TxHash:              txHash,
		DryRun:              request.DryRun,
	}, nil
}

type scenarioFutures struct {
	recorder *scenarioRecorder
	orders   []base.FuturesOrderRequest
}

func (f *scenarioFutures) SetLeverage(symbol string, leverage int) (base.FuturesLeverageResult, error) {
	f.recorder.record("futures.set_leverage")
	return base.FuturesLeverageResult{
		Symbol:   symbol,
		Leverage: leverage,
		Raw:      map[string]any{"symbol": symbol, "leverage": leverage},
	}, nil
}

func (f *scenarioFutures) PlaceFuturesOrder(request base.FuturesOrderRequest) (base.FuturesOrder, error) {
	f.orders = append(f.orders, request)
	orderID := "short-entry"
	if request.Side == models.OrderSideBuy {
		f.recorder.record("futures.order.buy")
		orderID = "short-exit"
	} else {
		f.recorder.record("futures.order.sell")
	}
	return base.FuturesOrder{
		ID:               orderID,
		Symbol:           request.Symbol,
		Side:             request.Side,
		Type:             request.Type,
		Status:           "TEST",
		Quantity:         request.Quantity,
		ExecutedQuantity: request.Quantity,
		ReduceOnly:       request.ReduceOnly,
		PositionSide:     request.PositionSide,
		Raw:              map[string]any{"id": orderID},
	}, nil
}

func (f *scenarioFutures) FetchFuturesOrder(symbol, orderID string) (base.FuturesOrder, error) {
	return base.FuturesOrder{ID: orderID, Symbol: symbol}, nil
}

func (f *scenarioFutures) FetchFuturesPositions(symbol *string, params map[string]any) ([]base.FuturesPosition, error) {
	return nil, nil
}

func (f *scenarioFutures) FuturesQuantityRules(symbol string) (base.FuturesQuantityRules, error) {
	return base.FuturesQuantityRules{
		Symbol:   symbol,
		StepSize: "0.001",
		MinQty:   "0.001",
	}, nil
}

func (f *scenarioFutures) RoundFuturesQuantity(symbol string, quantity string) (string, error) {
	f.recorder.record("futures.round_qty")
	if symbol != scenarioFuturesSymbol {
		return "", fmt.Errorf("unexpected futures symbol: %s", symbol)
	}
	if quantity != scenarioRequestedShort {
		return "", fmt.Errorf("unexpected futures quantity: %s", quantity)
	}
	return scenarioRoundedShort, nil
}

func assertEqual[T comparable](t *testing.T, got T, want T, label string) {
	t.Helper()
	if got != want {
		t.Fatalf("%s = %v, want %v", label, got, want)
	}
}
