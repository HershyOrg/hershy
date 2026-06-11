package relayer

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/HershyOrg/hershy/cctx/base"
)

type BundlePolicyStore struct {
	RootDir string
}

type bundlePolicyFile struct {
	ChainID                     int64              `json:"chain_id"`
	PolicyID                    string             `json:"policy_id"`
	SmartWalletAddress          string             `json:"smart_wallet_address"`
	SessionKeyAddress           string             `json:"session_key_address"`
	StrategyPolicyModuleAddress string             `json:"strategy_policy_module_address"`
	RelayerPolicy               SCWExecutionPolicy `json:"relayer_policy"`
}

func (s BundlePolicyStore) LookupPolicy(request base.SCWRelayRequest) (SCWExecutionPolicy, error) {
	root := strings.TrimSpace(s.RootDir)
	if root == "" {
		return SCWExecutionPolicy{}, errors.New("bundle policy store root required")
	}

	var (
		matchedPolicy SCWExecutionPolicy
		matched       bool
		loadErrors    []string
	)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			loadErrors = append(loadErrors, fmt.Sprintf("%s: %v", path, walkErr))
			return nil
		}
		if entry.IsDir() || filepath.Ext(path) != ".json" {
			return nil
		}
		policy, err := loadBundlePolicyFile(path)
		if err != nil {
			loadErrors = append(loadErrors, fmt.Sprintf("%s: %v", path, err))
			return nil
		}
		if !policyMatchesRequest(policy, request) {
			return nil
		}
		matchedPolicy = policy
		matched = true
		return filepath.SkipAll
	})
	if err != nil {
		return SCWExecutionPolicy{}, fmt.Errorf("walk bundle store: %w", err)
	}
	if matched {
		return matchedPolicy, nil
	}
	if len(loadErrors) > 0 {
		return SCWExecutionPolicy{}, fmt.Errorf("no matching policy for relay request; bundle load errors: %s", strings.Join(loadErrors, "; "))
	}
	return SCWExecutionPolicy{}, errors.New("no matching policy for relay request")
}

func loadBundlePolicyFile(path string) (SCWExecutionPolicy, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return SCWExecutionPolicy{}, fmt.Errorf("read bundle file: %w", err)
	}
	var bundle bundlePolicyFile
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return SCWExecutionPolicy{}, fmt.Errorf("decode bundle json: %w", err)
	}
	policy := bundle.RelayerPolicy
	if strings.TrimSpace(policy.SmartWalletAddress) == "" {
		policy.SmartWalletAddress = bundle.SmartWalletAddress
	}
	if strings.TrimSpace(policy.SessionKeyAddress) == "" {
		policy.SessionKeyAddress = bundle.SessionKeyAddress
	}
	if strings.TrimSpace(policy.PolicyID) == "" {
		policy.PolicyID = bundle.PolicyID
	}
	if strings.TrimSpace(policy.StrategyPolicyModule) == "" {
		policy.StrategyPolicyModule = bundle.StrategyPolicyModuleAddress
	}
	if len(policy.AllowedChainIDs) == 0 && bundle.ChainID > 0 {
		policy.AllowedChainIDs = []int64{bundle.ChainID}
	}
	return policy, nil
}

func policyMatchesRequest(policy SCWExecutionPolicy, request base.SCWRelayRequest) bool {
	if strings.TrimSpace(policy.SmartWalletAddress) != "" && !strings.EqualFold(policy.SmartWalletAddress, request.SmartWalletAddress) {
		return false
	}
	if strings.TrimSpace(policy.PolicyID) != "" && strings.TrimSpace(policy.PolicyID) != strings.TrimSpace(request.PolicyID) {
		return false
	}
	if strings.TrimSpace(policy.SessionKeyAddress) != "" && !strings.EqualFold(policy.SessionKeyAddress, request.SessionKeyAddress) {
		return false
	}
	return true
}
