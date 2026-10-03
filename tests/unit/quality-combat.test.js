import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { wordComplete } from '../../src/domain/learning.js';
import { norm } from '../../src/domain/text.js';

const q = (over = {}) => ({ wrong: 0, hint: 0, listen: 0, revealed: 0, ...over });
const stats = (over = {}) => ({ words: 0, perfect: 0, good: 0, rescue: 0,
  hintsUsed: 0, wrongLetters: 0, listenUsed: 0, ...over });
function harness({ word = 'keep', quality = q(), freeze = false } = {}) {
  const letters = [...norm(word), 'x'];
  const G = { floor: 1, maxhp: 70, hleech: 0, relics: [], bag: {}, done: new Set(),
    wrong: [], att: 0, attOk: 0, qStats: stats() };
  const B = { word: { w: word, z: '测试', u: 1, d: 1 }, letters,
    used: letters.map(() => false), bad: letters.map(() => false), input: [], sel: 0,
    hints: 3, hintUsed: 0, hintTotal: 0, wordQ: quality, combo: 0, maxCombo: 0, dmgBonus: 0,
    wordsDone: 0, wordStreak: 0, myHp: 70, enHp: 1000, enMax: 1000, shield: 0,
    firstWrong: true, lethUsed: 0, freezeWord: freeze, rageLeft: 0, chainNext: false,
    goldMult: 1, usedThisFight: {}, mistaken: [], foe: { n: '词灵', tint: '#fff' } };
  const DB = { mastered: [], reviewQueue: [] };
  const noop = () => {};
  const ports = { $: () => null, norm, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    rnd: () => 1, hasR: id => G.relics.includes(id), itemById: id => ({ id, n: id, max: 6 }),
    hitDmg: () => 10, wordDmg: () => 40, wordComplete: () => wordComplete(B),
    creditWord: w => { DB.mastered.push(w); G.done.add(w); }, onWordWrong: w => G.wrong.push(w),
    centerOf: () => ({ x: 0, y: 0 }), heroPoint: () => ({ x: 0, y: 0 }),
    toast: noop, sfx: new Proxy({}, { get: () => noop }),
    TTS: new Proxy({}, { get: () => noop }), burst: noop, floatTxt: noop, flash: noop,
    ring: noop, animHero: noop, wordFinisher: noop, foeCry: noop, renderFight: noop,
    nextWord: noop, winFight: noop, loseFight: noop, finishNode: noop, saveDB: noop,
    scheduleBattle: noop };
  const combat = createCombatController({ state: { G, B, DB }, ports });
  return { G, B, DB, combat, finish() { for (const ch of norm(word)) combat.typeLetter(ch); } };
}

test('quality: membership and order mistakes count, ignored attempts do not', () => {
  const h = harness();
  h.combat.typeLetter('p');
  h.combat.typeLetter('x');
  assert.deepEqual(h.B.wordQ, q({ wrong: 2 }));
  assert.equal(h.B.myHp, 52, 'original 6 + 12 penalty stays');
  h.combat.typeLetter('x');
  h.combat.typeLetter('z');
  h.combat.pressKey(-1);
  assert.equal(h.B.wordQ.wrong, 2, 'bad, absent and invalid letters were not accepted');
  h.combat.typeLetter('k');
  h.combat.pressKey(0);
  assert.equal(h.B.wordQ.wrong, 2, 'used slot is ignored');
});

test('quality: frozen mistakes and lucky immunity still mark the word wrong', () => {
  for (const freeze of [true, false]) {
    const h = harness({ freeze });
    h.B.lethUsed = 1;
    h.combat.typeLetter('x');
    assert.equal(h.B.wordQ.wrong, 1);
    assert.equal(h.B.myHp, 70);
  }
});

