import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { createRun } from '../../src/domain/run.js';
import { hitDmg, wordDmg } from '../../src/domain/damage.js';
import { wordComplete } from '../../src/domain/learning.js';
import { estimateWordDamage } from '../../src/domain/word-choice.js';
import { norm } from '../../src/domain/text.js';
import { createWordQ } from '../../src/domain/word-quality.js';
import { HEROES } from '../../src/data/heroes.js';
import { ITEMS } from '../../src/data/items.js';
import { ENEMIES } from '../../src/data/enemies.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';

function harness(hero = 'ranger', word = 'abcdefghijklmnopqrstuv') {
  const G = createRun(1, HEROES.find(h => h.id === hero), [{ w: word, z: '测试', u: 1, d: 1 }], () => 0.2);
  G.bag = {}; G.node = G.rows[0][0]; G.avail = [];
  let B = { word: G.pool[0], node: G.node, foe: ENEMIES[0], myHp: 10,
    enHp: 100000, enMax: 100000, shield: 0, hints: 3, hintUsed: 0, hintTotal: 0,
    combo: 0, maxCombo: 0, dmgBonus: 0, wordsDone: 0, wordStreak: 0,
    firstWrong: true, lethUsed: 0, rageLeft: 0, freezeWord: false, chainNext: false,
    goldMult: 1, usedThisFight: {}, mistaken: [], over: false, boss: false, elite: false,
    letterProgress: 0, heroHealed: 0, heroShieldGained: 0 };
  const DB = { mastered: [], reviewQueue: [] };
  const resetWord = () => Object.assign(B, { letters: [...norm(word), 'z'],
    used: Array(norm(word).length + 1).fill(false), bad: Array(norm(word).length + 1).fill(false),
    input: [], sel: 0, wordQ: createWordQ(), letterProgress: 0, hintUsed: 0, hintTotal: 0,
    combo: 0, freezeWord: false });
  resetWord();
  const noop = () => {};
  let attackAttempts = 0, completed = 0;
  const ports = { $: () => null, norm, clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
    rnd: () => 1, hasR: id => G.relics.includes(id), itemById: id => ITEMS.find(it => it.id === id),
    hitDmg: () => hitDmg(G, B), wordDmg: () => wordDmg(G, B), wordComplete: () => wordComplete(B),
    creditWord: () => { completed++; }, onWordWrong: w => G.wrong.push(w),
    centerOf: () => ({ x: 0, y: 0 }), heroPoint: () => ({ x: 0, y: 0 }), toast: noop,
    sfx: new Proxy({}, { get: () => noop }), TTS: new Proxy({}, { get: () => noop }),
    burst: noop, floatTxt: noop, flash: noop, ring: noop, animHero: noop, wordFinisher: noop,
    foeCry: noop, renderFight: noop, nextWord: resetWord, winFight: noop,
    loseFight: () => { B.over = true; }, finishNode: noop, saveDB: noop, scheduleBattle: noop,
    notifyLetterAttempted: () => { attackAttempts++; } };
  const state = { G, DB, get B() { return B; } };
  const combat = createCombatController({ state, ports });
  return { G, DB, get B() { return B; }, combat, resetWord,
    get attempts() { return attackAttempts; }, get completed() { return completed; },
    finish() { for (const ch of norm(word)) combat.typeLetter(ch); },
    snapshot() { return encodeSnapshot({ run: G, battle: B, phase: PHASE.BATTLE, encounter: null }); },
    reload() { const got = decodeSnapshot(JSON.parse(JSON.stringify(this.snapshot())));
      assert.equal(got.ok, true, got.reason); Object.assign(G, got.value.run); B = got.value.battle; } };
}

test('backspace/retype cannot farm damage, healing, combo bonuses, or attack interruption', () => {
  const h = harness();
  for (const ch of 'abcde') h.combat.typeLetter(ch);
  const before = { hp: h.B.myHp, foe: h.B.enHp, bonus: h.B.dmgBonus, attempts: h.attempts };
  for (let i = 0; i < 40; i++) { h.combat.undoLetter(); h.combat.typeLetter('e'); }
  assert.deepEqual({ hp: h.B.myHp, foe: h.B.enHp, bonus: h.B.dmgBonus, attempts: h.attempts }, before);
  assert.equal(h.completed, 0);
});

