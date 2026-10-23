"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Search,
  Sparkles,
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
  query?: string;
  url?: string;
  title?: string;
  error?: string | null;
  duration_ms?: number;
  sources?: TraceSource[];
  excerpt?: string;
  source_count?: number;
};

export type TraceStage = {
  id: string;
  title: string;
  body: string;
  status: "streaming" | "complete" | "active" | "done" | "talking" | "cancelled";
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

function uniqueSources(traces: TraceTool[]) {
  const seen = new Set<string>();
  for (const trace of traces) {
    for (const source of trace.sources ?? []) {
      if (source.url) seen.add(source.url);
    }
  }
  return seen.size;
}

export function ThinkingTrace({
  traces,
  timeline,
  active,
  researchActive,
  elapsed,
  locale,
  onOpenDetails,
}: {
  traces: TraceTool[];
  timeline: TraceStage[];
  active: boolean;
  researchActive: boolean;
  elapsed: number;
  locale: Locale;
  onOpenDetails?: () => void;
}) {
  const copy = t(locale);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [showAllSources, setShowAllSources] = useState<Record<string, boolean>>({});
  const [showAllStages, setShowAllStages] = useState(false);
  const [openFetches, setOpenFetches] = useState<Record<string, boolean>>({});
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});

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
  const runningTrace = traces.find((trace) => trace.status === "running");
  const hasBody = traces.length > 0 || stages.length > 0 || researchActive;
  const expanded = manualExpanded ?? active;
  const sourceCount = uniqueSources(traces);
  const visibleStages = showAllStages ? stages : stages.slice(-4);
  const hiddenStages = stages.length - visibleStages.length;
  const lastStageTitle = stages[stages.length - 1]?.title;

  if (!hasBody && !active) return null;

  let header = lastStageTitle || copy.thinking.active;
  if (active) {
    if (runningTrace?.tool === "fetch") header = copy.thinking.reading;
    else if (runningTrace?.tool === "search" || researchActive) header = copy.thinking.searching;
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
          {researchActive || runningTrace ? <Search size={15} /> : <Sparkles size={15} />}
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
            {researchActive && traces.length === 0 ? (
              <div className="trace-row trace-row-wait" role="status">
                <span className="trace-spinner" aria-hidden="true" />
                <span className="trace-text trace-shimmer">{copy.thinking.searching}</span>
              </div>
            ) : null}

            {traces.map((trace, traceIndex) => {
              if (trace.tool === "search") {
                const sources = trace.sources ?? [];
                const showingAll = Boolean(showAllSources[trace.id]);
                const visible = showingAll ? sources : sources.slice(0, 3);
                const hidden = sources.length - visible.length;
                return (
                  <div className="trace-group" key={trace.id}>
                    <div
                      className="trace-row trace-row-query"
                      style={{ animationDelay: `${Math.min(traceIndex, 4) * 60}ms` }}
                    >
                      <span className="trace-icon" aria-hidden="true">
                        <Search size={13} />
                      </span>
                      <span className="trace-text">{trace.query || copy.thinking.searching}</span>
                      <span className="trace-meta">
                        {trace.status === "running" ? (
                          <span className="trace-spinner" aria-hidden="true" />
                        ) : trace.status === "error" ? (
                          <span className="trace-meta-error" title={trace.error ?? undefined}>
                            {copy.thinking.traceFailed}
                          </span>
                        ) : (
                          copy.thinking.sourceCount.replace("{count}", String(sources.length))
                        )}
                      </span>
                    </div>
                    {visible.map((source, sourceIndex) => {
                      const domain = source.domain || domainOf(source.url);
                      return (
                        <a
                          key={`${trace.id}-${source.url}`}
                          className="trace-row trace-row-source"
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={source.snippet || source.title}
                          style={{ animationDelay: `${Math.min(sourceIndex, 4) * 55 + 70}ms` }}
                        >
                          <span className={`trace-dot ${toneFor(domain)}`} aria-hidden="true">
                            <span>{domain.slice(0, 1).toUpperCase()}</span>
                          </span>
                          <span className="trace-text trace-text-source">{source.title}</span>
                          <span className="trace-meta trace-domain">{domain}</span>
                        </a>
                      );
                    })}
                    {hidden > 0 ? (
                      <button
                        type="button"
                        className="trace-more"
                        onClick={() =>
                          setShowAllSources((current) => ({ ...current, [trace.id]: !showingAll }))
                        }
                      >
                        {showingAll
                          ? copy.thinking.showLess
                          : copy.thinking.moreSources.replace("{count}", String(hidden))}
                      </button>
                    ) : null}
                  </div>
                );
              }

              const fetchDomain = trace.url ? domainOf(trace.url) : "";
              const fetchTitle = trace.title || fetchDomain || trace.url || copy.thinking.reading;
              const open = Boolean(openFetches[trace.id]);
              return (
                <div className="trace-group" key={trace.id}>
                  <div className="trace-row trace-row-fetch" style={{ animationDelay: `${Math.min(traceIndex, 4) * 60}ms` }}>
                    <span className="trace-icon" aria-hidden="true">
                      <FileText size={13} />
                    </span>
                    <button
                      type="button"
                      className="trace-text trace-fetch-toggle"
                      onClick={() =>
                        trace.excerpt
                          ? setOpenFetches((current) => ({ ...current, [trace.id]: !open }))
                          : undefined
                      }
                      disabled={!trace.excerpt}
                    >
                      {trace.status === "running" ? copy.thinking.reading : fetchTitle}
                    </button>
                    <span className="trace-meta">
                      {trace.status === "running" ? (
                        <span className="trace-spinner" aria-hidden="true" />
                      ) : trace.status === "error" ? (
                        <span className="trace-meta-error" title={trace.error ?? undefined}>
                          {copy.thinking.traceFailed}
                        </span>
                      ) : (
                        <>
                          {fetchDomain}
                          {trace.duration_ms ? ` · ${formatToolDuration(trace.duration_ms)}` : ""}
                        </>
                      )}
                    </span>
                    {trace.url && trace.status === "complete" ? (
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
                  {open && trace.excerpt ? (
                    <div className="trace-excerpt">{trace.excerpt}</div>
                  ) : null}
                </div>
              );
            })}

            {hiddenStages > 0 ? (
              <button type="button" className="trace-more" onClick={() => setShowAllStages(true)}>
                {copy.thinking.earlierStages.replace("{count}", String(hiddenStages))}
              </button>
            ) : null}

            {visibleStages.map((stage) => {
              const open = Boolean(openStages[stage.id]);
              const streaming = stage.status === "streaming" || stage.status === "active";
              return (
                <div className="trace-group" key={stage.id}>
                  <div className="trace-row trace-row-stage">
                    <span className="trace-stage-icon" aria-hidden="true">
                      {streaming ? (
                        <span className="trace-spinner" />
                      ) : (
                        <Check size={13} />
                      )}
                    </span>
                    {stage.body ? (
                      <button
                        type="button"
                        className="trace-text trace-stage-toggle"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenStages((current) => ({ ...current, [stage.id]: !open }))
                        }
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
                  {open && stage.body ? (
                    <div className="trace-stage-detail">{stage.body}</div>
                  ) : null}
                </div>
              );
            })}

            {!active && onOpenDetails ? (
              <button type="button" className="trace-details" onClick={onOpenDetails}>
                {copy.ui.thinkingProcess}
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            ) : null}

            {traces.some((trace) => trace.status === "error") ? (
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
