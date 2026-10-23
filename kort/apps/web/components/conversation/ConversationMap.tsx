"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { t } from "../../app/locale";
import type { Locale } from "../../app/locale";

export type MapTurn = {
  id: string;
  title: string;
  preview: string;
};

type Tick = {
  top: number;
  height: number;
  inView: boolean;
};

const READ_LINE_TOLERANCE = 1;
const HOVER_DELAY = 120;
const CLOSE_DELAY = 80;
const CARD_WIDTH = 240;
const CARD_OFFSET = 10;

/**
 * 侧边对话地图：每一轮问答在轨道上占一个刻度，越靠近阅读线越粗。
 * 位置全部来自真实滚动测量，不猜测内容高度。
 */
export function ConversationMap({
  turns,
  scrollRef,
  locale,
}: {
  turns: MapTurn[];
  scrollRef: RefObject<HTMLElement | null>;
  locale: Locale;
}) {
  const copy = t(locale).ui;
  const trackRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [active, setActive] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [card, setCard] = useState<{ index: number; left: number; top: number } | null>(null);

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || turns.length === 0) {
      setTicks([]);
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const base = scrollerRect.top - scroller.scrollTop;
    const elements = Array.from(scroller.querySelectorAll<HTMLElement>("[data-message-id]"));
    const positions = turns.map((turn) => {
      const element = elements.find((item) => item.dataset.messageId === turn.id);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top - base, height: rect.height };
    });
    if (positions.every((item) => item === null)) return;

    const scrollTop = scroller.scrollTop;
    const height = scroller.clientHeight;
    const maxScroll = Math.max(0, scroller.scrollHeight - height);
    /* 最后一屏永远读不到顶部，所以阅读线在末尾滑向底部 */
    const line =
      scrollTop >= maxScroll - height ? scrollTop + height : scrollTop + READ_LINE_TOLERANCE;

    let current = 0;
    positions.forEach((position, index) => {
      if (position && position.top <= line) current = index;
    });
    setViewportHeight(height);
    setActive(current);
    setTicks(
      positions.map((position, index) => ({
        top: position?.top ?? index * 40,
        height: position?.height ?? 40,
        inView:
          !!position &&
          position.top < scrollTop + height - 8 &&
          position.top + position.height > scrollTop + 8,
      }))
    );
  }, [scrollRef, turns]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [measure, scrollRef, turns.length]);

  const jump = useCallback(
    (index: number) => {
      const scroller = scrollRef.current;
      const tick = ticks[index];
      if (!scroller || !tick) return;
      scroller.scrollTo({ top: Math.max(0, tick.top - 16), behavior: "smooth" });
    },
    [scrollRef, ticks]
  );

  const showCard = useCallback(
    (index: number) => {
      const node = tickRefs.current[index];
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const top = Math.min(
        Math.max(rect.top + rect.height / 2, 96),
        window.innerHeight - 120
      );
      setCard({ index, left: rect.right + CARD_OFFSET, top });
    },
    []
  );

  const openDelayed = useCallback(
    (index: number) => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => showCard(index), HOVER_DELAY);
    },
    [showCard]
  );

  const closeSoon = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setCard(null), CLOSE_DELAY);
  }, []);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in keys) {
      event.preventDefault();
      const next = Math.min(
        Math.max((focusIndex ?? active) + keys[event.key], 0),
        Math.max(turns.length - 1, 0)
      );
      setFocusIndex(next);
      tickRefs.current[next]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : Math.max(turns.length - 1, 0);
      setFocusIndex(next);
      tickRefs.current[next]?.focus();
    }
  }

  if (turns.length < 2) return null;

  const open = card ? turns[card.index] : null;

  return (
    <div className="conversation-map-wrap" aria-hidden={undefined}>
      <nav
        className="conversation-map"
        ref={trackRef}
        aria-label={copy.conversationMap}
        style={{ height: Math.max(viewportHeight - 24, 0) }}
        onKeyDown={onKeyDown}
        onMouseLeave={closeSoon}
      >
        {turns.map((turn, index) => (
          <button
            key={turn.id}
            type="button"
            ref={(node) => {
              tickRefs.current[index] = node;
            }}
            className="conversation-map-tick"
            data-active={index === active ? "true" : "false"}
            data-in-view={ticks[index]?.inView ? "true" : "false"}
            aria-current={index === active ? "true" : undefined}
            aria-label={turn.title}
            tabIndex={index === active || index === focusIndex ? 0 : -1}
            onMouseEnter={() => openDelayed(index)}
            onFocus={() => showCard(index)}
            onBlur={() => setCard(null)}
            onClick={() => jump(index)}
          >
            <span className="conversation-map-mark" />
          </button>
        ))}
      </nav>
      {open && card
        ? createPortal(
            <aside
              className="float-card conversation-map-card"
              role="tooltip"
              style={
                {
                  left: card.left,
                  top: card.top,
                  width: CARD_WIDTH,
                  "--cite-x": "0px",
                  "--cite-y": "-50%",
                } as CSSProperties
              }
            >
              <p className="conversation-map-card-title">{open.title}</p>
              {open.preview ? <p className="conversation-map-card-preview">{open.preview}</p> : null}
            </aside>,
            document.body
          )
        : null}
    </div>
  );
}

/** 把当前路径折成一轮一条：用户提问打头，随后的助手回复并入同一轮 */
export function mapTurns(
  path: Array<{ node_id: string; role: string; content: string }>,
  fallback: string
): MapTurn[] {
  const turns: MapTurn[] = [];
  for (const node of path) {
    if (node.role === "user") {
      turns.push({ id: node.node_id, title: clipTitle(node.content, fallback), preview: "" });
    } else if (turns.length > 0 && !turns[turns.length - 1].preview) {
      turns[turns.length - 1].preview = clipBody(node.content);
    }
  }
  return turns;
}

function clipTitle(text: string, fallback: string) {
  const cleaned = text.replace(/^[\s#>*`-]+/, "").trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 72) return cleaned;
  const cut = cleaned.slice(0, 72);
  const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("，"), cut.lastIndexOf("。"));
  return (boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd() + "…";
}

function clipBody(text: string) {
  const cleaned = text.replace(/^[\s#>*`-]+/, "").trim();
  return cleaned.length <= 240 ? cleaned : `${cleaned.slice(0, 240)}…`;
}
