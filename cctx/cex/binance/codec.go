package binance

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

func (b *Binance) parseOrder(payload map[string]any, fallbackSymbol string) models.Order {
	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["symbol"]), fallbackSymbol)))
	info, _ := b.fetchSymbolInfo(symbol)

	price := floatFromAny(payload["price"])
	if price <= 0 {
		price = floatFromAny(payload["stopPrice"])
	}
	if price <= 0 {
		price = floatFromAny(payload["fillsPrice"])
	}

	size := floatFromAny(payload["origQty"])
	if size <= 0 {
		size = floatFromAny(payload["executedQty"])
	}

	filled := floatFromAny(payload["executedQty"])
	createdAt := unixMillisFromAny(payload["time"])
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	updatedAt := unixMillisFromAny(payload["updateTime"])
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}

	return models.Order{
		ID:        firstNonEmpty(stringFromAny(payload["orderId"]), stringFromAny(payload["clientOrderId"])),
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Side:      parseOrderSide(stringFromAny(payload["side"])),
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    parseOrderStatus(stringFromAny(payload["status"])),
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
	}
}

func buildSpotMarket(info binanceSymbolInfo, ticker binanceBookTicker) models.Market {
	mid := ticker.BidPrice
	if ticker.AskPrice > 0 {
		if ticker.BidPrice > 0 {
			mid = (ticker.BidPrice + ticker.AskPrice) / 2
		} else {
			mid = ticker.AskPrice
		}
	}

	liquidity := ticker.BidPrice*ticker.BidQty + ticker.AskPrice*ticker.AskQty
	return models.Market{
		ID:        info.Symbol,
		Question:  fmt.Sprintf("%s/%s Spot", info.BaseAsset, info.QuoteAsset),
		Outcomes:  []string{info.BaseAsset},
		Liquidity: liquidity,
		Prices:    map[string]float64{info.BaseAsset: mid},
		Metadata: map[string]any{
			"market_type":  "spot",
			"symbol":       info.Symbol,
			"base_asset":   info.BaseAsset,
			"quote_asset":  info.QuoteAsset,
			"status":       info.Status,
			"clobTokenIds": []string{info.Symbol},
			"tokens":       map[string]any{info.BaseAsset: info.Symbol},
		},
		TickSize: info.TickSize,
	}
}

func parseSymbolInfo(data map[string]any) binanceSymbolInfo {
	info := binanceSymbolInfo{
		Symbol:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		Status:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["status"]))),
		BaseAsset:  strings.ToUpper(strings.TrimSpace(stringFromAny(data["baseAsset"]))),
		QuoteAsset: strings.ToUpper(strings.TrimSpace(stringFromAny(data["quoteAsset"]))),
	}

	filters, _ := data["filters"].([]any)
	for _, item := range filters {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch strings.ToUpper(strings.TrimSpace(stringFromAny(mapped["filterType"]))) {
		case "PRICE_FILTER":
			info.TickSize = floatFromAny(mapped["tickSize"])
		case "LOT_SIZE":
			info.StepSize = floatFromAny(mapped["stepSize"])
		}
	}
	return info
}

func parseBookTicker(data map[string]any) binanceBookTicker {
	return binanceBookTicker{
		Symbol:   strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		BidPrice: floatFromAny(data["bidPrice"]),
		BidQty:   floatFromAny(data["bidQty"]),
		AskPrice: floatFromAny(data["askPrice"]),
		AskQty:   floatFromAny(data["askQty"]),
	}
}

func parseOrderStatus(status string) models.OrderStatus {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "NEW":
		return models.OrderStatusOpen
	case "PARTIALLY_FILLED":
		return models.OrderStatusPartiallyFilled
	case "FILLED":
		return models.OrderStatusFilled
	case "CANCELED", "PENDING_CANCEL", "EXPIRED", "EXPIRED_IN_MATCH":
		return models.OrderStatusCancelled
	case "REJECTED":
		return models.OrderStatusRejected
	default:
		return models.OrderStatusPending
	}
}

func parseOrderSide(side string) models.OrderSide {
	switch strings.ToUpper(strings.TrimSpace(side)) {
	case "SELL":
		return models.OrderSideSell
	default:
		return models.OrderSideBuy
	}
}

func classifyBinanceError(statusCode int, endpoint string, payload []byte) error {
	type errBody struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	var parsed errBody
	_ = json.Unmarshal(payload, &parsed)
	message := strings.TrimSpace(parsed.Msg)
	if message == "" {
		message = strings.TrimSpace(string(payload))
	}
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return base.AuthenticationError{Message: message}
	case parsed.Code == -2015 || parsed.Code == -2014 || parsed.Code == -1022:
		return base.AuthenticationError{Message: message}
	case parsed.Code == -2010 || parsed.Code == -1013 || parsed.Code == -1100 || strings.Contains(endpoint, "/order"):
		return base.InvalidOrder{Message: message}
	default:
		return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", statusCode, message)}
	}
}

func preferredSymbolsByBaseAsset(infos map[string]binanceSymbolInfo) map[string]string {
	out := map[string]string{}
	for _, info := range infos {
		if info.Symbol == "" || info.BaseAsset == "" || info.Status != "TRADING" {
			continue
		}
		prev, exists := out[info.BaseAsset]
		if !exists || quoteAssetPriority(info.QuoteAsset) < quoteAssetPriority(infos[prev].QuoteAsset) {
			out[info.BaseAsset] = info.Symbol
		}
	}
	return out
}

func copySymbolInfoMap(source map[string]binanceSymbolInfo) map[string]binanceSymbolInfo {
	out := make(map[string]binanceSymbolInfo, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}
