package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/HershyOrg/hershy/cctx/onboarding"
)

func main() {
	var (
		listenAddr       = flag.String("listen", envOrDefault("SCW_ONBOARDING_LISTEN_ADDR", ":18081"), "HTTP listen address")
		storeRoot        = flag.String("store", envOrDefault("SCW_BUNDLE_STORE", ".scw/bundles"), "SCW bundle store root")
		rpcURL           = flag.String("rpc-url", envOrDefault("SCW_ONBOARDING_RPC_URL", envOrDefault("EVM_DEX_RPC_URL", "")), "optional RPC URL for status checks")
		chainID          = flag.Int64("chain-id", envOrDefaultInt64("SCW_CHAIN_ID", 0), "default chain id")
		policyID         = flag.String("policy-id", envOrDefault("SCW_POLICY_ID", "default"), "default policy id")
		safeSingleton    = flag.String("safe-singleton", envOrDefault("SCW_SAFE_SINGLETON_ADDRESS", ""), "default Safe singleton address")
		safeFactory      = flag.String("safe-factory", envOrDefault("SCW_SAFE_PROXY_FACTORY_ADDRESS", ""), "default Safe proxy factory address")
		safeFallback     = flag.String("safe-fallback-handler", envOrDefault("SCW_SAFE_FALLBACK_HANDLER_ADDRESS", ""), "default Safe fallback handler address")
		proxyCode        = flag.String("proxy-creation-code", envOrDefault("SCW_SAFE_PROXY_CREATION_CODE", ""), "optional Safe proxy creation code")
		moduleAddress    = flag.String("strategy-policy-module", envOrDefault("SCW_STRATEGY_POLICY_MODULE_ADDRESS", ""), "default StrategyPolicyModule address")
		allowedTargets   = flag.String("allowed-contracts", envOrDefault("SCW_ALLOWED_CONTRACTS", ""), "comma-separated default allowed target addresses")
		allowedSelectors = flag.String("allowed-selectors", envOrDefault("SCW_ALLOWED_SELECTORS", ""), "comma-separated default allowed function selectors")
		maxValueWei      = flag.String("max-value-wei", envOrDefault("SCW_MAX_VALUE_WEI", "0"), "default max native value in wei")
		maxGasLimit      = flag.Uint64("max-gas-limit", envOrDefaultUint64("SCW_MAX_GAS_LIMIT", 0), "default max execution gas limit")
		deadlineGrace    = flag.Int64("deadline-grace-seconds", envOrDefaultInt64("SCW_DEADLINE_GRACE_SECONDS", 30), "default relayer deadline grace seconds")
		validAfter       = flag.Int64("session-valid-after", envOrDefaultInt64("SCW_SESSION_VALID_AFTER_UNIX", 0), "default session valid-after unix timestamp")
		validUntil       = flag.Int64("session-valid-until", envOrDefaultInt64("SCW_SESSION_VALID_UNTIL_UNIX", 0), "default session valid-until unix timestamp")
	)
	flag.Parse()

	service := onboarding.NewService(onboarding.ServerDefaults{
		StoreRoot:                  strings.TrimSpace(*storeRoot),
		RPCURL:                     strings.TrimSpace(*rpcURL),
		ChainID:                    *chainID,
		PolicyID:                   strings.TrimSpace(*policyID),
		SafeSingletonAddress:       strings.TrimSpace(*safeSingleton),
		SafeProxyFactoryAddress:    strings.TrimSpace(*safeFactory),
		SafeFallbackHandlerAddress: strings.TrimSpace(*safeFallback),
		ProxyCreationCode:          strings.TrimSpace(*proxyCode),
		StrategyPolicyModule:       strings.TrimSpace(*moduleAddress),
		AllowedContractAddresses:   splitCSV(*allowedTargets),
		AllowedFunctionSelectors:   splitCSV(*allowedSelectors),
		MaxValueWei:                strings.TrimSpace(*maxValueWei),
		MaxGasLimit:                *maxGasLimit,
		DeadlineGraceSeconds:       *deadlineGrace,
		SessionValidAfterUnix:      *validAfter,
		SessionValidUntilUnix:      *validUntil,
	})
	server := onboarding.NewServer(service)

	log.Printf("SCW onboarding server listening on %s", strings.TrimSpace(*listenAddr))
	log.Printf("bundle_store=%s chain_id=%d policy=%s", strings.TrimSpace(*storeRoot), *chainID, strings.TrimSpace(*policyID))
	if err := http.ListenAndServe(strings.TrimSpace(*listenAddr), server); err != nil {
		log.Fatalf("listen: %v", err)
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
