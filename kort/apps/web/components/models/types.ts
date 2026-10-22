import type { ApiStyle, BillingType, ProviderTypeValue } from "./catalog";

export type ManagedModel = {
  id: string;
  label: string;
  enabled: boolean;
  capabilities: string[];
};

export type ProviderProfile = {
  provider_id: string;
  label: string;
  provider_type: ProviderTypeValue;
  base_url: string;
  api_style: ApiStyle;
  default_model: string;
  env_key_name: string;
  enabled: boolean;
  capabilities: string[];
  catalog_id: string;
  billing_type: BillingType;
  models: ManagedModel[];
};

export type ProviderProfileUpdate = Omit<ProviderProfile, "provider_id">;

export type ProviderSecretStatus = {
  provider_id: string;
  configured: boolean;
  env_configured: boolean;
};

export type ProbeStatus =
  | "valid"
  | "invalid_base_url"
  | "missing_key"
  | "unauthorized"
  | "unreachable"
  | "not_found"
  | "rejected"
  | "error";

export type ProbeRequest = {
  base_url: string;
  api_style: ApiStyle;
  provider_type: ProviderTypeValue;
  api_key?: string;
  provider_id?: string;
  env_key_name?: string;
  models: string[];
};

export type ProbeResponse = {
  ok: boolean;
  status: ProbeStatus;
  message: string;
  discovered_models: string[];
  missing_models: string[];
  latency_ms: number;
};
