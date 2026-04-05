package diagnostics

type ReasonCode string

const (
	ReasonInsufficientEdge    ReasonCode = "insufficient_edge"
	ReasonMissingEntryQuote   ReasonCode = "missing_entry_quote"
	ReasonInsufficientBalance ReasonCode = "insufficient_balance"
	ReasonInsufficientAmount  ReasonCode = "insufficient_amount"
	ReasonMarketClosed        ReasonCode = "market_closed"
	ReasonOrderbookDisabled   ReasonCode = "orderbook_disabled"
	ReasonNoFill              ReasonCode = "no_fill"
	ReasonRetryBackoffActive  ReasonCode = "retry_backoff_active"
	ReasonStopLossTriggered   ReasonCode = "stop_loss_triggered"
	ReasonWindowEndExit       ReasonCode = "window_end_exit"
	ReasonSignalExit          ReasonCode = "signal_exit"
	ReasonExchangeUnavailable ReasonCode = "exchange_unavailable"
	ReasonMissingCredentials  ReasonCode = "missing_credentials"
	ReasonInvalidActionParams ReasonCode = "invalid_action_params"
	ReasonUnsupportedVenue    ReasonCode = "unsupported_venue"
	ReasonOrderRejected       ReasonCode = "order_rejected"
	ReasonAuthenticationError ReasonCode = "authentication_error"
)

func (r ReasonCode) String() string {
	return string(r)
}
