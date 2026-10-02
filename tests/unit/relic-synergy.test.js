/* 遗物**组合技（synergy）**：规则层与派生数值。
 *
 * 守的是「遗物之间真的会互相说话」这条底线：
 *  - 组合必须**成对/成组**才成立，只拿一件绝不触发（否则组合技退化成第四个被动加值）；
 *  - 组合里引用的遗物 id 必须真实存在（拼错 id 的组合永远不触发，是最难发现的死代码）；
 *  - 派生数值集中在 synergyBonuses 一处，调用点只读不重算 ——
 *    面板文案说 8 点、代码打 8 点，是这类系统最典型的漂移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RELICS } from '../../src/data/relics.js';
import { RELIC_SYNERGY, BASE_PURSE_GOLD } from '../../src/data/balance.js';
import {
  SYNERGIES, activeSynergies, hasSynergy, synergyBonuses, synergyLabel,
  victoryGoldBonus, floorHealBonus, winHealBonus,
} from '../../src/domain/relic-rules.js';

const ids = (...a) => a;

test('组合技表本身完整：3-5 组、id 唯一、成员非空且都真实存在', () => {
  assert.ok(SYNERGIES.length >= 3 && SYNERGIES.length <= 5,
    '组合技应该是一小组有主题的搭配，不是两两组合的笛卡尔积；实际 ' + SYNERGIES.length + ' 组');
  const known = new Set(RELICS.map(r => r.id));
  const seen = new Set();
  for (const s of SYNERGIES) {
    assert.ok(s && typeof s.id === 'string' && s.id.length > 0, '组合技必须有 id');
    assert.ok(!seen.has(s.id), '组合技 id 重复: ' + s.id);
    seen.add(s.id);
    assert.ok(Array.isArray(s.need) && s.need.length >= 2, s.id + ' 至少要有两件成员遗物');
    for (const need of s.need) {
      assert.ok(known.has(need), `组合技「${s.n}」引用了不存在的遗物 id: ${need}`);
    }
    assert.equal(typeof s.n, 'string');
    assert.ok(s.n.length > 0, s.id + ' 缺中文名');
    assert.equal(typeof s.d, 'string');
    assert.ok(s.d.length > 0, s.id + ' 缺效果文案');
  }
});

test('一件都不许重复占坑：不同组合技不能共用同一件遗物', () => {
  const owner = new Map();
  for (const s of SYNERGIES) {
    for (const need of s.need) {
      assert.ok(!owner.has(need),
        `遗物「${need}」同时属于「${owner.get(need)}」和「${s.n}」—— 玩家只能挑一条路`);
      owner.set(need, s.n);
    }
  }
});

test('只拿组合的一半不触发', () => {
  for (const s of SYNERGIES) {
    for (const need of s.need) {
      const held = s.need.filter(x => x !== need);
      assert.equal(hasSynergy(held, s.id), false,
        `只持有 ${held.join('+')} 时不该触发「${s.n}」`);
    }
  }
});

test('恰好凑齐一组就触发，且持有顺序不影响结果', () => {
  for (const s of SYNERGIES) {
    assert.equal(hasSynergy(s.need, s.id), true, `持有 ${s.need.join('+')} 应触发「${s.n}」`);
    assert.equal(hasSynergy(s.need.slice().reverse(), s.id), true, '顺序无关');
    assert.deepEqual(activeSynergies(s.need).map(x => x.id), [s.id]);
  }
});

test('重复持有同一件遗物不会让组合技触发两次', () => {
  for (const s of SYNERGIES) {
    const doubled = s.need.concat(s.need);
    const active = activeSynergies(doubled).filter(x => x.id === s.id);
    assert.equal(active.length, 1, '组合技是「有没有」，不是「有几层」');
  }
});

test('认不出的遗物 id 既不炸也不误触发', () => {
  assert.deepEqual(activeSynergies([]), []);
  assert.deepEqual(activeSynergies(null), []);
  assert.deepEqual(activeSynergies(undefined), []);
  assert.deepEqual(activeSynergies(ids('__nope__', '<img src=x>')), []);
  assert.deepEqual(activeSynergies(ids('shield', '__nope__')).map(x => x.id), []);
});

test('synergyBonuses 在无组合时全是零值，而不是 undefined', () => {
  const b = synergyBonuses([]);
  for (const [k, v] of Object.entries(b)) {
    assert.equal(v, 0, '组合技字段 ' + k + ' 在未触发时必须是 0，实际 ' + v);
  }
  assert.deepEqual(Object.keys(b).sort(), Object.keys(RELIC_SYNERGY).sort(),
    '派生字段必须与数据层声明的字段一一对应，不许有一边多出来');
});

test('每组组合技都真的改了一个数值（不允许纯装饰的组合）', () => {
  const base = synergyBonuses([]);
  for (const s of SYNERGIES) {
    const on = synergyBonuses(s.need);
    const changed = Object.keys(on).filter(k => on[k] !== base[k]);
    assert.ok(changed.length > 0, `组合技「${s.n}」没有产生任何数值变化，等于没做`);
  }
});

test('一次持有全部遗物时所有组合技同时成立，数值可以叠加', () => {
  const all = SYNERGIES.reduce((acc, s) => acc.concat(s.need), []);
  const active = activeSynergies(all);
  assert.equal(active.length, SYNERGIES.length);
  const both = synergyBonuses(all);
  for (const s of SYNERGIES) {
    const solo = synergyBonuses(s.need);
    for (const k of Object.keys(solo)) {
      // 只有这组组合技自己点亮的字段才谈「不被覆盖」；
      // 没点亮的字段在 solo 里是 0，全开时是别的组合技的数，两者本来就该不同。
      if (solo[k] === 0) continue;
      assert.equal(both[k], solo[k], k + ' 不该被别的组合技覆盖');
    }
  }
  const lit = Object.keys(both).filter(k => both[k] !== 0);
  assert.ok(lit.length >= SYNERGIES.length, '全收集时每组组合技都应当点亮至少一个字段');
});

test('synergyLabel 能在界面上直接说出「哪两件凑成了什么」', () => {
  const s = SYNERGIES[0];
  const label = synergyLabel(s);
  for (const need of s.need) {
    assert.ok(label.includes(need) || label.includes((RELICS.filter(r => r.id === need)[0] || {}).n),
      '组合技标签必须指出成员：' + label);
  }
  assert.ok(label.includes(s.n), '组合技标签必须带自己的名字：' + label);
});

/* ---------------- 派生奖励：组合技改的是哪几个具体数字 ---------------- */

