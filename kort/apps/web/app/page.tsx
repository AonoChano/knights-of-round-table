"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Brain,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  KeyRound,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Save,
  SendHorizontal,
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
import { ModelList } from "../components/models/ModelList";
import { ProfileIcon } from "../components/models/ProviderIcon";
import { modelsOf, pickDefaultModel } from "../components/models/managed";
import { API_BASE } from "../components/models/api";
import type { ProviderProfile, ProviderSecretStatus } from "../components/models/types";
import type { DiscussionLevel, Locale } from "./locale";
import { AgentStrip } from "../components/discussion/AgentStrip";
import { DiscussionView } from "../components/discussion/DiscussionView";
import { MemoryPanel } from "../components/memory/MemoryPanel";

type TimerHandle = ReturnType<typeof setTimeout>;

type ThinkingTreeNode = {
  id: string;
  title: string;
  summary: string;
  parent_id?: string | null;
  status?: "active" | "complete" | "done" | "cancelled";
  children?: ThinkingTreeNode[];
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

type DelegatedAgent = {
  name: string;
  nickname: string;
  role: string;
  provider_profile: string;
  model: string;
};

type DelegationInfo = {
  route_kind: "direct" | "solo_thinking" | "panel";
  reason_code: string;
  discussion_level: DiscussionLevel;
  deep_think: boolean;
  participant_count: number;
  max_rounds: number;
  agents: DelegatedAgent[];
  // Early stop fields
  actual_rounds?: number;
  early_stop?: boolean;
  early_stop_reason?: string | null;
  convergence_score?: number | null;
};

type MessageNode = {
  node_id: string;
  parent_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error" | "cancelled";
  error?: string | null;
  elapsed_ms?: number;
  created_at?: string;
  stage_summaries?: StageSummary[];
  delegation?: DelegationInfo | null;
  discussion_messages?: DiscussionMessage[];
  active_child_id?: string | null;
  children: string[];
};

type ConversationResponse = {
  conversation_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  expert_count: number;
  nodes: MessageNode[];
  active_root_id: string | null;
  active_path: string[];
};

type ConversationListItem = {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  expert_count: number;
};

type BranchAttempt = {
  parentId: string | null;
  role: "user" | "assistant";
  content: string;
};

type DiscussionMessage = {
  id: string;
  round: number;
  speaker: string;
  nickname: string;
  role: string;
  text: string;
};

type DiscussionViewTarget =
  | { source: "live" }
  | { source: "node"; question: string; node: MessageNode };


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

type LogLevel = "error" | "info" | "debug";

type DeveloperDiagnostics = {
  app_env: string;
  api_base_url: string;
  conversation_store_path: string;
  conversation_count: number;
  jobs_total: number;
  jobs_running: number;
  log_level: string;
};

type SettingsTab = "general" | "providers" | "experts" | "memory" | "skills" | "data" | "developer";

const settingsTabIcons: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  providers: KeyRound,
  experts: UsersRound,
  memory: Brain,
  skills: Wrench,
  data: Database,
  developer: Bug,
};
const AGENT_ROLE_OPTIONS = [
  { id: "expert", label: "Expert" },
  { id: "critic", label: "Critic" },
  { id: "summarizer", label: "Summarizer" },
  { id: "synthesizer", label: "Synthesizer" },
];

type TimelineItem = {
  id: string;
  title: string;
  body: string;
  raw: string;
  status: "streaming" | "complete" | "active" | "done" | "talking";
  treeNodes?: ThinkingTreeNode[];
};

type StreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

type StreamSlot = {
  abortController: AbortController | null;
  loading: boolean;
  elapsed: number;
  /** 本轮开始生成的墙钟时间，用来在事件到达时精确结算耗时 */
  startedAt: number | null;
  thinkingComplete: boolean;
  finalBody: string;
  timeline: TimelineItem[];
  nodes: MessageNode[];
  activeRootId: string | null;
  streamingNodeId: string | null;
  pendingRetryOf: string | null;
  lastBranch: BranchAttempt | null;
  talkingActive: boolean;
  discussionLevel: DiscussionLevel;
  submittedQuestion: string | null;
  plannedConversationId: string | null;
  deepThink: boolean;
  requestPhase: "sent" | "delegating" | "delegated" | null;
  delegationInfo: DelegationInfo | null;
  paused: boolean;
  conversation: ConversationResponse | null;
  streamError: string | null;
  discussionMessages: DiscussionMessage[];
};

const TRANSIENT_TIMELINE_IDS = new Set(["thinking-active", "talking-active"]);
const DISCUSSION_LEVEL_KEY = "kort-discussion-level";
const DEEP_THINK_KEY = "kort-deep-think";
const DEVELOPER_MODE_KEY = "kort-developer-mode";
const LOG_LEVEL_KEY = "kort-log-level";
const DEFAULT_DISCUSSION_LEVEL: DiscussionLevel = "auto";
const DEFAULT_LOCALE: Locale = "zh-CN";
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
};

class RequestTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = "RequestTimeoutError";
  }
}

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

function loadDeveloperMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEVELOPER_MODE_KEY) === "true";
}

function saveDeveloperMode(enabled: boolean): void {
  localStorage.setItem(DEVELOPER_MODE_KEY, String(enabled));
}

function loadLogLevel(): LogLevel {
  if (typeof window === "undefined") return DEFAULT_LOG_LEVEL;
  const stored = localStorage.getItem(LOG_LEVEL_KEY);
  return stored === "error" || stored === "info" || stored === "debug" ? stored : DEFAULT_LOG_LEVEL;
}

