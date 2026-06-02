package scw

import (
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/HershyOrg/hershy/cctx/relayer"
)

var (
	safeSingletonABI = mustParseABI(`[
		{
			"inputs": [
				{"internalType":"address[]","name":"_owners","type":"address[]"},
				{"internalType":"uint256","name":"_threshold","type":"uint256"},
				{"internalType":"address","name":"to","type":"address"},
				{"internalType":"bytes","name":"data","type":"bytes"},
				{"internalType":"address","name":"fallbackHandler","type":"address"},
				{"internalType":"address","name":"paymentToken","type":"address"},
				{"internalType":"uint256","name":"payment","type":"uint256"},
				{"internalType":"address","name":"paymentReceiver","type":"address"}
			],
			"name":"setup",
			"outputs":[],
			"stateMutability":"nonpayable",
			"type":"function"
		}
	]`)
	safeProxyFactoryABI = mustParseABI(`[
		{
			"inputs":[
				{"internalType":"address","name":"_singleton","type":"address"},
				{"internalType":"bytes","name":"initializer","type":"bytes"},
				{"internalType":"uint256","name":"saltNonce","type":"uint256"}
			],
			"name":"createProxyWithNonce",
			"outputs":[{"internalType":"address","name":"proxy","type":"address"}],
			"stateMutability":"nonpayable",
			"type":"function"
		}
	]`)
	safeModuleManagerABI = mustParseABI(`[
		{
			"inputs":[{"internalType":"address","name":"module","type":"address"}],
			"name":"enableModule",
			"outputs":[],
			"stateMutability":"nonpayable",
			"type":"function"
		}
	]`)
	strategyPolicyModuleABI = mustParseABI(`[
		{
			"inputs":[
				{"internalType":"address","name":"sessionKey","type":"address"},
				{"internalType":"bytes32","name":"policyIdHash","type":"bytes32"},
				{"internalType":"uint48","name":"validAfter","type":"uint48"},
				{"internalType":"uint48","name":"validUntil","type":"uint48"},
				{"internalType":"uint64","name":"maxGasLimit","type":"uint64"},
				{"internalType":"uint256","name":"maxValueWei","type":"uint256"},
				{"internalType":"address[]","name":"targets","type":"address[]"},
				{"internalType":"bytes4[]","name":"selectors","type":"bytes4[]"}
			],
			"name":"grantSessionKey",
			"outputs":[],
			"stateMutability":"nonpayable",
			"type":"function"
		}
	]`)
)

// SafeProvisioningRequest describes the minimum information needed to generate
// a Safe-based SCW deployment bundle and delegated session key.
type SafeProvisioningRequest struct {
	OwnerAddress                string
	ChainID                     int64
	PolicyID                    string
	SafeSingletonAddress        string
	SafeProxyFactoryAddress     string
	SafeFallbackHandlerAddress  string
	ProxyCreationCode           string
	Threshold                   uint64
	SaltNonce                   string
	SessionPrivateKey           string
	SetupDelegateTarget         string
	SetupDelegateCalldata       string
	StrategyPolicyModuleAddress string
	SessionValidAfterUnix       int64
	SessionValidUntilUnix       int64
	AllowedContractAddresses    []string
	AllowedFunctionSelectors    []string
	MaxValueWei                 string
	MaxGasLimit                 uint64
	SessionDeadlineGraceSeconds int64
}

// StrategyPolicyModuleActionRequest describes post-deploy Safe actions needed
// to enable the policy module and grant the bundle's session key.
type StrategyPolicyModuleActionRequest struct {
	StrategyPolicyModuleAddress string
	SessionValidAfterUnix       int64
	SessionValidUntilUnix       int64
	AllowedContractAddresses    []string
	AllowedFunctionSelectors    []string
	MaxValueWei                 string
	MaxGasLimit                 uint64
}

// DeploymentCall is a wallet-submittable transaction request.
type DeploymentCall struct {
	To    string `json:"to"`
	Data  string `json:"data"`
	Value string `json:"value"`
}

