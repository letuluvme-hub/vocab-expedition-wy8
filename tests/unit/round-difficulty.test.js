/* 逐轮难度递增的纯规则单元回归（docs/feature-round-difficulty.md，清单 10）。
 *
 * 契约（逐条核对，全部是纯函数：src/domain/round-difficulty.js 不碰 DOM /
 * 存储 / 全局 / 计时器，只接收显式事实并返回可序列化结果）：
 *  1) 事实形状固定且可序列化：{version:1, roundAtStart, hpMultiplier,
 *     damageMultiplier, intervalMultiplier} —— 只有这五个键。
 *  2) 第 1 轮是基线：三个倍率恒等于 1（不改现有手感的起点）。
 *  3) 只依据真实 roundNumber：缺失 / NaN / 字符串 / 0 / 负数一律保守按第 1 轮。
 *     unit 与 segments **只被接收、不参与计算**，绝不偷偷当成新轮编号。
 *  4) 单调且有上限：hp / damage 逐轮递增、interval 逐轮递减，全部封顶在
 *     有限最高档；超大轮号（1e9）只封顶倍率，不改写轮号事实。
 *  5) 同轮跨单元 / 跨段结果逐字相同（同轮不重算）。
 *  6) 三类思考窗口有硬下限：任何档位、任何怪物，
 *     idle ≥ 3500ms、telegraph ≥ 3000ms、recover ≥ 2000ms。
 *  7) boss / elite 仍然强于 normal（同一倍率下排序不变），且统一上限。
 *  8) 纯函数：入参不被改写，重复调用结果一致，无全局 / 无 DOM 依赖。
 *  9) **脏事实整体 fail closed**：任意一个字段不合法 → 三个倍率全部回落 1，
 *     绝不部分采用。编解码二向严格：缺失（旧存档）是合法的 undefined，
 *     脏形状是 undefined（不是洗白后的对象）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOE_ATTACK } from '../../src/data/balance.js';
import {
  DIFFICULTY_VERSION, MAX_DIFFICULTY_ROUND,
  HP_STEP, DAMAGE_STEP, INTERVAL_STEP,
  MAX_HP_MULTIPLIER, MAX_DAMAGE_MULTIPLIER, MIN_INTERVAL_MULTIPLIER,
  MIN_IDLE_MS, MIN_TELEGRAPH_MS, MIN_RECOVER_MS,
  deriveRoundDifficulty, scaleFoeAttackProfile, scaleEnemyHealth,
  validateDifficultyFact, encodeDifficulty, decodeDifficulty,
} from '../../src/domain/round-difficulty.js';

const KINDS = ['normal', 'elite', 'boss'];
const at = n => deriveRoundDifficulty({ roundNumber: n });
const KEYS = ['version', 'roundAtStart', 'hpMultiplier', 'damageMultiplier', 'intervalMultiplier'];

/* ---------------- 垂直 1：事实形状 / 可序列化 ---------------- */

test('事实只有五个键，version 恒为 1，JSON 往返逐字不变', () => {
  for (const n of [1, 2, 5, MAX_DIFFICULTY_ROUND, 99999]) {
    const d = at(n);
    assert.deepEqual(Object.keys(d).sort(), [...KEYS].sort(), 'round ' + n);
    assert.equal(d.version, DIFFICULTY_VERSION);
    assert.equal(d.version, 1);
    for (const k of KEYS) assert.equal(typeof d[k] === 'number' || k === 'version' ? Number.isFinite(d[k]) : false, true, k);
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d, 'JSON 往返逐字相同');
  }
});

/* ---------------- 垂直 2：基线与脏值 ---------------- */

test('第 1 轮是基线：三个倍率恒等于 1', () => {
  const d = at(1);
  assert.equal(d.roundAtStart, 1);
  assert.equal(d.hpMultiplier, 1);
  assert.equal(d.damageMultiplier, 1);
  assert.equal(d.intervalMultiplier, 1);
});

