/* 学习档案 + 进度快照的持久化契约。
 *
 * 关键约束：**学习 DB 与快照必须同一次 storage.save(DB) 提交**。
 * 分两次写就会出现「奖励/掌握已落盘、快照还停在上一帧」的窗口，刷新后
 * 用旧快照恢复就会把已经拿过的奖励再发一次（金币、遗物、纪念卡都能刷）。
 * 所以这个模块的写入入口只有一个：commit(db, envelope)。
 *
 * 降级面：没有 localStorage（隐私模式、file:// 被拒、被 CSP 挡）时必须
 * 保持玩法可运行，只是明确告诉调用方「这次没存上」，绝不假装成功。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, initializeDB, STORAGE_KEY } from '../../src/services/storage.js';
import { createProgressStore } from '../../src/services/progress.js';
import { PHASE, encodeSnapshot, decodeSnapshot, SNAPSHOT_SCHEMA_VERSION } from '../../src/domain/run-snapshot.js';
import { createRun } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';

const HERO = { id: 'scholar', mod: { gold: 12, combo: 1 } };
const UNIT1 = WORDS.filter(w => w.u === 1);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

function memoryStorage(seed) {
  const map = new Map();
  if (seed !== undefined) map.set(STORAGE_KEY, seed);
  return {
    map,
    writes: 0,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { this.writes++; map.set(k, String(v)); },
    removeItem: k => map.delete(k),
  };
}

const dbFixture = over => Object.assign(
  { runs: 3, wins: 1, mastered: ['litre'], best: 4, custom: [], rewards: [], vol: 0.55, voice: false },
  over,
);

/* 走真实 createRun + 真实 codec：peek 会解码信封，commit 会自检信封，
   所以手写的假 run（少字段、假 rows）在新契约下本来就不该被当成合法存档。
   这里必须用真数据，否则测的是「假信封也能过」而不是「真存档能过」。 */
function realEnvelope(over = {}, runOver = {}) {
  const run = Object.assign(createRun(1, HERO, UNIT1, mulberry(0x2b1f)), runOver);
  run.gold = 12; run.countedStart = true;
  return encodeSnapshot({ phase: PHASE.MAP, run, battle: null, encounter: null, ...over },
    { now: 1_700_000_000_000 });
}

const ENVELOPE = realEnvelope({}, { gold: 12 });

test('真实 createRun 产出的信封能被 commit 接受并原样读回', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const env = realEnvelope({}, { gold: 12 });
  assert.equal(decodeSnapshot(JSON.parse(JSON.stringify(env))).ok, true, '前提：信封本身合法');
  assert.equal(store.commit(dbFixture(), env).ok, true);
  const back = store.peek();
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.value.run.gold, 12);
});

/* ---------------- 提交与读取 ---------------- */

test('commit 一次写入同时带上学习 DB 与快照', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture();
  DB.mastered.push('keep');
  const result = store.commit(DB, ENVELOPE);
  assert.equal(result.ok, true);
  assert.equal(s.writes, 1, '必须是同一次 save，不许拆成两次');
  const saved = JSON.parse(s.map.get(STORAGE_KEY));
  assert.deepEqual(saved.mastered, ['litre', 'keep'], '学习记录一起落盘');
  assert.deepEqual(saved.activeRun, ENVELOPE, '快照整体随这一次 save 落盘');
  assert.equal(saved.vol, 0.55, '既有字段不受影响');
});

test('未知字段与既有字段原样保留，快照只新增 activeRun 一个键', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture({ futureField: { deep: [1, 2] }, legacy: 'keep-me' });
  store.commit(DB, ENVELOPE);
  const saved = JSON.parse(s.map.get(STORAGE_KEY));
  assert.deepEqual(saved.futureField, { deep: [1, 2] });
  assert.equal(saved.legacy, 'keep-me');
  assert.equal('activeRun' in saved, true);
});

