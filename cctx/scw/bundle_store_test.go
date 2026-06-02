package scw

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBundleStoreSaveLoadAndUpdateSmartWalletAddress(t *testing.T) {
	bundle := testSafeProvisioningBundle(t, "")
	store := NewBundleStore(t.TempDir())

	path, err := store.Save(bundle)
	if err != nil {
		t.Fatalf("Save error: %v", err)
	}
	if !strings.HasSuffix(path, filepath.Join("8453", "0x00000000000000000000000000000000000000A1", "policy-1.json")) {
		t.Fatalf("unexpected bundle path: %s", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat bundle file: %v", err)
	}
	if info.Mode().Perm() != bundleFileMode {
		t.Fatalf("unexpected bundle file mode: got=%v want=%v", info.Mode().Perm(), os.FileMode(bundleFileMode))
	}

	loaded, err := store.Load(8453, "0x00000000000000000000000000000000000000a1", "policy-1")
	if err != nil {
		t.Fatalf("Load error: %v", err)
	}
	if loaded.SmartWalletAddress != "" {
		t.Fatalf("expected no smart wallet address before update, got %s", loaded.SmartWalletAddress)
	}
	if !loaded.NeedsPostDeployAddressSet {
		t.Fatalf("expected bundle to require post-deploy address update")
	}

	updated, err := store.UpdateSmartWalletAddress(8453, "0x00000000000000000000000000000000000000a1", "policy-1", "0x0000000000000000000000000000000000000012")
	if err != nil {
		t.Fatalf("UpdateSmartWalletAddress error: %v", err)
	}
	if updated.SmartWalletAddress != "0x0000000000000000000000000000000000000012" {
		t.Fatalf("unexpected smart wallet address: %s", updated.SmartWalletAddress)
	}
	if updated.RelayerPolicy.SmartWalletAddress != updated.SmartWalletAddress {
		t.Fatalf("relayer policy not updated: %#v", updated.RelayerPolicy)
	}
	if updated.NeedsPostDeployAddressSet {
		t.Fatalf("did not expect post-deploy address requirement after update")
	}

	reloaded, err := LoadBundleFile(path)
	if err != nil {
		t.Fatalf("LoadBundleFile error: %v", err)
	}
	if reloaded.SmartWalletAddress != updated.SmartWalletAddress {
		t.Fatalf("updated address not persisted: got=%s want=%s", reloaded.SmartWalletAddress, updated.SmartWalletAddress)
	}
}

func TestBuildAndSaveSafeProvisioningBundle(t *testing.T) {
	store := NewBundleStore(t.TempDir())

	bundle, path, err := BuildAndSaveSafeProvisioningBundle(store, testSafeProvisioningRequest("0x600060005560206000f3"))
	if err != nil {
		t.Fatalf("BuildAndSaveSafeProvisioningBundle error: %v", err)
	}
	if path == "" {
		t.Fatalf("expected persisted bundle path")
	}
	if bundle.SmartWalletAddress == "" {
		t.Fatalf("expected predicted smart wallet address")
	}

	loaded, err := LoadBundleFile(path)
	if err != nil {
		t.Fatalf("LoadBundleFile error: %v", err)
	}
	if loaded.SessionKeyAddress != bundle.SessionKeyAddress {
		t.Fatalf("unexpected stored session key address: got=%s want=%s", loaded.SessionKeyAddress, bundle.SessionKeyAddress)
	}
}

func TestSaveBundleFileNormalizesPredictedAddress(t *testing.T) {
	bundle := testSafeProvisioningBundle(t, "0x600060005560206000f3")
	path := filepath.Join(t.TempDir(), "bundle.json")

	if err := SaveBundleFile(path, bundle); err != nil {
		t.Fatalf("SaveBundleFile error: %v", err)
	}
	loaded, err := LoadBundleFile(path)
	if err != nil {
		t.Fatalf("LoadBundleFile error: %v", err)
	}
	if loaded.SmartWalletAddress == "" {
		t.Fatalf("expected predicted smart wallet address")
	}
	if loaded.RelayerPolicy.SmartWalletAddress != loaded.SmartWalletAddress {
		t.Fatalf("relayer policy smart wallet mismatch: %#v", loaded.RelayerPolicy)
	}
	if loaded.NeedsPostDeployAddressSet {
		t.Fatalf("predicted smart wallet should not need post-deploy address update")
	}
}

func TestAttachStrategyPolicyModuleBuildsSafeActions(t *testing.T) {
	bundle := testSafeProvisioningBundle(t, "")
	bundle.SmartWalletAddress = "0x0000000000000000000000000000000000000012"

	updated, err := AttachStrategyPolicyModule(bundle, StrategyPolicyModuleActionRequest{
		StrategyPolicyModuleAddress: "0x00000000000000000000000000000000000000eE",
	})
	if err != nil {
		t.Fatalf("AttachStrategyPolicyModule error: %v", err)
	}
	if !strings.EqualFold(updated.StrategyPolicyModuleAddress, "0x00000000000000000000000000000000000000ee") {
		t.Fatalf("unexpected module address: %s", updated.StrategyPolicyModuleAddress)
	}
	if updated.EnableModuleAction == nil {
		t.Fatalf("expected enable module action")
	}
	if updated.EnableModuleAction.Safe != updated.SmartWalletAddress || updated.EnableModuleAction.To != updated.SmartWalletAddress {
		t.Fatalf("enable action should be executed by safe against safe: %#v", updated.EnableModuleAction)
	}
	if !strings.HasPrefix(updated.EnableModuleAction.Data, "0x610b5925") {
		t.Fatalf("unexpected enableModule selector: %s", updated.EnableModuleAction.Data)
	}
	if updated.GrantSessionKeyAction == nil {
		t.Fatalf("expected grant session key action")
	}
	if updated.GrantSessionKeyAction.Safe != updated.SmartWalletAddress || updated.GrantSessionKeyAction.To != updated.StrategyPolicyModuleAddress {
		t.Fatalf("grant action should be executed by safe against module: %#v", updated.GrantSessionKeyAction)
	}
	if len(updated.RelayerPolicy.AllowedChainIDs) != 1 || updated.RelayerPolicy.AllowedChainIDs[0] != updated.ChainID {
		t.Fatalf("relayer policy chain id not preserved: %#v", updated.RelayerPolicy.AllowedChainIDs)
	}
	if updated.RelayerPolicy.SessionKeyAddress != updated.SessionKeyAddress {
		t.Fatalf("relayer policy session key mismatch: %#v", updated.RelayerPolicy)
	}
}

func TestUpdateBundleStrategyPolicyModuleFilePersistsActions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.json")
	if err := SaveBundleFile(path, testSafeProvisioningBundle(t, "")); err != nil {
		t.Fatalf("SaveBundleFile error: %v", err)
	}
	if _, err := UpdateBundleSmartWalletAddressFile(path, "0x0000000000000000000000000000000000000012"); err != nil {
		t.Fatalf("UpdateBundleSmartWalletAddressFile error: %v", err)
	}

	updated, err := UpdateBundleStrategyPolicyModuleFile(path, StrategyPolicyModuleActionRequest{
		StrategyPolicyModuleAddress: "0x00000000000000000000000000000000000000eE",
		AllowedContractAddresses:    []string{"0x00000000000000000000000000000000000000bb"},
		AllowedFunctionSelectors:    []string{"0x095ea7b3"},
		MaxValueWei:                 "7",
		MaxGasLimit:                 50000,
	})
	if err != nil {
		t.Fatalf("UpdateBundleStrategyPolicyModuleFile error: %v", err)
	}
	if updated.RelayerPolicy.MaxValueWei != "7" || updated.RelayerPolicy.MaxGasLimit != 50000 {
		t.Fatalf("policy override not applied: %#v", updated.RelayerPolicy)
	}

	reloaded, err := LoadBundleFile(path)
	if err != nil {
		t.Fatalf("LoadBundleFile error: %v", err)
	}
	if reloaded.EnableModuleAction == nil || reloaded.GrantSessionKeyAction == nil {
		t.Fatalf("module actions were not persisted: %#v", reloaded)
	}
	if len(reloaded.RelayerPolicy.AllowedFunctionSelectors) != 1 || reloaded.RelayerPolicy.AllowedFunctionSelectors[0] != "0x095ea7b3" {
		t.Fatalf("selector override not persisted: %#v", reloaded.RelayerPolicy.AllowedFunctionSelectors)
	}
}

