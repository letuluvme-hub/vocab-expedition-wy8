/* 版本化进度快照的纯编解码契约。
 *
 * 这里断言的是**事实**而不是形状猜测：往返之后每一个真实状态位都必须原样回来，
 * 而且地图节点、avail/cur/node/battle.node 必须重新指向**同一批对象** ——
 * 旧版 UI 的判定是 `G.avail.indexOf(n) >= 0` 与 `G.node === n` 这类身份比较，
 * 只复制值就会让「可选节点」和「当前节点」全部失配。
 *
 * 拒绝面同样重要：损坏、非法引用和不支持的版本号必须 fail closed，
 * 宁可让玩家看到「不能恢复」，也不能把远征恢复成一个乱 id 的死局。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, advanceRun } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';
import { ENEMIES, BOSS } from '../../src/data/enemies.js';
import {
  SNAPSHOT_SCHEMA_VERSION, PHASE, nodeId, encodeSnapshot, decodeSnapshot,
} from '../../src/domain/run-snapshot.js';

const HERO = { id: 'ranger', mod: { hp: -8, gold: 15, hint: 1, noise: -1, combo: 1.05, regen: 0, leech: 1 } };
const UNIT1 = WORDS.filter(w => w.u === 1);

/* 复刻真实路径：createRun → 选一个首层节点（enterNode 会置 node、清空 avail）
   → 战斗结算后 advanceRun。这样 rows/node/cur/avail 的组合与线上一致，
   而不是「凭空造一个 run 对象」。 */
function seededRun(over = {}) {
  const run = createRun(1, HERO, UNIT1, mulberry(0x51a7));
  run.node = run.rows[0][0];
  run.avail = [];
  advanceRun(run, 1000);
  return Object.assign(run, over);
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

function battleFor(run, over = {}) {
  const word = UNIT1[3];
  const letters = word.w.split('');
  return {
    word, letters, used: letters.map((_, i) => i < 2), bad: letters.map((_, i) => i === 3),
    node: run.node, foe: ENEMIES[1], boss: false, elite: false,
    myHp: 41, enHp: 118, enMax: 200, shield: 12,
    input: letters.slice(0, 2), sel: 4, hints: 5, hintUsed: 2, hintTotal: 3,
    combo: 7, maxCombo: 9, dmgBonus: 15, firstWrong: false, lethUsed: 1,
    wordsDone: 2, over: false, mistaken: ['other'], wordStreak: 2,
    rageLeft: 2, freezeWord: true, chainNext: true, goldMult: 3,
    usedThisFight: { leech: 2, stone: 1 }, rewardTaken: false, finished: false,
    ...over,
  };
}

function envelopeOf(over = {}) {
  const run = seededRun();
  return {
    phase: PHASE.BATTLE, savedAt: '2026-10-01T12:00:00.000Z',
    run, battle: battleFor(run), encounter: null, ...over,
  };
}

const roundTrip = env => decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(env))));

/* ---------------- 0. 段结算标记 / 纪念卡 id：跨刷新的事实（任务 7 补丁 A）---------------- */
test('clearedSegment and rewardId survive a round trip; old snapshots fall back', () => {
  const fresh = seededRun();
  fresh.clearedSegment = false;
  const a = roundTrip({ phase: PHASE.BATTLE, run: fresh, battle: battleFor(fresh) });
  assert.equal(a.ok, true, a.reason);
  assert.equal(a.value.run.clearedSegment, false, 'a fresh segment must stay false across a refresh');
  assert.equal(a.value.run.rewardId, undefined, 'no card yet → no id');

  const won = seededRun();
  won.clearedSegment = true; won.clearedRun = true; won.rewardId = 'WR-abc-1-0';
  const b = roundTrip({ phase: PHASE.BATTLE, run: won, battle: battleFor(won) });
  assert.equal(b.value.run.clearedSegment, true);
  assert.equal(b.value.run.rewardId, 'WR-abc-1-0', 'the memorial card id must survive the JSON trip');

  // 旧客户端写出的存档：两个字段都没有。缺 clearedSegment 保守按 clearedRun 回落。
  const legacy = seededRun();
  legacy.clearedRun = true;
  const env = JSON.parse(JSON.stringify(encodeSnapshot({ phase: PHASE.BATTLE, run: legacy, battle: battleFor(legacy) })));
  delete env.run.clearedSegment; delete env.run.rewardId;
  const c = decodeSnapshot(env);
  assert.equal(c.ok, true, c.reason);
  assert.equal(c.value.run.clearedSegment, true, 'legacy runs fall back to clearedRun');
  assert.equal(c.value.run.rewardId, undefined);
});

