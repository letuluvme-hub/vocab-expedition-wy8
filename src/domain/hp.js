import { clamp } from './math.js';

export function hpBarGeom(hp, shield, maxhp) {
  const sh = Math.max(0, shield | 0);
  const cap = Math.max(1, (maxhp | 0) + sh);
  const total = Math.max(0, hp) + sh;
  const pct = clamp(total / cap * 100, 0, 100);
  const hpPct = clamp(Math.max(0, hp) / cap * 100, 0, 100);
  return { pct, cap, shield: sh, hpPct, shPct: clamp(pct - hpPct, 0, 100) };
}
