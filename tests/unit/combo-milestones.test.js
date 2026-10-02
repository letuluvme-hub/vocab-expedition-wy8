/* 「战意·连击里程碑」的**规则层**回归（docs/feature-combo-milestones.md）。
 *
 * 纯规则：只认显式入参，不读 DOM / 存档 / 全局 G·B。锁住这几条：
 *
 *  1) **阶梯本身**（数据层 COMBO_MILESTONES）形状合法、门槛严格递增、无重复 id。
 *     这是三阶的「唯一来源」：门槛漂移或重复 id 会让同一个奖励被发两次。
 *  2) **向上跨越**而不是「恰好等于」：闪电道具一次 +3 连击可以从 8 跳到 11，
 *     里程碑 10 仍然必须发（判据是 threshold <= combo，不是 combo === threshold）。
 *  3) **一轮一次**（fired 是本轮已达成集合）：护盾会跨战斗结转（finishBattleNode
 *     把 B.shield 写回 run.shield），如果每场战斗都发一次，一轮下来就是
 *     「打得越多护盾越厚」的自我强化循环 —— 所以每个里程碑一轮只发一次。
 *  4) **脏入参不产生 NaN**：combo 是负数 / 字符串 / NaN / null 时一律按 0 处理；
 *     fired 缺失或形状不对时按「本轮一个都还没发」处理，绝不因此抛错。
 *  5) **加成夹在既有字段的合法区间内**：治疗不超过生命上限、护盾不超过生命上限
 *     （与道具「石之护盾」同一口径）。返回值是**实际到账的增量**，
 *     接线层拿它做加法就不会把越界的值写进状态。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBO_MILESTONES, MILESTONE_VERSION,
} from '../../src/data/combo-milestones.js';
import { WORDS } from '../../src/data/words.js';
import {
  newlyReached, milestoneGrant, milestoneToast, comboProgress, milestoneById,
} from '../../src/domain/combo-milestones.js';

/* ---------------- 1. 阶梯本身 ---------------- */

test('连击里程碑阶梯：三阶、门槛严格递增、id 唯一、效果各不相同', () => {
  assert.equal(MILESTONE_VERSION, 1);
  assert.ok(Array.isArray(COMBO_MILESTONES));
  assert.equal(COMBO_MILESTONES.length, 3, '就是三阶：多了少了都会改变节奏');
  let prev = 0;
  const ids = new Set(), effects = new Set();
  for (const m of COMBO_MILESTONES) {
    assert.ok(Number.isInteger(m.combo) && m.combo > 0, '门槛必须是正整数：' + m.id);
    assert.ok(m.combo > prev, '门槛必须严格递增：' + m.id + ' ' + m.combo + ' <= ' + prev);
    prev = m.combo;
    assert.ok(!ids.has(m.id), 'id 不许重复：' + m.id);
    ids.add(m.id);
    assert.ok(['shield', 'heal', 'hint'].indexOf(m.effect) >= 0, '未知效果类型：' + m.effect);
    effects.add(m.effect);
    assert.ok(Number.isInteger(m.amount) && m.amount > 0, '数值必须是正整数：' + m.id);
    assert.ok(typeof m.n === 'string' && m.n, '要有中文名：' + m.id);
    assert.ok(typeof m.blurb === 'string' && m.blurb.indexOf(String(m.combo)) >= 0,
      '说明里必须写清门槛，免得玩家看到自己已达成却不知道差多少：' + m.id);
    assert.equal(typeof m.ic, 'string');
  }
  assert.equal(effects.size, 3, '三阶必须是三种不同效果，否则阶梯读起来是同一个奖励换名字');
});

test('门槛必须落在真实教材词能到达的区间里（连击 ≤ 单词字母数）', () => {
  // 连击是「本词内连续答对字母数」，所以它的上限就是单词的字母数
  // （闪电道具还能一次 +3，但那是额外余量，不拿来当门槛依据）。
  // 门槛高过词库里绝大多数词的长度，就等于一个永远不发的里程碑。
  const letters = s => String(s).toLowerCase().replace(/[^a-z]/g, '').length;
  for (const m of COMBO_MILESTONES) {
    const n = WORDS.filter(w => letters(w.w) >= m.combo).length;
    assert.ok(n > 0, '没有任何教材词能达到 ' + m.combo + ' 连击：' + m.id);
    assert.ok(n >= 8, m.combo + ' 连击只有 ' + n + ' 个词可达，太稀罕（<8）：' + m.id);
  }
});

