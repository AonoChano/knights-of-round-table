"use client";

import "katex/dist/katex.min.css";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Cloud,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FlaskConical,
  KeyRound,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Save,
  SendHorizontal,
  Search,
  Server,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Trash2,
  UserPlus,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { loadLocale, saveLocale, localeStatusText, t, nextThinkingLabel, discussionLevels } from "./locale";
import type { DiscussionLevel, Locale } from "./locale";

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

const settingsTabIcons: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  providers: KeyRound,
  experts: UsersRound,
  skills: Wrench,
  data: Database,
};
const AGENT_ROLE_OPTIONS = [
  { id: "expert", label: "Expert" },
  { id: "critic", label: "Critic" },
  { id: "summarizer", label: "Summarizer" },
  { id: "synthesizer", label: "Synthesizer" },
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

const TRANSIENT_TIMELINE_IDS = new Set(["thinking-active", "talking-active"]);
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

function withoutTransientTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items.filter((item) => !TRANSIENT_TIMELINE_IDS.has(item.id));
}

function upsertSummaryStart(items: TimelineItem[], id: string, fallbackTitle: string): TimelineItem[] {
  if (items.some((item) => item.id === id)) {
    return items.map((item) =>
      item.id === id ? { ...item, title: item.title || fallbackTitle, status: "streaming" as const } : item
    );
  }
  return [...items, { id, title: fallbackTitle, body: "", raw: "", status: "streaming" as const }];
}

function dedupeTimelineItems(items: TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>();
  const deduped: TimelineItem[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.unshift(item);
  }
  return deduped;
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

function clientErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof Event !== "undefined" && error instanceof Event) {
    return error.type ? `${fallback} (${error.type})` : fallback;
  }
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
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

function thinkingElapsedLabel(locale: Locale, elapsed: number, complete: boolean) {
  const duration = formatDuration(elapsed);
  const copy = t(locale).ui;
  return complete ? copy.thinkingElapsedComplete(duration) : copy.thinkingElapsedActive(duration);
}

function randomNewChatPrompt(locale: Locale) {
  const prompts = t(locale).ui.newChatPrompts;
  return prompts[Math.floor(Math.random() * prompts.length)] ?? prompts[0] ?? "";
}

function defaultNewChatPrompt(locale: Locale) {
  return t(locale).ui.newChatPrompts[0] ?? "";
}