// SafeAction describes a call that must be executed by the Safe itself after
// deployment, typically through Safe UI/SDK or any owner-approved Safe tx flow.
type SafeAction struct {
	Safe  string `json:"safe"`
	To    string `json:"to"`
	Data  string `json:"data"`
	Value string `json:"value"`
}

// SafeProvisioningBundle is the output a frontend or backend can store and use
// to complete SCW setup and later configure the relayer.
type SafeProvisioningBundle struct {
	OwnerAddress                string                     `json:"owner_address"`
	ChainID                     int64                      `json:"chain_id"`
	PolicyID                    string                     `json:"policy_id,omitempty"`
	SessionPrivateKey           string                     `json:"session_private_key"`
	SessionKeyAddress           string                     `json:"session_key_address"`
	SmartWalletAddress          string                     `json:"smart_wallet_address,omitempty"`
	StrategyPolicyModuleAddress string                     `json:"strategy_policy_module_address,omitempty"`
	SaltNonce                   string                     `json:"salt_nonce"`
	SafeSetupCalldata           string                     `json:"safe_setup_calldata"`
	DeploymentCall              DeploymentCall             `json:"deployment_call"`
	EnableModuleAction          *SafeAction                `json:"enable_module_action,omitempty"`
	GrantSessionKeyAction       *SafeAction                `json:"grant_session_key_action,omitempty"`
	RelayerPolicy               relayer.SCWExecutionPolicy `json:"relayer_policy"`
	NeedsPostDeployAddressSet   bool                       `json:"needs_post_deploy_address_set"`
}

