/* 任务 7：按单元全部词完成依序解锁 + 同学习轮跨单元继承资源。
 *
 * 契约（本文件逐条钉死）：
 *  1) 解锁只认「本单元目标词全部完整拼对」，不认 wins / best / 纪念卡 / 部分词。
 *  2) 旧用户迁移保守：只有 mastered 对**前面连续单元**的目标词完整覆盖（trim+lower）
 *     才保守授予后续解锁；绝不凭历史直接授予全册。
 *  3) 自定义单元（0）永远可玩，但不解教材锁。
 *  4) transitionNextUnit 是纯事实函数：跨单元不改次数、不改 id、不补额度。
 *  5) apply* 只换词池与地图，金币/背包/遗物/影分身/英雄/统计原样继承。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { createRun } from '../../src/domain/run.js';
import {
  CUSTOM_UNIT, wordKey, unitTargets, ensureProgress, isUnitComplete,
  unlockProgress, canSelectUnit, recordUnitComplete,
  transitionNextUnit, applyUnitTransition, applyUnitSegment,
} from '../../src/domain/campaign.js';
import { pendingWords, learningCounts } from '../../src/domain/word-selection.js';

const HERO = { id: 'ranger', mod: { hp: 0, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const UNIT_NOS = [1, 2, 3, 4, 5, 6, 0];
const wordsFor = u => (u === 0 ? [] : WORDS.filter(w => w.u === u));
const mkDb = (db = {}) => Object.assign({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [] }, db);
const view = db => unlockProgress({ units: UNIT_NOS, wordsFor, mastered: db.mastered, unitProgress: db.unitProgress });

/* ---------------- 1. 只有 Unit 1 可选，其余锁定 ---------------- */
test('a fresh save unlocks only unit 1, and the custom unit is always playable', () => {
  const p = view(mkDb());
  assert.equal(p.isUnlocked(1), true, 'Unit 1 永远可玩');
  assert.equal(p.isUnlocked(0), true, '自定义词表永远可玩');
  for (const n of [2, 3, 4, 5, 6]) {
    assert.equal(p.isUnlocked(n), false, 'Unit ' + n + ' 必须锁定');
    assert.equal(canSelectUnit(p, n), false);
    assert.equal(p.byUnit[n].lockedReason, 'unit-' + (n - 1), '锁定原因必须指向要完成的上一单元');
  }
  assert.equal(canSelectUnit(p, 1), true);
  assert.equal(canSelectUnit(p, CUSTOM_UNIT), true);
});

test('partial mastery never unlocks anything beyond unit 1', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).slice(0, -1).map(w => w.w) });
  const p = view(db);
  assert.equal(p.byUnit[1].complete, false, '差一个词就不是完成');
  assert.equal(p.byUnit[1].remaining, 1);
  assert.equal(p.isUnlocked(2), false);
});

/* ---------------- 2. 旧用户迁移：保守、连续、可解释 ---------------- */
test('legacy mastery unlocks the next unit only when every target word is covered', () => {
  const u1 = WORDS.filter(w => w.u === 1).map(w => w.w);
  // 大小写与首尾空白不是新的词：身份只做 trim + lower。
  const db = mkDb({ mastered: [...u1.slice(0, -1), ' ' + u1[u1.length - 1].toUpperCase() + ' '] });
  const p = view(db);
  assert.equal(p.byUnit[1].total, u1.length);
  assert.equal(p.byUnit[1].done, u1.length, 'trim+lower 必须合并大小写与空白');
  assert.equal(p.byUnit[1].complete, true);
  assert.equal(p.isUnlocked(2), true, 'Unit 1 完整覆盖 → 保守授予 Unit 2');
  assert.equal(p.isUnlocked(3), false, '绝不一次授予全册');
});

test('legacy wins / best / reward cards alone never unlock a unit', () => {
  const db = mkDb({ wins: 42, best: 9, runs: 30, rewards: [{ id: 'WR-1', unit: 1 }], mastered: ['water'] });
  const p = view(db);
  assert.equal(p.byUnit[1].complete, false);
  assert.equal(p.isUnlocked(2), false, '历史战绩与纪念卡不是词汇完成的证据');
});

