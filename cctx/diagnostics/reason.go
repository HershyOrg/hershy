package diagnostics

type ReasonCode string

const (
	// Strategy or policy gates.
	ReasonPolicyEdgeBelowThreshold        ReasonCode = "policy.edge_below_threshold"
	ReasonPolicyProbabilityBelowThreshold ReasonCode = "policy.probability_below_threshold"

	// Data availability or market-data quality issues.
	ReasonDataQuoteUnavailable     ReasonCode = "data.quote_unavailable"
	ReasonDataOrderbookUnavailable ReasonCode = "data.orderbook_unavailable"

	// Market state conditions.
	ReasonMarketClosed ReasonCode = "market.closed"

	// Funds or sizing constraints.
	ReasonFundsInsufficientBalance ReasonCode = "funds.insufficient_balance"
	ReasonExecutionAmountTooSmall  ReasonCode = "execution.amount_too_small"

	// Execution outcomes.
	ReasonExecutionNoFill        ReasonCode = "execution.no_fill"
	ReasonExecutionOrderRejected ReasonCode = "execution.order_rejected"

	// Risk and lifecycle decisions.
	ReasonRiskStopLossTriggered ReasonCode = "risk.stop_loss_triggered"
	ReasonLifecycleWindowClosed ReasonCode = "lifecycle.window_closed"
	ReasonLifecycleSignalExit   ReasonCode = "lifecycle.signal_exit"

	// Venue or transport errors.
	ReasonVenueUnavailable         ReasonCode = "venue.unavailable"
	ReasonVenueAuthenticationError ReasonCode = "venue.authentication_error"

	// Configuration and capability issues.
	ReasonConfigMissingCredentials   ReasonCode = "config.missing_credentials"
	ReasonConfigInvalidParams        ReasonCode = "config.invalid_params"
	ReasonCapabilityUnsupportedVenue ReasonCode = "capability.unsupported_venue"
)

func (r ReasonCode) String() string {
	return string(r)
}
