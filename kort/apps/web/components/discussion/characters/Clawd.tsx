import type { CSSProperties, ReactNode } from 'react';
import type { CharacterRenderProps } from '../types';
import { shade } from './color';
import { registerCharacter } from './registry';

/**
 * Clawd —— Anthropic Claude Code 的像素吉祥物
 * 网格坐标系：viewBox 0 0 20 17
 *  身体  x 3..17, y 6..14
 *  手臂  x 1..3 / 17..19, y 9..11
 *  腿    y 14..16
 */

const INK = '#1c1917';

function Accessory({ id, facing, color }: { id: string; facing: string; color: string }): ReactNode {
  const dx = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
  switch (id) {
    case 'tophat':
      return (
        <g className="clawd-acc-hat">
          <rect x={6} y={1} width={8} height={4.6} fill="#27272a" />
          <rect x={6} y={1} width={8} height={0.6} fill="#3f3f46" />
          <rect x={6} y={3.8} width={8} height={1} fill="#b91c1c" />
          <rect x={4.5} y={5.4} width={11} height={0.9} fill="#18181b" />
        </g>
      );
    case 'beret':
      return (
        <g className="clawd-acc-hat">
          <rect x={4.5} y={4.6} width={10.5} height={1.6} fill="#1e3a5f" />
          <rect x={5.5} y={3.8} width={8} height={1} fill="#1e3a5f" />
          <rect x={6.5} y={3.8} width={6} height={0.5} fill="#2b4f7e" />
          <rect x={9.5} y={3} width={1} height={0.9} fill="#1e3a5f" />
        </g>
      );
    case 'gradcap':
      return (
        <g className="clawd-acc-hat">
          <rect x={6.5} y={4.4} width={7} height={1.8} fill="#18181b" />
          <polygon points="2.5,3.6 10,1.6 17.5,3.6 10,5.4" fill="#27272a" />
          <polygon points="2.5,3.6 10,1.6 17.5,3.6 10,3.2" fill="#3f3f46" />
          <rect x={9.6} y={3.2} width={0.8} height={0.6} fill="#facc15" />
          <rect x={15.6} y={3.6} width={0.5} height={3.4} fill="#facc15" className="clawd-tassel" />
          <rect x={15.3} y={6.8} width={1.1} height={1} fill="#facc15" className="clawd-tassel" />
        </g>
      );
    case 'cap':
      return (
        <g className="clawd-acc-hat">
          <rect x={5} y={3.8} width={10} height={2.4} fill="#16a34a" />
          <rect x={5} y={3.8} width={10} height={0.6} fill="#22c55e" />
          <rect x={dx >= 0 ? 14 : 1.5} y={5.4} width={4.5} height={0.9} fill="#15803d" />
          <rect x={9.5} y={3.3} width={1} height={0.6} fill="#15803d" />
        </g>
      );
    case 'crown':
      return (
        <g className="clawd-acc-hat">
          <polygon
            points="6,6 6,3 7.6,4.4 8.8,2.4 10,4.2 11.2,2.4 12.4,4.4 14,3 14,6"
            fill="#facc15"
          />
          <rect x={6} y={5} width={8} height={1} fill="#eab308" />
          <rect x={9.6} y={4.8} width={0.8} height={0.8} fill="#ef4444" />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <rect x={4} y={3.6} width={12} height={0.9} fill="#27272a" />
          <rect x={3.2} y={4.2} width={0.9} height={3} fill="#27272a" />
          <rect x={15.9} y={4.2} width={0.9} height={3} fill="#27272a" />
          <rect x={2} y={6.8} width={2.2} height={3.4} fill="#3f3f46" />
          <rect x={15.8} y={6.8} width={2.2} height={3.4} fill="#3f3f46" />
          <rect x={2} y={6.8} width={2.2} height={0.6} fill="#a78bfa" />
          <rect x={15.8} y={6.8} width={2.2} height={0.6} fill="#a78bfa" />
        </g>
      );
    case 'glasses': {
      const l = 5 + dx;
      const r = 12 + dx;
      return (
        <g>
          <rect x={l} y={7.6} width={3} height={2.8} fill="rgba(186,230,253,0.25)" stroke={INK} strokeWidth={0.45} />
          <rect x={r} y={7.6} width={3} height={2.8} fill="rgba(186,230,253,0.25)" stroke={INK} strokeWidth={0.45} />
          <rect x={l + 3} y={8.4} width={r - l - 3} height={0.45} fill={INK} />
          <rect x={l + 0.4} y={7.9} width={0.6} height={0.5} fill="rgba(255,255,255,0.7)" />
          <rect x={r + 0.4} y={7.9} width={0.6} height={0.5} fill="rgba(255,255,255,0.7)" />
        </g>
      );
    }
    case 'monocle': {
      const r = 12 + dx;
      return (
        <g>
          <circle cx={r + 1.5} cy={9} r={1.7} fill="rgba(186,230,253,0.25)" stroke="#ca8a04" strokeWidth={0.4} />
          <rect x={r + 3} y={9} width={0.3} height={4} fill="#ca8a04" />
        </g>
      );
    }
    case 'bowtie':
      return (
        <g>
          <polygon points="8,11.6 10,12.6 8,13.6" fill="#dc2626" />
          <polygon points="12,11.6 10,12.6 12,13.6" fill="#dc2626" />
          <rect x={9.5} y={12.1} width={1} height={1} fill="#991b1b" />
        </g>
      );
    case 'scarf':
      return (
        <g>
          <rect x={3} y={11.4} width={14} height={1.4} fill="#f5f5f4" />
          <rect x={3} y={11.4} width={14} height={0.4} fill="#e7e5e4" />
          <rect x={5} y={11.4} width={1} height={1.4} fill="#ef4444" />
          <rect x={9} y={11.4} width={1} height={1.4} fill="#ef4444" />
          <rect x={13} y={11.4} width={1} height={1.4} fill="#ef4444" />
          <rect x={dx >= 0 ? 13.5 : 5} y={12.8} width={1.6} height={2.4} fill="#f5f5f4" className="clawd-scarf-tail" />
          <rect x={dx >= 0 ? 13.5 : 5} y={14.6} width={1.6} height={0.5} fill="#ef4444" className="clawd-scarf-tail" />
        </g>
      );
    case 'flower':
      return (
        <g className="clawd-acc-hat">
          <rect x={12.6} y={4.2} width={0.5} height={1.9} fill="#16a34a" />
          <rect x={12} y={2.8} width={1.7} height={1.7} fill="#f9a8d4" />
          <rect x={11.4} y={3.4} width={2.9} height={0.5} fill="#f9a8d4" />
          <rect x={12.6} y={2.2} width={0.5} height={2.9} fill="#f9a8d4" />
          <rect x={12.55} y={3.35} width={0.6} height={0.6} fill="#facc15" />
        </g>
      );
    case 'blush':
      return (
        <g opacity={0.55}>
          <rect x={4 + dx} y={10.6} width={1.6} height={0.7} fill={shade(color, 0.45)} />
          <rect x={14.4 + dx} y={10.6} width={1.6} height={0.7} fill={shade(color, 0.45)} />
        </g>
      );
    default:
      return null;
  }
}

