package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/manager"
	cctxdebug "github.com/HershyOrg/hershy/cctx/debug"
	"github.com/HershyOrg/hershy/cctx/diagnostics"
)

type ManagedTrader struct {
	cfg             TraderConfig
	executorBuilder func() (TradeExecutor, error)
}

const (
	livePositionSyncGap          = 30 * time.Second
	livePositionRecoveryLookback = 2
	entryRetryLongMs             = int64(15 * time.Second / time.Millisecond)
	entryRetryMediumMs           = int64(8 * time.Second / time.Millisecond)
	entryRetryShortMs            = int64(3 * time.Second / time.Millisecond)
	scaleInRetryLongMs           = int64(20 * time.Second / time.Millisecond)
	scaleInRetryMediumMs         = int64(10 * time.Second / time.Millisecond)
	scaleInRetryShortMs          = int64(4 * time.Second / time.Millisecond)
)

type livePositionSnapshot struct {
	MarketSlug    string
	TokenID       string
	BetUp         bool
	Shares        float64
	CurrentMarket bool
	MarketClosed  bool
}

type windowEndHoldDecision struct {
	Hold             bool
	PositionProb     float64
	EntryPrice       float64
	CurrentExitPrice float64
	RemainingUpside  float64
	ModelEdgeVsExit  float64
}

type entryEdgeDecision struct {
	Allow               bool
	PositionProb        float64
	EstimatedEntryPrice float64
	ModelEdge           float64
}

type entryCandidate struct {
	BetUp    bool
	TokenID  string
	Decision entryEdgeDecision
}

type positionStopDecision struct {
	Exit             bool
	CurrentExitPrice float64
	UnrealizedROI    float64
}

func NewManagedTrader(cfg TraderConfig, executorBuilder func() (TradeExecutor, error)) *ManagedTrader {
	return &ManagedTrader{
		cfg:             cfg,
		executorBuilder: executorBuilder,
	}
}

func (mt *ManagedTrader) Run(msg *hersh.Message, ctx hersh.HershContext) (runErr error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[PANIC] %v\n%s", r, string(debug.Stack()))
			state := ensureRuntimeState(ctx)
			decisionID := nextDecisionID(state)
			mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventAnomaly, decisionID, activeTradeID(state), diagnostics.ReasonVenueUnavailable.String(), "panic", map[string]any{
				"panic": fmt.Sprintf("%v", r),
			}, nil, map[string]any{
				"stack": string(debug.Stack()),
			}, time.Now().UnixMilli())
			if err, ok := r.(error); ok {
				runErr = hersh.NewCrashErr("panic", err)
			} else {
				runErr = hersh.NewCrashErr("panic", fmt.Errorf("%v", r))
			}
			return
		}
		if runErr != nil {
			log.Printf("[RUN-ERR] %T: %v", runErr, runErr)
		}
	}()

	model, err := mt.getModel(ctx)
	if err != nil {
		log.Printf("[FATAL] model load failed: %v", err)
		return hersh.NewCrashErr("model load failed", err)
	}

	executor, err := mt.getExecutor(ctx)
	if err != nil {
		log.Printf("[FATAL] executor init failed: %v", err)
		return hersh.NewCrashErr("executor init failed", err)
	}

	stream, err := mt.getStream(ctx)
	if err != nil {
		log.Printf("[FATAL] stream init failed: %v", err)
		return hersh.NewCrashErr("stream init failed", err)
	}

	klineVal := hersh.WatchFlow(stream.Events(), "kline_event", ctx)
	_ = hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		now := time.Now()
		return func(prev any) (any, bool, error) {
			return now, true, nil
		}, nil
	}, "heartbeat", 1*time.Second, ctx)
	_ = hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
		return func(prev any) (any, bool, error) {
			return buildModelSignalState(ctx), true, nil
		}, nil
	}, "model_signal", 1*time.Second, ctx)

	var refreshedTokens any
	if mt.cfg.AutoSlug {
		refreshTick := time.Duration(mt.cfg.AutoRefreshSec) * time.Second
		if refreshTick <= 0 {
			refreshTick = 300 * time.Second
		}
		refreshedTokens = hersh.WatchCall(func() (manager.VarUpdateFunc, error) {
			nowET := time.Now().In(loadETLocation())
			tokens, err := resolveMarketTokens(mt.cfg, nowET)
			if err != nil {
				return nil, err
			}
			return func(prev any) (any, bool, error) {
				prevTokens, _ := prev.(MarketTokens)
				changed := prevTokens.Slug != tokens.Slug
				return tokens, changed, nil
			}, nil
		}, "market_tokens", refreshTick, ctx)
	}

	marketState, err := ensureMarketState(ctx, mt.cfg)
	if err != nil {
		log.Printf("[FATAL] market resolve failed: %v", err)
		return hersh.NewCrashErr("market resolve failed", err)
	}

	state := ensureRuntimeState(ctx)
	if state.StartTimeMs == 0 {
		state = updateRuntimeState(ctx, func(rs *RuntimeState) {
			rs.StartTimeMs = time.Now().UnixMilli()
		})
	}

	if mt.cfg.RunFor > 0 {
		elapsed := time.Since(time.UnixMilli(state.StartTimeMs))
		if elapsed >= mt.cfg.RunFor {
			log.Printf("[STOP] run_for_sec reached elapsed=%s", elapsed.Truncate(time.Second))
			return hersh.NewStopErr("run_for_sec reached")
		}
	}

	if refreshedTokens != nil {
		if tokens, ok := refreshedTokens.(MarketTokens); ok {
			marketState = mt.handleMarketSwitch(ctx, executor, marketState, tokens)
		}
	}

	state = mt.maybeSyncLivePositions(ctx, executor, marketState, state, time.Now().In(loadETLocation()))

	if msg != nil && strings.TrimSpace(msg.Content) != "" {
		if stopErr := mt.handleCommand(ctx, marketState, msg.Content); stopErr != nil {
			return stopErr
		}
	}

	if klineVal == nil {
		return nil
	}
	evt, ok := klineVal.(KlineEvent)
	if !ok {
		return nil
	}

	updated, stopNow := mt.processKline(ctx, model, executor, marketState, state, evt)
	_ = updated
	if stopNow {
		log.Printf("[STOP] stop condition reached from strategy")
		return hersh.NewStopErr("stop condition reached")
	}

	return nil
}

func (mt *ManagedTrader) maybeSyncLivePositions(ctx hersh.HershContext, executor TradeExecutor, market *MarketState, state *RuntimeState, nowET time.Time) *RuntimeState {
	if mt.cfg.PaperCfg != nil {
		return state
	}
	nowMs := nowET.UnixMilli()
	if state != nil && state.LastPositionSyncMs != 0 && nowMs-state.LastPositionSyncMs < livePositionSyncGap.Milliseconds() {
		return state
	}

	next := cloneRuntimeState(state)
	next.LastPositionSyncMs = nowMs

	if next.Position != nil {
		shares, err := executor.GetTokenBalance(next.Position.TokenID)
		if err != nil {
			log.Printf("[RECOVERY] tracked position check failed token_id=%s: %v", next.Position.TokenID, err)
			ctx.SetValue("runtime_state", next)
			return next
		}
		if shares <= 1e-9 {
			log.Printf("[RECOVERY] tracked position missing on exchange; clearing token_id=%s", next.Position.TokenID)
			next.Position = nil
			next.PendingBetUp = nil
			next.PendingTradeID = nil
			next.PendingSinceMs = nil
		} else if isDustPosition(shares, next.Position.CostUSDC, next.Position.EntryPrice, mt.cfg.TradeCfg) {
			log.Printf("[RECOVERY] tracked position is dust; clearing token_id=%s shares=%.6f", next.Position.TokenID, shares)
			next.Position = nil
			next.PendingBetUp = nil
			next.PendingTradeID = nil
			next.PendingSinceMs = nil
		} else {
			if math.Abs(shares-next.Position.Shares) > 1e-9 {
				prevShares := next.Position.Shares
				prevCost := next.Position.CostUSDC
				next.Position.Shares = shares
				if next.Position.EntryPrice != nil && *next.Position.EntryPrice > 0 {
					next.Position.CostUSDC = shares * *next.Position.EntryPrice
				}
				log.Printf("[RECOVERY] synced tracked position token_id=%s shares %.6f -> %.6f cost %.4f -> %.4f",
					next.Position.TokenID, prevShares, shares, prevCost, next.Position.CostUSDC)
			}
			ctx.SetValue("runtime_state", next)
			return next
		}
	}

	snapshots, err := mt.scanRecoverableLivePositions(executor, market, nowET)
	if err != nil {
		log.Printf("[RECOVERY] scan failed: %v", err)
		ctx.SetValue("runtime_state", next)
		return next
	}

	currentCandidates := make([]livePositionSnapshot, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if snapshot.Shares <= mt.cfg.TradeCfg.MinShares+1e-9 {
			continue
		}
		if snapshot.CurrentMarket {
			currentCandidates = append(currentCandidates, snapshot)
			continue
		}
		mt.tryRecoverOrphanPosition(executor, snapshot)
	}

	switch len(currentCandidates) {
	case 0:
	case 1:
		snapshot := currentCandidates[0]
		log.Printf("[RECOVERY] resumed current position slug=%s bet_up=%t shares=%.6f token_id=%s",
			snapshot.MarketSlug, snapshot.BetUp, snapshot.Shares, snapshot.TokenID)
		next.Position = &Position{
			TradeID:      nextTradeID(next),
			TokenID:      snapshot.TokenID,
			MarketSlug:   snapshot.MarketSlug,
			BetUp:        snapshot.BetUp,
			EntryTsMs:    nowMs,
			EntryPrice:   nil,
			Shares:       snapshot.Shares,
			CostUSDC:     0,
			EntryO1h:     next.O1h,
			HoldToExpiry: false,
		}
		next.PendingBetUp = nil
		next.PendingTradeID = nil
		next.PendingSinceMs = nil
		if !mt.cfg.AllowScaleIn {
			next.TradedThisHour = true
		}
	default:
		log.Printf("[RECOVERY] multiple current market balances detected slug=%s count=%d; leaving unmanaged",
			marketSlugValue(market), len(currentCandidates))
	}

	ctx.SetValue("runtime_state", next)
	return next
}

