import { getCharacter } from './characters/registry';
import './characters/Clawd';
import type { Participant } from './types';

interface Props {
  participant: Participant;
  size?: number;
}

/** 对话流里的小头像：与讨论视图共用同一套席位形象 */
export function MiniAvatar({ participant, size = 26 }: Props) {
  const definition = getCharacter(participant.kind);
  const Renderer = definition?.renderer;
  if (!Renderer) return null;
  return (
    <span
      className="agent-avatar"
      style={{ width: size, height: size * (definition?.aspect ?? 0.85) }}
      aria-hidden="true"
    >
      <Renderer
        state="idle"
        facing="front"
        color={participant.color}
        accessories={participant.accessories}
        theme="day"
        seed={0.17}
        size={size}
      />
    </span>
  );
}
