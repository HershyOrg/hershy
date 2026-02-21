package base

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/cctx/models"
	"github.com/HershyOrg/hershy/cctx/utils"
)

// OrderEvent represents order lifecycle events.
type OrderEvent string

const (
	OrderEventCreated     OrderEvent = "created"
	OrderEventPartialFill OrderEvent = "partial_fill"
	OrderEventFilled      OrderEvent = "filled"
	OrderEventCancelled   OrderEvent = "cancelled"
	OrderEventRejected    OrderEvent = "rejected"
	OrderEventExpired     OrderEvent = "expired"
)

// Trade represents a user trade fill event.
type Trade struct {
	// OrderID is the filled order identifier.
	OrderID string
	// MarketID is the related market identifier.
	MarketID string
	// Outcome is the outcome label.
	Outcome string
	// Price is the trade price.
	Price float64
	// Size is the trade size.
	Size float64
}

// TrackedOrder stores state for an order.
type TrackedOrder struct {
	// Order is the original order snapshot.
	Order models.Order
	// TotalFilled is the cumulative filled size.
	TotalFilled float64
	// CreatedTime is when the order started tracking.
	CreatedTime time.Time
}

// OrderCallback is called on order lifecycle events.
type OrderCallback func(event OrderEvent, order models.Order, fillSize float64)

// OrderTracker tracks orders and detects fills via trade events.
// Exchange마다 OrderTracker존재함
type OrderTracker struct {
	// Verbose toggles verbose logging.
	Verbose bool
	// trackedOrders stores orders by ID.
	trackedOrders map[string]*TrackedOrder
	// callbacks stores fill event handlers.
	callbacks []OrderCallback
	// mu guards tracker state.
	mu sync.Mutex
}

// NewOrderTracker creates a tracker.
func NewOrderTracker(verbose bool) *OrderTracker {
	return &OrderTracker{
		Verbose:       verbose,
		trackedOrders: map[string]*TrackedOrder{},
	}
}

// OnFill registers a callback for fill events.
func (t *OrderTracker) OnFill(callback OrderCallback) *OrderTracker {
	t.callbacks = append(t.callbacks, callback)
	return t
}

// On is an alias for OnFill.
func (t *OrderTracker) On(callback OrderCallback) *OrderTracker {
	return t.OnFill(callback)
}

// TrackOrder starts tracking an order.
func (t *OrderTracker) TrackOrder(order models.Order) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if order.ID == "" {
		utils.DefaultLogger().Debugf("base.OrderTracker.TrackOrder: order ID empty")
	}
	if order.Size == 0 {
		utils.DefaultLogger().Debugf("base.OrderTracker.TrackOrder: order size zero for orderID=%s", order.ID)
	}
	if _, ok := t.trackedOrders[order.ID]; ok {
		return
	}
	t.trackedOrders[order.ID] = &TrackedOrder{
		Order:       order,
		TotalFilled: order.Filled,
		CreatedTime: time.Now(),
	}
}

// UntrackOrder stops tracking an order.
func (t *OrderTracker) UntrackOrder(orderID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.trackedOrders, orderID)
}

// HandleTrade handles a trade event from a user WebSocket.
func (t *OrderTracker) HandleTrade(trade Trade) {
	if trade.OrderID == "" {
		utils.DefaultLogger().Debugf("base.OrderTracker.HandleTrade: trade order ID empty")
	}
	if trade.Size == 0 {
		utils.DefaultLogger().Debugf("base.OrderTracker.HandleTrade: trade size zero for orderID=%s", trade.OrderID)
	}
	t.mu.Lock()
	tracked, ok := t.trackedOrders[trade.OrderID]
	if !ok {
		t.mu.Unlock()
		return
	}

	tracked.TotalFilled += trade.Size
	status := models.OrderStatusPartiallyFilled
	if tracked.TotalFilled >= tracked.Order.Size {
		status = models.OrderStatusFilled
	}

	updatedOrder := models.Order{
		ID:        tracked.Order.ID,
		MarketID:  pickOrFallback(trade.MarketID, tracked.Order.MarketID),
		Outcome:   pickOrFallback(trade.Outcome, tracked.Order.Outcome),
		Side:      tracked.Order.Side,
		Price:     trade.Price,
		Size:      tracked.Order.Size,
		Filled:    tracked.TotalFilled,
		Status:    status,
		CreatedAt: tracked.Order.CreatedAt,
		UpdatedAt: timePtr(time.Now()),
	}
	tracked.Order = updatedOrder
	isComplete := tracked.TotalFilled >= tracked.Order.Size
	t.mu.Unlock()

	event := OrderEventPartialFill
	if isComplete {
		event = OrderEventFilled
	}
	t.emit(event, updatedOrder, trade.Size)
	if isComplete {
		t.UntrackOrder(trade.OrderID)
	}
}

// TrackedCount returns the number of tracked orders.
func (t *OrderTracker) TrackedCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.trackedOrders)
}

// GetTrackedOrders returns all tracked orders.
func (t *OrderTracker) GetTrackedOrders() []models.Order {
	t.mu.Lock()
	defer t.mu.Unlock()
	orders := make([]models.Order, 0, len(t.trackedOrders))
	for _, tracked := range t.trackedOrders {
		orders = append(orders, tracked.Order)
	}
	return orders
}

// Start is a no-op for compatibility.
func (t *OrderTracker) Start() {}

// Stop clears tracked orders.
func (t *OrderTracker) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.trackedOrders = map[string]*TrackedOrder{}
}

// CreateFillLogger returns a callback that logs fills.
func CreateFillLogger(logger *utils.Logger) OrderCallback {
	if logger == nil {
		logger = utils.DefaultLogger()
	}
	return func(event OrderEvent, order models.Order, fillSize float64) {
		sideStr := strings.ToUpper(string(order.Side))
		switch event {
		case OrderEventFilled:
			logger.Infof("%s %s %s %.2f @ %s", utils.Green("FILLED"), utils.Magenta(order.Outcome), sideStr, fillSize, utils.Yellow(formatPrice(order.Price)))
		case OrderEventPartialFill:
			logger.Infof("%s %s %s +%.2f (%.2f/%.2f) @ %s", utils.Cyan("PARTIAL"), utils.Magenta(order.Outcome), sideStr, fillSize, order.Filled, order.Size, utils.Yellow(formatPrice(order.Price)))
		case OrderEventCancelled:
			logger.Infof("%s %s %s %.2f @ %s (filled: %.2f)", utils.Red("CANCELLED"), utils.Magenta(order.Outcome), sideStr, order.Size, utils.Yellow(formatPrice(order.Price)), order.Filled)
		}
	}
}

// emit delivers an order event to callbacks.
func (t *OrderTracker) emit(event OrderEvent, order models.Order, fillSize float64) {
	for _, callback := range t.callbacks {
		callback(event, order, fillSize)
	}
}

// pickOrFallback returns value if non-empty, else fallback.
func pickOrFallback(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

// timePtr returns a pointer to a time value.
func timePtr(value time.Time) *time.Time {
	return &value
}

// formatPrice formats a price for logging.
func formatPrice(price float64) string {
	return fmt.Sprintf("%.4f", price)
}
