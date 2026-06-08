package basis_test

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/basis"
	"github.com/HershyOrg/hershy/cctx/cex"
	"github.com/HershyOrg/hershy/cctx/exchanges"
)

const liveRiskAck = "I_UNDERSTAND_THIS_SENDS_REAL_ORDERS"

// TestLiveBSCBasisReadOnlyPreflight hits real BSC/Binance read-only APIs.
//
// Required env:
//
//	CCTX_LIVE_BASIS=1
//	EVM_DEX_RPC_URL or BSC_RPC_URL
//	EOA mode: EVM_DEX_PRIVATE_KEY or PRIVATE_KEY
//	SCW mode: EVM_DEX_SIGNER_TYPE=session_key plus smart-wallet/session-key/relayer env
//	BASIS_TOKEN_ADDRESS
//	BASIS_AMOUNT_IN_WEI
//	BASIS_FUTURES_SYMBOL
//	BASIS_FUTURES_QUANTITY
//	BASIS_POOL_ADDRESS or UNISWAP_V3_FEE
//
// Optional env:
//
//	BASIS_QUOTE_ADDRESS defaults to BSC USDT
//	UNISWAP_V3_QUOTER defaults to BSC QuoterV2
//	UNISWAP_V3_ROUTER defaults to BSC SwapRouter02
//	BINANCE_API_KEY / BINANCE_API_SECRET enable signed balance checks
func TestLiveBSCBasisReadOnlyPreflight(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_BASIS", false) {
		t.Skip("set CCTX_LIVE_BASIS=1 to run live read-only preflight")
	}

	cfg := loadLiveConfig(t, false)
	deps := newLiveDeps(t, cfg)
	preflight := runReadOnlyPreflight(t, cfg, deps)

	t.Logf("wallet=%s", deps.wallet)
	t.Logf("entry_quote_amount_out_wei=%s", preflight.EntryQuote.AmountOutWei)
	t.Logf("quote_allowance_wei=%s", preflight.QuoteAllowance.AllowanceWei)
	t.Logf("asset_allowance_wei=%s", preflight.AssetAllowance.AllowanceWei)
	t.Logf("rounded_futures_quantity=%s", preflight.RoundedFuturesQuantity)
	t.Logf("preflight=%s", mustJSON(preflight))
}

// TestLiveBSCBasisReconcile compares stored state with live EOA and Binance exposure.
// It is read-only and does not submit DEX transactions or futures orders.
func TestLiveBSCBasisReconcile(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_BASIS", false) {
		t.Skip("set CCTX_LIVE_BASIS=1 to run live reconciliation")
	}

	cfg := loadLiveConfig(t, true)
	deps := newLiveDeps(t, cfg)
	store, err := basis.NewPositionStore(cfg.stateFile)
	if err != nil {
		t.Fatalf("NewPositionStore: %v", err)
	}
	reconciler := &basis.Reconciler{
		Store:         store,
		DEXReader:     deps.dexReader,
		Futures:       deps.futures,
		WalletAddress: deps.wallet,
	}
	report, err := reconciler.Reconcile(basis.ReconcileRequest{
		PositionID:           envString("BASIS_POSITION_ID", ""),
		IncludeClosed:        envBool("BASIS_RECONCILE_INCLUDE_CLOSED", false),
		QuantityToleranceBps: envUint32("BASIS_RECONCILE_TOLERANCE_BPS", basis.DefaultReconcileToleranceBps),
	})
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	t.Logf("reconciliation=%s", mustJSON(report))
	if envBool("BASIS_RECONCILE_FAIL_ON_ACTION", false) && report.Summary.NeedsAction > 0 {
		t.Fatalf("reconciliation needs action: %s", mustJSON(report.Summary))
	}
}