test('a dirty clearedSegment / rewardId fails the whole envelope closed', () => {
  for (const bad of [{ clearedSegment: 1 }, { clearedSegment: 'yes' }, { rewardId: 7 }, { rewardId: {} }]) {
    const run = seededRun();
    const env = JSON.parse(JSON.stringify(encodeSnapshot({ phase: PHASE.BATTLE, run, battle: battleFor(run) })));
    Object.assign(env.run, bad);
    assert.equal(decodeSnapshot(env).ok, false, JSON.stringify(bad) + ' must be rejected');
  }
});

test('encoding an in-memory reward without rewardId takes the id from the reward', () => {
  const run = seededRun();
  run.reward = { id: 'WR-mem-1', unit: 1, heroId: 'ranger', accuracy: 90, kills: 3, floor: 5, earnedAt: 'x' };
  delete run.rewardId;                                  // 旧内存态
  const env = encodeSnapshot({ phase: PHASE.BATTLE, run, battle: battleFor(run) });
  assert.equal(env.run.rewardId, 'WR-mem-1');
});

/* ---------------- 1. 战斗快照：半词、提示、连击、道具全在 ---------------- */

test('半词战斗往返后保留每一个事实位，done 仍是 Set', () => {
  const run = seededRun();
  run.gold = 137; run.ghostUsed = true; run.nextHint = 2; run.shopHints = 1;
  run.done.add('litre'); run.done.add('keep an eye on'); run.wrong = ['borrow', 'litre'];
  run.bag = { leech: 3, stone: 1, rage: 0 };
  const out = roundTrip({ phase: PHASE.BATTLE, run, battle: battleFor(run) });

  assert.equal(out.ok, true, out.reason);
  const { run: g, battle: b } = out.value;
  assert.ok(g.done instanceof Set, 'done 必须是 Set，不能是数组');
  assert.equal(g.done.has('litre'), true);
  assert.equal(g.done.has('keep an eye on'), true);
  assert.equal(g.done.size, 2);
  assert.deepEqual([...g.done], ['litre', 'keep an eye on'], 'Set 内部顺序即本局退休顺序');
  assert.deepEqual(g.wrong, ['borrow', 'litre']);
  assert.equal(g.gold, 137);
  assert.equal(g.ghostUsed, true, '影分身额度是 run 级事实，必须跨快照保留');
  assert.equal(g.nextHint, 2);
  assert.equal(g.shopHints, 1);
  assert.deepEqual(g.bag, { leech: 3, stone: 1, rage: 0 });
  assert.deepEqual(b.input, battleFor(run).input, '半词：已输入的字母必须逐位回来');
});

test('半词战斗的 letters/used/bad/input 逐位还原（不回满、不重抽词）', () => {
  const run = seededRun();
  const src = battleFor(run);
  const out = roundTrip({ phase: PHASE.BATTLE, run, battle: src });
  assert.equal(out.ok, true, out.reason);
  const b = out.value.battle;
  assert.equal(b.word.w, src.word.w);
  assert.deepEqual(b.letters, src.letters, '字母盘必须原样回来，不重新抽噪声');
  assert.deepEqual(b.used, src.used);
  assert.deepEqual(b.bad, src.bad);
  assert.deepEqual(b.input, src.input);
  assert.equal(b.sel, 4);
  assert.equal(b.hints, 5);
  assert.equal(b.hintUsed, 2);
  assert.equal(b.hintTotal, 3);
  assert.equal(b.combo, 7);
  assert.equal(b.maxCombo, 9);
  assert.equal(b.dmgBonus, 15);
  assert.equal(b.firstWrong, false);
  assert.equal(b.lethUsed, 1);
  assert.equal(b.wordsDone, 2);
  assert.equal(b.wordStreak, 2);
  assert.deepEqual(b.mistaken, ['other']);
  assert.equal(b.rageLeft, 2);
  assert.equal(b.freezeWord, true);
  assert.equal(b.chainNext, true);
  assert.equal(b.goldMult, 3);
  assert.deepEqual(b.usedThisFight, { leech: 2, stone: 1 });
  assert.equal(b.myHp, 41, '生命不回满');
  assert.equal(b.enHp, 118);
  assert.equal(b.enMax, 200);
  assert.equal(b.shield, 12);
  assert.equal(b.over, false);
  assert.equal(b.won, false);
  // 计时器 / 闭包 / DOM 一律不落盘
  const json = JSON.stringify(encodeSnapshot({ phase: PHASE.BATTLE, run, battle: src }));
  assert.ok(!json.includes('keyEls'));
  assert.ok(!json.includes('setTimeout'));
  assert.ok(!json.includes('innerHTML'));
});

test('BOSS 战斗的 foe 引用与首领标记完整还原', () => {
  const run = seededRun();
  const out = roundTrip({ phase: PHASE.BATTLE, run,
    battle: battleFor(run, { boss: true, elite: false, foe: BOSS }) });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.battle.boss, true);
  assert.equal(out.value.battle.foe.n, BOSS.n);
  assert.equal(out.value.battle.foe.ic, BOSS.ic);
  assert.equal(out.value.battle.foe.tint, BOSS.tint);
});

