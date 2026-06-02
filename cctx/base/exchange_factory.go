package base

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

// ExchangeFactory creates an Exchange from a config map.
type ExchangeFactory func(config map[string]any) (Exchange, error)

// CreateExchange creates an exchange instance by name using the provided factory.
// overrideParams provides explicit string-based configuration values.
func CreateExchange(name string, factory ExchangeFactory, config ExchangeConfig, overrideParams map[string]string, verbose, validate bool) (Exchange, error) {
	if factory == nil {
		return nil, fmt.Errorf("exchange factory required for %s", name)
	}
	nameLower := strings.ToLower(name)

	finalConfig := map[string]any{}
	if len(overrideParams) > 0 {
		finalConfig = mergeConfigMaps(finalConfig, loadMapConfig(nameLower, overrideParams))
	}

	if verbose {
		finalConfig["verbose"] = true
	}

	if config != nil {
		finalConfig = mergeConfigMaps(finalConfig, config.ToMap())
	}

	resolvedConfig, err := secureconfig.ResolveMap(finalConfig)
	if err != nil {
		return nil, fmt.Errorf("resolve secure config for %s: %w", nameLower, err)
	}
	finalConfig = resolvedConfig

	if validate {
		if err := validateConfig(nameLower, finalConfig); err != nil {
			return nil, err
		}
	}

	return factory(finalConfig)
}

// loadMapConfig maps string overrides into exchange config values.
func loadMapConfig(name string, values map[string]string) map[string]any {
	if values == nil {
		return map[string]any{}
	}
	switch name {
	case "binance", "binance_futures", "binance-usdm", "binance_usdm":
		out := map[string]any{
			"api_key":    values["api_key"],
			"api_secret": firstNonEmpty(values["api_secret"], values["hmac_secret"]),
		}
		if host := firstNonEmpty(values["base_url"], values["host"]); host != "" {
			out["base_url"] = host
		}
		if recvWindow := values["recv_window"]; recvWindow != "" {
			if parsed, err := strconv.ParseInt(recvWindow, 10, 64); err == nil {
				out["recv_window"] = float64(parsed)
			}
		}
		return out
	case "bybit":
		out := map[string]any{
			"api_key":      values["api_key"],
			"api_secret":   firstNonEmpty(values["api_secret"], values["hmac_secret"]),
			"account_type": firstNonEmpty(values["account_type"], "UNIFIED"),
		}
		if host := firstNonEmpty(values["base_url"], values["host"]); host != "" {
			out["base_url"] = host
		}
		if recvWindow := values["recv_window"]; recvWindow != "" {
			if parsed, err := strconv.ParseInt(recvWindow, 10, 64); err == nil {
				out["recv_window"] = float64(parsed)
			}
		}
		return out
	case "okx":
		out := map[string]any{
			"api_key":        values["api_key"],
			"api_secret":     firstNonEmpty(values["api_secret"], values["hmac_secret"]),
			"api_passphrase": firstNonEmpty(values["api_passphrase"], values["passphrase"]),
		}
		if host := firstNonEmpty(values["base_url"], values["host"]); host != "" {
			out["base_url"] = host
		}
		if simulated := firstNonEmpty(values["simulated"], values["simulated_trading"], values["demo_trading"]); simulated != "" {
			out["simulated"] = strings.EqualFold(simulated, "1") || strings.EqualFold(simulated, "true") || strings.EqualFold(simulated, "yes") || strings.EqualFold(simulated, "on")
		}
		return out
	case "gateio", "gate":
		out := map[string]any{
			"api_key":    values["api_key"],
			"api_secret": firstNonEmpty(values["api_secret"], values["hmac_secret"]),
		}
		if host := firstNonEmpty(values["base_url"], values["host"]); host != "" {
			out["base_url"] = host
		}
		return out
	case "polymarket":
		cacheTTL := 2.0
		if raw := values["cache_ttl"]; raw != "" {
			if parsed, err := strconv.ParseFloat(raw, 64); err == nil {
				cacheTTL = parsed
			}
		}
		out := map[string]any{
			"private_key": values["private_key"],
			"funder":      values["funder"],
			"api_key":     values["api_key"],
			"cache_ttl":   cacheTTL,
		}
		if host := values["host"]; host != "" {
			out["host"] = host
		}
		return out
	case "opinion":
		out := map[string]any{
			"api_key":        values["api_key"],
			"private_key":    values["private_key"],
			"multi_sig_addr": values["multi_sig_addr"],
		}
		if host := values["host"]; host != "" {
			out["host"] = host
		}
		if rpcURL := values["rpc_url"]; rpcURL != "" {
			out["rpc_url"] = rpcURL
		}
		if chainID := values["chain_id"]; chainID != "" {
			if parsed, err := strconv.ParseInt(chainID, 10, 64); err == nil {
				out["chain_id"] = float64(parsed)
			}
		}
		return out
	case "limitless":
		out := map[string]any{
			"private_key": values["private_key"],
		}
		if host := values["host"]; host != "" {
			out["host"] = host
		}
		if chainID := values["chain_id"]; chainID != "" {
			if parsed, err := strconv.ParseInt(chainID, 10, 64); err == nil {
				out["chain_id"] = float64(parsed)
			}
		}
		return out
	case "evm_dex":
		out := map[string]any{
			"signer_type":              values["signer_type"],
			"private_key":              values["private_key"],
			"smart_wallet_address":     values["smart_wallet_address"],
			"session_private_key":      values["session_private_key"],
			"session_key_id":           values["session_key_id"],
			"policy_id":                values["policy_id"],
			"relayer_url":              values["relayer_url"],
			"relayer_auth_token":       values["relayer_auth_token"],
			"rpc_url":                  values["rpc_url"],
			"cast_binary":              values["cast_binary"],
			"native_symbol":            values["native_symbol"],
			"session_deadline_seconds": values["session_deadline_seconds"],
		}
		if chainID := values["chain_id"]; chainID != "" {
			if parsed, err := strconv.ParseInt(chainID, 10, 64); err == nil {
				out["chain_id"] = float64(parsed)
			}
		}
		if deadline := values["session_deadline_seconds"]; deadline != "" {
			if parsed, err := strconv.ParseInt(deadline, 10, 64); err == nil {
				out["session_deadline_seconds"] = float64(parsed)
			}
		}
		rpcURLs := map[string]any{}
		chainIDs := map[string]any{}
		for key, value := range values {
			keyLower := strings.ToLower(key)
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			if strings.HasPrefix(keyLower, "rpc_url_") {
				chain := strings.TrimPrefix(keyLower, "rpc_url_")
				if chain != "" {
					rpcURLs[chain] = value
				}
				continue
			}
			if strings.HasPrefix(keyLower, "chain_id_") {
				chain := strings.TrimPrefix(keyLower, "chain_id_")
				if chain != "" {
					if parsed, err := strconv.ParseInt(value, 10, 64); err == nil && parsed > 0 {
						chainIDs[chain] = float64(parsed)
					}
				}
			}
		}
		if len(rpcURLs) > 0 {
			out["rpc_urls"] = rpcURLs
		}
		if len(chainIDs) > 0 {
			out["chain_ids"] = chainIDs
		}
		return out
	default:
		out := map[string]any{}
		for key, value := range values {
			if value != "" {
				out[key] = value
			}
		}
		return out
	}
}

