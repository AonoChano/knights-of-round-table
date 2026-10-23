"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Search, X } from "lucide-react";

import type { Locale } from "../../app/locale";
import { t } from "../../app/locale";
import { searchApi } from "./api";
import type { ConversationSearchHit, SearchScope } from "./api";

const DEBOUNCE_MS = 200;
const PAGE_LIMIT = 20;
const RECENT_LIMIT = 8;

export type SearchPick = { conversation_id: string; node_id: string | null };
export type RecentConversation = { conversation_id: string; title: string; updated_at: string };

type Status = "idle" | "loading" | "ready" | "error";

const SCOPES: SearchScope[] = ["all", "title", "message"];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/** Highlight with numbers only: React renders every slice as a text node, so a message that
 *  contains markup cannot inject it into the list. */
function highlight(text: string, matches: number[][]): ReactNode {
  if (matches.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  matches.forEach(([start, length], index) => {
    const end = start + length;
    if (start < cursor || end > text.length) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark className="search-mark" key={`mark-${index}`}>
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function formatWhen(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ConversationSearchDialog({
  locale,
  recent,
  onPick,
  onClose,
}: {
  locale: Locale;
  recent: RecentConversation[];
  onPick: (pick: SearchPick) => void;
  onClose: () => void;
}) {
  const tr = t(locale).search;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [hits, setHits] = useState<ConversationSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailure, setMoreFailure] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 每次检索递增，迟到的响应只能被丢弃，不能覆盖新的结果
  const requestRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      requestRef.current += 1;
      setHits([]);
      setTotal(0);
      setNextCursor(null);
      setStatus("idle");
      setFailure("");
      setMoreFailure(false);
      setLoadingMore(false);
      return;
    }
    const seq = requestRef.current + 1;
    requestRef.current = seq;
    setStatus("loading");
    setMoreFailure(false);
    setLoadingMore(false);
    const timer = window.setTimeout(() => {
      void searchApi
        .query({ query: term, scope, limit: PAGE_LIMIT })
        .then((page) => {
          if (requestRef.current !== seq) return;
          setHits(page.results);
          setTotal(page.total);
          setNextCursor(page.next_cursor);
          setStatus("ready");
          setFailure("");
        })
        .catch((error: unknown) => {
          if (requestRef.current !== seq) return;
          setHits([]);
          setTotal(0);
          setNextCursor(null);
          setStatus("error");
          setFailure(error instanceof Error ? error.message : String(error));
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, scope]);

  const rows: Array<{ key: string; pick: SearchPick; hit: ConversationSearchHit | null; title: string; when: string }> =
    useMemo(() => {
      if (query.trim()) {
        return hits.map((hit) => ({
          key: `${hit.conversation_id}-${hit.node_id ?? "title"}-${hit.match_type}`,
          pick: { conversation_id: hit.conversation_id, node_id: hit.node_id },
          hit,
          title: hit.conversation_title,
          when: hit.matched_at,
        }));
      }
      return recent.slice(0, RECENT_LIMIT).map((item) => ({
        key: `recent-${item.conversation_id}`,
        pick: { conversation_id: item.conversation_id, node_id: null },
        hit: null,
        title: item.title,
        when: item.updated_at,
      }));
    }, [hits, query, recent]);

  useEffect(() => {
    setActiveIndex((current) => (rows.length === 0 ? 0 : Math.min(current, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows.length]);

  function commit(index: number) {
    const row = rows[index];
    if (row) onPick(row.pick);
  }

  function loadMore() {
    const term = query.trim();
    if (!term || !nextCursor || loadingMore) return;
    const seq = requestRef.current;
    setLoadingMore(true);
    void searchApi
      .query({ query: term, scope, limit: PAGE_LIMIT, cursor: nextCursor })
      .then((page) => {
        if (requestRef.current !== seq) return;
        setHits((current) => [...current, ...page.results]);
        setNextCursor(page.next_cursor);
      })
      .catch(() => {
        if (requestRef.current !== seq) return;
        setMoreFailure(true);
      })
      .finally(() => {
        if (requestRef.current === seq) setLoadingMore(false);
      });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActiveIndex((current) => (current + 1) % rows.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActiveIndex((current) => (current - 1 + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit(activeIndex);
    }
  }

  const searching = Boolean(query.trim());
  const loading = status === "loading" && rows.length === 0;

  return (
    <div className="search-dialog-backdrop" onClick={onClose}>
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr.title}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="search-dialog-head">
          <Search aria-hidden="true" size={16} className="search-dialog-icon" />
          <input
            ref={inputRef}
            className="search-dialog-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr.placeholder}
            aria-label={tr.placeholder}
            maxLength={200}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="search-scopes" role="group" aria-label={tr.scopeLabel}>
            {SCOPES.map((option) => (
              <button
                className={cn("search-scope", scope === option && "search-scope-active")}
                key={option}
                type="button"
                onClick={() => setScope(option)}
              >
                {option === "all" ? tr.scopeAll : option === "title" ? tr.scopeTitle : tr.scopeMessage}
              </button>
            ))}
          </div>
          <button className="search-close" type="button" title={tr.close} aria-label={tr.close} onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="search-dialog-status" role="status" aria-live="polite">
          {searching && status === "ready" ? <span>{tr.matchCount(total)}</span> : null}
          {searching && status === "loading" ? <span>{tr.loading}</span> : null}
          {!searching ? <span>{tr.recentHint}</span> : null}
        </div>

        <div className="search-dialog-list" ref={listRef}>
          {loading ? (
            <div className="search-row-hint">
              <span className="search-spinner" aria-hidden="true" />
              {tr.loading}
            </div>
          ) : rows.length === 0 ? (
            <div className="search-row-hint">
              {status === "error" ? tr.failed(failure) : searching ? tr.empty : tr.recentEmpty}
              {status !== "error" && searching ? <div className="search-row-hint-detail">{tr.emptyHint}</div> : null}
            </div>
          ) : (
            <div role="listbox" aria-label={tr.results}>
              {!searching ? <div className="search-group-label">{tr.recentTitle}</div> : null}
              {rows.map((row, index) => (
                <button
                  className={cn("search-row", index === activeIndex && "search-row-active")}
                  data-row-index={index}
                  key={row.key}
                  role="option"
                  aria-selected={index === activeIndex}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span className="search-row-main">
                    <span className="search-row-title">{highlight(row.title, row.hit?.match_type === "title" ? row.hit.matches : [])}</span>
                    {row.hit && row.hit.match_type === "message" ? (
                      <span className="search-row-snippet">{highlight(row.hit.snippet, row.hit.matches)}</span>
                    ) : null}
                  </span>
                  <span className="search-row-meta">
                    {row.hit ? (
                      <span className={cn("search-badge", row.hit.match_type === "title" ? "search-badge-title" : "search-badge-body")}>
                        {row.hit.match_type === "title" ? tr.matchTitle : row.hit.role === "user" ? tr.roleUser : tr.roleAssistant}
                      </span>
                    ) : (
                      <span className="search-badge search-badge-title">{tr.matchTitle}</span>
                    )}
                    <span className="search-row-time">{formatWhen(row.when, locale)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="search-dialog-foot">
          <span className="search-foot-hint">{tr.openHint}</span>
          {moreFailure ? <span className="search-more-failed" role="status">{tr.loadMoreFailed}</span> : null}
          {nextCursor && !moreFailure ? (
            <button className="search-more" type="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <span className="search-spinner" aria-hidden="true" /> : null}
              {loadingMore ? tr.loadingMore : tr.loadMore}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
