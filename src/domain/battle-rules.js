/* 战斗的胜负规则（纯规则：不读 DOM / 存档 / 全局 G·B）。
 *
 * ★ 本模块存在的唯一理由：把「敌人什么时候算被打死」收成**一个**口径。
 *   旧实现里 enHp 只在 combat.js 的四个地方各自 `B.enHp -= x; if (B.enHp<=0) winFight()`，
 *   于是任何一点伤害（单字母、荆棘反弹）都能提前结束战斗 —— 玩家在
 *   「litre」只拼出 l 就赢了，而这个词既没学会、也没进本局退休。
 *
 * 现在的规则：
 *   1) 非完整词伤害（单字母、荆棘、道具直伤）只能削血，敌人血量永远
 *      钉在 MIN_ENEMY_HP(=1)：打不死，只能「逼玩家把当前词拼完」。
 *   2) 只有整词大招（pressKey 的 wordComplete 分支）带 allowFinish=true，
 *      才允许把 enHp 压到 <=0。
 *   3) winFight 的授权条件也集中在这里：整词拼完 + 敌人真的被打空 +
 *      本场还没结算过。半词 / 荆棘 / 重复调用全部被这道门挡住。
 *   4) 敌人已死（enHp<=0）或本场已结算（over/finished）之后到达的**迟到伤害**
 *      一律 no-op：不复活死人、不反向 dealt、不二次授权胜负。连点与动画回调
 *      都会走到这里，所以这不是防御性冗余，而是真实可达路径。
 *
 * applyDamage 同时返回**实际**扣掉的血：地板生效时反馈必须显示真实伤害，
 * 不能报一个超过敌人剩余血量的数字。
 */
import { wordComplete } from './learning.js';

// 非完整词伤害的地板：敌人永远留 1 血，逼玩家完成当前整词。
export const MIN_ENEMY_HP = 1;

/* no-op 的统一返回值：状态不动，dealt=0，不报致命。 */
const NO_DAMAGE = (before) => ({ before, after: before, dealt: 0, lethal: false });

/* 读血量，读不出就返回 null —— **绝不**用 `Number(x) || 0` 兜底：
 * `Number(null)`/`Number('')` 都是 0，而 0 在结算判据里等于「敌人已被打空」，
 * 于是「读不到血量」会被静默升级成「可以发胜利奖励」。脏值必须 fail closed。 */
function readHp(battle) {
  const raw = battle.enHp;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return isFinite(n) ? n : null;
  }
  return null;   // null / undefined / 布尔 / 对象 / 数组：都不是血量
}

/* 给敌人扣血。就地改 battle.enHp，返回 {before, after, dealt, lethal}。
 *
 * @param allowFinish true = 允许致命（只有整词大招传 true）
 */
export function applyDamage(battle, amount, { allowFinish = false } = {}) {
  if (!battle) return { before: 0, after: 0, dealt: 0, lethal: false };
  // 门 1：本场已结算（over = 胜负已定，finished = 节点奖励已领）。连点、迟到回调、
  //   重入伤害都走这里，直接 no-op —— 结算之后不再有任何血量或胜负变化。
  if (battle.over || battle.finished) return NO_DAMAGE(Number(battle.enHp) || 0);
  // 门 2：血量必须是非负有限数。脏值（NaN / undefined / null / 布尔）一律 no-op，
  //   不得被默认值悄悄改写成 0 —— 而 0 在结算判据里就是「已打空」。
  const hp = readHp(battle);
  if (hp === null) return NO_DAMAGE(0);
  // 门 3：敌人已经死了（含恰好 0）。负血是大招过量击打打出来的真实状态，
  //   不能被下一次伤害抬回 1 血地板 —— 那等于把已结算的战斗重新拉回进行中。
  if (hp <= 0) return NO_DAMAGE(hp);

  const raw = Number(amount);
  const dmg = (isFinite(raw) && raw > 0) ? raw : 0;
  const before = hp;
  let after = before - dmg;
  // 地板夹到 min(before, 1) 而不是固定 1：before 已经是 0.5 这种小数时不能被抬到 1。
  if (!allowFinish && after < MIN_ENEMY_HP) after = Math.min(before, MIN_ENEMY_HP);
  battle.enHp = after;
  return { before, after, dealt: before - after, lethal: after <= 0 };
}

// winFight 的唯一授权条件。四者缺一不可：
//   整词拼完（半词不算）、敌人真的被打空、且本场还没结算过（over / finished）。
// ★ fail closed：血量非法（NaN / undefined / 脏字符串）一律拒绝，
//   绝不用 `|| 0` 把「读不到血量」解释成「敌人已被打空」。
export function canFinishFight(battle) {
  if (!battle || battle.over || battle.finished) return false;
  if (!wordComplete(battle)) return false;
  const hp = readHp(battle);
  if (hp === null) return false;
  return hp <= 0;
}
// 逃跑花当前金币的一半（向上取整），最低 50；余额不足不能支付。
export function fleeGoldCost(gold) {
  return Math.max(50, Math.ceil(Math.max(0, Number(gold) || 0) / 2));
}
