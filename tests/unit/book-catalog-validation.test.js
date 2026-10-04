import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { WORDS_WY8B } from '../../src/data/words-wy8b.js';
import * as rules from '../../scripts/validate-word-data.mjs';

const upper = { 1: 45, 2: 55, 3: 29, 4: 50, 5: 41, 6: 39 };
const lower = { 1: 29, 2: 32, 3: 44, 4: 24, 5: 46, 6: 33 };
const catalog = () => [{ id: 'wy8a', words: structuredClone(WORDS), expectedUnits: { ...upper } },
  { id: 'wy8b', words: structuredClone(WORDS_WY8B), expectedUnits: { ...lower } }];

test('catalog validates both photographed books and reports separate unit totals', () => {
  const books = catalog(), before = structuredClone(books);
  assert.deepEqual(rules.validateCatalog(books), { total: 467, books: {
    wy8a: { total: 259, units: upper }, wy8b: { total: 208, units: lower },
  } });
  assert.deepEqual(books, before, 'validation never rewrites textbook words or registration metadata');
});

test('validateBook uses explicit source unit counts while default validateWords keeps the strict 259-word contract', () => {
  assert.deepEqual(rules.validateBook(WORDS_WY8B, { expectedUnits: lower }), { total: 208, units: lower });
  assert.throws(() => rules.validateWords(WORDS_WY8B), /total.*259/i);
  assert.deepEqual(rules.validateWords(WORDS), { total: 259, units: upper });
});

test('catalog registration can add a book with a different unit count without changing validation code', () => {
  const books = catalog();
  books.push({ id: 'future-book', expectedUnits: { 1: 1, 2: 1 }, words: [
    { u: 1, d: 1, w: 'novel', z: '小说', th: '故事' },
    { u: 2, d: 1, w: 'moon', z: '月亮', th: '太空' },
  ] });
  const result = rules.validateCatalog(books);
  assert.equal(result.total, 469);
  assert.deepEqual(result.books['future-book'], { total: 2, units: { 1: 1, 2: 1 } });
});

test('generic book validation rejects missing, malformed or contradictory source distributions', () => {
  for (const expectedUnits of [undefined, null, [], {}, { 1: 0 }, { 1: -1 }, { 1: 1.5 }, { 1: '1' }, { 2: 1 }, { 1: 1, 3: 1 }]) {
    assert.throws(() => rules.validateBook(WORDS_WY8B, { expectedUnits }), /expectedUnits/i);
  }
  assert.throws(() => rules.validateBook(WORDS_WY8B.slice(1), { expectedUnits: lower }), /total.*208/i);
  const words = structuredClone(WORDS_WY8B); words[0].u = 2;
  assert.throws(() => rules.validateBook(words, { expectedUnits: lower }), /unit 1.*29.*28/i);
});

test('each catalog book enforces record, difficulty, spelling and normalized duplicate contracts', () => {
  for (const mutate of [words => { words[0].d = 4; }, words => { words[0].w = '?!'; },
    words => { words[0].z = null; }, words => { words[1].w = 'SELF expression'; }]) {
    const words = structuredClone(WORDS_WY8B); mutate(words);
    assert.throws(() => rules.validateBook(words, { expectedUnits: lower }), { name: 'Error' });
  }
});

test('catalog cannot weaken legacy book counts by changing its source metadata', () => {
  const books = catalog(); books[0].words.pop(); books[0].expectedUnits[6]--;
  assert.throws(() => rules.validateCatalog(books), /259/);
  const shifted = catalog(); shifted[0].words[0].u = 2; shifted[0].expectedUnits[1]--; shifted[0].expectedUnits[2]++;
  assert.throws(() => rules.validateCatalog(shifted), /unit 1.*45.*44/i);
});

test('catalog rejects duplicate identities, missing source metadata and a missing frozen legacy registration', () => {
  const duplicate = catalog(); duplicate[1].id = 'wy8a';
  assert.throws(() => rules.validateCatalog(duplicate), /duplicate.*wy8a/i);
  const missing = catalog(); delete missing[1].expectedUnits;
  assert.throws(() => rules.validateCatalog(missing), /expectedUnits/i);
  assert.throws(() => rules.validateCatalog(catalog().slice(1)), /wy8a/i);
  assert.throws(() => rules.validateCatalog(null), /catalog/i);
});
