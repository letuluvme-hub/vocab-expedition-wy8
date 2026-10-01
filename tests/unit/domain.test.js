import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { norm } from '../../src/domain/text.js';
import * as text from '../../src/domain/text.js';

// Execute only the original declarations needed by these rules, never the HTML
// application (which contains DOM, timers, audio and storage side effects).
const source = readFileSync(new URL('../fixtures/legacy.html', import.meta.url), 'utf8');
function originalConst(name) {
  const match = source.match(new RegExp(`^const ${name}\\s*=.*?;`, 'm'));
  assert.ok(match, `legacy constant ${name} exists`);
  return match[0];
}
function originalFunction(name) {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm'));
  assert.ok(match, `legacy function ${name} exists`);
  return match[0];
}
function legacy(declarations, exports, globals = {}) {
  const context = vm.createContext(globals);
  return vm.runInContext(`${declarations.join('\n')}\n({${exports.join(',')}})`, context);
}
const oldText = legacy([originalConst('norm'), originalFunction('wordGapBefore')], ['norm', 'wordGapBefore']);
const oldHp = legacy([originalConst('clamp'), originalFunction('hpBarGeom')], ['hpBarGeom']);
const learningState = { B: null, G: null, DB: null, saveDB: () => learningState.saves++ , saves: 0 };
const oldLearning = legacy([originalConst('norm'),
  ...['wordComplete', 'creditWord', 'markMastered', 'onWordRight', 'onWordWrong'].map(originalFunction)],
['wordComplete', 'creditWord', 'onWordWrong'], learningState);

test('wordComplete matches original null guards and length-only full-word criterion', async t => {
  const { wordComplete } = await import('../../src/domain/learning.js');
  const wordsDeclaration = source.match(/^const WORDS=\[[^]*?^\];/m);
  assert.ok(wordsDeclaration, 'original word data exists');
  const { WORDS } = legacy([wordsDeclaration[0]], ['WORDS']);
  let count = 0;
  for (const word of WORDS) {
    const spelling = norm(word.w);
    for (const input of ['', spelling.slice(0, Math.floor(spelling.length / 2)), spelling.slice(0, -1),
      spelling, spelling + 'x', 'x'.repeat(spelling.length)]) {
      const battle = Object.freeze({ word: Object.freeze({ ...word }), input });
      learningState.B = battle;
      assert.equal(wordComplete(battle), oldLearning.wordComplete(), JSON.stringify([word.w, input]));
      count++;
    }
  }
  for (const battle of [null, undefined, {}, { word: null },
    { word: { w: '---' }, input: '' }, { word: { w: 'cut in' }, input: 'cuti' },
    { word: { w: 'cut in' }, input: 'cutin' }, { word: { w: null }, input: 'null' }]) {
    learningState.B = battle;
    assert.equal(wordComplete(battle), oldLearning.wordComplete());
    count++;
  }
  const invalid = { word: { w: 'abc' } };
  learningState.B = invalid;
  assert.throws(() => oldLearning.wordComplete(), { name: 'TypeError' });
  assert.throws(() => wordComplete(invalid), { name: 'TypeError' });
  t.diagnostic(`${count} completion cases from original vocabulary and edge inputs`);
});

test('creditWordProgress preserves mastery, retirement and first wrong-queue removal', async () => {
  const { creditWordProgress } = await import('../../src/domain/learning.js');
  const scenarios = [
    { mastered: [], done: [], wrong: [] },
    { mastered: [], done: [], wrong: ['before', 'cut in', 'after'] },
    { mastered: ['cut in'], done: [], wrong: ['cut in'] },
    { mastered: ['cut in'], done: ['cut in'], wrong: [] },
    { mastered: [], done: ['before'], wrong: ['cut in', 'cut in', 'after'] },
  ];
  for (const initial of scenarios) {
    const db = { mastered: [...initial.mastered], unrelated: 10 };
    const run = { done: new Set(initial.done), wrong: [...initial.wrong], unrelated: 20 };
    const expectedDb = structuredClone(db), expectedRun = structuredClone(run);
    const mastered = db.mastered, done = run.done, wrong = run.wrong;
    learningState.DB = expectedDb;
    learningState.G = expectedRun;
    learningState.saves = 0;
    for (const word of ['cut in', 'cut in', 'different', 'different']) {
      const saveCount = learningState.saves;
      oldLearning.creditWord(word);
      assert.equal(creditWordProgress(db, run, word), learningState.saves > saveCount);
      assert.deepEqual(db, expectedDb);
      assert.deepEqual(run, expectedRun);
      assert.equal(db.mastered, mastered);
      assert.equal(run.done, done);
      assert.equal(run.wrong, wrong);
    }
  }
});

