package base

import (
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	ethmath "github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"
)

const (
	SCWRelayEIP712DomainName    = "HershyStrategyPolicy"
	SCWRelayEIP712DomainVersion = "1"
	SCWRelayPrimaryType         = "SCWExecution"
)

// SCWRelayTypedData returns the EIP-712 typed data that session keys sign and
// relayers/modules verify. The authorization domain is bound to the smart
// wallet address so each wallet gets its own signing scope.
func SCWRelayTypedData(request SCWRelayRequest) (apitypes.TypedData, error) {
	if request.ChainID <= 0 {
		return apitypes.TypedData{}, fmt.Errorf("relay chain id required")
	}
	smartWalletAddress := strings.TrimSpace(request.SmartWalletAddress)
	if !common.IsHexAddress(smartWalletAddress) {
		return apitypes.TypedData{}, fmt.Errorf("invalid smart wallet address")
	}
	contractAddress := strings.TrimSpace(request.ContractAddress)
	if !common.IsHexAddress(contractAddress) {
		return apitypes.TypedData{}, fmt.Errorf("invalid contract address")
	}
	valueWei, err := ParseSCWRelayWeiValue(request.Value)
	if err != nil {
		return apitypes.TypedData{}, err
	}
	calldata, err := NormalizeSCWRelayCalldata(request.Calldata)
	if err != nil {
		return apitypes.TypedData{}, fmt.Errorf("invalid calldata: %w", err)
	}
	typedData := apitypes.TypedData{
		Types: apitypes.Types{
			"EIP712Domain": {
				{Name: "name", Type: "string"},
				{Name: "version", Type: "string"},
				{Name: "chainId", Type: "uint256"},
				{Name: "verifyingContract", Type: "address"},
			},
			SCWRelayPrimaryType: {
				{Name: "contractAddress", Type: "address"},
				{Name: "calldata", Type: "bytes"},
				{Name: "valueWei", Type: "uint256"},
				{Name: "gasLimit", Type: "uint256"},
				{Name: "nonceHash", Type: "bytes32"},
				{Name: "policyIdHash", Type: "bytes32"},
				{Name: "deadlineUnix", Type: "uint256"},
			},
		},
		PrimaryType: SCWRelayPrimaryType,
		Domain: apitypes.TypedDataDomain{
			Name:              SCWRelayEIP712DomainName,
			Version:           SCWRelayEIP712DomainVersion,
			ChainId:           ethmath.NewHexOrDecimal256(request.ChainID),
			VerifyingContract: common.HexToAddress(smartWalletAddress).Hex(),
		},
		Message: apitypes.TypedDataMessage{
			"contractAddress": common.HexToAddress(contractAddress).Hex(),
			"calldata":        "0x" + hex.EncodeToString(calldata),
			"valueWei":        valueWei.String(),
			"gasLimit":        fmt.Sprintf("%d", request.GasLimit),
			"nonceHash":       RelayStringHash(request.Nonce).Hex(),
			"policyIdHash":    RelayStringHash(request.PolicyID).Hex(),
			"deadlineUnix":    fmt.Sprintf("%d", request.DeadlineUnix),
		},
	}
	return typedData, nil
}

// SCWRelayTypedDataHash returns the EIP-712 digest that session keys sign.
func SCWRelayTypedDataHash(request SCWRelayRequest) ([]byte, error) {
	typedData, err := SCWRelayTypedData(request)
	if err != nil {
		return nil, err
	}
	digest, _, err := apitypes.TypedDataAndHash(typedData)
	if err != nil {
		return nil, err
	}
	return digest, nil
}

// SignSCWRelayRequest signs the relay request using the shared EIP-712 digest.
// The returned signature is encoded as 0x-prefixed hex and uses v in {27,28}
// so it can be consumed directly by on-chain ECDSA recovery.
func SignSCWRelayRequest(request SCWRelayRequest, signer *ecdsa.PrivateKey) (string, error) {
	if signer == nil {
		return "", fmt.Errorf("session signer required")
	}
	digest, err := SCWRelayTypedDataHash(request)
	if err != nil {
		return "", err
	}
	signature, err := crypto.Sign(digest, signer)
	if err != nil {
		return "", err
	}
	signature[64] += 27
	return "0x" + hex.EncodeToString(signature), nil
}

// RelayStringHash normalizes the string and hashes it for EIP-712 bytes32
// fields and on-chain policy comparisons.
func RelayStringHash(value string) common.Hash {
	return crypto.Keccak256Hash([]byte(strings.TrimSpace(value)))
}

func ParseSCWRelayWeiValue(raw string) (*big.Int, error) {
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

func NormalizeSCWRelayCalldata(raw string) ([]byte, error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	if text == "" {
		return []byte{}, nil
	}
	if len(text)%2 != 0 {
		return nil, fmt.Errorf("hex byte string must have even length")
	}
	decoded, err := hex.DecodeString(text)
	if err != nil {
		return nil, err
	}
	return decoded, nil
}