test('缺省 / 脏 roundNumber 保守按第 1 轮，且不抛异常', () => {
  const baseline = at(1);
  const dirty = [
    undefined, null, {}, { roundNumber: undefined }, { roundNumber: null },
    { roundNumber: NaN }, { roundNumber: Infinity }, { roundNumber: -Infinity },
    { roundNumber: 0 }, { roundNumber: -7 }, { roundNumber: '4' }, { roundNumber: 'abc' },
    { roundNumber: 1.7 }, { roundNumber: {} }, { roundNumber: [] }, { roundNumber: true },
  ];
  for (const arg of dirty) {
    assert.deepEqual(deriveRoundDifficulty(arg), baseline, JSON.stringify(arg));
  }
  assert.deepEqual(deriveRoundDifficulty(), baseline, '无参调用');
});

test('★ 小数轮号是脏形状：保守按第 1 轮，绝不 floor 成中间档', () => {
  // 轮号在存档里必须**是整数**（run-snapshot 的 roundNumber 就是 isInt 校验），
  // 所以 3.9 只可能来自损坏/伪造的存档。按整数部分（floor）猜一档等于
  // 「读不出来还给玩家上难度」；正确读法是整个事实回落基线。
  const baseline = at(1);
  for (const raw of [1.7, 3.9, 8.999, 1e-9, -0.5, 50.5]) {
    assert.deepEqual(deriveRoundDifficulty({ roundNumber: raw }), baseline, '小数轮号 ' + raw);
  }
  // 整数轮号（含极大值）原样记录：轮号是真实事实，不被上限改写。
  assert.equal(at(3).roundAtStart, 3);
  assert.equal(at(1e9).roundAtStart, 1e9);
});

/* ---------------- 垂直 3：单调 + 封顶 ---------------- */

test('逐轮单调：hp / damage 递增、interval 递减，且步长就是导出的常量', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' 约等于 ' + b);
  near(at(2).hpMultiplier - at(1).hpMultiplier, HP_STEP);
  near(at(2).damageMultiplier - at(1).damageMultiplier, DAMAGE_STEP);
  near(at(1).intervalMultiplier - at(2).intervalMultiplier, INTERVAL_STEP);
  for (let n = 2; n <= 60; n++) {
    assert.ok(at(n).hpMultiplier >= at(n - 1).hpMultiplier, 'hp 第 ' + n + ' 轮不下降');
    assert.ok(at(n).damageMultiplier >= at(n - 1).damageMultiplier, 'damage 第 ' + n + ' 轮不下降');
    assert.ok(at(n).intervalMultiplier <= at(n - 1).intervalMultiplier, 'interval 第 ' + n + ' 轮不上升');
  }
});

test('封顶：超过最高档后倍率逐字不变，仍是有限数', () => {
  const top = at(MAX_DIFFICULTY_ROUND);
  assert.equal(top.hpMultiplier, MAX_HP_MULTIPLIER);
  assert.equal(top.damageMultiplier, MAX_DAMAGE_MULTIPLIER);
  assert.equal(top.intervalMultiplier, MIN_INTERVAL_MULTIPLIER);
  for (const n of [MAX_DIFFICULTY_ROUND + 1, 100, 1e6, 1e9, Number.MAX_SAFE_INTEGER]) {
    const d = at(n);
    assert.deepEqual(d, { ...top, roundAtStart: n }, '第 ' + n + ' 轮只有轮号不同');
    assert.ok(d.hpMultiplier > 1 && d.damageMultiplier > 1 && d.intervalMultiplier > 0);
    assert.ok(d.intervalMultiplier < 1, 'interval 永远快于基线但不为 0');
  }
});

test('最高档是有限正数，不会出现 0 倍 / 负数 / 无穷', () => {
  for (const n of [1, 2, 9, 50, 1e9]) {
    const d = at(n);
    assert.ok(d.hpMultiplier >= 1 && d.hpMultiplier <= MAX_HP_MULTIPLIER, 'hp ' + n);
    assert.ok(d.damageMultiplier >= 1 && d.damageMultiplier <= MAX_DAMAGE_MULTIPLIER, 'damage ' + n);
    assert.ok(d.intervalMultiplier >= MIN_INTERVAL_MULTIPLIER && d.intervalMultiplier <= 1, 'interval ' + n);
  }
});

/* ---------------- 垂直 4：unit / segments 不参与计算 ---------------- */

