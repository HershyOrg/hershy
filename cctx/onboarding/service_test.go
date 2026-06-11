package onboarding

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestServicePrepareCreatesBundleAndModuleActions(t *testing.T) {
	service := testService(t)

	response, err := service.Prepare(t.Context(), PrepareRequest{
		OwnerAddress:       "0x00000000000000000000000000000000000000a1",
		SmartWalletAddress: "0x0000000000000000000000000000000000000012",
	})
	if err != nil {
		t.Fatalf("Prepare error: %v", err)
	}
	if response.Bundle.SmartWalletAddress != "0x0000000000000000000000000000000000000012" {
		t.Fatalf("unexpected smart wallet: %s", response.Bundle.SmartWalletAddress)
	}
	if response.Bundle.EnableModuleAction == nil || response.Bundle.GrantSessionKeyAction == nil {
		t.Fatalf("expected module setup actions: %#v", response.Bundle)
	}
	if response.PermissionSummary.Title == "" {
		t.Fatalf("expected permission summary")
	}
	if len(response.NextActions) != 2 {
		t.Fatalf("expected enable/grant actions, got %d", len(response.NextActions))
	}
	if response.Status.State != StateModuleActionsReady {
		t.Fatalf("unexpected status: %#v", response.Status)
	}
}

func TestServiceStatusReturnsNotCreatedForMissingBundle(t *testing.T) {
	service := testService(t)

	status, err := service.Status(t.Context(), StatusRequest{
		OwnerAddress: "0x00000000000000000000000000000000000000a1",
	})
	if err != nil {
		t.Fatalf("Status error: %v", err)
	}
	if status.State != StateNotCreated {
		t.Fatalf("unexpected state: %s", status.State)
	}
	if status.BundleExists {
		t.Fatalf("missing bundle should not exist")
	}
}

func TestServerPrepareAndStatus(t *testing.T) {
	server := NewServer(testService(t))

	body := bytes.NewBufferString(`{"owner_address":"0x00000000000000000000000000000000000000a1","smart_wallet_address":"0x0000000000000000000000000000000000000012"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/scw/onboarding/prepare", body)
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected prepare status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var prepare PrepareResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &prepare); err != nil {
		t.Fatalf("decode prepare: %v", err)
	}
	if len(prepare.NextActions) != 2 {
		t.Fatalf("expected setup actions: %#v", prepare.NextActions)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/scw/onboarding/status?owner_address=0x00000000000000000000000000000000000000a1&chain_id=8453&policy_id=policy-1", nil)
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status code=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var status StatusResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.State != StateModuleActionsReady {
		t.Fatalf("unexpected onboarding state: %#v", status)
	}
}

func TestServerConfirmUpdatesDeployAddress(t *testing.T) {
	server := NewServer(testService(t))

	body := bytes.NewBufferString(`{"owner_address":"0x00000000000000000000000000000000000000a1"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/scw/onboarding/prepare", body)
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected prepare status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	confirmBody := bytes.NewBufferString(`{"owner_address":"0x00000000000000000000000000000000000000a1","kind":"deploy","tx_hash":"0xabc","smart_wallet_address":"0x0000000000000000000000000000000000000012"}`)
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/scw/onboarding/confirm", confirmBody)
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected confirm status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response ConfirmResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode confirm: %v", err)
	}
	if !strings.Contains(response.Message, "deploy confirmation") {
		t.Fatalf("unexpected confirm message: %s", response.Message)
	}
	if response.Status.SmartWalletAddress != "0x0000000000000000000000000000000000000012" {
		t.Fatalf("deploy confirm did not update smart wallet: %#v", response.Status)
	}
}

func testService(t *testing.T) Service {
	t.Helper()
	service := NewService(ServerDefaults{
		StoreRoot:                  t.TempDir(),
		ChainID:                    8453,
		PolicyID:                   "policy-1",
		SafeSingletonAddress:       "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:    "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress: "0x00000000000000000000000000000000000000d1",
		StrategyPolicyModule:       "0x00000000000000000000000000000000000000ee",
		AllowedContractAddresses:   []string{"0x00000000000000000000000000000000000000aa"},
		AllowedFunctionSelectors:   []string{"0x095ea7b3"},
		MaxValueWei:                "0",
		MaxGasLimit:                1000000,
		DeadlineGraceSeconds:       30,
	})
	service.Now = func() time.Time {
		return time.Unix(1_700_000_000, 0)
	}
	return service
}
