import type { Participant, ThemeMode } from '../types';
import type { SeatLayout } from '../layout';
import { TABLE } from '../layout';

interface Props {
  theme: ThemeMode;
  seats: SeatLayout[];
  participants: Participant[];
  speakerId: string | null;
  showNameplates: boolean;
}

function Brazier() {
  return (
    <g>
      <ellipse cx={0} cy={-6} rx={150} ry={46} fill="#ff9b45" opacity={0.28} className="glow-pulse" />
      {/* 炭盆 */}
      <path d="M-50,-14 L50,-14 L38,18 L-38,18 Z" fill="#2b2522" />
      <ellipse cx={0} cy={-14} rx={50} ry={12} fill="#3a322e" />
      <ellipse cx={0} cy={-14} rx={42} ry={8} fill="#7c2d12" />
      <ellipse cx={0} cy={-14} rx={34} ry={6} fill="#ea580c" className="glow-pulse" />
      <rect x={-30} y={16} width={6} height={10} fill="#1f1a17" />
      <rect x={24} y={16} width={6} height={10} fill="#1f1a17" />
      <g transform="translate(0 -14) scale(0.55)">
        <path className="flame f1" d="M-40,0 C-48,-30 -30,-48 -26,-78 C-14,-52 -6,-44 -8,0 Z" fill="#f97316" />
        <path className="flame f2" d="M30,0 C40,-26 26,-50 30,-80 C12,-56 6,-40 8,0 Z" fill="#f97316" />
        <path className="flame f3" d="M-26,0 C-34,-40 -6,-64 0,-110 C8,-70 34,-42 26,0 Z" fill="#fb923c" />
        <path className="flame f4" d="M-16,0 C-20,-28 -2,-44 0,-74 C6,-46 20,-28 16,0 Z" fill="#fcd34d" />
        <path className="flame f5" d="M-8,0 C-10,-14 0,-24 0,-40 C4,-24 10,-14 8,0 Z" fill="#fff7d6" />
      </g>
      {/* 火星 */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect
          key={i}
          x={-24 + ((i * 17) % 48)}
          y={-40}
          width={3}
          height={3}
          fill={i % 2 ? '#fdba74' : '#fde68a'}
          className="ember"
          style={{ animationDelay: `${i * 0.37}s`, animationDuration: `${2.4 + (i % 4) * 0.5}s` }}
        />
      ))}
    </g>
  );
}

function TeaSet() {
  return (
    <g>
      {/* 茶盘 */}
      <ellipse cx={0} cy={8} rx={90} ry={22} fill="#7a5236" />
      <ellipse cx={0} cy={4} rx={86} ry={19} fill="#8f6243" />
      {/* 茶壶 */}
      <ellipse cx={0} cy={-18} rx={30} ry={24} fill="#f2ede4" />
      <ellipse cx={0} cy={-34} rx={14} ry={5} fill="#e2dbcf" />
      <rect x={-3} y={-44} width={6} height={8} rx={3} fill="#D97757" />
      <path d="M28,-22 Q48,-30 50,-42 L54,-40 Q50,-22 30,-12 Z" fill="#f2ede4" />
      <path d="M-28,-26 Q-46,-24 -44,-12 Q-42,-2 -28,-8" fill="none" stroke="#e2dbcf" strokeWidth={6} />
      <rect x={-30} y={-20} width={60} height={5} fill="#D97757" opacity={0.85} />
      {/* 茶杯 */}
      <g transform="translate(-60 0)">
        <path d="M-12,-12 L12,-12 L9,4 L-9,4 Z" fill="#f2ede4" />
        <ellipse cx={0} cy={-12} rx={12} ry={3.5} fill="#a16207" />
      </g>
      <g transform="translate(62 2)">
        <path d="M-12,-12 L12,-12 L9,4 L-9,4 Z" fill="#f2ede4" />
        <ellipse cx={0} cy={-12} rx={12} ry={3.5} fill="#a16207" />
      </g>
      {/* 热气 */}
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d="M0,0 C-6,-10 6,-18 0,-28 C-6,-38 6,-46 0,-56"
          fill="none"
          stroke="#ffffff"
          strokeWidth={4}
          strokeLinecap="round"
          opacity={0.7}
          className="steam"
          transform={`translate(${52 + i * 4} -46)`}
          style={{ animationDelay: `${i * 0.9}s` }}
        />
      ))}
    </g>
  );
}

