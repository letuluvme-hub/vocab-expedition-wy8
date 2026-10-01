/* runtime 侧的轮次接线：只有两条纯函数 + 一个 id 生成器。
 * 单元测试直接驱动它，runtime.js 只调用 —— 这样「编号从 DB.runs 取、身份由
 * crypto.randomUUID 生成」这两条口径不需要起浏览器就能钉住。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, registerRunStart, assignRoundId, endRunProgress, finishBattleNode } from '../../src/domain/run.js';
import { newRoundId, noteRoundUnitComplete } from '../../src/app/rounds.js';
import { WORDS } from '../../src/data/words.js';

const HERO = { id: 'ranger', mod: { hp: 0, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const wordsFor = u => WORDS.filter(w => w.u === u);
const mkDb = (over = {}) => ({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [], ...over });
const boss = run => ({ node: run.rows.at(-1)[0], myHp: 50, shield: 0, boss: true, won: true });

/* 复刻 runtime.newRun 的接线顺序：建 run → 注入身份 → 登记次数（编号在这里取）。 */
function runtimeNewRun(db, unit) {
  const run = createRun(unit, HERO, wordsFor(unit));
  assignRoundId(run, newRoundId());
  registerRunStart(db, run);
  return run;
}

test('the generated round ids are unique and are not the process-local run id', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const id = newRoundId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0, '身份必须存在');
    assert.ok(!/^R[0-9a-z]+$/.test(id), '不能退回进程内自增的 run.id 形状');
    ids.add(id);
  }
  assert.equal(ids.size, 50, '50 次开局不许撞 id');
});

test('two runs started through the runtime wiring get number 1 then 2', () => {
  const db = mkDb();
  const a = runtimeNewRun(db, 1);
  assert.equal(a.roundNumber, 1);
  assert.ok(a.roundId);
  finishBattleNode(a, boss(a), db);
  endRunProgress(a, db, true, 1700000000000);
  const b = runtimeNewRun(db, 2);
  assert.equal(b.roundNumber, 2);
  assert.notEqual(b.roundId, a.roundId);
  assert.equal(db.rewards.length, 1);
});

test('the round completion note needs real coverage and is idempotent and scoped', () => {
  const run = runtimeNewRun(mkDb(), 3);
  // ★ 一个词都没答过就不许记完成：这条闸门就是跨单元解锁不被当成本轮完成的保证。
  assert.equal(noteRoundUnitComplete(run), false);
  assert.deepEqual(run.completedUnits, []);
  for (const w of run.pool) run.done.add(w.w);
  assert.equal(noteRoundUnitComplete(run), true);
  assert.equal(noteRoundUnitComplete(run), false);
  assert.deepEqual(run.completedUnits, [3]);
});

test('noteRoundUnitComplete tolerates a missing run instead of throwing', () => {
  assert.equal(noteRoundUnitComplete(null), false);
});