test('a legacy half-word snapshot cannot re-award positions after undo and reload', () => {
  const h = harness();
  for (const ch of 'abcde') h.combat.typeLetter(ch);
  delete h.B.letterProgress; // Valid pre-balance saves have no position ledger.
  h.reload();
  const before = [h.B.myHp, h.B.enHp, h.B.dmgBonus, h.attempts];
  for (let i = 0; i < 5; i++) h.combat.undoLetter();
  h.reload();
  for (const ch of 'abcde') h.combat.typeLetter(ch);
  assert.deepEqual([h.B.myHp, h.B.enHp, h.B.dmgBonus, h.attempts], before);
  assert.equal(h.B.letterProgress, 5);
});

test('retyping cannot rebuild combo cleared by rage or a spelling mistake', () => {
  for (const penalty of ['rage', 'wrong']) {
    const h = harness();
    for (const ch of 'abcdefghij') h.combat.typeLetter(ch);
    if (penalty === 'rage') { h.G.bag.rage = 1; h.combat.useItem('rage'); }
    else h.combat.typeLetter('z');
    assert.equal(h.B.combo, 0);
    for (let i = 0; i < 10; i++) h.combat.undoLetter();
    h.reload();
    for (const ch of 'abcdefghij') h.combat.typeLetter(ch);
    assert.equal(h.B.combo, 0, penalty);
    assert.equal(h.B.rageLeft, penalty === 'rage' ? 3 : 0);
    h.combat.typeLetter('k'); assert.equal(h.B.combo, 1);
  }
});

test('current-word damage preview matches actual remaining hits with late rage and retyped positions', () => {
  for (const undo of [false, true]) {
    const h = harness('lucky', 'abcde'); h.G.bag.rage = 1;
    h.combat.typeLetter('a'); h.combat.typeLetter('b');
    if (undo) { h.combat.undoLetter(); h.combat.undoLetter(); }
    h.combat.useItem('rage');
    h.B.chainNext = true; h.G.relics = ['focus'];
    const before = h.B.enHp;
    const stateBefore = structuredClone(h.B);
    const estimate = estimateWordDamage(h.G, h.B, h.B.word);
    assert.deepEqual(h.B, stateBefore, 'preview is read-only');
    for (const ch of undo ? 'abcde' : 'cde') h.combat.typeLetter(ch);
    assert.equal(estimate.total, before - h.B.enHp, `undo=${undo}`);
    assert.equal(h.B.rageLeft, 0);
  }
});

test('ranger heals at most 18 per battle and the budget survives reload and a new word', () => {
  const h = harness(); h.G.milestones = { steady: true, flow: true, insight: true }; h.finish();
  assert.equal(h.B.myHp, 28); assert.equal(h.B.heroHealed, 18);
  h.B.myHp = 10; h.reload(); h.finish();
  assert.equal(h.B.myHp, 10); assert.equal(h.B.heroHealed, 18);
});

test('thornwall responds to real incoming damage even when a shield absorbs it', () => {
  const h = harness('lucky'); h.G.relics = ['shield', 'thorn']; h.B.shield = 20;
  h.combat.typeLetter('b');
  assert.equal(h.B.myHp, 10); assert.equal(h.B.shield, 18);
  assert.equal(h.B.enHp, 99992);
});

test('ranger receives no healing after a mistake, active hint, or listening', () => {
  for (const help of ['wrong', 'hint', 'listen']) {
    const h = harness(); h.B.wordQ[help] = 1;
    h.combat.typeLetter('a'); assert.equal(h.B.myHp, 10, help);
  }
  const h = harness(); h.B.autoHint = 1; h.B.hintUsed = 1; h.B.wordQ.hint = 1;
  h.combat.typeLetter('a'); assert.equal(h.B.myHp, 10, 'automatic revealed letter');
  h.combat.typeLetter('b'); assert.equal(h.B.myHp, 11, 'next unassisted letter');
});

