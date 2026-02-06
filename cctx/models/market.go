package models

import (
	"fmt"
	"time"

	"cctx/utils"
)

// ReadableMarketID is a path-like list for market identifiers.
// ex: ["사람이 보기 쉬운 제목", "실제 ID"]
// ex: ["btc-above-50k", "12345"]
type ReadableMarketID []string

// OutcomeRef references an outcome by market ID and outcome name.
// =마켓Id+포지션
type OutcomeRef struct {
	// MarketID is the market identifier.
	MarketID string
	// Outcome is the outcome label.
	Outcome string
}

// OutcomeToken is a tradeable outcome with token ID.
// 포지션 예치 후 주는 그에 대응하는 토큰
// ex: Btc>50k? = Yes,10Size 에 배팅 시 10에 해당하는 Yes토큰 지급
type OutcomeToken struct {
	// MarketID is the market identifier.
	MarketID string
	// Outcome is the outcome label.
	Outcome string
	// TokenID is the exchange token ID for the outcome.
	TokenID string
}

// ExchangeOutcomeRef references a market across an exchange.
// 거래소+마켓Id+포지션
type ExchangeOutcomeRef struct {
	// ExchangeID is the exchange identifier.
	ExchangeID string
	// MarketPath is the readable market path.
	MarketPath ReadableMarketID
	// Outcome is the outcome label.
	Outcome string
}

// FetchSlug returns the first element of MarketPath.ㅈ
// ==사람이 읽기 쉬운 경로
func (e ExchangeOutcomeRef) FetchSlug() string {
	if len(e.MarketPath) == 0 {
		return ""
	}
	return e.MarketPath[0]
}

// MatchID returns the last element of MarketPath.
// == 공식 마켓ID
func (e ExchangeOutcomeRef) MatchID() string {
	if len(e.MarketPath) == 0 {
		return ""
	}
	return e.MarketPath[len(e.MarketPath)-1]
}

// ToOutcomeRef returns a market+outcome reference.
// Exchange는 제거 후 마켓+outcome리턴
func (e ExchangeOutcomeRef) ToOutcomeRef() OutcomeRef {
	if len(e.MarketPath) == 0 {
		return OutcomeRef{MarketID: "", Outcome: e.Outcome}
	}
	return OutcomeRef{MarketID: e.MarketPath[0], Outcome: e.Outcome}
}

// Market represents a prediction market.
type Market struct {
	// ID is the exchange-specific market identifier.
	//"하나의 주제"마다 할당되는 마켓의 고유 ID
	ID string
	// Question is the market question/title.
	Question string
	// Outcomes is the ordered list of outcome labels.
	// 마켓이 제공하는 선택지 (Yes, No)
	// 다중 선택도 존재 가능
	Outcomes []string
	// CloseTime is the market close time, if provided.
	CloseTime *time.Time
	// Volume is the reported market volume.
	// 해당 마켓에서 발생한 거래량
	Volume float64
	// Liquidity is the reported market liquidity.
	//해당 마켓의 유동성 정도
	Liquidity float64
	// Prices maps outcome labels to latest known prices.
	//포지션당 가격
	Prices map[string]float64
	// Metadata carries exchange-specific fields.
	// ex: 마켓 카테고리 등, 거래소가 마켓에 부여하는 메타데이터
	Metadata map[string]any
	// TickSize is the minimum price increment.
	TickSize float64
	// Description is a longer market description if available.
	Description string
}

// ValidatePrices ensures all outcome prices are within [0,1].
func (m *Market) ValidatePrices() error {
	if m == nil {
		utils.DefaultLogger().Debugf("models.Market.ValidatePrices: market is nil")
		return nil
	}
	if len(m.Prices) == 0 {
		utils.DefaultLogger().Debugf("models.Market.ValidatePrices: prices empty for marketID=%s", m.ID)
	}
	for outcome, price := range m.Prices {
		if price < 0 || price > 1 {
			return fmt.Errorf("price for %q must be between 0 and 1, got %v", outcome, price)
		}
	}
	return nil
}