func (mt *ManagedTrader) scanRecoverableLivePositions(executor TradeExecutor, market *MarketState, nowET time.Time) ([]livePositionSnapshot, error) {
	snapshots := make([]livePositionSnapshot, 0, 4)
	seenSlugs := map[string]bool{}

	if market != nil {
		current, err := collectLivePositionSnapshots(executor, market.MarketSlug, market.TokenIDUp, market.TokenIDDown, market.MarketClosed, true)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, current...)
		if market.MarketSlug != "" {
			seenSlugs[market.MarketSlug] = true
		}
	}

	prefix := mt.cfg.SlugPrefix
	if prefix == "" && market != nil {
		prefix = inferSlugPrefix(normalizeSlug(market.MarketSlug))
	}
	if prefix == "" {
		return snapshots, nil
	}

	base := time.Date(nowET.Year(), nowET.Month(), nowET.Day(), nowET.Hour(), 0, 0, 0, nowET.Location())
	for h := 1; h <= livePositionRecoveryLookback; h++ {
		slug := buildSlug(prefix, base.Add(-time.Duration(h)*time.Hour))
		if seenSlugs[slug] {
			continue
		}
		seenSlugs[slug] = true

		marketData, err := fetchMarketBySlug(slug)
		if err != nil {
			continue
		}
		tokens, err := resolveYesNoTokens(marketData, slug)
		if err != nil {
			continue
		}
		recovered, err := collectLivePositionSnapshots(executor, tokens.Slug, tokens.YesTokenID, tokens.NoTokenID, tokens.Closed, false)
		if err != nil {
			continue
		}
		snapshots = append(snapshots, recovered...)
	}
	return snapshots, nil
}

func collectLivePositionSnapshots(executor TradeExecutor, slug, yesTokenID, noTokenID string, marketClosed *bool, currentMarket bool) ([]livePositionSnapshot, error) {
	snapshots := make([]livePositionSnapshot, 0, 2)
	closed := marketClosed != nil && *marketClosed

	checks := []struct {
		tokenID string
		betUp   bool
	}{
		{tokenID: yesTokenID, betUp: true},
		{tokenID: noTokenID, betUp: false},
	}
	for _, check := range checks {
		if check.tokenID == "" {
			continue
		}
		shares, err := executor.GetTokenBalance(check.tokenID)
		if err != nil {
			return nil, err
		}
		if shares <= 1e-9 {
			continue
		}
		snapshots = append(snapshots, livePositionSnapshot{
			MarketSlug:    slug,
			TokenID:       check.tokenID,
			BetUp:         check.betUp,
			Shares:        shares,
			CurrentMarket: currentMarket,
			MarketClosed:  closed,
		})
	}
	return snapshots, nil
}

func (mt *ManagedTrader) tryRecoverOrphanPosition(executor TradeExecutor, snapshot livePositionSnapshot) {
	if snapshot.MarketClosed {
		log.Printf("[RECOVERY] orphan position slug=%s bet_up=%t shares=%.6f token_id=%s is closed; settlement or manual claim may be required",
			snapshot.MarketSlug, snapshot.BetUp, snapshot.Shares, snapshot.TokenID)
		return
	}
	log.Printf("[RECOVERY] orphan position slug=%s bet_up=%t shares=%.6f token_id=%s; attempting exit",
		snapshot.MarketSlug, snapshot.BetUp, snapshot.Shares, snapshot.TokenID)
	fill, err := executor.MarketSellAll(snapshot.TokenID)
	if err != nil {
		log.Printf("[RECOVERY] orphan exit failed slug=%s token_id=%s: %v", snapshot.MarketSlug, snapshot.TokenID, err)
		return
	}
	if fill == nil {
		log.Printf("[RECOVERY] orphan exit not filled slug=%s token_id=%s", snapshot.MarketSlug, snapshot.TokenID)
		return
	}
	log.Printf("[RECOVERY] orphan exit filled slug=%s token_id=%s shares=%.6f usdc=%.4f", snapshot.MarketSlug, snapshot.TokenID, fill.Shares, fill.USDC)
}

func marketSlugValue(market *MarketState) string {
	if market == nil {
		return ""
	}
	return market.MarketSlug
}

func (mt *ManagedTrader) getModel(ctx hersh.HershContext) (*ProbModel, error) {
	value := hersh.Memo(func() any {
		model, err := LoadProbModel(mt.cfg.ModelPath)
		if err != nil {
			return err
		}
		return model
	}, "prob_model", ctx)
	if model, ok := value.(*ProbModel); ok {
		return model, nil
	}
	if err, ok := value.(error); ok {
		return nil, err
	}
	return nil, fmt.Errorf("unexpected model cache value")
}

func (mt *ManagedTrader) getExecutor(ctx hersh.HershContext) (TradeExecutor, error) {
	value := hersh.Memo(func() any {
		exec, err := mt.executorBuilder()
		if err != nil {
			return err
		}
		return exec
	}, "trade_executor", ctx)
	if exec, ok := value.(TradeExecutor); ok {
		return exec, nil
	}
	if err, ok := value.(error); ok {
		return nil, err
	}
	return nil, fmt.Errorf("unexpected executor cache value")
}

func (mt *ManagedTrader) getStream(ctx hersh.HershContext) (*BinanceKlineStream, error) {
	value := hersh.Memo(func() any {
		stream := NewBinanceKlineStream(mt.cfg.WSURL)
		if err := stream.Connect(); err != nil {
			return err
		}
		return stream
	}, "kline_stream", ctx)
	if stream, ok := value.(*BinanceKlineStream); ok {
		return stream, nil
	}
	if err, ok := value.(error); ok {
		return nil, err
	}
	return nil, fmt.Errorf("unexpected stream cache value")
}

func (mt *ManagedTrader) getSignalLog(ctx hersh.HershContext) *os.File {
	value := hersh.Memo(func() any {
		if mt.cfg.SignalLogPath == "" {
			return (*os.File)(nil)
		}
		_ = os.MkdirAll(dirName(mt.cfg.SignalLogPath), 0o755)
		fh, err := os.OpenFile(mt.cfg.SignalLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return (*os.File)(nil)
		}
		return fh
	}, "signal_log", ctx)
	if fh, ok := value.(*os.File); ok {
		return fh
	}
	return nil
}

func ensureRuntimeState(ctx hersh.HershContext) *RuntimeState {
	value := ctx.GetValue("runtime_state")
	if value == nil {
		state := &RuntimeState{O1hByHour: map[int64]float64{}, Last60Closes: make([]float64, 0, 61)}
		ensureRunID(state)
		ctx.SetValue("runtime_state", state)
		return state
	}
	state, _ := value.(*RuntimeState)
	if state == nil {
		state = &RuntimeState{O1hByHour: map[int64]float64{}, Last60Closes: make([]float64, 0, 61)}
		ctx.SetValue("runtime_state", state)
	}
	ensureRunID(state)
	return state
}

func updateRuntimeState(ctx hersh.HershContext, fn func(*RuntimeState)) *RuntimeState {
	state, _ := ctx.GetValue("runtime_state").(*RuntimeState)
	next := cloneRuntimeState(state)
	fn(next)
	ctx.SetValue("runtime_state", next)
	return next
}

func ensureMarketState(ctx hersh.HershContext, cfg TraderConfig) (*MarketState, error) {
	value := ctx.GetValue("market_state")
	if value != nil {
		if state, ok := value.(*MarketState); ok {
			return state, nil
		}
	}
	nowET := time.Now().In(loadETLocation())
	tokens, err := resolveMarketTokens(cfg, nowET)
	if err != nil {
		return nil, err
	}
	state := &MarketState{
		MarketID:        tokens.MarketID,
		TokenIDUp:       tokens.YesTokenID,
		TokenIDDown:     tokens.NoTokenID,
		MarketSlug:      tokens.Slug,
		EnableOrderbook: tokens.EnableOrderbook,
		MarketClosed:    tokens.Closed,
	}
	ctx.SetValue("market_state", state)
	return state, nil
}

func updateMarketState(ctx hersh.HershContext, state *MarketState) *MarketState {
	if state == nil {
		if current, ok := ctx.GetValue("market_state").(*MarketState); ok {
			return current
		}
		return nil
	}
	ctx.SetValue("market_state", state)
	return state
}

