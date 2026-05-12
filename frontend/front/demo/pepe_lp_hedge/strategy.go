package main

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/hutil"
)

const hedgeStateKey = "pepe_lp_hedge_state"

type HedgeMode string

const (
	HedgeModeIdle        HedgeMode = "IDLE"
	HedgeModeActive      HedgeMode = "ACTIVE"
	HedgeModeRebalancing HedgeMode = "REBALANCING"
	HedgeModeClosed      HedgeMode = "CLOSED"
)

type MarketSnapshot struct {
	Sequence       int
	CapturedAt     time.Time
	PEPEPrice      float64
	ETHPrice       float64
	FundingCostBps float64
	SlippageBps    float64
}

type HedgePlan struct {
	LPSeed          float64
	PepeShortMargin float64
	EthShortMargin  float64
}

type HedgeEvent struct {
	Kind    string
	Summary string
	At      time.Time
}

type HedgeState struct {
	Mode               HedgeMode
	Capital            float64
	Plan               HedgePlan
	EntrySnapshot      MarketSnapshot
	LastSnapshot       MarketSnapshot
	RebalanceReference MarketSnapshot
	BasePepeQty        float64
	BaseETHQty         float64
	PepeShortQty       float64
	ETHShortQty        float64
	PepeShortMarkPrice float64
	ETHShortMarkPrice  float64
	CollateralRatio    float64
	MaintenanceCount   int
	RebalanceCount     int
	EventLog           []HedgeEvent
}

type HedgeConfig struct {
	Capital                float64
	FeedInterval           time.Duration
	MaintenanceInterval    time.Duration
	RebalancePEPEThreshold float64
	RebalanceETHThreshold  float64
	MinCollateralRatio     float64
	MaxFundingCostBps      float64
	MaxSlippageBps         float64
}

func DefaultHedgeConfig() HedgeConfig {
	return HedgeConfig{
		Capital:                10000,
		FeedInterval:           400 * time.Millisecond,
		MaintenanceInterval:    2 * time.Second,
		RebalancePEPEThreshold: 0.10,
		RebalanceETHThreshold:  0.06,
		MinCollateralRatio:     1.25,
		MaxFundingCostBps:      8,
		MaxSlippageBps:         20,
	}
}

func preparePepeHedge(capital float64) HedgePlan {
	return HedgePlan{
		LPSeed:          capital * 0.50,
		PepeShortMargin: capital * 0.25,
		EthShortMargin:  capital * 0.25,
	}
}

func getHedgeState(ctx hersh.HershContext) HedgeState {
	val := ctx.GetValue(hedgeStateKey)
	if val == nil {
		return HedgeState{Mode: HedgeModeIdle}
	}
	state, ok := val.(HedgeState)
	if !ok {
		return HedgeState{Mode: HedgeModeIdle}
	}
	return state
}

func appendHedgeEvent(state *HedgeState, kind, summary string, at time.Time) {
	state.EventLog = append(state.EventLog, HedgeEvent{
		Kind:    kind,
		Summary: summary,
		At:      at,
	})
}

func estimateLPTargets(state HedgeState, snapshot MarketSnapshot) (float64, float64) {
	if state.BasePepeQty == 0 || state.BaseETHQty == 0 {
		return 0, 0
	}
	entryRatio := state.EntrySnapshot.PEPEPrice / state.EntrySnapshot.ETHPrice
	currentRatio := snapshot.PEPEPrice / snapshot.ETHPrice
	if entryRatio <= 0 || currentRatio <= 0 {
		return state.BasePepeQty, state.BaseETHQty
	}

	relativeMove := currentRatio / entryRatio
	scale := math.Sqrt(relativeMove)
	return state.BasePepeQty / scale, state.BaseETHQty * scale
}

func relativeDeviation(current, target float64) float64 {
	if target == 0 {
		return 0
	}
	return math.Abs(current-target) / target
}

