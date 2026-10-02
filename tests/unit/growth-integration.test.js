/* 「知识成长」接线回归（docs/feature-mastery-growth.md 的接线部分）。
 *
 * 纯规则模块（domain/mastery-growth.js）与展示模块（ui/components/mastery-growth.js）
 * 各有自己的单测；这里锁定的是**接线契约** —— 三处最容易出错的地方：
 *
 *  1) **开局真的把成长加进生命上限**：createRun 接受可选 growth，maxhp = 70 + 角色 + bonus，
 *     初始 hp 满血。20 个真实教材词 → 学者 60 → 61；不传 growth 时逐字等于旧行为。
 *  2) **快照带得走、恢复不重算**：growth 进快照（可选字段），往返 10 次 maxhp 不变；
 *     恢复路径**不调 createRun**，所以一份 maxhp=80 的旧存档不会被「现在全掌握了」的
 *     DB 重新算成 88 —— 这是「中途退出重进白赚一次上限」的那个 bug 的形状。
 *  3) **不叠加**：跨单元过渡 / 同单元续段都不碰 maxhp，本局中途达到 20 词也不改本局上限。
 *
 * 全部是纯函数 / 编解码，不碰 DOM 与存储。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { HEROES } from '../../src/data/heroes.js';
import { createRun } from '../../src/domain/run.js';
import { applyUnitTransition, applyUnitSegment } from '../../src/domain/campaign.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { growthSummary } from '../../src/domain/mastery-growth.js';

const HERO = id => HEROES.filter(h => h.id === id)[0];
const ALL = WORDS.map(w => w.w.toLowerCase());
const keys = n => ALL.slice(0, n);

/* 固定随机源：地图生成必须可重复，否则断言落在随机形状上。 */
const rnd = () => 0.5;

const newRun = (over = {}) =>
  createRun(1, HERO('scholar'), WORDS.filter(w => w.u === 1), rnd, over);

/* ---------------- 垂直 1：开局加成 ---------------- */

test('20 个真实教材词：学者新一局 maxhp 60 → 61（20 词 = +1）', () => {
  const g = growthSummary(keys(20), WORDS);
  assert.equal(g.bonusHp, 1, '规则层：20 词 = +1');
  const run = newRun({ version: 1, masteredAtStart: 20, bonusHp: g.bonusHp, baseMaxhp: 60 });
  assert.equal(run.maxhp, 61);
  assert.equal(run.hp, 61, '新一局满血开局：加的是上限，不是凭空回血');
});

test('不加成的旧调用逐字不变：createRun(..., rnd) 仍是 60', () => {
  const run = newRun();
  assert.equal(run.maxhp, 60);
  assert.equal(run.hp, 60);
  assert.equal(run.growth, undefined, '没传成长事实时不凭空造字段');
});

test('成长只加一次，且加在角色 base 之上（每个角色各自的 base）', () => {
  const base = { version: 1, masteredAtStart: 20, bonusHp: 1 };
  for (const id of ['scholar', 'warrior', 'healer', 'ranger']) {
    const hero = HERO(id);
    const natural = 70 + ((hero.mod && hero.mod.hp) || 0);
    const run = createRun(1, hero, WORDS.filter(w => w.u === 1), rnd,
      Object.assign({}, base, { baseMaxhp: natural }));
    assert.equal(run.maxhp, natural + 1, id + ' 只加一次成长');
  }
});

test('封顶 +12：240 词与 259 词都只加 12', () => {
  for (const n of [240, 259]) {
    const g = growthSummary(keys(n), WORDS);
    assert.equal(g.bonusHp, 12, n + ' 词 = +12');
    const run = newRun({ version: 1, masteredAtStart: n, bonusHp: g.bonusHp, baseMaxhp: 60 });
    assert.equal(run.maxhp, 72);
  }
});

