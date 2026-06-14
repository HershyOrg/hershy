import type {
  ScwOnboardingConfirmRequest,
  ScwOnboardingResponse,
} from "../types/scwOnboardingTypes";
import {
  getScwChainId,
  getScwPolicyId,
  getScwRpcUrl,
} from "@/shared/config/scwConfig";

const DEFAULT_ONBOARDING_API_BASE = "/scw-onboarding-api";

function shouldUseDevProxy(configuredBase: string) {
  if (!import.meta.env.DEV || !configuredBase) return false;

  try {
    const url = new URL(configuredBase);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "18081"
    );
  } catch {
    return false;
  }
}

export function getScwOnboardingApiBase() {
  const configuredBase = import.meta.env.VITE_SCW_ONBOARDING_API_BASE?.trim() || "";
  const apiBase = shouldUseDevProxy(configuredBase)
    ? DEFAULT_ONBOARDING_API_BASE
    : configuredBase || DEFAULT_ONBOARDING_API_BASE;

  return apiBase.replace(/\/+$/, "");
}

function onboardingRequestBase(ownerAddress: string, smartWalletAddress?: string) {
  return {
    owner_address: ownerAddress,
    chain_id: getScwChainId(),
    policy_id: getScwPolicyId(),
    rpc_url: getScwRpcUrl(),
    ...(smartWalletAddress ? { smart_wallet_address: smartWalletAddress } : {}),
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) as T : ({} as T);

  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error)
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return data;
}

export async function prepareScwOnboarding(ownerAddress: string, smartWalletAddress?: string) {
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(onboardingRequestBase(ownerAddress, smartWalletAddress)),
  });

  return readJsonResponse<ScwOnboardingResponse>(response);
}

export async function fetchScwOnboardingStatus(ownerAddress: string, smartWalletAddress?: string) {
  const request = onboardingRequestBase(ownerAddress, smartWalletAddress);
  const params = new URLSearchParams({
    owner_address: request.owner_address,
    chain_id: String(request.chain_id),
    policy_id: request.policy_id,
    rpc_url: request.rpc_url,
  });
  if (request.smart_wallet_address) {
    params.set("smart_wallet_address", request.smart_wallet_address);
  }
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/status?${params.toString()}`);

  return readJsonResponse<ScwOnboardingResponse>(response);
}

export async function confirmScwOnboardingAction(payload: ScwOnboardingConfirmRequest) {
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      chain_id: payload.chain_id ?? getScwChainId(),
      policy_id: payload.policy_id || getScwPolicyId(),
    }),
  });

  return readJsonResponse<ScwOnboardingResponse>(response);
}
