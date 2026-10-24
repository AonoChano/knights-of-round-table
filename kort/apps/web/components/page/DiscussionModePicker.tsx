import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

export function DiscussionModePicker({
  discussionLevel,
  deepThink,
  locale,
  setDiscussionLevel,
  setDeepThink,
  customMaxRounds,
  setCustomMaxRounds,
}: {
  discussionLevel: DiscussionLevel;
  deepThink: boolean;
  locale: Locale;
  setDiscussionLevel: Dispatch<SetStateAction<DiscussionLevel>>;
  setDeepThink: Dispatch<SetStateAction<boolean>>;
  customMaxRounds: number | null;
  setCustomMaxRounds: Dispatch<SetStateAction<number | null>>;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // 关闭讨论走底栏的开关，左上角只保留仍适用于单一模型的设置
  const levels = useMemo(
    () => discussionLevels(locale).filter((level) => level.id !== "off"),
    [locale]
  );
  const active = levels.find((d) => d.id === discussionLevel) ?? levels[0];
  const modeTitle = `${active.tag} [${active.code}]`;

  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = pickerRef.current;
      if (!root || !event.target || root.contains(event.target as Node)) return;
      setDropdownOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDropdownOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  return (
    <div ref={pickerRef} className="discussion-mode">
      {discussionLevel !== "off" ? (
        <div className="discussion-mode-control">
          <button
            className={cn(
              "discussion-level-trigger",
              "discussion-level-trigger-topbar",
              "discussion-level-trigger-active"
            )}
            onClick={() => setDropdownOpen((prev) => !prev)}
            type="button"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            aria-label={modeTitle}
            title={modeTitle}
          >
            <span className="discussion-trigger-label">{active.tag}</span>
            <span className="discussion-trigger-code">[{active.code}]</span>
            <ChevronDown className="discussion-trigger-chevron" size={14} aria-hidden="true" />
          </button>
          {dropdownOpen ? (
            <div className="discussion-level-dropdown discussion-level-dropdown-topbar" role="menu">
              {levels.map((level) => (
                <button
                  key={level.id}
                  className="discussion-level-option"
                  type="button"
                  role="menuitemradio"
                  aria-checked={discussionLevel === level.id}
                  onClick={() => {
                    setDiscussionLevel(level.id);
                    setDropdownOpen(false);
                  }}
                >
                  <span className="discussion-level-label">{level.label}</span>
                  <span className="discussion-level-tag">{level.tag}</span>
                  {discussionLevel === level.id ? (
                    <Check className="discussion-level-check" size={14} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {discussionLevel === "off" ? (
        <button
          className={cn(
            "discussion-level-trigger",
            "discussion-level-trigger-topbar",
            deepThink && "discussion-level-trigger-active"
          )}
          onClick={() => setDeepThink((prev) => !prev)}
          type="button"
          title={t(locale).ui.deepThink}
        >
          <Brain size={14} aria-hidden="true" />
          {t(locale).ui.deepThink}
          {deepThink ? (
            <Check className="discussion-level-check discussion-level-check-inline" size={14} aria-hidden="true" />
          ) : null}
        </button>
      ) : null}
      {discussionLevel !== "off" ? (
        <div className="discussion-mode-control" style={{ marginLeft: "8px" }}>
          <label className="discussion-rounds-field">
            <span>{t(locale).ui.maxRounds}</span>
            <input
              className="discussion-rounds-input"
              type="number"
              min="1"
              max="12"
              value={customMaxRounds ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") {
                  setCustomMaxRounds(null);
                } else {
                  const num = parseInt(val, 10);
                  if (num >= 1 && num <= 12) {
                    setCustomMaxRounds(num);
                  }
                }
              }}
              placeholder={t(locale).ui.auto}
              aria-label={t(locale).ui.maxRounds}
              title={t(locale).ui.maxRoundsHint}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