export function Clawd({ state, facing, color, accessories = [], theme, seed, size }: CharacterRenderProps) {
  const dx = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
  const light = shade(color, 0.18);
  const dark = shade(color, -0.22);
  const darker = shade(color, -0.38);
  const eyeY = state === 'thinking' ? 7.6 : 8;
  const delay = (seed * 4).toFixed(2);
  const style = { '--d': `${delay}s`, '--d2': `${(seed * 1.3).toFixed(2)}s` } as CSSProperties;
  const gradId = `glow-${Math.round(seed * 1e6)}`;

  return (
    <svg
      viewBox="0 0 20 17"
      width={size}
      height={size * 0.85}
      shapeRendering="crispEdges"
      className={`clawd clawd--${state}`}
      style={{ ...style, overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffb347" stopOpacity={0.55} />
          <stop offset="0.6" stopColor="#ff8a3d" stopOpacity={0.08} />
          <stop offset="1" stopColor="#ff8a3d" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* 腿 —— 坐着时会轻轻晃动 */}
      <g className="clawd-legs">
        <rect className="clawd-leg l1" x={4} y={13.6} width={1} height={2.6} fill={dark} />
        <rect className="clawd-leg l2" x={6} y={13.6} width={1} height={2.6} fill={dark} />
        <rect className="clawd-leg l3" x={13} y={13.6} width={1} height={2.6} fill={dark} />
        <rect className="clawd-leg l4" x={15} y={13.6} width={1} height={2.6} fill={dark} />
      </g>
      <g className="clawd-body">
        {/* 手臂 */}
        <rect className="clawd-arm arm-l" x={1} y={9} width={2.2} height={2} fill={color} />
        <rect className="clawd-arm arm-r" x={16.8} y={9} width={2.2} height={2} fill={color} />
        {/* 身体 */}
        <rect x={3} y={6} width={14} height={8} fill={color} />
        <rect x={3} y={6} width={14} height={0.8} fill={light} />
        <rect x={3} y={13.2} width={14} height={0.8} fill={dark} />
        <rect x={dx < 0 ? 16.2 : 3} y={6} width={0.8} height={8} fill={dark} opacity={0.55} />
        {theme === 'night' && <rect x={3} y={6} width={14} height={8} fill={`url(#${gradId})`} />}
        {/* 眼睛 */}
        <g className="clawd-eyes">
          <rect x={6 + dx} y={eyeY} width={1} height={2} fill={INK} />
          <rect x={13 + dx} y={eyeY} width={1} height={2} fill={INK} />
        </g>
        {state === 'reacting' && (
          <g>
            <rect x={5.4 + dx} y={7} width={2.2} height={0.4} fill={darker} />
            <rect x={12.4 + dx} y={7} width={2.2} height={0.4} fill={darker} />
          </g>
        )}
        {accessories.map((a) => (
          <Accessory key={a} id={a} facing={facing} color={color} />
        ))}
      </g>
    </svg>
  );
}

export const CLAWD_ACCESSORIES = [
  { id: 'tophat', label: '礼帽' },
  { id: 'beret', label: '贝雷帽' },
  { id: 'gradcap', label: '学士帽' },
  { id: 'cap', label: '棒球帽' },
  { id: 'crown', label: '王冠' },
  { id: 'headphones', label: '耳机' },
  { id: 'glasses', label: '眼镜' },
  { id: 'monocle', label: '单片镜' },
  { id: 'bowtie', label: '领结' },
  { id: 'scarf', label: '围巾' },
  { id: 'flower', label: '小花' },
  { id: 'blush', label: '腮红' },
];

registerCharacter({
  kind: 'clawd',
  displayName: 'Clawd',
  renderer: Clawd,
  aspect: 0.85,
  accessories: CLAWD_ACCESSORIES,
});