test('胜利金币：聚宝盆单件给基础值，点金术把它抬到更高的一档', () => {
  assert.equal(victoryGoldBonus([]), 0, '没拿聚宝盆就没有额外金币');
  assert.equal(victoryGoldBonus(['purse']), BASE_PURSE_GOLD);
  assert.equal(victoryGoldBonus(['scholar']), 0, '学者之书本身不加金币');
  assert.equal(victoryGoldBonus(['purse', 'scholar']), RELIC_SYNERGY.alchemistGold);
  assert.ok(RELIC_SYNERGY.alchemistGold > BASE_PURSE_GOLD, '组合必须真的更强');
});

test('每层回血：铁血循环只加自己那一份，不动永动电池的原值', () => {
  assert.equal(floorHealBonus([]), 0);
  assert.equal(floorHealBonus(['battery']), 0, '永动电池的 +8 由它自己的既有路径负责，组合不重复加');
  assert.equal(floorHealBonus(['battery', 'forge']), RELIC_SYNERGY.enduranceFloorHeal);
  assert.equal(floorHealBonus(['forge']), 0, '只拿锻造台不构成续航流');
});

test('胜利回血：只有铁血循环给', () => {
  assert.equal(winHealBonus([]), 0);
  assert.equal(winHealBonus(['battery']), 0);
  assert.equal(winHealBonus(['battery', 'forge']), RELIC_SYNERGY.enduranceWinHeal);
});