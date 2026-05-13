package main

import (
	"math"
	"testing"

	"github.com/HershyOrg/hershy/cctx/models"
)

func TestNormalizeBuyFillInfersMissingSpendFromFallbackPrice(t *testing.T) {
	fill := normalizeBuyFill(10, 0, 5, 0.5)
	if fill == nil {
		t.Fatal("expected fill")
	}
	if math.Abs(fill.USDC-5.0) > 1e-9 {
		t.Fatalf("expected inferred usdc 5.0, got %.6f", fill.USDC)
	}
	if fill.AvgPrice == nil || math.Abs(*fill.AvgPrice-0.5) > 1e-9 {
		t.Fatalf("expected avg price 0.5, got %+v", fill.AvgPrice)
	}
}

func TestInferBuyFillFromOrderUsesOrderFillAndPrice(t *testing.T) {
	fill := inferBuyFillFromOrder(models.Order{
		Side:   models.OrderSideBuy,
		Price:  0.99,
		Size:   5.05,
		Filled: 5.05,
		Status: models.OrderStatusFilled,
	}, 5, 0.98)
	if fill == nil {
		t.Fatal("expected fill")
	}
	if math.Abs(fill.Shares-5.05) > 1e-9 {
		t.Fatalf("expected shares 5.05, got %.6f", fill.Shares)
	}
	expectedUSDC := 5.05 * 0.99
	if math.Abs(fill.USDC-expectedUSDC) > 1e-9 {
		t.Fatalf("expected usdc %.6f, got %.6f", expectedUSDC, fill.USDC)
	}
	if fill.AvgPrice == nil || math.Abs(*fill.AvgPrice-0.99) > 1e-9 {
		t.Fatalf("expected avg price 0.99, got %+v", fill.AvgPrice)
	}
}

func TestApplyFillToPositionBackfillsMissingCostFromAvgPrice(t *testing.T) {
	entry := 0.99
	pos := &Position{
		EntryPrice: &entry,
		Shares:     5,
		CostUSDC:   4.95,
	}
	fillAvg := 0.98
	applyFillToPosition(pos, &FillResult{
		Shares:   5,
		USDC:     0,
		AvgPrice: &fillAvg,
	})
	if math.Abs(pos.Shares-10) > 1e-9 {
		t.Fatalf("expected shares 10, got %.6f", pos.Shares)
	}
	expectedCost := 4.95 + 4.9
	if math.Abs(pos.CostUSDC-expectedCost) > 1e-9 {
		t.Fatalf("expected cost %.6f, got %.6f", expectedCost, pos.CostUSDC)
	}
}
