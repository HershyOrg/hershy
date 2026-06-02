package main

import (
	"bufio"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/exchanges"
)

type walletAddresser interface {
	WalletAddress() string
}

func main() {
	loadDotEnvFromWorkingTree()

	modeFlag := flag.String("mode", "", "verification mode: smoke, balance, erc20, quote, call, send, both (default: EVM_DEX_VERIFY_MODE or smoke)")
	rpcURLFlag := flag.String("rpc-url", "", "rpc url (or EVM_DEX_RPC_URL)")
	privateKeyFlag := flag.String("private-key", "", "EOA private key (or EVM_DEX_PRIVATE_KEY)")
	castBinary := flag.String("cast-binary", envOrDefault("EVM_DEX_CAST_BINARY", "cast"), "foundry cast binary")
	chainFlag := flag.String("chain", "", "optional chain slug used for rpc selection (or EVM_DEX_CHAIN)")
	toFlag := flag.String("to", "", "target address; defaults to wallet address (or EVM_DEX_TO)")
	calldataFlag := flag.String("calldata", "", "hex calldata (or EVM_DEX_CALLDATA)")
	tokenFlag := flag.String("token", envOrDefault("EVM_DEX_TOKEN", ""), "ERC20 token address for erc20 mode")
	ownerFlag := flag.String("owner", envOrDefault("EVM_DEX_OWNER", ""), "owner address for erc20 mode; defaults to wallet")
	spenderFlag := flag.String("spender", envOrDefault("EVM_DEX_SPENDER", ""), "spender address for erc20 allowance checks")
	routerFlag := flag.String("router", envOrDefault("EVM_DEX_ROUTER", ""), "DEX router address for quote mode")
	protocolFlag := flag.String("protocol", envOrDefault("EVM_DEX_PROTOCOL", "uniswap_v2"), "DEX quote protocol")
	amountInWeiFlag := flag.String("amount-in-wei", envOrDefault("EVM_DEX_AMOUNT_IN_WEI", ""), "exact input amount in wei for quote mode")
	pathFlag := flag.String("path", envOrDefault("EVM_DEX_PATH", ""), "comma-separated token path for quote mode")
	tokenInFlag := flag.String("token-in", envOrDefault("EVM_DEX_TOKEN_IN", ""), "token-in address for quote mode when --path is omitted")
	tokenOutFlag := flag.String("token-out", envOrDefault("EVM_DEX_TOKEN_OUT", ""), "token-out address for quote mode when --path is omitted")
	valueWeiFlag := flag.String("value-wei", "", "wei value used for send mode (or EVM_DEX_VALUE_WEI)")
	gasLimit := flag.Uint64("gas-limit", envOrDefaultUint64("EVM_DEX_GAS_LIMIT", 21000), "gas limit for send mode")
	allowSend := flag.Bool("allow-send", false, "allow a real on-chain transaction")
	chainID := flag.Int64("chain-id", envOrDefaultInt64("EVM_DEX_CHAIN_ID", exchanges.EVMDEXDefaultChainID), "default chain id")
	flag.Parse()

	mode := firstNonEmpty(*modeFlag, envOrDefault("EVM_DEX_VERIFY_MODE", "smoke"))
	rpcURL := firstNonEmpty(*rpcURLFlag, envOrDefault("EVM_DEX_RPC_URL", ""))
	privateKey := firstNonEmpty(*privateKeyFlag, envOrDefault("EVM_DEX_PRIVATE_KEY", ""))
	chain := firstNonEmpty(*chainFlag, envOrDefault("EVM_DEX_CHAIN", ""))
	to := firstNonEmpty(*toFlag, envOrDefault("EVM_DEX_TO", ""))
	calldata := firstNonEmpty(*calldataFlag, envOrDefault("EVM_DEX_CALLDATA", "0x"))
	valueWei := firstNonEmpty(*valueWeiFlag, envOrDefault("EVM_DEX_VALUE_WEI", "0"))

	if strings.TrimSpace(rpcURL) == "" {
		log.Fatal("rpc url required: pass --rpc-url or set EVM_DEX_RPC_URL")
	}
	if strings.TrimSpace(privateKey) == "" {
		log.Fatal("private key required: pass --private-key or set EVM_DEX_PRIVATE_KEY")
	}

	config := map[string]any{
		"private_key": privateKey,
		"chain_id":    *chainID,
		"cast_binary": *castBinary,
	}
	if chainSlug := strings.TrimSpace(chain); chainSlug != "" {
		config["rpc_urls"] = map[string]any{chainSlug: strings.TrimSpace(rpcURL)}
		config["chain_ids"] = map[string]any{chainSlug: *chainID}
	} else {
		config["rpc_url"] = rpcURL
	}

	raw, err := exchanges.NewEVMDEX(config)
	if err != nil {
		log.Fatalf("failed to create evm_dex: %v", err)
	}

	executor, ok := raw.(base.EVMDEXExecutor)
	if !ok {
		log.Fatal("exchange does not expose EVMDEXExecutor capability")
	}

	walletAddress := ""
	if addresser, ok := raw.(walletAddresser); ok {
		walletAddress = addresser.WalletAddress()
	}
	if walletAddress == "" {
		log.Fatal("failed to derive wallet address from private key")
	}

	targetAddress := strings.TrimSpace(to)
	if targetAddress == "" {
		targetAddress = walletAddress
	}

	request := base.EVMDEXRequest{
		Chain:           strings.TrimSpace(chain),
		ContractAddress: targetAddress,
		Calldata:        strings.TrimSpace(calldata),
	}

	fmt.Println("DEX verifier configuration")
	fmt.Printf("  wallet: %s\n", walletAddress)
	fmt.Printf("  target: %s\n", targetAddress)
	fmt.Printf("  mode:   %s\n", strings.ToLower(strings.TrimSpace(mode)))
	fmt.Printf("  chain:  %s\n", strings.TrimSpace(chain))
	fmt.Printf("  id:     %d\n", *chainID)

	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "smoke":
		runSmoke(raw, executor, request)
	case "balance":
		runBalance(raw)
	case "erc20":
		reader, ok := raw.(base.EVMDEXReader)
		if !ok {
			log.Fatal("exchange does not expose EVMDEXReader capability")
		}
		runERC20(reader, strings.TrimSpace(chain), strings.TrimSpace(*tokenFlag), firstNonEmpty(*ownerFlag, walletAddress), strings.TrimSpace(*spenderFlag))
	case "quote":
		reader, ok := raw.(base.EVMDEXReader)
		if !ok {
			log.Fatal("exchange does not expose EVMDEXReader capability")
		}
		runQuote(reader, strings.TrimSpace(chain), strings.TrimSpace(*protocolFlag), strings.TrimSpace(*routerFlag), strings.TrimSpace(*amountInWeiFlag), quotePath(*pathFlag, *tokenInFlag, *tokenOutFlag))
	case "call":
		runCall(executor, request)
	case "send":
		runSend(executor, request, valueWei, *gasLimit, *allowSend)
	case "both":
		runCall(executor, request)
		runSend(executor, request, valueWei, *gasLimit, *allowSend)
	default:
		log.Fatalf("unsupported mode: %s", mode)
	}
}

