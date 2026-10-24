"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Search,
} from "lucide-react";
import { t } from "../../app/locale";
import type { Locale } from "../../app/locale";

export type TraceSource = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
};

export type TraceTool = {
  id: string;
  tool: "search" | "fetch";
  status: "running" | "complete" | "error";
  call_id?: string;
  order?: number;
  query?: string;
  url?: string;
  title?: string;
  error?: string | null;
  duration_ms?: number;
  sources?: TraceSource[];
  excerpt?: string;
  source_count?: number;
};

export type TraceCall = {
  callId: string;
  name: string;
  state: "running" | "complete" | "failed" | "skipped";
  query?: string;
  url?: string;
  result?: string;
  error?: string;
  reason?: string;
  trace?: TraceTool;
};

export type TraceStage = {
  id: string;
  title: string;
  body: string;
  status: "streaming" | "complete" | "active" | "done" | "talking" | "cancelled";
  order?: number;
  call?: TraceCall;
};

const DOT_TONES = ["trace-dot-a", "trace-dot-b", "trace-dot-c"];

function toneFor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return DOT_TONES[Math.abs(hash) % DOT_TONES.length];
}

function domainOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return minutes <= 0 ? `${seconds}s` : `${minutes} min ${seconds % 60}s`;
}

function formatToolDuration(ms?: number) {
  if (!ms || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function uniqueSources(stages: TraceStage[]) {
  const seen = new Set<string>();
  for (const stage of stages) {
    for (const source of stage.call?.trace?.sources ?? []) {
      if (source.url) seen.add(source.url);
    }
  }
  return seen.size;
}

function isFetch(name: string) {
  return name === "web_fetch";
}

function ChessThinkingIcon({ active }: { active: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pawnMask = `chess-thinking-pawn-${uid}`;
  const knightMask = `chess-thinking-knight-${uid}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="chess-thinking-icon"
      data-icon="chess-thinking"
      data-animated={active ? "true" : "false"}
      aria-hidden="true"
    >
      <defs>
        <mask id={pawnMask}>
          <rect width="24" height="24" fill="white" stroke="none" />
          <g
            className="chess-thinking-part chess-thinking-pawn-mask"
            fill="black"
            stroke="black"
            strokeWidth="2.7"
          >
            <circle cx="17.5" cy="7" r="2.3" />
            <path d="M16.5 9.2h2c-.3 2.4.3 4.2 1.5 6.3l1 3h-7l1-3c1.2-2.1 1.8-3.9 1.5-6.3Z" />
          </g>
        </mask>
        <mask id={knightMask}>
          <rect width="24" height="24" fill="white" stroke="none" />
          <g
            className="chess-thinking-part chess-thinking-knight-mask"
            fill="black"
            stroke="black"
            strokeWidth="2.7"
          >
            <path d="M5 17v-2.5L8 11l-3 .8-1-2L7.5 6V3l4 2.8L14 11l-1 6H5Z" />
            <path d="M4 17h10l1 3H3l1-3Z" />
          </g>
        </mask>
      </defs>
      <g mask={`url(#${pawnMask})`}>
        <g className="chess-thinking-part chess-thinking-back">
          <path d="M5 17v-2.5L8 11l-3 .8-1-2L7.5 6V3l4 2.8L14 11l-1 6H5Z" />
          <path d="M4 17h10l1 3H3l1-3Z" />
          <path d="M9.5 7.7h.01" strokeWidth="2.4" />
        </g>
      </g>
      <g mask={`url(#${knightMask})`}>
        <g className="chess-thinking-part chess-thinking-pawn">
          <circle cx="17.5" cy="7" r="2.3" />
          <path d="M16.5 9.2c.3 2.4-.3 4.2-1.5 6.3h5c-1.2-2.1-1.8-3.9-1.5-6.3M15 15.5h5l1 3h-7l1-3Z" />
        </g>
      </g>
      <g className="chess-thinking-part chess-thinking-front">
        <path d="M5 17v-2.5L8 11l-3 .8-1-2L7.5 6V3l4 2.8L14 11l-1 6H5Z" />
        <path d="M4 17h10l1 3H3l1-3Z" />
        <path d="M9.5 7.7h.01" strokeWidth="2.4" />
      </g>
    </svg>
  );
}

export function ThinkingTrace({
  timeline,
  active,
  elapsed,
  locale,
  onOpenDetails,
}: {
  timeline: TraceStage[];
  active: boolean;
  elapsed: number;
  locale: Locale;
  onOpenDetails?: () => void;
}) {
  const copy = t(locale);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [openItems, setOpenCalls] = useState<Record<string, boolean>>({});
  const [showAllStages, setShowAllStages] = useState(false);

  useEffect(() => {
    if (active) {
      setManualExpanded(null);
      setShowAllStages(false);
    }
  }, [active]);

  const stages = useMemo(
    () => timeline.filter((item) => item.status !== "done" && item.status !== "talking"),
    [timeline]
  );
  const runningCall = stages.find((item) => item.call?.state === "running")?.call;
  const hasBody = stages.length > 0;
  const expanded = manualExpanded ?? active;
  const sourceCount = uniqueSources(stages);
  const visibleStages = showAllStages ? stages : stages.slice(-6);
  const hiddenStages = stages.length - visibleStages.length;
  const lastStageTitle = stages[stages.length - 1]?.title;

  if (!hasBody && !active) return null;

  let header = lastStageTitle || copy.thinking.active;
  if (runningCall) {
    header = isFetch(runningCall.name) ? copy.thinking.reading : copy.thinking.searching;
  }

  const doneHeader =
    elapsed > 0 ? copy.ui.thinkingElapsedComplete(formatDuration(elapsed)) : copy.thinking.complete;

  return (
    <div className="thinking-trace" data-active={active ? "true" : "false"}>
      <button
        type="button"
        className="thinking-trace-header"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? active))}
      >
        <span className="thinking-trace-glyph" aria-hidden="true">
          {runningCall ? <Search size={15} /> : <ChessThinkingIcon active={active} />}
        </span>
        {active ? (
          <span className="thinking-trace-title thinking-trace-shimmer" role="status">
            {header}
          </span>
        ) : (
          <span className="thinking-trace-title thinking-trace-settled">
            {doneHeader}
            {sourceCount > 0 ? (
              <span className="thinking-trace-header-meta">
                {" · "}
                {copy.thinking.sourceCount.replace("{count}", String(sourceCount))}
              </span>
            ) : null}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="thinking-trace-chevron"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <div
        className="thinking-trace-expander"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="thinking-trace-clip">
          <div className="thinking-trace-rail">
            {hiddenStages > 0 ? (
              <button type="button" className="trace-more" onClick={() => setShowAllStages(true)}>
                {copy.thinking.earlierStages.replace("{count}", String(hiddenStages))}
              </button>
            ) : null}

            {visibleStages.map((stage, index) => {
              const delay = `${Math.min(index, 6) * 55}ms`;
              if (stage.call) {
                const call = stage.call;
                const trace = call.trace;
                const fetching = isFetch(call.name);
                const sources = trace?.sources ?? [];
                const detail = fetching ? trace?.excerpt : undefined;
                const open = Boolean(openItems[stage.id]);
                const domain = trace?.url ? domainOf(trace.url) : call.url ? domainOf(call.url) : "";
                const canExpand = sources.length > 0 || Boolean(detail) || Boolean(call.error);
                const label =
                  call.state === "running"
                    ? fetching
                      ? copy.thinking.reading
                      : copy.thinking.searching
                    : fetching
                      ? trace?.title || domain || call.url || copy.thinking.reading
                      : call.query || copy.thinking.searching;

                return (
                  <div className="trace-group" key={stage.id}>
                    <div
                      className={`trace-row ${fetching ? "trace-row-fetch" : "trace-row-query"} trace-row-call trace-row-${call.state}`}
                      style={{ animationDelay: delay }}
                    >
                      <span className="trace-icon" aria-hidden="true">
                        {fetching ? <FileText size={13} /> : <Search size={13} />}
                      </span>
                      <button
                        type="button"
                        className="trace-text trace-fetch-toggle"
                        aria-expanded={open}
                        disabled={!canExpand}
                        onClick={() =>
                          canExpand
                            ? setOpenCalls((current) => ({ ...current, [stage.id]: !open }))
                            : undefined
                        }
                      >
                        {label}
                      </button>
                      <span className="trace-meta">
                        {call.state === "running" ? (
                          <span className="trace-spinner" aria-hidden="true" />
                        ) : call.state === "skipped" ? (
                          <span className="trace-meta-muted">{copy.thinking.callSkipped}</span>
                        ) : call.state === "failed" ? (
                          <span className="trace-meta-error" title={call.error ?? undefined}>
                            {copy.thinking.traceFailed}
                          </span>
                        ) : fetching ? (
                          <>
                            {domain}
                            {trace?.duration_ms ? ` · ${formatToolDuration(trace.duration_ms)}` : ""}
                          </>
                        ) : (
                          copy.thinking.sourceCount.replace("{count}", String(sources.length))
                        )}
                      </span>
                      {fetching && trace?.url && call.state === "complete" ? (
                        <a
                          className="trace-open"
                          href={trace.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={copy.ui.openInNewTab}
                          title={copy.ui.openInNewTab}
                        >
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>

                    {open && sources.length > 0 ? (
                      sources.map((source, sourceIndex) => {
                        const host = source.domain || domainOf(source.url);
                        return (
                          <a
                            key={`${stage.id}-${source.url}`}
                            className="trace-row trace-row-source"
                            href={source.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={source.snippet || source.title}
                            style={{ animationDelay: `${Math.min(sourceIndex, 4) * 50}ms` }}
                          >
                            <span className={`trace-dot ${toneFor(host)}`} aria-hidden="true">
                              <span>{host.slice(0, 1).toUpperCase()}</span>
                            </span>
                            <span className="trace-text trace-text-source">{source.title}</span>
                            <span className="trace-meta trace-domain">{host}</span>
                          </a>
                        );
                      })
                    ) : null}

                    {open && detail ? <div className="trace-excerpt">{detail}</div> : null}
                    {open && call.error ? <div className="trace-call-error">{call.error}</div> : null}
                    {open && call.reason ? (
                      <div className="trace-call-muted">{copy.thinking.callSkippedDetail}</div>
                    ) : null}
                    {call.state === "complete" && call.result && !open ? (
                      <div className="trace-call-summary">{call.result}</div>
                    ) : null}
                  </div>
                );
              }

              const open = Boolean(openItems[stage.id]);
              const streaming = stage.status === "streaming" || stage.status === "active";
              return (
                <div className="trace-group" key={stage.id}>
                  <div className="trace-row trace-row-stage" style={{ animationDelay: delay }}>
                    <span className="trace-stage-icon" aria-hidden="true">
                      {streaming ? <span className="trace-spinner" /> : <Check size={13} />}
                    </span>
                    {stage.body ? (
                      <button
                        type="button"
                        className="trace-text trace-stage-toggle"
                        aria-expanded={open}
                        onClick={() => setOpenCalls((current) => ({ ...current, [stage.id]: !open }))}
                      >
                        {stage.title}
                      </button>
                    ) : (
                      <span className="trace-text">{stage.title}</span>
                    )}
                    {stage.body ? (
                      <ChevronRight
                        size={12}
                        className="trace-stage-chevron"
                        aria-hidden="true"
                        style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
                      />
                    ) : null}
                  </div>
                  {open && stage.body ? <div className="trace-stage-detail">{stage.body}</div> : null}
                </div>
              );
            })}

            {!active && onOpenDetails ? (
              <button type="button" className="trace-details" onClick={onOpenDetails}>
                {copy.ui.thinkingProcess}
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            ) : null}

            {stages.some((stage) => stage.call?.state === "failed") ? (
              <div className="trace-row trace-row-error">
                <AlertCircle size={13} aria-hidden="true" />
                <span className="trace-text">{copy.thinking.tracePartial}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
