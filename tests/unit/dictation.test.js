import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDB } from '../../src/services/storage.js';
import { unlockProgress, isUnitComplete } from '../../src/domain/campaign.js';

const load = () => import('../../src/domain/dictation.js');
const spell = (api, attempt, text = attempt.target) => {
  for (const ch of text) api.applyDictationInput(attempt, ch);
  return attempt;
};

test('a clean formal whole word earns dictation mastery once and keeps legacy records', async () => {
  const api = await load();
  const db = initializeDB({ mastered: ['old'], future: { retained: true } });
  const a = spell(api, api.createDictationAttempt({ w: 'Letter', z: '字母' }));
  assert.equal(api.dictationEligible(a), true);
  assert.deepEqual(api.creditDictation(db, a), { eligible: true, added: true, reviewed: false, ignored: false });
  assert.deepEqual(db.dictationMastered, ['letter']);
  assert.deepEqual(db.mastered, ['old']);
  assert.deepEqual(db.future, { retained: true });
  assert.equal(api.creditDictation(db, a).ignored, true);
  assert.deepEqual(db.dictationMastered, ['letter']);
  const another = spell(api, api.createDictationAttempt(' LETTER '));
  assert.equal(api.creditDictation(db, another).added, false);
});

test('warmup never grants mastery or schedules an untested word as a failure', async () => {
  const api = await load(); const db = initializeDB();
  const a = spell(api, api.createDictationAttempt('cat', { phase: 'warmup' }));
  assert.equal(api.dictationEligible(a), false);
  assert.equal(api.creditDictation(db, a).reviewed, false);
  assert.deepEqual(db.dictationMastered, []);
  assert.deepEqual(db.reviewQueue, []);
});

for (const [name, first] of [['wrong letter', 'z'], ['wrong order, even an answer letter', 'a']]) {
  test(name + ' stays failed after eventual completion, feeds review, and reports only 不对', async () => {
    const api = await load(); const db = initializeDB();
    const a = api.createDictationAttempt('cat');
    api.applyDictationInput(a, first);
    assert.equal(a.errors, 1);
    assert.equal(a.feedback, '不对');
    assert.equal(a.input, '');
    spell(api, a);
    assert.equal(a.completed, true);
    assert.equal(api.dictationEligible(a), false);
    assert.equal(api.creditDictation(db, a).reviewed, true);
    assert.deepEqual(db.dictationMastered, []);
    assert.deepEqual(db.reviewQueue, ['cat']);
    api.creditDictation(db, a);
    assert.deepEqual(db.reviewQueue, ['cat']);
  });
}

for (const kind of ['hint', 'prophecy', 'vision']) {
  test(kind + ' prevents mastery even after spelling every character correctly', async () => {
    const api = await load(); const db = initializeDB();
    const a = api.createDictationAttempt('cat');
    api.markDictationAssistance(a, kind);
    spell(api, a);
    assert.equal(api.dictationEligible(a), false);
    assert.equal(api.creditDictation(db, a).reviewed, true);
    assert.deepEqual(db.dictationMastered, []);
    assert.deepEqual(db.reviewQueue, ['cat']);
  });
}

test('partial words cannot be credited or marked submitted', async () => {
  const api = await load(); const db = initializeDB();
  const a = api.createDictationAttempt('cat');
  api.applyDictationInput(a, 'c');
  assert.equal(api.creditDictation(db, a).ignored, true);
  assert.equal(a.credited, false);
  spell(api, a, 'at');
  assert.equal(api.creditDictation(db, a).added, true);
});

test('spaces, hyphens, apostrophes and repeated letters are actual reusable input', async () => {
  const api = await load();
  for (const target of ['ice cream', 'well-known', "one's", 'letter']) {
    const a = spell(api, api.createDictationAttempt(target));
    assert.equal(a.input, target);
    assert.equal(api.dictationEligible(a), true);
  }
  assert.equal(api.dictationWordKey(' ICE CREAM '), 'ice cream');
  assert.notEqual(api.dictationWordKey('ice cream'), api.dictationWordKey('icecream'));
});

test('backspace cannot erase the history of a wrong attempt', async () => {
  const api = await load(); const a = api.createDictationAttempt('cat');
  api.applyDictationInput(a, 'c'); api.applyDictationInput(a, 'z');
  api.applyDictationInput(a, 'Backspace');
  assert.equal(a.input, ''); assert.equal(a.errors, 1);
  spell(api, a); assert.equal(api.dictationEligible(a), false);
});

test('completed attempts ignore late events and survive a JSON round trip', async () => {
  const api = await load(); const a = spell(api, api.createDictationAttempt('cat'));
  const restored = JSON.parse(JSON.stringify(a));
  api.applyDictationInput(restored, 'z'); api.markDictationAssistance(restored, 'hint');
  assert.deepEqual(restored, a);
  assert.equal(api.dictationEligible(restored), true);
});

test('mastery requires exact input, known phase and integer zero counters', async () => {
  const api = await load(); const good = spell(api, api.createDictationAttempt('cat'));
  for (const patch of [{ input: 'ca' }, { phase: 'free' }, { errors: -1 }, { hints: undefined }, { reveals: NaN }]) {
    assert.equal(api.dictationEligible({ ...good, ...patch }), false, JSON.stringify(patch));
  }
});

test('a later clean attempt does not silently delete an earlier failure from review', async () => {
  const api = await load(); const db = initializeDB();
  const first = api.createDictationAttempt('cat'); api.applyDictationInput(first, 'z'); spell(api, first);
  api.creditDictation(db, first);
  api.creditDictation(db, spell(api, api.createDictationAttempt('cat')));
  assert.deepEqual(db.dictationMastered, ['cat']);
  assert.deepEqual(db.reviewQueue, ['cat']);
});

test('legacy mastery and stale unitProgress are preserved but never unlock a unit', () => {
  const db = initializeDB({ mastered: ['cat', 'dog'], unitProgress: { 1: { complete: true } }, future: 9 });
  assert.deepEqual(db.mastered, ['cat', 'dog']);
  assert.deepEqual(db.dictationMastered, []);
  assert.equal(db.unitProgress[1].complete, true);
  const wordsFor = n => n === 1 ? [{ w: 'cat' }, { w: 'dog' }] : [{ w: 'bird' }];
  const p = unlockProgress({ units: [1, 2], wordsFor, ...db });
  assert.equal(p.isUnlocked(2), false);
  assert.equal(isUnitComplete({ unit: 1, words: wordsFor(1), db }), false);
  db.dictationMastered = ['CAT', ' dog '];
  assert.equal(unlockProgress({ units: [1, 2], wordsFor, ...db }).isUnlocked(2), true);
  db.dictationMastered.pop();
  assert.equal(unlockProgress({ units: [1, 2], wordsFor, ...db }).isUnlocked(2), false);
});

test('initialized new fields are arrays, valid values keep identity, unknown fields survive', () => {
  const mastered = ['cat']; const review = ['dog'];
  const db = initializeDB({ dictationMastered: mastered, reviewQueue: review, future: { x: 1 } });
  assert.equal(db.dictationMastered, mastered); assert.equal(db.reviewQueue, review);
  assert.deepEqual(db.future, { x: 1 });
  assert.deepEqual(initializeDB({ dictationMastered: new Set(['cat']), reviewQueue: 'cat' }).dictationMastered, []);
});