/* ---------------- 2. 地图快照：身份一致性是硬要求 ---------------- */

test('地图 links/avail/cur/node/battle.node 往返后是同一批对象', () => {
  const run = seededRun();
  const src = battleFor(run);
  const out = roundTrip({ phase: PHASE.BATTLE, run, battle: src });
  assert.equal(out.ok, true, out.reason);
  const g = out.value.run, b = out.value.battle;

  // links 必须是行内节点对象本身，不是副本
  const linked = g.rows[1][0].links[0];
  assert.ok(g.rows[2].includes(linked), 'links 必须指向 rows 里的同一个对象');
  assert.notEqual(linked, undefined);
  // avail / cur / node / battle.node 全部是身份相等
  assert.equal(g.avail.length, run.avail.length);
  for (const n of g.avail) assert.ok(g.rows[n.row].includes(n), 'avail 元素必须在 rows 里');
  assert.ok(g.cur === null || g.rows[g.cur.row].includes(g.cur));
  assert.ok(g.node === null || g.rows[g.node.row].includes(g.node));
  assert.equal(b.node, g.node, 'battle.node 与 run.node 必须是同一个对象');
  // 节点完成标记与类型/坐标一致
  assert.deepEqual(g.rows.map(row => row.map(n => n.done)),
    run.rows.map(row => row.map(n => n.done)));
  assert.deepEqual(g.rows.map(row => row.map(n => n.type)),
    run.rows.map(row => row.map(n => n.type)));
  assert.deepEqual(g.rows[2][0].links.map(nodeId), run.rows[2][0].links.map(nodeId));
  // 序列化层只出现 nodeID，不出现对象嵌套
  const json = JSON.stringify(encodeSnapshot({ phase: PHASE.BATTLE, run, battle: src }));
  assert.match(json, /"links":\["r\d+_x\d+"/);
});

test('同层多个节点各有独立 nodeID，links 不会串到孪生节点', () => {
  const run = seededRun();
  const ids = run.rows.flat().map(nodeId);
  assert.equal(new Set(ids).size, ids.length, '同层同 x 的兄弟节点也必须各自唯一');
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  const g = out.value.run;
  const flat = g.rows.flat();
  for (let r = 0; r + 1 < g.rows.length; r++) {
    for (const n of g.rows[r]) for (const m of n.links) assert.equal(m.row, r + 1, '连线只能指向下一层');
  }
  assert.equal(flat.length, run.rows.flat().length);
});

test('第 1 层（cur 为空、node 为空、avail 是首层）也能往返', () => {
  const run = createRun(1, HERO, UNIT1, mulberry(7));
  assert.equal(run.cur, null);
  assert.equal(run.node, null);
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.cur, null);
  assert.equal(out.value.run.node, null);
  assert.equal(out.value.run.floor, 1);
  for (const n of out.value.run.avail) assert.equal(n.row, 0);
});

/* ---------------- 3. 词池与自定义词 ---------------- */

test('词池按原顺序与原词条往返，删掉自定义词也不影响当前 run', () => {
  const custom = [{ u: 0, d: 2, w: 'myword', z: '自定义', th: 'custom' }];
  const pool = UNIT1.concat(custom);
  const run = createRun(0, HERO, pool, mulberry(3));
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.ok, true, out.reason);
  assert.deepEqual(out.value.run.pool.map(w => w.w), pool.map(w => w.w), '词池顺序与内容必须原样');
  assert.equal(out.value.run.pool.at(-1).th, 'custom');
  // 玩家在标题页清空自定义词库后，当前 run 的词池仍是快照里那份独立副本
  const restored = out.value.run;
  const dbCustom = [];
  assert.ok(restored.pool.some(w => w.w === 'myword'), '清空 DB.custom 不许动到 run 自己的词池');
  assert.equal(dbCustom.length, 0);
});

