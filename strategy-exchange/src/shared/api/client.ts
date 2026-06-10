import type { ZodType } from "zod";

type JsonRequestInit = RequestInit & {
  headers?: HeadersInit;
};

export class ApiRequestError extends Error {
  endpoint: string;
  status?: number;

  constructor(endpoint: string, message: string, status?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

export function buildApiUrl(endpoint: string) {
  if (/^https?:\/\//.test(endpoint)) return endpoint;
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  if (!baseUrl) return endpoint;
  return `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function buildJsonHeaders(headers?: HeadersInit) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Accept")) requestHeaders.set("Accept", "application/json");
  return requestHeaders;
}

export async function requestJson<T>(
  endpoint: string,
  schema?: ZodType<T>,
  init?: JsonRequestInit,
): Promise<T> {
  if (typeof fetch !== "function") {
    throw new ApiRequestError(endpoint, "Fetch is unavailable");
  }

  const url = buildApiUrl(endpoint);
  const response = await fetch(url, {
    ...init,
    headers: buildJsonHeaders(init?.headers),
  });

  if (!response.ok) {
    throw new ApiRequestError(endpoint, `API request failed with ${response.status}`, response.status);
  }

  const payload = await response.json();
  if (!schema) return payload as T;

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiRequestError(endpoint, "API response shape is invalid", response.status);
  }

  return result.data;
}

export async function getJson<T>(endpoint: string, schema?: ZodType<T>): Promise<T | null> {
  if (typeof fetch !== "function") return null;

  try {
    return await requestJson(endpoint, schema);
  } catch {
    return null;
  }
}

export async function postJson<T>(
  endpoint: string,
  body: unknown,
  schema?: ZodType<T>,
): Promise<T | null> {
  if (typeof fetch !== "function") return null;

  try {
    return await requestJson(endpoint, schema, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export async function patchJson<T>(
  endpoint: string,
  body: unknown,
  schema?: ZodType<T>,
): Promise<T | null> {
  if (typeof fetch !== "function") return null;

  try {
    return await requestJson(endpoint, schema, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}
