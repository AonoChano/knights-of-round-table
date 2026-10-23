import { Check, Eye, EyeOff, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Locale } from "../../app/locale";
import { t } from "../../app/locale";
import { modelsApi } from "./api";
import {
  API_STYLE_OPTIONS,
  apiStyleLabel,
  billingLabel,
  capabilityLabel,
  defaultPlan,
  findCatalogProvider,
  groupLabel,
  PROVIDER_CATALOG,
  providerDisplayName,
  type ApiStyle,
  type BillingType,
  type CatalogModel,
  type CatalogPlan,
  type CatalogProvider,
} from "./catalog";
import type { ModelsCopy } from "./copy";
import { ConfirmDialog } from "./ConfirmDialog";
import { CatalogIcon } from "./ProviderIcon";
import { catalogFor, modelsOf, nextProviderId, pickDefaultModel, toUpdate } from "./managed";
import type { ManagedModel, ProbeResponse, ProviderProfile, ProviderProfileUpdate } from "./types";

type StepId = "provider" | "type" | "models" | "key";

/** Where the endpoint's key would come from if the field is left empty. */
export type KeySource = "saved" | "env" | "none";

const STEP_LABEL_KEY: Record<StepId, "stepProvider" | "stepType" | "stepModels" | "stepKey"> = {
  provider: "stepProvider",
  type: "stepType",
  models: "stepModels",
  key: "stepKey",
};

