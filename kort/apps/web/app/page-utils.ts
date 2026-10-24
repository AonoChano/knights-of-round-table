import { Brain, Bug, Database, KeyRound, SlidersHorizontal, UsersRound, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ComposerAttachmentPayload, WebSearchMode } from "../components/composer/Composer";
import { t } from "./locale";
import type { DiscussionLevel, Locale } from "./locale";
import type {
  ToolTrace,
  TimerHandle,
  ThinkingTreeNode,
  StageSummary,
  DelegatedAgent,
  DelegationInfo,
  MessageNode,
  ConversationResponse,
  ConversationListItem,
  BranchAttempt,
  PendingEdit,
  DiscussionMessage,
  DiscussionViewTarget,
  AgentView,
  LogLevel,
  DeveloperDiagnostics,
  SettingsTab,
  ToolCallView,
  TimelineItem,
  StreamEvent,
  StreamSlot,
} from "./page-types";

export const settingsTabIcons: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  providers: KeyRound,
  experts: UsersRound,
  memory: Brain,
  skills: Wrench,
  data: Database,
  developer: Bug,
};
export const AGENT_ROLE_OPTIONS = [
  { id: "expert", label: "Expert" },
  { id: "critic", label: "Critic" },
  { id: "summarizer", label: "Summarizer" },
  { id: "synthesizer", label: "Synthesizer" },
];

export const TRANSIENT_TIMELINE_IDS = new Set(["thinking-active", "talking-active"]);
export const DISCUSSION_LEVEL_KEY = "kort-discussion-level";
export const DEEP_THINK_KEY = "kort-deep-think";
export const WEB_SEARCH_MODE_KEY = "kort-web-search-mode";
export const LEGACY_WEB_SEARCH_KEY = "kort-web-search";
export const PREFERRED_AGENT_KEY = "kort-preferred-agent";
export const NORMAL_MODEL_KEY = "kort-normal-model";
export const DEVELOPER_MODE_KEY = "kort-developer-mode";
export const LOG_LEVEL_KEY = "kort-log-level";
export const DEFAULT_DISCUSSION_LEVEL: DiscussionLevel = "auto";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
};

export class RequestTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = "RequestTimeoutError";
  }
}

export function loadDiscussionLevel(): DiscussionLevel {
  if (typeof window === "undefined") return DEFAULT_DISCUSSION_LEVEL;
  const stored = localStorage.getItem(DISCUSSION_LEVEL_KEY);
  return stored === "off" || stored === "auto" || stored === "low" || stored === "medium" || stored === "high"
    ? stored
    : DEFAULT_DISCUSSION_LEVEL;
}

export function saveDiscussionLevel(level: DiscussionLevel): void {
  localStorage.setItem(DISCUSSION_LEVEL_KEY, level);
}

export function loadDeepThink(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEEP_THINK_KEY) === "true";
}

export function saveDeepThink(enabled: boolean): void {
  localStorage.setItem(DEEP_THINK_KEY, String(enabled));
}

export function loadWebSearchMode(): WebSearchMode {
  if (typeof window === "undefined") return "auto";
  const stored = localStorage.getItem(WEB_SEARCH_MODE_KEY);
  if (stored === "auto" || stored === "required" || stored === "disabled") return stored;
  // 旧的布尔值只有“用户显式关过”才值得迁移成 disabled，其余回到默认 auto
  return localStorage.getItem(LEGACY_WEB_SEARCH_KEY) === "false" ? "disabled" : "auto";
}

export function loadPreferredAgent(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(PREFERRED_AGENT_KEY) ?? "";
}

export function loadNormalModel(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(NORMAL_MODEL_KEY) ?? "";
}

export function saveNormalModel(value: string): void {
  if (value) localStorage.setItem(NORMAL_MODEL_KEY, value);
  else localStorage.removeItem(NORMAL_MODEL_KEY);
}

export function splitModelOptionId(value: string): { provider_profile: string; model: string } | null {
  const index = value.indexOf("::");
  if (index <= 0) return null;
  const provider_profile = value.slice(0, index);
  const model = value.slice(index + 2);
  return provider_profile && model ? { provider_profile, model } : null;
}

export function loadDeveloperMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEVELOPER_MODE_KEY) === "true";
}

