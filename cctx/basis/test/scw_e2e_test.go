package basis_test

import (
	"math/big"
	"strings"
	"testing"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/exchanges"
)

const scwDEXRiskAck = "I_UNDERSTAND_THIS_SENDS_REAL_SCW_TXS"

// TestLiveSCWUniswapV3ReadOnlyPreflight checks the SCW address, balances,
// allowances, pool metadata, and quote without sending a transaction.
func TestLiveSCWUniswapV3ReadOnlyPreflight(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_SCW_DEX", false) {
		t.Skip("set CCTX_LIVE_SCW_DEX=1 to run live SCW DEX preflight")
	}

	cfg := loadSCWDEXConfig(t, false)
	deps := newSCWDEXDeps(t, cfg)
	preflight := runSCWDEXPreflight(t, cfg, deps)

	t.Logf("scw_wallet=%s", deps.wallet)
	t.Logf("entry_quote_amount_out_wei=%s", preflight.EntryQuote.AmountOutWei)
	t.Logf("quote_balance_wei=%s", preflight.QuoteBalance.BalanceWei)
	t.Logf("token_balance_wei=%s", preflight.TokenBalance.BalanceWei)
	t.Logf("quote_allowance_wei=%s", preflight.QuoteAllowance.AllowanceWei)
	t.Logf("token_allowance_wei=%s", preflight.TokenAllowance.AllowanceWei)
	t.Logf("preflight=%s", mustJSON(preflight))
}

