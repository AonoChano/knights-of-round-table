export type ProviderTypeValue =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "bigmodel"
  | "doubao"
  | "kimi"
  | "minimax"
  | "ollama"
  | "bailian"
  | "qianwen"
  | "xiaomi"
  | "openrouter"
  | "custom";

export type ApiStyle = "openai" | "openai_responses" | "anthropic";

export type BillingType = "pay_as_you_go" | "token_plan" | "coding_plan" | "local" | "custom";

export type ModelCapability = "reasoning" | "vision" | "tools" | "code" | "free";

export type CatalogModel = {
  id: string;
  label: string;
  capabilities: ModelCapability[];
};

export type CatalogPlan = {
  id: string;
  billing: BillingType;
  apiStyle: ApiStyle;
  baseUrl: string;
  models: CatalogModel[];
  hint?: { zh: string; en: string };
};

export type ProviderIconKind =
  | { kind: "brand"; key: string }
  | { kind: "asset"; key: string }
  | { kind: "monogram"; char: string }
  | { kind: "generic" };

export type CatalogProvider = {
  id: string;
  name: { zh: string; en: string };
  group: "recommended" | "more" | "custom";
  providerType: ProviderTypeValue;
  envKeyName: string;
  icon: ProviderIconKind;
  color: string;
  consoleUrl: string;
  docsUrl: string;
  plans: CatalogPlan[];
};
const REASONING_ONLY: ModelCapability[] = ["reasoning"];

