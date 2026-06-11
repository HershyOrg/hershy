package relayer

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

func TestFileExecutionRecorderWritesJSONL(t *testing.T) {
	root := t.TempDir()
	request, policy := signedRelayFixture(t)
	record := NewExecutionRecord(time.Unix(1_700_000_000, 0), request, policy, "0xabc", "submitted", nil)

	if err := (FileExecutionRecorder{RootDir: root}).RecordExecution(t.Context(), record); err != nil {
		t.Fatalf("RecordExecution error: %v", err)
	}

	path := filepath.Join(root, "8453", "0x00000000000000000000000000000000000000CC", "policy-1.jsonl")
	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open execution log: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		t.Fatalf("expected execution log line")
	}
	var decoded ExecutionRecord
	if err := json.Unmarshal(scanner.Bytes(), &decoded); err != nil {
		t.Fatalf("decode execution log: %v", err)
	}
	if decoded.TxHash != "0xabc" || decoded.Status != "submitted" {
		t.Fatalf("unexpected execution log: %#v", decoded)
	}
	if decoded.FunctionSelector != "0xa9059cbb" {
		t.Fatalf("unexpected selector: %s", decoded.FunctionSelector)
	}
}

func TestNewExecutionRecordDoesNotPersistSignature(t *testing.T) {
	request := base.SCWRelayRequest{
		ChainID:            56,
		SmartWalletAddress: "0x00000000000000000000000000000000000000cc",
		SessionKeyAddress:  "0x00000000000000000000000000000000000000dd",
		PolicyID:           "policy-1",
		ContractAddress:    "0x00000000000000000000000000000000000000aa",
		Calldata:           "0x095ea7b3",
		Signature:          "0xsecret",
	}
	record := NewExecutionRecord(time.Unix(1_700_000_000, 0), request, SCWExecutionPolicy{}, "", "failed", nil)
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatalf("marshal record: %v", err)
	}
	if strings.Contains(string(raw), request.Signature) {
		t.Fatalf("execution record should not contain relay signature: %s", string(raw))
	}
}