// TestLiveBSCBasisOpenClose sends real DEX swaps and real Binance futures orders.
// It is intentionally gated harder than the read-only test.
//
// Extra required env:
//
//	CCTX_LIVE_BASIS_ALLOW_ORDERS=1
//	CCTX_LIVE_BASIS_RISK_ACK=I_UNDERSTAND_THIS_SENDS_REAL_ORDERS
//	ENABLE_LIVE_TRADING=true
//	DRY_RUN=false
//	BINANCE_API_KEY
//	BINANCE_API_SECRET
//	BASIS_STATE_FILE
//
// Safety default:
//
//	BASIS_REQUIRE_PREAPPROVED defaults to true. With the current executor, approve
//	transactions are submitted asynchronously, so live open/close should start only
//	after both quote-token and asset-token router allowances are already sufficient.
func TestLiveBSCBasisOpenClose(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_BASIS_ALLOW_ORDERS", false) {
		t.Skip("set CCTX_LIVE_BASIS_ALLOW_ORDERS=1 to send real orders")
	}
	if !envBool("ENABLE_LIVE_TRADING", false) || envBool("DRY_RUN", true) {
		t.Fatal("live order test requires ENABLE_LIVE_TRADING=true and DRY_RUN=false")
	}
	if envString("CCTX_LIVE_BASIS_RISK_ACK", "") != liveRiskAck {
		t.Fatalf("set CCTX_LIVE_BASIS_RISK_ACK=%s to acknowledge real orders", liveRiskAck)
	}

	cfg := loadLiveConfig(t, true)
	deps := newLiveDeps(t, cfg)
	preflight := runReadOnlyPreflight(t, cfg, deps)
	if envBool("BASIS_REQUIRE_PREAPPROVED", true) {
		requireAllowanceAtLeast(t, "quote token", preflight.QuoteAllowance.AllowanceWei, cfg.amountInWei)
		requireAllowanceAtLeast(t, "asset token", preflight.AssetAllowance.AllowanceWei, preflight.EntryQuote.AmountOutWei)
	}

	store, err := basis.NewPositionStore(cfg.stateFile)
	if err != nil {
		t.Fatalf("NewPositionStore: %v", err)
	}
	executor := &basis.Executor{
		DEX:     deps.dex,
		Futures: deps.futures,
		Store:   store,
	}
	positionID := firstNonEmpty(envString("BASIS_POSITION_ID", ""), fmt.Sprintf("%s-live-%d", cfg.asset, time.Now().Unix()))

	openResult, err := executor.Open(basis.OpenRequest{
		ID:                  positionID,
		Asset:               cfg.asset,
		Chain:               cfg.chain,
		NotionalQuote:       envString("BASIS_NOTIONAL_QUOTE", ""),
		EntryDEXPrice:       envString("BASIS_ENTRY_DEX_PRICE", ""),
		EntryCEXBid:         envString("BASIS_ENTRY_CEX_BID", ""),
		EntryGapPct:         envString("BASIS_ENTRY_GAP_PCT", ""),
		DEXID:               "uniswap_v3",
		PoolAddress:         cfg.poolAddress,
		QuoterAddress:       cfg.quoterAddress,
		RouterAddress:       cfg.routerAddress,
		TokenAddress:        cfg.tokenAddress,
		QuoteAddress:        cfg.quoteAddress,
		QuoteSymbol:         cfg.quoteSymbol,
		UniswapV3Fee:        cfg.fee,
		AmountInWei:         cfg.amountInWei,
		MinTokenOutWei:      envString("BASIS_MIN_TOKEN_OUT_WEI", ""),
		SlippageBps:         cfg.entrySlippageBps,
		FuturesExchange:     "binance_futures",
		FuturesSymbol:       cfg.futuresSymbol,
		FuturesQuantity:     cfg.futuresQuantity,
		FuturesPositionSide: base.FuturesPositionSide(cfg.futuresPositionSide),
		Leverage:            cfg.leverage,
		DryRun:              false,
		RecordDryRun:        false,
		WaitForReceipt:      true,
		AllowMultiple:       envBool("BASIS_ALLOW_MULTIPLE", false),
		Metadata: map[string]any{
			"source": "live_scenario_test",
		},
	})
	if err != nil {
		t.Fatalf("live open failed: %v\npartial=%s", err, mustJSON(openResult))
	}
	t.Logf("live open result=%s", mustJSON(openResult))

	closeResult, err := executor.Close(basis.CloseRequest{
		PositionID:     positionID,
		Reason:         firstNonEmpty(envString("BASIS_CLOSE_REASON", ""), "live_test_close"),
		MinQuoteOutWei: envString("BASIS_MIN_QUOTE_OUT_WEI", ""),
		SlippageBps:    cfg.exitSlippageBps,
		DryRun:         false,
		RecordDryRun:   false,
		WaitForReceipt: true,
	})
	if err != nil {
		t.Fatalf("live close failed; position may remain open in %s: %v\nopen=%s", cfg.stateFile, err, mustJSON(openResult.Position))
	}
	t.Logf("live close result=%s", mustJSON(closeResult))
}

