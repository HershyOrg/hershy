package scw

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"
	"path/filepath"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/relayer"
)

// BundleManager exposes the SCW provisioning workflow for CLIs, servers, and tests.
type BundleManager struct{}

// BundleIdentityOptions selects a stored bundle either by explicit path or by
// deterministic store identity.
type BundleIdentityOptions struct {
	StoreRoot    string
	BundlePath   string
	ChainID      int64
	OwnerAddress string
	PolicyID     string
}

// BundleCreateOptions describes a new Safe-based SCW provisioning bundle.
type BundleCreateOptions struct {
	BundleIdentityOptions
	SafeSingletonAddress       string
	SafeProxyFactoryAddress    string
	SafeFallbackHandlerAddress string
	ProxyCreationCode          string
	Threshold                  uint64
	SaltNonce                  string
	SessionPrivateKey          string
	SetupDelegateTarget        string
	SetupDelegateCalldata      string
	StrategyPolicyModule       string
	SessionValidAfterUnix      int64
	SessionValidUntilUnix      int64
	AllowedContractAddresses   []string
	AllowedFunctionSelectors   []string
	MaxValueWei                string
	MaxGasLimit                uint64
	DeadlineGraceSeconds       int64
}

// BundleSmartWalletUpdateOptions records a deployed or predicted SCW address.
type BundleSmartWalletUpdateOptions struct {
	BundleIdentityOptions
	SmartWalletAddress string
}

// BundleStrategyPolicyModuleUpdateOptions regenerates the Safe actions needed
// for module enablement and session-key policy grant.
type BundleStrategyPolicyModuleUpdateOptions struct {
	BundleIdentityOptions
	StrategyPolicyModule     string
	SessionValidAfterUnix    int64
	SessionValidUntilUnix    int64
	AllowedContractAddresses []string
	AllowedFunctionSelectors []string
	MaxValueWei              string
	MaxGasLimit              uint64
}

// BundleBalanceOptions reads native and optional ERC20 balances for a bundle SCW.
type BundleBalanceOptions struct {
	BundleIdentityOptions
	RPCURL         string
	NativeSymbol   string
	NativeDecimals uint64
	ERC20Address   string
	ERC20Symbol    string
	ERC20Decimals  uint64
}

// BundleDeployOptions estimates or submits the saved Safe proxy deployment call.
type BundleDeployOptions struct {
	BundleIdentityOptions
	RPCURL                string
	PrivateKey            string
	AllowDeploy           bool
	ReceiptTimeoutSeconds int64
	NativeDecimals        uint64
}

// BundleOperationResult is intentionally JSON-friendly so API handlers and
// command-line tools can return the same payload shape.
type BundleOperationResult struct {
	Mode                      string                     `json:"mode"`
	BundlePath                string                     `json:"bundle_path,omitempty"`
	OwnerAddress              string                     `json:"owner_address,omitempty"`
	ChainID                   int64                      `json:"chain_id,omitempty"`
	PolicyID                  string                     `json:"policy_id,omitempty"`
	SessionKeyAddress         string                     `json:"session_key_address,omitempty"`
	SmartWalletAddress        string                     `json:"smart_wallet_address,omitempty"`
	StrategyPolicyModule      string                     `json:"strategy_policy_module_address,omitempty"`
	NeedsPostDeployAddressSet bool                       `json:"needs_post_deploy_address_set"`
	DeploymentCall            DeploymentCall             `json:"deployment_call"`
	EnableModuleAction        *SafeAction                `json:"enable_module_action,omitempty"`
	GrantSessionKeyAction     *SafeAction                `json:"grant_session_key_action,omitempty"`
	RelayerPolicy             relayer.SCWExecutionPolicy `json:"relayer_policy"`
	NativeBalance             *BundleBalance             `json:"native_balance,omitempty"`
	ERC20Balance              *BundleBalance             `json:"erc20_balance,omitempty"`
	DeploymentResult          *SafeDeploymentResult      `json:"deployment_result,omitempty"`
}