test('同轮跨单元 / 跨段结果逐字相同：unit 与 segments 不当轮编号', () => {
  const units = [1, 2, 3, 4, 5, 6];
  const segs = [1, 2, 3, 7];
  for (const round of [1, 2, 4, MAX_DIFFICULTY_ROUND]) {
    const ref = at(round);
    for (const unit of units) {
      for (const segments of segs) {
        const d = deriveRoundDifficulty({ roundNumber: round, unit, segments });
        assert.deepEqual(d, ref, 'round ' + round + ' unit ' + unit + ' segments ' + segments);
        assert.equal(d.roundAtStart, round, '轮号不被 unit/segments 顶替');
      }
    }
  }
});

test('unit / segments 是脏值时也不影响结果（它们根本不参与计算）', () => {
  const ref = at(2);
  for (const extra of [{ unit: 'x' }, { segments: -1 }, { unit: null }, { segments: NaN }, { unit: 99, segments: 99 }]) {
    assert.deepEqual(deriveRoundDifficulty({ roundNumber: 2, ...extra }), ref, JSON.stringify(extra));
  }
});

/* ---------------- 垂直 5：攻击参数缩放 + 三类窗口下限 ---------------- */

test('scaleFoeAttackProfile 逐轮更快更痛，但不突变基线', () => {
  const base = FOE_ATTACK.normal;
  const r1 = scaleFoeAttackProfile(base, at(1));
  assert.deepEqual(r1, { idleMs: base.idleMs, telegraphMs: base.telegraphMs, recoverMs: base.recoverMs, damage: base.damage });
  const prev = r1;
  for (let n = 2; n <= 40; n++) {
    const cur = scaleFoeAttackProfile(base, at(n));
    for (const f of ['idleMs', 'telegraphMs', 'recoverMs']) {
      assert.ok(cur[f] <= prev[f], '第 ' + n + ' 轮 ' + f + ' 不该变慢');
      assert.ok(Number.isInteger(cur[f]) && cur[f] > 0, f + ' 是正整数');
    }
    assert.ok(cur.damage >= prev.damage, '第 ' + n + ' 轮伤害不该下降');
    assert.ok(Number.isInteger(cur.damage) && cur.damage > 0);
    assert.deepEqual(cur, scaleFoeAttackProfile(base, at(n)), '同参数重复调用一致');
  }
});

test('三类思考窗口在任何档位 / 任何怪物都不低于下限', () => {
  // ★ 字面量而非导出常量：断言必须独立于实现，否则改常量就自动改期望（变异测试 M3 存活）。
  assert.equal(MIN_IDLE_MS, 3500, 'idle 下限是 3500ms');
  assert.equal(MIN_TELEGRAPH_MS, 3000, 'telegraph 下限是 3000ms');
  assert.equal(MIN_RECOVER_MS, 2000, 'recover 下限是 2000ms');
  const FLOORS = { idleMs: 3500, telegraphMs: 3000, recoverMs: 2000 };
  const rounds = [1, 2, 3, 5, MAX_DIFFICULTY_ROUND, 40, 1e9];
  for (const kind of KINDS) {
    for (const n of rounds) {
      const p = scaleFoeAttackProfile(FOE_ATTACK[kind], at(n));
      for (const f of Object.keys(FLOORS)) {
        assert.ok(p[f] >= FLOORS[f], kind + ' 第 ' + n + ' 轮 ' + f + ' ' + p[f] + ' < ' + FLOORS[f]);
      }
    }
  }
  // 收紧下限必须真的生效：最难的一档确实贴住了 floor（不是恰好自然落在上面）。
  const hardest = scaleFoeAttackProfile(FOE_ATTACK.boss, at(1e9));
  assert.equal(hardest.telegraphMs, 3000, 'boss 蓄力窗口在最高档被下限夹住');
});

test('boss / elite 始终强于 normal：伤害更高、窗口不更长', () => {
  for (const n of [1, 4, MAX_DIFFICULTY_ROUND, 1e9]) {
    const normal = scaleFoeAttackProfile(FOE_ATTACK.normal, at(n));
    const elite = scaleFoeAttackProfile(FOE_ATTACK.elite, at(n));
    const boss = scaleFoeAttackProfile(FOE_ATTACK.boss, at(n));
    assert.ok(boss.damage > elite.damage && elite.damage > normal.damage, '第 ' + n + ' 轮伤害排序');
    assert.ok(elite.idleMs <= normal.idleMs, '第 ' + n + ' 轮 elite idle');
    assert.ok(boss.idleMs <= elite.idleMs, '第 ' + n + ' 轮 boss idle');
    assert.ok(boss.telegraphMs <= elite.telegraphMs && elite.telegraphMs <= normal.telegraphMs, '第 ' + n + ' 轮 telegraph 排序');
  }
});

