import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

import { modelsOf, pickDefaultModel } from "../models/managed";
import type { ProviderProfile, ProviderSecretStatus } from "../models/types";
import { SkillPicker } from "./SkillPicker";
import { ProviderSelect } from "./ProviderSelect";

export function ExpertModal({
  mode,
  agent,
  providers,
  globalSkills,
  locale,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  agent: AgentView | null;
  providers: ProviderProfile[];
  globalSkills: string[];
  locale: Locale;
  onClose: () => void;
  onSave: (data: {
    name: string;
    nickname: string;
    role: string;
    provider_profile: string;
    model: string;
    system_prompt: string;
    allowed_global_skills: string[];
    disabled_global_skills: string[];
    priority: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [nickname, setNickname] = useState(agent?.nickname ?? "");
  const [providerProfile, setProviderProfile] = useState(
    agent?.provider_profile ?? (providers[0]?.provider_id ?? "")
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? "");
  const [role, setRole] = useState(agent?.role ?? "expert");
  const [allowedSkills, setAllowedSkills] = useState<string[]>(agent?.allowed_global_skills ?? []);
  const [disabledSkills, setDisabledSkills] = useState<string[]>(agent?.disabled_global_skills ?? []);
  const [priority, setPriority] = useState(agent?.priority ?? 50);
  const [saving, setSaving] = useState(false);
  const copy = t(locale).ui;

  const isSystem =
    (agent?.name === "summarizer-main" || agent?.name === "synthesizer-main");

  const selectedProvider = providers.find((p) => p.provider_id === providerProfile);
  const providerModels = selectedProvider ? modelsOf(selectedProvider).filter((entry) => entry.enabled) : [];
  // Keep a saved-but-now-disabled model visible instead of silently rewriting the expert.
  const modelOptions =
    model && !providerModels.some((entry) => entry.id === model) ? [{ id: model, label: model }, ...providerModels] : providerModels;

  useEffect(() => {
    if (selectedProvider && !model) {
      setModel(pickDefaultModel(modelsOf(selectedProvider), selectedProvider.default_model));
    }
  }, [providerProfile, selectedProvider, model]);

  function handleProviderChange(nextProviderId: string) {
    const nextProvider = providers.find((provider) => provider.provider_id === nextProviderId);
    const currentDefault = selectedProvider?.default_model ?? "";
    setProviderProfile(nextProviderId);
    if (!model || model === currentDefault) {
      setModel(nextProvider ? pickDefaultModel(modelsOf(nextProvider), nextProvider.default_model) : "");
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        nickname: nickname.trim(),
        role,
        provider_profile: providerProfile,
        model: model.trim() || selectedProvider?.default_model || "",
        system_prompt: systemPrompt,
        allowed_global_skills: allowedSkills,
        disabled_global_skills: disabledSkills,
        priority,
      });
      onClose();
    } catch (error) {
      console.warn(clientErrorMessage(error, copy.expertSaveFailed));
    } finally {
      setSaving(false);
    }
  }

  const isValidName = /^[a-z][a-z0-9-]*$/.test(name);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="expert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {mode === "create" ? copy.addExpert : copy.editExpert}
        </div>
        <div className="modal-form-grid">
          {/* name */}
          <label className="settings-field">
            <span className="settings-label">
              {mode === "edit" ? copy.expertNameReadonly : copy.expertName}
            </span>
            <input
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode === "edit"}
              placeholder={copy.expertNamePlaceholder}
            />
            {name && !isValidName ? (
              <span className="settings-error">
                {copy.invalidExpertName}
              </span>
            ) : null}
          </label>

          {/* nickname */}
          <label className="settings-field">
            <span className="settings-label">{copy.nickname}</span>
            <input
              className="settings-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={copy.displayName}
            />
          </label>

          {/* provider_profile */}
          <label className="settings-field">
            <span className="settings-label">{copy.modelProvider}</span>
            <ProviderSelect
              providers={providers}
              value={providerProfile}
              locale={locale}
              onChange={handleProviderChange}
            />
          </label>

          {/* model */}
          <label className="settings-field">
            <span className="settings-label">{copy.model}</span>
            {providerModels.length ? (
              <select
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label || entry.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={selectedProvider?.default_model ?? "model id"}
              />
            )}
          </label>

          {/* system_prompt */}
          <label className="settings-field">
            <span className="settings-label">{copy.systemPrompt}</span>
            <textarea
              className="settings-input"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder={copy.systemPromptPlaceholder}
            />
          </label>

          {/* role */}
          <div className="settings-field">
            <span className="settings-label">{copy.role}</span>
            <div className="role-segmented" role="radiogroup" aria-label={copy.role}>
              {AGENT_ROLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={cn("role-segment", role === option.id && "role-segment-active")}
                  type="button"
                  role="radio"
                  aria-checked={role === option.id}
                  disabled={isSystem}
                  onClick={() => setRole(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {isSystem ? (
              <p className="mt-1 text-xs text-muted">{copy.systemRoleLocked}</p>
            ) : null}
          </div>

          <div className="settings-field">
            <span className="settings-label">{copy.allowedGlobalSkills}</span>
            <SkillPicker
              skills={globalSkills}
              value={allowedSkills}
              emptyText={copy.noGlobalSkills}
              onChange={(next) => {
                setAllowedSkills(next);
                setDisabledSkills((current) => current.filter((skill) => !next.includes(skill)));
              }}
            />
          </div>

          <div className="settings-field">
            <span className="settings-label">{copy.disabledGlobalSkills}</span>
            <SkillPicker
              skills={globalSkills}
              value={disabledSkills}
              emptyText={copy.noDisabledSkills}
              onChange={(next) => {
                setDisabledSkills(next);
                setAllowedSkills((current) => current.filter((skill) => !next.includes(skill)));
              }}
            />
          </div>

          {/* priority */}
          <label className="settings-field">
            <span className="settings-label">{copy.priorityRange}</span>
            <input
              className="settings-input"
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) =>
                setPriority(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
              }
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="small-button" onClick={onClose}>
            {copy.cancel}
          </button>
          <button
            className="small-button-primary"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || !isValidName}
          >
            {saving ? copy.saving : mode === "create" ? copy.create : copy.save}
          </button>
        </div>
      </div>
    </div>
  );
}