// BuildSafeProvisioningBundle generates a session key, Safe setup calldata, and
// proxy-factory deployment call for user-side approval.
func BuildSafeProvisioningBundle(request SafeProvisioningRequest) (SafeProvisioningBundle, error) {
	ownerAddress, err := normalizeRequiredAddress(request.OwnerAddress, "owner address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	singletonAddress, err := normalizeRequiredAddress(request.SafeSingletonAddress, "safe singleton address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	factoryAddress, err := normalizeRequiredAddress(request.SafeProxyFactoryAddress, "safe proxy factory address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	fallbackHandler, err := normalizeRequiredAddress(request.SafeFallbackHandlerAddress, "safe fallback handler address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	threshold := request.Threshold
	if threshold == 0 {
		threshold = 1
	}
	if threshold != 1 {
		return SafeProvisioningBundle{}, fmt.Errorf("only threshold=1 is supported in the current provisioning bundle")
	}

	sessionSigner, sessionPrivateKeyHex, err := resolveSessionSigner(request.SessionPrivateKey)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	sessionKeyAddress := crypto.PubkeyToAddress(sessionSigner.PublicKey).Hex()

	setupDelegateTarget := common.Address{}
	if strings.TrimSpace(request.SetupDelegateTarget) != "" {
		normalized, err := normalizeRequiredAddress(request.SetupDelegateTarget, "setup delegate target")
		if err != nil {
			return SafeProvisioningBundle{}, err
		}
		setupDelegateTarget = common.HexToAddress(normalized)
	}
	setupDelegateData, err := normalizeOptionalHexBytes(request.SetupDelegateCalldata)
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("invalid setup delegate calldata: %w", err)
	}
	if len(setupDelegateData) > 0 && setupDelegateTarget == (common.Address{}) {
		return SafeProvisioningBundle{}, fmt.Errorf("setup delegate target required when setup delegate calldata is provided")
	}
	saltNonce, saltNonceText, err := resolveSaltNonce(request.SaltNonce)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}

	setupPayload, err := safeSingletonABI.Pack(
		"setup",
		[]common.Address{common.HexToAddress(ownerAddress)},
		new(big.Int).SetUint64(threshold),
		setupDelegateTarget,
		setupDelegateData,
		common.HexToAddress(fallbackHandler),
		common.Address{},
		big.NewInt(0),
		common.Address{},
	)
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("pack safe setup calldata: %w", err)
	}
	factoryPayload, err := safeProxyFactoryABI.Pack(
		"createProxyWithNonce",
		common.HexToAddress(singletonAddress),
		setupPayload,
		saltNonce,
	)
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("pack safe proxy factory calldata: %w", err)
	}

	smartWalletAddress := ""
	needsPostDeployAddressSet := true
	if proxyCreationCode, err := normalizeOptionalHexBytes(request.ProxyCreationCode); err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("invalid proxy creation code: %w", err)
	} else if len(proxyCreationCode) > 0 {
		predicted, err := predictSafeProxyAddress(factoryAddress, singletonAddress, proxyCreationCode, setupPayload, saltNonce)
		if err != nil {
			return SafeProvisioningBundle{}, err
		}
		smartWalletAddress = predicted
		needsPostDeployAddressSet = false
	}

	policy := relayer.SCWExecutionPolicy{
		SmartWalletAddress:       smartWalletAddress,
		SessionKeyAddress:        sessionKeyAddress,
		PolicyID:                 strings.TrimSpace(request.PolicyID),
		AllowedChainIDs:          cloneInt64s(request.ChainID),
		AllowedContractAddresses: normalizeAddressSlice(request.AllowedContractAddresses),
		AllowedFunctionSelectors: normalizeSelectorSlice(request.AllowedFunctionSelectors),
		MaxValueWei:              normalizeMaxValue(request.MaxValueWei),
		MaxGasLimit:              request.MaxGasLimit,
	}
	if request.SessionDeadlineGraceSeconds > 0 {
		policy.DeadlineGracePeriod = time.Duration(request.SessionDeadlineGraceSeconds) * time.Second
	}

	var enableModuleAction *SafeAction
	var grantSessionKeyAction *SafeAction
	moduleAddressText := strings.TrimSpace(request.StrategyPolicyModuleAddress)
	if moduleAddressText != "" {
		moduleAddress, err := normalizeRequiredAddress(moduleAddressText, "strategy policy module address")
		if err != nil {
			return SafeProvisioningBundle{}, err
		}
		if smartWalletAddress != "" {
			enablePayload, err := safeModuleManagerABI.Pack("enableModule", common.HexToAddress(moduleAddress))
			if err != nil {
				return SafeProvisioningBundle{}, fmt.Errorf("pack safe enableModule calldata: %w", err)
			}
			enableModuleAction = &SafeAction{
				Safe:  smartWalletAddress,
				To:    smartWalletAddress,
				Data:  "0x" + hex.EncodeToString(enablePayload),
				Value: "0",
			}

			maxValueWei, err := parseBundleWeiValue(request.MaxValueWei)
			if err != nil {
				return SafeProvisioningBundle{}, fmt.Errorf("invalid max value wei: %w", err)
			}
			selectorBytes, err := selectorsToBytes4(request.AllowedFunctionSelectors)
			if err != nil {
				return SafeProvisioningBundle{}, err
			}
			targets := make([]common.Address, 0, len(request.AllowedContractAddresses))
			for _, candidate := range normalizeAddressSlice(request.AllowedContractAddresses) {
				targets = append(targets, common.HexToAddress(candidate))
			}
			validAfter, err := normalizeUint48(request.SessionValidAfterUnix, "session validAfter")
			if err != nil {
				return SafeProvisioningBundle{}, err
			}
			validUntil, err := normalizeUint48(request.SessionValidUntilUnix, "session validUntil")
			if err != nil {
				return SafeProvisioningBundle{}, err
			}
			grantPayload, err := strategyPolicyModuleABI.Pack(
				"grantSessionKey",
				common.HexToAddress(sessionKeyAddress),
				relayerPolicyHash(request.PolicyID),
				new(big.Int).SetUint64(validAfter),
				new(big.Int).SetUint64(validUntil),
				request.MaxGasLimit,
				maxValueWei,
				targets,
				selectorBytes,
			)
			if err != nil {
				return SafeProvisioningBundle{}, fmt.Errorf("pack grantSessionKey calldata: %w", err)
			}
			grantSessionKeyAction = &SafeAction{
				Safe:  smartWalletAddress,
				To:    moduleAddress,
				Data:  "0x" + hex.EncodeToString(grantPayload),
				Value: "0",
			}
		}
		moduleAddressText = moduleAddress
	}

	return SafeProvisioningBundle{
		OwnerAddress:                ownerAddress,
		ChainID:                     request.ChainID,
		PolicyID:                    strings.TrimSpace(request.PolicyID),
		SessionPrivateKey:           sessionPrivateKeyHex,
		SessionKeyAddress:           sessionKeyAddress,
		SmartWalletAddress:          smartWalletAddress,
		StrategyPolicyModuleAddress: moduleAddressText,
		SaltNonce:                   saltNonceText,
		SafeSetupCalldata:           "0x" + hex.EncodeToString(setupPayload),
		DeploymentCall:              DeploymentCall{To: factoryAddress, Data: "0x" + hex.EncodeToString(factoryPayload), Value: "0"},
		EnableModuleAction:          enableModuleAction,
		GrantSessionKeyAction:       grantSessionKeyAction,
		RelayerPolicy:               policy,
		NeedsPostDeployAddressSet:   needsPostDeployAddressSet,
	}, nil
}

