import type { ProbeRequest, ProbeResponse, ProviderProfile, ProviderProfileUpdate, ProviderSecretStatus } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const REQUEST_TIMEOUT_MS = 20000;

/** FastAPI reports failures as {detail: string}; keep that text for the inline status line. */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : `Request failed with HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body as T;
}

export const modelsApi = {
  probe: (input: ProbeRequest) => apiRequest<ProbeResponse>("/api/model-probes", { method: "POST", body: JSON.stringify(input) }),

  create: (providerId: string, update: ProviderProfileUpdate) =>
    apiRequest<ProviderProfile>(`/api/providers/${providerId}`, { method: "POST", body: JSON.stringify(update) }),

  update: (providerId: string, update: ProviderProfileUpdate) =>
    apiRequest<ProviderProfile>(`/api/providers/${providerId}`, { method: "PUT", body: JSON.stringify(update) }),

  remove: async (providerId: string): Promise<void> => {
    await apiRequest<null>(`/api/providers/${providerId}`, { method: "DELETE" });
  },

  saveKey: (providerId: string, apiKey: string) =>
    apiRequest<ProviderSecretStatus>(`/api/providers/${providerId}/secret`, {
      method: "PUT",
      body: JSON.stringify({ api_key: apiKey }),
    }),
};
