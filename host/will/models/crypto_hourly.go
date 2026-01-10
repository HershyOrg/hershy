package models

import (
	"fmt"
	"strings"
	"time"
)

const (
	// CryptoHourlyMarketTypeStrikePrice represents strike price markets.
	// 가격 도달 예측
	CryptoHourlyMarketTypeStrikePrice = "strike_price"
	// CryptoHourlyMarketTypeUpDown represents up/down markets.
	//현재가 대비 가격 등락 예측
	CryptoHourlyMarketTypeUpDown = "up_down"
)

// CryptoHourlyMarket represents a crypto hourly price market.
// 1시간 후 크립토 가격 예측 마켓
type CryptoHourlyMarket struct {
	// TokenSymbol is the underlying token symbol.
	//ex: USDC, ETH
	TokenSymbol string
	// ExpiryTime is the market expiry timestamp.
	ExpiryTime time.Time
	// StrikePrice is the optional strike price.
	StrikePrice *float64
	// MarketType describes the market structure.
	//Strike/Up-down
	MarketType string
	// Direction describes up/down direction when applicable.
	Direction string
}

// String formats the crypto hourly market for display.
func (m CryptoHourlyMarket) String() string {

	if m.MarketType == CryptoHourlyMarketTypeUpDown {
		return fmt.Sprintf(
			"%s Up or Down at %s",
			m.TokenSymbol,
			m.ExpiryTime.UTC().Format("2006-01-02 15:04 UTC"),
		)
	}

	priceStr := "TBD"
	if m.StrikePrice != nil {
		priceStr = formatUSD(*m.StrikePrice)
	}

	return fmt.Sprintf(
		"%s at %s by %s",
		m.TokenSymbol,
		priceStr,
		m.ExpiryTime.UTC().Format("2006-01-02 15:04 UTC"),
	)
}

// formatUSD renders a float as a USD string with separators.
func formatUSD(value float64) string {

	raw := fmt.Sprintf("%.2f", value)
	parts := strings.SplitN(raw, ".", 2)
	integer := parts[0]
	fraction := "00"
	if len(parts) == 2 {
		fraction = parts[1]
	}

	var b strings.Builder
	b.WriteString("$")
	for i, r := range integer {
		if i != 0 && (len(integer)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	b.WriteByte('.')
	b.WriteString(fraction)
	return b.String()
}
