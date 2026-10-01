import test from 'node:test';
import assert from 'node:assert/strict';

const moduleURL = new URL('../../src/services/storage.js', import.meta.url);

// 任务14：新存档 / 缺字段存档默认 QWERTY（字母盘）；已有明确偏好不动。
// kbUpper 的默认值不变，仍然是 false。
test('initializeDB defaults a brand new or field-less save to the QWERTY layout', async () => {
  const { initializeDB } = await import(moduleURL);
  // 没有可用存档（no-storage / 首次进入）也走这条路：默认必须是 QWERTY。
  for (const value of [undefined, null, false, 0, '']) {
    assert.equal(initializeDB(value).kbMode, true);
  }
  assert.equal(initializeDB({}).kbMode, true);
  assert.equal(initializeDB({ runs: 3, mastered: ['litre'], custom: [] }).kbMode, true);
  assert.equal(Object.hasOwn(initializeDB({}), 'kbMode'), true);
  // kbUpper 是另一个偏好，默认值不受本任务影响。
  assert.equal(initializeDB(null).kbUpper, false);
  assert.equal(initializeDB({ kbUpper: true }).kbUpper, true);
});

test('initializeDB keeps an explicit keyboard preference in both directions', async () => {
  const { initializeDB } = await import(moduleURL);
  assert.equal(initializeDB({ kbMode: true }).kbMode, true);
  assert.equal(initializeDB({ kbMode: false }).kbMode, false);
  assert.equal(initializeDB({ kbMode: false, kbUpper: true }).kbMode, false);
  assert.equal(initializeDB({ kbMode: true, kbUpper: true }).kbMode, true);
  // 切换后存盘的显式 false 不能被默认值吃掉。
  const switched = initializeDB({ kbMode: false });
  assert.equal(initializeDB(switched).kbMode, false);
});

test('initializeDB still coerces legacy non-boolean keyboard values with !!', async () => {
  const { initializeDB } = await import(moduleURL);
  // 旧存档里的数字/字符串按原有 !! 规则兼容，不擅自迁移。
  assert.equal(initializeDB({ kbMode: 0 }).kbMode, false);
  assert.equal(initializeDB({ kbMode: 1 }).kbMode, true);
  assert.equal(initializeDB({ kbMode: 'yes' }).kbMode, true);
  assert.equal(initializeDB({ kbMode: '' }).kbMode, false);
  assert.equal(initializeDB({ kbMode: null }).kbMode, false);
});

test('initializeDB adds no schema marker and never drops unknown or run fields', async () => {
  const { initializeDB } = await import(moduleURL);
  const unknown = { nested: ['preserved'] };
  const activeRun = { schemaVersion: 1, phase: 'map', run: { floor: 3 }, battle: null };
  const db = { runs: 5, activeRun, future: { enabled: true }, unknown };
  assert.equal(initializeDB(db), db);
  assert.equal(db.kbMode, true);
  assert.equal(db.activeRun, activeRun);
  assert.deepEqual(db.unknown, unknown);
  assert.deepEqual(db.future, { enabled: true });
  assert.equal(Object.hasOwn(db, 'schemaVersion'), false);
});