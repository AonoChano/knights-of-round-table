import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { nextThinkingLabel, t } from "./locale";
import type { Locale } from "./locale";
import {
  appendDiscussionMessage,
  appendThinkingDoneNode,
  attachTrace,
  callArgs,
  elapsedMsToSeconds,
  markdownBody,
  parseDelegationInfo,
  parseDiscussionMessage,
  parseMessageNode,
  parseThinkingTreeNodes,
  parseToolTrace,
  patchCall,
  timelineFromStageSummaries,
  upsertNode,
  upsertSummaryStart,
  upsertToolTrace,
  withoutTransientTimelineItems,
} from "./page-utils";
import type {
  ConversationListItem,
  ConversationResponse,
  DelegationInfo,
  DiscussionMessage,
  MessageNode,
  PendingEdit,
  StreamEvent,
  StreamSlot,
  TimelineItem,
  TimerHandle,
  ToolTrace,
} from "./page-types";

type StreamHandlerRefs = {
  submittedQuestionRef: MutableRefObject<string | null>;
  delegationPhaseTimerRef: MutableRefObject<TimerHandle | null>;
  thinkingLabelRef: MutableRefObject<TimerHandle | null>;
  lastThinkingLabelRef: MutableRefObject<string>;
  lastThinkingActiveTimeRef: MutableRefObject<number>;
  sentenceTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  activeSummaryRef: MutableRefObject<string>;
  rawBodyBySummary: MutableRefObject<Record<string, string>>;
  sentenceQueueRef: MutableRefObject<string[]>;
  timerElapsedRef: MutableRefObject<boolean>;
  drawerOpenRef: MutableRefObject<boolean>;
};

export type StreamHandlerContext = {
  locale: Locale;
  elapsed: number;
  currentConversationId: string | null;
  streamingNodeId: string | null;
  pendingConvId: string | null;
  setNodesSynced: Dispatch<SetStateAction<MessageNode[]>>;
  setActiveRootId: Dispatch<SetStateAction<string | null>>;
  setStreamingNodeId: Dispatch<SetStateAction<string | null>>;
  setPendingRetryOf: Dispatch<SetStateAction<string | null>>;
  setToolTraces: Dispatch<SetStateAction<ToolTrace[]>>;
  setSubmittedQuestion: Dispatch<SetStateAction<string | null>>;
  setPendingEdit: Dispatch<SetStateAction<PendingEdit | null>>;
  setRequestPhase: Dispatch<SetStateAction<StreamSlot["requestPhase"]>>;
  setConversation: Dispatch<SetStateAction<ConversationResponse | null>>;
  setConversations: Dispatch<SetStateAction<ConversationListItem[]>>;
  setDelegationInfo: Dispatch<SetStateAction<DelegationInfo | null>>;
  setTimeline: Dispatch<SetStateAction<TimelineItem[]>>;
  setDiscussionMessages: Dispatch<SetStateAction<DiscussionMessage[]>>;
  setTalkingActive: Dispatch<SetStateAction<boolean>>;
  setThinkingComplete: Dispatch<SetStateAction<boolean>>;
  setElapsed: Dispatch<SetStateAction<number>>;
  setFinalBody: Dispatch<SetStateAction<string>>;
  setStreamError: Dispatch<SetStateAction<string | null>>;
  setDrawerTimeline: Dispatch<SetStateAction<TimelineItem[] | null>>;
  setPendingConvId: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  refs: StreamHandlerRefs;
  processSentenceBuffer: (summaryId: string) => void;
  loadConversations: () => void;
  markStreamingNodeFailed: (slot: StreamSlot, message: string) => boolean;
};

function elapsedForSlot(slot: StreamSlot | null | undefined, fallbackElapsed: number): number {
  if (slot?.startedAt) return Math.max(1, Math.round((Date.now() - slot.startedAt) / 1000));
  if (slot && slot.elapsed > 0) return slot.elapsed;
  return Math.max(1, fallbackElapsed);
}