test('quality: accepted hint adds one event and letter; denied hint adds nothing', () => {
  const h = harness();
  assert.equal(h.combat.requestHint(), true);
  assert.deepEqual(h.B.wordQ, q({ hint: 1, revealed: 1 }));
  assert.equal(h.B.hints, 2, 'same hint allowance');
  h.B.hints = 0;
  assert.equal(h.combat.requestHint(), false);
  assert.equal(h.B.wordQ.hint, 1);
  h.B.hints = 2; h.B.hintUsed = 4;
  assert.equal(h.combat.requestHint(), false);
  assert.equal(h.B.wordQ.hint, 1);
});

test('quality: reveal item counts the remaining actual letters, not a hardcoded two', () => {
  const h = harness({ word: 'i' });
  h.G.bag.reveal = 1;
  h.combat.useItem('reveal');
  assert.deepEqual(h.B.wordQ, q({ hint: 1, revealed: 1 }));
  assert.equal(h.B.hints, 2);
  h.combat.useItem('reveal');
  assert.equal(h.B.wordQ.hint, 1, 'no item left means no extra help event');
});

test('quality: overlapping hint, reveal and prophecy count only new visible letters', () => {
  const h = harness();
  h.G.bag.reveal = 2;
  h.combat.requestHint();
  h.combat.useItem('reveal');
  assert.deepEqual(h.B.wordQ, q({ hint: 2, revealed: 2 }));
  h.combat.useItem('reveal');
  assert.deepEqual(h.B.wordQ, q({ hint: 2, revealed: 2 }));
  assert.equal(h.G.bag.reveal, 1, '重复揭示不花道具、不增加帮助事件');
  h.B.hints = 2;
  h.G.relics = ['prophecy'];
  h.combat.typeLetter('p');
  assert.deepEqual(h.B.wordQ, q({ wrong: 1, hint: 3, revealed: 4 }));
  assert.equal(h.G.prophecyUsed, true);
  h.combat.typeLetter('p');
  assert.deepEqual(h.B.wordQ, q({ wrong: 2, hint: 3, revealed: 4 }), 'prophecy stays once per run');
});

test('quality: prophecy after partial input reveals only the remaining letters', () => {
  const h = harness();
  h.G.relics = ['prophecy'];
  h.combat.typeLetter('k'); h.combat.typeLetter('e');
  h.combat.typeLetter('p');
  assert.deepEqual(h.B.wordQ, q({ wrong: 1, hint: 1, revealed: 2 }));
});

test('quality: only whole-word completion accumulates statistics, exactly once', () => {
  const h = harness();
  h.combat.typeLetter('k');
  assert.deepEqual(h.G.qStats, stats());
  h.combat.typeLetter('e'); h.combat.typeLetter('e'); h.combat.typeLetter('p');
  assert.deepEqual(h.G.qStats, stats({ words: 1, perfect: 1 }));
  assert.equal(h.B.enHp, 920, 'four original 10 hits plus original 40 finisher');
  assert.deepEqual(h.DB.mastered, ['keep'], 'learning rules stay');
  assert.equal(h.B.wordsDone, 1);
  assert.equal(h.B.wordStreak, 1);
  h.combat.pressKey(3);
  assert.equal(h.G.qStats.words, 1);
});

test('quality: all three grades leave damage, finisher streak and mastery unchanged', () => {
  for (const [quality, grade] of [[q(), 'perfect'], [q({ wrong: 1, listen: 2 }), 'good'],
    [q({ hint: 1, revealed: 2 }), 'rescue']]) {
    const h = harness({ quality }); h.finish();
    assert.equal(h.G.qStats[grade], 1);
    assert.equal(h.G.qStats.words, 1);
    assert.equal(h.G.qStats.hintsUsed, quality.hint);
    assert.equal(h.G.qStats.wrongLetters, quality.wrong);
    assert.equal(h.G.qStats.listenUsed, quality.listen);
    assert.equal(h.B.enHp, 920);
    assert.equal(h.B.wordStreak, 1);
    assert.deepEqual(h.DB.mastered, ['keep']);
  }
});
