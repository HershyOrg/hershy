import type {
  ScwOnboardingConfirmRequest,
  ScwOnboardingResponse,
} from "../types/scwOnboardingTypes";

const DEFAULT_ONBOARDING_API_BASE = "http://127.0.0.1:18081";

export function getScwOnboardingApiBase() {
  return (
    import.meta.env.VITE_SCW_ONBOARDING_API_BASE?.trim() ||
    DEFAULT_ONBOARDING_API_BASE
  ).replace(/\/+$/, "");
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

export async function prepareScwOnboarding(ownerAddress: string) {
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      owner_address: ownerAddress,
    }),
  });

  return readJsonResponse<ScwOnboardingResponse>(response);
}

export async function fetchScwOnboardingStatus(ownerAddress: string) {
  const params = new URLSearchParams({ owner_address: ownerAddress });
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/status?${params.toString()}`);

  return readJsonResponse<ScwOnboardingResponse>(response);
}

export async function confirmScwOnboardingAction(payload: ScwOnboardingConfirmRequest) {
  const response = await fetch(`${getScwOnboardingApiBase()}/scw/onboarding/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return readJsonResponse<ScwOnboardingResponse>(response);
}