// ReadableID returns metadata["readable_id"] or falls back to [ID].
func (m Market) ReadableID() ReadableMarketID {
	if m.Metadata == nil {
		utils.DefaultLogger().Debugf("models.Market.ReadableID: metadata nil for marketID=%s", m.ID)
		return ReadableMarketID{m.ID}
	}
	if raw, ok := m.Metadata["readable_id"]; ok {
		switch value := raw.(type) {
		case []string:
			return ReadableMarketID(value)
		case []any:
			out := make([]string, 0, len(value))
			for _, item := range value {
				if str, ok := item.(string); ok {
					out = append(out, str)
				}
			}
			if len(out) > 0 {
				return ReadableMarketID(out)
			}
		}
	}
	return ReadableMarketID{m.ID}
}

// IsBinary reports whether the market is binary (two outcomes).
// 마켓의 Outcome선택지가 두 개 뿐인지
func (m Market) IsBinary() bool {
	if len(m.Outcomes) == 0 {
		utils.DefaultLogger().Debugf("models.Market.IsBinary: outcomes empty for marketID=%s", m.ID)
	}
	return len(m.Outcomes) == 2
}

// IsOpen reports whether the market is open for trading.
func (m Market) IsOpen() bool {
	if m.Metadata != nil {
		if closed, ok := m.Metadata["closed"].(bool); ok {
			return !closed
		}
	}
	if m.CloseTime == nil {
		utils.DefaultLogger().Debugf("models.Market.IsOpen: close time nil for marketID=%s", m.ID)
		return true
	}
	return time.Now().Before(*m.CloseTime)
}

// Spread returns the bid-ask spread for binary markets.
// Yes-No가격의 합이 1.0에서 얼마나 벗어났는지를 보는 함수
func (m Market) Spread() *float64 {
	if !m.IsBinary() || len(m.Prices) != 2 {
		utils.DefaultLogger().Debugf("models.Market.Spread: non-binary or missing prices for marketID=%s", m.ID)
		return nil
	}
	sum := 0.0
	for _, price := range m.Prices {
		sum += price
	}
	spread := absFloat(1.0 - sum)
	return &spread
}

// GetOutcomeRef returns a reference to a specific outcome.
func (m Market) GetOutcomeRef(outcome string) OutcomeRef {
	if outcome == "" {
		utils.DefaultLogger().Debugf("models.Market.GetOutcomeRef: outcome empty for marketID=%s", m.ID)
	}
	return OutcomeRef{MarketID: m.ID, Outcome: outcome}
}

// GetOutcomeRefs returns references for all outcomes.
func (m Market) GetOutcomeRefs() []OutcomeRef {
	if len(m.Outcomes) == 0 {
		utils.DefaultLogger().Debugf("models.Market.GetOutcomeRefs: outcomes empty for marketID=%s", m.ID)
	}
	refs := make([]OutcomeRef, 0, len(m.Outcomes))
	for _, outcome := range m.Outcomes {
		refs = append(refs, OutcomeRef{MarketID: m.ID, Outcome: outcome})
	}
	return refs
}

// GetOutcomeTokens returns tradeable outcomes with their token IDs.
func (m Market) GetOutcomeTokens() []OutcomeToken {
	tokens := tokensFromMetadata(m.Metadata)
	if len(tokens) == 0 {
		utils.DefaultLogger().Debugf("models.Market.GetOutcomeTokens: tokens empty for marketID=%s", m.ID)
	}
	out := make([]OutcomeToken, 0, len(m.Outcomes))
	for _, outcome := range m.Outcomes {
		if tokenID, ok := tokens[outcome]; ok {
			out = append(out, OutcomeToken{
				MarketID: m.ID,
				Outcome:  outcome,
				TokenID:  tokenID,
			})
		}
	}
	return out
}

// tokensFromMetadata extracts outcome token IDs from metadata.
func tokensFromMetadata(meta map[string]any) map[string]string {
	if meta == nil {
		utils.DefaultLogger().Debugf("models.tokensFromMetadata: metadata nil")
		return nil
	}
	raw, ok := meta["tokens"]
	if !ok {
		utils.DefaultLogger().Debugf("models.tokensFromMetadata: tokens missing")
		return nil
	}
	switch value := raw.(type) {
	case map[string]string:
		return value
	case map[string]any:
		out := make(map[string]string, len(value))
		for key, item := range value {
			if str, ok := item.(string); ok {
				out[key] = str
			}
		}
		return out
	default:
		return nil
	}
}

// absFloat returns the absolute value of a float.
func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