test('脏 baseProfile 回落 normal 的数值，脏 difficulty 不缩放；两者都不产生 NaN', () => {
  const base = FOE_ATTACK.normal;
  const safe = { idleMs: base.idleMs, telegraphMs: base.telegraphMs, recoverMs: base.recoverMs, damage: base.damage };
  // 档位仍然生效：回落的是「档案的数值」，不是「本轮不缩放」。
  const scaledNormal = scaleFoeAttackProfile(base, at(9));
  for (const bp of [null, undefined, {}, { idleMs: NaN }, { idleMs: -1, telegraphMs: 'x' }, []]) {
    assert.deepEqual(scaleFoeAttackProfile(bp, at(9)), scaledNormal, JSON.stringify(bp));
  }
  for (const d of [null, undefined, {}, { version: 2 }, { intervalMultiplier: NaN }, { damageMultiplier: -5 }, 'x']) {
    assert.deepEqual(scaleFoeAttackProfile(base, d), safe, JSON.stringify(d));
  }
});

/* ---------------- 垂直 5b：整体 fail closed + 严格编解码（接线层用） ---------------- */

test('★ 部分脏的 difficulty 整体回落基线，绝不部分采用', () => {
  const base = FOE_ATTACK.normal;
  const safe = { idleMs: base.idleMs, telegraphMs: base.telegraphMs, recoverMs: base.recoverMs, damage: base.damage };
  // 每个通道各坏一个：只要有一个字段不合法，三个倍率**全部**回到 1。
  // 「hp 用盘上的、interval 用基线」这种半份难度没人设计过，
  // 也让 999999 倍血量能靠一个看起来合法的 interval 混进存档。
  const halfDirty = [
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: NaN, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: 0 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: null, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: 0.8 },  // 缺 roundAtStart
    { version: DIFFICULTY_VERSION, roundAtStart: 5.5, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 999999, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
  ];
  for (const d of halfDirty) {
    assert.deepEqual(scaleFoeAttackProfile(base, d), safe, JSON.stringify(d));
    assert.equal(scaleEnemyHealth(100, d), 100, JSON.stringify(d));
  }
});

test('validateDifficultyFact 只认合法形状，上下界与轮次事实相容', () => {
  for (const n of [1, 2, 5, 9, 50, 1e9]) {
    assert.equal(validateDifficultyFact(at(n)), true, '第 ' + n + ' 轮派生值必须合法');
  }
  const dirty = [
    undefined, null, 0, 1, 'x', [], {}, { version: 2 },
    { version: DIFFICULTY_VERSION },                        // 倍率全缺
    { version: DIFFICULTY_VERSION, roundAtStart: 0, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 },
    { version: DIFFICULTY_VERSION, roundAtStart: -3, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 },
    { version: DIFFICULTY_VERSION, roundAtStart: 2.5, hpMultiplier: 1.08, damageMultiplier: 1.06, intervalMultiplier: 0.95 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1e9, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1e9, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: 1e9 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 0.01, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: 0.01 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: MAX_HP_MULTIPLIER * 1.01, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: MAX_DAMAGE_MULTIPLIER * 1.01, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: MIN_INTERVAL_MULTIPLIER - 0.01 },
  ];
  for (const d of dirty) {
    assert.equal(validateDifficultyFact(d), false, '脏事实必须被拒：' + JSON.stringify(d));
  }
});

test('encodeDifficulty 合法时逐字返回五个键；非法时 undefined（绝不剥字段洗白）', () => {
  for (const n of [1, 5, 1e9]) {
    const fact = at(n);
    const enc = encodeDifficulty(fact);
    assert.deepEqual(Object.keys(enc).sort(), [...KEYS].sort());
    assert.deepEqual(enc, fact);
    assert.notEqual(enc, fact, '返回新对象，不是入参引用');
  }
  for (const d of [{ version: 2, roundAtStart: 5, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5 }, 'x', 7, []]) {
    assert.equal(encodeDifficulty(d), undefined, JSON.stringify(d));
  }
  // encode 绝不「顺手修正」：错版本不会被改写成 1，巨型倍率不会被夹到上限。
  assert.equal(encodeDifficulty({ version: 2, roundAtStart: 5, hpMultiplier: 9e5, damageMultiplier: 9e5, intervalMultiplier: 0.001 }), undefined);
});