// AttachStrategyPolicyModule adds Safe-executable module setup actions to an
// existing deployed SCW bundle while preserving its owner and session key.
func AttachStrategyPolicyModule(bundle SafeProvisioningBundle, request StrategyPolicyModuleActionRequest) (SafeProvisioningBundle, error) {
	normalized, err := normalizeBundleForStorage(bundle)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	smartWalletAddress, err := normalizeRequiredAddress(normalized.SmartWalletAddress, "smart wallet address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	sessionKeyAddress, err := normalizeRequiredAddress(normalized.SessionKeyAddress, "session key address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	moduleAddress, err := normalizeRequiredAddress(request.StrategyPolicyModuleAddress, "strategy policy module address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}

	policyID := firstTrimmed(normalized.PolicyID, normalized.RelayerPolicy.PolicyID)
	if policyID == "" {
		policyID = defaultPolicyID
	}
	allowedContracts := normalizeAddressSlice(preferStringSlice(request.AllowedContractAddresses, normalized.RelayerPolicy.AllowedContractAddresses))
	allowedSelectors := normalizeSelectorSlice(preferStringSlice(request.AllowedFunctionSelectors, normalized.RelayerPolicy.AllowedFunctionSelectors))
	maxValueWei := firstTrimmed(request.MaxValueWei, normalized.RelayerPolicy.MaxValueWei)
	maxGasLimit := request.MaxGasLimit
	if maxGasLimit == 0 {
		maxGasLimit = normalized.RelayerPolicy.MaxGasLimit
	}

	enablePayload, err := safeModuleManagerABI.Pack("enableModule", common.HexToAddress(moduleAddress))
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("pack safe enableModule calldata: %w", err)
	}
	maxValue, err := parseBundleWeiValue(maxValueWei)
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("invalid max value wei: %w", err)
	}
	selectorBytes, err := selectorsToBytes4(allowedSelectors)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	targets := make([]common.Address, 0, len(allowedContracts))
	for _, candidate := range allowedContracts {
		targets = append(targets, common.HexToAddress(candidate))
	}
	validAfter, err := normalizeUint48(request.SessionValidAfterUnix, "session validAfter")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	validUntil, err := normalizeUint48(request.SessionValidUntilUnix, "session validUntil")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	grantPayload, err := strategyPolicyModuleABI.Pack(
		"grantSessionKey",
		common.HexToAddress(sessionKeyAddress),
		relayerPolicyHash(policyID),
		new(big.Int).SetUint64(validAfter),
		new(big.Int).SetUint64(validUntil),
		maxGasLimit,
		maxValue,
		targets,
		selectorBytes,
	)
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("pack grantSessionKey calldata: %w", err)
	}

	normalized.PolicyID = policyID
	normalized.SmartWalletAddress = smartWalletAddress
	normalized.SessionKeyAddress = sessionKeyAddress
	normalized.StrategyPolicyModuleAddress = moduleAddress
	normalized.EnableModuleAction = &SafeAction{
		Safe:  smartWalletAddress,
		To:    smartWalletAddress,
		Data:  "0x" + hex.EncodeToString(enablePayload),
		Value: "0",
	}
	normalized.GrantSessionKeyAction = &SafeAction{
		Safe:  smartWalletAddress,
		To:    moduleAddress,
		Data:  "0x" + hex.EncodeToString(grantPayload),
		Value: "0",
	}
	normalized.RelayerPolicy.SmartWalletAddress = smartWalletAddress
	normalized.RelayerPolicy.SessionKeyAddress = sessionKeyAddress
	normalized.RelayerPolicy.PolicyID = policyID
	if len(normalized.RelayerPolicy.AllowedChainIDs) == 0 && normalized.ChainID > 0 {
		normalized.RelayerPolicy.AllowedChainIDs = cloneInt64s(normalized.ChainID)
	}
	normalized.RelayerPolicy.AllowedContractAddresses = allowedContracts
	normalized.RelayerPolicy.AllowedFunctionSelectors = allowedSelectors
	normalized.RelayerPolicy.MaxValueWei = normalizeMaxValue(maxValueWei)
	normalized.RelayerPolicy.MaxGasLimit = maxGasLimit
	normalized.NeedsPostDeployAddressSet = false
	return normalized, nil
}