func (mt *ManagedTrader) handleCommand(ctx hersh.HershContext, market *MarketState, content string) error {
	cmd := strings.TrimSpace(strings.ToLower(content))
	if cmd == "" {
		return nil
	}

	switch cmd {
	case "pause":
		updateRuntimeState(ctx, func(rs *RuntimeState) {
			rs.Paused = true
		})
		log.Println("[CMD] paused")
	case "resume":
		updateRuntimeState(ctx, func(rs *RuntimeState) {
			rs.Paused = false
		})
		log.Println("[CMD] resumed")
	case "status":
		state := ensureRuntimeState(ctx)
		log.Printf("[STATUS] market=%s up=%s down=%s position=%v", market.MarketSlug, market.TokenIDUp, market.TokenIDDown, state.Position)
	case "stop":
		return hersh.NewStopErr("user requested stop")
	default:
		log.Printf("[CMD] unknown: %s", cmd)
	}
	return nil
}

func (mt *ManagedTrader) handleMarketSwitch(ctx hersh.HershContext, executor TradeExecutor, market *MarketState, tokens MarketTokens) *MarketState {
	if market.MarketSlug != "" && tokens.Slug != "" && tokens.Slug != market.MarketSlug {
		log.Printf("[MARKET] switch %s -> %s", market.MarketSlug, tokens.Slug)
		state := ensureRuntimeState(ctx)
		if state.Position != nil {
			if state.Position.HoldToExpiry {
				mt.releaseHeldPositionForSettlement(state, "market_switch", time.Now().UnixMilli())
			} else if mt.cfg.PaperCfg != nil && mt.cfg.PaperCfg.HoldToExpiry {
				if state.LastPriceTsMs == 0 {
					log.Printf("[PAPER] settle skipped (missing last price)")
				} else {
					mt.settlePaperPosition(ctx, executor, state, "market_switch", state.LastPriceTsMs, state.LastPrice, state.O1h, market.MarketSlug)
				}
			} else if mt.cfg.Strategy.ExitAtWindowEnd {
				mt.tryExitPosition(ctx, executor, state, "market_switch", time.Now().UnixMilli())
			} else {
				mt.expireLivePosition(ctx, state, "market_switch", time.Now().UnixMilli())
			}
		}
		updateRuntimeState(ctx, func(rs *RuntimeState) {
			rs.PendingBetUp = nil
			rs.PendingTradeID = nil
			rs.PendingSinceMs = nil
			rs.NextEntryAttemptMs = 0
			rs.NextScaleInMs = 0
		})
	}

	newState := &MarketState{
		MarketID:        tokens.MarketID,
		TokenIDUp:       tokens.YesTokenID,
		TokenIDDown:     tokens.NoTokenID,
		MarketSlug:      tokens.Slug,
		EnableOrderbook: tokens.EnableOrderbook,
		MarketClosed:    tokens.Closed,
	}
	return updateMarketState(ctx, newState)
}

