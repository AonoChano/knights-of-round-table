'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, List, Moon, Pause, Play, RotateCcw, Sun } from 'lucide-react';
import { t, type Locale } from '../../app/locale';
import { buildCast, castSeeds } from './cast';
import { Room } from './components/Room';
import { Seat, CHAR_SIZE } from './components/Seat';
import { SpeechBubble } from './components/SpeechBubble';
import { Table } from './components/Table';
import { Transcript } from './components/Transcript';
import './characters/Clawd';
import { useDiscussionPlayback } from './hooks/useDiscussionPlayback';
import { computeSeats, STAGE_H, STAGE_W, type SeatLayout } from './layout';
import { toDialogueLines } from './lines';
import type { DiscussionMessage, DiscussionParticipantSeed, Facing, ThemeMode } from './types';

interface Props {
  question: string;
  messages: DiscussionMessage[];
  agents: DiscussionParticipantSeed[];
  streaming: boolean;
  locale: Locale;
  onBack: () => void;
}

type StoredTheme = ThemeMode;

const THEME_KEY = 'kort-room-theme';
const SPEED_KEY = 'kort-room-speed';
const SPEEDS = [0.75, 1, 1.5, 2];
/** 鼠标停手这么久就收起底部控制条，把画面留给讨论本身 */
const IDLE_MS = 2600;

function loadTheme(): StoredTheme {
  if (typeof window === 'undefined') return 'night';
  return window.localStorage.getItem(THEME_KEY) === 'day' ? 'day' : 'night';
}

function loadSpeed(): number {
  if (typeof window === 'undefined') return 1;
  const stored = Number(window.localStorage.getItem(SPEED_KEY));
  return SPEEDS.includes(stored) ? stored : 1;
}

