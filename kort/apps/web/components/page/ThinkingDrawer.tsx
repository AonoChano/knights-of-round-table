import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

import { Markdown } from "../Markdown";

export function ThinkingDrawer({
  loading,
  elapsed,
  thinkingComplete,
  timeline,
  locale,
  onClose,
}: {
  loading: boolean;
  elapsed: number;
  thinkingComplete: boolean;
  timeline: TimelineItem[];
  locale: Locale;
  onClose: () => void;
}) {
  const tr = t(locale);
  const visibleTimeline = dedupeTimelineItems(timeline);
  const doneItem = [...visibleTimeline].reverse().find((item) => item.status === "done");
  const drawerComplete = thinkingComplete || Boolean(doneItem);
  const doneTitle = doneItem?.title || thinkingElapsedLabel(locale, elapsed, true);

  function normalizedText(text: string): string {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function renderTreeNodes(nodes: ThinkingTreeNode[], parentTitle = "") {
    return nodes.map((node) => {
      const children = node.children ?? [];
      const duplicateRootTitle = parentTitle && normalizedText(node.title) === normalizedText(parentTitle);
      return (
        <div key={node.id} className="reasoning-tree-node">
          {!duplicateRootTitle && node.title ? (
            <span className={cn("reasoning-tree-title", node.status === "done" && "reasoning-tree-title-done")}>
              {node.title}
            </span>
          ) : null}
          {node.summary ? <div className="reasoning-tree-summary markdown-body"><Markdown content={node.summary} locale={locale} /></div> : null}
          {children.length > 0 ? <div className="reasoning-tree-children">{renderTreeNodes(children)}</div> : null}
        </div>
      );
    });
  }

  return (
    <aside className="thinking-drawer" aria-label={tr.ui.thinkingProcess}>
      <div className="thinking-drawer-header">
        <div>
          <div className="thinking-drawer-title">{tr.ui.thinkingProcess}</div>
          <div className="thinking-drawer-meta">
            {drawerComplete
              ? doneTitle
              : loading
                ? thinkingElapsedLabel(locale, elapsed, false)
                : null}
          </div>
        </div>
        <button className="small-button" onClick={onClose}>{tr.ui.collapse}</button>
      </div>

      <div className="thinking-drawer-body">
        <div className="reasoning-timeline">
          {visibleTimeline.map((item, index) => (
            <div key={item.id} className="reasoning-node reasoning-node-appear">
              <div
                className={cn(
                  "reasoning-dot",
                  (item.status === "active" || item.status === "streaming") && "reasoning-dot-active",
                  item.status === "talking" && "reasoning-dot-talking",
                  item.status === "done" && "reasoning-dot-done"
                )}
              />
              {index < visibleTimeline.length - 1 ? <div className="reasoning-line" /> : null}
              <div className="reasoning-content">
                <div
                  className={cn(
                    "reasoning-title",
                    (item.status === "active" || item.status === "streaming" || item.status === "talking") &&
                      "thinking-title-active"
                  )}
                >
                  {item.status === "active" ? item.title ? `${item.title} · ${thinkingElapsedLabel(locale, elapsed, false)}` : null : null}
                  {item.status === "talking" ? `${tr.thinking.talking} · ${thinkingElapsedLabel(locale, elapsed, false)}` : null}
                  {item.status === "done" ? (item.title || doneTitle) : null}
                  {item.status !== "active" && item.status !== "done" && item.status !== "talking" ? item.title : null}
                </div>
                {item.status === "complete" || item.status === "streaming" ? (
                  item.treeNodes?.length ? (
                    <div className="reasoning-tree">{renderTreeNodes(item.treeNodes, item.title)}</div>
                  ) : (
                    <div className="reasoning-body markdown-body">
                      <Markdown content={item.body} locale={locale} />
                    </div>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