test('unlocking is contiguous: finishing unit 3 does not unlock unit 4 without unit 2', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1 || w.u === 3).map(w => w.w) });
  const p = view(db);
  assert.equal(p.byUnit[3].complete, true, 'Unit 3 的词确实都学过');
  assert.equal(p.isUnlocked(3), false, 'Unit 2 没完成 → Unit 3 仍锁');
  assert.equal(p.isUnlocked(4), false);
});

test('recordUnitComplete is idempotent and unlocks exactly one step', () => {
  const db = mkDb();
  assert.equal(recordUnitComplete(db, 1, { now: 1000 }), true, '第一次记录返回 true');
  assert.equal(recordUnitComplete(db, 1, { now: 2000 }), false, '重复记录返回 false');
  assert.equal(db.unitProgress['1'].completedAt, new Date(1000).toISOString(), '第一次的时间戳不许被覆盖');
  const p = view(db);
  assert.equal(p.byUnit[1].complete, true);
  assert.equal(p.isUnlocked(2), true);
  assert.equal(p.isUnlocked(3), false);
});

test('ensureProgress repairs a corrupted unitProgress field without touching mastered', () => {
  const db = mkDb({ mastered: ['cat'], unitProgress: 'nope' });
  ensureProgress(db);
  assert.deepEqual(db.unitProgress, {});
  assert.deepEqual(db.mastered, ['cat'], '掌握记录绝不被删');
});

test('isUnitComplete uses trim+lower identity and ignores words from other units', () => {
  const u1 = WORDS.filter(w => w.u === 1).map(w => w.w);
  const db = mkDb({ mastered: [...u1, ...WORDS.filter(w => w.u === 5).map(w => w.w)] });
  assert.equal(isUnitComplete({ unit: 1, words: wordsFor(1), db }), true);
  assert.equal(isUnitComplete({ unit: 2, words: wordsFor(2), db }), false, '别的单元的词不能顶替本单元');
});

test('unitTargets keeps duplicate entries but merges identity', () => {
  const t = unitTargets([{ w: 'Cat ' }, { w: 'cat' }, { w: 'CAT' }, { w: 'dog' }]);
  assert.deepEqual(t, ['cat', 'dog']);
  assert.equal(wordKey(' Keep An Eye '), 'keep an eye', '空格属于拼写，不许剥掉');
});

/* ---------------- 3. 跨单元衔接：纯事实 + 幂等 ---------------- */
test('transitionNextUnit refuses when the current unit is unfinished', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  const p = view(db);
  const t1 = transitionNextUnit({ run, progress: p });
  assert.equal(t1.ok, false);
  assert.equal(t1.reason, 'incomplete');
  assert.equal(run.unit, 1, '拒绝时绝不改任何状态');
});

test('transitionNextUnit refuses a locked next unit and the custom unit', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const run = createRun(1, HERO, wordsFor(1));
  const p = view(db);
  assert.deepEqual(transitionNextUnit({ run, progress: p }).to, 2);

  const custom = createRun(0, HERO, [{ u: 0, d: 1, w: 'cat', z: '猫' }]);
  assert.equal(transitionNextUnit({ run: custom, progress: p }).reason, 'custom');

  // 防御分支：调用方传进来的是**过期**的解锁视图（本单元已完成，但下一单元在
  // 那个视图里还锁着）。必须拒绝而不是擅自跳单元。
  const stale = { next: p.next, counts: () => ({ total: 1, done: 1, remaining: 0, complete: true }), isUnlocked: () => false };
  assert.equal(transitionNextUnit({ run, progress: stale }).reason, 'locked');
});

test('transitionNextUnit will not skip a unit that is still locked', () => {
  // 连续口径落到动作层：Unit 3 的词全学会了，但 Unit 2 没完成 → 停在 Unit 2 不许跳。
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1 || w.u === 3).map(w => w.w) });
  const run = createRun(2, HERO, wordsFor(2));
  const t = transitionNextUnit({ run, progress: view(db) });
  assert.equal(t.ok, false, 'Unit 2 还没完成，不许直接去 Unit 3');
  assert.equal(t.reason, 'incomplete');
  assert.equal(run.unit, 2);
});

