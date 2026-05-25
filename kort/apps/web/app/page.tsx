"use client";

import "katex/dist/katex.min.css";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { loadLocale, saveLocale, localeStatusText, t, nextThinkingLabel, initialThinkingLabel, BRAILLE_SPINNER } from "./locale";
import type { Locale } from "./locale";

type TimerHandle = ReturnType<typeof setTimeout>;

type ThinkingTreeNode = {
  id: string;
  title: string;
  summary: string;
};

type StageSummary = {
  id: string;
  stage: string;
  title: string;
  snippet: string;
  details: string;
  confidence: number;
  tree_nodes: ThinkingTreeNode[];
};

type FinalAnswer = {
  title: string;
  body: string;
  confidence: number;
  limitations: string[];
};

type ConversationRound = {
  round_id: string;
  created_at: string;
  question: string;
  stage_summaries: StageSummary[];
  final_answer: FinalAnswer;
};

type ConversationResponse = {
  conversation_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  expert_count: number;
  rounds: ConversationRound[];
};

type ConversationListItem = {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  expert_count: number;
};

type MessagePair = {
  question: string;
  timeline: TimelineItem[];
  finalBody: string;
};

type ProviderProfile = {
  provider_id: string;
  label: string;
  provider_type: string;
  base_url: string;
  api_style: string;
  default_model: string;
  env_key_name: string;
  enabled: boolean;
  capabilities: string[];
};

type AgentView = {
  name: string;
  nickname: string;
  role: string;
  provider_profile: string;
  model: string;
  system_prompt: string;
  allowed_global_skills: string[];
  disabled_global_skills: string[];
  private_skill_count: number;
  priority: number;
};

type ProviderConnectivityResponse = {
  provider_id: string;
  ok: boolean;
  status: "ready" | "disabled" | "missing_key" | "invalid_base_url" | "not_found";
  message: string;
};

type ProviderSecretStatus = {
  provider_id: string;
  configured: boolean;
};

type SettingsTab = "general" | "providers" | "experts" | "skills" | "data";
type DiscussionLevel = "off" | "auto" | "low" | "medium" | "high";

const DISCUSSION_LEVELS: Array<{
  id: DiscussionLevel;
  label: string;
  tag: string;
}> = [
  { id: "off", label: "关", tag: "讨论程度" },
  { id: "auto", label: "自动", tag: "博采众议" },
  { id: "low", label: "低", tag: "围炉夜话" },
  { id: "medium", label: "中", tag: "覆卮对弈" },
  { id: "high", label: "高", tag: "穷尽棋路" },
];

type ProviderTextField =
  | "label"
  | "provider_type"
  | "base_url"
  | "api_style"
  | "default_model"
  | "env_key_name";

type TimelineItem = {
  id: string;
  title: string;
  body: string;
  raw: string;
  status: "streaming" | "complete" | "active" | "done" | "talking";
};

type StreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

type StreamSlot = {
  abortController: AbortController | null;
  loading: boolean;
  elapsed: number;
  thinkingComplete: boolean;
  finalBody: string;
  timeline: TimelineItem[];
  talkingActive: boolean;
  discussionLevel: DiscussionLevel;
  submittedQuestion: string | null;
  plannedConversationId: string | null;
  deepThink: boolean;
  paused: boolean;
  conversation: ConversationResponse | null;
};

const DISCUSSION_LEVEL_KEY = "kort-discussion-level";
const DEEP_THINK_KEY = "kort-deep-think";
const DEFAULT_DISCUSSION_LEVEL: DiscussionLevel = "auto";
const DEFAULT_LOCALE: Locale = "zh-CN";

function loadDiscussionLevel(): DiscussionLevel {
  if (typeof window === "undefined") return DEFAULT_DISCUSSION_LEVEL;
  const stored = localStorage.getItem(DISCUSSION_LEVEL_KEY);
  return stored === "off" || stored === "auto" || stored === "low" || stored === "medium" || stored === "high"
    ? stored
    : DEFAULT_DISCUSSION_LEVEL;
}

function saveDiscussionLevel(level: DiscussionLevel): void {
  localStorage.setItem(DISCUSSION_LEVEL_KEY, level);
}

function loadDeepThink(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEEP_THINK_KEY) === "true";
}

function saveDeepThink(enabled: boolean): void {
  localStorage.setItem(DEEP_THINK_KEY, String(enabled));
}

