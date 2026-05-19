package relayer

import (
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/HershyOrg/hershy/cctx/base"
)

func TestValidateSCWRelayRequestSuccess(t *testing.T) {
	request, policy := signedRelayFixture(t)

	validated, err := ValidateSCWRelayRequest(request, policy, time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatalf("ValidateSCWRelayRequest error: %v", err)
	}

	if validated.FunctionSelector != "0xa9059cbb" {
		t.Fatalf("unexpected selector: %s", validated.FunctionSelector)
	}
	if validated.RecoveredSigner != request.SessionKeyAddress {
		t.Fatalf("unexpected signer: got=%s want=%s", validated.RecoveredSigner, request.SessionKeyAddress)
	}
	if validated.ValueWei.String() != "5" {
		t.Fatalf("unexpected value: %s", validated.ValueWei.String())
	}
}

func TestValidateSCWRelayRequestRejectsInvalidSignature(t *testing.T) {
	request, policy := signedRelayFixture(t)
	request.Signature = strings.Replace(request.Signature, "2", "3", 1)

	_, err := ValidateSCWRelayRequest(request, policy, time.Unix(1_700_000_000, 0))
	if err == nil {
		t.Fatalf("expected signature error")
	}
	if _, ok := err.(SignatureValidationError); !ok {
		t.Fatalf("expected SignatureValidationError, got %T", err)
	}
}

func TestValidateSCWRelayRequestRejectsExpiredDeadline(t *testing.T) {
	request, policy := signedRelayFixture(t)

	_, err := ValidateSCWRelayRequest(request, policy, time.Unix(request.DeadlineUnix+1, 0))
	if err == nil {
		t.Fatalf("expected deadline error")
	}
	if _, ok := err.(PolicyValidationError); !ok {
		t.Fatalf("expected PolicyValidationError, got %T", err)
	}
}

func TestValidateSCWRelayRequestRejectsDisallowedContract(t *testing.T) {
	request, policy := signedRelayFixture(t)
	policy.AllowedContractAddresses = []string{"0x00000000000000000000000000000000000000bb"}

	_, err := ValidateSCWRelayRequest(request, policy, time.Unix(1_700_000_000, 0))
	if err == nil {
		t.Fatalf("expected contract policy error")
	}
	if _, ok := err.(PolicyValidationError); !ok {
		t.Fatalf("expected PolicyValidationError, got %T", err)
	}
}

func TestValidateSCWRelayRequestRejectsDisallowedSelector(t *testing.T) {
	request, policy := signedRelayFixture(t)
	policy.AllowedFunctionSelectors = []string{"0x095ea7b3"}

	_, err := ValidateSCWRelayRequest(request, policy, time.Unix(1_700_000_000, 0))
	if err == nil {
		t.Fatalf("expected selector policy error")
	}
	if _, ok := err.(PolicyValidationError); !ok {
		t.Fatalf("expected PolicyValidationError, got %T", err)
	}
}

func TestValidateSCWRelayRequestRejectsExcessValue(t *testing.T) {
	request, policy := signedRelayFixture(t)
	policy.MaxValueWei = "4"

	_, err := ValidateSCWRelayRequest(request, policy, time.Unix(1_700_000_000, 0))
	if err == nil {
		t.Fatalf("expected max value policy error")
	}
	if _, ok := err.(PolicyValidationError); !ok {
		t.Fatalf("expected PolicyValidationError, got %T", err)
	}
}

func TestValidateSCWRelayRequestRejectsExcessGas(t *testing.T) {
	request, policy := signedRelayFixture(t)
	policy.MaxGasLimit = 20_000

	_, err := ValidateSCWRelayRequest(request, policy, time.Unix(1_700_000_000, 0))
	if err == nil {
		t.Fatalf("expected gas policy error")
	}
	if _, ok := err.(PolicyValidationError); !ok {
		t.Fatalf("expected PolicyValidationError, got %T", err)
	}
}

func signedRelayFixture(t *testing.T) (base.SCWRelayRequest, SCWExecutionPolicy) {
	t.Helper()

	sessionSigner, err := crypto.HexToECDSA("2222222222222222222222222222222222222222222222222222222222222222")
	if err != nil {
		t.Fatalf("session signer parse error: %v", err)
	}
	sessionAddress := crypto.PubkeyToAddress(sessionSigner.PublicKey).Hex()
	request := base.SCWRelayRequest{
		Chain:                "base-mainnet",
		ChainID:              8453,
		SmartWalletAddress:   "0x00000000000000000000000000000000000000CC",
		SessionKeyAddress:    sessionAddress,
		SessionKeyID:         "session-1",
		PolicyID:             "policy-1",
		StrategyID:           "strategy-42",
		ContractAddress:      "0x00000000000000000000000000000000000000AA",
		Calldata:             "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001",
		Value:                "5wei",
		GasLimit:             21_000,
		MaxFeePerGas:         "2",
		MaxPriorityFeePerGas: "1",
		FunctionName:         "transfer",
		DeadlineUnix:         1_700_000_000,
	}
	request.Signature, err = base.SignSCWRelayRequest(request, sessionSigner)
	if err != nil {
		t.Fatalf("sign relay payload: %v", err)
	}

	policy := SCWExecutionPolicy{
		SmartWalletAddress:       "0x00000000000000000000000000000000000000cc",
		SessionKeyAddress:        sessionAddress,
		PolicyID:                 "policy-1",
		AllowedChainIDs:          []int64{8453},
		AllowedContractAddresses: []string{"0x00000000000000000000000000000000000000aa"},
		AllowedFunctionSelectors: []string{"0xa9059cbb"},
		MaxValueWei:              "5",
		MaxGasLimit:              21_000,
	}
	return request, policy
}
