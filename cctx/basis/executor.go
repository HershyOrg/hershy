package basis

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

// Executor wires DEX and futures capabilities into a basis trade workflow.
type Executor struct {
	DEX     base.UniswapV3Executor
	Futures base.FuturesTrader
	Store   *PositionStore
	Now     func() time.Time
}

// OpenRequest is the executable plan for opening a CEX/DEX basis position.
type OpenRequest struct {
	ID              string
	Asset           string
	Chain           string
	NotionalQuote   string
	EntryDEXPrice   string
	EntryCEXBid     string
	EntryGapPct     string
	DEXID           string
	PoolAddress     string
	QuoterAddress   string
	RouterAddress   string
	TokenAddress    string
	QuoteAddress    string
	QuoteSymbol     string
	UniswapV3Fee    uint32
	AmountInWei     string
	MinTokenOutWei  string
	SlippageBps     uint32
	FuturesExchange string
	FuturesSymbol   string
	FuturesQuantity string
	Leverage        int
	DryRun          bool
	RecordDryRun    bool
	WaitForReceipt  bool
	AllowMultiple   bool
	Metadata        map[string]any
}

// OpenResult captures each executed leg.
type OpenResult struct {
	PoolInfo     *base.UniswapV3PoolInfo
	Quote        base.UniswapV3QuoteExactInputSingle
	Approval     base.ERC20ApprovalResult
	Swap         base.UniswapV3SwapExactInputSingleResult
	FuturesOrder base.FuturesOrder
	Position     Position
}

// CloseRequest is the executable plan for closing a stored basis position.
type CloseRequest struct {
	PositionID       string
	Reason           string
	TokenAmountInWei string
	MinQuoteOutWei   string
	SlippageBps      uint32
	DryRun           bool
	RecordDryRun     bool
	WaitForReceipt   bool
}

// CloseResult captures the close-leg execution results.
type CloseResult struct {
	Quote        base.UniswapV3QuoteExactInputSingle
	Approval     base.ERC20ApprovalResult
	Swap         base.UniswapV3SwapExactInputSingleResult
	FuturesOrder base.FuturesOrder
	Position     Position
}

// Open executes a DEX spot buy and CEX futures short hedge.
func (e *Executor) Open(request OpenRequest) (OpenResult, error) {
	if err := e.validate(); err != nil {
		return OpenResult{}, err
	}
	if err := validateOpenRequest(request); err != nil {
		return OpenResult{}, err
	}
	if !request.AllowMultiple {
		active, err := e.Store.Active()
		if err != nil {
			return OpenResult{}, err
		}
		if len(active) > 0 {
			return OpenResult{}, fmt.Errorf("active basis position already exists: %s", active[0].ID)
		}
	}

	result := OpenResult{}
	fee := request.UniswapV3Fee
	if fee == 0 {
		pool, err := e.DEX.FetchUniswapV3PoolInfo(base.UniswapV3PoolRequest{
			Chain:       request.Chain,
			PoolAddress: request.PoolAddress,
		})
		if err != nil {
			return result, err
		}
		if err := validatePoolTokens(pool, request.TokenAddress, request.QuoteAddress); err != nil {
			return result, err
		}
		result.PoolInfo = &pool
		fee = pool.Fee
	}

	quote, err := e.DEX.QuoteUniswapV3ExactInputSingle(base.UniswapV3QuoteExactInputSingleRequest{
		Chain:         request.Chain,
		QuoterAddress: request.QuoterAddress,
		TokenIn:       request.QuoteAddress,
		TokenOut:      request.TokenAddress,
		Fee:           fee,
		AmountInWei:   request.AmountInWei,
	})
	if err != nil {
		return result, err
	}
	result.Quote = quote

	minTokenOutWei := strings.TrimSpace(request.MinTokenOutWei)
	if minTokenOutWei == "" {
		minTokenOutWei, err = SlippageFloorWei(quote.AmountOutWei, request.SlippageBps)
		if err != nil {
			return result, err
		}
	}
	approval, err := e.DEX.EnsureERC20Approval(base.ERC20ApprovalRequest{
		Chain:          request.Chain,
		TokenAddress:   request.QuoteAddress,
		SpenderAddress: request.RouterAddress,
		AmountWei:      request.AmountInWei,
		DryRun:         request.DryRun,
	})
	if err != nil {
		return result, err
	}
	result.Approval = approval

	swap, err := e.DEX.SwapUniswapV3ExactInputSingle(base.UniswapV3SwapExactInputSingleRequest{
		Chain:                request.Chain,
		RouterAddress:        request.RouterAddress,
		TokenIn:              request.QuoteAddress,
		TokenOut:             request.TokenAddress,
		Fee:                  fee,
		AmountInWei:          request.AmountInWei,
		AmountOutMinimumWei:  minTokenOutWei,
		DryRun:               request.DryRun,
		WaitForReceipt:       request.WaitForReceipt,
		SqrtPriceLimitX96Wei: "0",
	})
	if err != nil {
		return result, err
	}
	result.Swap = swap

	position := e.newOpenPosition(request, fee, quote.AmountOutWei, swap.TxHash)
	shouldRecord := !request.DryRun || request.RecordDryRun
	if shouldRecord {
		if err := e.Store.Add(position); err != nil {
			return result, err
		}
	}
	result.Position = position

	if request.Leverage > 0 && !request.DryRun {
		if _, err := e.Futures.SetLeverage(request.FuturesSymbol, request.Leverage); err != nil {
			return result, err
		}
	}
	quantity, err := e.Futures.RoundFuturesQuantity(request.FuturesSymbol, request.FuturesQuantity)
	if err != nil {
		return result, err
	}
	order, err := e.Futures.PlaceFuturesOrder(base.FuturesOrderRequest{
		Symbol:           request.FuturesSymbol,
		Side:             models.OrderSideSell,
		Type:             base.FuturesOrderTypeMarket,
		Quantity:         quantity,
		PositionSide:     base.FuturesPositionSideShort,
		NewOrderRespType: "RESULT",
		Test:             request.DryRun,
	})
	if err != nil {
		return result, err
	}
	result.FuturesOrder = order
	result.Position.Futures.Quantity = quantity
	result.Position.Futures.EntryOrderID = order.ID
	result.Position.Futures.EntryOrderRaw = order.Raw
	if shouldRecord {
		if err := e.Store.Update(result.Position); err != nil {
			return result, err
		}
	}
	return result, nil
}

