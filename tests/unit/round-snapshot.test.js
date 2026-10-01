/* 轮次身份与完成范围在**版本化快照**里的契约（schemaVersion: 1 的可选字段）。
 *
 * 口径：
 *  - roundId / roundNumber 是可选的一对字段。旧快照完全没有它们是合法的，
 *    解码后保持 undefined —— 绝不按 DB.runs / 卡片数量补一个编号出来。
 *  - 一旦出现就必须形状合法：脏值整份 fail closed，绝不让半恢复的 run 去发纪念卡。
 *  - completedUnits 允许缺失（按「没有完成记录」回落），但出现时必须是
 *    0..6 的合法单元数组。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { createRun, finishBattleNode, endRunProgress, registerRunStart, assignRoundId } from '../../src/domain/run.js';
import { recordRoundUnitComplete } from '../../src/domain/campaign.js';
import { PHASE, encodeSnapshot, decodeSnapshot } from '../../src/domain/run-snapshot.js';

const HERO = { id: 'ranger', mod: { hp: 0, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const wordsFor = u => WORDS.filter(w => w.u === u);
const mkDb = (over = {}) => ({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [], ...over });

function roundTrip(run) {
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, out.reason);
  return out.value.run;
}

function seeded(unit = 1, rid = 'rid-1') {
  const run = createRun(unit, HERO, wordsFor(unit));
  assignRoundId(run, rid);
  return run;
}

/* 本轮整词完成是**有证据**的：把这个单元的词一个一个整词答对（run.done 覆盖词池）。
   没有这一步，recordRoundUnitComplete 一律拒绝 —— 历史 mastered 不是本轮证据。 */
function drainUnit(run, unit) {
  const pool = wordsFor(unit);
  for (const w of pool) run.done.add(w.w);
  assert.equal(recordRoundUnitComplete(run, unit, { pool }), true, '本轮整词覆盖后应记录 Unit ' + unit);
}

test('round identity and completed units survive a JSON round trip', () => {
  const run = seeded(1, 'rid-x');
  const db = mkDb();
  registerRunStart(db, run);
  drainUnit(run, 1);
  const back = roundTrip(run);
  assert.equal(back.roundId, 'rid-x');
  assert.equal(back.roundNumber, 1);
  assert.deepEqual(back.completedUnits, [1]);
});

test('a legacy snapshot without round fields decodes without inventing them', () => {
  const run = seeded();
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  delete env.run.roundId;
  delete env.run.roundNumber;
  delete env.run.completedUnits;
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.roundId, undefined, '★ 旧快照不许补出轮次身份');
  assert.equal(out.value.run.roundNumber, undefined, '★ 旧快照不许补出轮次编号');
  assert.deepEqual(out.value.run.completedUnits, [], '缺完成记录按空回落，不是"全部完成"');
});

test('dirty round fields fail closed instead of half-restoring', () => {
  const cases = [
    // 空串 roundId 是编码侧「没有身份」的合法表示（同 rewardId），不算脏值。
    { roundId: 7 }, { roundId: {} }, { roundId: [] },
    // roundNumber: 0 是编码侧「没有编号」的合法表示（真实编号从 1 开始），不算脏值。
    { roundNumber: '3' }, { roundNumber: 1.5 }, { roundNumber: -1 }, { roundNumber: true },
    { completedUnits: 'all' }, { completedUnits: [1, 'x'] }, { completedUnits: [9] }, { completedUnits: [-1] },
  ];
  for (const bad of cases) {
    const run = seeded();
    const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
    Object.assign(env.run, bad);
    const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
    assert.equal(out.ok, false, '脏字段必须整份拒绝：' + JSON.stringify(bad));
    assert.equal(out.reason, 'invalid');
  }
});

test('encoded completed units are deduplicated and in range', () => {
  const run = seeded();
  run.completedUnits = [2, 2, 1];
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  assert.deepEqual(env.run.completedUnits, [1, 2], '编码侧去重');
  run.completedUnits = [0];
  assert.deepEqual(encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 }).run.completedUnits, [0]);
});

/* ---------------- 纪念卡内容 ---------------- */

test('the first boss win mints one card carrying the round identity', () => {
  const db = mkDb();
  const run = seeded(1, 'rid-card');
  registerRunStart(db, run);
  finishBattleNode(run, { node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true }, db);
  const card = endRunProgress(run, db, true, 1700000000000);
  assert.equal(db.rewards.length, 1);
  assert.equal(card.roundId, 'rid-card');
  assert.equal(card.roundNumber, 1);
  assert.deepEqual(card.completedUnits, []);
  assert.equal(card.roundComplete, false, '只打 BOSS 不等于本轮学习范围完成');
  assert.ok(card.earnedAt, 'earnedAt 必须存在');
});

