package models

import (
	"time"

	"host/will/utils"
)

type OrderSide string

const (
	// OrderSideBuy represents a buy order.
	OrderSideBuy OrderSide = "buy"
	// OrderSideSell represents a sell order.
	OrderSideSell OrderSide = "sell"
)

type OrderStatus string

const (
	// OrderStatusPending represents an order queued but not active.
	//Pending=거래소 큐에서 대기
	OrderStatusPending OrderStatus = "pending"
	// OrderStatusOpen represents an active order.
	//Open=호가창에 노출 but 체결 x
	OrderStatusOpen OrderStatus = "open"
	// OrderStatusFilled represents a fully filled order.
	//Filled= 모든 Size가 체결됨
	OrderStatusFilled OrderStatus = "filled"
	// OrderStatusPartiallyFilled represents a partially filled order.
	//PartiallyFilled= Order Size중 일부만 체결된 상태
	OrderStatusPartiallyFilled OrderStatus = "partially_filled"
	// OrderStatusCancelled represents a cancelled order.
	// cancelled = 체결 전 주문이 cancel된 상태
	OrderStatusCancelled OrderStatus = "cancelled"
	// OrderStatusRejected represents a rejected order.
	// rejected = 주문이 거부된 상태
	//ex: 서명 오류, 잔고 부족, 가격범위 위반
	OrderStatusRejected OrderStatus = "rejected"
)

// Order represents an order on a prediction market.
type Order struct {
	// ID is the exchange-specific order identifier.
	//Order의 고유 Id임
	ID string
	// MarketID is the market identifier for the order.
	MarketID string
	// Outcome is the outcome label (e.g., Yes/No) for the order.
	Outcome string
	// Side is the buy/sell side of the order.
	Side OrderSide
	// Price is the limit/expected price for the order.
	// 시장가 주문의 경우 주문 직전의 midPrice로 요청
	Price float64
	// Size is the total size requested by the order.
	Size float64
	// Filled is the cumulative filled size for the order.
	// 현재까지 누적으로 채워진 Order의 체결량
	Filled float64
	// Status is the current status of the order.
	Status OrderStatus
	// CreatedAt is the time when the order was created.
	CreatedAt time.Time
	// UpdatedAt is the time when the order was last updated.
	UpdatedAt *time.Time
}

// Remaining returns the amount remaining to be filled.
func (o Order) Remaining() float64 {
	if o.Size == 0 {
		utils.DefaultLogger().Debugf("models.Order.Remaining: size is zero for orderID=%s", o.ID)
	}
	return o.Size - o.Filled
}

// IsActive reports whether the order is still active.
// 아예 Open상태 || 부분 체결 상태
func (o Order) IsActive() bool {
	if o.Status == "" {
		utils.DefaultLogger().Debugf("models.Order.IsActive: status empty for orderID=%s", o.ID)
	}
	return o.Status == OrderStatusOpen || o.Status == OrderStatusPartiallyFilled
}

// IsOpen reports whether the order is open.
// 아예 Open상태 || 부분 체결 상태
func (o Order) IsOpen() bool {
	if o.Status == "" {
		utils.DefaultLogger().Debugf("models.Order.IsOpen: status empty for orderID=%s", o.ID)
	}
	return o.Status == OrderStatusOpen || o.Status == OrderStatusPartiallyFilled
}

// IsFilled reports whether the order is completely filled.
func (o Order) IsFilled() bool {
	if o.Size == 0 {
		utils.DefaultLogger().Debugf("models.Order.IsFilled: size is zero for orderID=%s", o.ID)
	}
	return o.Status == OrderStatusFilled || o.Filled >= o.Size
}

// FillPercentage returns fill percentage (0-1).
func (o Order) FillPercentage() float64 {
	if o.Size == 0 {
		utils.DefaultLogger().Debugf("models.Order.FillPercentage: size is zero for orderID=%s", o.ID)
		return 0
	}
	return o.Filled / o.Size
}
