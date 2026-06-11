package relayer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/HershyOrg/hershy/cctx/base"
)

func TestBundlePolicyStoreLookupPolicy(t *testing.T) {
	root := t.TempDir()
	bundlePath := filepath.Join(root, "56", "0xowner", "policy-1.json")
	if err := os.MkdirAll(filepath.Dir(bundlePath), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	bundle := map[string]any{
		"chain_id":                       56,
		"policy_id":                      "policy-1",
		"smart_wallet_address":           "0x00000000000000000000000000000000000000cC",
		"session_key_address":            "0x00000000000000000000000000000000000000dD",
		"strategy_policy_module_address": "0x00000000000000000000000000000000000000eE",
		"relayer_policy": map[string]any{
			"allowed_contract_addresses": []string{"0x00000000000000000000000000000000000000aa"},
			"allowed_function_selectors": []string{"0xa9059cbb"},
			"max_value_wei":              "0",
			"max_gas_limit":              1000000,
		},
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		t.Fatalf("marshal bundle: %v", err)
	}
	if err := os.WriteFile(bundlePath, raw, 0o600); err != nil {
		t.Fatalf("write bundle: %v", err)
	}

	policy, err := BundlePolicyStore{RootDir: root}.LookupPolicy(base.SCWRelayRequest{
		SmartWalletAddress: "0x00000000000000000000000000000000000000cc",
		SessionKeyAddress:  "0x00000000000000000000000000000000000000dd",
		PolicyID:           "policy-1",
	})
	if err != nil {
		t.Fatalf("LookupPolicy error: %v", err)
	}
	if policy.StrategyPolicyModule != "0x00000000000000000000000000000000000000eE" {
		t.Fatalf("module address not inherited: %#v", policy)
	}
	if len(policy.AllowedChainIDs) != 1 || policy.AllowedChainIDs[0] != 56 {
		t.Fatalf("chain id not inherited: %#v", policy.AllowedChainIDs)
	}
	if policy.MaxGasLimit != 1000000 {
		t.Fatalf("unexpected max gas: %d", policy.MaxGasLimit)
	}
}

func TestBundlePolicyStoreRejectsMissingPolicy(t *testing.T) {
	_, err := BundlePolicyStore{RootDir: t.TempDir()}.LookupPolicy(base.SCWRelayRequest{
		SmartWalletAddress: "0x00000000000000000000000000000000000000cc",
		SessionKeyAddress:  "0x00000000000000000000000000000000000000dd",
		PolicyID:           "policy-1",
	})
	if err == nil {
		t.Fatalf("expected no matching policy error")
	}
}
