package relayer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/HershyOrg/hershy/cctx/base"
)

const executionLogFileMode = 0o600

type ExecutionRecord struct {
	RecordedAt             time.Time         `json:"recorded_at"`
	Status                 string            `json:"status"`
	TxHash                 string            `json:"tx_hash,omitempty"`
	Error                  string            `json:"error,omitempty"`
	ChainID                int64             `json:"chain_id"`
	SmartWalletAddress     string            `json:"smart_wallet_address"`
	SessionKeyAddress      string            `json:"session_key_address"`
	PolicyID               string            `json:"policy_id,omitempty"`
	StrategyID             string            `json:"strategy_id,omitempty"`
	ContractAddress        string            `json:"contract_address"`
	FunctionSelector       string            `json:"function_selector,omitempty"`
	Value                  string            `json:"value,omitempty"`
	GasLimit               uint64            `json:"gas_limit,omitempty"`
	Nonce                  string            `json:"nonce,omitempty"`
	DeadlineUnix           int64             `json:"deadline_unix"`
	StrategyPolicyModule   string            `json:"strategy_policy_module_address,omitempty"`
	AllowedContractAddress []string          `json:"allowed_contract_addresses,omitempty"`
	AllowedSelectors       []string          `json:"allowed_function_selectors,omitempty"`
	Metadata               map[string]string `json:"metadata,omitempty"`
}

type FileExecutionRecorder struct {
	RootDir string
}

func NewExecutionRecord(recordedAt time.Time, request base.SCWRelayRequest, policy SCWExecutionPolicy, txHash, status string, recordErr error) ExecutionRecord {
	errorMessage := ""
	if recordErr != nil {
		errorMessage = recordErr.Error()
	}
	return ExecutionRecord{
		RecordedAt:             recordedAt,
		Status:                 strings.TrimSpace(status),
		TxHash:                 strings.TrimSpace(txHash),
		Error:                  errorMessage,
		ChainID:                request.ChainID,
		SmartWalletAddress:     normalizeAddressForRecord(request.SmartWalletAddress),
		SessionKeyAddress:      normalizeAddressForRecord(request.SessionKeyAddress),
		PolicyID:               strings.TrimSpace(request.PolicyID),
		StrategyID:             strings.TrimSpace(request.StrategyID),
		ContractAddress:        normalizeAddressForRecord(request.ContractAddress),
		FunctionSelector:       selectorForRecord(request.Calldata),
		Value:                  strings.TrimSpace(request.Value),
		GasLimit:               request.GasLimit,
		Nonce:                  strings.TrimSpace(request.Nonce),
		DeadlineUnix:           request.DeadlineUnix,
		StrategyPolicyModule:   strings.TrimSpace(policy.StrategyPolicyModule),
		AllowedContractAddress: append([]string(nil), policy.AllowedContractAddresses...),
		AllowedSelectors:       append([]string(nil), policy.AllowedFunctionSelectors...),
	}
}

func (r FileExecutionRecorder) RecordExecution(_ context.Context, record ExecutionRecord) error {
	root := strings.TrimSpace(r.RootDir)
	if root == "" {
		return fmt.Errorf("execution log root required")
	}
	path := executionLogPath(root, record)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create execution log dir: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, executionLogFileMode)
	if err != nil {
		return fmt.Errorf("open execution log: %w", err)
	}
	defer file.Close()

	encoded, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal execution record: %w", err)
	}
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		return fmt.Errorf("write execution record: %w", err)
	}
	return nil
}

func executionLogPath(root string, record ExecutionRecord) string {
	chainID := fmt.Sprintf("%d", record.ChainID)
	smartWallet := sanitizePathSegment(record.SmartWalletAddress)
	policyID := sanitizePathSegment(record.PolicyID)
	if policyID == "" {
		policyID = "default"
	}
	return filepath.Join(root, chainID, smartWallet, policyID+".jsonl")
}

func normalizeAddressForRecord(raw string) string {
	if common.IsHexAddress(strings.TrimSpace(raw)) {
		return common.HexToAddress(strings.TrimSpace(raw)).Hex()
	}
	return strings.TrimSpace(raw)
}

func selectorForRecord(rawCalldata string) string {
	calldata, err := base.NormalizeSCWRelayCalldata(rawCalldata)
	if err != nil || len(calldata) < 4 {
		return ""
	}
	return "0x" + common.Bytes2Hex(calldata[:4])
}

func sanitizePathSegment(value string) string {
	text := strings.TrimSpace(value)
	var out strings.Builder
	for _, char := range text {
		switch {
		case char >= 'a' && char <= 'z':
			out.WriteRune(char)
		case char >= 'A' && char <= 'Z':
			out.WriteRune(char)
		case char >= '0' && char <= '9':
			out.WriteRune(char)
		case char == '-', char == '_', char == '.':
			out.WriteRune(char)
		default:
			out.WriteByte('_')
		}
	}
	return strings.Trim(out.String(), "._-")
}
