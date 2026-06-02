package main

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/relayer"
	"github.com/HershyOrg/hershy/cctx/scw"
)

type commandOutput struct {
	Mode                      string                     `json:"mode"`
	BundlePath                string                     `json:"bundle_path,omitempty"`
	OwnerAddress              string                     `json:"owner_address,omitempty"`
	ChainID                   int64                      `json:"chain_id,omitempty"`
	PolicyID                  string                     `json:"policy_id,omitempty"`
	SessionKeyAddress         string                     `json:"session_key_address,omitempty"`
	SmartWalletAddress        string                     `json:"smart_wallet_address,omitempty"`
	StrategyPolicyModule      string                     `json:"strategy_policy_module_address,omitempty"`
	NeedsPostDeployAddressSet bool                       `json:"needs_post_deploy_address_set"`
	DeploymentCall            scw.DeploymentCall         `json:"deployment_call"`
	EnableModuleAction        *scw.SafeAction            `json:"enable_module_action,omitempty"`
	GrantSessionKeyAction     *scw.SafeAction            `json:"grant_session_key_action,omitempty"`
	RelayerPolicy             relayer.SCWExecutionPolicy `json:"relayer_policy"`
	NativeBalance             *balanceOutput             `json:"native_balance,omitempty"`
	ERC20Balance              *balanceOutput             `json:"erc20_balance,omitempty"`
	DeploymentResult          *deploymentOutput          `json:"deployment_result,omitempty"`
}

type balanceOutput struct {
	Asset     string `json:"asset"`
	Address   string `json:"address"`
	Wei       string `json:"wei"`
	Formatted string `json:"formatted"`
	Decimals  uint64 `json:"decimals"`
}

type deploymentOutput struct {
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

	selectedMode := strings.ToLower(strings.TrimSpace(*mode))
	switch selectedMode {
	case "create":
		output, err := runCreate(createOptions{
			storeRoot:        *storeRoot,
			bundlePath:       *bundlePath,
			ownerAddress:     *ownerAddress,
			chainID:          *chainID,
			policyID:         *policyID,
			safeSingleton:    *safeSingleton,
			safeFactory:      *safeFactory,
			safeFallback:     *safeFallback,
			proxyCode:        *proxyCode,
			threshold:        *threshold,
			saltNonce:        *saltNonce,
			sessionKey:       *sessionKey,
			setupTarget:      *setupTarget,
			setupCalldata:    *setupCalldata,
			moduleAddress:    *moduleAddress,
			validAfter:       *validAfter,
			validUntil:       *validUntil,
			allowedContracts: *allowedContracts,
			allowedSelectors: *allowedSelectors,
			maxValueWei:      *maxValueWei,
			maxGasLimit:      *maxGasLimit,
			deadlineGrace:    *deadlineGrace,
		})
		if err != nil {
			log.Fatal(err)
		}
		printOutput(output)
	case "update-address":
		output, err := runUpdateAddress(updateOptions{
			storeRoot:    *storeRoot,
			bundlePath:   *bundlePath,
			chainID:      *chainID,
			ownerAddress: *ownerAddress,
			policyID:     *policyID,
			smartWallet:  *smartWallet,
		})
		if err != nil {
			log.Fatal(err)
		}
		printOutput(output)
	case "update-module":
		output, err := runUpdateModule(updateModuleOptions{
			showOptions: showOptions{
				storeRoot:    *storeRoot,
				bundlePath:   *bundlePath,
				chainID:      *chainID,
				ownerAddress: *ownerAddress,
				policyID:     *policyID,
			},
			moduleAddress:    *moduleAddress,
			validAfter:       *validAfter,
			validUntil:       *validUntil,
			allowedContracts: *allowedContracts,
			allowedSelectors: *allowedSelectors,
			maxValueWei:      *maxValueWei,
			maxGasLimit:      *maxGasLimit,
		})
		if err != nil {
			log.Fatal(err)
		}
		printOutput(output)
	case "show":
		output, err := runShow(showOptions{
			storeRoot:    *storeRoot,
			bundlePath:   *bundlePath,
			chainID:      *chainID,
			ownerAddress: *ownerAddress,
			policyID:     *policyID,
		})
		if err != nil {
			log.Fatal(err)
		}
		printOutput(output)
	case "balance":
		output, err := runBalance(balanceOptions{
			showOptions: showOptions{
				storeRoot:    *storeRoot,
				bundlePath:   *bundlePath,
				chainID:      *chainID,
				ownerAddress: *ownerAddress,
				policyID:     *policyID,
			},
			rpcURL:         *rpcURL,
			nativeSymbol:   *nativeSymbol,
			nativeDecimals: *nativeDecimals,
			erc20Address:   *erc20Address,
			erc20Symbol:    *erc20Symbol,
			erc20Decimals:  *erc20Decimals,
		})
		if err != nil {
			log.Fatal(err)
		}
		printOutput(output)
	case "deploy":
		output, err := runDeploy(deployOptions{
			showOptions: showOptions{
				storeRoot:    *storeRoot,
				bundlePath:   *bundlePath,
				chainID:      *chainID,
				ownerAddress: *ownerAddress,
				policyID:     *policyID,
			},
			rpcURL:         *rpcURL,
			privateKey:     *privateKey,
			allowDeploy:    *allowDeploy,
			receiptTimeout: *receiptTimeout,
			nativeDecimals: *nativeDecimals,
		})
		if err != nil {
			log.Fatal(err)
		}
		printOutput(output)
	default:
		log.Fatalf("unsupported mode: %s", selectedMode)
	}
}

