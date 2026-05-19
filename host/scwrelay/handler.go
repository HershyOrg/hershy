package scwrelay

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/base"
	cctxrelayer "github.com/HershyOrg/hershy/cctx/relayer"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/program"
)

const DefaultRoutePath = "/relayer/scw/execute"

type RegistryPolicyStore struct {
	Registry *registry.Registry
}

func NewHandler(reg *registry.Registry, chainConfigPath string) (http.Handler, error) {
	if reg == nil {
		return nil, fmt.Errorf("registry required")
	}

	return &cctxrelayer.Server{
		PolicyStore: RegistryPolicyStore{Registry: reg},
		Submitter: FileBackedSubmitter{
			ConfigPath: strings.TrimSpace(chainConfigPath),
		},
		Now: time.Now,
	}, nil
}

func DefaultChainConfigPath(storageRoot string) string {
	return filepath.Join(strings.TrimSpace(storageRoot), "relayer", "chains.json")
}

func (store RegistryPolicyStore) LookupPolicy(request base.SCWRelayRequest) (cctxrelayer.SCWExecutionPolicy, error) {
	if store.Registry == nil {
		return cctxrelayer.SCWExecutionPolicy{}, fmt.Errorf("registry policy store not configured")
	}

	strategyID := strings.TrimSpace(request.StrategyID)
	if strategyID != "" {
		registration, err := store.Registry.GetSCWRelayerRegistration(program.ProgramID(strategyID))
		if err == nil {
			return toExecutionPolicy(registration.Config), nil
		}
	}

	registrations := store.Registry.ListSCWRelayerRegistrations()
	for _, registration := range registrations {
		policy := toExecutionPolicy(registration.Config)
		if matchesLookupKeys(request, policy) {
			return policy, nil
		}
	}

	return cctxrelayer.SCWExecutionPolicy{}, fmt.Errorf("no matching scw relayer policy for request")
}

func toExecutionPolicy(config registry.SCWRelayerConfig) cctxrelayer.SCWExecutionPolicy {
	policy := cctxrelayer.SCWExecutionPolicy{
		SmartWalletAddress:       strings.TrimSpace(config.SmartWalletAddress),
		SessionKeyAddress:        strings.TrimSpace(config.SessionKeyAddress),
		PolicyID:                 strings.TrimSpace(config.PolicyID),
		AllowedChainIDs:          append([]int64(nil), config.AllowedChainIDs...),
		AllowedContractAddresses: append([]string(nil), config.AllowedContractAddresses...),
		AllowedFunctionSelectors: append([]string(nil), config.AllowedFunctionSelectors...),
		MaxValueWei:              strings.TrimSpace(config.MaxValueWei),
		MaxGasLimit:              config.MaxGasLimit,
	}
	if config.DeadlineGraceSeconds > 0 {
		policy.DeadlineGracePeriod = time.Duration(config.DeadlineGraceSeconds) * time.Second
	}
	return policy
}

func matchesLookupKeys(request base.SCWRelayRequest, policy cctxrelayer.SCWExecutionPolicy) bool {
	if strings.TrimSpace(policy.SmartWalletAddress) != "" && !strings.EqualFold(strings.TrimSpace(policy.SmartWalletAddress), strings.TrimSpace(request.SmartWalletAddress)) {
		return false
	}
	if strings.TrimSpace(policy.SessionKeyAddress) != "" && !strings.EqualFold(strings.TrimSpace(policy.SessionKeyAddress), strings.TrimSpace(request.SessionKeyAddress)) {
		return false
	}
	if strings.TrimSpace(policy.PolicyID) != "" && strings.TrimSpace(policy.PolicyID) != strings.TrimSpace(request.PolicyID) {
		return false
	}
	return true
}