export function saveDeveloperMode(enabled: boolean): void {
  localStorage.setItem(DEVELOPER_MODE_KEY, String(enabled));
}

export function loadLogLevel(): LogLevel {
  if (typeof window === "undefined") return DEFAULT_LOG_LEVEL;
  const stored = localStorage.getItem(LOG_LEVEL_KEY);
  return stored === "error" || stored === "info" || stored === "debug" ? stored : DEFAULT_LOG_LEVEL;
}

export function saveLogLevel(level: LogLevel): void {
  localStorage.setItem(LOG_LEVEL_KEY, level);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
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

export function logClientEvent(
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

export function createEmptySlot(): StreamSlot {
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
    pendingEdit: null,
    plannedConversationId: null,
    deepThink: loadDeepThink(),
    requestPhase: null,
    delegationInfo: null,
    paused: false,
    conversation: null,
    streamError: null,
    discussionMessages: [],
    toolTraces: [],
  };
}

export function withoutTransientTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items.filter((item) => !TRANSIENT_TIMELINE_IDS.has(item.id));
}

export function upsertSummaryStart(items: TimelineItem[], id: string, fallbackTitle: string): TimelineItem[] {
  if (items.some((item) => item.id === id)) {
    return items.map((item) =>
      item.id === id ? { ...item, title: item.title || fallbackTitle, status: "streaming" as const } : item
    );
  }
  return [...items, { id, title: fallbackTitle, body: "", raw: "", status: "streaming" as const }];
}

export function callTitle(locale: Locale, call: ToolCallView): string {
  const copy = t(locale).thinking;
  if (call.name === "web_fetch") return call.url || copy.reading;
  return call.query || copy.searching;
}

export function itemFromCall(call: ToolCallView, locale: Locale, order: number): TimelineItem {
  return {
    id: `tool-${call.callId}`,
    title: callTitle(locale, call),
    body: "",
    raw: "",
    status: call.state === "running" ? "active" : "complete",
    order,
    call,
  };
}

export function itemFromTrace(trace: ToolTrace, locale: Locale): TimelineItem {
  const call: ToolCallView = {
    callId: trace.call_id || trace.id,
    name: trace.tool === "fetch" ? "web_fetch" : "web_search",
    state: trace.status === "running" ? "running" : trace.status === "error" ? "failed" : "complete",
    query: trace.query,
    url: trace.url,
    error: trace.error ?? undefined,
    trace,
  };
  return itemFromCall(call, locale, trace.order ?? 0);
}

/** Merge a provider tool call with the trace its execution emitted, matched on the call id. */
export function attachTrace(items: TimelineItem[], trace: ToolTrace, locale: Locale): TimelineItem[] {
  const id = `tool-${trace.call_id || trace.id}`;
  if (!items.some((item) => item.id === id)) {
    return [...items, itemFromTrace(trace, locale)];
  }
  return items.map((item) => {
    if (item.id !== id || !item.call) return item;
    return {
      ...item,
      call: {
        ...item.call,
        trace,
        query: item.call.query || trace.query,
        url: item.call.url || trace.url,
        error: trace.status === "error" ? trace.error ?? undefined : item.call.error,
      },
    };
  });
}

export function patchCall(
  items: TimelineItem[],
  callId: string,
  patch: Partial<ToolCallView>,
  locale: Locale
): TimelineItem[] {
  const id = `tool-${callId}`;
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<ToolCallView>;
  if (!items.some((item) => item.id === id)) {
    const base: ToolCallView = { callId, name: String(clean.name ?? ""), state: "running", ...clean };
    return [...items, itemFromCall(base, locale, items.length + 1)];
  }
  return items.map((item) => {
    if (item.id !== id || !item.call) return item;
    const call = { ...item.call, ...clean };
    return {
      ...item,
      call,
      title: callTitle(locale, call),
      status: call.state === "running" ? ("active" as const) : ("complete" as const),
    };
  });
}

export function callArgs(data: Record<string, unknown>): { query?: string; url?: string } {
  const args = (data.arguments ?? {}) as Record<string, unknown>;
  return {
    query: typeof args.query === "string" ? args.query : undefined,
    url: typeof args.url === "string" ? args.url : undefined,
  };
}