// validateConfig checks required fields and basic private key format.
func validateConfig(name string, config map[string]any) error {
	required := map[string][]string{
		"binance":    {"api_key", "api_secret"},
		"bybit":      {"api_key", "api_secret"},
		"okx":        {"api_key", "api_secret", "api_passphrase"},
		"gateio":     {"api_key", "api_secret"},
		"gate":       {"api_key", "api_secret"},
		"polymarket": {"private_key", "funder"},
		"opinion":    {"api_key", "private_key", "multi_sig_addr"},
		"limitless":  {"private_key"},
		"evm_dex":    {},
	}

	missing := []string{}
	for _, key := range required[name] {
		value, ok := config[key]
		if !ok || value == "" {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		envPrefix := strings.ToUpper(name)
		envVars := make([]string, 0, len(missing))
		for _, key := range missing {
			envVars = append(envVars, fmt.Sprintf("%s_%s", envPrefix, strings.ToUpper(key)))
		}
		return fmt.Errorf("missing required config: %v. set env vars: %v", missing, envVars)
	}

	if name == "evm_dex" {
		signerType := strings.ToLower(strings.TrimSpace(anyStringFromMap(config, "signer_type")))
		if signerType == "" || signerType == "eoa" {
			if strings.TrimSpace(anyStringFromMap(config, "private_key")) == "" {
				return fmt.Errorf("missing required config: private_key. set env var: EVM_DEX_PRIVATE_KEY")
			}
		} else if signerType == "session_key" || signerType == "scw_session" || signerType == "scw" {
			missingSCW := []string{}
			for _, key := range []string{"smart_wallet_address", "session_private_key", "relayer_url"} {
				if strings.TrimSpace(anyStringFromMap(config, key)) == "" {
					missingSCW = append(missingSCW, key)
				}
			}
			if len(missingSCW) > 0 {
				return fmt.Errorf("missing required config for %s signer_type=%s: %v", name, signerType, missingSCW)
			}
		} else {
			return fmt.Errorf("unsupported evm_dex signer_type: %s", signerType)
		}
		if !hasRPCURL(config) {
			return fmt.Errorf("missing required config: rpc_url or rpc_urls. set env vars: EVM_DEX_RPC_URL or EVM_DEX_RPC_URL_<CHAIN>")
		}
	}

	if name == "evm_dex" {
		signerType := strings.ToLower(strings.TrimSpace(anyStringFromMap(config, "signer_type")))
		if signerType == "session_key" || signerType == "scw_session" || signerType == "scw" {
			if key := strings.TrimSpace(anyStringFromMap(config, "session_private_key")); key != "" {
				return validatePrivateKey(key, name)
			}
			return nil
		}
	}
	if key, ok := config["private_key"].(string); ok && key != "" {
		return validatePrivateKey(key, name)
	}
	return nil
}

func anyStringFromMap(config map[string]any, key string) string {
	if config == nil {
		return ""
	}
	if value, ok := config[key].(string); ok {
		return value
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// validatePrivateKey validates a hex private key.
func validatePrivateKey(key, name string) error {
	clean := strings.TrimPrefix(key, "0x")
	if len(clean) != 64 {
		return fmt.Errorf("invalid private key length for %s. expected 64 hex chars", name)
	}
	if _, err := strconv.ParseUint(clean[:1], 16, 8); err != nil {
		return errors.New("invalid private key format: not hex")
	}
	if _, err := strconv.ParseUint(clean[len(clean)-1:], 16, 8); err != nil {
		return errors.New("invalid private key format: not hex")
	}
	_, err := strconv.ParseUint(clean[:16], 16, 64)
	if err != nil {
		return fmt.Errorf("invalid private key format for %s", name)
	}
	return nil
}

func hasRPCURL(config map[string]any) bool {
	if rpcURL, ok := config["rpc_url"].(string); ok && strings.TrimSpace(rpcURL) != "" {
		return true
	}
	switch raw := config["rpc_urls"].(type) {
	case map[string]string:
		for _, value := range raw {
			if strings.TrimSpace(value) != "" {
				return true
			}
		}
	case map[string]any:
		for _, value := range raw {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				return true
			}
		}
	}
	return false
}
