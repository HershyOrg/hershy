package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"hersh"
	"hersh/manager"
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

// Global trading function - uses Watcher environment variables
func tradingFunc(msg *hersh.Message, ctx hersh.HershContext) error {
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Printf("[%s] Trading Cycle Started\n", time.Now().Format("15:04:05"))
	fmt.Println(strings.Repeat("=", 60))

	// Get watcher to access environment variables
	watcherVal := ctx.GetWatcher()
	if watcherVal == nil {
		return fmt.Errorf("watcher not found in context")
	}
	watcher := watcherVal.(*hersh.Watcher)

	// Load configuration from environment variables
	apiKey, _ := watcher.GetEnv("API_KEY")
	buyThresholdStr, _ := watcher.GetEnv("BUY_THRESHOLD")
	sellThresholdStr, _ := watcher.GetEnv("SELL_THRESHOLD")
	maxPositionStr, _ := watcher.GetEnv("MAX_POSITION")

	buyThreshold, _ := strconv.ParseFloat(buyThresholdStr, 64)
	sellThreshold, _ := strconv.ParseFloat(sellThresholdStr, 64)
	maxPosition, _ := strconv.ParseFloat(maxPositionStr, 64)

	// Get monitoring state from context (can be toggled by messages)
	monitoringVal := ctx.GetValue("monitoring_enabled")
	if monitoringVal == nil {
		ctx.SetValue("monitoring_enabled", true)
		monitoringVal = true
	}
	monitoringEnabled := monitoringVal.(bool)

	// Initialize MarketClient with Memo (expensive operation, cached)
	client := hersh.Memo(func() any {
		fmt.Println("\n[MEMO] Creating MarketClient (this happens only once)...")
		return NewMarketClient(apiKey)
	}, "marketClient", ctx).(*MarketClient)

	// Get trading state from context
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
		func() (manager.VarUpdateFunc, error) {
			// 네트워크 요청은 미리 해둔 후, func엔 가능한 계산만 남기는게 성능상 유리.
			price, err := client.GetBitcoinPrice()
			if err != nil {
				return nil, err
			}

			return func(prev any) (any, bool, error) {
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
			}, nil
		},
		"btcPrice",
		500*time.Millisecond, // Poll every 500ms
		ctx,
	)

	// Process price data if monitoring is enabled
	if monitoringEnabled && priceData != nil {
		currentPrice := priceData.(float64)

		fmt.Printf("\n📊 Current Bitcoin Price: $%.2f\n", currentPrice)
		fmt.Printf("💰 Current Position: $%.2f\n", state.Position)

		// Buy signal - use UpdateValue for safe state mutation
		if currentPrice < buyThreshold && state.Position < maxPosition {
			buyAmount := 1000.0
			fmt.Printf("\n🎯 BUY SIGNAL: Price $%.2f < Threshold $%.2f\n",
				currentPrice, buyThreshold)

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
		if currentPrice > sellThreshold && state.Position > 0 {
			sellAmount := min(1000.0, state.Position)
			fmt.Printf("\n🎯 SELL SIGNAL: Price $%.2f > Threshold $%.2f\n",
				currentPrice, sellThreshold)

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
			ctx.SetValue("monitoring_enabled", false)
			fmt.Println("⏸️  Monitoring paused")

		case "resume":
			ctx.SetValue("monitoring_enabled", true)
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

// Global cleanup function
func cleanupFunc(ctx hersh.HershContext) {
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
}

func main() {
	fmt.Println("=== Hersh Trading Bot Demo ===")

	fmt.Println("Polymarket + Bitcoin Price Monitor. \n")

	// Create environment variables for watcher
	envVars := map[string]string{
		"API_KEY":        "demo-api-key-12345",
		"BUY_THRESHOLD":  "44500.00",
		"SELL_THRESHOLD": "45500.00",
		"MAX_POSITION":   "10000.00",
	}

	// Create watcher with environment variables
	watcherConfig := hersh.DefaultWatcherConfig()
	watcherConfig.DefaultTimeout = 10 * time.Second
	watcher := hersh.NewWatcher(watcherConfig, envVars)

	// Register global trading function with cleanup
	watcher.Manage(tradingFunc, "tradingBot").Cleanup(cleanupFunc)

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
