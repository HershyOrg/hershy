package onboarding

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/scw"
)

var (
	safeModuleStatusABI = mustParseABI(`[
		{
			"inputs":[{"internalType":"address","name":"module","type":"address"}],
			"name":"isModuleEnabled",
			"outputs":[{"internalType":"bool","name":"","type":"bool"}],
			"stateMutability":"view",
			"type":"function"
		}
	]`)
	strategyPolicyStatusABI = mustParseABI(`[
		{
			"inputs":[
				{"internalType":"address","name":"","type":"address"},
				{"internalType":"address","name":"","type":"address"}
			],
			"name":"sessionPolicies",
			"outputs":[
				{"internalType":"bool","name":"active","type":"bool"},
				{"internalType":"bool","name":"paused","type":"bool"},
				{"internalType":"uint48","name":"validAfter","type":"uint48"},
				{"internalType":"uint48","name":"validUntil","type":"uint48"},
				{"internalType":"uint64","name":"maxGasLimit","type":"uint64"},
				{"internalType":"uint256","name":"maxValueWei","type":"uint256"},
				{"internalType":"bytes32","name":"policyIdHash","type":"bytes32"}
			],
			"stateMutability":"view",
			"type":"function"
		}
	]`)
)

type Service struct {
	Manager  scw.BundleManager
	Defaults ServerDefaults
	Now      func() time.Time
}

func NewService(defaults ServerDefaults) Service {
	return Service{
		Manager:  scw.NewBundleManager(),
		Defaults: defaults,
		Now:      time.Now,
	}
}

func (s Service) Prepare(ctx context.Context, request PrepareRequest) (PrepareResponse, error) {
	options := s.prepareOptions(request)
	identity := options.BundleIdentityOptions

	var (
		result scw.BundleOperationResult
		err    error
	)
	if !request.ForceRecreate {
		result, err = s.Manager.ShowBundle(identity)
	}
	if request.ForceRecreate || err != nil {
		result, err = s.Manager.CreateBundle(options)
		if err != nil {
			return PrepareResponse{}, err
		}
	}

	if strings.TrimSpace(request.SmartWalletAddress) != "" && !strings.EqualFold(result.SmartWalletAddress, request.SmartWalletAddress) {
		result, err = s.Manager.UpdateSmartWalletAddress(scw.BundleSmartWalletUpdateOptions{
			BundleIdentityOptions: identity,
			SmartWalletAddress:    strings.TrimSpace(request.SmartWalletAddress),
		})
		if err != nil {
			return PrepareResponse{}, err
		}
	}

	moduleAddress := firstNonEmpty(request.StrategyPolicyModule, s.Defaults.StrategyPolicyModule)
	if strings.TrimSpace(moduleAddress) != "" && strings.TrimSpace(result.SmartWalletAddress) != "" {
		result, err = s.Manager.UpdateStrategyPolicyModule(scw.BundleStrategyPolicyModuleUpdateOptions{
			BundleIdentityOptions:    identity,
			StrategyPolicyModule:     moduleAddress,
			SessionValidAfterUnix:    firstNonZeroInt64(request.SessionValidAfterUnix, s.Defaults.SessionValidAfterUnix),
			SessionValidUntilUnix:    firstNonZeroInt64(request.SessionValidUntilUnix, s.Defaults.SessionValidUntilUnix),
			AllowedContractAddresses: firstNonEmptySlice(request.AllowedContractAddresses, s.Defaults.AllowedContractAddresses),
			AllowedFunctionSelectors: firstNonEmptySlice(request.AllowedFunctionSelectors, s.Defaults.AllowedFunctionSelectors),
			MaxValueWei:              firstNonEmpty(request.MaxValueWei, s.Defaults.MaxValueWei, "0"),
			MaxGasLimit:              firstNonZeroUint64(request.MaxGasLimit, s.Defaults.MaxGasLimit),
		})
		if err != nil {
			return PrepareResponse{}, err
		}
	}

	status := s.statusFromBundle(ctx, result, firstNonEmpty(s.Defaults.RPCURL))
	return PrepareResponse{
		Status:            status,
		Bundle:            result,
		PermissionSummary: permissionSummary(result),
		NextActions:       nextActions(result),
	}, nil
}

func (s Service) Status(ctx context.Context, request StatusRequest) (StatusResponse, error) {
	identity := scw.BundleIdentityOptions{
		StoreRoot:    firstNonEmpty(s.Defaults.StoreRoot, ".scw/bundles"),
		OwnerAddress: strings.TrimSpace(request.OwnerAddress),
		ChainID:      firstNonZeroInt64(request.ChainID, s.Defaults.ChainID),
		PolicyID:     firstNonEmpty(request.PolicyID, s.Defaults.PolicyID, "default"),
	}
	result, err := s.Manager.ShowBundle(identity)
	if err != nil {
		return StatusResponse{
			State:            StateNotCreated,
			VerificationMode: "bundle_only",
			OwnerAddress:     identity.OwnerAddress,
			ChainID:          identity.ChainID,
			PolicyID:         identity.PolicyID,
			CheckedAt:        s.now(),
			Error:            err.Error(),
		}, nil
	}
	return s.statusFromBundle(ctx, result, firstNonEmpty(request.RPCURL, s.Defaults.RPCURL)), nil
}

