package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/manager"
)

type ManagedTrader struct {
	cfg             TraderConfig
	executorBuilder func() (TradeExecutor, error)
}

func NewManagedTrader(cfg TraderConfig, executorBuilder func() (TradeExecutor, error)) *ManagedTrader {
	return &ManagedTrader{
		cfg:             cfg,
		executorBuilder: executorBuilder,
	}
}

func (mt *ManagedTrader) Run(msg *hersh.Message, ctx hersh.HershContext) error {
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
		ctx.SetValue("runtime_state", state)
		return state
	}
	state, _ := value.(*RuntimeState)
	if state == nil {
		state = &RuntimeState{O1hByHour: map[int64]float64{}, Last60Closes: make([]float64, 0, 61)}
		ctx.SetValue("runtime_state", state)
	}
	return state
}

func updateRuntimeState(ctx hersh.HershContext, fn func(*RuntimeState)) *RuntimeState {
	val := ctx.UpdateValue("runtime_state", func(current any) any {
		state, _ := current.(*RuntimeState)
		if state == nil {
			state = &RuntimeState{O1hByHour: map[int64]float64{}, Last60Closes: make([]float64, 0, 61)}
		}
		fn(state)
		return state
	})
	if state, ok := val.(*RuntimeState); ok {
		return state
	}
	return ensureRuntimeState(ctx)
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
	val := ctx.UpdateValue("market_state", func(current any) any {
		if state == nil {
			return current
		}
		return state
	})
	if updated, ok := val.(*MarketState); ok {
		return updated
	}
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
			if mt.cfg.PaperCfg != nil && mt.cfg.PaperCfg.HoldToExpiry {
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
			rs.PendingSinceMs = nil
		})
	}

	newState := &MarketState{
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
			if mt.cfg.PaperCfg != nil && mt.cfg.PaperCfg.HoldToExpiry {
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
		updated.PendingSinceMs = nil
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
	windowStart := hourEnd - int64(mt.cfg.Strategy.WindowSec*1000)
	if nowMs < windowStart {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	tauSec := int((hourEnd - nowMs) / 1000)
	if tauSec < 1 || tauSec > mt.cfg.Strategy.WindowSec {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	deltaPct := (evt.Close/(*updated.O1h+1e-12) - 1.0) * 100.0
	pUp := model.Predict(deltaPct, updated.CumVol, mom, regime, tauSec)
	pbad, sgn := ComputePbad(pUp, evt.Close, *updated.O1h)

	stopActive := mt.cfg.StopAtMs != nil && nowMs >= *mt.cfg.StopAtMs
	if stopActive && !updated.StopLogged {
		log.Printf("[STOP] reached stop_at_et=%s; no new entries", msToETStr(*mt.cfg.StopAtMs, loadETLocation()))
		updated.StopLogged = true
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
		updated.PendingSinceMs = nil
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
				updated.PendingBetUp = &v
				ms := nowMs
				updated.PendingSinceMs = &ms
				log.Printf("[ENTRY] pending tau=%ds bet_up=%t p_up=%.4f", tauSec, v, pUp)
			} else if *updated.PendingBetUp != *betUpSignal {
				v := *betUpSignal
				updated.PendingBetUp = &v
				ms := nowMs
				updated.PendingSinceMs = &ms
				log.Printf("[ENTRY] pending switch tau=%ds bet_up=%t p_up=%.4f", tauSec, v, pUp)
			}
		}

		if updated.PendingBetUp != nil {
			if market.MarketClosed != nil && *market.MarketClosed {
				log.Printf("[ENTRY] skip (market closed)")
				updated.PendingBetUp = nil
				updated.PendingSinceMs = nil
				updated.TradedThisHour = true
			} else if market.EnableOrderbook != nil && !*market.EnableOrderbook {
				log.Printf("[ENTRY] skip (orderbook disabled)")
				updated.PendingBetUp = nil
				updated.PendingSinceMs = nil
				updated.TradedThisHour = true
			} else {
				tokenID := market.TokenIDDown
				if *updated.PendingBetUp {
					tokenID = market.TokenIDUp
				}
				log.Printf("[ENTRY] tau=%ds bet_up=%t p_up=%.4f token_id=%s", tauSec, *updated.PendingBetUp, pUp, tokenID)
				fill, err := executor.MarketBuyMax(tokenID)
				if err != nil {
					log.Printf("[ENTRY] buy failed: %v", err)
				} else if fill != nil {
					updated.Position = &Position{
						TokenID:    tokenID,
						BetUp:      *updated.PendingBetUp,
						EntryTsMs:  nowMs,
						EntryPrice: fill.AvgPrice,
						Shares:     fill.Shares,
						CostUSDC:   fill.USDC,
						EntryO1h:   updated.O1h,
					}
					if !mt.cfg.AllowScaleIn {
						updated.TradedThisHour = true
					}
					updated.PendingBetUp = nil
					updated.PendingSinceMs = nil
				}
			}

			if updated.Position == nil && updated.PendingBetUp != nil && tauSec <= 1 {
				log.Printf("[ENTRY] pending expired tau=%ds bet_up=%t", tauSec, *updated.PendingBetUp)
				updated.PendingBetUp = nil
				updated.PendingSinceMs = nil
				updated.TradedThisHour = true
			}
		}
	} else if mt.cfg.AllowScaleIn && updated.Position != nil && !updated.TradedThisHour && betUpSignal != nil && updated.Position.BetUp == *betUpSignal {
		if market.MarketClosed != nil && *market.MarketClosed {
			log.Printf("[ENTRY] scale-in skip (market closed)")
			updated.TradedThisHour = true
		} else if market.EnableOrderbook != nil && !*market.EnableOrderbook {
			log.Printf("[ENTRY] scale-in skip (orderbook disabled)")
			updated.TradedThisHour = true
		} else {
			available, err := executor.ComputeBuyUSDC()
			if err != nil {
				log.Printf("[ENTRY] scale-in skip (balance check failed: %v)", err)
				updated.TradedThisHour = true
			} else if available < mt.cfg.TradeCfg.MinUSDC {
				log.Printf("[ENTRY] scale-in skip (amount=%.4f < min_usdc=%.4f)", available, mt.cfg.TradeCfg.MinUSDC)
				updated.TradedThisHour = true
			} else {
				tokenID := market.TokenIDDown
				if *betUpSignal {
					tokenID = market.TokenIDUp
				}
				log.Printf("[ENTRY] scale-in tau=%ds bet_up=%t p_up=%.4f token_id=%s", tauSec, *betUpSignal, pUp, tokenID)
				fill, err := executor.MarketBuyMax(tokenID)
				if err != nil {
					log.Printf("[ENTRY] scale-in buy failed: %v", err)
				} else if fill != nil {
					applyFillToPosition(updated.Position, fill)
				}
			}
		}
	}

	if updated.Position == nil {
		return updateRuntimeState(ctx, func(rs *RuntimeState) { *rs = *updated }), false
	}

	exitNow := false
	exitReason := ""
	if mt.cfg.Strategy.Mode == "pm" {
		if updated.Position.BetUp && pUp < mt.cfg.Strategy.ExitHigh {
			exitNow = true
			exitReason = "pm_exit"
		} else if !updated.Position.BetUp && pUp > mt.cfg.Strategy.ExitLow {
			exitNow = true
			exitReason = "pm_exit"
		}
	} else if pbad > mt.cfg.Strategy.Theta {
		exitNow = true
		exitReason = "pbad"
	}

	if !exitNow && mt.cfg.Strategy.ExitAtWindowEnd && tauSec <= mt.cfg.Strategy.ExitAtWindowEndSec {
		exitNow = true
		exitReason = "window_end"
	}

	if exitNow {
		if mt.cfg.AllowScaleIn {
			updated.TradedThisHour = true
			updated.PendingBetUp = nil
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
	log.Printf("[EXIT] reason=%s time=%s token_id=%s", reason, msToUTCStr(tMs), state.Position.TokenID)
	fill, err := executor.MarketSellAll(state.Position.TokenID)
	if err != nil {
		log.Printf("[EXIT] failed: %v", err)
		return
	}
	if fill != nil {
		state.Position = nil
	}
}

func (mt *ManagedTrader) expireLivePosition(ctx hersh.HershContext, state *RuntimeState, reason string, tMs int64) {
	if state.Position == nil {
		return
	}
	log.Printf("[HOLD] expiry reason=%s time=%s token_id=%s (no exit order)", reason, msToUTCStr(tMs), state.Position.TokenID)
	state.Position = nil
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

func cloneRuntimeState(state *RuntimeState) *RuntimeState {
	if state == nil {
		return &RuntimeState{O1hByHour: map[int64]float64{}, Last60Closes: make([]float64, 0, 61)}
	}
	clone := *state
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
	return &clone
}

func loadETLocation() *time.Location {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		return time.FixedZone("ET", -5*60*60)
	}
	return loc
}
