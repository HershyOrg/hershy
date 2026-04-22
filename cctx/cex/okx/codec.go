package okx

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

func (o *OKX) parseOrderList(payload any, fallbackSymbol string) ([]models.Order, error) {
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "okx order list response malformed"}
	}

	orders := make([]models.Order, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		orders = append(orders, o.parseOrder(mapped, fallbackSymbol))
	}
	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, nil
}

func (o *OKX) parseOrder(payload map[string]any, fallbackSymbol string) models.Order {
	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["instId"]), fallbackSymbol)))
	info, _ := o.fetchSymbolInfo(symbol)

	price := floatFromAny(payload["px"])
	if price <= 0 {
		price = floatFromAny(payload["avgPx"])
	}
	if price <= 0 {
		price = floatFromAny(payload["fillPx"])
	}

	size := floatFromAny(payload["sz"])
	filled := floatFromAny(payload["accFillSz"])
	createdAt := unixMillisFromAny(payload["cTime"])
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	updatedAt := unixMillisFromAny(payload["uTime"])
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}

	return models.Order{
		ID:        firstNonEmpty(stringFromAny(payload["ordId"]), stringFromAny(payload["clOrdId"])),
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Side:      parseOKXOrderSide(stringFromAny(payload["side"])),
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    parseOKXOrderStatus(stringFromAny(payload["state"]), filled),
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
	}
}

func buildOKXSpotMarket(info okxInstrumentInfo, ticker okxTicker) models.Market {
	mid := ticker.LastPrice
	switch {
	case ticker.BidPrice > 0 && ticker.AskPrice > 0:
		mid = (ticker.BidPrice + ticker.AskPrice) / 2
	case mid <= 0:
		mid = ticker.BidPrice
	}

	liquidity := ticker.BidPrice*ticker.BidQty + ticker.AskPrice*ticker.AskQty
	return models.Market{
		ID:        info.InstID,
		Question:  fmt.Sprintf("%s/%s Spot", info.BaseAsset, info.QuoteAsset),
		Outcomes:  []string{info.BaseAsset},
		Liquidity: liquidity,
		Prices:    map[string]float64{info.BaseAsset: mid},
		Metadata: map[string]any{
			"market_type":  "spot",
			"symbol":       info.InstID,
			"base_asset":   info.BaseAsset,
			"quote_asset":  info.QuoteAsset,
			"status":       info.State,
			"clobTokenIds": []string{info.InstID},
			"tokens":       map[string]any{info.BaseAsset: info.InstID},
		},
		TickSize: info.TickSize,
	}
}

func parseOKXInstrumentInfo(data map[string]any) okxInstrumentInfo {
	return okxInstrumentInfo{
		InstID:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["instId"]))),
		State:      strings.ToUpper(strings.TrimSpace(stringFromAny(data["state"]))),
		BaseAsset:  strings.ToUpper(strings.TrimSpace(stringFromAny(data["baseCcy"]))),
		QuoteAsset: strings.ToUpper(strings.TrimSpace(stringFromAny(data["quoteCcy"]))),
		TickSize:   floatFromAny(data["tickSz"]),
		LotSize:    floatFromAny(data["lotSz"]),
		MinSize:    floatFromAny(data["minSz"]),
	}
}

func parseOKXTicker(data map[string]any) okxTicker {
	return okxTicker{
		InstID:    strings.ToUpper(strings.TrimSpace(stringFromAny(data["instId"]))),
		BidPrice:  floatFromAny(data["bidPx"]),
		BidQty:    floatFromAny(data["bidSz"]),
		AskPrice:  floatFromAny(data["askPx"]),
		AskQty:    floatFromAny(data["askSz"]),
		LastPrice: floatFromAny(data["last"]),
	}
}

func parseOKXOrderStatus(status string, filled float64) models.OrderStatus {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "live":
		return models.OrderStatusOpen
	case "partially_filled":
		return models.OrderStatusPartiallyFilled
	case "filled":
		return models.OrderStatusFilled
	case "canceled", "mmp_canceled":
		return models.OrderStatusCancelled
	default:
		if filled > 0 {
			return models.OrderStatusPartiallyFilled
		}
		return models.OrderStatusPending
	}
}

func parseOKXOrderSide(side string) models.OrderSide {
	switch strings.ToLower(strings.TrimSpace(side)) {
	case "sell":
		return models.OrderSideSell
	default:
		return models.OrderSideBuy
	}
}

func preferredOKXSymbolsByBaseAsset(infos map[string]okxInstrumentInfo) map[string]string {
	out := map[string]string{}
	for _, info := range infos {
		if info.InstID == "" || info.BaseAsset == "" || info.State != "LIVE" {
			continue
		}
		prev, exists := out[info.BaseAsset]
		if !exists || quoteAssetPriority(info.QuoteAsset) < quoteAssetPriority(infos[prev].QuoteAsset) {
			out[info.BaseAsset] = info.InstID
		}
	}
	return out
}

func classifyOKXError(statusCode int, endpoint string, payload []byte) error {
	root := map[string]any{}
	_ = json.Unmarshal(payload, &root)
	code := strings.TrimSpace(stringFromAny(root["code"]))
	msg := strings.TrimSpace(firstNonEmpty(stringFromAny(root["msg"]), string(payload)))
	if code != "" && code != "0" {
		return classifyOKXEnvelopeError(code, msg, endpoint)
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return base.AuthenticationError{Message: msg}
	}
	return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", statusCode, msg)}
}

func classifyOKXEnvelopeError(code, message, endpoint string) error {
	switch strings.TrimSpace(code) {
	case "50101", "50102", "50105", "50110", "50111", "50112", "50113", "50114", "50115", "50119":
		return base.AuthenticationError{Message: message}
	case "51008", "51131":
		return base.InsufficientFunds{Message: message}
	default:
		if strings.Contains(strings.ToLower(message), "insufficient") {
			return base.InsufficientFunds{Message: message}
		}
		if strings.Contains(endpoint, "/trade/") {
			return base.InvalidOrder{Message: message}
		}
		return base.ExchangeError{Message: message}
	}
}

func copyOKXSymbolInfoMap(source map[string]okxInstrumentInfo) map[string]okxInstrumentInfo {
	out := make(map[string]okxInstrumentInfo, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}
