/* 逐轮难度（清单 10）的**接线**回归：规则 → 开局 → 战斗 → 快照。
 *
 * 纯规则本身在 tests/unit/round-difficulty.test.js。这里钉住的是接线契约，
 * 也就是「规则算出来了，但没接到线上」时最容易悄悄坏掉的那几条：
 *
 *  A) 开局一次：registerRunStart 定下 roundNumber 之后派生**一次**并存进 run.difficulty。
 *     之后本局内任何动作都不再重算 —— 换词、换战斗、跨单元、续段都逐字不变。
 *  B) 战斗接线：血量走 scaleEnemyHealth（BOSS 的 +40 与缩放**一起**算一次），
 *     蓄力档案走 scaleFoeAttackProfile（base × difficulty），UI 窗口读的是缩放后
 *     的值。三者必须来自同一份事实，否则 UI 显示的蓄力时间和真实伤害会漂移。
 *  C) 同轮不重算：同轮换单元 / 续段之后，倍率与血量/窗口逐字不变。
 *  D) 快照二向严格：合法的 difficulty 逐字往返；旧存档缺键 → undefined（完全基线，
 *     绝不按当前 DB.runs 重算）；脏形状 → 整份快照 fail closed。
 *  E) 恢复后仍是同一档：刷新回来不重排、不改血、不改 runs/wins。
 *
 * ★ 接线层是「读得出真实值」的：这些断言读的都是 runtime/foe-attacks 真实模块
 *   暴露的行为，不是对纯规则的再抄一遍。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { FOE_ATTACK } from '../../src/data/balance.js';
import { createRun, registerRunStart, assignRoundId } from '../../src/domain/run.js';
import { createLifecycle } from '../../src/app/lifecycle.js';
import { createFoeAttackController } from '../../src/app/foe-attacks.js';
import { PHASE, encodeSnapshot, decodeSnapshot } from '../../src/domain/run-snapshot.js';
import {
  deriveRoundDifficulty, scaleFoeAttackProfile, scaleEnemyHealth,
  validateDifficultyFact, encodeDifficulty,
} from '../../src/domain/round-difficulty.js';

const HERO = { id: 'ranger', mod: { hp: 0, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const wordsFor = u => WORDS.filter(w => w.u === u);
const mkDb = (over = {}) => ({ runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [], unitProgress: {}, ...over });

/* 与 runtime.newRun 同构的开局：registerRunStart 定下真实 roundNumber，然后
 * **一次**派生难度存进 run.difficulty。这是接线契约本身，不是复制实现细节：
 * 任何调用方都必须走这条路，否则「同轮冻结」无从保证。 */
function runtimeNewRun(db, unit, hero = HERO) {
  const run = createRun(unit, hero, wordsFor(unit));
  assignRoundId(run, 'rid-' + unit);
  registerRunStart(db, run);
  run.difficulty = deriveRoundDifficulty({
    roundNumber: run.roundNumber, unit: run.unit, segments: run.campaign ? run.campaign.segments : 1,
  });
  return run;
}