function saveLogLevel(level: LogLevel): void {
  localStorage.setItem(LOG_LEVEL_KEY, level);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeoutError = new RequestTimeoutError(timeoutMs);
  const timeout = window.setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error === timeoutError || controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function logClientEvent(
  developerMode: boolean,
  logLevel: LogLevel,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
) {
  if (!developerMode || LOG_LEVEL_RANK[level] > LOG_LEVEL_RANK[logLevel]) return;
  const payload = data ? { ...data } : undefined;
  const prefix = `[KORT ${level.toUpperCase()}] ${message}`;
  if (level === "error") {
    console.error(prefix, payload ?? "");
  } else if (level === "debug") {
    console.debug(prefix, payload ?? "");
  } else {
    console.info(prefix, payload ?? "");
  }
}

function createEmptySlot(): StreamSlot {
  return {
    abortController: null,
    loading: false,
    elapsed: 0,
    startedAt: null,
    thinkingComplete: false,
    finalBody: "",
    timeline: [],
    nodes: [],
    activeRootId: null,
    streamingNodeId: null,
    pendingRetryOf: null,
    lastBranch: null,
    talkingActive: false,
    discussionLevel: loadDiscussionLevel(),
    submittedQuestion: null,
    plannedConversationId: null,
    deepThink: loadDeepThink(),
    requestPhase: null,
    delegationInfo: null,
    paused: false,
    conversation: null,
    streamError: null,
    discussionMessages: [],
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


const SENTENCE_BOUNDARY_RE = /[。！？…；\n]+/g;

function settingsTabs(locale: Locale): Array<{ id: SettingsTab; label: string }> {
  return [
    { id: "general", label: t(locale).ui.general },
    { id: "providers", label: t(locale).ui.providers },
    { id: "experts", label: t(locale).ui.experts },
    { id: "memory", label: t(locale).ui.memory },
    { id: "skills", label: t(locale).ui.skills },
    { id: "data", label: t(locale).ui.data },
    { id: "developer", label: t(locale).ui.developer },
  ];
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function clientErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && /failed to fetch|load failed|networkerror/i.test(error.message)) {
    return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  if (typeof Event !== "undefined" && error instanceof Event) {
    return error.type ? `${fallback} (${error.type})` : fallback;
  }
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function isExpectedAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    return /abort|aborted|paused|cancelled|canceled/i.test(`${error.name} ${error.message}`);
  }
  if (typeof error === "string") return /abort|aborted|paused|cancelled|canceled/i.test(error);
  if (typeof Event !== "undefined" && error instanceof Event) {
    return /abort|aborted|cancel/i.test(error.type);
  }
  return false;
}

function parseThinkingTreeNodes(value: unknown): ThinkingTreeNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const item = node as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
    const title = typeof item.title === "string" ? item.title : "";
    const summary = typeof item.summary === "string" ? item.summary : "";
    if (!title && !summary) return [];
    const status =
      item.status === "active" ||
      item.status === "complete" ||
      item.status === "done" ||
      item.status === "cancelled"
        ? item.status
        : "complete";
    return [{
      id,
      title,
      summary,
      parent_id: typeof item.parent_id === "string" ? item.parent_id : null,
      status,
      children: parseThinkingTreeNodes(item.children),
    }];
  });
}

function parseDelegatedAgents(value: unknown): DelegatedAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((agent) => {
    if (!agent || typeof agent !== "object") return [];
    const item = agent as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    const nickname = typeof item.nickname === "string" ? item.nickname : name;
    const role = typeof item.role === "string" ? item.role : "";
    const providerProfile = typeof item.provider_profile === "string" ? item.provider_profile : "";
    const model = typeof item.model === "string" ? item.model : "";
    if (!name && !nickname && !role && !model) return [];
    return [{ name, nickname, role, provider_profile: providerProfile, model }];
  });
}

function parseDelegationInfo(value: unknown): DelegationInfo | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const routeKind = item.route_kind;
  const discussionLevelValue = item.discussion_level;
  const discussionLevel: DiscussionLevel =
    discussionLevelValue === "off" ||
    discussionLevelValue === "auto" ||
    discussionLevelValue === "low" ||
    discussionLevelValue === "medium" ||
    discussionLevelValue === "high"
      ? discussionLevelValue
      : "auto";
  if (routeKind !== "direct" && routeKind !== "solo_thinking" && routeKind !== "panel") return null;
  const agents = parseDelegatedAgents(item.agents);
  const participantCount =
    typeof item.participant_count === "number" ? item.participant_count : agents.length;
  const maxRounds = typeof item.max_rounds === "number" ? item.max_rounds : 0;
  return {
    route_kind: routeKind,
    reason_code: typeof item.reason_code === "string" ? item.reason_code : "",
    discussion_level: discussionLevel,
    deep_think: item.deep_think === true,
    participant_count: participantCount,
    max_rounds: maxRounds,
    agents,
  };
}

function parseDiscussionMessage(value: unknown): DiscussionMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const speaker = typeof item.speaker === "string" ? item.speaker : "";
  const text = typeof item.text === "string" ? item.text : "";
  if (!speaker || !text) return null;
  const round = typeof item.round === "number" ? item.round : 0;
  return {
    id: typeof item.id === "string" ? item.id : `r${round}-${speaker}`,
    round,
    speaker,
    nickname: typeof item.nickname === "string" && item.nickname ? item.nickname : speaker,
    role: typeof item.role === "string" ? item.role : "expert",
    text,
  };
}

