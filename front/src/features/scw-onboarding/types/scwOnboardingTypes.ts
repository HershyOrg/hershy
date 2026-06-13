export type HexString = `0x${string}`;

export type ScwTransactionAction = {
  safe?: string;
  to: string;
  data: HexString;
  value?: string;
  operation?: number;
  chain_id?: number;
};

export type ScwNextAction = {
  id: string;
  label: string;
  description?: string;
  action: ScwTransactionAction;
};

export type ScwOnboardingStatus = {
  state?: string;
  ready_for_relay?: boolean;
  verification_mode?: string;
  owner_address?: string;
  chain_id?: number;
  policy_id?: string;
  smart_wallet_address?: string;
  session_key_address?: string;
  strategy_policy_module_address?: string;
  bundle_exists?: boolean;
  deployment_call_ready?: boolean;
  module_action_ready?: boolean;
  session_grant_ready?: boolean;
  smart_wallet_deployed?: boolean;
  smart_wallet_code_size?: number;
  module_enabled?: boolean;
  session_policy_active?: boolean;
  session_policy_paused?: boolean;
  session_policy_valid?: boolean;
  checked_at?: string;
};

export type ScwOnboardingResponse = {
  status?: ScwOnboardingStatus;
  message?: string;
  next_actions?: ScwNextAction[];
};

export type ScwOnboardingConfirmRequest = {
  owner_address: string;
  kind: string;
  tx_hash: HexString;
  smart_wallet_address?: string;
};

export type ScwActionExecutionResult = {
  txHash: HexString;
  approvalTxHash?: HexString;
  safeExecTxHash?: HexString;
  mode: "direct" | "safe";
};
