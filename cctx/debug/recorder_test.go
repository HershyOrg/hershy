package debug

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRecorderWritesJSONLEvent(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "events.jsonl")

	recorder, err := OpenJSONLRecorder(path, "test-strategy", WithDefaultVenue("paper"))
	if err != nil {
		t.Fatalf("OpenJSONLRecorder() error = %v", err)
	}
	defer func() {
		_ = recorder.Close()
	}()

	runID := RunID("run-1")
	tradeID := TradeID("trade-1")
	decisionID := DecisionID("decision-1")
	if err := recorder.Emit(EventSignalEval, EmitParams{
		RunID:      runID,
		TradeID:    &tradeID,
		DecisionID: &decisionID,
		TsMs:       12345,
		MarketID:   "market-1",
		Decision:   "signal_ready",
		Inputs: map[string]any{
			"price": 1.23,
		},
	}); err != nil {
		t.Fatalf("Emit() error = %v", err)
	}

	if err := recorder.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	text := string(data)
	if !strings.Contains(text, `"run_id":"run-1"`) {
		t.Fatalf("expected run id in output, got %s", text)
	}
	if !strings.Contains(text, `"event":"signal_eval"`) {
		t.Fatalf("expected event type in output, got %s", text)
	}
	if !strings.Contains(text, `"venue":"paper"`) {
		t.Fatalf("expected default venue in output, got %s", text)
	}
}
