package relayer

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/base"
)

var (
	safeModuleReadinessABI = mustParseABI(`[
		{
			"inputs":[{"internalType":"address","name":"module","type":"address"}],
			"name":"isModuleEnabled",
			"outputs":[{"internalType":"bool","name":"","type":"bool"}],
			"stateMutability":"view",
			"type":"function"
		}
	]`)
	strategyPolicyReadinessABI = mustParseABI(`[
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

type RPCReadinessChecker struct {
	RPCURL        string
	ModuleAddress string
	Now           func() time.Time
}

type readinessSessionPolicy struct {
	Active     bool
	Paused     bool
	ValidAfter uint64
	ValidUntil uint64
}

func (c RPCReadinessChecker) CheckReady(ctx context.Context, request base.SCWRelayRequest, policy SCWExecutionPolicy) error {
	rpcURL := strings.TrimSpace(c.RPCURL)
	if rpcURL == "" {
		return errors.New("ready check rpc url required")
	}
	moduleAddress := firstNonEmpty(policy.StrategyPolicyModule, c.ModuleAddress)
	if !common.IsHexAddress(moduleAddress) {
		return errors.New("ready check strategy policy module address required")
	}
	if !common.IsHexAddress(request.SmartWalletAddress) {
		return errors.New("ready check smart wallet address invalid")
	}
	if !common.IsHexAddress(request.SessionKeyAddress) {
		return errors.New("ready check session key address invalid")
	}

	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return fmt.Errorf("ready check rpc dial: %w", err)
	}
	defer client.Close()

	safe := common.HexToAddress(request.SmartWalletAddress)
	code, err := client.CodeAt(ctx, safe, nil)
	if err != nil {
		return fmt.Errorf("ready check smart wallet code: %w", err)
	}
	if len(code) == 0 {
		return fmt.Errorf("smart wallet is not deployed: %s", safe.Hex())
	}

	module := common.HexToAddress(moduleAddress)
	moduleEnabled, err := readinessModuleEnabled(ctx, client, safe, module)
	if err != nil {
		return err
	}
	if !moduleEnabled {
		return fmt.Errorf("strategy policy module is not enabled for smart wallet: safe=%s module=%s", safe.Hex(), module.Hex())
	}

	sessionPolicy, err := readinessSessionPolicyAt(ctx, client, module, safe, common.HexToAddress(request.SessionKeyAddress))
	if err != nil {
		return err
	}
	now := time.Now()
	if c.Now != nil {
		now = c.Now()
	}
	if !sessionPolicy.Active {
		return fmt.Errorf("session policy is not active: safe=%s session_key=%s", safe.Hex(), common.HexToAddress(request.SessionKeyAddress).Hex())
	}
	if sessionPolicy.Paused {
		return fmt.Errorf("session policy is paused: safe=%s session_key=%s", safe.Hex(), common.HexToAddress(request.SessionKeyAddress).Hex())
	}
	if sessionPolicy.ValidAfter > 0 && now.Unix() < int64(sessionPolicy.ValidAfter) {
		return fmt.Errorf("session policy is not yet valid: valid_after=%d now=%d", sessionPolicy.ValidAfter, now.Unix())
	}
	if sessionPolicy.ValidUntil > 0 && now.Unix() > int64(sessionPolicy.ValidUntil) {
		return fmt.Errorf("session policy expired: valid_until=%d now=%d", sessionPolicy.ValidUntil, now.Unix())
	}
	return nil
}

func readinessModuleEnabled(ctx context.Context, client *ethclient.Client, safe, module common.Address) (bool, error) {
	payload, err := safeModuleReadinessABI.Pack("isModuleEnabled", module)
	if err != nil {
		return false, fmt.Errorf("pack isModuleEnabled: %w", err)
	}
	output, err := client.CallContract(ctx, ethereum.CallMsg{To: &safe, Data: payload}, nil)
	if err != nil {
		return false, fmt.Errorf("call isModuleEnabled: %w", err)
	}
	values, err := safeModuleReadinessABI.Unpack("isModuleEnabled", output)
	if err != nil {
		return false, fmt.Errorf("unpack isModuleEnabled: %w", err)
	}
	enabled, ok := values[0].(bool)
	if !ok {
		return false, errors.New("isModuleEnabled returned non-bool")
	}
	return enabled, nil
}

func readinessSessionPolicyAt(ctx context.Context, client *ethclient.Client, module, safe, sessionKey common.Address) (readinessSessionPolicy, error) {
	payload, err := strategyPolicyReadinessABI.Pack("sessionPolicies", safe, sessionKey)
	if err != nil {
		return readinessSessionPolicy{}, fmt.Errorf("pack sessionPolicies: %w", err)
	}
	output, err := client.CallContract(ctx, ethereum.CallMsg{To: &module, Data: payload}, nil)
	if err != nil {
		return readinessSessionPolicy{}, fmt.Errorf("call sessionPolicies: %w", err)
	}
	values, err := strategyPolicyReadinessABI.Unpack("sessionPolicies", output)
	if err != nil {
		return readinessSessionPolicy{}, fmt.Errorf("unpack sessionPolicies: %w", err)
	}
	if len(values) < 4 {
		return readinessSessionPolicy{}, errors.New("sessionPolicies returned short output")
	}
	validAfter, err := uint64FromReadinessABIValue(values[2])
	if err != nil {
		return readinessSessionPolicy{}, fmt.Errorf("decode validAfter: %w", err)
	}
	validUntil, err := uint64FromReadinessABIValue(values[3])
	if err != nil {
		return readinessSessionPolicy{}, fmt.Errorf("decode validUntil: %w", err)
	}
	active, _ := values[0].(bool)
	paused, _ := values[1].(bool)
	return readinessSessionPolicy{
		Active:     active,
		Paused:     paused,
		ValidAfter: validAfter,
		ValidUntil: validUntil,
	}, nil
}

func uint64FromReadinessABIValue(value any) (uint64, error) {
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
