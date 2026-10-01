/* 任务 7 补丁 A：连续单元衔接 + 段 BOSS 结算分离 + 纪念卡 ID 跨刷新幂等 + 自定义词进度。
 *
 * 这个文件只钉**本补丁**新增的契约（campaign.test.js 保留原有口径）：
 *  A. 一次学习轮可以从 Unit 1 连续走到 Unit 6：每一跳资源守恒、segments 恰好 +1、
 *     startedUnit / run.id 不变，DB.runs / DB.wins 都不动。
 *  B. 过期事实（stale facts）重复喂进 applyUnitTransition 是彻底的 no-op：
 *     不换地图、不加段、不改单元。
 *  C. 段 BOSS 结算与 run 通关计数分离：同一段里 distinct BOSS 重复依旧 ignored，
 *     但换段之后的新 BOSS 可以真正结算（回血 + 标记节点 + 返回 boss-win），
 *     而 DB.wins 全程只 +1。
 *  D. clearedSegment / rewardId 进快照：缺字段的旧存档保守回落，脏值 fail closed。
 *     纪念卡 id 跨 JSON 往返后再次结算不再发第二张卡。
 *  E. unlockProgress：units 排序去重；自定义单元（0）按真实词表算进度，但永不参与解锁。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { createRun, finishBattleNode, endRunProgress, registerRunStart } from '../../src/domain/run.js';
import {
  CUSTOM_UNIT, unlockProgress, transitionNextUnit, applyUnitTransition, applyUnitSegment,
  recordUnitComplete,
} from '../../src/domain/campaign.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';

const HERO = { id: 'ranger', mod: { hp: 10, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const wordsFor = u => (u === 0 ? [] : WORDS.filter(w => w.u === u));
const mkDb = (db = {}) => Object.assign({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [] }, db);
const view = (db, units = [1, 2, 3, 4, 5, 6, 0]) => unlockProgress({
  units, wordsFor, mastered: db.mastered, unitProgress: db.unitProgress,
});

/* 一次真实 BOSS 战对象（不是同一个对象复用：正是它考验 run 级守卫）。 */
const bossBattle = (run, over = {}) => ({
  node: run.rows[run.rows.length - 1][0],
  myHp: 40, shield: 0, boss: true, elite: false, won: true, finished: false, ...over,
});

/* ================= A. Unit 1→6 连续衔接 ================= */

test('one learning run walks unit 1 through 6: every hop keeps resources and bumps segments once', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  const id = run.id;
  run.gold = 137; run.bag = { leech: 1, potion: 2 }; run.relics = ['shield', 'purse'];
  run.ghostUsed = true; run.kills = 5; run.att = 22; run.attOk = 19; run.history = [2, 5];
  run.maxFloor = 9; run.hp = 33; run.shield = 4;

  for (let from = 1; from <= 6; from++) {
    const u = from + 1;
    // 玩家把本单元的词全部完整拼对（唯一解锁凭据）。
    for (const w of WORDS.filter(x => x.u === from)) {
      if (db.mastered.indexOf(w.w) < 0) db.mastered.push(w.w);
    }
    const p = view(db);
    const facts = transitionNextUnit({ run, progress: p });
    if (from === 6) {
      assert.equal(facts.ok, false, 'Unit 6 之后没有下一单元');
      assert.equal(facts.reason, 'last-unit');
      break;
    }
    assert.equal(facts.ok, true, 'Unit ' + from + ' → ' + u + ' 必须能接上');
    assert.deepEqual([facts.from, facts.to], [from, u]);
    assert.equal(p.isUnlocked(u), true, 'Unit ' + u + ' 应已解锁');

    const segBefore = run.campaign.segments;
    applyUnitTransition(run, facts, { words: wordsFor(u) });

    assert.equal(run.unit, u);
    assert.equal(run.id, id, '同一轮：run.id 不变');
    assert.deepEqual(run.campaign, { startedUnit: 1, segments: segBefore + 1 },
      'startedUnit 恒为 1，segments 每跳恰好 +1');
    assert.equal(run.countedStart, true);
    assert.equal(db.runs, 1, '跨单元绝不加次数');
    assert.equal(db.wins, 0, '没打 BOSS 就不该有通关数');
    assert.equal(run.gold, 137, '金币守恒');
    assert.deepEqual(run.bag, { leech: 1, potion: 2 }, '背包守恒，不重发新手道具');
    assert.deepEqual(run.relics, ['shield', 'purse'], '遗物守恒');
    assert.equal(run.ghostUsed, true, '影分身额度不补');
    assert.deepEqual([run.kills, run.att, run.attOk, run.history], [5, 22, 19, [2, 5]], '统计守恒');
    assert.equal(run.hp, 33, '过渡不回血');
    assert.equal(run.shield, 4);
    assert.equal(run.floor, 1, '楼层回到第一层');
    assert.equal(run.maxFloor, 9, '历史最好层数不许改小');
    assert.ok(run.pool.length && run.pool.every(w => w.u === u), '词池整体换成 Unit ' + u);
  }

  assert.equal(run.unit, 6, '连续五跳之后停在 Unit 6');
  assert.equal(run.campaign.segments, 6, '开局 1 段 + 五次过渡');
});