function appendThinkingDoneNode(items: TimelineItem[], locale: Locale, elapsedSeconds?: number): TimelineItem[] {
  return [
    ...items.filter((item) => item.id !== "thinking-done"),
    {
      id: "thinking-done",
      title:
        typeof elapsedSeconds === "number"
          ? thinkingElapsedLabel(locale, elapsedSeconds, true)
          : t(locale).thinking.done,
      body: "",
      raw: "",
      status: "done" as const,
    },
  ];
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newChatPrompt, setNewChatPrompt] = useState(() => defaultNewChatPrompt(DEFAULT_LOCALE));

  const router = useRouter();
  const searchParams = useSearchParams();

  const thinkingLabelRef = useRef<TimerHandle | null>(null);
  const lastThinkingLabelRef = useRef("");
  const lastThinkingActiveTimeRef = useRef(0);

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
    setNewChatPrompt(randomNewChatPrompt(locale));
    setSlotVersion((v) => v + 1);
    router.replace("/", { scroll: false });
  }

  useEffect(() => {
    const loadedLocale = loadLocale();
    setDiscussionLevel(loadDiscussionLevel());
    setDeepThink(loadDeepThink());
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
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.loadAgentsFailed);
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
      else setAgentsError(t(locale).ui.createAgentFailedHttp(response.status));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.createAgentRequestFailed);
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
      else setAgentsError(t(locale).ui.updateAgentFailedHttp(response.status));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.updateAgentRequestFailed);
    }
  }

  async function deleteAgent(name: string) {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${name}`, { method: "DELETE" });
      if (response.ok) await loadAgents();
      else setAgentsError(t(locale).ui.deleteAgentFailedHttp(response.status));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.deleteAgentRequestFailed);
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
          const timelineItems: TimelineItem[] = appendThinkingDoneNode((round.stage_summaries ?? []).map((s) => ({
            id: s.id,
            title: markdownTitle(s.details, s.title),
            body: markdownBody(s.details),
            raw: s.details,
            status: "complete" as const,
          })), locale);
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
    const resumePlaceholder = t(locale).ui.restoreConversation;
    const resumeTitle = t(locale).ui.resumeConversation;
    const now = new Date().toISOString();
    slot.submittedQuestion = null;
    slot.plannedConversationId = conversationId;
    setCurrentConversationId(conversationId);
    currentCidRef.current = conversationId;
    setSubmittedQuestion(null);
    setFinalBody("");
    setTimeline([]);
    setThinkingComplete(false);
    setLoading(true);
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
            slot.submittedQuestion = question || null;
            setSubmittedQuestion(question || null);
            submittedQuestionRef.current = question || null;
            if (question) {
              setConversations((prev) =>
                prev.map((item) =>
                  item.conversation_id === conversationId
                    ? { ...item, title: question.slice(0, 30), updated_at: new Date().toISOString() }
                    : item
                )
              );
            }
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
          ? { id: "thinking-cancelled", title: t(locale).ui.cancelled, body: "", raw: "", status: "complete" as const }
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
    const convId = currentConversationId ?? crypto.randomUUID();
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
    setCurrentConversationId(convId);
    currentCidRef.current = convId;
    router.replace(`/?c=${convId}`, { scroll: false });
    setSubmittedQuestion(question);
    submittedQuestionRef.current = question;
    setInput("");
    setLoading(true);

    const controller = slot.abortController!;

    if (isNewConversation) {
      setConversations((prev) => [
        {
          conversation_id: convId,
          title: question.slice(0, 30),
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
      const body: Record<string, string | boolean> = { question, level: discussionLevel };
      if (discussionLevel === "off") {
        body.deep_think = deepThink;
      }
      body.conversation_id = convId;

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
          if (startedId && startedId !== streamSlotId) {
            const activeSlot = slotMapRef.current.get(streamSlotId);
            if (activeSlot) {
              slotMapRef.current.delete(streamSlotId);
              slotMapRef.current.set(startedId, activeSlot);
            }
            streamSlotId = startedId;
            activeSlotIdRef.current = startedId;
            setActiveSlotId(startedId);
            setPendingConvId(startedId);
            setCurrentConversationId(startedId);
            currentCidRef.current = startedId;
            router.replace(`/?c=${startedId}`, { scroll: false });
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
      slot.timeline = withoutTransientTimelineItems(slot.timeline);
      slot.timeline = [...slot.timeline, { id: "talking-active", title: t(locale).thinking.talking, body: "", raw: "", status: "talking" }];
      return;
    }
    if (message.event === "thinking_active") {
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
      slot.talkingActive = false;
      slot.timeline = appendThinkingDoneNode(withoutTransientTimelineItems(slot.timeline), locale, slot.elapsed);
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
      slot.timeline = appendThinkingDoneNode(withoutTransientTimelineItems(slot.timeline), locale, slot.elapsed);
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
      setTimeline((current) => {
        const filtered = withoutTransientTimelineItems(current);
        return [...filtered, { id: "talking-active", title: t(locale).thinking.talking, body: "", raw: "", status: "talking" }];
      });
      return;
    }

    if (message.event === "thinking_active") {
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
      setTimeline((current) =>
        appendThinkingDoneNode(withoutTransientTimelineItems(current), locale, elapsed)
      );
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
        const timelineItems: TimelineItem[] = appendThinkingDoneNode((lastRound.stage_summaries ?? []).map((s) => ({
          id: s.id,
          title: markdownTitle(s.details, s.title),
          body: markdownBody(s.details),
          raw: s.details,
          status: "complete" as const,
        })), locale, elapsed);
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
    const copy = t(locale).ui;

    setProviderStatus((current) => ({ ...current, [providerId]: copy.savingConfig }));
    try {
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
        [providerId]: response.ok ? copy.configurationSaved : copy.saveConfigFailedFields,
      }));
      await loadProviders();
    } catch (error) {
      setProviderStatus((current) => ({
        ...current,
        [providerId]: copy.configureSaveFailed(clientErrorMessage(error, copy.networkError)),
      }));
    }
  }

  async function saveProviderSecret(providerId: string) {
    const apiKey = providerKeys[providerId];
    const copy = t(locale).ui;
    if (!apiKey?.trim()) {
      setProviderStatus((current) => ({ ...current, [providerId]: copy.enterApiKeyFirst }));
      return;
    }

    setProviderStatus((current) => ({ ...current, [providerId]: copy.savingApiKey }));
    try {
      const response = await fetch(`${API_BASE}/api/providers/${providerId}/secret`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (response.ok) {
        setProviderKeys((current) => ({ ...current, [providerId]: "" }));
        setProviderSecretStatus((current) => ({ ...current, [providerId]: true }));
        setProviderStatus((current) => ({ ...current, [providerId]: copy.apiKeySavedRuntime }));
        return;
      }
      setProviderStatus((current) => ({ ...current, [providerId]: copy.apiKeySaveFailed }));
    } catch (error) {
      setProviderStatus((current) => ({
        ...current,
        [providerId]: `${copy.apiKeySaveFailed}: ${clientErrorMessage(error, copy.networkError)}`,
      }));
    }
  }

  async function testProvider(providerId: string) {
    const provider = providerForms[providerId];
    const apiKey = providerKeys[providerId];
    if (!provider) return;
    const copy = t(locale).ui;

    setProviderStatus((current) => ({ ...current, [providerId]: copy.testing }));
    try {
      const response = await fetch(`${API_BASE}/api/providers/${providerId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey || null }),
      });
      const payload = (await response.json().catch(() => ({ message: "" }))) as ProviderConnectivityResponse;
      setProviderStatus((current) => ({
        ...current,
        [providerId]: response.ok ? localeStatusText(locale, payload.message) : copy.testFailedBackend,
      }));
    } catch (error) {
      setProviderStatus((current) => ({
        ...current,
        [providerId]: copy.testFailed(clientErrorMessage(error, copy.backendUnavailable)),
      }));
    }
  }

  const visibleTimeline = useMemo(() => {
    return dedupeTimelineItems(timeline);
  }, [timeline]);

  const hasRun = Boolean(submittedQuestion || conversation || loading || messagePairs.length > 0);
  const tr = t(locale);

  useEffect(() => {
    if (hasRun) return;
    setNewChatPrompt((current) => {
      if (t(locale).ui.newChatPrompts.includes(current)) return current;
      return randomNewChatPrompt(locale);
    });
  }, [hasRun, locale]);

  return (
    <main className="app-shell">
      <Sidebar
        locale={locale}
        agents={agents}
        conversations={conversations}
        activeConversationId={currentConversationId}
        unreadConversationIds={unreadConversationIds}
        slotMapRef={slotMapRef}
        slotVersion={slotVersion}
        collapsed={sidebarCollapsed}
        onNewConversation={fullReset}
        onSelectConversation={(id) => void loadConversation(id)}
        onRenameConversation={(id, name) => void renameConversation(id, name)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        openSettings={(tab) => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
      />

      <section className="main-shell">
        <header className="topbar">
          <button className="brand-button" onClick={fullReset}>
            <span>Round Table</span>
            <small>{tr.ui.statusReady}</small>
          </button>
          <div className="flex items-center gap-2">
            <button className="small-button small-button-icon">
              <Share2 size={15} aria-hidden="true" />
              <span>{tr.ui.share}</span>
            </button>
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
              <div className="new-chat-prompt">{newChatPrompt}</div>
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
          locale={locale}
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
  locale,
  agents,
  conversations,
  activeConversationId,
  unreadConversationIds,
  slotMapRef,
  slotVersion,
  collapsed,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onToggleCollapsed,
  openSettings,
}: {
  locale: Locale;
  agents: AgentView[];
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  unreadConversationIds: Set<string>;
  slotMapRef: React.MutableRefObject<Map<string, StreamSlot>>;
  slotVersion: number;
  collapsed: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, name: string) => void;
  onDeleteConversation: (id: string) => void;
  onToggleCollapsed: () => void;
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

  return (
    <aside className={cn("sidebar", collapsed && "sidebar-collapsed")} aria-label="Conversation sidebar">
      <div className="sidebar-main">
        <div className="sidebar-header">
          <div className="logo-mark" aria-label="Knights of the Round Table">
            <img src="/icon.svg" alt="" aria-hidden="true" />
          </div>
          <button
            className="sidebar-collapse-button"
            type="button"
            title={collapsed ? tr.ui.expandSidebar : tr.ui.collapseSidebar}
            aria-label={collapsed ? tr.ui.expandSidebar : tr.ui.collapseSidebar}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
        </div>
        <button
          className="sidebar-primary sidebar-primary-action"
          title={tr.ui.newConversation}
          onClick={onNewConversation}
        >
          <SquarePen size={16} aria-hidden="true" />
          <span className="sidebar-expanded-only">{tr.ui.newConversation}</span>
        </button>
        <div className="sidebar-history sidebar-expanded-only">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="sidebar-date-divider">
                <span>{group.label}</span>
              </div>
              {group.items.map((item) => (
                <div
                  key={item.conversation_id}
                  className={cn(
                    "sidebar-link-row",
                    activeConversationId === item.conversation_id && "sidebar-link-row-active",
                    menuConversationId === item.conversation_id && "sidebar-link-row-menu-open"
                  )}
                >
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
                </div>
              ))}
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted">{tr.ui.noConversationHistory}</div>
          )}
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

      {confirmDeleteId ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="sidebar-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm mb-3">{tr.ui.confirmDeleteConversation}</div>
            <div className="flex gap-2 justify-end">
              <button className="small-button" onClick={() => setConfirmDeleteId(null)}>{tr.ui.cancel}</button>
              <button className="small-button-primary" onClick={confirmDelete}>{tr.ui.delete}</button>
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
              <button className="thinking-block" onClick={() => onViewPairThinking(pair)} type="button">
                <span className="thinking-title">
                  {pair.timeline[pair.timeline.length - 1]?.title ?? tr.thinking.complete}
                </span>
                <ChevronRight className="thinking-chevron" size={14} aria-hidden="true" />
              </button>
            ) : null}
            {cleanBody ? (
              <>
                <div className="answer-body markdown-body mt-2">
                  <Markdown content={cleanBody} />
                </div>
                <MessageActions body={cleanBody} locale={locale} />
              </>
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
  const statusItem = [...timeline].reverse().find(
    (item) => item.status === "active" || item.status === "talking" || item.status === "done"
  );
  const lastCompleteTitle = [...timeline].reverse().find(
    (item) => item.status === "complete"
  )?.title;
  const hasLiveTimelineItems = timeline.some(
    (item) => item.status === "active" || item.status === "talking" || item.status === "streaming"
  );
  const isHistoryView = Boolean(conversation && !loading && !hasLiveTimelineItems);
  const isDone = thinkingComplete || statusItem?.status === "done";
  const showPreview = !isDone && latest && latest.body.trim();
  const showCurrentTurn = !isHistoryView && (question || timeline.length > 0 || finalBody);
  const previewTitle = isDone
    ? thinkingElapsedLabel(locale, elapsed, true)
    : statusItem?.title ?? lastCompleteTitle ?? latest?.title ?? tr.thinking.active;
  const previewBody = latest ? markdownBody(latest.body) : "";

  return (
    <div>
      {messagePairs.map((pair, idx) => renderTurn(pair, idx))}

      {showCurrentTurn ? (
        <div className="conversation-stack">
          {question ? <div className="user-message">{question}</div> : null}

          <div className="assistant-row">
            <div className="assistant-content">
              <button className={cn("thinking-block", !isDone && "thinking-block-active")} onClick={onToggleThinking} type="button">
                <span className={cn("thinking-title", !isDone && "thinking-title-active")}>
                  {isDone
                    ? thinkingElapsedLabel(locale, elapsed, true)
                    : previewTitle}
                </span>
                <ChevronRight className="thinking-chevron" size={14} aria-hidden="true" />
              </button>

              {showPreview && previewBody ? (
                <div className="thinking-preview markdown-body">
                  <Markdown content={truncateWords(previewBody, 20)} />
                </div>
              ) : null}

              {finalBody ? (
                <>
                  <div className="answer-body markdown-body">
                    <Markdown content={finalBody} />
                  </div>
                  <MessageActions body={finalBody} locale={locale} />
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageActions({ body, locale }: { body: string; locale: Locale }) {
  const [copied, setCopied] = useState(false);
  const copy = t(locale).ui;

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
      {copied ? <span className="message-action-status">{copy.copied}</span> : null}
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

const COMPOSER_TEXTAREA_MAX_HEIGHT = 176;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const levels = useMemo(() => discussionLevels(locale), [locale]);
  const active = levels.find((d) => d.id === discussionLevel) ?? levels[0];
  const isActive = discussionLevel !== "off";
  const copy = t(locale).ui;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [input]);

  return (
    <div className="composer-shell">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !loading) {
            event.preventDefault();
            onSubmit();
          }
        }}
        rows={1}
        className="composer-textarea"
        placeholder={t(locale).ui.composerPlaceholder}
      />
      <div className="composer-toolbar">
        <div className="composer-corner-controls">
          <div className="composer-corner-control">
            <button
              className={cn("discussion-level-trigger", isActive && "discussion-level-trigger-active")}
              onClick={() => setDropdownOpen((prev) => !prev)}
              type="button"
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
            >
              <span className="discussion-trigger-label">{active.tag}</span>
              <span className="discussion-trigger-code">[{active.code}]</span>
            </button>
            {dropdownOpen ? (
              <div className="discussion-level-dropdown" role="menu">
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
              <Brain size={14} aria-hidden="true" />
              {t(locale).ui.deepThink}
              {deepThink ? (
                <Check className="discussion-level-check discussion-level-check-inline" size={14} aria-hidden="true" />
              ) : null}
            </button>
          ) : null}
        </div>
        <button
          className={cn(
            "send-button",
            paused && pauseFlash && "send-button-pause-flash",
            paused && !pauseFlash && "send-button-paused"
          )}
          onClick={paused ? undefined : loading ? onPause : onSubmit}
          disabled={paused || (!loading && !input.trim())}
          type="button"
          aria-label={loading ? copy.stop : copy.send}
          title={loading ? copy.stop : copy.send}
        >
          {paused ? (
            <span className="pause-status-text">{t(locale).ui.paused}</span>
          ) : loading ? (
            <CircleStop size={16} aria-hidden="true" />
          ) : (
            <SendHorizontal size={18} aria-hidden="true" />
          )}
        </button>
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
  const visibleTimeline = dedupeTimelineItems(timeline);
  const doneItem = [...visibleTimeline].reverse().find((item) => item.status === "done");
  const drawerComplete = thinkingComplete || Boolean(doneItem);
  const doneTitle = doneItem?.title || thinkingElapsedLabel(locale, elapsed, true);
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
                  <div className="reasoning-body markdown-body">
                    <Markdown content={item.body} />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
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
  const copy = t(locale).ui;
  const skillCountLabel = copy.globalSkillsCount(globalSkills.length);
  return (
    <div className="settings-backdrop">
      <div className="settings-shell" role="dialog" aria-modal="true" aria-label={t(locale).ui.settings}>
      <div className="settings-nav">
        <div className="settings-nav-title">
          <Settings size={16} aria-hidden="true" />
          <span>{t(locale).ui.settings}</span>
        </div>
        {settingsTabs(locale).map((tab) => {
          const TabIcon = settingsTabIcons[tab.id];
          return (
            <button
              key={tab.id}
              className={cn("settings-tab", settingsTab === tab.id && "settings-tab-active")}
              onClick={() => setSettingsTab(tab.id)}
            >
              <TabIcon className="settings-tab-icon" size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="settings-content">
        <div className="settings-header">
          <div>
            <div className="text-xl font-medium">{settingsTitle(settingsTab, locale)}</div>
            <div className="mt-1 max-w-[640px] text-sm leading-6 text-muted">{settingsSubtitle(settingsTab, locale)}</div>
          </div>
          <button
            className="icon-button settings-close-button"
            onClick={() => setSettingsOpen(false)}
            aria-label={copy.closeSettings}
            title={copy.close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-mobile-tabs">
          {settingsTabs(locale).map((tab) => {
            const TabIcon = settingsTabIcons[tab.id];
            return (
              <button
                key={tab.id}
                className={cn("settings-mobile-tab", settingsTab === tab.id && "settings-mobile-tab-active")}
                onClick={() => setSettingsTab(tab.id)}
              >
                <TabIcon size={15} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
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
                        {provider.provider_id} · {keyConfigured ? copy.apiKeyConfigured : copy.apiKeyMissing}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="small-button small-button-icon" onClick={() => void testProvider(provider.provider_id)}>
                        <FlaskConical size={14} aria-hidden="true" />
                        <span>{copy.test}</span>
                      </button>
                      <button className="small-button small-button-icon" onClick={() => void saveProviderSecret(provider.provider_id)}>
                        <KeyRound size={14} aria-hidden="true" />
                        <span>{copy.saveKey}</span>
                      </button>
                      <button className="small-button-primary small-button-icon" onClick={() => void saveProvider(provider.provider_id)}>
                        <Save size={14} aria-hidden="true" />
                        <span>{copy.saveConfig}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <ProviderField provider={form} field="label" label={copy.providerField.label} setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="default_model" label={copy.providerField.default_model} setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="base_url" label={copy.providerField.base_url} setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="api_style" label={copy.providerField.api_style} setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="provider_type" label={copy.providerField.provider_type} setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="env_key_name" label={copy.providerField.env_key_name} setProviderForms={setProviderForms} />
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
                        placeholder={keyConfigured ? copy.apiKeyPlaceholderSaved : copy.apiKeyPlaceholderNew(form.env_key_name)}
                      />
                    </label>
                  </div>

                  <div className="mt-3 text-xs leading-5 text-muted">
                    {providerStatus[provider.provider_id] ?? copy.apiKeyHint}
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
                className="small-button-primary small-button-icon"
                onClick={onAddExpert}
              >
                <UserPlus size={14} aria-hidden="true" />
                <span>{copy.addExpert}</span>
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
                          <span className="rounded border border-line bg-gray-50 px-1.5 py-0.5 text-[11px] text-muted">[{copy.system}]</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">{agent.name}</div>
                      <div className="mt-4 grid gap-2 text-sm text-muted">
                        <div>{copy.role}: {agent.role}</div>
                        <div>{copy.provider}: {agent.provider_profile}</div>
                        <div>{copy.priority}: {agent.priority}</div>
                        <div>Skills: {agent.allowed_global_skills.join(", ") || copy.noSkillsConfigured}</div>
                        <div>{copy.disabled}: {agent.disabled_global_skills.join(", ") || copy.none}</div>
                        <div>{copy.privateSkills}: {agent.private_skill_count}</div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button className="small-button small-button-icon" onClick={() => onEditExpert(agent)}>
                          <Pencil size={14} aria-hidden="true" />
                          <span>{copy.edit}</span>
                        </button>
                        {!isSystem ? (
                          <button
                            className="small-button small-button-danger small-button-icon"
                            onClick={() => setConfirmDeleteName(agent.name)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            <span>{copy.delete}</span>
                          </button>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <section className="settings-card text-sm leading-7 text-muted">
                {copy.noExperts}{agentsError ? `${copy.errorPrefix}${agentsError}` : ""}
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
              <div className="text-sm leading-7 text-muted">{copy.dataSkeleton}</div>
            )}
          </section>
        ) : null}
      </div>
      </div>

      {confirmDeleteName ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteName(null)}>
          <div className="sidebar-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm mb-3">{copy.confirmDeleteExpert(confirmDeleteName)}</div>
            <div className="flex gap-2 justify-end">
              <button className="small-button" onClick={() => setConfirmDeleteName(null)}>{copy.cancel}</button>
              <button
                className="small-button-primary"
                onClick={() => {
                  onDeleteExpert(confirmDeleteName);
                  setConfirmDeleteName(null);
                }}
              >
                {copy.delete}
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
  const copy = t(locale).ui;
  if (tab === "providers") return copy.settingsSubtitleProviders;
  if (tab === "experts") return copy.settingsSubtitleExperts;
  if (tab === "skills") return copy.settingsSubtitleSkills;
  if (tab === "data") return copy.settingsSubtitleData;
  return copy.settingsSubtitleGeneral;
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

function providerIcon(provider: ProviderProfile | undefined): LucideIcon {
  const id = `${provider?.provider_id ?? ""} ${provider?.provider_type ?? ""}`.toLowerCase();
  if (id.includes("openai")) return Sparkles;
  if (id.includes("anthropic")) return Bot;
  if (id.includes("deepseek")) return Brain;
  if (id.includes("ollama") || id.includes("local")) return Server;
  if (id.includes("cloud")) return Cloud;
  return Cpu;
}

function ProviderIcon({ provider }: { provider: ProviderProfile | undefined }) {
  const Icon = providerIcon(provider);
  return (
    <span className="provider-select-icon" aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

function ProviderSelect({
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
        <ProviderIcon provider={selectedProvider} />
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
                <ProviderIcon provider={provider} />
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

function ExpertModal({
  mode,
  agent,
  providers,
  globalSkills,
  locale,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  agent: AgentView | null;
  providers: ProviderProfile[];
  globalSkills: string[];
  locale: Locale;
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
  const copy = t(locale).ui;

  const isSystem =
    (agent?.name === "summarizer-main" || agent?.name === "synthesizer-main");

  const selectedProvider = providers.find((p) => p.provider_id === providerProfile);

  useEffect(() => {
    if (selectedProvider && !model) {
      setModel(selectedProvider.default_model);
    }
  }, [providerProfile, selectedProvider, model]);

  function handleProviderChange(nextProviderId: string) {
    const nextProvider = providers.find((provider) => provider.provider_id === nextProviderId);
    const currentDefault = selectedProvider?.default_model ?? "";
    setProviderProfile(nextProviderId);
    if (!model || model === currentDefault) {
      setModel(nextProvider?.default_model ?? "");
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        nickname: nickname.trim(),
        role,
        provider_profile: providerProfile,
        model: model.trim() || selectedProvider?.default_model || "",
        system_prompt: systemPrompt,
        allowed_global_skills: allowedSkills,
        disabled_global_skills: disabledSkills,
        priority,
      });
      onClose();
    } catch (error) {
      console.warn(clientErrorMessage(error, copy.expertSaveFailed));
    } finally {
      setSaving(false);
    }
  }

  const isValidName = /^[a-z][a-z0-9-]*$/.test(name);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="expert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {mode === "create" ? copy.addExpert : copy.editExpert}
        </div>
        <div className="modal-form-grid">
          {/* name */}
          <label className="settings-field">
            <span className="settings-label">
              {mode === "edit" ? copy.expertNameReadonly : copy.expertName}
            </span>
            <input
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode === "edit" || isSystem}
              placeholder={copy.expertNamePlaceholder}
            />
            {name && !isValidName ? (
              <span className="settings-error">
                {copy.invalidExpertName}
              </span>
            ) : null}
          </label>

          {/* nickname */}
          <label className="settings-field">
            <span className="settings-label">{copy.nickname}</span>
            <input
              className="settings-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={isSystem}
              placeholder={copy.displayName}
            />
          </label>

          {/* provider_profile */}
          <label className="settings-field">
            <span className="settings-label">{copy.modelProvider}</span>
            <ProviderSelect
              providers={providers}
              value={providerProfile}
              disabled={isSystem}
              locale={locale}
              onChange={handleProviderChange}
            />
          </label>

          {/* model */}
          <label className="settings-field">
            <span className="settings-label">{copy.model}</span>
            <input
              className="settings-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isSystem}
              placeholder={selectedProvider?.default_model ?? "model id"}
            />
          </label>

          {/* system_prompt */}
          <label className="settings-field">
            <span className="settings-label">{copy.systemPrompt}</span>
            <textarea
              className="settings-input"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={isSystem}
              rows={4}
              placeholder={copy.systemPromptPlaceholder}
            />
          </label>

          {/* role */}
          <div className="settings-field">
            <span className="settings-label">{copy.role}</span>
            <div className="role-segmented" role="radiogroup" aria-label={copy.role}>
              {AGENT_ROLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={cn("role-segment", role === option.id && "role-segment-active")}
                  type="button"
                  role="radio"
                  aria-checked={role === option.id}
                  disabled={isSystem}
                  onClick={() => setRole(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-field">
            <span className="settings-label">{copy.allowedGlobalSkills}</span>
            <SkillPicker
              skills={globalSkills}
              value={allowedSkills}
              disabled={isSystem}
              emptyText={copy.noGlobalSkills}
              onChange={(next) => {
                setAllowedSkills(next);
                setDisabledSkills((current) => current.filter((skill) => !next.includes(skill)));
              }}
            />
          </div>

          <div className="settings-field">
            <span className="settings-label">{copy.disabledGlobalSkills}</span>
            <SkillPicker
              skills={globalSkills}
              value={disabledSkills}
              disabled={isSystem}
              emptyText={copy.noDisabledSkills}
              onChange={(next) => {
                setDisabledSkills(next);
                setAllowedSkills((current) => current.filter((skill) => !next.includes(skill)));
              }}
            />
          </div>

          {/* priority */}
          <label className="settings-field">
            <span className="settings-label">{copy.priorityRange}</span>
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
            {copy.cancel}
          </button>
          <button
            className="small-button-primary"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || !isValidName}
          >
            {saving ? copy.saving : mode === "create" ? copy.create : copy.save}
          </button>
        </div>
      </div>
    </div>
  );
}
