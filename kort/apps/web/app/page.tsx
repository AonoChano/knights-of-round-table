"use client";

import "katex/dist/katex.min.css";

import { useEffect, useMemo, useState } from "react";
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
  question: string;
  expert_count: number;
  status: "completed";
  stage_summaries: StageSummary[];
  final_answer: FinalAnswer;
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
  status: "streaming" | "complete" | "active" | "done";
};

type StreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

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

const sampleConversations = [
  "如何提高大模型推理能力？",
  "量子计算的基本原理是什么？",
  "Python 中装饰器的工作原理",
  "推荐几本关于复杂系统的书籍",
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

  useEffect(() => {
    void loadProviders();
    void loadProviderSecretStatuses();
    void loadAgents();
  }, []);

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

  async function sendQuestion() {
    const question = input.trim();
    if (!question) return;

    setSubmittedQuestion(question);
    setInput("");
    setConversation(null);
    setTimeline([]);
    setFinalBody("");
    setThinkingComplete(false);
    setElapsed(0);
    setDrawerOpen(false);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/conversations/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
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
    }
  }

  function handleStreamEvent(message: StreamEvent) {
    if (message.event === "summary_start") {
      const id = String(message.data.id ?? crypto.randomUUID());
      setTimeline((current) => [
        ...current.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done"),
        { id, title: "Thinking", body: "", raw: "", status: "streaming" },
      ]);
      return;
    }

    if (message.event === "summary_delta") {
      const id = String(message.data.id ?? "");
      const delta = String(message.data.delta ?? "");
      setTimeline((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          const raw = item.raw + delta;
          return {
            ...item,
            raw,
            title: markdownTitle(raw, item.title),
            body: markdownBody(raw),
          };
        })
      );
      return;
    }

    if (message.event === "summary_complete") {
      const id = String(message.data.id ?? "");
      setTimeline((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "complete" } : item))
      );
      return;
    }

    if (message.event === "thinking_active") {
      setTimeline((current) => [
        ...current.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done"),
        { id: "thinking-active", title: "思考中", body: "", raw: "", status: "active" },
      ]);
      return;
    }

    if (message.event === "thinking_complete") {
      setThinkingComplete(true);
      setTimeline((current) => [
        ...current.filter((item) => item.id !== "thinking-active" && item.id !== "thinking-done"),
        { id: "thinking-done", title: "已完成思考", body: "", raw: "", status: "done" },
      ]);
      return;
    }

    if (message.event === "final_delta") {
      setFinalBody((current) => current + String(message.data.delta ?? ""));
      return;
    }

    if (message.event === "conversation_complete") {
      setConversation(message.data as unknown as ConversationResponse);
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

  const currentReasoning = [...visibleTimeline].reverse().find((item) => item.status === "streaming" || item.status === "complete");
  const activeTitle = currentReasoning?.title ?? (thinkingComplete ? "已完成思考" : "Thinking");
  const hasRun = Boolean(submittedQuestion || conversation || loading);

  return (
    <main className="app-shell">
      <Sidebar
        agents={agents}
        sampleConversations={sampleConversations}
        setInput={setInput}
        openSettings={(tab) => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
      />

      <section className="main-shell">
        <header className="topbar">
          <button
            className="brand-button"
            onClick={() => {
              setConversation(null);
              setSubmittedQuestion(null);
              setTimeline([]);
              setFinalBody("");
              setThinkingComplete(false);
              setElapsed(0);
              setDrawerOpen(false);
            }}
          >
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
                question={submittedQuestion}
                timeline={visibleTimeline}
                finalBody={finalBody || conversation?.final_answer.body || ""}
                onOpenThinking={() => setDrawerOpen(true)}
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
            setInput={setInput}
            onSubmit={() => void sendQuestion()}
            openSettings={() => {
              setSettingsTab("experts");
              setSettingsOpen(true);
            }}
          />
        </div>

        {(loading || conversation) && !drawerOpen ? (
          <button className="thinking-trigger" onClick={() => setDrawerOpen(true)} aria-label="Open thinking timeline">
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
        />
      ) : null}
    </main>
  );
}

function Sidebar({
  agents,
  sampleConversations,
  setInput,
  openSettings,
}: {
  agents: AgentView[];
  sampleConversations: string[];
  setInput: Dispatch<SetStateAction<string>>;
  openSettings: (tab: SettingsTab) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="logo-mark">K</div>
          <button className="small-button">新建</button>
        </div>
        <button className="sidebar-primary" onClick={() => setInput("")}>
          新对话
        </button>
        <div className="space-y-1">
          <div className="px-2 py-1 text-xs text-muted">今天</div>
          {sampleConversations.map((item) => (
            <button key={item} className="sidebar-link" onClick={() => setInput(item)}>
              {item}
            </button>
          ))}
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
    </aside>
  );
}

function ConversationView({
  conversation,
  loading,
  question,
  timeline,
  finalBody,
  onOpenThinking,
}: {
  conversation: ConversationResponse | null;
  loading: boolean;
  question: string | null;
  timeline: TimelineItem[];
  finalBody: string;
  onOpenThinking: () => void;
}) {
  const latest = [...timeline].reverse().find((item) => item.status === "streaming" || item.status === "complete");

  return (
    <div className="conversation-stack">
      {question ? <div className="user-message">{question}</div> : null}

      <div className="assistant-row">
        <div className="assistant-avatar">K</div>
        <div className="assistant-content">
          <button className="thinking-block" onClick={onOpenThinking}>
            <span className={cn("thinking-title", (loading || conversation) && "thinking-title-active")}>
              {latest?.title ?? "Thinking"}
            </span>
          </button>

          {latest ? (
            <div className="thinking-preview markdown-body">
              <Markdown content={latest.body} />
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
  setInput,
  onSubmit,
  openSettings,
}: {
  input: string;
  loading: boolean;
  setInput: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  openSettings: () => void;
}) {
  return (
    <div className="composer-shell">
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
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
          <button className="icon-soft" title="深度思考" type="button">深</button>
          <button className="icon-soft" title="专家小组配置" type="button" onClick={openSettings}>设</button>
        </div>
        <button className="send-button" disabled={loading || !input.trim()} onClick={onSubmit} type="button">
          {loading ? "..." : "发送"}
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
            {thinkingComplete ? `已完成思考（总用时：${formatDuration(elapsed)}）` : `已进行 ${formatDuration(elapsed)}`}
          </div>
        </div>
        <button className="small-button" onClick={onClose}>收起</button>
      </div>

      <div className="reasoning-timeline">
        {timeline.map((item, index) => (
          <div key={item.id} className="reasoning-node">
            <div className={cn("reasoning-dot", (item.status === "active" || item.status === "streaming") && "reasoning-dot-active", item.status === "done" && "reasoning-dot-done")} />
            {index < timeline.length - 1 ? <div className="reasoning-line" /> : null}
            <div className="reasoning-content">
              <div className={cn("reasoning-title", (item.status === "active" || item.status === "streaming") && "thinking-title-active")}>
                {item.status === "active" ? `思考中（已进行 ${formatDuration(elapsed)}）` : null}
                {item.status === "done" ? `已完成思考✔（总用时：${formatDuration(elapsed)}）` : null}
                {item.status !== "active" && item.status !== "done" ? item.title : null}
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
}) {
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
          agents.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {agents.map((agent) => (
                <section key={agent.name} className="settings-card">
                  <div className="font-medium">{agent.nickname}</div>
                  <div className="mt-1 text-xs text-muted">{agent.name}</div>
                  <div className="mt-4 grid gap-2 text-sm text-muted">
                    <div>角色: {agent.role}</div>
                    <div>模型: {agent.model}</div>
                    <div>Provider: {agent.provider_profile}</div>
                    <div>Skills: {agent.allowed_global_skills.join(", ") || "未配置"}</div>
                    <div>禁用: {agent.disabled_global_skills.join(", ") || "无"}</div>
                    <div>私有 Skills: {agent.private_skill_count}</div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="settings-card text-sm leading-7 text-muted">
              没有加载到专家。{agentsError ? `错误：${agentsError}` : "请确认后端 API 正在运行，并且 runtime/agents 中存在 agent.yaml。"}
            </section>
          )
        ) : null}

        {settingsTab !== "providers" && settingsTab !== "experts" ? (
          <section className="settings-card text-sm leading-7 text-muted">
            该部分保留为 MVP 设置中心骨架。后续会接入真实表单、技能授权和数据清理动作。
          </section>
        ) : null}
      </div>
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