func (mt *ManagedTrader) processKline(ctx hersh.HershContext, model *ProbModel, executor TradeExecutor, market *MarketState, state *RuntimeState, evt KlineEvent) (*RuntimeState, bool) {
	nowMs := evt.StartTimeMs
	updated := cloneRuntimeState(state)

	if evt.Interval == "1h" {
		hourOpen := floorToHourMs(evt.StartTimeMs)
		updated.O1hByHour[hourOpen] = evt.Open
		if updated.CurHour == hourOpen {
			val := evt.Open
			updated.O1h = &val
		}
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	if evt.Interval != "1s" {
		return state, false
	}

	hourOpen := floorToHourMs(nowMs)
	if updated.CurHour == 0 || hourOpen != updated.CurHour {
		if updated.CurHour != 0 && updated.Position != nil {
			if updated.Position.HoldToExpiry {
				mt.releaseHeldPositionForSettlement(updated, "hour_rollover", nowMs)
			} else if mt.cfg.PaperCfg != nil && mt.cfg.PaperCfg.HoldToExpiry {
				if updated.LastPriceTsMs == 0 {
					log.Printf("[PAPER] settle skipped (missing last price)")
				} else {
					mt.settlePaperPosition(ctx, executor, updated, "hour_rollover", updated.LastPriceTsMs, updated.LastPrice, updated.O1h, market.MarketSlug)
				}
			} else if mt.cfg.Strategy.ExitAtWindowEnd {
				log.Printf("[WARN] position still open at hour rollover; forcing exit")
				mt.tryExitPosition(ctx, executor, updated, "hour_rollover", nowMs)
			} else {
				mt.expireLivePosition(ctx, updated, "hour_rollover", nowMs)
			}
		}

		updated.CurHour = hourOpen
		if val, ok := updated.O1hByHour[updated.CurHour]; ok {
			v := val
			updated.O1h = &v
		} else {
			updated.O1h = nil
		}
		updated.CumVol = 0
		updated.Last60Closes = updated.Last60Closes[:0]
		updated.TradedThisHour = false
		updated.PendingBetUp = nil
		updated.PendingTradeID = nil
		updated.PendingSinceMs = nil
		updated.NextEntryAttemptMs = 0
		updated.NextScaleInMs = 0
	}

	updated.LastPrice = evt.Close
	updated.LastPriceTsMs = nowMs
	if evt.Volume > 0 {
		updated.CumVol += evt.Volume
	}
	updated.Last60Closes = append(updated.Last60Closes, evt.Close)
	if len(updated.Last60Closes) > 61 {
		updated.Last60Closes = updated.Last60Closes[1:]
	}

	mom := 0.0
	if len(updated.Last60Closes) >= 61 {
		prev := updated.Last60Closes[0]
		if prev > 0 {
			mom = math.Log(evt.Close / prev)
		}
	}

	regime := 0
	if mom > mt.cfg.RegimeEps {
		regime = 1
	} else if mom < -mt.cfg.RegimeEps {
		regime = -1
	}

	if updated.O1h == nil {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	hourEnd := updated.CurHour + 3_600_000
	tauToEndSec := int((hourEnd - nowMs) / 1000)
	pUp := 0.0
	pbad := 0.0
	sgn := 0
	signalReady := false
	if tauToEndSec >= 1 && tauToEndSec <= 3600 {
		deltaPct := (evt.Close/(*updated.O1h+1e-12) - 1.0) * 100.0
		pUp = model.Predict(deltaPct, updated.CumVol, mom, regime, tauToEndSec)
		pbad, sgn = ComputePbad(pUp, evt.Close, *updated.O1h)
		updated.LastSignalTsMs = nowMs
		updated.LastPUp = pUp
		updated.LastPBad = pbad
		updated.LastTauSec = tauToEndSec
		updated.LastDeltaPct = deltaPct
		updated.LastRegime = regime
		signalReady = true
	}

	windowStart := hourEnd - int64(mt.cfg.Strategy.WindowSec*1000)
	if nowMs < windowStart {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	tauSec := tauToEndSec
	if tauSec < 1 || tauSec > mt.cfg.Strategy.WindowSec {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}
	if !signalReady {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	signalDecisionID := nextDecisionID(updated)
	mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventMarketSnapshot, signalDecisionID, activeTradeID(updated), "", "observed", map[string]any{
		"interval":      evt.Interval,
		"hour_open_ms":  updated.CurHour,
		"tau_sec":       tauSec,
		"price":         evt.Close,
		"hour_open":     *updated.O1h,
		"cum_volume":    updated.CumVol,
		"last_price_ts": updated.LastPriceTsMs,
	}, nil, nil, nowMs)
	mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventSignalEval, signalDecisionID, activeTradeID(updated), "", "signal_ready", map[string]any{
		"entry_high": mt.cfg.Strategy.EntryHigh,
		"entry_low":  mt.cfg.Strategy.EntryLow,
		"theta":      mt.cfg.Strategy.Theta,
	}, map[string]any{
		"p_up":      pUp,
		"p_bad":     pbad,
		"sign":      sgn,
		"delta_pct": updated.LastDeltaPct,
		"mom":       mom,
		"regime":    regime,
	}, nil, nowMs)

	stopActive := mt.cfg.StopAtMs != nil && nowMs >= *mt.cfg.StopAtMs
	if stopActive && !updated.StopLogged {
		log.Printf("[STOP] reached stop_at_et=%s; no new entries", msToETStr(*mt.cfg.StopAtMs, loadETLocation()))
		updated.StopLogged = true
		mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventStateChange, nextDecisionID(updated), activeTradeID(updated), "", "stop_time_reached", nil, nil, map[string]any{
			"stop_at_ms": *mt.cfg.StopAtMs,
		}, nowMs)
	}

	if mt.cfg.LogEverySec > 0 && (nowMs-updated.LastLogMs) >= int64(mt.cfg.LogEverySec*1000) {
		updated.LastLogMs = nowMs
		log.Printf("[SIGNAL] tau=%3ds time=%s p_up=%.4f pbad=%.4f sign=%+d", tauSec, msToUTCStr(nowMs), pUp, pbad, sgn)
		fh := mt.getSignalLog(ctx)
		if fh != nil {
			payload := map[string]any{
				"t_ms":         nowMs,
				"hour_open_ms": hourOpen,
				"tau_sec":      tauSec,
				"p_up":         pUp,
				"pbad":         pbad,
				"price":        evt.Close,
				"o_1h":         *updated.O1h,
				"market_slug":  market.MarketSlug,
			}
			if mt.cfg.LogOrderbookGap {
				gap := mt.buildOrderbookGap(pUp, market)
				for k, v := range gap {
					payload[k] = v
				}
			}
			data, _ := json.Marshal(payload)
			_, _ = fh.Write(append(data, '\n'))
			updated.SignalLogLines++
			if mt.cfg.SignalLogFlushEvery > 0 && updated.SignalLogLines%mt.cfg.SignalLogFlushEvery == 0 {
				_ = fh.Sync()
			}
		}
	}

	if mt.cfg.SignalsOnly || updated.Paused {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	if stopActive {
		updated.PendingBetUp = nil
		updated.PendingTradeID = nil
		updated.PendingSinceMs = nil
		updated.NextEntryAttemptMs = 0
		if mt.cfg.StopExit && updated.Position != nil {
			mt.tryExitPosition(ctx, executor, updated, "stop_time", nowMs)
		}
		if updated.Position == nil {
			return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), true
		}
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	var betUpSignal *bool
	if pUp >= mt.cfg.Strategy.EntryHigh {
		v := true
		betUpSignal = &v
	} else if pUp <= mt.cfg.Strategy.EntryLow {
		v := false
		betUpSignal = &v
	}

	if updated.Position == nil && !updated.TradedThisHour {
		if betUpSignal != nil {
			if updated.PendingBetUp == nil {
				v := *betUpSignal
				tradeID := nextTradeID(updated)
				updated.PendingBetUp = &v
				updated.PendingTradeID = &tradeID
				ms := nowMs
				updated.PendingSinceMs = &ms
				updated.NextEntryAttemptMs = 0
				log.Printf("[ENTRY] pending tau=%ds bet_up=%t p_up=%.4f", tauSec, v, pUp)
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventStateChange, nextDecisionID(updated), tradeID, "", "pending_created", map[string]any{
					"bet_up":  v,
					"p_up":    pUp,
					"tau_sec": tauSec,
				}, nil, map[string]any{
					"state": "pending",
				}, nowMs)
			} else if *updated.PendingBetUp != *betUpSignal {
				v := *betUpSignal
				tradeID := nextTradeID(updated)
				updated.PendingBetUp = &v
				updated.PendingTradeID = &tradeID
				ms := nowMs
				updated.PendingSinceMs = &ms
				updated.NextEntryAttemptMs = 0
				log.Printf("[ENTRY] pending switch tau=%ds bet_up=%t p_up=%.4f", tauSec, v, pUp)
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventStateChange, nextDecisionID(updated), tradeID, "", "pending_switched", map[string]any{
					"bet_up":  v,
					"p_up":    pUp,
					"tau_sec": tauSec,
				}, nil, map[string]any{
					"state": "pending",
				}, nowMs)
			}
		}

		if updated.PendingBetUp != nil {
			if market.MarketClosed != nil && *market.MarketClosed {
				log.Printf("[ENTRY] skip (market closed)")
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), pendingTradeID(updated), diagnostics.ReasonMarketClosed.String(), "blocked", map[string]any{
					"bet_up":  *updated.PendingBetUp,
					"tau_sec": tauSec,
				}, nil, nil, nowMs)
				updated.PendingBetUp = nil
				updated.PendingTradeID = nil
				updated.PendingSinceMs = nil
				updated.NextEntryAttemptMs = 0
				updated.TradedThisHour = true
			} else if market.EnableOrderbook != nil && !*market.EnableOrderbook {
				log.Printf("[ENTRY] skip (orderbook disabled)")
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), pendingTradeID(updated), diagnostics.ReasonDataOrderbookUnavailable.String(), "blocked", map[string]any{
					"bet_up":  *updated.PendingBetUp,
					"tau_sec": tauSec,
				}, nil, nil, nowMs)
				updated.PendingBetUp = nil
				updated.PendingTradeID = nil
				updated.PendingSinceMs = nil
				updated.NextEntryAttemptMs = 0
				updated.TradedThisHour = true
			} else if updated.NextEntryAttemptMs != 0 && nowMs < updated.NextEntryAttemptMs {
			} else {
				tokenID := market.TokenIDDown
				if *updated.PendingBetUp {
					tokenID = market.TokenIDUp
				}
				available, err := executor.ComputeBuyUSDC()
				if err != nil {
					log.Printf("[ENTRY] balance check failed: %v", err)
					delayMs := entryRetryDelayMs(tauSec)
					updated.NextEntryAttemptMs = nowMs + delayMs
					log.Printf("[ENTRY] retry scheduled in %ds", delayMs/1000)
					mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), pendingTradeID(updated), diagnostics.ReasonVenueUnavailable.String(), "balance_check_failed", map[string]any{
						"bet_up":  *updated.PendingBetUp,
						"tau_sec": tauSec,
					}, nil, map[string]any{
						"error":    err.Error(),
						"retry_ms": delayMs,
					}, nowMs)
				} else {
					selected, err := mt.evaluateBestEntryCandidate(market, pUp, available, *updated.PendingBetUp)
					if err != nil {
						log.Printf("[ENTRY] edge check failed: %v", err)
						delayMs := entryRetryDelayMs(tauSec)
						updated.NextEntryAttemptMs = nowMs + delayMs
						log.Printf("[ENTRY] retry scheduled in %ds", delayMs/1000)
						mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), pendingTradeID(updated), diagnostics.ReasonVenueUnavailable.String(), "entry_edge_check_failed", map[string]any{
							"available_usdc": available,
						}, nil, map[string]any{
							"error":    err.Error(),
							"retry_ms": delayMs,
						}, nowMs)
					} else {
						tokenID = selected.TokenID
						decision := selected.Decision
						if updated.PendingBetUp != nil && *updated.PendingBetUp != selected.BetUp {
							prevBetUp := *updated.PendingBetUp
							v := selected.BetUp
							updated.PendingBetUp = &v
							log.Printf("[ENTRY] pending side switch bet_up=%t -> %t based on edge comparison", prevBetUp, v)
							mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventStateChange, nextDecisionID(updated), pendingTradeID(updated), "", "pending_side_switched", map[string]any{
								"from_bet_up": prevBetUp,
								"to_bet_up":   v,
							}, map[string]any{
								"p_up":                  pUp,
								"position_prob":         decision.PositionProb,
								"estimated_entry_price": decision.EstimatedEntryPrice,
								"edge":                  decision.ModelEdge,
							}, nil, nowMs)
						}
						if !decision.Allow {
							delayMs := entryRetryDelayMs(tauSec)
							updated.NextEntryAttemptMs = nowMs + delayMs
							reasonCode := entryBlockReason(decision, mt.cfg.Strategy)
							if decision.EstimatedEntryPrice > 0 && reasonCode == diagnostics.ReasonPolicyProbabilityBelowThreshold {
								log.Printf("[ENTRY] blocked by probability gate token_id=%s position_prob=%.4f min_position_prob=%.4f est_entry_px=%.4f edge=%.4f; backing off for %ds",
									tokenID, decision.PositionProb, mt.cfg.Strategy.MinPositionProbForEntry, decision.EstimatedEntryPrice, decision.ModelEdge, delayMs/1000)
							} else if decision.EstimatedEntryPrice > 0 {
								log.Printf("[ENTRY] blocked by edge gate token_id=%s position_prob=%.4f est_entry_px=%.4f edge=%.4f min_edge=%.4f; backing off for %ds",
									tokenID, decision.PositionProb, decision.EstimatedEntryPrice, decision.ModelEdge, mt.cfg.Strategy.MinEntryEdge, delayMs/1000)
							} else {
								log.Printf("[ENTRY] blocked by edge gate token_id=%s (missing entry quote or insufficient amount); backing off for %ds",
									tokenID, delayMs/1000)
							}
							mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), pendingTradeID(updated), reasonCode.String(), "blocked", map[string]any{
								"token_id":       tokenID,
								"bet_up":         *updated.PendingBetUp,
								"tau_sec":        tauSec,
								"available_usdc": available,
							}, map[string]any{
								"position_prob":         decision.PositionProb,
								"estimated_entry_price": decision.EstimatedEntryPrice,
								"edge":                  decision.ModelEdge,
								"min_entry_edge":        mt.cfg.Strategy.MinEntryEdge,
								"min_position_prob":     mt.cfg.Strategy.MinPositionProbForEntry,
							}, map[string]any{
								"retry_ms": delayMs,
							}, nowMs)
						} else {
							cancelled, cancelErr := executor.CancelOpenEntryOrders(market.MarketID)
							if cancelErr != nil {
								log.Printf("[ENTRY] open order cleanup failed market_id=%s: %v", market.MarketID, cancelErr)
							} else if cancelled > 0 {
								log.Printf("[ENTRY] cleaned up %d stale open buy order(s) for market_id=%s", cancelled, market.MarketID)
							}
							log.Printf("[ENTRY] tau=%ds bet_up=%t p_up=%.4f token_id=%s", tauSec, *updated.PendingBetUp, pUp, tokenID)
							pendingID := pendingTradeID(updated)
							mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventOrderAction, nextDecisionID(updated), pendingID, "", "attempt_entry", map[string]any{
								"token_id": tokenID,
								"bet_up":   *updated.PendingBetUp,
								"tau_sec":  tauSec,
							}, map[string]any{
								"p_up":                  pUp,
								"position_prob":         decision.PositionProb,
								"estimated_entry_price": decision.EstimatedEntryPrice,
								"edge":                  decision.ModelEdge,
							}, map[string]any{
								"cancelled_open_orders": cancelled,
							}, nowMs)
							fill, err := executor.MarketBuyMax(tokenID)
							if err != nil {
								log.Printf("[ENTRY] buy failed: %v", err)
								delayMs := entryRetryDelayMs(tauSec)
								updated.NextEntryAttemptMs = nowMs + delayMs
								log.Printf("[ENTRY] retry scheduled in %ds", delayMs/1000)
								mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), pendingID, diagnostics.ReasonVenueUnavailable.String(), "entry_order_failed", map[string]any{
									"token_id": tokenID,
									"bet_up":   *updated.PendingBetUp,
								}, nil, map[string]any{
									"error":    err.Error(),
									"retry_ms": delayMs,
								}, nowMs)
							} else if fill != nil {
								tradeID := pendingID
								if tradeID == "" {
									tradeID = nextTradeID(updated)
								}
								updated.Position = &Position{
									TradeID:      tradeID,
									TokenID:      tokenID,
									MarketSlug:   market.MarketSlug,
									BetUp:        *updated.PendingBetUp,
									EntryTsMs:    nowMs,
									EntryPrice:   fill.AvgPrice,
									Shares:       fill.Shares,
									CostUSDC:     fill.USDC,
									EntryO1h:     updated.O1h,
									HoldToExpiry: false,
								}
								updated.NextEntryAttemptMs = 0
								updated.NextScaleInMs = 0
								if !mt.cfg.AllowScaleIn {
									updated.TradedThisHour = true
								}
								updated.PendingBetUp = nil
								updated.PendingTradeID = nil
								updated.PendingSinceMs = nil
								mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventFillResult, nextDecisionID(updated), tradeID, "", "entry_filled", map[string]any{
									"token_id": tokenID,
									"bet_up":   updated.Position.BetUp,
								}, nil, map[string]any{
									"usdc":      fill.USDC,
									"shares":    fill.Shares,
									"avg_price": derefFloat(fill.AvgPrice),
									"partial":   fill.Partial,
								}, nowMs)
								mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventStateChange, nextDecisionID(updated), tradeID, "", "entered_position", nil, nil, map[string]any{
									"state": "in_position",
								}, nowMs)
							} else {
								delayMs := entryRetryDelayMs(tauSec)
								updated.NextEntryAttemptMs = nowMs + delayMs
								log.Printf("[ENTRY] no fill; keeping entry pending and backing off for %ds", delayMs/1000)
								mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventOrderAction, nextDecisionID(updated), pendingID, diagnostics.ReasonExecutionNoFill.String(), "entry_no_fill", map[string]any{
									"token_id": tokenID,
									"bet_up":   *updated.PendingBetUp,
								}, nil, map[string]any{
									"retry_ms": delayMs,
								}, nowMs)
							}
						}
					}
				}

				if updated.Position == nil && updated.PendingBetUp != nil && tauSec <= 1 {
					log.Printf("[ENTRY] pending expired tau=%ds bet_up=%t", tauSec, *updated.PendingBetUp)
					mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventStateChange, nextDecisionID(updated), pendingTradeID(updated), diagnostics.ReasonLifecycleWindowClosed.String(), "pending_expired", map[string]any{
						"bet_up": *updated.PendingBetUp,
					}, nil, map[string]any{
						"state": "expired",
					}, nowMs)
					updated.PendingBetUp = nil
					updated.PendingTradeID = nil
					updated.PendingSinceMs = nil
					updated.NextEntryAttemptMs = 0
					updated.TradedThisHour = true
				}
			}
		} else if mt.cfg.AllowScaleIn && updated.Position != nil && updated.Position.MarketSlug == market.MarketSlug && !updated.TradedThisHour && betUpSignal != nil && updated.Position.BetUp == *betUpSignal {
			if market.MarketClosed != nil && *market.MarketClosed {
				log.Printf("[ENTRY] scale-in skip (market closed)")
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonMarketClosed.String(), "scale_in_blocked", nil, nil, nil, nowMs)
				updated.NextScaleInMs = 0
				updated.TradedThisHour = true
			} else if market.EnableOrderbook != nil && !*market.EnableOrderbook {
				log.Printf("[ENTRY] scale-in skip (orderbook disabled)")
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonDataOrderbookUnavailable.String(), "scale_in_blocked", nil, nil, nil, nowMs)
				updated.NextScaleInMs = 0
				updated.TradedThisHour = true
			} else if updated.NextScaleInMs != 0 && nowMs < updated.NextScaleInMs {
			} else {
				available, err := executor.ComputeBuyUSDC()
				if err != nil {
					log.Printf("[ENTRY] scale-in skip (balance check failed: %v)", err)
					mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonVenueUnavailable.String(), "scale_in_balance_check_failed", nil, nil, map[string]any{
						"error": err.Error(),
					}, nowMs)
					updated.NextScaleInMs = 0
					updated.TradedThisHour = true
				} else if available < mt.cfg.TradeCfg.MinUSDC {
					log.Printf("[ENTRY] scale-in skip (amount=%.4f < min_usdc=%.4f)", available, mt.cfg.TradeCfg.MinUSDC)
					mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonExecutionAmountTooSmall.String(), "scale_in_blocked", map[string]any{
						"available_usdc": available,
					}, nil, nil, nowMs)
					updated.NextScaleInMs = 0
					updated.TradedThisHour = true
				} else {
					tokenID := market.TokenIDDown
					if *betUpSignal {
						tokenID = market.TokenIDUp
					}
					positionProb := positionProbForBet(*betUpSignal, pUp)
					decision, err := mt.evaluateEntryEdgeDecision(tokenID, positionProb, available)
					if err != nil {
						log.Printf("[ENTRY] scale-in edge check failed token_id=%s: %v", tokenID, err)
						delayMs := scaleInRetryDelayMs(tauSec)
						updated.NextScaleInMs = nowMs + delayMs
						log.Printf("[ENTRY] scale-in retry scheduled in %ds", delayMs/1000)
						mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonVenueUnavailable.String(), "scale_in_edge_check_failed", map[string]any{
							"token_id":       tokenID,
							"available_usdc": available,
						}, nil, map[string]any{
							"error":    err.Error(),
							"retry_ms": delayMs,
						}, nowMs)
					} else if !decision.Allow {
						delayMs := scaleInRetryDelayMs(tauSec)
						updated.NextScaleInMs = nowMs + delayMs
						reasonCode := entryBlockReason(decision, mt.cfg.Strategy)
						if decision.EstimatedEntryPrice > 0 && reasonCode == diagnostics.ReasonPolicyProbabilityBelowThreshold {
							log.Printf("[ENTRY] scale-in blocked by probability gate token_id=%s position_prob=%.4f min_position_prob=%.4f est_entry_px=%.4f edge=%.4f; backing off for %ds",
								tokenID, decision.PositionProb, mt.cfg.Strategy.MinPositionProbForEntry, decision.EstimatedEntryPrice, decision.ModelEdge, delayMs/1000)
						} else if decision.EstimatedEntryPrice > 0 {
							log.Printf("[ENTRY] scale-in blocked by edge gate token_id=%s position_prob=%.4f est_entry_px=%.4f edge=%.4f min_edge=%.4f; backing off for %ds",
								tokenID, decision.PositionProb, decision.EstimatedEntryPrice, decision.ModelEdge, mt.cfg.Strategy.MinEntryEdge, delayMs/1000)
						} else {
							log.Printf("[ENTRY] scale-in blocked by edge gate token_id=%s (missing entry quote); backing off for %ds",
								tokenID, delayMs/1000)
						}
						mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventEntryEval, nextDecisionID(updated), positionTradeID(updated), reasonCode.String(), "scale_in_blocked", map[string]any{
							"token_id":       tokenID,
							"available_usdc": available,
						}, map[string]any{
							"position_prob":         decision.PositionProb,
							"estimated_entry_price": decision.EstimatedEntryPrice,
							"edge":                  decision.ModelEdge,
							"min_entry_edge":        mt.cfg.Strategy.MinEntryEdge,
							"min_position_prob":     mt.cfg.Strategy.MinPositionProbForEntry,
						}, map[string]any{
							"retry_ms": delayMs,
						}, nowMs)
					} else {
						log.Printf("[ENTRY] scale-in tau=%ds bet_up=%t p_up=%.4f token_id=%s", tauSec, *betUpSignal, pUp, tokenID)
						mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventOrderAction, nextDecisionID(updated), positionTradeID(updated), "", "attempt_scale_in", map[string]any{
							"token_id": tokenID,
							"bet_up":   *betUpSignal,
						}, map[string]any{
							"position_prob":         decision.PositionProb,
							"estimated_entry_price": decision.EstimatedEntryPrice,
							"edge":                  decision.ModelEdge,
						}, nil, nowMs)
						fill, err := executor.MarketBuyMax(tokenID)
						if err != nil {
							log.Printf("[ENTRY] scale-in buy failed: %v", err)
							delayMs := scaleInRetryDelayMs(tauSec)
							updated.NextScaleInMs = nowMs + delayMs
							log.Printf("[ENTRY] scale-in retry scheduled in %ds", delayMs/1000)
							mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonVenueUnavailable.String(), "scale_in_order_failed", map[string]any{
								"token_id": tokenID,
							}, nil, map[string]any{
								"error":    err.Error(),
								"retry_ms": delayMs,
							}, nowMs)
						} else if fill != nil {
							applyFillToPosition(updated.Position, fill)
							updated.NextScaleInMs = 0
							updated.TradedThisHour = true
							mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventFillResult, nextDecisionID(updated), positionTradeID(updated), "", "scale_in_filled", map[string]any{
								"token_id": tokenID,
							}, nil, map[string]any{
								"usdc":      fill.USDC,
								"shares":    fill.Shares,
								"avg_price": derefFloat(fill.AvgPrice),
								"partial":   fill.Partial,
							}, nowMs)
						} else {
							delayMs := scaleInRetryDelayMs(tauSec)
							updated.NextScaleInMs = nowMs + delayMs
							log.Printf("[ENTRY] scale-in no fill; backing off for %ds", delayMs/1000)
							mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventOrderAction, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonExecutionNoFill.String(), "scale_in_no_fill", map[string]any{
								"token_id": tokenID,
							}, nil, map[string]any{
								"retry_ms": delayMs,
							}, nowMs)
						}
					}
				}
			}
		}

	}

	if updated.Position == nil {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	exitNow := false
	exitReason := ""
	if decision, err := mt.evaluatePositionStopDecision(updated.Position); err != nil {
		log.Printf("[RISK] stop-loss check failed token_id=%s: %v", updated.Position.TokenID, err)
		mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventAnomaly, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonVenueUnavailable.String(), "stop_loss_check_failed", map[string]any{
			"token_id": updated.Position.TokenID,
		}, nil, map[string]any{
			"error": err.Error(),
		}, nowMs)
	} else if decision.Exit {
		exitNow = true
		exitReason = "stop_loss"
		log.Printf("[RISK] stop_loss token_id=%s current_exit_px=%.4f unrealized_roi=%.2f%% max_loss_roi=%.2f%%",
			updated.Position.TokenID, decision.CurrentExitPrice, decision.UnrealizedROI*100.0, mt.cfg.Strategy.MaxPositionLossROI*100.0)
		mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventRiskEval, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonRiskStopLossTriggered.String(), "exit", map[string]any{
			"token_id": updated.Position.TokenID,
		}, map[string]any{
			"current_exit_price":    decision.CurrentExitPrice,
			"unrealized_roi":        decision.UnrealizedROI,
			"max_position_loss_roi": mt.cfg.Strategy.MaxPositionLossROI,
		}, nil, nowMs)
	}
	if !exitNow && mt.cfg.Strategy.Mode == "pm" {
		if updated.Position.BetUp && pUp < mt.cfg.Strategy.ExitHigh {
			exitNow = true
			exitReason = "pm_exit"
		} else if !updated.Position.BetUp && pUp > mt.cfg.Strategy.ExitLow {
			exitNow = true
			exitReason = "pm_exit"
		}
	} else if !exitNow && pbad > mt.cfg.Strategy.Theta {
		exitNow = true
		exitReason = "pbad"
	}

	if !exitNow && mt.cfg.Strategy.ExitAtWindowEnd && tauSec <= mt.cfg.Strategy.ExitAtWindowEndSec {
		if decision, ok := mt.evaluateWindowEndHoldDecision(updated.Position, market, pUp); ok {
			if !updated.Position.HoldToExpiry {
				updated.Position.HoldToExpiry = true
				log.Printf("[HOLD] keep_to_close reason=window_end slug=%s token_id=%s entry_px=%.4f current_exit_px=%.4f remaining_upside=%.4f position_prob=%.4f edge_vs_exit=%.4f",
					updated.Position.MarketSlug, updated.Position.TokenID, decision.EntryPrice, decision.CurrentExitPrice,
					decision.RemainingUpside, decision.PositionProb, decision.ModelEdgeVsExit)
				mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventRiskEval, nextDecisionID(updated), positionTradeID(updated), "", "hold_to_close", map[string]any{
					"token_id": updated.Position.TokenID,
					"tau_sec":  tauSec,
				}, map[string]any{
					"entry_price":        decision.EntryPrice,
					"current_exit_price": decision.CurrentExitPrice,
					"remaining_upside":   decision.RemainingUpside,
					"position_prob":      decision.PositionProb,
					"edge_vs_exit":       decision.ModelEdgeVsExit,
				}, nil, nowMs)
			}
		} else {
			exitNow = true
			exitReason = "window_end"
			mt.emitDebugEvent(ctx, updated, market, cctxdebug.EventRiskEval, nextDecisionID(updated), positionTradeID(updated), diagnostics.ReasonLifecycleWindowClosed.String(), "exit", map[string]any{
				"token_id": updated.Position.TokenID,
				"tau_sec":  tauSec,
			}, nil, nil, nowMs)
		}
	}

	if exitNow {
		if mt.cfg.AllowScaleIn {
			updated.TradedThisHour = true
			updated.PendingBetUp = nil
			updated.PendingTradeID = nil
			updated.PendingSinceMs = nil
		}
		if mt.cfg.PaperCfg != nil && mt.cfg.PaperCfg.HoldToExpiry {
			if exitReason == "pbad" {
				mt.tryExitPosition(ctx, executor, updated, exitReason, nowMs)
			}
		} else {
			if exitReason == "" {
				exitReason = "signal_exit"
			}
			mt.tryExitPosition(ctx, executor, updated, exitReason, nowMs)
		}
	}

	return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
}

