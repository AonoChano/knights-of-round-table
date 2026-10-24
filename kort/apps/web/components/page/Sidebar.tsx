import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";

export function Sidebar({
  locale,
  agents,
  conversations,
  conversationsError,
  conversationsLoading,
  activeConversationId,
  unreadConversationIds,
  slotMapRef,
  slotVersion,
  collapsed,
  mobileOpen = false,
  onNewConversation,
  onOpenSearch,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onToggleCollapsed,
  onCloseMobile,
  openSettings,
}: {
  locale: Locale;
  agents: AgentView[];
  conversations: ConversationListItem[];
  conversationsError: string | null;
  conversationsLoading: boolean;
  activeConversationId: string | null;
  unreadConversationIds: Set<string>;
  slotMapRef: React.MutableRefObject<Map<string, StreamSlot>>;
  slotVersion: number;
  collapsed: boolean;
  mobileOpen?: boolean;
  onNewConversation: () => void;
  onOpenSearch: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, name: string) => void;
  onDeleteConversation: (id: string) => void;
  onToggleCollapsed: () => void;
  onCloseMobile?: () => void;
  openSettings: (tab: SettingsTab) => void;
}) {
  const tr = t(locale);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!menuConversationId) return;
    const handlePointerDown = () => setMenuConversationId(null);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuConversationId]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const handlePointerDown = () => setConfirmDeleteId(null);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [confirmDeleteId]);

  const grouped = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);

    const groups: { label: string; items: ConversationListItem[] }[] = [
      { label: tr.ui.conversationToday, items: [] },
      { label: tr.ui.conversationYesterday, items: [] },
      { label: tr.ui.conversationEarlier, items: [] },
    ];

    const seenIds = new Set<string>();

    for (const conv of conversations) {
      if (seenIds.has(conv.conversation_id)) continue;
      seenIds.add(conv.conversation_id);
      const d = new Date(conv.created_at);
      if (d >= todayStart) {
        groups[0].items.push(conv);
      } else if (d >= yesterdayStart) {
        groups[1].items.push(conv);
      } else {
        groups[2].items.push(conv);
      }
    }

    return groups.filter((g) => g.items.length > 0);
  }, [conversations, tr.ui.conversationToday, tr.ui.conversationYesterday, tr.ui.conversationEarlier]);

  const loadingConvIds = useMemo(() => {
    const ids = new Set<string>();
    slotMapRef.current.forEach((slot, cid) => {
      if (slot.loading) ids.add(cid);
    });
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotVersion]);

  function startRename(item: ConversationListItem, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(item.conversation_id);
    setEditValue(item.title);
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      onRenameConversation(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  }

  function handleDeleteClick(item: ConversationListItem, e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmDeleteId(item.conversation_id);
  }

  function closeMenu() {
    setMenuConversationId(null);
  }

  function openConversationInNewTab(item: ConversationListItem, e: React.MouseEvent) {
    e.stopPropagation();
    window.open(`/?c=${encodeURIComponent(item.conversation_id)}`, "_blank", "noopener,noreferrer");
    closeMenu();
  }

  function confirmDelete() {
    if (confirmDeleteId) {
      onDeleteConversation(confirmDeleteId);
    }
    setConfirmDeleteId(null);
  }

  const collapseTitle = mobileOpen
    ? tr.ui.closeSidebar
    : collapsed
      ? tr.ui.expandSidebar
      : tr.ui.collapseSidebar;
  const handleCollapseClick = mobileOpen && onCloseMobile ? onCloseMobile : onToggleCollapsed;

  return (
    <aside className={cn("sidebar", collapsed && "sidebar-collapsed", mobileOpen && "sidebar-mobile-open")} aria-label="Conversation sidebar">
      <div className="sidebar-main">
        <div className="sidebar-header">
          <div className="sidebar-brand" aria-label="Knights of the Round Table">
            <div className="logo-mark">
              <img className="brand-icon" src="/icon.svg" alt="" aria-hidden="true" />
              <button
                className="logo-collapse-overlay"
                type="button"
                title={collapseTitle}
                aria-label={collapseTitle}
                onClick={handleCollapseClick}
              >
                {mobileOpen ? <X size={17} aria-hidden="true" /> : collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
              </button>
            </div>
            <img className="sidebar-wordmark sidebar-expanded-only" src="/icon_text_part.svg" alt="Knights of Round Table" />
          </div>
          <button
            className="sidebar-collapse-button"
            type="button"
            title={collapseTitle}
            aria-label={collapseTitle}
            onClick={handleCollapseClick}
          >
            {mobileOpen ? <X size={17} aria-hidden="true" /> : collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
        </div>
        <div className="sidebar-actions">
          <button
            className="sidebar-primary sidebar-primary-action"
            title={tr.ui.newConversation}
            onClick={onNewConversation}
          >
            <SquarePen size={16} aria-hidden="true" />
            <span className="sidebar-expanded-only">{tr.ui.newConversation}</span>
          </button>
          <button
            className="sidebar-primary sidebar-primary-action"
            title={tr.search.title}
            onClick={onOpenSearch}
          >
            <Search size={16} aria-hidden="true" />
            <span className="sidebar-expanded-only">{tr.search.title}</span>
            <span className="sidebar-shortcut-hint sidebar-expanded-only" aria-hidden="true">
              {tr.search.shortcut}
            </span>
          </button>
        </div>
        <div className="sidebar-history sidebar-expanded-only">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="sidebar-date-divider">
                <span>{group.label}</span>
              </div>
              {group.items.map((item) => {
                const isLoadingConversation = loadingConvIds.has(item.conversation_id);
                const isActiveConversation = activeConversationId === item.conversation_id;
                const hasUnreadConversation = unreadConversationIds.has(item.conversation_id);
                return (
                  <div
                    key={item.conversation_id}
                    className={cn(
                      "sidebar-link-row",
                      isActiveConversation && "sidebar-link-row-active",
                      isLoadingConversation && !isActiveConversation && "sidebar-link-row-loading",
                      menuConversationId === item.conversation_id && "sidebar-link-row-menu-open",
                      confirmDeleteId === item.conversation_id && "sidebar-link-row-confirm-open"
                    )}
                  >
                    {editingId === item.conversation_id ? (
                      <input
                        ref={editInputRef}
                        className="sidebar-link-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditValue("");
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <button
                        className={cn("sidebar-link", isActiveConversation && "sidebar-link-active")}
                        onClick={() => onSelectConversation(item.conversation_id)}
                      >
                        {item.title}
                      </button>
                    )}
                    {!isActiveConversation && (isLoadingConversation || hasUnreadConversation) ? (
                      <span
                        className="sidebar-row-progress"
                        title={isLoadingConversation ? tr.ui.conversationInProgress : tr.ui.conversationCompleteUnread}
                      >
                        {isLoadingConversation ? <span className="sidebar-spinner" /> : <span className="sidebar-unread-dot" />}
                      </span>
                    ) : null}
                    <span className="sidebar-link-actions" onPointerDown={(e) => e.stopPropagation()}>
                      <button
                        className="sidebar-link-action-btn"
                        title={tr.ui.more}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuConversationId((current) => current === item.conversation_id ? null : item.conversation_id);
                        }}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </button>
                    </span>
                    {menuConversationId === item.conversation_id ? (
                      <div
                        className="conversation-menu"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button className="conversation-menu-item" onClick={(e) => openConversationInNewTab(item, e)}>
                          <ExternalLink size={14} aria-hidden="true" />
                          <span>{tr.ui.openInNewTab}</span>
                        </button>
                        <button className="conversation-menu-item" onClick={(e) => { startRename(item, e); closeMenu(); }}>
                          <Pencil size={14} aria-hidden="true" />
                          <span>{tr.ui.rename}</span>
                        </button>
                        <button className="conversation-menu-item conversation-menu-danger" onClick={(e) => { handleDeleteClick(item, e); closeMenu(); }}>
                          <Trash2 size={14} aria-hidden="true" />
                          <span>{tr.ui.delete}</span>
                        </button>
                      </div>
                    ) : null}
                    {confirmDeleteId === item.conversation_id ? (
                      <div
                        className="sidebar-confirm-popover"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="sidebar-confirm-title">{tr.ui.confirmDeleteConversation}</div>
                        <div className="sidebar-confirm-actions">
                          <button className="small-button" onClick={() => setConfirmDeleteId(null)}>{tr.ui.cancel}</button>
                          <button className="small-button small-button-danger" onClick={confirmDelete}>{tr.ui.delete}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {conversations.length === 0 && conversationsLoading ? (
            <div className="sidebar-history-skeleton" aria-busy="true">
              <div className="skeleton skeleton-caption" />
              {[0, 1, 2, 3].map((index) => (
                <div className="sidebar-skeleton-row" key={index}>
                  <div
                    className="skeleton skeleton-line"
                    style={{ width: `${68 - index * 9}%`, height: 11 }}
                  />
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="sidebar-history-empty">
              <div>
                {conversationsError
                  ? tr.ui.conversationHistoryUnavailable
                  : tr.ui.noConversationHistory}
              </div>
              {conversationsError ? <div className="sidebar-history-empty-detail">{conversationsError}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-primary sidebar-status-card group sidebar-expanded-only" onClick={() => openSettings("experts")}>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <UsersRound size={15} aria-hidden="true" />
              {tr.ui.discussionReady}
            </span>
            <span className="breathing-dot h-1.5 w-1.5 rounded-full bg-[#2f7d32]" />
          </div>
          <div className="mt-2 hidden text-xs leading-5 text-muted group-hover:block">
            {tr.ui.profilesAvailable(agents.length || 0)}
          </div>
        </button>
        <button className="sidebar-user" title={tr.ui.settingsUser} onClick={() => openSettings("general")}>
          <div className="avatar-button">A</div>
          <div className="min-w-0 flex-1 text-left sidebar-expanded-only">
            <div className="text-sm font-medium">Alex</div>
            <div className="text-xs text-muted">{tr.ui.settingsUser}</div>
          </div>
          <Settings className="sidebar-expanded-only" size={15} aria-hidden="true" />
        </button>
      </div>

    </aside>
  );
}