type createOptions struct {
	storeRoot        string
	bundlePath       string
	ownerAddress     string
	chainID          int64
	policyID         string
	safeSingleton    string
	safeFactory      string
	safeFallback     string
	proxyCode        string
	threshold        uint64
	saltNonce        string
	sessionKey       string
	setupTarget      string
	setupCalldata    string
	moduleAddress    string
	validAfter       int64
	validUntil       int64
	allowedContracts string
	allowedSelectors string
	maxValueWei      string
	maxGasLimit      uint64
	deadlineGrace    int64
}

type updateOptions struct {
	storeRoot    string
	bundlePath   string
	chainID      int64
	ownerAddress string
	policyID     string
	smartWallet  string
}

type updateModuleOptions struct {
	showOptions
	moduleAddress    string
	validAfter       int64
	validUntil       int64
	allowedContracts string
	allowedSelectors string
	maxValueWei      string
	maxGasLimit      uint64
}

type showOptions struct {
	storeRoot    string
	bundlePath   string
	chainID      int64
	ownerAddress string
	policyID     string
}

type balanceOptions struct {
	showOptions
	rpcURL         string
	nativeSymbol   string
	nativeDecimals uint64
	erc20Address   string
	erc20Symbol    string
	erc20Decimals  uint64
}

type deployOptions struct {
	showOptions
	rpcURL         string
	privateKey     string
	allowDeploy    bool
	receiptTimeout int64
	nativeDecimals uint64
}

func runCreate(options createOptions) (commandOutput, error) {
	request := scw.SafeProvisioningRequest{
		OwnerAddress:                strings.TrimSpace(options.ownerAddress),
		ChainID:                     options.chainID,
		PolicyID:                    strings.TrimSpace(options.policyID),
		SafeSingletonAddress:        strings.TrimSpace(options.safeSingleton),
		SafeProxyFactoryAddress:     strings.TrimSpace(options.safeFactory),
		SafeFallbackHandlerAddress:  strings.TrimSpace(options.safeFallback),
		ProxyCreationCode:           strings.TrimSpace(options.proxyCode),
		Threshold:                   options.threshold,
		SaltNonce:                   strings.TrimSpace(options.saltNonce),
		SessionPrivateKey:           strings.TrimSpace(options.sessionKey),
		SetupDelegateTarget:         strings.TrimSpace(options.setupTarget),
		SetupDelegateCalldata:       strings.TrimSpace(options.setupCalldata),
		StrategyPolicyModuleAddress: strings.TrimSpace(options.moduleAddress),
		SessionValidAfterUnix:       options.validAfter,
		SessionValidUntilUnix:       options.validUntil,
		AllowedContractAddresses:    splitCSV(options.allowedContracts),
		AllowedFunctionSelectors:    splitCSV(options.allowedSelectors),
		MaxValueWei:                 strings.TrimSpace(options.maxValueWei),
		MaxGasLimit:                 options.maxGasLimit,
		SessionDeadlineGraceSeconds: options.deadlineGrace,
	}

	if strings.TrimSpace(options.bundlePath) != "" {
		bundle, err := scw.BuildSafeProvisioningBundle(request)
		if err != nil {
			return commandOutput{}, err
		}
		path, err := absolutePath(options.bundlePath)
		if err != nil {
			return commandOutput{}, err
		}
		if err := scw.SaveBundleFile(path, bundle); err != nil {
			return commandOutput{}, err
		}
		loaded, err := scw.LoadBundleFile(path)
		if err != nil {
			return commandOutput{}, err
		}
		return outputFromBundle("create", path, loaded), nil
	}

	store := scw.NewBundleStore(options.storeRoot)
	bundle, path, err := scw.BuildAndSaveSafeProvisioningBundle(store, request)
	if err != nil {
		return commandOutput{}, err
	}
	absolute, err := absolutePath(path)
	if err != nil {
		return commandOutput{}, err
	}
	return outputFromBundle("create", absolute, bundle), nil
}

