package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/hutil"
)

const coreDCAStateKey = "core_etf_dca_state"

type DCARule struct {
	Asset      string
	Symbol     string
	Weight     float64
	Executable bool
}

type DCAAllocation struct {
	Asset      string
	Symbol     string
	Weight     float64
	Notional   float64
	Executable bool
}

type DCAPlan struct {
	Budget           float64
	GeneratedAt      time.Time
	Allocations      []DCAAllocation
	ExecutableBudget float64
	ReserveBudget    float64
}

type DCAOrder struct {
	Asset      string
	Symbol     string
	Exchange   string
	Side       string
	Notional   float64
	Weight     float64
	ExecutedAt time.Time
}

type DCAExecution struct {
	Sequence   int
	TickCount  int
	ExecutedAt time.Time
	Plan       DCAPlan
	Orders     []DCAOrder
	Note       string
}

type CoreETFDCAState struct {
	ExecutionCount int
	ReserveBalance float64
	LastExecution  DCAExecution
	HasExecution   bool
	Log            []DCAExecution
}

type CoreETFDCAConfig struct {
	MonthlyBudget           float64
	Exchange                string
	SimulatedMonth          time.Duration
	AutoStopAfterExecutions int
	AllocationRules         []DCARule
}

func DefaultCoreETFDCAConfig() CoreETFDCAConfig {
	return CoreETFDCAConfig{
		MonthlyBudget:           500,
		Exchange:                "Binance",
		SimulatedMonth:          2 * time.Second,
		AutoStopAfterExecutions: 3,
		AllocationRules: []DCARule{
			{Asset: "BTC", Symbol: "BTC/USDT", Weight: 55, Executable: true},
			{Asset: "ETH", Symbol: "ETH/USDT", Weight: 25, Executable: true},
			{Asset: "SOL", Symbol: "SOL/USDT", Weight: 10, Executable: true},
			{Asset: "LINK", Symbol: "LINK/USDT", Weight: 3, Executable: false},
			{Asset: "AAVE", Symbol: "AAVE/USDT", Weight: 2, Executable: false},
			{Asset: "Cash", Symbol: "USDT", Weight: 5, Executable: false},
		},
	}
}

func allocateDCA(amount float64, rules []DCARule, now time.Time) DCAPlan {
	plan := DCAPlan{
		Budget:      amount,
		GeneratedAt: now,
		Allocations: make([]DCAAllocation, 0, len(rules)),
	}

	for _, rule := range rules {
		notional := amount * (rule.Weight / 100)
		allocation := DCAAllocation{
			Asset:      rule.Asset,
			Symbol:     rule.Symbol,
			Weight:     rule.Weight,
			Notional:   notional,
			Executable: rule.Executable,
		}
		plan.Allocations = append(plan.Allocations, allocation)
		if rule.Executable {
			plan.ExecutableBudget += notional
		} else {
			plan.ReserveBudget += notional
		}
	}

	return plan
}

func buildDCAOrders(plan DCAPlan, exchange string, now time.Time) []DCAOrder {
	orders := make([]DCAOrder, 0, len(plan.Allocations))
	for _, allocation := range plan.Allocations {
		if !allocation.Executable {
			continue
		}
		orders = append(orders, DCAOrder{
			Asset:      allocation.Asset,
			Symbol:     allocation.Symbol,
			Exchange:   exchange,
			Side:       "BUY",
			Notional:   allocation.Notional,
			Weight:     allocation.Weight,
			ExecutedAt: now,
		})
	}
	return orders
}

func getCoreDCAState(ctx hersh.HershContext) CoreETFDCAState {
	val := ctx.GetValue(coreDCAStateKey)
	if val == nil {
		return CoreETFDCAState{}
	}
	state, ok := val.(CoreETFDCAState)
	if !ok {
		return CoreETFDCAState{}
	}
	return state
}

