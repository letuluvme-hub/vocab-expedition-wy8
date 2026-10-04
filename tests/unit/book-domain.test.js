import test from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../../src/data/heroes.js';
import { WORDS } from '../../src/data/words.js';
import { BOOKS } from '../../src/data/books.js';
import { ENEMIES } from '../../src/data/enemies.js';
import { createRun, endRunProgress } from '../../src/domain/run.js';
import { creditWordProgress } from '../../src/domain/learning.js';
import { pendingWords } from '../../src/domain/word-selection.js';
import { createDictationAttempt, applyDictationInput, creditDictation } from '../../src/domain/dictation.js';
import { createDailySession, restoreDailySession, selectDailyWords } from '../../src/domain/daily-session.js';
import { recordUnitComplete, unlockProgress, applyUnitTransition, roundScopeUnits, transitionNextUnit, applyUnitSegment } from '../../src/domain/campaign.js';
import { growthSummary, validGrowthFact, growthAttackPct } from '../../src/domain/mastery-growth.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { appendPlayLog } from '../../src/domain/word-quality.js';

const upper = { u: 1, d: 1, w: 'rest', z: '剩余部分；休息时间', th: 'number' };
const lower = { bookId: 'wy8b', u: 1, d: 1, w: 'rest', z: '休息', th: 'health' };
const hero = HEROES.find(h => h.id === 'ranger');
const make = (words = [lower], growth) => createRun(1, hero, words, () => .5, growth, { bookId: 'wy8b' });
const snapshot = run => encodeSnapshot({ phase: PHASE.MAP, run, battle: null, encounter: null }, { now: 100 });
const spell = a => { for (const ch of a.target) applyDictationInput(a, ch); return a; };

test('new book runs freeze their book; old default runs keep their old shape', () => {
  const run = make();
  assert.equal(run.bookId, 'wy8b');
  assert.deepEqual(roundScopeUnits(run), [1, 2, 3, 4, 5, 6]);
  const old = createRun(1, hero, WORDS.filter(w => w.u === 1), () => .5);
  assert.equal(Object.hasOwn(old, 'bookId'), false);
});

test('book-specific expedition credit does not consume or rewrite upper-book evidence', () => {
  const db = { mastered: ['rest'], future: { keep: true } }, run = make();
  assert.equal(creditWordProgress(db, run, lower), true);
  assert.deepEqual(db.mastered, ['rest', { ...lower }]);
  assert.deepEqual([...run.done], ['wy8b:rest']);
  assert.equal(pendingWords(run).length, 0);
  assert.equal(creditWordProgress(db, run, lower), false);
  assert.deepEqual(db.future, { keep: true });
});

test('cross-book identical spellings stay independent in a continued word pool', () => {
  const run = make([lower]); run.done.add('rest');
  assert.deepEqual(pendingWords(run), [lower]);
  run.done.add('wy8b:rest'); assert.deepEqual(pendingWords(run), []);
});

test('formal spelling targets remain plain English while book evidence is separate', () => {
  const db = { dictationMastered: ['rest'], reviewQueue: [] };
  const a = createDictationAttempt(lower); assert.equal(a.target, 'rest');
  const result = creditDictation(db, spell(a));
  assert.equal(result.eligible, true); assert.equal(result.added, true);
  assert.deepEqual(db.dictationMastered, ['rest', { ...lower }]);
  const failed = createDictationAttempt(lower); applyDictationInput(failed, 'z'); spell(failed);
  creditDictation(db, failed); assert.deepEqual(db.reviewQueue, [{ ...lower }]);
});

test('unit completion and unlock proofs are scoped to one book', () => {
  const db = { dictationMastered: ['rest'], unitProgress: { 1: { complete: true, completedAt: 'old', future: 9 } } };
  const before = JSON.stringify(db.unitProgress);
  const wordsFor = u => u === 1 ? [lower] : [{ ...lower, u, w: 'next' }];
  let p = unlockProgress({ bookId: 'wy8b', units: [1, 2], wordsFor, dictationMastered: db.dictationMastered, unitProgress: db.unitProgress, bookUnitProgress: db.bookUnitProgress });
  assert.equal(p.counts(1).done, 0); assert.equal(p.isUnlocked(2), false);
  assert.equal(recordUnitComplete(db, 1, { bookId: 'wy8b', now: 100 }), true);
  assert.equal(JSON.stringify(db.unitProgress), before);
  assert.equal(db.bookUnitProgress.wy8b[1].complete, true);
  p = unlockProgress({ bookId: 'wy8b', units: [1, 2], wordsFor, dictationMastered: db.dictationMastered, unitProgress: db.unitProgress, bookUnitProgress: db.bookUnitProgress });
  assert.equal(p.isUnlocked(2), true);
  assert.equal(recordUnitComplete(db, 1, { bookId: 'wy8b', now: 200 }), false);
});

