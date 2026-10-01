/* 轮次纪念卡（任务 8，docs/feature-rounds.md）的纯规则契约。
 *
 * 三条口径：
 *  1) 轮次身份是**事实**：roundId 持久化在 run 上（不同于进程内自增的 run.id = R1），
 *     roundNumber 在真正新开一轮 registerRunStart 成功之后才从 DB.runs 取。
 *     绝不按卡片数量 / wins 猜，也绝不从旧恢复补填。
 *  2) 一轮最多一张卡：rewardId 跨刷新复用，后来的结算只更新同一张卡。
 *  3) 完成范围只认「本轮整词完成」的证据：到过某个单元、半词、跳过 BOSS 都不算。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import {
  createRun, finishBattleNode, endRunProgress, registerRunStart, assignRoundId, syncRoundCard,
} from '../../src/domain/run.js';
import {
  recordRoundUnitComplete, roundScopeUnits, roundCompletion, applyUnitTransition,
} from '../../src/domain/campaign.js';
import { learningCounts } from '../../src/domain/word-selection.js';
import { initializeDB } from '../../src/services/storage.js';

const HERO = { id: 'ranger', mod: { hp: 0, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const wordsFor = u => WORDS.filter(w => w.u === u);
const mkDb = (over = {}) => initializeDB({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [], ...over });
const bossNode = run => run.rows[run.rows.length - 1][0];
const bossBattle = run => ({ node: bossNode(run), myHp: 50, shield: 0, boss: true, elite: false, won: true });
const fleeBattle = run => ({ node: bossNode(run), myHp: 20, shield: 0, boss: true, elite: false, won: false });
const plainBattle = run => ({ node: run.rows[0][0], myHp: 50, shield: 0, boss: false, elite: false, won: true });

/* runtime 的真实接线：注入一个 roundId（crypto.randomUUID 的替身）再登记次数。 */
function startRound(db, unit, roundId, { restored = false } = {}) {
  const run = createRun(unit, HERO, wordsFor(unit));
  assignRoundId(run, roundId);
  registerRunStart(db, run, { restored });
  return run;
}

/* ---------------- 1. 轮次编号与身份 ---------------- */

test('two real starts get increasing round numbers and different round ids', () => {
  const db = mkDb();
  const a = startRound(db, 1, 'rid-a');
  assert.equal(db.runs, 1);
  assert.equal(a.roundNumber, 1, '★ 轮次编号取自真正开局之后的 DB.runs');
  assert.equal(a.roundId, 'rid-a');

  // 第一轮结算掉，再开第二轮。
  finishBattleNode(a, bossBattle(a), db);
  endRunProgress(a, db, true, 1700000000000);
  const b = startRound(db, 2, 'rid-b');
  assert.equal(db.runs, 2);
  assert.equal(b.roundNumber, 2, '编号递增');
  assert.notEqual(b.roundId, a.roundId, '★ roundId 必须是独立的持久身份');
});

test('a restored round keeps its number, and a restored start never backfills one', () => {
  const db = mkDb({ runs: 4 });
  const run = createRun(3, HERO, wordsFor(3));
  assignRoundId(run, 'rid-live');
  registerRunStart(db, run);                       // 真正开局：DB.runs 4 → 5
  assert.equal(run.roundNumber, 5);

  // 刷新/读档：恢复不是新开一轮，编号与身份都原样。
  registerRunStart(db, run, { restored: true });
  assert.equal(run.roundNumber, 5, '同轮恢复编号固定');
  assert.equal(db.runs, 5, '恢复不加次数');
  assert.equal(registerRunStart(db, run), false, '重复登记无效');

  // 旧内存态/旧快照：根本没有轮次事实时**不许**按 db.runs 补一个编号出来。
  const legacy = createRun(3, HERO, wordsFor(3));
  registerRunStart(db, legacy);
  assert.equal(legacy.roundNumber, 6, '真正新开的一轮照常取编号');
  const orphan = createRun(3, HERO, wordsFor(3));
  registerRunStart(db, orphan, { restored: true });
  assert.equal(orphan.roundNumber, undefined, '★ 恢复出来的旧 run 不许补填编号');
});

