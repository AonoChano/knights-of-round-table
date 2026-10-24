import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

import { ProfileIcon } from "../models/ProviderIcon";
import type { ProviderProfile, ProviderSecretStatus } from "../models/types";

export function ProviderSelect({
  providers,
  value,
  disabled,
  locale,
  onChange,
}: {
  providers: ProviderProfile[];
  value: string;
  disabled?: boolean;
  locale: Locale;
  onChange: (providerId: string) => void;
}) {
  const copy = t(locale).ui;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const selectedProvider = enabledProviders.find((provider) => provider.provider_id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProviders = normalizedQuery
    ? enabledProviders.filter((provider) =>
        `${provider.label} ${provider.provider_id} ${provider.provider_type}`
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : enabledProviders;

  function chooseProvider(providerId: string) {
    onChange(providerId);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="provider-select">
      <button
        className={cn("provider-select-trigger", open && "provider-select-trigger-open")}
        type="button"
        disabled={disabled || enabledProviders.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedProvider ? (
          <ProfileIcon provider={selectedProvider} size={30} className="provider-select-icon" />
        ) : (
          <span className="provider-select-icon" aria-hidden="true" />
        )}
        <span className="provider-select-current">
          <span className="provider-select-name">
            {selectedProvider?.label ?? copy.noProvider}
          </span>
          <span className="provider-select-id">
            {selectedProvider ? selectedProvider.provider_id : copy.selectProviderFirst}
          </span>
        </span>
        <ChevronDown className="provider-select-chevron" size={16} aria-hidden="true" />
      </button>

      {open ? (
        <div className="provider-select-popover">
          <label className="provider-select-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchProviders}
              autoFocus
            />
          </label>
          <div className="provider-select-list">
            {visibleProviders.map((provider) => (
              <button
                key={provider.provider_id}
                className={cn(
                  "provider-select-option",
                  provider.provider_id === value && "provider-select-option-active"
                )}
                type="button"
                onClick={() => chooseProvider(provider.provider_id)}
              >
                <ProfileIcon provider={provider} size={30} className="provider-select-icon" />
                <span className="provider-select-option-text">
                  <span className="provider-select-name">{provider.label}</span>
                  <span className="provider-select-id">{provider.provider_id}</span>
                </span>
                {provider.provider_id === value ? (
                  <Check className="provider-select-check" size={15} aria-hidden="true" />
                ) : null}
              </button>
            ))}
            {visibleProviders.length === 0 ? (
              <div className="provider-select-empty">{copy.noMatchingProviders}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
