import { shade } from '../characters/color';
import type { ThemeMode } from '../types';

interface Props {
  style: 'armchair' | 'wooden' | 'stool';
  color: string;
  theme: ThemeMode;
  /** 让侧面座椅稍作偏移，营造转向感 */
  tilt: number;
}

/** 椅子：本地坐标原点 = 坐面中心顶部 */
export function Chair({ style, color, theme, tilt }: Props) {
  const night = theme === 'night';
  const c = night ? shade(color, -0.25) : color;
  const light = shade(c, 0.18);
  const dark = shade(c, -0.3);
  const wood = night ? '#3a2112' : '#6b4026';
  const woodDark = night ? '#24140a' : '#4a2a17';
  const bx = -tilt * 14;

  return (
    <svg viewBox="-110 -180 220 250" width={220} height={250} className="absolute" style={{ left: -110, top: -180, overflow: 'visible' }}>
      {/* 地面投影 */}
      <ellipse cx={0} cy={58} rx={88} ry={14} fill="#000" opacity={night ? 0.4 : 0.15} />
      {style === 'armchair' && (
        <g>
          {/* 椅腿 */}
          <rect x={-74} y={18} width={9} height={40} fill={woodDark} />
          <rect x={65} y={18} width={9} height={40} fill={woodDark} />
          {/* 靠背 */}
          <path d={`M${-78 + bx},-4 L${-78 + bx},-120 Q${-78 + bx},-158 ${-40 + bx},-160 L${40 + bx},-160 Q${78 + bx},-158 ${78 + bx},-120 L${78 + bx},-4 Z`} fill={c} />
          <path d={`M${-66 + bx},-10 L${-66 + bx},-118 Q${-66 + bx},-146 ${-36 + bx},-148 L${36 + bx},-148 Q${66 + bx},-146 ${66 + bx},-118 L${66 + bx},-10 Z`} fill={light} opacity={0.5} />
          {[-34, 0, 34].map((x) =>
            [-120, -80, -40].map((y) => <circle key={`${x}${y}`} cx={x + bx} cy={y} r={3} fill={dark} />),
          )}
          {/* 坐垫 */}
          <rect x={-80} y={-8} width={160} height={28} rx={10} fill={dark} />
          <rect x={-80} y={-12} width={160} height={20} rx={10} fill={c} />
          {/* 扶手 */}
          <rect x={-100} y={-58} width={30} height={78} rx={12} fill={dark} />
          <rect x={-100} y={-62} width={30} height={22} rx={11} fill={light} />
          <rect x={70} y={-58} width={30} height={78} rx={12} fill={dark} />
          <rect x={70} y={-62} width={30} height={22} rx={11} fill={light} />
        </g>
      )}
      {style === 'wooden' && (
        <g>
          <rect x={-70} y={10} width={8} height={48} fill={woodDark} />
          <rect x={62} y={10} width={8} height={48} fill={woodDark} />
          <rect x={-66 + bx} y={-150} width={10} height={150} rx={3} fill={wood} />
          <rect x={56 + bx} y={-150} width={10} height={150} rx={3} fill={wood} />
          <rect x={-70 + bx} y={-156} width={140} height={18} rx={6} fill={shade(wood, 0.15)} />
          {[-36, -12, 12, 36].map((x) => (
            <rect key={x} x={x - 4 + bx} y={-138} width={8} height={130} fill={wood} opacity={0.9} />
          ))}
          <rect x={-76} y={-10} width={152} height={22} rx={5} fill={shade(wood, 0.12)} />
          <rect x={-76} y={8} width={152} height={6} fill={woodDark} />
          <rect x={-60} y={-14} width={120} height={10} rx={5} fill={c} opacity={0.85} />
        </g>
      )}
      {style === 'stool' && (
        <g>
          <rect x={-56} y={10} width={8} height={48} fill={woodDark} transform="rotate(8 -52 10)" />
          <rect x={48} y={10} width={8} height={48} fill={woodDark} transform="rotate(-8 52 10)" />
          <rect x={-40 + bx} y={-90} width={8} height={90} fill={wood} />
          <rect x={32 + bx} y={-90} width={8} height={90} fill={wood} />
          <rect x={-56 + bx} y={-100} width={112} height={26} rx={12} fill={c} />
          <rect x={-56 + bx} y={-100} width={112} height={8} rx={4} fill={light} />
          <ellipse cx={0} cy={6} rx={72} ry={14} fill={woodDark} />
          <ellipse cx={0} cy={0} rx={72} ry={14} fill={c} />
          <ellipse cx={0} cy={-3} rx={60} ry={9} fill={light} opacity={0.6} />
        </g>
      )}
    </svg>
  );
}
