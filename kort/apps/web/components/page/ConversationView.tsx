import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type * as React from "react";
import { Brain, Bug, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, FileText, FlaskConical, KeyRound, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, RotateCcw, Save, Search, Settings, Share2, SlidersHorizontal, SquarePen, Trash2, UserPlus, UsersRound, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { discussionLevels, loadLocale, nextThinkingLabel, saveLocale, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "../../app/page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "../../app/page-types";
import { waitingStatusText } from "../../app/page-utils";

import { Markdown } from "../Markdown";
import { numberSources } from "../citation/sources";
import { ThinkingTrace } from "../thinking/ThinkingTrace";
import { BrailleSpinner } from "./BrailleSpinner";
import { BranchNav } from "./BranchNav";
import { MessageActions } from "./MessageActions";

export function ConversationView({
  nodes,
  activeRootId,
  streamingNodeId,
  pendingRetryOf,
  loading,
  thinkingComplete,
  elapsed,
  question,
  pendingEdit,
  timeline,
  toolTraces,
  finalBody,
  streamError,
  requestPhase,
  delegationInfo,
  locale,
  liveDiscussion,
  locateNodeId,
  onToggleThinking,
  onOpenLiveDiscussion,
  onEditMessage,
  onRetryMessage,
  onSelectBranch,
  onOpenNodeDiscussion,
  onViewNodeThinking,
}: {
  nodes: MessageNode[];
  activeRootId: string | null;
  streamingNodeId: string | null;
  pendingRetryOf: string | null;
  loading: boolean;
  thinkingComplete: boolean;
  elapsed: number;
  question: string | null;
  pendingEdit: PendingEdit | null;
  timeline: TimelineItem[];
  toolTraces: ToolTrace[];
  finalBody: string;
  streamError: string | null;
  requestPhase: StreamSlot["requestPhase"];
  delegationInfo: DelegationInfo | null;
  locale: Locale;
  liveDiscussion: DiscussionMessage[];
  locateNodeId: string | null;
  onToggleThinking: () => void;
  onOpenLiveDiscussion?: () => void;
  onEditMessage: (node: MessageNode, content: string) => void;
  onRetryMessage: (userNode: MessageNode) => void;
  onSelectBranch: (nodeId: string) => void;
  onOpenNodeDiscussion: (question: string, node: MessageNode) => void;
  onViewNodeThinking: (node: MessageNode) => void;
}) {
  const tr = t(locale);
  const copy = tr.ui;
  const path = activePathOf(nodes, activeRootId);
  // 编辑提交后、新分支落盘前，把对话截断到被编辑消息之前，在原位显示改后的文本，
  // 而不是让同一段文字再追加到对话末尾
  const pendingEditIndex = pendingEdit
    ? path.findIndex((node) => node.node_id === pendingEdit.nodeId)
    : -1;
  const showPendingEdit = Boolean(pendingEdit) && pendingEditIndex >= 0;
  const visiblePath = showPendingEdit ? path.slice(0, pendingEditIndex) : path;
  const pendingEditNode = showPendingEdit ? path[pendingEditIndex] : null;
  const liveSources = useMemo(() => numberSources(toolTraces), [toolTraces]);
  const liveNodeId =
    streamingNodeId ??
    path.find((node) => node.role === "assistant" && node.status === "streaming")?.node_id ??
    null;
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editingNodeId) return;
    const textarea = editRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editingNodeId]);

  function startEditing(node: MessageNode) {
    setEditingNodeId(node.node_id);
    setEditDraft(node.content);
  }

  function cancelEditing() {
    setEditingNodeId(null);
    setEditDraft("");
  }

  function submitEditing(node: MessageNode) {
    const content = editDraft.trim();
    if (!content) return;
    cancelEditing();
    onEditMessage(node, content);
  }

  function renderBranchNav(node: MessageNode) {
    if (loading) return null;
    const ids = siblingIdsOf(nodes, node);
    if (ids.length < 2) return null;
    return <BranchNav ids={ids} activeId={node.node_id} locale={locale} onSelect={onSelectBranch} />;
  }

  function renderUserMessage(node: MessageNode) {
    if (editingNodeId === node.node_id) {
      return (
        <div className="message-editor" key={`editor-${node.node_id}`}>
          <textarea
            ref={editRef}
            className="message-editor-input"
            value={editDraft}
            rows={3}
            onChange={(event) => setEditDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitEditing(node);
              }
              if (event.key === "Escape") cancelEditing();
            }}
          />
          <div className="message-editor-actions">
            <span className="message-editor-hint">{copy.editMessage}</span>
            <button className="small-button" type="button" onClick={cancelEditing}>
              {copy.cancel}
            </button>
            <button
              className="small-button small-button-primary"
              type="button"
              disabled={!editDraft.trim()}
              onClick={() => submitEditing(node)}
            >
              {copy.send}
            </button>
          </div>
        </div>
      );
    }
    const images = (node.attachments ?? []).filter(
      (file) => file.kind === "image" && Boolean(file.data)
    );
    const files = (node.attachments ?? []).filter((file) => file.kind !== "image");
    return (
      <div
        className={cn("user-message-row", locateNodeId === node.node_id && "node-locate")}
        data-node-id={node.node_id}
        key={`user-${node.node_id}`}
      >
        {images.length > 0 ? (
          <div className="user-message-images">
            {images.map((file, index) => (
              <img
                key={`${node.node_id}-image-${index}`}
                className="user-message-image"
                src={file.data}
                alt={file.name}
                title={file.name}
                loading="lazy"
                draggable={false}
              />
            ))}
          </div>
        ) : null}
        {node.content ? <div className="user-message">{node.content}</div> : null}
        {files.length > 0 ? (
          <div className="user-message-files">
            {files.map((file) => (
              <span className="user-message-file" key={`${node.node_id}-${file.name}`}>
                <FileText size={11} aria-hidden="true" />
                <span className="user-message-file-name">{file.name}</span>
                <span className="user-message-file-size">
                  {tr.composer.attachmentChars(file.text?.length ?? 0)}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="user-message-actions">
          {renderBranchNav(node)}
          {!loading ? (
            <button
              className="message-edit-button"
              type="button"
              title={copy.edit}
              aria-label={copy.edit}
              onClick={() => startEditing(node)}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const latest = [...timeline].reverse().find(
    (item) => item.status === "streaming" || item.status === "complete"
  );
  const statusItem = [...timeline].reverse().find(
    (item) => item.status === "active" || item.status === "talking" || item.status === "done"
  );
  const isDone = thinkingComplete || statusItem?.status === "done";

  function renderLiveAssistant() {
    const showPreview = !isDone && latest && latest.body.trim();
    const showWaitingState =
      loading && !finalBody && !streamError && (timeline.length === 0 || requestPhase !== null);
    const previewBody = latest ? markdownBody(latest.body) : "";
    return (
      <div className="assistant-row" key="assistant-live">
        <div className="assistant-content">
          {timeline.length > 0 ? (
            <ThinkingTrace
              timeline={timeline}
              active={!isDone && loading}
              elapsed={elapsed}
              locale={locale}
              onOpenDetails={onToggleThinking}
            />
          ) : null}

          {showWaitingState ? (
            <div className="assistant-waiting" role="status" aria-live="polite">
              <BrailleSpinner />
              <span>{waitingStatusText(locale, requestPhase, delegationInfo)}</span>
            </div>
          ) : null}

          {streamError ? (
            <div className="assistant-error" role="status" aria-live="polite">
              <span>{tr.ui.sendFailed}</span>
              <span className="assistant-error-detail">{streamError}</span>
            </div>
          ) : null}

          {showPreview && previewBody ? (
            <div className="thinking-preview markdown-body">
              <Markdown content={truncateWords(previewBody, 20)} locale={locale} sources={liveSources} />
            </div>
          ) : null}

          {finalBody ? (
            <>
              <div className="answer-body markdown-body">
                <Markdown content={finalBody} locale={locale} sources={liveSources} />
              </div>
              <MessageActions
                body={finalBody}
                locale={locale}
                delegation={delegationInfo}
                discussion={liveDiscussion}
                openLabel={loading ? tr.room.watchLive : tr.room.review}
                onOpenDiscussion={liveDiscussion.length > 0 ? onOpenLiveDiscussion : undefined}
              />
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function renderStoredAssistant(node: MessageNode, user: MessageNode | null) {
    if (node.node_id === liveNodeId) {
      return renderLiveAssistant();
    }
    const body = markdownBody(node.content) || node.content;
    const nodeTimeline = timelineFromStageSummaries(
      node.stage_summaries,
      locale,
      nodeElapsedSeconds(node),
      node.status === "cancelled",
      node.tool_traces
    );
    const discussion = node.discussion_messages ?? [];
    const nodeSources = numberSources(node.tool_traces ?? []);
    const failed = node.status === "error";
    return (
      <div
        className={cn("assistant-row", locateNodeId === node.node_id && "node-locate")}
        data-node-id={node.node_id}
        key={`assistant-${node.node_id}`}
      >
        <div className="assistant-content">
          {nodeTimeline.length > 0 ? (
            <ThinkingTrace
              timeline={nodeTimeline}
              active={false}
              elapsed={nodeElapsedSeconds(node) ?? 0}
              locale={locale}
              onOpenDetails={() => onViewNodeThinking(node)}
            />
          ) : null}
          {body ? (
            <div className="answer-body markdown-body">
              <Markdown content={body} locale={locale} sources={nodeSources} />
            </div>
          ) : null}
          {failed ? (
            <div className="assistant-error" role="status" aria-live="polite">
              <span>{copy.generationFailed}</span>
              {node.error ? <span className="assistant-error-detail">{node.error}</span> : null}
            </div>
          ) : null}
          {body || failed || node.status === "cancelled" ? (
            <MessageActions
              body={body}
              locale={locale}
              delegation={node.delegation ?? null}
              discussion={discussion}
              openLabel={tr.room.review}
              onOpenDiscussion={
                discussion.length > 0 ? () => onOpenNodeDiscussion(user?.content ?? "", node) : undefined
              }
              onRetry={
                !loading && user ? () => onRetryMessage(user) : undefined
              }
              branch={
                loading
                  ? undefined
                  : {
                      ids: siblingIdsOf(nodes, node),
                      activeId: node.node_id,
                      onSelect: onSelectBranch,
                    }
              }
            />
          ) : null}
        </div>
      </div>
    );
  }

  function renderWaitingAssistant(key: string) {
    return (
      <div className="assistant-row" key={key}>
        <div className="assistant-content">
          <div className="assistant-waiting" role="status" aria-live="polite">
            <BrailleSpinner />
            <span>{waitingStatusText(locale, requestPhase, delegationInfo)}</span>
          </div>
        </div>
      </div>
    );
  }

  const turns: Array<{ user: MessageNode | null; assistant: MessageNode | null }> = [];
  for (const node of visiblePath) {
    if (node.role === "user") {
      turns.push({ user: node, assistant: null });
    } else if (turns.length > 0 && turns[turns.length - 1].assistant === null) {
      turns[turns.length - 1].assistant = node;
    } else {
      turns.push({ user: null, assistant: node });
    }
  }

  return (
    <div>
      {turns.map((turn, idx) => {
        const retrying = Boolean(turn.user && pendingRetryOf === turn.user.node_id);
        return (
          <div
            key={turn.user ? `turn-${turn.user.node_id}` : `turn-a-${idx}`}
            className="conversation-stack"
            data-message-id={turn.user?.node_id}
          >
            {turn.user ? renderUserMessage(turn.user) : null}
            {retrying
              ? renderWaitingAssistant(`waiting-retry-${idx}`)
              : turn.assistant
                ? renderStoredAssistant(turn.assistant, turn.user)
                : null}
          </div>
        );
      })}

      {showPendingEdit && pendingEdit && pendingEditNode ? (
        <div className="conversation-stack" key={`pending-edit-${pendingEdit.nodeId}`}>
          {renderUserMessage({ ...pendingEditNode, content: pendingEdit.content })}
          {renderLiveAssistant()}
        </div>
      ) : null}

      {question && !showPendingEdit ? (
        <div className="conversation-stack">
          <div className="user-message">{question}</div>
          {renderLiveAssistant()}
        </div>
      ) : null}

      {!question && streamError ? (
        <div className="conversation-stack">
          <div className="assistant-row">
            <div className="assistant-content">
              <div className="assistant-error" role="status" aria-live="polite">
                <span>{tr.ui.sendFailed}</span>
                <span className="assistant-error-detail">{streamError}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