func calculateCollateralRatio(state HedgeState, snapshot MarketSnapshot) float64 {
	if state.PepeShortQty == 0 && state.ETHShortQty == 0 {
		return 0
	}

	pepePnL := (state.PepeShortMarkPrice - snapshot.PEPEPrice) * state.PepeShortQty
	ethPnL := (state.ETHShortMarkPrice - snapshot.ETHPrice) * state.ETHShortQty
	equity := state.Plan.PepeShortMargin + state.Plan.EthShortMargin + pepePnL + ethPnL
	requiredMargin := (state.PepeShortQty*snapshot.PEPEPrice + state.ETHShortQty*snapshot.ETHPrice) * 0.40
	if requiredMargin <= 0 {
		return 0
	}
	return equity / requiredMargin
}

func enterPepeHedge(cfg HedgeConfig, snapshot MarketSnapshot, ctx hersh.HershContext) HedgeState {
	plan := preparePepeHedge(cfg.Capital)
	basePepeQty := (plan.LPSeed * 0.50) / snapshot.PEPEPrice
	baseETHQty := (plan.LPSeed * 0.50) / snapshot.ETHPrice

	state := HedgeState{
		Mode:               HedgeModeActive,
		Capital:            cfg.Capital,
		Plan:               plan,
		EntrySnapshot:      snapshot,
		LastSnapshot:       snapshot,
		RebalanceReference: snapshot,
		BasePepeQty:        basePepeQty,
		BaseETHQty:         baseETHQty,
		PepeShortQty:       basePepeQty,
		ETHShortQty:        baseETHQty,
		PepeShortMarkPrice: snapshot.PEPEPrice,
		ETHShortMarkPrice:  snapshot.ETHPrice,
	}
	state.CollateralRatio = calculateCollateralRatio(state, snapshot)

	hersh.PrintWithLog("[INIT] preparePepeHedge() capital split completed", ctx)
	hersh.PrintWithLog(
		fmt.Sprintf(
			"  LP seed=$%.2f, PEPE short margin=$%.2f, ETH short margin=$%.2f",
			plan.LPSeed,
			plan.PepeShortMargin,
			plan.EthShortMargin,
		),
		ctx,
	)
	hersh.PrintWithLog(
		fmt.Sprintf(
			"  DEX add liquidity: PEPE %.0f / ETH %.4f",
			basePepeQty,
			baseETHQty,
		),
		ctx,
	)
	hersh.PrintWithLog(
		fmt.Sprintf(
			"  CEX enter shorts: PEPE %.0f @ %.10f, ETH %.4f @ %.2f",
			state.PepeShortQty,
			snapshot.PEPEPrice,
			state.ETHShortQty,
			snapshot.ETHPrice,
		),
		ctx,
	)

	appendHedgeEvent(&state, "init", "initial LP seed and short hedge entered", snapshot.CapturedAt)
	return state
}

func shouldRebalance(state HedgeState, snapshot MarketSnapshot, cfg HedgeConfig) (bool, string) {
	if state.Mode != HedgeModeActive {
		return false, ""
	}

	pepeMove := math.Abs(snapshot.PEPEPrice/state.RebalanceReference.PEPEPrice - 1)
	ethMove := math.Abs(snapshot.ETHPrice/state.RebalanceReference.ETHPrice - 1)
	collateral := calculateCollateralRatio(state, snapshot)

	switch {
	case pepeMove >= cfg.RebalancePEPEThreshold:
		return true, fmt.Sprintf("PEPE moved %.2f%% from rebalance anchor", pepeMove*100)
	case ethMove >= cfg.RebalanceETHThreshold:
		return true, fmt.Sprintf("ETH moved %.2f%% from rebalance anchor", ethMove*100)
	case collateral <= cfg.MinCollateralRatio:
		return true, fmt.Sprintf("collateral ratio dropped to %.2fx", collateral)
	default:
		return false, ""
	}
}

