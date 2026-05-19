package relayer

import (
	"bytes"
	"context"
	"encoding/json"
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

func TestServerAcceptsValidRequest(t *testing.T) {
	request, policy := signedRelayFixture(t)
	submitter := &fakeSubmitter{txHash: "0xabc123"}
	server := &Server{
		PolicyStore: StaticPolicyStore{Policies: []SCWExecutionPolicy{policy}},
		Submitter:   submitter,
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