test('peek 只返回解码后的合法快照，非法快照给出原因而不抛错', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  assert.deepEqual(store.peek(), { ok: false, reason: 'none' }, '没有快照时不是错误');
  store.commit(dbFixture(), realEnvelope());
  const found = store.peek();
  assert.equal(found.ok, true, found.reason);
  assert.equal(found.value.phase, PHASE.MAP);
  assert.equal(found.value.run.gold, 12);
  assert.ok(found.value.run.done instanceof Set, 'peek 出来的 done 已经是 Set');

  // 手改成损坏信封：peek 必须 fail closed，但存档本身不被清掉
  const raw = JSON.parse(s.map.get(STORAGE_KEY));
  raw.activeRun.run.gold = -5;
  s.map.set(STORAGE_KEY, JSON.stringify(raw));
  const broken = store.peek();
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'invalid');
  assert.equal(broken.value, undefined);
  assert.equal('activeRun' in JSON.parse(s.map.get(STORAGE_KEY)), true, '损坏快照不许被 peek 顺手删掉');
});

test('peek 遇到解码器会抛错的损坏存档时兜底为 invalid，绝不冒泡、绝不写回', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  store.commit(dbFixture(), realEnvelope({}, { gold: 12 }));
  const raw = JSON.parse(s.map.get(STORAGE_KEY));
  delete raw.activeRun.run.history;                  // 删键：旧解码器会在这里炸
  s.map.set(STORAGE_KEY, JSON.stringify(raw));
  const before = s.map.get(STORAGE_KEY);
  let out;
  assert.doesNotThrow(() => { out = store.peek(); }, '主页加载即调用 peek，抛错等于白屏');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid');
  assert.equal(s.map.get(STORAGE_KEY), before, '损坏存档必须原样留给玩家确认');
  assert.ok(store.rawDB().activeRun, 'rawDB 仍能拿到原文，供界面提示');
});

test('peek 对未来版本快照明确报 version，上层据此提示「不能恢复」', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture();
  DB.activeRun = { ...ENVELOPE, schemaVersion: 2 };
  s.map.set(STORAGE_KEY, JSON.stringify(DB));
  const out = store.peek();
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'version');
});

test('peek 对非 JSON 的存档文本静默降级为 none（老存档/被手改）', () => {
  const s = memoryStorage('{not json');
  const store = createProgressStore(createStorage(s));
  assert.deepEqual(store.peek(), { ok: false, reason: 'none' });
});

/* ---------------- 清除 ---------------- */

test('clear 删除快照但保留学习记录与未知字段', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture({ futureField: 1 });
  store.commit(DB, ENVELOPE);
  assert.equal(store.clear(DB).ok, true);
  const saved = JSON.parse(s.map.get(STORAGE_KEY));
  assert.equal('activeRun' in saved, false, '快照必须真的从存档里消失');
  assert.deepEqual(saved.mastered, ['litre']);
  assert.equal(saved.futureField, 1);
  assert.equal(store.peek().ok, false);
});

test('clear 在本来就没有快照时也成功（幂等）', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture();
  assert.equal(store.clear(DB).ok, true);
  assert.equal(store.clear(DB).ok, true);
  assert.equal('activeRun' in JSON.parse(s.map.get(STORAGE_KEY)), false);
});

/* ---------------- 降级 ---------------- */

test('没有 localStorage 时 commit 报 unavailable，玩法仍可继续', () => {
  const store = createProgressStore(createStorage(null));
  const DB = dbFixture();
  const out = store.commit(DB, ENVELOPE);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unavailable');
  assert.deepEqual(DB.mastered, ['litre'], 'DB 本身照常可用');
});

test('存储抛异常（配额/隐私模式）时 commit 报 failed，不冒泡', () => {
  const hostile = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  const store = createProgressStore(createStorage(hostile));
  const out = store.commit(dbFixture(), ENVELOPE);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'failed');
});