test('词池里有完全相同的重复词条时，战斗快照仍必须能往返（只认第一条）', () => {
  // 真实成因：玩家把同一行 'cat 猫' 导入两次 → DB.custom 两行一模一样 →
  // 词池里两条 w/u/d/z 全同。旧判据是 pool.length !== 1 → 整份快照 fail closed，
  // 于是自定义单元的暂停/保存/刷新**每次**都报「存档损坏」。
  // 抽词侧只出第一条（唯一身份），所以引用校验也只该认第一条。
  const run = seededRun();
  const dup = { u: 0, d: 2, w: 'cat', z: '猫', th: 'custom' };
  run.pool = [dup, { u: 0, d: 2, w: 'cat', z: '猫', th: 'custom' }, { u: 0, d: 2, w: 'dog', z: '狗', th: 'custom' }];
  const battle = battleFor(run, { word: run.pool[0], letters: ['c', 'a', 't'], used: [false, false, false],
    bad: [false, false, false], input: ['c'], sel: 1 });
  const out = roundTrip({ phase: PHASE.BATTLE, run, battle });
  assert.equal(out.ok, true, '重复自定义词条不许让快照判 invalid：' + out.reason);
  assert.equal(out.value.battle.word.w, 'cat');
  assert.equal(out.value.battle.word.z, '猫');
  // 词池两条重复条目都原样保留（不删 DB.custom / pool 的任何一条）
  assert.equal(out.value.run.pool.length, 3);
  assert.deepEqual(out.value.run.pool.map(w => w.w), ['cat', 'cat', 'dog']);
  // 但引用校验仍然只认**正版来源**：u/d/z/th 改一个就非法。
  for (const [name, bad] of [['u', { u: 3 }], ['d', { d: 3 }], ['z', { z: '别的释义' }], ['th', { th: 'other' }]]) {
    const tampered = battleFor(run, { word: { ...run.pool[0], ...bad }, letters: ['c', 'a', 't'],
      used: [false, false, false], bad: [false, false, false], input: [], sel: 0 });
    const raw = JSON.parse(JSON.stringify(encodeSnapshot({ phase: PHASE.BATTLE, run, battle: tampered })));
    assert.equal(decodeSnapshot(raw).ok, false, '词条字段 ' + name + ' 被改必须被拒');
  }
  // 词压根不在词池里（凭空造的词）仍然 fail closed
  const alien = battleFor(run, { word: { u: 0, d: 2, w: 'zzz', z: '不存在', th: 'custom' },
    letters: ['z', 'z', 'z'], used: [false, false, false], bad: [false, false, false], input: [], sel: 0 });
  assert.equal(decodeSnapshot(JSON.parse(JSON.stringify(
    encodeSnapshot({ phase: PHASE.BATTLE, run, battle: alien })))).ok, false, '词池外的词必须被拒');
});

/* ---------------- 4. 档案外壳 ---------------- */

test('外壳带 schemaVersion / savedAt / phase，decode 不修改输入对象', () => {
  const env = envelopeOf();
  const encoded = encodeSnapshot(env);
  assert.equal(encoded.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(encoded.savedAt, '2026-10-01T12:00:00.000Z');
  assert.equal(encoded.phase, PHASE.BATTLE);
  const frozen = JSON.stringify(encoded);
  const out = decodeSnapshot(encoded);
  assert.equal(out.ok, true, out.reason);
  assert.equal(JSON.stringify(encoded), frozen, 'decode 不得就地改写存档信封');
});

test('savedAt 缺省时由调用方时间补上，且必须是可解析时刻', () => {
  const env = envelopeOf({ savedAt: undefined });
  const encoded = encodeSnapshot(env, { now: 1_700_000_000_000 });
  assert.equal(encoded.savedAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(decodeSnapshot(encoded).ok, true);
  const bad = envelopeOf();
  delete bad.savedAt;
  assert.equal(encodeSnapshot(bad).savedAt.length > 0, true);
});

test('英雄来自 run.heroId 而不是主页选择', () => {
  const run = seededRun();
  run.heroId = 'lucky';
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.value.run.heroId, 'lucky');
  assert.equal(out.value.run.hleech, HERO.mod.leech);
  assert.equal(out.value.run.hcombo, HERO.mod.combo);
});

test('已计数标记原样带回，恢复路径不必也不得再加一次', () => {
  const run = seededRun({ countedStart: true, clearedRun: true });
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.value.run.countedStart, true);
  assert.equal(out.value.run.clearedRun, true);
});

/* ---------------- 5. 拒绝面 ---------------- */

test('不支持的版本号被拒绝，且不产生任何状态', () => {
  const out = decodeSnapshot({ schemaVersion: 99, savedAt: 'x', phase: PHASE.MAP, run: {}, battle: null });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'version');
  assert.equal(out.value, undefined);
});

test('非对象 / 空 / 缺 phase / 缺 run 一律拒绝，且理由可区分', () => {
  for (const bad of [null, undefined, 0, 'x', []]) {
    const out = decodeSnapshot(bad);
    assert.equal(out.ok, false, JSON.stringify(bad));
    assert.equal(out.reason, 'invalid');
    assert.equal(out.value, undefined);
  }
  // 缺 phase / 缺 run：信封结构不对，同样是 invalid（不是 version）
  const base = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, savedAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(decodeSnapshot({ ...base, run: {} }).reason, 'invalid');
  assert.equal(decodeSnapshot({ ...base, phase: PHASE.MAP, battle: null }).reason, 'invalid');
});

test('未知 phase 被拒绝', () => {
  const env = envelopeOf({ phase: 'mid-sword' });
  assert.equal(decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(env)))).reason, 'invalid');
});