// TestLiveBSCBasisCloseOpenPosition closes an existing stored open position.
// It is useful for recovery after the DEX spot leg succeeded but the futures leg
// failed before an entry order was placed.
func TestLiveBSCBasisCloseOpenPosition(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_BASIS_ALLOW_ORDERS", false) {
		t.Skip("set CCTX_LIVE_BASIS_ALLOW_ORDERS=1 to send real orders")
	}
	if !envBool("ENABLE_LIVE_TRADING", false) || envBool("DRY_RUN", true) {
		t.Fatal("live recovery close requires ENABLE_LIVE_TRADING=true and DRY_RUN=false")
	}
	if envString("CCTX_LIVE_BASIS_RISK_ACK", "") != liveRiskAck {
		t.Fatalf("set CCTX_LIVE_BASIS_RISK_ACK=%s to acknowledge real orders", liveRiskAck)
	}

	cfg := loadLiveConfig(t, true)
	deps := newLiveDeps(t, cfg)
	store, err := basis.NewPositionStore(cfg.stateFile)
	if err != nil {
		t.Fatalf("NewPositionStore: %v", err)
	}
	positions, err := store.Active()
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(positions) == 0 {
		t.Fatal("no active basis position to close")
	}
	position := positions[0]
	if requestedID := envString("BASIS_POSITION_ID", ""); requestedID != "" {
		found := false
		for _, candidate := range positions {
			if candidate.ID == requestedID {
				position = candidate
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("active basis position not found: %s", requestedID)
		}
	}

	if envBool("BASIS_REQUIRE_PREAPPROVED", true) {
		allowance, err := deps.dexReader.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
			Chain:          position.Spot.Chain,
			TokenAddress:   position.Spot.TokenAddress,
			OwnerAddress:   deps.wallet,
			SpenderAddress: position.Spot.RouterAddress,
		})
		if err != nil {
			t.Fatalf("FetchERC20Allowance asset: %v", err)
		}
		requireAllowanceAtLeast(t, "asset token", allowance.AllowanceWei, position.Spot.TokenQtyWei)
	}

	executor := &basis.Executor{
		DEX:     deps.dex,
		Futures: deps.futures,
		Store:   store,
	}
	skipFutures := envBool("BASIS_CLOSE_SKIP_FUTURES", strings.TrimSpace(position.Futures.EntryOrderID) == "")
	closeResult, err := executor.Close(basis.CloseRequest{
		PositionID:     position.ID,
		Reason:         firstNonEmpty(envString("BASIS_CLOSE_REASON", ""), "live_recovery_close"),
		MinQuoteOutWei: envString("BASIS_MIN_QUOTE_OUT_WEI", ""),
		SlippageBps:    cfg.exitSlippageBps,
		DryRun:         false,
		RecordDryRun:   false,
		WaitForReceipt: true,
		SkipFutures:    skipFutures,
	})
	if err != nil {
		t.Fatalf("live recovery close failed; position may remain open in %s: %v\nposition=%s", cfg.stateFile, err, mustJSON(position))
	}
	t.Logf("live recovery close result=%s", mustJSON(closeResult))
}

type liveConfig struct {
	chain               string
	chainID             int64
	rpcURL              string
	signerType          string
	privateKey          string
	smartWallet         string
	sessionPrivateKey   string
	sessionKeyID        string
	policyID            string
	relayerURL          string
	relayerAuthToken    string
	sessionDeadline     int64
	asset               string
	tokenAddress        string
	quoteAddress        string
	quoteSymbol         string
	poolAddress         string
	quoterAddress       string
	routerAddress       string
	fee                 uint32
	amountInWei         string
	futuresSymbol       string
	futuresQuantity     string
	futuresPositionSide string
	leverage            int
	entrySlippageBps    uint32
	exitSlippageBps     uint32
	binanceAPIKey       string
	binanceAPISecret    string
	binanceBaseURL      string
	binanceRecvWindow   int64
	stateFile           string
}

type liveDeps struct {
	dex             base.UniswapV3Executor
	dexReader       base.EVMDEXReader
	dexExecutor     base.EVMDEXExecutor
	futures         base.FuturesTrader
	futuresExchange base.Exchange
	wallet          string
}

type livePreflight struct {
	Wallet                 string                              `json:"wallet"`
	Pool                   *base.UniswapV3PoolInfo             `json:"pool,omitempty"`
	EntryQuote             base.UniswapV3QuoteExactInputSingle `json:"entry_quote"`
	QuoteAllowance         base.EVMERC20Allowance              `json:"quote_allowance"`
	AssetAllowance         base.EVMERC20Allowance              `json:"asset_allowance"`
	FuturesRules           base.FuturesQuantityRules           `json:"futures_rules"`
	RoundedFuturesQuantity string                              `json:"rounded_futures_quantity"`
	BinanceBalances        map[string]float64                  `json:"binance_balances,omitempty"`
}