// Close executes the reverse DEX sell and reduce-only futures buy.
func (e *Executor) Close(request CloseRequest) (CloseResult, error) {
	if err := e.validate(); err != nil {
		return CloseResult{}, err
	}
	if strings.TrimSpace(request.PositionID) == "" {
		return CloseResult{}, errors.New("position id required")
	}
	positions, err := e.Store.Load()
	if err != nil {
		return CloseResult{}, err
	}
	position, ok := findPosition(positions, request.PositionID)
	if !ok {
		return CloseResult{}, fmt.Errorf("basis position not found: %s", request.PositionID)
	}
	if !position.IsOpen() {
		return CloseResult{}, fmt.Errorf("basis position is not open: %s", request.PositionID)
	}

	tokenAmountInWei := firstNonEmpty(request.TokenAmountInWei, position.Spot.TokenQtyWei)
	quote, err := e.DEX.QuoteUniswapV3ExactInputSingle(base.UniswapV3QuoteExactInputSingleRequest{
		Chain:         position.Spot.Chain,
		QuoterAddress: position.Spot.QuoterAddress,
		TokenIn:       position.Spot.TokenAddress,
		TokenOut:      position.Spot.QuoteAddress,
		Fee:           position.Spot.UniswapV3Fee,
		AmountInWei:   tokenAmountInWei,
	})
	if err != nil {
		return CloseResult{}, err
	}
	minQuoteOutWei := strings.TrimSpace(request.MinQuoteOutWei)
	if minQuoteOutWei == "" {
		minQuoteOutWei, err = SlippageFloorWei(quote.AmountOutWei, request.SlippageBps)
		if err != nil {
			return CloseResult{}, err
		}
	}
	result := CloseResult{Quote: quote}

	approval, err := e.DEX.EnsureERC20Approval(base.ERC20ApprovalRequest{
		Chain:          position.Spot.Chain,
		TokenAddress:   position.Spot.TokenAddress,
		SpenderAddress: position.Spot.RouterAddress,
		AmountWei:      tokenAmountInWei,
		DryRun:         request.DryRun,
	})
	if err != nil {
		return result, err
	}
	result.Approval = approval

	swap, err := e.DEX.SwapUniswapV3ExactInputSingle(base.UniswapV3SwapExactInputSingleRequest{
		Chain:               position.Spot.Chain,
		RouterAddress:       position.Spot.RouterAddress,
		TokenIn:             position.Spot.TokenAddress,
		TokenOut:            position.Spot.QuoteAddress,
		Fee:                 position.Spot.UniswapV3Fee,
		AmountInWei:         tokenAmountInWei,
		AmountOutMinimumWei: minQuoteOutWei,
		DryRun:              request.DryRun,
		WaitForReceipt:      request.WaitForReceipt,
	})
	if err != nil {
		return result, err
	}
	result.Swap = swap

	order, err := e.Futures.PlaceFuturesOrder(base.FuturesOrderRequest{
		Symbol:           position.Futures.Symbol,
		Side:             models.OrderSideBuy,
		Type:             base.FuturesOrderTypeMarket,
		Quantity:         position.Futures.Quantity,
		ReduceOnly:       true,
		PositionSide:     base.FuturesPositionSideShort,
		NewOrderRespType: "RESULT",
		Test:             request.DryRun,
	})
	if err != nil {
		return result, err
	}
	result.FuturesOrder = order

	now := e.now()
	position.Status = PositionStatusClosed
	position.CloseReason = firstNonEmpty(request.Reason, "manual")
	position.Spot.ExitTxHash = swap.TxHash
	position.Futures.ExitOrderID = order.ID
	position.Futures.ExitOrderRaw = order.Raw
	position.ClosedAt = &now
	result.Position = position
	if !request.DryRun || request.RecordDryRun {
		if err := e.Store.Update(position); err != nil {
			return result, err
		}
	}
	return result, nil
}

