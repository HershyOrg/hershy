package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hershy/cctx/exchanges"
)

const (
	defaultModelPath = "backtest/bots/polymarket_tools/out/prob_model_logit_all.json"
	defaultClobHost  = "https://clob.polymarket.com"
)

func main() {
	args := parseArgs()

	tradeCfg := TradeConfig{
		MaxUSDC:     args.maxUSDC,
		MinUSDC:     args.minUSDC,
		ReserveUSDC: args.reserveUSDC,
		MinShares:   args.minShares,
		OrderType:   args.orderType,
		DryRun:      args.dryRun,
	}
	strategy := StrategyConfig{
		Mode:               args.mode,
		EntryHigh:          args.entryHigh,
		EntryLow:           args.entryLow,
		ExitHigh:           args.exitHigh,
		ExitLow:            args.exitLow,
		Theta:              args.theta,
		WindowSec:          args.windowSec,
		ExitAtWindowEnd:    args.exitAtWindowEnd,
		ExitAtWindowEndSec: args.exitAtWindowEndSec,
	}

	var paperCfg *PaperConfig
	if args.paper {
		cfg := PaperConfig{StartUSDC: args.paperUSDC, HoldToExpiry: args.paperHoldToExpiry, LedgerPath: args.paperLedger}
		paperCfg = &cfg
	}
	executorBuilder := func() (TradeExecutor, error) {
		if args.paper {
			return NewPaperExecutor(tradeCfg, *paperCfg, args.clobHost), nil
		}
		client, err := buildPolymarketClient(args)
		if err != nil {
			return nil, err
		}
		return NewLiveExecutor(client, tradeCfg, args.clobHost), nil
	}

	stopAtMs, err := parseStopAt(args.stopAtET)
	if err != nil {
		log.Fatalf("[BOOT] %v", err)
	}

	traderCfg := TraderConfig{
		Strategy:            strategy,
		TradeCfg:            tradeCfg,
		PaperCfg:            paperCfg,
		AllowScaleIn:        args.allowScaleIn,
		SignalsOnly:         args.signalsOnly,
		StopExit:            args.stopExit,
		StopAtMs:            stopAtMs,
		RunFor:              time.Duration(args.runForSec) * time.Second,
		LogEverySec:         args.logEverySec,
		RegimeEps:           args.regimeEps,
		SignalLogPath:       args.signalLog,
		SignalLogFlushEvery: args.signalLogFlushEvery,
		LogOrderbookGap:     args.logOrderbookGap,
		AutoSlug:            args.autoSlug,
		Slug:                args.slug,
		SlugPrefix:          args.slugPrefix,
		SearchHours:         args.searchHours,
		SearchStepHours:     args.searchStepHours,
		AutoRefreshSec:      args.autoRefreshSec,
		TokenIDUp:           args.tokenIDUp,
		TokenIDDown:         args.tokenIDDown,
		ClobHost:            args.clobHost,
		ModelPath:           args.modelPath,
		WSURL:               args.wsURL,
	}

	config := hersh.DefaultWatcherConfig()
	config.ServerPort = 8080
	config.DefaultTimeout = 5 * time.Minute
	watcher := hersh.NewWatcher(config, map[string]string{"DEMO_NAME": "PolymarketTrader"}, context.Background())

	log.Printf("[BOOT] model=%s slug=%s", args.modelPath, args.slug)
	log.Printf("[BOOT] mode=%s entry=%.2f/%.2f exit=%.2f/%.2f theta=%.2f exit_at_window_end=%t exit_at_window_end_sec=%d", strategy.Mode, strategy.EntryHigh, strategy.EntryLow, strategy.ExitHigh, strategy.ExitLow, strategy.Theta, strategy.ExitAtWindowEnd, strategy.ExitAtWindowEndSec)
	if stopAtMs != nil {
		log.Printf("[BOOT] stop_at_et=%s stop_exit=%t", msToETStr(*stopAtMs, loadETLocation()), args.stopExit)
	}
	if args.signalsOnly {
		log.Printf("[BOOT] signals_only=true (no trades)")
	}
	if args.runForSec > 0 {
		log.Printf("[BOOT] run_for_sec=%d", args.runForSec)
	}
	if args.paper {
		log.Printf("[BOOT] paper start_usdc=%.2f hold_to_expiry=%t", args.paperUSDC, args.paperHoldToExpiry)
	}

	managed := NewManagedTrader(traderCfg, executorBuilder)
	watcher.Manage(func(msg *hersh.Message, hctx hersh.HershContext) error {
		return managed.Run(msg, hctx)
	}, "PolymarketTrader").Cleanup(func(ctx hersh.HershContext) {
		if value := hersh.Memo(func() any { return nil }, "kline_stream", ctx); value != nil {
			if stream, ok := value.(*BinanceKlineStream); ok && stream != nil {
				stream.Stop()
			}
		}
		if value := hersh.Memo(func() any { return nil }, "signal_log", ctx); value != nil {
			if fh, ok := value.(*os.File); ok && fh != nil {
				_ = fh.Sync()
				_ = fh.Close()
			}
		}
	})

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		watcher.Stop()
	}()

	if err := watcher.Start(); err != nil {
		log.Fatalf("[BOOT] %v", err)
	}
}

