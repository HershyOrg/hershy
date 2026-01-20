package models

// PositionBreakdown represents a position breakdown for NAV calculation.
// 마켓 outcome별 홀딩중인 총 Value = Size*Midpice
type PositionBreakdown struct {
	// MarketID is the market identifier.
	MarketID string
	// Outcome is the outcome label.
	Outcome string
	// Size is the position size.
	Size float64
	// MidPrice is the mid price used for valuation.
	//bbo상의 (bid+ask)/2
	MidPrice float64
	// Value is the computed position value.
	//Value=MidPrice*Size
	Value float64
}

// NAV represents net asset value breakdown.
type NAV struct {
	// NAV is the total net asset value.
	NAV float64
	// Cash is the available cash balance.
	Cash float64
	// PositionsValue is the aggregated value of positions.
	//포지션 평가액
	PositionsValue float64
	// Positions contains per-position valuation breakdowns.
	//포지션별 평가액
	//매번 최신 사태 유지
	Positions []PositionBreakdown
}