func rebalanceHedge(state HedgeState, snapshot MarketSnapshot, reason string, ctx hersh.HershContext) HedgeState {
	targetPepeQty, targetETHQty := estimateLPTargets(state, snapshot)
	pepeDelta := targetPepeQty - state.PepeShortQty
	ethDelta := targetETHQty - state.ETHShortQty

	state.Mode = HedgeModeRebalancing
	hersh.PrintWithLog("[REBALANCE] "+reason, ctx)

	if math.Abs(pepeDelta) > 0 {
		side := "BUY"
		if pepeDelta > 0 {
			side = "SELL"
		}
		hersh.PrintWithLog(
			fmt.Sprintf("  PEPE short reorder: %s %.0f", side, math.Abs(pepeDelta)),
			ctx,
		)
	}
	if math.Abs(ethDelta) > 0 {
		side := "BUY"
		if ethDelta > 0 {
			side = "SELL"
		}
		hersh.PrintWithLog(
			fmt.Sprintf("  ETH short reorder: %s %.4f", side, math.Abs(ethDelta)),
			ctx,
		)
	}

	state.PepeShortQty = targetPepeQty
	state.ETHShortQty = targetETHQty
	state.PepeShortMarkPrice = snapshot.PEPEPrice
	state.ETHShortMarkPrice = snapshot.ETHPrice
	state.RebalanceReference = snapshot
	state.CollateralRatio = calculateCollateralRatio(state, snapshot)
	state.RebalanceCount++
	state.Mode = HedgeModeActive

	appendHedgeEvent(&state, "rebalance", reason, snapshot.CapturedAt)
	return state
}

func runMaintenance(state HedgeState, snapshot MarketSnapshot, cfg HedgeConfig, ctx hersh.HershContext) HedgeState {
	if snapshot.FundingCostBps > cfg.MaxFundingCostBps || snapshot.SlippageBps > cfg.MaxSlippageBps {
		hersh.PrintWithLog(
			fmt.Sprintf(
				"[MAINTAIN] skipped because funding=%.2fbps slippage=%.2fbps",
				snapshot.FundingCostBps,
				snapshot.SlippageBps,
			),
			ctx,
		)
		appendHedgeEvent(&state, "maintenance-skip", "market frictions too high", snapshot.CapturedAt)
		return state
	}

	targetPepeQty, targetETHQty := estimateLPTargets(state, snapshot)
	pepeDev := relativeDeviation(state.PepeShortQty, targetPepeQty)
	ethDev := relativeDeviation(state.ETHShortQty, targetETHQty)

	if math.Max(pepeDev, ethDev) < 0.01 {
		hersh.PrintWithLog("[MAINTAIN] funding/slippage healthy, hedge already inside band", ctx)
		appendHedgeEvent(&state, "maintenance-check", "hedge remained inside maintenance band", snapshot.CapturedAt)
		return state
	}

	state.PepeShortQty = targetPepeQty
	state.ETHShortQty = targetETHQty
	state.PepeShortMarkPrice = snapshot.PEPEPrice
	state.ETHShortMarkPrice = snapshot.ETHPrice
	state.CollateralRatio = calculateCollateralRatio(state, snapshot)
	state.MaintenanceCount++

	hersh.PrintWithLog(
		fmt.Sprintf(
			"[MAINTAIN] corrected short weights to PEPE %.0f / ETH %.4f",
			targetPepeQty,
			targetETHQty,
		),
		ctx,
	)
	appendHedgeEvent(&state, "maintenance-adjust", "short weights refreshed under healthy funding/slippage", snapshot.CapturedAt)
	return state
}

