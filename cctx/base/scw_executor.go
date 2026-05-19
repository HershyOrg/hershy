package base

// SCWRelayRequest describes a session-key authorized smart-wallet execution request.
type SCWRelayRequest struct {
	// Chain is an optional normalized chain slug.
	Chain string `json:"chain,omitempty"`
	// ChainID is the target EVM chain id.
	ChainID int64 `json:"chain_id"`
	// SmartWalletAddress is the user-owned SCW that will execute the call.
	SmartWalletAddress string `json:"smart_wallet_address"`
	// SessionKeyAddress is the delegated session-key signer address.
	SessionKeyAddress string `json:"session_key_address"`
	// SessionKeyID is an optional relayer/session identifier.
	SessionKeyID string `json:"session_key_id,omitempty"`
	// PolicyID is an optional on-chain/off-chain policy identifier.
	PolicyID string `json:"policy_id,omitempty"`
	// StrategyID is an optional strategy identifier for audit/routing.
	StrategyID string `json:"strategy_id,omitempty"`
	// ContractAddress is the target contract address.
	ContractAddress string `json:"contract_address"`
	// Calldata is the pre-encoded calldata hex string.
	Calldata string `json:"calldata"`
	// Value is the native token amount string.
	Value string `json:"value,omitempty"`
	// GasLimit is an optional transaction gas limit override.
	GasLimit uint64 `json:"gas_limit,omitempty"`
	// MaxFeePerGas is an optional EIP-1559 max fee string.
	MaxFeePerGas string `json:"max_fee_per_gas,omitempty"`
	// MaxPriorityFeePerGas is an optional EIP-1559 priority fee string.
	MaxPriorityFeePerGas string `json:"max_priority_fee_per_gas,omitempty"`
	// FunctionName is an optional human-readable function label.
	FunctionName string `json:"function_name,omitempty"`
	// StateMutability is an optional mutability hint.
	StateMutability string `json:"state_mutability,omitempty"`
	// Nonce is an optional relayer/module nonce domain value.
	Nonce string `json:"nonce,omitempty"`
	// DeadlineUnix is the UNIX deadline after which the relayer/module should reject the request.
	DeadlineUnix int64 `json:"deadline_unix"`
	// Signature is the session-key signature over the canonical request payload.
	Signature string `json:"signature,omitempty"`
}

// SCWRelayResponse captures a relayer submission result.
type SCWRelayResponse struct {
	// RelayID is an optional relayer-side request identifier.
	RelayID string `json:"relay_id,omitempty"`
	// TxHash is the submitted on-chain transaction hash.
	TxHash string `json:"tx_hash,omitempty"`
	// Status is an optional relayer status string.
	Status string `json:"status,omitempty"`
	// Message is an optional relayer diagnostic message.
	Message string `json:"message,omitempty"`
}

