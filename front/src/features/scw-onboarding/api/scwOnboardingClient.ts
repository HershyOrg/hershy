import type {
  ScwOnboardingConfirmRequest,
  ScwOnboardingListResponse,
  ScwOnboardingResponse,
  ScwOnboardingStatus,
} from "../types/scwOnboardingTypes";
import {
  getScwChainId,
  getScwPolicyId,
  getScwRpcUrl,
} from "@/shared/config/scwConfig";

const DEFAULT_ONBOARDING_API_BASE = "/scw-onboarding-api";
const DEFAULT_SCW_POLICY_PREFIX = "bsc-fixed-dex-adapter";

function getScwPolicyPrefix() {
  return import.meta.env.VITE_SCW_POLICY_PREFIX?.trim() || DEFAULT_SCW_POLICY_PREFIX;
}

function normalizeEvmAddress(value?: string) {
  return value?.trim().toLowerCase() || "";
}

export function createScwPolicyId(smartWalletAddress?: string) {
  const address = normalizeEvmAddress(smartWalletAddress);
  return /^0x[0-9a-f]{40}$/.test(address)
    ? `${getScwPolicyPrefix()}-${address.slice(2, 10)}-${address.slice(-8)}`
    : getScwPolicyId();
}

export function createNewScwPolicyId(now = Date.now()) {
  const randomBytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(randomBytes);
  } else {
    randomBytes.set([now & 255, (now >> 8) & 255, (now >> 16) & 255, (now >> 24) & 255]);
  }
  const entropy = Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${getScwPolicyPrefix()}-${now.toString(36)}-${entropy}`;
}

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

function onboardingRequestBase(ownerAddress: string, smartWalletAddress?: string, policyId?: string) {
  return {
    owner_address: ownerAddress,
    chain_id: getScwChainId(),
    policy_id: policyId || createScwPolicyId(smartWalletAddress),
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

function normalizeScwOnboardingResponse(data: ScwOnboardingResponse | ScwOnboardingStatus): ScwOnboardingResponse {
  if ("status" in data && data.status) {
    return data;
  }

  return {
    status: data as ScwOnboardingStatus,
  };
}

export async function prepareScwOnboarding(ownerAddress: string, smartWalletAddress?: string, policyId?: string) {
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(onboardingRequestBase(ownerAddress, smartWalletAddress, policyId)),
  });

  return readJsonResponse<ScwOnboardingResponse>(response);
}

export async function fetchScwOnboardingStatus(ownerAddress: string, smartWalletAddress?: string, policyId?: string) {
  const request = onboardingRequestBase(ownerAddress, smartWalletAddress, policyId);
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

  const data = await readJsonResponse<ScwOnboardingResponse | ScwOnboardingStatus>(response);
  return normalizeScwOnboardingResponse(data);
}

export async function fetchScwOnboardingList(
  ownerAddress: string,
  options: { includeActions?: boolean; verifyOnchain?: boolean } = {},
) {
  const params = new URLSearchParams({
    owner_address: ownerAddress,
    chain_id: String(getScwChainId()),
  });
  if (options.includeActions) params.set("include_actions", "true");
  if (options.verifyOnchain) params.set("verify_onchain", "true");

  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/list?${params.toString()}`);
  return readJsonResponse<ScwOnboardingListResponse>(response);
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
