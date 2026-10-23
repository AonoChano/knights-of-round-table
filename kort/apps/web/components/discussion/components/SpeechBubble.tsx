import { useEffect, useRef } from 'react';
import { Markdown } from '../../Markdown';
import type { Locale } from '../../../app/locale';
import type { Participant, ThemeMode } from '../types';
import { STAGE_H, STAGE_W } from '../layout';

interface Props {
  x: number;
  y: number;
  /** 舞台缩放比；气泡反向缩放，保证座位缩小时文字依旧可读 */
  scale: number;
  /** 舞台实际可见的像素窗口，气泡越出它就会被 overflow:hidden 裁掉 */
  view: { width: number; height: number };
  participant: Participant;
  text: string;
  done: boolean;
  theme: ThemeMode;
  locale: Locale;
}

const W = 380;

export function SpeechBubble({ x, y, scale, view, participant, text, done, theme, locale }: Props) {
  const halfVisual = W / 2 / scale;
  const visibleW = view.width > 0 ? Math.min(STAGE_W, view.width / scale) : STAGE_W;
  const visibleTop = view.height > 0 ? (STAGE_H - Math.min(STAGE_H, view.height / scale)) / 2 : 0;
  const lowEdge = (STAGE_W - visibleW) / 2 + 16 + halfVisual;
  const highEdge = (STAGE_W + visibleW) / 2 - 16 - halfVisual;
  const center = highEdge < lowEdge ? STAGE_W / 2 : Math.max(lowEdge, Math.min(highEdge, x));
  const visualLeft = center - halfVisual;
  const pointer = Math.max(28, Math.min(W - 28, (x - visualLeft) * scale));
  const night = theme === 'night';
  const bodyRef = useRef<HTMLDivElement>(null);
  // 气泡贴着座位向上长，正文超出时自己往下滚，而不是被舞台裁掉。
  // 反向缩放会把布局高度放大 1/scale 倍，所以可用高度要按缩放后的视觉高度来算。
  const bodyMaxHeight = Math.max(96, (y - visibleTop - 16) * scale - 88);

  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: center, top: y, transform: 'translate(-50%, -100%)', zIndex: 5000 }}
    >
      <div style={{ width: W, transform: `scale(${1 / scale})`, transformOrigin: '50% 100%' }}>
        <div className="bubble-in">
          <div
            className="relative rounded-2xl px-5 py-4 text-[17px] leading-relaxed"
            style={{
              background: night ? 'rgba(42,30,24,0.94)' : 'rgba(255,253,249,0.97)',
              color: night ? '#fbead6' : '#2d2420',
              border: `2px solid ${night ? 'rgba(255,180,110,0.35)' : 'rgba(60,40,30,0.08)'}`,
              boxShadow: night
                ? '0 10px 40px rgba(255,140,60,0.18), 0 4px 0 rgba(0,0,0,0.35)'
                : '0 14px 40px rgba(80,50,30,0.15), 0 4px 0 rgba(80,50,30,0.06)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-3 w-3 rounded-[3px]" style={{ background: participant.color }} />
              <span className="text-[14px] font-bold tracking-wide" style={{ color: participant.color }}>
                {participant.name}
              </span>
              <span className="truncate text-[12px] opacity-50">{participant.title}</span>
            </div>
            <div
              ref={bodyRef}
              className="discussion-bubble-text markdown-body"
              style={{ maxHeight: bodyMaxHeight }}
            >
              <Markdown content={text} locale={locale} />
            </div>
            {!done && <span className="caret">▍</span>}
            <div
              className="absolute -bottom-[11px] h-5 w-5 rotate-45"
              style={{
                left: pointer - 10,
                background: night ? 'rgba(42,30,24,0.94)' : 'rgba(255,253,249,0.97)',
                borderRight: `2px solid ${night ? 'rgba(255,180,110,0.35)' : 'rgba(60,40,30,0.08)'}`,
                borderBottom: `2px solid ${night ? 'rgba(255,180,110,0.35)' : 'rgba(60,40,30,0.08)'}`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