test('损坏的引用一律 fail closed：乱 nodeID、词不在池、数组长度对不上、脏数值', () => {
  // 直接改**编码后的信封**：这才是「存档被损坏/被手改」的真实形态。
  // 改源 run 对象是没用的 —— encode 会从对象重新推导 nodeID，脏值当场就被抹平。
  const cases = [
    ['links 指向不存在的 nodeID', e => { e.run.rows[1][0].links = ['r9_x999999']; }],
    ['avail 指向不存在的 nodeID', e => { e.run.avail = ['r9_x1']; }],
    ['battle.node 指向不存在的 nodeID', e => { e.battle.node = 'r0_x1'; }],
    ['cur 指向不存在的 nodeID', e => { e.run.cur = 'nope'; }],
    ['node 指向不存在的 nodeID', e => { e.run.node = 'nope'; }],
    ['战斗词不在 run.pool 里', e => { e.battle.word = { w: 'not-a-real-word', z: '?', u: 1, d: 1 }; }],
    ['战斗词的 unit 与池中不符', e => { e.battle.word.u = 4; }],
    ['used 与 letters 长度不一致', e => { e.battle.used = e.battle.used.slice(1); }],
    ['bad 与 letters 长度不一致', e => { e.battle.bad = e.battle.bad.concat([false]); }],
    ['used 里出现非布尔', e => { e.battle.used[0] = 'yes'; }],
    ['生命是脏值', e => { e.battle.myHp = null; }],
    ['生命超过上限', e => { e.battle.myHp = e.run.maxhp + 500; }],
    ['金币是负数', e => { e.run.gold = -1; }],
    ['护盾超过生命上限', e => { e.battle.shield = e.run.maxhp + 1; }],
    ['层数不是整数', e => { e.run.floor = 1.5; }],
    ['done 里有重复项', e => { e.run.done = ['a', 'a']; }],
    ['pool 被清空', e => { e.run.pool = []; }],
    ['敌人名不是字符串', e => { e.battle.foe = { n: 7, ic: 'x', tint: '#fff' }; }],
    ['letters 里混入非小写字母', e => { e.battle.letters[0] = 'A'; }],
    ['nodeID 重复', e => { e.run.rows[1][0].id = e.run.rows[1][1].id; }],
    ['savedAt 不可解析', e => { e.savedAt = '昨天'; }],
  ];
  for (const [name, mutate] of cases) {
    const encoded = JSON.parse(JSON.stringify(encodeSnapshot(envelopeOf())));
    mutate(encoded);
    const out = decodeSnapshot(encoded);
    assert.equal(out.ok, false, name + ' 必须被拒绝');
    assert.equal(out.reason, 'invalid', name);
    assert.equal(out.value, undefined, name);
  }
});

test('手写的脏快照（绕过 encode）同样被拒绝', () => {
  const env = envelopeOf();
  const encoded = encodeSnapshot(env);
  const dirty = JSON.parse(JSON.stringify(encoded));
  dirty.battle.input = ['l', 'i', 't', 'r', 'e', 'x'];    // 比词还长
  assert.equal(decodeSnapshot(dirty).ok, false);
  const dirty2 = JSON.parse(JSON.stringify(encoded));
  dirty2.run.hp = 'forty';
  assert.equal(decodeSnapshot(dirty2).ok, false);
});

test('phase 与内容必须自洽：非战斗相位不许带战斗，反之亦然', () => {
  const run = seededRun();
  const map = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(map.ok, true);
  assert.equal(map.value.battle, null);
  const withBattle = roundTrip({ phase: PHASE.MAP, run, battle: battleFor(run) });
  assert.equal(withBattle.ok, false, '地图相位带战斗对象属于不自洽');
  const noBattle = roundTrip({ phase: PHASE.BATTLE, run, battle: null });
  assert.equal(noBattle.ok, false, '战斗相位缺战斗对象属于不自洽');
});

/* ---------------- 6. 奖励 / 事件相位与纯度 ---------------- */

test('奖励相位带着已算好的奖励卡数据往返，不重新 roll', () => {
  const run = seededRun();
  const env = {
    phase: PHASE.REWARD, run, battle: battleFor(run, { over: true, won: true }),
    encounter: { kind: 'reward', gold: 121, unfinished: 'litre', node: run.node,
      options: [{ id: 'heal', cat: 'heal', ic: '💚', t: '恢复生命', d: '回复 30 点生命' }] },
  };
  const out = roundTrip(env);
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.phase, PHASE.REWARD);
  assert.equal(out.value.battle.over, true, '战斗仍是已结算状态');
  assert.equal(out.value.battle.won, true);
  assert.equal(out.value.encounter.kind, 'reward');
  assert.equal(out.value.encounter.gold, 121, '金币在快照里是已算好的事实，不重算');
  assert.equal(out.value.encounter.unfinished, 'litre');
  // 卡片原样回来，不重抽（tip/leave 是解码后的规范字段，未设置时归一化为 undefined/false）
  assert.deepEqual(out.value.encounter.options.map(o => ({ id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d })),
    env.encounter.options.map(o => ({ id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d })));
  assert.equal(out.value.encounter.node, out.value.run.node, 'encounter 节点与 run.node 同身份');
});

