package relayer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

type fakeSubmitter struct {
	txHash      string
	err         error
	seenRequest base.SCWRelayRequest
}

func (f *fakeSubmitter) SubmitModuleExecute(_ context.Context, request base.SCWRelayRequest) (string, error) {
	f.seenRequest = request
	return f.txHash, f.err
}

type fakeReadinessChecker struct {
	err error
}

func (f fakeReadinessChecker) CheckReady(_ context.Context, _ base.SCWRelayRequest, _ SCWExecutionPolicy) error {
	return f.err
}

type fakeExecutionRecorder struct {
	records []ExecutionRecord
}

func (f *fakeExecutionRecorder) RecordExecution(_ context.Context, record ExecutionRecord) error {
	f.records = append(f.records, record)
	return nil
}

func TestServerAcceptsValidRequest(t *testing.T) {
	request, policy := signedRelayFixture(t)
	submitter := &fakeSubmitter{txHash: "0xabc123"}
	executionRecorder := &fakeExecutionRecorder{}
	server := &Server{
		PolicyStore: StaticPolicyStore{Policies: []SCWExecutionPolicy{policy}},
		Submitter:   submitter,
		Recorder:    executionRecorder,
		Now: func() time.Time {
			return time.Unix(1_700_000_000, 0)
		},
	}

	body, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/relay/execute", bytes.NewReader(body))
	server.ServeHTTP(recorder, httpRequest)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d body=%s", recorder.Code, recorder.Body.String())
	}
	if submitter.seenRequest.SessionKeyAddress != request.SessionKeyAddress {
		t.Fatalf("submitter did not receive validated request")
	}
	var response base.SCWRelayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.TxHash != "0xabc123" {
		t.Fatalf("unexpected tx hash: %s", response.TxHash)
	}
	if len(executionRecorder.records) != 1 || executionRecorder.records[0].Status != "submitted" {
		t.Fatalf("expected submitted execution record: %#v", executionRecorder.records)
	}
}

func TestServerRejectsInvalidSignature(t *testing.T) {
	request, policy := signedRelayFixture(t)
	request.Signature = "0xdeadbeef"
	server := &Server{
		PolicyStore: StaticPolicyStore{Policies: []SCWExecutionPolicy{policy}},
		Submitter:   &fakeSubmitter{txHash: "0xabc123"},
		Now: func() time.Time {
			return time.Unix(1_700_000_000, 0)
		},
	}

	body, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/relay/execute", bytes.NewReader(body))
	server.ServeHTTP(recorder, httpRequest)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("unexpected status code: %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestServerRejectsNotReadyPolicy(t *testing.T) {
	request, policy := signedRelayFixture(t)
	recorder := &fakeExecutionRecorder{}
	server := &Server{
		PolicyStore:      StaticPolicyStore{Policies: []SCWExecutionPolicy{policy}},
		Submitter:        &fakeSubmitter{txHash: "0xabc123"},
		ReadinessChecker: fakeReadinessChecker{err: errors.New("not ready")},
		Recorder:         recorder,
		Now: func() time.Time {
			return time.Unix(1_700_000_000, 0)
		},
	}

	body, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	rec := httptest.NewRecorder()
	httpRequest := httptest.NewRequest(http.MethodPost, "/relay/execute", bytes.NewReader(body))
	server.ServeHTTP(rec, httpRequest)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("unexpected status code: %d body=%s", rec.Code, rec.Body.String())
	}
	if len(recorder.records) != 1 || recorder.records[0].Status != "rejected" {
		t.Fatalf("expected rejected execution record: %#v", recorder.records)
	}
}
