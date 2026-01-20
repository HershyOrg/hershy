package models

import (
	"fmt"
	"sort"
	"sync"

	"host/library/utils"
)

// PriceLevel represents a price level with price and size.
// 오더북 한 줄의 상태 = 가격 * 가격에 걸린 수량
type PriceLevel struct {
	// Price is the price at this level.
	Price float64
	// Size is the total size at this level.
	Size float64
}

// Orderbook represents normalized orderbook data.
type Orderbook struct {
	// Bids is a list of bid levels sorted by price desc.
	Bids []PriceLevel
	// Asks is a list of ask levels sorted by price asc.
	Asks []PriceLevel
	// Timestamp is the snapshot timestamp in ms.
	Timestamp int64
	// AssetID is the token/asset identifier.
	//대상 outcomeTokend의 Id임
	//ex: Yes outcome 토큰에 대한 오더북
	AssetID string
	// MarketID is the market identifier.
	MarketID string
}

// BestBid returns the best bid price.
func (o Orderbook) BestBid() *float64 {
	if len(o.Bids) == 0 {
		utils.DefaultLogger().Debugf("models.Orderbook.BestBid: empty bids")
		return nil
	}
	return &o.Bids[0].Price
}

// BestAsk returns the best ask price.
func (o Orderbook) BestAsk() *float64 {
	if len(o.Asks) == 0 {
		utils.DefaultLogger().Debugf("models.Orderbook.BestAsk: empty asks")
		return nil
	}
	return &o.Asks[0].Price
}

// MidPrice returns the mid price.
func (o Orderbook) MidPrice() *float64 {
	bestBid := o.BestBid()
	bestAsk := o.BestAsk()
	if bestBid == nil || bestAsk == nil {
		utils.DefaultLogger().Debugf("models.Orderbook.MidPrice: missing best bid/ask")
		return nil
	}
	mid := (*bestBid + *bestAsk) / 2
	return &mid
}

// Spread returns the bid-ask spread.
// 오더북의 스프레드= bid-ask 스프레드
func (o Orderbook) Spread() *float64 {
	bestBid := o.BestBid()
	bestAsk := o.BestAsk()
	if bestBid == nil || bestAsk == nil {
		utils.DefaultLogger().Debugf("models.Orderbook.Spread: missing best bid/ask")
		return nil
	}
	spread := *bestAsk - *bestBid
	return &spread
}

// FromRESTResponse builds an Orderbook from a REST API response.
func FromRESTResponse(data map[string]any, tokenID string) Orderbook {
	if data == nil {
		utils.DefaultLogger().Debugf("models.FromRESTResponse: data is nil")
	}
	if tokenID == "" {
		utils.DefaultLogger().Debugf("models.FromRESTResponse: tokenID is empty")
	}
	bids := parseLevels(data["bids"])
	asks := parseLevels(data["asks"])

	sort.Slice(bids, func(i, j int) bool { return bids[i].Price > bids[j].Price })
	sort.Slice(asks, func(i, j int) bool { return asks[i].Price < asks[j].Price })

	return Orderbook{
		Bids:    bids,
		Asks:    asks,
		AssetID: tokenID,
	}
}

// OrderbookData is a serializable snapshot of an orderbook.
type OrderbookData struct {
	// Bids is a list of bid levels sorted by price desc.
	Bids []PriceLevel
	// Asks is a list of ask levels sorted by price asc.
	Asks []PriceLevel
	// Timestamp is the snapshot timestamp in ms.
	Timestamp int64
	// AssetID is the token/asset identifier.
	AssetID string
	// MarketID is the market identifier.
	MarketID string
}

// ToData converts an Orderbook to OrderbookData.
func (o Orderbook) ToData() OrderbookData {
	return OrderbookData{
		Bids:      o.Bids,
		Asks:      o.Asks,
		Timestamp: o.Timestamp,
		AssetID:   o.AssetID,
		MarketID:  o.MarketID,
	}
}