test('book-mismatched transition facts and word pools cannot alter an active run', () => {
  const run = make(), before = JSON.stringify(snapshot(run));
  const wrong = { ok: true, from: 1, to: 2, bookId: 'wy8a' };
  assert.equal(applyUnitTransition(run, wrong, { words: [{ ...upper, u: 2 }] }), null);
  assert.equal(JSON.stringify(snapshot(run)), before);
  assert.ok(applyUnitTransition(run, { ok: true, from: 1, to: 2, bookId: 'wy8b' }, { words: [{ ...lower, u: 2 }] }));
  assert.equal(run.bookId, 'wy8b'); assert.equal(run.campaign.segments, 2);
});

test('implicit legacy books cannot continue with another textbook or reuse its unlock facts', () => {
  const old = createRun(1, hero, [upper], () => .5), run = make();
  const legacyProgress = unlockProgress({ units: [1, 2], wordsFor: u => [{ ...upper, u }], dictationMastered: ['rest'], unitProgress: {} });
  assert.equal(transitionNextUnit({ run, progress: legacyProgress }).ok, false);
  assert.equal(applyUnitTransition(run, { ok: true, from: 1, to: 2 }, { words: [{ ...lower, u: 2 }] }), null);
  assert.equal(applyUnitTransition(old, { ok: true, from: 1, to: 2 }, { words: [{ ...lower, u: 2 }] }), null);
  assert.equal(applyUnitSegment(old, { words: [lower] }), null);
  assert.equal(old.unit, 1); assert.equal(old.campaign.segments, 1); assert.deepEqual(old.pool, [upper]);
});

test('daily selection and session restore distinguish book entries from spelling targets', () => {
  const selected = selectDailyWords({ words: [lower], mastered: ['rest'], dueWords: [upper], limit: 2 });
  assert.deepEqual(selected.words, [upper, lower]);
  const s = createDailySession(selected, { id: 'books', unit: 1, bookId: 'wy8b', now: 100 });
  assert.equal(s.bookId, 'wy8b'); assert.equal(s.words.length, 2);
  s.warmupDone = ['rest', 'wy8b:rest']; s.phase = 'formal'; s.index = 0;
  s.attempt = spell(createDictationAttempt(upper)); s.attempt.credited = true;
  s.results = [{ key: 'rest', word: upper, eligible: true, completed: true }];
  assert.ok(restoreDailySession(s));
  const wrong = structuredClone(s); wrong.results[0].key = 'wy8b:rest';
  assert.equal(restoreDailySession(wrong), null);
});

test('daily deferred new-book results validate English input and scoped identity separately', () => {
  const s = createDailySession({ words: [lower] }, { id: 'deferred', unit: 1, bookId: 'wy8b', now: 100 });
  s.phase = 'completed'; s.index = 1; s.warmupDone = ['wy8b:rest']; s.attempt = null;
  s.results = [{ key: 'wy8b:rest', word: { ...lower }, eligible: false, completed: false, deferred: true, input: 're', errors: 1, hints: 0, reveals: 0, assistance: [], deferredAt: 110 }];
  assert.ok(restoreDailySession(s));
  s.results[0].input = 'cat'; assert.equal(restoreDailySession(s), null);
});

test('ellipsis phrases require literal periods and restore the same partially typed target', () => {
  const word = { ...lower, w: 'prefer ... to', z: '比起……更喜欢……' };
  const a = createDictationAttempt(word);
  for (const ch of 'prefer ..') applyDictationInput(a, ch);
  assert.equal(a.input, 'prefer ..');
  const s = createDailySession({ words: [word] }, { id: 'dots', unit: 1, bookId: 'wy8b', now: 100 });
  s.phase = 'formal'; s.index = 0; s.attempt = a;
  assert.ok(restoreDailySession(s));
  for (const ch of '. to') applyDictationInput(a, ch);
  assert.equal(a.completed, true); assert.equal(a.errors, 0);
  const plain = createDictationAttempt(lower); applyDictationInput(plain, '.');
  assert.equal(plain.input, ''); assert.equal(plain.errors, 0);
});

test('catalog growth counts separate book entries and accepts frozen totals above 259', () => {
  const summary = growthSummary(['rest', lower], [upper, lower]);
  assert.equal(summary.masteredCount, 2); assert.equal(summary.totalCount, 2);
  const fact = { version: 3, masteredAtStart: 300, catalogTotalAtStart: 467, bonusHp: 12, bonusAttackPct: 60 };
  assert.equal(validGrowthFact(fact), true); assert.equal(growthAttackPct({ growth: fact }), 60);
  const run = make([lower], fact); assert.equal(run.maxhp, make().maxhp + 12);
  const enc = snapshot(run); assert.ok(enc); assert.equal(enc.run.growth.catalogTotalAtStart, 467);
  assert.deepEqual(decodeSnapshot(enc).value.run.growth, run.growth);
  assert.equal(validGrowthFact({ ...fact, version: 2 }), false);
  assert.equal(validGrowthFact({ ...fact, masteredAtStart: 468 }), false);
});

