import { getCharacter } from '../characters/registry';
import type { CharacterState, Facing, Participant, ThemeMode } from '../types';
import type { SeatLayout } from '../layout';
import { Chair } from './Chair';

interface Props {
  seat: SeatLayout;
  participant: Participant;
  state: CharacterState;
  facing: Facing;
  theme: ThemeMode;
  seed: number;
  onClick?: () => void;
}

export const CHAR_SIZE = 124;

export function Seat({ seat, participant, state, facing, theme, seed, onClick }: Props) {
  const def = getCharacter(participant.kind);
  const Renderer = def?.renderer;
  const aspect = def?.aspect ?? 1;
  const h = CHAR_SIZE * aspect;
  // Clawd 身体底部位于 14/17 处，让身体坐在坐垫上，腿垂在前面
  const bodyBottom = h * (14 / 17);
  const tilt = seat.baseFacing === 'right' ? 1 : seat.baseFacing === 'left' ? -1 : 0;
  const speaking = state === 'talking';

  return (
    <div
      className="absolute"
      style={{
        left: seat.x,
        top: seat.y,
        transform: `scale(${seat.scale})`,
        transformOrigin: '0 0',
        zIndex: Math.round(seat.y) + (seat.front ? 1000 : 0),
      }}
    >
      {/* 发言光圈 */}
      <div
        className="absolute rounded-[50%] transition-all duration-500"
        style={{
          left: -110,
          top: 20,
          width: 220,
          height: 56,
          background:
            theme === 'night'
              ? 'radial-gradient(closest-side, rgba(255,170,90,0.55), rgba(255,170,90,0))'
              : 'radial-gradient(closest-side, rgba(217,119,87,0.45), rgba(217,119,87,0))',
          opacity: speaking ? 1 : 0,
          transform: speaking ? 'scale(1)' : 'scale(0.6)',
        }}
      />
      <Chair style={participant.chair ?? 'armchair'} color={participant.chairColor ?? '#9a3412'} theme={theme} tilt={tilt} />
      <button
        type="button"
        onClick={onClick}
        className="absolute cursor-pointer outline-none seat-character"
        style={{ left: -CHAR_SIZE / 2, top: -bodyBottom - 4, width: CHAR_SIZE, height: h }}
        aria-label={participant.name}
      >
        <div className={`char-wrap char-wrap--${state}`} style={{ animationDelay: `${seed * 2}s` }}>
          {Renderer ? (
            <Renderer
              state={state}
              facing={facing}
              color={participant.color}
              accessories={participant.accessories}
              theme={theme}
              seed={seed}
              size={CHAR_SIZE}
            />
          ) : (
            <div className="w-full h-full grid place-items-center bg-stone-400 rounded-lg text-white">?</div>
          )}
        </div>
        {/* 状态指示 */}
        {state === 'thinking' && (
          <div className="absolute -top-6 right-0 flex gap-1 status-pop">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="think-dot block w-2.5 h-2.5 rounded-sm"
                style={{ background: theme === 'night' ? '#fde3c4' : '#57534e', animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </div>
        )}
        {state === 'reacting' && (
          <div
            className="absolute -top-10 right-1 text-2xl font-black status-pop"
            style={{ color: theme === 'night' ? '#fdba74' : '#D97757', textShadow: '0 2px 0 rgba(0,0,0,0.2)' }}
          >
            {['!', '♪', '✦', '♥'][Math.floor(seed * 4)]}
          </div>
        )}
      </button>
    </div>
  );
}
