package scw

import (
	"strings"
	"testing"
	"time"
)

func TestBuildSafeProvisioningBundleWithoutProxyCreationCode(t *testing.T) {
	bundle, err := BuildSafeProvisioningBundle(SafeProvisioningRequest{
		OwnerAddress:                "0x00000000000000000000000000000000000000a1",
		ChainID:                     8453,
		PolicyID:                    "policy-1",
		SafeSingletonAddress:        "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:     "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress:  "0x00000000000000000000000000000000000000d1",
		SessionPrivateKey:           "0x2222222222222222222222222222222222222222222222222222222222222222",
		SaltNonce:                   "12345",
		AllowedContractAddresses:    []string{"0x00000000000000000000000000000000000000aa"},
		AllowedFunctionSelectors:    []string{"0xa9059cbb"},
		MaxValueWei:                 "5",
		MaxGasLimit:                 21000,
		SessionDeadlineGraceSeconds: 30,
	})
	if err != nil {
		t.Fatalf("BuildSafeProvisioningBundle error: %v", err)
	}

	if bundle.OwnerAddress != "0x00000000000000000000000000000000000000A1" {
		t.Fatalf("unexpected owner address: %s", bundle.OwnerAddress)
	}
	if bundle.SessionPrivateKey != "0x2222222222222222222222222222222222222222222222222222222222222222" {
		t.Fatalf("unexpected session private key: %s", bundle.SessionPrivateKey)
	}
	if bundle.SessionKeyAddress == "" {
		t.Fatalf("expected session key address")
	}
	if bundle.SaltNonce != "12345" {
		t.Fatalf("unexpected salt nonce: %s", bundle.SaltNonce)
	}
	if !strings.HasPrefix(bundle.SafeSetupCalldata, "0xb63e800d") {
		t.Fatalf("unexpected safe setup selector: %s", bundle.SafeSetupCalldata[:10])
	}
	if !strings.HasPrefix(bundle.DeploymentCall.Data, "0x1688f0b9") {
		t.Fatalf("unexpected factory selector: %s", bundle.DeploymentCall.Data[:10])
	}
	if bundle.DeploymentCall.To != "0x00000000000000000000000000000000000000C1" {
		t.Fatalf("unexpected deployment target: %s", bundle.DeploymentCall.To)
	}
	if bundle.SmartWalletAddress != "" {
		t.Fatalf("expected no predicted smart wallet address without proxy creation code, got %s", bundle.SmartWalletAddress)
	}
	if !bundle.NeedsPostDeployAddressSet {
		t.Fatalf("expected post-deploy address resolution requirement")
	}
	if bundle.RelayerPolicy.SessionKeyAddress != bundle.SessionKeyAddress {
		t.Fatalf("unexpected relayer policy session key address: %s", bundle.RelayerPolicy.SessionKeyAddress)
	}
	if len(bundle.RelayerPolicy.AllowedChainIDs) != 1 || bundle.RelayerPolicy.AllowedChainIDs[0] != 8453 {
		t.Fatalf("unexpected relayer policy chain ids: %#v", bundle.RelayerPolicy.AllowedChainIDs)
	}
	if bundle.RelayerPolicy.MaxValueWei != "5" || bundle.RelayerPolicy.MaxGasLimit != 21000 {
		t.Fatalf("unexpected relayer policy limits: %#v", bundle.RelayerPolicy)
	}
	if bundle.RelayerPolicy.DeadlineGracePeriod != 30*time.Second {
		t.Fatalf("unexpected deadline grace period: %s", bundle.RelayerPolicy.DeadlineGracePeriod)
	}
}

func TestBuildSafeProvisioningBundlePredictsAddressWhenProxyCodeProvided(t *testing.T) {
	bundle, err := BuildSafeProvisioningBundle(SafeProvisioningRequest{
		OwnerAddress:               "0x00000000000000000000000000000000000000a1",
		ChainID:                    1,
		SafeSingletonAddress:       "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:    "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress: "0x00000000000000000000000000000000000000d1",
		SessionPrivateKey:          "0x2222222222222222222222222222222222222222222222222222222222222222",
		SaltNonce:                  "7",
		ProxyCreationCode:          "0x600060005560206000f3",
	})
	if err != nil {
		t.Fatalf("BuildSafeProvisioningBundle error: %v", err)
	}

	if bundle.SmartWalletAddress == "" {
		t.Fatalf("expected predicted smart wallet address")
	}
	if bundle.NeedsPostDeployAddressSet {
		t.Fatalf("did not expect post-deploy address resolution requirement")
	}
	if bundle.RelayerPolicy.SmartWalletAddress != bundle.SmartWalletAddress {
		t.Fatalf("unexpected relayer smart wallet address: got=%s want=%s", bundle.RelayerPolicy.SmartWalletAddress, bundle.SmartWalletAddress)
	}
}

