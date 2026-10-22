'use client';

import { UsersRound } from 'lucide-react';
import { t, type Locale } from '../../app/locale';
import { buildCast, castSeeds } from './cast';
import { MiniAvatar } from './MiniAvatar';
import type { DiscussionMessage, DiscussionParticipantSeed } from './types';

interface Props {
  agents: DiscussionParticipantSeed[];
  messages: DiscussionMessage[];
  locale: Locale;
  tooltip: string;
  /** 点开这场讨论的直播或录播；不传则只做展示 */
  onOpen?: () => void;
  openLabel?: string;
}

/** 圆圈直径；三个不交叠时的总宽（78px）是堆叠后的恒定占位宽度 */
const SEAT = 26;
const BASELINE = SEAT * 3;
/** 最多叠 6 个；≥7 位时第 6 个圆显示为 …，不再新增 */
const MAX_STACK = 6;

function stackStep(circles: number) {
  if (circles <= 1) return SEAT;
  return Math.min(SEAT, (BASELINE - SEAT) / (circles - 1));
}

/** 回答下方的圆桌署名：席位堆叠即委派摘要，悬停看细节，点击进讨论 */
export function AgentStrip({ agents, messages, locale, tooltip, onOpen, openLabel }: Props) {
  const copy = t(locale);
  const cast = buildCast(castSeeds(agents, messages));
  const className = cast.length === 0 ? 'delegation-badge' : 'agent-strip delegation-badge';

  const overflow = cast.length > MAX_STACK;
  const seats = cast.slice(0, overflow ? MAX_STACK - 1 : MAX_STACK);
  const circles = seats.length + (overflow ? 1 : 0);
  const offset = stackStep(circles) - SEAT;

  const inner =
    cast.length === 0 ? (
      <>
        <UsersRound size={14} aria-hidden="true" />
        <span>{copy.ui.delegationInfo}</span>
      </>
    ) : (
      <>
        <span className="agent-strip-seats" aria-hidden="true">
          {seats.map((seat, index) => (
            <span
              key={seat.id}
              className="agent-strip-seat"
              style={{ marginLeft: index === 0 ? 0 : offset, zIndex: index + 1 }}
            >
              <MiniAvatar participant={seat} size={SEAT - 6} />
            </span>
          ))}
          {overflow ? (
            <span
              className="agent-strip-seat agent-strip-ellipsis"
              style={{ marginLeft: offset, zIndex: circles }}
            >
              …
            </span>
          ) : null}
        </span>
        <span className="agent-strip-label">{copy.room.seats(cast.length, messages.length)}</span>
      </>
    );

  if (!onOpen) {
    return (
      <span className={className} data-tooltip={tooltip} tabIndex={0}>
        {inner}
      </span>
    );
  }

  return (
    <button type="button" className={className} data-tooltip={tooltip} onClick={onOpen} aria-label={openLabel}>
      {inner}
    </button>
  );
}