func emergencyExit(state HedgeState, snapshot MarketSnapshot, ctx hersh.HershContext) HedgeState {
	hersh.PrintWithLog("[EMERGENCY] remove PEPE/WETH LP and close both shorts", ctx)
	hersh.PrintWithLog("  DEX remove liquidity and swap residual inventory to USDT", ctx)
	hersh.PrintWithLog("  CEX buy back PEPE short and ETH short", ctx)

	state.Mode = HedgeModeClosed
	state.LastSnapshot = snapshot
	state.PepeShortQty = 0
	state.ETHShortQty = 0
	state.CollateralRatio = 0

	appendHedgeEvent(&state, "emergency-exit", "all LP and hedge legs converted back to USDT", snapshot.CapturedAt)
	return state
}

func printHedgeStatus(state HedgeState, ctx hersh.HershContext) {
	hersh.PrintWithLog(
		fmt.Sprintf(
			"[STATUS] mode=%s collateral=%.2fx maintenance=%d rebalance=%d",
			state.Mode,
			state.CollateralRatio,
			state.MaintenanceCount,
			state.RebalanceCount,
		),
		ctx,
	)
	if state.LastSnapshot.PEPEPrice > 0 {
		hersh.PrintWithLog(
			fmt.Sprintf(
				"  market PEPE=%.10f ETH=%.2f funding=%.2fbps slippage=%.2fbps",
				state.LastSnapshot.PEPEPrice,
				state.LastSnapshot.ETHPrice,
				state.LastSnapshot.FundingCostBps,
				state.LastSnapshot.SlippageBps,
			),
			ctx,
		)
	}
}

func runPepeLPHedge(msg *hersh.Message, ctx hersh.HershContext, feed *SimulatedMarketFeed, cfg HedgeConfig) error {
	state := getHedgeState(ctx)

	market := hersh.WatchFlow(feed.Stream(), "pepe_lp_market", ctx)
	maintenanceTick := hutil.WatchTick("pepe_lp_maintenance", cfg.MaintenanceInterval, ctx)
	marketTriggered := market.IsTriggered(ctx)

	if market.IsValid() {
		if snapshot, ok := market.Value.(MarketSnapshot); ok {
			state.LastSnapshot = snapshot
			if state.Mode == HedgeModeActive || state.Mode == HedgeModeRebalancing {
				state.CollateralRatio = calculateCollateralRatio(state, snapshot)
			}
		}
	}

	if msg != nil {
		switch strings.ToLower(strings.TrimSpace(msg.Content)) {
		case "init":
			if state.Mode != HedgeModeIdle {
				hersh.PrintWithLog("[INIT] ignored because hedge is already active or closed", ctx)
			} else if state.LastSnapshot.PEPEPrice == 0 || state.LastSnapshot.ETHPrice == 0 {
				hersh.PrintWithLog("[INIT] waiting for initial market snapshot", ctx)
			} else {
				state = enterPepeHedge(cfg, state.LastSnapshot, ctx)
			}
		case "status":
			printHedgeStatus(state, ctx)
		case "emergency-exit":
			if state.Mode == HedgeModeActive || state.Mode == HedgeModeRebalancing {
				state = emergencyExit(state, state.LastSnapshot, ctx)
				ctx.SetValue(hedgeStateKey, state)
				return hersh.NewStopErr("emergency exit completed")
			}
			hersh.PrintWithLog("[EMERGENCY] ignored because hedge is not active", ctx)
		case "stop":
			ctx.SetValue(hedgeStateKey, state)
			return hersh.NewStopErr("manual stop requested")
		}
	}

	if state.Mode == HedgeModeActive && marketTriggered && state.LastSnapshot.PEPEPrice != 0 && state.LastSnapshot.ETHPrice != 0 {
		if should, reason := shouldRebalance(state, state.LastSnapshot, cfg); should {
			state = rebalanceHedge(state, state.LastSnapshot, reason, ctx)
		}
	}

	if state.Mode == HedgeModeActive && maintenanceTick.IsTriggered(ctx) && !maintenanceTick.IsZero() {
		state = runMaintenance(state, state.LastSnapshot, cfg, ctx)
	}

	ctx.SetValue(hedgeStateKey, state)
	return nil
}