test('pause snapshots preserve book and word metadata; unknown or mismatched books fail closed', () => {
  const run = make(), enc = snapshot(run); assert.ok(enc);
  assert.equal(enc.run.bookId, 'wy8b'); assert.equal(enc.run.pool[0].bookId, 'wy8b');
  const restored = decodeSnapshot(JSON.parse(JSON.stringify(enc))); assert.equal(restored.ok, true);
  assert.equal(restored.value.run.bookId, 'wy8b'); assert.equal(restored.value.run.pool[0].bookId, 'wy8b');
  for (const field of ['unknown', null, 7]) { const bad = structuredClone(enc); bad.run.bookId = field; assert.equal(decodeSnapshot(bad).ok, false); }
  const bad = structuredClone(enc); bad.run.pool[0].bookId = 'wy8a'; assert.equal(decodeSnapshot(bad).ok, false);
  const old = createRun(1, hero, [upper], () => .5), legacy = snapshot(old);
  assert.equal(Object.hasOwn(legacy.run, 'bookId'), false); assert.equal(Object.hasOwn(decodeSnapshot(legacy).value.run, 'bookId'), false);
});

test('part-word battle, offer references and scoped retirement survive pause without stealing another book', () => {
  const next = { ...lower, w: 'next' }, run = make([lower, next]);
  run.node = run.rows[0][0]; run.avail = []; run.done.add('wy8b:older');
  const letters = lower.w.split('');
  const battle = { word: lower, offer: [lower, next], node: run.node, foe: ENEMIES[0],
    letters, used: letters.map((_, i) => i === 0), bad: letters.map(() => false), input: ['r'], sel: 1,
    myHp: run.hp - 3, enHp: 100, enMax: 200, shield: 2, hints: 3, hintUsed: 0, hintTotal: 0,
    combo: 1, maxCombo: 1, dmgBonus: 0, firstWrong: true, lethUsed: 0, wordsDone: 0,
    over: false, won: false, mistaken: [], wordStreak: 0, rageLeft: 0, freezeWord: false, chainNext: false,
    goldMult: 1, usedThisFight: {}, boss: false, elite: false, finished: false, rewardTaken: false };
  const env = { phase: PHASE.BATTLE, run, battle, encounter: null };
  const enc = encodeSnapshot(env, { now: 100 }); assert.ok(enc);
  const restored = decodeSnapshot(JSON.parse(JSON.stringify(enc))); assert.equal(restored.ok, true);
  assert.equal(restored.value.battle.word.bookId, 'wy8b'); assert.equal(restored.value.battle.offer[0], restored.value.run.pool[0]);
  assert.deepEqual(restored.value.battle.input, ['r']); assert.deepEqual([...restored.value.run.done], ['wy8b:older']);
  const bad = structuredClone(enc); delete bad.battle.word.bookId; assert.equal(decodeSnapshot(bad).ok, false);
  const stolen = structuredClone(enc); stolen.battle.offer[0].bookId = 'wy8a'; assert.equal(decodeSnapshot(stolen).ok, false);
  battle.word = { ...lower, bookId: 'missing-book' }; assert.equal(encodeSnapshot(env, { now: 100 }), null);
});

test('rewards and play logs preserve the selected book without rewriting legacy records', () => {
  const run = make(); const db = { runs: 1, rewards: [], best: 0 };
  const card = endRunProgress(run, db, true, 100); assert.equal(card.bookId, 'wy8b');
  const rec = { endedAt: 'now', hero: 'ranger', unit: 1, bookId: 'wy8b', win: true, qStats: run.qStats };
  assert.equal(appendPlayLog([], rec)[0].bookId, 'wy8b');
  const legacy = { ...rec }; delete legacy.bookId;
  assert.equal(Object.hasOwn(appendPlayLog([], legacy)[0], 'bookId'), false);
});

test('newly registered books derive scope, snapshot validation and play logs from their catalog', () => {
  const word = { ...lower, bookId: 'future-book', u: 8 };
  BOOKS.push({ id: 'future-book', words: [word], units: Array.from({ length: 8 }, (_, i) => ({ n: i + 1, t: 'Unit ' + (i + 1) })).concat({ n: 0, t: '自定义' }) });
  try {
    const run = createRun(7, hero, [{ ...word, u: 7 }], () => .5, null, { bookId: 'future-book' });
    assert.deepEqual(roundScopeUnits(run), [7, 8]);
    run.completedUnits = [7, 8];
    const enc = snapshot(run); assert.ok(enc); assert.equal(decodeSnapshot(enc).ok, true);
    const log = appendPlayLog([], { endedAt: 'now', hero: 'ranger', unit: 8, bookId: 'future-book', win: true, qStats: run.qStats });
    assert.equal(log[0].unit, 8);
    const bad = structuredClone(enc); bad.run.completedUnits.push(9); assert.equal(decodeSnapshot(bad).ok, false);
  } finally { BOOKS.pop(); }
});
