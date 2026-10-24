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
    composer: {
      ...copy.composer,
      attachmentChars: (count: number) => formatTemplate(copy.composer.attachmentChars, { count }),
    },
    thinking: {
      ...copy.thinking,
      active: initialThinkingLabel(locale),
      talking: copy.thinking.talking,
      done: copy.thinking.done,
      complete: copy.thinking.complete,
    },
    models: {
      ...copy.models,
      count: (count: number) => formatTemplate(copy.models.count, { count }),
      selectedCount: (count: number) => formatTemplate(copy.models.selectedCount, { count }),
      addedToast: (count: number) => formatTemplate(copy.models.addedToast, { count }),
      fetchedCount: (count: number) => formatTemplate(copy.models.fetchedCount, { count }),
      deleteBody: (model: string) => formatTemplate(copy.models.deleteBody, { model }),
      deleteConfigBody: (config: string, count: number) =>
        formatTemplate(copy.models.deleteConfigBody, { config, count }),
      deleteLastModel: (provider: string) => formatTemplate(copy.models.deleteLastModel, { provider }),
      probeFailed: (reason: string) => formatTemplate(copy.models.probeFailed, { reason }),
      keyFromEnv: (envKey: string) => formatTemplate(copy.models.keyFromEnv, { envKey }),
      keyKeepEnv: (envKey: string) => formatTemplate(copy.models.keyKeepEnv, { envKey }),
      probeMissingModels: (models: string) => formatTemplate(copy.models.probeMissingModels, { models }),
    },
    search: {
      ...copy.search,
      matchCount: (count: number) => formatTemplate(copy.search.matchCount, { count }),
      failed: (error: string) => formatTemplate(copy.search.failed, { error }),
    },
    room: {
      ...copy.room,
      round: (round: number) => formatTemplate(copy.room.round, { round }),
      seats: (seats: number, messages: number) =>
        formatTemplate(copy.room.seats, { seats, messages }),
      speaking: (name: string) => formatTemplate(copy.room.speaking, { name }),
    },
    ui: {
      ...copy.ui,
      confirmDeleteExpert: (name: string) =>
        formatTemplate(copy.ui.confirmDeleteExpert, { name }),
      createAgentFailedHttp: (status: number) =>
        formatTemplate(copy.ui.createAgentFailedHttp, { status }),
      delegatingExperts: (count: number) =>
        formatTemplate(copy.ui.delegatingExperts, { count }),
      delegationAgentLine: (name: string, role: string, model: string) =>
        formatTemplate(copy.ui.delegationAgentLine, { name, role, model }),
      delegationMode: (level: string, thinking: string) =>
        formatTemplate(copy.ui.delegationMode, { level, thinking }),
      delegationParticipants: (count: number) =>
        formatTemplate(copy.ui.delegationParticipants, { count }),
      delegationRounds: (count: number) =>
        formatTemplate(copy.ui.delegationRounds, { count }),
      deleteAgentFailedHttp: (status: number) =>
        formatTemplate(copy.ui.deleteAgentFailedHttp, { status }),
      globalSkillsCount: (count: number) =>
        formatTemplate(copy.ui.globalSkillsCount, { count }),
      profilesAvailable: (count: number) =>
        formatTemplate(copy.ui.profilesAvailable, { count }),
      logLevelSaveFailed: (error: string) =>
        formatTemplate(copy.ui.logLevelSaveFailed, { error }),
      requestTimedOut: (seconds: number) =>
        formatTemplate(copy.ui.requestTimedOut, { seconds }),
      thinkingElapsedActive: (duration: string) =>
        formatTemplate(copy.ui.thinkingElapsedActive, { duration }),
      thinkingElapsedComplete: (duration: string) =>
        formatTemplate(copy.ui.thinkingElapsedComplete, { duration }),
      updateAgentFailedHttp: (status: number) =>
        formatTemplate(copy.ui.updateAgentFailedHttp, { status }),
      memoryActionFailed: (error: string) =>
        formatTemplate(copy.ui.memoryActionFailed, { error }),
      memoryDreamConfig: (state: string, episodes: number, hours: number) =>
        formatTemplate(copy.ui.memoryDreamConfig, { state, episodes, hours }),
      memoryDreamFailed: (error: string) =>
        formatTemplate(copy.ui.memoryDreamFailed, { error }),
      memoryDreamLast: (time: string) =>
        formatTemplate(copy.ui.memoryDreamLast, { time }),
      memoryDreamStats: (
        facts: number,
        updated: number,
        hunches: number,
        promotions: number,
        archived: number,
        rejected: number
      ) =>
        formatTemplate(copy.ui.memoryDreamStats, {
          facts,
          updated,
          hunches,
          promotions,
          archived,
          rejected,
        }),
      memoryLoadFailed: (error: string) =>
        formatTemplate(copy.ui.memoryLoadFailed, { error }),
      memorySaveFailed: (error: string) =>
        formatTemplate(copy.ui.memorySaveFailed, { error }),
    },
  } as const;
};

export type T = ReturnType<typeof t>;

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
