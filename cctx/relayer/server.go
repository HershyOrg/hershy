package relayer

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
)

type PolicyStore interface {
	LookupPolicy(request base.SCWRelayRequest) (SCWExecutionPolicy, error)
}

type ModuleSubmitter interface {
	SubmitModuleExecute(ctx context.Context, request base.SCWRelayRequest) (string, error)
}

type PolicyAwareModuleSubmitter interface {
	SubmitModuleExecuteWithPolicy(ctx context.Context, request base.SCWRelayRequest, policy SCWExecutionPolicy) (string, error)
}

type ReadinessChecker interface {
	CheckReady(ctx context.Context, request base.SCWRelayRequest, policy SCWExecutionPolicy) error
}

type ExecutionRecorder interface {
	RecordExecution(ctx context.Context, record ExecutionRecord) error
}

type StaticPolicyStore struct {
	Policies []SCWExecutionPolicy
}

func (s StaticPolicyStore) LookupPolicy(request base.SCWRelayRequest) (SCWExecutionPolicy, error) {
	for index := range s.Policies {
		candidate := s.Policies[index]
		if strings.TrimSpace(candidate.SmartWalletAddress) != "" && !strings.EqualFold(candidate.SmartWalletAddress, request.SmartWalletAddress) {
			continue
		}
		if strings.TrimSpace(candidate.PolicyID) != "" && strings.TrimSpace(candidate.PolicyID) != strings.TrimSpace(request.PolicyID) {
			continue
		}
		if strings.TrimSpace(candidate.SessionKeyAddress) != "" && !strings.EqualFold(candidate.SessionKeyAddress, request.SessionKeyAddress) {
			continue
		}
		return candidate, nil
	}
	return SCWExecutionPolicy{}, errors.New("no matching policy for relay request")
}

type Server struct {
	PolicyStore      PolicyStore
	Submitter        ModuleSubmitter
	ReadinessChecker ReadinessChecker
	Recorder         ExecutionRecorder
	Now              func() time.Time
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.PolicyStore == nil || s.Submitter == nil {
		http.Error(w, "server not configured", http.StatusInternalServerError)
		return
	}

	var request base.SCWRelayRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	policy, err := s.PolicyStore.LookupPolicy(request)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	if _, err := ValidateSCWRelayRequest(request, policy, now); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if s.ReadinessChecker != nil {
		if err := s.ReadinessChecker.CheckReady(r.Context(), request, policy); err != nil {
			s.recordExecution(r.Context(), request, policy, "", "rejected", err)
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
	}

	txHash, err := s.submitModuleExecute(r.Context(), request, policy)
	if err != nil {
		s.recordExecution(r.Context(), request, policy, "", "failed", err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.recordExecution(r.Context(), request, policy, txHash, "submitted", nil)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(base.SCWRelayResponse{
		TxHash:  txHash,
		Status:  "submitted",
		Message: "relay request accepted",
	})
}

func (s *Server) submitModuleExecute(ctx context.Context, request base.SCWRelayRequest, policy SCWExecutionPolicy) (string, error) {
	if policyAware, ok := s.Submitter.(PolicyAwareModuleSubmitter); ok {
		return policyAware.SubmitModuleExecuteWithPolicy(ctx, request, policy)
	}
	return s.Submitter.SubmitModuleExecute(ctx, request)
}

func (s *Server) recordExecution(ctx context.Context, request base.SCWRelayRequest, policy SCWExecutionPolicy, txHash, status string, err error) {
	if s.Recorder == nil {
		return
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	record := NewExecutionRecord(now, request, policy, txHash, status, err)
	_ = s.Recorder.RecordExecution(ctx, record)
}