// BundleBalance is a formatted on-chain balance snapshot.
type BundleBalance struct {
	Asset     string `json:"asset"`
	Address   string `json:"address"`
	Wei       string `json:"wei"`
	Formatted string `json:"formatted"`
	Decimals  uint64 `json:"decimals"`
}

// SafeDeploymentResult reports deployment estimation and receipt details.
type SafeDeploymentResult struct {
	Submitted              bool   `json:"submitted"`
	From                   string `json:"from"`
	To                     string `json:"to"`
	ChainID                string `json:"chain_id"`
	Nonce                  uint64 `json:"nonce"`
	EstimatedGas           uint64 `json:"estimated_gas"`
	GasLimit               uint64 `json:"gas_limit"`
	GasFeeCapWei           string `json:"gas_fee_cap_wei,omitempty"`
	GasTipCapWei           string `json:"gas_tip_cap_wei,omitempty"`
	GasPriceWei            string `json:"gas_price_wei,omitempty"`
	MaxFeeUpperBoundWei    string `json:"max_fee_upper_bound_wei,omitempty"`
	MaxFeeUpperBoundNative string `json:"max_fee_upper_bound_native,omitempty"`
	TxHash                 string `json:"tx_hash,omitempty"`
	ReceiptStatus          uint64 `json:"receipt_status,omitempty"`
	DeployedSmartWallet    string `json:"deployed_smart_wallet,omitempty"`
	SmartWalletCodeSize    int    `json:"smart_wallet_code_size,omitempty"`
}

// NewBundleManager creates a stateless SCW bundle manager.
func NewBundleManager() BundleManager {
	return BundleManager{}
}

// CreateBundle builds and persists a Safe provisioning bundle.
func (manager BundleManager) CreateBundle(options BundleCreateOptions) (BundleOperationResult, error) {
	request := SafeProvisioningRequest{
		OwnerAddress:                strings.TrimSpace(options.OwnerAddress),
		ChainID:                     options.ChainID,
		PolicyID:                    strings.TrimSpace(options.PolicyID),
		SafeSingletonAddress:        strings.TrimSpace(options.SafeSingletonAddress),
		SafeProxyFactoryAddress:     strings.TrimSpace(options.SafeProxyFactoryAddress),
		SafeFallbackHandlerAddress:  strings.TrimSpace(options.SafeFallbackHandlerAddress),
		ProxyCreationCode:           strings.TrimSpace(options.ProxyCreationCode),
		Threshold:                   options.Threshold,
		SaltNonce:                   strings.TrimSpace(options.SaltNonce),
		SessionPrivateKey:           strings.TrimSpace(options.SessionPrivateKey),
		SetupDelegateTarget:         strings.TrimSpace(options.SetupDelegateTarget),
		SetupDelegateCalldata:       strings.TrimSpace(options.SetupDelegateCalldata),
		StrategyPolicyModuleAddress: strings.TrimSpace(options.StrategyPolicyModule),
		SessionValidAfterUnix:       options.SessionValidAfterUnix,
		SessionValidUntilUnix:       options.SessionValidUntilUnix,
		AllowedContractAddresses:    options.AllowedContractAddresses,
		AllowedFunctionSelectors:    options.AllowedFunctionSelectors,
		MaxValueWei:                 strings.TrimSpace(options.MaxValueWei),
		MaxGasLimit:                 options.MaxGasLimit,
		SessionDeadlineGraceSeconds: options.DeadlineGraceSeconds,
	}

	if strings.TrimSpace(options.BundlePath) != "" {
		bundle, err := BuildSafeProvisioningBundle(request)
		if err != nil {
			return BundleOperationResult{}, err
		}
		path, err := absoluteBundlePath(options.BundlePath)
		if err != nil {
			return BundleOperationResult{}, err
		}
		if err := SaveBundleFile(path, bundle); err != nil {
			return BundleOperationResult{}, err
		}
		loaded, err := LoadBundleFile(path)
		if err != nil {
			return BundleOperationResult{}, err
		}
		return bundleOperationResultFromBundle("create", path, loaded), nil
	}

	store := NewBundleStore(options.StoreRoot)
	bundle, path, err := BuildAndSaveSafeProvisioningBundle(store, request)
	if err != nil {
		return BundleOperationResult{}, err
	}
	absolute, err := absoluteBundlePath(path)
	if err != nil {
		return BundleOperationResult{}, err
	}
	return bundleOperationResultFromBundle("create", absolute, bundle), nil
}