func runUpdateAddress(options updateOptions) (commandOutput, error) {
	if strings.TrimSpace(options.smartWallet) == "" {
		return commandOutput{}, fmt.Errorf("smart wallet address required")
	}
	if strings.TrimSpace(options.bundlePath) != "" {
		path, err := absolutePath(options.bundlePath)
		if err != nil {
			return commandOutput{}, err
		}
		bundle, err := scw.UpdateBundleSmartWalletAddressFile(path, options.smartWallet)
		if err != nil {
			return commandOutput{}, err
		}
		return outputFromBundle("update-address", path, bundle), nil
	}

	store := scw.NewBundleStore(options.storeRoot)
	bundle, err := store.UpdateSmartWalletAddress(options.chainID, options.ownerAddress, options.policyID, options.smartWallet)
	if err != nil {
		return commandOutput{}, err
	}
	path, err := store.BundlePath(options.chainID, options.ownerAddress, options.policyID)
	if err != nil {
		return commandOutput{}, err
	}
	absolute, err := absolutePath(path)
	if err != nil {
		return commandOutput{}, err
	}
	return outputFromBundle("update-address", absolute, bundle), nil
}

func runUpdateModule(options updateModuleOptions) (commandOutput, error) {
	if strings.TrimSpace(options.moduleAddress) == "" {
		return commandOutput{}, fmt.Errorf("strategy policy module address required")
	}
	request := scw.StrategyPolicyModuleActionRequest{
		StrategyPolicyModuleAddress: strings.TrimSpace(options.moduleAddress),
		SessionValidAfterUnix:       options.validAfter,
		SessionValidUntilUnix:       options.validUntil,
		AllowedContractAddresses:    splitCSV(options.allowedContracts),
		AllowedFunctionSelectors:    splitCSV(options.allowedSelectors),
		MaxValueWei:                 strings.TrimSpace(options.maxValueWei),
		MaxGasLimit:                 options.maxGasLimit,
	}
	if strings.TrimSpace(options.bundlePath) != "" {
		path, err := absolutePath(options.bundlePath)
		if err != nil {
			return commandOutput{}, err
		}
		bundle, err := scw.UpdateBundleStrategyPolicyModuleFile(path, request)
		if err != nil {
			return commandOutput{}, err
		}
		return outputFromBundle("update-module", path, bundle), nil
	}

	store := scw.NewBundleStore(options.storeRoot)
	bundle, err := store.UpdateStrategyPolicyModule(options.chainID, options.ownerAddress, options.policyID, request)
	if err != nil {
		return commandOutput{}, err
	}
	path, err := store.BundlePath(options.chainID, options.ownerAddress, options.policyID)
	if err != nil {
		return commandOutput{}, err
	}
	absolute, err := absolutePath(path)
	if err != nil {
		return commandOutput{}, err
	}
	return outputFromBundle("update-module", absolute, bundle), nil
}

func runShow(options showOptions) (commandOutput, error) {
	bundle, path, err := loadBundleFromOptions(options)
	if err != nil {
		return commandOutput{}, err
	}
	return outputFromBundle("show", path, bundle), nil
}

