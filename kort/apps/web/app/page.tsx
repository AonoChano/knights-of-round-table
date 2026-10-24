"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Brain,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  KeyRound,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  UserPlus,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { loadLocale, saveLocale, t, nextThinkingLabel, discussionLevels } from "./locale";
import { Markdown } from "../components/Markdown";
import { numberSources } from "../components/citation/sources";
import { ModelList } from "../components/models/ModelList";
import { ProfileIcon } from "../components/models/ProviderIcon";
import { modelsOf, pickDefaultModel } from "../components/models/managed";
import { API_BASE } from "../components/models/api";
import type { ProviderProfile, ProviderSecretStatus } from "../components/models/types";
import type { DiscussionLevel, Locale } from "./locale";
import { AgentStrip } from "../components/discussion/AgentStrip";
import { AgentGlyph } from "../components/agents/AgentGlyph";
import { DiscussionView } from "../components/discussion/DiscussionView";
import { MemoryPanel } from "../components/memory/MemoryPanel";
import { ThinkingTrace } from "../components/thinking/ThinkingTrace";
import type { TraceTool } from "../components/thinking/ThinkingTrace";
import { Composer } from "../components/composer/Composer";
import type {
  ComposerAttachmentItem,
  ComposerAttachmentPayload,
  ComposerModelMode,
  ComposerModelOption,
  ComposerProviderModelOption,
  WebSearchMode,
} from "../components/composer/Composer";
import { ConversationMap, mapTurns } from "../components/conversation/ConversationMap";
import { ConversationSearchDialog } from "../components/search/ConversationSearchDialog";
import type { SearchPick } from "../components/search/ConversationSearchDialog";
import { Sidebar } from "../components/page/Sidebar";
import { BrailleSpinner } from "../components/page/BrailleSpinner";
import { ConversationSkeleton } from "../components/page/ConversationSkeleton";
import { ConversationView } from "../components/page/ConversationView";
import { BranchNav } from "../components/page/BranchNav";
import { MessageActions } from "../components/page/MessageActions";
import { DiscussionModePicker } from "../components/page/DiscussionModePicker";
import { ThinkingDrawer } from "../components/page/ThinkingDrawer";
import { SettingsOverlay } from "../components/page/SettingsOverlay";
import { SkillPicker } from "../components/page/SkillPicker";
import { ProviderSelect } from "../components/page/ProviderSelect";
import { ExpertModal } from "../components/page/ExpertModal";
import { settingsTabIcons, AGENT_ROLE_OPTIONS, TRANSIENT_TIMELINE_IDS, DISCUSSION_LEVEL_KEY, DEEP_THINK_KEY, WEB_SEARCH_MODE_KEY, LEGACY_WEB_SEARCH_KEY, PREFERRED_AGENT_KEY, NORMAL_MODEL_KEY, DEVELOPER_MODE_KEY, LOG_LEVEL_KEY, DEFAULT_DISCUSSION_LEVEL, DEFAULT_LOCALE, DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, RequestTimeoutError, loadDiscussionLevel, saveDiscussionLevel, loadDeepThink, saveDeepThink, loadWebSearchMode, loadPreferredAgent, loadNormalModel, saveNormalModel, splitModelOptionId, loadDeveloperMode, saveDeveloperMode, loadLogLevel, saveLogLevel, fetchWithTimeout, logClientEvent, createEmptySlot, withoutTransientTimelineItems, upsertSummaryStart, callTitle, itemFromCall, itemFromTrace, attachTrace, patchCall, callArgs, mergeOrdered, dedupeTimelineItems, SENTENCE_BOUNDARY_RE, settingsTabs, cn, clientErrorMessage, isExpectedAbortError, parseThinkingTreeNodes, parseDelegatedAgents, parseDelegationInfo, parseDiscussionMessage, parseDiscussionMessages, appendDiscussionMessage, parseToolTrace, parseToolTraces, parseAttachments, upsertToolTrace, markdownTitle, markdownBody, truncateWords, formatDuration, thinkingElapsedLabel, elapsedMsToSeconds, nodeElapsedSeconds, randomNewChatPrompt, defaultNewChatPrompt, appendThinkingDoneNode, appendThinkingCancelledNode, timelineFromStageSummaries, activePathOf, activeLeafId, siblingIdsOf, upsertNode, parseMessageNode, parseSseChunk, extractSentences, randomDelay } from "./page-utils";
import type { ToolTrace, TimerHandle, ThinkingTreeNode, StageSummary, DelegatedAgent, DelegationInfo, MessageNode, ConversationResponse, ConversationListItem, BranchAttempt, PendingEdit, DiscussionMessage, DiscussionViewTarget, AgentView, LogLevel, DeveloperDiagnostics, SettingsTab, ToolCallView, TimelineItem, StreamEvent, StreamSlot } from "./page-types";
import { applyEventToSlot, handleStreamEvent, type StreamHandlerContext } from "./stream-events";
import { useChatResources } from "./use-chat-resources";

export default function HomePage() {
  return (
    <Suspense fallback={<main className="app-shell" />}>
      <HomeExperience />
    </Suspense>
  );
}

function HomeExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachmentItem[]>([]);
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [thinkingComplete, setThinkingComplete] = useState(false);
  const [finalBody, setFinalBody] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [talkingActive, setTalkingActive] = useState(false);
  const [discussionLevel, setDiscussionLevel] = useState<DiscussionLevel>(DEFAULT_DISCUSSION_LEVEL);
  const [deepThink, setDeepThink] = useState(false);
  const [customMaxRounds, setCustomMaxRounds] = useState<number | null>(null);
  const [conversationLoading, setConversationLoading] = useState(
    () => Boolean(searchParams.get("c"))
  );
  const [nodes, setNodes] = useState<MessageNode[]>([]);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [streamingNodeId, setStreamingNodeId] = useState<string | null>(null);
  const [pendingRetryOf, setPendingRetryOf] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);
  const [drawerTimeline, setDrawerTimeline] = useState<TimelineItem[] | null>(null);
  const [expertModalOpen, setExpertModalOpen] = useState(false);
  const [expertModalMode, setExpertModalMode] = useState<"create" | "edit">("create");
  const [editingAgent, setEditingAgent] = useState<AgentView | null>(null);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const {
    providers,
    providerSecretStatus,
    agents,
    agentsError,
    globalSkills,
    conversations,
    conversationsError,
    conversationsLoading,
    providersLoading,
    providerSecretsLoading,
    agentsLoading,
    developerMode,
    logLevel,
    developerStatus,
    developerDiagnostics,
    setProviders,
    setProviderSecretStatus,
    setAgents,
    setAgentsError,
    setGlobalSkills,
    setConversations,
    setConversationsError,
    setConversationsLoading,
    setProvidersLoading,
    setProviderSecretsLoading,
    setAgentsLoading,
    setDeveloperMode,
    setLogLevel,
    setDeveloperStatus,
    setDeveloperDiagnostics,
    clientLog,
    loadProviders,
    loadProviderSecretStatuses,
    loadAgents,
    loadSkills,
    loadDeveloperDiagnostics,
    updateServerLogLevel,
    createAgent,
    updateAgent,
    deleteAgent,
    loadConversations,
    refreshModels,
  } = useChatResources(locale);
  const [paused, setPaused] = useState(false);
  const [pauseFlash, setPauseFlash] = useState(false);
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newChatPrompt, setNewChatPrompt] = useState(() => defaultNewChatPrompt(DEFAULT_LOCALE));
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [requestPhase, setRequestPhase] = useState<StreamSlot["requestPhase"]>(null);
  const [delegationInfo, setDelegationInfo] = useState<DelegationInfo | null>(null);
  const [discussionMessages, setDiscussionMessages] = useState<DiscussionMessage[]>([]);
  const [discussionView, setDiscussionView] = useState<DiscussionViewTarget | null>(null);
  const [toolTraces, setToolTraces] = useState<ToolTrace[]>([]);
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("auto");
  const [preferredAgent, setPreferredAgent] = useState("");
  const [normalModel, setNormalModel] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMiss, setSearchMiss] = useState<string | null>(null);
  const [locateNodeId, setLocateNodeId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const thinkingLabelRef = useRef<TimerHandle | null>(null);
  const lastThinkingLabelRef = useRef("");
  const lastThinkingActiveTimeRef = useRef(0);

  const sentenceQueueRef = useRef<string[]>([]);
  const sentenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSummaryRef = useRef<string>("");
  const timerElapsedRef = useRef(false);
  // 流式回调在启动时就闭包了当时的 UI 状态，抽屉的开合要用 ref 才能读到最新值
  const drawerOpenRef = useRef(false);
  // 连续点选会话时，用序号丢弃迟到的响应，防止旧会话覆盖新会话
  const conversationLoadRef = useRef(0);
  const rawBodyBySummary = useRef<Record<string, string>>({});
  const timelineRef = useRef<TimelineItem[]>([]);
  const finalBodyRef = useRef("");
  const discussionMessagesRef = useRef<DiscussionMessage[]>([]);
  const nodesRef = useRef<MessageNode[]>([]);
  const submittedQuestionRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const delegationPhaseTimerRef = useRef<TimerHandle | null>(null);
  const slotMapRef = useRef<Map<string, StreamSlot>>(new Map());
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [slotVersion, setSlotVersion] = useState(0);
  const activeSlotIdRef = useRef<string | null>(null);
  const currentCidRef = useRef<string | null>(null);
  const preferencesReadyRef = useRef(false);
  const lastDiscussionOnLevelRef = useRef<DiscussionLevel>(DEFAULT_DISCUSSION_LEVEL);
  // 关闭搜索弹窗后把焦点还给打开它的那个控件
  const searchReturnRef = useRef<HTMLElement | null>(null);
  const searchMissTimerRef = useRef<TimerHandle | null>(null);
  const locateTimerRef = useRef<TimerHandle | null>(null);

  function getActiveSlot(): StreamSlot | null {
    if (!activeSlotId) return null;
    return slotMapRef.current.get(activeSlotId) ?? null;
  }

  function syncSlotToState(slot: StreamSlot) {
    setLoading(slot.loading);
    setElapsed(slot.elapsed);
    setThinkingComplete(slot.thinkingComplete);
    setFinalBody(slot.finalBody);
    setTimeline(slot.timeline);
    setNodesSynced(slot.nodes);
    setActiveRootId(slot.activeRootId);
    setStreamingNodeId(slot.streamingNodeId);
    setPendingRetryOf(slot.pendingRetryOf);
    setTalkingActive(slot.talkingActive);
    setDiscussionLevel(slot.discussionLevel);
    setDeepThink(slot.deepThink);
    setSubmittedQuestion(slot.submittedQuestion);
    setPendingEdit(slot.pendingEdit);
    setPendingConvId(slot.plannedConversationId);
    setConversation(slot.conversation);
    setPaused(slot.paused);
    setStreamError(slot.streamError);
    setRequestPhase(slot.requestPhase);
    setDelegationInfo(slot.delegationInfo);
    setDiscussionMessages(slot.discussionMessages);
    setToolTraces(slot.toolTraces);
    setDiscussionView(null);
  }

  function flushStateToSlot(slot: StreamSlot) {
    slot.loading = loading;
    slot.elapsed = elapsed;
    slot.thinkingComplete = thinkingComplete;
    slot.finalBody = finalBody;
    slot.timeline = timeline;
    slot.nodes = nodesRef.current;
    slot.activeRootId = activeRootId;
    slot.streamingNodeId = streamingNodeId;
    slot.pendingRetryOf = pendingRetryOf;
    slot.talkingActive = talkingActive;
    slot.discussionLevel = discussionLevel;
    slot.deepThink = deepThink;
    slot.paused = paused;
    slot.submittedQuestion = submittedQuestion;
    slot.pendingEdit = pendingEdit;
    slot.plannedConversationId = pendingConvId;
    slot.conversation = conversation;
    slot.streamError = streamError;
    slot.requestPhase = requestPhase;
    slot.delegationInfo = delegationInfo;
    slot.discussionMessages = discussionMessagesRef.current;
    slot.toolTraces = toolTraces;
  }

  function saveCurrentSlot() {
    if (!activeSlotId) return;
    const slot = slotMapRef.current.get(activeSlotId);
    if (!slot) return;
    flushStateToSlot(slot);
  }

  function setNodesSynced(nextValue: MessageNode[] | ((current: MessageNode[]) => MessageNode[])) {
    setNodes((current) => {
      const next = typeof nextValue === "function" ? nextValue(current) : nextValue;
      nodesRef.current = next;
      return next;
    });
  }

  function activateSlot(slotId: string) {
    // save current slot before switching
    if (activeSlotId && activeSlotId !== slotId) {
      const cur = slotMapRef.current.get(activeSlotId);
      if (cur) flushStateToSlot(cur);
    }
    const target = slotMapRef.current.get(slotId) ?? createEmptySlot();
    slotMapRef.current.set(slotId, target);
    activeSlotIdRef.current = slotId;
    setActiveSlotId(slotId);
    syncSlotToState(target);
    setSlotVersion((v) => v + 1);
  }

  function ensureSlotForSend(
    slotId: string,
    seed: { nodes: MessageNode[]; activeRootId: string | null } | null = null
  ): StreamSlot {
    // save current slot before switching
    if (activeSlotId && activeSlotId !== slotId) {
      const cur = slotMapRef.current.get(activeSlotId);
      if (cur) flushStateToSlot(cur);
    }
    const slot = createEmptySlot();
    const ac = new AbortController();
    slot.abortController = ac;
    slot.loading = true;
    slot.startedAt = Date.now();
    if (seed) {
      slot.nodes = seed.nodes;
      slot.activeRootId = seed.activeRootId;
    }
    slotMapRef.current.set(slotId, slot);
    activeSlotIdRef.current = slotId;
    setActiveSlotId(slotId);
    syncSlotToState(slot);
    setSlotVersion((v) => v + 1);
    return slot;
  }

  function clearSentenceState() {
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    if (thinkingLabelRef.current) {
      clearTimeout(thinkingLabelRef.current);
      thinkingLabelRef.current = null;
    }
    if (delegationPhaseTimerRef.current) {
      clearTimeout(delegationPhaseTimerRef.current);
      delegationPhaseTimerRef.current = null;
    }
    sentenceQueueRef.current = [];
    activeSummaryRef.current = "";
    timerElapsedRef.current = false;
    rawBodyBySummary.current = {};
  }

  function revealNextSentence(summaryId: string) {
    const queue = sentenceQueueRef.current;
    if (queue.length === 0) {
      timerElapsedRef.current = true;
      sentenceTimerRef.current = null;
      return;
    }

    const next = queue.shift()!;
    setTimeline((current) =>
      current.map((item) => {
        if (item.id !== summaryId) return item;
        return { ...item, body: item.body + next };
      })
    );

    sentenceTimerRef.current = setTimeout(() => {
      revealNextSentence(summaryId);
    }, randomDelay());
  }

  function processSentenceBuffer(summaryId: string) {
    const raw = rawBodyBySummary.current[summaryId] ?? "";
    const { sentences, remaining } = extractSentences(raw);

    if (sentences.length > 0) {
      sentenceQueueRef.current.push(...sentences);
      rawBodyBySummary.current[summaryId] = remaining;
    } else {
      rawBodyBySummary.current[summaryId] = raw;
    }

    if (timerElapsedRef.current && sentenceQueueRef.current.length > 0) {
      timerElapsedRef.current = false;
      revealNextSentence(summaryId);
      return;
    }

    if (sentenceTimerRef.current === null && sentenceQueueRef.current.length > 0) {
      timerElapsedRef.current = false;
      sentenceTimerRef.current = setTimeout(() => {
        revealNextSentence(summaryId);
      }, randomDelay());
    }
  }

  function resetConversation() {
    // save current slot state before resetting
    saveCurrentSlot();
    clearSentenceState();
    setConversation(null);
    setTimeline([]);
    setFinalBody("");
    setThinkingComplete(false);
    setElapsed(0);
    setDrawerOpen(false);
    setDrawerTimeline(null);
    setTalkingActive(false);
    setLoading(false);
    setSubmittedQuestion(null);
    setPendingEdit(null);
    setStreamError(null);
    setRequestPhase(null);
    setDelegationInfo(null);
    setDiscussionMessages([]);
    setToolTraces([]);
    setDiscussionView(null);
    setNodesSynced([]);
    setActiveRootId(null);
    setStreamingNodeId(null);
    setPendingRetryOf(null);
  }

  function fullReset() {
    // save current slot before creating a new view
    if (activeSlotId) {
      const cur = slotMapRef.current.get(activeSlotId);
      if (cur) {
        flushStateToSlot(cur);
        // if this slot was streaming, DON'T abort — let it run in background
        cur.plannedConversationId = null;
      }
    }
    slotMapRef.current.forEach((s, cid) => {
      if (!s.loading) slotMapRef.current.delete(cid);
    });
    resetConversation();
    // 新建对话要作废还在路上的历史会话请求，否则它晚到的数据会把骨架替换回旧会话
    conversationLoadRef.current += 1;
    setConversationLoading(false);
    setSubmittedQuestion(null);
    setNodesSynced([]);
    setActiveRootId(null);
    setStreamingNodeId(null);
    setPendingRetryOf(null);
    setActiveSlotId(null);
    setCurrentConversationId(null);
    setConversation(null);
    setDrawerTimeline(null);
    setNewChatPrompt(randomNewChatPrompt(locale));
    setSlotVersion((v) => v + 1);
    router.replace("/", { scroll: false });
  }

  useEffect(() => {
    const loadedLocale = loadLocale();
    const loadedLevel = loadDiscussionLevel();
    if (loadedLevel !== "off") lastDiscussionOnLevelRef.current = loadedLevel;
    setDiscussionLevel(loadedLevel);
    setDeepThink(loadDeepThink());
    setWebSearchMode(loadWebSearchMode());
    setPreferredAgent(loadPreferredAgent());
    setNormalModel(loadNormalModel());
    setDeveloperMode(loadDeveloperMode());
    setLogLevel(loadLogLevel());
    setLocale(loadedLocale);
    setNewChatPrompt(randomNewChatPrompt(loadedLocale));
    window.setTimeout(() => {
      preferencesReadyRef.current = true;
    }, 0);

    void loadProviders();
    void loadProviderSecretStatuses();
    void loadAgents();
    void loadSkills();
    void loadConversations();
    const cid = searchParams.get("c");
    if (cid) {
      void loadConversation(cid);
    }
  }, []);

  useEffect(() => {
    return () => clearSentenceState();
  }, []);

  useEffect(() => {
    activeSlotIdRef.current = activeSlotId;
  }, [activeSlotId]);

  useEffect(() => {
    currentCidRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    const handleResize = () => {
      if (window.innerWidth >= 1024) setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      // 设置面板、讨论舞台和思考抽屉占屏时不再叠一层弹窗
      if (settingsOpen || discussionView || drawerOpen) return;
      event.preventDefault();
      if (searchOpen) closeSearch();
      else openSearch();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, settingsOpen, discussionView, drawerOpen]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    finalBodyRef.current = finalBody;
  }, [finalBody]);

  useEffect(() => {
    discussionMessagesRef.current = discussionMessages;
  }, [discussionMessages]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    if (!loading || thinkingComplete) return;
    const slot = activeSlotId ? slotMapRef.current.get(activeSlotId) : null;
    // 以本轮开始的墙钟时间为准，避免首帧或事件批处理导致计时停在 0
    const startedAt = slot?.startedAt ?? Date.now() - elapsed * 1000;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [loading, thinkingComplete, activeSlotId]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveDiscussionLevel(discussionLevel);
  }, [discussionLevel]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveDeepThink(deepThink);
  }, [deepThink]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    localStorage.setItem(WEB_SEARCH_MODE_KEY, webSearchMode);
  }, [webSearchMode]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    if (preferredAgent) localStorage.setItem(PREFERRED_AGENT_KEY, preferredAgent);
    else localStorage.removeItem(PREFERRED_AGENT_KEY);
  }, [preferredAgent]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveNormalModel(normalModel);
  }, [normalModel]);

  useEffect(() => {
    if (discussionLevel !== "off") lastDiscussionOnLevelRef.current = discussionLevel;
  }, [discussionLevel]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveDeveloperMode(developerMode);
  }, [developerMode]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveLogLevel(logLevel);
    void updateServerLogLevel(logLevel);
  }, [logLevel]);

  useEffect(() => {
    if (!settingsOpen || settingsTab !== "developer" || developerDiagnostics) return;
    void loadDeveloperDiagnostics();
  }, [settingsOpen, settingsTab, developerDiagnostics]);

  async function loadConversation(conversationId: string): Promise<ConversationResponse | null> {
    const requestId = conversationLoadRef.current + 1;
    conversationLoadRef.current = requestId;
    const isCurrentRequest = () => conversationLoadRef.current === requestId;
    clientLog("info", "conversation detail load started", { conversationId });
    setUnreadConversationIds((current) => {
      if (!current.has(conversationId)) return current;
      const next = new Set(current);
      next.delete(conversationId);
      return next;
    });
    saveCurrentSlot();
    const existingSlot = slotMapRef.current.get(conversationId);
    const hasActiveStream = existingSlot && existingSlot.loading;

    if (hasActiveStream) {
      activateSlot(conversationId);
      setConversationLoading(false);
      setCurrentConversationId(conversationId);
      currentCidRef.current = conversationId;
      router.replace(`/?c=${conversationId}`, { scroll: false });
      clientLog("info", "conversation detail load skipped for active local stream", { conversationId });
      return existingSlot.conversation ?? null;
    }

    resetConversation();
    setNodesSynced([]);
    setActiveSlotId(conversationId);
    setSlotVersion((v) => v + 1);
    setCurrentConversationId(conversationId);
    currentCidRef.current = conversationId;
    router.replace(`/?c=${conversationId}`, { scroll: false });
    setConversationLoading(true);
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/conversations/${conversationId}`, {}, 6000);
      if (!isCurrentRequest()) return null;
      if (!response.ok) {
        if (response.status === 404) {
          setConversationLoading(false);
          const resumed = await resumeConversationStream(conversationId);
          if (!isCurrentRequest()) return null;
          if (resumed) return null;
          router.replace("/", { scroll: false });
          setCurrentConversationId(null);
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as ConversationResponse;
      if (!isCurrentRequest()) return null;
      if (!hasActiveStream) {
        setConversation(payload);
      } else {
        const slot = slotMapRef.current.get(conversationId);
        if (slot) {
          slot.conversation = payload;
          setConversation(payload);
        }
      }
      const restoredNodes = payload.nodes ?? [];
      setNodesSynced(restoredNodes);
      setActiveRootId(payload.active_root_id ?? null);
      const restoredPath = activePathOf(restoredNodes, payload.active_root_id ?? null);
      const lastAssistant = [...restoredPath].reverse().find((node) => node.role === "assistant");
      const restoredMessages = parseDiscussionMessages(lastAssistant?.discussion_messages);
      discussionMessagesRef.current = restoredMessages;
      setDiscussionMessages(restoredMessages);
      setDiscussionView(null);
      setConversationLoading(false);
      clientLog("info", "conversation detail load completed", {
        conversationId,
        nodes: restoredNodes.length,
      });
      if (restoredNodes.some((node) => node.status === "streaming")) {
        await resumeConversationStream(conversationId, {
          nodes: restoredNodes,
          activeRootId: payload.active_root_id ?? null,
        });
        return payload;
      }
      return payload;
    } catch (error) {
      if (!isCurrentRequest()) return null;
      const message =
        error instanceof RequestTimeoutError
          ? t(locale).ui.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, t(locale).ui.backendUnavailable);
      clientLog("error", "conversation detail load failed", { conversationId, error: message });
      return null;
    } finally {
      if (isCurrentRequest()) setConversationLoading(false);
    }
  }

  async function resumeConversationStream(
    conversationId: string,
    seed: { nodes: MessageNode[]; activeRootId: string | null } | null = null
  ): Promise<boolean> {
    clearSentenceState();
    const slot = ensureSlotForSend(conversationId, seed);
    const resumableNode = seed?.nodes.find(
      (node) => node.role === "assistant" && node.status === "streaming"
    );
    slot.streamingNodeId = resumableNode?.node_id ?? null;
    slot.pendingRetryOf = null;
    setStreamingNodeId(slot.streamingNodeId);
    setPendingRetryOf(null);
    const resumeTitle = t(locale).ui.resumeConversation;
    const now = new Date().toISOString();
    slot.submittedQuestion = null;
    slot.plannedConversationId = conversationId;
    slot.requestPhase = "sent";
    slot.delegationInfo = null;
    setCurrentConversationId(conversationId);
    currentCidRef.current = conversationId;
    setSubmittedQuestion(null);
    setFinalBody("");
    setTimeline([]);
    setToolTraces([]);
    setThinkingComplete(false);
    setLoading(true);
    setRequestPhase("sent");
    setDelegationInfo(null);
    setPendingConvId(conversationId);
    setConversations((prev) => {
      if (prev.some((item) => item.conversation_id === conversationId)) return prev;
      return [
        {
          conversation_id: conversationId,
          title: resumeTitle,
          created_at: now,
          updated_at: now,
          expert_count: 0,
        },
        ...prev,
      ];
    });

    try {
      clientLog("info", "conversation resume stream started", { conversationId });
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/stream`);
      clientLog("info", "conversation resume stream response", {
        conversationId,
        status: response.status,
        ok: response.ok,
      });
      if (!response.ok || !response.body) {
        slot.loading = false;
        setLoading(false);
        return false;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const read = await reader.read();
        done = read.done;
        buffer += decoder.decode(read.value, { stream: !done });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          clientLog("debug", "conversation resume stream event", {
            conversationId,
            event: event.event,
          });
          if (event.event === "branch_started") {
            const started = Array.isArray(event.data.nodes)
              ? event.data.nodes.map(parseMessageNode).filter((node): node is MessageNode => node !== null)
              : [];
            const startedQuestion = started.find((node) => node.role === "user")?.content;
            if (startedQuestion) {
              setConversations((prev) =>
                prev.map((item) =>
                  item.conversation_id === conversationId
                    ? { ...item, title: startedQuestion.slice(0, 30), updated_at: new Date().toISOString() }
                    : item
                )
              );
            }
          }
          const slotForEvent = slotMapRef.current.get(conversationId);
          const streamingIdBefore = slotForEvent?.streamingNodeId ?? null;
          if (slotForEvent) {
            applyEventToSlot(streamHandlerContext, slotForEvent, event);
          }
          if (activeSlotIdRef.current !== conversationId) {
            const bgSlot = slotMapRef.current.get(conversationId);
            if (bgSlot) {
              if (event.event === "node_complete") {
                setUnreadConversationIds((current) => {
                  const next = new Set(current);
                  next.add(conversationId);
                  return next;
                });
              }
            }
            continue;
          }
          handleStreamEvent(
            streamHandlerContext,
            event,
            slotForEvent ? { streamingNodeId: streamingIdBefore, slot: slotForEvent } : undefined
          );
        }
      }
      return true;
    } catch (error) {
      if (isExpectedAbortError(error)) return true;
      const message =
        error instanceof RequestTimeoutError
          ? t(locale).ui.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, t(locale).ui.backendUnavailable);
      clientLog("error", "conversation resume stream failed", { conversationId, error: message });
      return false;
    } finally {
      slot.loading = false;
      if (activeSlotIdRef.current === conversationId) {
        setLoading(false);
      }
      setSlotVersion((v) => v + 1);
    }
  }

  async function renameConversation(conversationId: string, newName: string) {
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newName }),
      });
      if (response.ok) {
        await loadConversations();
      }
    } catch {
      // silently fail
    }
  }

  async function deleteConversation(conversationId: string) {
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        if (conversation?.conversation_id === conversationId) {
          fullReset();
        }
        await loadConversations();
      }
    } catch {
      // silently fail
    }
  }

  async function cancelBackendConversation(conversationId: string) {
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/cancel`, {
        method: "POST",
        keepalive: true,
      });
      clientLog("debug", "conversation cancel request completed", {
        conversationId,
        status: response.status,
      });
    } catch (error) {
      clientLog("debug", "conversation cancel request failed", {
        conversationId,
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
    }
  }

  function pauseConversation() {
    const slot = getActiveSlot();
    if (!slot) return;

    clientLog("info", "conversation pause requested", {
      conversationId: activeSlotId,
    });

    flushStateToSlot(slot);
    slot.paused = true;
    setPaused(true);
    if (activeSlotId) {
      void cancelBackendConversation(activeSlotId);
    }

    setPauseFlash(true);
    window.setTimeout(() => setPauseFlash(false), 800);

    if (slot.abortController && !slot.abortController.signal.aborted) {
      try {
        slot.abortController.abort();
      } catch {
        // abort may throw in rare edge cases — ignore
      }
    }
    slot.abortController = null;

    clearSentenceState();

    if (slot.streamingNodeId) {
      slot.nodes = slot.nodes.map((node) =>
        node.node_id === slot.streamingNodeId
          ? { ...node, status: "cancelled" as const, content: slot.finalBody || node.content }
          : node
      );
      setNodesSynced(slot.nodes);
    }
    slot.streamingNodeId = null;
    slot.pendingRetryOf = null;
    slot.submittedQuestion = null;
    slot.pendingEdit = null;
    submittedQuestionRef.current = null;
    setSubmittedQuestion(null);
    setPendingEdit(null);
    slot.finalBody = "";
    setFinalBody("");
    slot.timeline = [];
    setTimeline([]);
    slot.thinkingComplete = false;
    setThinkingComplete(false);
    slot.talkingActive = false;
    setTalkingActive(false);
    slot.requestPhase = null;
    setRequestPhase(null);
    slot.discussionMessages = [];
    setDiscussionMessages([]);
    setDiscussionView(null);
    setStreamingNodeId(null);
    setPendingRetryOf(null);

    slot.loading = false;
    setLoading(false);

    // revert send button to airplane after brief flash
    window.setTimeout(() => {
      setPaused(false);
      slot.paused = false;
    }, 800);

    setSlotVersion((v) => v + 1);

    setPendingConvId(null);
  }

  function markStreamingNodeFailed(slot: StreamSlot, message: string) {
    if (!slot.streamingNodeId) return false;
    const failedId = slot.streamingNodeId;
    slot.nodes = slot.nodes.map((node) =>
      node.node_id === failedId
        ? { ...node, status: "error" as const, error: message, content: slot.finalBody || node.content }
        : node
    );
    slot.streamingNodeId = null;
    return true;
  }

  async function runBranch(attempt: BranchAttempt) {
    const isNewConversation = !currentConversationId;
    const convId = currentConversationId ?? crypto.randomUUID();
    const seed = isNewConversation
      ? { nodes: [] as MessageNode[], activeRootId: null }
      : { nodes: nodesRef.current, activeRootId };

    if (isNewConversation) {
      fullReset();
    } else {
      // save current slot state, then reset view for this continuation
      saveCurrentSlot();
      resetConversation();
    }

    clearSentenceState();
    setDrawerOpen(false);

    const slot = ensureSlotForSend(convId, seed);
    slot.lastBranch = attempt;
    slot.streamingNodeId = null;
    slot.pendingRetryOf = attempt.role === "assistant" ? attempt.parentId : null;
    slot.toolTraces = [];
    setToolTraces([]);
    setStreamingNodeId(null);
    setPendingRetryOf(slot.pendingRetryOf);
    setCurrentConversationId(convId);
    currentCidRef.current = convId;
    router.replace(`/?c=${convId}`, { scroll: false });
    const liveQuestion = attempt.role === "user" ? attempt.content : null;
    const pendingEdit = attempt.editOfNodeId
      ? { nodeId: attempt.editOfNodeId, content: attempt.content }
      : null;
    setSubmittedQuestion(liveQuestion);
    submittedQuestionRef.current = liveQuestion;
    setPendingEdit(pendingEdit);
    if (attempt.role === "user") {
      setInput("");
      setAttachments([]);
    }
    setLoading(true);
    setStreamError(null);

    const controller = slot.abortController!;
    slot.streamError = null;
    slot.submittedQuestion = liveQuestion;
    slot.pendingEdit = pendingEdit;
    slot.discussionLevel = discussionLevel;
    slot.deepThink = discussionLevel === "off" ? deepThink : false;
    slot.requestPhase = "sent";
    slot.delegationInfo = null;
    setRequestPhase("sent");
    setDelegationInfo(null);

    if (isNewConversation) {
      setConversations((prev) => [
        {
          conversation_id: convId,
          title:
            attempt.content.slice(0, 30) ||
            attempt.attachments?.find((file) => file.kind === "image")?.name.slice(0, 30) ||
            "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expert_count: 0,
        },
        ...prev,
      ]);
      setPendingConvId(convId);
      slot.plannedConversationId = convId;
    }

    try {
      clientLog("info", "conversation branch started", {
        conversationId: convId,
        isNewConversation,
        role: attempt.role,
        discussionLevel,
        deepThink: discussionLevel === "off" ? deepThink : false,
        webSearch: webSearchMode,
        preferredAgent: discussionLevel === "off" ? null : effectivePreferredAgent,
        modelOverride: discussionLevel === "off" ? effectiveNormalModel : null,
      });
      const body: Record<
        string,
        string | boolean | number | null | ComposerAttachmentPayload[] | { provider_profile: string; model: string }
      > = {
        parent_id: attempt.parentId,
        role: attempt.role,
        content: attempt.role === "user" ? attempt.content : "",
        level: discussionLevel,
        web_search: webSearchMode,
      };
      if (discussionLevel !== "off" && effectivePreferredAgent) {
        body.preferred_agent = effectivePreferredAgent;
      }
      if (attempt.attachments?.length) {
        body.attachments = attempt.attachments;
      }
      if (discussionLevel === "off") {
        body.deep_think = deepThink;
        const override = splitModelOptionId(effectiveNormalModel);
        if (override) {
          body.model_override = override;
        }
      }
      if (customMaxRounds !== null) {
        body.custom_max_rounds = customMaxRounds;
      }

      const response = await fetch(`${API_BASE}/api/conversations/${convId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clientLog("info", "conversation branch response", {
        conversationId: convId,
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      if (controller.signal.aborted) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      function streamEventHandler(message: StreamEvent) {
        clientLog("debug", "conversation stream event", {
          conversationId: convId,
          event: message.event,
        });
        const slotForEvent = slotMapRef.current.get(convId);
        const streamingIdBefore = slotForEvent?.streamingNodeId ?? null;
        if (slotForEvent) {
          applyEventToSlot(streamHandlerContext, slotForEvent, message);
        }
        if (activeSlotIdRef.current !== convId) {
          if (slotForEvent) {
            if (
              message.event === "thinking_complete" ||
              message.event === "node_complete" ||
              message.event === "error"
            ) {
              setSlotVersion((v) => v + 1);
            }
            if (message.event === "node_complete") {
              setUnreadConversationIds((current) => {
                const next = new Set(current);
                next.add(convId);
                return next;
              });
            }
          }
          return;
        }
        handleStreamEvent(
          streamHandlerContext,
          message,
          slotForEvent ? { streamingNodeId: streamingIdBefore, slot: slotForEvent } : undefined
        );
      }

      while (!done) {
        try {
          const read = await reader.read();
          done = read.done;
          buffer += decoder.decode(read.value, { stream: !done });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            streamEventHandler(event);
          }
        } catch (readError: unknown) {
          if (isExpectedAbortError(readError)) {
            done = true;
            break;
          }
          throw readError;
        }
      }
    } catch (e: unknown) {
      slot.pendingEdit = null;
      if (activeSlotIdRef.current === convId) setPendingEdit(null);
      if (isExpectedAbortError(e)) {
        clientLog("info", "conversation stream aborted by user", { conversationId: convId });
      } else {
        const message = clientErrorMessage(e, t(locale).ui.backendUnavailable);
        const nodeFailed = markStreamingNodeFailed(slot, message);
        if (!nodeFailed) slot.streamError = message;
        if (activeSlotIdRef.current === convId) {
          setNodesSynced(slot.nodes);
          setStreamingNodeId(null);
          setStreamError(nodeFailed ? null : message);
        }
        clientLog("error", "conversation stream failed", {
          conversationId: convId,
          error: message,
        });
      }
    } finally {
      slot.pendingEdit = null;
      if (activeSlotIdRef.current === convId) setPendingEdit(null);
      if (slot.streamingNodeId) {
        markStreamingNodeFailed(slot, t(locale).ui.backendUnavailable);
        if (activeSlotIdRef.current === convId) {
          setNodesSynced(slot.nodes);
          setStreamingNodeId(null);
        }
      }
      slot.loading = false;
      if (activeSlotIdRef.current === convId) {
        setLoading(false);
      }
      setSlotVersion((v) => v + 1);
      abortControllerRef.current = null;
      clientLog("debug", "conversation stream settled", { conversationId: convId });
    }
  }

  async function sendQuestion(files: ComposerAttachmentPayload[]) {
    const question = input.trim();
    const hasImage = files.some((file) => file.kind === "image");
    if ((!question && !hasImage) || loading) return;
    if (currentConversationId && !activeRootId) return;
    await runBranch({
      parentId: currentConversationId ? activeLeafId(nodesRef.current, activeRootId) : null,
      role: "user",
      content: question,
      attachments: files,
    });
  }

  async function submitEditedMessage(node: MessageNode, content: string) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;
    await runBranch({
      parentId: node.parent_id,
      role: "user",
      content: trimmed,
      attachments: node.attachments,
      editOfNodeId: node.node_id,
    });
  }

  async function retryMessage(userNode: MessageNode) {
    if (loading) return;
    await runBranch({ parentId: userNode.node_id, role: "assistant", content: "" });
  }

  async function selectBranch(nodeId: string, conversationIdArg?: string) {
    // 搜索跳转在 loadConversation 之后调用，这里的闭包还指着上一个会话，必须显式传入
    const conversationId = conversationIdArg ?? currentConversationId;
    if (!conversationId || loading) return;
    const previous = nodesRef.current;
    const previousRoot = activeRootId;
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/active-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ConversationResponse;
      setNodesSynced(payload.nodes);
      setActiveRootId(payload.active_root_id ?? null);
      setConversation(payload);
      const slot = slotMapRef.current.get(conversationId);
      if (slot) {
        slot.nodes = payload.nodes;
        slot.activeRootId = payload.active_root_id ?? null;
      }
      const path = activePathOf(payload.nodes, payload.active_root_id ?? null);
      const lastAssistant = [...path].reverse().find((node) => node.role === "assistant");
      const messages = parseDiscussionMessages(lastAssistant?.discussion_messages);
      discussionMessagesRef.current = messages;
      setDiscussionMessages(messages);
      setDiscussionView(null);
    } catch (error) {
      setNodesSynced(previous);
      setActiveRootId(previousRoot);
      clientLog("info", "branch switch failed", {
        conversationId,
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
    }
  }

  function scrollConversationNodeIntoView(nodeId: string) {
    const root = scrollRef.current;
    if (!root) return false;
    const target = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (!target) return false;
    // 系统级「减弱动效」下不做平滑滚动，直接定位到中间
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    return true;
  }

  // 高亮交给 React 状态：切分支会让行重新渲染，直接改 classList 会被下一次渲染抹掉
  function highlightConversationNode(nodeId: string) {
    setLocateNodeId(nodeId);
    if (locateTimerRef.current) clearTimeout(locateTimerRef.current);
    locateTimerRef.current = setTimeout(() => setLocateNodeId(null), 1700);
  }

  // 刚切会话/切分支时目标行还没进 DOM，逐帧等它出现，最多约半秒
  async function locateConversationNode(nodeId: string) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (scrollConversationNodeIntoView(nodeId)) {
        highlightConversationNode(nodeId);
        return true;
      }
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }
    return false;
  }

  function notifySearchMiss(message: string) {
    setSearchMiss(message);
    if (searchMissTimerRef.current) clearTimeout(searchMissTimerRef.current);
    searchMissTimerRef.current = setTimeout(() => setSearchMiss(null), 5000);
  }

  function openSearch() {
    if (searchOpen) return;
    searchReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    const origin = searchReturnRef.current;
    searchReturnRef.current = null;
    if (origin?.isConnected) origin.focus();
  }

  async function openSearchResult(pick: SearchPick) {
    setSearchOpen(false);
    searchReturnRef.current = null;
    try {
      const payload = await loadConversation(pick.conversation_id);
      if (!payload) {
        notifySearchMiss(tr.ui.conversationHistoryUnavailable);
        return;
      }
      if (!pick.node_id) return;
      const target = payload.nodes.find((node) => node.node_id === pick.node_id);
      if (!target) {
        notifySearchMiss(tr.search.targetMissing);
        return;
      }
      const path = activePathOf(payload.nodes, payload.active_root_id ?? null);
      if (!path.some((node) => node.node_id === pick.node_id)) {
        await selectBranch(pick.node_id, pick.conversation_id);
      }
      if (!(await locateConversationNode(pick.node_id))) {
        notifySearchMiss(tr.search.targetMissing);
      }
    } finally {
      // 跳转后焦点交给对话滚动区：触发搜索的那个元素可能已随会话切换被重建
      scrollRef.current?.focus();
    }
  }