// UpdateSmartWalletAddress records a deployed or predicted SCW address.
func (manager BundleManager) UpdateSmartWalletAddress(options BundleSmartWalletUpdateOptions) (BundleOperationResult, error) {
	if strings.TrimSpace(options.SmartWalletAddress) == "" {
		return BundleOperationResult{}, fmt.Errorf("smart wallet address required")
	}
	if strings.TrimSpace(options.BundlePath) != "" {
		path, err := absoluteBundlePath(options.BundlePath)
		if err != nil {
			return BundleOperationResult{}, err
		}
		bundle, err := UpdateBundleSmartWalletAddressFile(path, options.SmartWalletAddress)
		if err != nil {
			return BundleOperationResult{}, err
		}
		return bundleOperationResultFromBundle("update-address", path, bundle), nil
	}

	store := NewBundleStore(options.StoreRoot)
	bundle, err := store.UpdateSmartWalletAddress(options.ChainID, options.OwnerAddress, options.PolicyID, options.SmartWalletAddress)
	if err != nil {
		return BundleOperationResult{}, err
	}
	path, err := store.BundlePath(options.ChainID, options.OwnerAddress, options.PolicyID)
	if err != nil {
		return BundleOperationResult{}, err
	}
	absolute, err := absoluteBundlePath(path)
	if err != nil {
		return BundleOperationResult{}, err
	}
	return bundleOperationResultFromBundle("update-address", absolute, bundle), nil
}

// UpdateStrategyPolicyModule records the policy module and regenerates Safe actions.
func (manager BundleManager) UpdateStrategyPolicyModule(options BundleStrategyPolicyModuleUpdateOptions) (BundleOperationResult, error) {
	if strings.TrimSpace(options.StrategyPolicyModule) == "" {
		return BundleOperationResult{}, fmt.Errorf("strategy policy module address required")
	}
	request := StrategyPolicyModuleActionRequest{
		StrategyPolicyModuleAddress: strings.TrimSpace(options.StrategyPolicyModule),
		SessionValidAfterUnix:       options.SessionValidAfterUnix,
		SessionValidUntilUnix:       options.SessionValidUntilUnix,
		AllowedContractAddresses:    options.AllowedContractAddresses,
		AllowedFunctionSelectors:    options.AllowedFunctionSelectors,
		MaxValueWei:                 strings.TrimSpace(options.MaxValueWei),
		MaxGasLimit:                 options.MaxGasLimit,
	}
	if strings.TrimSpace(options.BundlePath) != "" {
		path, err := absoluteBundlePath(options.BundlePath)
		if err != nil {
			return BundleOperationResult{}, err
		}
		bundle, err := UpdateBundleStrategyPolicyModuleFile(path, request)
		if err != nil {
			return BundleOperationResult{}, err
		}
		return bundleOperationResultFromBundle("update-module", path, bundle), nil
	}

	store := NewBundleStore(options.StoreRoot)
	bundle, err := store.UpdateStrategyPolicyModule(options.ChainID, options.OwnerAddress, options.PolicyID, request)
	if err != nil {
		return BundleOperationResult{}, err
	}
	path, err := store.BundlePath(options.ChainID, options.OwnerAddress, options.PolicyID)
	if err != nil {
		return BundleOperationResult{}, err
	}
	absolute, err := absoluteBundlePath(path)
	if err != nil {
		return BundleOperationResult{}, err
	}
	return bundleOperationResultFromBundle("update-module", absolute, bundle), nil
}

