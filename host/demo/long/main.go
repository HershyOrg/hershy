package main

import (
	"bufio"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"hersh"
)

const (
	// Demo configuration
	DemoName          = "Long-Running Trading Simulator"
	DemoVersion       = "1.0.0"
	TargetDuration    = 4*time.Hour + 30*time.Minute // 4.5 hours
	StatsInterval     = 1 * time.Minute
	RebalanceInterval = 1 * time.Hour
	InitialCapital    = 10000.0 // $10,000 USD
)

func main() {
	fmt.Println(strings.Repeat("═", 80))
	fmt.Printf("🚀 %s v%s\n", DemoName, DemoVersion)
	fmt.Println(strings.Repeat("═", 80))
	fmt.Printf("⏱️  Target Duration: %s\n", TargetDuration)
	fmt.Printf("📊 Stats Interval: %s\n", StatsInterval)
	fmt.Printf("💼 Initial Capital: $%.2f\n", InitialCapital)
	fmt.Println(strings.Repeat("═", 80))

	// Initialize components
	fmt.Println("\n🔧 Initializing components...")

	stream := NewBinanceStream()
	fmt.Println("   ✅ BinanceStream created")

	simulator := NewTradingSimulator(InitialCapital)
	fmt.Println("   ✅ TradingSimulator created")

	statsCollector := NewStatsCollector()
	fmt.Println("   ✅ StatsCollector created")

	commandHandler := NewCommandHandler(stream, simulator, statsCollector)
	fmt.Println("   ✅ CommandHandler created")

	// Connect to Binance WebSocket
	fmt.Println("\n🌐 Connecting to Binance WebSocket...")
	if err := stream.Connect(); err != nil {
		fmt.Printf("❌ Failed to connect: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("   ✅ Connected to wss://stream.binance.com:9443")

	// Wait for initial prices
	fmt.Println("\n⏳ Waiting for initial price data...")
	for i := 0; i < 30; i++ {
		if stream.GetCurrentBTC() > 0 && stream.GetCurrentETH() > 0 {
			fmt.Printf("   ✅ Initial prices received: BTC=$%.2f, ETH=$%.2f\n",
				stream.GetCurrentBTC(), stream.GetCurrentETH())
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if stream.GetCurrentBTC() == 0 || stream.GetCurrentETH() == 0 {
		fmt.Println("   ⚠️  Initial prices not received, continuing anyway...")
	}

	// Create timer channels for WatchFlow
	statsTickerChan := make(chan any, 10)
	rebalanceTickerChan := make(chan any, 10)

	// Start stats ticker (1 minute interval)
	go func() {
		// Send initial value immediately for Init completion
		statsTickerChan <- time.Now()

		ticker := time.NewTicker(StatsInterval)
		defer ticker.Stop()
		for range ticker.C {
			select {
			case statsTickerChan <- time.Now():
			default:
			}
		}
	}()

	// Start rebalance ticker (1 hour interval)
	go func() {
		// Send initial value immediately for Init completion
		rebalanceTickerChan <- time.Now()

		ticker := time.NewTicker(RebalanceInterval)
		defer ticker.Stop()
		for range ticker.C {
			select {
			case rebalanceTickerChan <- time.Now():
			default:
			}
		}
	}()

	// Create Watcher
	fmt.Println("\n🔍 Creating Hersh Watcher...")
	config := hersh.DefaultWatcherConfig()
	config.DefaultTimeout = 10 * time.Minute
	config.RecoveryPolicy.MinConsecutiveFailures = 5
	config.RecoveryPolicy.MaxConsecutiveFailures = 10
	config.RecoveryPolicy.BaseRetryDelay = 10 * time.Second
	config.RecoveryPolicy.MaxRetryDelay = 5 * time.Minute
	config.RecoveryPolicy.LightweightRetryDelays = []time.Duration{
		30 * time.Second,
		1 * time.Minute,
		2 * time.Minute,
	}

	envVars := map[string]string{
		"DEMO_NAME":    DemoName,
		"DEMO_VERSION": DemoVersion,
	}

	watcher := hersh.NewWatcher(config, envVars)
	fmt.Println("   ✅ Watcher created with long-running config")

	// Register managed function with closure
	watcher.Manage(func(msg *hersh.Message, ctx hersh.HershContext) error {
		return mainReducer(
			msg, ctx,
			stream,
			simulator,
			statsCollector,
			commandHandler,
			statsTickerChan,
			rebalanceTickerChan,
		)
	}, "TradingSimulator").Cleanup(func(ctx hersh.HershContext) {
		cleanup(ctx, stream, simulator, statsCollector)
	})

	// Setup signal handling BEFORE starting Watcher
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Start Watcher in goroutine to allow Ctrl+C during Init
	fmt.Println("\n▶️  Starting main trading loop...")
	fmt.Println("   Type 'help' for available commands")
	fmt.Println("   Press Ctrl+C to stop")
	fmt.Println()

	startErrChan := make(chan error, 1)
	go func() {
		if err := watcher.Start(); err != nil {
			startErrChan <- err
		}
	}()

	// Wait for either Watcher start error or user interrupt
	select {
	case err := <-startErrChan:
		fmt.Printf("\n❌ Watcher failed to start: %v\n", err)
		os.Exit(1)
	case <-sigChan:
		fmt.Println("\n\n🛑 Interrupt received during startup, shutting down...")
		watcher.Stop()
		os.Exit(0)
	case <-time.After(100 * time.Millisecond):
		// Watcher started successfully, continue to main loop
	}

	// Start user input handler (only if stdin is available)
	go func() {
		stat, _ := os.Stdin.Stat()
		if (stat.Mode() & os.ModeCharDevice) != 0 {
			handleUserInput(watcher)
		}
	}()

	// Wait for shutdown signal
	<-sigChan

	// Graceful shutdown
	fmt.Println("\n\n🛑 Shutting down...")

	// Print logger summary
	fmt.Println("\n" + strings.Repeat("═", 80))
	fmt.Println("📋 EXECUTION LOGS")
	fmt.Println(strings.Repeat("═", 80))
	watcher.GetLogger().PrintSummary()

	fmt.Println("\n   Stopping Watcher...")
	watcher.Stop()

	fmt.Println("\n✅ Demo completed successfully")
	fmt.Println(strings.Repeat("═", 80))
}

// mainReducer is the main managed function for the Watcher
func mainReducer(
	msg *hersh.Message,
	ctx hersh.HershContext,
	stream *BinanceStream,
	simulator *TradingSimulator,
	statsCollector *StatsCollector,
	commandHandler *CommandHandler,
	statsTickerChan <-chan any,
	rebalanceTickerChan <-chan any,
) error {
	// Initialize start time on first run
	if ctx.GetValue("start_time") == nil {
		ctx.SetValue("start_time", time.Now())
	}
	startTime := ctx.GetValue("start_time").(time.Time)

	// Check if target duration reached
	elapsed := time.Since(startTime)
	if elapsed >= TargetDuration {
		if ctx.GetValue("target_reached") == nil {
			fmt.Printf("\n🎯 Target duration reached: %s\n", TargetDuration)
			fmt.Println("   Demo will continue until you press Ctrl+C")
			ctx.SetValue("target_reached", true)
		}
	}

	// WatchFlow: BTC price (real-time from WebSocket)
	btcPrice := hersh.WatchFlow(stream.GetBTCPriceChan(), "btc_price", ctx)
	if btcPrice != nil {
		simulator.UpdatePrice("BTC", btcPrice.(float64))
	}

	// WatchFlow: ETH price (real-time from WebSocket)
	ethPrice := hersh.WatchFlow(stream.GetETHPriceChan(), "eth_price", ctx)
	if ethPrice != nil {
		simulator.UpdatePrice("ETH", ethPrice.(float64))
	}

	// WatchFlow: Stats ticker (1 minute interval)
	statsTick := hersh.WatchFlow(statsTickerChan, "stats_ticker", ctx)
	if statsTick != nil {
		tickTime := statsTick.(time.Time)
		lastStats := ctx.GetValue("last_stats")

		// Only print stats if this is a new tick (not the same timestamp)
		shouldPrintStats := false
		if lastStats == nil {
			shouldPrintStats = true
		} else {
			lastTime := lastStats.(time.Time)
			if !tickTime.Equal(lastTime) {
				shouldPrintStats = true
			}
		}

		if shouldPrintStats {
			ctx.SetValue("last_stats", tickTime)
			statsCollector.PrintStats(stream, simulator)
		}
	}

	// WatchFlow: Rebalance ticker (1 hour interval)
	rebalanceTick := hersh.WatchFlow(rebalanceTickerChan, "rebalance_ticker", ctx)
	if rebalanceTick != nil {
		tickTime := rebalanceTick.(time.Time)
		lastRebalance := ctx.GetValue("last_rebalance")

		// Only rebalance if this is a new tick (not the same timestamp)
		shouldRebalance := false
		if lastRebalance == nil {
			shouldRebalance = true
		} else {
			lastTime := lastRebalance.(time.Time)
			if !tickTime.Equal(lastTime) {
				shouldRebalance = true
			}
		}

		if shouldRebalance {
			ctx.SetValue("last_rebalance", tickTime)
			fmt.Println("\n⏰ Hourly rebalance triggered...")
			trades := simulator.Rebalance()

			if len(trades) > 0 {
				fmt.Printf("   Executed %d rebalancing trades\n", len(trades))
				for _, t := range trades {
					fmt.Printf("      %s %s: %.6f @ $%.2f\n",
						t.Action, t.Symbol, t.Amount, t.Price)
				}
			} else {
				fmt.Println("   No rebalancing needed")
			}
		}
	}

	// Execute trading strategy (unless paused)
	if !simulator.IsPaused() {
		trades := simulator.ExecuteStrategy()

		if len(trades) > 0 {
			fmt.Printf("\n💹 Strategy executed %d trades:\n", len(trades))
			for _, t := range trades {
				fmt.Printf("   %s %s %s: %.6f @ $%.2f (%s)\n",
					t.Time.Format("15:04:05"),
					t.Action, t.Symbol, t.Amount, t.Price, t.Reason)
			}

			portfolio := simulator.GetPortfolio()
			fmt.Printf("   Portfolio Value: $%.2f (%.2f%%)\n",
				portfolio.CurrentValue, portfolio.ProfitLossPercent)
		}
	}

	// Handle user messages (commands)
	if msg != nil && msg.Content != "" {
		commandHandler.HandleCommand(msg.Content)
	}

	return nil
}

// cleanup is called when the Watcher stops
func cleanup(
	ctx hersh.HershContext,
	stream *BinanceStream,
	simulator *TradingSimulator,
	statsCollector *StatsCollector,
) {
	fmt.Println("\n🔧 Cleanup started...")

	// Close WebSocket
	fmt.Println("   Closing WebSocket...")
	stream.Close()

	// Print final statistics
	fmt.Println("\n📊 Final Statistics:")
	statsCollector.PrintDetailedStats(stream, simulator)

	fmt.Println("\n✅ Cleanup complete")
}

// handleUserInput reads user input and sends to Watcher
func handleUserInput(w *hersh.Watcher) {
	scanner := bufio.NewScanner(os.Stdin)

	for scanner.Scan() {
		input := scanner.Text()
		if input == "" {
			continue
		}

		// Send command to Watcher
		if err := w.SendMessage(input); err != nil {
			fmt.Printf("⚠️  Failed to send command: %v\n", err)
		}
	}

	if err := scanner.Err(); err != nil {
		fmt.Printf("⚠️  Input error: %v\n", err)
	}
}