func TestBundleStoreRejectsInvalidIdentity(t *testing.T) {
	store := NewBundleStore(t.TempDir())

	if _, err := store.BundlePath(0, "0x00000000000000000000000000000000000000a1", "policy-1"); err == nil {
		t.Fatalf("expected chain id error")
	}
	if _, err := store.BundlePath(8453, "not-an-address", "policy-1"); err == nil {
		t.Fatalf("expected owner address error")
	}
	if _, err := NewBundleStore("").BundlePath(8453, "0x00000000000000000000000000000000000000a1", "policy-1"); err == nil {
		t.Fatalf("expected root error")
	}
}

func testSafeProvisioningBundle(t *testing.T, proxyCreationCode string) SafeProvisioningBundle {
	t.Helper()
	bundle, err := BuildSafeProvisioningBundle(testSafeProvisioningRequest(proxyCreationCode))
	if err != nil {
		t.Fatalf("BuildSafeProvisioningBundle error: %v", err)
	}
	return bundle
}

func testSafeProvisioningRequest(proxyCreationCode string) SafeProvisioningRequest {
	return SafeProvisioningRequest{
		OwnerAddress:                "0x00000000000000000000000000000000000000a1",
		ChainID:                     8453,
		PolicyID:                    "policy-1",
		SafeSingletonAddress:        "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:     "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress:  "0x00000000000000000000000000000000000000d1",
		ProxyCreationCode:           proxyCreationCode,
		SessionPrivateKey:           "0x2222222222222222222222222222222222222222222222222222222222222222",
		SaltNonce:                   "12345",
		AllowedContractAddresses:    []string{"0x00000000000000000000000000000000000000aa"},
		AllowedFunctionSelectors:    []string{"0xa9059cbb"},
		MaxValueWei:                 "5",
		MaxGasLimit:                 21000,
		SessionDeadlineGraceSeconds: 30,
	}
}