func loadLiveConfig(t *testing.T, requireOrders bool) liveConfig {
	t.Helper()
	cfg := liveConfig{
		chain:               envString("BASIS_CHAIN", "bsc"),
		chainID:             envInt64("EVM_DEX_CHAIN_ID", envInt64("BSC_CHAIN_ID", 56)),
		rpcURL:              firstNonEmpty(envString("EVM_DEX_RPC_URL", ""), envString("BSC_RPC_URL", "")),
		signerType:          envString("EVM_DEX_SIGNER_TYPE", "eoa"),
		privateKey:          firstNonEmpty(envString("EVM_DEX_PRIVATE_KEY", ""), envString("PRIVATE_KEY", "")),
		smartWallet:         envString("EVM_DEX_SMART_WALLET_ADDRESS", ""),
		sessionPrivateKey:   firstNonEmpty(envString("EVM_DEX_SESSION_PRIVATE_KEY", ""), envString("SESSION_PRIVATE_KEY", "")),
		sessionKeyID:        envString("EVM_DEX_SESSION_KEY_ID", ""),
		policyID:            envString("EVM_DEX_POLICY_ID", ""),
		relayerURL:          envString("EVM_DEX_RELAYER_URL", ""),
		relayerAuthToken:    envString("EVM_DEX_RELAYER_AUTH_TOKEN", ""),
		sessionDeadline:     envInt64("EVM_DEX_SESSION_DEADLINE_SECONDS", 300),
		asset:               envString("BASIS_ASSET", "LIVE"),
		tokenAddress:        envString("BASIS_TOKEN_ADDRESS", ""),
		quoteAddress:        envString("BASIS_QUOTE_ADDRESS", scenarioUSDT),
		quoteSymbol:         envString("BASIS_QUOTE_SYMBOL", "USDT"),
		poolAddress:         envString("BASIS_POOL_ADDRESS", ""),
		quoterAddress:       envString("UNISWAP_V3_QUOTER", scenarioQuoterV2),
		routerAddress:       envString("UNISWAP_V3_ROUTER", scenarioSwapRouter02),
		fee:                 envUint32("UNISWAP_V3_FEE", 0),
		amountInWei:         envString("BASIS_AMOUNT_IN_WEI", ""),
		futuresSymbol:       envString("BASIS_FUTURES_SYMBOL", ""),
		futuresQuantity:     envString("BASIS_FUTURES_QUANTITY", ""),
		futuresPositionSide: strings.ToUpper(envString("BASIS_FUTURES_POSITION_SIDE", "")),
		leverage:            envInt("BINANCE_LEVERAGE", 1),
		entrySlippageBps:    envUint32("BASIS_SLIPPAGE_BPS", 100),
		exitSlippageBps:     envUint32("BASIS_EXIT_SLIPPAGE_BPS", 100),
		binanceAPIKey:       envString("BINANCE_API_KEY", ""),
		binanceAPISecret:    firstNonEmpty(envString("BINANCE_API_SECRET", ""), envString("BINANCE_HMAC_SECRET", "")),
		binanceBaseURL:      envString("BINANCE_FUTURES_BASE_URL", ""),
		binanceRecvWindow:   envInt64("BINANCE_RECV_WINDOW", 5000),
		stateFile:           envString("BASIS_STATE_FILE", ""),
	}

	required := map[string]string{
		"EVM_DEX_RPC_URL or BSC_RPC_URL": cfg.rpcURL,
		"BASIS_TOKEN_ADDRESS":            cfg.tokenAddress,
		"BASIS_AMOUNT_IN_WEI":            cfg.amountInWei,
		"BASIS_FUTURES_SYMBOL":           cfg.futuresSymbol,
		"BASIS_FUTURES_QUANTITY":         cfg.futuresQuantity,
		"UNISWAP_V3_QUOTER":              cfg.quoterAddress,
		"UNISWAP_V3_ROUTER":              cfg.routerAddress,
	}
	if isSCWSigner(cfg.signerType) {
		required["EVM_DEX_SMART_WALLET_ADDRESS"] = cfg.smartWallet
		required["EVM_DEX_SESSION_PRIVATE_KEY or SESSION_PRIVATE_KEY"] = cfg.sessionPrivateKey
		required["EVM_DEX_RELAYER_URL"] = cfg.relayerURL
	} else {
		required["EVM_DEX_PRIVATE_KEY or PRIVATE_KEY"] = cfg.privateKey
	}
	if cfg.fee == 0 {
		required["BASIS_POOL_ADDRESS or UNISWAP_V3_FEE"] = cfg.poolAddress
	}
	if requireOrders {
		required["BINANCE_API_KEY"] = cfg.binanceAPIKey
		required["BINANCE_API_SECRET"] = cfg.binanceAPISecret
		required["BASIS_STATE_FILE"] = cfg.stateFile
		if isSCWSigner(cfg.signerType) {
			required["EVM_DEX_SESSION_KEY_ID"] = cfg.sessionKeyID
			required["EVM_DEX_POLICY_ID"] = cfg.policyID
		}
	}
	for name, value := range required {
		if strings.TrimSpace(value) == "" {
			t.Fatalf("missing required env: %s", name)
		}
	}
	return cfg
}

