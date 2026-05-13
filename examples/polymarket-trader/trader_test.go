package main

import "testing"

func TestComputeWindowEndHoldDecision_HoldsHighConfidenceLowUpsidePosition(t *testing.T) {
	strategy := StrategyConfig{
		WindowEndHoldEnabled:            true,
		WindowEndHoldRemainingUpsideMax: 0.05,
		WindowEndHoldMinPositionProb:    0.90,
		WindowEndHoldMinEdgeVsExit:      0.02,
	}
	decision := computeWindowEndHoldDecision(0.98, 0.96, 0.531, strategy)
	if !decision.Hold {
		t.Fatalf("expected hold decision, got %+v", decision)
	}
}

func TestComputeWindowEndHoldDecision_RejectsWideUpsideOrWeakEdge(t *testing.T) {
	strategy := StrategyConfig{
		WindowEndHoldEnabled:            true,
		WindowEndHoldRemainingUpsideMax: 0.05,
		WindowEndHoldMinPositionProb:    0.90,
		WindowEndHoldMinEdgeVsExit:      0.02,
	}
	decision := computeWindowEndHoldDecision(0.80, 0.96, 0.70, strategy)
	if decision.Hold {
		t.Fatalf("expected no hold for wide upside, got %+v", decision)
	}
	decision = computeWindowEndHoldDecision(0.98, 0.89, 0.88, strategy)
	if decision.Hold {
		t.Fatalf("expected no hold for weak probability, got %+v", decision)
	}
}

func TestCloneRuntimeStateClonesPosition(t *testing.T) {
	entry := 0.98
	state := &RuntimeState{
		TradeState: TradeState{
			Position: &Position{
				TokenID:      "token",
				MarketSlug:   "market",
				EntryPrice:   &entry,
				Shares:       5,
				CostUSDC:     4.9,
				HoldToExpiry: true,
			},
		},
		O1hByHour:    map[int64]float64{},
		Last60Closes: []float64{},
	}
	cloned := cloneRuntimeState(state)
	cloned.Position.Shares = 10
	cloned.Position.HoldToExpiry = false
	if state.Position.Shares != 5 {
		t.Fatalf("expected original position shares unchanged, got %.4f", state.Position.Shares)
	}
	if !state.Position.HoldToExpiry {
		t.Fatal("expected original hold flag unchanged")
	}
}

func TestEntryRetryDelayMs(t *testing.T) {
	if got := entryRetryDelayMs(240); got != 15_000 {
		t.Fatalf("expected long entry retry delay, got %d", got)
	}
	if got := entryRetryDelayMs(90); got != 8_000 {
		t.Fatalf("expected medium entry retry delay, got %d", got)
	}
	if got := entryRetryDelayMs(20); got != 3_000 {
		t.Fatalf("expected short entry retry delay, got %d", got)
	}
}

func TestScaleInRetryDelayMs(t *testing.T) {
	if got := scaleInRetryDelayMs(240); got != 20_000 {
		t.Fatalf("expected long scale-in retry delay, got %d", got)
	}
	if got := scaleInRetryDelayMs(60); got != 10_000 {
		t.Fatalf("expected medium scale-in retry delay, got %d", got)
	}
	if got := scaleInRetryDelayMs(10); got != 4_000 {
		t.Fatalf("expected short scale-in retry delay, got %d", got)
	}
}

func TestComputeEntryEdgeDecisionBlocksNegativeEdgeTrade(t *testing.T) {
	decision := computeGuardedEntryDecision(0.8967, 0.9690, 0.02, 0.0)
	if decision.Allow {
		t.Fatalf("expected edge gate to block trade, got %+v", decision)
	}
	if decision.ModelEdge >= 0 {
		t.Fatalf("expected negative model edge, got %.4f", decision.ModelEdge)
	}
}

func TestComputeEntryEdgeDecisionAllowsBufferedEdgeTrade(t *testing.T) {
	decision := computeGuardedEntryDecision(0.98, 0.94, 0.02, 0.0)
	if !decision.Allow {
		t.Fatalf("expected edge gate to allow trade, got %+v", decision)
	}
}