test('assignRoundId rejects junk without inventing an identity', () => {
  const run = createRun(1, HERO, wordsFor(1));
  assert.equal(assignRoundId(run, 'rid-1'), 'rid-1');
  assert.equal(run.roundId, 'rid-1');
  for (const junk of [7, '', null, {}, []]) {
    const r2 = createRun(1, HERO, wordsFor(1));
    assert.equal(assignRoundId(r2, junk), null, '脏 roundId 不许变成身份');
    assert.equal(r2.roundId, undefined);
  }
});

/* ---------------- 2. 本轮完成范围 ---------------- */

test('completed units come from real whole-word completion, not from having visited a unit', () => {
  const run = startRound(mkDb(), 3, 'rid-scope');
  assert.deepEqual(run.completedUnits, [], '开局没有任何完成事实');
  drainPool(run);   // 真实路径：把本单元的词一个一个整词答对
  assert.equal(recordRoundUnitComplete(run, 3), true);
  assert.equal(recordRoundUnitComplete(run, 3), false, '同一单元幂等');
  assert.deepEqual(run.completedUnits, [3]);
  assert.deepEqual(roundScopeUnits(run), [3, 4, 5, 6], '★ 起点 Unit 3 的目标是 3..6，不是 1..6');
  assert.equal(roundCompletion(run).complete, false, '3..6 只完成 3 → 不算整轮范围完成');
});

test('clearing a boss or skipping a node never marks a unit vocabulary-complete', () => {
  const db = mkDb();
  const run = startRound(db, 1, 'rid-boss');
  finishBattleNode(run, plainBattle(run), db);
  finishBattleNode(run, bossBattle(run), db);
  assert.deepEqual(run.completedUnits, [], '★ BOSS 通关只是击败事实，不是整词完成的证据');
  const b2 = createRun(1, HERO, wordsFor(1));
  finishBattleNode(b2, fleeBattle(b2), mkDb());
  assert.deepEqual(b2.completedUnits, [], '逃跑/战败不记完成');
});

test('a run that starts at Unit 3 never claims Unit 1 or 2', () => {
  const db = mkDb({ mastered: wordsFor(1).map(w => w.w).concat(wordsFor(2).map(w => w.w)) });
  const run = startRound(db, 3, 'rid-3');
  // 历史存档里 Unit 1/2 的词全部掌握：绝不能因此把本轮范围记成 1..6 完成。
  assert.deepEqual(roundScopeUnits(run), [3, 4, 5, 6]);
  for (const u of [3, 4, 5, 6]) { drainPool(run); assert.equal(recordRoundUnitComplete(run, u), true); }
  assert.deepEqual(run.completedUnits, [3, 4, 5, 6]);
  drainPool(run);
  assert.equal(recordRoundUnitComplete(run, 1), false, '★ 范围外的单元不记录');
  assert.equal(recordRoundUnitComplete(run, 2), false);
  assert.deepEqual(run.completedUnits, [3, 4, 5, 6]);
  assert.equal(roundCompletion(run).complete, true, '本轮学习范围（3..6）已完成');
});

test('a custom round is scoped to unit 0 only', () => {
  const run = createRun(0, HERO, [{ w: 'cat', u: 0, d: 1, z: '猫' }]);
  assignRoundId(run, 'rid-c');
  assert.deepEqual(roundScopeUnits(run), [0]);
  assert.equal(roundCompletion(run).complete, false);
  drainPool(run);
  assert.equal(recordRoundUnitComplete(run, 0), true);
  assert.equal(roundCompletion(run).complete, true);
  assert.equal(recordRoundUnitComplete(run, 1), false, '自定义轮次不记教材单元');
});

/* ---------------- 4. 本轮整词证据闸门（L1）---------------- */

/* 把一条 run 的词池抽干（模拟真实地把每个词都整词答对一次）。
 * 这是「本轮真的完成了这个单元」唯一合法的证据形态。 */
function drainPool(run) {
  for (const w of run.pool) run.done.add(w.w);
}

test('recording a unit requires real whole-word coverage of that unit pool', () => {
  const run = startRound(mkDb(), 3, 'rid-gate');
  // 历史 mastered 里 Unit 3 全掌握，但**本轮一个词都没答过**：
  // 跨单元解锁是合法的（口径不变），可本轮完成范围一个单元都不能记。
  assert.deepEqual(run.completedUnits, []);
  assert.equal(recordRoundUnitComplete(run, 3), false, '★ 空证据不许记本轮完成');
  assert.deepEqual(run.completedUnits, []);

  // 抽了一半：仍然不许。
  const pool = run.pool.slice();
  for (const w of pool.slice(0, Math.ceil(pool.length / 2))) run.done.add(w.w);
  assert.equal(learningCounts(run).remaining > 0, true);
  assert.equal(recordRoundUnitComplete(run, 3), false, '★ 部分覆盖不许记本轮完成');
  assert.deepEqual(run.completedUnits, []);

  // 真的抽干：这一条才是证据。
  drainPool(run);
  assert.equal(learningCounts(run).remaining, 0);
  assert.equal(recordRoundUnitComplete(run, 3), true);
  assert.deepEqual(run.completedUnits, [3]);
});