// ShowBundle loads the selected provisioning bundle without mutating it.
func (manager BundleManager) ShowBundle(options BundleIdentityOptions) (BundleOperationResult, error) {
	bundle, path, err := manager.loadBundle(options)
	if err != nil {
		return BundleOperationResult{}, err
	}
	return bundleOperationResultFromBundle("show", path, bundle), nil
}

// ReadBalance reads the SCW native balance and optionally one ERC20 balance.
func (manager BundleManager) ReadBalance(ctx context.Context, options BundleBalanceOptions) (BundleOperationResult, error) {
	bundle, path, err := manager.loadBundle(options.BundleIdentityOptions)
	if err != nil {
		return BundleOperationResult{}, err
	}
	if strings.TrimSpace(bundle.SmartWalletAddress) == "" {
		return BundleOperationResult{}, errors.New("bundle missing smart_wallet_address; update the bundle after SCW deployment")
	}
	if strings.TrimSpace(options.RPCURL) == "" {
		return BundleOperationResult{}, errors.New("rpc url required for balance mode")
	}
	if options.NativeDecimals > 255 || options.ERC20Decimals > 255 {
		return BundleOperationResult{}, errors.New("token decimals must be <= 255")
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, err := ethclient.DialContext(ctx, strings.TrimSpace(options.RPCURL))
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("eth rpc dial failed: %w", err)
	}
	defer client.Close()

	wallet := common.HexToAddress(bundle.SmartWalletAddress)
	nativeWei, err := client.BalanceAt(ctx, wallet, nil)
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("eth_getBalance failed: %w", err)
	}

	output := bundleOperationResultFromBundle("balance", path, bundle)
	output.NativeBalance = &BundleBalance{
		Asset:     firstTrimmed(options.NativeSymbol, "ETH"),
		Address:   wallet.Hex(),
		Wei:       nativeWei.String(),
		Formatted: formatUnits(nativeWei, options.NativeDecimals),
		Decimals:  options.NativeDecimals,
	}

	if strings.TrimSpace(options.ERC20Address) != "" {
		if !common.IsHexAddress(strings.TrimSpace(options.ERC20Address)) {
			return BundleOperationResult{}, fmt.Errorf("invalid erc20 address: %s", options.ERC20Address)
		}
		token := common.HexToAddress(strings.TrimSpace(options.ERC20Address))
		tokenWei, err := callERC20BalanceOf(ctx, client, token, wallet)
		if err != nil {
			return BundleOperationResult{}, err
		}
		output.ERC20Balance = &BundleBalance{
			Asset:     firstTrimmed(options.ERC20Symbol, "ERC20"),
			Address:   token.Hex(),
			Wei:       tokenWei.String(),
			Formatted: formatUnits(tokenWei, options.ERC20Decimals),
			Decimals:  options.ERC20Decimals,
		}
	}

	return output, nil
}

