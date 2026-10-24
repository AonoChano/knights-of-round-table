import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";
import { delegationTooltip } from "../../app/page-utils";

import { AgentStrip } from "../discussion/AgentStrip";
import { BranchNav } from "./BranchNav";

export function MessageActions({
  body,
  locale,
  delegation,
  discussion,
  onOpenDiscussion,
  openLabel,
  onRetry,
  branch,
}: {
  body: string;
  locale: Locale;
  delegation?: DelegationInfo | null;
  discussion: DiscussionMessage[];
  onOpenDiscussion?: () => void;
  openLabel: string;
  onRetry?: () => void;
  branch?: { ids: string[]; activeId: string; onSelect: (nodeId: string) => void };
}) {
  const [copied, setCopied] = useState(false);
  const copy = t(locale).ui;
  const tooltip = delegationTooltip(locale, delegation ?? null);

  async function copyBody() {
    if (!body.trim() || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      console.warn(clientErrorMessage(error, t(locale).ui.copyFailed));
    }
  }

  return (
    <div className="message-actions" aria-label={copy.messageActions}>
      <button
        className="message-action-button"
        onClick={() => void copyBody()}
        type="button"
        title={copy.copy}
      >
        <Copy size={15} aria-hidden="true" />
        <span className="sr-only">{copy.copy}</span>
      </button>
      {onRetry ? (
        <button
          className="message-action-button"
          onClick={onRetry}
          type="button"
          title={copy.retry}
        >
          <RotateCcw size={14} aria-hidden="true" />
          <span className="sr-only">{copy.retry}</span>
        </button>
      ) : null}
      {branch && branch.ids.length > 1 ? (
        <BranchNav
          ids={branch.ids}
          activeId={branch.activeId}
          locale={locale}
          onSelect={branch.onSelect}
        />
      ) : null}
      {delegation || discussion.length > 0 ? (
        <AgentStrip
          agents={delegation?.agents ?? []}
          messages={discussion}
          locale={locale}
          tooltip={tooltip}
          onOpen={onOpenDiscussion}
          openLabel={openLabel}
        />
      ) : null}
      {copied ? <span className="message-action-status">{copy.copied}</span> : null}    </div>
  );
}