function parseDiscussionMessages(value: unknown): DiscussionMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseDiscussionMessage)
    .filter((item): item is DiscussionMessage => Boolean(item));
}

function appendDiscussionMessage(
  current: DiscussionMessage[],
  message: DiscussionMessage
): DiscussionMessage[] {
  if (current.some((item) => item.id === message.id)) return current;
  return [...current, message];
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

/** Backend reports ms; anything ≤0 means "not recorded" rather than a real 0s thought. */
function elapsedMsToSeconds(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value / 1000));
}

function nodeElapsedSeconds(node: MessageNode): number | undefined {
  return elapsedMsToSeconds(node.elapsed_ms) ?? undefined;
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
    ...items.filter((item) => item.id !== "thinking-done" && item.id !== "thinking-cancelled"),
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

function appendThinkingCancelledNode(items: TimelineItem[], locale: Locale): TimelineItem[] {
  const stableItems = withoutTransientTimelineItems(items)
    .filter((item) => item.id !== "thinking-done" && item.id !== "thinking-cancelled")
    .map((item) =>
      item.status === "streaming"
        ? { ...item, body: item.body || markdownBody(item.raw), status: "complete" as const }
        : item
    );

  return [
    ...stableItems,
    {
      id: "thinking-cancelled",
      title: t(locale).ui.cancelled,
      body: "",
      raw: "",
      status: "done" as const,
    },
  ];
}

function timelineFromStageSummaries(
  stageSummaries: StageSummary[] | undefined,
  locale: Locale,
  elapsedSeconds?: number,
  cancelled = false
): TimelineItem[] {
  const items = (stageSummaries ?? []).map((s) => ({
    id: s.id,
    title: markdownTitle(s.details, s.title),
    body: markdownBody(s.details),
    raw: s.details,
    status: "complete" as const,
    treeNodes: s.tree_nodes ?? [],
  }));
  if (cancelled) return appendThinkingCancelledNode(items, locale);
  return items.length > 0 ? appendThinkingDoneNode(items, locale, elapsedSeconds) : [];
}

function activePathOf(nodes: MessageNode[], rootId: string | null): MessageNode[] {
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const path: MessageNode[] = [];
  const seen = new Set<string>();
  let current = rootId ? byId.get(rootId) : undefined;
  while (current && !seen.has(current.node_id)) {
    seen.add(current.node_id);
    path.push(current);
    current = current.active_child_id ? byId.get(current.active_child_id) : undefined;
  }
  return path;
}

function activeLeafId(nodes: MessageNode[], rootId: string | null): string | null {
  const path = activePathOf(nodes, rootId);
  return path.length > 0 ? path[path.length - 1].node_id : null;
}

function siblingIdsOf(nodes: MessageNode[], node: MessageNode): string[] {
  return nodes
    .filter((item) => item.parent_id === node.parent_id && item.role === node.role)
    .map((item) => item.node_id);
}

function upsertNode(nodes: MessageNode[], node: MessageNode): MessageNode[] {
  const exists = nodes.some((item) => item.node_id === node.node_id);
  const next = exists
    ? nodes.map((item) => (item.node_id === node.node_id ? { ...item, ...node } : item))
    : [...nodes, node];
  return node.parent_id
    ? next.map((item) =>
        item.node_id === node.parent_id ? { ...item, active_child_id: node.node_id } : item
      )
    : next;
}

function parseMessageNode(value: unknown): MessageNode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.node_id !== "string" || (raw.role !== "user" && raw.role !== "assistant")) return null;
  const status =
    raw.status === "streaming" || raw.status === "error" || raw.status === "cancelled"
      ? raw.status
      : "complete";
  return {
    node_id: raw.node_id,
    parent_id: typeof raw.parent_id === "string" ? raw.parent_id : null,
    role: raw.role,
    content: typeof raw.content === "string" ? raw.content : "",
    status,
    error: typeof raw.error === "string" ? raw.error : null,
    elapsed_ms: typeof raw.elapsed_ms === "number" ? raw.elapsed_ms : 0,
    created_at: typeof raw.created_at === "string" ? raw.created_at : undefined,
    stage_summaries: Array.isArray(raw.stage_summaries) ? (raw.stage_summaries as StageSummary[]) : [],
    delegation: (raw.delegation as DelegationInfo | null) ?? null,
    discussion_messages: Array.isArray(raw.discussion_messages)
      ? (raw.discussion_messages as DiscussionMessage[])
      : [],
    active_child_id: typeof raw.active_child_id === "string" ? raw.active_child_id : null,
    children: Array.isArray(raw.children) ? raw.children.filter((item): item is string => typeof item === "string") : [],
  };
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
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [providerSecretStatus, setProviderSecretStatus] = useState<Record<string, ProviderSecretStatus>>({});
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
  const [customMaxRounds, setCustomMaxRounds] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);
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
  const [paused, setPaused] = useState(false);
  const [pauseFlash, setPauseFlash] = useState(false);
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newChatPrompt, setNewChatPrompt] = useState(() => defaultNewChatPrompt(DEFAULT_LOCALE));
  const [developerMode, setDeveloperMode] = useState(false);
  const [logLevel, setLogLevel] = useState<LogLevel>(DEFAULT_LOG_LEVEL);
  const [developerStatus, setDeveloperStatus] = useState<string | null>(null);
  const [developerDiagnostics, setDeveloperDiagnostics] = useState<DeveloperDiagnostics | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [requestPhase, setRequestPhase] = useState<StreamSlot["requestPhase"]>(null);
  const [delegationInfo, setDelegationInfo] = useState<DelegationInfo | null>(null);
  const [discussionMessages, setDiscussionMessages] = useState<DiscussionMessage[]>([]);
  const [discussionView, setDiscussionView] = useState<DiscussionViewTarget | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

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
    setPendingConvId(slot.plannedConversationId);
    setConversation(slot.conversation);
    setPaused(slot.paused);
    setStreamError(slot.streamError);
    setRequestPhase(slot.requestPhase);
    setDelegationInfo(slot.delegationInfo);
    setDiscussionMessages(slot.discussionMessages);
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
    slot.plannedConversationId = pendingConvId;
    slot.conversation = conversation;
    slot.streamError = streamError;
    slot.requestPhase = requestPhase;
    slot.delegationInfo = delegationInfo;
    slot.discussionMessages = discussionMessagesRef.current;
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
    setStreamError(null);
    setRequestPhase(null);
    setDelegationInfo(null);
    setDiscussionMessages([]);
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
    setDiscussionLevel(loadDiscussionLevel());
    setDeepThink(loadDeepThink());
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

  function clientLog(level: LogLevel, message: string, data?: Record<string, unknown>) {
    logClientEvent(developerMode, logLevel, level, message, data);
  }

  async function loadProviders() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/providers`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProviderProfile[];
      setProviders(payload);
    } catch (error) {
      clientLog("debug", "provider profiles load failed", {
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }

  async function loadProviderSecretStatuses() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/provider-secrets`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProviderSecretStatus[];
      setProviderSecretStatus(Object.fromEntries(payload.map((item) => [item.provider_id, item])));
    } catch (error) {
      clientLog("debug", "provider secret status load failed", {
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
      setProviderSecretStatus({});
    }
  }

  async function loadAgents() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/agents`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as AgentView[];
      setAgents(payload);
      setAgentsError(null);
    } catch (error) {
      setAgents([]);
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.loadAgentsFailed);
    } finally {
      setAgentsLoading(false);
    }
  }

  async function loadSkills() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/skills`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as string[];
      setGlobalSkills(payload);
    } catch (error) {
      clientLog("debug", "global skills load failed", {
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
      setGlobalSkills([]);
    }
  }

  async function loadDeveloperDiagnostics() {
    const copy = t(locale).ui;
    setDeveloperStatus(copy.loadingDiagnostics);
    clientLog("info", "developer diagnostics requested", { apiBase: API_BASE });
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/developer/runtime`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as DeveloperDiagnostics;
      setDeveloperDiagnostics(payload);
      setDeveloperStatus(copy.diagnosticsUpdated);
      clientLog("debug", "developer diagnostics loaded", {
        conversationCount: payload.conversation_count,
        jobsRunning: payload.jobs_running,
        backendLogLevel: payload.log_level,
      });
    } catch (error) {
      const message =
        error instanceof RequestTimeoutError
          ? copy.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, copy.backendUnavailable);
      setDeveloperStatus(message);
      clientLog("error", "developer diagnostics failed", { error: message });
    }
  }

  async function updateServerLogLevel(level: LogLevel) {
    const copy = t(locale).ui;
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/api/developer/log-level`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: level.toUpperCase() }),
        },
        6000
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { level: string };
      setDeveloperStatus(copy.logLevelSaved);
      setDeveloperDiagnostics((current) => current ? { ...current, log_level: payload.level } : current);
      clientLog("info", "server log level updated", { level: payload.level });
    } catch (error) {
      const message =
        error instanceof RequestTimeoutError
          ? copy.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, copy.backendUnavailable);
      setDeveloperStatus(copy.logLevelSaveFailed(message));
      clientLog("error", "server log level update failed", { error: message });
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
    const copy = t(locale).ui;
    setConversationsLoading(true);
    clientLog("info", "conversation history load started", { apiBase: API_BASE });
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/conversations`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ConversationListItem[];
      setConversations(payload);
      setConversationsError(null);
      clientLog("info", "conversation history load completed", { count: payload.length });
    } catch (error) {
      const message =
        error instanceof RequestTimeoutError
          ? copy.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, copy.backendUnavailable);
      setConversationsError(message);
      clientLog("error", "conversation history load failed", { error: message });
      // keep existing conversations on fetch failure
    } finally {
      setConversationsLoading(false);
    }
  }

  async function loadConversation(conversationId: string) {
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
      return;
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
      if (!isCurrentRequest()) return;
      if (!response.ok) {
        if (response.status === 404) {
          setConversationLoading(false);
          const resumed = await resumeConversationStream(conversationId);
          if (!isCurrentRequest()) return;
          if (resumed) return;
          router.replace("/", { scroll: false });
          setCurrentConversationId(null);
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as ConversationResponse;
      if (!isCurrentRequest()) return;
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
        return;
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      const message =
        error instanceof RequestTimeoutError
          ? t(locale).ui.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, t(locale).ui.backendUnavailable);
      clientLog("error", "conversation detail load failed", { conversationId, error: message });
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
            applyEventToSlot(slotForEvent, event);
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
    submittedQuestionRef.current = null;
    setSubmittedQuestion(null);
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
    setStreamingNodeId(null);
    setPendingRetryOf(slot.pendingRetryOf);
    setCurrentConversationId(convId);
    currentCidRef.current = convId;
    router.replace(`/?c=${convId}`, { scroll: false });
    const liveQuestion = attempt.role === "user" ? attempt.content : null;
    setSubmittedQuestion(liveQuestion);
    submittedQuestionRef.current = liveQuestion;
    if (attempt.role === "user") setInput("");
    setLoading(true);
    setStreamError(null);

    const controller = slot.abortController!;
    slot.streamError = null;
    slot.submittedQuestion = liveQuestion;
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
          title: attempt.content.slice(0, 30),
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
      });
      const body: Record<string, string | boolean | number | null> = {
        parent_id: attempt.parentId,
        role: attempt.role,
        content: attempt.role === "user" ? attempt.content : "",
        level: discussionLevel,
      };
      if (discussionLevel === "off") {
        body.deep_think = deepThink;
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
          applyEventToSlot(slotForEvent, message);
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

  async function sendQuestion() {
    const question = input.trim();
    if (!question || loading) return;
    if (currentConversationId && !activeRootId) return;
    await runBranch({
      parentId: currentConversationId ? activeLeafId(nodesRef.current, activeRootId) : null,
      role: "user",
      content: question,
    });
  }

  async function submitEditedMessage(node: MessageNode, content: string) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;
    await runBranch({ parentId: node.parent_id, role: "user", content: trimmed });
  }

  async function retryMessage(userNode: MessageNode) {
    if (loading) return;
    await runBranch({ parentId: userNode.node_id, role: "assistant", content: "" });
  }

  async function selectBranch(nodeId: string) {
    const conversationId = currentConversationId;
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

  function elapsedForSlot(slot: StreamSlot | null | undefined): number {
    if (slot?.startedAt) return Math.max(1, Math.round((Date.now() - slot.startedAt) / 1000));
    if (slot && slot.elapsed > 0) return slot.elapsed;
    return Math.max(1, elapsed);
  }

  function applyEventToSlot(slot: StreamSlot, message: StreamEvent) {
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
      slot.requestPhase = "sent";
      return;
    }
    if (message.event === "delegation_complete") {
      const info = parseDelegationInfo(message.data);
      slot.delegationInfo = info;
      slot.requestPhase = "delegating";
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
        elapsedForSlot(slot);
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
    if (message.event === "node_complete") {
      const completed = parseMessageNode(message.data.node);
      if (completed) {
        slot.nodes = upsertNode(slot.nodes, completed);
      }
      if (typeof message.data.active_root_id === "string") {
        slot.activeRootId = message.data.active_root_id;
      }
      slot.elapsed = Math.max(slot.elapsed, elapsedMsToSeconds(completed?.elapsed_ms) ?? 0, elapsedForSlot(slot));
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
      if (!markStreamingNodeFailed(slot, errorMessage)) {
        slot.streamError = errorMessage;
      }
      return;
    }
  }

  function handleStreamEvent(
    message: StreamEvent,
    streamContext?: { streamingNodeId: string | null; slot: StreamSlot }
  ) {
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
      submittedQuestionRef.current = null;
      setSubmittedQuestion(null);
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
        elapsedForSlot(null);
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
          completed.status === "cancelled"
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

  async function refreshModels() {
    await Promise.all([loadProviders(), loadProviderSecretStatuses()]);
  }

  const visibleTimeline = useMemo(() => {
    return dedupeTimelineItems(timeline);
  }, [timeline]);

  const hasRun = Boolean(submittedQuestion || loading || nodes.length > 0);
  const tr = t(locale);
  const hasDiscussion = discussionMessages.length > 0;

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
            <div className="conversation-scroll">
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
                    timeline={visibleTimeline}
                    finalBody={finalBody}
                    streamError={streamError}
                    requestPhase={requestPhase}
                    delegationInfo={delegationInfo}
                    locale={locale}
                    liveDiscussion={discussionMessages}
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
                          node.status === "cancelled"
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
                      onSubmit={() => void sendQuestion()}
                      onPause={pauseConversation}
                    />
                  </div>
                )}
              </div>
            </div>

            {hasRun && !conversationLoading ? (
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
                  onSubmit={() => void sendQuestion()}
                  onPause={pauseConversation}
                />
              </div>
            ) : null}
          </>
        )}
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

function Sidebar({
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

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function BrailleSpinner() {
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

function waitingStatusText(
  locale: Locale,
  requestPhase: StreamSlot["requestPhase"],
  delegation: DelegationInfo | null
) {
  const copy = t(locale).ui;
  if (requestPhase === "delegating") {
    return copy.delegatingExperts(delegation?.participant_count ?? 0);
  }
  if (requestPhase === "delegated") return copy.delegationSucceeded;
  return copy.requestReceived;
}

function ConversationSkeleton() {
  return (
    <div className="conversation-skeleton" aria-busy="true">
      <div className="skeleton skeleton-message-user" />
      <div className="skeleton-thread">
        <div className="skeleton skeleton-chip" />
        <div className="skeleton skeleton-line" style={{ width: "92%" }} />
        <div className="skeleton skeleton-line" style={{ width: "78%" }} />
        <div className="skeleton skeleton-line skeleton-line-short" style={{ width: "46%" }} />
      </div>
      <div className="skeleton skeleton-message-user skeleton-message-user-short" />
      <div className="skeleton-thread">
        <div className="skeleton skeleton-line" style={{ width: "86%" }} />
        <div className="skeleton skeleton-line" style={{ width: "94%" }} />
        <div className="skeleton skeleton-line" style={{ width: "64%" }} />
      </div>
    </div>
  );
}

function ConversationView({
  nodes,
  activeRootId,
  streamingNodeId,
  pendingRetryOf,
  loading,
  thinkingComplete,
  elapsed,
  question,
  timeline,
  finalBody,
  streamError,
  requestPhase,
  delegationInfo,
  locale,
  liveDiscussion,
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
  timeline: TimelineItem[];
  finalBody: string;
  streamError: string | null;
  requestPhase: StreamSlot["requestPhase"];
  delegationInfo: DelegationInfo | null;
  locale: Locale;
  liveDiscussion: DiscussionMessage[];
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
    return (
      <div className="user-message-row" key={`user-${node.node_id}`}>
        <div className="user-message">{node.content}</div>
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
  const lastCompleteTitle = [...timeline].reverse().find(
    (item) => item.status === "complete"
  )?.title;
  const isDone = thinkingComplete || statusItem?.status === "done";
  const previewTitle = isDone
    ? statusItem?.title ?? thinkingElapsedLabel(locale, elapsed, true)
    : statusItem?.title ?? lastCompleteTitle ?? latest?.title ?? tr.thinking.active;

  function renderLiveAssistant() {
    const showPreview = !isDone && latest && latest.body.trim();
    const showWaitingState =
      loading && !finalBody && !streamError && (timeline.length === 0 || requestPhase !== null);
    const previewBody = latest ? markdownBody(latest.body) : "";
    return (
      <div className="assistant-row" key="assistant-live">
        <div className="assistant-content">
          {timeline.length > 0 ? (
            <button
              className={cn("thinking-block", !isDone && "thinking-block-active")}
              onClick={onToggleThinking}
              type="button"
            >
              <span className={cn("thinking-title", !isDone && "thinking-title-active")}>
                {previewTitle}
              </span>
              <ChevronRight className="thinking-chevron" size={14} aria-hidden="true" />
            </button>
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
              <Markdown content={truncateWords(previewBody, 20)} />
            </div>
          ) : null}

          {finalBody ? (
            <>
              <div className="answer-body markdown-body">
                <Markdown content={finalBody} />
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
      node.status === "cancelled"
    );
    const discussion = node.discussion_messages ?? [];
    const failed = node.status === "error";
    return (
      <div className="assistant-row" key={`assistant-${node.node_id}`}>
        <div className="assistant-content">
          {nodeTimeline.length > 0 ? (
            <button className="thinking-block" onClick={() => onViewNodeThinking(node)} type="button">
              <span className="thinking-title">
                {nodeTimeline[nodeTimeline.length - 1]?.title ?? tr.thinking.complete}
              </span>
              <ChevronRight className="thinking-chevron" size={14} aria-hidden="true" />
            </button>
          ) : null}
          {body ? (
            <div className="answer-body markdown-body">
              <Markdown content={body} />
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
  for (const node of path) {
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
          <div key={turn.user ? `turn-${turn.user.node_id}` : `turn-a-${idx}`} className="conversation-stack">
            {turn.user ? renderUserMessage(turn.user) : null}
            {retrying
              ? renderWaitingAssistant(`waiting-retry-${idx}`)
              : turn.assistant
                ? renderStoredAssistant(turn.assistant, turn.user)
                : null}
          </div>
        );
      })}

      {question ? (
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

function BranchNav({
  ids,
  activeId,
  locale,
  onSelect,
}: {
  ids: string[];
  activeId: string;
  locale: Locale;
  onSelect: (nodeId: string) => void;
}) {
  const copy = t(locale).ui;
  const index = ids.indexOf(activeId);
  if (ids.length < 2 || index < 0) return null;
  return (
    <span className="branch-nav">
      <button
        className="branch-nav-button"
        type="button"
        disabled={index <= 0}
        title={copy.previousBranch}
        aria-label={copy.previousBranch}
        onClick={() => onSelect(ids[index - 1])}
      >
        <ChevronLeft size={13} aria-hidden="true" />
      </button>
      <span className="branch-nav-count">
        {index + 1} / {ids.length}
      </span>
      <button
        className="branch-nav-button"
        type="button"
        disabled={index >= ids.length - 1}
        title={copy.nextBranch}
        aria-label={copy.nextBranch}
        onClick={() => onSelect(ids[index + 1])}
      >
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

function delegationRouteLabel(locale: Locale, routeKind: DelegationInfo["route_kind"]) {
  const copy = t(locale).ui;
  if (routeKind === "direct") return copy.delegationRouteDirect;
  if (routeKind === "solo_thinking") return copy.delegationRouteSolo;
  return copy.delegationRoutePanel;
}

function delegationTooltip(locale: Locale, delegation: DelegationInfo | null) {
  const copy = t(locale).ui;
  if (!delegation) return copy.delegationUnavailable;
  const lines = [
    `${copy.delegationRoute}: ${delegationRouteLabel(locale, delegation.route_kind)}`,
    copy.delegationMode(delegation.discussion_level.toUpperCase(), delegation.deep_think ? copy.enabled : copy.disabled),
    copy.delegationParticipants(delegation.participant_count),
  ];
  if (delegation.max_rounds > 0) {
    if (delegation.early_stop && delegation.actual_rounds !== undefined) {
      // Show early stop information
      const actualRounds = delegation.actual_rounds;
      const maxRounds = delegation.max_rounds;
      const convergenceInfo = delegation.convergence_score
        ? ` (${Math.round(delegation.convergence_score * 100)}% converged)`
        : '';
      lines.push(`Rounds: ${actualRounds}/${maxRounds} (stopped early${convergenceInfo})`);
    } else {
      lines.push(copy.delegationRounds(delegation.max_rounds));
    }
  }
  const agentLines = delegation.agents.slice(0, 6).map((agent) =>
    copy.delegationAgentLine(agent.nickname || agent.name, agent.role, agent.model)
  );
  if (agentLines.length) {
    lines.push(...agentLines);
  }
  return lines.join("\n");
}

function MessageActions({
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
      <AgentStrip
        agents={delegation?.agents ?? []}
        messages={discussion}
        locale={locale}
        tooltip={tooltip}
        onOpen={onOpenDiscussion}
        openLabel={openLabel}
      />
      {copied ? <span className="message-action-status">{copy.copied}</span> : null}
    </div>
  );
}

const COMPOSER_TEXTAREA_MAX_HEIGHT = 176;

function DiscussionModePicker({
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
  const levels = useMemo(() => discussionLevels(locale), [locale]);
  const active = levels.find((d) => d.id === discussionLevel) ?? levels[0];
  const isActive = discussionLevel !== "off";
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
      <div className="discussion-mode-control">
        <button
          className={cn("discussion-level-trigger", "discussion-level-trigger-topbar", isActive && "discussion-level-trigger-active")}
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

function Composer({
  input,
  loading,
  paused,
  pauseFlash,
  locale,
  setInput,
  onSubmit,
  onPause,
}: {
  input: string;
  loading: boolean;
  paused: boolean;
  pauseFlash: boolean;
  locale: Locale;
  setInput: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onPause: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
      <div className="composer-input-row">
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
          {node.summary ? <div className="reasoning-tree-summary markdown-body"><Markdown content={node.summary} /></div> : null}
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
                      <Markdown content={item.body} />
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

function SettingsOverlay({
  agents,
  agentsError,
  agentsLoading,
  globalSkills,
  providers,
  providersLoading,
  secretStatus,
  settingsTab,
  locale,
  developerMode,
  logLevel,
  developerStatus,
  developerDiagnostics,
  setLocale,
  setDeveloperMode,
  setLogLevel,
  setSettingsOpen,
  setSettingsTab,
  onModelsChanged,
  refreshDeveloperDiagnostics,
  onAddExpert,
  onEditExpert,
  onDeleteExpert,
}: {
  agents: AgentView[];
  agentsError: string | null;
  agentsLoading: boolean;
  globalSkills: string[];
  providers: ProviderProfile[];
  providersLoading: boolean;
  secretStatus: Record<string, ProviderSecretStatus>;
  settingsTab: SettingsTab;
  locale: Locale;
  developerMode: boolean;
  logLevel: LogLevel;
  developerStatus: string | null;
  developerDiagnostics: DeveloperDiagnostics | null;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setDeveloperMode: Dispatch<SetStateAction<boolean>>;
  setLogLevel: Dispatch<SetStateAction<LogLevel>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  onModelsChanged: () => Promise<void>;
  refreshDeveloperDiagnostics: () => void;
  onAddExpert: () => void;
  onEditExpert: (agent: AgentView) => void;
  onDeleteExpert: (name: string) => void;
}) {
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const copy = t(locale).ui;
  const skillCountLabel = copy.globalSkillsCount(globalSkills.length);
  const logLevelOptions: Array<{ id: LogLevel; label: string; description: string }> = [
    { id: "error", label: copy.logLevelError, description: copy.logLevelErrorDescription },
    { id: "info", label: copy.logLevelInfo, description: copy.logLevelInfoDescription },
    { id: "debug", label: copy.logLevelDebug, description: copy.logLevelDebugDescription },
  ];
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
          <ModelList
            providers={providers}
            loading={providersLoading}
            secretStatus={secretStatus}
            locale={locale}
            onChanged={onModelsChanged}
          />
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
            {agentsLoading && agents.length === 0 ? (
              <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
                {[0, 1, 2, 3].map((index) => (
                  <section className="settings-card settings-card-skeleton" key={index}>
                    <div className="skeleton skeleton-line" style={{ width: "42%" }} />
                    <div className="skeleton skeleton-line skeleton-line-faint" style={{ width: "26%" }} />
                    <div className="skeleton skeleton-line skeleton-line-faint" style={{ width: "72%" }} />
                    <div className="skeleton skeleton-line skeleton-line-faint" style={{ width: "58%" }} />
                  </section>
                ))}
              </div>
            ) : agents.length ? (
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

        {settingsTab === "memory" ? <MemoryPanel agents={agents} locale={locale} /> : null}

        {settingsTab !== "providers" && settingsTab !== "experts" && settingsTab !== "memory" ? (
          <section className="settings-section">
            {settingsTab === "general" ? (
              <div className="settings-list">
                <div className="settings-row">
                  <div className="settings-row-title">{t(locale).ui.language}</div>
                  <div className="settings-language-options">
                    <button
                      className={cn(
                        "settings-choice",
                        locale === "zh-CN" && "settings-choice-active"
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
                        "settings-choice",
                        locale === "en" && "settings-choice-active"
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
            ) : settingsTab === "developer" ? (
              <div className="settings-list">
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">{copy.developerMode}</div>
                    <div className="settings-row-description">{copy.developerModeDescription}</div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={developerMode}
                      onChange={(event) => setDeveloperMode(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <div className="settings-row settings-row-stacked">
                  <div>
                    <div className="settings-row-title">{copy.logLevel}</div>
                    <div className="settings-row-description">{copy.logLevelDescription}</div>
                  </div>
                  <div className="settings-choice-stack">
                    {logLevelOptions.map((option) => (
                      <button
                        key={option.id}
                        className={cn("settings-log-choice", logLevel === option.id && "settings-log-choice-active")}
                        onClick={() => setLogLevel(option.id)}
                        type="button"
                      >
                        <span>{option.label}</span>
                        <small>{option.description}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row settings-row-stacked">
                  <div className="settings-row-inline">
                    <div>
                      <div className="settings-row-title">{copy.diagnostics}</div>
                      <div className="settings-row-description">{copy.diagnosticsDescription}</div>
                    </div>
                    <button className="small-button small-button-icon" type="button" onClick={refreshDeveloperDiagnostics}>
                      <FlaskConical size={14} aria-hidden="true" />
                      <span>{copy.refresh}</span>
                    </button>
                  </div>
                  <div className="developer-diagnostics">
                    <div>
                      <span>{copy.apiBaseUrl}</span>
                      <strong>{developerDiagnostics?.api_base_url || API_BASE}</strong>
                    </div>
                    <div>
                      <span>{copy.conversationStore}</span>
                      <strong>{developerDiagnostics?.conversation_store_path ?? copy.notLoaded}</strong>
                    </div>
                    <div>
                      <span>{copy.conversationCount}</span>
                      <strong>{developerDiagnostics?.conversation_count ?? copy.notLoaded}</strong>
                    </div>
                    <div>
                      <span>{copy.runningJobs}</span>
                      <strong>{developerDiagnostics ? `${developerDiagnostics.jobs_running}/${developerDiagnostics.jobs_total}` : copy.notLoaded}</strong>
                    </div>
                    <div>
                      <span>{copy.backendLogLevel}</span>
                      <strong>{developerDiagnostics?.log_level ?? logLevel.toUpperCase()}</strong>
                    </div>
                  </div>
                  {developerStatus ? <div className="settings-status-text">{developerStatus}</div> : null}
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
  if (tab === "memory") return t(locale).ui.memory;
  if (tab === "skills") return t(locale).ui.skills;
  if (tab === "data") return t(locale).ui.data;
  if (tab === "developer") return t(locale).ui.developer;
  return t(locale).ui.general;
}

function settingsSubtitle(tab: SettingsTab, locale: Locale) {
  const copy = t(locale).ui;
  if (tab === "providers") return copy.settingsSubtitleProviders;
  if (tab === "experts") return copy.settingsSubtitleExperts;
  if (tab === "memory") return copy.settingsSubtitleMemory;
  if (tab === "skills") return copy.settingsSubtitleSkills;
  if (tab === "data") return copy.settingsSubtitleData;
  if (tab === "developer") return copy.settingsSubtitleDeveloper;
  return copy.settingsSubtitleGeneral;
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
        {selectedProvider ? (
          <ProfileIcon provider={selectedProvider} size={30} className="provider-select-icon" />
        ) : (
          <span className="provider-select-icon" aria-hidden="true" />
        )}
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
                <ProfileIcon provider={provider} size={30} className="provider-select-icon" />
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
  const providerModels = selectedProvider ? modelsOf(selectedProvider).filter((entry) => entry.enabled) : [];
  // Keep a saved-but-now-disabled model visible instead of silently rewriting the expert.
  const modelOptions =
    model && !providerModels.some((entry) => entry.id === model) ? [{ id: model, label: model }, ...providerModels] : providerModels;

  useEffect(() => {
    if (selectedProvider && !model) {
      setModel(pickDefaultModel(modelsOf(selectedProvider), selectedProvider.default_model));
    }
  }, [providerProfile, selectedProvider, model]);

  function handleProviderChange(nextProviderId: string) {
    const nextProvider = providers.find((provider) => provider.provider_id === nextProviderId);
    const currentDefault = selectedProvider?.default_model ?? "";
    setProviderProfile(nextProviderId);
    if (!model || model === currentDefault) {
      setModel(nextProvider ? pickDefaultModel(modelsOf(nextProvider), nextProvider.default_model) : "");
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
              disabled={mode === "edit"}
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
              placeholder={copy.displayName}
            />
          </label>

          {/* provider_profile */}
          <label className="settings-field">
            <span className="settings-label">{copy.modelProvider}</span>
            <ProviderSelect
              providers={providers}
              value={providerProfile}
              locale={locale}
              onChange={handleProviderChange}
            />
          </label>

          {/* model */}
          <label className="settings-field">
            <span className="settings-label">{copy.model}</span>
            {providerModels.length ? (
              <select
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label || entry.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={selectedProvider?.default_model ?? "model id"}
              />
            )}
          </label>

          {/* system_prompt */}
          <label className="settings-field">
            <span className="settings-label">{copy.systemPrompt}</span>
            <textarea
              className="settings-input"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
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
            {isSystem ? (
              <p className="mt-1 text-xs text-muted">{copy.systemRoleLocked}</p>
            ) : null}
          </div>

          <div className="settings-field">
            <span className="settings-label">{copy.allowedGlobalSkills}</span>
            <SkillPicker
              skills={globalSkills}
              value={allowedSkills}
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
