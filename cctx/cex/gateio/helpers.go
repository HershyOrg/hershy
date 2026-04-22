package gateio

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var gateStableQuoteAssets = map[string]bool{
	"USD":   true,
	"USDC":  true,
	"USDT":  true,
	"BUSD":  true,
	"FDUSD": true,
	"TUSD":  true,
}

const gateEmptyBodySHA512Hex = "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"

func cloneValues(values url.Values) url.Values {
	out := url.Values{}
	for key, list := range values {
		copied := make([]string, len(list))
		copy(copied, list)
		out[key] = copied
	}
	return out
}

func buildHMACSHA512Hex(secret, payload string) string {
	mac := hmac.New(sha512.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func sha512Hex(payload string) string {
	if payload == "" {
		return gateEmptyBodySHA512Hex
	}
	sum := sha512.Sum512([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func chooseOrderType(price float64) string {
	if price > 0 {
		return "limit"
	}
	return "market"
}

func formatDecimal(value float64) string {
	if value <= 0 {
		return ""
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func floatFromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		out, _ := typed.Float64()
		return out
	case string:
		out, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err == nil {
			return out
		}
	}
	return 0
}

func numberFromAny(value any) float64 {
	return floatFromAny(value)
}

func intFromAny(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		out, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return out
		}
	}
	return fallback
}

func stringFromConfig(config map[string]any, key string) string {
	value, ok := config[key]
	if !ok {
		return ""
	}
	return stringFromAny(value)
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func unixSecondsFromAny(value any) time.Time {
	seconds := floatFromAny(value)
	if seconds <= 0 {
		return time.Time{}
	}
	whole, fractional := math.Modf(seconds)
	return time.Unix(int64(whole), int64(fractional*float64(time.Second))).UTC()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstPositive(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func isNumeric(value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	_, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return err == nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func quoteAssetPriority(asset string) int {
	switch strings.ToUpper(strings.TrimSpace(asset)) {
	case "USDT":
		return 0
	case "USDC":
		return 1
	case "FDUSD":
		return 2
	case "BUSD":
		return 3
	case "TUSD":
		return 4
	default:
		return 100
	}
}

func normalizeGateClientOrderID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "t-") {
		return trimmed
	}
	return "t-" + trimmed
}

func precisionStep(value int) float64 {
	if value < 0 {
		return 0
	}
	return math.Pow10(-value)
}