func runSmoke(exchange base.Exchange, executor base.EVMDEXExecutor, request base.EVMDEXRequest) {
	fmt.Println("\n[smoke] checking rpc balance path")
	runBalance(exchange)

	calldata := strings.TrimSpace(request.Calldata)
	if calldata == "" || strings.EqualFold(calldata, "0x") {
		fmt.Println("\n[smoke] contract call skipped: pass --to and --calldata to exercise ExecuteEVMCall")
		fmt.Println("[smoke] success")
		return
	}

	runCall(executor, request)
	fmt.Println("[smoke] success")
}

func runBalance(exchange base.Exchange) {
	fmt.Println("\n[balance] executing eth_getBalance")
	balance, err := exchange.FetchBalance()
	if err != nil {
		log.Fatalf("[balance] failed: %v", err)
	}
	fmt.Printf("[balance] success\n")
	for asset, amount := range balance {
		fmt.Printf("  %s: %.18f\n", asset, amount)
	}
}

func runERC20(reader base.EVMDEXReader, chain, token, owner, spender string) {
	if strings.TrimSpace(token) == "" {
		log.Fatal("[erc20] token required: pass --token or set EVM_DEX_TOKEN")
	}
	fmt.Println("\n[erc20] reading token metadata and balance")
	metadata, err := reader.FetchERC20Metadata(base.EVMERC20MetadataRequest{
		Chain:        chain,
		TokenAddress: token,
	})
	if err != nil {
		log.Fatalf("[erc20] metadata failed: %v", err)
	}
	fmt.Printf("[erc20] metadata success\n")
	fmt.Printf("  token:    %s\n", metadata.TokenAddress)
	fmt.Printf("  symbol:   %s\n", metadata.Symbol)
	fmt.Printf("  decimals: %d\n", metadata.Decimals)

	balance, err := reader.FetchERC20Balance(base.EVMERC20BalanceRequest{
		Chain:        chain,
		TokenAddress: token,
		OwnerAddress: owner,
	})
	if err != nil {
		log.Fatalf("[erc20] balance failed: %v", err)
	}
	fmt.Printf("[erc20] balance success\n")
	fmt.Printf("  owner: %s\n", balance.OwnerAddress)
	fmt.Printf("  wei:   %s\n", balance.BalanceWei)
	fmt.Printf("  human: %s\n", balance.BalanceFormatted)

	if strings.TrimSpace(spender) == "" {
		return
	}
	allowance, err := reader.FetchERC20Allowance(base.EVMERC20AllowanceRequest{
		Chain:          chain,
		TokenAddress:   token,
		OwnerAddress:   owner,
		SpenderAddress: spender,
	})
	if err != nil {
		log.Fatalf("[erc20] allowance failed: %v", err)
	}
	fmt.Printf("[erc20] allowance success\n")
	fmt.Printf("  spender: %s\n", allowance.SpenderAddress)
	fmt.Printf("  wei:     %s\n", allowance.AllowanceWei)
	fmt.Printf("  human:   %s\n", allowance.AllowanceFormatted)
}

