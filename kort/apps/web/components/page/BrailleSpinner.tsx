import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function BrailleSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % BRAILLE_FRAMES.length);
    }, 85);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="assistant-waiting-spinner" aria-hidden="true">
      {BRAILLE_FRAMES[frame]}
    </span>
  );
}
