import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

import { ModelList } from "../models/ModelList";
import { API_BASE } from "../models/api";
import { AgentGlyph } from "../agents/AgentGlyph";
import { MemoryPanel } from "../memory/MemoryPanel";
import type { ProviderProfile, ProviderSecretStatus } from "../models/types";

export function SettingsOverlay({
  agents,
  agentsError,
  agentsLoading,
  globalSkills,
  providers,
  providersLoading,
  secretStatus,
  settingsTab,
  locale,
  developerMode,
  logLevel,
  developerStatus,
  developerDiagnostics,
  setLocale,
  setDeveloperMode,
  setLogLevel,
  setSettingsOpen,
  setSettingsTab,
  onModelsChanged,
  refreshDeveloperDiagnostics,
  onAddExpert,
  onEditExpert,
  onDeleteExpert,
}: {
  agents: AgentView[];
  agentsError: string | null;
  agentsLoading: boolean;
  globalSkills: string[];
  providers: ProviderProfile[];
  providersLoading: boolean;
  secretStatus: Record<string, ProviderSecretStatus>;
  settingsTab: SettingsTab;
  locale: Locale;
  developerMode: boolean;
  logLevel: LogLevel;
  developerStatus: string | null;
  developerDiagnostics: DeveloperDiagnostics | null;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setDeveloperMode: Dispatch<SetStateAction<boolean>>;
  setLogLevel: Dispatch<SetStateAction<LogLevel>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  onModelsChanged: () => Promise<void>;
  refreshDeveloperDiagnostics: () => void;
  onAddExpert: () => void;
  onEditExpert: (agent: AgentView) => void;
  onDeleteExpert: (name: string) => void;
}) {
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const copy = t(locale).ui;
  const skillCountLabel = copy.globalSkillsCount(globalSkills.length);
  const logLevelOptions: Array<{ id: LogLevel; label: string; description: string }> = [
    { id: "error", label: copy.logLevelError, description: copy.logLevelErrorDescription },
    { id: "info", label: copy.logLevelInfo, description: copy.logLevelInfoDescription },
    { id: "debug", label: copy.logLevelDebug, description: copy.logLevelDebugDescription },
  ];
  return (
    <div className="settings-backdrop">
      <div className="settings-shell" role="dialog" aria-modal="true" aria-label={t(locale).ui.settings}>
      <div className="settings-nav">
        <div className="settings-nav-title">
          <Settings size={16} aria-hidden="true" />
          <span>{t(locale).ui.settings}</span>
        </div>
        {settingsTabs(locale).map((tab) => {
          const TabIcon = settingsTabIcons[tab.id];
          return (
            <button
              key={tab.id}
              className={cn("settings-tab", settingsTab === tab.id && "settings-tab-active")}
              onClick={() => setSettingsTab(tab.id)}
            >
              <TabIcon className="settings-tab-icon" size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="settings-content">
        <div className="settings-header">
          <div>
            <div className="text-xl font-medium">{settingsTitle(settingsTab, locale)}</div>
            <div className="mt-1 max-w-[640px] text-sm leading-6 text-muted">{settingsSubtitle(settingsTab, locale)}</div>
          </div>
          <button
            className="icon-button settings-close-button"
            onClick={() => setSettingsOpen(false)}
            aria-label={copy.closeSettings}
            title={copy.close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-mobile-tabs">
          {settingsTabs(locale).map((tab) => {
            const TabIcon = settingsTabIcons[tab.id];
            return (
              <button
                key={tab.id}
                className={cn("settings-mobile-tab", settingsTab === tab.id && "settings-mobile-tab-active")}
                onClick={() => setSettingsTab(tab.id)}
              >
                <TabIcon size={15} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {settingsTab === "providers" ? (
          <ModelList
            providers={providers}
            loading={providersLoading}
            secretStatus={secretStatus}
            locale={locale}
            onChanged={onModelsChanged}
          />
        ) : null}

        {settingsTab === "experts" ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted">{skillCountLabel}</div>
              <button
                className="small-button-primary small-button-icon"
                onClick={onAddExpert}
              >
                <UserPlus size={14} aria-hidden="true" />
                <span>{copy.addExpert}</span>
              </button>
            </div>
            {agentsLoading && agents.length === 0 ? (
              <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
                {[0, 1, 2, 3].map((index) => (
                  <section className="settings-card settings-card-skeleton" key={index}>
                    <div className="skeleton skeleton-line" style={{ width: "42%" }} />
                    <div className="skeleton skeleton-line skeleton-line-faint" style={{ width: "26%" }} />
                    <div className="skeleton skeleton-line skeleton-line-faint" style={{ width: "72%" }} />
                    <div className="skeleton skeleton-line skeleton-line-faint" style={{ width: "58%" }} />
                  </section>
                ))}
              </div>
            ) : agents.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {agents.map((agent) => {
                  const isSystem =
                    agent.name === "summarizer-main" || agent.name === "synthesizer-main";
                  return (
                    <section key={agent.name} className="settings-card">
                      <div className="flex items-center gap-2">
                        <AgentGlyph agent={agent.name} size={16} />
                        <div className="font-medium">{agent.nickname}</div>
                        {isSystem ? (
                          <span className="rounded border border-line bg-gray-50 px-1.5 py-0.5 text-[11px] text-muted">[{copy.system}]</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">{agent.name}</div>
                      <div className="mt-4 grid gap-2 text-sm text-muted">
                        <div>{copy.role}: {agent.role}</div>
                        <div>{copy.provider}: {agent.provider_profile}</div>
                        <div>{copy.priority}: {agent.priority}</div>
                        <div>Skills: {agent.allowed_global_skills.join(", ") || copy.noSkillsConfigured}</div>
                        <div>{copy.disabled}: {agent.disabled_global_skills.join(", ") || copy.none}</div>
                        <div>{copy.privateSkills}: {agent.private_skill_count}</div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button className="small-button small-button-icon" onClick={() => onEditExpert(agent)}>
                          <Pencil size={14} aria-hidden="true" />
                          <span>{copy.edit}</span>
                        </button>
                        {!isSystem ? (
                          <button
                            className="small-button small-button-danger small-button-icon"
                            onClick={() => setConfirmDeleteName(agent.name)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            <span>{copy.delete}</span>
                          </button>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <section className="settings-card text-sm leading-7 text-muted">
                {copy.noExperts}{agentsError ? `${copy.errorPrefix}${agentsError}` : ""}
              </section>
            )}
          </>
        ) : null}

        {settingsTab === "memory" ? <MemoryPanel agents={agents} locale={locale} /> : null}

        {settingsTab !== "providers" && settingsTab !== "experts" && settingsTab !== "memory" ? (
          <section className="settings-section">
            {settingsTab === "general" ? (
              <div className="settings-list">
                <div className="settings-row">
                  <div className="settings-row-title">{t(locale).ui.language}</div>
                  <div className="settings-language-options">
                    <button
                      className={cn(
                        "settings-choice",
                        locale === "zh-CN" && "settings-choice-active"
                      )}
                      onClick={() => {
                        setLocale("zh-CN");
                        saveLocale("zh-CN");
                      }}
                    >
                      简体中文
                    </button>
                    <button
                      className={cn(
                        "settings-choice",
                        locale === "en" && "settings-choice-active"
                      )}
                      onClick={() => {
                        setLocale("en");
                        saveLocale("en");
                      }}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>
            ) : settingsTab === "developer" ? (
              <div className="settings-list">
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">{copy.developerMode}</div>
                    <div className="settings-row-description">{copy.developerModeDescription}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={developerMode}
                      onChange={(event) => setDeveloperMode(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <div className="settings-row settings-row-stacked">
                  <div>
                    <div className="settings-row-title">{copy.logLevel}</div>
                    <div className="settings-row-description">{copy.logLevelDescription}</div>
                  </div>
                  <div className="settings-choice-stack">
                    {logLevelOptions.map((option) => (
                      <button
                        key={option.id}
                        className={cn("settings-log-choice", logLevel === option.id && "settings-log-choice-active")}
                        onClick={() => setLogLevel(option.id)}
                        type="button"
                      >
                        <span>{option.label}</span>
                        <small>{option.description}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row settings-row-stacked">
                  <div className="settings-row-inline">
                    <div>
                      <div className="settings-row-title">{copy.diagnostics}</div>
                      <div className="settings-row-description">{copy.diagnosticsDescription}</div>
                    </div>
                    <button className="small-button small-button-icon" type="button" onClick={refreshDeveloperDiagnostics}>
                      <FlaskConical size={14} aria-hidden="true" />
                      <span>{copy.refresh}</span>
                    </button>
                  </div>
                  <div className="developer-diagnostics">
                    <div>
                      <span>{copy.apiBaseUrl}</span>
                      <strong>{developerDiagnostics?.api_base_url || API_BASE}</strong>
                    </div>
                    <div>
                      <span>{copy.conversationStore}</span>
                      <strong>{developerDiagnostics?.conversation_store_path ?? copy.notLoaded}</strong>
                    </div>
                    <div>
                      <span>{copy.conversationCount}</span>
                      <strong>{developerDiagnostics?.conversation_count ?? copy.notLoaded}</strong>
                    </div>
                    <div>
                      <span>{copy.runningJobs}</span>
                      <strong>{developerDiagnostics ? `${developerDiagnostics.jobs_running}/${developerDiagnostics.jobs_total}` : copy.notLoaded}</strong>
                    </div>
                    <div>
                      <span>{copy.backendLogLevel}</span>
                      <strong>{developerDiagnostics?.log_level ?? logLevel.toUpperCase()}</strong>
                    </div>
                  </div>
                  {developerStatus ? <div className="settings-status-text">{developerStatus}</div> : null}
                </div>
              </div>
            ) : (
              <div className="text-sm leading-7 text-muted">{copy.dataSkeleton}</div>
            )}
          </section>
        ) : null}
      </div>
      </div>

      {confirmDeleteName ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteName(null)}>
          <div className="sidebar-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm mb-3">{copy.confirmDeleteExpert(confirmDeleteName)}</div>
            <div className="flex gap-2 justify-end">
              <button className="small-button" onClick={() => setConfirmDeleteName(null)}>{copy.cancel}</button>
              <button
                className="small-button-primary"
                onClick={() => {
                  onDeleteExpert(confirmDeleteName);
                  setConfirmDeleteName(null);
                }}
              >
                {copy.delete}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function settingsTitle(tab: SettingsTab, locale: Locale) {
  if (tab === "providers") return t(locale).ui.providers;
  if (tab === "experts") return t(locale).ui.experts;
  if (tab === "memory") return t(locale).ui.memory;
  if (tab === "skills") return t(locale).ui.skills;
  if (tab === "data") return t(locale).ui.data;
  if (tab === "developer") return t(locale).ui.developer;
  return t(locale).ui.general;
}

function settingsSubtitle(tab: SettingsTab, locale: Locale) {
  const copy = t(locale).ui;
  if (tab === "providers") return copy.settingsSubtitleProviders;
  if (tab === "experts") return copy.settingsSubtitleExperts;
  if (tab === "memory") return copy.settingsSubtitleMemory;
  if (tab === "skills") return copy.settingsSubtitleSkills;
  if (tab === "data") return copy.settingsSubtitleData;
  if (tab === "developer") return copy.settingsSubtitleDeveloper;
  return copy.settingsSubtitleGeneral;
}
