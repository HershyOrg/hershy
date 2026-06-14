import { useCallback, useEffect, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import {
  confirmScwOnboardingAction,
  fetchScwOnboardingStatus,
  prepareScwOnboarding,
} from "../api/scwOnboardingClient";
import { getScwChainId, getScwRpcUrl } from "@/shared/config/scwConfig";
import type {
  ScwActionExecutionResult,
  ScwNextAction,
  ScwOnboardingResponse,
  ScwOnboardingStatus,
} from "../types/scwOnboardingTypes";
import {
  executePrivySmartWalletAction,
  executeScwOnboardingAction,
  getConfirmKindForAction,
} from "../utils/safeActionExecutor";

type UseScwOnboardingInput = {
  ownerAddress: string;
  smartWalletAddress?: string;
  smartWalletClient?: SmartWalletClientType | null;
  wallet: ConnectedWallet | null;
};

export function useScwOnboarding({
  ownerAddress,
  smartWalletAddress = "",
  smartWalletClient = null,
  wallet,
}: UseScwOnboardingInput) {
  const [response, setResponse] = useState<ScwOnboardingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingActionId, setPendingActionId] = useState("");
  const [error, setError] = useState("");
  const [lastExecution, setLastExecution] = useState<ScwActionExecutionResult | null>(null);
  const [chainId] = useState(getScwChainId);
  const [rpcUrl] = useState(getScwRpcUrl);

  const status: ScwOnboardingStatus | null = response?.status ?? null;
  const actions: ScwNextAction[] = response?.next_actions ?? [];

  const prepare = useCallback(async () => {
    if (!ownerAddress) return null;

    setIsLoading(true);
    setError("");
    try {
      const next = await prepareScwOnboarding(ownerAddress, smartWalletAddress);
      setResponse(next);
      return next;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SCW onboarding prepare failed";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [ownerAddress, smartWalletAddress]);

  const refresh = useCallback(async () => {
    if (!ownerAddress) return null;

    setIsLoading(true);
    setError("");
    try {
      const next = await fetchScwOnboardingStatus(ownerAddress, smartWalletAddress);
      setResponse(next);
      return next;
    } catch {
      return prepare();
    } finally {
      setIsLoading(false);
    }
  }, [ownerAddress, prepare, smartWalletAddress]);

  const executeAction = useCallback(async (nextAction: ScwNextAction) => {
    if (!ownerAddress || (!wallet && !smartWalletClient)) {
      setError("Privy 지갑 연결이 필요합니다.");
      return null;
    }

    setPendingActionId(nextAction.id);
    setError("");
    setLastExecution(null);
    try {
      const execution = smartWalletClient
        ? await executePrivySmartWalletAction({
            smartWalletClient,
            action: nextAction.action,
            rpcUrl,
            chainId,
          })
        : await executeScwOnboardingAction({
            wallet: wallet as ConnectedWallet,
            ownerAddress,
            action: nextAction.action,
            rpcUrl,
            chainId,
          });
      setLastExecution(execution);

      const confirmed = await confirmScwOnboardingAction({
        owner_address: ownerAddress,
        kind: getConfirmKindForAction(nextAction.id),
        tx_hash: execution.txHash,
        smart_wallet_address: smartWalletAddress || status?.smart_wallet_address || nextAction.action.safe || undefined,
      });
      setResponse(confirmed);
      await refresh();
      return execution;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SCW action execution failed";
      setError(message);
      return null;
    } finally {
      setPendingActionId("");
    }
  }, [chainId, ownerAddress, refresh, rpcUrl, smartWalletAddress, smartWalletClient, status, wallet]);

  useEffect(() => {
    if (!ownerAddress) {
      setResponse(null);
      setError("");
      return;
    }

    void refresh();
  }, [ownerAddress, refresh]);

  return {
    actions,
    chainId,
    error,
    executeAction,
    isLoading,
    lastExecution,
    pendingActionId,
    prepare,
    refresh,
    response,
    rpcUrl,
    status,
  };
}
