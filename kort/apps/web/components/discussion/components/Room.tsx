import type { ThemeMode } from '../types';

const VP = { x: 800, y: 240 }; // 透视消失点
const FLOOR_Y = 500;

function Flames({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={0} cy={-4} rx={70} ry={30} fill="#ff9a3c" opacity={0.35} className="glow-pulse" />
      <path className="flame f1" d="M-40,0 C-48,-30 -30,-48 -26,-78 C-14,-52 -6,-44 -8,0 Z" fill="#f97316" />
      <path className="flame f2" d="M30,0 C40,-26 26,-50 30,-80 C12,-56 6,-40 8,0 Z" fill="#f97316" />
      <path className="flame f3" d="M-26,0 C-34,-40 -6,-64 0,-110 C8,-70 34,-42 26,0 Z" fill="#fb923c" />
      <path className="flame f4" d="M-16,0 C-20,-28 -2,-44 0,-74 C6,-46 20,-28 16,0 Z" fill="#fcd34d" />
      <path className="flame f5" d="M-8,0 C-10,-14 0,-24 0,-40 C4,-24 10,-14 8,0 Z" fill="#fff7d6" />
    </g>
  );
}

export function Room({ theme }: { theme: ThemeMode }) {
  const night = theme === 'night';
  // 地板线（向消失点汇聚）
  const boards = Array.from({ length: 23 }, (_, i) => -300 + i * 100);
  const rows = [530, 568, 616, 676, 750, 840];

  return (
    <svg viewBox="0 0 1600 900" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="wallDay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6efe6" />
          <stop offset="1" stopColor="#ebe0d1" />
        </linearGradient>
        <linearGradient id="wallNight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d1715" />
          <stop offset="1" stopColor="#33241d" />
        </linearGradient>
        <linearGradient id="floorDay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8b892" />
          <stop offset="1" stopColor="#c99d70" />
        </linearGradient>
        <linearGradient id="floorNight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2519" />
          <stop offset="1" stopColor="#24160f" />
        </linearGradient>
        <linearGradient id="skyDay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7cc4f2" />
          <stop offset="1" stopColor="#d6eefc" />
        </linearGradient>
        <linearGradient id="skyNight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1026" />
          <stop offset="1" stopColor="#24305a" />
        </linearGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8dc" stopOpacity={0.55} />
          <stop offset="1" stopColor="#fff8dc" stopOpacity={0} />
        </linearGradient>
        <radialGradient id="rugGrad" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#b4533a" />
          <stop offset="0.75" stopColor="#9c4330" />
          <stop offset="1" stopColor="#7d3424" />
        </radialGradient>
        <radialGradient id="hearthGlow" cx="0.5" cy="0.8" r="0.6">
          <stop offset="0" stopColor="#ff9b45" stopOpacity={0.6} />
          <stop offset="1" stopColor="#ff9b45" stopOpacity={0} />
        </radialGradient>
        <clipPath id="winClip">
          <rect x={1150} y={90} width={300} height={300} rx={6} />
        </clipPath>
      </defs>

      {/* 墙面 */}
      <rect width={1600} height={FLOOR_Y} fill="url(#wallDay)" />
      <rect width={1600} height={FLOOR_Y} fill="url(#wallNight)" className="theme-fade" opacity={night ? 1 : 0} />
      {/* 墙裙 */}
      <rect y={FLOOR_Y - 120} width={1600} height={120} fill={night ? '#2a1c16' : '#e2d3c0'} className="theme-fill" />
      <rect y={FLOOR_Y - 124} width={1600} height={6} fill={night ? '#4a3226' : '#cdb89f'} className="theme-fill" />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={20 + i * 100} y={FLOOR_Y - 100} width={80} height={80} rx={3} fill="none" stroke={night ? '#3c2a20' : '#d4c2ac'} strokeWidth={2} className="theme-stroke" />
      ))}
      <rect y={FLOOR_Y - 8} width={1600} height={8} fill={night ? '#1a100b' : '#b89a78'} className="theme-fill" />

      {/* 地板 */}
      <rect y={FLOOR_Y} width={1600} height={400} fill="url(#floorDay)" />
      <rect y={FLOOR_Y} width={1600} height={400} fill="url(#floorNight)" className="theme-fade" opacity={night ? 1 : 0} />
      <g stroke={night ? '#1c120c' : '#b88b5f'} strokeWidth={1.5} opacity={0.6} className="theme-stroke">
        {boards.map((bx) => {
          const t = (FLOOR_Y - VP.y) / (900 - VP.y);
          const topX = VP.x + (bx - VP.x) * t;
          return <line key={bx} x1={topX} y1={FLOOR_Y} x2={bx} y2={900} />;
        })}
        {rows.map((ry) => (
          <line key={ry} x1={0} y1={ry} x2={1600} y2={ry} opacity={0.4} />
        ))}
      </g>

      {/* 窗户 */}
      <g>
        <rect x={1138} y={78} width={324} height={324} rx={10} fill={night ? '#3d2a20' : '#fdfaf5'} className="theme-fill" />
        <g clipPath="url(#winClip)">
          <rect x={1150} y={90} width={300} height={300} fill="url(#skyDay)" />
          <g className="theme-fade" opacity={night ? 0 : 1}>
            <circle cx={1370} cy={150} r={30} fill="#fff4c2" />
            <circle cx={1370} cy={150} r={46} fill="#fff4c2" opacity={0.3} />
            <g className="cloud-drift">
              <ellipse cx={1210} cy={200} rx={40} ry={14} fill="#fff" />
              <ellipse cx={1235} cy={190} rx={26} ry={16} fill="#fff" />
              <ellipse cx={1330} cy={270} rx={46} ry={13} fill="#fff" opacity={0.9} />
              <ellipse cx={1350} cy={260} rx={24} ry={14} fill="#fff" opacity={0.9} />
            </g>
            <path d="M1150,390 L1150,330 Q1200,300 1250,325 Q1320,290 1380,320 Q1420,305 1450,318 L1450,390 Z" fill="#8cc58a" />
            <path d="M1150,390 L1150,355 Q1230,335 1300,352 Q1380,335 1450,350 L1450,390 Z" fill="#6aa86b" />
          </g>
          <g className="theme-fade" opacity={night ? 1 : 0}>
            <rect x={1150} y={90} width={300} height={300} fill="url(#skyNight)" />
            {Array.from({ length: 26 }, (_, i) => (
              <circle
                key={i}
                cx={1160 + ((i * 97) % 280)}
                cy={100 + ((i * 53) % 220)}
                r={i % 4 === 0 ? 1.8 : 1.1}
                fill="#fff"
                className="twinkle"
                style={{ animationDelay: `${(i % 7) * 0.5}s` }}
              />
            ))}
            <circle cx={1360} cy={160} r={26} fill="#fdf6d8" />
            <circle cx={1372} cy={152} r={24} fill="#24305a" opacity={0.95} />
            <circle cx={1360} cy={160} r={50} fill="#fdf6d8" opacity={0.08} />
            <path d="M1150,390 L1150,340 Q1220,315 1290,338 Q1370,312 1450,334 L1450,390 Z" fill="#141a33" />
          </g>
        </g>
        <rect x={1296} y={90} width={8} height={300} fill={night ? '#3d2a20' : '#fdfaf5'} className="theme-fill" />
        <rect x={1150} y={236} width={300} height={8} fill={night ? '#3d2a20' : '#fdfaf5'} className="theme-fill" />
        <rect x={1126} y={396} width={348} height={14} rx={3} fill={night ? '#4a3226' : '#efe4d4'} className="theme-fill" />
        {/* 窗帘 */}
        <path d="M1110,60 L1170,60 Q1160,240 1180,420 L1100,420 Q1112,240 1110,60 Z" fill={night ? '#5b1f1a' : '#e9a184'} className="theme-fill" />
        <path d="M1430,60 L1490,60 Q1488,240 1500,420 L1420,420 Q1440,240 1430,60 Z" fill={night ? '#5b1f1a' : '#e9a184'} className="theme-fill" />
        <rect x={1090} y={52} width={420} height={10} rx={5} fill={night ? '#2a1c16' : '#a07a5a'} className="theme-fill" />
      </g>

      {/* 白天阳光光柱 */}
      <g className="theme-fade" opacity={night ? 0 : 1}>
        <polygon points="1150,90 1450,90 1180,900 560,900" fill="url(#beam)" opacity={0.55} className="beam-shimmer" />
      </g>

      {/* 墙上挂画（KORT 骑士徽记，取自 app/icon.svg 的图形部分） */}
      <g transform="translate(800 170)">
        <rect x={-96} y={-76} width={192} height={152} rx={4} fill={night ? '#4a3226' : '#8a6a4f'} className="theme-fill" />
        <rect x={-84} y={-64} width={168} height={128} fill={night ? '#2b211c' : '#f4ead9'} className="theme-fill" />
        <g fill={night ? '#e8c39e' : '#3b2b22'} className="theme-fill" transform="scale(1.55) translate(-147.35 -36.42)">
          <path d="M121.097 65.4186C121.431 63.9186 122.597 60.9186 124.597 60.9186H164.597C165.931 61.752 168.497 63.8186 168.097 65.4186V71.4186H121.097V65.4186Z" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M124.597 24.4186C124.097 16.752 129.397 1.41865 154.597 1.41865L151.097 8.91865C151.097 8.91865 155.597 11.4186 157.597 10.9186C159.597 10.4186 160.597 17.4186 173.597 27.9186V32.4186L170.097 35.4186C170.097 35.4186 164.264 34.9186 165.597 35.9186C166.931 36.9186 162.097 32.4186 162.097 32.4186L154.097 32.9186L151.097 30.4186H149.597L147.597 32.9186V34.4186L164.597 57.9186H153.097L140.097 40.4186L135.597 45.9186V57.9186H124.597V24.4186ZM135.597 21.9186C139.997 11.1186 149.764 11.752 154.097 13.4186L135.597 32.9186V32.4186V21.9186Z"
          />
        </g>
      </g>

      {/* 壁炉 */}
      <g transform="translate(250 0)">
        <ellipse cx={0} cy={500} rx={260} ry={60} fill="url(#hearthGlow)" className="theme-fade glow-pulse" opacity={night ? 1 : 0} />
        <rect x={-150} y={250} width={300} height={250} fill={night ? '#5a3a2c' : '#c9a98b'} className="theme-fill" />
        {/* 砖纹 */}
        <g stroke={night ? '#3c2519' : '#b39276'} strokeWidth={2} className="theme-stroke">
          {[290, 330, 370, 410, 450].map((y) => (
            <line key={y} x1={-150} y1={y} x2={150} y2={y} />
          ))}
        </g>
        <rect x={-170} y={232} width={340} height={24} rx={3} fill={night ? '#3a251b' : '#8a6a4f'} className="theme-fill" />
        <path d="M-90,500 L-90,360 Q0,300 90,360 L90,500 Z" fill={night ? '#120b08' : '#3b2b22'} className="theme-fill" />
        {/* 柴火 */}
        <rect x={-60} y={478} width={120} height={14} rx={7} fill="#5b3a26" transform="rotate(-6 0 485)" />
        <rect x={-60} y={480} width={120} height={14} rx={7} fill="#6b4630" transform="rotate(8 0 487)" />
        <g className="theme-fade" opacity={night ? 1 : 0}>
          <Flames x={0} y={482} scale={0.8} />
        </g>
        {/* 壁炉台摆件 */}
        <rect x={-120} y={206} width={22} height={26} fill="#e9d8c0" />
        <rect x={-114} y={196} width={10} height={10} fill="#fcd34d" className="theme-fade" opacity={night ? 1 : 0.2} />
        <rect x={80} y={196} width={36} height={36} rx={4} fill="#6b8f6b" />
        <rect x={86} y={190} width={24} height={8} rx={3} fill="#4f7350" />
        <rect x={-40} y={200} width={18} height={32} fill="#b45309" />
        <rect x={-20} y={208} width={16} height={24} fill="#1e40af" />
        <rect x={-2} y={204} width={14} height={28} fill="#15803d" />
      </g>

      {/* 地毯 */}
      <ellipse cx={800} cy={660} rx={600} ry={190} fill="url(#rugGrad)" opacity={night ? 0.85 : 0.75} className="theme-opacity" />
      <ellipse cx={800} cy={660} rx={560} ry={170} fill="none" stroke="#e8c39e" strokeWidth={3} strokeDasharray="10 8" opacity={0.6} />
      <ellipse cx={800} cy={660} rx={500} ry={148} fill="none" stroke="#e8c39e" strokeWidth={1.5} opacity={0.35} />

      {/* 绿植 */}
      <g transform="translate(1500 560)">
        <path d="M-40,0 L40,0 L30,70 L-30,70 Z" fill={night ? '#5b3a2a' : '#c56b4a'} className="theme-fill" />
        <g fill={night ? '#264d32' : '#4f9a5c'} className="theme-fill sway">
          <ellipse cx={-30} cy={-50} rx={16} ry={46} transform="rotate(-30 -30 -50)" />
          <ellipse cx={30} cy={-55} rx={16} ry={46} transform="rotate(28 30 -55)" />
          <ellipse cx={0} cy={-80} rx={18} ry={60} />
          <ellipse cx={-14} cy={-30} rx={12} ry={30} transform="rotate(-55 -14 -30)" />
          <ellipse cx={16} cy={-30} rx={12} ry={30} transform="rotate(55 16 -30)" />
        </g>
      </g>
    </svg>
  );
}
