/* src/data/lookup.js 的契约（VE-20）。
 *
 * 这不是"测一个 Map 能不能用"，而是**锁死三件事**——它们是这次重构唯一有风险的地方：
 *   1. 「第一条赢」的重复 id 语义：旧代码是 `.filter(x => x.id === id)[0]`，
 *      换成 Map 时很容易顺手写成后写覆盖（`m.set(id, x)` 不带 has 检查），
 *      那样数据表里一旦出现重复 id，取到的对象会静默地变一个。
 *   2. 查不到时的返回值**三者各不相同**，且调用点依赖这个区别：
 *        heroById       → 回退 HEROES[0]（永不 undefined，否则 undefined 渗进数值计算）
 *        relicById      → undefined（调用点 `if (!r) return;`）
 *        *OrNull 变体   → null（equipment-panel 的 unknown 分支会区分 null/undefined）
 *   3. 索引与源表指向**同一批对象**（不是拷贝）——否则运行时改了 HEROES[x]，
 *      索引这边还是旧值，就会出现"两个真相"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { HEROES } from '../../src/data/heroes.js';
import { ITEMS } from '../../src/data/items.js';
import { RELICS } from '../../src/data/relics.js';
import {
  HERO_BY_ID, ITEM_BY_ID, RELIC_BY_ID,
  heroById, relicById, itemById, relicByIdOrNull, itemByIdOrNull,
} from '../../src/data/lookup.js';
import { heroById as heroByIdViaUi } from '../../src/ui/components/hero.js';

test('索引覆盖每一张表，且与源表双向一一对应', () => {
  assert.equal(HERO_BY_ID.size, HEROES.length);
  assert.equal(ITEM_BY_ID.size, ITEMS.length);
  assert.equal(RELIC_BY_ID.size, RELICS.length);
  for (const h of HEROES) assert.equal(HERO_BY_ID.get(h.id), h);
  for (const it of ITEMS) assert.equal(ITEM_BY_ID.get(it.id), it);
  for (const r of RELICS) assert.equal(RELIC_BY_ID.get(r.id), r);
});

test('索引拿到的是源表里的**同一批对象**，不是拷贝', () => {
  // 身份相等而不是深相等：拷贝会让运行时对 HEROES[i] 的任何就地修改不生效。
  const first = HEROES[0];
  assert.ok(Object.is(heroById(first.id), first));
  assert.ok(Object.is(RELIC_BY_ID.get(RELICS[0].id), RELICS[0]));
  assert.ok(Object.is(ITEM_BY_ID.get(ITEMS[0].id), ITEMS[0]));
});

test('重复 id 时**第一条赢**（与旧的 .filter(...)[0] 同语义）', () => {
  const shared = { id: 'dup', n: 'first' };
  const second = { id: 'dup', n: 'second' };
  // 用一张带重复项的假表走同一个建索引函数，而不是去污染真实数据表。
  const build = list => { const m = new Map(); for (const e of (Array.isArray(list) ? list : [])) {
    if (!e || typeof e.id !== 'string') continue;
    if (!m.has(e.id)) m.set(e.id, e);
  } return m; };
  assert.equal(build([shared, second]).get('dup'), shared);
  assert.equal(build([second, shared]).get('dup'), second);

  // ★ 每张表**内部**不许有重复 id —— 一旦有，索引就会静默丢掉一条数据。
  for (const [name, list] of [['HEROES', HEROES], ['ITEMS', ITEMS], ['RELICS', RELICS]]) {
    const ids = list.map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, name + ' 内部出现了重复 id');
  }
});

test('三张表是**各自独立的命名空间**，id 可以跨表撞车', () => {
  // 写这一条是因为审计时把 id 拼在一起判重真的炸了：scholar / lucky / greed
  // 既是角色/道具 id、又是遗物 id。这不是数据错误 —— 三张表本来就是三个命名空间，
  // 快照里 run.relics 存的是遗物命名空间的 id，不会和 heroId 混淆。
  // 但它意味着**任何"全局 id 查找"都是错的**：heroById('scholar') 必须给学者，
  // 而不是学者之书。索引按表分开正是为了守住这条。
  const heroIds = new Set(HEROES.map(h => h.id));
  const relicIds = new Set(RELICS.map(r => r.id));
  const itemIds = new Set(ITEMS.map(i => i.id));
  const cross = [...heroIds].filter(id => relicIds.has(id));
  assert.ok(cross.length > 0, '本项目本来就有跨表撞车的 id；若哪天数据改了，这条也要更新');
  for (const id of cross) {
    assert.ok(Object.is(heroById(id), HEROES.find(h => h.id === id)));
    assert.notEqual(heroById(id), RELIC_BY_ID.get(id), '角色查找绝不能返回遗物对象');
  }
  assert.ok([...itemIds].some(id => relicIds.has(id)), '道具与遗物之间同样存在撞车 id');
});

test('heroById 认不出时回退第一位，绝不返回 undefined', () => {
  assert.equal(heroById('__not_a_hero__'), HEROES[0]);
  assert.equal(heroById(undefined), HEROES[0]);
  assert.equal(heroById(null), HEROES[0]);
  assert.equal(heroById(''), HEROES[0]);
  assert.equal(heroById(0), HEROES[0]);
  assert.ok(heroById(HEROES[2].id));
});

test('relicById / itemById 认不出时返回 undefined（调用点惯例是 if (!r) return）', () => {
  assert.equal(relicById('__not_a_relic__'), undefined);
  assert.equal(itemById('__not_an_item__'), undefined);
});

test('*OrNull 变体返回 null 而不是 undefined（equipment-panel 依赖这个区别）', () => {
  assert.equal(relicByIdOrNull('__not_a_relic__'), null);
  assert.equal(itemByIdOrNull('__not_an_item__'), null);
  // 命中时两者必须完全一致（否则同一件遗物在两个面板里长得不一样）。
  assert.equal(relicByIdOrNull(RELICS[0].id), relicById(RELICS[0].id));
  assert.equal(itemByIdOrNull(ITEMS[0].id), itemById(ITEMS[0].id));
});

test('ui/components/hero.js 的再导出与统一索引是同一个函数', () => {
  // hero.js 只是再导出。这里钉住"没有在 UI 层又偷偷实现一份"。
  assert.equal(heroByIdViaUi, heroById);
  assert.equal(heroByIdViaUi('__not_a_hero__'), HEROES[0]);
});

test('脏条目不污染索引', () => {
  // 建索引函数跳过没有字符串 id 的条目，而不是把它们塞进去。
  const build = list => { const m = new Map(); for (const e of (Array.isArray(list) ? list : [])) {
    if (!e || typeof e.id !== 'string') continue;
    if (!m.has(e.id)) m.set(e.id, e);
  } return m; };
  const m = build([{ id: 'ok' }, null, undefined, {}, { id: 7 }, 'str', []]);
  assert.equal(m.size, 1);
  assert.ok(m.get('ok'));
  assert.equal(build('not an array').size, 0);
});