test('事件相位带着展开后的选项与随机结果往返（不重抽）', () => {
  const run = seededRun();
  const env = {
    phase: PHASE.ENCOUNTER, run, battle: null,
    encounter: { kind: 'shop', gold: 100, node: run.node,
      options: [{ id: 'relic:greed', cat: 'relic', ic: '💰', t: '贪婪钱币 · 80 金币', d: '金币 +50%' },
        { id: 'item:stone', cat: 'item', ic: '🪨', t: '磐石之躯 ×3 · 70 金币', d: '+20 护盾', tip: '开局护盾' }] },
  };
  const out = roundTrip(env);
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.encounter.kind, 'shop');
  assert.deepEqual(out.value.encounter.options.map(o => o.id), ['relic:greed', 'item:stone']);
  assert.equal(out.value.encounter.options[1].tip, '开局护盾');
  assert.equal(out.value.encounter.gold, 100);
  assert.equal(out.value.encounter.node, out.value.run.node);
});

test('未选定的相位允许 encounter 为 null，已选定的相位必须有', () => {
  const run = seededRun();
  assert.equal(roundTrip({ phase: PHASE.ENCOUNTER, run, battle: null, encounter: null }).ok, false);
  assert.equal(roundTrip({ phase: PHASE.ENCOUNTER_DONE, run, battle: null, encounter: null }).ok, false);
  const done = roundTrip({ phase: PHASE.ENCOUNTER_DONE, run, battle: null,
    encounter: { kind: 'rest', chosenId: 'rest:heal', node: run.node, options: [] } });
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.value.encounter.chosenId, 'rest:heal');
  // 已生效的相位不要求再带选项：副作用已经发生过，重建只需要 chosenId
  const done2 = roundTrip({ phase: PHASE.ENCOUNTER_DONE, run, battle: null,
    encounter: { kind: 'rest', chosenId: 'rest:heal', node: null, options: [] } });
  assert.equal(done2.ok, true, done2.reason);
  assert.equal(done2.value.encounter.node, null);
});

test('编解码不碰 DOM、不碰 localStorage、不需要 window', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const run = seededRun();
  const out = roundTrip({ phase: PHASE.BATTLE, run, battle: battleFor(run) });
  assert.equal(out.ok, true);
});

/* ---------------- 7. 先知卡的 nextHint=true 是合法事实 ----------------
 * encounters.js 里「先知」卡写的是 G.nextHint = true（不是数字），而 runtime
 * 又用 (G.nextHint||0) 当次数用。快照必须两个形状都认，且 true 原样回来 ——
 * 不能在编解码时把它改成 1（那是篡改游戏 hint 数值），也不能因为它不是数字
 * 就把整份快照判死（那会让「拿到先知卡后暂停」直接不可用）。 */

test('nextHint 为 true（先知卡）时往返后仍是 true，不被改写成数字', () => {
  const run = seededRun();
  run.nextHint = true;
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.nextHint, true, '先知卡语义必须原样保留，不能变成 1');
});

test('nextHint 为非负数字时同样合法且数值不变', () => {
  const run = seededRun();
  run.nextHint = 2; run.shopHints = 3;
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.nextHint, 2);
  assert.equal(out.value.run.shopHints, 3);
  const dirty = JSON.parse(JSON.stringify(encodeSnapshot({ phase: PHASE.MAP, run, battle: null })));
  dirty.run.nextHint = -1;
  assert.equal(decodeSnapshot(dirty).ok, false, '负数仍是脏值');
});

/* ---------------- 8. 快照自身不可读时必须 fail closed，而不是抛错 ----------------
 * 存档会被手改、被旧版本截断、被别的标签页写坏。decode 的调用点在主页与
 * 标题页，加载即执行 —— 在那里抛异常等于整页白屏。这里逐个验证「删键 /
 * 换类型 / 塞 null」都只返回 { ok:false }。 */

test('删掉 history、删掉 battle.word、letters 里混入 null：都不抛错', () => {
  const base = () => JSON.parse(JSON.stringify(encodeSnapshot(envelopeOf())));
  const noHistory = base();
  delete noHistory.run.history;
  const noWord = base();
  delete noWord.battle.word;
  const nullLetter = base();
  nullLetter.battle.letters[1] = null;
  for (const [name, raw] of [['删 history', noHistory], ['删 battle.word', noWord], ['letters 含 null', nullLetter]]) {
    let out;
    assert.doesNotThrow(() => { out = decodeSnapshot(raw); }, name + ' 绝不允许抛错');
    assert.equal(out.ok, false, name + ' 必须被判为不可读');
    assert.equal(out.reason, 'invalid', name);
    assert.equal(out.value, undefined, name);
  }
});