func newLiveDeps(t *testing.T, cfg liveConfig) liveDeps {
	t.Helper()
	dexConfig := map[string]any{
		"signer_type":              cfg.signerType,
		"private_key":              cfg.privateKey,
		"rpc_url":                  cfg.rpcURL,
		"chain_id":                 cfg.chainID,
		"cast_binary":              envString("EVM_DEX_CAST_BINARY", "cast"),
		"native_symbol":            envString("EVM_DEX_NATIVE_SYMBOL", "BNB"),
		"smart_wallet_address":     cfg.smartWallet,
		"session_private_key":      cfg.sessionPrivateKey,
		"session_key_id":           cfg.sessionKeyID,
		"policy_id":                cfg.policyID,
		"relayer_url":              cfg.relayerURL,
		"relayer_auth_token":       cfg.relayerAuthToken,
		"session_deadline_seconds": cfg.sessionDeadline,
	}
	dexExchange, err := exchanges.NewEVMDEX(dexConfig)
	if err != nil {
		t.Fatalf("NewEVMDEX: %v", err)
	}
	dex, ok := dexExchange.(base.UniswapV3Executor)
	if !ok {
		t.Fatal("EVMDEX does not implement UniswapV3Executor")
	}
	dexReader, ok := dexExchange.(base.EVMDEXReader)
	if !ok {
		t.Fatal("EVMDEX does not implement EVMDEXReader")
	}
	dexExecutor, ok := dexExchange.(base.EVMDEXExecutor)
	if !ok {
		t.Fatal("EVMDEX does not implement EVMDEXExecutor")
	}
	futuresExchange, err := cex.NewBinanceFutures(map[string]any{
		"api_key":     cfg.binanceAPIKey,
		"api_secret":  cfg.binanceAPISecret,
		"base_url":    cfg.binanceBaseURL,
		"recv_window": cfg.binanceRecvWindow,
	})
	if err != nil {
		t.Fatalf("NewBinanceFutures: %v", err)
	}
	futures, ok := futuresExchange.(base.FuturesTrader)
	if !ok {
		t.Fatal("BinanceFutures does not implement FuturesTrader")
	}
	return liveDeps{
		dex:             dex,
		dexReader:       dexReader,
		dexExecutor:     dexExecutor,
		futures:         futures,
		futuresExchange: futuresExchange,
		wallet:          dexExecutor.WalletAddress(),
	}
}

