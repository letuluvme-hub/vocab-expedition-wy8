/* 「战意·连击里程碑」的**纯规则**（docs/feature-combo-milestones.md）。
 *
 * 与 domain/mastery-growth.js 是两条**并存**的成长线，互不替代：
 *   知识成长（mastery-growth）—— 跨轮次、持久，答对真实教材词换下轮生命上限；
 *   战意（本模块）            —— 本轮内、看拼写技巧，答对字母的连击换当轮资源。
 * 一个是「你学了多少」，一个是「你打得多准」。本模块不碰 mastered、不碰存档。
 *
 * 契约：
 *  1) **阶梯来自数据层**（data/combo-milestones.js 是唯一来源），这里只做校验与读表。
 *     门槛必须严格递增且为正整数：漂移或倒序会让「一阶奖励发两次 / 永远发不出去」。
 *  2) **向上跨越**而不是「恰好等于」：闪电道具一次 +3 连击可以从 8 跳到 11，
 *     判据是 `combo >= 门槛`（配合「一轮一次」的 fired 表），不是 `combo === 门槛`。
 *  3) **纯函数**：不改入参、不改 fired、不改 battle / run。发放由接线层
 *     （app/combat.js）按返回值做加法，本模块只回答「该发什么、实际到账多少」。
 *  4) **到账量夹在既有字段的合法区间内**：护盾不超过生命上限、回复不超过生命上限。
 *     返回的是**增量**，所以接线层直接 `+=` 就一定不会写出越界值。
 *  5) **脏入参 fail closed**：combo 是负数 / 字符串 / NaN 时按 0 处理；
 *     fired 缺失或形状不对时按「本轮一个都没发过」处理，绝不抛错、绝不产生 NaN。
 *     （存档与测试台都是外部输入；这里最怕的是 NaN 渗进生命/护盾。）
 */

import { COMBO_MILESTONES, MILESTONE_EFFECT } from '../data/combo-milestones.js';

export { COMBO_MILESTONES, MILESTONE_EFFECT };

/* 已登记的阶梯：门槛为正整数、严格递增。形状不合法的那条之后全部丢弃 ——
   「半张表」也比「倒序的表」安全：倒序会让同一个奖励被发两次。 */
const LADDER = (() => {
  const out = [];
  let prev = 0;
  for (const m of COMBO_MILESTONES) {
    if (!m || !Number.isInteger(m.combo) || m.combo <= prev) break;
    if (typeof m.id !== 'string' || !m.id) break;
    prev = m.combo;
    out.push(m);
  }
  return out;
})();

/* 连击读数：**只接受数字**。字符串 '6' / 布尔 / 对象一律按 0。
   ★ 刻意不做 Number(x) 归一：战斗状态是外部输入，而 `'6'` 是脏的而不是 6
     （同 domain/battle-rules.js 的 readHp 口径：读不到就当读不到，绝不猜）。
   小数向下取整 —— 5.9 连击不该被当成 6。 */
function readCombo(combo) {
  if (typeof combo !== 'number' || !Number.isFinite(combo) || combo <= 0) return 0;
  return Math.floor(combo);
}

/* fired（run.milestones）读数：只认普通对象；数组 / 字符串 / 数字 / Set 一律按空表 ——
   宁可「当没发过、这次补发一次」（有上限，一次性），也不要因为形状不对
   就把后面所有阶梯永久吞掉。 */
function firedSet(fired) {
  return (fired && typeof fired === 'object' && !Array.isArray(fired)) ? fired : {};
}
function isFired(fired, id) { return fired[id] === true; }

/* 三类资源各自的上限（= 生命上限）。与道具「石之护盾」同一口径：
   护盾 never 超过生命上限，所以这一轮不可能滚出无穷厚的盾。 */
