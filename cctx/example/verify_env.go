package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/exchanges"
	"github.com/HershyOrg/hershy/cctx/models"
)

func loadEnv() {
	file, err := os.Open("../../examples/polymarket-trader-copy/.env")
	if err != nil {
		return // Ignore if not exists
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip empty lines and comments
		if len(line) == 0 || strings.HasPrefix(line, "#") {
			continue
		}
		// Split on first equals sign
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			// Strip quotes from value
			val := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
			os.Setenv(key, val)
		}
	}
}

func main() {
	loadEnv()

	pk := os.Getenv("POLY_PRIVATE_KEY")
	funder := os.Getenv("POLY_FUNDER")
	apiKey := os.Getenv("POLY_API_KEY")
	apiSecret := os.Getenv("POLY_API_SECRET")
	apiPass := os.Getenv("POLY_API_PASSPHRASE")

	eoa := os.Getenv("POLY_EOA")
	signatureType := 0
	if funder != "" {
		signatureType = 2
	}
	if raw := os.Getenv("POLY_SIGNATURE_TYPE"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			signatureType = parsed
		}
	}

	fmt.Println("Initializing Polymarket client with .env credentials...")
	forceRegen := os.Getenv("FORCE_REGEN") == "1"
	if forceRegen {
		apiKey = ""
		apiSecret = ""
		apiPass = ""
	}

	p, err := exchanges.NewPolymarket(map[string]any{
		"private_key":    pk,
		"funder":         funder,
		"api_key":        apiKey,
		"api_secret":     apiSecret,
		"api_passphrase": apiPass,
		"signature_type": signatureType,
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize Polymarket: %v", err)
	}

	// Double check if keys changed (meaning they were derived)
	// We need a way to access the creds from Polymarket struct.
	// Since we can't easily, let's just modify verify_env.go to manually trigger it.
	fmt.Printf("✅ Client initialized\n")
	fmt.Printf("Signer (EOA): %s\n", eoa)
	fmt.Printf("Funder (Proxy): %s\n", funder)
	fmt.Printf("Signature Type: %d\n", signatureType)

	fmt.Println("\n--- Testing API Authentication ---")

	fmt.Println("\n1. Fetching Balance (Tests L2 API Key read permissions)...")
	start := time.Now()
	balances, err := p.FetchBalance()
	if err != nil {
		fmt.Printf("❌ Error fetching balance: %v\n", err)
	} else {
		fmt.Printf("✅ Balance fetched successfully in %v: %+v\n", time.Since(start), balances)
	}

	fmt.Println("\n2. Fetching Open Orders (Tests API Authentication & Signature)...")
	start = time.Now()
	dummyMarket := "0xa8e2f123b6001c0f63d2bafa4f654acd1500a413b2e12110686b90c393c49da0"
	orders, err := p.FetchOpenOrders(&dummyMarket, nil)
	if err != nil {
		fmt.Printf("❌ Error fetching open orders: %v\n", err)
	} else {
		fmt.Printf("✅ Open orders fetched successfully in %v. Count: %d\n", time.Since(start), len(orders))
	}

	fmt.Println("\n3. Testing Order Creation (Tests L1 Signer & Maker match)...")
	start = time.Now()
	// Using the dummyMarket used earlier
	order, err := p.CreateOrder(dummyMarket, "yes", models.OrderSideBuy, 0.50, 5.0, map[string]any{
		"token_id": "98022490269692409998126496127597032490334070080325855126491859374983463996227",
	})
	if err != nil {
		fmt.Printf("❌ Expected error from matching engine, got: %v\n", err)
	} else {
		fmt.Printf("✅ Order placement succeeded in %v. Order ID: %s\n", time.Since(start), order.ID)
		if order.ID != "" {
			if _, cancelErr := p.CancelOrder(order.ID, nil); cancelErr != nil {
				fmt.Printf("⚠️  Cleanup cancel failed for %s: %v\n", order.ID, cancelErr)
			} else {
				fmt.Printf("🧹 Cleanup canceled test order: %s\n", order.ID)
			}
		}
	}

	fmt.Println("\nNote: Creating an order tests the L1 Private Key strictly. Fetching data mostly tests L2 keys.")
}
