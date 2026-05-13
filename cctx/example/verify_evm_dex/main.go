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

	mode := flag.String("mode", envOrDefault("EVM_DEX_VERIFY_MODE", "call"), "verification mode: call, send, both")
	rpcURL := flag.String("rpc-url", envOrDefault("EVM_DEX_RPC_URL", ""), "rpc url")
	privateKey := flag.String("private-key", envOrDefault("EVM_DEX_PRIVATE_KEY", ""), "EOA private key")
	castBinary := flag.String("cast-binary", envOrDefault("EVM_DEX_CAST_BINARY", "cast"), "foundry cast binary")
	chain := flag.String("chain", envOrDefault("EVM_DEX_CHAIN", ""), "optional chain slug used for rpc selection")
	to := flag.String("to", envOrDefault("EVM_DEX_TO", ""), "target address; defaults to wallet address")
	calldata := flag.String("calldata", envOrDefault("EVM_DEX_CALLDATA", "0x"), "hex calldata")
	valueWei := flag.String("value-wei", envOrDefault("EVM_DEX_VALUE_WEI", "0"), "wei value used for send mode")
	gasLimit := flag.Uint64("gas-limit", envOrDefaultUint64("EVM_DEX_GAS_LIMIT", 21000), "gas limit for send mode")
	allowSend := flag.Bool("allow-send", envOrDefaultBool("EVM_DEX_ALLOW_SEND", false), "allow a real on-chain transaction")
	chainID := flag.Int64("chain-id", envOrDefaultInt64("EVM_DEX_CHAIN_ID", exchanges.EVMDEXDefaultChainID), "default chain id")
	flag.Parse()

	if strings.TrimSpace(*rpcURL) == "" {
		log.Fatal("rpc url required: pass --rpc-url or set EVM_DEX_RPC_URL")
	}
	if strings.TrimSpace(*privateKey) == "" {
		log.Fatal("private key required: pass --private-key or set EVM_DEX_PRIVATE_KEY")
	}

	raw, err := exchanges.NewEVMDEX(map[string]any{
		"private_key": *privateKey,
		"rpc_url":     *rpcURL,
		"chain_id":    *chainID,
		"cast_binary": *castBinary,
	})
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

	targetAddress := strings.TrimSpace(*to)
	if targetAddress == "" {
		targetAddress = walletAddress
	}

	request := base.EVMDEXRequest{
		Chain:           strings.TrimSpace(*chain),
		ContractAddress: targetAddress,
		Calldata:        strings.TrimSpace(*calldata),
	}

	fmt.Println("DEX verifier configuration")
	fmt.Printf("  wallet: %s\n", walletAddress)
	fmt.Printf("  target: %s\n", targetAddress)
	fmt.Printf("  mode:   %s\n", strings.ToLower(strings.TrimSpace(*mode)))
	fmt.Printf("  chain:  %s\n", strings.TrimSpace(*chain))

	switch strings.ToLower(strings.TrimSpace(*mode)) {
	case "call":
		runCall(executor, request)
	case "send":
		runSend(executor, request, *valueWei, *gasLimit, *allowSend)
	case "both":
		runCall(executor, request)
		runSend(executor, request, *valueWei, *gasLimit, *allowSend)
	default:
		log.Fatalf("unsupported mode: %s", *mode)
	}
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

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envOrDefaultBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
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