func (mt *ManagedTrader) buildOrderbookGap(pUp float64, market *MarketState) map[string]any {
	payload := map[string]any{}
	yesBook, err := fetchOrderbook(mt.cfg.ClobHost, market.TokenIDUp)
	if err != nil {
		payload["orderbook_error"] = err.Error()
		return payload
	}
	noBook, err := fetchOrderbook(mt.cfg.ClobHost, market.TokenIDDown)
	if err != nil {
		payload["orderbook_error"] = err.Error()
		return payload
	}
	yesBid, yesAsk := bestBidAsk(yesBook)
	noBid, noAsk := bestBidAsk(noBook)
	yesMid := midFromBidAsk(yesBid, yesAsk)
	noMid := midFromBidAsk(noBid, noAsk)
	payload["orderbook"] = map[string]any{
		"yes": map[string]any{
			"bid": yesBid,
			"ask": yesAsk,
			"mid": yesMid,
		},
		"no": map[string]any{
			"bid": noBid,
			"ask": noAsk,
			"mid": noMid,
		},
		"gap_yes": gapValue(pUp, yesMid),
		"gap_no":  gapValue(1.0-pUp, noMid),
	}
	return payload
}

func (mt *ManagedTrader) tryExitPosition(ctx hersh.HershContext, executor TradeExecutor, state *RuntimeState, reason string, tMs int64) {
	if state.Position == nil {
		return
	}
	pos := state.Position
	log.Printf("[EXIT] reason=%s time=%s token_id=%s", reason, msToUTCStr(tMs), pos.TokenID)
	mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventOrderAction, nextDecisionID(state), pos.TradeID, reason, "attempt_exit", map[string]any{
		"token_id": pos.TokenID,
		"shares":   pos.Shares,
	}, nil, nil, tMs)
	fill, err := executor.MarketSellAll(pos.TokenID)
	if err != nil {
		log.Printf("[EXIT] failed: %v", err)
		mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventAnomaly, nextDecisionID(state), pos.TradeID, diagnostics.ReasonVenueUnavailable.String(), "exit_failed", map[string]any{
			"token_id": pos.TokenID,
		}, nil, map[string]any{
			"error": err.Error(),
		}, tMs)
		return
	}
	if fill != nil {
		soldShares := fill.Shares
		if soldShares < 0 {
			soldShares = 0
		}
		if soldShares > pos.Shares {
			soldShares = pos.Shares
		}
		realizedCost := 0.0
		if pos.Shares > 1e-9 && pos.CostUSDC > 0 {
			realizedCost = pos.CostUSDC * (soldShares / pos.Shares)
		}
		if realizedCost > 0 {
			pnl := fill.USDC - realizedCost
			roiPct := (pnl / realizedCost) * 100
			log.Printf("[EXIT] realized token_id=%s cost=%.4f proceeds=%.4f pnl=%.4f roi=%.2f%% shares=%.6f",
				pos.TokenID, realizedCost, fill.USDC, pnl, roiPct, soldShares)
			mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventFillResult, nextDecisionID(state), pos.TradeID, reason, "exit_filled", map[string]any{
				"token_id": pos.TokenID,
			}, nil, map[string]any{
				"shares":        soldShares,
				"proceeds":      fill.USDC,
				"avg_price":     derefFloat(fill.AvgPrice),
				"realized_cost": realizedCost,
				"pnl":           pnl,
				"roi_pct":       roiPct,
				"partial":       fill.Partial,
			}, tMs)
		} else {
			log.Printf("[EXIT] realized token_id=%s proceeds=%.4f shares=%.6f", pos.TokenID, fill.USDC, soldShares)
			mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventFillResult, nextDecisionID(state), pos.TradeID, reason, "exit_filled", map[string]any{
				"token_id": pos.TokenID,
			}, nil, map[string]any{
				"shares":    soldShares,
				"proceeds":  fill.USDC,
				"avg_price": derefFloat(fill.AvgPrice),
				"partial":   fill.Partial,
			}, tMs)
		}
		remainingShares := pos.Shares - soldShares
		if remainingShares < 0 {
			remainingShares = 0
		}
		remainingCost := pos.CostUSDC - realizedCost
		if remainingCost < 0 {
			remainingCost = 0
		}
		if remainingShares <= 1e-9 || isDustPosition(remainingShares, remainingCost, pos.EntryPrice, mt.cfg.TradeCfg) {
			if remainingShares > 1e-9 {
				log.Printf("[EXIT] clearing residual dust token_id=%s shares=%.6f cost=%.4f", pos.TokenID, remainingShares, remainingCost)
			}
			mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventStateChange, nextDecisionID(state), pos.TradeID, reason, "position_closed", nil, nil, map[string]any{
				"state": "closed",
			}, tMs)
			state.Position = nil
			return
		}
		pos.Shares = remainingShares
		pos.CostUSDC = remainingCost
		if pos.Shares > 1e-9 && pos.CostUSDC > 0 {
			v := pos.CostUSDC / pos.Shares
			pos.EntryPrice = &v
		}
		log.Printf("[EXIT] partial token_id=%s remaining_shares=%.6f remaining_cost=%.4f", pos.TokenID, pos.Shares, pos.CostUSDC)
		mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventStateChange, nextDecisionID(state), pos.TradeID, reason, "partial_exit", nil, nil, map[string]any{
			"state":            "partial",
			"remaining_shares": pos.Shares,
			"remaining_cost":   pos.CostUSDC,
		}, tMs)
		return
	}
	mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventOrderAction, nextDecisionID(state), pos.TradeID, diagnostics.ReasonExecutionNoFill.String(), "exit_no_fill", map[string]any{
		"token_id": pos.TokenID,
	}, nil, nil, tMs)
}

