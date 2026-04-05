package debug

type RunID string
type TradeID string
type DecisionID string

type EventType string

const (
	EventMarketSnapshot EventType = "market_snapshot"
	EventSignalEval     EventType = "signal_eval"
	EventEntryEval      EventType = "entry_eval"
	EventOrderAction    EventType = "order_action"
	EventFillResult     EventType = "fill_result"
	EventRiskEval       EventType = "risk_eval"
	EventStateChange    EventType = "state_transition"
	EventAnomaly        EventType = "anomaly"
)

type EventEnvelope struct {
	RunID      RunID             `json:"run_id"`
	TradeID    *TradeID          `json:"trade_id,omitempty"`
	DecisionID *DecisionID       `json:"decision_id,omitempty"`
	Event      EventType         `json:"event"`
	TsMs       int64             `json:"ts_ms"`
	StrategyID string            `json:"strategy_id"`
	MarketID   string            `json:"market_id,omitempty"`
	Venue      string            `json:"venue,omitempty"`
	ReasonCode string            `json:"reason_code,omitempty"`
	Decision   string            `json:"decision,omitempty"`
	Inputs     map[string]any    `json:"inputs,omitempty"`
	Derived    map[string]any    `json:"derived,omitempty"`
	Outcome    map[string]any    `json:"outcome,omitempty"`
	Tags       map[string]string `json:"tags,omitempty"`
}

type EmitParams struct {
	RunID      RunID
	TradeID    *TradeID
	DecisionID *DecisionID
	TsMs       int64
	MarketID   string
	Venue      string
	ReasonCode string
	Decision   string
	Inputs     map[string]any
	Derived    map[string]any
	Outcome    map[string]any
	Tags       map[string]string
}

type EventSink interface {
	WriteEvent(EventEnvelope) error
	Close() error
}