export function Table({ theme, seats, participants, speakerId, showNameplates }: Props) {
  const night = theme === 'night';
  const { cx, cy, rx, ry, thick } = TABLE;
  const top = night ? '#6b3f26' : '#a8714a';
  const topLight = night ? '#7d4a2d' : '#b98258';
  const side = night ? '#3e2214' : '#7a4b2c';
  const sideDark = night ? '#2a160c' : '#5e3820';

  return (
    <svg viewBox="0 0 1600 900" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
      <defs>
        <radialGradient id="tableGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb25e" stopOpacity={0.55} />
          <stop offset="1" stopColor="#ffb25e" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="tableSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={sideDark} />
          <stop offset="0.5" stopColor={side} />
          <stop offset="1" stopColor={sideDark} />
        </linearGradient>
      </defs>
      {/* 投影 */}
      <ellipse cx={cx} cy={cy + 150} rx={rx * 0.7} ry={ry * 0.45} fill="#000" opacity={night ? 0.35 : 0.18} />
      {/* 桌腿 */}
      <rect x={cx - 34} y={cy + 20} width={68} height={120} fill={sideDark} />
      <rect x={cx - 34} y={cy + 20} width={18} height={120} fill={side} opacity={0.6} />
      <ellipse cx={cx} cy={cy + 142} rx={120} ry={22} fill={side} />
      <ellipse cx={cx} cy={cy + 138} rx={120} ry={20} fill={top} />
      {/* 桌沿侧面 */}
      <path
        d={`M${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy} L${cx + rx},${cy + thick} A${rx},${ry} 0 0 1 ${cx - rx},${cy + thick} Z`}
        fill="url(#tableSide)"
      />
      {/* 桌面 */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={top} className="theme-fill" />
      <ellipse cx={cx} cy={cy - 4} rx={rx - 18} ry={ry - 10} fill={topLight} opacity={0.6} className="theme-fill" />
      <ellipse cx={cx} cy={cy} rx={rx - 40} ry={ry - 26} fill="none" stroke={side} strokeWidth={1.5} opacity={0.35} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={topLight} strokeWidth={2} opacity={0.7} />
      {/* 夜间火光映照 */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#tableGlow)" className="theme-fade glow-pulse" opacity={night ? 1 : 0} />

      {/* 每位的茶杯与名牌 */}
      {seats.map((s, i) => {
        const p = participants[i];
        if (!p) return null;
        const t = s.front ? 0.34 : 0.42;
        const mx = s.x + (cx - s.x) * t;
        const my = s.y + (cy - s.y) * (s.front ? 0.2 : 0.62) + (s.front ? 0 : 6);
        const active = speakerId === p.id;
        return (
          <g key={p.id} transform={`translate(${mx} ${my})`}>
            {showNameplates && (
              <g transform="translate(0 0)">
                <polygon points="-38,-14 38,-14 42,6 -42,6" fill={active ? p.color : night ? '#f3e7d6' : '#fffaf2'} className="theme-fill" />
                <polygon points="-42,6 42,6 40,10 -40,10" fill="#000" opacity={0.2} />
                <text
                  x={0}
                  y={1}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill={active ? '#fff' : '#3b2a20'}
                  style={{ fontFamily: 'inherit' }}
                >
                  {p.name}
                </text>
              </g>
            )}
            <g transform={`translate(${(s.x < cx ? 1 : -1) * (s.front ? 54 : -58)} -4)`}>
              <path d="M-9,-14 L9,-14 L8,4 L-8,4 Z" fill={p.color} />
              <ellipse cx={0} cy={-14} rx={9} ry={2.6} fill="#5a3418" />
              <path d="M9,-10 Q15,-8 9,-1" fill="none" stroke={p.color} strokeWidth={2.4} />
            </g>
          </g>
        );
      })}

      {/* 中心摆件：白天茶具 / 夜晚炭火盆 */}
      <g transform={`translate(${cx} ${cy - 6})`}>
        <g className="theme-fade" opacity={night ? 0 : 1}>
          <TeaSet />
        </g>
        <g className="theme-fade" opacity={night ? 1 : 0}>
          <Brazier />
        </g>
      </g>
    </svg>
  );
}
