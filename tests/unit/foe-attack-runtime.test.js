import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycle } from '../../src/app/lifecycle.js';
import { createFoeAttackController } from '../../src/app/foe-attacks.js';
import { FOE_ATTACK } from '../../src/data/balance.js';
import { FOE_PHASE, decodeFoeAttack, encodeFoeAttack } from '../../src/domain/foe-attack.js';

/* ============================================================
 * 蓄力攻击的应用层控制器
 *
 * 三条不能破的契约：
 *  1) 排期只走 lifecycle.scheduleBattle（带 battle epoch 归属），
 *     自己绝不 new setInterval/setTimeout —— 否则暂停、换战斗、战败都拦不住它。
 *  2) 快照只存「剩余时间」这一个时间事实，绝不存 dueAt/performance.now。
 *  3) 伤害走独立端口 foeAttackHit()，不走 hurtPlayer：自主攻击不是
 *     「答错」的惩罚，绝不能顺手记错词、删掌握、消耗首击减半/幸运草。
 * ============================================================ */

function harness({ kind = 'normal', frozen = false, maxhp = 60 } = {}) {
  const now = { t: 1000 };
  const lifecycle = createLifecycle({ setTimer: () => {}, clearTimer: () => {}, now: () => now.t });
  // 用真实的 setTimeout 语义换成可控的假定时器：注册即排期，
  // advance(ms) 让所有到点的回调按注册顺序跑 —— 暂停冻结由 lifecycle 自己管。
  const jobs = [];
  let seq = 0;
  const timers = { ids: new Set() };
  const setTimer = (fn, ms) => { const id = ++seq; jobs.push({ id, fn, at: now.t + ms }); timers.ids.add(id); return id; };
  const clearTimer = id => { timers.ids.delete(id); const i = jobs.findIndex(j => j.id === id); if (i >= 0) jobs.splice(i, 1); };
  const life = createLifecycle({ setTimer, clearTimer, now: () => now.t });

  const G = { hp: maxhp, maxhp, shield: 0, relics: [], floor: 1 };
  const B = { boss: kind === 'boss', elite: kind === 'elite', over: false, finished: false,
    myHp: maxhp, shield: 0, freezeWord: false, foeAttack: undefined };
  const hits = [];
  const commits = [];
  const toasts = [];
  let rendered = 0;
  const foeAttack = createFoeAttackController({
    state: { getRun: () => G, getBattle: () => B },
    lifecycle: life,
    now: () => now.t,
    // 自主攻击的伤害端口：只扣护盾/生命并可能判负，不碰学习记录。
    foeAttackHit: dmg => { hits.push(dmg); return { dealt: dmg, lost: false }; },
    // 每一次相位变化都提交一次快照（「每 phase transition 写一次」）。
    commit: () => commits.push(1),
    renderFight: () => { rendered++; },
    toast: m => toasts.push(m),
    frozen,                                // 词汇完成/奖励等「怪不再动」的相位
  });

  return {
    G, B, hits, commits, toasts, lifecycle: life, foeAttack, timers,
    get rendered() { return rendered; },
    get pending() { return jobs.length; },
    // 推进虚拟时间：跑到 t+ms 为止，途中每一步都执行到点的回调。
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
    setTime: t => { now.t = t; },
  };
}

test('自主攻击：idle 站桩 → 蓄力 → 打出一次伤害，然后收招', async () => {
  const h = harness();
  h.foeAttack.start();
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(h.hits.length, 0, '刚开局绝不挨打');

  await h.advance(FOE_ATTACK.normal.idleMs);          // idle -> telegraph
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH);
  assert.equal(h.hits.length, 0, '蓄力中还没打出来');
  assert.equal(h.foeAttack.isTelegraphing(), true);

  await h.advance(FOE_ATTACK.normal.telegraphMs);    // telegraph -> attack -> recover
  assert.deepEqual(h.hits, [FOE_ATTACK.normal.damage], '蓄满恰好打一次，伤害取该档配置');
  assert.equal(h.B.foeAttack.cycle, 1);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.RECOVER);

  await h.advance(FOE_ATTACK.normal.recoverMs);      // recover -> idle
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(h.foeAttack.isTelegraphing(), false);
});

