"use client";

import "katex/dist/katex.min.css";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

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

type ConversationResponse = {
  conversation_id: string;
  created_at: string;
  question: string;
  expert_count: number;
  status: "completed";
  stage_summaries: StageSummary[];
  final_answer: FinalAnswer;
};

type ConversationListItem = {
  conversation_id: string;
  question: string;
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

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "通用" },
  { id: "providers", label: "模型提供商" },
  { id: "experts", label: "专家小组" },
  { id: "skills", label: "Skills" },
  { id: "data", label: "数据与日志" },
];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function statusText(message: string) {
  return message
    .replace("Provider profile was not found.", "未找到模型提供商配置。")
    .replace("Provider profile is disabled.", "该模型提供商已禁用。")
    .replace("Provider base_url must be an absolute http(s) URL.", "Base URL 必须是完整的 http(s) 地址。")
    .replace("No API key was supplied", "未提供 API Key")
    .replace("Profile is ready", "配置已就绪")
    .replace("using temporary input", "使用当前输入框中的临时密钥")
    .replace("using saved local key", "使用已保存的本地密钥")
    .replace("using environment variable", "使用环境变量");
}

function markdownTitle(markdown: string, fallback: string) {
  const firstHeading = markdown.match(/^###\s+(.+)$/m);
  return firstHeading?.[1]?.trim() || fallback;
}

function markdownBody(markdown: string) {
  return markdown.replace(/^###\s+.+\n+/, "").trim();
}

function truncateWords(text: string, maxWords: number) {
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [thinkingComplete, setThinkingComplete] = useState(false);
  const [finalBody, setFinalBody] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [talkingActive, setTalkingActive] = useState(false);
  const [discussionLevel, setDiscussionLevel] = useState<DiscussionLevel>("auto");
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [messagePairs, setMessagePairs] = useState<MessagePair[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [expertModalOpen, setExpertModalOpen] = useState(false);
  const [expertModalMode, setExpertModalMode] = useState<"create" | "edit">("create");
  const [editingAgent, setEditingAgent] = useState<AgentView | null>(null);

  const sentenceQueueRef = useRef<string[]>([]);
  const sentenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSummaryRef = useRef<string>("");
  const timerElapsedRef = useRef(false);
  const rawBodyBySummary = useRef<Record<string, string>>({});
  const timelineRef = useRef<TimelineItem[]>([]);
  const finalBodyRef = useRef("");
  const submittedQuestionRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  function clearSentenceState() {
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
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
    clearSentenceState();
    setConversation(null);
    setTimeline([]);
    setFinalBody("");
    setThinkingComplete(false);
    setElapsed(0);
    setDrawerOpen(false);
    setTalkingActive(false);
  }

  function fullReset() {
    resetConversation();
    setSubmittedQuestion(null);
    setMessagePairs([]);
    setCurrentConversationId(null);
    setConversation(null);
  }

  useEffect(() => {
    void loadProviders();
    void loadProviderSecretStatuses();
    void loadAgents();
    void loadConversations();
  }, []);

  useEffect(() => {
    return () => clearSentenceState();
  }, []);

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

  async function createAgent(data: { name: string; nickname: string; role: string; provider_profile: string; model: string; system_prompt: string; priority: number }) {
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
      setConversations([]);
    }
  }

  async function loadConversation(conversationId: string) {
    resetConversation();
    setMessagePairs([]);
    setCurrentConversationId(null);
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ConversationResponse;
      setConversation(payload);
      setSubmittedQuestion(payload.question);
    } catch {
      // silently fail
    }
  }

  async function renameConversation(conversationId: string, newName: string) {
    try {
      const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: newName }),
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
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
  }

  async function sendQuestion() {
    const question = input.trim();
    if (!question) return;

    const isNewConversation = !currentConversationId;

    if (isNewConversation) {
      setMessagePairs([]);
      setConversation(null);
    }

    clearSentenceState();
    setTimeline([]);
    setFinalBody("");
    setThinkingComplete(false);
    setElapsed(0);
    setDrawerOpen(false);
    setTalkingActive(false);

    setSubmittedQuestion(question);
    submittedQuestionRef.current = question;
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body: Record<string, string> = { question, level: discussionLevel };
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
          handleStreamEvent(event);
        }
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }

  function handleStreamEvent(message: StreamEvent) {
    if (message.event === "talking_active") {
      setTalkingActive(true);
      setTimeline((current) => {
        const filtered = current.filter(
          (item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"
        );
        return [...filtered, { id: "talking-active", title: "讨论中", body: "", raw: "", status: "talking" }];
      });
      return;
    }

    if (message.event === "thinking_active") {
      setTalkingActive(false);
      setTimeline((current) => {
        const filtered = current.filter(
          (item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"
        );
        return [...filtered, { id: "thinking-active", title: "思考中", body: "", raw: "", status: "active" }];
      });
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
      setTimeline((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          return { ...item, raw: item.raw + delta };
        })
      );

      const raw = rawBodyBySummary.current[id];
      const earlyTitle = raw.match(/^###\s+(.+)\n/m)?.[1]?.trim();
      if (earlyTitle) {
        setTimeline((current) =>
          current.map((item) =>
            item.id === id && item.title === "Thinking" ? { ...item, title: earlyTitle } : item
          )
        );
      }

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
      setTimeline((current) => [
        ...current.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done" && item.id !== "talking-active"),
        { id: "thinking-done", title: "已完成思考", body: "", raw: "", status: "done" },
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
      const snapshotTimeline = timelineRef.current.filter(
        (t) => t.id !== "thinking-active" && t.id !== "thinking-done" && t.id !== "talking-active"
      );
      const snapshotBody = finalBodyRef.current;
      const question = submittedQuestionRef.current;
      if (question) {
        setMessagePairs((prev) => [
          ...prev,
          { question, timeline: snapshotTimeline, finalBody: snapshotBody },
        ]);
      }
      setTimeline([]);
      setFinalBody("");
      setSubmittedQuestion(null);
      submittedQuestionRef.current = null;
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
      [providerId]: response.ok ? statusText(payload.message) : "测试失败，请检查后端服务",
    }));
  }

  const visibleTimeline = useMemo(() => {
    if (timeline.length) return timeline;
    return (
      conversation?.stage_summaries.map((stage) => ({
        id: stage.id,
        title: markdownTitle(stage.details, stage.title),
        body: markdownBody(stage.details),
        raw: stage.details,
        status: "complete" as const,
      })) ?? []
    );
  }, [conversation, timeline]);

  const currentReasoning = [...visibleTimeline].reverse().find(
    (item) => item.status === "streaming" || item.status === "complete"
  );
  const statusItem = visibleTimeline.find(
    (item) => item.status === "active" || item.status === "talking" || item.status === "done"
  );
  const activeTitle = statusItem?.title ?? currentReasoning?.title ?? (thinkingComplete ? "已完成思考" : "Thinking");
  const hasRun = Boolean(submittedQuestion || conversation || loading || messagePairs.length > 0);

  return (
    <main className="app-shell">
      <Sidebar
        agents={agents}
        conversations={conversations}
        activeConversationId={conversation?.conversation_id ?? null}
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
            <button className="avatar-button" onClick={() => setSettingsOpen(true)}>A</button>
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
                finalBody={finalBody || conversation?.final_answer.body || ""}
                messagePairs={messagePairs}
                onToggleThinking={() => setDrawerOpen((prev) => !prev)}
              />
            ) : (
              <div className="new-chat-prompt">今天想解决什么？</div>
            )}
          </div>
        </div>

        <div className="composer-dock">
          <Composer
            input={input}
            loading={loading}
            discussionLevel={discussionLevel}
            setInput={setInput}
            setDiscussionLevel={setDiscussionLevel}
            onSubmit={() => void sendQuestion()}
            onPause={pauseConversation}
            openSettings={() => {
              setSettingsTab("experts");
              setSettingsOpen(true);
            }}
          />
        </div>

        {(loading || conversation) && !drawerOpen ? (
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
          timeline={visibleTimeline}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsOverlay
          agents={agents}
          agentsError={agentsError}
          providers={providers}
          providerForms={providerForms}
          providerKeys={providerKeys}
          providerSecretStatus={providerSecretStatus}
          providerStatus={providerStatus}
          settingsTab={settingsTab}
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
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  openSettings,
}: {
  agents: AgentView[];
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, name: string) => void;
  onDeleteConversation: (id: string) => void;
  openSettings: (tab: SettingsTab) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const grouped = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);

    const groups: { label: string; items: ConversationListItem[] }[] = [
      { label: "今天", items: [] },
      { label: "昨天", items: [] },
      { label: "更早", items: [] },
    ];

    for (const conv of conversations) {
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

  function startRename(item: ConversationListItem, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(item.conversation_id);
    setEditValue(item.question);
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
                      {item.question}
                    </button>
                  )}
                  <span className="sidebar-link-actions">
                    <button
                      className="sidebar-link-action-btn"
                      title="重命名"
                      onClick={(e) => startRename(item, e)}
                    >
                      ✎
                    </button>
                    <button
                      className="sidebar-link-action-btn sidebar-link-action-delete"
                      title="删除"
                      onClick={(e) => handleDeleteClick(item, e)}
                    >
                      ✕
                    </button>
                  </span>
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
  onToggleThinking,
}: {
  conversation: ConversationResponse | null;
  loading: boolean;
  thinkingComplete: boolean;
  elapsed: number;
  question: string | null;
  timeline: TimelineItem[];
  finalBody: string;
  messagePairs: MessagePair[];
  onToggleThinking: () => void;
}) {
  function renderTurn(pair: MessagePair) {
    const cleanBody = markdownBody(pair.finalBody) || pair.finalBody;
    return (
      <div key={pair.question} className="conversation-stack">
        <div className="user-message">{pair.question}</div>
        <div className="assistant-row">
          <div className="assistant-avatar">K</div>
          <div className="assistant-content">
            <span className="thinking-title text-muted text-xs">已完成思考</span>
            {cleanBody ? (
              <div className="answer-body markdown-body mt-2">
                <Markdown content={cleanBody} />
              </div>
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
  const showPreview = !isDone && latest && latest.body.trim();
  const showCurrentTurn = question || timeline.length > 0 || finalBody;
  const previewTitle = lastCompleteTitle ?? statusItem?.title ?? latest?.title ?? "Thinking";
  const previewBody = latest ? markdownBody(latest.body) : "";

  return (
    <div>
      {messagePairs.map((pair) => renderTurn(pair))}

      {showCurrentTurn ? (
        <div className="conversation-stack">
          {question ? <div className="user-message">{question}</div> : null}

          {isHistoryView ? (
            <div className="assistant-row">
              <div className="assistant-avatar">K</div>
              <div className="assistant-content">
                {finalBody ? (
                  <div className="answer-body markdown-body">
                    <Markdown content={finalBody} />
                    <div className="mt-5 text-xs text-muted">
                      Confidence {Math.round(conversation!.final_answer.confidence * 100)}%
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="assistant-row">
              <div className="assistant-avatar">K</div>
              <div className="assistant-content">
                <button className="thinking-block" onClick={onToggleThinking}>
                  <span className={cn("thinking-title", !isDone && "thinking-title-active", isDone && !!lastCompleteTitle && "thinking-title-active")}>
                    {isDone
                      ? `已完成思考（总用时：${formatDuration(elapsed)}）`
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
                    {conversation ? (
                      <div className="mt-5 text-xs text-muted">
                        Confidence {Math.round(conversation.final_answer.confidence * 100)}%
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}
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
  discussionLevel,
  setInput,
  setDiscussionLevel,
  onSubmit,
  onPause,
  openSettings,
}: {
  input: string;
  loading: boolean;
  discussionLevel: DiscussionLevel;
  setInput: Dispatch<SetStateAction<string>>;
  setDiscussionLevel: Dispatch<SetStateAction<DiscussionLevel>>;
  onSubmit: () => void;
  onPause: () => void;
  openSettings: () => void;
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
        placeholder="向圆桌提出你的问题..."
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
                    <span>{level.label}</span>
                    <span className="discussion-level-tag">{level.id !== "off" ? level.tag : ""}</span>
                    {discussionLevel === level.id ? (
                      <span className="discussion-level-check">✓</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="icon-soft" title="设置" type="button" onClick={openSettings}>设</button>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <button className="send-button-pause" title="暂停" type="button" onClick={onPause}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="1" width="3" height="10" rx="1" />
                <rect x="7" y="1" width="3" height="10" rx="1" />
              </svg>
            </button>
          ) : null}
          <button
            className="send-button"
            disabled={loading || !input.trim()}
            onClick={onSubmit}
            type="button"
          >
            {loading ? (
              <svg
                className="send-button-spinner"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  onClose,
}: {
  loading: boolean;
  elapsed: number;
  thinkingComplete: boolean;
  timeline: TimelineItem[];
  onClose: () => void;
}) {
  return (
    <aside className="thinking-drawer">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold">思考过程</div>
          <div className="mt-1 text-xs text-muted">
            {thinkingComplete
              ? `已完成思考（总用时：${formatDuration(elapsed)}）`
              : `已进行 ${formatDuration(elapsed)}`}
          </div>
        </div>
        <button className="small-button" onClick={onClose}>收起</button>
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
                {item.status === "active" ? `思考中（已进行 ${formatDuration(elapsed)}）` : null}
                {item.status === "talking" ? `讨论中（已进行 ${formatDuration(elapsed)}）` : null}
                {item.status === "done" ? `已完成思考（总用时：${formatDuration(elapsed)}）` : null}
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
  providers,
  providerForms,
  providerKeys,
  providerSecretStatus,
  providerStatus,
  settingsTab,
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
  providers: ProviderProfile[];
  providerForms: Record<string, ProviderProfile>;
  providerKeys: Record<string, string>;
  providerSecretStatus: Record<string, boolean>;
  providerStatus: Record<string, string>;
  settingsTab: SettingsTab;
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
  return (
    <div className="settings-backdrop">
      <div className="hidden w-[260px] border-r border-line bg-white px-4 py-5 md:block">
        <div className="mb-5 text-[15px] font-medium">设置</div>
        {settingsTabs.map((tab) => (
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
            <div className="text-xl font-medium">{settingsTitle(settingsTab)}</div>
            <div className="mt-1 max-w-[640px] text-sm leading-6 text-muted">{settingsSubtitle(settingsTab)}</div>
          </div>
          <button className="small-button" onClick={() => setSettingsOpen(false)}>关闭</button>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">
          {settingsTabs.map((tab) => (
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
            <button
              className="small-button-primary mb-4"
              onClick={onAddExpert}
            >
              + 添加专家
            </button>
            {agents.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {agents.filter(a => a.name !== "summarizer-main" && a.name !== "synthesizer-main").map((agent) => {
                  const isSystem =
                    agent.name === "summarizer-main" || agent.name === "synthesizer-main";
                  return (
                    <section key={agent.name} className="settings-card">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{agent.nickname}</div>
                        {isSystem ? (
                          <span className="rounded border border-line bg-gray-50 px-1.5 py-0.5 text-[11px] text-muted">系统</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">{agent.name}</div>
                      <div className="mt-4 grid gap-2 text-sm text-muted">
                        <div>角色: {agent.role}</div>
                        <div>模型: {agent.model}</div>
                        <div>Provider: {agent.provider_profile}</div>
                        <div>优先级: {agent.priority}</div>
                        <div>Skills: {agent.allowed_global_skills.join(", ") || "未配置"}</div>
                        <div>禁用: {agent.disabled_global_skills.join(", ") || "无"}</div>
                        <div>私有 Skills: {agent.private_skill_count}</div>
                      </div>
                      {!isSystem ? (
                        <div className="mt-3 flex gap-2">
                          <button className="small-button" onClick={() => onEditExpert(agent)}>编辑</button>
                          <button
                            className="small-button"
                            style={{ color: "#d92d20", borderColor: "rgba(217,45,32,0.3)" }}
                            onClick={() => setConfirmDeleteName(agent.name)}
                          >
                            删除
                          </button>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : (
              <section className="settings-card text-sm leading-7 text-muted">
                没有加载到专家。点击上方按钮添加。{agentsError ? `错误：${agentsError}` : ""}
              </section>
            )}
          </>
        ) : null}

        {settingsTab !== "providers" && settingsTab !== "experts" ? (
          <section className="settings-card text-sm leading-7 text-muted">
            该部分保留为 MVP 设置中心骨架。后续会接入真实表单、技能授权和数据清理动作。
          </section>
        ) : null}
      </div>

      {confirmDeleteName ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteName(null)}>
          <div className="sidebar-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm mb-3">确定要删除专家 "{confirmDeleteName}" 吗？</div>
            <div className="flex gap-2 justify-end">
              <button className="small-button" onClick={() => setConfirmDeleteName(null)}>取消</button>
              <button
                className="small-button-primary"
                onClick={() => {
                  onDeleteExpert(confirmDeleteName);
                  setConfirmDeleteName(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function settingsTitle(tab: SettingsTab) {
  if (tab === "providers") return "模型提供商";
  if (tab === "experts") return "专家小组";
  if (tab === "skills") return "Skills";
  if (tab === "data") return "数据与日志";
  return "通用";
}

function settingsSubtitle(tab: SettingsTab) {
  if (tab === "providers") return "开发阶段可在前端配置并保存 API Key。密钥只存本机 runtime/data，用于本地开发。";
  if (tab === "experts") return "默认专家从 runtime/agents 自动加载。角色和提示词定义身份，Skills 只定义可复用能力。";
  if (tab === "skills") return "全局 Skills 是能力模块，不是身份标签。专家通过 yaml 白名单或禁用列表控制访问。";
  if (tab === "data") return "只持久化用户可见投影，不保存原始专家讨论。";
  return "圆桌骑士的基础偏好设置。";
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

function ExpertModal({
  mode,
  agent,
  providers,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  agent: AgentView | null;
  providers: ProviderProfile[];
  onClose: () => void;
  onSave: (data: {
    name: string;
    nickname: string;
    role: string;
    provider_profile: string;
    model: string;
    system_prompt: string;
    priority: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [nickname, setNickname] = useState(agent?.nickname ?? "");
  const [providerProfile, setProviderProfile] = useState(
    agent?.provider_profile ?? (providers[0]?.provider_id ?? "")
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [role, setRole] = useState(agent?.role ?? "expert");
  const [priority, setPriority] = useState(agent?.priority ?? 50);
  const [saving, setSaving] = useState(false);

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
        model: model.trim() || selectedProvider?.default_model || "",
        system_prompt: systemPrompt,
        priority,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isValidName = /^[a-z][a-z0-9-]*$/.test(name);

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.3)",
  };

  const panelStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: "12px",
    boxShadow: "0 16px 48px rgba(0, 0, 0, 0.15)",
    maxWidth: "520px",
    width: "90%",
    maxHeight: "85vh",
    overflow: "auto",
    padding: "24px",
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "20px" }}>
          {mode === "create" ? "添加专家" : "编辑专家"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* name */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>
              名称{mode === "edit" ? "（只读）" : ""}
            </span>
            <input
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode === "edit"}
              placeholder="小写字母开头，仅小写字母、数字、连字符"
            />
            {name && !isValidName ? (
              <span style={{ fontSize: "12px", color: "#d92d20" }}>
                格式不符（需匹配 ^[a-z][a-z0-9-]*$）
              </span>
            ) : null}
          </label>

          {/* nickname */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>昵称</span>
            <input
              className="settings-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="显示名称"
            />
          </label>

          {/* provider_profile */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>模型提供商</span>
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

          {/* model */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>模型</span>
            <input
              className="settings-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={selectedProvider?.default_model ?? ""}
            />
          </label>

          {/* system_prompt */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>系统提示词</span>
            <textarea
              className="settings-input"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="输入该专家的系统提示词..."
            />
          </label>

          {/* role */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>角色</span>
            <select
              className="settings-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="expert">Expert</option>
              <option value="critic">Critic</option>
              <option value="summarizer">Summarizer</option>
              <option value="synthesizer">Synthesizer</option>
            </select>
          </label>

          {/* priority */}
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
            <span style={{ fontWeight: 500 }}>优先级 (0-100)</span>
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

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "24px" }}>
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