/* ================= B. 过期事实 ================= */

test('replaying stale transition facts changes nothing at all', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const run = createRun(1, HERO, wordsFor(1));
  const facts = transitionNextUnit({ run, progress: view(db) });
  applyUnitTransition(run, facts, { words: wordsFor(2) });

  const segAfterHop = run.campaign.segments;
  const rowRef = run.rows[0][0];
  const goldBefore = run.gold;

  // 迟到回调 / 双击 / 恢复重放：同一份 facts 再喂三次。
  for (let i = 0; i < 3; i++) {
    assert.equal(applyUnitTransition(run, facts, { words: wordsFor(2) }), null,
      'run.unit 已不等于 facts.from，必须直接 null（no-effect）');
  }
  assert.equal(run.unit, 2, '单元不许被改回去');
  assert.equal(run.campaign.segments, segAfterHop, '重复应用不许再加段');
  assert.deepEqual(run.campaign, { startedUnit: 1, segments: segAfterHop });
  assert.equal(run.rows[0][0], rowRef, '地图对象不许被重新生成（否则玩家位置全丢）');
  assert.equal(run.gold, goldBefore);
});

test('applyUnitTransition refuses facts whose target is not a legal next unit', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const run = createRun(1, HERO, wordsFor(1));
  // progress 给的是 Unit 1 全部学完的视图：合法的下一单元只有 Unit 2。
  const p = view(db);
  for (const facts of [
    { ok: true, from: 1, to: 0 },          // 自定义单元不是「下一单元」
    { ok: true, from: 1, to: 3 },          // 跳单元：progress.next(1) === 2
    { ok: true, from: 1, to: undefined },  // 缺目标
    { ok: true, from: 1, to: 1 },          // 停在原单元
    { ok: false, reason: 'incomplete', from: 1, to: 2 },
    { ok: true, from: 2, to: 3 },          // 过期事实：run.unit 还是 1
    null,
  ]) {
    assert.equal(applyUnitTransition(run, facts, { words: wordsFor(2), progress: p }), null,
      '非法 facts 必须 null：' + JSON.stringify(facts));
  }
  assert.equal(run.unit, 1, '被拒绝时一个字段都不许动');
  assert.equal(run.campaign.segments, 1);
  assert.equal(run.pool.length, wordsFor(1).length, '词池不许被换掉');
});

test('transitionNextUnit reports the real next unit instead of a permanent already guard', () => {
  // startedUnit 曾经被当成「已经过渡过」的永久守卫，那让 Unit 3→4 永远接不上。
  const db = mkDb({
    mastered: WORDS.filter(w => w.u <= 3).map(w => w.w),
  });
  const run = createRun(1, HERO, wordsFor(1));
  run.campaign.startedUnit = 1;                     // 早已跨过单元
  for (let from = 1; from <= 3; from++) {
    const facts = transitionNextUnit({ run, progress: view(db) });
    assert.equal(facts.ok, true, 'Unit ' + from + ' 应能继续');
    applyUnitTransition(run, facts, { words: wordsFor(from + 1) });
  }
  assert.equal(run.unit, 4);
  assert.deepEqual(run.campaign, { startedUnit: 1, segments: 4 });
});

