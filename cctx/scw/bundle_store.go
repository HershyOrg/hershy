package scw

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	bundleDirectoryMode = 0o700
	bundleFileMode      = 0o600
	defaultPolicyID     = "default"
)

// BundleStore persists Safe provisioning bundles as local JSON files.
type BundleStore struct {
	rootDir string
}

// BuildAndSaveSafeProvisioningBundle creates a provisioning bundle and persists it.
func BuildAndSaveSafeProvisioningBundle(store BundleStore, request SafeProvisioningRequest) (SafeProvisioningBundle, string, error) {
	bundle, err := BuildSafeProvisioningBundle(request)
	if err != nil {
		return SafeProvisioningBundle{}, "", err
	}
	normalized, err := normalizeBundleForStorage(bundle)
	if err != nil {
		return SafeProvisioningBundle{}, "", err
	}
	path, err := store.Save(normalized)
	if err != nil {
		return SafeProvisioningBundle{}, "", err
	}
	return normalized, path, nil
}

// NewBundleStore creates a file-backed SCW bundle store rooted at rootDir.
func NewBundleStore(rootDir string) BundleStore {
	return BundleStore{rootDir: strings.TrimSpace(rootDir)}
}

// Save writes bundle to its deterministic store path and returns that path.
func (store BundleStore) Save(bundle SafeProvisioningBundle) (string, error) {
	normalized, err := normalizeBundleForStorage(bundle)
	if err != nil {
		return "", err
	}
	path, err := store.BundlePath(normalized.ChainID, normalized.OwnerAddress, normalized.PolicyID)
	if err != nil {
		return "", err
	}
	if err := SaveBundleFile(path, normalized); err != nil {
		return "", err
	}
	return path, nil
}

// Load reads a bundle by chain, owner, and policy identifier.
func (store BundleStore) Load(chainID int64, ownerAddress, policyID string) (SafeProvisioningBundle, error) {
	path, err := store.BundlePath(chainID, ownerAddress, policyID)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	return LoadBundleFile(path)
}

// UpdateSmartWalletAddress records the deployed or predicted SCW address.
func (store BundleStore) UpdateSmartWalletAddress(chainID int64, ownerAddress, policyID, smartWalletAddress string) (SafeProvisioningBundle, error) {
	path, err := store.BundlePath(chainID, ownerAddress, policyID)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	return UpdateBundleSmartWalletAddressFile(path, smartWalletAddress)
}

// UpdateStrategyPolicyModule records a module address and regenerates Safe setup actions.
func (store BundleStore) UpdateStrategyPolicyModule(chainID int64, ownerAddress, policyID string, request StrategyPolicyModuleActionRequest) (SafeProvisioningBundle, error) {
	path, err := store.BundlePath(chainID, ownerAddress, policyID)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	return UpdateBundleStrategyPolicyModuleFile(path, request)
}

// BundlePath returns the deterministic JSON path for a bundle identity.
func (store BundleStore) BundlePath(chainID int64, ownerAddress, policyID string) (string, error) {
	if strings.TrimSpace(store.rootDir) == "" {
		return "", fmt.Errorf("bundle store root required")
	}
	if chainID <= 0 {
		return "", fmt.Errorf("chain id required")
	}
	owner, err := normalizeRequiredAddress(ownerAddress, "owner address")
	if err != nil {
		return "", err
	}
	policySegment := safeBundlePathSegment(policyID)
	return filepath.Join(store.rootDir, strconv.FormatInt(chainID, 10), owner, policySegment+".json"), nil
}

// SaveBundleFile writes a provisioning bundle to a specific JSON path.
func SaveBundleFile(path string, bundle SafeProvisioningBundle) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("bundle path required")
	}
	normalized, err := normalizeBundleForStorage(bundle)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), bundleDirectoryMode); err != nil {
		return fmt.Errorf("create bundle directory: %w", err)
	}

	payload, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal bundle json: %w", err)
	}
	payload = append(payload, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(path), ".bundle-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp bundle file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(payload); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp bundle file: %w", err)
	}
	if err := tmp.Chmod(bundleFileMode); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod temp bundle file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp bundle file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("commit bundle file: %w", err)
	}
	return nil
}

// LoadBundleFile reads a provisioning bundle from a specific JSON path.
func LoadBundleFile(path string) (SafeProvisioningBundle, error) {
	if strings.TrimSpace(path) == "" {
		return SafeProvisioningBundle{}, fmt.Errorf("bundle path required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("read bundle file: %w", err)
	}
	var bundle SafeProvisioningBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return SafeProvisioningBundle{}, fmt.Errorf("decode bundle json: %w", err)
	}
	normalized, err := normalizeBundleForStorage(bundle)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	return normalized, nil
}