func (s Service) Confirm(ctx context.Context, request ConfirmRequest) (ConfirmResponse, error) {
	identity := scw.BundleIdentityOptions{
		StoreRoot:    firstNonEmpty(s.Defaults.StoreRoot, ".scw/bundles"),
		OwnerAddress: strings.TrimSpace(request.OwnerAddress),
		ChainID:      firstNonZeroInt64(request.ChainID, s.Defaults.ChainID),
		PolicyID:     firstNonEmpty(request.PolicyID, s.Defaults.PolicyID, "default"),
	}
	if strings.TrimSpace(request.Kind) == "" {
		return ConfirmResponse{}, errors.New("confirmation kind required")
	}
	if strings.TrimSpace(request.TxHash) == "" {
		return ConfirmResponse{}, errors.New("tx hash required")
	}
	if strings.EqualFold(request.Kind, "deploy") && strings.TrimSpace(request.SmartWalletAddress) != "" {
		if _, err := s.Manager.UpdateSmartWalletAddress(scw.BundleSmartWalletUpdateOptions{
			BundleIdentityOptions: identity,
			SmartWalletAddress:    strings.TrimSpace(request.SmartWalletAddress),
		}); err != nil {
			return ConfirmResponse{}, err
		}
	}
	status, err := s.Status(ctx, StatusRequest{
		OwnerAddress: request.OwnerAddress,
		ChainID:      request.ChainID,
		PolicyID:     request.PolicyID,
	})
	if err != nil {
		return ConfirmResponse{}, err
	}
	return ConfirmResponse{
		Status:  status,
		Message: fmt.Sprintf("%s confirmation recorded for %s", strings.TrimSpace(request.Kind), strings.TrimSpace(request.TxHash)),
	}, nil
}

func (s Service) prepareOptions(request PrepareRequest) scw.BundleCreateOptions {
	return scw.BundleCreateOptions{
		BundleIdentityOptions: scw.BundleIdentityOptions{
			StoreRoot:    firstNonEmpty(s.Defaults.StoreRoot, ".scw/bundles"),
			OwnerAddress: strings.TrimSpace(request.OwnerAddress),
			ChainID:      firstNonZeroInt64(request.ChainID, s.Defaults.ChainID),
			PolicyID:     firstNonEmpty(request.PolicyID, s.Defaults.PolicyID, "default"),
		},
		SafeSingletonAddress:       firstNonEmpty(request.SafeSingletonAddress, s.Defaults.SafeSingletonAddress),
		SafeProxyFactoryAddress:    firstNonEmpty(request.SafeProxyFactoryAddress, s.Defaults.SafeProxyFactoryAddress),
		SafeFallbackHandlerAddress: firstNonEmpty(request.SafeFallbackHandlerAddress, s.Defaults.SafeFallbackHandlerAddress),
		ProxyCreationCode:          firstNonEmpty(request.ProxyCreationCode, s.Defaults.ProxyCreationCode),
		StrategyPolicyModule:       firstNonEmpty(request.StrategyPolicyModule, s.Defaults.StrategyPolicyModule),
		SessionValidAfterUnix:      firstNonZeroInt64(request.SessionValidAfterUnix, s.Defaults.SessionValidAfterUnix),
		SessionValidUntilUnix:      firstNonZeroInt64(request.SessionValidUntilUnix, s.Defaults.SessionValidUntilUnix),
		AllowedContractAddresses:   firstNonEmptySlice(request.AllowedContractAddresses, s.Defaults.AllowedContractAddresses),
		AllowedFunctionSelectors:   firstNonEmptySlice(request.AllowedFunctionSelectors, s.Defaults.AllowedFunctionSelectors),
		MaxValueWei:                firstNonEmpty(request.MaxValueWei, s.Defaults.MaxValueWei, "0"),
		MaxGasLimit:                firstNonZeroUint64(request.MaxGasLimit, s.Defaults.MaxGasLimit),
		DeadlineGraceSeconds:       firstNonZeroInt64(request.DeadlineGraceSeconds, s.Defaults.DeadlineGraceSeconds),
	}
}

