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

// BinanceConfig holds Binance spot configuration.
type BinanceConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// APIKey is the API key for Binance.
	APIKey string
	// APISecret is the HMAC secret for Binance.
	APISecret string
	// BaseURL overrides the Binance API base URL.
	BaseURL string
	// RecvWindow is the Binance recvWindow in milliseconds.
	RecvWindow int64
}

// ToMap converts config to a map, omitting zero values.
func (c BinanceConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.APIKey != "" {
		out["api_key"] = c.APIKey
	}
	if c.APISecret != "" {
		out["api_secret"] = c.APISecret
	}
	if c.BaseURL != "" {
		out["base_url"] = c.BaseURL
	}
	if c.RecvWindow > 0 {
		out["recv_window"] = c.RecvWindow
	}
	return out
}

// BybitConfig holds Bybit spot configuration.
type BybitConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// APIKey is the API key for Bybit.
	APIKey string
	// APISecret is the HMAC secret for Bybit.
	APISecret string
	// BaseURL overrides the Bybit API base URL.
	BaseURL string
	// AccountType configures the V5 wallet account type.
	AccountType string
	// RecvWindow is the Bybit recv window in milliseconds.
	RecvWindow int64
}

// ToMap converts config to a map, omitting zero values.
func (c BybitConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.APIKey != "" {
		out["api_key"] = c.APIKey
	}
	if c.APISecret != "" {
		out["api_secret"] = c.APISecret
	}
	if c.BaseURL != "" {
		out["base_url"] = c.BaseURL
	}
	if c.AccountType != "" {
		out["account_type"] = c.AccountType
	}
	if c.RecvWindow > 0 {
		out["recv_window"] = c.RecvWindow
	}
	return out
}

// OKXConfig holds OKX spot configuration.
type OKXConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// APIKey is the API key for OKX.
	APIKey string
	// APISecret is the secret key for OKX.
	APISecret string
	// APIPassphrase is the passphrase for OKX.
	APIPassphrase string
	// BaseURL overrides the OKX API base URL.
	BaseURL string
	// Simulated toggles OKX demo trading mode.
	Simulated bool
}

// ToMap converts config to a map, omitting zero values.
func (c OKXConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.APIKey != "" {
		out["api_key"] = c.APIKey
	}
	if c.APISecret != "" {
		out["api_secret"] = c.APISecret
	}
	if c.APIPassphrase != "" {
		out["api_passphrase"] = c.APIPassphrase
	}
	if c.BaseURL != "" {
		out["base_url"] = c.BaseURL
	}
	if c.Simulated {
		out["simulated"] = true
	}
	return out
}

// GateIOConfig holds Gate.io spot configuration.
type GateIOConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// APIKey is the API key for Gate.io.
	APIKey string
	// APISecret is the API secret for Gate.io.
	APISecret string
	// BaseURL overrides the Gate.io API base URL.
	BaseURL string
}

// ToMap converts config to a map, omitting zero values.
func (c GateIOConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.APIKey != "" {
		out["api_key"] = c.APIKey
	}
	if c.APISecret != "" {
		out["api_secret"] = c.APISecret
	}
	if c.BaseURL != "" {
		out["base_url"] = c.BaseURL
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

// EVMDEXConfig holds generic EVM DEX executor configuration.
type EVMDEXConfig struct {
	// BaseExchangeConfig embeds shared configuration.
	BaseExchangeConfig
	// SignerType selects how transactions are authorized. Defaults to "eoa".
	SignerType string
	// PrivateKey is the EOA signer private key.
	PrivateKey string
	// SmartWalletAddress is the SCW address used for delegated execution.
	SmartWalletAddress string
	// SessionPrivateKey is the delegated session-key private key.
	SessionPrivateKey string
	// SessionKeyID is an optional relayer/session identifier.
	SessionKeyID string
	// PolicyID is an optional policy identifier attached to relay requests.
	PolicyID string
	// RelayerURL is the HTTP endpoint that accepts SCW relay requests.
	RelayerURL string
	// RelayerAuthToken is an optional bearer token for the relayer.
	RelayerAuthToken string
	// SessionDeadlineSeconds is the default relay-request deadline window in seconds.
	SessionDeadlineSeconds int64
	// RPCURL is the default chain RPC URL.
	RPCURL string
	// RPCURLs stores chain-specific RPC URLs keyed by chain slug.
	RPCURLs map[string]string
	// ChainID is the configured chain ID.
	ChainID int64
	// ChainIDs stores chain-specific chain IDs keyed by chain slug.
	ChainIDs map[string]int64
	// CastBinary overrides the Foundry cast binary path.
	CastBinary string
	// NativeSymbol labels the native balance returned by FetchBalance.
	NativeSymbol string
}

// ToMap converts config to a map, omitting zero values.
func (c EVMDEXConfig) ToMap() map[string]any {
	out := c.BaseExchangeConfig.ToMap()
	if c.SignerType != "" {
		out["signer_type"] = c.SignerType
	}
	if c.PrivateKey != "" {
		out["private_key"] = c.PrivateKey
	}
	if c.SmartWalletAddress != "" {
		out["smart_wallet_address"] = c.SmartWalletAddress
	}
	if c.SessionPrivateKey != "" {
		out["session_private_key"] = c.SessionPrivateKey
	}
	if c.SessionKeyID != "" {
		out["session_key_id"] = c.SessionKeyID
	}
	if c.PolicyID != "" {
		out["policy_id"] = c.PolicyID
	}
	if c.RelayerURL != "" {
		out["relayer_url"] = c.RelayerURL
	}
	if c.RelayerAuthToken != "" {
		out["relayer_auth_token"] = c.RelayerAuthToken
	}
	if c.SessionDeadlineSeconds > 0 {
		out["session_deadline_seconds"] = c.SessionDeadlineSeconds
	}
	if c.RPCURL != "" {
		out["rpc_url"] = c.RPCURL
	}
	if len(c.RPCURLs) > 0 {
		rpcURLs := make(map[string]any, len(c.RPCURLs))
		for key, value := range c.RPCURLs {
			if value != "" {
				rpcURLs[key] = value
			}
		}
		if len(rpcURLs) > 0 {
			out["rpc_urls"] = rpcURLs
		}
	}
	if c.ChainID > 0 {
		out["chain_id"] = c.ChainID
	}
	if len(c.ChainIDs) > 0 {
		chainIDs := make(map[string]any, len(c.ChainIDs))
		for key, value := range c.ChainIDs {
			if value > 0 {
				chainIDs[key] = value
			}
		}
		if len(chainIDs) > 0 {
			out["chain_ids"] = chainIDs
		}
	}
	if c.CastBinary != "" {
		out["cast_binary"] = c.CastBinary
	}
	if c.NativeSymbol != "" {
		out["native_symbol"] = c.NativeSymbol
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