// TestLiveSCWUniswapV3ApproveSwapE2E sends real SCW transactions through the
// configured relayer. By default it performs a round-trip: quote -> token,
// then token -> quote, so the smoke test does not leave the SCW intentionally
// long the output token.
func TestLiveSCWUniswapV3ApproveSwapE2E(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_SCW_DEX_ALLOW_TX", false) {
		t.Skip("set CCTX_LIVE_SCW_DEX_ALLOW_TX=1 to send real SCW DEX transactions")
	}
	if !envBool("ENABLE_LIVE_TRADING", false) || envBool("DRY_RUN", true) {
		t.Fatal("SCW DEX E2E requires ENABLE_LIVE_TRADING=true and DRY_RUN=false")
	}
	if envString("CCTX_LIVE_SCW_DEX_RISK_ACK", "") != scwDEXRiskAck {
		t.Fatalf("set CCTX_LIVE_SCW_DEX_RISK_ACK=%s to acknowledge real SCW transactions", scwDEXRiskAck)
	}

	cfg := loadSCWDEXConfig(t, true)
	deps := newSCWDEXDeps(t, cfg)
	preflight := runSCWDEXPreflight(t, cfg, deps)
	requireWeiAtLeast(t, "SCW quote-token balance", preflight.QuoteBalance.BalanceWei, cfg.amountInWei)

	if envBool("SCW_DEX_REQUIRE_PREAPPROVED", false) {
		requireAllowanceAtLeast(t, "SCW quote token", preflight.QuoteAllowance.AllowanceWei, cfg.amountInWei)
	}

	result := scwDEXE2EResult{Preflight: preflight}
	entryApproval, err := deps.dex.EnsureERC20Approval(base.ERC20ApprovalRequest{
		Chain:          cfg.chain,
		TokenAddress:   cfg.quoteAddress,
		OwnerAddress:   deps.wallet,
		SpenderAddress: cfg.approvalSpender,
		AmountWei:      cfg.amountInWei,
		DryRun:         false,
		WaitForReceipt: true,
	})
	if err != nil {
		t.Fatalf("SCW quote approval failed: %v\npartial=%s", err, mustJSON(result))
	}
	result.EntryApproval = &entryApproval

	entryMinOut := firstNonEmpty(envString("SCW_DEX_MIN_TOKEN_OUT_WEI", ""), slippageFloorWei(t, preflight.EntryQuote.AmountOutWei, cfg.slippageBps))
	entrySwap, err := deps.dex.SwapUniswapV3ExactInputSingle(base.UniswapV3SwapExactInputSingleRequest{
		Chain:               cfg.chain,
		RouterAddress:       cfg.routerAddress,
		TokenIn:             cfg.quoteAddress,
		TokenOut:            cfg.tokenAddress,
		Fee:                 preflight.EntryQuote.Fee,
		Recipient:           deps.wallet,
		AmountInWei:         cfg.amountInWei,
		AmountOutMinimumWei: entryMinOut,
		DryRun:              false,
		WaitForReceipt:      true,
	})
	if err != nil {
		t.Fatalf("SCW entry swap failed: %v\npartial=%s", err, mustJSON(result))
	}
	result.EntrySwap = &entrySwap

	if envBool("SCW_DEX_SKIP_EXIT", false) {
		t.Logf("SCW entry-only result=%s", mustJSON(result))
		return
	}
	if !positiveWei(entrySwap.ObservedAmountOutWei) {
		t.Fatalf("SCW entry swap reported no observed output; refusing to guess exit amount\nresult=%s", mustJSON(result))
	}

	exitQuote, err := deps.dex.QuoteUniswapV3ExactInputSingle(base.UniswapV3QuoteExactInputSingleRequest{
		Chain:         cfg.chain,
		QuoterAddress: cfg.quoterAddress,
		TokenIn:       cfg.tokenAddress,
		TokenOut:      cfg.quoteAddress,
		Fee:           preflight.EntryQuote.Fee,
		AmountInWei:   entrySwap.ObservedAmountOutWei,
	})
	if err != nil {
		t.Fatalf("SCW exit quote failed: %v\npartial=%s", err, mustJSON(result))
	}
	result.ExitQuote = &exitQuote

	exitApproval, err := deps.dex.EnsureERC20Approval(base.ERC20ApprovalRequest{
		Chain:          cfg.chain,
		TokenAddress:   cfg.tokenAddress,
		OwnerAddress:   deps.wallet,
		SpenderAddress: cfg.approvalSpender,
		AmountWei:      entrySwap.ObservedAmountOutWei,
		DryRun:         false,
		WaitForReceipt: true,
	})
	if err != nil {
		t.Fatalf("SCW token approval failed: %v\npartial=%s", err, mustJSON(result))
	}
	result.ExitApproval = &exitApproval

	exitMinOut := firstNonEmpty(envString("SCW_DEX_MIN_QUOTE_OUT_WEI", ""), slippageFloorWei(t, exitQuote.AmountOutWei, cfg.exitSlippageBps))
	exitSwap, err := deps.dex.SwapUniswapV3ExactInputSingle(base.UniswapV3SwapExactInputSingleRequest{
		Chain:               cfg.chain,
		RouterAddress:       cfg.routerAddress,
		TokenIn:             cfg.tokenAddress,
		TokenOut:            cfg.quoteAddress,
		Fee:                 preflight.EntryQuote.Fee,
		Recipient:           deps.wallet,
		AmountInWei:         entrySwap.ObservedAmountOutWei,
		AmountOutMinimumWei: exitMinOut,
		DryRun:              false,
		WaitForReceipt:      true,
	})
	if err != nil {
		t.Fatalf("SCW exit swap failed; token may remain in SCW: %v\npartial=%s", err, mustJSON(result))
	}
	result.ExitSwap = &exitSwap

	t.Logf("SCW round-trip result=%s", mustJSON(result))
}