export function applyEventToSlot(ctx: StreamHandlerContext, slot: StreamSlot, message: StreamEvent) {
  const {
    locale, elapsed, markStreamingNodeFailed,
  } = ctx;

  if (message.event === "branch_started") {
    const startedNodes = Array.isArray(message.data.nodes)
      ? message.data.nodes.map(parseMessageNode).filter((node): node is MessageNode => node !== null)
      : [];
    for (const node of startedNodes) {
      slot.nodes = upsertNode(slot.nodes, node);
    }
    if (typeof message.data.active_root_id === "string") {
      slot.activeRootId = message.data.active_root_id;
    }
    slot.streamingNodeId = startedNodes.find((node) => node.role === "assistant")?.node_id ?? null;
    slot.pendingRetryOf = null;
    slot.submittedQuestion = null;
    slot.pendingEdit = null;
    slot.requestPhase = "sent";
    slot.toolTraces = [];
    return;
  }
  if (message.event === "delegation_complete") {
    const info = parseDelegationInfo(message.data);
    slot.delegationInfo = info;
    slot.requestPhase = "delegating";
    return;
  }
  if (message.event === "tool_trace") {
    const trace = parseToolTrace(message.data);
    if (trace) {
      slot.toolTraces = upsertToolTrace(slot.toolTraces, trace);
      slot.timeline = attachTrace(slot.timeline, trace, locale);
    }
    return;
  }
  if (message.event === "tool_call_started") {
    const callId = String(message.data.id ?? "");
    if (callId) {
      slot.timeline = patchCall(
        slot.timeline,
        callId,
        {
          name: String(message.data.name ?? ""),
          state: "running",
          ...callArgs(message.data),
        },
        locale
      );
    }
    return;
  }
  if (
    message.event === "tool_call_completed" ||
    message.event === "tool_call_failed" ||
    message.event === "tool_call_skipped"
  ) {
    const callId = String(message.data.id ?? "");
    if (callId) {
      slot.timeline = patchCall(
        slot.timeline,
        callId,
        {
          name: String(message.data.name ?? ""),
          state:
            message.event === "tool_call_completed"
              ? "complete"
              : message.event === "tool_call_failed"
                ? "failed"
                : "skipped",
          result:
            typeof message.data.result === "string" ? message.data.result : undefined,
          error: typeof message.data.error === "string" ? message.data.error : undefined,
          reason: typeof message.data.reason === "string" ? message.data.reason : undefined,
        },
        locale
      );
    }
    return;
  }
  if (message.event === "discussion_message") {
    const parsed = parseDiscussionMessage(message.data);
    if (parsed) {
      slot.discussionMessages = appendDiscussionMessage(slot.discussionMessages, parsed);
    }
    return;
  }
  if (message.event === "early_stop_detected") {
    // Update delegation info with early stop metadata
    if (slot.delegationInfo && message.data) {
      slot.delegationInfo = {
        ...slot.delegationInfo,
        actual_rounds: typeof message.data.actual_rounds === "number" ? message.data.actual_rounds : 0,
        early_stop: true,
        early_stop_reason: typeof message.data.early_stop_reason === "string" ? message.data.early_stop_reason : null,
        convergence_score: typeof message.data.convergence_score === "number" ? message.data.convergence_score : null,
      };
    }
    return;
  }
  if (message.event === "talking_active") {
    slot.requestPhase = null;
    slot.talkingActive = true;
    slot.timeline = withoutTransientTimelineItems(slot.timeline);
    slot.timeline = [...slot.timeline, { id: "talking-active", title: t(locale).thinking.talking, body: "", raw: "", status: "talking" }];
    return;
  }
  if (message.event === "thinking_active") {
    slot.requestPhase = null;
    slot.talkingActive = false;
    const { label: initialLabel } = nextThinkingLabel(locale, "");
    slot.timeline = withoutTransientTimelineItems(slot.timeline);
    slot.timeline = [...slot.timeline, { id: "thinking-active", title: initialLabel, body: "", raw: "", status: "active" }];
    return;
  }
  if (message.event === "summary_start") {
    const id = String(message.data.id ?? crypto.randomUUID());
    slot.timeline = upsertSummaryStart(slot.timeline, id, t(locale).thinking.active);
    return;
  }
  if (message.event === "summary_title") {
    const id = String(message.data.id ?? "");
    const title = String(message.data.title ?? "Thinking");
    slot.timeline = slot.timeline.map((item) => (item.id === id ? { ...item, title, status: "streaming" as const } : item));
    return;
  }
  if (message.event === "summary_delta") {
    const id = String(message.data.id ?? "");
    const delta = String(message.data.delta ?? "");
    slot.timeline = slot.timeline.map((item) => {
      if (item.id !== id) return item;
      const raw = item.raw + delta;
      return { ...item, raw, body: markdownBody(raw) };
    });
    return;
  }
  if (message.event === "summary_complete") {
    const id = String(message.data.id ?? "");
    const treeNodes = parseThinkingTreeNodes(message.data.tree_nodes);
    slot.timeline = slot.timeline.map((item) => {
      if (item.id !== id) return item;
      return { ...item, body: item.raw.trim(), status: "complete" as const, treeNodes };
    });
    return;
  }
  if (message.event === "thinking_complete") {
    slot.thinkingComplete = true;
    slot.talkingActive = false;
    slot.elapsed =
      elapsedMsToSeconds(typeof message.data.elapsed_ms === "number" ? message.data.elapsed_ms : undefined) ??
      elapsedForSlot(slot, elapsed);
    slot.startedAt = null;
    slot.timeline = appendThinkingDoneNode(withoutTransientTimelineItems(slot.timeline), locale, slot.elapsed);
    return;
  }
  if (message.event === "final_delta") {
    slot.requestPhase = null;
    const delta = String(message.data.delta ?? "");
    slot.finalBody = slot.finalBody + delta;
    if (slot.streamingNodeId) {
      const streamingId = slot.streamingNodeId;
      slot.nodes = slot.nodes.map((node) =>
        node.node_id === streamingId ? { ...node, content: slot.finalBody } : node
      );
    }
    return;
  }
  if (message.event === "final_reset") {
    slot.finalBody = "";
    if (slot.streamingNodeId) {
      const streamingId = slot.streamingNodeId;
      slot.nodes = slot.nodes.map((node) =>
        node.node_id === streamingId ? { ...node, content: "" } : node
      );
    }
    return;
  }
  if (message.event === "node_complete") {
    const completed = parseMessageNode(message.data.node);
    if (completed) {
      slot.nodes = upsertNode(slot.nodes, completed);
    }
    if (typeof message.data.active_root_id === "string") {
      slot.activeRootId = message.data.active_root_id;
    }
    slot.elapsed = Math.max(slot.elapsed, elapsedMsToSeconds(completed?.elapsed_ms) ?? 0, elapsedForSlot(slot, elapsed));
    slot.startedAt = null;
    slot.finalBody = "";
    slot.loading = false;
    slot.requestPhase = null;
    slot.streamError = null;
    slot.streamingNodeId = null;
    slot.pendingRetryOf = null;
    slot.submittedQuestion = null;
    slot.thinkingComplete = false;
    const visibleTimeline = withoutTransientTimelineItems(slot.timeline);
    slot.timeline =
      visibleTimeline.length > 0 ? appendThinkingDoneNode(visibleTimeline, locale, slot.elapsed) : [];
    return;
  }
  if (message.event === "conversation_title") {
    const title = String(message.data.title ?? "");
    if (slot.conversation) {
      slot.conversation = { ...slot.conversation, title };
    }
    return;
  }
  if (message.event === "error") {
    const errorMessage = String(
      message.data.message ?? message.data.error ?? t(locale).ui.backendUnavailable
    );
    slot.loading = false;
    slot.requestPhase = null;
    slot.pendingEdit = null;
    if (!markStreamingNodeFailed(slot, errorMessage)) {
      slot.streamError = errorMessage;
    }
    return;
  }
}