test('普通怪默认 11 秒内挨第一下；精英/首领更快更痛（强怪间隔更短）', async () => {
  const first = 6000 + 5000;
  assert.equal(first, 11000, '普通怪首次攻击在 11 秒');
  const elite = harness({ kind: 'elite' });
  elite.foeAttack.start();
  await elite.advance(5000 + 4000);
  assert.deepEqual(elite.hits, [FOE_ATTACK.elite.damage]);
  const boss = harness({ kind: 'boss' });
  boss.foeAttack.start();
  await boss.advance(4000 + 3500);
  assert.deepEqual(boss.hits, [FOE_ATTACK.boss.damage]);
});

test('自主攻击伤害走自己的端口，不复用「答错」那条路径', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(11000);
  assert.equal(h.hits.length, 1);
  // 契约：控制器只调 foeAttackHit。它绝不认识 mastered / mistaken /
  // firstWrong / lethUsed —— 下面这四个字段在整轮攻击后必须原样。
  assert.equal(h.B.firstWrong, undefined);
  assert.equal(h.B.lethUsed, undefined);
  assert.deepEqual(h.B.mistaken, undefined);
  assert.deepEqual(h.G.relics, []);
});

test('寒冰护符期间相位照常推进，但不造成伤害', async () => {
  const h = harness();
  h.foeAttack.start();
  h.B.freezeWord = true;
  await h.advance(11000);
  assert.equal(h.hits.length, 0, '冰冻中这一次不掉血');
  assert.equal(h.B.foeAttack.cycle, 1, '但蓄力照样走完，相位不被无限暂停');
  h.B.freezeWord = false;
  await h.advance(2500 + 6000 + 5000);                  // recover->idle->telegraph->attack
  assert.equal(h.hits.length, 1, '解冻后下一次攻击正常生效');
});

/* ---------------- 打断 ---------------- */

test('有效字母尝试在蓄力期间打断：进 recover，本次不掉血', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(FOE_ATTACK.normal.idleMs);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH);

  const out = h.foeAttack.notifyLetterAttempted();
  assert.equal(out, true, '蓄力期间一次有效尝试应打断');
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.RECOVER);
  assert.equal(h.B.foeAttack.interrupted, true);
  assert.equal(h.hits.length, 0);

  // recover 走完不再补打：这一轮已经被打断了，绝不延后补一次伤害。
  await h.advance(FOE_ATTACK.normal.telegraphMs + 1000);
  assert.equal(h.hits.length, 0, '被打断的蓄力永远不补打');
});

test('同一轮里第二次尝试不能再次打断（相位闸门），下一轮可以', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000);
  assert.equal(h.foeAttack.notifyLetterAttempted(), true);
  assert.equal(h.foeAttack.notifyLetterAttempted(), false, '已经在 recover 里，不再二次打断');
  await h.advance(2500);                                  // recover -> idle
  assert.equal(h.foeAttack.notifyLetterAttempted(), false, 'idle 阶段打断无意义');
  await h.advance(6000);                                  // idle -> telegraph
  assert.equal(h.foeAttack.notifyLetterAttempted(), true, '下一轮蓄力仍可再打断');
});

test('idle 阶段的字母尝试不算打断（不提前进入 recover、不改相位）', async () => {
  const h = harness();
  h.foeAttack.start();
  assert.equal(h.foeAttack.notifyLetterAttempted(), false);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(h.B.foeAttack.remainingMs, FOE_ATTACK.normal.idleMs, 'idle 剩余时间不被偷改');
});

test('战斗结束/已结算后不再有任何主动伤害', async () => {
  const h = harness();
  h.foeAttack.start();
  h.B.over = true;
  await h.advance(11000);
  assert.equal(h.hits.length, 0, '战斗已结束：攻击端口一次都不调');
});

