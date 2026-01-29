package main

import (
	"fmt"
	"strings"
	"time"

	"hersh"
)

// Trading strategy configuration
type TradingConfig struct {
	APIKey            string
	BuyThreshold      float64
	SellThreshold     float64
	MaxPosition       float64
	MonitoringEnabled bool
}

// Trading state
type TradingState struct {
	Position    float64
	TotalTrades int
	LastPrice   float64
}

func main() {
	fmt.Println("=== Hersh Trading Bot Demo ===")
	fmt.Println("Polymarket + Bitcoin Price Monitor\n")

	// Configuration
	config := TradingConfig{
		APIKey:            "demo-api-key-12345",
		BuyThreshold:      44500.0, // Buy when price drops below this
		SellThreshold:     45500.0, // Sell when price rises above this
		MaxPosition:       10000.0,
		MonitoringEnabled: true,
	}

	// Create watcher
	watcherConfig := hersh.DefaultWatcherConfig()
	watcherConfig.DefaultTimeout = 10 * time.Second
	watcher := hersh.NewWatcher(watcherConfig)

	// Main trading function
	tradingFunc := func(msg *hersh.Message, ctx hersh.HershContext) error {
		fmt.Println("\n" + strings.Repeat("=", 60))
		fmt.Printf("[%s] Trading Cycle Started\n", time.Now().Format("15:04:05"))
		fmt.Println(strings.Repeat("=", 60))

		// Initialize MarketClient with Memo (expensive operation, cached)
		client := hersh.Memo(func() any {
			fmt.Println("\n[MEMO] Creating MarketClient (this happens only once)...")
			return NewMarketClient(config.APIKey)
		}, "marketClient", ctx).(*MarketClient)

		// Get trading state from context
		// Use GetValue for read-only access (framework doesn't copy)
		stateVal := ctx.GetValue("state")
		if stateVal == nil {
			// Initialize state on first run
			ctx.SetValue("state", &TradingState{
				Position:    0.0,
				TotalTrades: 0,
				LastPrice:   0.0,
			})
			stateVal = ctx.GetValue("state")
		}
		state := stateVal.(*TradingState)

		// Watch Bitcoin price - always outside conditional logic
		priceData := hersh.WatchCall(
			func(prev any, watchCtx hersh.HershContext) (any, bool, error) {
				// Fetch current price
				price, err := client.GetBitcoinPrice()
				if err != nil {
					// Silently ignore errors during shutdown
					return prev, false, nil
				}

				// Check if price changed significantly (>$100)
				if prev == nil {
					return price, true, nil
				}

				prevPrice := prev.(float64)
				changed := abs(price-prevPrice) > 100.0

				if changed {
					fmt.Printf("  [Watch] Price changed: $%.2f → $%.2f (Δ $%.2f)\n",
						prevPrice, price, price-prevPrice)
				}

				return price, changed, nil
			},
			"btcPrice",
			500*time.Millisecond, // Poll every 500ms
			ctx,
		)

		// Process price data if monitoring is enabled
		if config.MonitoringEnabled && priceData != nil {
			currentPrice := priceData.(float64)

			fmt.Printf("\n📊 Current Bitcoin Price: $%.2f\n", currentPrice)
			fmt.Printf("💰 Current Position: $%.2f\n", state.Position)

			// Buy signal - use UpdateValue for safe state mutation
			if currentPrice < config.BuyThreshold && state.Position < config.MaxPosition {
				buyAmount := 1000.0
				fmt.Printf("\n🎯 BUY SIGNAL: Price $%.2f < Threshold $%.2f\n",
					currentPrice, config.BuyThreshold)

				err := client.PlaceOrder("BUY", buyAmount)
				if err == nil {
					newState := ctx.UpdateValue("state", func(current any) any {
						s := current.(*TradingState)
						return &TradingState{
							Position:    s.Position + buyAmount,
							TotalTrades: s.TotalTrades + 1,
							LastPrice:   currentPrice,
						}
					}).(*TradingState)
					fmt.Printf("✅ Position updated: $%.2f\n", newState.Position)
					state = newState // Update local reference
				}
			}

			// Sell signal - use UpdateValue for safe state mutation
			if currentPrice > config.SellThreshold && state.Position > 0 {
				sellAmount := min(1000.0, state.Position)
				fmt.Printf("\n🎯 SELL SIGNAL: Price $%.2f > Threshold $%.2f\n",
					currentPrice, config.SellThreshold)

				err := client.PlaceOrder("SELL", sellAmount)
				if err == nil {
					newState := ctx.UpdateValue("state", func(current any) any {
						s := current.(*TradingState)
						return &TradingState{
							Position:    s.Position - sellAmount,
							TotalTrades: s.TotalTrades + 1,
							LastPrice:   currentPrice,
						}
					}).(*TradingState)
					fmt.Printf("✅ Position updated: $%.2f\n", newState.Position)
					state = newState // Update local reference
				}
			}

			// Get market depth periodically
			if state.TotalTrades > 0 && state.TotalTrades%3 == 0 {
				depth, err := client.GetMarketDepth("BTC-USD")
				if err == nil {
					fmt.Printf("\n📈 Market Depth: Bid=%.2f, Ask=%.2f, Volume=%.0f\n",
						depth["bid"], depth["ask"], depth["volume"])
				}
			}
		}

		// Handle user messages
		if msg != nil {
			fmt.Printf("\n💬 Message received: '%s'\n", msg.Content)

			switch msg.Content {
			case "status":
				fmt.Printf("\n📊 Trading Bot Status:\n")
				fmt.Printf("  - Last Price: $%.2f\n", state.LastPrice)
				fmt.Printf("  - Position: $%.2f\n", state.Position)
				fmt.Printf("  - Total Trades: %d\n", state.TotalTrades)
				fmt.Printf("  - Client: %s\n", client.GetStats())

			case "pause":
				config.MonitoringEnabled = false
				fmt.Println("⏸️  Monitoring paused")

			case "resume":
				config.MonitoringEnabled = true
				fmt.Println("▶️  Monitoring resumed")

			case "stop":
				fmt.Println("\n🛑 Stop signal received")
				fmt.Printf("Final Position: $%.2f\n", state.Position)
				fmt.Printf("Total Trades: %d\n", state.TotalTrades)
				return hersh.NewStopErr("user requested stop")

			default:
				fmt.Printf("❓ Unknown command: %s\n", msg.Content)
			}
		}

		fmt.Println("\n" + strings.Repeat("-", 60))
		return nil
	}

	// Register with cleanup
	watcher.Manage(tradingFunc, "tradingBot").Cleanup(func(ctx hersh.HershContext) {
		fmt.Println("\n" + strings.Repeat("=", 60))
		fmt.Println("[CLEANUP] Shutting down trading bot...")
		fmt.Println(strings.Repeat("=", 60))

		// Get client from Memo cache and close it
		clientVal := hersh.Memo(func() any {
			return nil // Won't be called, value already cached
		}, "marketClient", ctx)

		if client, ok := clientVal.(*MarketClient); ok && client != nil {
			client.Close()
		}

		// Print final statistics from context
		stateVal := ctx.GetValue("state")
		if stateVal != nil {
			state := stateVal.(*TradingState)
			fmt.Println("\n📊 Final Statistics:")
			fmt.Printf("  - Final Position: $%.2f\n", state.Position)
			fmt.Printf("  - Total Trades: %d\n", state.TotalTrades)
		}

		fmt.Println("\n✅ Cleanup complete")
	})

	// Start watcher
	fmt.Println("Starting trading bot...")
	err := watcher.Start()
	if err != nil {
		panic(err)
	}

	// Wait for initialization
	time.Sleep(800 * time.Millisecond)
	fmt.Printf("\n✅ Trading bot started (State: %s)\n", watcher.GetState())

	// Simulate user interactions
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("Simulating User Commands...")
	fmt.Println(strings.Repeat("=", 60))

	time.Sleep(2 * time.Second)
	fmt.Println("\n→ Sending 'status' command...")
	watcher.SendMessage("status")

	time.Sleep(2 * time.Second)
	fmt.Println("\n→ Sending 'pause' command...")
	watcher.SendMessage("pause")

	time.Sleep(1 * time.Second)
	fmt.Println("\n→ Sending 'resume' command...")
	watcher.SendMessage("resume")

	time.Sleep(2 * time.Second)
	fmt.Println("\n→ Sending 'stop' command...")
	watcher.SendMessage("stop")

	// Wait for shutdown
	time.Sleep(1 * time.Second)

	// Print logger summary
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("Execution Summary")
	fmt.Println(strings.Repeat("=", 60))
	watcher.GetLogger().PrintSummary()

	// Stop watcher
	err = watcher.Stop()
	if err != nil {
		fmt.Printf("Error stopping: %v\n", err)
	}

	fmt.Println("\n=== Demo Complete ===")
}

// Helper functions
func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
