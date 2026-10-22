import { useEffect, useRef } from 'react';
import { isAbsentUtterance } from '../lines';
import type { DiscussionMessage, Participant } from '../types';

interface Props {
  messages: DiscussionMessage[];
  cast: Participant[];
  currentIndex: number;
  typedText: string;
  theme: 'day' | 'night';
  open: boolean;
  title: string;
  roundLabel: (round: number) => string;
  absentLabel: string;
  onClose: () => void;
  onJump: (index: number) => void;
}

export function Transcript({
  messages,
  cast,
  currentIndex,
  typedText,
  theme,
  open,
  title,
  roundLabel,
  absentLabel,
  onClose,
  onJump,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const night = theme === 'night';
  const byId = Object.fromEntries(cast.map((seat) => [seat.id, seat]));

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [currentIndex, typedText.length, open]);

  return (
    <aside
      aria-hidden={!open}
      inert={!open}
      className={`absolute bottom-3 left-3 right-3 top-3 z-[6000] flex flex-col rounded-2xl transition-all duration-300 lg:left-auto lg:w-[330px] ${
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'
      } ${night ? 'bg-stone-900/90 text-amber-50 ring-1 ring-amber-200/10' : 'bg-white/90 text-stone-800 ring-1 ring-stone-900/5'}`}
      style={{ backdropFilter: 'blur(14px)', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}
    >
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <h3 className="text-sm font-bold uppercase tracking-widest opacity-70">{title}</h3>
        <button onClick={onClose} className="text-lg leading-none opacity-50 hover:opacity-100" aria-label="close">
          ×
        </button>
      </div>
      <div ref={ref} className="scroll-thin flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {messages.map((message, index) => {
          const seat = byId[message.speaker];
          const previous = messages[index - 1];
          const showRound = !previous || previous.round !== message.round;
          const absent = isAbsentUtterance(message.text);
          const text = index === currentIndex ? typedText || message.text : message.text;
          return (
            <div key={message.id}>
              {showRound ? (
                <div className="px-1 pb-1 pt-2 text-[11px] uppercase tracking-[0.18em] opacity-45">
                  {roundLabel(message.round)}
                </div>
              ) : null}
              <button
                onClick={() => onJump(index)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                  index === currentIndex
                    ? night
                      ? 'bg-amber-200/10'
                      : 'bg-orange-50'
                    : night
                      ? 'hover:bg-white/5'
                      : 'hover:bg-stone-100'
                }`}
              >
                <div className="mb-0.5 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: seat?.color ?? (night ? '#f5e5cf' : '#57534e') }}
                  />
                  <span className="text-xs font-bold" style={{ color: seat?.color }}>
                    {seat?.name ?? message.nickname}
                  </span>
                  <span className="truncate text-[11px] opacity-40">{message.nickname}</span>
                </div>
                {absent ? (
                  <p className="text-[13px] italic leading-relaxed opacity-45">{absentLabel}</p>
                ) : (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed opacity-85">{text}</p>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