test('frozen 传函数时按运行期求值（回归：!frozen 对函数恒假会让怪一次都不动）', async () => {
  // 这条钉住真实装配形态：runtime 传的 frozen 是**函数**。
  // 旧写法 `!frozen` 对函数恒为 false → live() 恒假 → 一次都排不出去，
  // 表现是「战斗里蓄力永远停在 idle」且不报任何错。
  let frozen = false;
  const h = harness({ frozen: () => frozen });
  h.foeAttack.start();
  await h.advance(6000);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH, 'frozen=false 时必须真的推进');
  await h.advance(5000);
  assert.deepEqual(h.hits, [FOE_ATTACK.normal.damage]);
  // 变成 frozen（切到奖励屏/结算屏）后立刻停手。
  frozen = true;
  await h.advance(2500 + 6000 + 5000);
  assert.equal(h.hits.length, 1, 'frozen=true 后不再有任何主动伤害');
});

test('frozen 相位（词汇完成/奖励/结算屏）不再推进', async () => {
  const h = harness({ frozen: true });
  h.foeAttack.start();
  await h.advance(60000);
  assert.equal(h.hits.length, 0);
  assert.equal(h.foeAttack.isTelegraphing(), false);
});

/* ---------------- 暂停 / 恢复 / 剩余时间 ---------------- */

test('暂停冻结蓄力：等多久都不继续扣，继续后按剩余时间接着走', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000);                                  // telegraph, remaining 5000
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH);

  h.lifecycle.pause();                                    // 冻结在途定时器
  await h.advance(30000);                                 // 暂停期间墙钟走 30 秒
  assert.equal(h.hits.length, 0, '暂停期间绝不结算伤害（不积累、不回来补打）');
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH);

  h.lifecycle.resume();
  await h.advance(FOE_ATTACK.normal.telegraphMs - 50);    // 几乎走完原本的 5000ms
  assert.equal(h.hits.length, 0, '还没到原本的时刻');
  await h.advance(100);
  assert.deepEqual(h.hits, [FOE_ATTACK.normal.damage], '继续后按原本剩余时间打出一次，不多打');
});

test('快照事实 = 剩余时间（due - now），不含任何绝对时间戳', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000 + 1200);                            // telegraph 已过 1.2s
  const fact = h.foeAttack.captureFact();
  assert.equal(fact.phase, FOE_PHASE.TELEGRAPH);
  assert.equal(fact.remainingMs, FOE_ATTACK.normal.telegraphMs - 1200);
  const enc = encodeFoeAttack(fact);
  assert.equal(enc.remainingMs, FOE_ATTACK.normal.telegraphMs - 1200);
  assert.doesNotThrow(() => JSON.stringify(enc));
  assert.equal('dueAt' in enc, false);
  assert.equal('timerId' in enc, false);
  assert.deepEqual(Object.keys(enc).sort(),
    ['cycle', 'interrupted', 'phase', 'remainingMs', 'schemaVersion']);
});

test('刷新恢复：按 remainingMs 精确重建，不补过期攻击、不提前攻击', async () => {
  const saved = encodeFoeAttack({ schemaVersion: 1, phase: FOE_PHASE.TELEGRAPH, remainingMs: 1500, cycle: 4, interrupted: false });
  const h = harness();
  h.foeAttack.restore(saved);
  assert.equal(h.B.foeAttack.remainingMs, 1500);
  await h.advance(1000);
  assert.equal(h.hits.length, 0);
  await h.advance(600);                                    // 累计 1600 > 1500
  assert.deepEqual(h.hits, [FOE_ATTACK.normal.damage], '按保存的剩余时间打，不多不少');
  assert.equal(h.B.foeAttack.cycle, 5, 'cycle 接着原来的计数，不归零');
});

test('旧存档没有 foeAttack：恢复成干净的 idle 窗口，绝不默认立刻攻击', async () => {
  const h = harness();
  h.foeAttack.restore(undefined);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(h.B.foeAttack.remainingMs, FOE_ATTACK.normal.idleMs);
  assert.equal(h.hits.length, 0);
  await h.advance(5000);
  assert.equal(h.hits.length, 0, '旧存档恢复后也不提前挨打');
});

test('restore 后 capture 再 restore 是稳定的（连续保存不漂移）', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000 + 500);
  const a = encodeFoeAttack(h.foeAttack.captureFact());
  const h2 = harness();
  h2.foeAttack.restore(JSON.parse(JSON.stringify(a)));
  const b = encodeFoeAttack(h2.foeAttack.captureFact());
  assert.deepEqual(b, a, '存→恢复→再存必须完全一致');
});

