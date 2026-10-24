'use client';

import { UsersRound } from 'lucide-react';
import { t, type Locale } from '../../app/locale';
import { AgentGlyph } from '../agents/AgentGlyph';
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

/** 圆圈直径；相邻圆交叠 8px，3 个圆的总宽 62px */
const SEAT = 26;
const SEAT_OVERLAP = 8;
/** 最多 3 个圆；≥4 位时显示 2 个头像 + 剩余人数，不再新增 */
const MAX_STACK = 3;

/** 回答下方的圆桌署名：席位堆叠即委派摘要，悬停看细节，点击进讨论 */
export function AgentStrip({ agents, messages, locale, tooltip, onOpen, openLabel }: Props) {
  const copy = t(locale);
  const cast = buildCast(castSeeds(agents, messages));
  const className = cast.length === 0 ? 'delegation-badge' : 'agent-strip delegation-badge';

  const overflow = cast.length > MAX_STACK;
  const seats = cast.slice(0, overflow ? MAX_STACK - 1 : MAX_STACK);
  const hidden = cast.length - seats.length;
  const circles = seats.length + (overflow ? 1 : 0);
  const offset = circles > 1 ? -SEAT_OVERLAP : 0;

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
              className="agent-strip-seat agent-strip-more"
              style={{ marginLeft: offset, zIndex: circles }}
            >
              +{hidden}
            </span>
          ) : null}
        </span>
        <span className="agent-strip-label">{copy.room.seats(cast.length, messages.length)}</span>
      </>
    );

  const headerLines = tooltip.split('\n').filter(Boolean);
  const listed = agents.slice(0, 6);
  const details = (
    <span className="agent-strip-tooltip" aria-hidden="true">
      {headerLines.map((line) => (
        <span key={line} className="agent-strip-tooltip-line">
          {line}
        </span>
      ))}
      {listed.length ? (
        <span className="agent-strip-tooltip-agents">
          {listed.map((agent) => (
            <span key={agent.name} className="agent-strip-tooltip-agent">
              <AgentGlyph agent={agent.name} size={13} />
              <span>
                {copy.ui.delegationAgentLine(
                  agent.nickname || agent.name,
                  agent.role,
                  agent.model || ''
                )}
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );

  if (!onOpen) {
    return (
      <span className={className} tabIndex={0}>
        {inner}
        {details}
      </span>
    );
  }

  return (
    <button type="button" className={className} onClick={onOpen} aria-label={openLabel}>
      {inner}
      {details}
    </button>
  );
}