// DeployBundle estimates or submits the saved Safe proxy deployment transaction.
func (manager BundleManager) DeployBundle(ctx context.Context, options BundleDeployOptions) (BundleOperationResult, error) {
	bundle, path, err := manager.loadBundle(options.BundleIdentityOptions)
	if err != nil {
		return BundleOperationResult{}, err
	}
	if strings.TrimSpace(options.RPCURL) == "" {
		return BundleOperationResult{}, errors.New("rpc url required for deploy mode")
	}
	if strings.TrimSpace(options.PrivateKey) == "" {
		return BundleOperationResult{}, errors.New("private key required for deploy mode")
	}

	callTo := strings.TrimSpace(bundle.DeploymentCall.To)
	if !common.IsHexAddress(callTo) {
		return BundleOperationResult{}, fmt.Errorf("invalid deployment call target: %s", callTo)
	}
	callData := common.FromHex(bundle.DeploymentCall.Data)
	if len(callData) == 0 {
		return BundleOperationResult{}, errors.New("deployment call data required")
	}
	valueWei, err := parseWeiString(bundle.DeploymentCall.Value)
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("invalid deployment call value: %w", err)
	}

	signer, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(options.PrivateKey), "0x"))
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("invalid deployer private key: %w", err)
	}
	from := crypto.PubkeyToAddress(signer.PublicKey)
	to := common.HexToAddress(callTo)

	ctx, cancel := context.WithTimeout(ctx, time.Duration(maxInt64(options.ReceiptTimeoutSeconds, 30))*time.Second)
	defer cancel()
	client, err := ethclient.DialContext(ctx, strings.TrimSpace(options.RPCURL))
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("eth rpc dial failed: %w", err)
	}
	defer client.Close()

	chainID, err := client.ChainID(ctx)
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("fetch chain id: %w", err)
	}
	if bundle.ChainID > 0 && chainID.Int64() != bundle.ChainID {
		return BundleOperationResult{}, fmt.Errorf("rpc chain id mismatch: got %s want %d", chainID.String(), bundle.ChainID)
	}
	nonce, err := client.PendingNonceAt(ctx, from)
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("fetch deployer nonce: %w", err)
	}
	estimatedGas, err := client.EstimateGas(ctx, ethereum.CallMsg{
		From:  from,
		To:    &to,
		Value: valueWei,
		Data:  callData,
	})
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("estimate deployment gas: %w", err)
	}
	gasLimit := estimatedGas + estimatedGas/5
	deployResult := SafeDeploymentResult{
		Submitted:    false,
		From:         from.Hex(),
		To:           to.Hex(),
		ChainID:      chainID.String(),
		Nonce:        nonce,
		EstimatedGas: estimatedGas,
		GasLimit:     gasLimit,
	}

	tx, err := buildDeploymentTx(ctx, client, signer, chainID, nonce, to, valueWei, gasLimit, callData, &deployResult, options.NativeDecimals)
	if err != nil {
		return BundleOperationResult{}, err
	}

	output := bundleOperationResultFromBundle("deploy", path, bundle)
	output.DeploymentResult = &deployResult
	if !options.AllowDeploy {
		return output, nil
	}

	if err := client.SendTransaction(ctx, tx); err != nil {
		return BundleOperationResult{}, fmt.Errorf("send deployment tx: %w", err)
	}
	deployResult.Submitted = true
	deployResult.TxHash = tx.Hash().Hex()

	receipt, err := waitForReceipt(ctx, client, tx.Hash())
	if err != nil {
		return BundleOperationResult{}, err
	}
	deployResult.ReceiptStatus = receipt.Status
	if receipt.Status != types.ReceiptStatusSuccessful {
		output.DeploymentResult = &deployResult
		return output, fmt.Errorf("deployment tx failed: %s", tx.Hash().Hex())
	}

	deployedAddress := strings.TrimSpace(bundle.SmartWalletAddress)
	if deployedAddress == "" {
		deployedAddress = proxyAddressFromReceipt(receipt, to)
	}
	if deployedAddress == "" {
		output.DeploymentResult = &deployResult
		return output, errors.New("deployment succeeded but ProxyCreation event was not found")
	}

	updatedBundle, err := UpdateBundleSmartWalletAddressFile(path, deployedAddress)
	if err != nil {
		return BundleOperationResult{}, err
	}
	code, err := client.CodeAt(ctx, common.HexToAddress(deployedAddress), nil)
	if err != nil {
		return BundleOperationResult{}, fmt.Errorf("fetch deployed smart wallet code: %w", err)
	}
	deployResult.DeployedSmartWallet = common.HexToAddress(deployedAddress).Hex()
	deployResult.SmartWalletCodeSize = len(code)
	output = bundleOperationResultFromBundle("deploy", path, updatedBundle)
	output.DeploymentResult = &deployResult
	return output, nil
}