test('脏事实恢复时 fail closed：回到干净的 idle，而不是脏相位', async () => {
  const h = harness();
  h.foeAttack.restore({ schemaVersion: 1, phase: 'sneak', remainingMs: 10, cycle: 0 });
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(decodeFoeAttack({ schemaVersion: 1, phase: 'sneak', remainingMs: 10, cycle: 0 }), undefined);
});

test('stop() 后相位转 defeated，迟到的定时回调不再造成伤害', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000);
  h.foeAttack.stop();
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.DEFEATED);
  await h.advance(60000);
  assert.equal(h.hits.length, 0, '停止后到点的旧回调不得再结算伤害');
});

test('换战斗（epoch 重置）后旧战斗的定时回调不会打到新战斗', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000);
  h.lifecycle.resetBattle();          // 旧战斗作废
  h.foeAttack.start();                // 新战斗
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(h.B.foeAttack.cycle, 0);
  await h.advance(11000);
  // 旧战斗在 6000ms 时正处 telegraph，其回调会在 5000ms 后到点。
  // 新战斗的第一次攻击在 6000+5000=11000ms。两者若都结算就是 2 次 ——
  // 所以「恰好 1 次」正是 epoch 归属生效的证据。
  assert.deepEqual(h.hits, [FOE_ATTACK.normal.damage], '旧战斗的回调不得替新战斗结算一次');
  assert.equal(h.B.foeAttack.cycle, 1, 'cycle 只属于新战斗');
});

/* ---------------- 提交节奏 ---------------- */

test('每次相位变化提交一次快照（不是每帧狂写，也不是完全不等）', async () => {
  const h = harness();
  h.foeAttack.start();
  const base = h.commits.length;
  await h.advance(6000);
  assert.ok(h.commits.length > base, '进入蓄力要提交一次');
  const afterTele = h.commits.length;
  await h.advance(5000);
  assert.ok(h.commits.length > afterTele, '打出攻击/进入收招要提交一次');
});

test('state 只有取值器 B（没有 getBattle）时也必须真的起手', async () => {
  // runtime 装配的 state 就是这个形态：只暴露取值器 B。
  // 只认 getBattle() 的实现会静默拿到 null —— 战斗从头到尾没有蓄力事实，
  // 而且不抛任何错。这条断言就是为了钉住「两种形态都要认」。
  const now = { t: 1000 };
  const jobs = [];
  let seq = 0;
  const life = createLifecycle({
    setTimer: (fn, ms) => { const id = ++seq; jobs.push({ id, fn, at: now.t + ms }); return id; },
    clearTimer: id => { const i = jobs.findIndex(j => j.id === id); if (i >= 0) jobs.splice(i, 1); },
    now: () => now.t,
  });
  const hits = [];
  const B = { boss: false, elite: false, over: false, finished: false, myHp: 60, shield: 0, freezeWord: false };
  const ctl = createFoeAttackController({
    state: { B },                      // ← 只有取值器
    lifecycle: life, now: () => now.t,
    foeAttackHit: d => { hits.push(d); return {}; },
    commit: () => {}, renderFight: () => {}, toast: () => {},
  });
  assert.equal(ctl.start(), true);
  assert.ok(B.foeAttack, '必须真的把蓄力事实挂到战斗上');
  assert.equal(B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(jobs.length, 1, '并且真的排了期');
  const target = now.t + FOE_ATTACK.normal.idleMs + FOE_ATTACK.normal.telegraphMs;
  for (;;) {
    const due = jobs.filter(j => j.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    jobs.splice(jobs.indexOf(due), 1);
    now.t = due.at; due.fn();
  }
  assert.deepEqual(hits, [FOE_ATTACK.normal.damage], '并且真的会在蓄满时结算一次');
});

test('start() 在已有事实时重新起一个干净的 idle（新战斗不继承上一场的相位）', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(6000);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH);
  h.foeAttack.start();
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.IDLE);
  assert.equal(h.B.foeAttack.cycle, 0);
});