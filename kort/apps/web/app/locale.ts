import enCopy from "./locales/en.json";
import zhCopy from "./locales/zh-CN.json";

export type Locale = "zh-CN" | "en";

export type DiscussionLevel = "off" | "auto" | "low" | "medium" | "high";

export type DiscussionLevelOption = {
  id: DiscussionLevel;
  label: string;
  tag: string;
  code: string;
};

type LocaleCopy = typeof zhCopy;

const COPY: Record<Locale, LocaleCopy> = {
  "zh-CN": zhCopy,
  en: enCopy,
};

function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function pickRandomLabel(labels: string[], exclude: string): string {
  const pool = labels.filter((label) => label !== exclude);
  if (pool.length === 0) return labels[0] ?? "";
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? "";
}

export function nextThinkingLabel(locale: Locale, lastLabel: string): { label: string; lastLabel: string } {
  const pools = COPY[locale].thinking.pools;
  const pool = pools[Math.floor(Math.random() * pools.length)] ?? pools[0] ?? [];
  const label = pickRandomLabel(pool, lastLabel);
  return { label, lastLabel: label };
}

export function initialThinkingLabel(locale: Locale): string {
  return COPY[locale].thinking.pools[0]?.[0] ?? "";
}

export function discussionLevels(locale: Locale): DiscussionLevelOption[] {
  return COPY[locale].discussionLevels as DiscussionLevelOption[];
}

export const t = (locale: Locale) => {
  const copy = COPY[locale];
  return {
    thinking: {
      active: initialThinkingLabel(locale),
      talking: copy.thinking.talking,
      done: copy.thinking.done,
      complete: copy.thinking.complete,
    },
    status: copy.status,
    ui: {
      ...copy.ui,
      apiKeyPlaceholderNew: (envKey: string) =>
        formatTemplate(copy.ui.apiKeyPlaceholderNew, { envKey }),
      configureSaveFailed: (error: string) =>
        formatTemplate(copy.ui.configureSaveFailed, { error }),
      confirmDeleteExpert: (name: string) =>
        formatTemplate(copy.ui.confirmDeleteExpert, { name }),
      createAgentFailedHttp: (status: number) =>
        formatTemplate(copy.ui.createAgentFailedHttp, { status }),
      deleteAgentFailedHttp: (status: number) =>
        formatTemplate(copy.ui.deleteAgentFailedHttp, { status }),
      globalSkillsCount: (count: number) =>
        formatTemplate(copy.ui.globalSkillsCount, { count }),
      profilesAvailable: (count: number) =>
        formatTemplate(copy.ui.profilesAvailable, { count }),
      testFailed: (error: string) =>
        formatTemplate(copy.ui.testFailed, { error }),
      thinkingElapsedActive: (duration: string) =>
        formatTemplate(copy.ui.thinkingElapsedActive, { duration }),
      thinkingElapsedComplete: (duration: string) =>
        formatTemplate(copy.ui.thinkingElapsedComplete, { duration }),
      updateAgentFailedHttp: (status: number) =>
        formatTemplate(copy.ui.updateAgentFailedHttp, { status }),
    },
  } as const;
};

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