function maxOf(state) {
  const n = state && Number(state.maxhp);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* 达到 combo 时**新**达成的里程碑（按门槛升序）。
   ★ 只读 fired，不写：发放与记账是接线层的责任。
     返回空数组是最常见结果，绝不在规则层产生副作用。 */
export function newlyReached(combo, fired) {
  const c = readCombo(combo);
  if (c <= 0) return [];
  const f = firedSet(fired);
  const out = [];
  for (const m of LADDER) {
    if (m.combo > c) break;
    if (isFired(f, m.id)) continue;
    out.push(m);
  }
  return out;
}

/* 按 id 取一阶。未知 / 缺 id 一律 null（fail closed）。 */
export function milestoneById(id) {
  if (typeof id !== 'string' || !id) return null;
  for (const m of LADDER) if (m.id === id) return m;
  return null;
}

/* 一阶实际到账多少：返回 { shield, heal, hint }，全是**非负整数增量**。
 *   护盾 / 生命都夹在生命上限内（满了就到账 0，绝不越界、绝不为负）。
 *   提示次数不夹 —— 它不受生命上限约束（线索回上限就不是奖励了）。
 *   未知效果类型 / 缺金额 / 脏战斗状态一律全 0：绝不凭空加伤害、改生命上限。 */
export function milestoneGrant(milestone, state) {
  const none = { shield: 0, heal: 0, hint: 0 };
  if (!milestone || typeof milestone !== 'object') return none;
  const amount = Number(milestone.amount);
  if (!Number.isInteger(amount) || amount <= 0) return none;
  const cap = maxOf(state);
  const cur = s => { const n = Number(s); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  switch (milestone.effect) {
    case MILESTONE_EFFECT.SHIELD: {
      if (cap <= 0) return none;
      const room = cap - cur(state && state.shield);
      return { shield: Math.max(0, Math.min(amount, room)), heal: 0, hint: 0 };
    }
    case MILESTONE_EFFECT.HEAL: {
      if (cap <= 0) return none;
      const room = cap - cur(state && state.myHp);
      return { shield: 0, heal: Math.max(0, Math.min(amount, room)), hint: 0 };
    }
    case MILESTONE_EFFECT.HINT:
      return { shield: 0, heal: 0, hint: amount };
    default:
      return none;               // 未登记的效果类型：fail closed
  }
}

/* 触发时的横幅文案。★ 到账 0 时必须说实话：
   「护盾已满，没多拿到 +8」和「护盾 +8」对玩家是完全不同的两件事，
   后者是玩家会截图发群里的假消息。 */
export function milestoneToast(milestone, grant) {
  if (!milestone || typeof milestone !== 'object') return '战意达成';
  const g = grant && typeof grant === 'object' ? grant : {};
  const head = '战意 · ' + milestone.n + ' · ' + milestone.combo + ' 连击';
  if (milestone.effect === MILESTONE_EFFECT.SHIELD) {
    return (g.shield | 0) > 0 ? (milestone.ic + ' ' + head + '：护盾 +' + (g.shield | 0))
      : (milestone.ic + ' ' + head + '：护盾已满，未额外获得');
  }
  if (milestone.effect === MILESTONE_EFFECT.HEAL) {
    return (g.heal | 0) > 0 ? (milestone.ic + ' ' + head + '：回复 ' + (g.heal | 0) + ' 点生命')
      : (milestone.ic + ' ' + head + '：生命已满，未额外回复');
  }
  if (milestone.effect === MILESTONE_EFFECT.HINT) {
    return (g.hint | 0) > 0 ? (milestone.ic + ' ' + head + '：提示 +' + (g.hint | 0) + ' 次') : head;
  }
  return head;
}

/* 战斗页那一行的视图量：已达成阶数 / 下一阶门槛 / 进度比。
   纯派生：读 combo 与 fired，不改任何东西。封顶后 next 为 null、progress 为 1，
   UI 就不必自己判断「还剩几阶」。 */
export function comboProgress(combo, fired) {
  const total = LADDER.length;
  const f = firedSet(fired);
  let unlocked = 0, next = null;
  for (const m of LADDER) {
    if (isFired(f, m.id)) unlocked++;
    else if (!next) next = m;
  }
  return {
    total,
    unlocked,
    next,
    done: total > 0 && unlocked >= total,
    // 进度是「已达成阶数」而不是「连击 / 最高门槛」：连击会在换词时清零，
    // 用它当分母会让同一段事实每拼一个词就掉一格，玩家看着像在倒退。
    progress: total > 0 ? Math.min(1, Math.round((unlocked / total) * 1e4) / 1e4) : 0,
  };
}

/* 导出给展示层用的只读阶梯副本（避免 UI 直接 import 数据层）。 */
export function comboMilestoneLadder() { return LADDER.slice(); }