func TestComputeEntryEdgeDecisionBlocksLowProbabilityTrade(t *testing.T) {
	decision := computeGuardedEntryDecision(0.0735, 0.0107, 0.01, 0.50)
	if decision.Allow {
		t.Fatalf("expected low-probability trade to be blocked, got %+v", decision)
	}
	if decision.ModelEdge <= 0 {
		t.Fatalf("expected trade to still have positive raw edge, got %.4f", decision.ModelEdge)
	}
}

func TestSelectPreferredEntryCandidatePrefersHigherAllowedEdge(t *testing.T) {
	yesCandidate := entryCandidate{
		BetUp:    true,
		TokenID:  "yes-token",
		Decision: computeGuardedEntryDecision(0.8923, 0.9960, 0.01, 0.0),
	}
	noCandidate := entryCandidate{
		BetUp:    false,
		TokenID:  "no-token",
		Decision: computeGuardedEntryDecision(0.1077, 0.0040, 0.01, 0.0),
	}

	selected, ok := selectPreferredEntryCandidate(true, yesCandidate, noCandidate)
	if !ok {
		t.Fatal("expected candidate selection to succeed")
	}
	if selected.BetUp {
		t.Fatalf("expected lower-priced no side to be selected, got %+v", selected)
	}
	if !selected.Decision.Allow {
		t.Fatalf("expected selected candidate to pass edge gate, got %+v", selected)
	}
}

func TestSelectPreferredEntryCandidatePrefersQuotedCandidateWhenAllBlocked(t *testing.T) {
	missingQuote := entryCandidate{
		BetUp:   true,
		TokenID: "yes-token",
		Decision: entryEdgeDecision{
			PositionProb: 0.86,
		},
	}
	quotedBlocked := entryCandidate{
		BetUp:    false,
		TokenID:  "no-token",
		Decision: computeGuardedEntryDecision(0.14, 0.20, 0.01, 0.0),
	}

	selected, ok := selectPreferredEntryCandidate(true, missingQuote, quotedBlocked)
	if !ok {
		t.Fatal("expected candidate selection to succeed")
	}
	if selected.TokenID != "no-token" {
		t.Fatalf("expected quoted candidate to win blocked selection, got %+v", selected)
	}
	if selected.Decision.EstimatedEntryPrice <= 0 {
		t.Fatalf("expected selected candidate to keep a quoted price, got %+v", selected)
	}
}

func TestSelectPreferredEntryCandidateBreaksTiesWithPreferredSide(t *testing.T) {
	yesCandidate := entryCandidate{
		BetUp:    true,
		TokenID:  "yes-token",
		Decision: computeGuardedEntryDecision(0.80, 0.70, 0.05, 0.0),
	}
	noCandidate := entryCandidate{
		BetUp:    false,
		TokenID:  "no-token",
		Decision: computeGuardedEntryDecision(0.20, 0.10, 0.05, 0.0),
	}

	selected, ok := selectPreferredEntryCandidate(false, yesCandidate, noCandidate)
	if !ok {
		t.Fatal("expected candidate selection to succeed")
	}
	if selected.BetUp {
		t.Fatalf("expected preferred no side to win tie, got %+v", selected)
	}
}

func TestComputePositionStopDecisionTriggersAtLossThreshold(t *testing.T) {
	decision := computePositionStopDecision(10.0235, 10.27, 0.6214, 0.10)
	if !decision.Exit {
		t.Fatalf("expected stop-loss exit, got %+v", decision)
	}
	if decision.UnrealizedROI > -0.10 {
		t.Fatalf("expected roi below threshold, got %.4f", decision.UnrealizedROI)
	}
}

func TestComputePositionStopDecisionIgnoresHealthyPosition(t *testing.T) {
	decision := computePositionStopDecision(10.0, 10.0, 0.98, 0.10)
	if decision.Exit {
		t.Fatalf("expected healthy position to stay open, got %+v", decision)
	}
}