const streamHandlerContext: StreamHandlerContext = {
    locale,
    elapsed,
    currentConversationId,
    streamingNodeId,
    pendingConvId,
    setNodesSynced,
    setActiveRootId,
    setStreamingNodeId,
    setPendingRetryOf,
    setToolTraces,
    setSubmittedQuestion,
    setPendingEdit,
    setRequestPhase,
    setConversation,
    setConversations,
    setDelegationInfo,
    setTimeline,
    setDiscussionMessages,
    setTalkingActive,
    setThinkingComplete,
    setElapsed,
    setFinalBody,
    setStreamError,
    setDrawerTimeline,
    setPendingConvId,
    setLoading,
    refs: {
      submittedQuestionRef,
      delegationPhaseTimerRef,
      thinkingLabelRef,
      lastThinkingLabelRef,
      lastThinkingActiveTimeRef,
      sentenceTimerRef,
      activeSummaryRef,
      rawBodyBySummary,
      sentenceQueueRef,
      timerElapsedRef,
      drawerOpenRef,
    },
    processSentenceBuffer,
    loadConversations,
    markStreamingNodeFailed,
  };

  
  const visibleTimeline = useMemo(() => {
    return dedupeTimelineItems(timeline);
  }, [timeline]);

  const hasRun = Boolean(submittedQuestion || loading || nodes.length > 0);
  const tr = t(locale);
  const hasDiscussion = discussionMessages.length > 0;

  /* 只列出真正能作答的席位：供应商启用、模型启用、密钥可用 */
  const modelOptions = useMemo<ComposerModelOption[]>(() => {
    const providersById = new Map(providers.map((provider) => [provider.provider_id, provider]));
    const options: ComposerModelOption[] = [];
    for (const agent of agents) {
      const provider = providersById.get(agent.provider_profile);
      if (!provider || !provider.enabled) continue;
      const model = agent.model || provider.default_model;
      if (!model) continue;
      const listed = provider.models.length
        ? provider.models.find((entry) => entry.id === model)
        : undefined;
      if (provider.models.length > 0 && !listed) continue;
      if (listed && !listed.enabled) continue;
      const secret = providerSecretStatus[provider.provider_id];
      if (provider.provider_type !== "ollama" && !secret?.configured && !secret?.env_configured) continue;
      options.push({ name: agent.name, label: agent.nickname || agent.name, model });
    }
    return options;
  }, [agents, providerSecretStatus, providers]);

  const effectivePreferredAgent = modelOptions.some((option) => option.name === preferredAgent)
    ? preferredAgent
    : "";

  useEffect(() => {
    if (!preferredAgent) return;
    if (agentsLoading || providersLoading || providerSecretsLoading) return;
    if (modelOptions.some((option) => option.name === preferredAgent)) return;
    setPreferredAgent("");
  }, [agentsLoading, modelOptions, preferredAgent, providerSecretsLoading, providersLoading]);

  /* 讨论关闭时选的是供应商自己的模型，与专家席位无关 */
  const providerModelOptions = useMemo<ComposerProviderModelOption[]>(() => {
    const options: ComposerProviderModelOption[] = [];
    const seen = new Set<string>();
    for (const provider of providers) {
      if (!provider.enabled) continue;
      const secret = providerSecretStatus[provider.provider_id];
      if (provider.provider_type !== "ollama" && !secret?.configured && !secret?.env_configured) continue;
      for (const model of modelsOf(provider)) {
        if (!model.enabled || !model.id) continue;
        const id = `${provider.provider_id}::${model.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        options.push({
          id,
          provider,
          label: model.label || model.id,
          model: model.id,
          capabilities: model.capabilities,
        });
      }
    }
    return options;
  }, [providerSecretStatus, providers]);

  const effectiveNormalModel = providerModelOptions.some((option) => option.id === normalModel)
    ? normalModel
    : "";

  useEffect(() => {
    if (!normalModel) return;
    if (providersLoading || providerSecretsLoading) return;
    if (providerModelOptions.some((option) => option.id === normalModel)) return;
    setNormalModel("");
  }, [normalModel, providerModelOptions, providerSecretsLoading, providersLoading]);

  function toggleDiscussionMode() {
    setDiscussionLevel((current) =>
      current === "off" ? lastDiscussionOnLevelRef.current : "off"
    );
  }

  const mapEntries = useMemo(
    () => mapTurns(activePathOf(nodes, activeRootId), tr.ui.mapUntitled),
    [activeRootId, nodes, tr.ui.mapUntitled]
  );
  const recentForSearch = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 8),
    [conversations]
  );

  const discussionSession = useMemo(() => {
    if (!discussionView) return null;
    if (discussionView.source === "live") {
      return {
        question: submittedQuestion ?? conversation?.title ?? "",
        messages: discussionMessages,
        agents: delegationInfo?.agents ?? [],
        streaming: loading,
      };
    }
    return {
      question: discussionView.question,
      messages: discussionView.node.discussion_messages ?? [],
      agents: discussionView.node.delegation?.agents ?? [],
      streaming: false,
    };
  }, [
    conversation?.title,
    delegationInfo?.agents,
    discussionMessages,
    discussionView,
    loading,
    submittedQuestion,
  ]);

  useEffect(() => {
    if (hasRun) return;
    setNewChatPrompt((current) => {
      if (t(locale).ui.newChatPrompts.includes(current)) return current;
      return randomNewChatPrompt(locale);
    });
  }, [hasRun, locale]);

  function toggleCurrentThinkingDrawer() {
    const wasShowingHistoryTimeline = drawerTimeline !== null;
    setDrawerTimeline(null);
    setDrawerOpen((current) => (wasShowingHistoryTimeline ? true : !current));
  }

  return (
    <main className="app-shell">
      {mobileSidebarOpen ? (
        <div className="mobile-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />
      ) : null}
      <Sidebar
        locale={locale}
        agents={agents}
        conversations={conversations}
        conversationsError={conversationsError}
        conversationsLoading={conversationsLoading}
        activeConversationId={currentConversationId}
        unreadConversationIds={unreadConversationIds}
        slotMapRef={slotMapRef}
        slotVersion={slotVersion}
        collapsed={sidebarCollapsed && !mobileSidebarOpen}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onNewConversation={() => {
          setMobileSidebarOpen(false);
          fullReset();
        }}
        onOpenSearch={openSearch}
        onSelectConversation={(id) => {
          setMobileSidebarOpen(false);
          void loadConversation(id);
        }}
        onRenameConversation={(id, name) => void renameConversation(id, name)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        openSettings={(tab) => {
          setMobileSidebarOpen(false);
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
      />

      <section className={cn("main-shell", !hasRun && "main-shell-empty")}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-sidebar-button"
              type="button"
              title={tr.ui.openSidebar}
              aria-label={tr.ui.openSidebar}
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <PanelLeftOpen size={18} aria-hidden="true" />
            </button>
            <DiscussionModePicker
              discussionLevel={discussionLevel}
              deepThink={deepThink}
              locale={locale}
              setDiscussionLevel={setDiscussionLevel}
              setDeepThink={setDeepThink}
              customMaxRounds={customMaxRounds}
              setCustomMaxRounds={setCustomMaxRounds}
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="small-button small-button-icon">
              <Share2 size={15} aria-hidden="true" />
              <span>{tr.ui.share}</span>
            </button>
          </div>
        </header>

        {discussionSession ? (
          <DiscussionView
            question={discussionSession.question}
            messages={discussionSession.messages}
            agents={discussionSession.agents}
            streaming={discussionSession.streaming}
            locale={locale}
            onBack={() => setDiscussionView(null)}
          />
        ) : (
          <>
            {searchMiss ? (
              <div className="search-miss" role="status" aria-live="polite">
                {searchMiss}
              </div>
            ) : null}
            <div className="conversation-scroll" ref={scrollRef} tabIndex={-1}>
              <ConversationMap turns={mapEntries} scrollRef={scrollRef} locale={locale} />
              <div className={cn("conversation-inner", !hasRun && !conversationLoading && "conversation-empty")}>
                {conversationLoading ? (
                  <ConversationSkeleton />
                ) : hasRun ? (
                  <ConversationView
                    nodes={nodes}
                    activeRootId={activeRootId}
                    streamingNodeId={streamingNodeId}
                    pendingRetryOf={pendingRetryOf}
                    loading={loading}
                    thinkingComplete={thinkingComplete}
                    elapsed={elapsed}
                    question={submittedQuestion}
                    pendingEdit={pendingEdit}
                    timeline={visibleTimeline}
                    toolTraces={toolTraces}
                    finalBody={finalBody}
                    streamError={streamError}
                    requestPhase={requestPhase}
                    delegationInfo={delegationInfo}
                    locale={locale}
                    liveDiscussion={discussionMessages}
                    locateNodeId={locateNodeId}
                    onToggleThinking={toggleCurrentThinkingDrawer}
                    onOpenLiveDiscussion={
                      hasDiscussion ? () => setDiscussionView({ source: "live" }) : undefined
                    }
                    onEditMessage={(node, content) => void submitEditedMessage(node, content)}
                    onRetryMessage={(userNode) => void retryMessage(userNode)}
                    onSelectBranch={(nodeId) => void selectBranch(nodeId)}
                    onOpenNodeDiscussion={(nodeQuestion, node) =>
                      setDiscussionView({ source: "node", question: nodeQuestion, node })
                    }
                    onViewNodeThinking={(node) => {
                      setDrawerTimeline(
                        timelineFromStageSummaries(
                          node.stage_summaries,
                          locale,
                          nodeElapsedSeconds(node),
                          node.status === "cancelled",
                          node.tool_traces
                        )
                      );
                      setDrawerOpen(true);
                    }}
                  />
                ) : (
                  <div className="new-chat-start">
                    <div className="new-chat-prompt">{newChatPrompt}</div>
                    <Composer
                      input={input}
                      loading={loading}
                      paused={paused}
                      pauseFlash={pauseFlash}
                      locale={locale}
                      setInput={setInput}
                      webSearchMode={webSearchMode}
                      setWebSearchMode={setWebSearchMode}
                      modelMode={discussionLevel === "off" ? "models" : "agents"}
                      modelOptions={modelOptions}
                      providerModelOptions={providerModelOptions}
                      modelValue={discussionLevel === "off" ? effectiveNormalModel : effectivePreferredAgent}
                      setModelValue={discussionLevel === "off" ? setNormalModel : setPreferredAgent}
                      discussionOn={discussionLevel !== "off"}
                      deepThink={deepThink}
                      onToggleDiscussion={toggleDiscussionMode}
                      attachments={attachments}
                      setAttachments={setAttachments}
                      onSubmit={(files) => void sendQuestion(files)}
                      onPause={pauseConversation}
                    />
                  </div>
                )}
              </div>
            </div>

            {hasRun || conversationLoading ? (
              <div className="composer-dock">
                {hasDiscussion && loading ? (
                  <div className="discussion-cta-row">
                    <button
                      type="button"
                      className="discussion-cta"
                      onClick={() => setDiscussionView({ source: "live" })}
                    >
                      <UsersRound size={14} aria-hidden="true" />
                      <span>{tr.room.watchLive}</span>
                      <span className="discussion-cta-count">{discussionMessages.length}</span>
                    </button>
                  </div>
                ) : null}
                <Composer
                  input={input}
                  loading={loading}
                  paused={paused}
                  pauseFlash={pauseFlash}
                  locale={locale}
                  setInput={setInput}
                  webSearchMode={webSearchMode}
                  setWebSearchMode={setWebSearchMode}
                  modelMode={discussionLevel === "off" ? "models" : "agents"}
                  modelOptions={modelOptions}
                  providerModelOptions={providerModelOptions}
                  modelValue={discussionLevel === "off" ? effectiveNormalModel : effectivePreferredAgent}
                  setModelValue={discussionLevel === "off" ? setNormalModel : setPreferredAgent}
                  discussionOn={discussionLevel !== "off"}
                  deepThink={deepThink}
                  onToggleDiscussion={toggleDiscussionMode}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  onSubmit={(files) => void sendQuestion(files)}
                  onPause={pauseConversation}
                />
              </div>
            ) : null}
          </>
        )}
      </section>

      {searchOpen ? (
        <ConversationSearchDialog
          locale={locale}
          recent={recentForSearch}
          onPick={(pick) => void openSearchResult(pick)}
          onClose={closeSearch}
        />
      ) : null}

      {drawerOpen ? (
        <ThinkingDrawer
          loading={loading}
          elapsed={elapsed}
          thinkingComplete={thinkingComplete}
          timeline={drawerTimeline ?? visibleTimeline}
          locale={locale}
          onClose={() => {
            setDrawerOpen(false);
            setDrawerTimeline(null);
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsOverlay
          agents={agents}
          agentsError={agentsError}
          agentsLoading={agentsLoading}
          globalSkills={globalSkills}
          providers={providers}
          providersLoading={providersLoading}
          secretStatus={providerSecretStatus}
          settingsTab={settingsTab}
          locale={locale}
          developerMode={developerMode}
          logLevel={logLevel}
          developerStatus={developerStatus}
          developerDiagnostics={developerDiagnostics}
          setLocale={setLocale}
          setDeveloperMode={setDeveloperMode}
          setLogLevel={setLogLevel}
          setSettingsOpen={setSettingsOpen}
          setSettingsTab={setSettingsTab}
          onModelsChanged={refreshModels}
          refreshDeveloperDiagnostics={() => void loadDeveloperDiagnostics()}
          onAddExpert={() => {
            setExpertModalMode("create");
            setEditingAgent(null);
            setExpertModalOpen(true);
          }}
          onEditExpert={(agent: AgentView) => {
            setExpertModalMode("edit");
            setEditingAgent(agent);
            setExpertModalOpen(true);
          }}
          onDeleteExpert={(name: string) => void deleteAgent(name)}
        />
      ) : null}

      {settingsOpen && expertModalOpen ? (
        <ExpertModal
          mode={expertModalMode}
          agent={editingAgent}
          providers={providers}
          globalSkills={globalSkills}
          locale={locale}
          onClose={() => setExpertModalOpen(false)}
          onSave={async (data) => {
            if (expertModalMode === "create") {
              await createAgent(data);
            } else if (editingAgent) {
              // The PUT contract takes identity from the path, so `name` is not an updatable field.
              const { name: agentName, ...updates } = data;
              await updateAgent(agentName, updates);
            }
          }}
        />
      ) : null}
    </main>
  );
}