// OrderbookManager manages multiple orderbooks.
// 토큰 Id에 따른 오더북 스냅샷 관리함
type OrderbookManager struct {
	mu sync.RWMutex
	// orderbooks maps token IDs to orderbook snapshots.
	orderbooks map[string]OrderbookData
}

// NewOrderbookManager creates a new manager.
func NewOrderbookManager() *OrderbookManager {
	return &OrderbookManager{orderbooks: map[string]OrderbookData{}}
}

// Update sets orderbook data for a token.
func (m *OrderbookManager) Update(tokenID string, orderbook OrderbookData) {
	if tokenID == "" {
		utils.DefaultLogger().Debugf("models.OrderbookManager.Update: tokenID is empty")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.orderbooks == nil {
		m.orderbooks = map[string]OrderbookData{}
	}
	m.orderbooks[tokenID] = orderbook
}

// Get returns orderbook data for a token.
func (m *OrderbookManager) Get(tokenID string) (OrderbookData, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.orderbooks == nil {
		utils.DefaultLogger().Debugf("models.OrderbookManager.Get: orderbooks map is nil")
		return OrderbookData{}, false
	}
	if tokenID == "" {
		utils.DefaultLogger().Debugf("models.OrderbookManager.Get: tokenID is empty")
	}
	orderbook, ok := m.orderbooks[tokenID]
	return orderbook, ok
}

// GetBestBidAsk returns best bid and ask for a token.
func (m *OrderbookManager) GetBestBidAsk(tokenID string) (*float64, *float64) {
	orderbook, ok := m.Get(tokenID)
	if !ok {
		utils.DefaultLogger().Debugf("models.OrderbookManager.GetBestBidAsk: no orderbook for tokenID=%s", tokenID)
		return nil, nil
	}
	if len(orderbook.Bids) == 0 || len(orderbook.Asks) == 0 {
		utils.DefaultLogger().Debugf("models.OrderbookManager.GetBestBidAsk: empty bids/asks for tokenID=%s", tokenID)
		return nil, nil
	}
	return &orderbook.Bids[0].Price, &orderbook.Asks[0].Price
}

// HasData reports whether we have orderbook data for a token.
func (m *OrderbookManager) HasData(tokenID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	orderbook, ok := m.Get(tokenID)
	if !ok {
		utils.DefaultLogger().Debugf("models.OrderbookManager.HasData: no data for tokenID=%s", tokenID)
		return false
	}
	return len(orderbook.Bids) > 0 && len(orderbook.Asks) > 0
}

// HasAllData reports whether we have data for all tokens.
func (m *OrderbookManager) HasAllData(tokenIDs []string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(tokenIDs) == 0 {
		utils.DefaultLogger().Debugf("models.OrderbookManager.HasAllData: tokenIDs empty")
	}
	for _, tokenID := range tokenIDs {
		if !m.HasData(tokenID) {
			return false
		}
	}
	return true
}

// parseLevels converts a raw payload into price levels.
func parseLevels(raw any) []PriceLevel {
	if raw == nil {
		utils.DefaultLogger().Debugf("models.parseLevels: raw is nil")
	}
	items, ok := raw.([]any)
	if !ok {
		utils.DefaultLogger().Debugf("models.parseLevels: raw is not []any (%T)", raw)
		return nil
	}
	if len(items) == 0 {
		utils.DefaultLogger().Debugf("models.parseLevels: no items")
	}
	levels := make([]PriceLevel, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		price, okPrice := toFloat(entry["price"])
		size, okSize := toFloat(entry["size"])
		if !okPrice || !okSize || price <= 0 || size <= 0 {
			continue
		}
		levels = append(levels, PriceLevel{Price: price, Size: size})
	}
	return levels
}

// toFloat coerces a value to float64 when possible.
func toFloat(value any) (float64, bool) {
	if value == nil {
		utils.DefaultLogger().Debugf("models.toFloat: value is nil")
	}
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		var parsed float64
		if _, err := fmt.Sscanf(v, "%f", &parsed); err == nil {
			return parsed, true
		}
	}
	return 0, false
}
