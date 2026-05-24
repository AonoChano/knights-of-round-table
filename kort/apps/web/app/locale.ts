export type Locale = "zh-CN" | "en";

const THINKING_L1: Record<Locale, string[]> = {
  "zh-CN": ["正在执行", "正在处理", "正在编译", "正在登记", "正在校验"],
  en: ["Executing", "Processing", "Compiling", "Registering", "Validating"],
};

const THINKING_L2: Record<Locale, string[]> = {
  "zh-CN": ["正在审议", "正在协商", "正在汇整", "正在交叉核验", "正在协调"],
  en: ["Deliberating", "Reconciling", "Collating", "Cross-checking", "Negotiating"],
};

const THINKING_L3: Record<Locale, string[]> = {
  "zh-CN": ["正在汇聚", "正在稳定", "正在定稿", "正在落定", "正在封存"],
  en: ["Consolidating", "Stabilizing", "Finalizing", "Settling", "Sealing"],
};

function pickRandomLabel(labels: string[], exclude: string): string {
  const pool = labels.filter((l) => l !== exclude);
  if (pool.length === 0) return labels[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function nextThinkingLabel(locale: Locale, lastLabel: string): { label: string; lastLabel: string } {
  const rotate = Math.floor(Math.random() * 3);
  let pool: string[];
  if (rotate === 0) {
    pool = THINKING_L1[locale];
  } else if (rotate === 1) {
    pool = THINKING_L2[locale];
  } else {
    pool = THINKING_L3[locale];
  }
  const label = pickRandomLabel(pool, lastLabel);
  return { label, lastLabel: label };
}

export function initialThinkingLabel(locale: Locale): string {
  const rotate = Math.floor(Math.random() * 3);
  if (rotate === 0) return THINKING_L1[locale][0];
  if (rotate === 1) return THINKING_L2[locale][0];
  return THINKING_L3[locale][0];
}

export const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const t = (locale: Locale) =>
({
  thinking: {
    active: initialThinkingLabel(locale),
    talking: { "zh-CN": "讨论中", en: "Discussing" }[locale]!,
    done: { "zh-CN": "已完成思考", en: "Thinking complete" }[locale]!,
    complete: { "zh-CN": "已完成思考", en: "Thinking complete" }[locale]!,
  },
  status: {
    providerNotFound: { "zh-CN": "未找到模型提供商配置。", en: "Provider profile was not found." }[locale]!,
    providerDisabled: { "zh-CN": "该模型提供商已禁用。", en: "Provider profile is disabled." }[locale]!,
    providerBaseUrl: {
      "zh-CN": "Base URL 必须是完整的 http(s) 地址。",
      en: "Provider base_url must be an absolute http(s) URL.",
    }[locale]!,
    noApiKey: { "zh-CN": "未提供 API Key", en: "No API key was supplied" }[locale]!,
    profileReady: { "zh-CN": "配置已就绪", en: "Profile is ready" }[locale]!,
    usingTempKey: { "zh-CN": "使用当前输入框中的临时密钥", en: "using temporary input" }[locale]!,
    usingSavedKey: { "zh-CN": "使用已保存的本地密钥", en: "using saved local key" }[locale]!,
    usingEnvVar: { "zh-CN": "使用环境变量", en: "using environment variable" }[locale]!,
  },
  ui: {
    newChatPrompt: { "zh-CN": "今天想解决什么？", en: "What would you like to resolve today?" }[locale]!,
    composerPlaceholder: { "zh-CN": "向圆桌提出你的问题...", en: "Ask the round table..." }[locale]!,
    thinkingProcess: { "zh-CN": "思考过程", en: "Thinking process" }[locale]!,
    collapse: { "zh-CN": "收起", en: "Collapse" }[locale]!,
    settings: { "zh-CN": "设置", en: "Settings" }[locale]!,
    general: { "zh-CN": "通用", en: "General" }[locale]!,
    providers: { "zh-CN": "模型提供商", en: "Model Providers" }[locale]!,
    experts: { "zh-CN": "专家小组", en: "Expert Panel" }[locale]!,
    skills: { "zh-CN": "Skills", en: "Skills" }[locale]!,
    data: { "zh-CN": "数据与日志", en: "Data & Logs" }[locale]!,
    language: { "zh-CN": "界面语言", en: "Language" }[locale]!,
    noExperts: { "zh-CN": "没有加载到专家。点击上方按钮添加。", en: "No experts loaded. Click the button above to add." }[locale]!,
    paused: { "zh-CN": "已暂停", en: "Paused" }[locale]!,
    cancelled: { "zh-CN": "已停止", en: "Stopped" }[locale]!,
    deepThink: { "zh-CN": "深度思考", en: "Deep Think" }[locale]!,
  },
}) as const;

export type T = ReturnType<typeof t>;

export function localeStatusText(locale: Locale, message: string): string {
  const dict = t(locale).status;
  return message
    .replace("Provider profile was not found.", dict.providerNotFound)
    .replace("Provider profile is disabled.", dict.providerDisabled)
    .replace("Provider base_url must be an absolute http(s) URL.", dict.providerBaseUrl)
    .replace("No API key was supplied", dict.noApiKey)
    .replace("Profile is ready", dict.profileReady)
    .replace("using temporary input", dict.usingTempKey)
    .replace("using saved local key", dict.usingSavedKey)
    .replace("using environment variable", dict.usingEnvVar);
}

const LOCALE_KEY = "kort-locale";

export function loadLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  const stored = localStorage.getItem(LOCALE_KEY);
  if (stored === "zh-CN" || stored === "en") return stored;
  const navLang = navigator.language.slice(0, 2);
  return navLang === "zh" ? "zh-CN" : "en";
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_KEY, locale);
}