export function AddModelDialog({
  mode,
  provider,
  takenIds,
  keySource,
  envKeyName,
  locale,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  provider: ProviderProfile | null;
  takenIds: string[];
  keySource: KeySource;
  envKeyName: string;
  locale: Locale;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const copy = t(locale).models;
  const editing = mode === "edit" && provider ? provider : null;
  const initialCatalog = editing ? catalogFor(editing) : undefined;
  const initialPlan = editing && initialCatalog ? planOf(editing, initialCatalog) : defaultPlan(PROVIDER_CATALOG[0]);

  const savedIds = editing ? modelsOf(editing).map((model) => model.id) : [];
  const curatedIds = new Set((initialPlan?.models ?? []).map((model) => model.id));

  const [catalogId, setCatalogId] = useState(initialCatalog?.id ?? PROVIDER_CATALOG[0].id);
  const [planId, setPlanId] = useState(initialPlan?.id ?? "");
  const [name, setName] = useState(() =>
    editing ? editing.label : initialCatalog ? providerDisplayName(initialCatalog, locale) : ""
  );
  const [apiStyle, setApiStyle] = useState<ApiStyle>(editing?.api_style ?? initialPlan?.apiStyle ?? "openai");
  const [baseUrl, setBaseUrl] = useState(editing?.base_url ?? initialPlan?.baseUrl ?? "");
  const [selected, setSelected] = useState<string[]>(() =>
    editing ? savedIds.filter((id) => curatedIds.has(id)) : (initialPlan?.models.map((model) => model.id) ?? [])
  );
  // 目录里没有的模型（含自定义接口）走可增删的手填行，编辑时把已存的额外模型也放进来。
  const [manualModels, setManualModels] = useState<string[]>(() => {
    if (editing) return [...savedIds.filter((id) => !curatedIds.has(id)), ""];
    return initialPlan && initialPlan.models.length ? [] : [""];
  });
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [query, setQuery] = useState("");
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const catalog = findCatalogProvider(catalogId);
  const isCustom = catalog?.group === "custom";
  const plan = catalog && !isCustom ? findPlanById(catalog, planId) : undefined;
  const stepModels: CatalogModel[] = plan?.models ?? [];
  // Model discovery needs the key, so when there is no list to pick from, ask for the key first.
  const steps: StepId[] = stepModels.length ? ["provider", "type", "models", "key"] : ["provider", "type", "key", "models"];

  const [stepIndex, setStepIndex] = useState(() => (editing ? steps.indexOf("models") : 0));
  const [stepDir, setStepDir] = useState<"forward" | "back">("forward");
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLastStep = stepIndex >= steps.length - 1;

  const chosenModels = collectModels(catalog, plan, selected, manualModels, editing ? modelsOf(editing) : []);
  const modelIds = chosenModels.map((model) => model.id);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dirty, busy]);

  function touch() {
    setDirty(true);
    setStatus(null);
  }

  function requestClose() {
    if (dirty && !busy) {
      setAskDiscard(true);
      return;
    }
    onClose();
  }

  function chooseProvider(next: CatalogProvider) {
    const nextPlan = defaultPlan(next);
    // 用户没改过配置名时，让它跟着新供应商走
    if (!name.trim() || (catalog && name === providerDisplayName(catalog, locale))) {
      setName(providerDisplayName(next, locale));
    }
    setCatalogId(next.id);
    setPlanId(next.id === "custom" ? "" : nextPlan.id);
    setApiStyle(nextPlan.apiStyle);
    setBaseUrl(nextPlan.baseUrl);
    setSelected(nextPlan.models.map((model) => model.id));
    setManualModels(next.id === "custom" ? [""] : []);
    setDiscovered([]);
    touch();
  }

  function choosePlan(next: CatalogPlan) {
    setPlanId(next.id);
    setApiStyle(next.apiStyle);
    setBaseUrl(next.baseUrl);
    setSelected(next.models.map((model) => model.id));
    setManualModels([]);
    setDiscovered([]);
    touch();
  }

  function toggleModel(modelId: string) {
    setSelected((current) =>
      current.includes(modelId) ? current.filter((item) => item !== modelId) : [...current, modelId]
    );
    touch();
  }

  function stepErrorAt(id: StepId): string | null {
    if (id === "provider" && !catalog) return copy.noProviderMatch;
    if (id === "type") {
      if (!baseUrl.trim()) return copy.needBaseUrl;
      if (!isCustom && !plan) return copy.selectType;
      return null;
    }
    if (id === "models" && !modelIds.length) return copy.needModels;
    if (id === "key" && keySource === "none" && !apiKey.trim() && catalog?.providerType !== "ollama") {
      return copy.needKey;
    }
    return null;
  }

  function currentStepError(): string | null {
    return stepErrorAt(step);
  }

  function goToStep(target: number) {
    if (busy || target === stepIndex) return;
    if (target < 0 || target >= steps.length) return;
    // 往后跳必须把中间的步骤逐一校验过，往回跳不设门槛。
    for (let index = stepIndex; index < target; index += 1) {
      const error = stepErrorAt(steps[index]);
      if (error) {
        setStatus(error);
        return;
      }
    }
    setStepDir(target < stepIndex ? "back" : "forward");
    setStepIndex(target);
    setStatus(null);
  }

  function nextStep() {
    const error = currentStepError();
    if (error) {
      setStatus(error);
      return;
    }
    goToStep(stepIndex + 1);
  }

  function previousStep() {
    goToStep(stepIndex - 1);
  }

  async function fetchModelList() {
    setBusy(true);
    try {
      const probe = await modelsApi.probe({
        base_url: baseUrl.trim(),
        api_style: apiStyle,
        provider_type: catalog?.providerType ?? "custom",
        api_key: apiKey.trim() || undefined,
        provider_id: editing?.provider_id,
        env_key_name: catalog?.envKeyName ?? editing?.env_key_name ?? "CUSTOM_API_KEY",
        models: [],
      });
      if (probe.discovered_models.length) {
        setDiscovered(probe.discovered_models);
        setManualModels((current) => mergeIds(current, probe.discovered_models));
        setStatus(copy.fetchedCount(probe.discovered_models.length));
        return;
      }
      setStatus(describeProbe(copy, probe));
    } catch (error) {
      setStatus(errorMessage(error, copy.failed));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const error = currentStepError() ?? (!modelIds.length ? copy.needModels : null);
    if (error) {
      setStatus(error);
      return;
    }
    setBusy(true);
    setStatus(null);

    try {
      const probe = await modelsApi.probe({
        base_url: baseUrl.trim(),
        api_style: apiStyle,
        provider_type: catalog?.providerType ?? editing?.provider_type ?? "custom",
        api_key: apiKey.trim() || undefined,
        provider_id: editing?.provider_id,
        env_key_name: catalog?.envKeyName ?? editing?.env_key_name ?? "CUSTOM_API_KEY",
        models: modelIds,
      });
      if (!probe.ok) {
        setStatus(copy.probeFailed(describeProbe(copy, probe)));
        return;
      }

      const providerId = editing ? editing.provider_id : nextProviderId(catalog?.id ?? "custom", takenIds);
      const update = buildUpdate({
        editing,
        catalog,
        plan,
        locale,
        name,
        baseUrl: baseUrl.trim(),
        apiStyle,
        models: chosenModels,
      });

      if (editing) {
        await modelsApi.update(providerId, update);
      } else {
        await modelsApi.create(providerId, update);
      }
      if (apiKey.trim()) {
        await modelsApi.saveKey(providerId, apiKey.trim());
      }
      await onDone(editing ? copy.savedToast : copy.addedToast(modelIds.length));
    } catch (caught) {
      setStatus(errorMessage(caught, copy.failed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="model-dialog-backdrop" onClick={requestClose}>
      <div
        className="model-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? copy.editTitle : copy.addTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="model-dialog-head">
          <div className="model-dialog-title">{editing ? copy.editTitle : copy.addTitle}</div>
          <ol className="model-steps">
            {steps.map((item, index) => {
              const state = index === stepIndex ? "active" : index < stepIndex ? "done" : "future";
              return (
                <li key={item} className={`model-step model-step-${state}`}>
                  <button
                    type="button"
                    className="model-step-button"
                    aria-current={state === "active" ? "step" : undefined}
                    title={state === "future" ? copy.stepJump : undefined}
                    disabled={busy}
                    onClick={() => goToStep(index)}
                  >
                    <span className="model-step-dot" aria-hidden="true">
                      {state === "done" ? <Check size={11} /> : index + 1}
                    </span>
                    <span>{copy[STEP_LABEL_KEY[item]]}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className="icon-button model-dialog-close" aria-label={copy.close} onClick={requestClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="model-dialog-body">
          {editing ? <p className="model-dialog-note">{copy.lockedNote}</p> : null}

          <div className={`model-step-pane model-step-pane-${stepDir}`} key={step}>
            {step === "provider" ? (
              <ProviderPicker
                copy={copy}
                locale={locale}
                query={query}
                currentId={catalogId}
                disabled={Boolean(editing)}
                onQuery={(value) => {
                  setQuery(value);
                  touch();
                }}
                onPick={chooseProvider}
              />
            ) : null}

            {step === "type" && catalog ? (
              <ProviderTypeStep
                copy={copy}
                locale={locale}
                catalog={catalog}
                plan={plan}
                name={name}
                apiStyle={apiStyle}
                baseUrl={baseUrl}
                disabled={Boolean(editing)}
                onName={(value) => {
                  setName(value);
                  touch();
                }}
                onPickPlan={choosePlan}
                onApiStyle={(value) => {
                  setApiStyle(value);
                  touch();
                }}
                onBaseUrl={(value) => {
                  setBaseUrl(value);
                  touch();
                }}
              />
            ) : null}

            {step === "models" ? (
              <ModelsStep
                copy={copy}
                locale={locale}
                models={stepModels}
                selected={selected}
                manualModels={manualModels}
                discovered={discovered}
                busy={busy}
                onToggle={toggleModel}
                onSelectAll={() => {
                  setSelected(stepModels.map((model) => model.id));
                  touch();
                }}
                onClear={() => {
                  setSelected([]);
                  touch();
                }}
                onManualChange={(values) => {
                  setManualModels(values);
                  touch();
                }}
                onManualAdd={() => {
                  setManualModels((current) => [...current, ""]);
                  touch();
                }}
                onManualRemove={(index) => {
                  setManualModels((current) => current.filter((_, position) => position !== index));
                  touch();
                }}
                onFetch={() => void fetchModelList()}
              />
            ) : null}

            {step === "key" ? (
              <KeyStep
                copy={copy}
                apiKey={apiKey}
                showKey={showKey}
                keySource={keySource}
                envKeyName={catalog?.envKeyName ?? envKeyName}
                requiresKey={catalog?.providerType !== "ollama"}
                consoleUrl={catalog?.consoleUrl ?? ""}
                docsUrl={catalog?.docsUrl ?? ""}
                onApiKey={(value) => {
                  setApiKey(value);
                  touch();
                }}
                onToggleVisibility={() => setShowKey((current) => !current)}
              />
            ) : null}
          </div>

          {status ? (
            <p className="model-dialog-status" role="status">
              {status}
            </p>
          ) : null}
        </div>

        <footer className="model-dialog-foot">
          <button type="button" className="small-button" onClick={requestClose} disabled={busy}>
            {copy.cancel}
          </button>
          <div className="model-dialog-foot-actions">
            {stepIndex > 0 ? (
              <button
                type="button"
                className="small-button"
                disabled={busy}
                onClick={previousStep}
              >
                {copy.back}
              </button>
            ) : null}
            {isLastStep ? (
              <button type="button" className="small-button-primary small-button-icon" onClick={() => void submit()} disabled={busy}>
                {busy ? (
                  <Loader2 size={14} className="model-spin" aria-hidden="true" />
                ) : (
                  <Check size={14} aria-hidden="true" />
                )}
                <span>{busy ? copy.validating : editing ? copy.validateAndSave : copy.validateAndAdd}</span>
              </button>
            ) : (
              <button type="button" className="small-button-primary small-button-icon" onClick={nextStep} disabled={busy}>
                <span>{copy.next}</span>
              </button>
            )}
          </div>
        </footer>
      </div>

      {askDiscard ? (
        <ConfirmDialog
          title={copy.discardTitle}
          body={copy.discardBody}
          confirmLabel={copy.discardConfirm}
          cancelLabel={copy.discardKeep}
          onConfirm={onClose}
          onCancel={() => setAskDiscard(false)}
        />
      ) : null}
    </div>
  );
}

function ProviderPicker({
  copy,
  locale,
  query,
  currentId,
  disabled,
  onQuery,
  onPick,
}: {
  copy: ModelsCopy;
  locale: Locale;
  query: string;
  currentId: string;
  disabled: boolean;
  onQuery: (value: string) => void;
  onPick: (provider: CatalogProvider) => void;
}) {
  const needle = query.trim().toLowerCase();
  const suggestions = needle
    ? PROVIDER_CATALOG.filter((provider) => searchKey(provider).includes(needle)).slice(0, 8)
    : [];
  const groups = (["recommended", "more", "custom"] as const)
    .map((group) => ({
      group,
      providers: PROVIDER_CATALOG.filter((provider) => provider.group === group),
    }))
    .filter((entry) => entry.providers.length);

  return (
    <div className="model-provider-picker">
      <div className="model-search-box">
        <Search size={15} aria-hidden="true" className="model-search-icon" />
        <input
          className="settings-input model-search"
          value={query}
          placeholder={copy.searchProvider}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-label={copy.searchProvider}
          onChange={(event) => onQuery(event.target.value)}
          disabled={disabled}
        />
        {needle && suggestions.length === 0 ? (
          <p className="model-field-hint">{copy.noProviderMatch}</p>
        ) : null}
        {suggestions.length ? (
          <ul className="model-search-suggestions" role="listbox" aria-label={copy.searchSuggestions}>
            {suggestions.map((provider) => (
              <li key={provider.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={provider.id === currentId}
                  className="model-search-suggestion"
                  onClick={() => onPick(provider)}
                  disabled={disabled}
                >
                  <CatalogIcon provider={provider} size={20} />
                  <span>{providerDisplayName(provider, locale)}</span>
                  <span className="model-search-suggestion-group">{groupLabel(provider.group, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {needle ? null : (
        <div className="model-provider-groups">
          {groups.map(({ group, providers }) => (
            <section key={group} className="model-provider-group">
              <div className="model-provider-group-title">{groupLabel(group, locale)}</div>
              <div className="model-provider-grid">
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={`model-provider-card${provider.id === currentId ? " model-provider-card-active" : ""}`}
                    onClick={() => onPick(provider)}
                    disabled={disabled}
                  >
                    <CatalogIcon provider={provider} size={26} />
                    <span>{providerDisplayName(provider, locale)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderTypeStep({
  copy,
  locale,
  catalog,
  plan,
  name,
  apiStyle,
  baseUrl,
  disabled,
  onName,
  onPickPlan,
  onApiStyle,
  onBaseUrl,
}: {
  copy: ModelsCopy;
  locale: Locale;
  catalog: CatalogProvider;
  plan: CatalogPlan | undefined;
  name: string;
  apiStyle: ApiStyle;
  baseUrl: string;
  disabled: boolean;
  onName: (value: string) => void;
  onPickPlan: (plan: CatalogPlan) => void;
  onApiStyle: (value: ApiStyle) => void;
  onBaseUrl: (value: string) => void;
}) {
  const nameField = (
    <label className="model-field">
      <span className="model-field-label">{copy.configName}</span>
      <input
        className="settings-input"
        value={name}
        placeholder={copy.configNamePlaceholder}
        disabled={disabled}
        onChange={(event) => onName(event.target.value)}
      />
      <span className="model-field-hint">{copy.configNameHint}</span>
    </label>
  );

  if (catalog.group === "custom") {
    return (
      <section className="model-field-grid">
        {nameField}
        <label className="model-field">
          <span className="model-field-label">{copy.apiStyle}</span>
          <select
            className="settings-input"
            value={apiStyle}
            disabled={disabled}
            onChange={(event) => onApiStyle(event.target.value as ApiStyle)}
          >
            {API_STYLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="model-field">
          <span className="model-field-label">{copy.baseUrl}</span>
          <input
            className="settings-input"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => onBaseUrl(event.target.value)}
          />
        </label>
      </section>
    );
  }

  return (
    <div className="model-type-step">
      {nameField}
      <div className="model-plan-list">
        <p className="model-field-hint">{copy.typeNote}</p>
        {catalog.plans.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`model-plan-card${entry.id === plan?.id ? " model-plan-card-active" : ""}`}
            onClick={() => onPickPlan(entry)}
            disabled={disabled}
          >
            <span className="model-plan-card-title">
              {billingLabel(entry.billing, locale)} · {apiStyleLabel(entry.apiStyle)}
            </span>
            <span className="model-plan-card-url">{entry.baseUrl}</span>
            {entry.hint ? (
              <span className="model-plan-card-hint">{entry.hint[locale === "zh-CN" ? "zh" : "en"]}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelsStep({
  copy,
  locale,
  models,
  selected,
  manualModels,
  discovered,
  busy,
  onToggle,
  onSelectAll,
  onClear,
  onManualChange,
  onManualAdd,
  onManualRemove,
  onFetch,
}: {
  copy: ModelsCopy;
  locale: Locale;
  models: CatalogModel[];
  selected: string[];
  manualModels: string[];
  discovered: string[];
  busy: boolean;
  onToggle: (modelId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onManualChange: (values: string[]) => void;
  onManualAdd: () => void;
  onManualRemove: (index: number) => void;
  onFetch: () => void;
}) {
  return (
    <div className="model-models-step">
      {models.length ? (
        <div className="model-check-list">
          <div className="model-check-tools">
            <span className="model-check-count">{copy.selectedCount(selected.length)}</span>
            <button type="button" className="model-link-button" onClick={onSelectAll}>
              {copy.selectAll}
            </button>
            <button type="button" className="model-link-button" onClick={onClear}>
              {copy.clearSelection}
            </button>
          </div>
          {models.map((model) => (
            <label key={model.id} className={`model-check${selected.includes(model.id) ? " model-check-on" : ""}`}>
              <input type="checkbox" checked={selected.includes(model.id)} onChange={() => onToggle(model.id)} />
              <span className="model-check-name">{model.label}</span>
              <span className="model-check-id">{model.id}</span>
              <span className="model-check-caps">
                {model.capabilities.map((capability) => (
                  <span key={capability} className="model-cap-chip">
                    {capabilityLabel(capability, locale)}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <section className="model-manual-ids">
        <div className="model-field-label-row">
          <span className="model-field-label">{copy.modelIds}</span>
          <button type="button" className="small-button small-button-icon" onClick={onManualAdd}>
            <Plus size={14} aria-hidden="true" />
            <span>{copy.addModelId}</span>
          </button>
        </div>
        {manualModels.length === 0 ? (
          <p className="model-field-hint">{copy.modelIdsHint}</p>
        ) : (
          manualModels.map((value, index) => (
            <div className="model-id-row" key={`model-id-${index}`}>
              <input
                className="settings-input"
                value={value}
                placeholder={copy.modelIdPlaceholder}
                spellCheck={false}
                onChange={(event) =>
                  onManualChange(manualModels.map((item, position) => (position === index ? event.target.value : item)))
                }
              />
              <button
                type="button"
                className="icon-button model-id-remove"
                aria-label={copy.removeModelId}
                onClick={() => onManualRemove(index)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
        {discovered.length ? <p className="model-field-hint">{copy.fetchedCount(discovered.length)}</p> : null}
        <div className="model-fetch-row">
          <button type="button" className="small-button small-button-icon" onClick={onFetch} disabled={busy}>
            {busy ? (
              <Loader2 size={14} className="model-spin" aria-hidden="true" />
            ) : (
              <Search size={14} aria-hidden="true" />
            )}
            <span>{copy.fetchList}</span>
          </button>
          <span className="model-fetch-hint">{copy.fetchListHint}</span>
        </div>
      </section>
    </div>
  );
}

function KeyStep({
  copy,
  apiKey,
  showKey,
  keySource,
  envKeyName,
  requiresKey,
  consoleUrl,
  docsUrl,
  onApiKey,
  onToggleVisibility,
}: {
  copy: ModelsCopy;
  apiKey: string;
  showKey: boolean;
  keySource: KeySource;
  envKeyName: string;
  requiresKey: boolean;
  consoleUrl: string;
  docsUrl: string;
  onApiKey: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  return (
    <section className="model-field-grid">
      <label className="model-field">
        <span className="model-field-label">{copy.apiKey}</span>
        <span className="model-key-row">
          <input
            className="settings-input"
            type={showKey ? "text" : "password"}
            value={apiKey}
            placeholder={keyPlaceholder(copy, keySource, envKeyName, requiresKey)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onApiKey(event.target.value)}
          />
          <button
            type="button"
            className="icon-button model-key-toggle"
            aria-label={showKey ? copy.hideKey : copy.showKey}
            onClick={onToggleVisibility}
          >
            {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </span>
      </label>
      <div className="model-link-row">
        {consoleUrl ? (
          <a className="model-docs-link" href={consoleUrl} target="_blank" rel="noreferrer">
            {copy.getApiKey}
          </a>
        ) : null}
        {docsUrl ? (
          <a className="model-docs-link" href={docsUrl} target="_blank" rel="noreferrer">
            {copy.docs}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function describeProbe(copy: ModelsCopy, probe: ProbeResponse): string {
  const label = copy.probeStatus[probe.status];
  if (probe.missing_models.length) {
    return `${label} · ${copy.probeMissingModels(probe.missing_models.join("、"))}`;
  }
  return probe.message ? `${label} · ${probe.message}` : label;
}

function findPlanById(catalog: CatalogProvider, planId: string): CatalogPlan | undefined {
  return catalog.plans.find((entry) => entry.id === planId);
}

function planOf(profile: ProviderProfile, catalog: CatalogProvider): CatalogPlan | undefined {
  return (
    catalog.plans.find((entry) => entry.baseUrl === profile.base_url && entry.apiStyle === profile.api_style) ??
    catalog.plans.find((entry) => entry.billing === profile.billing_type && entry.apiStyle === profile.api_style)
  );
}

function searchKey(provider: CatalogProvider): string {
  return `${provider.id} ${provider.name.zh} ${provider.name.en}`.toLowerCase();
}

function collectModels(
  catalog: CatalogProvider | undefined,
  plan: CatalogPlan | undefined,
  selected: string[],
  manual: string[],
  saved: ManagedModel[]
): ManagedModel[] {
  const curated = (plan?.models ?? []).filter((model) => selected.includes(model.id));
  const lookup = new Map<string, CatalogModel>();
  catalog?.plans.forEach((entry) => entry.models.forEach((model) => lookup.set(model.id, model)));
  // 编辑时已存的行要保留停用状态和自定义别名
  const stored = new Map(saved.map((model) => [model.id, model]));

  const manualIds = manual.map((id) => id.trim()).filter((id) => id && !curated.some((model) => model.id === id));
  const extras: ManagedModel[] = manualIds.map((id) => {
    const previous = stored.get(id);
    const known = lookup.get(id);
    return {
      id,
      label: previous?.label || known?.label || id,
      enabled: previous ? previous.enabled : true,
      capabilities: previous?.capabilities ?? (known ? [...known.capabilities] : ["chat"]),
    };
  });

  return [
    ...curated.map((model) => {
      const previous = stored.get(model.id);
      return {
        id: model.id,
        label: previous?.label || model.label,
        enabled: previous ? previous.enabled : true,
        capabilities: previous?.capabilities ?? [...model.capabilities],
      };
    }),
    ...extras,
  ];
}

function buildUpdate(input: {
  editing: ProviderProfile | null;
  catalog: CatalogProvider | undefined;
  plan: CatalogPlan | undefined;
  locale: Locale;
  name: string;
  baseUrl: string;
  apiStyle: ApiStyle;
  models: ManagedModel[];
}): ProviderProfileUpdate {
  const { editing, catalog, plan, locale, name, baseUrl, apiStyle, models } = input;

  if (editing) {
    return {
      ...toUpdate(editing),
      base_url: baseUrl,
      api_style: apiStyle,
      default_model: pickDefaultModel(models, editing.default_model),
      models,
    };
  }

  return {
    label: name.trim() || (catalog ? providerDisplayName(catalog, locale) : hostOf(baseUrl)),
    provider_type: catalog?.providerType ?? "custom",
    base_url: baseUrl,
    api_style: apiStyle,
    default_model: pickDefaultModel(models, ""),
    env_key_name: catalog?.envKeyName ?? "CUSTOM_API_KEY",
    enabled: true,
    capabilities: ["chat"],
    catalog_id: catalog?.id ?? "",
    billing_type: plan?.billing ?? ("custom" as BillingType),
    models,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function mergeIds(current: string[], found: string[]): string[] {
  const seen = new Set(current.map((item) => item.trim()).filter(Boolean));
  return [...current.filter((item) => item.trim()), ...found.filter((id) => !seen.has(id))];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback;
}

function keyPlaceholder(copy: ModelsCopy, keySource: KeySource, envKeyName: string, requiresKey: boolean): string {
  if (keySource === "saved") return copy.keyKeepExisting;
  if (keySource === "env") return copy.keyKeepEnv(envKeyName);
  return requiresKey ? copy.keyRequired : copy.keyOptionalLocal;
}