test('transitionNextUnit is idempotent: applying twice cannot double-apply', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const run = createRun(1, HERO, wordsFor(1));
  run.done = new Set(WORDS.filter(w => w.u === 1).map(w => w.w));
  const p = view(db);
  const first = transitionNextUnit({ run, progress: p });
  assert.equal(first.ok, true);
  assert.deepEqual([first.from, first.to], [1, 2]);
  applyUnitTransition(run, first, { words: wordsFor(2) });
  // ★ 幂等不再由 campaign.startedUnit 守卫（那会让 Unit 2→3 永远接不上）。
  //   现在由 applyUnitTransition 的入口校验保证：run.unit 已经不等于 facts.from。
  const again = applyUnitTransition(run, first, { words: wordsFor(2) });
  assert.equal(again, null, '重复应用同一份事实必须是彻底的 no-op');
  assert.equal(run.unit, 2, '第二次调用不许再改一次');
  assert.deepEqual(run.campaign, { startedUnit: 1, segments: 2 }, '段数不许被重复应用再加一次');
  // 而在 Unit 2 上重新算事实，得到的是**下一个**单元，不是「already」。
  for (const w of WORDS.filter(x => x.u === 2)) db.mastered.push(w.w);
  const next2 = transitionNextUnit({ run, progress: view(db) });
  assert.equal(next2.ok, true, 'Unit 2 学完之后必须能继续去 Unit 3');
  assert.deepEqual([next2.from, next2.to], [2, 3]);
});

/* ---------------- 4. 继承：资源与计数一个都不许变 ---------------- */
test('applyUnitTransition keeps gold, bag, relics, ghost, hero and stats; only pool and map change', () => {
  const run = createRun(1, HERO, wordsFor(1));
  run.gold = 231; run.bag = { leech: 1, potion: 4 }; run.relics = ['shield', 'greed'];
  run.ghostUsed = true; run.hp = 41; run.maxhp = 80; run.shield = 9;
  run.kills = 7; run.att = 30; run.attOk = 25; run.history = [1, 2, 3];
  run.countedStart = true; run.clearedRun = true;
  const id = run.id;
  run.done = new Set(['water']);
  run.wrong = ['water', 'river'];

  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const t = transitionNextUnit({ run, progress: view(db) });
  applyUnitTransition(run, t, { words: wordsFor(2) });

  assert.equal(run.unit, 2);
  assert.equal(run.id, id, '同一轮学习：G.id 不变');
  assert.equal(run.countedStart, true);
  assert.equal(run.clearedRun, true, '通关标记绝不跨单元清零');
  assert.equal(run.gold, 231, '金币继承');
  assert.deepEqual(run.bag, { leech: 1, potion: 4 }, '背包原样，不重发新手道具');
  assert.deepEqual(run.relics, ['shield', 'greed'], '遗物原样，不重跑初始化');
  assert.equal(run.ghostUsed, true, '影分身额度已耗，不补');
  assert.equal(run.hp, 41);
  assert.equal(run.maxhp, 80);
  assert.equal(run.shield, 9);
  assert.equal(run.kills, 7, '迁移不是击杀');
  assert.deepEqual([run.att, run.attOk, run.history], [30, 25, [1, 2, 3]], '学习统计持久保留');
  assert.deepEqual([...run.done], ['water'], '已完成集合跨单元保留');
  assert.deepEqual(run.wrong, [], '错词只保留仍在当前词池里的');
  assert.equal(new Set(run.pool.map(w => w.u)).size, 1, '词池整体换成 Unit 2');
  assert.ok(run.pool.every(w => w.u === 2), '不许混入上一单元的词');
  assert.ok(run.rows.length && run.rows[0].length, '新单元的地图必须真的重新生成');
  assert.equal(run.floor, 1, '楼层重置');
  assert.equal(run.maxFloor, 1);
  assert.equal(pendingWords(run).length, wordsFor(2).length, '新词池里没有上一单元的退休词');
});