// TestLiveSCWUniswapV3AdapterApproveSwapE2E sends real SCW transactions through
// the StrategyPolicyModule, but targets the Uniswap V3 strategy adapter instead
// of the DEX router. The adapter must already be deployed and allowed by policy.
func TestLiveSCWUniswapV3AdapterApproveSwapE2E(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_SCW_DEX_ALLOW_TX", false) {
		t.Skip("set CCTX_LIVE_SCW_DEX_ALLOW_TX=1 to send real SCW DEX transactions")
	}
	if !envBool("ENABLE_LIVE_TRADING", false) || envBool("DRY_RUN", true) {
		t.Fatal("SCW DEX adapter E2E requires ENABLE_LIVE_TRADING=true and DRY_RUN=false")
	}
	if envString("CCTX_LIVE_SCW_DEX_RISK_ACK", "") != scwDEXRiskAck {
		t.Fatalf("set CCTX_LIVE_SCW_DEX_RISK_ACK=%s to acknowledge real SCW transactions", scwDEXRiskAck)
	}

	cfg := loadSCWDEXConfig(t, true)
	if strings.TrimSpace(cfg.adapterAddress) == "" {
		t.Fatal("missing required env: SCW_DEX_UNISWAP_V3_ADAPTER")
	}
	cfg.approvalSpender = cfg.adapterAddress
	deps := newSCWDEXDeps(t, cfg)
	adapter, ok := deps.exchange.(base.UniswapV3AdapterExecutor)
	if !ok {
		t.Fatal("EVMDEX does not implement UniswapV3AdapterExecutor")
	}
	preflight := runSCWDEXPreflight(t, cfg, deps)
	requireWeiAtLeast(t, "SCW quote-token balance", preflight.QuoteBalance.BalanceWei, cfg.amountInWei)

	result := scwDEXAdapterE2EResult{Preflight: preflight}
	if envBool("SCW_DEX_REQUIRE_PREAPPROVED", false) {
		requireAllowanceAtLeast(t, "SCW quote token to adapter", preflight.QuoteAllowance.AllowanceWei, cfg.amountInWei)
	} else if !weiAtLeast(preflight.QuoteAllowance.AllowanceWei, cfg.amountInWei) {
		entryApproval, err := deps.dex.EnsureERC20Approval(base.ERC20ApprovalRequest{
			Chain:          cfg.chain,
			TokenAddress:   cfg.quoteAddress,
			OwnerAddress:   deps.wallet,
			SpenderAddress: cfg.adapterAddress,
			AmountWei:      cfg.amountInWei,
			DryRun:         false,
			WaitForReceipt: true,
		})
		if err != nil {
			t.Fatalf("SCW quote approval to adapter failed: %v\npartial=%s", err, mustJSON(result))
		}
		result.EntryApproval = &entryApproval
	}

	entryMinOut := firstNonEmpty(envString("SCW_DEX_MIN_TOKEN_OUT_WEI", ""), slippageFloorWei(t, preflight.EntryQuote.AmountOutWei, cfg.slippageBps))
	entrySwap, err := adapter.ExecuteUniswapV3AdapterAction(base.UniswapV3AdapterActionRequest{
		Chain:                   cfg.chain,
		AdapterAddress:          cfg.adapterAddress,
		Action:                  base.UniswapV3AdapterActionOpenPosition,
		AmountInWei:             cfg.amountInWei,
		AmountOutMinimumWei:     entryMinOut,
		ObservedTokenOutAddress: cfg.tokenAddress,
		Recipient:               deps.wallet,
		DryRun:                  false,
		WaitForReceipt:          true,
	})
	if err != nil {
		t.Fatalf("SCW adapter entry swap failed: %v\npartial=%s", err, mustJSON(result))
	}
	result.EntrySwap = &entrySwap

	if envBool("SCW_DEX_SKIP_EXIT", false) {
		t.Logf("SCW adapter entry-only result=%s", mustJSON(result))
		return
	}
	if !positiveWei(entrySwap.ObservedAmountOutWei) {
		t.Fatalf("SCW adapter entry swap reported no observed output; refusing to guess exit amount\nresult=%s", mustJSON(result))
	}

	exitQuote, err := deps.dex.QuoteUniswapV3ExactInputSingle(base.UniswapV3QuoteExactInputSingleRequest{
		Chain:         cfg.chain,
		QuoterAddress: cfg.quoterAddress,
		TokenIn:       cfg.tokenAddress,
		TokenOut:      cfg.quoteAddress,
		Fee:           preflight.EntryQuote.Fee,
		AmountInWei:   entrySwap.ObservedAmountOutWei,
	})
	if err != nil {
		t.Fatalf("SCW adapter exit quote failed: %v\npartial=%s", err, mustJSON(result))
	}
	result.ExitQuote = &exitQuote

	if envBool("SCW_DEX_REQUIRE_PREAPPROVED", false) {
		requireAllowanceAtLeast(t, "SCW token to adapter", preflight.TokenAllowance.AllowanceWei, entrySwap.ObservedAmountOutWei)
	} else if !weiAtLeast(preflight.TokenAllowance.AllowanceWei, entrySwap.ObservedAmountOutWei) {
		exitApproval, err := deps.dex.EnsureERC20Approval(base.ERC20ApprovalRequest{
			Chain:          cfg.chain,
			TokenAddress:   cfg.tokenAddress,
			OwnerAddress:   deps.wallet,
			SpenderAddress: cfg.adapterAddress,
			AmountWei:      entrySwap.ObservedAmountOutWei,
			DryRun:         false,
			WaitForReceipt: true,
		})
		if err != nil {
			t.Fatalf("SCW token approval to adapter failed: %v\npartial=%s", err, mustJSON(result))
		}
		result.ExitApproval = &exitApproval
	}

	exitMinOut := firstNonEmpty(envString("SCW_DEX_MIN_QUOTE_OUT_WEI", ""), slippageFloorWei(t, exitQuote.AmountOutWei, cfg.exitSlippageBps))
	exitSwap, err := adapter.ExecuteUniswapV3AdapterAction(base.UniswapV3AdapterActionRequest{
		Chain:                   cfg.chain,
		AdapterAddress:          cfg.adapterAddress,
		Action:                  base.UniswapV3AdapterActionClosePosition,
		AmountInWei:             entrySwap.ObservedAmountOutWei,
		AmountOutMinimumWei:     exitMinOut,
		ObservedTokenOutAddress: cfg.quoteAddress,
		Recipient:               deps.wallet,
		DryRun:                  false,
		WaitForReceipt:          true,
	})
	if err != nil {
		t.Fatalf("SCW adapter exit swap failed; token may remain in SCW: %v\npartial=%s", err, mustJSON(result))
	}
	result.ExitSwap = &exitSwap

	t.Logf("SCW adapter round-trip result=%s", mustJSON(result))
}