test('decodeDifficulty 缺失（旧存档）是 undefined，脏形状是 undefined，合法值逐字往返', () => {
  for (const missing of [undefined, null]) {
    assert.equal(decodeDifficulty(missing), undefined, '旧存档没有 difficulty 是合法形状');
  }
  const fact = at(5);
  assert.deepEqual(decodeDifficulty(JSON.parse(JSON.stringify(fact))), fact);
  // 极端倍率绝不允许从盘上潜入。
  const hostile = [
    { version: DIFFICULTY_VERSION, roundAtStart: 1, hpMultiplier: 999999, damageMultiplier: 999999, intervalMultiplier: 0.0001 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: '2', intervalMultiplier: 0.8 },
    { version: 99, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1.24, intervalMultiplier: 0.8 },
    { version: DIFFICULTY_VERSION, roundAtStart: 5, hpMultiplier: 1.32, damageMultiplier: 1.24 },
  ];
  for (const raw of hostile) {
    assert.equal(decodeDifficulty(raw), undefined, JSON.stringify(raw));
  }
});

test('★ 只有 hp 通道与轮号不相容也必须被拒（逐通道独立判定）', () => {
  // 逐字钉死「第 1 轮派生值就是三个 1」：拿它当基准，任何一个通道被单独改大/改小
  // 都必须被 validateDifficultyFact 拒掉。这条是「倍率必须与轮号互相对得上」的
  // 最小证明 —— 只夹上下界挡不住「基线轮 + 封顶倍率」这种存档。
  assert.deepEqual(at(1), { version: 1, roundAtStart: 1, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 });
  const solo = [
    { hpMultiplier: MAX_HP_MULTIPLIER },
    { hpMultiplier: 1.01 },
    { damageMultiplier: MAX_DAMAGE_MULTIPLIER },
    { damageMultiplier: 1.01 },
    { intervalMultiplier: MIN_INTERVAL_MULTIPLIER },
    { intervalMultiplier: 0.99 },
  ];
  for (const patch of solo) {
    const dirty = Object.assign({ version: DIFFICULTY_VERSION, roundAtStart: 1,
      hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 }, patch);
    assert.equal(validateDifficultyFact(dirty), false,
      '第 1 轮只有一个通道被改也必须被拒：' + JSON.stringify(patch));
    assert.equal(encodeDifficulty(dirty), undefined, JSON.stringify(patch));
    assert.equal(decodeDifficulty(dirty), undefined, JSON.stringify(patch));
  }
  // 反向自证：把值改回与轮号相容的合法档，就必须通过（否则上面全是「因为别的原因被拒」）。
  assert.equal(validateDifficultyFact(at(9)), true);
});

test('脏档案的回落值真的跟着 FOE_ATTACK 走（不留第二份字面量）', () => {
  // 临时改 balance 的 normal 档：脏 baseProfile 的回落值必须同步跟着变。
  // 做不到这件事，就说明本模块抄了一份 6000/5000/2500/4 —— 两份数值迟早漂移，
  // 而漂移的后果是「UI 显示的蓄力时间和真实伤害对不上」，且极难自查。
  const original = { ...FOE_ATTACK.normal };
  try {
    FOE_ATTACK.normal.idleMs = 4321;
    FOE_ATTACK.normal.telegraphMs = 3456;
    FOE_ATTACK.normal.recoverMs = 2345;
    FOE_ATTACK.normal.damage = 6;
    const dirtyBases = [null, undefined, {}, { idleMs: NaN }, { idleMs: -1, telegraphMs: 'x' }, []];
    for (const bp of dirtyBases) {
      assert.deepEqual(scaleFoeAttackProfile(bp, at(1)), FOE_ATTACK.normal, JSON.stringify(bp));
    }
    // 缩放仍照做：回落的是「档案的数值」，不是「本轮不缩放」。
    // ★ 三类窗口都有硬下限，4321×0.6 之类的小数会被 floor 夹住（idle 3500 / telegraph
    //   3000 / recover 2000）—— 所以这里只断言**夹住**（这正是设计意图），
    //   而「倍率真的生效」由 damage 这个没有下限的通道证明。
    const scaled = scaleFoeAttackProfile({}, at(9));
    assert.equal(scaled.idleMs, 3500, 'idle 被硬下限夹住');
    assert.equal(scaled.telegraphMs, 3000, 'telegraph 被硬下限夹住');
    assert.equal(scaled.recoverMs, 2000, 'recover 被硬下限夹住');
    assert.equal(scaled.damage, Math.round(6 * 1.48), '伤害按本轮倍率放大');
    // 第 1 轮（倍率 1）则是逐字等于改过的 base —— 证明回落值确实来自 FOE_ATTACK。
    assert.deepEqual(scaleFoeAttackProfile({}, at(1)), FOE_ATTACK.normal);
  } finally {
    Object.assign(FOE_ATTACK.normal, original);
  }
  // 复原后立刻回到真实数值（证明上面确实改过、又确实改回来了）。
  assert.deepEqual(scaleFoeAttackProfile({}, at(1)), FOE_ATTACK.normal);
});