test('a stale progress view still blocks the hop (locked), startedUnit never grants passage', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const run = createRun(1, HERO, wordsFor(1));
  run.campaign.startedUnit = 9;   // 诊断字段被污染
  const stale = {
    next: view(db).next,
    counts: () => ({ total: 1, done: 1, remaining: 0, complete: true }),
    isUnlocked: () => false,
  };
  assert.equal(transitionNextUnit({ run, progress: stale }).reason, 'locked');
});

/* ================= C. 段 BOSS 结算 vs run 通关 ================= */

test('the first BOSS of each segment really settles, but DB.wins only ever counts once', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  registerRunStart(db, run);
  run.hp = 20;
  const hpBefore = run.hp;

  // --- 第 1 段 ---
  assert.equal(run.clearedSegment, false, '开局段 BOSS 未结算');
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'boss-win');
  assert.equal(db.wins, 1, '真 BOSS 胜利记一次通关');
  assert.equal(run.clearedSegment, true);
  assert.equal(run.clearedRun, true);
  assert.ok(run.hp > hpBefore, '段 BOSS 胜利正常回血');
  assert.equal(run.rows[run.rows.length - 1][0].done, true, '节点被标记完成');

  // 同一段里再来一个 **distinct** BOSS 战斗对象：旧契约必须仍然成立。
  const hpAfterWin = run.hp;
  const otherNode = { ...run.rows[run.rows.length - 1][0], done: false };
  const repeat = bossBattle(run, { node: otherNode, myHp: 5, shield: 6 });
  assert.equal(finishBattleNode(run, repeat, db), 'ignored', '同段重复 BOSS 依旧 ignored');
  assert.equal(db.wins, 1);
  assert.equal(run.hp, hpAfterWin, 'ignored 绝不许再回血');
  assert.equal(run.shield, 0, 'ignored 绝不结转护盾');
  assert.equal(otherNode.done, false, 'ignored 绝不标记节点');

  // --- 第 2 段（同一单元继续练）---
  run.hp = 12;
  applyUnitSegment(run, { words: wordsFor(1) });
  assert.equal(run.clearedSegment, false, '换段后段 BOSS 重新可结算');
  assert.equal(run.clearedRun, true, 'run 级通关标记不因换段清零');
  const hpBefore2 = run.hp;
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'boss-win', '新段的 BOSS 必须能真正结算');
  assert.ok(run.hp > hpBefore2, '新段 BOSS 胜利正常回血');
  assert.equal(run.rows[run.rows.length - 1][0].done, true, '新段节点被标记完成');
  assert.equal(db.wins, 1, '★ 通关数全程只 +1：段结算与 run 通关是两个事实');
  assert.equal(db.runs, 1, '同单元续段不算新开一轮');
});

test('a legacy run without clearedSegment falls back to clearedRun (never double-settles)', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  // 旧快照 / 老内存态：字段缺失。保守回落成「本段已结算」，重复结算必须被挡住。
  delete run.clearedSegment;
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'ignored');
  assert.equal(db.wins, 1);
});

test('an escaped BOSS leaves the segment open for a later real win', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  assert.equal(finishBattleNode(run, bossBattle(run, { won: false }), db), 'boss-loss');
  assert.equal(run.clearedSegment, false, '逃跑 / 战败不算段 BOSS 结算');
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'boss-win');
  assert.equal(db.wins, 1);
});

/* ================= D. 快照：clearedSegment / rewardId ================= */

const roundTrip = (env) => {
  const encoded = encodeSnapshot(env, { now: 1 });
  assert.ok(encoded, 'encodeSnapshot 不该返回 null');
  const out = decodeSnapshot(JSON.parse(JSON.stringify(encoded)));
  assert.equal(out.ok, true, out.reason);
  return out.value;
};

