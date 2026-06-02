package basis

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPositionStoreAddActiveUpdate(t *testing.T) {
	store, err := NewPositionStore(filepath.Join(t.TempDir(), "positions.json"))
	if err != nil {
		t.Fatalf("NewPositionStore: %v", err)
	}
	position := Position{
		ID:            "TEST-1",
		Status:        PositionStatusOpen,
		Asset:         "TEST",
		NotionalQuote: "10",
		EntryGapPct:   "5.5",
		OpenedAt:      time.Unix(1700000000, 0).UTC(),
		Spot: SpotLeg{
			DEXID:         "uniswap",
			TokenAddress:  "0xToken",
			QuoteAddress:  "0xQuote",
			QuoteSymbol:   "USDT",
			AmountInWei:   "10000000",
			TokenQtyWei:   "123",
			UniswapV3Fee:  2500,
			PoolAddress:   "0xPool",
			RouterAddress: "0xRouter",
		},
		Futures: FuturesLeg{
			ExchangeID:   "binance_futures",
			Symbol:       "TESTUSDT",
			Quantity:     "123",
			PositionSide: "SHORT",
		},
	}
	if err := store.Add(position); err != nil {
		t.Fatalf("Add: %v", err)
	}
	active, err := store.Active()
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(active) != 1 || active[0].ID != position.ID {
		t.Fatalf("active = %#v, want one TEST-1", active)
	}

	closedAt := time.Unix(1700000100, 0).UTC()
	position.Status = PositionStatusClosed
	position.CloseReason = "force"
	position.ClosedAt = &closedAt
	if err := store.Update(position); err != nil {
		t.Fatalf("Update: %v", err)
	}
	active, err = store.Active()
	if err != nil {
		t.Fatalf("Active after update: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("active after close = %#v, want none", active)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(loaded) != 1 || loaded[0].CloseReason != "force" {
		t.Fatalf("loaded = %#v", loaded)
	}
}