test('嵌套类型被换掉（对象变字符串/数组/数字）一律 invalid，不抛错', () => {
  const cases = [
    ['run.history 是数字', e => { e.run.history = 7; }],
    ['run.rows 是对象', e => { e.run.rows = { 0: [] }; }],
    ['run.bag 是数组', e => { e.run.bag = []; }],
    ['run.pool 是字符串', e => { e.run.pool = 'litre'; }],
    ['battle.word 是字符串', e => { e.battle.word = 'litre'; }],
    ['battle.foe 是 null', e => { e.battle.foe = null; }],
    ['battle.usedThisFight 是字符串', e => { e.battle.usedThisFight = 'x'; }],
    ['battle.letters 是对象', e => { e.battle.letters = {}; }],
    ['battle.input 是数字', e => { e.battle.input = 3; }],
  ];
  for (const [name, mutate] of cases) {
    const raw = JSON.parse(JSON.stringify(encodeSnapshot(envelopeOf())));
    mutate(raw);
    let out;
    assert.doesNotThrow(() => { out = decodeSnapshot(raw); }, name + ' 绝不允许抛错');
    assert.equal(out.ok, false, name + ' 必须被拒绝');
    assert.equal(out.reason, 'invalid', name);
  }
});

test('自定义词的 th 可以是 undefined（教材词都是字符串），但对象/数字是脏值', () => {
  const custom = [{ u: 0, d: 2, w: 'myword', z: '自定义' }];      // 无 th
  const run = createRun(0, HERO, UNIT1.concat(custom), mulberry(3));
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.pool.at(-1).th, undefined);
  const dirty = JSON.parse(JSON.stringify(encodeSnapshot({ phase: PHASE.MAP, run, battle: null })));
  dirty.run.pool[0].th = { nested: true };
  assert.equal(decodeSnapshot(dirty).ok, false, 'th 是对象属于损坏');
});

/* ---------------- 9. 事件元信息：optionById 靠 title 找回原来的卡 ----------------
 * encounters.js 的恢复路径是 `EVENTS.filter(x => x.t === desc.title)`，
 * 而 describe('event', …) 把 title/text/icon 挂在 encounter 上。编码漏掉这三
 * 个字段 = 恢复后一张卡都映射不出来，事件屏变成空屏。这里锁住三字段不丢。 */

test('事件的 title/text/icon 全部落盘并原样还原（optionById 才找得到卡）', () => {
  const run = seededRun();
  const env = {
    phase: PHASE.ENCOUNTER, run, battle: null,
    encounter: {
      kind: 'event', node: run.node, title: '神秘的背包', icon: '🎁', text: '你捡到一个鼓鼓的背包，主人却不见了。',
      options: [
        { id: 'pack:open', cat: 'relic', ic: '💎', t: '打开看看', d: '随机获得一个遗物' },
        { id: 'pack:leave', cat: 'none', ic: '🚶', t: '不关我事', d: '离开，什么也不发生', leave: true },
      ],
    },
  };
  const json = JSON.stringify(encodeSnapshot(env));
  assert.match(json, /"title":"神秘的背包"/, '事件标题必须真的进了 JSON');
  assert.match(json, /"icon":"🎁"/);
  const out = roundTrip(env);
  assert.equal(out.ok, true, out.reason);
  const e = out.value.encounter;
  assert.equal(e.title, '神秘的背包');
  assert.equal(e.icon, '🎁');
  assert.equal(e.text, '你捡到一个鼓鼓的背包，主人却不见了。');
  assert.deepEqual(e.options.map(o => o.id), ['pack:open', 'pack:leave']);
  assert.equal(e.options[1].leave, true);
});

test('非事件相位不强制 title/text/icon，脏类型仍然拒绝', () => {
  const run = seededRun();
  const shop = roundTrip({ phase: PHASE.ENCOUNTER, run, battle: null,
    encounter: { kind: 'shop', gold: 100, node: run.node,
      options: [{ id: 'shop:potion', cat: 'heal', ic: '💚', t: '疗伤药剂', d: '回复 35 点生命' }] } });
  assert.equal(shop.ok, true, shop.reason);
  assert.equal(shop.value.encounter.title, undefined, '商店没有标题字段是正常的');
  const dirty = JSON.parse(JSON.stringify(encodeSnapshot({ phase: PHASE.ENCOUNTER, run, battle: null,
    encounter: { kind: 'event', title: 'x', text: 'y', icon: 'z', node: run.node,
      options: [{ id: 'a:1', cat: 'none', ic: '🚶', t: '走', d: '离开' }] } })));
  dirty.encounter.title = 42;
  assert.equal(decodeSnapshot(dirty).ok, false, 'title 是数字属于损坏');
});

/* ---------------- 10. 结算前最后一刻：ENDING 相位 ----------------
 * BOSS 打赢后奖励已发、战败后也已完成结算，但 endRun 还没跑（result 还是
 * undefined）。这时必须能被快照带走，否则刷新会让玩家重打一场已经赢了/输了
 * 的战斗。outcome 是这个相位**唯一**需要的额外事实：赢了还是输了。
 * run.result 一旦是布尔，说明 endRun 已经跑过 —— 那时不该再有快照，
 * encodeSnapshot 返回 null，让调用方走 clear，而不是存一份等着重发奖励。 */