// SlippageFloorWei applies basis-point slippage to an integer wei amount.
func SlippageFloorWei(amountWei string, slippageBps uint32) (string, error) {
	amount, ok := new(big.Int).SetString(strings.TrimSpace(amountWei), 10)
	if !ok || amount.Sign() < 0 {
		return "", fmt.Errorf("invalid wei amount: %s", amountWei)
	}
	if slippageBps > 10_000 {
		return "", fmt.Errorf("slippage bps too large: %d", slippageBps)
	}
	numerator := new(big.Int).Mul(amount, big.NewInt(int64(10_000-slippageBps)))
	return new(big.Int).Quo(numerator, big.NewInt(10_000)).String(), nil
}

func (e *Executor) validate() error {
	if e == nil {
		return errors.New("basis executor is nil")
	}
	if e.DEX == nil {
		return errors.New("basis executor dex is required")
	}
	if e.Futures == nil {
		return errors.New("basis executor futures is required")
	}
	if e.Store == nil {
		return errors.New("basis executor store is required")
	}
	return nil
}

func (e *Executor) newOpenPosition(request OpenRequest, fee uint32, tokenQtyWei string, spotEntryTx string) Position {
	now := e.now()
	return Position{
		ID:            request.ID,
		Status:        PositionStatusOpen,
		Asset:         request.Asset,
		NotionalQuote: request.NotionalQuote,
		EntryDEXPrice: request.EntryDEXPrice,
		EntryCEXBid:   request.EntryCEXBid,
		EntryGapPct:   request.EntryGapPct,
		OpenedAt:      now,
		Spot: SpotLeg{
			DEXID:         firstNonEmpty(request.DEXID, "uniswap_v3"),
			Chain:         request.Chain,
			PoolAddress:   request.PoolAddress,
			QuoterAddress: request.QuoterAddress,
			RouterAddress: request.RouterAddress,
			TokenAddress:  request.TokenAddress,
			QuoteAddress:  request.QuoteAddress,
			QuoteSymbol:   request.QuoteSymbol,
			UniswapV3Fee:  fee,
			AmountInWei:   request.AmountInWei,
			TokenQtyWei:   tokenQtyWei,
			EntryTxHash:   spotEntryTx,
		},
		Futures: FuturesLeg{
			ExchangeID:   firstNonEmpty(request.FuturesExchange, "binance_futures"),
			Symbol:       request.FuturesSymbol,
			Quantity:     request.FuturesQuantity,
			PositionSide: string(base.FuturesPositionSideShort),
		},
		Metadata: request.Metadata,
	}
}

func (e *Executor) now() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}

func validateOpenRequest(request OpenRequest) error {
	required := map[string]string{
		"id":               request.ID,
		"asset":            request.Asset,
		"quoter_address":   request.QuoterAddress,
		"router_address":   request.RouterAddress,
		"token_address":    request.TokenAddress,
		"quote_address":    request.QuoteAddress,
		"amount_in_wei":    request.AmountInWei,
		"futures_symbol":   request.FuturesSymbol,
		"futures_quantity": request.FuturesQuantity,
	}
	for name, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s required", name)
		}
	}
	if request.UniswapV3Fee == 0 && strings.TrimSpace(request.PoolAddress) == "" {
		return errors.New("uniswap_v3_fee or pool_address required")
	}
	return nil
}

func validatePoolTokens(pool base.UniswapV3PoolInfo, tokenAddress string, quoteAddress string) error {
	token := strings.EqualFold(pool.Token0, tokenAddress) || strings.EqualFold(pool.Token1, tokenAddress)
	quote := strings.EqualFold(pool.Token0, quoteAddress) || strings.EqualFold(pool.Token1, quoteAddress)
	if !token || !quote {
		return fmt.Errorf("pool tokens %s/%s do not include token/quote %s/%s", pool.Token0, pool.Token1, tokenAddress, quoteAddress)
	}
	return nil
}

func findPosition(positions []Position, id string) (Position, bool) {
	for _, position := range positions {
		if position.ID == id {
			return position, true
		}
	}
	return Position{}, false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