test('an empty pool never counts as a completed unit', () => {
  const run = createRun(3, HERO, []);
  assignRoundId(run, 'rid-empty');
  assert.equal(learningCounts(run).total, 0);
  assert.equal(recordRoundUnitComplete(run, 3), false, '★ 没有词就没有完成可言');
  assert.deepEqual(run.completedUnits, []);
  assert.equal(roundCompletion(run).complete, false);
});

test('the caller may pass the pre-transition pool as the coverage evidence', () => {
  // ★ 这就是 runtime 的真实顺序：applyUnitTransition 之后 G.pool 已经是**下一个**
  //   单元的词池了。那时再看 G 就等于用新单元的覆盖去给旧单元记完成。
  const run = startRound(mkDb({ mastered: wordsFor(1).map(w => w.w) }), 1, 'rid-pre');
  const fromPool = run.pool.slice();          // 过渡前抓的真实词池
  assert.ok(fromPool.length > 0);
  // 过渡前先把 Unit 1 抽干（真实路径：抽词抽干 → 检查点）。
  for (const w of fromPool) run.done.add(w.w);

  const applied = applyUnitTransition(run, { ok: true, from: 1, to: 2 }, { words: wordsFor(2) });
  assert.ok(applied);
  assert.equal(run.unit, 2);
  assert.notDeepEqual(run.pool, fromPool, '★ 此时 G.pool 已经是 Unit 2 的');

  // 不给 fromPool：Unit 1 的词一个都不在 run.done 里 → 拒绝（这正是 bug 的形态）。
  assert.equal(recordRoundUnitComplete(run, 1), false);
  assert.deepEqual(run.completedUnits, []);
  // 给了 fromPool：Unit 1 的真实完成证据 → 记录。
  assert.equal(recordRoundUnitComplete(run, 1, { pool: fromPool }), true);
  assert.deepEqual(run.completedUnits, [1]);
});

test('an out-of-scope unit is refused even with complete coverage', () => {
  const run = startRound(mkDb(), 2, 'rid-scope2');
  drainPool(run);
  assert.equal(recordRoundUnitComplete(run, 1), false, '★ 范围外单元即使词全答对也不记录');
  assert.equal(recordRoundUnitComplete(run, 2), true);
  assert.equal(recordRoundUnitComplete(run, 2), false, '幂等');
  assert.deepEqual(run.completedUnits, [2]);
});

/* ---------------- 5. 既有卡即时同步（L2）---------------- */

test('syncRoundCard updates an existing card in place without minting or touching wins', () => {
  const db = mkDb();
  const run = startRound(db, 1, 'rid-sync');
  // 先真打一场 BOSS 拿到卡。
  finishBattleNode(run, bossBattle(run), db);
  const earnedAt = '2026-01-02T03:04:05.000Z';
  const card = endRunProgress(run, db, true, 1700000000000, earnedAt);
  assert.ok(card && card.id, '结算发卡');
  const id = card.id;
  assert.deepEqual(card.completedUnits, []);
  assert.equal(card.roundComplete, false);
  const winsAfterMint = db.wins;

  // 本轮学完 Unit 1 → 2 → 3（真实证据：每个单元抽干）。
  for (const u of [1, 2]) {
    const fromPool = run.pool.slice();
    for (const w of fromPool) run.done.add(w.w);
    assert.equal(recordRoundUnitComplete(run, u, { pool: fromPool }), true);
    if (u < 3) assert.ok(applyUnitTransition(run, { ok: true, from: u, to: u + 1 }, { words: wordsFor(u + 1) }));
  }

  // ★ 不结算就同步：卡就地更新，绝不新发一张。
  const synced = syncRoundCard(run, db);
  assert.ok(synced, '★ 已有的卡必须被找到');
  assert.equal(synced.id, id, '★ 复用同一张卡');
  assert.equal(db.rewards.length, 1, '★ 绝不多发一张');
  assert.deepEqual(synced.completedUnits, [1, 2]);
  assert.equal(synced.roundComplete, false, '范围 1..6 还没全完成');
  assert.equal(db.wins, winsAfterMint, '★ 同步不动通关数');
  assert.equal(run.result, true, '★ 同步不结束这一局（结算留下的 result 原样）');
  assert.equal(synced.earnedAt, earnedAt, '★ 获得时间固定：同步不是重新获得');
  assert.equal(synced.roundNumber, 1);
  assert.equal(synced.roundId, 'rid-sync');
  // 之后真的结算：仍然同一张卡。
  endRunProgress(run, db, true, 1700000005000, '2026-01-02T09:00:00.000Z');
  assert.equal(db.rewards.length, 1);
  assert.equal(db.rewards[0].id, id);
  assert.equal(db.rewards[0].earnedAt, earnedAt, '★ 结算也不改获得时间');
});