// command-line parsing

type cliArgs struct {
	slug                string
	slugPrefix          string
	autoSlug            bool
	autoSlugSet         bool
	searchHours         int
	searchStepHours     int
	autoRefreshSec      int
	tokenIDUp           string
	tokenIDDown         string
	modelPath           string
	mode                string
	entryHigh           float64
	entryLow            float64
	exitHigh            float64
	exitLow             float64
	theta               float64
	windowSec           int
	logEverySec         int
	regimeEps           float64
	signalLog           string
	signalLogFlushEvery int
	logOrderbookGap     bool
	maxUSDC             *float64
	minUSDC             float64
	reserveUSDC         float64
	minShares           float64
	orderType           string
	dryRun              bool
	allowScaleIn        bool
	paper               bool
	paperUSDC           float64
	paperLedger         string
	paperHoldToExpiry   bool
	privateKey          string
	funder              string
	envPrefix           string
	apiKey              string
	apiSecret           string
	apiPassphrase       string
	clobHost            string
	chainID             int
	wsURL               string
	exitAtWindowEnd     bool
	exitAtWindowEndSec  int
	stopAtET            string
	stopExit            bool
	signalsOnly         bool
	runForSec           int
}

func parseArgs() cliArgs {
	var args cliArgs
	flag.StringVar(&args.slug, "slug", "", "Polymarket slug")
	flag.StringVar(&args.slugPrefix, "slug-prefix", "", "Polymarket slug prefix")
	autoSlug := flag.Bool("auto-slug", false, "Enable auto-slug resolution")
	noAutoSlug := flag.Bool("no-auto-slug", false, "Disable auto-slug resolution")
	flag.IntVar(&args.searchHours, "search-hours", 12, "Search hours for auto-slug")
	flag.IntVar(&args.searchStepHours, "search-step-hours", 1, "Step hours for auto-slug search")
	flag.IntVar(&args.autoRefreshSec, "auto-refresh-sec", 300, "Auto-refresh market every N seconds")
	flag.StringVar(&args.tokenIDUp, "token-id-up", "", "Up/Yes token ID")
	flag.StringVar(&args.tokenIDDown, "token-id-down", "", "Down/No token ID")
	flag.StringVar(&args.modelPath, "model-path", defaultModelPath, "Path to prob model JSON")
	flag.StringVar(&args.mode, "mode", "pbad", "Trading mode: pm or pbad")
	flag.Float64Var(&args.entryHigh, "entry-high", 0.96, "Entry high threshold")
	flag.Float64Var(&args.entryLow, "entry-low", 0.04, "Entry low threshold")
	flag.Float64Var(&args.exitHigh, "exit-high", 0.70, "Exit high threshold")
	flag.Float64Var(&args.exitLow, "exit-low", 0.30, "Exit low threshold")
	flag.Float64Var(&args.theta, "theta", 0.5, "Pbad exit threshold")
	flag.IntVar(&args.windowSec, "window-sec", 240, "Trading window seconds")
	flag.IntVar(&args.logEverySec, "log-every-sec", 5, "Signal log frequency in seconds")
	flag.Float64Var(&args.regimeEps, "regime-eps", 0.0002, "Regime epsilon")
	flag.StringVar(&args.signalLog, "signal-log", "", "Signal log path")
	flag.IntVar(&args.signalLogFlushEvery, "signal-log-flush-every", 10, "Signal log flush interval")
	flag.BoolVar(&args.logOrderbookGap, "log-orderbook-gap", false, "Log orderbook gap")
	maxUSDC := flag.Float64("max-usdc", -1, "Max USDC to use per trade")
	flag.Float64Var(&args.minUSDC, "min-usdc", 1.0, "Min USDC to trade")
	flag.Float64Var(&args.reserveUSDC, "reserve-usdc", 0.0, "Reserve USDC to keep")
	flag.Float64Var(&args.minShares, "min-shares", 0.01, "Min shares to sell")
	flag.StringVar(&args.orderType, "order-type", "FAK", "Order type: FOK or FAK")
	flag.BoolVar(&args.dryRun, "dry-run", false, "Dry-run orders")
	flag.BoolVar(&args.allowScaleIn, "allow-scale-in", false, "Allow scale-in")
	flag.BoolVar(&args.paper, "paper", false, "Paper trade mode")
	flag.Float64Var(&args.paperUSDC, "paper-usdc", 1000.0, "Paper trading starting USDC")
	flag.StringVar(&args.paperLedger, "paper-ledger", "", "Paper ledger output path")
	paperHoldToExpiry := flag.Bool("paper-hold-to-expiry", true, "Hold paper positions to expiry")
	noPaperHold := flag.Bool("no-paper-hold-to-expiry", false, "Disable paper hold to expiry")
	flag.StringVar(&args.privateKey, "private-key", "", "Polymarket private key")
	flag.StringVar(&args.funder, "funder", "", "Polymarket funder")
	flag.StringVar(&args.envPrefix, "env-prefix", "POLY", "Env var prefix for secrets")
	flag.StringVar(&args.apiKey, "api-key", "", "Polymarket API key")
	flag.StringVar(&args.apiSecret, "api-secret", "", "Polymarket API secret")
	flag.StringVar(&args.apiPassphrase, "api-passphrase", "", "Polymarket API passphrase")
	flag.StringVar(&args.clobHost, "clob-host", defaultClobHost, "CLOB host")
	flag.IntVar(&args.chainID, "chain-id", 137, "Chain ID")
	flag.StringVar(&args.wsURL, "ws-url", binanceWSURL, "Binance WS URL (unused)")
	exitAtWindowEnd := flag.Bool("exit-at-window-end", true, "Exit at window end")
	noExitAtWindowEnd := flag.Bool("no-exit-at-window-end", false, "Disable exit at window end")
	flag.IntVar(&args.exitAtWindowEndSec, "exit-at-window-end-sec", 2, "Exit this many seconds before the window ends")
	flag.StringVar(&args.stopAtET, "stop-at-et", "", "Stop new entries after ET time")
	flag.BoolVar(&args.stopExit, "stop-exit", false, "Exit open position at stop time")
	flag.BoolVar(&args.signalsOnly, "signals-only", false, "Log signals only")
	flag.IntVar(&args.runForSec, "run-for-sec", 0, "Stop after N seconds")

	flag.Parse()

	args.autoSlugSet = *autoSlug || *noAutoSlug
	if *autoSlug {
		args.autoSlug = true
	} else if *noAutoSlug {
		args.autoSlug = false
	} else {
		args.autoSlug = false
	}
	if !args.autoSlugSet {
		if args.slugPrefix != "" {
			args.autoSlug = true
		} else if inferSlugPrefix(normalizeSlug(args.slug)) != "" {
			args.autoSlug = true
		}
	}
	if *noExitAtWindowEnd {
		args.exitAtWindowEnd = false
	} else {
		args.exitAtWindowEnd = *exitAtWindowEnd
	}
	if args.exitAtWindowEndSec < 1 {
		args.exitAtWindowEndSec = 1
	}
	if *noPaperHold {
		args.paperHoldToExpiry = false
	} else {
		args.paperHoldToExpiry = *paperHoldToExpiry
	}
	if *maxUSDC >= 0 {
		args.maxUSDC = maxUSDC
	}
	args.orderType = strings.ToUpper(args.orderType)
	if args.orderType != "FOK" && args.orderType != "FAK" {
		log.Fatalf("order_type must be FOK or FAK")
	}
	if args.mode != "pm" && args.mode != "pbad" {
		log.Fatalf("mode must be pm or pbad")
	}
	return args
}