export const PROVIDER_CATALOG: CatalogProvider[] = [
  {
    id: "deepseek",
    name: { zh: "DeepSeek", en: "DeepSeek" },
    group: "recommended",
    providerType: "deepseek",
    envKeyName: "DEEPSEEK_API_KEY",
    icon: { kind: "brand", key: "deepseek" },
    color: "#5786FE",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com",
    plans: [
      {
        id: "deepseek-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://api.deepseek.com",
        models: [
          { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", capabilities: REASONING_ONLY },
          { id: "deepseek-flash", label: "DeepSeek Flash", capabilities: ["reasoning", "vision"] },
        ],
      },
    ],
  },
  {
    id: "bailian",
    name: { zh: "阿里云百炼", en: "Alibaba Cloud Model Studio" },
    group: "recommended",
    providerType: "bailian",
    envKeyName: "DASHSCOPE_API_KEY",
    icon: { kind: "brand", key: "alibabacloud" },
    color: "#FF6A00",
    consoleUrl: "https://bailian.console.aliyun.com",
    docsUrl: "https://help.aliyun.com/zh/model-studio/models",
    plans: [
      {
        id: "bailian-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: [
          { id: "qwen3.8-max", label: "Qwen3.8 Max", capabilities: ["reasoning", "vision"] },
          { id: "qwen3.8-flash", label: "Qwen3.8 Flash", capabilities: ["reasoning", "vision"] },
          { id: "qwen3.7-plus", label: "Qwen3.7 Plus", capabilities: ["reasoning", "vision"] },
          { id: "qwen3.7-flash", label: "Qwen3.7 Flash", capabilities: REASONING_ONLY },
          { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", capabilities: ["code", "tools"] },
          { id: "qwen3-vl-plus", label: "Qwen3 VL Plus", capabilities: ["vision"] },
        ],
        hint: {
          zh: "API Key 与 Base URL 必须属于同一地域，跨地域调用会鉴权失败。",
          en: "The API key, base URL and models must belong to the same region.",
        },
      },
      {
        id: "bailian-token",
        billing: "token_plan",
        apiStyle: "openai",
        baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        models: [
          { id: "qwen3.8-max", label: "Qwen3.8 Max", capabilities: ["reasoning", "vision"] },
          { id: "qwen3.7-plus", label: "Qwen3.7 Plus", capabilities: ["reasoning", "vision"] },
        ],
        hint: {
          zh: "Token Plan 使用独立的套餐密钥，与按量付费密钥不通用。",
          en: "Token Plan needs its own plan key; pay-as-you-go keys are not accepted.",
        },
      },
    ],
  },
  {
    id: "qianwen",
    name: { zh: "千问AI平台", en: "Qwen AI Platform" },
    group: "recommended",
    providerType: "qianwen",
    envKeyName: "DASHSCOPE_API_KEY",
    icon: { kind: "brand", key: "qwen" },
    color: "#6950EF",
    consoleUrl: "https://platform.qianwenai.com",
    docsUrl: "https://platform.qianwenai.com/docs/developer-guides/getting-started/first-api-call",
    plans: [
      {
        id: "qianwen-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://maas.qianwenaiapi.com/compatible-mode/v1",
        models: [
          { id: "qwen3.8-max", label: "Qwen3.8 Max", capabilities: ["reasoning", "vision"] },
          { id: "qwen3.8-flash", label: "Qwen3.8 Flash", capabilities: ["reasoning", "vision"] },
          { id: "qwen3.7-plus", label: "Qwen3.7 Plus", capabilities: ["reasoning", "vision"] },
        ],
        hint: {
          zh: "平台是聚合市场：模型市场内的模型可直接调用，其他供应商直供需先在控制台开通。",
          en: "This is a marketplace: models from its own catalog work immediately, resold providers must be enabled first.",
        },
      },
    ],
  },
  {
    id: "bigmodel",
    name: { zh: "智谱 GLM", en: "Zhipu AI GLM" },
    group: "recommended",
    providerType: "bigmodel",
    envKeyName: "BIGMODEL_API_KEY",
    icon: { kind: "asset", key: "zdotai" },
    color: "#1F2A5B",
    consoleUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    docsUrl: "https://docs.bigmodel.cn/cn/guide/start/model-overview",
    plans: [
      {
        id: "glm-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        models: [
          { id: "glm-5.3", label: "GLM-5.3", capabilities: ["reasoning", "tools"] },
          { id: "glm-5.2", label: "GLM-5.2", capabilities: ["reasoning", "tools"] },
          { id: "glm-5", label: "GLM-5", capabilities: ["reasoning"] },
          { id: "glm-4.7", label: "GLM-4.7", capabilities: ["reasoning", "tools"] },
          { id: "glm-4.6", label: "GLM-4.6", capabilities: ["reasoning", "tools"] },
          { id: "glm-5.3-flash", label: "GLM-5.3 Flash", capabilities: ["vision", "reasoning"] },
          { id: "glm-5v-turbo", label: "GLM-5V Turbo", capabilities: ["vision"] },
          { id: "glm-4.7-flash", label: "GLM-4.7 Flash", capabilities: ["free"] },
        ],
        hint: {
          zh: "GLM-5.3 常驻思考，请求里带 thinking.disabled 会直接被拒。",
          en: "GLM-5.3 always reasons; sending thinking disabled is rejected outright.",
        },
      },
      {
        id: "glm-coding",
        billing: "coding_plan",
        apiStyle: "openai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        models: [
          { id: "glm-5.3", label: "GLM-5.3", capabilities: ["reasoning", "code"] },
          { id: "glm-4.7", label: "GLM-4.7", capabilities: ["reasoning", "code"] },
        ],
        hint: {
          zh: "Coding Plan 密钥目前只能通过 OpenAI Chat Completions 协议调用；Claude Code 用的 /api/anthropic 端点不对程序端开放。",
          en: "Coding Plan keys currently work over OpenAI Chat Completions only; the Claude-Code /api/anthropic endpoint is not open to programmatic calls.",
        },
      },
    ],
  },
  {
    id: "doubao",
    name: { zh: "豆包 · 火山方舟", en: "Doubao (Volcengine Ark)" },
    group: "recommended",
    providerType: "doubao",
    envKeyName: "ARK_API_KEY",
    icon: { kind: "asset", key: "doubao" },
    color: "#1E37FC",
    consoleUrl: "https://ark.volcengine.com/region:cn-beijing/apikey",
    docsUrl: "https://docs.volcengine.com/docs/ark/product-overview",
    plans: [
      {
        id: "doubao-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        models: [],
        hint: {
          zh: "模型 ID 以方舟控制台为准；推理接入点也可直接当模型 ID 填。",
          en: "Model IDs come from the Ark console; an inference endpoint ID also works as the model ID.",
        },
      },
    ],
  },
  {
    id: "kimi",
    name: { zh: "Kimi", en: "Kimi" },
    group: "recommended",
    providerType: "kimi",
    envKeyName: "MOONSHOT_API_KEY",
    icon: { kind: "brand", key: "moonshotai" },
    color: "#000000",
    consoleUrl: "https://platform.kimi.com/console/api-keys",
    docsUrl: "https://platform.kimi.com/docs/models",
    plans: [
      {
        id: "kimi-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://api.moonshot.cn/v1",
        models: [
          { id: "kimi-k3", label: "Kimi K3", capabilities: ["reasoning", "vision", "tools"] },
          { id: "kimi-k2.6", label: "Kimi K2.6", capabilities: ["reasoning", "vision"] },
          { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", capabilities: ["code", "tools"] },
          { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed", capabilities: ["code"] },
        ],
        hint: {
          zh: "K3 无法关闭思考；K2.x 用 thinking.type 开关。",
          en: "K3 cannot turn reasoning off; K2.x exposes thinking.type.",
        },
      },
    ],
  },
  {
    id: "minimax",
    name: { zh: "MiniMax", en: "MiniMax" },
    group: "recommended",
    providerType: "minimax",
    envKeyName: "MINIMAX_API_KEY",
    icon: { kind: "brand", key: "minimax" },
    color: "#E73562",
    consoleUrl: "https://platform.minimax.cn/usercenter/proft-mgt-apikey",
    docsUrl: "https://platform.minimax.cn/docs/api-reference/api-overview",
    plans: [
      {
        id: "minimax-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://api.minimax.cn/v1",
        models: [
          { id: "MiniMax-M3", label: "MiniMax M3", capabilities: ["reasoning", "vision"] },
          { id: "MiniMax-M3.1-Flash", label: "MiniMax M3.1 Flash", capabilities: ["reasoning", "vision"] },
          { id: "MiniMax-M2.7", label: "MiniMax M2.7", capabilities: ["reasoning", "tools"] },
          { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed", capabilities: ["reasoning"] },
        ],
        hint: {
          zh: "中国与海外账号的密钥互不通用，Base URL 要选同侧。",
          en: "Mainland and international keys are isolated; keep the base URL on the same side.",
        },
      },
      {
        id: "minimax-token",
        billing: "token_plan",
        apiStyle: "anthropic",
        baseUrl: "https://api.minimax.cn/anthropic",
        models: [
          { id: "MiniMax-M3", label: "MiniMax M3", capabilities: ["reasoning", "vision"] },
          { id: "MiniMax-M3.1-Flash", label: "MiniMax M3.1 Flash", capabilities: ["reasoning", "vision"] },
        ],
        hint: {
          zh: "Token Plan 走 Anthropic Messages 协议，思考开关在 thinking 块里。",
          en: "Token Plan speaks the Anthropic Messages protocol, where thinking is a request block.",
        },
      },
    ],
  },
  {
    id: "xiaomi",
    name: { zh: "小米 MiMo", en: "Xiaomi MiMo" },
    group: "recommended",
    providerType: "xiaomi",
    envKeyName: "XIAOMI_MIMO_API_KEY",
    icon: { kind: "brand", key: "xiaomi" },
    color: "#FF6900",
    consoleUrl: "https://platform.xiaomimimo.com",
    docsUrl: "https://mimo.mi.com/docs/zh-CN/api/chat/openai-api",
    plans: [
      {
        id: "mimo-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://api.xiaomimimo.com/v1",
        models: [
          { id: "mimo-v2.6-pro", label: "MiMo V2.6 Pro", capabilities: ["reasoning", "vision", "tools"] },
          { id: "mimo-v2.6-flash", label: "MiMo V2.6 Flash", capabilities: ["reasoning", "vision"] },
          { id: "mimo-v2.6-pro-ultraspeed", label: "MiMo V2.6 Pro Ultraspeed", capabilities: ["reasoning"] },
        ],
        hint: {
          zh: "V2.5 系列已于 2026-10-21 下线，旧模型名会直接报错。",
          en: "The V2.5 series was retired on 2026-10-21; old model names now fail.",
        },
      },
      {
        id: "mimo-token",
        billing: "token_plan",
        apiStyle: "openai",
        baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
        models: [
          { id: "mimo-v2.6-pro", label: "MiMo V2.6 Pro", capabilities: ["reasoning", "vision", "tools"] },
          { id: "mimo-v2.6-flash", label: "MiMo V2.6 Flash", capabilities: ["reasoning", "vision"] },
        ],
        hint: {
          zh: "Token Plan 密钥以 tp- / ttp- 开头，与按量付费的 sk- 密钥不通用。",
          en: "Token Plan keys start with tp- / ttp-, not the pay-as-you-go sk- prefix.",
        },
      },
    ],
  },
  {
    id: "anthropic",
    name: { zh: "Anthropic", en: "Anthropic" },
    group: "more",
    providerType: "anthropic",
    envKeyName: "ANTHROPIC_API_KEY",
    icon: { kind: "brand", key: "anthropic" },
    color: "#191919",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://platform.claude.com/docs",
    plans: [
      {
        id: "anthropic-payg",
        billing: "pay_as_you_go",
        apiStyle: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        models: [
          { id: "claude-opus-5-5", label: "Claude Opus 5.5", capabilities: ["reasoning", "vision", "tools"] },
          { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", capabilities: ["reasoning", "vision", "tools"] },
          { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", capabilities: ["vision"] },
        ],
      },
    ],
  },
  {
    id: "openai",
    name: { zh: "OpenAI", en: "OpenAI" },
    group: "more",
    providerType: "openai",
    envKeyName: "OPENAI_API_KEY",
    icon: { kind: "asset", key: "openai" },
    color: "#0F1115",
    consoleUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://developers.openai.com/api/docs/api-reference",
    plans: [
      {
        id: "openai-responses",
        billing: "pay_as_you_go",
        apiStyle: "openai_responses",
        baseUrl: "https://api.openai.com/v1",
        models: [],
        hint: {
          zh: "新特性优先落在 Responses API；点“获取模型列表”按你的密钥拉取可用模型。",
          en: "New capabilities land on the Responses API first; fetch the model list for what your key can call.",
        },
      },
      {
        id: "openai-chat",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: [],
        hint: {
          zh: "Chat Completions 协议仍可用，但部分新模型的工具调用只在新接口开放。",
          en: "Chat Completions still works, though tool calling for some newer models is Responses-only.",
        },
      },
    ],
  },
  {
    id: "openrouter",
    name: { zh: "OpenRouter", en: "OpenRouter" },
    group: "more",
    providerType: "openrouter",
    envKeyName: "OPENROUTER_API_KEY",
    icon: { kind: "brand", key: "openrouter" },
    color: "#76A9C4",
    consoleUrl: "https://openrouter.ai/settings/keys",
    docsUrl: "https://openrouter.ai/docs",
    plans: [
      {
        id: "openrouter-payg",
        billing: "pay_as_you_go",
        apiStyle: "openai",
        baseUrl: "https://openrouter.ai/api/v1",
        models: [],
      },
    ],
  },
  {
    id: "microsoft-copilot",
    name: { zh: "Microsoft Copilot", en: "Microsoft Copilot" },
    group: "more",
    providerType: "openai",
    envKeyName: "COPILOT_API_KEY",
    icon: { kind: "asset", key: "microsoft-copilot" },
    color: "#2253CE",
    consoleUrl: "",
    docsUrl: "https://learn.microsoft.com/copilot/",
    plans: [
      {
        id: "copilot-bridge",
        billing: "custom",
        apiStyle: "openai",
        baseUrl: "",
        models: [],
        hint: {
          zh: "微软没有开放 Copilot 的 OpenAI 兼容接口；这里用于接你自建的兼容网关，Base URL 与 Key 以网关为准。",
          en: "Microsoft exposes no OpenAI-compatible Copilot API; use this preset with your own compatible gateway.",
        },
      },
    ],
  },
  {
    id: "ollama",
    name: { zh: "Ollama 本地", en: "Ollama (local)" },
    group: "more",
    providerType: "ollama",
    envKeyName: "OLLAMA_API_KEY",
    icon: { kind: "brand", key: "ollama" },
    color: "#1C1C1C",
    consoleUrl: "https://ollama.com/library",
    docsUrl: "https://docs.ollama.com/api",
    plans: [
      {
        id: "ollama-local",
        billing: "local",
        apiStyle: "openai",
        baseUrl: "http://localhost:11434/v1",
        models: [],
        hint: {
          zh: "本地服务不需要密钥；模型列表来自已 pull 的标签。",
          en: "Local servers need no key; the model list comes from pulled tags.",
        },
      },
    ],
  },
  {
    id: "custom",
    name: { zh: "自定义 OpenAI Compatible", en: "Custom OpenAI Compatible" },
    group: "custom",
    providerType: "custom",
    envKeyName: "CUSTOM_API_KEY",
    icon: { kind: "generic" },
    color: "#6B6B63",
    consoleUrl: "",
    docsUrl: "",
    plans: [
      {
        id: "custom-openai",
        billing: "custom",
        apiStyle: "openai",
        baseUrl: "",
        models: [],
      },
    ],
  },
];

/** Protocol names are product names, not translatable copy — one label serves both locales. */
export const API_STYLE_OPTIONS: Array<{ value: ApiStyle; label: string }> = [
  { value: "openai", label: "Chat Completions" },
  { value: "openai_responses", label: "Responses API" },
  { value: "anthropic", label: "Anthropic Messages" },
];

export const BILLING_LABELS: Record<BillingType, { zh: string; en: string }> = {
  pay_as_you_go: { zh: "按量付费", en: "Pay As You Go" },
  token_plan: { zh: "Token 套餐", en: "Token Plan" },
  coding_plan: { zh: "Coding 套餐", en: "Coding Plan" },
  local: { zh: "本地服务", en: "Local Service" },
  custom: { zh: "自定义", en: "Custom" },
};

export const CAPABILITY_LABELS: Record<ModelCapability, { zh: string; en: string }> = {
  reasoning: { zh: "深度思考", en: "Reasoning" },
  vision: { zh: "视觉", en: "Vision" },
  tools: { zh: "工具调用", en: "Tools" },
  code: { zh: "代码", en: "Code" },
  free: { zh: "免费额度", en: "Free tier" },
};

export function findCatalogProvider(catalogId: string): CatalogProvider | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.id === catalogId);
}

export function providerDisplayName(provider: CatalogProvider, locale: "zh-CN" | "en"): string {
  return provider.name[locale === "zh-CN" ? "zh" : "en"];
}

export function defaultPlan(provider: CatalogProvider): CatalogPlan {
  return provider.plans[0];
}

export const GROUP_LABELS: Record<CatalogProvider["group"], { zh: string; en: string }> = {
  recommended: { zh: "推荐", en: "Recommended" },
  more: { zh: "更多", en: "More" },
  custom: { zh: "自定义", en: "Custom" },
};

export function groupLabel(group: CatalogProvider["group"], locale: "zh-CN" | "en"): string {
  return GROUP_LABELS[group][locale === "zh-CN" ? "zh" : "en"];
}

export function capabilityLabel(capability: ModelCapability, locale: "zh-CN" | "en"): string {
  return CAPABILITY_LABELS[capability][locale === "zh-CN" ? "zh" : "en"];
}

export function billingLabel(billing: BillingType, locale: "zh-CN" | "en"): string {
  return BILLING_LABELS[billing][locale === "zh-CN" ? "zh" : "en"];
}

export function apiStyleLabel(style: ApiStyle): string {
  return API_STYLE_OPTIONS.find((option) => option.value === style)?.label ?? style;
}