test('a fresh segment survives a snapshot round trip as clearedSegment:false', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const run = createRun(1, HERO, wordsFor(1));
  run.done = new Set(WORDS.filter(w => w.u === 1).map(w => w.w));
  applyUnitTransition(run, transitionNextUnit({ run, progress: view(db) }), { words: wordsFor(2) });

  const back = roundTrip({ phase: PHASE.MAP, run }).run;
  assert.equal(back.clearedSegment, false, '★ 新段的 false 必须落盘并在刷新后保住');
  assert.equal(back.clearedRun, false);
  assert.equal(back.campaign.segments, 2);
  assert.equal(finishBattleNode(back, bossBattle(back), mkDb()), 'boss-win',
    '刷新后这一段的 BOSS 仍可真正结算');
});

test('a snapshot without clearedSegment falls back to clearedRun', () => {
  const run = createRun(1, HERO, wordsFor(1));
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  env.run.clearedRun = true;
  delete env.run.clearedSegment;                     // 旧客户端写出的存档形状
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.clearedSegment, true, '旧存档按 clearedRun 保守回落');
});

test('a cleared segment also survives a refresh as true', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  finishBattleNode(run, bossBattle(run), db);
  const back = roundTrip({ phase: PHASE.MAP, run }).run;
  assert.equal(back.clearedSegment, true);
  assert.equal(finishBattleNode(back, bossBattle(back), mkDb()), 'ignored');
});

test('dirty clearedSegment / rewardId fail closed instead of half-restoring', () => {
  for (const bad of [{ clearedSegment: 'yes' }, { clearedSegment: 1 }, { rewardId: 7 }, { rewardId: {} }]) {
    const run = createRun(1, HERO, wordsFor(1));
    const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
    Object.assign(env.run, bad);
    const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
    assert.equal(out.ok, false, '脏字段必须整份拒绝：' + JSON.stringify(bad));
    assert.equal(out.reason, 'invalid');
  }
});

test('the memorial card id persists and a second settlement reuses it', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);

  const card = endRunProgress(run, db, true, 1700000000000);
  assert.ok(card && card.id, '第一次结算发卡');
  assert.equal(db.rewards.length, 1);
  assert.equal(run.rewardId, card.id, '★ 卡 id 必须持久落在 run 上');

  // 模拟「同一轮被再次结算」：内存里的卡丢了（刷新 / 重开），但 id 还在。
  run.result = undefined;
  run.reward = null;
  const again = endRunProgress(run, db, true, 1700000009999);
  assert.equal(again, card, '复用 db.rewards 里同一张卡对象');
  assert.equal(db.rewards.length, 1, '★ 绝不发第二张卡');
});

test('rewardId survives a JSON round trip, so a refresh cannot mint a second card', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  const card = endRunProgress(run, db, true, 1700000000000);

  // 结算后的这一轮又被退回 active（runtime 的「继续」路径），快照照常写。
  run.result = undefined;
  run.reward = null;                                  // 只剩 id 这个事实
  const back = roundTrip({ phase: PHASE.MAP, run }).run;
  assert.equal(back.rewardId, card.id, '★ rewardId 必须穿过 JSON 往返');

  const reused = endRunProgress(back, db, true, 1700000012345);
  assert.equal(reused.id, card.id);
  assert.deepEqual(db.rewards.map(r => r.id), [card.id], '★ DB.rewards 仍只有一张卡');
});

test('an in-memory reward without rewardId still encodes its id (no second card after refresh)', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  const card = endRunProgress(run, db, true, 1700000000000);

  // 旧内存态：卡在内存里，但 run.rewardId 还没有这个字段。
  delete run.rewardId;
  run.result = undefined;
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  assert.equal(env.run.rewardId, card.id, '编码时可以从 reward.id 取');
  const back = decodeSnapshot(JSON.parse(JSON.stringify(env))).value.run;
  assert.equal(back.rewardId, card.id);
});

test('an old snapshot with no rewardId keeps exactly one card per run', () => {
  const db = mkDb();
  const run = createRun(1, HERO, wordsFor(1));
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  const card = endRunProgress(run, db, true, 1700000000000);
  delete run.rewardId;
  run.result = undefined;

  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  delete env.run.rewardId;                             // 极端旧形状：连 id 都没有
  const back = decodeSnapshot(JSON.parse(JSON.stringify(env))).value.run;
  assert.equal(back.rewardId, undefined);
  assert.equal(back.clearedRun, true, '这一轮确实已经通关过');
  // 领域层不猜：没有 id 就不能凭空复用一张卡；上层（runtime 恢复）负责判定该不该发。
  assert.ok(card && db.rewards.length === 1, '历史卡原样保留，不删不改');
});

