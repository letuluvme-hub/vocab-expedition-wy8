import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const validatorURL = new URL('../../scripts/validate-word-data.mjs', import.meta.url);
const fixtureURL = new URL('../fixtures/legacy.html', import.meta.url);
const expression = readFileSync(fixtureURL, 'utf8').match(/const WORDS=(\[[\s\S]*?\n\]);/)[1];
const legacyWords = JSON.parse(JSON.stringify(runInNewContext(expression)));
const expected = { total: 259, units: { 1: 45, 2: 55, 3: 29, 4: 50, 5: 41, 6: 39 } };
const freshWords = () => structuredClone(legacyWords);

test('the extracted WORDS match the legacy book exactly and pass validation', async () => {
  const { validateWords } = await import(validatorURL);
  const { WORDS } = await import('../../src/data/words.js');
  assert.deepEqual(WORDS, legacyWords);
  assert.deepEqual(validateWords(WORDS), expected);
});

test('the CLI validates the extracted book and prints its machine-readable summary', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(validatorURL)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

test('validateWords accepts the real legacy book and reports all six unit counts', async () => {
  const { validateWords } = await import(validatorURL);
  const words = freshWords();
  const before = structuredClone(words);
  assert.deepEqual(validateWords(words), expected);
  assert.deepEqual(words, before, 'validation must not rewrite the data');
});

test('validateWords rejects a non-array book or non-object record with Error', async () => {
  const { validateWords } = await import(validatorURL);
  for (const book of [null, undefined, {}, 'words', 259]) {
    assert.throws(() => validateWords(book), { name: 'Error', message: /array/i });
  }
  for (const record of [null, undefined, 'word', 3, []]) {
    const words = freshWords(); words[0] = record;
    assert.throws(() => validateWords(words), { name: 'Error', message: /record.*0|word.*0/i });
  }
});

test('validateWords requires exactly 259 records and the fixed unit distribution', async () => {
  const { validateWords } = await import(validatorURL);
  for (const words of [[], freshWords().slice(1),
    [...freshWords(), { u: 6, d: 1, w: 'extra unique', z: '多余', th: 'study' }]]) {
    assert.throws(() => validateWords(words), { name: 'Error', message: /total.*259/i });
  }
  const words = freshWords(); words[0].u = 2;
  assert.throws(() => validateWords(words), { name: 'Error', message: /unit 1.*45.*44/i });
});

test('validateWords rejects exact and normalized duplicates across the book', async () => {
  const { validateWords } = await import(validatorURL);
  for (const [index, value] of [[1, 'litre'], [1, 'L-I T R E'], [45, 'LITRE']]) {
    const words = freshWords(); words[index].w = value;
    assert.throws(() => validateWords(words), { name: 'Error', message: /duplicate.*litre/i });
  }
});

test('validateWords rejects words with an empty legacy normalized spelling', async () => {
  const { validateWords } = await import(validatorURL);
  for (const value of ['', '   ', '123', '--!?', '中文', 'é']) {
    const words = freshWords(); words[0].w = value;
    assert.throws(() => validateWords(words), { name: 'Error', message: /0.*w.*normalized.*empty/i });
  }
  const words = freshWords(); words[0].w = "A-'Z 123";
  assert.deepEqual(validateWords(words), expected);
  assert.equal(words[0].w, "A-'Z 123");
});

test('validateWords enforces integer unit and difficulty ranges', async () => {
  const { validateWords } = await import(validatorURL);
  const invalidValues = { u: [undefined, null, '1', 0, 7, 1.5, NaN, Infinity],
    d: [undefined, null, '1', 0, 4, 1.5, NaN, Infinity] };
  for (const [field, values] of Object.entries(invalidValues)) {
    for (const value of values) {
      const words = freshWords(); words[0][field] = value;
      assert.throws(() => validateWords(words), { name: 'Error', message: new RegExp(`0.*${field}.*integer`, 'i') });
    }
  }
});

test('validateWords requires w, z and th string fields', async () => {
  const { validateWords } = await import(validatorURL);
  for (const field of ['w', 'z', 'th']) {
    for (const value of [undefined, null, 5, true, {}, []]) {
      const words = freshWords(); words[0][field] = value;
      assert.throws(() => validateWords(words), { name: 'Error', message: new RegExp(`0.*${field}.*string`, 'i') });
    }
  }
});