test('onWordWrongProgress preserves queue order, uniqueness and retirement reversal', async () => {
  const { onWordWrongProgress } = await import('../../src/domain/learning.js');
  for (const initial of [
    { done: [], wrong: [] },
    { done: ['cut in', 'other'], wrong: [] },
    { done: ['cut in'], wrong: ['before', 'cut in', 'after'] },
    { done: ['cut in'], wrong: ['cut in', 'cut in'] },
  ]) {
    const run = { done: new Set(initial.done), wrong: [...initial.wrong], unrelated: 20 };
    const expectedRun = structuredClone(run);
    const done = run.done, wrong = run.wrong;
    learningState.G = expectedRun;
    for (const word of ['cut in', 'cut in', 'new phrase', 'other', 'new phrase']) {
      assert.equal(onWordWrongProgress(run, word), oldLearning.onWordWrong(word));
      assert.deepEqual(run, expectedRun);
      assert.equal(run.done, done);
      assert.equal(run.wrong, wrong);
    }
  }
});

test('hpBarGeom matches original shield capacity, clipping and int32 coercion', async t => {
  const { hpBarGeom } = await import('../../src/domain/hp.js');
  let count = 0;
  for (const hp of [-10, 0, 1, 30, 60, 100, 2.5, undefined, NaN, '30'])
    for (const shield of [-10, 0, 20, 100, 20.9, undefined, NaN, '20', 2147483648, 4294967316])
      for (const maxhp of [-5, 0, 1, 60, 60.9, undefined, '60', 2147483648]) {
        assert.deepEqual(hpBarGeom(hp, shield, maxhp), { ...oldHp.hpBarGeom(hp, shield, maxhp) },
          JSON.stringify([hp, shield, maxhp]));
        count++;
      }
  assert.deepEqual(hpBarGeom(30, 20, 60), { pct: 62.5, cap: 80, shield: 20, hpPct: 37.5, shPct: 25 });
  assert.equal(hpBarGeom(60, 20, 60).pct, 100);
  assert.equal(hpBarGeom(30, 0, 60).pct, 50);
  t.diagnostic(`${count} HP geometry cases compared against isolated legacy function`);
});
const damageState = { G: null, B: null };
const oldDamage = legacy([
  ...['clamp', 'has', 'hasR', 'comboRate', 'WORD_RATIO', 'WORD_COMBO_BOOST', 'WORD_MIN_RATIO',
    'WORD_DMG_CAP', 'FIN_TIER_MAX'].map(originalConst),
  ...['hitDmg', 'finTier', 'wordDmg'].map(originalFunction),
], ['comboRate', 'hitDmg', 'finTier', 'wordDmg'], damageState);
function setDamageState(run, battle) {
  damageState.G = run;
  damageState.B = battle;
}
function* damageCases() {
  for (const floor of [-10, 0, 1, 1.4, 2, 9, 50, 500])
    for (const combo of [0, 1, 10, 1000])
      for (const dmgBonus of [-150, -50, 0, 25, 1000])
        for (const rageLeft of [0, 1])
          for (const freezeWord of [false, true])
            for (const hcombo of [0, 0.9, 1.5])
              for (const relics of [[], ['combo']]) {
                yield [Object.freeze({ floor, hcombo, relics: Object.freeze(relics) }),
                  Object.freeze({ combo, dmgBonus, rageLeft, freezeWord, wordStreak: 1 })];
              }
}

test('hitDmg matches original rounding order, floor, relic, rage, freeze and clamps', async t => {
  const { hitDmg } = await import('../../src/domain/damage.js');
  let count = 0;
  for (const [run, battle] of damageCases()) {
    setDamageState(run, battle);
    assert.equal(hitDmg(run, battle), oldDamage.hitDmg(), JSON.stringify([run, battle]));
    count++;
  }
  for (const [run, battle] of [
    [{ floor: undefined, relics: [] }, { combo: 1, dmgBonus: 0 }],
    [{ floor: 1, relics: [] }, { combo: undefined, dmgBonus: 0 }],
    [{ floor: 1, relics: [] }, { combo: 1, dmgBonus: undefined }],
    [{ floor: '9', relics: [] }, { combo: '3', dmgBonus: '25', rageLeft: '1', freezeWord: 'yes' }],
  ]) {
    setDamageState(run, battle);
    assert.equal(hitDmg(run, battle), oldDamage.hitDmg());
    count++;
  }
  t.diagnostic(`${count} hit damage cases compared against isolated legacy functions`);
});