test('manual healing item does not auto-consume and restores eight actual HP', () => {
  const h = harness('lucky'); h.G.bag.leech = 3;
  h.combat.typeLetter('a'); assert.equal(h.G.bag.leech, 3); assert.equal(h.B.myHp, 10);
  h.combat.useItem('leech'); assert.equal(h.B.myHp, 18); assert.equal(h.G.bag.leech, 2);
});

test('freeze blocks autonomous attacks without altering learning evidence or shields', () => {
  const h = harness(); h.G.bag.freeze = 1; h.B.shield = 5;
  h.combat.useItem('freeze'); const before = structuredClone(h.B.wordQ);
  const hit = h.combat.enemyHit(8);
  assert.equal(hit.dealt, 0); assert.equal(h.B.myHp, 10); assert.equal(h.B.shield, 5);
  assert.deepEqual(h.B.wordQ, before);
  h.combat.typeLetter('z'); assert.equal(h.B.wordQ.wrong, 1); assert.equal(h.B.myHp, 10);
});

test('ineffective items refuse consumption for full, active, and unavailable states', () => {
  const cases = { leech: h => { h.B.myHp = h.G.maxhp; },
    rage: h => { h.B.rageLeft = 2; }, freeze: h => { h.B.freezeWord = true; },
    chain: h => { h.B.chainNext = true; }, reveal: h => { h.B.hints = 0; },
    purge: () => {}, greed: h => { h.B.goldMult = 1.5; }, stone: h => { h.B.shield = h.G.maxhp; } };
  for (const [id, setup] of Object.entries(cases)) {
    const h = harness(); h.G.bag[id] = 1; setup(h);
    h.combat.useItem(id); assert.equal(h.G.bag[id], 1, id);
    assert.equal(h.B.usedThisFight[id] || 0, 0, id);
  }
});

test('a warrior earns at most six shields per battle from whole words, never from letters', () => {
  const h = harness('warrior', 'cat');
  h.combat.typeLetter('c'); assert.equal(h.B.shield, 0);
  h.combat.typeLetter('a'); h.combat.typeLetter('t'); assert.equal(h.B.shield, 2);
  h.finish(); h.reload(); h.finish(); h.finish();
  assert.equal(h.B.shield, 6); assert.equal(h.B.heroShieldGained, 6);
});

test('scholar hints reveal two letters, spend one allowance, and cannot exceed the word', () => {
  const h = harness('scholar', 'cat');
  h.combat.requestHint(); assert.equal(h.B.hints, 2); assert.equal(h.B.hintUsed, 2);
  h.combat.requestHint(); assert.equal(h.B.hints, 1); assert.equal(h.B.hintUsed, 3);
  h.combat.requestHint(); assert.equal(h.B.hints, 1);
  assert.deepEqual(h.B.wordQ, { wrong: 0, hint: 2, listen: 0, revealed: 3 });
});

test('rage last charged letter still amplifies its whole-word finisher', () => {
  const h = harness('lucky', 'cat'); h.G.bag.rage = 1;
  h.combat.useItem('rage');
  h.combat.typeLetter('c'); h.combat.typeLetter('a');
  const before = h.B.enHp;
  const expectedBattle = { ...h.B, combo: h.B.combo + 1 };
  const expected = hitDmg(h.G, expectedBattle) + wordDmg(h.G, expectedBattle);
  h.combat.typeLetter('t'); assert.equal(before - h.B.enHp, expected);
  assert.equal(h.B.rageLeft, 0);
});

test('balance counters and rewarded positions survive snapshots; invalid budgets are rejected', () => {
  const h = harness(); h.combat.typeLetter('a'); h.combat.undoLetter(); h.reload();
  const before = [h.B.myHp, h.B.enHp]; h.combat.typeLetter('a');
  assert.deepEqual([h.B.myHp, h.B.enHp], before);
  for (const [key, value] of [['heroHealed', 19], ['heroShieldGained', 7], ['letterProgress', 1000], ['letterProgress', -1]]) {
    const snap = h.snapshot(); snap.battle[key] = value;
    assert.equal(decodeSnapshot(snap).ok, false, key);
  }
});