test('two bosses in the same round still yield exactly one card after a JSON restore', () => {
  const db = mkDb();
  const run = seeded(1, 'rid-two');
  registerRunStart(db, run);
  const boss = () => ({ node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true });
  finishBattleNode(run, boss(), db);
  const card = endRunProgress(run, db, true, 1700000000000);
  run.result = undefined;
  run.clearedSegment = false;             // 换段：新一段有自己的 BOSS
  run.reward = null;                       // 刷新后内存卡没了，只剩 rewardId
  const back = roundTrip(run);
  finishBattleNode(back, { node: back.rows.at(-1)[0], myHp: 40, shield: 0, boss: true, won: true }, db);
  const again = endRunProgress(back, db, true, 1700000099999);
  assert.equal(again.id, card.id, '同一轮的卡 id 必须固定');
  assert.equal(again.earnedAt, card.earnedAt, '★ earnedAt 固定，不因第二次结算改写');
  assert.equal(db.rewards.length, 1, '★ 一轮最多一张卡');
});

test('later stages update the same card instead of minting a new one', () => {
  const db = mkDb();
  const run = seeded(1, 'rid-grow');
  registerRunStart(db, run);
  finishBattleNode(run, { node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true }, db);
  const card = endRunProgress(run, db, true, 1700000000000);
  // 打完 BOSS 后继续学：Unit 1..6 的目标词在本轮全部整词完成。
  for (const u of [1, 2, 3, 4, 5, 6]) drainUnit(run, u);
  run.kills = 42; run.att = 10; run.attOk = 9; run.maxFloor = 8;
  run.result = undefined; run.reward = null;
  const again = endRunProgress(run, db, true, 1700000012345);
  assert.equal(again.id, card.id);
  assert.equal(again.earnedAt, card.earnedAt);
  assert.equal(db.rewards.length, 1, '★ 不再生成第二张卡');
  assert.deepEqual(again.completedUnits, [1, 2, 3, 4, 5, 6]);
  assert.equal(again.roundComplete, true);
  assert.equal(again.kills, 42, '统计按同一轮的真实最新事实更新');
  assert.equal(again.accuracy, 90);
  assert.equal(again.floor, 8);
});

test('words finishing before the boss update an already-earned card without minting one', () => {
  const db = mkDb();
  const run = seeded(1, 'rid-first');
  registerRunStart(db, run);
  finishBattleNode(run, { node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true }, db);
  const card = endRunProgress(run, db, true, 1700000000000);
  for (const u of [1, 2, 3, 4, 5, 6]) drainUnit(run, u);
  run.result = undefined; run.reward = null;
  const again = endRunProgress(run, db, true, 1700000009999);
  assert.equal(db.rewards.length, 1);
  assert.equal(again.id, card.id);
  assert.equal(again.roundComplete, true, '范围完成可以后补到已有卡上');
});

test('a loss or a flee never mints a card, and never hides the one already earned', () => {
  const db = mkDb();
  const run = seeded(1, 'rid-loss');
  registerRunStart(db, run);
  const lost = endRunProgress(run, db, false, 1700000000000);
  assert.equal(lost, null);
  assert.equal(db.rewards.length, 0, '★ 战败不发卡');

  // 同一个 run 之后打赢了 BOSS：卡正常发出。
  run.result = undefined;
  run.clearedSegment = false;
  finishBattleNode(run, { node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true }, db);
  const card = endRunProgress(run, db, true, 1700000001111);
  assert.ok(card && card.id);
  assert.equal(db.rewards.length, 1);

  // 之后再失败：仍然只有那张卡，id 不变。
  run.result = undefined; run.reward = null;
  const after = endRunProgress(run, db, false, 1700000002222);
  assert.equal(db.rewards.length, 1, '★ 失败后不能冒出新卡');
  assert.equal(after.id, card.id, '仍是以前已获的那张');
});

test('a legacy save with a card that has no round fields keeps every existing value', () => {
  const db = mkDb({ rewards: [{ id: 'WR-old', unit: 2, heroId: 'ranger', accuracy: 80, kills: 3, floor: 5, earnedAt: '2020-01-01T00:00:00.000Z', extra: 'keep-me' }] });
  // 旧版 run：连 roundId 这个字段都还没有（只有进程内自增的 run.id = 'R1'）。
  const run = createRun(2, HERO, wordsFor(2));
  run.rewardId = 'WR-old';                 // 旧版只有 id 这一个轮次事实
  finishBattleNode(run, { node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true }, db);
  const card = endRunProgress(run, db, true, 1700000000000);
  assert.equal(db.rewards.length, 1, '复用旧卡，不新增');
  assert.equal(card.roundNumber, undefined, '★ 不猜编号');
  assert.equal(card.roundId, undefined, '★ 不猜身份');
  assert.equal(card.extra, 'keep-me', '未知字段原样保留');
});
