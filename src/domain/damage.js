import { clamp } from './math.js';

export const WORD_RATIO = 4;
export const WORD_COMBO_BOOST = 1.8;
export const WORD_MIN_RATIO = 3.2;
export const WORD_DMG_CAP = 560;
export const FIN_TIER_MAX = 4, FIN_TIER_STEP = 0.12;

export const comboRate = run => (run.relics.includes('combo') ? 0.2 : 0.1) * (run.hcombo || 1);

export function finTier(battle) {
  const s = Math.max(0, Math.min(FIN_TIER_MAX, (battle.wordStreak | 0) - 1));
  return 1 + s * FIN_TIER_STEP;
}

export function hitDmg(run, battle) {
  const base = 7 + Math.floor(run.floor * 0.7);
  const mult = 1 + battle.combo * comboRate(run);
  let d = Math.round(base * mult * (1 + battle.dmgBonus / 100));
  if (battle.rageLeft > 0) d = Math.round(d * 2.5);
  if (battle.freezeWord) d = Math.round(d * 0.5);
  return clamp(d, Math.max(1, Math.round(base * 0.5)), 140);
}

export function wordDmg(run, battle) {
  const base = 7 + Math.floor(run.floor * 0.7);
  const mult = 1 + battle.combo * comboRate(run) * WORD_COMBO_BOOST;
  let d = Math.round(base * WORD_RATIO * mult * finTier(battle) * (1 + battle.dmgBonus / 100));
  if (battle.rageLeft > 0) d = Math.round(d * 2.5);
  if (battle.freezeWord) d = Math.round(d * 0.5);
  const lo = Math.max(Math.round(base * WORD_RATIO * 0.5), 1);
  return Math.max(clamp(d, lo, WORD_DMG_CAP), Math.round(hitDmg(run, battle) * WORD_MIN_RATIO));
}
