package onboarding

import (
	"time"

	"github.com/HershyOrg/hershy/cctx/scw"
)

type OnboardingState string

const (
	StateNotCreated         OnboardingState = "not_created"
	StateBundleCreated      OnboardingState = "bundle_created"
	StateDeployed           OnboardingState = "deployed"
	StateModuleActionsReady OnboardingState = "module_actions_ready"
	StateReady              OnboardingState = "ready"
	StateFailed             OnboardingState = "failed"
)

type ServerDefaults struct {
	StoreRoot                  string
	RPCURL                     string
	ChainID                    int64
	PolicyID                   string
	SafeSingletonAddress       string
	SafeProxyFactoryAddress    string
	SafeFallbackHandlerAddress string
	ProxyCreationCode          string
	StrategyPolicyModule       string
	AllowedContractAddresses   []string
	AllowedFunctionSelectors   []string
	MaxValueWei                string
	MaxGasLimit                uint64
	DeadlineGraceSeconds       int64
	SessionValidAfterUnix      int64
	SessionValidUntilUnix      int64
}

type PrepareRequest struct {
	OwnerAddress               string   `json:"owner_address"`
	ChainID                    int64    `json:"chain_id,omitempty"`
	PolicyID                   string   `json:"policy_id,omitempty"`
	SmartWalletAddress         string   `json:"smart_wallet_address,omitempty"`
	SafeSingletonAddress       string   `json:"safe_singleton_address,omitempty"`
	SafeProxyFactoryAddress    string   `json:"safe_proxy_factory_address,omitempty"`
	SafeFallbackHandlerAddress string   `json:"safe_fallback_handler_address,omitempty"`
	ProxyCreationCode          string   `json:"proxy_creation_code,omitempty"`
	StrategyPolicyModule       string   `json:"strategy_policy_module_address,omitempty"`
	AllowedContractAddresses   []string `json:"allowed_contract_addresses,omitempty"`
	AllowedFunctionSelectors   []string `json:"allowed_function_selectors,omitempty"`
	MaxValueWei                string   `json:"max_value_wei,omitempty"`
	MaxGasLimit                uint64   `json:"max_gas_limit,omitempty"`
	DeadlineGraceSeconds       int64    `json:"deadline_grace_seconds,omitempty"`
	SessionValidAfterUnix      int64    `json:"session_valid_after_unix,omitempty"`
	SessionValidUntilUnix      int64    `json:"session_valid_until_unix,omitempty"`
	ForceRecreate              bool     `json:"force_recreate,omitempty"`
}

type StatusRequest struct {
	OwnerAddress string `json:"owner_address"`
	ChainID      int64  `json:"chain_id,omitempty"`
	PolicyID     string `json:"policy_id,omitempty"`
	RPCURL       string `json:"rpc_url,omitempty"`
}

type ConfirmRequest struct {
	OwnerAddress       string `json:"owner_address"`
	ChainID            int64  `json:"chain_id,omitempty"`
	PolicyID           string `json:"policy_id,omitempty"`
	TxHash             string `json:"tx_hash"`
	Kind               string `json:"kind"`
	SmartWalletAddress string `json:"smart_wallet_address,omitempty"`
}

type PrepareResponse struct {
	Status            StatusResponse            `json:"status"`
	Bundle            scw.BundleOperationResult `json:"bundle"`
	PermissionSummary PermissionSummary         `json:"permission_summary"`
	NextActions       []UserAction              `json:"next_actions"`
}

type StatusResponse struct {
	State                OnboardingState `json:"state"`
	ReadyForRelay        bool            `json:"ready_for_relay"`
	VerificationMode     string          `json:"verification_mode"`
	OwnerAddress         string          `json:"owner_address,omitempty"`
	ChainID              int64           `json:"chain_id,omitempty"`
	PolicyID             string          `json:"policy_id,omitempty"`
	SmartWalletAddress   string          `json:"smart_wallet_address,omitempty"`
	SessionKeyAddress    string          `json:"session_key_address,omitempty"`
	StrategyPolicyModule string          `json:"strategy_policy_module_address,omitempty"`
	BundleExists         bool            `json:"bundle_exists"`
	DeploymentCallReady  bool            `json:"deployment_call_ready"`
	ModuleActionReady    bool            `json:"module_action_ready"`
	SessionGrantReady    bool            `json:"session_grant_ready"`
	SmartWalletDeployed  *bool           `json:"smart_wallet_deployed,omitempty"`
	SmartWalletCodeSize  *int            `json:"smart_wallet_code_size,omitempty"`
	ModuleEnabled        *bool           `json:"module_enabled,omitempty"`
	SessionPolicyActive  *bool           `json:"session_policy_active,omitempty"`
	SessionPolicyPaused  *bool           `json:"session_policy_paused,omitempty"`
	SessionPolicyValid   *bool           `json:"session_policy_valid,omitempty"`
	CheckedAt            time.Time       `json:"checked_at"`
	Error                string          `json:"error,omitempty"`
}

type ConfirmResponse struct {
	Status  StatusResponse `json:"status"`
	Message string         `json:"message"`
}

type PermissionSummary struct {
	Title                    string   `json:"title"`
	Description              string   `json:"description"`
	SmartWalletAddress       string   `json:"smart_wallet_address,omitempty"`
	SessionKeyAddress        string   `json:"session_key_address,omitempty"`
	StrategyPolicyModule     string   `json:"strategy_policy_module_address,omitempty"`
	AllowedContractAddresses []string `json:"allowed_contract_addresses,omitempty"`
	AllowedFunctionSelectors []string `json:"allowed_function_selectors,omitempty"`
	MaxValueWei              string   `json:"max_value_wei,omitempty"`
	MaxGasLimit              uint64   `json:"max_gas_limit,omitempty"`
	SessionValidAfterUnix    int64    `json:"session_valid_after_unix,omitempty"`
	SessionValidUntilUnix    int64    `json:"session_valid_until_unix,omitempty"`
}

type UserAction struct {
	ID          string          `json:"id"`
	Label       string          `json:"label"`
	Description string          `json:"description"`
	Action      *scw.SafeAction `json:"action,omitempty"`
}
