import type { Locale } from "../../app/locale";
import { billingLabel, findCatalogProvider, type CatalogProvider } from "./catalog";
import type { ManagedModel, ProviderProfile, ProviderProfileUpdate } from "./types";

export type ModelRow = {
  key: string;
  provider: ProviderProfile;
  model: ManagedModel;
};

export type ModelGroup = {
  provider: ProviderProfile;
  rows: ModelRow[];
};

/** Which vendor a saved profile came from: explicit catalog id, else type, else its own id. */
export function catalogFor(provider: ProviderProfile): CatalogProvider | undefined {
  const candidates = [provider.catalog_id, provider.provider_type, provider.provider_id];
  for (const candidate of candidates) {
    const match = findCatalogProvider(candidate);
    if (match) return match;
  }
  return undefined;
}

/** A profile with no explicit rows still serves its default model. */
export function modelsOf(provider: ProviderProfile): ManagedModel[] {
  if (provider.models.length) return provider.models;
  if (!provider.default_model) return [];
  return [
    {
      id: provider.default_model,
      label: provider.default_model,
      enabled: provider.enabled,
      capabilities: provider.capabilities,
    },
  ];
}

/** 一个配置（供应商 + Endpoint + Key）折叠成一组，组里是它名下的模型行 */
export function modelGroups(providers: ProviderProfile[]): ModelGroup[] {
  return providers.map((provider) => ({
    provider,
    rows: modelsOf(provider).map((model) => ({
      key: `${provider.provider_id}/${model.id}`,
      provider,
      model,
    })),
  }));
}

export function modelName(model: ManagedModel): string {
  return model.label || model.id;
}

export function vendorName(provider: ProviderProfile, locale: Locale): string {
  const catalog = catalogFor(provider);
  return catalog ? catalog.name[locale === "zh-CN" ? "zh" : "en"] : provider.label;
}

/** 配置名即档案自己的 label；没起过名的老档案退回供应商名 */
export function configName(provider: ProviderProfile, locale: Locale): string {
  return provider.label.trim() || vendorName(provider, locale);
}

/** 组头已经带了供应商，行内只需要说明计费方式 */
export function rowSubtitle(provider: ProviderProfile, locale: Locale): string {
  return billingLabel(provider.billing_type, locale);
}

export function toUpdate(provider: ProviderProfile): ProviderProfileUpdate {
  const { provider_id: _ignored, ...rest } = provider;
  return rest;
}

/** The model a call falls back to when an agent names none. */
export function pickDefaultModel(models: ManagedModel[], fallback: string): string {
  const enabled = models.find((model) => model.enabled);
  return enabled?.id ?? models[0]?.id ?? fallback;
}

export function withModelEnabled(
  provider: ProviderProfile,
  modelId: string,
  enabled: boolean
): ProviderProfileUpdate {
  // A profile without rows *is* one model, so its switch is the provider's own enable flag.
  if (!provider.models.length) {
    return { ...toUpdate(provider), enabled };
  }

  const models = provider.models.map((model) => (model.id === modelId ? { ...model, enabled } : model));
  return {
    ...toUpdate(provider),
    models,
    default_model:
      provider.default_model === modelId && !enabled ? pickDefaultModel(models, provider.default_model) : provider.default_model,
  };
}

export function withoutModel(provider: ProviderProfile, modelId: string): ProviderProfileUpdate | null {
  const models = provider.models.filter((model) => model.id !== modelId);
  if (!models.length) return null;
  const update = toUpdate(provider);
  return {
    ...update,
    models,
    default_model: provider.default_model === modelId ? pickDefaultModel(models, "") : provider.default_model,
  };
}

/** `kimi`, then `kimi-2`, `kimi-3`… so a second account of one vendor keeps its own key. */
export function nextProviderId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