func (s Service) statusFromBundle(ctx context.Context, bundle scw.BundleOperationResult, rpcURL string) StatusResponse {
	status := StatusResponse{
		State:                deriveBundleState(bundle),
		VerificationMode:     "bundle_only",
		OwnerAddress:         bundle.OwnerAddress,
		ChainID:              bundle.ChainID,
		PolicyID:             bundle.PolicyID,
		SmartWalletAddress:   bundle.SmartWalletAddress,
		SessionKeyAddress:    bundle.SessionKeyAddress,
		StrategyPolicyModule: bundle.StrategyPolicyModule,
		BundleExists:         true,
		DeploymentCallReady:  strings.TrimSpace(bundle.DeploymentCall.To) != "" && strings.TrimSpace(bundle.DeploymentCall.Data) != "",
		ModuleActionReady:    bundle.EnableModuleAction != nil,
		SessionGrantReady:    bundle.GrantSessionKeyAction != nil,
		CheckedAt:            s.now(),
	}
	if strings.TrimSpace(rpcURL) == "" || strings.TrimSpace(bundle.SmartWalletAddress) == "" {
		return status
	}
	status.VerificationMode = "rpc"
	if err := s.attachOnChainStatus(ctx, rpcURL, bundle, &status); err != nil {
		status.Error = err.Error()
		status.State = StateFailed
		return status
	}
	deployed := status.SmartWalletDeployed != nil && *status.SmartWalletDeployed
	moduleEnabled := status.ModuleEnabled != nil && *status.ModuleEnabled
	sessionActive := status.SessionPolicyActive != nil && *status.SessionPolicyActive
	sessionValid := status.SessionPolicyValid == nil || *status.SessionPolicyValid
	status.ReadyForRelay = deployed && moduleEnabled && sessionActive && sessionValid
	if status.ReadyForRelay {
		status.State = StateReady
	} else if deployed {
		status.State = StateDeployed
	}
	return status
}

func (s Service) attachOnChainStatus(ctx context.Context, rpcURL string, bundle scw.BundleOperationResult, status *StatusResponse) error {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	client, err := ethclient.DialContext(ctx, strings.TrimSpace(rpcURL))
	if err != nil {
		return fmt.Errorf("eth rpc dial failed: %w", err)
	}
	defer client.Close()

	smartWallet := common.HexToAddress(bundle.SmartWalletAddress)
	code, err := client.CodeAt(ctx, smartWallet, nil)
	if err != nil {
		return fmt.Errorf("fetch smart wallet code: %w", err)
	}
	codeSize := len(code)
	deployed := codeSize > 0
	status.SmartWalletCodeSize = &codeSize
	status.SmartWalletDeployed = &deployed

	if strings.TrimSpace(bundle.StrategyPolicyModule) == "" || strings.TrimSpace(bundle.SessionKeyAddress) == "" {
		return nil
	}
	module := common.HexToAddress(bundle.StrategyPolicyModule)
	moduleEnabled, err := callSafeModuleEnabled(ctx, client, smartWallet, module)
	if err != nil {
		return err
	}
	status.ModuleEnabled = &moduleEnabled

	sessionPolicy, err := callSessionPolicy(ctx, client, module, smartWallet, common.HexToAddress(bundle.SessionKeyAddress))
	if err != nil {
		return err
	}
	status.SessionPolicyActive = &sessionPolicy.Active
	status.SessionPolicyPaused = &sessionPolicy.Paused
	now := s.now().Unix()
	valid := sessionPolicy.Active && !sessionPolicy.Paused
	if sessionPolicy.ValidAfter > 0 && now < int64(sessionPolicy.ValidAfter) {
		valid = false
	}
	if sessionPolicy.ValidUntil > 0 && now > int64(sessionPolicy.ValidUntil) {
		valid = false
	}
	status.SessionPolicyValid = &valid
	return nil
}

func permissionSummary(bundle scw.BundleOperationResult) PermissionSummary {
	return PermissionSummary{
		Title:                    "전략 실행 권한 허용",
		Description:              "이 전략이 사용자의 트레이딩 지갑에서 허용된 자산, DEX, 함수, 한도 안에서만 실행되도록 설정합니다.",
		SmartWalletAddress:       bundle.SmartWalletAddress,
		SessionKeyAddress:        bundle.SessionKeyAddress,
		StrategyPolicyModule:     bundle.StrategyPolicyModule,
		AllowedContractAddresses: bundle.RelayerPolicy.AllowedContractAddresses,
		AllowedFunctionSelectors: bundle.RelayerPolicy.AllowedFunctionSelectors,
		MaxValueWei:              bundle.RelayerPolicy.MaxValueWei,
		MaxGasLimit:              bundle.RelayerPolicy.MaxGasLimit,
	}
}

