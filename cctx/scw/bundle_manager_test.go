package scw

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestBundleManagerCreateShowAndUpdateFlow(t *testing.T) {
	manager := NewBundleManager()
	identity := BundleIdentityOptions{
		StoreRoot:    t.TempDir(),
		OwnerAddress: "0x00000000000000000000000000000000000000a1",
		ChainID:      8453,
		PolicyID:     "policy-1",
	}

	created, err := manager.CreateBundle(BundleCreateOptions{
		BundleIdentityOptions:      identity,
		SafeSingletonAddress:       "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:    "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress: "0x00000000000000000000000000000000000000d1",
		SessionPrivateKey:          "0x2222222222222222222222222222222222222222222222222222222222222222",
		SaltNonce:                  "12345",
		AllowedContractAddresses:   []string{"0x00000000000000000000000000000000000000aa"},
		AllowedFunctionSelectors:   []string{"0xa9059cbb"},
		MaxValueWei:                "5",
		MaxGasLimit:                21000,
		DeadlineGraceSeconds:       30,
	})
	if err != nil {
		t.Fatalf("CreateBundle error: %v", err)
	}
	if created.Mode != "create" {
		t.Fatalf("unexpected mode: %s", created.Mode)
	}
	if !strings.HasSuffix(created.BundlePath, filepath.Join("8453", "0x00000000000000000000000000000000000000A1", "policy-1.json")) {
		t.Fatalf("unexpected bundle path: %s", created.BundlePath)
	}
	if created.SessionKeyAddress == "" {
		t.Fatalf("expected session key address")
	}

	shown, err := manager.ShowBundle(identity)
	if err != nil {
		t.Fatalf("ShowBundle error: %v", err)
	}
	if shown.SessionKeyAddress != created.SessionKeyAddress {
		t.Fatalf("show should load created bundle: got=%s want=%s", shown.SessionKeyAddress, created.SessionKeyAddress)
	}

	addressed, err := manager.UpdateSmartWalletAddress(BundleSmartWalletUpdateOptions{
		BundleIdentityOptions: identity,
		SmartWalletAddress:    "0x0000000000000000000000000000000000000012",
	})
	if err != nil {
		t.Fatalf("UpdateSmartWalletAddress error: %v", err)
	}
	if addressed.SmartWalletAddress != "0x0000000000000000000000000000000000000012" {
		t.Fatalf("unexpected smart wallet address: %s", addressed.SmartWalletAddress)
	}

	updated, err := manager.UpdateStrategyPolicyModule(BundleStrategyPolicyModuleUpdateOptions{
		BundleIdentityOptions:    identity,
		StrategyPolicyModule:     "0x00000000000000000000000000000000000000ee",
		AllowedContractAddresses: []string{"0x00000000000000000000000000000000000000bb"},
		AllowedFunctionSelectors: []string{"0x095ea7b3"},
		MaxValueWei:              "7",
		MaxGasLimit:              50000,
	})
	if err != nil {
		t.Fatalf("UpdateStrategyPolicyModule error: %v", err)
	}
	if updated.EnableModuleAction == nil || updated.GrantSessionKeyAction == nil {
		t.Fatalf("expected Safe module setup actions: %#v", updated)
	}
	if updated.RelayerPolicy.MaxValueWei != "7" || updated.RelayerPolicy.MaxGasLimit != 50000 {
		t.Fatalf("policy overrides not applied: %#v", updated.RelayerPolicy)
	}
}

func TestBundleManagerCreateWithExplicitBundlePath(t *testing.T) {
	manager := NewBundleManager()
	path := filepath.Join(t.TempDir(), "bundle.json")

	created, err := manager.CreateBundle(BundleCreateOptions{
		BundleIdentityOptions: BundleIdentityOptions{
			BundlePath:   path,
			OwnerAddress: "0x00000000000000000000000000000000000000a1",
			ChainID:      8453,
			PolicyID:     "policy-1",
		},
		SafeSingletonAddress:       "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:    "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress: "0x00000000000000000000000000000000000000d1",
		SessionPrivateKey:          "0x2222222222222222222222222222222222222222222222222222222222222222",
		SaltNonce:                  "12345",
		MaxValueWei:                "0",
	})
	if err != nil {
		t.Fatalf("CreateBundle explicit path error: %v", err)
	}
	if created.BundlePath != path {
		t.Fatalf("unexpected explicit bundle path: got=%s want=%s", created.BundlePath, path)
	}

	loaded, err := manager.ShowBundle(BundleIdentityOptions{BundlePath: path})
	if err != nil {
		t.Fatalf("ShowBundle explicit path error: %v", err)
	}
	if loaded.OwnerAddress != created.OwnerAddress {
		t.Fatalf("unexpected loaded owner: got=%s want=%s", loaded.OwnerAddress, created.OwnerAddress)
	}
}
