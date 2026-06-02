package basis

import "time"

// PositionStatus is the lifecycle state of a basis position.
type PositionStatus string

const (
	PositionStatusOpen   PositionStatus = "open"
	PositionStatusClosed PositionStatus = "closed"
)

// SpotLeg records the on-chain spot leg of a basis trade.
type SpotLeg struct {
	DEXID         string `json:"dex_id"`
	Chain         string `json:"chain,omitempty"`
	PoolAddress   string `json:"pool_address,omitempty"`
	QuoterAddress string `json:"quoter_address,omitempty"`
	RouterAddress string `json:"router_address,omitempty"`
	TokenAddress  string `json:"token_address"`
	QuoteAddress  string `json:"quote_address"`
	QuoteSymbol   string `json:"quote_symbol"`
	UniswapV3Fee  uint32 `json:"uniswap_v3_fee,omitempty"`
	AmountInWei   string `json:"amount_in_wei"`
	TokenQtyWei   string `json:"token_qty_wei"`
	EntryTxHash   string `json:"entry_tx_hash,omitempty"`
	ExitTxHash    string `json:"exit_tx_hash,omitempty"`
}

// FuturesLeg records the centralized futures hedge.
type FuturesLeg struct {
	ExchangeID    string `json:"exchange_id"`
	Symbol        string `json:"symbol"`
	Quantity      string `json:"quantity"`
	EntryOrderID  string `json:"entry_order_id,omitempty"`
	ExitOrderID   string `json:"exit_order_id,omitempty"`
	PositionSide  string `json:"position_side,omitempty"`
	EntryOrderRaw any    `json:"entry_order_raw,omitempty"`
	ExitOrderRaw  any    `json:"exit_order_raw,omitempty"`
}

// Position is a durable record for one CEX/DEX basis position.
type Position struct {
	ID            string         `json:"id"`
	Status        PositionStatus `json:"status"`
	Asset         string         `json:"asset"`
	NotionalQuote string         `json:"notional_quote"`
	EntryDEXPrice string         `json:"entry_dex_price"`
	EntryCEXBid   string         `json:"entry_cex_bid"`
	EntryGapPct   string         `json:"entry_gap_pct"`
	Spot          SpotLeg        `json:"spot"`
	Futures       FuturesLeg     `json:"futures"`
	OpenedAt      time.Time      `json:"opened_at"`
	ClosedAt      *time.Time     `json:"closed_at,omitempty"`
	CloseReason   string         `json:"close_reason,omitempty"`
	ObservedPnL   string         `json:"observed_pnl,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

// IsOpen reports whether the position is currently active.
func (p Position) IsOpen() bool {
	return p.Status == PositionStatusOpen
}