func executeCoreDCA(state CoreETFDCAState, cfg CoreETFDCAConfig, tickCount int, now time.Time, ctx hersh.HershContext) CoreETFDCAState {
	plan := allocateDCA(cfg.MonthlyBudget, cfg.AllocationRules, now)
	orders := buildDCAOrders(plan, cfg.Exchange, now)

	execution := DCAExecution{
		Sequence:   state.ExecutionCount + 1,
		TickCount:  tickCount,
		ExecutedAt: now,
		Plan:       plan,
		Orders:     orders,
	}

	if plan.ReserveBudget > 0 {
		execution.Note = fmt.Sprintf(
			"LINK/AAVE/Cash %.0f%%는 액션 노드가 없어 이번 데모에선 현금성 리저브로 남깁니다 ($%.2f)",
			100-(plan.ExecutableBudget/cfg.MonthlyBudget*100),
			plan.ReserveBudget,
		)
	}

	hersh.PrintWithLog(
		fmt.Sprintf(
			"[DCA #%d] monthly budget $%.2f distributed at %s",
			execution.Sequence,
			cfg.MonthlyBudget,
			now.Format(time.RFC3339),
		),
		ctx,
	)
	for _, order := range orders {
		hersh.PrintWithLog(
			fmt.Sprintf(
				"  BUY %s via %s market order: $%.2f (%.0f%%)",
				order.Symbol,
				order.Exchange,
				order.Notional,
				order.Weight,
			),
			ctx,
		)
	}
	if execution.Note != "" {
		hersh.PrintWithLog("  "+execution.Note, ctx)
	}

	state.ExecutionCount++
	state.ReserveBalance += plan.ReserveBudget
	state.LastExecution = execution
	state.HasExecution = true
	state.Log = append(state.Log, execution)
	return state
}

func printCoreDCAStatus(state CoreETFDCAState, cfg CoreETFDCAConfig, ctx hersh.HershContext) {
	hersh.PrintWithLog(
		fmt.Sprintf(
			"[STATUS] Core ETF DCA budget=$%.2f cadence=%s executions=%d reserve=$%.2f",
			cfg.MonthlyBudget,
			cfg.SimulatedMonth,
			state.ExecutionCount,
			state.ReserveBalance,
		),
		ctx,
	)
	if !state.HasExecution {
		hersh.PrintWithLog("  no DCA execution yet", ctx)
		return
	}

	last := state.LastExecution
	hersh.PrintWithLog(
		fmt.Sprintf(
			"  last execution #%d at %s",
			last.Sequence,
			last.ExecutedAt.Format(time.RFC3339),
		),
		ctx,
	)
	for _, order := range last.Orders {
		hersh.PrintWithLog(
			fmt.Sprintf("  %s $%.2f", order.Symbol, order.Notional),
			ctx,
		)
	}
	if last.Note != "" {
		hersh.PrintWithLog("  "+last.Note, ctx)
	}
}

func runCoreETFDCA(msg *hersh.Message, ctx hersh.HershContext, cfg CoreETFDCAConfig) error {
	state := getCoreDCAState(ctx)

	if msg != nil {
		switch strings.ToLower(strings.TrimSpace(msg.Content)) {
		case "status":
			printCoreDCAStatus(state, cfg, ctx)
		case "stop":
			return hersh.NewStopErr("core ETF DCA stop requested")
		}
	}

	tick := hutil.WatchTick("core_etf_monthly_dca", cfg.SimulatedMonth, ctx)
	if tick.IsTriggered(ctx) && !tick.IsZero() {
		state = executeCoreDCA(state, cfg, tick.TickCount, tick.Time, ctx)
		ctx.SetValue(coreDCAStateKey, state)

		if cfg.AutoStopAfterExecutions > 0 && state.ExecutionCount >= cfg.AutoStopAfterExecutions {
			return hersh.NewStopErr("core ETF DCA demo finished")
		}
		return nil
	}

	if ctx.GetValue(coreDCAStateKey) == nil {
		ctx.SetValue(coreDCAStateKey, state)
	}
	return nil
}
