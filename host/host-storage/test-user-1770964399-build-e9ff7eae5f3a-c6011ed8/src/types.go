package main

import "time"

type StrategyConfig struct {
	Mode               string
	EntryHigh          float64
	EntryLow           float64
	ExitHigh           float64
	ExitLow            float64
	Theta              float64
	WindowSec          int
	ExitAtWindowEnd    bool
	ExitAtWindowEndSec int
}

type TradeConfig struct {
	MaxUSDC     *float64
	MinUSDC     float64
	ReserveUSDC float64
	MinShares   float64
	OrderType   string
	DryRun      bool
}

type PaperConfig struct {
	StartUSDC    float64
	HoldToExpiry bool
	LedgerPath   string
}

type FillResult struct {
	USDC       float64
	Shares     float64
	AvgPrice   *float64
	Partial    bool
	WorstPrice float64
}

type Position struct {
	TokenID    string
	BetUp      bool
	EntryTsMs  int64
	EntryPrice *float64
	Shares     float64
	CostUSDC   float64
	EntryO1h   *float64
}

type TradeState struct {
	Position       *Position
	TradedThisHour bool
	PendingBetUp   *bool
	PendingSinceMs *int64
}

type MarketTokens struct {
	YesTokenID      string
	NoTokenID       string
	Outcomes        []string
	ClobTokenIDs    []string
	MarketID        string
	Slug            string
	EnableOrderbook *bool
	Closed          *bool
	Active          *bool
	StartDate       string
	EndDate         string
}

type KlineEvent struct {
	Interval    string
	StartTimeMs int64
	Open        float64
	Close       float64
	Volume      float64
}

type TraderConfig struct {
	Strategy            StrategyConfig
	TradeCfg            TradeConfig
	PaperCfg            *PaperConfig
	AllowScaleIn        bool
	SignalsOnly         bool
	StopExit            bool
	StopAtMs            *int64
	RunFor              time.Duration
	LogEverySec         int
	RegimeEps           float64
	SignalLogPath       string
	SignalLogFlushEvery int
	LogOrderbookGap     bool
	AutoSlug            bool
	Slug                string
	SlugPrefix          string
	SearchHours         int
	SearchStepHours     int
	AutoRefreshSec      int
	TokenIDUp           string
	TokenIDDown         string
	ClobHost            string
	ModelPath           string
	WSURL               string
}

type RuntimeState struct {
	TradeState
	O1hByHour     map[int64]float64
	CurHour       int64
	O1h           *float64
	CumVol        float64
	Last60Closes  []float64
	LastLogMs     int64
	LastPrice     float64
	LastPriceTsMs int64
	StopLogged    bool
	SignalLogLines int
	Paused        bool
	StartTimeMs   int64
}

type MarketState struct {
	TokenIDUp       string
	TokenIDDown     string
	MarketSlug      string
	EnableOrderbook *bool
	MarketClosed    *bool
}