test('读取抛异常时 peek 静默降级为 none', () => {
  const hostile = { getItem() { throw new Error('SecurityError'); }, setItem() {} };
  const store = createProgressStore(createStorage(hostile));
  assert.deepEqual(store.peek(), { ok: false, reason: 'none' });
});

test('快照体积过大导致写失败时，学习记录也不落盘（宁可不存，不存半份）', () => {
  const base = memoryStorage();
  let overflow = false;
  const guarded = {
    getItem: base.getItem,
    setItem: (k, v) => {
      if (String(v).length > 5000) { overflow = true; throw new Error('QuotaExceededError'); }
      base.map.set(k, String(v));
    },
    removeItem: base.removeItem,
  };
  const store = createProgressStore(createStorage(guarded));
  const DB = dbFixture();
  // 信封本身合法（真实 run + 真实 codec），只是词池大到写不下：这样失败原因
  // 仍然是「存储写不下」，而不是被 commit 的自检提前挡掉。
  const fat = Array.from({ length: 400 }, (_, i) => ({ u: 0, d: 1, w: 'customword' + i, z: '词' + i }));
  const huge = realEnvelope({}, { pool: UNIT1.concat(fat) });
  const out = store.commit(DB, huge);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'failed');
  assert.equal(overflow, true);
  assert.equal(base.map.size, 0, '失败时不得留下半份存档');
  assert.equal('activeRun' in DB, false, '失败时内存里的 DB 也要恢复原样');
});

/* ---------------- commit 自检：损坏信封不许进存档 ----------------
 * commit 是唯一的写入入口，也是最后一道闸门。这里若放行一份自己都解不开的
 * 存档，玩家刷新后拿到的是「有快照但恢复不了」，而且旧的那份好存档已被覆盖
 * —— 不可恢复 + 不可回退。所以自检失败必须是 no-op：DB 与磁盘都不动。 */

test('commit 拒绝自检不通过的信封，并且不动旧 DB、不写磁盘', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture();
  const good = realEnvelope({}, { gold: 12 });
  assert.equal(store.commit(DB, good).ok, true);
  const writesAfterGood = s.writes;
  const onDisk = s.map.get(STORAGE_KEY);

  const broken = JSON.parse(JSON.stringify(good));
  delete broken.run.history;                       // 删键：解码器解不开
  const out = store.commit(DB, broken);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid');
  assert.equal(s.writes, writesAfterGood, '自检失败不许写盘');
  assert.equal(s.map.get(STORAGE_KEY), onDisk, '旧存档必须原封不动');
  assert.deepEqual(DB.activeRun, good, 'DB 上仍是那份好信封');
  assert.equal(store.peek().ok, true, '玩家仍能恢复上一次的好存档');
});

test('commit 对多种损坏信封一律拒绝并保留原存档', () => {
  /* 每条 mutate 都必须**返回整个信封**：Object.assign(e.run, …) 返回的是 run，
     拿它当信封去解码只会得到 'version'，测的就不是本意了。 */
  const cases = [
    ['版本号不认识', e => Object.assign(e, { schemaVersion: 99 })],
    ['phase 不认识', e => Object.assign(e, { phase: 'mid-sword' })],
    ['run.gold 是负数', e => Object.assign(e, Object.assign(e.run, { gold: -1 }))],
    ['run.pool 被清空', e => Object.assign(e, Object.assign(e.run, { pool: [] }))],
    ['map 相位却带战斗', e => Object.assign(e, { battle: { letters: [], used: [], bad: [], input: [], sel: 0 } })],
    ['run 整个被删掉', e => { delete e.run; return e; }],
    // 注意：**没有** null 这一条 —— commit(db, null) 是契约里「清档」的合法
    // 输入（encodeSnapshot 对已结算的 run 返回 null），由下面那条测试覆盖。
    ['整个信封是字符串', () => 'not-an-envelope'],
    ['整个信封是数组', () => []],
    ['整个信封是数字', () => 42],
  ];
  for (const [name, mutate] of cases) {
    const s = memoryStorage();
    const store = createProgressStore(createStorage(s));
    const DB = dbFixture();
    const good = realEnvelope({}, { gold: 12 });
    store.commit(DB, good);
    const writes = s.writes;
    const bad = mutate(JSON.parse(JSON.stringify(good)));
    let out;
    assert.doesNotThrow(() => { out = store.commit(DB, bad); }, name + ' 绝不允许抛错');
    assert.equal(out.ok, false, name + ' 必须被拒绝');
    // 未来版本单独报 version：上层据此提示「存档来自更新的版本」而不是「已损坏」。
    assert.equal(out.reason, name.startsWith('版本号') ? 'version' : 'invalid', name);
    assert.equal(s.writes, writes, name + ' 不得写盘');
    assert.deepEqual(JSON.parse(s.map.get(STORAGE_KEY)).activeRun, good, name);
  }
});