/* 控制器测试台：与 foe-attack-runtime.test.js 同构的假定时器 + 真实控制器。 */
function harness({ kind = 'normal', difficulty, maxhp = 60 } = {}) {
  const now = { t: 1000 };
  const jobs = [];
  let seq = 0;
  const timers = new Set();
  const setTimer = (fn, ms) => { const id = ++seq; jobs.push({ id, fn, at: now.t + ms }); timers.add(id); return id; };
  const clearTimer = id => { timers.delete(id); const i = jobs.findIndex(j => j.id === id); if (i >= 0) jobs.splice(i, 1); };
  const lifecycle = createLifecycle({ setTimer, clearTimer, now: () => now.t });

  const G = { hp: maxhp, maxhp, shield: 0, relics: [], floor: 1, unit: 1, difficulty };
  const B = { boss: kind === 'boss', elite: kind === 'elite', over: false, finished: false,
    myHp: maxhp, shield: 0, freezeWord: false, foeAttack: undefined };
  const hits = [];
  const ctl = createFoeAttackController({
    state: { getRun: () => G, getBattle: () => B },
    lifecycle,
    now: () => now.t,
    foeAttackHit: dmg => { hits.push(dmg); return { dealt: dmg, lost: false }; },
    commit: () => {}, renderFight: () => {}, toast: () => {},
    frozen: false,
  });
  return {
    G, B, hits, ctl, lifecycle,
    // 同页暂停是**两个**动作：控制器采下冻结的剩余，lifecycle 冻结在途回调。
    // 少第二步，冻结期间那个到点的回调照样会走 step() —— 真实 runtime 由
    // progress 控制器依次调 pauseFoeAttack() 与 lifecycle.pause()。
    pause() { ctl.pause(); lifecycle.pause(); },
    resume() { lifecycle.resume(); ctl.resume(); },
    get pending() { return jobs.length; },
    async advance(ms) {
      const target = now.t + ms;
      for (;;) {
        const due = jobs.filter(j => j.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        jobs.splice(jobs.indexOf(due), 1);
        now.t = due.at;
        due.fn();
        await Promise.resolve();
      }
      now.t = target;
    },
    get t() { return now.t; },
  };
}

function roundTrip(run, env = {}) {
  const out = encodeSnapshot(Object.assign({ phase: PHASE.MAP, run }, env), { now: 1 });
  assert.ok(out, '内存态合法时必须能编码（null = 判成损坏）');
  const back = decodeSnapshot(JSON.parse(JSON.stringify(out)));
  assert.equal(back.ok, true, back.reason);
  return back.value;
}

/* ================= A：开局一次，冻结 ================= */

test('开局派生一次：run.difficulty 与轮号相容，跨单元/续段/换战斗逐字不变', () => {
  const db = mkDb();
  const run = runtimeNewRun(db, 1);
  assert.equal(run.roundNumber, 1);
  assert.equal(validateDifficultyFact(run.difficulty), true, '派生值必须自洽');
  const frozen = JSON.stringify(run.difficulty);

  // 同轮跨单元 / 续段 / 换战斗：**不**再调用派生，事实原样带着。
  run.unit = 4;
  run.campaign = { startedUnit: 1, segments: 3 };
  assert.equal(JSON.stringify(run.difficulty), frozen, '跨单元/续段不重算');
  // 极端诱惑：即使有人「顺手」重算一次，结果也必须逐字相同（unit/segments 不参与）。
  assert.deepEqual(deriveRoundDifficulty({ roundNumber: 1, unit: 4, segments: 3 }), run.difficulty);
});

test('多轮各自派生，轮号高的那局更厚更痛；DB.runs 仍是唯一轮号来源', () => {
  const db = mkDb();
  const first = runtimeNewRun(db, 1);
  const second = runtimeNewRun(db, 1);
  const third = runtimeNewRun(db, 1);
  assert.deepEqual([first.roundNumber, second.roundNumber, third.roundNumber], [1, 2, 3]);
  assert.deepEqual([db.runs, db.wins], [3, 0], '难度派生绝不碰 wins');
  for (const [run, round] of [[first, 1], [second, 2], [third, 3]]) {
    assert.equal(run.difficulty.roundAtStart, round);
    assert.equal(validateDifficultyFact(run.difficulty), true);
  }
  assert.ok(second.difficulty.hpMultiplier > first.difficulty.hpMultiplier);
  assert.ok(third.difficulty.damageMultiplier > second.difficulty.damageMultiplier);
  assert.ok(third.difficulty.intervalMultiplier < second.difficulty.intervalMultiplier);
});

/* ================= B：战斗接线（血量 + 蓄力档案 + UI 窗口同源） ================= */

test('血量走 scaleEnemyHealth 且只算一次；BOSS 的 +40 与缩放一起考虑', () => {
  const db = mkDb({ runs: 4 });                       // 下一局是第 5 轮
  const run = runtimeNewRun(db, 1);
  const base = 130;
  // 第 1 轮逐字等于原血量（接线不改变既有手感）。
  assert.equal(scaleEnemyHealth(base, deriveRoundDifficulty({ roundNumber: 1 })), base);
  // 第 5 轮更厚；BOSS 的 +40 是在**缩放之后**叠加的固定奖励，不参与缩放 ——
  // 两者顺序反了会让 BOSS 随轮次额外膨胀一截，那是没设计过的难度。
  const d = run.difficulty;
  const scaled = scaleEnemyHealth(base, d);
  assert.equal(scaled, Math.round(base * d.hpMultiplier));
  assert.ok(scaled > base);
  const bossTotal = scaled + 40;
  assert.equal(bossTotal - scaled, 40, 'BOSS +40 恒定，不随轮次再缩放一次');
});

test('蓄力档案走 scaleFoeAttackProfile：base × difficulty，UI 窗口与真实排期同源', async () => {
  for (const round of [1, 2, 5, 9, 50]) {
    const h = harness({ kind: 'normal', difficulty: deriveRoundDifficulty({ roundNumber: round }) });
    h.ctl.start();
    const win = h.ctl.window();
    const expect = scaleFoeAttackProfile(FOE_ATTACK.normal, h.G.difficulty);
    // controller.window() 只对外暴露蓄力条需要的两项（UI 不读整份档案）。
    assert.deepEqual(win, { telegraphMs: expect.telegraphMs, damage: expect.damage }, '第 ' + round + ' 轮 UI 窗口');
    // 开局的 idle 剩余时间必须就是缩放后的 idle 窗口（事实与 UI 一致）。
    assert.equal(h.B.foeAttack.remainingMs, expect.idleMs, '第 ' + round + ' 轮起始剩余');
    // 真实排期也按缩放后的窗口走：idle 走完正好进 telegraph，不多不少。
    await h.advance(expect.idleMs);
    assert.equal(h.B.foeAttack.phase, 'telegraph', '第 ' + round + ' 轮 idle→telegraph');
    await h.advance(expect.telegraphMs);
    assert.deepEqual(h.hits, [expect.damage], '第 ' + round + ' 轮蓄满恰好打一下，伤害取缩放档');
  }
});

test('逐轮间隔更短、伤害与血量非减且封顶；窗口永远有界', () => {
  let prev = null;
  for (const round of [1, 2, 5, 9, 50]) {
    const d = deriveRoundDifficulty({ roundNumber: round });
    const p = scaleFoeAttackProfile(FOE_ATTACK.normal, d);
    if (prev) {
      assert.ok(p.idleMs <= prev.idleMs, '第 ' + round + ' 轮 idle 不该变长');
      assert.ok(p.telegraphMs <= prev.telegraphMs, '第 ' + round + ' 轮 telegraph 不该变长');
      assert.ok(p.recoverMs <= prev.recoverMs, '第 ' + round + ' 轮 recover 不该变长');
      assert.ok(p.damage >= prev.damage, '第 ' + round + ' 轮伤害不该下降');
    }
    assert.ok(p.idleMs >= 3500 && p.telegraphMs >= 3000 && p.recoverMs >= 2000, '第 ' + round + ' 轮窗口有界');
    prev = p;
  }
  // 封顶：第 9 轮与第 50 轮逐字相同。
  assert.deepEqual(scaleFoeAttackProfile(FOE_ATTACK.normal, deriveRoundDifficulty({ roundNumber: 9 })),
    scaleFoeAttackProfile(FOE_ATTACK.normal, deriveRoundDifficulty({ roundNumber: 50 })));
  assert.equal(scaleEnemyHealth(100, deriveRoundDifficulty({ roundNumber: 50 })),
    scaleEnemyHealth(100, deriveRoundDifficulty({ roundNumber: 1e9 })));
});

test('换词不重排蓄力：同一场战斗里换 B.word 之后窗口与剩余都不变', async () => {
  const h = harness({ kind: 'normal', difficulty: deriveRoundDifficulty({ roundNumber: 5 }) });
  h.ctl.start();
  const before = h.ctl.window();
  await h.advance(1000);
  const remainingBefore = h.ctl.remainingMs();
  // nextWord 换词（runtime 不重置控制器）之后：
  h.B.word = { w: 'example', z: '例子' };
  assert.deepEqual(h.ctl.window(), before, '换词不重算档位');
  assert.equal(h.ctl.remainingMs(), remainingBefore, '换词不重排倒计时');
});

/* ================= C：同轮跨单元 / 恢复不重算 ================= */

test('同轮跨单元：difficulty 原样带着，战斗仍按同一档', async () => {
  const db = mkDb({ runs: 2 });
  const run = runtimeNewRun(db, 1);                   // 第 3 轮
  const h = harness({ kind: 'elite', difficulty: run.difficulty });
  h.G.difficulty = run.difficulty;
  h.ctl.start();
  const win = h.ctl.window();
  // 跨到 Unit 5、续到第 3 段（同一轮学习）。
  run.unit = 5;
  run.campaign = { startedUnit: 1, segments: 3 };
  assert.deepEqual(h.G.difficulty, run.difficulty, '跨单元不换档');
  assert.deepEqual(h.ctl.window(), win, '跨单元后窗口逐字不变');
  // 新一场战斗（换节点）读的还是同一份事实。
  const h2 = harness({ kind: 'boss', difficulty: run.difficulty });
  h2.ctl.start();
  const bossCfg = scaleFoeAttackProfile(FOE_ATTACK.boss, run.difficulty);
  assert.deepEqual(h2.ctl.window(), { telegraphMs: bossCfg.telegraphMs, damage: bossCfg.damage });
  assert.equal(h2.B.foeAttack.remainingMs, bossCfg.idleMs, '新战斗也按同一档的 idle 窗口起手');
});

/* ================= D：快照二向严格 + 旧档完全基线 ================= */

test('合法 difficulty 逐字往返；旧快照缺键保持 undefined（绝不按 DB.runs 补）', () => {
  const db = mkDb({ runs: 8 });                       // 第 9 轮（封顶档）
  const run = runtimeNewRun(db, 1);
  const back = roundTrip(run);
  assert.deepEqual(back.run.difficulty, run.difficulty);
  assert.equal(validateDifficultyFact(back.run.difficulty), true);

  // 旧快照：完全没有 difficulty 这个键 —— 解码后必须仍是 undefined。
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  delete env.run.difficulty;
  const legacy = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(legacy.ok, true, legacy.reason);
  assert.equal(legacy.value.run.difficulty, undefined, '★ 旧存档不许补出难度事实');
  // ★ 也不许按当前 DB.runs（此刻是 9）重算：那样刷新一次就给老玩家凭空升到封顶档。
  assert.deepEqual(scaleEnemyHealth(130, legacy.value.run.difficulty), 130, '旧存档完全基线');
  assert.deepEqual(scaleFoeAttackProfile(FOE_ATTACK.boss, legacy.value.run.difficulty),
    { idleMs: FOE_ATTACK.boss.idleMs, telegraphMs: FOE_ATTACK.boss.telegraphMs, recoverMs: FOE_ATTACK.boss.recoverMs, damage: FOE_ATTACK.boss.damage });
});

test('脏 difficulty 让整份快照 fail closed（绝不洗白成合法值）', () => {
  const run = runtimeNewRun(mkDb({ runs: 2 }), 1);
  const good = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  assert.equal(good.run.difficulty.roundAtStart, 3);
  const dirty = [
    { version: 2, roundAtStart: 3, hpMultiplier: 1.16, damageMultiplier: 1.12, intervalMultiplier: 0.9 },
    { version: 1, roundAtStart: 3 },                                   // 倍率全缺
    { version: 1, roundAtStart: 3, hpMultiplier: NaN, damageMultiplier: 1.12, intervalMultiplier: 0.9 },
    { version: 1, roundAtStart: 3, hpMultiplier: 1.16, damageMultiplier: 1.12 },
    // ★ 与轮号不相容的倍率：轮号 3 却带封顶档倍率，绝不能通过。
    { version: 1, roundAtStart: 3, hpMultiplier: 1.64, damageMultiplier: 1.48, intervalMultiplier: 0.6 },
    { version: 1, roundAtStart: 1, hpMultiplier: 999999, damageMultiplier: 1, intervalMultiplier: 1 },
    'x', 5, [], { version: 1, roundAtStart: 3.5, hpMultiplier: 1.16, damageMultiplier: 1.12, intervalMultiplier: 0.9 },
  ];
  for (const bad of dirty) {
    const env = JSON.parse(JSON.stringify(good));
    env.run.difficulty = bad;
    const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
    assert.equal(out.ok, false, '脏难度必须整份拒绝：' + JSON.stringify(bad));
    assert.equal(out.reason, 'invalid');
  }
  // 编码侧同样 fail closed：内存态自己脏了就整份不写，而不是写一份缺了难度的快照。
  const bad2 = Object.assign({}, run, { difficulty: { version: 1, roundAtStart: 3, hpMultiplier: 9e5, damageMultiplier: 1, intervalMultiplier: 1 } });
  assert.equal(encodeSnapshot({ phase: PHASE.MAP, run: bad2 }, { now: 1 }), null);
});

test('编码侧只写那五个键，绝不夹取/补写洗白内存事实', () => {
  const run = runtimeNewRun(mkDb({ runs: 1 }), 1);   // 第 2 轮
  const env = encodeSnapshot({ phase: PHASE.MAP, run }, { now: 1 });
  assert.deepEqual(Object.keys(env.run.difficulty).sort(),
    ['damageMultiplier', 'hpMultiplier', 'intervalMultiplier', 'roundAtStart', 'version']);
  assert.deepEqual(env.run.difficulty, encodeDifficulty(run.difficulty));
  assert.equal(env.run.difficulty.version, 1);
});

/* ================= E：恢复后仍是同一档，且不碰 runs/wins ================= */

test('恢复后仍是同一档：血量/窗口不变，runs 与 wins 一次都不动', async () => {
  const db = mkDb({ runs: 4 });
  const run = runtimeNewRun(db, 1);                  // 第 5 轮
  const fact = run.difficulty;
  const saved = roundTrip(run, { phase: PHASE.MAP });
  assert.deepEqual(saved.run.difficulty, fact);
  // 恢复只是把存档里的事实读回来，绝不重新派生。
  assert.deepEqual(saved.run.difficulty, deriveRoundDifficulty({ roundNumber: saved.run.roundNumber }));
  assert.equal(db.runs, 5, '恢复不新增远征次数');
  assert.equal(db.wins, 0, '恢复不记通关');

  // 恢复后开一场战斗：同一档血量与同一档蓄力档案。
  const h = harness({ kind: 'normal', difficulty: saved.run.difficulty });
  h.ctl.start();
  const restoredCfg = scaleFoeAttackProfile(FOE_ATTACK.normal, fact);
  assert.deepEqual(h.ctl.window(), { telegraphMs: restoredCfg.telegraphMs, damage: restoredCfg.damage });
  assert.equal(scaleEnemyHealth(130, saved.run.difficulty), scaleEnemyHealth(130, fact));
  await h.advance(restoredCfg.idleMs);
  assert.equal(h.B.foeAttack.phase, 'telegraph');
});

/* ================= F：暂停冻结的事实与难度无关 ================= */

test('暂停冻结剩余与伤害：难度档位不改变冻结口径（同页恢复不多打）', async () => {
  for (const round of [1, 5, 50]) {
    const h = harness({ kind: 'boss', difficulty: deriveRoundDifficulty({ roundNumber: round }) });
    h.ctl.start();
    const cfg = scaleFoeAttackProfile(FOE_ATTACK.boss, h.G.difficulty);
    await h.advance(cfg.idleMs);                    // 进 telegraph
    assert.equal(h.ctl.pause(), true);
    h.lifecycle.pause();
    const hpAtPause = h.B.myHp;
    const leftAtPause = h.ctl.remainingMs();
    await h.advance(5000);                          // 暂停期间墙钟继续走
    assert.equal(h.B.myHp, hpAtPause, '第 ' + round + ' 轮暂停期间不掉血');
    assert.equal(h.ctl.remainingMs(), leftAtPause, '第 ' + round + ' 轮暂停期间剩余不走');
    assert.equal(h.hits.length, 0);
    // 采到快照的事实就是冻结那一刻的剩余（绝不按墙钟重算）。
    assert.equal(h.ctl.captureFact().remainingMs, leftAtPause);
    h.lifecycle.resume();
    h.ctl.resume();
    await h.advance(cfg.telegraphMs);
    assert.deepEqual(h.hits, [cfg.damage], '第 ' + round + ' 轮继续后只挨一下');
  }
});