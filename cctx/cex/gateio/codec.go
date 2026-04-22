package gateio

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

func (g *GateIO) parseOrderList(payload any) ([]models.Order, error) {
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "gateio order list response malformed"}
	}

	orders := make([]models.Order, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			continue
		}
		orders = append(orders, g.parseOrder(mapped))
	}
	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, nil
}

func (g *GateIO) parseOpenOrderGroups(payload any) ([]models.Order, error) {
	items, ok := payload.([]any)
	if !ok {
		return nil, base.ExchangeError{Message: "gateio open orders response malformed"}
	}

	orders := []models.Order{}
	for _, item := range items {
		group, ok := item.(map[string]any)
		if !ok {
			continue
		}
		rawOrders, ok := group["orders"].([]any)
		if !ok {
			continue
		}
		for _, rawOrder := range rawOrders {
			mapped, ok := rawOrder.(map[string]any)
			if !ok {
				continue
			}
			orders = append(orders, g.parseOrder(mapped))
		}
	}
	sort.SliceStable(orders, func(i, j int) bool {
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, nil
}

func (g *GateIO) parseOrder(payload map[string]any) models.Order {
	symbol := strings.ToUpper(strings.TrimSpace(stringFromAny(payload["currency_pair"])))
	info, _ := g.fetchPairInfo(symbol)

	size := floatFromAny(payload["amount"])
	filled := floatFromAny(payload["filled_amount"])
	if filled <= 0 && size > 0 {
		left := floatFromAny(payload["left"])
		if left >= 0 && left <= size {
			filled = size - left
		}
	}

	price := floatFromAny(payload["avg_deal_price"])
	if price <= 0 {
		price = floatFromAny(payload["price"])
	}
	if price <= 0 {
		price = floatFromAny(payload["fill_price"])
	}

	createdAt := unixSecondsFromAny(payload["create_time"])
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	updatedAt := unixSecondsFromAny(payload["update_time"])
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}

	return models.Order{
		ID:        firstNonEmpty(stringFromAny(payload["id"]), stringFromAny(payload["text"])),
		MarketID:  symbol,
		Outcome:   info.BaseAsset,
		Side:      parseGateIOOrderSide(stringFromAny(payload["side"])),
		Price:     price,
		Size:      size,
		Filled:    filled,
		Status:    parseGateIOOrderStatus(stringFromAny(payload["status"]), stringFromAny(payload["finish_as"]), size, filled),
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
	}
}

func buildGateIOSpotMarket(info gateCurrencyPairInfo, ticker gateTicker) models.Market {
	mid := ticker.LastPrice
	switch {
	case ticker.BidPrice > 0 && ticker.AskPrice > 0:
		mid = (ticker.BidPrice + ticker.AskPrice) / 2
	case mid <= 0:
		mid = ticker.BidPrice
	}

	return models.Market{
		ID:        info.PairID,
		Question:  fmt.Sprintf("%s/%s Spot", info.BaseAsset, info.QuoteAsset),
		Outcomes:  []string{info.BaseAsset},
		Liquidity: ticker.QuoteVolume,
		Volume:    ticker.BaseVolume,
		Prices:    map[string]float64{info.BaseAsset: mid},
		Metadata: map[string]any{
			"market_type":  "spot",
			"symbol":       info.PairID,
			"base_asset":   info.BaseAsset,
			"quote_asset":  info.QuoteAsset,
			"trade_status": info.TradeStatus,
			"clobTokenIds": []string{info.PairID},
			"tokens":       map[string]any{info.BaseAsset: info.PairID},
		},
		TickSize: info.TickSize,
	}
}

func parseGateCurrencyPairInfo(data map[string]any) gateCurrencyPairInfo {
	pricePrecision := intFromAny(data["precision"], 0)
	amountPrecision := intFromAny(data["amount_precision"], 0)
	return gateCurrencyPairInfo{
		PairID:         strings.ToUpper(strings.TrimSpace(stringFromAny(data["id"]))),
		BaseAsset:      strings.ToUpper(strings.TrimSpace(stringFromAny(data["base"]))),
		QuoteAsset:     strings.ToUpper(strings.TrimSpace(stringFromAny(data["quote"]))),
		TradeStatus:    strings.ToLower(strings.TrimSpace(stringFromAny(data["trade_status"]))),
		TickSize:       precisionStep(pricePrecision),
		AmountStep:     precisionStep(amountPrecision),
		MinBaseAmount:  floatFromAny(data["min_base_amount"]),
		MinQuoteAmount: floatFromAny(data["min_quote_amount"]),
	}
}

func parseGateTicker(data map[string]any) gateTicker {
	return gateTicker{
		PairID:      strings.ToUpper(strings.TrimSpace(stringFromAny(data["currency_pair"]))),
		LastPrice:   floatFromAny(data["last"]),
		BidPrice:    floatFromAny(data["highest_bid"]),
		AskPrice:    floatFromAny(data["lowest_ask"]),
		BidQty:      floatFromAny(data["highest_size"]),
		AskQty:      floatFromAny(data["lowest_size"]),
		BaseVolume:  floatFromAny(data["base_volume"]),
		QuoteVolume: floatFromAny(data["quote_volume"]),
	}
}

func parseGateIOOrderStatus(status, finishAs string, size, filled float64) models.OrderStatus {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "open":
		if filled > 0 && filled < size {
			return models.OrderStatusPartiallyFilled
		}
		return models.OrderStatusOpen
	case "cancelled":
		return models.OrderStatusCancelled
	case "closed":
		switch strings.ToLower(strings.TrimSpace(finishAs)) {
		case "filled":
			return models.OrderStatusFilled
		case "cancelled", "ioc", "fok", "stp", "depth_not_enough", "trader_not_enough", "small", "price_protect_cancelled", "liquidate_cancelled":
			if filled >= size && size > 0 {
				return models.OrderStatusFilled
			}
			if filled > 0 {
				return models.OrderStatusCancelled
			}
			return models.OrderStatusCancelled
		default:
			if filled >= size && size > 0 {
				return models.OrderStatusFilled
			}
			if filled > 0 {
				return models.OrderStatusCancelled
			}
			return models.OrderStatusPending
		}
	default:
		if filled > 0 && filled < size {
			return models.OrderStatusPartiallyFilled
		}
		return models.OrderStatusPending
	}
}

