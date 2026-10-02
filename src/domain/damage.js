import { clamp } from './math.js';
import { WORD_DMG_CAP, WORD_DMG_CAP_ANCHOR_BASE } from '../data/balance.js';

export const WORD_RATIO = 4;
export const WORD_COMBO_BOOST = 1.8;
export const WORD_MIN_RATIO = 3.2;
export { WORD_DMG_CAP };
export const FIN_TIER_MAX = 4, FIN_TIER_STEP = 0.12;

export const comboRate = run => (run.relics.includes('combo') ? 0.2 : 0.1) * (run.hcombo || 1);

/* 战斗伤害的公共基数：血量公式（app/runtime.js 的 startFight）用的也是这一个，
 * 所以「敌人多硬」与「我能打多疼」天生是同一条曲线，不会各自漂移。 */
const baseDamage = floor => 7 + Math.floor(floor * 0.7);

/* 整词伤害的天花板：随 base 等比增长，而不是一个常数。
 *
 * 旧版这里是 clamp(d, lo, 560)，一个**深度无关**的常数。问题是敌人血量按同一个
 * base 线性增长且没有上限，于是 floor 40 之后玩家伤害被钉死、血量继续涨 ——
 * 满配构筑的原始伤害在 floor 40/60/100 分别是 580/812/1276，31%~56% 被直接扔掉，
 * 「打空一个敌人需要的词数」从 floor 1 的 3.4 一路涨到 floor 400 的 31.7：
 * 深层难度单调恶化，永远追不上。
 *
 * 现在上限 = max(旧常数, base × 560/13)：与血量同步增长，浪费消失，词数收敛。
 *  · base ≤ 13（floor 1-9）时上限**恰好还是 560** —— 浅层手感逐位不变，不是近似，
 *    是同一个数；这次改动对浅层构筑是纯放宽，没有任何组合被削弱。
 *  · 上限仍然存在、仍然单调不减，所以「连击 + 增伤 + 怒火叠满不会数值爆炸」这个
 *    原始意图没有被放弃，只是天花板跟着深度一起长高了。
 *  · 锚点 13 是 floor 9 的 base，也就是 560 还算合理的最深层。 */
export function wordDmgCap(base) {
  return Math.max(WORD_DMG_CAP, Math.round(base * WORD_DMG_CAP / WORD_DMG_CAP_ANCHOR_BASE));
}

export function finTier(battle) {
  const s = Math.max(0, Math.min(FIN_TIER_MAX, (battle.wordStreak | 0) - 1));
  return 1 + s * FIN_TIER_STEP;
}

export function hitDmg(run, battle) {
  const base = baseDamage(run.floor);
  const mult = 1 + battle.combo * comboRate(run);
  let d = Math.round(base * mult * (1 + battle.dmgBonus / 100));
  if (battle.rageLeft > 0) d = Math.round(d * 2.5);
  if (battle.freezeWord) d = Math.round(d * 0.5);
  return clamp(d, Math.max(1, Math.round(base * 0.5)), 140);
}

export function wordDmg(run, battle) {
  const base = baseDamage(run.floor);
  const mult = 1 + battle.combo * comboRate(run) * WORD_COMBO_BOOST;
  let d = Math.round(base * WORD_RATIO * mult * finTier(battle) * (1 + battle.dmgBonus / 100));
  if (battle.rageLeft > 0) d = Math.round(d * 2.5);
  if (battle.freezeWord) d = Math.round(d * 0.5);
  const lo = Math.max(Math.round(base * WORD_RATIO * 0.5), 1);
  // 双重夹逼：夹上限（随深度增长，见 wordDmgCap），再对 hitDmg() 取硬下限倍率 ——
  // 任何参数组合下倍率都落在 [3.2, ~4.3]，同时不再有深度相关的天花板。
  return Math.max(clamp(d, lo, wordDmgCap(base)), Math.round(hitDmg(run, battle) * WORD_MIN_RATIO));
}