/* ---------------- 垂直 6：敌人血量 ---------------- */

test('scaleEnemyHealth 逐轮更厚，第 1 轮逐字等于原血量', () => {
  const base = 120;
  assert.equal(scaleEnemyHealth(base, at(1)), base);
  let prev = base;
  for (let n = 2; n <= 40; n++) {
    const cur = scaleEnemyHealth(base, at(n));
    assert.ok(cur >= prev, '第 ' + n + ' 轮血量不该下降');
    assert.ok(Number.isInteger(cur) && cur >= 1);
    prev = cur;
  }
  assert.ok(prev > base);
});

test('scaleEnemyHealth 封顶在统一上限内，脏值不产生 NaN', () => {
  const base = 100;
  assert.equal(scaleEnemyHealth(base, at(1e9)), Math.round(base * MAX_HP_MULTIPLIER));
  assert.ok(scaleEnemyHealth(base, at(1e9)) <= Math.round(base * MAX_HP_MULTIPLIER) + 1);
  assert.equal(scaleEnemyHealth(NaN, at(9)), 1);
  assert.equal(scaleEnemyHealth(undefined, at(9)), 1);
  assert.equal(scaleEnemyHealth(-30, at(9)), 1);
  assert.equal(scaleEnemyHealth('abc', at(9)), 1);
  assert.equal(scaleEnemyHealth(base, null), base, '脏 difficulty 不缩放');
  assert.equal(scaleEnemyHealth(base, { version: 99, hpMultiplier: 999 }), base);
});

test('小数血量按四舍五入取整到正整数', () => {
  const v = scaleEnemyHealth(30.5, at(2));
  assert.ok(Number.isInteger(v) && v >= 1);
});

/* ---------------- 垂直 7：纯度 ---------------- */

test('纯函数：入参逐字节不变，输出是新对象', () => {
  const base = { ...FOE_ATTACK.boss };
  const snapshot = JSON.stringify(base);
  const d = at(6);
  const out = scaleFoeAttackProfile(base, d);
  assert.equal(JSON.stringify(base), snapshot, 'baseProfile 未被改写');
  assert.notEqual(out, base);
  assert.deepEqual(Object.keys(out).sort(), ['damage', 'idleMs', 'recoverMs', 'telegraphMs']);
  const dSnapshot = JSON.stringify(d);
  scaleFoeAttackProfile(base, d);
  scaleEnemyHealth(100, d);
  assert.equal(JSON.stringify(d), dSnapshot, 'difficulty 未被改写');
  // 返回值不能是共享引用：改一份不影响另一份。
  out.idleMs = 1;
  assert.notEqual(scaleFoeAttackProfile(FOE_ATTACK.boss, d).idleMs, 1);
});

test('无全局 / 无 DOM 依赖：同参数调用结果与调用顺序无关', () => {
  const warm = scaleFoeAttackProfile(FOE_ATTACK.elite, at(7));
  scaleEnemyHealth(999, at(3));
  assert.deepEqual(scaleFoeAttackProfile(FOE_ATTACK.elite, at(7)), warm);
});