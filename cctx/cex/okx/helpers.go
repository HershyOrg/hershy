package okx

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var stableQuoteAssets = map[string]bool{
	"USD":   true,
	"USDC":  true,
	"USDT":  true,
	"BUSD":  true,
	"FDUSD": true,
	"TUSD":  true,
}

func cloneValues(values url.Values) url.Values {
	out := url.Values{}
	for key, list := range values {
		copied := make([]string, len(list))
		copy(copied, list)
		out[key] = copied
	}
	return out
}

func buildHMACSHA256Base64(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
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

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		default:
			return false
		}
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return false
	}
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

func unixMillisFromAny(value any) time.Time {
	ms := int64(floatFromAny(value))
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
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

func okxTimestamp(now time.Time) string {
	return now.UTC().Format("2006-01-02T15:04:05.000Z")
}
