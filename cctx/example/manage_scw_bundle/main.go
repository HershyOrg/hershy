package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/HershyOrg/hershy/cctx/scw"
)

func main() {
	var (
		mode             = flag.String("mode", envOrDefault("SCW_BUNDLE_MODE", "create"), "mode: create, update-address, update-module, show, balance, deploy")
		storeRoot        = flag.String("store", envOrDefault("SCW_BUNDLE_STORE", ".scw/bundles"), "bundle store root")
		bundlePath       = flag.String("bundle", envOrDefault("SCW_BUNDLE_PATH", ""), "explicit bundle JSON path")
		ownerAddress     = flag.String("owner", envOrDefault("SCW_OWNER_ADDRESS", ""), "owner EOA address")
		chainID          = flag.Int64("chain-id", envOrDefaultInt64("SCW_CHAIN_ID", 0), "target chain id")
		policyID         = flag.String("policy-id", envOrDefault("SCW_POLICY_ID", "default"), "policy id")
		smartWallet      = flag.String("smart-wallet", envOrDefault("SCW_SMART_WALLET_ADDRESS", ""), "deployed or predicted SCW address for update-address mode")
		safeSingleton    = flag.String("safe-singleton", envOrDefault("SCW_SAFE_SINGLETON_ADDRESS", ""), "Safe singleton address")
		safeFactory      = flag.String("safe-factory", envOrDefault("SCW_SAFE_PROXY_FACTORY_ADDRESS", ""), "Safe proxy factory address")
		safeFallback     = flag.String("safe-fallback-handler", envOrDefault("SCW_SAFE_FALLBACK_HANDLER_ADDRESS", ""), "Safe fallback handler address")
		proxyCode        = flag.String("proxy-creation-code", envOrDefault("SCW_SAFE_PROXY_CREATION_CODE", ""), "optional Safe proxy creation code for address prediction")
		threshold        = flag.Uint64("threshold", envOrDefaultUint64("SCW_SAFE_THRESHOLD", 1), "Safe owner threshold")
		saltNonce        = flag.String("salt-nonce", envOrDefault("SCW_SAFE_SALT_NONCE", ""), "optional Safe create2 salt nonce")
		sessionKey       = flag.String("session-private-key", envOrDefault("SCW_SESSION_PRIVATE_KEY", ""), "optional session private key")
		setupTarget      = flag.String("setup-delegate-target", envOrDefault("SCW_SETUP_DELEGATE_TARGET", ""), "optional Safe setup delegate target")
		setupCalldata    = flag.String("setup-delegate-calldata", envOrDefault("SCW_SETUP_DELEGATE_CALLDATA", ""), "optional Safe setup delegate calldata")
		moduleAddress    = flag.String("strategy-policy-module", envOrDefault("SCW_STRATEGY_POLICY_MODULE_ADDRESS", ""), "optional StrategyPolicyModule address")
		validAfter       = flag.Int64("session-valid-after", envOrDefaultInt64("SCW_SESSION_VALID_AFTER_UNIX", 0), "session valid-after unix timestamp")
		validUntil       = flag.Int64("session-valid-until", envOrDefaultInt64("SCW_SESSION_VALID_UNTIL_UNIX", 0), "session valid-until unix timestamp")
		allowedContracts = flag.String("allowed-contracts", envOrDefault("SCW_ALLOWED_CONTRACTS", ""), "comma-separated allowed target addresses")
		allowedSelectors = flag.String("allowed-selectors", envOrDefault("SCW_ALLOWED_SELECTORS", ""), "comma-separated allowed function selectors")
		maxValueWei      = flag.String("max-value-wei", envOrDefault("SCW_MAX_VALUE_WEI", "0"), "max native value in wei")
		maxGasLimit      = flag.Uint64("max-gas-limit", envOrDefaultUint64("SCW_MAX_GAS_LIMIT", 0), "max execution gas limit")
		deadlineGrace    = flag.Int64("deadline-grace-seconds", envOrDefaultInt64("SCW_DEADLINE_GRACE_SECONDS", 30), "relayer deadline grace seconds")
		rpcURL           = flag.String("rpc-url", envOrDefault("SCW_RPC_URL", envOrDefault("EVM_DEX_RPC_URL", "")), "RPC URL for balance mode")
		nativeSymbol     = flag.String("native-symbol", envOrDefault("SCW_NATIVE_SYMBOL", "ETH"), "native asset symbol for balance mode")
		nativeDecimals   = flag.Uint64("native-decimals", envOrDefaultUint64("SCW_NATIVE_DECIMALS", 18), "native asset decimals for balance mode")
		erc20Address     = flag.String("erc20", envOrDefault("SCW_ERC20_ADDRESS", ""), "optional ERC20 token address for balanceOf")
		erc20Symbol      = flag.String("erc20-symbol", envOrDefault("SCW_ERC20_SYMBOL", "ERC20"), "ERC20 symbol for balance output")
		erc20Decimals    = flag.Uint64("erc20-decimals", envOrDefaultUint64("SCW_ERC20_DECIMALS", 18), "ERC20 decimals for balance output")
		privateKey       = flag.String("private-key", envOrDefault("SCW_DEPLOYER_PRIVATE_KEY", envOrDefault("EVM_DEX_PRIVATE_KEY", "")), "deployer private key for deploy mode")
		allowDeploy      = flag.Bool("allow-deploy", envOrDefaultBool("SCW_ALLOW_DEPLOY", false), "submit the real deployment transaction")
		receiptTimeout   = flag.Int64("receipt-timeout-seconds", envOrDefaultInt64("SCW_RECEIPT_TIMEOUT_SECONDS", 180), "deployment receipt wait timeout")
	)
	flag.Parse()

	identity := scw.BundleIdentityOptions{
		StoreRoot:    *storeRoot,
		BundlePath:   *bundlePath,
		OwnerAddress: *ownerAddress,
		ChainID:      *chainID,
		PolicyID:     *policyID,
	}
	manager := scw.NewBundleManager()

	var (
		output scw.BundleOperationResult
		err    error
	)
	switch strings.ToLower(strings.TrimSpace(*mode)) {
	case "create":
		output, err = manager.CreateBundle(scw.BundleCreateOptions{
			BundleIdentityOptions:      identity,
			SafeSingletonAddress:       *safeSingleton,
			SafeProxyFactoryAddress:    *safeFactory,
			SafeFallbackHandlerAddress: *safeFallback,
			ProxyCreationCode:          *proxyCode,
			Threshold:                  *threshold,
			SaltNonce:                  *saltNonce,
			SessionPrivateKey:          *sessionKey,
			SetupDelegateTarget:        *setupTarget,
			SetupDelegateCalldata:      *setupCalldata,
			StrategyPolicyModule:       *moduleAddress,
			SessionValidAfterUnix:      *validAfter,
			SessionValidUntilUnix:      *validUntil,
			AllowedContractAddresses:   splitCSV(*allowedContracts),
			AllowedFunctionSelectors:   splitCSV(*allowedSelectors),
			MaxValueWei:                *maxValueWei,
			MaxGasLimit:                *maxGasLimit,
			DeadlineGraceSeconds:       *deadlineGrace,
		})
	case "update-address":
		output, err = manager.UpdateSmartWalletAddress(scw.BundleSmartWalletUpdateOptions{
			BundleIdentityOptions: identity,
			SmartWalletAddress:    *smartWallet,
		})
	case "update-module":
		output, err = manager.UpdateStrategyPolicyModule(scw.BundleStrategyPolicyModuleUpdateOptions{
			BundleIdentityOptions:    identity,
			StrategyPolicyModule:     *moduleAddress,
			SessionValidAfterUnix:    *validAfter,
			SessionValidUntilUnix:    *validUntil,
			AllowedContractAddresses: splitCSV(*allowedContracts),
			AllowedFunctionSelectors: splitCSV(*allowedSelectors),
			MaxValueWei:              *maxValueWei,
			MaxGasLimit:              *maxGasLimit,
		})
	case "show":
		output, err = manager.ShowBundle(identity)
	case "balance":
		output, err = manager.ReadBalance(context.Background(), scw.BundleBalanceOptions{
			BundleIdentityOptions: identity,
			RPCURL:                *rpcURL,
			NativeSymbol:          *nativeSymbol,
			NativeDecimals:        *nativeDecimals,
			ERC20Address:          *erc20Address,
			ERC20Symbol:           *erc20Symbol,
			ERC20Decimals:         *erc20Decimals,
		})
	case "deploy":
		output, err = manager.DeployBundle(context.Background(), scw.BundleDeployOptions{
			BundleIdentityOptions: identity,
			RPCURL:                *rpcURL,
			PrivateKey:            *privateKey,
			AllowDeploy:           *allowDeploy,
			ReceiptTimeoutSeconds: *receiptTimeout,
			NativeDecimals:        *nativeDecimals,
		})
	default:
		log.Fatalf("unsupported mode: %s", *mode)
	}
	if err != nil {
		log.Fatal(err)
	}
	printOutput(output)
}

func printOutput(output scw.BundleOperationResult) {
	encoded, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		log.Fatalf("marshal output: %v", err)
	}
	if _, err := os.Stdout.Write(append(encoded, '\n')); err != nil {
		log.Fatalf("write output: %v", err)
	}
}

func splitCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			out = append(out, value)
		}
	}
	return out
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

func envOrDefaultBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
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