func runBalance(options balanceOptions) (commandOutput, error) {
	bundle, path, err := loadBundleFromOptions(options.showOptions)
	if err != nil {
		return commandOutput{}, err
	}
	if strings.TrimSpace(bundle.SmartWalletAddress) == "" {
		return commandOutput{}, errors.New("bundle missing smart_wallet_address; update the bundle after SCW deployment")
	}
	if strings.TrimSpace(options.rpcURL) == "" {
		return commandOutput{}, errors.New("rpc url required for balance mode")
	}
	if options.nativeDecimals > 255 || options.erc20Decimals > 255 {
		return commandOutput{}, errors.New("token decimals must be <= 255")
	}

	client, err := ethclient.Dial(strings.TrimSpace(options.rpcURL))
	if err != nil {
		return commandOutput{}, fmt.Errorf("eth rpc dial failed: %w", err)
	}
	defer client.Close()

	wallet := common.HexToAddress(bundle.SmartWalletAddress)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	nativeWei, err := client.BalanceAt(ctx, wallet, nil)
	if err != nil {
		return commandOutput{}, fmt.Errorf("eth_getBalance failed: %w", err)
	}

	output := outputFromBundle("balance", path, bundle)
	output.NativeBalance = &balanceOutput{
		Asset:     firstNonEmpty(options.nativeSymbol, "ETH"),
		Address:   wallet.Hex(),
		Wei:       nativeWei.String(),
		Formatted: formatUnits(nativeWei, options.nativeDecimals),
		Decimals:  options.nativeDecimals,
	}

	if strings.TrimSpace(options.erc20Address) != "" {
		if !common.IsHexAddress(strings.TrimSpace(options.erc20Address)) {
			return commandOutput{}, fmt.Errorf("invalid erc20 address: %s", options.erc20Address)
		}
		token := common.HexToAddress(strings.TrimSpace(options.erc20Address))
		tokenWei, err := callERC20BalanceOf(ctx, client, token, wallet)
		if err != nil {
			return commandOutput{}, err
		}
		output.ERC20Balance = &balanceOutput{
			Asset:     firstNonEmpty(options.erc20Symbol, "ERC20"),
			Address:   token.Hex(),
			Wei:       tokenWei.String(),
			Formatted: formatUnits(tokenWei, options.erc20Decimals),
			Decimals:  options.erc20Decimals,
		}
	}

	return output, nil
}