func buildPolymarketClient(args cliArgs) (*exchanges.Polymarket, error) {
	privateKey, err := resolveSecret(args.privateKey, "PRIVATE_KEY", "private-key", args.envPrefix)
	if err != nil {
		return nil, err
	}
	funder, err := resolveSecret(args.funder, "FUNDER", "funder", args.envPrefix)
	if err != nil {
		return nil, err
	}
	apiKey := resolveOptionalSecret(args.apiKey, "API_KEY", args.envPrefix)
	apiSecret := resolveOptionalSecret(args.apiSecret, "API_SECRET", args.envPrefix)
	apiPassphrase := resolveOptionalSecret(args.apiPassphrase, "API_PASSPHRASE", args.envPrefix)
	cfg := map[string]any{
		"private_key":    privateKey,
		"funder":         funder,
		"api_key":        apiKey,
		"api_secret":     apiSecret,
		"api_passphrase": apiPassphrase,
		"chain_id":       args.chainID,
	}
	ex, err := exchanges.NewPolymarket(cfg)
	if err != nil {
		return nil, err
	}
	client, ok := ex.(*exchanges.Polymarket)
	if !ok {
		return nil, fmt.Errorf("unexpected exchange type")
	}
	return client, nil
}

func resolveSecret(value, baseKey, argName, envPrefix string) (string, error) {
	if value != "" {
		return value, nil
	}
	envKey := envKey(baseKey, envPrefix)
	if v := os.Getenv(envKey); v != "" {
		return v, nil
	}
	return "", fmt.Errorf("missing %s. Provide --%s or set env var", envKey, argName)
}

func resolveOptionalSecret(value, baseKey, envPrefix string) string {
	if value != "" {
		return value
	}
	return os.Getenv(envKey(baseKey, envPrefix))
}

func envKey(baseKey, envPrefix string) string {
	prefix := strings.TrimSpace(envPrefix)
	if prefix == "" {
		return baseKey
	}
	return prefix + "_" + baseKey
}

func parseStopAt(value string) (*int64, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	text := strings.TrimSpace(value)
	if strings.HasSuffix(text, "Z") {
		text = strings.TrimSuffix(text, "Z") + "+00:00"
	}
	var parsed time.Time
	var err error
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		parsed, err = time.Parse(layout, text)
		if err == nil {
			break
		}
	}
	if err != nil {
		loc, locErr := time.LoadLocation("America/New_York")
		if locErr != nil {
			loc = time.FixedZone("ET", -5*60*60)
		}
		for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02T15:04:05", "2006-01-02T15:04"} {
			parsed, err = time.ParseInLocation(layout, text, loc)
			if err == nil {
				break
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("invalid --stop-at-et format. Use YYYY-MM-DD HH:MM[:SS] or ISO format")
	}
	ms := parsed.UTC().UnixMilli()
	return &ms, nil
}