// TestLiveSCWUniswapV3ExitTokenBalance is a recovery helper for a failed
// entry-only/round-trip run. It swaps either SCW_DEX_EXIT_AMOUNT_IN_WEI or the
// SCW's current token balance back into the quote token.
func TestLiveSCWUniswapV3ExitTokenBalance(t *testing.T) {
	loadLiveEnvFiles(t)
	if !envBool("CCTX_LIVE_SCW_DEX_ALLOW_TX", false) {
		t.Skip("set CCTX_LIVE_SCW_DEX_ALLOW_TX=1 to send real SCW DEX transactions")
	}
	if !envBool("ENABLE_LIVE_TRADING", false) || envBool("DRY_RUN", true) {
		t.Fatal("SCW DEX recovery requires ENABLE_LIVE_TRADING=true and DRY_RUN=false")
	}
	if envString("CCTX_LIVE_SCW_DEX_RISK_ACK", "") != scwDEXRiskAck {
		t.Fatalf("set CCTX_LIVE_SCW_DEX_RISK_ACK=%s to acknowledge real SCW transactions", scwDEXRiskAck)
	}

	cfg := loadSCWDEXConfig(t, true)
	deps := newSCWDEXDeps(t, cfg)
	preflight := runSCWDEXPreflight(t, cfg, deps)
	amountInWei := firstNonEmpty(envString("SCW_DEX_EXIT_AMOUNT_IN_WEI", ""), preflight.TokenBalance.BalanceWei)
	if !positiveWei(amountInWei) {
		t.Fatal("no SCW token balance to exit; set SCW_DEX_EXIT_AMOUNT_IN_WEI if you want a specific recovery amount")
	}

	exitQuote, err := deps.dex.QuoteUniswapV3ExactInputSingle(base.UniswapV3QuoteExactInputSingleRequest{
		Chain:         cfg.chain,
		QuoterAddress: cfg.quoterAddress,
		TokenIn:       cfg.tokenAddress,
		TokenOut:      cfg.quoteAddress,
		Fee:           preflight.EntryQuote.Fee,
		AmountInWei:   amountInWei,
	})
	if err != nil {
		t.Fatalf("SCW recovery quote failed: %v", err)
	}
	approval, err := deps.dex.EnsureERC20Approval(base.ERC20ApprovalRequest{
		Chain:          cfg.chain,
		TokenAddress:   cfg.tokenAddress,
		OwnerAddress:   deps.wallet,
		SpenderAddress: cfg.approvalSpender,
		AmountWei:      amountInWei,
		DryRun:         false,
		WaitForReceipt: true,
	})
	if err != nil {
		t.Fatalf("SCW recovery approval failed: %v", err)
	}
	swap, err := deps.dex.SwapUniswapV3ExactInputSingle(base.UniswapV3SwapExactInputSingleRequest{
		Chain:               cfg.chain,
		RouterAddress:       cfg.routerAddress,
		TokenIn:             cfg.tokenAddress,
		TokenOut:            cfg.quoteAddress,
		Fee:                 preflight.EntryQuote.Fee,
		Recipient:           deps.wallet,
		AmountInWei:         amountInWei,
		AmountOutMinimumWei: slippageFloorWei(t, exitQuote.AmountOutWei, cfg.exitSlippageBps),
		DryRun:              false,
		WaitForReceipt:      true,
	})
	if err != nil {
		t.Fatalf("SCW recovery exit swap failed: %v", err)
	}

	t.Logf("SCW recovery result=%s", mustJSON(map[string]any{
		"preflight": preflight,
		"quote":     exitQuote,
		"approval":  approval,
		"swap":      swap,
	}))
}

