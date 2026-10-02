/* 敌人的血量：纯规则，显式传参，无 DOM / 无存档 / 无全局 G·B。
 *
 * 这段公式原本内联在 app/runtime.js 的 startFight() 里，与「玩家每词的伤害」
 * （domain/damage.js 的 hitDmg / wordDmg）共用同一个 base = 7 + floor(floor × 0.7)：
 * 敌人血量按「几词能打死」反推出来的，难度差由 targetWords 承担。
 * 搬进 domain 只是为了让它**可测**（tests/unit/foe-identity.test.js），
 * 公式本身逐字未动 —— 没有 base 时返回值与旧版完全相同。
 *
 * 本次唯一的规则变化：怪种倍率 hpMult（src/data/enemies.js 的 base）。
 *   ★ 精英与首领不吃这个倍率（恒为 1）：它们各有自己的难度口径
 *     （精英 targetWords 4、首领 5 词且 +40），叠上怪种倍率会让
 *     「一只 base 6 的精英比首领还硬」在深层成立 —— 那不是分层，是倒挂。
 *   ★ 倍率锚在 8 种怪 base 的**均值**上，所以 8 选 1 的期望血量与旧版逐点相同：
 *     这次改动移动的是方差，不是难度曲线（分寸见 data/balance.js 的说明）。
 */
import { FOE_HP_SCALE, FOE_BOSS_HP_BONUS } from '../data/balance.js';
import { WORD_RATIO, WORD_COMBO_BOOST } from './damage.js';

/* 怪种血量倍率：base 越高越硬。夹紧到 [min, max]，
 * 认不出来的 base（undefined / NaN / 字符串 …）一律回到 1 —— 中性永远安全。 */
export function foeHpMult(base) {
  if (typeof base !== 'number' || !Number.isFinite(base)) return 1;
  const m = 1 + (base - FOE_HP_SCALE.mean) * FOE_HP_SCALE.per;
  return Math.min(FOE_HP_SCALE.max, Math.max(FOE_HP_SCALE.min, m));
}

/* 一场战斗的敌人血量。
 *
 * @param floor     当前楼层（战斗用的那次 floor）
 * @param boss      首领战：按第 9 层算血，难度差由 targetWords 5 承担，
 *                  外加固定 +FOE_BOSS_HP_BONUS（旧版是 runtime 里的字面量 40）
 * @param elite     精英战：不叠加怪种倍率
 * @param comboRate comboRate() 的当前值（连击遗物 / 英雄加成会抬整词大招）
 * @param base      怪种档位；缺失 / 脏值 = 中性
 */
export function foeHpMax({ floor, boss = false, elite = false, comboRate, base } = {}) {
  const hpFloor = boss ? 9 : floor;
  const b = 7 + Math.floor(hpFloor * 0.7);
  const finMult = 1 + 1.45 * comboRate * WORD_COMBO_BOOST;
  // 每词伤害 ≈ 字母小伤害之和 + 整词大招那一击（avgLen=6、连击均值 1.45）
  const perWord = Math.round(6 * b * 1.45 + b * WORD_RATIO * finMult + hpFloor * 1.5);
  const targetWords = boss ? 5 : 4;      // 精英与普通怪同样按 4 词（旧版就是这个口径）
  const hpMult = (boss || elite) ? 1 : foeHpMult(base);
  const hpMax = Math.round(perWord * targetWords * hpMult) + (boss ? FOE_BOSS_HP_BONUS : 0);
  return { perWord, targetWords, hpMult, hpMax };
}