func (mt *ManagedTrader) expireLivePosition(ctx hersh.HershContext, state *RuntimeState, reason string, tMs int64) {
	if state.Position == nil {
		return
	}
	log.Printf("[HOLD] expiry reason=%s time=%s token_id=%s (no exit order)", reason, msToUTCStr(tMs), state.Position.TokenID)
	mt.emitDebugEvent(ctx, state, nil, cctxdebug.EventStateChange, nextDecisionID(state), state.Position.TradeID, reason, "expired_without_exit", nil, nil, map[string]any{
		"state": "expired",
	}, tMs)
	state.Position = nil
}

func (mt *ManagedTrader) releaseHeldPositionForSettlement(state *RuntimeState, reason string, tMs int64) {
	if state == nil || state.Position == nil {
		return
	}
	log.Printf("[HOLD] release_to_settlement reason=%s time=%s slug=%s token_id=%s shares=%.6f",
		reason, msToUTCStr(tMs), state.Position.MarketSlug, state.Position.TokenID, state.Position.Shares)
	state.Position = nil
}

func (mt *ManagedTrader) evaluateWindowEndHoldDecision(pos *Position, market *MarketState, pUp float64) (windowEndHoldDecision, bool) {
	decision := windowEndHoldDecision{}
	if pos == nil || !mt.cfg.Strategy.WindowEndHoldEnabled || mt.cfg.PaperCfg != nil {
		return decision, false
	}
	if market == nil || pos.MarketSlug == "" || pos.MarketSlug != market.MarketSlug {
		return decision, false
	}
	if pos.EntryPrice == nil || *pos.EntryPrice <= 1e-9 {
		return decision, false
	}
	positionProb := pUp
	if !pos.BetUp {
		positionProb = 1 - pUp
	}
	entryPrice := *pos.EntryPrice
	currentExitPrice := entryPrice
	if exitPx, err := mt.estimateCurrentExitPrice(pos.TokenID, pos.Shares); err == nil && exitPx != nil && *exitPx > 0 {
		currentExitPrice = *exitPx
	}
	decision = computeWindowEndHoldDecision(entryPrice, positionProb, currentExitPrice, mt.cfg.Strategy)
	return decision, decision.Hold
}