test('syncRoundCard returns null and mints nothing when this round has no card', () => {
  const db = mkDb();
  const run = startRound(db, 1, 'rid-nocard');
  drainPool(run);
  assert.equal(recordRoundUnitComplete(run, 1, { pool: run.pool }), true);
  assert.equal(syncRoundCard(run, db), null, '★ 没有卡就返回 null，绝不凭空 mint');
  assert.equal(db.rewards.length, 0);
});

test('syncRoundCard never completes a round from partial progress', () => {
  const db = mkDb();
  const run = startRound(db, 6, 'rid-partial');
  finishBattleNode(run, bossBattle(run), db);
  endRunProgress(run, db, true, 1700000000000);
  // 历史 mastered 让 Unit 6 立刻算完成，但本轮一个词都没答。
  drainPool(run);   // 只把 Unit 6 抽干，范围 6..6 之外的没有证据
  syncRoundCard(run, db);
  assert.deepEqual(db.rewards[0].completedUnits, []);
  assert.equal(db.rewards[0].roundComplete, false, '★ 本轮只覆盖 Unit 6，范围就是 [6]');
});

test('a round started at Unit 3 syncs scope [3..6], never the whole book', () => {
  const db = mkDb();
  const run = startRound(db, 3, 'rid-3sync');
  finishBattleNode(run, bossBattle(run), db);
  endRunProgress(run, db, true, 1700000000000);
  for (const u of [3, 4, 5]) {
    const fromPool = run.pool.slice();
    for (const w of fromPool) run.done.add(w.w);
    recordRoundUnitComplete(run, u, { pool: fromPool });
    if (u < 6) applyUnitTransition(run, { ok: true, from: u, to: u + 1 }, { words: wordsFor(u + 1) });
  }
  syncRoundCard(run, db);
  assert.deepEqual(db.rewards[0].completedUnits, [3, 4, 5]);
  assert.equal(db.rewards[0].roundComplete, false, '3..6 只完成 3 个 → 不算整轮范围完成');
  // 补完 Unit 6：这时才真的完成。
  drainPool(run);
  assert.equal(recordRoundUnitComplete(run, 6, { pool: run.pool }), true);
  syncRoundCard(run, db);
  assert.deepEqual(db.rewards[0].completedUnits, [3, 4, 5, 6]);
  assert.equal(db.rewards[0].roundComplete, true);
  assert.equal(db.rewards.length, 1);
});

test('completing the scope inside one campaign keeps the same round identity', () => {
  const db = mkDb();
  const run = startRound(db, 1, 'rid-chain');
  for (const u of [1, 2, 3, 4, 5, 6]) {
    drainPool(run);
    assert.equal(recordRoundUnitComplete(run, u), true, '本轮整词抽干后应记录：' + u);
    if (u < 6) {
      const applied = applyUnitTransition(run, { ok: true, from: u, to: u + 1 }, { words: wordsFor(u + 1) });
      assert.ok(applied, '过渡必须真的生效：' + u);
    }
  }
  assert.equal(run.unit, 6);
  assert.equal(run.roundId, 'rid-chain', '★ 1→6 同一轮，roundId 不变');
  assert.equal(run.roundNumber, 1, '编号不因跨段变化');
  assert.equal(db.runs, 1, '跨单元不加次数');
  assert.equal(roundCompletion(run).complete, true);
  assert.deepEqual(run.completedUnits, [1, 2, 3, 4, 5, 6]);
});
