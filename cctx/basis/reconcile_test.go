package basis

import (
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

func TestReconcilePositionBalancedOpen(t *testing.T) {
	position := reconcileTestPosition(PositionStatusOpen)
	got := ReconcilePosition(position, reconcileSpotBalance("1000"), []base.FuturesPosition{
		{Symbol: "ETHUSDT", PositionSide: base.FuturesPositionSideBoth, PositionAmount: "-0.012"},
	}, 50)

	if got.Status != ReconciliationStatusBalancedOpen || got.RecommendedAction != ReconciliationActionNone {
		t.Fatalf("got status=%s action=%s", got.Status, got.RecommendedAction)
	}
	if !got.SpotMatched || !got.FuturesMatched {
		t.Fatalf("expected both legs to match: %#v", got)
	}
}

func TestReconcilePositionSpotOnly(t *testing.T) {
	got := ReconcilePosition(reconcileTestPosition(PositionStatusOpen), reconcileSpotBalance("1000"), nil, 50)

	if got.Status != ReconciliationStatusSpotOnly {
		t.Fatalf("status = %s, want spot_only", got.Status)
	}
	if got.RecommendedAction != ReconciliationActionCloseSpotOnly {
		t.Fatalf("action = %s, want close_spot_only", got.RecommendedAction)
	}
}

func TestReconcilePositionFuturesOnly(t *testing.T) {
	got := ReconcilePosition(reconcileTestPosition(PositionStatusOpen), reconcileSpotBalance("0"), []base.FuturesPosition{
		{Symbol: "ETHUSDT", PositionSide: base.FuturesPositionSideBoth, PositionAmount: "-0.012"},
	}, 50)

	if got.Status != ReconciliationStatusFuturesOnly {
		t.Fatalf("status = %s, want futures_only", got.Status)
	}
	if got.RecommendedAction != ReconciliationActionCloseFuturesOnly {
		t.Fatalf("action = %s, want close_futures_only", got.RecommendedAction)
	}
}

func TestReconcilePositionStateOnlyOpen(t *testing.T) {
	got := ReconcilePosition(reconcileTestPosition(PositionStatusOpen), reconcileSpotBalance("0"), nil, 50)

	if got.Status != ReconciliationStatusStateOnlyOpen {
		t.Fatalf("status = %s, want state_only_open", got.Status)
	}
	if got.RecommendedAction != ReconciliationActionMarkStateClosed {
		t.Fatalf("action = %s, want mark state closed", got.RecommendedAction)
	}
}

func TestReconcilePositionClosedResidualSpot(t *testing.T) {
	got := ReconcilePosition(reconcileTestPosition(PositionStatusClosed), reconcileSpotBalance("1000"), nil, 50)

	if got.Status != ReconciliationStatusResidualSpotAfterClose {
		t.Fatalf("status = %s, want residual spot", got.Status)
	}
	if got.RecommendedAction != ReconciliationActionCloseSpotOnly {
		t.Fatalf("action = %s, want close_spot_only", got.RecommendedAction)
	}
}

func TestReconcilePositionClosedClean(t *testing.T) {
	got := ReconcilePosition(reconcileTestPosition(PositionStatusClosed), reconcileSpotBalance("0"), nil, 50)

	if got.Status != ReconciliationStatusCleanClosed {
		t.Fatalf("status = %s, want clean_closed", got.Status)
	}
	if got.RecommendedAction != ReconciliationActionNone {
		t.Fatalf("action = %s, want none", got.RecommendedAction)
	}
}

func TestReconcilePositionImbalancedOpen(t *testing.T) {
	got := ReconcilePosition(reconcileTestPosition(PositionStatusOpen), reconcileSpotBalance("1000"), []base.FuturesPosition{
		{Symbol: "ETHUSDT", PositionSide: base.FuturesPositionSideBoth, PositionAmount: "-0.025"},
	}, 50)

	if got.Status != ReconciliationStatusImbalancedOpen {
		t.Fatalf("status = %s, want imbalanced_open", got.Status)
	}
	if got.RecommendedAction != ReconciliationActionCloseBoth {
		t.Fatalf("action = %s, want close_both", got.RecommendedAction)
	}
}

func reconcileTestPosition(status PositionStatus) Position {
	return Position{
		ID:     "ETH-live-test",
		Status: status,
		Asset:  "ETH",
		Spot: SpotLeg{
			Chain:        "bsc",
			TokenAddress: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
			QuoteSymbol:  "USDT",
			TokenQtyWei:  "1000",
		},
		Futures: FuturesLeg{
			ExchangeID: "binance_futures",
			Symbol:     "ETHUSDT",
			Quantity:   "0.012",
		},
		OpenedAt: time.Unix(1700000000, 0).UTC(),
	}
}

func reconcileSpotBalance(balanceWei string) base.EVMERC20Balance {
	return base.EVMERC20Balance{
		EVMERC20Metadata: base.EVMERC20Metadata{
			Chain:        "bsc",
			ChainID:      56,
			TokenAddress: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
			Symbol:       "ETH",
			Decimals:     18,
		},
		OwnerAddress:     "0x00000000000000000000000000000000000000aa",
		BalanceWei:       balanceWei,
		BalanceFormatted: balanceWei,
	}
}
