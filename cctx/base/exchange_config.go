package base

import "maps"

// ExchangeConfig is implemented by exchange-specific config structs.
type ExchangeConfig interface {
	ToMap() map[string]any
}

// BaseExchangeConfig contains shared config fields.
type BaseExchangeConfig struct {
	// Verbose enables verbose logging.
	Verbose bool
}

// ToMap converts config to a map, omitting zero values.
func (c BaseExchangeConfig) ToMap() map[string]any {
	if !c.Verbose {
		return map[string]any{}
	}
	return map[string]any{"verbose": c.Verbose}
}

// PolymarketConfig holds Polymarket configuration.
type PolymarketConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// PrivateKey is the signer private key.
	PrivateKey string
	// Funder is the funder address used by Polymarket.
	Funder string
	// APIKey is the API key for Polymarket.
	APIKey string
	// CacheTTL is the cache time-to-live.
	CacheTTL float64
}

// ToMap converts config to a map, omitting zero values.
func (c PolymarketConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.PrivateKey != "" {
		out["private_key"] = c.PrivateKey
	}
	if c.Funder != "" {
		out["funder"] = c.Funder
	}
	if c.APIKey != "" {
		out["api_key"] = c.APIKey
	}
	if c.CacheTTL != 0 {
		out["cache_ttl"] = c.CacheTTL
	}
	return out
}

// OpinionConfig holds Opinion configuration.
type OpinionConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// APIKey is the API key for Opinion.
	APIKey string
	// PrivateKey is the signer private key.
	PrivateKey string
	// MultiSigAddr is the multi-sig address.
	MultiSigAddr string
}

// ToMap converts config to a map, omitting zero values.
func (c OpinionConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.APIKey != "" {
		out["api_key"] = c.APIKey
	}
	if c.PrivateKey != "" {
		out["private_key"] = c.PrivateKey
	}
	if c.MultiSigAddr != "" {
		out["multi_sig_addr"] = c.MultiSigAddr
	}
	return out
}

// LimitlessConfig holds Limitless configuration.
type LimitlessConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// PrivateKey is the signer private key.
	PrivateKey string
}

// ToMap converts config to a map, omitting zero values.
func (c LimitlessConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.PrivateKey != "" {
		out["private_key"] = c.PrivateKey
	}
	return out
}

// mergeConfigMaps merges source into target and returns target.
func mergeConfigMaps(target map[string]any, source map[string]any) map[string]any {
	if target == nil {
		target = map[string]any{}
	}
	maps.Copy(target, source)
	return target
}
