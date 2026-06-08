package base

// UniswapV3PoolRequest identifies a Uniswap V3-compatible pool.
type UniswapV3PoolRequest struct {
	Chain       string `json:"chain,omitempty"`
	PoolAddress string `json:"pool_address"`
}

// UniswapV3PoolInfo contains the immutable pool metadata needed for quoting.
type UniswapV3PoolInfo struct {
	Chain       string `json:"chain,omitempty"`
	ChainID     int64  `json:"chain_id"`
	PoolAddress string `json:"pool_address"`
	Token0      string `json:"token0"`
	Token1      string `json:"token1"`
	Fee         uint32 `json:"fee"`
}

// UniswapV3QuoteExactInputSingleRequest asks a QuoterV2 contract for a single-hop quote.
type UniswapV3QuoteExactInputSingleRequest struct {
	Chain                string `json:"chain,omitempty"`
	QuoterAddress        string `json:"quoter_address"`
	TokenIn              string `json:"token_in"`
	TokenOut             string `json:"token_out"`
	Fee                  uint32 `json:"fee"`
	AmountInWei          string `json:"amount_in_wei"`
	SqrtPriceLimitX96Wei string `json:"sqrt_price_limit_x96_wei,omitempty"`
}

// UniswapV3QuoteExactInputSingle captures a QuoterV2 exact-input quote.
type UniswapV3QuoteExactInputSingle struct {
	Chain                   string `json:"chain,omitempty"`
	ChainID                 int64  `json:"chain_id"`
	QuoterAddress           string `json:"quoter_address"`
	TokenIn                 string `json:"token_in"`
	TokenOut                string `json:"token_out"`
	Fee                     uint32 `json:"fee"`
	AmountInWei             string `json:"amount_in_wei"`
	AmountOutWei            string `json:"amount_out_wei"`
	SqrtPriceX96AfterWei    string `json:"sqrt_price_x96_after_wei"`
	InitializedTicksCrossed uint32 `json:"initialized_ticks_crossed"`
	GasEstimate             string `json:"gas_estimate"`
}

// ERC20ApprovalRequest asks the executor to ensure router allowance.
type ERC20ApprovalRequest struct {
	Chain          string `json:"chain,omitempty"`
	TokenAddress   string `json:"token_address"`
	OwnerAddress   string `json:"owner_address,omitempty"`
	SpenderAddress string `json:"spender_address"`
	AmountWei      string `json:"amount_wei"`
	ApproveWei     string `json:"approve_wei,omitempty"`
	DryRun         bool   `json:"dry_run,omitempty"`
	WaitForReceipt bool   `json:"wait_for_receipt,omitempty"`
}

// ERC20ApprovalResult reports whether approval was already sufficient or submitted.
type ERC20ApprovalResult struct {
	Chain              string `json:"chain,omitempty"`
	ChainID            int64  `json:"chain_id"`
	TokenAddress       string `json:"token_address"`
	OwnerAddress       string `json:"owner_address"`
	SpenderAddress     string `json:"spender_address"`
	RequiredAmountWei  string `json:"required_amount_wei"`
	AllowanceBeforeWei string `json:"allowance_before_wei"`
	ApproveAmountWei   string `json:"approve_amount_wei"`
	TxHash             string `json:"tx_hash,omitempty"`
	AlreadyApproved    bool   `json:"already_approved"`
	DryRun             bool   `json:"dry_run"`
}

// UniswapV3SwapExactInputSingleRequest executes a single-hop exact-input swap.
type UniswapV3SwapExactInputSingleRequest struct {
	Chain                string `json:"chain,omitempty"`
	RouterAddress        string `json:"router_address"`
	TokenIn              string `json:"token_in"`
	TokenOut             string `json:"token_out"`
	Fee                  uint32 `json:"fee"`
	Recipient            string `json:"recipient,omitempty"`
	AmountInWei          string `json:"amount_in_wei"`
	AmountOutMinimumWei  string `json:"amount_out_minimum_wei"`
	SqrtPriceLimitX96Wei string `json:"sqrt_price_limit_x96_wei,omitempty"`
	ValueWei             string `json:"value_wei,omitempty"`
	DryRun               bool   `json:"dry_run,omitempty"`
	WaitForReceipt       bool   `json:"wait_for_receipt,omitempty"`
}

// UniswapV3SwapExactInputSingleResult captures submitted transaction details and,
// when a receipt is available, the observed tokenOut transfer amount.
type UniswapV3SwapExactInputSingleResult struct {
	Chain                string `json:"chain,omitempty"`
	ChainID              int64  `json:"chain_id"`
	RouterAddress        string `json:"router_address"`
	TokenIn              string `json:"token_in"`
	TokenOut             string `json:"token_out"`
	Fee                  uint32 `json:"fee"`
	Recipient            string `json:"recipient"`
	AmountInWei          string `json:"amount_in_wei"`
	AmountOutMinimumWei  string `json:"amount_out_minimum_wei"`
	ValueWei             string `json:"value_wei"`
	TxHash               string `json:"tx_hash,omitempty"`
	ObservedAmountOutWei string `json:"observed_amount_out_wei,omitempty"`
	GasUsed              uint64 `json:"gas_used,omitempty"`
	EffectiveGasPriceWei string `json:"effective_gas_price_wei,omitempty"`
	ReceiptStatus        uint64 `json:"receipt_status,omitempty"`
	DryRun               bool   `json:"dry_run"`
}

// UniswapV3Executor is an optional capability for Uniswap V3-compatible DEXs.
type UniswapV3Executor interface {
	FetchUniswapV3PoolInfo(request UniswapV3PoolRequest) (UniswapV3PoolInfo, error)
	QuoteUniswapV3ExactInputSingle(request UniswapV3QuoteExactInputSingleRequest) (UniswapV3QuoteExactInputSingle, error)
	EnsureERC20Approval(request ERC20ApprovalRequest) (ERC20ApprovalResult, error)
	SwapUniswapV3ExactInputSingle(request UniswapV3SwapExactInputSingleRequest) (UniswapV3SwapExactInputSingleResult, error)
}
