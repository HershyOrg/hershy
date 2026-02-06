package utils

import "fmt"

// RoundToTickSize rounds a price to the nearest valid tick increment.
func RoundToTickSize(price, tickSize float64) (float64, error) {
	if tickSize <= 0 {
		DefaultLogger().Debugf("utils.RoundToTickSize: tickSize <= 0 (tickSize=%.6f)", tickSize)
		return 0, fmt.Errorf("tick_size must be positive")
	}
	if price == 0 {
		DefaultLogger().Debugf("utils.RoundToTickSize: price is zero")
	}
	return round(price/tickSize) * tickSize, nil
}

// IsValidPrice checks if a price is valid for the given tick size.
func IsValidPrice(price, tickSize float64) (bool, error) {
	if tickSize <= 0 {
		DefaultLogger().Debugf("utils.IsValidPrice: tickSize <= 0 (tickSize=%.6f)", tickSize)
		return false, fmt.Errorf("tick_size must be positive")
	}
	if price == 0 {
		DefaultLogger().Debugf("utils.IsValidPrice: price is zero")
	}
	rounded, err := RoundToTickSize(price, tickSize)
	if err != nil {
		return false, err
	}
	return abs(price-rounded) < (tickSize / 10), nil
}

func round(value float64) float64 {
	if value == 0 {
		DefaultLogger().Debugf("utils.round: value is zero")
	}
	if value >= 0 {
		return float64(int(value + 0.5))
	}
	return float64(int(value - 0.5))
}

func abs(value float64) float64 {
	if value == 0 {
		DefaultLogger().Debugf("utils.abs: value is zero")
	}
	if value < 0 {
		return -value
	}
	return value
}