func runQuote(reader base.EVMDEXReader, chain, protocol, router, amountInWei string, path []string) {
	if strings.TrimSpace(router) == "" {
		log.Fatal("[quote] router required: pass --router or set EVM_DEX_ROUTER")
	}
	if strings.TrimSpace(amountInWei) == "" {
		log.Fatal("[quote] amount-in-wei required: pass --amount-in-wei or set EVM_DEX_AMOUNT_IN_WEI")
	}
	if len(path) < 2 {
		log.Fatal("[quote] path requires at least 2 token addresses: pass --path or --token-in/--token-out")
	}
	fmt.Println("\n[quote] reading router getAmountsOut")
	quote, err := reader.QuoteExactInput(base.EVMDEXQuoteRequest{
		Chain:         chain,
		Protocol:      protocol,
		RouterAddress: router,
		AmountInWei:   amountInWei,
		Path:          path,
	})
	if err != nil {
		log.Fatalf("[quote] failed: %v", err)
	}
	fmt.Printf("[quote] success\n")
	fmt.Printf("  protocol:   %s\n", quote.Protocol)
	fmt.Printf("  router:     %s\n", quote.RouterAddress)
	fmt.Printf("  amount in:  %s\n", quote.AmountInWei)
	fmt.Printf("  amount out: %s\n", quote.AmountOutWei)
	fmt.Printf("  path:       %s\n", strings.Join(quote.Path, " -> "))
	fmt.Printf("  amounts:    %s\n", strings.Join(quote.AmountsWei, " -> "))
}

func runCall(executor base.EVMDEXExecutor, request base.EVMDEXRequest) {
	fmt.Println("\n[call] executing cast call")
	result, err := executor.ExecuteEVMCall(request)
	if err != nil {
		log.Fatalf("[call] failed: %v", err)
	}
	fmt.Printf("[call] success\n")
	fmt.Printf("  rpc:    %s\n", result.RPCURL)
	fmt.Printf("  output: %s\n", result.RawOutput)
}

func runSend(executor base.EVMDEXExecutor, request base.EVMDEXRequest, valueWei string, gasLimit uint64, allowSend bool) {
	if !allowSend {
		log.Fatal("[send] blocked: pass --allow-send or set EVM_DEX_ALLOW_SEND=1 to submit a real transaction")
	}
	sendRequest := request
	sendRequest.Value = strings.TrimSpace(valueWei) + "wei"
	sendRequest.GasLimit = gasLimit

	fmt.Println("\n[send] executing cast send")
	fmt.Println("  this submits a real on-chain transaction and consumes gas")
	result, err := executor.ExecuteEVMTransaction(sendRequest)
	if err != nil {
		log.Fatalf("[send] failed: %v", err)
	}
	fmt.Printf("[send] success\n")
	fmt.Printf("  rpc:     %s\n", result.RPCURL)
	fmt.Printf("  tx hash: %s\n", result.TxHash)
}

func quotePath(rawPath, tokenIn, tokenOut string) []string {
	if strings.TrimSpace(rawPath) != "" {
		parts := strings.Split(rawPath, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if value := strings.TrimSpace(part); value != "" {
				out = append(out, value)
			}
		}
		return out
	}
	if strings.TrimSpace(tokenIn) != "" && strings.TrimSpace(tokenOut) != "" {
		return []string{strings.TrimSpace(tokenIn), strings.TrimSpace(tokenOut)}
	}
	return nil
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envOrDefaultInt64(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envOrDefaultUint64(key string, fallback uint64) uint64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func loadDotEnvFromWorkingTree() {
	cwd, err := os.Getwd()
	if err != nil {
		return
	}
	for _, candidate := range dotenvCandidates(cwd) {
		if loadDotEnvFile(candidate) {
			return
		}
	}
}

func dotenvCandidates(startDir string) []string {
	candidates := []string{}
	seen := map[string]bool{}
	current := startDir
	for {
		candidate := filepath.Join(current, ".env")
		if !seen[candidate] {
			candidates = append(candidates, candidate)
			seen[candidate] = true
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return candidates
}

func loadDotEnvFile(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	loaded := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		if strings.TrimSpace(os.Getenv(key)) != "" {
			continue
		}
		value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if err := os.Setenv(key, value); err == nil {
			loaded = true
		}
	}
	return loaded
}