func (manager BundleManager) loadBundle(options BundleIdentityOptions) (SafeProvisioningBundle, string, error) {
	if strings.TrimSpace(options.BundlePath) != "" {
		path, err := absoluteBundlePath(options.BundlePath)
		if err != nil {
			return SafeProvisioningBundle{}, "", err
		}
		bundle, err := LoadBundleFile(path)
		if err != nil {
			return SafeProvisioningBundle{}, "", err
		}
		return bundle, path, nil
	}

	store := NewBundleStore(options.StoreRoot)
	bundle, err := store.Load(options.ChainID, options.OwnerAddress, options.PolicyID)
	if err != nil {
		return SafeProvisioningBundle{}, "", err
	}
	path, err := store.BundlePath(options.ChainID, options.OwnerAddress, options.PolicyID)
	if err != nil {
		return SafeProvisioningBundle{}, "", err
	}
	absolute, err := absoluteBundlePath(path)
	if err != nil {
		return SafeProvisioningBundle{}, "", err
	}
	return bundle, absolute, nil
}

func bundleOperationResultFromBundle(mode, path string, bundle SafeProvisioningBundle) BundleOperationResult {
	return BundleOperationResult{
		Mode:                      mode,
		BundlePath:                path,
		OwnerAddress:              bundle.OwnerAddress,
		ChainID:                   bundle.ChainID,
		PolicyID:                  bundle.PolicyID,
		SessionKeyAddress:         bundle.SessionKeyAddress,
		SmartWalletAddress:        bundle.SmartWalletAddress,
		StrategyPolicyModule:      bundle.StrategyPolicyModuleAddress,
		NeedsPostDeployAddressSet: bundle.NeedsPostDeployAddressSet,
		DeploymentCall:            bundle.DeploymentCall,
		EnableModuleAction:        bundle.EnableModuleAction,
		GrantSessionKeyAction:     bundle.GrantSessionKeyAction,
		RelayerPolicy:             bundle.RelayerPolicy,
	}
}

