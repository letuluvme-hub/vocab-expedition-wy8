/* 选词出招的存档：offer / autoHint 是**可选**字段。
 * 旧快照没有它们 —— 合法；出现就必须形状合法、且全部是本局词池里真实的词条，
 * 当前战斗词必须是候选之一。否则整份 fail closed。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../src/domain/run.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { ENEMIES } from '../../src/data/enemies.js';

const POOL = [{ w: 'pot', z: '锅', u: 1, d: 1 }, { w: 'keep', z: '保持', u: 1, d: 1 },
  { w: 'pollution', z: '污染', u: 1, d: 3 }];
function envelope(extra = {}) {
  const run = createRun(1, { id: 'scholar', mod: {} }, POOL);
  run.node = run.rows[0][0]; run.avail = [];
  const word = run.pool[1];
  const battle = Object.assign({ word, letters: [...word.w], used: [false, false, false, false],
    bad: [false, false, false, false], node: run.node, foe: ENEMIES[0],
    boss: false, elite: false, myHp: 70, enHp: 300, enMax: 400, shield: 0,
    input: [], sel: 0, hints: 2, hintUsed: 0, hintTotal: 0,
    combo: 0, maxCombo: 0, dmgBonus: 0, firstWrong: true, lethUsed: 0,
    wordsDone: 0, over: false, won: false, mistaken: [], wordStreak: 0,
    rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1, usedThisFight: {},
    rewardTaken: false, finished: false }, extra);
  return { phase: PHASE.BATTLE, run, battle, encounter: null };
}
const roundTrip = env => decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(env))));

test('offer and autoHint survive a JSON round trip as pool entries', () => {
  const env = envelope();
  env.battle.offer = [env.run.pool[0], env.run.pool[1], env.run.pool[2]];
  env.battle.autoHint = 1;
  const got = roundTrip(env);
  assert.equal(got.ok, true, got.reason);
  assert.deepEqual(got.value.battle.offer.map(w => w.w), ['pot', 'keep', 'pollution']);
  assert.equal(got.value.battle.autoHint, 1);
});

test('old snapshots without offer stay valid and decode without one', () => {
  const got = roundTrip(envelope());
  assert.equal(got.ok, true, got.reason);
  assert.equal(got.value.battle.offer, undefined);
  assert.equal(got.value.battle.autoHint, undefined);
});

test('dirty offers fail closed', () => {
  const base = encodeSnapshot(envelope({ offer: POOL.slice() }));
  const variants = [
    b => { b.offer = 'pot'; },
    b => { b.offer = [{ w: 'ghost', z: '鬼', u: 1, d: 1 }, b.word]; },        // 不在词池
    b => { b.offer = [{ w: 'pot', z: '锅', u: 1, d: 2 }, b.word]; },          // 字段对不上
    b => { b.offer = [POOL[0], POOL[2]]; },                                   // 当前词不在候选里
    b => { b.autoHint = -1; },
    b => { b.autoHint = 'x'; },
    b => { b.wordLocked = 'yes'; },
  ];
  for (const mutate of variants) {
    const snap = JSON.parse(JSON.stringify(base));
    mutate(snap.battle);
    assert.equal(decodeSnapshot(snap).ok, false, String(mutate));
  }
});

test('wordLocked survives a round trip and is omitted when false', () => {
  const env = envelope({ offer: POOL.slice(), wordLocked: true });
  const got = roundTrip(env);
  assert.equal(got.ok, true, got.reason);
  assert.equal(got.value.battle.wordLocked, true);
  assert.equal('wordLocked' in encodeSnapshot(envelope({ offer: POOL.slice(), wordLocked: false })).battle, false);
});