func nextActions(bundle scw.BundleOperationResult) []UserAction {
	actions := []UserAction{}
	if strings.TrimSpace(bundle.SmartWalletAddress) == "" && strings.TrimSpace(bundle.DeploymentCall.To) != "" {
		actions = append(actions, UserAction{
			ID:          "deploy_smart_wallet",
			Label:       "트레이딩 지갑 생성",
			Description: "사용자의 owner 지갑으로 Safe 기반 SCW를 배포합니다.",
			Action: &scw.SafeAction{
				To:    bundle.DeploymentCall.To,
				Data:  bundle.DeploymentCall.Data,
				Value: bundle.DeploymentCall.Value,
			},
		})
	}
	if bundle.EnableModuleAction != nil {
		actions = append(actions, UserAction{
			ID:          "enable_strategy_module",
			Label:       "전략 실행 모듈 허용",
			Description: "SCW가 StrategyPolicyModule을 통해 제한된 전략 실행을 허용하도록 설정합니다.",
			Action:      bundle.EnableModuleAction,
		})
	}
	if bundle.GrantSessionKeyAction != nil {
		actions = append(actions, UserAction{
			ID:          "grant_strategy_session_key",
			Label:       "전략 실행 권한 허용",
			Description: "session key에 이 전략의 제한된 실행 권한을 부여합니다.",
			Action:      bundle.GrantSessionKeyAction,
		})
	}
	return actions
}

func deriveBundleState(bundle scw.BundleOperationResult) OnboardingState {
	if strings.TrimSpace(bundle.OwnerAddress) == "" {
		return StateNotCreated
	}
	if strings.TrimSpace(bundle.SmartWalletAddress) == "" {
		return StateBundleCreated
	}
	if bundle.EnableModuleAction != nil && bundle.GrantSessionKeyAction != nil {
		return StateModuleActionsReady
	}
	return StateDeployed
}

type sessionPolicySnapshot struct {
	Active     bool
	Paused     bool
	ValidAfter uint64
	ValidUntil uint64
}

func callSafeModuleEnabled(ctx context.Context, client *ethclient.Client, safe, module common.Address) (bool, error) {
	payload, err := safeModuleStatusABI.Pack("isModuleEnabled", module)
	if err != nil {
		return false, fmt.Errorf("pack isModuleEnabled: %w", err)
	}
	output, err := client.CallContract(ctx, ethereum.CallMsg{To: &safe, Data: payload}, nil)
	if err != nil {
		return false, fmt.Errorf("call isModuleEnabled: %w", err)
	}
	values, err := safeModuleStatusABI.Unpack("isModuleEnabled", output)
	if err != nil {
		return false, fmt.Errorf("unpack isModuleEnabled: %w", err)
	}
	enabled, ok := values[0].(bool)
	if !ok {
		return false, errors.New("isModuleEnabled returned non-bool")
	}
	return enabled, nil
}

func callSessionPolicy(ctx context.Context, client *ethclient.Client, module, safe, sessionKey common.Address) (sessionPolicySnapshot, error) {
	payload, err := strategyPolicyStatusABI.Pack("sessionPolicies", safe, sessionKey)
	if err != nil {
		return sessionPolicySnapshot{}, fmt.Errorf("pack sessionPolicies: %w", err)
	}
	output, err := client.CallContract(ctx, ethereum.CallMsg{To: &module, Data: payload}, nil)
	if err != nil {
		return sessionPolicySnapshot{}, fmt.Errorf("call sessionPolicies: %w", err)
	}
	values, err := strategyPolicyStatusABI.Unpack("sessionPolicies", output)
	if err != nil {
		return sessionPolicySnapshot{}, fmt.Errorf("unpack sessionPolicies: %w", err)
	}
	if len(values) < 4 {
		return sessionPolicySnapshot{}, errors.New("sessionPolicies returned short output")
	}
	active, _ := values[0].(bool)
	paused, _ := values[1].(bool)
	validAfter, err := uint64FromABIValue(values[2])
	if err != nil {
		return sessionPolicySnapshot{}, fmt.Errorf("decode validAfter: %w", err)
	}
	validUntil, err := uint64FromABIValue(values[3])
	if err != nil {
		return sessionPolicySnapshot{}, fmt.Errorf("decode validUntil: %w", err)
	}
	return sessionPolicySnapshot{
		Active:     active,
		Paused:     paused,
		ValidAfter: validAfter,
		ValidUntil: validUntil,
	}, nil
}

func uint64FromABIValue(value any) (uint64, error) {
	switch typed := value.(type) {
	case uint64:
		return typed, nil
	case *big.Int:
		if !typed.IsUint64() {
			return 0, fmt.Errorf("value exceeds uint64: %s", typed.String())
		}
		return typed.Uint64(), nil
	default:
		return 0, fmt.Errorf("unsupported uint64 ABI type %T", value)
	}
}

func mustParseABI(raw string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}

func (s Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonZeroInt64(values ...int64) int64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func firstNonZeroUint64(values ...uint64) uint64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func firstNonEmptySlice(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			out := make([]string, len(value))
			copy(out, value)
			return out
		}
	}
	return nil
}