function useStageScale(ref: { current: HTMLDivElement | null }) {
  const [view, setView] = useState({ scale: 0.42, width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 16 || box.height < 16) return;
      const cover = Math.max(box.width / STAGE_W, box.height / STAGE_H);
      setView({
        scale: Math.min(1.22, Math.max(0.32, cover)),
        width: box.width,
        height: box.height,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return view;
}

export function DiscussionView({ question, messages, agents, streaming, locale, onBack }: Props) {
  const tr = t(locale).room;
  const stageRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<StoredTheme>(loadTheme);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [speed, setSpeed] = useState(loadSpeed);
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimer = useRef<number | null>(null);
  const { scale, width: viewWidth, height: viewHeight } = useStageScale(stageRef);

  const cast = useMemo(() => buildCast(castSeeds(agents, messages)), [agents, messages]);

  const seats = useMemo(() => computeSeats(cast.length), [cast.length]);
  const lines = useMemo(() => toDialogueLines(messages, cast), [messages, cast]);
  const seatEls = useRef(new Map<string, HTMLButtonElement>());
  const [dimmedIds, setDimmedIds] = useState<string[]>([]);
  const castKey = cast.map((participant) => participant.id).join('|');
  const playback = useDiscussionPlayback(lines, {
    participants: cast,
    speed,
    live: streaming,
  });

  const night = theme === 'night';
  const seatOf = (id: string) => seats[cast.findIndex((seat) => seat.id === id)];
  const focusSeat = playback.speakerId ? seatOf(playback.speakerId) : null;

  const facingFor = (index: number): Facing => {
    const seat = seats[index];
    const participant = cast[index];
    if (!focusSeat || !seat || !participant || participant.id === playback.speakerId) {
      return seat?.baseFacing ?? 'front';
    }
    const dx = focusSeat.x - seat.x;
    if (Math.abs(dx) < 40) return 'front';
    return dx < 0 ? 'left' : 'right';
  };

  const speaker = playback.speakerId ? cast.find((seat) => seat.id === playback.speakerId) : null;
  const speakerSeat = playback.speakerId ? seatOf(playback.speakerId) : null;
  const waiting = messages.length === 0;
  const currentRound = messages[messages.length - 1]?.round ?? 0;
  const replaying = !streaming && playback.phase !== 'end';
  const stageState = waiting
    ? tr.ongoing
    : streaming
      ? playback.phase === 'await'
        ? tr.deliberating
        : tr.ongoing
      : playback.phase === 'end'
        ? tr.adjourned
        : tr.replaying;
  const [roundFlash, setRoundFlash] = useState<{ round: number; token: number } | null>(null);
  const lastRoundRef = useRef(0);

  useEffect(() => {
    const round = playback.currentRound;
    if (!round || round === lastRoundRef.current) return;
    lastRoundRef.current = round;
    const token = Date.now();
    setRoundFlash({ round, token });
    const timer = window.setTimeout(
      () => setRoundFlash((current) => (current?.token === token ? null : current)),
      1800
    );
    return () => window.clearTimeout(timer);
  }, [playback.currentRound]);

  /** 座位层级：靠前的座位压在靠后的座位上 */
  const seatZ = (seat: SeatLayout) => Math.round(seat.y) + (seat.front ? 1000 : 0);

  // 发言者被前方座位挡住时，把挡住他的专家临时淡出，保证视线落在说话的人身上
  useEffect(() => {
    const activeId = playback.speakerId;
    const clear = () => setDimmedIds((current) => (current.length ? [] : current));
    if (!activeId) {
      clear();
      return;
    }
    const activeIndex = cast.findIndex((participant) => participant.id === activeId);
    const activeSeat = activeIndex >= 0 ? seats[activeIndex] : undefined;
    const activeEl = seatEls.current.get(activeId);
    if (!activeSeat || !activeEl) {
      clear();
      return;
    }
    const base = activeEl.getBoundingClientRect();
    const baseArea = base.width * base.height;
    if (baseArea <= 0) return;
    const baseZ = seatZ(activeSeat);
    const next: string[] = [];
    cast.forEach((participant, index) => {
      if (participant.id === activeId) return;
      const seat = seats[index];
      const node = seatEls.current.get(participant.id);
      if (!seat || !node || seatZ(seat) <= baseZ) return;
      const rect = node.getBoundingClientRect();
      const overlapWidth = Math.min(base.right, rect.right) - Math.max(base.left, rect.left);
      const overlapHeight = Math.min(base.bottom, rect.bottom) - Math.max(base.top, rect.top);
      if (overlapWidth <= 8 || overlapHeight <= 8) return;
      const overlap = overlapWidth * overlapHeight;
      if (overlap < Math.min(baseArea, rect.width * rect.height) * 0.14) return;
      next.push(participant.id);
    });
    setDimmedIds((current) =>
      current.length === next.length && current.every((id, index) => id === next[index]) ? current : next
    );
  }, [playback.speakerId, seats, castKey]);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  }, [speed]);

  useEffect(() => {
    const reveal = () => {
      setChromeVisible(true);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setChromeVisible(false), IDLE_MS);
    };
    reveal();
    window.addEventListener('mousemove', reveal);
    window.addEventListener('pointerdown', reveal);
    window.addEventListener('keydown', reveal);
    return () => {
      window.removeEventListener('mousemove', reveal);
      window.removeEventListener('pointerdown', reveal);
      window.removeEventListener('keydown', reveal);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === ' ') {
        event.preventDefault();
        playback.setPlaying((value) => !value);
      } else if (event.key === 'ArrowRight') {
        playback.goTo(playback.index + 1);
      } else if (event.key === 'ArrowLeft') {
        playback.goTo(playback.index - 1);
      } else if (event.key === 'Escape') {
        if (transcriptOpen) setTranscriptOpen(false);
        else onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, playback, transcriptOpen]);

  const chrome = night
    ? 'bg-stone-900/60 text-amber-50 ring-1 ring-amber-100/10 hover:bg-stone-800/80'
    : 'bg-white/75 text-stone-700 ring-1 ring-stone-900/5 hover:bg-white';
  const controlsHidden = !chromeVisible;
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;

  return (
    <div className="discussion-shell" data-theme={night ? 'night' : 'day'}>
      <header className="discussion-head">
        <button type="button" className="discussion-back" onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span>{tr.back}</span>
        </button>
        <div className="discussion-topic">
          <div className="discussion-kicker">
            <span className={waiting || !(streaming || replaying) ? 'discussion-dot' : 'discussion-dot discussion-dot-live'} />
            <span>{stageState}</span>
            {currentRound > 0 ? (
              <>
                <span className="discussion-kicker-sep">·</span>
                <span>{tr.round(currentRound)}</span>
              </>
            ) : null}
            {speaker ? (
              <span className="discussion-speaker" key={`${playback.index}-${speaker.id}`}>
                <span className="discussion-speaker-dot" style={{ background: speaker.color }} />
                {tr.speaking(speaker.name)}
              </span>
            ) : null}
          </div>
          <h2 className="discussion-question">{question}</h2>
        </div>
        <div className="discussion-actions">
          <button
            type="button"
            className={`discussion-icon-button ${chrome}`}
            onClick={() => setTranscriptOpen((value) => !value)}
            title={tr.transcript}
            aria-label={tr.transcript}
          >
            <List size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`discussion-icon-button ${chrome}`}
            onClick={() => setTheme((value) => (value === 'night' ? 'day' : 'night'))}
            title={night ? tr.switchToDay : tr.switchToNight}
            aria-label={night ? tr.switchToDay : tr.switchToNight}
          >
            {night ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className="discussion-stage kort-room"
        style={{ background: night ? '#120c0a' : '#e9dccb' }}
      >
        <div
          className="absolute left-1/2 top-1/2 select-none"
          style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <Room theme={theme} />

          {cast.map((participant, index) =>
            seats[index] && !seats[index].front ? (
              <Seat
                key={participant.id}
                seat={seats[index]}
                participant={participant}
                state={playback.states[participant.id] ?? 'idle'}
                facing={facingFor(index)}
                theme={theme}
                seed={((index * 0.37) % 1) + 0.05}
                dimmed={dimmedIds.includes(participant.id)}
                onClick={() => setTranscriptOpen(true)}
                elementRef={(node) => {
                  if (node) seatEls.current.set(participant.id, node);
                  else seatEls.current.delete(participant.id);
                }}
              />
            ) : null
          )}

          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 1500 }}>
            <Table
              theme={theme}
              seats={seats}
              participants={cast}
              speakerId={playback.speakerId}
              showNameplates
            />
          </div>

          {cast.map((participant, index) =>
            seats[index] && seats[index].front ? (
              <Seat
                key={participant.id}
                seat={seats[index]}
                participant={participant}
                state={playback.states[participant.id] ?? 'idle'}
                facing={facingFor(index)}
                theme={theme}
                seed={((index * 0.37) % 1) + 0.05}
                dimmed={dimmedIds.includes(participant.id)}
                onClick={() => setTranscriptOpen(true)}
                elementRef={(node) => {
                  if (node) seatEls.current.set(participant.id, node);
                  else seatEls.current.delete(participant.id);
                }}
              />
            ) : null
          )}

          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
            style={{
              zIndex: 4000,
              opacity: night ? 1 : 0,
              background:
                'radial-gradient(ellipse 46% 52% at 50% 66%, rgba(20,10,5,0) 0%, rgba(20,10,8,0.35) 55%, rgba(6,4,10,0.82) 100%)',
            }}
          />
          <div
            className="fire-flicker pointer-events-none absolute inset-0 transition-opacity duration-1000"
            style={{
              zIndex: 4001,
              opacity: night ? 1 : 0,
              mixBlendMode: 'screen',
              background:
                'radial-gradient(ellipse 30% 30% at 50% 66%, rgba(255,140,50,0.22), rgba(255,140,50,0) 70%), radial-gradient(ellipse 18% 24% at 16% 52%, rgba(255,130,40,0.2), rgba(255,130,40,0) 70%)',
            }}
          />
          <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 4002 }}>
            {Array.from({ length: 22 }, (_, index) => (
              <span
                key={index}
                className={night ? 'mote-ember' : 'mote-dust'}
                style={{
                  left: night ? `${(index % 2 ? 46 : 12) + ((index * 7) % 10)}%` : `${48 + ((index * 13) % 34)}%`,
                  top: night ? `${index % 2 ? 66 : 54}%` : `${20 + ((index * 17) % 60)}%`,
                  animationDelay: `${(index * 0.73) % 6}s`,
                  animationDuration: `${5 + (index % 5)}s`,
                }}
              />
            ))}
          </div>

          {speaker && speakerSeat && playback.typedText ? (
            <SpeechBubble
              key={`${playback.index}-${speaker.id}`}
              x={speakerSeat.x}
              y={speakerSeat.y - (CHAR_SIZE * 1.32 + 6) * speakerSeat.scale}
              scale={scale}
              view={{ width: viewWidth, height: viewHeight }}
              participant={speaker}
              text={playback.typedText}
              done={playback.phase === 'hold'}
              theme={theme}
              locale={locale}
            />
          ) : null}
        </div>

        {roundFlash ? (
          <div className="discussion-round-flash" key={roundFlash.token} role="status">
            {tr.round(roundFlash.round)}
          </div>
        ) : null}

        {waiting ? (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-[5500] -translate-x-1/2 -translate-y-1/2">
            <div className="discussion-waiting">{tr.waiting}</div>
          </div>
        ) : null}

        <div
          className={`absolute bottom-4 left-1/2 z-[5600] -translate-x-1/2 transition-all duration-500 ${
            controlsHidden ? 'pointer-events-none translate-y-6 opacity-0' : 'opacity-100'
          }`}
        >
          <div
            className={`flex items-center gap-1 rounded-full py-2 pl-2 pr-4 transition-colors duration-700 ${chrome}`}
            style={{ backdropFilter: 'blur(12px)' }}
          >
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/10"
              onClick={() => playback.goTo(playback.index - 1)}
              title={tr.prev}
              aria-label={tr.prev}
            >
              ‹
            </button>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-full bg-[#D97757] text-white hover:brightness-110"
              onClick={() => (playback.phase === 'end' ? playback.restart() : playback.setPlaying((value) => !value))}
              title={playback.playing ? tr.pause : tr.play}
              aria-label={playback.playing ? tr.pause : tr.play}
            >
              {playback.phase === 'end' ? (
                <RotateCcw size={15} aria-hidden="true" />
              ) : playback.playing ? (
                <Pause size={15} aria-hidden="true" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/10"
              onClick={() => playback.goTo(playback.index + 1)}
              title={tr.next}
              aria-label={tr.next}
            >
              ›
            </button>
            <button
              type="button"
              className="discussion-speed"
              onClick={() => setSpeed(nextSpeed)}
              title={tr.speed}
              aria-label={tr.speed}
            >
              {speed}&times;
            </button>
            <div className="mx-3 flex items-center gap-[3px]">
              {lines.map((line, index) => {
                const seat = cast.find((participant) => participant.id === line.speaker);
                return (
                  <button
                    key={`${line.speaker}-${index}`}
                    type="button"
                    onClick={() => playback.goTo(index)}
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: index === playback.index ? 20 : 7,
                      background:
                        index <= playback.index
                          ? seat?.color
                          : night
                            ? 'rgba(255,255,255,0.18)'
                            : 'rgba(0,0,0,0.14)',
                    }}
                    title={line.text.slice(0, 24)}
                  />
                );
              })}
            </div>
            <span className="discussion-controls-counter hidden text-xs tabular-nums opacity-60 sm:inline">
              {messages.length ? `${playback.index + 1}/${lines.length}` : '0/0'}
            </span>
          </div>
        </div>

        <Transcript
          messages={messages}
          cast={cast}
          currentIndex={playback.index}
          typedText={playback.typedText}
          theme={theme}
          open={transcriptOpen}
          title={tr.transcript}
          roundLabel={tr.round}
          absentLabel={tr.absent}
          locale={locale}
          onClose={() => setTranscriptOpen(false)}
          onJump={playback.goTo}
        />
      </div>
    </div>
  );
}
