import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../src/domain/run.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { ENEMIES } from '../../src/data/enemies.js';

const q = (over = {}) => ({ wrong: 0, hint: 0, listen: 0, revealed: 0, ...over });
const stats = (over = {}) => ({ words: 0, perfect: 0, good: 0, rescue: 0,
  hintsUsed: 0, wrongLetters: 0, listenUsed: 0, ...over });
function envelope() {
  const word = { w: 'keep', z: '保持', u: 1, d: 1 };
  const run = createRun(1, { id: 'scholar', mod: {} }, [word]);
  run.node = run.rows[0][0]; run.avail = [];
  const battle = { word, letters: [...word.w], used: [true, false, false, false],
    bad: [false, false, false, false], node: run.node, foe: ENEMIES[0],
    boss: false, elite: false, myHp: 70, enHp: 300, enMax: 400, shield: 0,
    input: ['k'], sel: 1, hints: 2, hintUsed: 1, hintTotal: 1,
    combo: 1, maxCombo: 1, dmgBonus: 0, firstWrong: true, lethUsed: 0,
    wordsDone: 0, over: false, won: false, mistaken: [], wordStreak: 0,
    rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1, usedThisFight: {},
    rewardTaken: false, finished: false, wordQ: q({ hint: 1, listen: 1, revealed: 1 }) };
  run.qStats = stats({ words: 3, perfect: 1, good: 1, rescue: 1,
    hintsUsed: 4, wrongLetters: 2, listenUsed: 1 });
  return { phase: PHASE.BATTLE, run, battle, encounter: null };
}

test('quality snapshot: valid facts survive JSON, do not alias live objects', () => {
  const env = envelope();
  const encoded = encodeSnapshot(env);
  assert.deepEqual(encoded.run.qStats, env.run.qStats);
  assert.deepEqual(encoded.battle.wordQ, env.battle.wordQ);
  assert.notEqual(encoded.run.qStats, env.run.qStats);
  assert.notEqual(encoded.battle.wordQ, env.battle.wordQ);
  const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encoded)));
  assert.equal(decoded.ok, true, decoded.reason);
  assert.deepEqual(decoded.value.run.qStats, env.run.qStats);
  assert.deepEqual(decoded.value.battle.wordQ, env.battle.wordQ);
  assert.deepEqual(encodeSnapshot(decoded.value).run.qStats, encoded.run.qStats);
  assert.deepEqual(encodeSnapshot(decoded.value).battle.wordQ, encoded.battle.wordQ);
});

test('quality snapshot: old missing fields remain readable and conservatively imperfect', () => {
  const env = envelope(); delete env.run.qStats; delete env.battle.wordQ;
  const encoded = encodeSnapshot(env);
  assert.equal(Object.hasOwn(encoded.run, 'qStats'), false);
  assert.equal(Object.hasOwn(encoded.battle, 'wordQ'), false);
  const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encoded)));
  assert.equal(decoded.ok, true, decoded.reason);
  assert.deepEqual(decoded.value.run.qStats, stats());
  assert.deepEqual(decoded.value.battle.wordQ, q({ wrong: 1 }));
});

test('quality snapshot: dirty word counters are neither written nor accepted', () => {
  for (const value of [-1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ['wrong', 'hint', 'listen', 'revealed']) {
      const env = envelope(); env.battle.wordQ = q({ [field]: value });
      assert.equal(encodeSnapshot(env), null, `${field}: ${value}`);
      const wire = encodeSnapshot(envelope()); wire.battle.wordQ = q({ [field]: value });
      assert.equal(decodeSnapshot(wire).ok, false);
    }
  }
  for (const bad of [{ wrong: 0 }, [], new Set(), 'nope']) {
    const env = envelope(); env.battle.wordQ = bad;
    assert.equal(encodeSnapshot(env), null);
  }
});

test('quality snapshot: dirty or inconsistent run totals fail closed', () => {
  for (const value of [-1, 0.5, '0', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of Object.keys(stats())) {
      const env = envelope(); env.run.qStats = stats({ [field]: value });
      assert.equal(encodeSnapshot(env), null, `${field}: ${value}`);
      const wire = encodeSnapshot(envelope()); wire.run.qStats = stats({ [field]: value });
      assert.equal(decodeSnapshot(wire).ok, false);
    }
  }
  for (const bad of [{ words: 1 }, stats({ words: 1 }), [], new Set(), 'nope']) {
    const env = envelope(); env.run.qStats = bad;
    assert.equal(encodeSnapshot(env), null);
  }
});