func TestBuildSafeProvisioningBundleRequiresDelegateTargetWhenDataPresent(t *testing.T) {
	_, err := BuildSafeProvisioningBundle(SafeProvisioningRequest{
		OwnerAddress:               "0x00000000000000000000000000000000000000a1",
		ChainID:                    1,
		SafeSingletonAddress:       "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:    "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress: "0x00000000000000000000000000000000000000d1",
		SetupDelegateCalldata:      "0x1234",
	})
	if err == nil {
		t.Fatalf("expected setup delegate target error")
	}
}

func TestBuildSafeProvisioningBundleAddsModuleActionsWhenConfigured(t *testing.T) {
	bundle, err := BuildSafeProvisioningBundle(SafeProvisioningRequest{
		OwnerAddress:                "0x00000000000000000000000000000000000000a1",
		ChainID:                     1,
		PolicyID:                    "policy-1",
		SafeSingletonAddress:        "0x00000000000000000000000000000000000000b1",
		SafeProxyFactoryAddress:     "0x00000000000000000000000000000000000000c1",
		SafeFallbackHandlerAddress:  "0x00000000000000000000000000000000000000d1",
		ProxyCreationCode:           "0x600060005560206000f3",
		StrategyPolicyModuleAddress: "0x00000000000000000000000000000000000000e1",
		SessionPrivateKey:           "0x2222222222222222222222222222222222222222222222222222222222222222",
		SaltNonce:                   "77",
		AllowedContractAddresses:    []string{"0x00000000000000000000000000000000000000aa"},
		AllowedFunctionSelectors:    []string{"0xa9059cbb"},
		MaxValueWei:                 "5",
		MaxGasLimit:                 21000,
		SessionValidUntilUnix:       1_900_000_000,
	})
	if err != nil {
		t.Fatalf("BuildSafeProvisioningBundle error: %v", err)
	}

	if !strings.EqualFold(bundle.StrategyPolicyModuleAddress, "0x00000000000000000000000000000000000000e1") {
		t.Fatalf("unexpected strategy policy module address: %s", bundle.StrategyPolicyModuleAddress)
	}
	if bundle.EnableModuleAction == nil {
		t.Fatalf("expected enable module action")
	}
	if bundle.EnableModuleAction.Safe != bundle.SmartWalletAddress {
		t.Fatalf("unexpected enable module safe: got=%s want=%s", bundle.EnableModuleAction.Safe, bundle.SmartWalletAddress)
	}
	if bundle.EnableModuleAction.To != bundle.SmartWalletAddress {
		t.Fatalf("unexpected enable module target: %s", bundle.EnableModuleAction.To)
	}
	if !strings.HasPrefix(bundle.EnableModuleAction.Data, "0x"+hexEncode(safeModuleManagerABI.Methods["enableModule"].ID)) {
		t.Fatalf("unexpected enable module selector: %s", bundle.EnableModuleAction.Data[:10])
	}
	if bundle.GrantSessionKeyAction == nil {
		t.Fatalf("expected grant session key action")
	}
	if bundle.GrantSessionKeyAction.Safe != bundle.SmartWalletAddress {
		t.Fatalf("unexpected grant action safe: got=%s want=%s", bundle.GrantSessionKeyAction.Safe, bundle.SmartWalletAddress)
	}
	if bundle.GrantSessionKeyAction.To != bundle.StrategyPolicyModuleAddress {
		t.Fatalf("unexpected grant action target: %s", bundle.GrantSessionKeyAction.To)
	}
	if !strings.HasPrefix(bundle.GrantSessionKeyAction.Data, "0x"+hexEncode(strategyPolicyModuleABI.Methods["grantSessionKey"].ID)) {
		t.Fatalf("unexpected grantSessionKey selector: %s", bundle.GrantSessionKeyAction.Data[:10])
	}
}

func hexEncode(raw []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(raw)*2)
	for index, value := range raw {
		out[index*2] = digits[value>>4]
		out[index*2+1] = digits[value&0x0f]
	}
	return string(out)
}