func callERC20BalanceOf(ctx context.Context, client *ethclient.Client, token, owner common.Address) (*big.Int, error) {
	calldata := []byte{0x70, 0xa0, 0x82, 0x31}
	calldata = append(calldata, common.LeftPadBytes(owner.Bytes(), 32)...)
	output, err := client.CallContract(ctx, ethereum.CallMsg{
		To:   &token,
		Data: calldata,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("erc20 balanceOf failed: %w", err)
	}
	if len(output) < 32 {
		return nil, fmt.Errorf("erc20 balanceOf returned short output: 0x%x", output)
	}
	return new(big.Int).SetBytes(output[len(output)-32:]), nil
}

func buildDeploymentTx(ctx context.Context, client *ethclient.Client, signer *ecdsa.PrivateKey, chainID *big.Int, nonce uint64, to common.Address, valueWei *big.Int, gasLimit uint64, callData []byte, out *SafeDeploymentResult, decimals uint64) (*types.Transaction, error) {
	latestHeader, err := client.HeaderByNumber(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch latest header: %w", err)
	}
	var tx *types.Transaction
	if latestHeader != nil && latestHeader.BaseFee != nil {
		tipCap, err := client.SuggestGasTipCap(ctx)
		if err != nil {
			return nil, fmt.Errorf("suggest gas tip cap: %w", err)
		}
		maxFeePerGas := new(big.Int).Add(new(big.Int).Mul(latestHeader.BaseFee, big.NewInt(2)), tipCap)
		tx = types.NewTx(&types.DynamicFeeTx{
			ChainID:   chainID,
			Nonce:     nonce,
			To:        &to,
			Value:     valueWei,
			Gas:       gasLimit,
			GasFeeCap: maxFeePerGas,
			GasTipCap: tipCap,
			Data:      callData,
		})
		out.GasFeeCapWei = maxFeePerGas.String()
		out.GasTipCapWei = tipCap.String()
		upperBound := new(big.Int).Mul(new(big.Int).SetUint64(gasLimit), maxFeePerGas)
		out.MaxFeeUpperBoundWei = upperBound.String()
		out.MaxFeeUpperBoundNative = formatUnits(upperBound, decimals)
	} else {
		gasPrice, err := client.SuggestGasPrice(ctx)
		if err != nil {
			return nil, fmt.Errorf("suggest gas price: %w", err)
		}
		tx = types.NewTx(&types.LegacyTx{
			Nonce:    nonce,
			To:       &to,
			Value:    valueWei,
			Gas:      gasLimit,
			GasPrice: gasPrice,
			Data:     callData,
		})
		out.GasPriceWei = gasPrice.String()
		upperBound := new(big.Int).Mul(new(big.Int).SetUint64(gasLimit), gasPrice)
		out.MaxFeeUpperBoundWei = upperBound.String()
		out.MaxFeeUpperBoundNative = formatUnits(upperBound, decimals)
	}
	signedTx, err := types.SignTx(tx, types.LatestSignerForChainID(chainID), signer)
	if err != nil {
		return nil, fmt.Errorf("sign deployment tx: %w", err)
	}
	return signedTx, nil
}

func parseWeiString(raw string) (*big.Int, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return big.NewInt(0), nil
	}
	text = strings.TrimSuffix(strings.TrimSuffix(text, "wei"), "WEI")
	if text == "" {
		return big.NewInt(0), nil
	}
	value := new(big.Int)
	if _, ok := value.SetString(text, 10); !ok {
		return nil, fmt.Errorf("invalid wei value: %s", raw)
	}
	if value.Sign() < 0 {
		return nil, errors.New("wei value cannot be negative")
	}
	return value, nil
}

func waitForReceipt(ctx context.Context, client *ethclient.Client, txHash common.Hash) (*types.Receipt, error) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		receipt, err := client.TransactionReceipt(ctx, txHash)
		if err == nil {
			return receipt, nil
		}
		if !errors.Is(err, ethereum.NotFound) {
			return nil, fmt.Errorf("fetch deployment receipt: %w", err)
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("wait deployment receipt: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func proxyAddressFromReceipt(receipt *types.Receipt, factory common.Address) string {
	proxyCreationTopic := crypto.Keccak256Hash([]byte("ProxyCreation(address,address)"))
	for _, logEntry := range receipt.Logs {
		if logEntry == nil || logEntry.Address != factory || len(logEntry.Topics) < 2 {
			continue
		}
		if logEntry.Topics[0] != proxyCreationTopic {
			continue
		}
		return common.BytesToAddress(logEntry.Topics[1].Bytes()[12:]).Hex()
	}
	return ""
}

func formatUnits(value *big.Int, decimals uint64) string {
	if value == nil {
		return "0"
	}
	if decimals == 0 {
		return value.String()
	}
	scale := new(big.Int).Exp(big.NewInt(10), new(big.Int).SetUint64(decimals), nil)
	integer := new(big.Int).Quo(new(big.Int).Set(value), scale)
	fraction := new(big.Int).Mod(new(big.Int).Set(value), scale)
	if fraction.Sign() == 0 {
		return integer.String()
	}
	fractionText := fraction.String()
	for uint64(len(fractionText)) < decimals {
		fractionText = "0" + fractionText
	}
	fractionText = strings.TrimRight(fractionText, "0")
	if fractionText == "" {
		return integer.String()
	}
	return integer.String() + "." + fractionText
}

func absoluteBundlePath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("path required")
	}
	if filepath.IsAbs(path) {
		return path, nil
	}
	return filepath.Abs(path)
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