export function mergeOrdered(groups: TimelineItem[][]): TimelineItem[] {
  const flat = groups.flat();
  return flat
    .map((item, index) => ({ item, rank: item.order && item.order > 0 ? item.order : 1_000_000 + index }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}

export function dedupeTimelineItems(items: TimelineItem[]): TimelineItem[] {
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


export const SENTENCE_BOUNDARY_RE = /[。！？…；\n]+/g;

export function settingsTabs(locale: Locale): Array<{ id: SettingsTab; label: string }> {
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

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function clientErrorMessage(error: unknown, fallback: string) {
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

export function isExpectedAbortError(error: unknown): boolean {
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

export function parseThinkingTreeNodes(value: unknown): ThinkingTreeNode[] {
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

export function parseDelegatedAgents(value: unknown): DelegatedAgent[] {
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

export function parseDelegationInfo(value: unknown): DelegationInfo | null {
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

export function parseDiscussionMessage(value: unknown): DiscussionMessage | null {
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

export function parseDiscussionMessages(value: unknown): DiscussionMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseDiscussionMessage)
    .filter((item): item is DiscussionMessage => Boolean(item));
}

export function appendDiscussionMessage(
  current: DiscussionMessage[],
  message: DiscussionMessage
): DiscussionMessage[] {
  if (current.some((item) => item.id === message.id)) return current;
  return [...current, message];
}

export function parseToolTrace(value: unknown): ToolTrace | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string") return null;
  if (item.tool !== "search" && item.tool !== "fetch") return null;
  const status =
    item.status === "running" || item.status === "error" ? item.status : "complete";
  const sources = Array.isArray(item.sources)
    ? item.sources.flatMap((source) => {
        if (!source || typeof source !== "object") return [];
        const raw = source as Record<string, unknown>;
        if (typeof raw.url !== "string" || !raw.url) return [];
        return [
          {
            title: typeof raw.title === "string" ? raw.title : raw.url,
            url: raw.url,
            domain: typeof raw.domain === "string" ? raw.domain : undefined,
            snippet: typeof raw.snippet === "string" ? raw.snippet : undefined,
          },
        ];
      })
    : [];
  return {
    id: item.id,
    tool: item.tool,
    status,
    call_id: typeof item.call_id === "string" ? item.call_id : "",
    order: typeof item.order === "number" ? item.order : 0,
    query: typeof item.query === "string" ? item.query : "",
    url: typeof item.url === "string" ? item.url : "",
    title: typeof item.title === "string" ? item.title : "",
    error: typeof item.error === "string" ? item.error : null,
    duration_ms: typeof item.duration_ms === "number" ? item.duration_ms : 0,
    sources,
    excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
    source_count: typeof item.source_count === "number" ? item.source_count : sources.length,
  };
}

export function parseToolTraces(value: unknown): ToolTrace[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseToolTrace)
    .filter((item): item is ToolTrace => Boolean(item));
}

export function parseAttachments(value: unknown): ComposerAttachmentPayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Record<string, unknown> | null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => typeof item.name === "string")
    .map((item) => ({
      kind: item.kind === "image" ? ("image" as const) : ("text" as const),
      name: item.name as string,
      mime: typeof item.mime === "string" ? item.mime : "",
      text: typeof item.text === "string" ? item.text : "",
      ...(typeof item.data === "string" ? { data: item.data } : {}),
      ...(typeof item.width === "number" ? { width: item.width } : {}),
      ...(typeof item.height === "number" ? { height: item.height } : {}),
      ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
    }));
}

export function upsertToolTrace(current: ToolTrace[], trace: ToolTrace): ToolTrace[] {
  const exists = current.some((item) => item.id === trace.id);
  return exists ? current.map((item) => (item.id === trace.id ? trace : item)) : [...current, trace];
}

export function markdownTitle(markdown: string, fallback: string) {
  const firstHeading = markdown.match(/^###\s+(.+)$/m);
  return firstHeading?.[1]?.trim() || fallback;
}

export function markdownBody(markdown: string) {
  return markdown.replace(/^###[^\n]*\n*/m, "").trim();
}

export function truncateWords(text: string, maxWords: number) {
  const cjk = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
  if (cjk.test(text)) {
    if (text.length <= maxWords * 3) return text;
    return text.slice(0, maxWords * 3) + "…";
  }
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes} min ${seconds}s`;
}

export function thinkingElapsedLabel(locale: Locale, elapsed: number, complete: boolean) {
  const duration = formatDuration(elapsed);
  const copy = t(locale).ui;
  return complete ? copy.thinkingElapsedComplete(duration) : copy.thinkingElapsedActive(duration);
}

/** Backend reports ms; anything ≤0 means "not recorded" rather than a real 0s thought. */
export function elapsedMsToSeconds(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value / 1000));
}

export function nodeElapsedSeconds(node: MessageNode): number | undefined {
  return elapsedMsToSeconds(node.elapsed_ms) ?? undefined;
}

export function randomNewChatPrompt(locale: Locale) {
  const prompts = t(locale).ui.newChatPrompts;
  return prompts[Math.floor(Math.random() * prompts.length)] ?? prompts[0] ?? "";
}

export function defaultNewChatPrompt(locale: Locale) {
  return t(locale).ui.newChatPrompts[0] ?? "";
}

export function appendThinkingDoneNode(items: TimelineItem[], locale: Locale, elapsedSeconds?: number): TimelineItem[] {
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

export function appendThinkingCancelledNode(items: TimelineItem[], locale: Locale): TimelineItem[] {
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

export function timelineFromStageSummaries(
  stageSummaries: StageSummary[] | undefined,
  locale: Locale,
  elapsedSeconds?: number,
  cancelled = false,
  traces?: ToolTrace[]
): TimelineItem[] {
  const items = mergeOrdered([
    (stageSummaries ?? []).map((s) => ({
      id: s.id,
      title: markdownTitle(s.details, s.title),
      body: markdownBody(s.details),
      raw: s.details,
      status: "complete" as const,
      treeNodes: s.tree_nodes ?? [],
      order: s.order ?? 0,
    })),
    (traces ?? []).map((trace) => itemFromTrace(trace, locale)),
  ]);
  if (cancelled) return appendThinkingCancelledNode(items, locale);
  return items.length > 0 ? appendThinkingDoneNode(items, locale, elapsedSeconds) : [];
}

export function activePathOf(nodes: MessageNode[], rootId: string | null): MessageNode[] {
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

export function activeLeafId(nodes: MessageNode[], rootId: string | null): string | null {
  const path = activePathOf(nodes, rootId);
  return path.length > 0 ? path[path.length - 1].node_id : null;
}

export function siblingIdsOf(nodes: MessageNode[], node: MessageNode): string[] {
  return nodes
    .filter((item) => item.parent_id === node.parent_id && item.role === node.role)
    .map((item) => item.node_id);
}

export function upsertNode(nodes: MessageNode[], node: MessageNode): MessageNode[] {
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

export function parseMessageNode(value: unknown): MessageNode | null {
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
    tool_traces: parseToolTraces(raw.tool_traces),
    attachments: parseAttachments(raw.attachments),
    active_child_id: typeof raw.active_child_id === "string" ? raw.active_child_id : null,
    children: Array.isArray(raw.children) ? raw.children.filter((item): item is string => typeof item === "string") : [],
  };
}

export function parseSseChunk(buffer: string): { events: StreamEvent[]; rest: string } {
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

export function extractSentences(text: string) {
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

export function randomDelay() {
  return 1000 + Math.random() * 1000;
}

export function waitingStatusText(
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

function delegationRouteLabel(locale: Locale, routeKind: DelegationInfo["route_kind"]) {
  const copy = t(locale).ui;
  if (routeKind === "direct") return copy.delegationRouteDirect;
  if (routeKind === "solo_thinking") return copy.delegationRouteSolo;
  return copy.delegationRoutePanel;
}

export function delegationTooltip(locale: Locale, delegation: DelegationInfo | null) {
  const copy = t(locale).ui;
  if (!delegation) return copy.delegationUnavailable;
  const lines = [
    `${copy.delegationRoute}: ${delegationRouteLabel(locale, delegation.route_kind)}`,
    copy.delegationMode(delegation.discussion_level.toUpperCase(), delegation.deep_think ? copy.enabled : copy.disabled),
    copy.delegationParticipants(delegation.participant_count),
  ];
  if (delegation.max_rounds > 0) {
    if (delegation.early_stop && delegation.actual_rounds !== undefined) {
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
  return lines.join("\n");
}