/* ---------------- 2. 向上跨越 ---------------- */

test('达到门槛才发；差 1 个连击绝不发', () => {
  const before = newlyReached(5, {});
  assert.deepEqual(before, [], '5 连击不该有任何里程碑');
  const at = newlyReached(6, {});
  assert.equal(at.length, 1);
  assert.equal(at[0].combo, 6);
  assert.equal(at[0].effect, 'shield');
});

test('闪电道具一次 +3：从 8 跳到 11，10 连击的里程碑仍然要发', () => {
  // 判据必须是「threshold <= combo」。写成 combo === threshold 的话，
  // 玩家用道具把连击推过门槛就会白白丢掉这一阶奖励。
  const jumped = newlyReached(11, { steady: true });
  assert.deepEqual(jumped.map(m => m.id), ['flow'], '只补发被跳过的那一阶');
  // 从 0 直接跳到 13（极端情况）也不能漏发中间两阶
  assert.deepEqual(newlyReached(13, {}).map(m => m.combo), [6, 10, 12]);
});

/* ---------------- 3. 一轮一次 ---------------- */

test('同一里程碑一轮只发一次：已经发过的绝不再发', () => {
  assert.equal(newlyReached(6, {}).length, 1);
  assert.equal(newlyReached(6, { steady: true }).length, 0, '已达成就不再发');
  assert.equal(newlyReached(99, { steady: true }).length, 2, '只补发还没发过的两阶');
  // 连击在战斗中被清零后再涨回来，也不会二次发放
  const fired = { steady: true };
  assert.deepEqual(newlyReached(0, fired), []);
  assert.deepEqual(newlyReached(6, fired), []);
});

test('fired 里有未知 id（数据表改过 / 存档脏了）不影响已登记的三阶', () => {
  const got = newlyReached(12, { steady: true, flow: true, whoIsThis: true });
  assert.deepEqual(got.map(m => m.id), ['insight'], '未知 id 既不当成已发也不当成没发之外的东西');
});

/* ---------------- 4. 脏入参 ---------------- */

test('脏 combo（负数 / 字符串 / NaN / null / 布尔 / 对象）一律按 0，绝不产生 NaN', () => {
  for (const bad of [-1, -99, '6', NaN, Infinity, null, undefined, true, {}, [], () => {}]) {
    const got = newlyReached(bad, {});
    assert.deepEqual(got, [], '脏连击不该发任何里程碑：' + String(bad));
    const p = comboProgress(bad, {});
    assert.equal(Number.isFinite(p.unlocked), true);
    assert.equal(Number.isFinite(p.progress), true);
  }
});

test('小数连击按 floor 处理，绝不四舍五入到下一个里程碑', () => {
  assert.deepEqual(newlyReached(5.9, {}), [], '5.9 不许当成 6');
  assert.deepEqual(newlyReached(6.0, {}).map(m => m.id), ['steady']);
});

test('脏 fired（字符串 / 数组 / 数字）按「本轮一个都没发」处理，绝不抛错', () => {
  for (const bad of ['steady', [1, 2], 42, true]) {
    const got = newlyReached(6, bad);
    assert.equal(got.length, 1, '脏 fired 不得吞掉本该发的里程碑：' + String(bad));
    assert.equal(comboProgress(6, bad).unlocked, 0);
  }
  // 缺字段（createRun 之前的老 run / 快照恢复出来的 run）同样按没发过处理
  assert.equal(newlyReached(6, undefined).length, 1);
  assert.equal(comboProgress(6, null).unlocked, 0);
});

/* ---------------- 5. 增量计算与夹取 ---------------- */