func resolveSessionSigner(raw string) (*ecdsa.PrivateKey, string, error) {
	if strings.TrimSpace(raw) != "" {
		normalized := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(raw), "0x"), "0X")
		signer, err := crypto.HexToECDSA(normalized)
		if err != nil {
			return nil, "", fmt.Errorf("invalid session private key: %w", err)
		}
		return signer, "0x" + strings.ToLower(normalized), nil
	}
	signer, err := ecdsa.GenerateKey(crypto.S256(), rand.Reader)
	if err != nil {
		return nil, "", fmt.Errorf("generate session key: %w", err)
	}
	privateBytes := make([]byte, 32)
	encoded := signer.D.FillBytes(privateBytes)
	return signer, "0x" + hex.EncodeToString(encoded), nil
}

func resolveSaltNonce(raw string) (*big.Int, string, error) {
	if strings.TrimSpace(raw) != "" {
		nonce, err := parseBigInt(raw)
		if err != nil {
			return nil, "", fmt.Errorf("invalid salt nonce: %w", err)
		}
		if nonce.Sign() < 0 {
			return nil, "", fmt.Errorf("salt nonce cannot be negative")
		}
		return nonce, nonce.String(), nil
	}
	max := new(big.Int).Lsh(big.NewInt(1), 128)
	nonce, err := rand.Int(rand.Reader, max)
	if err != nil {
		return nil, "", fmt.Errorf("generate salt nonce: %w", err)
	}
	return nonce, nonce.String(), nil
}

func normalizeRequiredAddress(raw, field string) (string, error) {
	text := strings.TrimSpace(raw)
	if !common.IsHexAddress(text) {
		return "", fmt.Errorf("%s required", field)
	}
	return common.HexToAddress(text).Hex(), nil
}

func normalizeOptionalHexBytes(raw string) ([]byte, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, nil
	}
	text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	if len(text)%2 != 0 {
		text = "0" + text
	}
	decoded, err := hex.DecodeString(text)
	if err != nil {
		return nil, err
	}
	return decoded, nil
}