type scwDEXConfig struct {
	chain             string
	chainID           int64
	rpcURL            string
	signerType        string
	smartWallet       string
	sessionPrivateKey string
	sessionKeyID      string
	policyID          string
	relayerURL        string
	relayerAuthToken  string
	sessionDeadline   int64
	asset             string
	tokenAddress      string
	quoteAddress      string
	quoteSymbol       string
	poolAddress       string
	quoterAddress     string
	routerAddress     string
	adapterAddress    string
	approvalSpender   string
	fee               uint32
	amountInWei       string
	slippageBps       uint32
	exitSlippageBps   uint32
}

type scwDEXDeps struct {
	exchange    base.Exchange
	dex         base.UniswapV3Executor
	dexReader   base.EVMDEXReader
	dexExecutor base.EVMDEXExecutor
	wallet      string
}

type scwDEXPreflight struct {
	Wallet          string                              `json:"wallet"`
	NativeBalances  map[string]float64                  `json:"native_balances,omitempty"`
	Pool            *base.UniswapV3PoolInfo             `json:"pool,omitempty"`
	EntryQuote      base.UniswapV3QuoteExactInputSingle `json:"entry_quote"`
	QuoteBalance    base.EVMERC20Balance                `json:"quote_balance"`
	TokenBalance    base.EVMERC20Balance                `json:"token_balance"`
	QuoteAllowance  base.EVMERC20Allowance              `json:"quote_allowance"`
	TokenAllowance  base.EVMERC20Allowance              `json:"token_allowance"`
	ApprovalSpender string                              `json:"approval_spender"`
}

type scwDEXE2EResult struct {
	Preflight     scwDEXPreflight                           `json:"preflight"`
	EntryApproval *base.ERC20ApprovalResult                 `json:"entry_approval,omitempty"`
	EntrySwap     *base.UniswapV3SwapExactInputSingleResult `json:"entry_swap,omitempty"`
	ExitQuote     *base.UniswapV3QuoteExactInputSingle      `json:"exit_quote,omitempty"`
	ExitApproval  *base.ERC20ApprovalResult                 `json:"exit_approval,omitempty"`
	ExitSwap      *base.UniswapV3SwapExactInputSingleResult `json:"exit_swap,omitempty"`
}

type scwDEXAdapterE2EResult struct {
	Preflight     scwDEXPreflight                      `json:"preflight"`
	EntryApproval *base.ERC20ApprovalResult            `json:"entry_approval,omitempty"`
	EntrySwap     *base.UniswapV3AdapterActionResult   `json:"entry_swap,omitempty"`
	ExitQuote     *base.UniswapV3QuoteExactInputSingle `json:"exit_quote,omitempty"`
	ExitApproval  *base.ERC20ApprovalResult            `json:"exit_approval,omitempty"`
	ExitSwap      *base.UniswapV3AdapterActionResult   `json:"exit_swap,omitempty"`
}