func parseGateIOOrderSide(side string) models.OrderSide {
	switch strings.ToLower(strings.TrimSpace(side)) {
	case "sell":
		return models.OrderSideSell
	default:
		return models.OrderSideBuy
	}
}

func preferredGateSymbolsByBaseAsset(infos map[string]gateCurrencyPairInfo) map[string]string {
	out := map[string]string{}
	for _, info := range infos {
		if info.PairID == "" || info.BaseAsset == "" || info.TradeStatus == "untradable" {
			continue
		}
		prev, exists := out[info.BaseAsset]
		if !exists || quoteAssetPriority(info.QuoteAsset) < quoteAssetPriority(infos[prev].QuoteAsset) {
			out[info.BaseAsset] = info.PairID
		}
	}
	return out
}

func classifyGateIOError(statusCode int, endpoint string, payload []byte) error {
	root := map[string]any{}
	_ = json.Unmarshal(payload, &root)
	label := strings.TrimSpace(stringFromAny(root["label"]))
	message := strings.TrimSpace(firstNonEmpty(stringFromAny(root["message"]), string(payload)))
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return base.AuthenticationError{Message: message}
	}
	if strings.Contains(strings.ToLower(label), "insufficient") || strings.Contains(strings.ToLower(message), "insufficient") {
		return base.InsufficientFunds{Message: message}
	}
	if statusCode == http.StatusBadRequest || statusCode == http.StatusUnprocessableEntity {
		if strings.Contains(endpoint, "/spot/orders") {
			return base.InvalidOrder{Message: message}
		}
	}
	return base.ExchangeError{Message: fmt.Sprintf("http %d: %s", statusCode, message)}
}

func copyGatePairInfoMap(source map[string]gateCurrencyPairInfo) map[string]gateCurrencyPairInfo {
	out := make(map[string]gateCurrencyPairInfo, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}