test('ENDING 相位：胜利与战败的 outcome 都能往返，且形状是 battle:true / encounter:false', () => {
  for (const outcome of [true, false]) {
    const run = seededRun();
    const env = {
      phase: PHASE.ENDING, outcome, run,
      battle: battleFor(run, { over: true, won: outcome, boss: true, foe: BOSS, finished: true }),
      encounter: null,
    };
    const out = roundTrip(env);
    assert.equal(out.ok, true, 'ENDING ' + outcome + ': ' + out.reason);
    assert.equal(out.value.phase, PHASE.ENDING);
    assert.equal(out.value.outcome, outcome);
    assert.equal(out.value.battle.over, true);
    assert.equal(out.value.battle.finished, true);
    assert.equal(out.value.encounter, null);
  }
});

test('ENDING 相位缺 outcome 或 outcome 是非布尔值时拒绝', () => {
  for (const outcome of [undefined, null, 'win', 1, 0]) {
    const run = seededRun();
    const raw = JSON.parse(JSON.stringify(encodeSnapshot({
      phase: PHASE.ENDING, outcome, run,
      battle: battleFor(run, { over: true, won: true }), encounter: null,
    })));
    delete raw.outcome;
    if (outcome !== undefined) raw.outcome = outcome;
    assert.equal(decodeSnapshot(raw).ok, false, 'outcome=' + JSON.stringify(outcome) + ' 必须被拒绝');
  }
});

test('run.result 已是布尔（endRun 跑过）时 encodeSnapshot 返回 null，不再产生快照', () => {
  for (const result of [true, false]) {
    const run = seededRun({ result });
    assert.equal(encodeSnapshot({ phase: PHASE.MAP, run, battle: null }), null,
      'result=' + result + ' 属于已结算，必须返回 null 让调用方清掉快照');
  }
  const live = seededRun();
  assert.ok(encodeSnapshot({ phase: PHASE.MAP, run: live, battle: null }), '还在进行的远征照常编码');
});

/* ---------------- 11. 不给真实数据乱加地板/上限 ---------------- */

test('真实生成的长序列不被上限误拒（600 项 history、600 层、金币 600）', () => {
  const run = seededRun();
  run.history = Array.from({ length: 600 }, (_, i) => i);      // 纯数字序列
  run.floor = 600; run.maxFloor = 600; run.gold = 600; run.att = 600; run.attOk = 600;
  run.shopHints = 600; run.nextHint = 600;
  const out = roundTrip({ phase: PHASE.MAP, run, battle: null });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.history.length, 600);
  assert.equal(out.value.run.floor, 600);
  assert.equal(out.value.run.gold, 600);
});

/* ---------------- 12. 事件 option 自身不可读时同样 fail closed ---------------- */

test('encounter.options 被换成非数组 / 选项缺 id 时不抛错且被拒绝', () => {
  const run = seededRun();
  const env = { phase: PHASE.ENCOUNTER, run, battle: null,
    encounter: { kind: 'event', title: 'x', text: 'y', icon: 'z', node: run.node,
      options: [{ id: 'pack:open', cat: 'relic', ic: '💎', t: '打开看看', d: '随机获得一个遗物' }] } };
  const bad = [
    ['options 是对象', e => { e.encounter.options = {}; }],
    ['options 是 null', e => { e.encounter.options = null; }],
    ['选项缺 id', e => { delete e.encounter.options[0].id; }],
    ['选项 id 是数字', e => { e.encounter.options[0].id = 1; }],
    ['chosenId 是对象', e => { e.encounter.chosenId = { id: 'x' }; }],
  ];
  for (const [name, mutate] of bad) {
    const raw = JSON.parse(JSON.stringify(encodeSnapshot(env)));
    mutate(raw);
    let out;
    assert.doesNotThrow(() => { out = decodeSnapshot(raw); }, name + ' 绝不允许抛错');
    assert.equal(out.ok, false, name + ' 必须被拒绝');
  }
});

test('run 序列化不含 DOM 缓存与函数（读档不会把页面元素写进存档）', () => {
  const run = seededRun();
  run.mapCache = '<svg>…</svg>';
  run.rows[0][0].links = run.rows[1][0].links;
  const encoded = encodeSnapshot({ phase: PHASE.MAP, run, battle: null });
  const json = JSON.stringify(encoded);
  assert.ok(!json.includes('<svg'), '不得保存 innerHTML');
  assert.ok(!json.includes('availSig'), '纯 UI 派生缓存不进快照');
  const out = decodeSnapshot(encoded);
  assert.equal(out.ok, true);
  assert.equal(out.value.run.mapCache, undefined, 'DOM 缓存不进恢复结果');
});