func computeWindowEndHoldDecision(entryPrice, positionProb, currentExitPrice float64, strategy StrategyConfig) windowEndHoldDecision {
	remainingUpside := 1 - entryPrice
	modelEdgeVsExit := positionProb - currentExitPrice
	return windowEndHoldDecision{
		Hold: remainingUpside <= strategy.WindowEndHoldRemainingUpsideMax &&
			positionProb >= strategy.WindowEndHoldMinPositionProb &&
			modelEdgeVsExit >= strategy.WindowEndHoldMinEdgeVsExit,
		PositionProb:     positionProb,
		EntryPrice:       entryPrice,
		CurrentExitPrice: currentExitPrice,
		RemainingUpside:  remainingUpside,
		ModelEdgeVsExit:  modelEdgeVsExit,
	}
}

func (mt *ManagedTrader) estimateCurrentExitPrice(tokenID string, shares float64) (*float64, error) {
	book, err := fetchOrderbook(mt.cfg.ClobHost, tokenID)
	if err != nil {
		return nil, err
	}
	if fill := simulateMarketSell(book, shares); fill != nil && fill.AvgPrice != nil {
		return fill.AvgPrice, nil
	}
	bid, _ := bestBidAsk(book)
	return bid, nil
}

func entryRetryDelayMs(tauSec int) int64 {
	switch {
	case tauSec > 120:
		return entryRetryLongMs
	case tauSec > 30:
		return entryRetryMediumMs
	default:
		return entryRetryShortMs
	}
}

func scaleInRetryDelayMs(tauSec int) int64 {
	switch {
	case tauSec > 120:
		return scaleInRetryLongMs
	case tauSec > 30:
		return scaleInRetryMediumMs
	default:
		return scaleInRetryShortMs
	}
}

func positionProbForBet(betUp bool, pUp float64) float64 {
	if betUp {
		return pUp
	}
	return 1.0 - pUp
}

func computeEntryEdgeDecision(positionProb, estimatedEntryPrice, minEntryEdge float64) entryEdgeDecision {
	decision := entryEdgeDecision{
		Allow:               true,
		PositionProb:        positionProb,
		EstimatedEntryPrice: estimatedEntryPrice,
		ModelEdge:           positionProb - estimatedEntryPrice,
	}
	if minEntryEdge > 0 && decision.ModelEdge < minEntryEdge {
		decision.Allow = false
	}
	return decision
}

func computeGuardedEntryDecision(positionProb, estimatedEntryPrice, minEntryEdge, minPositionProb float64) entryEdgeDecision {
	decision := computeEntryEdgeDecision(positionProb, estimatedEntryPrice, minEntryEdge)
	if minPositionProb > 0 && positionProb < minPositionProb {
		decision.Allow = false
	}
	return decision
}

func entryBlockReason(decision entryEdgeDecision, strategy StrategyConfig) diagnostics.ReasonCode {
	if decision.EstimatedEntryPrice <= 0 {
		return diagnostics.ReasonDataQuoteUnavailable
	}
	if strategy.MinPositionProbForEntry > 0 && decision.PositionProb < strategy.MinPositionProbForEntry {
		return diagnostics.ReasonPolicyProbabilityBelowThreshold
	}
	return diagnostics.ReasonPolicyEdgeBelowThreshold
}

func prefersEntryCandidate(a, b entryCandidate, preferredBetUp bool) bool {
	if math.Abs(a.Decision.ModelEdge-b.Decision.ModelEdge) > 1e-9 {
		return a.Decision.ModelEdge > b.Decision.ModelEdge
	}
	aQuoted := a.Decision.EstimatedEntryPrice > 0
	bQuoted := b.Decision.EstimatedEntryPrice > 0
	if aQuoted != bQuoted {
		return aQuoted
	}
	if a.BetUp == preferredBetUp && b.BetUp != preferredBetUp {
		return true
	}
	if a.BetUp != preferredBetUp && b.BetUp == preferredBetUp {
		return false
	}
	if a.Decision.PositionProb != b.Decision.PositionProb {
		return a.Decision.PositionProb > b.Decision.PositionProb
	}
	return a.BetUp && !b.BetUp
}

func selectPreferredEntryCandidate(preferredBetUp bool, candidates ...entryCandidate) (entryCandidate, bool) {
	var bestAllowed *entryCandidate
	var bestQuoted *entryCandidate
	var bestAny *entryCandidate

	for _, candidate := range candidates {
		if candidate.TokenID == "" {
			continue
		}
		candidateCopy := candidate
		if bestAny == nil || prefersEntryCandidate(candidateCopy, *bestAny, preferredBetUp) {
			bestAny = &candidateCopy
		}
		if candidate.Decision.EstimatedEntryPrice > 0 {
			if bestQuoted == nil || prefersEntryCandidate(candidateCopy, *bestQuoted, preferredBetUp) {
				bestQuoted = &candidateCopy
			}
		}
		if candidate.Decision.Allow {
			if bestAllowed == nil || prefersEntryCandidate(candidateCopy, *bestAllowed, preferredBetUp) {
				bestAllowed = &candidateCopy
			}
		}
	}

	switch {
	case bestAllowed != nil:
		return *bestAllowed, true
	case bestQuoted != nil:
		return *bestQuoted, true
	case bestAny != nil:
		return *bestAny, true
	default:
		return entryCandidate{BetUp: preferredBetUp}, false
	}
}