test('自定义词 500 个（独有）不成长：maxhp 仍是 60', () => {
  const custom = Array.from({ length: 500 }, (_, i) => 'myword' + i);
  const g = growthSummary(custom, WORDS);
  assert.equal(g.bonusHp, 0);
  const run = newRun({ version: 1, masteredAtStart: 0, bonusHp: 0, baseMaxhp: 60 });
  assert.equal(run.maxhp, 60);
});

/* 脏的成长事实绝不渗进 maxhp —— 存档是外部输入。 */
test('非法 growth（负数 / 超封顶 / NaN / 对象）fail closed：按 +0 开局', () => {
  const bad = [
    { version: 1, masteredAtStart: 20, bonusHp: -3 },
    { version: 1, masteredAtStart: 20, bonusHp: 99 },
    { version: 1, masteredAtStart: 20, bonusHp: NaN },
    { version: 1, masteredAtStart: 20, bonusHp: '2' },
    { version: 1, masteredAtStart: 20, bonusHp: 1.5 },
    'nope', 42, { bonusHp: 1 },
  ];
  for (const g of bad) {
    assert.equal(newRun(g).maxhp, 60, '脏输入按 +0：' + JSON.stringify(g));
  }
});

/* ---------------- 垂直 2：快照往返与「恢复不重算」 ---------------- */

const snapshotOf = run => {
  const env = { run, battle: null, encounter: null, phase: PHASE.MAP };
  return encodeSnapshot(env, { now: 1700000000000 });
};

test('growth 随快照落盘，JSON 往返 10 次 maxhp 与 growth 完全不变', () => {
  let run = newRun({ version: 1, masteredAtStart: 40, bonusHp: 2, baseMaxhp: 60 });
  assert.equal(run.maxhp, 62);
  for (let i = 0; i < 10; i++) {
    // 每一轮都真的过一遍编解码（不是只做一次 JSON 往返）：
    // 往返不稳定的字段（Set、节点引用、可选键）正是在第二轮开始崩的。
    const back = decodeSnapshot(JSON.parse(JSON.stringify(snapshotOf(run))));
    assert.equal(back.ok, true, '第 ' + (i + 1) + ' 次往返仍可恢复');
    assert.equal(back.value.run.maxhp, 62);
    assert.equal(back.value.run.hp, 62);
    assert.deepEqual(back.value.run.growth, { version: 1, masteredAtStart: 40, bonusHp: 2, baseMaxhp: 60 });
    run = back.value.run;
  }
});

test('旧快照没有 growth 字段：保持 undefined，绝不凭空补一个 +0', () => {
  const run = newRun();
  delete run.growth;
  const back = decodeSnapshot(JSON.parse(JSON.stringify(snapshotOf(run))));
  assert.equal(back.ok, true, '缺字段的旧快照必须仍可恢复');
  assert.equal(back.value.run.growth, undefined);
  assert.equal(back.value.run.maxhp, 60);
});

test('恢复不重算：旧的 maxhp=80 存档不会因为「现在全掌握了」被抬到 92', () => {
  // 一份没有 growth 字段、maxhp=80 的历史快照（角色基础值不是 70+-10，
  // 说明它来自更早的版本 —— 恢复必须原样尊重盘上的事实）。
  const run = newRun();
  run.maxhp = 80; run.hp = 55;
  delete run.growth;
  const raw = JSON.parse(JSON.stringify(snapshotOf(run)));
  const back = decodeSnapshot(raw);
  assert.equal(back.ok, true);
  assert.equal(back.value.run.maxhp, 80, '恢复出来仍是 80，绝不按当前 DB 重算');
  assert.equal(back.value.run.hp, 55);
});

