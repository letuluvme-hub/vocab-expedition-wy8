import { growthAttackPct } from './mastery-growth.js';
import { clamp } from './math.js';
import { WORD_DMG_CAP, WORD_DMG_CAP_ANCHOR_BASE } from '../data/balance.js';
import { foeLetterMult, foeFinisherMult } from './foe-traits.js';
import { heroFinisherMultiplier } from './hero-rules.js';
import { ITEM_BALANCE } from '../data/hero-balance.js';

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
  let d = Math.round(base * mult * (1 + (Number(battle.dmgBonus) + growthAttackPct(run)) / 100));
  if (battle.rageLeft > 0) d = Math.round(d * ITEM_BALANCE.rageMultiplier);
  if (battle.freezeWord) d = Math.round(d * 0.5);
  // 怪种机制（石化词素等）：按 foe.n 解析，没有机制 / 认不出来时恒为 1，
  // 所以对没有 foe 字段的老战斗对象逐字不变。
  d = Math.round(d * foeLetterMult(battle.foe));
  // ★ 地板不跟着机制缩：折扣只砍「打掉多少」，永远不把这下伤害打成 0，
  //   否则「半词打死」那条底线之外的路径也会被机制摸到。
  return clamp(d, Math.max(1, Math.round(base * 0.5)), 140);
}

export function wordDmg(run, battle) {
  const base = baseDamage(run.floor);
  const mult = 1 + battle.combo * comboRate(run) * WORD_COMBO_BOOST;
  let d = Math.round(base * WORD_RATIO * mult * finTier(battle) * (1 + (Number(battle.dmgBonus) + growthAttackPct(run)) / 100));
  if (battle.rageLeft > 0) d = Math.round(d * ITEM_BALANCE.rageMultiplier);
  if (battle.freezeWord) d = Math.round(d * 0.5);
  d = Math.round(d * foeFinisherMult(battle.foe));
  d = Math.round(d * heroFinisherMultiplier(run, battle));
  const lo = Math.max(Math.round(base * WORD_RATIO * 0.5), 1);
  // 双重夹逼：夹上限（随深度增长，见 wordDmgCap），再对 hitDmg() 取硬下限倍率 ——
  // 任何参数组合下倍率都落在 [3.2, ~4.3]，同时不再有深度相关的天花板。
  // ★ 怪种机制倍率在夹紧**之前**生效：怪种只是把同一发大招打得更重，绝不越过上限
  //   曲线。这条约束当初需要一个**深度无关**的常数 560 才敢写（那时上限不随深度长，
  //   机制加成会在深层被削掉一大截）；现在上限按 base 等比增长，同一条约束自动成立
  //   而且更严 —— 怪种的 ×1.5 在深层拿得到完整收益，同时「连击 + 增伤 + 怒火叠满
  //   不数值爆炸」这个兜底一条没松：下面 clamp 的 max 仍是 wordDmgCap(base)。
  // ★ 下限那一路（hitDmg × WORD_MIN_RATIO）不可能反超上限：hitDmg 至多
  //   max(140, base×0.5)，×3.2 至多 max(448, 1.6×base)，而上限至少是 max(560, 43.08×base)。
  //   所以 Math.max 的两个分支都在上限之内，「机制不得越过夹紧」对两条路都成立。
  return Math.max(clamp(d, lo, wordDmgCap(base)), Math.round(hitDmg(run, battle) * WORD_MIN_RATIO));
}
