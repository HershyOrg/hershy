package base

import "testing"

func TestCreateExchangeMapsEVMDEXChainSpecificRPCAndChainID(t *testing.T) {
	var seenConfig map[string]any
	factory := func(config map[string]any) (Exchange, error) {
		seenConfig = config
		return nil, nil
	}

	_, err := CreateExchange("evm_dex", factory, nil, map[string]string{
		"private_key":                "0x1111111111111111111111111111111111111111111111111111111111111111",
		"rpc_url_giwa_sepolia":       "https://sepolia-rpc.giwa.io",
		"chain_id_giwa_sepolia":      "91342",
		"rpc_url_custom_chain":       "https://custom.example",
		"chain_id_custom_chain":      "777",
		"session_deadline_seconds":   "600",
		"session_private_key_unused": "ignored",
	}, false, true)
	if err != nil {
		t.Fatalf("CreateExchange error: %v", err)
	}

	rpcURLs, ok := seenConfig["rpc_urls"].(map[string]any)
	if !ok {
		t.Fatalf("rpc_urls missing or wrong type: %#v", seenConfig["rpc_urls"])
	}
	if got := rpcURLs["giwa_sepolia"]; got != "https://sepolia-rpc.giwa.io" {
		t.Fatalf("unexpected giwa rpc url: %#v", got)
	}
	if got := rpcURLs["custom_chain"]; got != "https://custom.example" {
		t.Fatalf("unexpected custom rpc url: %#v", got)
	}

	chainIDs, ok := seenConfig["chain_ids"].(map[string]any)
	if !ok {
		t.Fatalf("chain_ids missing or wrong type: %#v", seenConfig["chain_ids"])
	}
	if got := chainIDs["giwa_sepolia"]; got != float64(91342) {
		t.Fatalf("unexpected giwa chain id: %#v", got)
	}
	if got := chainIDs["custom_chain"]; got != float64(777) {
		t.Fatalf("unexpected custom chain id: %#v", got)
	}
	if got := seenConfig["session_deadline_seconds"]; got != float64(600) {
		t.Fatalf("unexpected session deadline: %#v", got)
	}
}