/* ================= E. unlockProgress：排序去重 + 自定义词 ================= */

test('unordered and duplicated unit numbers produce the same unlock state', () => {
  const db = mkDb({ mastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const shuffled = view(db, [3, 1, 0, 1, 2, 0, 4, 5, 6]);
  const ordered = view(db, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Object.keys(shuffled.byUnit).sort(), Object.keys(ordered.byUnit).sort());
  for (const n of [0, 1, 2, 3, 4, 5, 6]) {
    assert.deepEqual(shuffled.byUnit[n], ordered.byUnit[n], 'Unit ' + n + ' 的口径不许因输入顺序而变');
  }
  assert.equal(shuffled.isUnlocked(2), true);
  assert.equal(shuffled.isUnlocked(3), false, 'Unit 2 没完成 → Unit 3 仍锁');
});

test('the custom unit reports real learned words without ever unlocking a textbook unit', () => {
  const custom = [
    { u: 0, d: 1, w: 'cat', z: '猫' },
    { u: 0, d: 1, w: 'dog', z: '狗' },
    { u: 0, d: 1, w: 'Bird', z: '鸟' },
  ];
  const mastered = ['cat', 'dog'];
  const p = unlockProgress({
    units: [1, 2, 0], wordsFor: u => (u === 0 ? custom : wordsFor(u)),
    mastered, unitProgress: {},
  });
  const c = p.byUnit[CUSTOM_UNIT];
  assert.equal(c.total, 3, '★ 自定义单元不许伪报 total 0');
  assert.equal(c.done, 2);
  assert.equal(c.remaining, 1);
  assert.equal(c.custom, true);
  assert.equal(c.unlocked, true);
  assert.equal(c.lockedReason, null);
  assert.equal(c.complete, false, '还有词没学完');
  assert.equal(p.isUnlocked(2), false, '★ 自定义单元的完成绝不解锁教材单元');

  const p2 = unlockProgress({
    units: [1, 2, 0], wordsFor: u => (u === 0 ? custom : wordsFor(u)),
    mastered: ['cat', 'dog', 'BIRD '], unitProgress: {},
  });
  assert.equal(p2.byUnit[CUSTOM_UNIT].complete, true, '学完可按词判定完成');
  assert.equal(p2.isUnlocked(2), false, '但完成也不参与教材解锁');
  assert.equal(p2.next(CUSTOM_UNIT), 1, 'next() 只是个纯算术视图：它不知道解锁状态');
  assert.equal(transitionNextUnit({ run: createRun(0, HERO, custom), progress: p2 }).reason, 'custom',
    '自定义单元永远没有「下一单元」');
});

test('a fully learned custom unit still leaves every textbook unit locked', () => {
  const custom = [{ u: 0, d: 1, w: 'cat', z: '猫' }];
  const p = unlockProgress({
    units: [1, 2, 0], wordsFor: u => (u === 0 ? custom : wordsFor(u)),
    mastered: ['cat'], unitProgress: {},
  });
  assert.equal(p.byUnit[0].complete, true);
  assert.equal(p.isUnlocked(2), false);
  assert.equal(p.byUnit[2].lockedReason, 'unit-1');
});

test('recordUnitComplete writes no counter of any kind', () => {
  const db = mkDb({ mastered: ['cat'] });
  const before = JSON.stringify({ runs: db.runs, wins: db.wins, best: db.best, rewards: db.rewards, mastered: db.mastered });
  assert.equal(recordUnitComplete(db, 1, { now: 1000 }), true);
  assert.equal(recordUnitComplete(db, 1, { now: 2000 }), false, '幂等');
  const after = JSON.stringify({ runs: db.runs, wins: db.wins, best: db.best, rewards: db.rewards, mastered: db.mastered });
  assert.equal(after, before, '完成凭据不许顺手加任何计数');
});