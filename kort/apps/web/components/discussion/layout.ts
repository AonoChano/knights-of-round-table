import type { Facing } from './types';

export const STAGE_W = 1600;
export const STAGE_H = 900;
export const TABLE = { cx: 800, cy: 640, rx: 370, ry: 108, thick: 34 };
const SEAT_RING = { rx: 490, ry: 128 };

export interface SeatLayout {
  index: number;
  x: number;
  y: number;
  scale: number;
  baseFacing: Facing;
  /** 是否在桌子前方（层级） */
  front: boolean;
}

/** 根据人数计算座位：沿桌子后半圈排布，前方留空，形成横向舞台透视 */
export function computeSeats(n: number): SeatLayout[] {
  const start = 188;
  const end = -8;
  return Array.from({ length: n }, (_, i) => {
    const deg = n === 1 ? 90 : start - (i * (start - end)) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    const x = TABLE.cx + SEAT_RING.rx * Math.cos(rad);
    const y = TABLE.cy - SEAT_RING.ry * Math.sin(rad);
    const scale = 0.86 + ((y - 510) / 150) * 0.26;
    const baseFacing: Facing = x < TABLE.cx - 200 ? 'right' : x > TABLE.cx + 200 ? 'left' : 'front';
    return { index: i, x, y, scale, baseFacing, front: y > TABLE.cy - 80 };
  });
}