// UpdateBundleSmartWalletAddressFile updates only the smart-wallet address in a saved bundle.
func UpdateBundleSmartWalletAddressFile(path, smartWalletAddress string) (SafeProvisioningBundle, error) {
	bundle, err := LoadBundleFile(path)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	normalizedAddress, err := normalizeRequiredAddress(smartWalletAddress, "smart wallet address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	bundle.SmartWalletAddress = normalizedAddress
	bundle.RelayerPolicy.SmartWalletAddress = normalizedAddress
	bundle.NeedsPostDeployAddressSet = false
	if err := SaveBundleFile(path, bundle); err != nil {
		return SafeProvisioningBundle{}, err
	}
	return bundle, nil
}

// UpdateBundleStrategyPolicyModuleFile updates module configuration and Safe actions.
func UpdateBundleStrategyPolicyModuleFile(path string, request StrategyPolicyModuleActionRequest) (SafeProvisioningBundle, error) {
	bundle, err := LoadBundleFile(path)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	updated, err := AttachStrategyPolicyModule(bundle, request)
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	if err := SaveBundleFile(path, updated); err != nil {
		return SafeProvisioningBundle{}, err
	}
	return updated, nil
}

func normalizeBundleForStorage(bundle SafeProvisioningBundle) (SafeProvisioningBundle, error) {
	if bundle.ChainID <= 0 {
		return SafeProvisioningBundle{}, fmt.Errorf("chain id required")
	}
	owner, err := normalizeRequiredAddress(bundle.OwnerAddress, "owner address")
	if err != nil {
		return SafeProvisioningBundle{}, err
	}
	bundle.OwnerAddress = owner
	policyID := firstTrimmed(bundle.PolicyID, bundle.RelayerPolicy.PolicyID)
	if policyID == "" {
		policyID = defaultPolicyID
	}
	bundle.PolicyID = policyID

	if smartWalletCandidate := firstTrimmed(bundle.SmartWalletAddress, bundle.RelayerPolicy.SmartWalletAddress); smartWalletCandidate != "" {
		smartWallet, err := normalizeRequiredAddress(smartWalletCandidate, "smart wallet address")
		if err != nil {
			return SafeProvisioningBundle{}, err
		}
		bundle.SmartWalletAddress = smartWallet
		bundle.RelayerPolicy.SmartWalletAddress = smartWallet
		bundle.NeedsPostDeployAddressSet = false
	}
	if sessionKeyCandidate := firstTrimmed(bundle.SessionKeyAddress, bundle.RelayerPolicy.SessionKeyAddress); sessionKeyCandidate != "" {
		sessionKey, err := normalizeRequiredAddress(sessionKeyCandidate, "session key address")
		if err != nil {
			return SafeProvisioningBundle{}, err
		}
		bundle.SessionKeyAddress = sessionKey
		bundle.RelayerPolicy.SessionKeyAddress = sessionKey
	}
	if moduleCandidate := firstTrimmed(bundle.StrategyPolicyModuleAddress, bundle.RelayerPolicy.StrategyPolicyModule); moduleCandidate != "" {
		moduleAddress, err := normalizeRequiredAddress(moduleCandidate, "strategy policy module address")
		if err != nil {
			return SafeProvisioningBundle{}, err
		}
		bundle.StrategyPolicyModuleAddress = moduleAddress
		bundle.RelayerPolicy.StrategyPolicyModule = moduleAddress
	}
	bundle.RelayerPolicy.PolicyID = strings.TrimSpace(bundle.PolicyID)
	return bundle, nil
}

func firstTrimmed(values ...string) string {
	for _, value := range values {
		if text := strings.TrimSpace(value); text != "" {
			return text
		}
	}
	return ""
}

func safeBundlePathSegment(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		text = defaultPolicyID
	}
	var out strings.Builder
	for _, char := range text {
		switch {
		case char >= 'a' && char <= 'z':
			out.WriteRune(char)
		case char >= 'A' && char <= 'Z':
			out.WriteRune(char)
		case char >= '0' && char <= '9':
			out.WriteRune(char)
		case char == '-', char == '_', char == '.':
			out.WriteRune(char)
		default:
			out.WriteByte('_')
		}
	}
	segment := strings.Trim(out.String(), "._-")
	if segment == "" || segment == "." || segment == ".." || strings.Contains(segment, string(filepath.Separator)) {
		return defaultPolicyID
	}
	return segment
}
