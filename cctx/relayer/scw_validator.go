package relayer

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/HershyOrg/hershy/cctx/base"
)

// SignatureValidationError indicates that a relay request could not be
// authenticated by the delegated session key.
type SignatureValidationError struct {
	Message string
}

func (e SignatureValidationError) Error() string {
	return e.Message
}

// PolicyValidationError indicates that a relay request violates the SCW
// execution policy attached to a delegated session key.
type PolicyValidationError struct {
	Message string
}

func (e PolicyValidationError) Error() string {
	return e.Message
}

// SCWExecutionPolicy describes relayer-side constraints that must be satisfied
// before a session-key relay request is forwarded to an on-chain smart wallet.
type SCWExecutionPolicy struct {
	SmartWalletAddress       string        `json:"smart_wallet_address,omitempty"`
	SessionKeyAddress        string        `json:"session_key_address,omitempty"`
	PolicyID                 string        `json:"policy_id,omitempty"`
	AllowedChainIDs          []int64       `json:"allowed_chain_ids,omitempty"`
	AllowedContractAddresses []string      `json:"allowed_contract_addresses,omitempty"`
	AllowedFunctionSelectors []string      `json:"allowed_function_selectors,omitempty"`
	MaxValueWei              string        `json:"max_value_wei,omitempty"`
	MaxGasLimit              uint64        `json:"max_gas_limit,omitempty"`
	DeadlineGracePeriod      time.Duration `json:"deadline_grace_period,omitempty"`
}

// SCWValidatedRequest captures the normalized data extracted from a verified
// relay request.
type SCWValidatedRequest struct {
	Request          base.SCWRelayRequest
	RecoveredSigner  string
	FunctionSelector string
	ValueWei         *big.Int
}

// ValidateSCWRelayRequest verifies the session-key signature and enforces the
// supplied relayer policy.
func ValidateSCWRelayRequest(request base.SCWRelayRequest, policy SCWExecutionPolicy, now time.Time) (SCWValidatedRequest, error) {
	if strings.TrimSpace(request.Signature) == "" {
		return SCWValidatedRequest{}, SignatureValidationError{Message: "relay request signature required"}
	}
	if !common.IsHexAddress(strings.TrimSpace(request.SmartWalletAddress)) {
		return SCWValidatedRequest{}, PolicyValidationError{Message: "invalid smart wallet address"}
	}
	if !common.IsHexAddress(strings.TrimSpace(request.SessionKeyAddress)) {
		return SCWValidatedRequest{}, PolicyValidationError{Message: "invalid session key address"}
	}
	if !common.IsHexAddress(strings.TrimSpace(request.ContractAddress)) {
		return SCWValidatedRequest{}, PolicyValidationError{Message: "invalid contract address"}
	}
	if request.DeadlineUnix <= 0 {
		return SCWValidatedRequest{}, PolicyValidationError{Message: "relay request deadline required"}
	}
	valueWei, err := parseWeiValue(request.Value)
	if err != nil {
		return SCWValidatedRequest{}, PolicyValidationError{Message: err.Error()}
	}
	selector, err := extractFunctionSelector(request.Calldata)
	if err != nil {
		return SCWValidatedRequest{}, PolicyValidationError{Message: err.Error()}
	}
	recoveredSigner, err := recoverRelaySigner(request)
	if err != nil {
		return SCWValidatedRequest{}, err
	}
	if recoveredSigner != common.HexToAddress(strings.TrimSpace(request.SessionKeyAddress)).Hex() {
		return SCWValidatedRequest{}, SignatureValidationError{Message: fmt.Sprintf("session key signature mismatch: got %s want %s", recoveredSigner, common.HexToAddress(strings.TrimSpace(request.SessionKeyAddress)).Hex())}
	}
	if err := validatePolicy(request, policy, selector, valueWei, now); err != nil {
		return SCWValidatedRequest{}, err
	}
	return SCWValidatedRequest{
		Request:          request,
		RecoveredSigner:  recoveredSigner,
		FunctionSelector: selector,
		ValueWei:         valueWei,
	}, nil
}

func recoverRelaySigner(request base.SCWRelayRequest) (string, error) {
	digest, err := base.SCWRelayTypedDataHash(request)
	if err != nil {
		return "", SignatureValidationError{Message: fmt.Sprintf("build relay typed data hash: %v", err)}
	}
	signature, err := decodeSignature(request.Signature)
	if err != nil {
		return "", SignatureValidationError{Message: err.Error()}
	}
	pubKey, err := crypto.SigToPub(digest, signature)
	if err != nil {
		return "", SignatureValidationError{Message: fmt.Sprintf("recover relay signer: %v", err)}
	}
	return crypto.PubkeyToAddress(*pubKey).Hex(), nil
}