func computePositionStopDecision(costUSDC, shares, currentExitPrice, maxPositionLossROI float64) positionStopDecision {
	if maxPositionLossROI < 0 || costUSDC <= 1e-9 || shares <= 1e-9 || currentExitPrice <= 0 {
		return positionStopDecision{}
	}
	proceeds := currentExitPrice * shares
	unrealizedROI := (proceeds - costUSDC) / costUSDC
	return positionStopDecision{
		Exit:             unrealizedROI <= -maxPositionLossROI,
		CurrentExitPrice: currentExitPrice,
		UnrealizedROI:    unrealizedROI,
	}
}

func (mt *ManagedTrader) evaluateEntryEdgeDecision(tokenID string, positionProb, amountUSDC float64) (entryEdgeDecision, error) {
	if amountUSDC < mt.cfg.TradeCfg.MinUSDC {
		return entryEdgeDecision{Allow: false, PositionProb: positionProb}, nil
	}
	estimatedEntryPrice, err := mt.estimateCurrentEntryPrice(tokenID, amountUSDC)
	if err != nil {
		return entryEdgeDecision{}, err
	}
	if estimatedEntryPrice == nil {
		return entryEdgeDecision{Allow: false, PositionProb: positionProb}, nil
	}
	return computeGuardedEntryDecision(positionProb, *estimatedEntryPrice, mt.cfg.Strategy.MinEntryEdge, mt.cfg.Strategy.MinPositionProbForEntry), nil
}

func (mt *ManagedTrader) evaluateEntryCandidate(tokenID string, betUp bool, pUp, amountUSDC float64) (entryCandidate, error) {
	candidate := entryCandidate{
		BetUp:   betUp,
		TokenID: tokenID,
		Decision: entryEdgeDecision{
			PositionProb: positionProbForBet(betUp, pUp),
		},
	}
	if tokenID == "" || amountUSDC < mt.cfg.TradeCfg.MinUSDC {
		return candidate, nil
	}
	estimatedEntryPrice, err := mt.estimateCurrentEntryPrice(tokenID, amountUSDC)
	if err != nil {
		return candidate, err
	}
	if estimatedEntryPrice == nil {
		return candidate, nil
	}
	candidate.Decision = computeGuardedEntryDecision(candidate.Decision.PositionProb, *estimatedEntryPrice, mt.cfg.Strategy.MinEntryEdge, mt.cfg.Strategy.MinPositionProbForEntry)
	return candidate, nil
}

func (mt *ManagedTrader) evaluateBestEntryCandidate(market *MarketState, pUp, amountUSDC float64, preferredBetUp bool) (entryCandidate, error) {
	if market == nil {
		return entryCandidate{BetUp: preferredBetUp}, fmt.Errorf("market state unavailable")
	}

	var (
		candidates []entryCandidate
		errs       []string
	)

	upCandidate, err := mt.evaluateEntryCandidate(market.TokenIDUp, true, pUp, amountUSDC)
	if err != nil {
		errs = append(errs, fmt.Sprintf("up: %v", err))
	} else {
		candidates = append(candidates, upCandidate)
	}

	downCandidate, err := mt.evaluateEntryCandidate(market.TokenIDDown, false, pUp, amountUSDC)
	if err != nil {
		errs = append(errs, fmt.Sprintf("down: %v", err))
	} else {
		candidates = append(candidates, downCandidate)
	}

	selected, ok := selectPreferredEntryCandidate(preferredBetUp, candidates...)
	if !ok {
		if len(errs) > 0 {
			return entryCandidate{BetUp: preferredBetUp}, fmt.Errorf("%s", strings.Join(errs, "; "))
		}
		return entryCandidate{BetUp: preferredBetUp}, nil
	}
	if !selected.Decision.Allow && len(errs) > 0 {
		return entryCandidate{BetUp: preferredBetUp}, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return selected, nil
}

func (mt *ManagedTrader) evaluatePositionStopDecision(pos *Position) (positionStopDecision, error) {
	if pos == nil || mt.cfg.Strategy.MaxPositionLossROI < 0 {
		return positionStopDecision{}, nil
	}
	currentExitPrice, err := mt.estimateCurrentExitPrice(pos.TokenID, pos.Shares)
	if err != nil {
		return positionStopDecision{}, err
	}
	if currentExitPrice == nil {
		return positionStopDecision{}, nil
	}
	return computePositionStopDecision(pos.CostUSDC, pos.Shares, *currentExitPrice, mt.cfg.Strategy.MaxPositionLossROI), nil
}

func (mt *ManagedTrader) estimateCurrentEntryPrice(tokenID string, amountUSDC float64) (*float64, error) {
	book, err := fetchOrderbook(mt.cfg.ClobHost, tokenID)
	if err != nil {
		return nil, err
	}
	if fill := simulateMarketBuy(book, amountUSDC); fill != nil {
		if fill.WorstPrice > 0 {
			price := fill.WorstPrice
			return &price, nil
		}
		if fill.AvgPrice != nil {
			return fill.AvgPrice, nil
		}
	}
	_, ask := bestBidAsk(book)
	return ask, nil
}

func (mt *ManagedTrader) settlePaperPosition(ctx hersh.HershContext, executor TradeExecutor, state *RuntimeState, reason string, tMs int64, closePrice float64, o1h *float64, marketSlug string) {
	if state.Position == nil {
		return
	}
	pos := state.Position
	entryO1h := pos.EntryO1h
	if entryO1h == nil {
		entryO1h = o1h
	}
	if entryO1h == nil {
		log.Printf("[PAPER] settle skipped (missing O_1h)")
		return
	}
	if pos.Shares <= 0 {
		log.Printf("[PAPER] settle skipped (missing shares)")
		return
	}

	outcomeUp := closePrice >= *entryO1h
	won := pos.BetUp == outcomeUp
	payout := pos.Shares
	if !won {
		payout = 0
	}
	pnl := payout - pos.CostUSDC

	exec, ok := executor.(*PaperExecutor)
	if !ok {
		return
	}
	exec.usdcBalance += payout
	remaining := exec.positions[pos.TokenID] - pos.Shares
	if remaining <= 1e-9 {
		delete(exec.positions, pos.TokenID)
	} else {
		exec.positions[pos.TokenID] = remaining
	}

	log.Printf("[PAPER] settle reason=%s time=%s won=%t payout=%.4f pnl=%.4f balance=%.4f", reason, msToUTCStr(tMs), won, payout, pnl, exec.usdcBalance)
	writePaperLedger(exec.paperCfg.LedgerPath, map[string]any{
		"event":        "settle",
		"reason":       reason,
		"t_ms":         tMs,
		"market_slug":  marketSlug,
		"token_id":     pos.TokenID,
		"bet_up":       pos.BetUp,
		"entry_ts_ms":  pos.EntryTsMs,
		"entry_price":  pos.EntryPrice,
		"entry_o_1h":   entryO1h,
		"close_price":  closePrice,
		"won":          won,
		"shares":       pos.Shares,
		"cost_usdc":    pos.CostUSDC,
		"payout":       payout,
		"pnl":          pnl,
		"balance_usdc": exec.usdcBalance,
		"pnl_total":    exec.usdcBalance - exec.paperCfg.StartUSDC,
	})
	state.Position = nil
}

func buildModelSignalState(ctx hersh.HershContext) map[string]any {
	state := ensureRuntimeState(ctx)
	snapshot := map[string]any{
		"initialized": state.LastSignalTsMs > 0,
		"t_ms":        state.LastSignalTsMs,
		"p_up":        state.LastPUp,
		"p_bad":       state.LastPBad,
		"tau_sec":     state.LastTauSec,
		"delta_pct":   state.LastDeltaPct,
		"regime":      state.LastRegime,
	}
	if market, ok := ctx.GetValue("market_state").(*MarketState); ok && market != nil {
		snapshot["market_slug"] = market.MarketSlug
	}
	return snapshot
}

func cloneRuntimeState(state *RuntimeState) *RuntimeState {
	if state == nil {
		return &RuntimeState{O1hByHour: map[int64]float64{}, Last60Closes: make([]float64, 0, 61)}
	}
	clone := *state
	if state.Position != nil {
		posClone := *state.Position
		clone.Position = &posClone
	}
	if state.O1hByHour != nil {
		clone.O1hByHour = make(map[int64]float64, len(state.O1hByHour))
		for k, v := range state.O1hByHour {
			clone.O1hByHour[k] = v
		}
	} else {
		clone.O1hByHour = map[int64]float64{}
	}
	if state.Last60Closes != nil {
		clone.Last60Closes = append([]float64(nil), state.Last60Closes...)
	} else {
		clone.Last60Closes = make([]float64, 0, 61)
	}
	if state.PendingTradeID != nil {
		value := *state.PendingTradeID
		clone.PendingTradeID = &value
	}
	return &clone
}

func loadETLocation() *time.Location {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		return time.FixedZone("ET", -5*60*60)
	}
	return loc
}
