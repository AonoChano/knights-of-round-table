import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterState, DialogueLine, Participant } from '../types';

export type Phase = 'idle' | 'typing' | 'hold' | 'await' | 'end';

interface Options {
  participants: Participant[];
  speed: number;
  /** 讨论仍在进行时持续跟随最新发言 */
  live: boolean;
}

function holdMs(length: number) {
  return Math.min(4200, Math.max(1600, 900 + length * 8));
}

export function useDiscussionPlayback(lines: DialogueLine[], { participants, speed, live }: Options) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>(() => (lines.length > 0 ? 'typing' : 'idle'));
  const [playing, setPlaying] = useState(true);

  const line = lines[index] ?? null;
  const previousCount = useRef(lines.length);

  useEffect(() => {
    const grew = lines.length > previousCount.current;
    previousCount.current = lines.length;
    if (!grew || !playing) return;
    setIndex(lines.length - 1);
    setTyped(0);
    setPhase('typing');
  }, [lines.length, playing]);

  useEffect(() => {
    if (!playing || !line) return;
    if (phase === 'typing') {
      if (typed >= line.text.length) {
        setPhase('hold');
        return;
      }
      const chunk = Math.max(1, Math.ceil(line.text.length / 60));
      const timer = setTimeout(
        () => setTyped((value) => Math.min(line.text.length, value + chunk)),
        26 / speed
      );
      return () => clearTimeout(timer);
    }
    if (phase === 'hold') {
      const timer = setTimeout(() => {
        if (index < lines.length - 1) {
          setIndex((value) => value + 1);
          setTyped(0);
          setPhase('typing');
        } else if (live) {
          // 发言已说完、下一条还没到：让所有人进入“推演中”，而不是僵在聆听态
          setPhase('await');
        } else {
          setPhase('end');
        }
      }, (line.absent ? 120 : holdMs(line.text.length)) / speed);
      return () => clearTimeout(timer);
    }
    if (phase === 'end') {
      setPlaying(false);
    }
  }, [playing, phase, typed, index, line, lines.length, live, speed]);

  const states = useMemo(() => {
    const map: Record<string, CharacterState> = {};
    if (!line || phase === 'await') {
      const waiting: CharacterState = live && playing ? 'thinking' : 'idle';
      for (const participant of participants) map[participant.id] = waiting;
      return map;
    }
    for (const participant of participants) map[participant.id] = 'listening';
    map[line.speaker] = line.absent
      ? 'listening'
      : phase === 'typing'
        ? 'talking'
        : phase === 'end'
          ? 'reacting'
          : 'idle';
    const progress = typed / Math.max(1, line.text.length);
    if (line.reactions && (phase === 'hold' || progress > 0.55)) {
      for (const [id, state] of Object.entries(line.reactions)) {
        if (id !== line.speaker) map[id] = state;
      }
    }
    if (phase === 'end') {
      for (const participant of participants) map[participant.id] = 'reacting';
    }
    return map;
  }, [participants, line, phase, typed, live, playing]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(lines.length - 1, next));
      setIndex(clamped);
      setTyped(0);
      setPhase('typing');
    },
    [lines.length]
  );

  const restart = useCallback(() => {
    setIndex(0);
    setTyped(0);
    setPhase(lines.length > 0 ? 'typing' : 'idle');
    setPlaying(true);
  }, [lines.length]);

  const spoken = line && (phase === 'typing' || phase === 'hold');

  return {
    index,
    line,
    phase,
    playing,
    setPlaying,
    states,
    speakerId: spoken ? line.speaker : null,
    typedText: spoken ? line.text.slice(0, typed) : '',
    currentRound: line?.round ?? 0,
    goTo,
    restart,
  };
}