export function handleStreamEvent(
  ctx: StreamHandlerContext,
  message: StreamEvent,
  streamContext?: { streamingNodeId: string | null; slot: StreamSlot }
) {
  const {
    locale, elapsed, currentConversationId, streamingNodeId, pendingConvId,
    setNodesSynced, setActiveRootId, setStreamingNodeId, setPendingRetryOf,
    setToolTraces, setSubmittedQuestion, setPendingEdit, setRequestPhase,
    setConversation, setConversations, setDelegationInfo, setTimeline,
    setDiscussionMessages, setTalkingActive, setThinkingComplete, setElapsed,
    setFinalBody, setStreamError, setDrawerTimeline, setPendingConvId, setLoading,
    processSentenceBuffer, loadConversations,
  } = ctx;
  const {
    submittedQuestionRef, delegationPhaseTimerRef, thinkingLabelRef,
    lastThinkingLabelRef, lastThinkingActiveTimeRef, sentenceTimerRef,
    activeSummaryRef, rawBodyBySummary, sentenceQueueRef, timerElapsedRef,
    drawerOpenRef,
  } = ctx.refs;

  if (message.event === "branch_started") {
    const started = Array.isArray(message.data.nodes)
      ? message.data.nodes.map(parseMessageNode).filter((node): node is MessageNode => node !== null)
      : [];
    if (started.length > 0) {
      setNodesSynced((current) => started.reduce(upsertNode, current));
    }
    const startedRoot = typeof message.data.active_root_id === "string" ? message.data.active_root_id : null;
    setActiveRootId(startedRoot);
    const streamingAssistant = started.find((node) => node.role === "assistant");
    setStreamingNodeId(streamingAssistant?.node_id ?? null);
    setPendingRetryOf(null);
    setToolTraces([]);
    submittedQuestionRef.current = null;
    setSubmittedQuestion(null);
    setPendingEdit(null);
    setRequestPhase("sent");
    const title = typeof message.data.title === "string" ? message.data.title : "";
    const cid = typeof message.data.conversation_id === "string" ? message.data.conversation_id : currentConversationId;
    if (cid) {
      setConversation((current) =>
        current && current.conversation_id === cid
          ? { ...current, title: title || current.title }
          : current
      );
      if (title) {
        setConversations((prev) =>
          prev.map((item) =>
            item.conversation_id === cid
              ? { ...item, title, updated_at: new Date().toISOString() }
              : item
          )
        );
      }
    }
    return;
  }

  if (message.event === "delegation_complete") {
    const info = parseDelegationInfo(message.data);
    setDelegationInfo(info);
    setRequestPhase("delegating");
    if (delegationPhaseTimerRef.current) {
      clearTimeout(delegationPhaseTimerRef.current);
    }
    delegationPhaseTimerRef.current = setTimeout(() => {
      setRequestPhase((current) => (current === "delegating" ? "delegated" : current));
      delegationPhaseTimerRef.current = setTimeout(() => {
        setRequestPhase((current) => (current === "delegated" ? null : current));
        delegationPhaseTimerRef.current = null;
      }, 450);
    }, 1200);
    return;
  }

  if (message.event === "tool_trace") {
    const trace = parseToolTrace(message.data);
    if (trace) {
      setToolTraces((current) => upsertToolTrace(current, trace));
      setTimeline((current) => attachTrace(current, trace, locale));
    }
    return;
  }

  if (
    message.event === "tool_call_started" ||
    message.event === "tool_call_completed" ||
    message.event === "tool_call_failed" ||
    message.event === "tool_call_skipped"
  ) {
    const callId = String(message.data.id ?? "");
    if (!callId) return;
    setRequestPhase(null);
    setTimeline((current) =>
      patchCall(
        current,
        callId,
        {
          name: String(message.data.name ?? ""),
          state:
            message.event === "tool_call_completed"
              ? "complete"
              : message.event === "tool_call_failed"
                ? "failed"
                : message.event === "tool_call_started"
                  ? "running"
                  : "skipped",
          ...(message.event === "tool_call_started" ? callArgs(message.data) : {}),
          result: typeof message.data.result === "string" ? message.data.result : undefined,
          error: typeof message.data.error === "string" ? message.data.error : undefined,
          reason: typeof message.data.reason === "string" ? message.data.reason : undefined,
        },
        locale
      )
    );
    return;
  }

  if (message.event === "discussion_message") {
    const parsed = parseDiscussionMessage(message.data);
    if (parsed) {
      setDiscussionMessages((current) => appendDiscussionMessage(current, parsed));
    }
    return;
  }

  if (message.event === "talking_active") {
    setRequestPhase(null);
    setTalkingActive(true);
    if (thinkingLabelRef.current) {
      clearTimeout(thinkingLabelRef.current);
      thinkingLabelRef.current = null;
    }
    setTimeline((current) => {
      const filtered = withoutTransientTimelineItems(current);
      return [...filtered, { id: "talking-active", title: t(locale).thinking.talking, body: "", raw: "", status: "talking" }];
    });
    return;
  }

  if (message.event === "thinking_active") {
    setRequestPhase(null);
    setTalkingActive(false);
    const now = Date.now();
    const STABLE_LABEL_WINDOW = 15000;
    const reuseLabel = lastThinkingLabelRef.current && now - lastThinkingActiveTimeRef.current < STABLE_LABEL_WINDOW;
    if (!reuseLabel) {
      if (thinkingLabelRef.current) {
        clearTimeout(thinkingLabelRef.current);
      }
      lastThinkingLabelRef.current = "";
      const { label: initialLabel } = nextThinkingLabel(locale, lastThinkingLabelRef.current);
      lastThinkingLabelRef.current = initialLabel;
    }
    lastThinkingActiveTimeRef.current = now;
    const displayedLabel = lastThinkingLabelRef.current;
    setTimeline((current) => {
      const filtered = withoutTransientTimelineItems(current);
      return [...filtered, { id: "thinking-active", title: displayedLabel, body: "", raw: "", status: "active" }];
    });
    if (!reuseLabel) {
      const scheduleLabelSwitch = () => {
        const delay = 22000 + Math.random() * 14000;
        thinkingLabelRef.current = setTimeout(() => {
          const { label: nextLabel } = nextThinkingLabel(locale, lastThinkingLabelRef.current);
          lastThinkingLabelRef.current = nextLabel;
          setTimeline((current) =>
            current.map((item) =>
              item.id === "thinking-active" ? {
                ...item,
                title: nextLabel
              } : item
            )
          );
          scheduleLabelSwitch();
        }, delay);
      };
      scheduleLabelSwitch();
    }
    return;
  }

  if (message.event === "summary_start") {
    const id = String(message.data.id ?? crypto.randomUUID());

    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    activeSummaryRef.current = id;
    rawBodyBySummary.current[id] = rawBodyBySummary.current[id] ?? "";
    sentenceQueueRef.current = [];
    timerElapsedRef.current = false;

    setTimeline((current) => upsertSummaryStart(current, id, t(locale).thinking.active));
    return;
  }

  if (message.event === "summary_title") {
    const id = String(message.data.id ?? "");
    const title = String(message.data.title ?? "Thinking");
    setTimeline((current) =>
      current.map((item) => (item.id === id ? { ...item, title, status: "streaming" } : item))
    );
    return;
  }

  if (message.event === "summary_delta") {
    const id = String(message.data.id ?? "");
    const delta = String(message.data.delta ?? "");

    rawBodyBySummary.current[id] = (rawBodyBySummary.current[id] ?? "") + delta;
    const raw = rawBodyBySummary.current[id];
    const earlyTitle = raw.match(/^###\s+(.+)\n/m)?.[1]?.trim();

    setTimeline((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, raw: item.raw + delta, body: markdownBody(item.raw + delta) };
        if (earlyTitle && (next.title === "Thinking" || next.title === t(locale).thinking.active)) {
          next.title = earlyTitle;
        }
        return next;
      })
    );

    processSentenceBuffer(id);
    return;
  }

  if (message.event === "summary_complete") {
    const id = String(message.data.id ?? "");
    const treeNodes = parseThinkingTreeNodes(message.data.tree_nodes);

    setTimeout(() => {
      const finalRaw = rawBodyBySummary.current[id] ?? "";
      if (finalRaw.trim()) {
        setTimeline((current) =>
          current.map((item) => {
            if (item.id !== id) return item;
            return { ...item, body: finalRaw.trim(), treeNodes };
          })
        );
      }

      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = null;
      }
    }, 3000);

    setTimeline((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "complete", treeNodes } : item))
    );
    return;
  }

  if (message.event === "thinking_complete") {
    const finalElapsed =
      elapsedMsToSeconds(typeof message.data.elapsed_ms === "number" ? message.data.elapsed_ms : undefined) ??
      streamContext?.slot.elapsed ??
      elapsedForSlot(null, elapsed);
    setThinkingComplete(true);
    setTalkingActive(false);
    setElapsed(finalElapsed);
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    if (thinkingLabelRef.current) {
      clearTimeout(thinkingLabelRef.current);
      thinkingLabelRef.current = null;
    }
    setTimeline((current) =>
      appendThinkingDoneNode(withoutTransientTimelineItems(current), locale, finalElapsed)
    );
    return;
  }

  if (message.event === "final_delta") {
    setRequestPhase(null);
    setFinalBody((current) => current + String(message.data.delta ?? ""));
    return;
  }

  if (message.event === "node_complete") {
    const completed = parseMessageNode(message.data.node);
    if (completed) {
      setNodesSynced((current) => upsertNode(current, completed));
    }
    if (typeof message.data.active_root_id === "string") {
      setActiveRootId(message.data.active_root_id);
    }
    const cid =
      typeof message.data.conversation_id === "string"
        ? message.data.conversation_id
        : currentConversationId;
    const completedTitle = typeof message.data.title === "string" ? message.data.title : null;
    if (cid) {
      setConversation((current) => {
        const now = new Date().toISOString();
        if (current && current.conversation_id === cid) {
          return {
            ...current,
            title: completedTitle ?? current.title,
            updated_at: now,
          };
        }
        return {
          conversation_id: cid,
          created_at: now,
          updated_at: now,
          title: completedTitle ?? "",
          expert_count: 0,
          nodes: [],
          active_root_id: null,
          active_path: [],
        };
      });
    }
    setStreamError(null);
    setRequestPhase(null);
    submittedQuestionRef.current = null;
    setSubmittedQuestion(null);
    setStreamingNodeId(null);
    setPendingRetryOf(null);
    setThinkingComplete(false);
    setTalkingActive(false);
    setFinalBody("");
    const finalElapsed =
      elapsedMsToSeconds(completed?.elapsed_ms) ?? streamContext?.slot.elapsed ?? Math.max(1, elapsed);
    setElapsed(finalElapsed);
    if (completed && completed.role === "assistant") {
      const timelineItems = timelineFromStageSummaries(
        completed.stage_summaries,
        locale,
        finalElapsed,
        completed.status === "cancelled",
        completed.tool_traces
      );
      // 抽屉当时开着，就用落盘的思考详情替换实时时间线，而不是把它清空
      if (timelineItems.length > 0 && drawerOpenRef.current) {
        setDrawerTimeline(timelineItems);
      }
    }
    setTimeline([]);
    if (pendingConvId) {
      setPendingConvId(null);
    }
    setLoading(false);
    void loadConversations();
    return;
  }

  if (message.event === "error") {
    const errorMessage = String(
      message.data.message ?? message.data.error ?? t(locale).ui.backendUnavailable
    );
    setLoading(false);
    setRequestPhase(null);
    setPendingEdit(null);
    const failedId = streamContext?.streamingNodeId ?? streamingNodeId;
    const failedNode = failedId
      ? streamContext?.slot.nodes.find((node) => node.node_id === failedId) ?? null
      : null;
    if (failedNode) {
      setNodesSynced((current) => upsertNode(current, failedNode));
      setStreamingNodeId(null);
      setStreamError(null);
    } else if (failedId) {
      setStreamingNodeId(null);
      setStreamError(null);
    } else {
      setStreamError(errorMessage);
    }
    submittedQuestionRef.current = null;
    setSubmittedQuestion(null);
    return;
  }
}
