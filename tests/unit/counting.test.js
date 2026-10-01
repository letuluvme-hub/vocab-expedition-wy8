// 计数不变式：远征次数（DB.runs）与通关次数（DB.wins）。
// 纯规则测试：不碰 DOM、不碰 localStorage，只验证 domain 层的计数入口。
//
// 语义（来自 docs/product-backlog.md 任务 A.1）：
//   runs  —— 只在「真正新开一轮」时 +1；恢复/读档不 +1；同一次启动意图重复触发不重复计。
//   wins  —— 只在「本次远征真打赢 BOSS」时 +1；逃跑/跳过/失败不计；同一轮最多 +1（幂等）。
//   历史存档里的既有 totals 一律原样保留，不做任何回填或折算。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, finishBattleNode, registerRunStart, registerRunWin, isDuplicateRunStart, endRunProgress,
} from '../../src/domain/run.js';
import { initializeDB } from '../../src/services/storage.js';

const HERO = { id: 'h', mod: { hp: 10 } };
const WORDS = [
  { w: 'litre', z: '升' },
  { w: 'keep', z: '保持' },
  { w: 'an eye on', z: '留意' },
];
const mkDb = (over = {}) => initializeDB({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [], ...over });

const bossNode = run => run.rows[run.rows.length - 1][0];
const bossBattle = run => ({ node: bossNode(run), myHp: 50, shield: 0, boss: true, elite: false, won: true });

/* ================= 唯一计数入口 ================= */

test('every created run gets a distinct id so counting can key on it', () => {
  const ids = new Set([createRun(1, HERO, WORDS).id, createRun(1, HERO, WORDS).id, createRun(2, HERO, WORDS).id]);
  assert.equal(ids.size, 3, 'run ids must not repeat');
});

test('registerRunStart counts one new expedition per run object', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  assert.equal(registerRunStart(db, run), true);
  assert.equal(db.runs, 1);
});

test('registerRunStart is idempotent for the same run (repeat start intent)', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  assert.equal(registerRunStart(db, run), false);
  assert.equal(registerRunStart(db, run), false);
  assert.equal(db.runs, 1, 'the same run must never be counted twice');
});

test('registerRunStart never counts a restored expedition', () => {
  const db = mkDb({ runs: 9 });
  const run = createRun(1, HERO, WORDS);
  assert.equal(registerRunStart(db, run, { restored: true }), false);
  assert.equal(db.runs, 9, 'restoring is not starting a new expedition');
});

test('re-registering a restored run keeps it counted exactly once', () => {
  const db = mkDb();
  const run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  assert.equal(db.runs, 1);
  // A later restore replays the same accounting entry; it must not add a second expedition.
  assert.equal(registerRunStart(db, run, { restored: true }), false);
  assert.equal(registerRunStart(db, run), false);
  assert.equal(db.runs, 1);
});

test('registerRunStart refuses a null run or db instead of throwing', () => {
  assert.equal(registerRunStart(mkDb(), null), false);
  assert.equal(registerRunStart(null, createRun(1, HERO, WORDS)), false);
});

test('restoring first pins the run as counted, so a later plain start cannot add one', () => {
  const db = mkDb({ runs: 9 });
  const run = createRun(1, HERO, WORDS);
  assert.equal(registerRunStart(db, run, { restored: true }), false);
  assert.equal(db.runs, 9);
  // The restore already claimed this run's single start slot. A later plain call
  // (replay, future resume flow) must see that slot as used, not as a fresh start.
  assert.equal(registerRunStart(db, run), false);
  assert.equal(db.runs, 9, 'a restored run must never be counted, before or after the restore call');
});

test('two different runs are two real expeditions', () => {
  const db = mkDb();
  registerRunStart(db, createRun(1, HERO, WORDS));
  registerRunStart(db, createRun(1, HERO, WORDS));
  assert.equal(db.runs, 2);
});

test('registerRunWin counts at most one clear per run', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  assert.equal(registerRunWin(db, run), true);
  assert.equal(registerRunWin(db, run), false);
  assert.equal(db.wins, 1);
});

/* ================= 通关次数 ================= */

test('a real BOSS victory settles exactly one clear', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'boss-win');
  assert.equal(db.wins, 1);
});

test('a second BOSS battle inside the same run cannot clear twice', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  // Same run, a different battle object: the per-battle `finished` flag no longer applies,
  // so the run-level `clearedRun` is the idempotency key. The repeat is not a win at all
  // (new semantics): it must not heal, must not touch the node, must not settle.
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'ignored');
  assert.equal(db.wins, 1, 'one expedition can only be cleared once');
});

test('a BOSS repeat after the run is cleared has no side effects at all', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'boss-win');
  const hpAfterWin = run.hp, shieldAfterWin = run.shield;
  const dbAfterWin = { ...db };
  // A different boss battle object with different numbers: if the run-level guard is
  // missing, these values would be written back (hp clamped to 10, shield set to 7).
  const otherNode = { ...bossNode(run), done: false };  // a node nothing has settled yet
  const repeat = { node: otherNode, myHp: 10, shield: 7, boss: true, elite: false, won: true };
  assert.equal(finishBattleNode(run, repeat, db), 'ignored');
  assert.equal(run.hp, hpAfterWin, 'the +30 clear heal must not be granted twice');
  assert.equal(run.shield, shieldAfterWin, 'shield must not be carried over from an ignored battle');
  assert.equal(otherNode.done, false, 'an ignored settlement must not mark its node done');
  assert.deepEqual(db, dbAfterWin, 'wins / best / rewards must be untouched');
});

test('repeated settlement of the very same battle object is still ignored', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  const battle = bossBattle(run);
  registerRunStart(db, run);
  finishBattleNode(run, battle, db);
  assert.equal(finishBattleNode(run, battle, db), 'ignored');
  assert.equal(db.wins, 1);
});

