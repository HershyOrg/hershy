package bybit

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/models"
)

func (b *Bybit) fetchOrderFromEndpoint(endpoint, symbol, identifierKey, identifier string) (models.Order, bool, error) {
	values := url.Values{}
	values.Set("category", "spot")
	values.Set("symbol", symbol)
	values.Set(identifierKey, strings.TrimSpace(identifier))
	payload, err := b.doSignedQueryRequest(http.MethodGet, endpoint, values)
	if err != nil {
		return models.Order{}, false, err
	}
	orders, err := b.parseOrderList(payload, symbol)
	if err != nil {
		return models.Order{}, false, err
	}
	if len(orders) == 0 {
		return models.Order{}, false, nil
	}
	return orders[0], true, nil
}

func (b *Bybit) parseOrderList(payload any, fallbackSymbol string) ([]models.Order, error) {
	root, ok := payload.(map[string]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit order list response malformed"}
	}
	items, ok := root["list"].([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "bybit order list missing"}
	}

	orders := make([]models.Order, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		orders = append(orders, b.parseOrder(mapped, fallbackSymbol))
	}
	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, nil
}

func (b *Bybit) parseOrder(payload map[string]any, fallbackSymbol string) models.Order {
	symbol := strings.ToUpper(strings.TrimSpace(firstNonEmpty(stringFromAny(payload["symbol"]), fallbackSymbol)))
	info, _ := b.fetchSymbolInfo(symbol)

	price := floatFromAny(payload["price"])
	if price <= 0 {
		price = floatFromAny(payload["avgPrice"])
	}
	size := floatFromAny(payload["qty"])
	filled := floatFromAny(payload["cumExecQty"])
	createdAt := unixMillisFromAny(firstNonEmpty(stringFromAny(payload["createdTime"]), stringFromAny(payload["createdAt"])))
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	updatedAt := unixMillisFromAny(firstNonEmpty(stringFromAny(payload["updatedTime"]), stringFromAny(payload["updatedAt"])))
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}

	return models.Order{
		ID:        firstNonEmpty(stringFromAny(payload["orderId"]), stringFromAny(payload["orderLinkId"])),
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Side:      parseBybitOrderSide(stringFromAny(payload["side"])),
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    parseBybitOrderStatus(stringFromAny(payload["orderStatus"]), filled),
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
	}
}

func buildBybitSpotMarket(info bybitSymbolInfo, ticker bybitTicker) models.Market {
	mid := ticker.LastPrice
	switch {
	case ticker.BidPrice > 0 && ticker.AskPrice > 0:
		mid = (ticker.BidPrice + ticker.AskPrice) / 2
	case mid <= 0:
		mid = ticker.BidPrice
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

func parseBybitSymbolInfo(data map[string]any) bybitSymbolInfo {
	info := bybitSymbolInfo{
		Symbol:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		Status:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["status"]))),
		BaseAsset:  strings.ToUpper(strings.TrimSpace(stringFromAny(data["baseCoin"]))),
		QuoteAsset: strings.ToUpper(strings.TrimSpace(stringFromAny(data["quoteCoin"]))),
	}

	if priceFilter, ok := data["priceFilter"].(map[string]any); ok {
		info.TickSize = floatFromAny(priceFilter["tickSize"])
	}
	if lotSizeFilter, ok := data["lotSizeFilter"].(map[string]any); ok {
		info.QtyStep = firstPositive(
			floatFromAny(lotSizeFilter["qtyStep"]),
			floatFromAny(lotSizeFilter["basePrecision"]),
		)
		info.MinOrderQty = floatFromAny(lotSizeFilter["minOrderQty"])
		info.MinOrderAmt = floatFromAny(lotSizeFilter["minOrderAmt"])
	}
	return info
}

func parseBybitTicker(data map[string]any) bybitTicker {
	return bybitTicker{
		Symbol:    strings.ToUpper(strings.TrimSpace(stringFromAny(data["symbol"]))),
		BidPrice:  floatFromAny(data["bid1Price"]),
		BidQty:    floatFromAny(data["bid1Size"]),
		AskPrice:  floatFromAny(data["ask1Price"]),
		AskQty:    floatFromAny(data["ask1Size"]),
		LastPrice: floatFromAny(data["lastPrice"]),
	}
}

func parseBybitOrderStatus(status string, filled float64) models.OrderStatus {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "NEW", "PARTIALLYFILLED":
		if filled > 0 && strings.EqualFold(strings.TrimSpace(status), "PartiallyFilled") {
			return models.OrderStatusPartiallyFilled
		}
		return models.OrderStatusOpen
	case "FILLED":
		return models.OrderStatusFilled
	case "CANCELLED", "PARTIALLYFILLEDCANCELED", "DEACTIVATED":
		return models.OrderStatusCancelled
	case "REJECTED":
		return models.OrderStatusRejected
	default:
		if filled > 0 {
			return models.OrderStatusPartiallyFilled
		}
		return models.OrderStatusPending
	}
}

func parseBybitOrderSide(side string) models.OrderSide {
	switch strings.ToUpper(strings.TrimSpace(side)) {
	case "SELL":
		return models.OrderSideSell
	default:
		return models.OrderSideBuy
	}
}

func bybitOrderSide(side models.OrderSide) string {
	if side == models.OrderSideSell {
		return "Sell"
	}
	return "Buy"
}

func preferredBybitSymbolsByBaseAsset(infos map[string]bybitSymbolInfo) map[string]string {
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

func classifyBybitError(statusCode int, endpoint string, payload []byte) error {
	root := map[string]any{}
	_ = json.Unmarshal(payload, &root)
	retCode := intFromAny(root["retCode"], 0)
	retMsg := strings.TrimSpace(firstNonEmpty(stringFromAny(root["retMsg"]), string(payload)))
	if retCode != 0 {
		return classifyBybitEnvelopeError(retCode, retMsg, endpoint)
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return base.AuthenticationError{Message: retMsg}
	}
	return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", statusCode, retMsg)}
}

func classifyBybitEnvelopeError(retCode int, message, endpoint string) error {
	switch retCode {
	case 10003, 10004, 10005, 10007, 33004:
		return base.AuthenticationError{Message: message}
	case 110004, 110007, 170131:
		return base.InsufficientFunds{Message: message}
	case 10001, 110001, 110003, 110008, 110010, 110017, 170005, 170130, 170132, 170136, 170137, 170140:
		return base.InvalidOrder{Message: message}
	default:
		if strings.Contains(endpoint, "/order") {
			return base.InvalidOrder{Message: message}
		}
		return base.ExchangeError{Message: message}
	}
}

func copyBybitSymbolInfoMap(source map[string]bybitSymbolInfo) map[string]bybitSymbolInfo {
	out := make(map[string]bybitSymbolInfo, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}