test('损坏的 growth 字段整份 fail closed（不静默改成 +0）', () => {
  const run = newRun({ version: 1, masteredAtStart: 40, bonusHp: 2, baseMaxhp: 60 });
  const bads = ['2', -1, 99, NaN, 1.5, { bonusHp: 2 }, [], { version: 1, bonusHp: 2, masteredAtStart: '20', baseMaxhp: 60 }];
  for (const bad of bads) {
    const raw = JSON.parse(JSON.stringify(snapshotOf(run)));
    // JSON.stringify 把 NaN 变成 null，null 同样是非法形状
    raw.run.growth = bad;
    assert.equal(decodeSnapshot(raw).ok, false, '脏 growth 必须被拒：' + JSON.stringify(bad));
  }
});

test('snapshot 的 maxhp 允许大于 base+bonus（遗物等后续加成不误拒）', () => {
  // 守恒性只在开局成立：进本局之后 maxhp 可能被别的合法途径抬高，
  // 校验绝不能因此把一份**合法**存档判成损坏。
  const run = newRun({ version: 1, masteredAtStart: 40, bonusHp: 2, baseMaxhp: 60 });
  run.maxhp = 70; run.hp = 40;
  const back = decodeSnapshot(JSON.parse(JSON.stringify(snapshotOf(run))));
  assert.equal(back.ok, true, 'maxhp 高于 base+bonus 仍是合法存档');
  assert.equal(back.value.run.maxhp, 70);
});

test('growth producer and codec reject mastery above the canonical book size', () => {
  const invalid = {version:1,masteredAtStart:260,bonusHp:12,baseMaxhp:60};
  assert.equal(newRun(invalid).growth,undefined);
  const raw = snapshotOf(newRun()); raw.run.growth=invalid;
  assert.equal(decodeSnapshot(raw).ok,false);
});

test('encoding a corrupt growth fact must not silently make it a legacy snapshot', () => {
  const run = newRun({version:1,masteredAtStart:40,bonusHp:2,baseMaxhp:60});
  run.growth.bonusHp=99;
  assert.equal(snapshotOf(run),null);
});

/* ---------------- 垂直 3：不叠加、不回血 ---------------- */

test('本局中途达到 20 词：本局 maxhp 不动，下一局才 +1', () => {
  const run = newRun();                       // 开局 0 词 → 60
  for (let i = 0; i < 20; i++) run.done.add(keys(20)[i]);
  assert.equal(run.maxhp, 60, '战斗中达到阈值不改本局上限');
  const g = growthSummary(keys(20), WORDS);
  const next = createRun(1, HERO('scholar'), WORDS.filter(w => w.u === 1), rnd,
    { version: 1, masteredAtStart: 20, bonusHp: g.bonusHp, baseMaxhp: 60 });
  assert.equal(next.maxhp, 61, '只有新开一轮才生效');
});

test('跨单元过渡不叠加 maxhp / hp', () => {
  const run = newRun({ version: 1, masteredAtStart: 40, bonusHp: 2, baseMaxhp: 60 });
  run.maxhp = 62; run.hp = 40;
  const applied = applyUnitTransition(run, { ok: true, from: 1, to: 2 }, { words: WORDS.filter(w => w.u === 2) });
  assert.ok(applied, '过渡成功');
  assert.equal(run.maxhp, 62, '跨单元不再额外增加');
  assert.equal(run.hp, 40, '也不额外回血');
});

test('同单元续段不叠加 maxhp / hp', () => {
  const run = newRun({ version: 1, masteredAtStart: 40, bonusHp: 2, baseMaxhp: 60 });
  run.hp = 30;
  const applied = applyUnitSegment(run, { words: WORDS.filter(w => w.u === 1) });
  assert.ok(applied);
  assert.equal(run.maxhp, 62);
  assert.equal(run.hp, 30);
});

test('growth.baseMaxhp 是遗物/开局加成之前的角色 base（不是本轮 maxhp）', () => {
  const run = newRun({ version: 1, masteredAtStart: 20, bonusHp: 1, baseMaxhp: 60 });
  assert.equal(run.growth.baseMaxhp, 60, 'base 是角色基础 70-10，不是 61 也不是本轮涨过的值');
  assert.equal(run.maxhp, 61);
});
