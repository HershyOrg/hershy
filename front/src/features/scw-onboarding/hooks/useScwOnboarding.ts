import { useCallback, useEffect, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  confirmScwOnboardingAction,
  fetchScwOnboardingStatus,
  prepareScwOnboarding,
} from "../api/scwOnboardingClient";
import type {
  ScwActionExecutionResult,
  ScwNextAction,
  ScwOnboardingResponse,
  ScwOnboardingStatus,
} from "../types/scwOnboardingTypes";
import {
  executeScwOnboardingAction,
  getConfirmKindForAction,
} from "../utils/safeActionExecutor";

const DEFAULT_CHAIN_ID = 56;
const DEFAULT_RPC_URL = "https://bsc-dataseed.binance.org";

function getScwChainId() {
  const raw = import.meta.env.VITE_SCW_CHAIN_ID?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_CHAIN_ID;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHAIN_ID;
}

function getScwRpcUrl() {
  return import.meta.env.VITE_SCW_RPC_URL?.trim() || DEFAULT_RPC_URL;
}

type UseScwOnboardingInput = {
  ownerAddress: string;
  wallet: ConnectedWallet | null;
};

export function useScwOnboarding({ ownerAddress, wallet }: UseScwOnboardingInput) {
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
      const next = await prepareScwOnboarding(ownerAddress);
      setResponse(next);
      return next;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SCW onboarding prepare failed";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [ownerAddress]);

  const refresh = useCallback(async () => {
    if (!ownerAddress) return null;

    setIsLoading(true);
    setError("");
    try {
      const next = await fetchScwOnboardingStatus(ownerAddress);
      setResponse(next);
      return next;
    } catch {
      return prepare();
    } finally {
      setIsLoading(false);
    }
  }, [ownerAddress, prepare]);

  const executeAction = useCallback(async (nextAction: ScwNextAction) => {
    if (!ownerAddress || !wallet) {
      setError("Privy 지갑 연결이 필요합니다.");
      return null;
    }

    setPendingActionId(nextAction.id);
    setError("");
    setLastExecution(null);
    try {
      const execution = await executeScwOnboardingAction({
        wallet,
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
        smart_wallet_address: status?.smart_wallet_address || nextAction.action.safe || undefined,
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
  }, [chainId, ownerAddress, refresh, rpcUrl, status, wallet]);

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
