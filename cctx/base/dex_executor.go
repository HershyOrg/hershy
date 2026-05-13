package base

// EVMDEXRequest describes a raw EVM contract interaction.
type EVMDEXRequest struct {
	// Chain is an optional chain slug used to resolve chain-specific RPC URLs.
	Chain string
	// ContractAddress is the target contract address.
	ContractAddress string
	// Calldata is the pre-encoded calldata hex string.
	Calldata string
	// Value is the native token value forwarded to the transaction.
	Value string
	// GasLimit overrides the transaction gas limit when non-zero.
	GasLimit uint64
	// MaxFeePerGas is an optional max fee string understood by Foundry.
	MaxFeePerGas string
	// MaxPriorityFeePerGas is an optional priority fee string understood by Foundry.
	MaxPriorityFeePerGas string
	// FunctionName is an optional human-readable label for diagnostics.
	FunctionName string
	// StateMutability is an optional function mutability hint.
	StateMutability string
}

// EVMDEXResult captures the result of a raw EVM call or transaction submission.
type EVMDEXResult struct {
	// Mode is either "call" or "transaction".
	Mode string
	// Transport identifies the underlying execution transport.
	Transport string
	// Chain is the requested chain slug if provided.
	Chain string
	// ChainID is the configured chain ID.
	ChainID int64
	// RPCURL is the RPC endpoint used for execution.
	RPCURL string
	// From is the derived EOA signer address.
	From string
	// To is the target contract address.
	To string
	// Calldata is the calldata used for execution.
	Calldata string
	// Value is the forwarded native token value.
	Value string
	// TxHash is populated for state-changing transactions.
	TxHash string
	// RawOutput is populated for read-only calls.
	RawOutput string
}

// EVMDEXExecutor is an optional capability for exchanges that can execute raw EVM calldata.
type EVMDEXExecutor interface {
	// WalletAddress returns the signer address used by the executor.
	WalletAddress() string
	// ExecuteEVMCall performs a read-only contract call.
	ExecuteEVMCall(request EVMDEXRequest) (EVMDEXResult, error)
	// ExecuteEVMTransaction submits a state-changing transaction.
	ExecuteEVMTransaction(request EVMDEXRequest) (EVMDEXResult, error)
}
