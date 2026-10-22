"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Wand2,
} from "lucide-react";
import { t } from "../../app/locale";
import type { Locale } from "../../app/locale";
import { memoryApi } from "./api";
import type { MemoryDetail, MemoryDreamReport, MemoryFact } from "./api";

type MemoryAgent = {
  name: string;
  nickname: string;
  role: string;
};

type ConfirmState = {
  body: string;
  label: string;
  danger?: boolean;
  run: () => Promise<unknown>;
};

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function formatWhen(value: string | null, locale: Locale): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

function percent(value: number): string {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

export function MemoryPanel({ agents, locale }: { agents: MemoryAgent[]; locale: Locale }) {
  const copy = t(locale).ui;
  const memoryAgents = agents.filter((agent) => agent.role !== "summarizer");
  const [agentName, setAgentName] = useState(memoryAgents[0]?.name ?? "");
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dreamReport, setDreamReport] = useState<MemoryDreamReport | null>(null);

  const [newText, setNewText] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newScope, setNewScope] = useState<"private" | "shared">("private");
  const [newPinned, setNewPinned] = useState(false);

  useEffect(() => {
    if (!memoryAgents.some((agent) => agent.name === agentName)) {
      setAgentName(memoryAgents[0]?.name ?? "");
      setDetail(null);
      setDreamReport(null);
    }
    // memoryAgents is derived from agents; agents is the stable input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, agentName]);

  useEffect(() => {
    if (!agentName) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    memoryApi
      .detail(agentName)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(t(locale).ui.memoryLoadFailed(messageOf(err)));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentName, refreshKey, locale]);

  function reload() {
    setRefreshKey((value) => value + 1);
  }

  function sourceLabel(source: string): string {
    if (source === "manual") return copy.memorySourceManual;
    if (source === "seed") return copy.memorySourceSeed;
    if (source === "dream") return copy.memorySourceDream;
    if (source.startsWith("promoted:")) return copy.memorySourcePromoted;
    if (source.startsWith("consensus:")) return copy.memorySourceConsensus;
    return source;
  }

  async function submitMemory() {
    if (!detail || !agentName || newText.trim().length < 2) return;
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      await memoryApi.remember(agentName, {
        text: newText.trim(),
        tags: parseTags(newTags),
        scope: newScope,
        pinned: newPinned,
      });
      setNewText("");
      setNewTags("");
      setNewPinned(false);
      setNotice(copy.memorySaved);
      reload();
    } catch (err) {
      setError(copy.memorySaveFailed(messageOf(err)));
    } finally {
      setBusy(null);
    }
  }

  async function runFactAction(
    key: string,
    action: () => Promise<unknown>,
    successText?: string
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successText) setNotice(successText);
      reload();
    } catch (err) {
      setError(copy.memoryActionFailed(messageOf(err)));
    } finally {
      setBusy(null);
    }
  }

  async function runDream(apply: boolean) {
    if (!agentName) return;
    setBusy("dream");
    setError(null);
    setNotice(null);
    setDreamReport(null);
    try {
      const report = await memoryApi.dream(agentName, apply);
      setDreamReport(report);
    } catch (err) {
      setError(copy.memoryDreamFailed(messageOf(err)));
    } finally {
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    const action = confirm.run;
    setConfirm(null);
    setBusy("confirm");
    setError(null);
    setNotice(null);
    try {
      await action();
      reload();
    } catch (err) {
      setError(copy.memoryActionFailed(messageOf(err)));
    } finally {
      setBusy(null);
    }
  }

  if (!memoryAgents.length) {
    return <section className="settings-card text-sm leading-7 text-muted">{copy.memoryNoAgents}</section>;
  }

  const status = detail?.status;
  const dreamConfig = status
    ? copy.memoryDreamConfig(
        status.auto_dream ? copy.memoryDreamOn : copy.memoryDreamOff,
        status.dream_min_episodes,
        status.dream_min_hours
      )
    : "";
  const dreamLast = status?.last_dream_at
    ? copy.memoryDreamLast(formatWhen(status.last_dream_at, locale))
    : copy.memoryDreamNever;

  function renderFact(fact: MemoryFact, shared: boolean) {
    const disabled = busy !== null;
    return (
      <article className="memory-fact" key={fact.id}>
        <div className="memory-fact-top">
          <div className="memory-badges">
            {shared ? (
              <span className="memory-badge memory-badge-shared">
                <Share2 size={11} aria-hidden="true" />
                {copy.memorySharedBadge}
              </span>
            ) : null}
            {fact.pinned ? (
              <span className="memory-badge">
                <Pin size={11} aria-hidden="true" />
                {copy.memoryPinnedBadge}
              </span>
            ) : null}
            {fact.source ? <span className="memory-source">{sourceLabel(fact.source)}</span> : null}
          </div>
          <span className="memory-fact-time">{formatWhen(fact.updated_at, locale)}</span>
        </div>
        <p className="memory-fact-text">{fact.text}</p>
        <div className="memory-fact-meta">
          {fact.tags.map((tag) => (
            <span className="memory-tag" key={tag}>
              {tag}
            </span>
          ))}
          <span>
            {copy.memoryConfidence} {percent(fact.confidence)}
          </span>
          <span>
            {copy.memoryImportance} {percent(fact.importance)}
          </span>
        </div>
        <div className="memory-fact-actions">
          <button
            type="button"
            className="small-button small-button-icon"
            disabled={disabled}
            onClick={() =>
              runFactAction(fact.id, () =>
                memoryApi.updateFact(agentName, fact.id, { pinned: !fact.pinned })
              )
            }
          >
            {fact.pinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}
            <span>{fact.pinned ? copy.memoryUnpin : copy.memoryPin}</span>
          </button>
          {!shared && !fact.promoted_to ? (
            <button
              type="button"
              className="small-button small-button-icon"
              disabled={disabled}
              onClick={() =>
                setConfirm({
                  body: copy.memoryPromoteConfirm,
                  label: copy.memoryPromote,
                  run: async () => {
                    await memoryApi.promoteFact(agentName, fact.id);
                    setNotice(copy.memoryPromoted);
                  },
                })
              }
            >
              <Share2 size={12} aria-hidden="true" />
              <span>{copy.memoryPromote}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="small-button small-button-danger small-button-icon"
            disabled={disabled}
            onClick={() =>
              setConfirm({
                body: copy.memoryArchiveConfirm,
                label: copy.memoryArchive,
                danger: true,
                run: async () => {
                  await memoryApi.archiveFact(agentName, fact.id);
                },
              })
            }
          >
            <Trash2 size={12} aria-hidden="true" />
            <span>{copy.memoryArchive}</span>
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="memory-panel">
      <section className="settings-card memory-toolbar">
        <label className="memory-agent-picker">
          <span className="memory-agent-label">{copy.memoryAgent}</span>
          <select
            className="settings-input memory-agent-select"
            value={agentName}
            onChange={(event) => {
              setAgentName(event.target.value);
              setDetail(null);
              setDreamReport(null);
              setNotice(null);
            }}
          >
            {memoryAgents.map((agent) => (
              <option value={agent.name} key={agent.name}>
                {agent.nickname} · {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="small-button small-button-icon"
          onClick={reload}
          disabled={loading || busy !== null}
        >
          <RefreshCw size={14} className={loading ? "memory-spin" : undefined} aria-hidden="true" />
          <span>{copy.memoryRefresh}</span>
        </button>
      </section>

      {error ? <div className="settings-error memory-feedback">{error}</div> : null}
      {notice ? <div className="memory-notice memory-feedback">{notice}</div> : null}

      {!detail && loading ? (
        <section className="settings-card memory-loading">
          <Loader2 size={16} className="memory-spin" aria-hidden="true" />
          <span>{copy.memoryLoading}</span>
        </section>
      ) : null}

      {detail && status ? (
        <>
          <div className="memory-stats">
            <div className="memory-stat">
              <span>{copy.memoryPrivateFacts}</span>
              <strong>{status.fact_count}</strong>
            </div>
            <div className="memory-stat">
              <span>{copy.memorySharedFacts}</span>
              <strong>{status.shared_fact_count}</strong>
            </div>
            <div className="memory-stat">
              <span>{copy.memoryEpisodes}</span>
              <strong>{status.episode_count}</strong>
            </div>
            <div className="memory-stat">
              <span>{copy.memoryHunches}</span>
              <strong>{status.hunch_count}</strong>
            </div>
            <div className="memory-stat">
              <span>{copy.memoryPendingEpisodes}</span>
              <strong>{status.pending_episodes}</strong>
            </div>
            <div className="memory-stat">
              <span>{copy.memoryBudget}</span>
              <strong>
                {status.budget_tokens}
                <small> tokens</small>
              </strong>
            </div>
          </div>

          <section className="settings-card memory-stack">
            <div className="memory-section-head">
              <div>
                <div className="settings-row-title">{copy.memoryAddTitle}</div>
                <div className="settings-row-description">{copy.memoryAddDescription}</div>
              </div>
            </div>
            <textarea
              className="settings-input memory-textarea"
              value={newText}
              maxLength={600}
              placeholder={copy.memoryTextPlaceholder}
              onChange={(event) => setNewText(event.target.value)}
            />
            <div className="memory-form-row">
              <input
                className="settings-input"
                value={newTags}
                maxLength={120}
                placeholder={copy.memoryTagsPlaceholder}
                onChange={(event) => setNewTags(event.target.value)}
              />
              <div className="settings-language-options" role="group" aria-label={copy.memoryAddTitle}>
                <button
                  type="button"
                  className={newScope === "private" ? "settings-choice settings-choice-active" : "settings-choice"}
                  aria-pressed={newScope === "private"}
                  onClick={() => setNewScope("private")}
                >
                  {copy.memoryScopePrivate}
                </button>
                <button
                  type="button"
                  className={newScope === "shared" ? "settings-choice settings-choice-active" : "settings-choice"}
                  aria-pressed={newScope === "shared"}
                  onClick={() => setNewScope("shared")}
                >
                  {copy.memoryScopeShared}
                </button>
              </div>
            </div>
            {newScope === "shared" ? <div className="memory-hint">{copy.memorySharedHint}</div> : null}
            <div className="memory-form-actions">
              <label className="memory-check">
                <input
                  type="checkbox"
                  checked={newPinned}
                  onChange={(event) => setNewPinned(event.target.checked)}
                />
                <span>{copy.memoryPin}</span>
                <small>{copy.memoryPinHint}</small>
              </label>
              <button
                type="button"
                className="small-button-primary small-button-icon"
                onClick={submitMemory}
                disabled={busy !== null || newText.trim().length < 2}
              >
                {busy === "add" ? (
                  <Loader2 size={14} className="memory-spin" aria-hidden="true" />
                ) : (
                  <Plus size={14} aria-hidden="true" />
                )}
                <span>{busy === "add" ? copy.memorySaving : copy.memorySave}</span>
              </button>
            </div>
          </section>

          <section className="memory-block">
            <div className="memory-block-head">
              <h3>{copy.memoryPrivateFacts}</h3>
              <span className="memory-count">{detail.private_facts.length}</span>
            </div>
            {detail.private_facts.length ? (
              <div className="settings-card memory-list">
                {detail.private_facts.map((fact) => renderFact(fact, false))}
              </div>
            ) : (
              <div className="settings-card memory-empty">{copy.memoryEmptyFacts}</div>
            )}
          </section>

          <section className="memory-block">
            <div className="memory-block-head">
              <h3>{copy.memorySharedFacts}</h3>
              <span className="memory-count">{detail.shared_facts.length}</span>
            </div>
            <div className="memory-hint">{copy.memorySharedHint}</div>
            {detail.shared_facts.length ? (
              <div className="settings-card memory-list">
                {detail.shared_facts.map((fact) => renderFact(fact, true))}
              </div>
            ) : (
              <div className="settings-card memory-empty">{copy.memoryEmptyShared}</div>
            )}
          </section>

          <section className="settings-card memory-stack">
            <div className="memory-section-head">
              <div>
                <div className="settings-row-title">{copy.memoryDreamTitle}</div>
                <div className="settings-row-description">{copy.memoryDreamHint}</div>
              </div>
            </div>
            <div className="memory-dream-config">
              <span>{dreamConfig}</span>
              <span>{dreamLast}</span>
            </div>
            <div className="memory-dream-actions">
              <button
                type="button"
                className="small-button small-button-icon"
                onClick={() => runDream(false)}
                disabled={busy !== null}
              >
                {busy === "dream" ? (
                  <Loader2 size={14} className="memory-spin" aria-hidden="true" />
                ) : (
                  <Wand2 size={14} aria-hidden="true" />
                )}
                <span>{busy === "dream" ? copy.memoryDreamRunning : copy.memoryDreamPreview}</span>
              </button>
              <button
                type="button"
                className="small-button-primary small-button-icon"
                onClick={() =>
                  setConfirm({
                    body: copy.memoryDreamApplyConfirm,
                    label: copy.memoryDreamApply,
                    run: () => runDream(true),
                  })
                }
                disabled={busy !== null || status.episode_count === 0}
              >
                <Wand2 size={14} aria-hidden="true" />
                <span>{copy.memoryDreamApply}</span>
              </button>
            </div>
            {dreamReport && dreamReport.agent === agentName ? (
              <div className="memory-dream-result">
                <div className="memory-dream-result-title">
                  {dreamReport.applied
                    ? copy.memoryDreamAppliedResult
                    : copy.memoryDreamPreviewResult}
                </div>
                {dreamReport.journal ? <p className="memory-journal">{dreamReport.journal}</p> : null}
                <div className="memory-fact-meta">
                  {copy.memoryDreamStats(
                    dreamReport.stats.facts_added ?? 0,
                    dreamReport.stats.facts_updated ?? 0,
                    dreamReport.stats.hunches_added ?? 0,
                    dreamReport.stats.shared_promotions ?? 0,
                    dreamReport.stats.facts_archived ?? 0,
                    dreamReport.stats.rejected ?? 0
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="memory-block">
            <div className="memory-block-head">
              <h3>{copy.memoryHunches}</h3>
              <span className="memory-count">{detail.hunches.length}</span>
            </div>
            {detail.hunches.length ? (
              <div className="settings-card memory-list">
                {detail.hunches.map((hunch) => (
                  <article className="memory-mini" key={hunch.id}>
                    <div className="memory-mini-title">{hunch.text}</div>
                    <div className="memory-fact-meta">
                      <span>
                        {copy.memoryConfidence} {percent(hunch.confidence)}
                      </span>
                      {hunch.tags.map((tag) => (
                        <span className="memory-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                      <span>{formatWhen(hunch.updated_at, locale)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="settings-card memory-empty">{copy.memoryEmptyHunches}</div>
            )}
          </section>

          <section className="memory-block">
            <div className="memory-block-head">
              <h3>{copy.memoryEpisodes}</h3>
              <span className="memory-count">{detail.episodes.length}</span>
            </div>
            {detail.episodes.length ? (
              <div className="settings-card memory-list">
                {detail.episodes.map((episode) => (
                  <article className="memory-mini" key={episode.id}>
                    <div className="memory-mini-title">{episode.question}</div>
                    {episode.answer_gist ? (
                      <div className="memory-mini-body">{episode.answer_gist}</div>
                    ) : null}
                    <div className="memory-fact-meta">
                      <span>{formatWhen(episode.created_at, locale)}</span>
                      <span>{episode.participants.join(" · ")}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="settings-card memory-empty">{copy.memoryEmptyEpisodes}</div>
            )}
          </section>

          <section className="memory-block">
            <div className="memory-block-head">
              <h3>{copy.memoryDreams}</h3>
              <span className="memory-count">{detail.dreams.length}</span>
            </div>
            {detail.dreams.length ? (
              <div className="settings-card memory-list">
                {detail.dreams.map((dream) => (
                  <article className="memory-mini" key={dream.id}>
                    <div className="memory-mini-title">{copy.memoryDream}</div>
                    {dream.journal ? <div className="memory-mini-body">{dream.journal}</div> : null}
                    <div className="memory-fact-meta">
                      <span>{formatWhen(dream.created_at, locale)}</span>
                      <span>
                        {copy.memoryDreamStats(
                          dream.stats.facts_added ?? 0,
                          dream.stats.facts_updated ?? 0,
                          dream.stats.hunches_added ?? 0,
                          dream.stats.shared_promotions ?? 0,
                          dream.stats.facts_archived ?? 0,
                          dream.stats.rejected ?? 0
                        )}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="settings-card memory-empty">{copy.memoryEmptyDreams}</div>
            )}
          </section>

          <section className="settings-card memory-stack">
            <div className="memory-section-head">
              <div className="settings-row-title">{copy.memorySelf}</div>
            </div>
            {stripFrontmatter(detail.self_narrative) ? (
              <div className="memory-self">{stripFrontmatter(detail.self_narrative)}</div>
            ) : (
              <div className="memory-empty">{copy.memoryEmptySelf}</div>
            )}
          </section>
        </>
      ) : null}

      {confirm ? (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirm(null)}>
          <div className="sidebar-confirm-box" onClick={(event) => event.stopPropagation()}>
            <div className="text-sm mb-3">{confirm.body}</div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="small-button" onClick={() => setConfirm(null)}>
                {copy.cancel}
              </button>
              <button
                type="button"
                className={confirm.danger ? "small-button-primary memory-danger" : "small-button-primary"}
                onClick={runConfirm}
              >
                {confirm.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
