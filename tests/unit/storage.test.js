import test from 'node:test';
import assert from 'node:assert/strict';

const moduleURL = new URL('../../src/services/storage.js', import.meta.url);

test('load reads the unchanged legacy storage key without rewriting data', async () => {
  const { STORAGE_KEY, createStorage } = await import(moduleURL);
  const db = { runs: 7, mastered: ['AI', 'set off'], future: { enabled: true } };
  const values = new Map([['wy8a_rogue_v1', JSON.stringify(db)]]);
  let writes = 0;
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem() { writes += 1; },
  };
  assert.equal(STORAGE_KEY, 'wy8a_rogue_v1');
  assert.deepEqual(createStorage(storage).load(), db);
  assert.equal(writes, 0);
});

test('load returns null for missing, malformed, falsy or inaccessible storage', async () => {
  const { createStorage } = await import(moduleURL);
  for (const value of [null, '', '{broken', 'null', 'false', '0', '""']) {
    assert.equal(createStorage({ getItem() { return value; } }).load(), null);
  }
  assert.equal(createStorage({ getItem() { throw new Error('denied'); } }).load(), null);
  assert.equal(createStorage({ get getItem() { throw new Error('denied getter'); } }).load(), null);
  assert.equal(createStorage(null).load(), null);
});

test('save round-trips legacy fields under the unchanged key and returns true', async () => {
  const { createStorage } = await import(moduleURL);
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const db = {
    runs: 4, wins: 2, best: 9, mastered: ['AI', 'set off'],
    custom: [{ w: 'My phrase', z: '自定义' }],
    rewards: [{ id: 'WR-original', details: { title: '纪念' } }],
    hero: 'kept-hero', vol: 0.35, mute: true,
    kbMode: true, kbUpper: false, voice: false,
    future: { keep: ['unknown'] },
  };
  const service = createStorage(storage);
  assert.equal(service.save(db), true);
  assert.deepEqual([...values.keys()], ['wy8a_rogue_v1']);
  assert.equal(values.get('wy8a_rogue_v1'), JSON.stringify(db));
  assert.deepEqual(service.load(), db);
});

test('save returns false without throwing for write or serialization failures', async () => {
  const { createStorage } = await import(moduleURL);
  assert.equal(createStorage({ setItem() { throw new Error('quota'); } }).save({ runs: 1 }), false);
  assert.equal(createStorage({ get setItem() { throw new Error('denied getter'); } }).save({}), false);
  assert.equal(createStorage(null).save({}), false);
  const circular = {}; circular.self = circular;
  let writes = 0;
  const storage = { setItem() { writes += 1; } };
  assert.equal(createStorage(storage).save(circular), false);
  assert.equal(createStorage(storage).save({ runs: 1n }), false);
  assert.equal(createStorage(storage).save({ toJSON() { throw new Error('serialization'); } }), false);
  assert.equal(writes, 0);
});

test('default storage resolution catches browser localStorage getter failures', async () => {
  const { createStorage, resolveStorage } = await import(moduleURL);
  assert.equal(resolveStorage({}), null);
  assert.equal(resolveStorage(null), null);
  const values = new Map();
  const storage = { getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); } };
  assert.equal(resolveStorage({ localStorage: storage }), storage);
  assert.equal(resolveStorage({ get localStorage() { throw new Error('blocked'); } }), null);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true,
      get() { throw new Error('SecurityError'); } });
    const blocked = createStorage();
    assert.equal(blocked.load(), null);
    assert.equal(blocked.save({}), false);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const available = createStorage();
    assert.equal(available.save({ runs: 2 }), true);
    assert.deepEqual(available.load(), { runs: 2 });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('initializeDB adds empty formal evidence to legacy defaults for absent or falsy saves', async () => {
  const { initializeDB } = await import(moduleURL);
  const expected = {
    runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [],
    kbMode: true, kbUpper: false, voice: true,
    // 2026-10-02：主页一次性键盘提示看没看过。旧档缺这个键 → 按「还没看过」
    // 处理，让老玩家也见一次。这是一次性说明，不是数据损坏，所以默认 false。
    keyboardTipSeen: false, dictationMastered: [], reviewQueue: [], heroStats:{words:0,cleanWords:0,kills:0,damage:0,healing:0},heroUnlocks:{scholar:{words:0,cleanWords:0,kills:0,damage:0,healing:0}},
  };
  for (const value of [undefined, null, false, 0, '']) {
    assert.deepEqual(initializeDB(value), expected);
  }
  const first = initializeDB(null);
  const second = initializeDB(null);
  assert.notEqual(first.mastered, second.mastered);
  assert.notEqual(first.custom, second.custom);
  assert.notEqual(first.rewards, second.rewards);
});

test('initializeDB preserves legacy fallback rules and adds formal evidence without grandfathering', async () => {
  const { initializeDB } = await import(moduleURL);
  const mastered = ['AI', 'set off'];
  const custom = [{ w: 'Keep CAPS', z: '原文' }];
  const rewards = [{ id: 'WR-existing' }];
  const unknown = { nested: ['preserved'] };
  const db = { runs: 8, wins: 3, best: 9, mastered, custom, rewards,
    kbMode: 'yes', kbUpper: 0, voice: null, hero: 'old', vol: 0.2, mute: true, unknown };
  assert.equal(initializeDB(db), db);
  assert.deepEqual(db, { runs: 8, wins: 3, best: 9, mastered, custom, rewards,
    kbMode: true, kbUpper: false, voice: false, hero: 'old', vol: 0.2, mute: true, unknown,
    keyboardTipSeen: false, dictationMastered: [], reviewQueue: [], heroStats:{words:2,cleanWords:0,kills:0,damage:0,healing:0},heroUnlocks:{scholar:{words:2,cleanWords:0,kills:0,damage:0,healing:0}} });
  assert.equal(db.mastered, mastered);
  assert.equal(db.custom, custom);
  assert.equal(db.rewards, rewards);
  assert.equal(db.unknown, unknown);
  assert.equal(Object.hasOwn(db, 'schemaVersion'), false);

  for (const value of [undefined, null, false, 0, '']) {
    const sparse = { mastered: value, custom: value, rewards: value };
    assert.deepEqual(initializeDB(sparse), {
      mastered: [], custom: [], rewards: [], kbMode: true, kbUpper: false, voice: true,
      keyboardTipSeen: false, dictationMastered: [], reviewQueue: [],heroStats:{words:0,cleanWords:0,kills:0,damage:0,healing:0},heroUnlocks:{scholar:{words:0,cleanWords:0,kills:0,damage:0,healing:0}},
    });
    assert.equal(Object.hasOwn(sparse, 'runs'), false);
  }
  // Truthy legacy mastered/custom values were not type-checked; preserve that behavior.
  const odd = { mastered: 'AI', custom: { keep: true }, rewards: 'not an array',
    kbMode: 0, kbUpper: 'yes', voice: 'yes' };
  assert.deepEqual(initializeDB(odd), { mastered: 'AI', custom: { keep: true }, rewards: [],
    kbMode: false, kbUpper: true, voice: true, keyboardTipSeen: false, dictationMastered: [], reviewQueue: [],heroStats:{words:0,cleanWords:0,kills:0,damage:0,healing:0},heroUnlocks:{scholar:{words:0,cleanWords:0,kills:0,damage:0,healing:0}} });
});