test('commit(db, null) 走一次 clear：没有 activeRun 时不该留下过期快照', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const DB = dbFixture();
  store.commit(DB, realEnvelope({}, { gold: 12 }));
  const writes = s.writes;
  const out = store.commit(DB, null);
  assert.equal(out.ok, true, out.reason);
  assert.equal(s.writes, writes + 1, '清档只准一次写入，不许两次');
  assert.equal('activeRun' in JSON.parse(s.map.get(STORAGE_KEY)), false);
  assert.deepEqual(JSON.parse(s.map.get(STORAGE_KEY)).mastered, ['litre'], '学习记录保留');
});

test('clear 写失败时如实报 failed，绝不声称成功，DB 也恢复原样', () => {
  const base = memoryStorage();
  let blocked = false;                    // 先放行 commit，再只挡 clear 那一次写
  const guarded = {
    getItem: base.getItem,
    setItem: (k, v) => { if (blocked) throw new Error('QuotaExceededError'); base.map.set(k, String(v)); },
    removeItem: base.removeItem,
  };
  const store = createProgressStore(createStorage(guarded));
  const DB = dbFixture();
  const env = realEnvelope({}, { gold: 12 });
  assert.equal(store.commit(DB, env).ok, true);
  const before = base.map.get(STORAGE_KEY);
  blocked = true;
  const out = store.clear(DB);
  assert.equal(out.ok, false, '写失败不得声称成功');
  assert.equal(out.reason, 'failed');
  assert.equal(base.map.get(STORAGE_KEY), before, '磁盘上的快照仍在');
  assert.deepEqual(DB.activeRun, env, '内存里的 DB 恢复成原样');
});

/* ---------------- 与 codec 的接缝 ---------------- */

test('commit 接受 encodeSnapshot 的产物并能原样读回（单次 JSON 往返）', () => {
  const s = memoryStorage();
  const store = createProgressStore(createStorage(s));
  const envelope = realEnvelope({}, { gold: 12, done: new Set(['litre']) });
  const DB = dbFixture();
  assert.equal(store.commit(DB, envelope).ok, true);
  const back = store.peek();
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.value.run.gold, 12);
  assert.equal(back.value.savedAt, new Date(1_700_000_000_000).toISOString(), 'savedAt 由调用方时间决定');
  assert.deepEqual([...back.value.run.done], ['litre']);
  assert.ok(back.value.run.done instanceof Set);
});

test('initializeDB 不动 activeRun，缺失时才由快照写入方创建', async () => {
  const s = memoryStorage(JSON.stringify({ runs: 1, activeRun: ENVELOPE }));
  const DB = initializeDB(createStorage(s).load());
  assert.equal(DB.activeRun.phase, PHASE.MAP, 'initializeDB 保留既有快照原样');
  const fresh = initializeDB(null);
  assert.equal('activeRun' in fresh, false, 'initializeDB 不凭空造快照键');
});
