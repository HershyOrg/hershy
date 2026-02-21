package models

import "github.com/HershyOrg/hershy/cctx/utils"

// Position represents a position in a prediction market.
// outcome뿐 아니라 마켓, 사이즈까지 포괄하는 더 구체적 정보
type Position struct {
	// MarketID is the market identifier for this position.
	MarketID string
	// Outcome is the outcome label for the position.
	Outcome string
	// Size is the number of shares held.
	Size float64
	// AveragePrice is the average entry price.
	//==평균매입단가
	//Size * AveragePrice= 해당 포지션 구축하는데 들어간 총비용
	AveragePrice float64
	// CurrentPrice is the latest known price for the outcome.
	CurrentPrice float64
}

// CostBasis returns total cost of the position.
func (p Position) CostBasis() float64 {
	if p.Size == 0 || p.AveragePrice == 0 {
		utils.DefaultLogger().Debugf("models.Position.CostBasis: zero size or average price for marketID=%s outcome=%s", p.MarketID, p.Outcome)
	}
	return p.Size * p.AveragePrice
}

// CurrentValue returns current value of the position.
func (p Position) CurrentValue() float64 {
	if p.Size == 0 || p.CurrentPrice == 0 {
		utils.DefaultLogger().Debugf("models.Position.CurrentValue: zero size or current price for marketID=%s outcome=%s", p.MarketID, p.Outcome)
	}
	return p.Size * p.CurrentPrice
}

// UnrealizedPNL returns unrealized profit/loss.
// ==총 가치 - 총 비용
// ==size*(currentPrice-averagePrice)
func (p Position) UnrealizedPNL() float64 {
	if p.Size == 0 {
		utils.DefaultLogger().Debugf("models.Position.UnrealizedPNL: size is zero for marketID=%s outcome=%s", p.MarketID, p.Outcome)
	}
	return p.CurrentValue() - p.CostBasis()
}

// UnrealizedPNLPercent returns unrealized profit/loss percentage.
// 총 비용 대비 현재까지의 미실형수익
func (p Position) UnrealizedPNLPercent() float64 {
	costBasis := p.CostBasis()
	if costBasis == 0 {
		utils.DefaultLogger().Debugf("models.Position.UnrealizedPNLPercent: cost basis is zero for marketID=%s outcome=%s", p.MarketID, p.Outcome)
		return 0
	}
	return (p.UnrealizedPNL() / costBasis) * 100
}