func predictSafeProxyAddress(factoryAddress, singletonAddress string, proxyCreationCode []byte, initializer []byte, saltNonce *big.Int) (string, error) {
	if len(proxyCreationCode) == 0 {
		return "", fmt.Errorf("proxy creation code required to predict safe address")
	}
	deploymentData := append([]byte{}, proxyCreationCode...)
	deploymentData = append(deploymentData, common.LeftPadBytes(common.HexToAddress(singletonAddress).Bytes(), 32)...)
	deploymentHash := crypto.Keccak256(deploymentData)

	initHash := crypto.Keccak256(initializer)
	saltPreimage := append([]byte{}, initHash...)
	saltPreimage = append(saltPreimage, common.LeftPadBytes(saltNonce.Bytes(), 32)...)
	create2Salt := crypto.Keccak256(saltPreimage)

	preimage := []byte{0xff}
	preimage = append(preimage, common.HexToAddress(factoryAddress).Bytes()...)
	preimage = append(preimage, create2Salt...)
	preimage = append(preimage, deploymentHash...)
	hash := crypto.Keccak256(preimage)
	return common.BytesToAddress(hash[12:]).Hex(), nil
}

func parseBigInt(raw string) (*big.Int, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, fmt.Errorf("empty integer")
	}
	base := 10
	if strings.HasPrefix(text, "0x") || strings.HasPrefix(text, "0X") {
		text = text[2:]
		base = 16
	}
	value := new(big.Int)
	if _, ok := value.SetString(text, base); !ok {
		return nil, fmt.Errorf("invalid integer: %s", raw)
	}
	return value, nil
}

func normalizeAddressSlice(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, candidate := range raw {
		if common.IsHexAddress(strings.TrimSpace(candidate)) {
			out = append(out, common.HexToAddress(strings.TrimSpace(candidate)).Hex())
		}
	}
	return out
}

func parseBundleWeiValue(raw string) (*big.Int, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return big.NewInt(0), nil
	}
	text = strings.TrimSuffix(strings.TrimSuffix(text, "wei"), "WEI")
	value := new(big.Int)
	if _, ok := value.SetString(text, 10); !ok {
		return nil, fmt.Errorf("invalid wei value: %s", raw)
	}
	if value.Sign() < 0 {
		return nil, fmt.Errorf("wei value cannot be negative")
	}
	return value, nil
}

func selectorsToBytes4(raw []string) ([][4]byte, error) {
	out := make([][4]byte, 0, len(raw))
	for _, candidate := range normalizeSelectorSlice(raw) {
		selectorHex := strings.TrimPrefix(candidate, "0x")
		decoded, err := hex.DecodeString(selectorHex)
		if err != nil || len(decoded) != 4 {
			return nil, fmt.Errorf("invalid function selector: %s", candidate)
		}
		var selector [4]byte
		copy(selector[:], decoded)
		out = append(out, selector)
	}
	return out, nil
}

func normalizeUint48(value int64, field string) (uint64, error) {
	if value < 0 {
		return 0, fmt.Errorf("%s cannot be negative", field)
	}
	if value > int64(^uint64(0)>>16) {
		return 0, fmt.Errorf("%s exceeds uint48", field)
	}
	return uint64(value), nil
}

func relayerPolicyHash(policyID string) [32]byte {
	hash := relayerStringHash(policyID)
	var out [32]byte
	copy(out[:], hash.Bytes())
	return out
}

func relayerStringHash(value string) common.Hash {
	return crypto.Keccak256Hash([]byte(strings.TrimSpace(value)))
}

func normalizeSelectorSlice(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, candidate := range raw {
		text := strings.TrimSpace(candidate)
		text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
		if text == "" {
			continue
		}
		if len(text) > 8 {
			text = text[:8]
		}
		if len(text) < 8 {
			continue
		}
		if _, err := hex.DecodeString(text); err != nil {
			continue
		}
		out = append(out, "0x"+strings.ToLower(text))
	}
	return out
}

func normalizeMaxValue(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	text = strings.TrimSuffix(strings.TrimSuffix(text, "wei"), "WEI")
	if text == "" {
		return ""
	}
	return text
}

func preferStringSlice(primary, fallback []string) []string {
	if len(primary) > 0 {
		return primary
	}
	return fallback
}

func cloneInt64s(value int64) []int64 {
	if value == 0 {
		return nil
	}
	return []int64{value}
}

func mustParseABI(raw string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}