func runDeploy(options deployOptions) (commandOutput, error) {
	bundle, path, err := loadBundleFromOptions(options.showOptions)
	if err != nil {
		return commandOutput{}, err
	}
	if strings.TrimSpace(options.rpcURL) == "" {
		return commandOutput{}, errors.New("rpc url required for deploy mode")
	}
	if strings.TrimSpace(options.privateKey) == "" {
		return commandOutput{}, errors.New("private key required for deploy mode")
	}

	callTo := strings.TrimSpace(bundle.DeploymentCall.To)
	if !common.IsHexAddress(callTo) {
		return commandOutput{}, fmt.Errorf("invalid deployment call target: %s", callTo)
	}
	callData := common.FromHex(bundle.DeploymentCall.Data)
	if len(callData) == 0 {
		return commandOutput{}, errors.New("deployment call data required")
	}
	valueWei, err := parseWeiString(bundle.DeploymentCall.Value)
	if err != nil {
		return commandOutput{}, fmt.Errorf("invalid deployment call value: %w", err)
	}

	signer, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(options.privateKey), "0x"))
	if err != nil {
		return commandOutput{}, fmt.Errorf("invalid deployer private key: %w", err)
	}
	from := crypto.PubkeyToAddress(signer.PublicKey)
	to := common.HexToAddress(callTo)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(maxInt64(options.receiptTimeout, 30))*time.Second)
	defer cancel()

	client, err := ethclient.DialContext(ctx, strings.TrimSpace(options.rpcURL))
	if err != nil {
		return commandOutput{}, fmt.Errorf("eth rpc dial failed: %w", err)
	}
	defer client.Close()

	chainID, err := client.ChainID(ctx)
	if err != nil {
		return commandOutput{}, fmt.Errorf("fetch chain id: %w", err)
	}
	if bundle.ChainID > 0 && chainID.Int64() != bundle.ChainID {
		return commandOutput{}, fmt.Errorf("rpc chain id mismatch: got %s want %d", chainID.String(), bundle.ChainID)
	}
	nonce, err := client.PendingNonceAt(ctx, from)
	if err != nil {
		return commandOutput{}, fmt.Errorf("fetch deployer nonce: %w", err)
	}
	estimatedGas, err := client.EstimateGas(ctx, ethereum.CallMsg{
		From:  from,
		To:    &to,
		Value: valueWei,
		Data:  callData,
	})
	if err != nil {
		return commandOutput{}, fmt.Errorf("estimate deployment gas: %w", err)
	}
	gasLimit := estimatedGas + estimatedGas/5
	deployResult := deploymentOutput{
		Submitted:    false,
		From:         from.Hex(),
		To:           to.Hex(),
		ChainID:      chainID.String(),
		Nonce:        nonce,
		EstimatedGas: estimatedGas,
		GasLimit:     gasLimit,
	}

	tx, err := buildDeploymentTx(ctx, client, signer, chainID, nonce, to, valueWei, gasLimit, callData, &deployResult, options.nativeDecimals)
	if err != nil {
		return commandOutput{}, err
	}

	output := outputFromBundle("deploy", path, bundle)
	output.DeploymentResult = &deployResult
	if !options.allowDeploy {
		return output, nil
	}

	if err := client.SendTransaction(ctx, tx); err != nil {
		return commandOutput{}, fmt.Errorf("send deployment tx: %w", err)
	}
	deployResult.Submitted = true
	deployResult.TxHash = tx.Hash().Hex()

	receipt, err := waitForReceipt(ctx, client, tx.Hash())
	if err != nil {
		return commandOutput{}, err
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

	updatedBundle, err := scw.UpdateBundleSmartWalletAddressFile(path, deployedAddress)
	if err != nil {
		return commandOutput{}, err
	}
	code, err := client.CodeAt(ctx, common.HexToAddress(deployedAddress), nil)
	if err != nil {
		return commandOutput{}, fmt.Errorf("fetch deployed smart wallet code: %w", err)
	}
	deployResult.DeployedSmartWallet = common.HexToAddress(deployedAddress).Hex()
	deployResult.SmartWalletCodeSize = len(code)
	output = outputFromBundle("deploy", path, updatedBundle)
	output.DeploymentResult = &deployResult
	return output, nil
}

func loadBundleFromOptions(options showOptions) (scw.SafeProvisioningBundle, string, error) {
	if strings.TrimSpace(options.bundlePath) != "" {
		path, err := absolutePath(options.bundlePath)
		if err != nil {
			return scw.SafeProvisioningBundle{}, "", err
		}
		bundle, err := scw.LoadBundleFile(path)
		if err != nil {
			return scw.SafeProvisioningBundle{}, "", err
		}
		return bundle, path, nil
	}

	store := scw.NewBundleStore(options.storeRoot)
	bundle, err := store.Load(options.chainID, options.ownerAddress, options.policyID)
	if err != nil {
		return scw.SafeProvisioningBundle{}, "", err
	}
	path, err := store.BundlePath(options.chainID, options.ownerAddress, options.policyID)
	if err != nil {
		return scw.SafeProvisioningBundle{}, "", err
	}
	absolute, err := absolutePath(path)
	if err != nil {
		return scw.SafeProvisioningBundle{}, "", err
	}
	return bundle, absolute, nil
}

func outputFromBundle(mode, path string, bundle scw.SafeProvisioningBundle) commandOutput {
	return commandOutput{
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

func printOutput(output commandOutput) {
	encoded, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		log.Fatalf("marshal output: %v", err)
	}
	fmt.Println(string(encoded))
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

func buildDeploymentTx(ctx context.Context, client *ethclient.Client, signer *ecdsa.PrivateKey, chainID *big.Int, nonce uint64, to common.Address, valueWei *big.Int, gasLimit uint64, callData []byte, out *deploymentOutput, decimals uint64) (*types.Transaction, error) {
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if text := strings.TrimSpace(value); text != "" {
			return text
		}
	}
	return ""
}

func absolutePath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("path required")
	}
	if filepath.IsAbs(path) {
		return path, nil
	}
	return filepath.Abs(path)
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

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