test('wordDmg matches legacy finisher scaling, hit-relative minimum and cap order', async t => {
  const { wordDmg, hitDmg, WORD_RATIO, WORD_COMBO_BOOST, WORD_MIN_RATIO,
    WORD_DMG_CAP, FIN_TIER_MAX, FIN_TIER_STEP } = await import('../../src/domain/damage.js');
  assert.deepEqual({ WORD_RATIO, WORD_COMBO_BOOST, WORD_MIN_RATIO, WORD_DMG_CAP, FIN_TIER_MAX, FIN_TIER_STEP },
    { ...legacy(['WORD_RATIO', 'WORD_COMBO_BOOST', 'WORD_MIN_RATIO', 'WORD_DMG_CAP', 'FIN_TIER_MAX'].map(originalConst),
      ['WORD_RATIO', 'WORD_COMBO_BOOST', 'WORD_MIN_RATIO', 'WORD_DMG_CAP', 'FIN_TIER_MAX', 'FIN_TIER_STEP']) });
  let count = 0;
  for (const [run, baseBattle] of damageCases()) {
    for (const wordStreak of [0, 1, 2, 4, 5, 6]) {
      const battle = Object.freeze({ ...baseBattle, wordStreak });
      setDamageState(run, battle);
      const actual = wordDmg(run, battle);
      assert.equal(actual, oldDamage.wordDmg(), JSON.stringify([run, battle]));
      assert.ok(actual >= Math.round(hitDmg(run, battle) * WORD_MIN_RATIO));
      count++;
    }
  }
  for (const battle of [{}, { combo: 1, dmgBonus: NaN },
    { combo: '3', dmgBonus: '25', rageLeft: '1', freezeWord: 'yes', wordStreak: '3' }]) {
    const run = { floor: 9, relics: ['combo'] };
    setDamageState(run, battle);
    assert.equal(wordDmg(run, battle), oldDamage.wordDmg());
    count++;
  }
  assert.equal(wordDmg({ floor: 9, relics: ['combo'] },
    { combo: 1000, dmgBonus: 1000, rageLeft: 1, freezeWord: false, wordStreak: 5 }), WORD_DMG_CAP);
  // Preserve the existing clamp order even when an extreme floor makes the
  // lower bound exceed the nominal damage cap; do not silently fix gameplay.
  const extremeRun = { floor: 500, relics: [] };
  const extremeBattle = { combo: 0, dmgBonus: 0, rageLeft: 0, freezeWord: false, wordStreak: 1 };
  setDamageState(extremeRun, extremeBattle);
  assert.equal(hitDmg(extremeRun, extremeBattle), oldDamage.hitDmg());
  assert.ok(hitDmg(extremeRun, extremeBattle) > 140);
  assert.equal(wordDmg(extremeRun, extremeBattle), oldDamage.wordDmg());
  assert.ok(wordDmg(extremeRun, extremeBattle) > WORD_DMG_CAP);
  t.diagnostic(`${count} word damage cases compared against isolated legacy functions`);
});

test('finTier preserves streak bitwise coercion and fifth-word plateau', async () => {
  const { finTier } = await import('../../src/domain/damage.js');
  for (const wordStreak of [undefined, null, NaN, -10, -1, 0, 1, 2, 3, 4, 5, 6, 100, 2.9, '3',
    2147483648, 4294967295, 4294967296, 4294967298]) {
    const battle = Object.freeze({ wordStreak });
    setDamageState(null, battle);
    assert.equal(finTier(battle), oldDamage.finTier(), String(wordStreak));
  }
  assert.equal(finTier({ wordStreak: 1 }), 1);
  assert.equal(finTier({ wordStreak: 5 }), 1.48);
});

test('comboRate preserves relic membership and hcombo truthy fallback', async () => {
  const { comboRate } = await import('../../src/domain/damage.js');
  for (const relics of [[], ['combo'], ['focus', 'combo'], ['combination'], ['combo', 'combo']]) {
    for (const hcombo of [undefined, null, false, 0, NaN, '', 0.9, 1, 1.5, -1, '0', '2']) {
      const run = { relics, hcombo };
      setDamageState(run);
      assert.equal(comboRate(run), oldDamage.comboRate(), JSON.stringify(run));
    }
  }
});

test('norm preserves original String coercion and ASCII-only normalization', () => {
  const values = [undefined, null, '', 0, 123, true, false, 'AbC', "don't", 'super-speed',
    '  living\tconditions! ', '中文 café naïve', 'İKſßＡＢＣ', '🙂A🙂Z', ['A', 'B'], { toString: () => 'FOO-Bar' }];
  for (const value of values) assert.equal(norm(value), oldText.norm(value), String(value));
  assert.equal(norm(null), 'null');
  assert.equal(norm(undefined), 'undefined');
});

test('wordGapBefore preserves phrase boundaries, coercion and explicit length behavior', () => {
  const values = [undefined, null, '', 42, 'living conditions', 'super-speed', "don't", ' A--B  C! ',
    'a\tb\nc', 'a🙂b', 'İAKB', '123', '中文', 'ABCD'];
  for (const value of values) {
    for (const length of [0, 1, 2, norm(value).length, norm(value).length + 3]) {
      assert.deepEqual(text.wordGapBefore(value, length), Array.from(oldText.wordGapBefore(value, length)), `${value}/${length}`);
    }
  }
  assert.deepEqual(text.wordGapBefore('cut in', 5), [false, false, false, true, false]);
  assert.deepEqual(text.wordGapBefore(null, 4), [false, false, false, false]);
  for (const length of [-1, 1.5, NaN]) {
    assert.throws(() => oldText.wordGapBefore('ab', length), { name: 'RangeError' });
    assert.throws(() => text.wordGapBefore('ab', length), { name: 'RangeError' });
  }
  for (const length of [undefined, '3', null]) {
    assert.deepEqual(text.wordGapBefore('a-b', length), Array.from(oldText.wordGapBefore('a-b', length)));
  }
});