func loadSCWDEXConfig(t *testing.T, requireRelayer bool) scwDEXConfig {
	t.Helper()
	cfg := scwDEXConfig{
		chain:             envString("BASIS_CHAIN", "bsc"),
		chainID:           envInt64("EVM_DEX_CHAIN_ID", envInt64("BSC_CHAIN_ID", 56)),
		rpcURL:            firstNonEmpty(envString("EVM_DEX_RPC_URL", ""), envString("BSC_RPC_URL", "")),
		signerType:        envString("EVM_DEX_SIGNER_TYPE", "session_key"),
		smartWallet:       envString("EVM_DEX_SMART_WALLET_ADDRESS", ""),
		sessionPrivateKey: firstNonEmpty(envString("EVM_DEX_SESSION_PRIVATE_KEY", ""), envString("SESSION_PRIVATE_KEY", "")),
		sessionKeyID:      envString("EVM_DEX_SESSION_KEY_ID", ""),
		policyID:          envString("EVM_DEX_POLICY_ID", ""),
		relayerURL:        envString("EVM_DEX_RELAYER_URL", ""),
		relayerAuthToken:  envString("EVM_DEX_RELAYER_AUTH_TOKEN", ""),
		sessionDeadline:   envInt64("EVM_DEX_SESSION_DEADLINE_SECONDS", 300),
		asset:             envString("BASIS_ASSET", "SCW"),
		tokenAddress:      envString("BASIS_TOKEN_ADDRESS", ""),
		quoteAddress:      envString("BASIS_QUOTE_ADDRESS", scenarioUSDT),
		quoteSymbol:       envString("BASIS_QUOTE_SYMBOL", "USDT"),
		poolAddress:       envString("BASIS_POOL_ADDRESS", ""),
		quoterAddress:     envString("UNISWAP_V3_QUOTER", scenarioQuoterV2),
		routerAddress:     envString("UNISWAP_V3_ROUTER", scenarioSwapRouter02),
		adapterAddress:    envString("SCW_DEX_UNISWAP_V3_ADAPTER", ""),
		fee:               envUint32("UNISWAP_V3_FEE", 0),
		amountInWei:       envString("BASIS_AMOUNT_IN_WEI", ""),
		slippageBps:       envUint32("BASIS_SLIPPAGE_BPS", 100),
		exitSlippageBps:   envUint32("BASIS_EXIT_SLIPPAGE_BPS", 100),
	}
	cfg.approvalSpender = firstNonEmpty(envString("SCW_DEX_APPROVAL_SPENDER", ""), cfg.routerAddress)
	if !isSCWSigner(cfg.signerType) {
		t.Fatalf("SCW DEX tests require EVM_DEX_SIGNER_TYPE=session_key/scw/scw_session, got %q", cfg.signerType)
	}

	required := map[string]string{
		"EVM_DEX_RPC_URL or BSC_RPC_URL":                     cfg.rpcURL,
		"EVM_DEX_SMART_WALLET_ADDRESS":                       cfg.smartWallet,
		"EVM_DEX_SESSION_PRIVATE_KEY or SESSION_PRIVATE_KEY": cfg.sessionPrivateKey,
		"BASIS_TOKEN_ADDRESS":                                cfg.tokenAddress,
		"BASIS_AMOUNT_IN_WEI":                                cfg.amountInWei,
		"UNISWAP_V3_QUOTER":                                  cfg.quoterAddress,
		"UNISWAP_V3_ROUTER":                                  cfg.routerAddress,
		"SCW_DEX_APPROVAL_SPENDER or UNISWAP_V3_ROUTER":      cfg.approvalSpender,
	}
	if cfg.fee == 0 {
		required["BASIS_POOL_ADDRESS or UNISWAP_V3_FEE"] = cfg.poolAddress
	}
	if requireRelayer {
		required["EVM_DEX_RELAYER_URL"] = cfg.relayerURL
		required["EVM_DEX_SESSION_KEY_ID"] = cfg.sessionKeyID
		required["EVM_DEX_POLICY_ID"] = cfg.policyID
	}
	for name, value := range required {
		if strings.TrimSpace(value) == "" {
			t.Fatalf("missing required env: %s", name)
		}
	}
	return cfg
}

