import type { Participant, ThemeMode } from '../types';
import { STAGE_W } from '../layout';

interface Props {
  x: number;
  y: number;
  /** 舞台缩放比；气泡反向缩放，保证座位缩小时文字依旧可读 */
  scale: number;
  participant: Participant;
  text: string;
  done: boolean;
  theme: ThemeMode;
}

const W = 380;

export function SpeechBubble({ x, y, scale, participant, text, done, theme }: Props) {
  const halfVisual = W / 2 / scale;
  const fits = halfVisual * 2 < STAGE_W - 32;
  const center = fits ? Math.max(16 + halfVisual, Math.min(STAGE_W - 16 - halfVisual, x)) : STAGE_W / 2;
  const visualLeft = center - halfVisual;
  const pointer = Math.max(28, Math.min(W - 28, (x - visualLeft) * scale));
  const night = theme === 'night';

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
            <p>
              {text}
              {!done && <span className="caret">▍</span>}
            </p>
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