test('maxFloor statistics are never rewritten by a unit transition', () => {
  const run = createRun(1, HERO, wordsFor(1));
  run.maxFloor = 9; run.floor = 9;
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const t = transitionNextUnit({ run, progress: view(db) });
  applyUnitTransition(run, t, { words: wordsFor(2) });
  assert.equal(run.floor, 1);
  assert.equal(run.maxFloor, 9, '历史最好层数不许被改小');
});

test('applyUnitSegment restarts the same unit without touching counters or ids', () => {
  const run = createRun(3, HERO, wordsFor(3));
  run.gold = 12; run.bag = { leech: 0 }; run.relics = ['purse']; run.ghostUsed = true;
  run.countedStart = true; run.clearedRun = true;
  run.done = new Set([WORDS.find(w => w.u === 3).w]);
  const before = { id: run.id, kills: run.kills, done: run.done.size };
  const facts = applyUnitSegment(run, { words: wordsFor(3) });
  assert.equal(facts.unit, 3, '仍是本单元');
  assert.equal(run.unit, 3);
  assert.equal(run.id, before.id);
  assert.equal(run.gold, 12);
  assert.equal(run.kills, before.kills);
  assert.equal(run.done.size, before.done, '已完成词不重置：只继续抽未完成的');
  assert.equal(run.ghostUsed, true);
  assert.equal(pendingWords(run).length, learningCounts(run).remaining);
  assert.ok(pendingWords(run).length > 0);
});

test('campaign segment facts survive a snapshot round trip', async () => {
  const { encodeSnapshot, decodeSnapshot, PHASE } = await import('../../src/domain/run-snapshot.js');
  const run = createRun(1, HERO, wordsFor(1));
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  run.done = new Set(WORDS.filter(w => w.u === 1).map(w => w.w));
  const t = transitionNextUnit({ run, progress: view(db) });
  applyUnitTransition(run, t, { words: wordsFor(2) });

  const env = encodeSnapshot({ phase: PHASE.MAP, run, battle: null }, { now: 1 });
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.campaign.startedUnit, 1, '这一轮从 Unit 1 开始的事实必须留存');
  assert.equal(out.value.run.campaign.segments, 2);
  assert.equal(out.value.run.unit, 2, '恢复后仍在 Unit 2');
});

test('a snapshot written before the campaign feature still restores as its own unit', async () => {
  const { encodeSnapshot, decodeSnapshot, PHASE } = await import('../../src/domain/run-snapshot.js');
  const env = encodeSnapshot({ phase: PHASE.MAP, run: createRun(2, HERO, wordsFor(2)), battle: null }, { now: 1 });
  delete env.run.campaign;                                   // 旧客户端写出的存档形状
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, '缺 campaign 字段的旧快照必须照常能恢复');
  assert.equal(out.value.run.unit, 2);
  assert.deepEqual(out.value.run.campaign, { startedUnit: 2, segments: 1 },
    '按 G.unit 保守回落，绝不凭空恢复成别的单元');
});

test('a corrupted campaign field falls back instead of destroying the active run', async () => {
  const { encodeSnapshot, decodeSnapshot, PHASE } = await import('../../src/domain/run-snapshot.js');
  const env = encodeSnapshot({ phase: PHASE.MAP, run: createRun(2, HERO, wordsFor(2)), battle: null }, { now: 1 });
  env.run.campaign = { startedUnit: 'x', segments: -3 };
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, 'campaign 脏数据不许把玩家正在进行的一局判成损坏');
  assert.deepEqual(out.value.run.campaign, { startedUnit: 2, segments: 1 });
});

test('campaign segment counter starts at one and only counts real segments', () => {
  const run = createRun(1, HERO, wordsFor(1));
  assert.equal(run.campaign.startedUnit, 1);
  assert.equal(run.campaign.segments, 1);
  applyUnitSegment(run, { words: wordsFor(1) });
  assert.equal(run.campaign.segments, 2);
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  applyUnitTransition(run, transitionNextUnit({ run, progress: view(db) }), { words: wordsFor(2) });
  assert.equal(run.campaign.segments, 3);
  assert.equal(run.campaign.startedUnit, 1, '整轮从 Unit 1 开始');
  assert.equal(run.unit, 2);
});