func newSCWDEXDeps(t *testing.T, cfg scwDEXConfig) scwDEXDeps {
	t.Helper()
	dexExchange, err := exchanges.NewEVMDEX(map[string]any{
		"signer_type":              cfg.signerType,
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
		"strategy_id":              envString("SCW_DEX_STRATEGY_ID", "scw-dex-e2e"),
	})
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
	return scwDEXDeps{
		exchange:    dexExchange,
		dex:         dex,
		dexReader:   dexReader,
		dexExecutor: dexExecutor,
		wallet:      dexExecutor.WalletAddress(),
	}
}

func runSCWDEXPreflight(t *testing.T, cfg scwDEXConfig, deps scwDEXDeps) scwDEXPreflight {
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

	nativeBalances, err := deps.exchange.FetchBalance()
	if err != nil {
		t.Fatalf("FetchBalance native: %v", err)
	}
	quoteBalance, err := deps.dexReader.FetchERC20Balance(base.EVMERC20BalanceRequest{
		Chain:        cfg.chain,
		TokenAddress: cfg.quoteAddress,
		OwnerAddress: deps.wallet,
	})
	if err != nil {
		t.Fatalf("FetchERC20Balance quote: %v", err)
	}
	tokenBalance, err := deps.dexReader.FetchERC20Balance(base.EVMERC20BalanceRequest{
		Chain:        cfg.chain,
		TokenAddress: cfg.tokenAddress,
		OwnerAddress: deps.wallet,
	})
	if err != nil {
		t.Fatalf("FetchERC20Balance token: %v", err)
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
		SpenderAddress: cfg.approvalSpender,
	})
	if err != nil {
		t.Fatalf("FetchERC20Allowance quote: %v", err)
	}
	tokenAllowance, err := deps.dexReader.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
		Chain:          cfg.chain,
		TokenAddress:   cfg.tokenAddress,
		OwnerAddress:   deps.wallet,
		SpenderAddress: cfg.approvalSpender,
	})
	if err != nil {
		t.Fatalf("FetchERC20Allowance token: %v", err)
	}
	return scwDEXPreflight{
		Wallet:          deps.wallet,
		NativeBalances:  nativeBalances,
		Pool:            poolInfo,
		EntryQuote:      entryQuote,
		QuoteBalance:    quoteBalance,
		TokenBalance:    tokenBalance,
		QuoteAllowance:  quoteAllowance,
		TokenAllowance:  tokenAllowance,
		ApprovalSpender: cfg.approvalSpender,
	}
}

func requireWeiAtLeast(t *testing.T, label string, actualWei string, requiredWei string) {
	t.Helper()
	actual := mustBigInt(t, actualWei)
	required := mustBigInt(t, requiredWei)
	if actual.Cmp(required) < 0 {
		t.Fatalf("%s too low: actual=%s required=%s", label, actualWei, requiredWei)
	}
}

func slippageFloorWei(t *testing.T, amountWei string, bps uint32) string {
	t.Helper()
	amount := mustBigInt(t, amountWei)
	if bps > 10_000 {
		t.Fatalf("invalid slippage bps: %d", bps)
	}
	numerator := new(big.Int).Mul(amount, big.NewInt(int64(10_000-bps)))
	return numerator.Div(numerator, big.NewInt(10_000)).String()
}

func positiveWei(value string) bool {
	parsed, ok := new(big.Int).SetString(strings.TrimSpace(value), 10)
	return ok && parsed.Sign() > 0
}

func weiAtLeast(actualWei string, requiredWei string) bool {
	actual, ok := new(big.Int).SetString(strings.TrimSpace(actualWei), 10)
	if !ok {
		return false
	}
	required, ok := new(big.Int).SetString(strings.TrimSpace(requiredWei), 10)
	if !ok {
		return false
	}
	return actual.Cmp(required) >= 0
}
