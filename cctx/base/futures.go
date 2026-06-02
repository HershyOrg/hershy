package base

import "github.com/HershyOrg/hershy/cctx/models"

// FuturesOrderType identifies the order execution type on a futures venue.
type FuturesOrderType string

const (
	FuturesOrderTypeMarket FuturesOrderType = "MARKET"
	FuturesOrderTypeLimit  FuturesOrderType = "LIMIT"
)

// FuturesPositionSide identifies one-way or hedge-mode position sides.
type FuturesPositionSide string

const (
	FuturesPositionSideBoth  FuturesPositionSide = "BOTH"
	FuturesPositionSideLong  FuturesPositionSide = "LONG"
	FuturesPositionSideShort FuturesPositionSide = "SHORT"
)

// FuturesOrderRequest is a venue-neutral futures order request.
type FuturesOrderRequest struct {
	Symbol           string
	Side             models.OrderSide
	Type             FuturesOrderType
	Quantity         string
	Price            string
	TimeInForce      string
	ReduceOnly       bool
	PositionSide     FuturesPositionSide
	ClientOrderID    string
	NewOrderRespType string
	Test             bool
	Params           map[string]any
}

// FuturesOrder captures the important futures order response fields while
// preserving the raw exchange payload for venue-specific reconciliation.
type FuturesOrder struct {
	ID               string
	ClientOrderID    string
	Symbol           string
	Side             models.OrderSide
	Type             FuturesOrderType
	Status           string
	Quantity         string
	ExecutedQuantity string
	AveragePrice     string
	Price            string
	ReduceOnly       bool
	PositionSide     FuturesPositionSide
	CreatedAtMillis  int64
	UpdatedAtMillis  int64
	Raw              map[string]any
}

// FuturesPosition is a futures position snapshot.
type FuturesPosition struct {
	Symbol           string
	PositionSide     FuturesPositionSide
	PositionAmount   string
	EntryPrice       string
	MarkPrice        string
	UnrealizedProfit string
	Leverage         int
	LiquidationPrice string
	MarginType       string
	UpdateTimeMillis int64
	Raw              map[string]any
}

// FuturesLeverageResult captures a successful leverage update.
type FuturesLeverageResult struct {
	Symbol           string
	Leverage         int
	MaxNotionalValue string
	Raw              map[string]any
}

// FuturesQuantityRules describes symbol-level quantity constraints.
type FuturesQuantityRules struct {
	Symbol      string
	MinQty      string
	MaxQty      string
	StepSize    string
	MinNotional string
}

// FuturesTrader is an optional capability for derivatives venues.
type FuturesTrader interface {
	SetLeverage(symbol string, leverage int) (FuturesLeverageResult, error)
	PlaceFuturesOrder(request FuturesOrderRequest) (FuturesOrder, error)
	FetchFuturesOrder(symbol, orderID string) (FuturesOrder, error)
	FetchFuturesPositions(symbol *string, params map[string]any) ([]FuturesPosition, error)
	FuturesQuantityRules(symbol string) (FuturesQuantityRules, error)
	RoundFuturesQuantity(symbol string, quantity string) (string, error)
}