func runReadOnlyPreflight(t *testing.T, cfg liveConfig, deps liveDeps) livePreflight {
	t.Helper()
	fee := cfg.fee
	var poolInfo *base.UniswapV3PoolInfo
	if cfg.poolAddress != "" {
		pool, err := deps.dex.FetchUniswapV3PoolInfo(base.UniswapV3PoolRequest{
			Chain:       cfg.chain,
			PoolAddress: cfg.poolAddress,
		})
		if err != nil {
			t.Fatalf("FetchUniswapV3PoolInfo: %v", err)
		}
		if !poolIncludes(pool, cfg.tokenAddress, cfg.quoteAddress) {
			t.Fatalf("pool token mismatch: pool=%s/%s token=%s quote=%s", pool.Token0, pool.Token1, cfg.tokenAddress, cfg.quoteAddress)
		}
		poolInfo = &pool
		if fee == 0 {
			fee = pool.Fee
		}
	}
	if fee == 0 {
		t.Fatal("fee resolved to zero")
	}

	entryQuote, err := deps.dex.QuoteUniswapV3ExactInputSingle(base.UniswapV3QuoteExactInputSingleRequest{
		Chain:         cfg.chain,
		QuoterAddress: cfg.quoterAddress,
		TokenIn:       cfg.quoteAddress,
		TokenOut:      cfg.tokenAddress,
		Fee:           fee,
		AmountInWei:   cfg.amountInWei,
	})
	if err != nil {
		t.Fatalf("QuoteUniswapV3ExactInputSingle entry: %v", err)
	}
	quoteAllowance, err := deps.dexReader.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
		Chain:          cfg.chain,
		TokenAddress:   cfg.quoteAddress,
		OwnerAddress:   deps.wallet,
		SpenderAddress: cfg.routerAddress,
	})
	if err != nil {
		t.Fatalf("FetchERC20Allowance quote: %v", err)
	}
	assetAllowance, err := deps.dexReader.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
		Chain:          cfg.chain,
		TokenAddress:   cfg.tokenAddress,
		OwnerAddress:   deps.wallet,
		SpenderAddress: cfg.routerAddress,
	})
	if err != nil {
		t.Fatalf("FetchERC20Allowance asset: %v", err)
	}
	rules, err := deps.futures.FuturesQuantityRules(cfg.futuresSymbol)
	if err != nil {
		t.Fatalf("FuturesQuantityRules: %v", err)
	}
	rounded, err := deps.futures.RoundFuturesQuantity(cfg.futuresSymbol, cfg.futuresQuantity)
	if err != nil {
		t.Fatalf("RoundFuturesQuantity: %v", err)
	}
	out := livePreflight{
		Wallet:                 deps.wallet,
		Pool:                   poolInfo,
		EntryQuote:             entryQuote,
		QuoteAllowance:         quoteAllowance,
		AssetAllowance:         assetAllowance,
		FuturesRules:           rules,
		RoundedFuturesQuantity: rounded,
	}
	if cfg.binanceAPIKey != "" && cfg.binanceAPISecret != "" {
		balances, err := deps.futuresExchange.FetchBalance()
		if err != nil {
			if envBool("CCTX_LIVE_BASIS_ALLOW_ORDERS", false) {
				t.Fatalf("FetchBalance: %v", err)
			}
			t.Logf("FetchBalance skipped: %v", err)
			return out
		}
		out.BinanceBalances = balances
	}
	return out
}

func requireAllowanceAtLeast(t *testing.T, label string, allowanceWei string, requiredWei string) {
	t.Helper()
	allowance := mustBigInt(t, allowanceWei)
	required := mustBigInt(t, requiredWei)
	if allowance.Cmp(required) < 0 {
		t.Fatalf("%s allowance too low: allowance=%s required=%s; pre-approve router or set BASIS_REQUIRE_PREAPPROVED=false if you intentionally want the test to submit approvals", label, allowanceWei, requiredWei)
	}
}

func poolIncludes(pool base.UniswapV3PoolInfo, token string, quote string) bool {
	tokenOK := strings.EqualFold(pool.Token0, token) || strings.EqualFold(pool.Token1, token)
	quoteOK := strings.EqualFold(pool.Token0, quote) || strings.EqualFold(pool.Token1, quote)
	return tokenOK && quoteOK
}

func loadLiveEnvFiles(t *testing.T) {
	t.Helper()
	for _, path := range []string{".env", "../.env", "../../.env", "../../../.env"} {
		loadEnvFile(path)
	}
}

func loadEnvFile(path string) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, rawLine := range strings.Split(string(payload), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
}

func envString(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt64(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envUint32(name string, fallback uint32) uint32 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return fallback
	}
	return uint32(parsed)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func isSCWSigner(signerType string) bool {
	switch strings.ToLower(strings.TrimSpace(signerType)) {
	case "session_key", "scw", "scw_session":
		return true
	default:
		return false
	}
}

func mustBigInt(t *testing.T, value string) *big.Int {
	t.Helper()
	out, ok := new(big.Int).SetString(strings.TrimSpace(value), 10)
	if !ok {
		t.Fatalf("invalid integer: %s", value)
	}
	return out
}

func mustJSON(value any) string {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Sprintf("<json error: %v>", err)
	}
	return string(payload)
}

func TestMain(m *testing.M) {
	_ = os.MkdirAll(filepath.Join(os.TempDir(), "cctx-basis-live"), 0o700)
	os.Exit(m.Run())
}
