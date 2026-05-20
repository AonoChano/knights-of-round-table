"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

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
  "推荐几本关于复杂系统的书",
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

export default function HomePage() {
  const [question, setQuestion] = useState("如何提高大模型推理能力？");
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [providers, setProviders] = useState<ProviderProfile[]>(fallbackProviders);
  const [providerForms, setProviderForms] = useState<Record<string, ProviderProfile>>({});
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [providerSecretStatus, setProviderSecretStatus] = useState<Record<string, boolean>>({});
  const [providerStatus, setProviderStatus] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadProviders();
    void loadProviderSecretStatuses();
    void loadAgents();
  }, []);

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
    if (!question.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = (await response.json()) as ConversationResponse;
      setConversation(payload);
      setDrawerId(payload.stage_summaries[0]?.id ?? null);
    } finally {
      setLoading(false);
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

  const selectedStage = useMemo(
    () => conversation?.stage_summaries.find((item) => item.id === drawerId) ?? null,
    [conversation, drawerId]
  );

  return (
    <main className="flex min-h-screen bg-canvas text-ink">
      <aside className="hidden w-[286px] shrink-0 flex-col justify-between border-r border-line bg-panel/90 px-4 py-5 backdrop-blur lg:flex">
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-white shadow-card">
              K
            </div>
            <button className="rounded-full border border-line bg-white px-3 py-2 text-sm text-muted">新建</button>
          </div>
          <button className="w-full rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-card">
            <span className="text-base font-medium">+ 新对话</span>
          </button>
          <div className="space-y-3">
            <div className="px-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted">今天</div>
            {sampleConversations.map((item, index) => (
              <button
                key={item}
                className={cn(
                  "w-full rounded-2xl px-3 py-3 text-left text-sm transition",
                  index === 0 ? "bg-white shadow-card" : "text-muted hover:bg-white/70"
                )}
                onClick={() => setQuestion(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <button
            className="w-full rounded-[24px] border border-line bg-white/90 p-4 text-left shadow-card"
            onClick={() => {
              setSettingsTab("experts");
              setSettingsOpen(true);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">专家小组状态</div>
              <div className="flex items-center gap-2 text-sm text-[#2f7d32]">
                <span className="breathing-dot h-2.5 w-2.5 rounded-full bg-[#36a852]" />
                就绪
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-muted">
              <div>轮次: 4 / 4</div>
              <div>专家: {agents.length || 0} 个模型</div>
            </div>
          </button>

          <button
            className="flex w-full items-center gap-3 rounded-[24px] border border-line bg-white px-4 py-4 shadow-card"
            onClick={() => setSettingsOpen(true)}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-lg text-white">
              A
            </div>
            <div className="text-left">
              <div className="font-medium">Alex</div>
              <div className="text-sm text-muted">设置与偏好</div>
            </div>
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-5 md:px-7 md:py-7">
          <div>
            <div className="text-2xl font-medium">圆桌骑士</div>
            <div className="mt-1 text-sm text-muted">Multi-LLM 专家小组</div>
          </div>
          <div className="flex items-center gap-3">
            <button className="rounded-full border border-line bg-white px-4 py-2 text-sm shadow-card">分享</button>
            <button
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white"
              onClick={() => setSettingsOpen(true)}
            >
              A
            </button>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-4 pb-8 md:px-6">
          <div className="mb-6 max-w-[76%] self-end rounded-[22px] bg-white px-5 py-4 shadow-card">
            {question}
          </div>

          {conversation ? (
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-sm shadow-card">
                  K
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    className="mb-3 flex items-center gap-2 text-sm text-muted transition hover:text-ink"
                    onClick={() => setDrawerId(conversation.stage_summaries[0]?.id ?? null)}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white">◎</span>
                    <span>思考已完成</span>
                    <span>⌄</span>
                  </button>
                  <div className="space-y-2 border-l border-line pl-4">
                    {conversation.stage_summaries.map((item) => (
                      <button
                        key={item.id}
                        className="block w-full rounded-lg px-2 py-1 text-left transition hover:bg-white/70"
                        onClick={() => setDrawerId(item.id)}
                      >
                        <span className="font-semibold">{item.title}</span>
                        <span className="ml-2 text-sm leading-7 text-muted">{item.snippet}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pl-12">
                <div className="text-xl font-semibold">{conversation.final_answer.title}</div>
                <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-[#2b2926]">
                  {conversation.final_answer.body}
                </div>
                <div className="mt-5 text-sm text-muted">
                  置信度 {Math.round(conversation.final_answer.confidence * 100)}%
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-16 rounded-[28px] border border-dashed border-line bg-white/60 p-10 text-center shadow-card">
              <div className="text-2xl font-semibold">准备开始首个可见摘要回合</div>
              <div className="mt-3 text-base leading-7 text-muted">
                发送问题后，界面只会展示阶段摘要和最终答案。
              </div>
            </div>
          )}

          <div className="mt-auto pt-10">
            <div className="rounded-[28px] border border-line bg-white/95 p-5 shadow-card">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
                className="w-full resize-none border-0 bg-transparent text-lg leading-8 outline-none"
                placeholder="向专家小组提出你的问题..."
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-3">
                  {["深度思考", "联网搜索", "上传文件", "专家小组配置"].map((item) => (
                    <button
                      key={item}
                      className="rounded-full border border-line px-4 py-2 text-sm text-muted"
                      onClick={() => {
                        if (item === "专家小组配置") {
                          setSettingsTab("experts");
                          setSettingsOpen(true);
                        }
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <button
                  className="rounded-full bg-accent px-6 py-3 text-sm text-white disabled:opacity-50"
                  disabled={loading || !question.trim()}
                  onClick={() => void sendQuestion()}
                >
                  {loading ? "生成中..." : "发送"}
                </button>
              </div>
            </div>
            <div className="mt-4 text-center text-sm text-muted">内部讨论不会出现在界面或 API 响应中</div>
          </div>
        </div>
      </section>

      <aside className="hidden w-[360px] shrink-0 border-l border-line bg-[#fffdfa]/85 px-5 py-6 backdrop-blur xl:block">
        <div className="text-lg font-semibold">思考树</div>
        <div className="mt-1 text-sm text-muted">仅展示阶段化摘要节点</div>
        {selectedStage ? (
          <div className="mt-8 space-y-6">
            {selectedStage.tree_nodes.map((node, index) => (
              <div key={node.id} className="relative pl-8">
                {index < selectedStage.tree_nodes.length - 1 ? (
                  <div className="absolute left-3 top-7 h-full w-px bg-line" />
                ) : null}
                <div className="absolute left-0 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white text-xs">
                  {index + 1}
                </div>
                <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
                  <div className="font-medium">{node.title}</div>
                  <div className="mt-2 text-sm leading-7 text-muted">{node.summary}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-3xl border border-dashed border-line p-6 text-sm leading-7 text-muted">
            发送问题后，这里会按阶段展示由 Summarizer 生成的可见思考树。
          </div>
        )}
      </aside>

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
    <div className="absolute inset-0 z-20 flex bg-[rgba(245,241,236,0.92)] backdrop-blur">
      <div className="hidden w-[280px] border-r border-line bg-white/90 px-5 py-6 md:block">
        <div className="mb-6 text-xl font-semibold">设置</div>
        {settingsTabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "mb-2 w-full rounded-2xl px-4 py-3 text-left text-sm transition",
              settingsTab === tab.id ? "bg-[#f3ede4] font-medium" : "text-muted hover:bg-[#faf7f2]"
            )}
            onClick={() => setSettingsTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-5 py-6 md:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold">{settingsTitle(settingsTab)}</div>
            <div className="mt-2 text-sm leading-6 text-muted">{settingsSubtitle(settingsTab)}</div>
          </div>
          <button className="rounded-full border border-line bg-white px-4 py-2" onClick={() => setSettingsOpen(false)}>
            关闭
          </button>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto md:hidden">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "shrink-0 rounded-full border border-line px-4 py-2 text-sm",
                settingsTab === tab.id ? "bg-accent text-white" : "bg-white text-muted"
              )}
              onClick={() => setSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {settingsTab === "providers" ? (
          <div className="grid gap-5">
            {providers.map((provider) => {
              const form = providerForms[provider.provider_id] ?? provider;
              const keyConfigured = providerSecretStatus[provider.provider_id];
              return (
                <section key={provider.provider_id} className="rounded-[24px] border border-line bg-white p-6 shadow-card">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{form.label}</div>
                      <div className="text-sm text-muted">
                        {provider.provider_id} · {keyConfigured ? "API Key 已配置" : "API Key 未配置"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-full border border-line px-4 py-2 text-sm" onClick={() => void testProvider(provider.provider_id)}>
                        测试
                      </button>
                      <button className="rounded-full border border-line px-4 py-2 text-sm" onClick={() => void saveProviderSecret(provider.provider_id)}>
                        保存 API Key
                      </button>
                      <button className="rounded-full bg-accent px-4 py-2 text-sm text-white" onClick={() => void saveProvider(provider.provider_id)}>
                        保存配置
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ProviderField provider={form} field="label" label="显示名称" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="default_model" label="默认模型" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="base_url" label="Base URL" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="api_style" label="API 风格" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="provider_type" label="Provider 类型" setProviderForms={setProviderForms} />
                    <ProviderField provider={form} field="env_key_name" label="环境变量名" setProviderForms={setProviderForms} />
                    <label className="grid gap-2 text-sm md:col-span-2">
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
                        className="rounded-2xl border border-line bg-[#fcfbf8] px-4 py-3 outline-none focus:border-[#b49c7d]"
                        placeholder={keyConfigured ? "已保存；输入新值可覆盖" : `保存到本地运行时，或使用 ${form.env_key_name}`}
                      />
                    </label>
                  </div>

                  <div className="mt-4 text-sm text-muted">
                    {providerStatus[provider.provider_id] ?? "密钥只保存到本地 runtime/data，不会在 API 响应中回显。"}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {settingsTab === "experts" ? (
          agents.length ? (
            <div className="grid gap-5 md:grid-cols-2">
              {agents.map((agent) => (
                <section key={agent.name} className="rounded-[24px] border border-line bg-white p-6 shadow-card">
                  <div className="text-lg font-semibold">{agent.nickname}</div>
                  <div className="mt-1 text-sm text-muted">{agent.name}</div>
                  <div className="mt-4 grid gap-2 text-sm text-muted">
                    <div>角色: {agent.role}</div>
                    <div>模型: {agent.model}</div>
                    <div>Provider: {agent.provider_profile}</div>
                    <div>全局 Skills: {agent.allowed_global_skills.join(", ") || "未配置"}</div>
                    <div>禁用 Skills: {agent.disabled_global_skills.join(", ") || "未配置"}</div>
                    <div>私有 Skills: {agent.private_skill_count}</div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="rounded-[24px] border border-line bg-white p-6 text-sm leading-7 text-muted shadow-card">
              没有加载到专家。{agentsError ? `错误：${agentsError}` : "请确认后端 API 正在运行并且 runtime/agents 中存在 agent.yaml。"}
            </section>
          )
        ) : null}

        {settingsTab !== "providers" && settingsTab !== "experts" ? (
          <section className="rounded-[24px] border border-line bg-white p-6 text-sm leading-7 text-muted shadow-card">
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
  if (tab === "providers") return "可在前端配置并保存 API Key。当前 MVP 将密钥保存到本机 runtime/data，仅用于本地开发。";
  if (tab === "experts") return "默认专家从 runtime/agents 自动加载。";
  if (tab === "skills") return "全局 Skills 对专家可见，专家可通过 yaml 白名单或禁用列表控制访问。";
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
    <label className="grid gap-2 text-sm">
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
        className="rounded-2xl border border-line bg-[#fcfbf8] px-4 py-3 outline-none focus:border-[#b49c7d]"
      />
    </label>
  );
}