func validatePolicy(request base.SCWRelayRequest, policy SCWExecutionPolicy, selector string, valueWei *big.Int, now time.Time) error {
	deadline := time.Unix(request.DeadlineUnix, 0)
	if now.After(deadline.Add(policy.DeadlineGracePeriod)) {
		return PolicyValidationError{Message: "relay request deadline expired"}
	}

	normalizedSmartWallet := common.HexToAddress(strings.TrimSpace(request.SmartWalletAddress)).Hex()
	if strings.TrimSpace(policy.SmartWalletAddress) != "" && normalizedSmartWallet != common.HexToAddress(strings.TrimSpace(policy.SmartWalletAddress)).Hex() {
		return PolicyValidationError{Message: fmt.Sprintf("smart wallet %s not allowed by policy", normalizedSmartWallet)}
	}
	normalizedSessionKey := common.HexToAddress(strings.TrimSpace(request.SessionKeyAddress)).Hex()
	if strings.TrimSpace(policy.SessionKeyAddress) != "" && normalizedSessionKey != common.HexToAddress(strings.TrimSpace(policy.SessionKeyAddress)).Hex() {
		return PolicyValidationError{Message: fmt.Sprintf("session key %s not allowed by policy", normalizedSessionKey)}
	}
	if strings.TrimSpace(policy.PolicyID) != "" && strings.TrimSpace(request.PolicyID) != strings.TrimSpace(policy.PolicyID) {
		return PolicyValidationError{Message: fmt.Sprintf("policy id mismatch: got %s want %s", request.PolicyID, policy.PolicyID)}
	}
	if len(policy.AllowedChainIDs) > 0 && !slices.Contains(policy.AllowedChainIDs, request.ChainID) {
		return PolicyValidationError{Message: fmt.Sprintf("chain id %d not allowed by policy", request.ChainID)}
	}
	if len(policy.AllowedContractAddresses) > 0 {
		normalizedTarget := common.HexToAddress(strings.TrimSpace(request.ContractAddress)).Hex()
		allowed := false
		for _, candidate := range policy.AllowedContractAddresses {
			if strings.TrimSpace(candidate) == "" || !common.IsHexAddress(strings.TrimSpace(candidate)) {
				continue
			}
			if normalizedTarget == common.HexToAddress(strings.TrimSpace(candidate)).Hex() {
				allowed = true
				break
			}
		}
		if !allowed {
			return PolicyValidationError{Message: fmt.Sprintf("contract %s not allowed by policy", normalizedTarget)}
		}
	}
	if len(policy.AllowedFunctionSelectors) > 0 {
		allowed := false
		normalizedSelector := normalizeSelector(selector)
		for _, candidate := range policy.AllowedFunctionSelectors {
			if normalizedSelector == normalizeSelector(candidate) {
				allowed = true
				break
			}
		}
		if !allowed {
			return PolicyValidationError{Message: fmt.Sprintf("function selector %s not allowed by policy", selector)}
		}
	}
	if strings.TrimSpace(policy.MaxValueWei) != "" {
		maxValueWei, err := parseWeiValue(policy.MaxValueWei)
		if err != nil {
			return PolicyValidationError{Message: fmt.Sprintf("invalid policy max value: %v", err)}
		}
		if valueWei.Cmp(maxValueWei) > 0 {
			return PolicyValidationError{Message: fmt.Sprintf("value %s exceeds policy max %s", valueWei.String(), maxValueWei.String())}
		}
	}
	if policy.MaxGasLimit > 0 && request.GasLimit > policy.MaxGasLimit {
		return PolicyValidationError{Message: fmt.Sprintf("gas limit %d exceeds policy max %d", request.GasLimit, policy.MaxGasLimit)}
	}
	return nil
}

func decodeSignature(raw string) ([]byte, error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	signature, err := hex.DecodeString(text)
	if err != nil {
		return nil, fmt.Errorf("invalid relay signature: %w", err)
	}
	if len(signature) != crypto.SignatureLength {
		return nil, fmt.Errorf("invalid relay signature length: %d", len(signature))
	}
	switch signature[64] {
	case 27, 28:
		signature[64] -= 27
	case 0, 1:
	default:
		return nil, fmt.Errorf("invalid relay recovery id: %d", signature[64])
	}
	return signature, nil
}

func parseWeiValue(raw string) (*big.Int, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return big.NewInt(0), nil
	}
	text = strings.TrimSuffix(strings.TrimSuffix(text, "wei"), "WEI")
	if text == "" {
		return nil, fmt.Errorf("invalid wei value")
	}
	value := new(big.Int)
	if _, ok := value.SetString(text, 10); !ok {
		return nil, fmt.Errorf("invalid wei value: %s", raw)
	}
	if value.Sign() < 0 {
		return nil, fmt.Errorf("wei value cannot be negative")
	}
	return value, nil
}

func extractFunctionSelector(calldata string) (string, error) {
	text := strings.TrimSpace(calldata)
	text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	if text == "" {
		return "", nil
	}
	if len(text)%2 != 0 {
		return "", fmt.Errorf("invalid calldata length")
	}
	if _, err := hex.DecodeString(text); err != nil {
		return "", fmt.Errorf("invalid calldata: %w", err)
	}
	if len(text) < 8 {
		return "", fmt.Errorf("calldata shorter than 4-byte selector")
	}
	return "0x" + strings.ToLower(text[:8]), nil
}

func normalizeSelector(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	if len(text) > 8 {
		text = text[:8]
	}
	return "0x" + strings.ToLower(text)
}
