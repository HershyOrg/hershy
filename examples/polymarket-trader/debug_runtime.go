package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/HershyOrg/hersh"
	cctxdebug "github.com/HershyOrg/hershy/cctx/debug"
)

const (
	polymarketStrategyID = "polymarket-trader"
	polymarketVenueID    = "polymarket"
	debugRecorderMemoKey = "debug_recorder"
)

func defaultDebugEventsPath() string {
	if info, err := os.Stat("/state"); err == nil && info.IsDir() {
		return "/state/debug/timeline.json"
	}
	return "state/debug/timeline.json"
}

func (mt *ManagedTrader) getDebugRecorder(ctx hersh.HershContext) *cctxdebug.Recorder {
	value := hersh.Memo(func() any {
		recorder, err := cctxdebug.OpenRecorder(mt.cfg.DebugEventsPath, polymarketStrategyID, cctxdebug.WithDefaultVenue(polymarketVenueID))
		if err != nil {
			log.Printf("[DEBUG] recorder init failed path=%s: %v", mt.cfg.DebugEventsPath, err)
			return cctxdebug.NewNoopRecorder(polymarketStrategyID, cctxdebug.WithDefaultVenue(polymarketVenueID))
		}
		return recorder
	}, debugRecorderMemoKey, ctx)
	if recorder, ok := value.(*cctxdebug.Recorder); ok && recorder != nil {
		return recorder
	}
	return cctxdebug.NewNoopRecorder(polymarketStrategyID, cctxdebug.WithDefaultVenue(polymarketVenueID))
}

func ensureRunID(state *RuntimeState) {
	if state == nil || state.RunID != "" {
		return
	}
	state.RunID = fmt.Sprintf("run-%d", time.Now().UnixNano())
}

func nextDecisionID(state *RuntimeState) string {
	if state == nil {
		return ""
	}
	ensureRunID(state)
	state.NextDecisionSeq++
	return fmt.Sprintf("%s-d%06d", state.RunID, state.NextDecisionSeq)
}

func nextTradeID(state *RuntimeState) string {
	if state == nil {
		return ""
	}
	ensureRunID(state)
	state.NextTradeSeq++
	return fmt.Sprintf("%s-t%06d", state.RunID, state.NextTradeSeq)
}

func pendingTradeID(state *RuntimeState) string {
	if state == nil || state.PendingTradeID == nil {
		return ""
	}
	return *state.PendingTradeID
}

func positionTradeID(state *RuntimeState) string {
	if state == nil || state.Position == nil {
		return ""
	}
	return state.Position.TradeID
}

func activeTradeID(state *RuntimeState) string {
	if tradeID := positionTradeID(state); tradeID != "" {
		return tradeID
	}
	return pendingTradeID(state)
}

func (mt *ManagedTrader) emitDebugEvent(ctx hersh.HershContext, state *RuntimeState, market *MarketState, eventType cctxdebug.EventType, decisionID, tradeID, reasonCode, decision string, inputs, derived, outcome map[string]any, tMs int64) {
	recorder := mt.getDebugRecorder(ctx)
	if recorder == nil {
		return
	}

	var runID cctxdebug.RunID
	if state != nil {
		ensureRunID(state)
		runID = cctxdebug.RunID(state.RunID)
	}
	var tradeIDPtr *cctxdebug.TradeID
	if tradeID != "" {
		value := cctxdebug.TradeID(tradeID)
		tradeIDPtr = &value
	}
	var decisionIDPtr *cctxdebug.DecisionID
	if decisionID != "" {
		value := cctxdebug.DecisionID(decisionID)
		decisionIDPtr = &value
	}

	marketID := ""
	tags := map[string]string{}
	if market != nil {
		marketID = market.MarketID
		if market.MarketSlug != "" {
			tags["market_slug"] = market.MarketSlug
		}
	}
	if len(tags) == 0 {
		tags = nil
	}

	_ = recorder.Emit(eventType, cctxdebug.EmitParams{
		RunID:      runID,
		TradeID:    tradeIDPtr,
		DecisionID: decisionIDPtr,
		TsMs:       tMs,
		MarketID:   marketID,
		ReasonCode: reasonCode,
		Decision:   decision,
		Inputs:     inputs,
		Derived:    derived,
		Outcome:    outcome,
		Tags:       tags,
	})
}