test('护盾增量 = 实际到账值，超过生命上限的部分被夹掉（与石之护盾同一口径）', () => {
  const m = milestoneById('steady');
  assert.deepEqual(milestoneGrant(m, { shield: 0, myHp: 50, maxhp: 60 }), { shield: 8, heal: 0, hint: 0 });
  assert.deepEqual(milestoneGrant(m, { shield: 55, myHp: 50, maxhp: 60 }), { shield: 5, heal: 0, hint: 0 },
    '只剩 5 点空间就只到账 5，绝不把 63 点护盾写进状态');
  assert.deepEqual(milestoneGrant(m, { shield: 60, myHp: 50, maxhp: 60 }), { shield: 0, heal: 0, hint: 0 },
    '满护盾时到账 0 —— 不许变成负数把护盾削掉');
  assert.equal(milestoneGrant(m, { shield: 0, myHp: 50, maxhp: -3 }).shield, 0, '脏上限不许造出护盾');
});

test('治疗增量夹在生命上限内：满血时到账 0，绝不溢出', () => {
  const m = milestoneById('flow');
  assert.deepEqual(milestoneGrant(m, { shield: 0, myHp: 30, maxhp: 60 }), { shield: 0, heal: 8, hint: 0 });
  assert.deepEqual(milestoneGrant(m, { shield: 0, myHp: 56, maxhp: 60 }), { shield: 0, heal: 4, hint: 0 });
  assert.deepEqual(milestoneGrant(m, { shield: 0, myHp: 60, maxhp: 60 }), { shield: 0, heal: 0, hint: 0 });
});

test('提示类里程碑直接给整数次数，不受生命/护盾夹取影响', () => {
  const m = milestoneById('insight');
  assert.deepEqual(milestoneGrant(m, { shield: 0, myHp: 60, maxhp: 60 }), { shield: 0, heal: 0, hint: 1 });
});

test('脏 battle / 未知效果 / 未知里程碑：全部到账 0，绝不产出 NaN', () => {
  const junk = [{ shield: 0, myHp: 10, maxhp: 60 }, null, undefined, {}, 'x',
    { shield: 'a', myHp: NaN, maxhp: 60 }, { shield: -5, myHp: -5, maxhp: -5 }];
  for (const st of junk) {
    const g = milestoneGrant(milestoneById('steady'), st);
    assert.equal(Number.isFinite(g.shield) && g.shield >= 0, true, JSON.stringify(st));
    assert.equal(g.heal, 0);
  }
  assert.equal(milestoneGrant(null, { shield: 0, myHp: 1, maxhp: 60 }).shield, 0, 'null 里程碑 fail closed');
  assert.equal(milestoneGrant({ id: 'x', effect: 'damage', amount: 999 }, { shield: 0, myHp: 1, maxhp: 60 }).shield, 0,
    '未知效果类型 fail closed：绝不凭空加伤害');
  for (const st of junk) {
    const g = milestoneGrant(milestoneById('flow'), st);
    assert.equal(Number.isFinite(g.heal) && g.heal >= 0, true, JSON.stringify(st));
  }
});

/* ---------------- 文案与进度视图 ---------------- */

test('文案说清「几连击 + 得了什么」，且到账 0 时不谎报奖励', () => {
  const m = milestoneById('steady');
  const got = milestoneToast(m, { shield: 8, heal: 0, hint: 0 });
  assert.match(got, /6/, '必须带门槛');
  assert.match(got, /8/, '必须带实际到账的数值');
  const full = milestoneToast(m, { shield: 0, heal: 0, hint: 0 });
  assert.match(full, /已满|没有额外/, '到账 0 时要说实话，不许报一个没拿到的 +8');
  assert.equal(typeof milestoneToast(null, { shield: 0 }), 'string');
});

test('comboProgress：已达成阶数 / 下一个门槛 / 进度比，封顶后 next 为 null', () => {
  const p0 = comboProgress(0, {});
  assert.equal(p0.total, 3);
  assert.equal(p0.unlocked, 0);
  assert.equal(p0.next.combo, 6);
  assert.equal(p0.progress, 0);

  const p1 = comboProgress(6, { steady: true });
  assert.equal(p1.unlocked, 1);
  assert.equal(p1.next.combo, 10);

  const pAll = comboProgress(30, { steady: true, flow: true, insight: true });
  assert.equal(pAll.unlocked, 3);
  assert.equal(pAll.next, null, '全达成后不许还报一个不存在的下一阶');
  assert.equal(pAll.done, true);
  assert.equal(pAll.progress, 1, '进度封顶在 1，不许超过');
});