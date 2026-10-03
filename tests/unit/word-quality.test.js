import test from 'node:test';
import assert from 'node:assert/strict';

const q = (over = {}) => ({ wrong: 0, hint: 0, listen: 0, revealed: 0, ...over });
const stats = (over = {}) => ({ words: 0, perfect: 0, good: 0, rescue: 0,
  hintsUsed: 0, wrongLetters: 0, listenUsed: 0, ...over });
const load = () => import('../../src/domain/word-quality.js');

test('quality: only zero wrong, hint and listen is perfect', async () => {
  const { classifyWordQuality } = await load();
  assert.equal(classifyWordQuality('keep', q()), 'perfect');
  for (const field of ['wrong', 'hint', 'listen']) {
    assert.equal(classifyWordQuality('keep', q({ [field]: 1 })), 'good', field);
  }
});

test('quality: rescue threshold uses letters only, rounded up for odd lengths', async () => {
  const { classifyWordQuality } = await load();
  for (const word of ['keep', 'litre', 'keep an eye on', 'well-known']) {
    const half = Math.ceil(word.replace(/[^a-z]/g, '').length / 2);
    assert.equal(classifyWordQuality(word, q({ hint: 1, revealed: half - 1 })), 'good');
    assert.equal(classifyWordQuality(word, q({ hint: 1, revealed: half })), 'rescue');
  }
  assert.equal(classifyWordQuality('I', q({ hint: 1, revealed: 1 })), 'rescue');
});

test('quality: completed words accumulate each grade and help totals without mutating inputs', async () => {
  const { completeWordStats } = await load();
  const initial = Object.freeze(stats());
  const a = completeWordStats(initial, 'keep', Object.freeze(q()));
  const b = completeWordStats(a, 'litre', q({ wrong: 2, listen: 1 }));
  const c = completeWordStats(b, 'well-known', q({ hint: 3, revealed: 5 }));
  assert.deepEqual(c, stats({ words: 3, perfect: 1, good: 1, rescue: 1,
    hintsUsed: 3, wrongLetters: 2, listenUsed: 1 }));
  assert.deepEqual(initial, stats());
  assert.deepEqual(a, stats({ words: 1, perfect: 1 }));
});

test('quality: missing legacy markers never manufacture a perfect word', async () => {
  const { completeWordStats, decodeWordQ, decodeQStats } = await load();
  assert.deepEqual(decodeWordQ(undefined), q({ wrong: 1 }));
  assert.deepEqual(decodeQStats(undefined), stats());
  assert.deepEqual(completeWordStats(undefined, 'keep', undefined),
    stats({ words: 1, good: 1, wrongLetters: 1 }));
});

test('quality: play log retains the newest twenty detached, plain records', async () => {
  const { appendPlayLog } = await load();
  let log;
  const source = stats({ words: 1, perfect: 1 });
  for (let i = 0; i < 25; i++) {
    log = appendPlayLog(log, { endedAt: new Date(i * 1000).toISOString(),
      hero: 'scholar', unit: 1, qStats: source, win: i % 2 === 0 });
  }
  assert.equal(log.length, 20);
  assert.equal(log[0].endedAt, new Date(5000).toISOString());
  assert.equal(log.at(-1).endedAt, new Date(24000).toISOString());
  assert.deepEqual(Object.keys(log[0]).sort(), ['endedAt', 'hero', 'qStats', 'unit', 'win']);
  source.words = 99;
  assert.equal(log.at(-1).qStats.words, 1, 'history must not alias the live run');
  assert.deepEqual(JSON.parse(JSON.stringify(log)), log);
});

test('quality: an old non-array play log is replaced, never serialized as a Set', async () => {
  const { appendPlayLog } = await load();
  const record = { endedAt: '2026-10-03T06:00:00.000Z', hero: 'warrior', unit: 0,
    qStats: stats(), win: false };
  assert.deepEqual(appendPlayLog(new Set(), record), [record]);
});

test('quality: new runs start with their own zero counters', async () => {
  const { createRun } = await import('../../src/domain/run.js');
  const pool = [{ w: 'keep', z: '保持', u: 1, d: 1 }];
  const a = createRun(1, { id: 'scholar', mod: {} }, pool);
  const b = createRun(1, { id: 'scholar', mod: {} }, pool);
  assert.deepEqual(a.qStats, stats());
  assert.notEqual(a.qStats, b.qStats);
});
