package scwrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/HershyOrg/hershy/cctx/base"
	cctxrelayer "github.com/HershyOrg/hershy/cctx/relayer"
)

type ChainExecutionConfig struct {
	Chain              string `json:"chain,omitempty"`
	ChainID            int64  `json:"chain_id"`
	RPCURL             string `json:"rpc_url"`
	ModuleAddress      string `json:"module_address"`
	RelayerPrivateKey  string `json:"relayer_private_key"`
	GasLimitMultiplier uint64 `json:"gas_limit_multiplier,omitempty"`
}

type ChainExecutionConfigFile struct {
	Chains []ChainExecutionConfig `json:"chains"`
}

type FileBackedSubmitter struct {
	ConfigPath string
}

func (submitter FileBackedSubmitter) SubmitModuleExecute(ctx context.Context, request base.SCWRelayRequest) (string, error) {
	config, err := loadChainExecutionConfig(strings.TrimSpace(submitter.ConfigPath), request)
	if err != nil {
		return "", err
	}
	return cctxrelayer.RPCModuleExecutor{
		RPCURL:             strings.TrimSpace(config.RPCURL),
		ModuleAddress:      strings.TrimSpace(config.ModuleAddress),
		RelayerPrivateKey:  strings.TrimSpace(config.RelayerPrivateKey),
		GasLimitMultiplier: config.GasLimitMultiplier,
	}.SubmitModuleExecute(ctx, request)
}

func loadChainExecutionConfig(path string, request base.SCWRelayRequest) (ChainExecutionConfig, error) {
	if path == "" {
		return ChainExecutionConfig{}, fmt.Errorf("relayer chain config path required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ChainExecutionConfig{}, fmt.Errorf("read relayer chain config: %w", err)
	}

	var file ChainExecutionConfigFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return ChainExecutionConfig{}, fmt.Errorf("decode relayer chain config: %w", err)
	}
	if len(file.Chains) == 0 {
		return ChainExecutionConfig{}, fmt.Errorf("relayer chain config is empty")
	}

	chainSlug := strings.TrimSpace(request.Chain)
	for _, candidate := range file.Chains {
		if request.ChainID > 0 && candidate.ChainID == request.ChainID {
			return validateChainExecutionConfig(candidate)
		}
		if chainSlug != "" && strings.EqualFold(strings.TrimSpace(candidate.Chain), chainSlug) {
			return validateChainExecutionConfig(candidate)
		}
	}

	if request.ChainID > 0 {
		return ChainExecutionConfig{}, fmt.Errorf("no relayer chain config for chain id %d", request.ChainID)
	}
	if chainSlug != "" {
		return ChainExecutionConfig{}, fmt.Errorf("no relayer chain config for chain %s", chainSlug)
	}
	return ChainExecutionConfig{}, fmt.Errorf("relay request missing chain selection")
}

func validateChainExecutionConfig(config ChainExecutionConfig) (ChainExecutionConfig, error) {
	if config.ChainID <= 0 {
		return ChainExecutionConfig{}, fmt.Errorf("relayer chain config missing chain_id")
	}
	if strings.TrimSpace(config.RPCURL) == "" {
		return ChainExecutionConfig{}, fmt.Errorf("relayer chain %d missing rpc_url", config.ChainID)
	}
	if strings.TrimSpace(config.ModuleAddress) == "" {
		return ChainExecutionConfig{}, fmt.Errorf("relayer chain %d missing module_address", config.ChainID)
	}
	if strings.TrimSpace(config.RelayerPrivateKey) == "" {
		return ChainExecutionConfig{}, fmt.Errorf("relayer chain %d missing relayer_private_key", config.ChainID)
	}
	if config.GasLimitMultiplier == 0 {
		config.GasLimitMultiplier = 1
	}
	return config, nil
}
