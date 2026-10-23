"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { t } from "../../app/locale";
import type { Locale } from "../../app/locale";
import { safeHref, type CiteSource } from "./sources";

type TimerHandle = ReturnType<typeof setTimeout>;

const CARD_GAP = 8;
const HOVER_DELAY = 120;
const CLOSE_DELAY = 80;
/* below this much room the card flips under the marker instead of above it */
const FLIP_ABOVE = 210;
const CARD_WIDTH = 244;

export function InlineCitation({ source, locale }: { source: CiteSource; locale: Locale }) {
  const copy = t(locale);
  const anchorRef = useRef<HTMLElement | null>(null);
  const openTimer = useRef<TimerHandle | null>(null);
  const closeTimer = useRef<TimerHandle | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const cancelTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => cancelTimers, [cancelTimers]);

  const show = useCallback(() => {
    const node = anchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const half = CARD_WIDTH / 2;
    const left = Math.min(Math.max(rect.left + rect.width / 2, half + 10), window.innerWidth - half - 10);
    const below = rect.top < FLIP_ABOVE;
    setCoords({ left, top: below ? rect.bottom + CARD_GAP : rect.top - CARD_GAP, below });
  }, []);

  const hide = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setCoords(null), CLOSE_DELAY);
  }, []);

  const openDelayed = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(show, HOVER_DELAY);
  }, [show]);

  const toggle = useCallback(() => {
    if (coords) {
      cancelTimers();
      setCoords(null);
    } else {
      show();
    }
  }, [cancelTimers, coords, show]);

  useEffect(() => {
    if (!coords) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCoords(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coords]);

  const href = safeHref(source.url);

  return (
    <>
      <cite
        ref={anchorRef}
        className="citation"
        data-open={coords ? "true" : "false"}
        aria-label={copy.ui.citationLabel
          .replace("{index}", String(source.index))
          .replace("{title}", source.title)}
        tabIndex={0}
        onMouseEnter={openDelayed}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => setCoords(null)}
        onClick={toggle}
      >
        {source.index}
      </cite>
      {coords
        ? createPortal(
            <aside
              className="float-card"
              role="tooltip"
              style={
                {
                  left: coords.left,
                  top: coords.top,
                  width: CARD_WIDTH,
                  "--cite-y": coords.below ? "0%" : "-100%",
                } as CSSProperties
              }
            >
              <div className="citation-card-meta">
                <span className="citation-card-tile" aria-hidden="true">
                  {source.domain.slice(0, 1).toUpperCase()}
                </span>
                <span className="citation-card-domain">{source.domain}</span>
              </div>
              <p className="citation-card-title">{source.title}</p>
              {source.snippet ? <p className="citation-card-snippet">{source.snippet}</p> : null}
              {href ? (
                <a
                  className="citation-card-link"
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  <span>{copy.ui.citationOpen}</span>
                </a>
              ) : null}
            </aside>,
            document.body,
          )
        : null}
    </>
  );
}
