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

// EVMERC20MetadataRequest identifies an ERC20 token on a specific EVM chain.
type EVMERC20MetadataRequest struct {
	// Chain is an optional chain slug used to resolve chain-specific RPC URLs.
	Chain string `json:"chain,omitempty"`
	// TokenAddress is the ERC20 contract address.
	TokenAddress string `json:"token_address"`
}

// EVMERC20Metadata captures basic token metadata needed for balances and quotes.
type EVMERC20Metadata struct {
	Chain        string `json:"chain,omitempty"`
	ChainID      int64  `json:"chain_id"`
	TokenAddress string `json:"token_address"`
	Symbol       string `json:"symbol,omitempty"`
	Decimals     uint8  `json:"decimals"`
}

// EVMERC20BalanceRequest asks for an ERC20 balance for an owner address.
type EVMERC20BalanceRequest struct {
	Chain        string `json:"chain,omitempty"`
	TokenAddress string `json:"token_address"`
	OwnerAddress string `json:"owner_address"`
}

// EVMERC20Balance is a precise ERC20 balance snapshot.
type EVMERC20Balance struct {
	EVMERC20Metadata
	OwnerAddress     string `json:"owner_address"`
	BalanceWei       string `json:"balance_wei"`
	BalanceFormatted string `json:"balance_formatted"`
}

// EVMERC20AllowanceRequest asks for an ERC20 allowance from owner to spender.
type EVMERC20AllowanceRequest struct {
	Chain          string `json:"chain,omitempty"`
	TokenAddress   string `json:"token_address"`
	OwnerAddress   string `json:"owner_address"`
	SpenderAddress string `json:"spender_address"`
}

// EVMERC20Allowance is a precise ERC20 allowance snapshot.
type EVMERC20Allowance struct {
	EVMERC20Metadata
	OwnerAddress       string `json:"owner_address"`
	SpenderAddress     string `json:"spender_address"`
	AllowanceWei       string `json:"allowance_wei"`
	AllowanceFormatted string `json:"allowance_formatted"`
}

// EVMDEXQuoteRequest asks a DEX router for an exact-input token route quote.
type EVMDEXQuoteRequest struct {
	// Chain is an optional chain slug used to resolve chain-specific RPC URLs.
	Chain string `json:"chain,omitempty"`
	// Protocol currently supports "uniswap_v2" compatible routers.
	Protocol string `json:"protocol,omitempty"`
	// RouterAddress is the DEX router contract address.
	RouterAddress string `json:"router_address"`
	// AmountInWei is the exact input amount in the token's smallest unit.
	AmountInWei string `json:"amount_in_wei"`
	// Path is the token route passed to the router.
	Path []string `json:"path"`
}

// EVMDEXQuote captures the router's returned amount path.
type EVMDEXQuote struct {
	Chain         string   `json:"chain,omitempty"`
	ChainID       int64    `json:"chain_id"`
	Protocol      string   `json:"protocol"`
	RouterAddress string   `json:"router_address"`
	AmountInWei   string   `json:"amount_in_wei"`
	AmountOutWei  string   `json:"amount_out_wei"`
	Path          []string `json:"path"`
	AmountsWei    []string `json:"amounts_wei"`
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

// EVMDEXReader is an optional capability for ERC20 reads and DEX quote checks.
type EVMDEXReader interface {
	// FetchERC20Metadata returns symbol and decimals for an ERC20 token.
	FetchERC20Metadata(request EVMERC20MetadataRequest) (EVMERC20Metadata, error)
	// FetchERC20Balance returns balanceOf(owner).
	FetchERC20Balance(request EVMERC20BalanceRequest) (EVMERC20Balance, error)
	// FetchERC20Allowance returns allowance(owner, spender).
	FetchERC20Allowance(request EVMERC20AllowanceRequest) (EVMERC20Allowance, error)
	// QuoteExactInput returns a router quote for an exact-input swap path.
	QuoteExactInput(request EVMDEXQuoteRequest) (EVMDEXQuote, error)
}
