/* 怪种机制（不是数值分层）：按**怪名**解析，纯规则、无 DOM / 无存档 / 无全局。
 *
 * ★ 为什么身份只认 foe.n：
 *   run-snapshot.js 的 encodeBattle() 对 foe 只写 {n, ic, tint} 三个字段
 *   （b.base / b.trait 一律不落盘）。所以「按 id 认、按字段认」都会在
 *   刷新之后悄悄退化成中性怪 —— 玩家会发现同一个怪在刷新前后打法完全不同，
 *   却没有任何东西记录过这件事。按 n 索引则天然跨刷新成立，且**不需要**
 *   改那份版本化编解码（改存档结构的风险留给显式的迁移，而不是顺手夹带）。
 * ★ 未登记的怪一律没有机制（倍率恒为 1）：BOSS、测试桩、旧存档里的怪名
 *   都落在这条回路上。fail safe 的方向永远是「没有机制」，不是「猜一个机制」。
 * ★ hasOwnProperty 守卫：怪名是外部数据，'constructor'/'__proto__' 这类键
 *   绝不能从原型链上被当成一条机制。与 domain/foe-attack.js 同一口径。
 */
import { FOE_TRAITS } from '../data/balance.js';

/* 这只怪的机制配置；没有就返回 null（绝不返回半个对象）。 */
export function foeTraits(foe) {
  if (!foe || typeof foe.n !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(FOE_TRAITS, foe.n) ? FOE_TRAITS[foe.n] : null;
}

/* 两个倍率入口：damage.js 每算一次伤害都会问一次，所以认不出来的怪必须恒为 1。 */
export function foeLetterMult(foe) {
  const t = foeTraits(foe);
  return t ? t.letterMult : 1;
}

export function foeFinisherMult(foe) {
  const t = foeTraits(foe);
  return t ? t.finisherMult : 1;
}