test('escaping, skipping or losing the BOSS never counts as a clear', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  const escape = { node: bossNode(run), myHp: 50, shield: 0, boss: true, elite: false, won: false };
  assert.equal(finishBattleNode(run, escape, db), 'boss-loss');
  assert.equal(db.wins, 0);
  // The player keeps playing after an escape: a later real win still counts once.
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'boss-win');
  assert.equal(db.wins, 1);
});

test('an ordinary node battle never counts as a clear', () => {
  const db = mkDb(), run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  for (const node of run.rows.slice(0, 4).flat()) {
    if (node.type !== 'boss') finishBattleNode(run, { node, myHp: 40, shield: 0, boss: false, elite: false, won: true }, db);
  }
  assert.equal(db.wins, 0);
  assert.equal(db.runs, 1);
});

/* ================= 新开一轮的重复触发判据 ================= */

test('isDuplicateRunStart rejects a start while an expedition is still in progress', () => {
  const run = createRun(1, HERO, WORDS);
  assert.equal(typeof run.result, 'undefined', 'a fresh run has no result yet');
  assert.equal(isDuplicateRunStart(run), true);
});

test('isDuplicateRunStart accepts a start after the previous run was settled', () => {
  for (const result of [true, false]) {
    const run = createRun(1, HERO, WORDS);
    endRunProgress(run, mkDb(), result, 1700000000000);
    assert.equal(run.result, result);
    assert.equal(isDuplicateRunStart(run), false, `a settled run (result=${result}) may be followed by a new one`);
  }
});

test('isDuplicateRunStart accepts a start after the player abandoned the run', () => {
  // mQuit / 回主页 set G to null, so there is nothing left to guard against.
  assert.equal(isDuplicateRunStart(null), false);
  assert.equal(isDuplicateRunStart(undefined), false);
});

test('a refused duplicate start leaves the counter untouched', () => {
  const db = mkDb();
  const first = createRun(1, HERO, WORDS);
  registerRunStart(db, first);
  assert.equal(isDuplicateRunStart(first), true, 'second click refused');
  assert.equal(db.runs, 1);
});

/* ================= 次数与结算的全局不变式 ================= */

test('wins never exceed started expeditions across a mixed session', () => {
  const db = mkDb();
  for (let i = 0; i < 5; i++) {
    const run = createRun(1, HERO, WORDS);
    registerRunStart(db, run);
    const won = i % 2 === 0;
    finishBattleNode(run, { ...bossBattle(run), won }, db);
  }
  assert.equal(db.runs, 5);
  assert.equal(db.wins, 3, 'odd runs escaped the BOSS');
  assert.ok(db.wins <= db.runs, 'you cannot clear more expeditions than you started');
});

test('duplicate run and clear intents leave the totals untouched', () => {
  const db = mkDb({ runs: 4, wins: 2 });
  const run = createRun(1, HERO, WORDS);
  registerRunStart(db, run); registerRunStart(db, run);
  const battle = bossBattle(run);
  finishBattleNode(run, battle, db);
  finishBattleNode(run, battle, db);
  // The third call is a *different* boss battle object for an already-cleared run:
  // now ignored by `clearedRun`, so hp / node state / totals stay as after call #1.
  const hpAfterWin = run.hp;
  assert.equal(finishBattleNode(run, bossBattle(run), db), 'ignored');
  assert.equal(run.hp, hpAfterWin);
  registerRunWin(db, run);
  assert.deepEqual([db.runs, db.wins], [5, 3]);
});

test('historical totals are preserved, never recomputed or back-filled', () => {
  const db = mkDb({ runs: 41, wins: 17, best: 9 });
  const run = createRun(3, HERO, WORDS);
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  assert.equal(db.runs, 42, 'the pre-existing 41 expeditions still count');
  assert.equal(db.wins, 18, 'the pre-existing 17 clears still count');
});

/* ================= 旧存档兼容 ================= */

test('initializeDB keeps existing numeric totals untouched', () => {
  const db = initializeDB({ runs: 12, wins: 7, mastered: [], best: 3, custom: [] });
  assert.equal(db.runs, 12);
  assert.equal(db.wins, 7);
});

test('initializeDB adds no counter fields to a sparse legacy save', () => {
  // Pre-existing baseline: initialization is not a schema migration. The counting entry
  // points coerce with `| 0` at increment time, so a missing base needs no field here.
  const sparse = { mastered: [], custom: [], rewards: [] };
  initializeDB(sparse);
  assert.equal(Object.hasOwn(sparse, 'runs'), false);
  assert.equal(Object.hasOwn(sparse, 'wins'), false);
});

test('counting on a save with missing totals still yields numbers, not NaN', () => {
  const db = initializeDB({ mastered: [], best: 0, custom: [] });
  const run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  assert.deepEqual([db.runs, db.wins], [1, 1]);
});

test('counting on a save with corrupt totals yields numbers, not NaN or a string', () => {
  const db = initializeDB({ runs: 'x', wins: null, mastered: [], best: 0, custom: [] });
  const run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  assert.equal(typeof db.runs, 'number');
  assert.equal(typeof db.wins, 'number');
  assert.deepEqual([db.runs, db.wins], [1, 1]);
});

test('a legacy save already holding totals keeps counting on top of them', () => {
  const db = initializeDB({ runs: 5, wins: 5, mastered: [], best: 0, custom: [] });
  const run = createRun(1, HERO, WORDS);
  registerRunStart(db, run);
  finishBattleNode(run, bossBattle(run), db);
  assert.deepEqual([db.runs, db.wins], [6, 6]);
});