function createEmptySlot(): StreamSlot {
  return {
    abortController: null,
    loading: false,
    elapsed: 0,
    thinkingComplete: false,
    finalBody: "",
    timeline: [],
    talkingActive: false,
    discussionLevel: loadDiscussionLevel(),
    submittedQuestion: null,
    plannedConversationId: null,
    deepThink: loadDeepThink(),
    paused: false,
    conversation: null,
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const SENTENCE_BOUNDARY_RE = /[。！？…；\n]+/g;

const fallbackProviders: ProviderProfile[] = [
  {
    provider_id: "deepseek",
    label: "DeepSeek",
    provider_type: "deepseek",
    base_url: "https://api.deepseek.com",
    api_style: "openai",
    default_model: "deepseek-chat",
    env_key_name: "DEEPSEEK_API_KEY",
    enabled: true,
    capabilities: ["chat", "reasoning"],
  },
];

function settingsTabs(locale: Locale): Array<{ id: SettingsTab; label: string }> {
  return [
    { id: "general", label: t(locale).ui.general },
    { id: "providers", label: t(locale).ui.providers },
    { id: "experts", label: t(locale).ui.experts },
    { id: "skills", label: t(locale).ui.skills },
    { id: "data", label: t(locale).ui.data },
  ];
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function markdownTitle(markdown: string, fallback: string) {
  const firstHeading = markdown.match(/^###\s+(.+)$/m);
  return firstHeading?.[1]?.trim() || fallback;
}

function markdownBody(markdown: string) {
  return markdown.replace(/^###[^\n]*\n*/m, "").trim();
}

function truncateWords(text: string, maxWords: number) {
  const cjk = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
  if (cjk.test(text)) {
    if (text.length <= maxWords * 3) return text;
    return text.slice(0, maxWords * 3) + "…";
  }
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes} min ${seconds}s`;
}

function parseSseChunk(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const part of parts) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }

    if (!dataLines.length) continue;
    try {
      events.push({ event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> });
    } catch {
      // Ignore malformed partial events; the remaining buffer will be retried.
    }
  }

  return { events, rest };
}

function extractSentences(text: string) {
  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const re = new RegExp(SENTENCE_BOUNDARY_RE.source, SENTENCE_BOUNDARY_RE.flags);
  re.lastIndex = 0;

  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const sentence = text.slice(lastIndex, end).trim();
    if (sentence) sentences.push(sentence);
    lastIndex = end;
  }

  const remaining = text.slice(lastIndex).trim();
  return { sentences, remaining };
}

function randomDelay() {
  return 1000 + Math.random() * 1000;
}

export default function HomePage() {
  return (
    <Suspense fallback={<main className="app-shell" />}>
      <HomeExperience />
    </Suspense>
  );
}

function HomeExperience() {
  const [input, setInput] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [providers, setProviders] = useState<ProviderProfile[]>(fallbackProviders);
  const [providerForms, setProviderForms] = useState<Record<string, ProviderProfile>>({});
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [providerSecretStatus, setProviderSecretStatus] = useState<Record<string, boolean>>({});
  const [providerStatus, setProviderStatus] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [globalSkills, setGlobalSkills] = useState<string[]>([]);
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
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [messagePairs, setMessagePairs] = useState<MessagePair[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);
  const [drawerTimeline, setDrawerTimeline] = useState<TimelineItem[] | null>(null);
  const [expertModalOpen, setExpertModalOpen] = useState(false);
  const [expertModalMode, setExpertModalMode] = useState<"create" | "edit">("create");
  const [editingAgent, setEditingAgent] = useState<AgentView | null>(null);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [paused, setPaused] = useState(false);
  const [pauseFlash, setPauseFlash] = useState(false);
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set());

  const router = useRouter();
  const searchParams = useSearchParams();

  const thinkingLabelRef = useRef<TimerHandle | null>(null);
  const lastThinkingLabelRef = useRef("");
  const lastThinkingActiveTimeRef = useRef(0);
  const brailleFrameRef = useRef(0);
  const brailleTimerRef = useRef<TimerHandle | null>(null);

  const sentenceQueueRef = useRef<string[]>([]);
  const sentenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSummaryRef = useRef<string>("");
  const timerElapsedRef = useRef(false);
  const rawBodyBySummary = useRef<Record<string, string>>({});
  const timelineRef = useRef<TimelineItem[]>([]);
  const finalBodyRef = useRef("");
  const submittedQuestionRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const slotMapRef = useRef<Map<string, StreamSlot>>(new Map());
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [slotVersion, setSlotVersion] = useState(0);
  const activeSlotIdRef = useRef<string | null>(null);
  const currentCidRef = useRef<string | null>(null);
  const preferencesReadyRef = useRef(false);

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
    setTalkingActive(slot.talkingActive);
    setDiscussionLevel(slot.discussionLevel);
    setDeepThink(slot.deepThink);
    setSubmittedQuestion(slot.submittedQuestion);
    setPendingConvId(slot.plannedConversationId);
    setConversation(slot.conversation);
    setPaused(slot.paused);
  }

  function flushStateToSlot(slot: StreamSlot) {
    slot.loading = loading;
    slot.elapsed = elapsed;
    slot.thinkingComplete = thinkingComplete;
    slot.finalBody = finalBody;
    slot.timeline = timeline;
    slot.talkingActive = talkingActive;
    slot.discussionLevel = discussionLevel;
    slot.deepThink = deepThink;
    slot.paused = paused;
    slot.submittedQuestion = submittedQuestion;
    slot.plannedConversationId = pendingConvId;
    slot.conversation = conversation;
  }

  function saveCurrentSlot() {
    if (!activeSlotId) return;
    const slot = slotMapRef.current.get(activeSlotId);
    if (!slot) return;
    flushStateToSlot(slot);
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

  function ensureSlotForSend(slotId: string): StreamSlot {
    // save current slot before switching
    if (activeSlotId && activeSlotId !== slotId) {
      const cur = slotMapRef.current.get(activeSlotId);
      if (cur) flushStateToSlot(cur);
    }
    const slot = createEmptySlot();
    const ac = new AbortController();
    slot.abortController = ac;
    slot.loading = true;
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
    if (brailleTimerRef.current) {
      clearInterval(brailleTimerRef.current);
      brailleTimerRef.current = null;
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
    setTalkingActive(false);
    setLoading(false);
    setSubmittedQuestion(null);
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
    setSubmittedQuestion(null);
    setMessagePairs([]);
    setActiveSlotId(null);
    setCurrentConversationId(null);
    setConversation(null);
    setDrawerTimeline(null);
    setSlotVersion((v) => v + 1);
    router.replace("/", { scroll: false });
  }

  useEffect(() => {
    setDiscussionLevel(loadDiscussionLevel());
    setDeepThink(loadDeepThink());
    setLocale(loadLocale());
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
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    finalBodyRef.current = finalBody;
  }, [finalBody]);

  useEffect(() => {
    if (!loading || thinkingComplete) return;

    const timer = window.setInterval(() => {
      setElapsed((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading, thinkingComplete]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveDiscussionLevel(discussionLevel);
  }, [discussionLevel]);

  useEffect(() => {
    if (!preferencesReadyRef.current) return;
    saveDeepThink(deepThink);
  }, [deepThink]);

  async function loadProviders() {
    try {
      const response = await fetch(`${API_BASE}/api/providers`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProviderProfile[];
      const next = payload.length ? payload : fallbackProviders;
      setProviders(next);
      setProviderForms(Object.fromEntries(next.map((item) => [item.provider_id, item])));
    } catch {
      setProviders(fallbackProviders);
      setProviderForms(Object.fromEntries(fallbackProviders.map((item) => [item.provider_id, item])));
    }
  }

  async function loadProviderSecretStatuses() {
    try {
      const response = await fetch(`${API_BASE}/api/provider-secrets`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProviderSecretStatus[];
      setProviderSecretStatus(Object.fromEntries(payload.map((item) => [item.provider_id, item.configured])));
    } catch {
      setProviderSecretStatus({});
    }
  }

  async function loadAgents() {
    try {
      const response = await fetch(`${API_BASE}/api/agents`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as AgentView[];
      setAgents(payload);
      setAgentsError(null);
    } catch (error) {
      setAgents([]);
      setAgentsError(error instanceof Error ? error.message : "无法连接后端 API");
    }
  }

  async function loadSkills() {
    try {
      const response = await fetch(`${API_BASE}/api/skills`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as string[];
      setGlobalSkills(payload);
    } catch {
      setGlobalSkills([]);
    }
  }

  async function createAgent(data: { name: string; nickname: string; role: string; provider_profile: string; model: string; system_prompt: string; allowed_global_skills: string[]; disabled_global_skills: string[]; priority: number }) {
    try {
      const response = await fetch(`${API_BASE}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) await loadAgents();
      else setAgentsError(`创建失败 HTTP ${response.status}`);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "创建请求失败");
    }
  }

  async function updateAgent(name: string, data: Record<string, unknown>) {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) await loadAgents();
      else setAgentsError(`更新失败 HTTP ${response.status}`);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "更新请求失败");
    }
  }

  async function deleteAgent(name: string) {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${name}`, { method: "DELETE" });
      if (response.ok) await loadAgents();
      else setAgentsError(`删除失败 HTTP ${response.status}`);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "删除请求失败");
    }
  }

  async function loadConversations() {
    try {
      const response = await fetch(`${API_BASE}/api/conversations`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ConversationListItem[];
      setConversations(payload);
    } catch {
      // keep existing conversations on fetch failure
    }
  }

  async function loadConversation(conversationId: string) {
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
    } else {
      resetConversation();
      setActiveSlotId(conversationId);
      setSlotVersion((v) => v + 1);
    }
    setMessagePairs([]);
    setCurrentConversationId(conversationId);
    router.replace(`/?c=${conversationId}`, { scroll: false });
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
      if (!response.ok) {
        if (response.status === 404) {
          const resumed = await resumeConversationStream(conversationId);
          if (resumed) return;
          router.replace("/", { scroll: false });
          setCurrentConversationId(null);
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as ConversationResponse;
      if (!hasActiveStream) {
        setConversation(payload);
      } else {
        const slot = slotMapRef.current.get(conversationId);
        if (slot) {
          slot.conversation = payload;
          setConversation(payload);
        }
      }
      if (payload.rounds?.length) {
        const pairs: MessagePair[] = payload.rounds.map((round) => {
          const timelineItems: TimelineItem[] = (round.stage_summaries ?? []).map((s) => ({
            id: s.id,
            title: markdownTitle(s.details, s.title),
            body: markdownBody(s.details),
            raw: s.details,
            status: "complete" as const,
          }));
          return {
            question: round.question,
            timeline: timelineItems,
            finalBody: round.final_answer.body,
          };
        });
        setMessagePairs(pairs);
      }
    } catch {
      // silently fail
    }
  }

  async function resumeConversationStream(conversationId: string): Promise<boolean> {
    clearSentenceState();
    const slot = ensureSlotForSend(conversationId);
    setCurrentConversationId(conversationId);
    currentCidRef.current = conversationId;
    setSubmittedQuestion(null);
    setFinalBody("");
    setTimeline([]);
    setThinkingComplete(false);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/stream`);
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
          if (event.event === "conversation_start") {
            const question = String(event.data.question ?? "");
            setSubmittedQuestion(question || null);
            submittedQuestionRef.current = question || null;
            continue;
          }
          if (activeSlotIdRef.current !== conversationId) {
            const bgSlot = slotMapRef.current.get(conversationId);
            if (bgSlot) {
              applyEventToSlot(bgSlot, event);
              if (event.event === "conversation_complete") {
                setUnreadConversationIds((current) => {
                  const next = new Set(current);
                  next.add(conversationId);
                  return next;
                });
              }
            }
            continue;
          }
          handleStreamEvent(event);
        }
      }
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return true;
      console.error(error);
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

  function pauseConversation() {
    const slot = getActiveSlot();
    if (!slot) return;

    slot.paused = true;
    setPaused(true);

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

    setTimeline((current) =>
      current.map((item) =>
        item.id === "thinking-active"
          ? { id: "thinking-done", title: t(locale).ui.cancelled, body: "", raw: "", status: "complete" as const }
          : item
      )
    );

    slot.loading = false;
    setLoading(false);

    // revert send button to airplane after brief flash
    window.setTimeout(() => {
      setPaused(false);
      slot.paused = false;
    }, 800);

    setSlotVersion((v) => v + 1);

    if (pendingConvId) {
      setConversations((prev) => prev.filter((c) => c.conversation_id !== pendingConvId));
      setPendingConvId(null);
    }
  }

  async function sendQuestion() {
    const question = input.trim();
    if (!question) return;

    const isNewConversation = !currentConversationId;
    const convId = currentConversationId ?? "pending";
    let streamSlotId = convId;

    if (isNewConversation) {
      fullReset();
    } else {
      // save current slot state, then reset view for this continuation
      saveCurrentSlot();
      resetConversation();
    }

    clearSentenceState();
    setDrawerOpen(false);

    const slot = ensureSlotForSend(convId);
    // preserve current conversation title in the view
    if (!isNewConversation) {
      setCurrentConversationId(currentConversationId);
    }
    setSubmittedQuestion(question);
    submittedQuestionRef.current = question;
    setInput("");
    setLoading(true);

    const controller = slot.abortController!;

    if (isNewConversation) {
      const placeholderId = "pending";
      setConversations((prev) => [
        {
          conversation_id: placeholderId,
          title: question.slice(0, 30),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expert_count: 0,
        },
        ...prev,
      ]);
      setPendingConvId(placeholderId);
      slot.plannedConversationId = placeholderId;
    }

    try {
      const body: Record<string, string | boolean> = { question, level: discussionLevel };
      if (discussionLevel === "off") {
        body.deep_think = deepThink;
      }
      if (!isNewConversation && currentConversationId) {
        body.conversation_id = currentConversationId;
      }

      const response = await fetch(`${API_BASE}/api/conversations/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      if (controller.signal.aborted) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      function streamEventHandler(message: StreamEvent) {
        if (message.event === "conversation_start") {
          const startedId = String(message.data.conversation_id ?? "");
          if (isNewConversation && startedId && startedId !== "pending") {
            const pendingSlot = slotMapRef.current.get("pending");
            if (pendingSlot) {
              slotMapRef.current.delete("pending");
              slotMapRef.current.set(startedId, pendingSlot);
              activeSlotIdRef.current = startedId;
              setActiveSlotId(startedId);
              streamSlotId = startedId;
            }
            setPendingConvId(startedId);
            setCurrentConversationId(startedId);
            currentCidRef.current = startedId;
            router.replace(`/?c=${startedId}`, { scroll: false });
            setConversations((prev) =>
              prev.map((item) =>
                item.conversation_id === "pending"
                  ? { ...item, conversation_id: startedId }
                  : item
              )
            );
          }
        }
        if (activeSlotIdRef.current !== streamSlotId) {
          const bgSlot = slotMapRef.current.get(streamSlotId);
          if (bgSlot) {
            applyEventToSlot(bgSlot, message);
            if (message.event === "conversation_start") return;
            if (
              message.event === "thinking_complete" ||
              message.event === "conversation_complete" ||
              message.event === "error"
            ) {
              setSlotVersion((v) => v + 1);
            }
            if (message.event === "conversation_complete") {
              setUnreadConversationIds((current) => {
                const next = new Set(current);
                next.add(streamSlotId);
                return next;
              });
            }
          }
          return;
        }
        handleStreamEvent(message);
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
          if (readError instanceof DOMException && readError.name === "AbortError") {
            done = true;
            break;
          }
          throw readError;
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // stream aborted by user — pauseConversation handles UI feedback
      } else if (e instanceof Error && /aborted|abort|paused/i.test(e.message)) {
        // fetch/read can surface browser-specific abort errors outside DOMException.
      } else {
        console.error(e);
      }
    } finally {
      slot.loading = false;
      if (activeSlotIdRef.current === streamSlotId) {
        setLoading(false);
      }
      setSlotVersion((v) => v + 1);
      abortControllerRef.current = null;
    }
  }

  function applyEventToSlot(slot: StreamSlot, message: StreamEvent) {
    if (message.event === "talking_active") {
      slot.talkingActive = true;
      slot.timeline = slot.timeline.filter(
        (item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"
      );
      slot.timeline = [...slot.timeline, { id: "talking-active", title: t(locale).thinking.talking, body: "", raw: "", status: "talking" }];
      return;
    }
    if (message.event === "thinking_active") {
      slot.talkingActive = false;
      const { label: initialLabel } = nextThinkingLabel(locale, "");
      slot.timeline = slot.timeline.filter(
        (item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"
      );
      slot.timeline = [...slot.timeline, { id: "thinking-active", title: initialLabel, body: "", raw: "", status: "active" }];
      return;
    }
    if (message.event === "summary_start") {
      const id = String(message.data.id ?? crypto.randomUUID());
      slot.timeline = [
        ...slot.timeline.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"),
        { id, title: "Thinking", body: "", raw: "", status: "streaming" as const },
      ];
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
        return { ...item, raw: item.raw + delta };
      });
      return;
    }
    if (message.event === "summary_complete") {
      const id = String(message.data.id ?? "");
      slot.timeline = slot.timeline.map((item) => {
        if (item.id !== id) return item;
        return { ...item, body: item.raw.trim(), status: "complete" as const };
      });
      return;
    }
    if (message.event === "thinking_complete") {
      slot.thinkingComplete = true;
      slot.loading = false;
      return;
    }
    if (message.event === "final_delta") {
      const delta = String(message.data.delta ?? "");
      slot.finalBody = slot.finalBody + delta;
      return;
    }
    if (message.event === "conversation_complete") {
      slot.finalBody = String(message.data.final_body ?? slot.finalBody);
      slot.loading = false;
      slot.thinkingComplete = true;
      slot.conversation = message.data as unknown as ConversationResponse;
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
      slot.loading = false;
      return;
    }
  }

  function handleStreamEvent(message: StreamEvent) {
    if (message.event === "talking_active") {
      setTalkingActive(true);
      if (thinkingLabelRef.current) {
        clearTimeout(thinkingLabelRef.current);
        thinkingLabelRef.current = null;
      }
      if (brailleTimerRef.current) {
        clearInterval(brailleTimerRef.current);
        brailleTimerRef.current = null;
      }
      setTimeline((current) => {
        const filtered = current.filter(
          (item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"
        );
        return [...filtered, { id: "talking-active", title: t(locale).thinking.talking, body: "", raw: "", status: "talking" }];
      });
      return;
    }

    if (message.event === "thinking_active") {
      setTalkingActive(false);
      const now = Date.now();
      const STABLE_LABEL_WINDOW = 10000;
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
        const filtered = current.filter(
          (item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"
        );
        return [...filtered, { id: "thinking-active", title: BRAILLE_SPINNER[0] + " " + displayedLabel, body: "", raw: "", status: "active" }];
      });
      brailleFrameRef.current = 0;
      if (brailleTimerRef.current) {
        clearInterval(brailleTimerRef.current);
      }
      brailleTimerRef.current = setInterval(() => {
        brailleFrameRef.current = (brailleFrameRef.current + 1) % BRAILLE_SPINNER.length;
        setTimeline((current) =>
          current.map((item) =>
            item.id === "thinking-active" ? {
              ...item,
              title: BRAILLE_SPINNER[brailleFrameRef.current] + " " + item.title.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/, "")
            } : item
          )
        );
      }, 120);
      if (!reuseLabel) {
        const scheduleLabelSwitch = () => {
          const delay = 10000 + Math.random() * 5000;
          thinkingLabelRef.current = setTimeout(() => {
            const { label: nextLabel } = nextThinkingLabel(locale, lastThinkingLabelRef.current);
            lastThinkingLabelRef.current = nextLabel;
            setTimeline((current) =>
              current.map((item) =>
                item.id === "thinking-active" ? {
                  ...item,
                  title: BRAILLE_SPINNER[brailleFrameRef.current] + " " + nextLabel
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
      rawBodyBySummary.current[id] = "";
      sentenceQueueRef.current = [];
      timerElapsedRef.current = false;

      setTimeline((current) => [
        ...current.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"),
        { id, title: "Thinking", body: "", raw: "", status: "streaming" },
      ]);
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
          if (earlyTitle && next.title === "Thinking") {
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

      setTimeout(() => {
        const finalRaw = rawBodyBySummary.current[id] ?? "";
        if (finalRaw.trim()) {
          setTimeline((current) =>
            current.map((item) => {
              if (item.id !== id) return item;
              return { ...item, body: finalRaw.trim() };
            })
          );
        }

        if (sentenceTimerRef.current) {
          clearTimeout(sentenceTimerRef.current);
          sentenceTimerRef.current = null;
        }
      }, 3000);

      setTimeline((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "complete" } : item))
      );
      return;
    }

    if (message.event === "thinking_complete") {
      setThinkingComplete(true);
      setTalkingActive(false);
      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = null;
      }
      if (thinkingLabelRef.current) {
        clearTimeout(thinkingLabelRef.current);
        thinkingLabelRef.current = null;
      }
      if (brailleTimerRef.current) {
        clearInterval(brailleTimerRef.current);
        brailleTimerRef.current = null;
      }
      const doneLabel = t(locale).thinking.done;
      setTimeline((current) => [
        ...current.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"),
        { id: "thinking-done", title: doneLabel, body: "", raw: "", status: "done" },
      ]);
      return;
    }

    if (message.event === "final_delta") {
      setFinalBody((current) => current + String(message.data.delta ?? ""));
      return;
    }

    if (message.event === "conversation_complete") {
      const conv = message.data as unknown as ConversationResponse;
      setConversation(conv);
      setCurrentConversationId(conv.conversation_id);
      const question = submittedQuestionRef.current;
      submittedQuestionRef.current = null;
      setSubmittedQuestion(null);
      setTimeline([]);
      setFinalBody("");
      if (question && conv.rounds.length > 0) {
        const lastRound = conv.rounds[conv.rounds.length - 1];
        const timelineItems: TimelineItem[] = (lastRound.stage_summaries ?? []).map((s) => ({
          id: s.id,
          title: markdownTitle(s.details, s.title),
          body: markdownBody(s.details),
          raw: s.details,
          status: "complete" as const,
        }));
        setMessagePairs((prev) => [
          ...prev,
          {
            question: lastRound.question,
            timeline: timelineItems,
            finalBody: lastRound.final_answer.body,
          },
        ]);
      }
      if (pendingConvId) {
        setPendingConvId(null);
      }
      void loadConversations();
    }
  }

  async function saveProvider(providerId: string) {
    const provider = providerForms[providerId];
    if (!provider) return;

    setProviderStatus((current) => ({ ...current, [providerId]: "正在保存配置..." }));
    const response = await fetch(`${API_BASE}/api/providers/${providerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: provider.label,
        provider_type: provider.provider_type,
        base_url: provider.base_url,
        api_style: provider.api_style,
        default_model: provider.default_model,
        env_key_name: provider.env_key_name,
        enabled: provider.enabled,
        capabilities: provider.capabilities,
      }),
    });

    setProviderStatus((current) => ({
      ...current,
      [providerId]: response.ok ? "非敏感配置已保存" : "配置保存失败，请检查字段",
    }));
    await loadProviders();
  }

  async function saveProviderSecret(providerId: string) {
    const apiKey = providerKeys[providerId];
    if (!apiKey?.trim()) {
      setProviderStatus((current) => ({ ...current, [providerId]: "请先输入 API Key" }));
      return;
    }

    setProviderStatus((current) => ({ ...current, [providerId]: "正在保存 API Key..." }));
    const response = await fetch(`${API_BASE}/api/providers/${providerId}/secret`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (response.ok) {
      setProviderKeys((current) => ({ ...current, [providerId]: "" }));
      setProviderSecretStatus((current) => ({ ...current, [providerId]: true }));
      setProviderStatus((current) => ({ ...current, [providerId]: "API Key 已保存到本地运行时" }));
      return;
    }
    setProviderStatus((current) => ({ ...current, [providerId]: "API Key 保存失败" }));
  }

  async function testProvider(providerId: string) {
    const provider = providerForms[providerId];
    const apiKey = providerKeys[providerId];
    if (!provider) return;

    setProviderStatus((current) => ({ ...current, [providerId]: "正在测试..." }));
    const response = await fetch(`${API_BASE}/api/providers/${providerId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey || null }),
    });
    const payload = (await response.json()) as ProviderConnectivityResponse;
    setProviderStatus((current) => ({
      ...current,
      [providerId]: response.ok ? localeStatusText(locale, payload.message) : locale === "zh-CN" ? "测试失败，请检查后端服务" : "Test failed, check backend service",
    }));
  }

  const visibleTimeline = useMemo(() => {
    return timeline;
  }, [timeline]);

  const currentReasoning = [...visibleTimeline].reverse().find(
    (item) => item.status === "streaming" || item.status === "complete"
  );
  const statusItem = visibleTimeline.find(
    (item) => item.status === "active" || item.status === "talking" || item.status === "done"
  );
  const activeTitle = statusItem?.title ?? currentReasoning?.title ?? (thinkingComplete ? t(locale).thinking.complete : t(locale).thinking.active);
  const hasRun = Boolean(submittedQuestion || conversation || loading || messagePairs.length > 0);

  return (
    <main className="app-shell">
      <Sidebar
        agents={agents}
        conversations={conversations}
        activeConversationId={currentConversationId}
        unreadConversationIds={unreadConversationIds}
        slotMapRef={slotMapRef}
        slotVersion={slotVersion}
        onNewConversation={fullReset}
        onSelectConversation={(id) => void loadConversation(id)}
        onRenameConversation={(id, name) => void renameConversation(id, name)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        openSettings={(tab) => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
      />

      <section className="main-shell">
        <header className="topbar">
          <button className="brand-button" onClick={fullReset}>
            <span>Round Table</span>
            <small>ready</small>
          </button>
          <div className="flex items-center gap-2">
            <button className="small-button">分享</button>
          </div>
        </header>

        <div className="conversation-scroll">
          <div className={cn("conversation-inner", !hasRun && "conversation-empty")}>
            {hasRun ? (
              <ConversationView
                conversation={conversation}
                loading={loading}
                thinkingComplete={thinkingComplete}
                elapsed={elapsed}
                question={submittedQuestion}
                timeline={visibleTimeline}
                finalBody={finalBody}
                messagePairs={messagePairs}
                locale={locale}
                onToggleThinking={() => setDrawerOpen((prev) => !prev)}
                onViewPairThinking={(pair) => {
                  setDrawerTimeline(pair.timeline);
                  setDrawerOpen(true);
                }}
              />
            ) : (
              <div className="new-chat-prompt">{t(locale).ui.newChatPrompt}</div>
            )}
          </div>
        </div>

        <div className="composer-dock">
          <Composer
            input={input}
            loading={loading}
            paused={paused}
            pauseFlash={pauseFlash}
            discussionLevel={discussionLevel}
            deepThink={deepThink}
            locale={locale}
            setInput={setInput}
            setDiscussionLevel={setDiscussionLevel}
            setDeepThink={setDeepThink}
            onSubmit={() => void sendQuestion()}
            onPause={pauseConversation}
          />
        </div>

        {(loading || conversation || submittedQuestion) && !drawerOpen ? (
          <button className="thinking-trigger" onClick={() => setDrawerOpen((prev) => !prev)} aria-label="Toggle thinking timeline">
            <span className="breathing-dot h-1.5 w-1.5 rounded-full bg-ink/55" />
            <span>{activeTitle}</span>
          </button>
        ) : null}
      </section>

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
          globalSkills={globalSkills}
          providers={providers}
          providerForms={providerForms}
          providerKeys={providerKeys}
          providerSecretStatus={providerSecretStatus}
          providerStatus={providerStatus}
          settingsTab={settingsTab}
          locale={locale}
          setLocale={setLocale}
          setProviderForms={setProviderForms}
          setProviderKeys={setProviderKeys}
          setSettingsOpen={setSettingsOpen}
          setSettingsTab={setSettingsTab}
          saveProvider={saveProvider}
          saveProviderSecret={saveProviderSecret}
          testProvider={testProvider}
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
          onClose={() => setExpertModalOpen(false)}
          onSave={async (data) => {
            if (expertModalMode === "create") {
              await createAgent(data);
            } else if (editingAgent) {
              await updateAgent(editingAgent.name, data as Record<string, unknown>);
            }
          }}
        />
      ) : null}
    </main>
  );
}

function Sidebar({
  agents,
  conversations,
  activeConversationId,
  unreadConversationIds,
  slotMapRef,
  slotVersion,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  openSettings,
}: {
  agents: AgentView[];
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  unreadConversationIds: Set<string>;
  slotMapRef: React.MutableRefObject<Map<string, StreamSlot>>;
  slotVersion: number;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, name: string) => void;
  onDeleteConversation: (id: string) => void;
  openSettings: (tab: SettingsTab) => void;
}) {
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

  const grouped = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);

    const groups: { label: string; items: ConversationListItem[] }[] = [
      { label: "今天", items: [] },
      { label: "昨天", items: [] },
      { label: "更早", items: [] },
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
  }, [conversations]);

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

  function confirmDelete() {
    if (confirmDeleteId) {
      onDeleteConversation(confirmDeleteId);
    }
    setConfirmDeleteId(null);
  }

  return (
    <aside className="sidebar">
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="logo-mark">K</div>
        </div>
        <button className="sidebar-primary" onClick={onNewConversation}>
          新建对话
        </button>
        <div className="space-y-1">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1 text-xs text-muted">{group.label}</div>
              {group.items.map((item) => (
                <div key={item.conversation_id} className="sidebar-link-row">
                  {loadingConvIds.has(item.conversation_id) && activeConversationId !== item.conversation_id ? (
                    <span className="sidebar-status-indicator">
                      <span className="sidebar-spinner" />
                    </span>
                  ) : unreadConversationIds.has(item.conversation_id) ? (
                    <span className="sidebar-status-indicator">
                      <span className="sidebar-unread-dot" />
                    </span>
                  ) : null}
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
                      className={cn(
                        "sidebar-link",
                        activeConversationId === item.conversation_id && "sidebar-link-active"
                      )}
                      onClick={() => onSelectConversation(item.conversation_id)}
                    >
                      {item.title}
                    </button>
                  )}
                  <span className="sidebar-link-actions">
                    <button
                      className="sidebar-link-action-btn"
                      title="更多"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuConversationId((current) => current === item.conversation_id ? null : item.conversation_id);
                      }}
                    >
                      ···
                    </button>
                  </span>
                  {menuConversationId === item.conversation_id ? (
                    <div
                      className="conversation-menu"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button className="conversation-menu-item" onClick={(e) => { startRename(item, e); closeMenu(); }}>
                        <span>✎</span>
                        <span>重命名</span>
                      </button>
                      <button className="conversation-menu-item conversation-menu-danger" onClick={(e) => { handleDeleteClick(item, e); closeMenu(); }}>
                        <span>⌫</span>
                        <span>删除</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted">暂无对话历史</div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <button className="sidebar-primary group" onClick={() => openSettings("experts")}>
          <div className="flex items-center justify-between">
            <span>Discussion ready</span>
            <span className="breathing-dot h-1.5 w-1.5 rounded-full bg-[#2f7d32]" />
          </div>
          <div className="mt-2 hidden text-xs leading-5 text-muted group-hover:block">
            {agents.length || 0} profiles available
          </div>
        </button>
        <button className="sidebar-user" onClick={() => openSettings("general")}>
          <div className="avatar-button">A</div>
          <div className="text-left">
            <div className="text-sm font-medium">Alex</div>
            <div className="text-xs text-muted">Settings</div>
          </div>
        </button>
      </div>

      {confirmDeleteId ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="sidebar-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm mb-3">确定要删除这个对话吗？</div>
            <div className="flex gap-2 justify-end">
              <button className="small-button" onClick={() => setConfirmDeleteId(null)}>取消</button>
              <button className="small-button-primary" onClick={confirmDelete}>删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ConversationView({
  conversation,
  loading,
  thinkingComplete,
  elapsed,
  question,
  timeline,
  finalBody,
  messagePairs,
  locale,
  onToggleThinking,
  onViewPairThinking,
}: {
  conversation: ConversationResponse | null;
  loading: boolean;
  thinkingComplete: boolean;
  elapsed: number;
  question: string | null;
  timeline: TimelineItem[];
  finalBody: string;
  messagePairs: MessagePair[];
  locale: Locale;
  onToggleThinking: () => void;
  onViewPairThinking: (pair: MessagePair) => void;
}) {
  const tr = t(locale);

  function renderTurn(pair: MessagePair, idx: number) {
    const cleanBody = markdownBody(pair.finalBody) || pair.finalBody;
    const hasTimeline = pair.timeline.length > 0;
    const wasCancelled = hasTimeline && !cleanBody;
    return (
      <div key={`turn-${idx}`} className="conversation-stack">
        <div className="user-message">{pair.question}</div>
        <div className="assistant-row">
          <div className="assistant-content">
            {hasTimeline ? (
              <button className="thinking-block" onClick={() => onViewPairThinking(pair)}>
                <span className="thinking-title">
                  {pair.timeline[pair.timeline.length - 1]?.title ?? tr.thinking.complete}
                </span>
              </button>
            ) : null}
            {cleanBody ? (
              <div className="answer-body markdown-body mt-2">
                <Markdown content={cleanBody} />
              </div>
            ) : wasCancelled ? (
              <div className="cancelled-badge mt-2 text-xs text-muted">{tr.ui.cancelled}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const latest = [...timeline].reverse().find(
    (item) => item.status === "streaming" || item.status === "complete"
  );
  const statusItem = timeline.find(
    (item) => item.status === "active" || item.status === "talking" || item.status === "done"
  );
  const lastCompleteTitle = [...timeline].reverse().find(
    (item) => item.status === "complete"
  )?.title;
  const hasActiveTimelineItems = timeline.some((item) => item.status !== "complete");
  const isHistoryView = Boolean(conversation && !loading && !hasActiveTimelineItems);
  const isDone = thinkingComplete || statusItem?.status === "done";
  const showPreview = latest && latest.body.trim();
  const showCurrentTurn = !isHistoryView && (question || timeline.length > 0 || finalBody);
  const previewTitle = lastCompleteTitle ?? statusItem?.title ?? latest?.title ?? tr.thinking.active;
  const previewBody = latest ? markdownBody(latest.body) : "";

  return (
    <div>
      {messagePairs.map((pair, idx) => renderTurn(pair, idx))}

      {showCurrentTurn ? (
        <div className="conversation-stack">
          {question ? <div className="user-message">{question}</div> : null}

          <div className="assistant-row">
            <div className="assistant-content">
              <button className="thinking-block" onClick={onToggleThinking}>
                <span className={cn("thinking-title", !isDone && "thinking-title-active")}>
                  {isDone
                    ? `${tr.thinking.complete}（${locale === "zh-CN" ? "总用时：" : ""}${formatDuration(elapsed)}）`
                    : previewTitle}
                </span>
              </button>

              {showPreview && previewBody ? (
                <div className="thinking-preview markdown-body">
                  <Markdown content={truncateWords(previewBody, 20)} />
                </div>
              ) : null}

              {finalBody ? (
                <div className="answer-body markdown-body">
                  <Markdown content={finalBody} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {content}
    </ReactMarkdown>
  );
}

function Composer({
  input,
  loading,
  paused,
  pauseFlash,
  discussionLevel,
  deepThink,
  locale,
  setInput,
  setDiscussionLevel,
  setDeepThink,
  onSubmit,
  onPause,
}: {
  input: string;
  loading: boolean;
  paused: boolean;
  pauseFlash: boolean;
  discussionLevel: DiscussionLevel;
  deepThink: boolean;
  locale: Locale;
  setInput: Dispatch<SetStateAction<string>>;
  setDiscussionLevel: Dispatch<SetStateAction<DiscussionLevel>>;
  setDeepThink: Dispatch<SetStateAction<boolean>>;
  onSubmit: () => void;
  onPause: () => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const active = DISCUSSION_LEVELS.find((d) => d.id === discussionLevel) ?? DISCUSSION_LEVELS[0];
  const isActive = discussionLevel !== "off";

  return (
    <div className="composer-shell">
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !loading) {
            event.preventDefault();
            onSubmit();
          }
        }}
        rows={3}
        className="max-h-40 min-h-20 w-full resize-none border-0 bg-transparent text-[15px] leading-7 outline-none"
        placeholder={t(locale).ui.composerPlaceholder}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              className={cn("discussion-level-trigger", isActive && "discussion-level-trigger-active")}
              onClick={() => setDropdownOpen((prev) => !prev)}
              type="button"
            >
              {active.tag}
            </button>
            {dropdownOpen ? (
              <div className="discussion-level-dropdown">
                {DISCUSSION_LEVELS.map((level) => (
                  <button
                    key={level.id}
                    className="discussion-level-option"
                    onClick={() => {
                      setDiscussionLevel(level.id);
                      setDropdownOpen(false);
                    }}
                  >
                    <span className="discussion-level-label">{level.label}</span>
                    <span className="discussion-level-tag">{level.id !== "off" ? level.tag : ""}</span>
                    {discussionLevel === level.id ? (
                      <span className="discussion-level-check">✓</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {discussionLevel === "off" ? (
            <button
              className={cn(
                "discussion-level-trigger",
                deepThink && "discussion-level-trigger-active"
              )}
              onClick={() => setDeepThink((prev) => !prev)}
              type="button"
              title={t(locale).ui.deepThink}
            >
              {t(locale).ui.deepThink}
              {deepThink ? (
                <span className="discussion-level-check" style={{ marginLeft: 4 }}>✓</span>
              ) : null}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cn(
              "send-button",
              paused && pauseFlash && "send-button-pause-flash",
              paused && !pauseFlash && "send-button-paused"
            )}
            onClick={
              paused ? undefined : (loading ? onPause : onSubmit)
            }
            disabled={paused || (!loading && !input.trim())}
            type="button"
            aria-label={loading ? (locale === "zh-CN" ? "停止生成" : "Stop") : (locale === "zh-CN" ? "发送" : "Send")}
            title={loading ? (locale === "zh-CN" ? "停止生成" : "Stop") : (locale === "zh-CN" ? "发送" : "Send")}
          >
            {paused ? (
              <span className="pause-status-text">{t(locale).ui.paused}</span>
            ) : loading ? (
              <span className="send-button-stop-icon" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThinkingDrawer({
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
  return (
    <aside className="thinking-drawer">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold">{tr.ui.thinkingProcess}</div>
          <div className="mt-1 text-xs text-muted">
            {thinkingComplete
              ? `${tr.thinking.complete}（${locale === "zh-CN" ? "总用时：" : ""}${formatDuration(elapsed)}）`
              : loading
                ? `${locale === "zh-CN" ? "已进行 " : ""}${formatDuration(elapsed)}`
                : null}
          </div>
        </div>
        <button className="small-button" onClick={onClose}>{tr.ui.collapse}</button>
      </div>

      <div className="reasoning-timeline">
        {timeline.map((item, index) => (
          <div key={item.id} className="reasoning-node reasoning-node-appear">
            <div
              className={cn(
                "reasoning-dot",
                (item.status === "active" || item.status === "streaming") && "reasoning-dot-active",
                item.status === "talking" && "reasoning-dot-talking",
                item.status === "done" && "reasoning-dot-done"
              )}
            />
            {index < timeline.length - 1 ? <div className="reasoning-line" /> : null}
            <div className="reasoning-content">
              <div
                className={cn(
                  "reasoning-title",
                  (item.status === "active" || item.status === "streaming" || item.status === "talking") &&
                    "thinking-title-active"
                )}
              >
                {item.status === "active" ? item.title ? `${item.title}（${locale === "zh-CN" ? "已进行 " : ""}${formatDuration(elapsed)}）` : null : null}
                {item.status === "talking" ? `${tr.thinking.talking}（${locale === "zh-CN" ? "已进行 " : ""}${formatDuration(elapsed)}）` : null}
                {item.status === "done" ? `${tr.thinking.done}（${locale === "zh-CN" ? "总用时：" : ""}${formatDuration(elapsed)}）` : null}
                {item.status !== "active" && item.status !== "done" && item.status !== "talking" ? item.title : null}
              </div>
              {item.status === "complete" || item.status === "streaming" ? (
                <div className="reasoning-body markdown-body">
                  <Markdown content={item.body} />
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function SettingsOverlay({
  agents,
  agentsError,
  globalSkills,
  providers,
  providerForms,
  providerKeys,
  providerSecretStatus,
  providerStatus,
  settingsTab,
  locale,
  setLocale,
  setProviderForms,
  setProviderKeys,
  setSettingsOpen,
  setSettingsTab,
  saveProvider,
  saveProviderSecret,
  testProvider,
  onAddExpert,
  onEditExpert,
  onDeleteExpert,
}: {
  agents: AgentView[];
  agentsError: string | null;
  globalSkills: string[];
  providers: ProviderProfile[];
  providerForms: Record<string, ProviderProfile>;
  providerKeys: Record<string, string>;
  providerSecretStatus: Record<string, boolean>;
  providerStatus: Record<string, string>;
  settingsTab: SettingsTab;
  locale: Locale;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setProviderForms: Dispatch<SetStateAction<Record<string, ProviderProfile>>>;
  setProviderKeys: Dispatch<SetStateAction<Record<string, string>>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  saveProvider: (providerId: string) => Promise<void>;
  saveProviderSecret: (providerId: string) => Promise<void>;
  testProvider: (providerId: string) => Promise<void>;
  onAddExpert: () => void;
  onEditExpert: (agent: AgentView) => void;
  onDeleteExpert: (name: string) => void;
}) {
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const skillCountLabel = locale === "zh-CN" ? `${globalSkills.length} 个全局 Skills` : `${globalSkills.length} global Skills`;
  return (
    <div className="settings-backdrop">
      <div className="hidden w-[260px] border-r border-line bg-white px-4 py-5 md:block">
        <div className="mb-5 text-[15px] font-medium">{t(locale).ui.settings}</div>
        {settingsTabs(locale).map((tab) => (
          <button
            key={tab.id}
            className={cn("settings-tab", settingsTab === tab.id && "settings-tab-active")}
            onClick={() => setSettingsTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-5 py-5 md:px-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-medium">{settingsTitle(settingsTab, locale)}</div>
            <div className="mt-1 max-w-[640px] text-sm leading-6 text-muted">{settingsSubtitle(settingsTab, locale)}</div>
          </div>
          <button className="small-button" onClick={() => setSettingsOpen(false)}>{locale === "zh-CN" ? "关闭" : "Close"}</button>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">
          {settingsTabs(locale).map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "shrink-0 rounded-md border border-line px-3 py-2 text-sm",
                settingsTab === tab.id ? "bg-accent text-white" : "bg-white text-muted"
              )}
              onClick={() => setSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {settingsTab === "providers" ? (
          <div className="grid gap-4">
            {providers.map((provider) => {
              const form = providerForms[provider.provider_id] ?? provider;
              const keyConfigured = providerSecretStatus[provider.provider_id];
              return (
                <section key={provider.provider_id} className="settings-card">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{form.label}</div>
                      <div className="mt-1 text-xs text-muted">
                        {provider.provider_id} · {keyConfigured ? "API Key 已配置" : "API Key 未配置"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="small-button" onClick={() => void testProvider(provider.provider_id)}>测试</button>
                      <button className="small-button" onClick={() => void saveProviderSecret(provider.provider_id)}>保存 Key</button>
                      <button className="small-button-primary" onClick={() => void saveProvider(provider.provider_id)}>保存配置</button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <ProviderField provider={form} field="label" label="显示名称" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="default_model" label="默认模型" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="base_url" label="Base URL" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="api_style" label="API 风格" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="provider_type" label="Provider 类型" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="env_key_name" label="环境变量名" setProviderForms={setProviderForms} />
                    <label className="grid gap-1 text-sm md:col-span-2">
                      <span className="font-medium">API Key</span>
                      <input
                        type="password"
                        value={providerKeys[provider.provider_id] ?? ""}
                        onChange={(event) =>
                          setProviderKeys((current) => ({
                            ...current,
                            [provider.provider_id]: event.target.value,
                          }))
                        }
                        className="settings-input"
                        placeholder={keyConfigured ? "已保存；输入新值可覆盖" : `保存到本地运行时，或使用 ${form.env_key_name}`}
                      />
                    </label>
                  </div>

                  <div className="mt-3 text-xs leading-5 text-muted">
                    {providerStatus[provider.provider_id] ?? "密钥只保存到本地 runtime/data，不会在 API 响应中回显。"}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {settingsTab === "experts" ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted">{skillCountLabel}</div>
              <button
                className="small-button-primary"
                onClick={onAddExpert}
              >
                + 添加专家
              </button>
            </div>
            {agents.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {agents.map((agent) => {
                  const isSystem =
                    agent.name === "summarizer-main" || agent.name === "synthesizer-main";
                  return (
                    <section key={agent.name} className="settings-card">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{agent.nickname}</div>
                        {isSystem ? (
                          <span className="rounded border border-line bg-gray-50 px-1.5 py-0.5 text-[11px] text-muted">[系统]</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">{agent.name}</div>
                      <div className="mt-4 grid gap-2 text-sm text-muted">
                        <div>角色: {agent.role}</div>
                        <div>Provider: {agent.provider_profile}</div>
                        <div>优先级: {agent.priority}</div>
                        <div>Skills: {agent.allowed_global_skills.join(", ") || "未配置"}</div>
                        <div>禁用: {agent.disabled_global_skills.join(", ") || "无"}</div>
                        <div>私有 Skills: {agent.private_skill_count}</div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button className="small-button" onClick={() => onEditExpert(agent)}>编辑</button>
                        {!isSystem ? (
                          <button
                            className="small-button"
                            style={{ color: "#d92d20", borderColor: "rgba(217,45,32,0.3)" }}
                            onClick={() => setConfirmDeleteName(agent.name)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <section className="settings-card text-sm leading-7 text-muted">
                {t(locale).ui.noExperts}{agentsError ? `${locale === "zh-CN" ? "错误：" : "Error: "}${agentsError}` : ""}
              </section>
            )}
          </>
        ) : null}

        {settingsTab !== "providers" && settingsTab !== "experts" ? (
          <section className="settings-card">
            {settingsTab === "general" ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-sm font-medium">{t(locale).ui.language}</div>
                  <div className="flex gap-2">
                    <button
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm",
                        locale === "zh-CN" ? "border-ink bg-ink text-white" : "border-line bg-white text-muted"
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
                        "rounded-md border px-3 py-1.5 text-sm",
                        locale === "en" ? "border-ink bg-ink text-white" : "border-line bg-white text-muted"
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
            ) : (
              <div className="text-sm leading-7 text-muted">{locale === "zh-CN" ? "该部分保留为 MVP 设置中心骨架。" : "This section is reserved as an MVP settings skeleton."}</div>
            )}
          </section>
        ) : null}
      </div>

      {confirmDeleteName ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteName(null)}>
          <div className="sidebar-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm mb-3">{locale === "zh-CN" ? `确定要删除专家 "${confirmDeleteName}" 吗？` : `Are you sure you want to delete "${confirmDeleteName}"?`}</div>
            <div className="flex gap-2 justify-end">
              <button className="small-button" onClick={() => setConfirmDeleteName(null)}>{locale === "zh-CN" ? "取消" : "Cancel"}</button>
              <button
                className="small-button-primary"
                onClick={() => {
                  onDeleteExpert(confirmDeleteName);
                  setConfirmDeleteName(null);
                }}
              >
                {locale === "zh-CN" ? "删除" : "Delete"}
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
  if (tab === "skills") return t(locale).ui.skills;
  if (tab === "data") return t(locale).ui.data;
  return t(locale).ui.general;
}

function settingsSubtitle(tab: SettingsTab, locale: Locale) {
  if (tab === "providers") return locale === "zh-CN" ? "开发阶段可在前端配置并保存 API Key。密钥只存本机 runtime/data，用于本地开发。" : "Configure and save API Keys in the frontend. Keys are stored locally in runtime/data for local dev.";
  if (tab === "experts") return locale === "zh-CN" ? "默认专家从 runtime/agents 自动加载。角色和提示词定义身份，Skills 只定义可复用能力。" : "Default experts auto-load from runtime/agents. Roles and prompts define identity, Skills define reusable capabilities.";
  if (tab === "skills") return locale === "zh-CN" ? "全局 Skills 是能力模块，不是身份标签。专家通过 yaml 白名单或禁用列表控制访问。" : "Global Skills are capability modules, not identity tags. Experts control access via yaml allowlist or denylist.";
  if (tab === "data") return locale === "zh-CN" ? "只持久化用户可见投影，不保存原始专家讨论。" : "Only persist user-visible projection, not raw expert discussions.";
  return locale === "zh-CN" ? "圆桌骑士的基础偏好设置。" : "Basic KORT preferences.";
}

function ProviderField({
  provider,
  field,
  label,
  setProviderForms,
}: {
  provider: ProviderProfile;
  field: ProviderTextField;
  label: string;
  setProviderForms: Dispatch<SetStateAction<Record<string, ProviderProfile>>>;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        value={provider[field]}
        onChange={(event) =>
          setProviderForms((current) => ({
            ...current,
            [provider.provider_id]: {
              ...current[provider.provider_id],
              [field]: event.target.value,
            },
          }))
        }
        className="settings-input"
      />
    </label>
  );
}

function SkillPicker({
  skills,
  value,
  disabled,
  emptyText,
  onChange,
}: {
  skills: string[];
  value: string[];
  disabled?: boolean;
  emptyText: string;
  onChange: (next: string[]) => void;
}) {
  if (!skills.length) {
    return <div className="skill-picker-empty">{emptyText}</div>;
  }

  const selected = new Set(value);
  return (
    <div className="skill-picker">
      {skills.map((skill) => {
        const checked = selected.has(skill);
        return (
          <label key={skill} className={cn("skill-chip", checked && "skill-chip-active", disabled && "skill-chip-disabled")}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...value, skill]
                  : value.filter((item) => item !== skill);
                onChange(next);
              }}
            />
            <span>{skill}</span>
          </label>
        );
      })}
    </div>
  );
}

function ExpertModal({
  mode,
  agent,
  providers,
  globalSkills,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  agent: AgentView | null;
  providers: ProviderProfile[];
  globalSkills: string[];
  onClose: () => void;
  onSave: (data: {
    name: string;
    nickname: string;
    role: string;
    provider_profile: string;
    model: string;
    system_prompt: string;
    allowed_global_skills: string[];
    disabled_global_skills: string[];
    priority: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [nickname, setNickname] = useState(agent?.nickname ?? "");
  const [providerProfile, setProviderProfile] = useState(
    agent?.provider_profile ?? (providers[0]?.provider_id ?? "")
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? "");
  const [role, setRole] = useState(agent?.role ?? "expert");
  const [allowedSkills, setAllowedSkills] = useState<string[]>(agent?.allowed_global_skills ?? []);
  const [disabledSkills, setDisabledSkills] = useState<string[]>(agent?.disabled_global_skills ?? []);
  const [priority, setPriority] = useState(agent?.priority ?? 50);
  const [saving, setSaving] = useState(false);

  const isSystem =
    (agent?.name === "summarizer-main" || agent?.name === "synthesizer-main");

  const selectedProvider = providers.find((p) => p.provider_id === providerProfile);

  useEffect(() => {
    if (selectedProvider && !model) {
      setModel(selectedProvider.default_model);
    }
  }, [providerProfile, selectedProvider, model]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        nickname: nickname.trim(),
        role,
        provider_profile: providerProfile,
        model: selectedProvider?.default_model ?? "",
        system_prompt: systemPrompt,
        allowed_global_skills: allowedSkills,
        disabled_global_skills: disabledSkills,
        priority,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isValidName = /^[a-z][a-z0-9-]*$/.test(name);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="expert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {mode === "create" ? "添加专家" : "编辑专家"}
        </div>
        <div className="modal-form-grid">
          {/* name */}
          <label className="settings-field">
            <span className="settings-label">
              名称{mode === "edit" ? "（只读）" : ""}
            </span>
            <input
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode === "edit" || isSystem}
              placeholder="小写字母开头，仅小写字母、数字、连字符"
            />
            {name && !isValidName ? (
              <span className="settings-error">
                格式不符（需匹配 ^[a-z][a-z0-9-]*$）
              </span>
            ) : null}
          </label>

          {/* nickname */}
          <label className="settings-field">
            <span className="settings-label">昵称</span>
            <input
              className="settings-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={isSystem}
              placeholder="显示名称"
            />
          </label>

          {/* provider_profile */}
          <label className="settings-field">
            <span className="settings-label">模型提供商</span>
            <select
              className="settings-input"
              value={providerProfile}
              onChange={(e) => setProviderProfile(e.target.value)}
            >
              {providers.length === 0 ? (
                <option value="">无可用提供商</option>
              ) : null}
              {providers.filter(p => p.enabled).map((p) => (
                <option key={p.provider_id} value={p.provider_id}>
                  {p.label} ({p.provider_id})
                </option>
              ))}
            </select>
          </label>

          {/* system_prompt */}
          <label className="settings-field">
            <span className="settings-label">系统提示词</span>
            <textarea
              className="settings-input"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={isSystem}
              rows={4}
              placeholder="输入该专家的系统提示词..."
            />
          </label>

          {/* role */}
          <label className="settings-field">
            <span className="settings-label">角色</span>
            <select
              className="settings-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isSystem}
            >
              <option value="expert">Expert</option>
              <option value="critic">Critic</option>
              <option value="summarizer">Summarizer</option>
              <option value="synthesizer">Synthesizer</option>
            </select>
          </label>

          <div className="settings-field">
            <span className="settings-label">允许的全局 Skills</span>
            <SkillPicker
              skills={globalSkills}
              value={allowedSkills}
              disabled={isSystem}
              emptyText="未发现全局 Skills"
              onChange={(next) => {
                setAllowedSkills(next);
                setDisabledSkills((current) => current.filter((skill) => !next.includes(skill)));
              }}
            />
          </div>

          <div className="settings-field">
            <span className="settings-label">禁用的全局 Skills</span>
            <SkillPicker
              skills={globalSkills}
              value={disabledSkills}
              disabled={isSystem}
              emptyText="未禁用 Skills"
              onChange={(next) => {
                setDisabledSkills(next);
                setAllowedSkills((current) => current.filter((skill) => !next.includes(skill)));
              }}
            />
          </div>

          {/* priority */}
          <label className="settings-field">
            <span className="settings-label">优先级 (0-100)</span>
            <input
              className="settings-input"
              type="number"
              min={0}
              max={100}
              value={priority}
              disabled={isSystem}
              onChange={(e) =>
                setPriority(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
              }
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="small-button" onClick={onClose}>
            取消
          </button>
          <button
            className="small-button-primary"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || !isValidName}
          >
            {saving ? "保存中..." : mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
