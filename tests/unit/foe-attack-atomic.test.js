import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycle } from '../../src/app/lifecycle.js';
import { createFoeAttackController } from '../../src/app/foe-attacks.js';
import { createFoeAttackMeter } from '../../src/ui/components/foe-attack-meter.js';
import { FOE_ATTACK } from '../../src/data/balance.js';
import { FOE_PHASE } from '../../src/domain/foe-attack.js';

/* ============================================================
 * 蓄力自主攻击的三条纵向契约（docs/feature-foe-attack.md）
 *
 *  ① 原子性：自主攻击的相位推进与实际伤害是**同一次提交**。
 *     攻击 → 收招与掉血绝不允许分成两次写盘/两次渲染 ——
 *     否则快照里会出现「已经收招、但血还是满的」这一帧。
 *  ② 暂停冻结 / 继续重定位：pause 采当时的剩余时间，resume 只把
 *     dueAt 重定位到 now+剩余，**不重排** lifecycle 已冻结的同页队列。
 *  ③ 蓄力可视倒计时真实流动：UI 刷新节拍 250ms，只 paint 蓄力条，
 *     不落盘、不推进相位、不重建字母盘。
 * ============================================================ */

const NORMAL = FOE_ATTACK.normal;

/* 忠实模拟 runtime 的事务边界：commit 在事务内部延期，最外层收尾才真写。 */
function harness({ kind = 'normal', maxhp = 60, shield = 0, frozen = false, mutate = true } = {}) {
  const now = { t: 1000 };
  const jobs = [];
  let seq = 0;
  const setTimer = (fn, ms) => { const id = ++seq; jobs.push({ id, fn, at: now.t + ms }); return id; };
  const clearTimer = id => { const i = jobs.findIndex(j => j.id === id); if (i >= 0) jobs.splice(i, 1); };
  const lifecycle = createLifecycle({ setTimer, clearTimer, now: () => now.t });

  const G = { hp: maxhp, maxhp, shield, relics: [], floor: 1 };
  const B = { boss: kind === 'boss', elite: kind === 'elite', over: false, finished: false,
    myHp: maxhp, shield, freezeWord: false, foeAttack: undefined };
  // 与 runtime 同构的运行相位：战败时 markEnding 会把它推到 ending。
  const run = { phase: 'battle', ending: false };

  const commits = [];   // 真正落盘那一刻的 battle 真实状态
  const hits = [];
  const toasts = [];
  const paints = [];    // UI tick 画到蓄力条上的事实
  let rendered = 0;
  let depth = 0;
  const ctl = {};

  function writeOnce() {
    commits.push({
      phase: B.foeAttack ? B.foeAttack.phase : null,
      cycle: B.foeAttack ? B.foeAttack.cycle : -1,
      myHp: B.myHp, shield: B.shield,
      over: B.over, runPhase: run.phase,
    });
  }
  const wrapMutate = fn => {
    depth++;
    let out;
    try { out = fn(); } finally { depth--; if (depth === 0) writeOnce(); }
    return out;
  };

  const foeAttack = createFoeAttackController(Object.assign({
    state: { getRun: () => G, getBattle: () => B },
    lifecycle,
    now: () => now.t,
    // 自主攻击伤害端口：只走护盾 → 生命 → 判负，绝不碰学习记录。
    foeAttackHit: d => {
      hits.push(d);
      const abs = Math.min(B.shield, d);
      B.shield -= abs;
      B.myHp -= (d - abs);
      const lost = B.myHp <= 0;
      if (lost) {                 // 与 combat.enemyHit → loseFight 同构
        B.myHp = Math.max(0, B.myHp);
        B.over = true;
        foeAttack.stop();
        run.ending = true;
        run.phase = 'ending';
      }
      return { dealt: d, absorbed: abs, lost };
    },
    commit: () => { if (depth > 0) return false; writeOnce(); return true; },
    renderFight: () => { rendered++; },
    toast: m => toasts.push(m),
    frozen,
    paintAttack: f => { paints.push({ phase: f.phase, remainingMs: f.remainingMs }); },
  }, mutate ? { mutate: wrapMutate } : {}));
  ctl.foeAttack = foeAttack;

  const h = {
    G, B, run, commits, hits, toasts, paints, lifecycle, foeAttack, jobs,
    get rendered() { return rendered; },
    get pending() { return jobs.length; },
    setTime: t => { now.t = t; },
    nowT: () => now.t,
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
    // 与 progress.pause() 同序：先 ctl.pause() 采剩余，再 lifecycle.pause()。
    pause() { foeAttack.pause(); lifecycle.pause(); },
    // 与 progress.resume() 同序：先 lifecycle.resume() 重新挂冻结队列，再 ctl.resume()。
    resume() { lifecycle.resume(); foeAttack.resume(); },
  };
  return h;
}

test('new battle after lifecycle reset starts its own live meter cadence', async () => {
  const h = harness();
  h.foeAttack.start(); await h.advance(1000);
  h.lifecycle.resetBattle();
  const count = h.paints.length;
  h.foeAttack.start(); await h.advance(1000);
  assert.ok(h.paints.length > count, 'old ticking flag must not suppress a new battle meter');
});

test('start renders a fresh battle with its new due time, not the prior battle deadline', () => {
  let at=1000,ctl,last;
  const B={boss:false,elite:false,over:false,finished:false,myHp:60};
  const lifecycle=createLifecycle({now:()=>at,setTimer:()=>1,clearTimer:()=>{}});
  ctl=createFoeAttackController({state:{B},lifecycle,now:()=>at,
    renderFight:()=>{last=ctl.captureFact()},foeAttackHit:()=>{}});
  ctl.start(); at=20000; lifecycle.resetBattle(); ctl.start();
  assert.equal(last.remainingMs,NORMAL.idleMs,'new battle must expose the fresh deadline at first render');
});

/* ---------------- ① 相位推进与伤害同一次事务 ---------------- */

test('自主攻击的相位与伤害同一次提交：不会出现「已收招但血还是满的」快照', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);                       // idle -> telegraph（一次提交）
  const commitsBefore = h.commits.length;
  await h.advance(NORMAL.telegraphMs);                 // telegraph -> attack -> recover + 伤害

  const writes = h.commits.slice(commitsBefore);
  assert.equal(writes.length, 1, '整次攻击只写一次盘（不是 attack 一次 + recover 一次）');
  const w = writes[0];
  assert.equal(w.phase, FOE_PHASE.RECOVER, '落盘时相位已经是收招');
  assert.equal(w.cycle, 1, '这一轮在同一次提交里就算完成');
  assert.equal(w.myHp, h.B.myHp, '落盘的血量 = 伤害之后的血量');
  assert.equal(w.myHp, 60 - NORMAL.damage);
  assert.equal(w.over, false);
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.RECOVER);
});

test('中间态（attack 相位、血未扣）绝不出现在任何一次提交里', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + NORMAL.telegraphMs);
  assert.equal(h.commits.some(c => c.phase === FOE_PHASE.ATTACK), false, 'attack 是不发布的内部事实');
  assert.equal(h.commits.some(c => c.cycle === 1 && c.myHp === 60), false,
    '绝不存在「这一轮已完成但玩家还没掉血」的那一帧');
});

test('伤害与最终渲染同一次：渲染看到的血量已经扣掉', async () => {
  const h = harness();
  const renderedHp = [];
  const spy = createFoeAttackController({
    state: { getBattle: () => h.B },
    lifecycle: h.lifecycle,
    now: () => h.nowT(),
    foeAttackHit: d => { h.B.myHp -= d; return { dealt: d }; },
    commit: () => {},
    renderFight: () => renderedHp.push(h.B.myHp),
    mutate: fn => fn(),
  });
  spy.start();
  await h.advance(NORMAL.idleMs + NORMAL.telegraphMs);
  assert.ok(renderedHp.length > 0, '攻击后必须渲染');
  assert.equal(renderedHp[renderedHp.length - 1], 60 - NORMAL.damage,
    '渲染那一刻看到的血量就是扣完之后的血量');
});

test('寒冰护符挡下伤害时同样只提交一次（相位推进不受影响）', async () => {
  const h = harness();
  h.foeAttack.start();
  h.B.freezeWord = true;
  await h.advance(NORMAL.idleMs);                          // 先走完 idle -> telegraph 那次发布
  const before = h.commits.length;
  await h.advance(NORMAL.telegraphMs);
  const writes = h.commits.slice(before);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].phase, FOE_PHASE.RECOVER);
  assert.equal(writes[0].cycle, 1);
  assert.equal(writes[0].myHp, 60, '冰冻中这一次确实没掉血');
  assert.equal(h.hits.length, 0);
  assert.ok(h.toasts.some(t => /冰冻/.test(t)));
});

test('护盾与生命在同一次提交里一起落盘（不会出现盾扣了血没扣的快照）', async () => {
  const h = harness({ shield: 3 });
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);
  const before = h.commits.length;
  await h.advance(NORMAL.telegraphMs);
  const w = h.commits[before];
  assert.equal(w.shield, h.B.shield, '护盾与生命同一个事实');
  assert.equal(w.myHp, h.B.myHp);
  assert.equal(w.myHp, 60 - (NORMAL.damage - 3));
});

test('致死一击触发 loseFight 重入：最外层只写一次，绝不落 BATTLE 相位的非法结束快照', async () => {
  const h = harness({ maxhp: NORMAL.damage });        // 正好一击致命
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);
  const before = h.commits.length;
  await h.advance(NORMAL.telegraphMs);
  assert.equal(h.B.over, true, '这一击打死了玩家');
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.DEFEATED, '相位转 defeated');
  assert.equal(h.commits.filter(c => c.over && c.runPhase === 'battle').length, 0,
    '绝不写出「战斗已关闭但仍在 battle 相位」的非法快照');
  assert.equal(h.commits.length - before, 1, '整条重入链只在最外层写一次');
  assert.equal(h.commits[h.commits.length - 1].runPhase, 'ending');
  assert.equal(h.commits[h.commits.length - 1].myHp, 0);
});

test('没有 mutate 端口时（纯控制器用法）也不会写出中间态', async () => {
  const h = harness({ mutate: false });
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + NORMAL.telegraphMs);
  assert.equal(h.commits.some(c => c.phase === FOE_PHASE.ATTACK), false);
  assert.equal(h.commits[h.commits.length - 1].myHp, 60 - NORMAL.damage);
});

test('同一个定时回调被重复触发只推进一次（不假计一轮）', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);
  // 抓取当前排出去的那次**相位**回调（队列里还有 UI 节拍，取最晚到点的那次），
  // 模拟浏览器把它重复入队。
  const phaseJob = h.jobs.slice().sort((a, b) => b.at - a.at)[0];
  assert.equal(phaseJob.at, h.nowT() + NORMAL.telegraphMs, '这一步抓到的是相位回调');
  phaseJob.fn();
  phaseJob.fn();
  await h.advance(0);
  assert.equal(h.B.foeAttack.cycle, 1, '重复触发不会让 cycle 变成 2');
  assert.equal(h.hits.length, 1);
});

/* ---------------- ② 暂停冻结 / 继续重定位 ---------------- */

test('pause() 采的是暂停那一刻的剩余时间，不是整个窗口', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + 1200);
  h.pause();
  await h.advance(30000);                               // 暂停期间墙钟走 30 秒
  const fact = h.foeAttack.captureFact();
  assert.equal(fact.phase, FOE_PHASE.TELEGRAPH);
  assert.equal(fact.remainingMs, NORMAL.telegraphMs - 1200, '冻结的是 3.8 秒，不是 5 秒，更不是 0');
  assert.equal(fact.remainingMs, 3800);
});

test('resume() 只重定位 dueAt：立刻 checkpoint 的剩余时间与暂停时基本相同', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + 1200);
  h.pause();
  const saved = h.foeAttack.captureFact().remainingMs;
  await h.advance(30000);
  h.resume();
  const after = h.foeAttack.captureFact().remainingMs;
  // 允许「继续」这一个动作自身的毫秒级开销，但绝不是 0、绝不是 30 秒。
  assert.ok(Math.abs(after - saved) <= 50, `继续后剩余 ${after} 应约等于暂停时的 ${saved}`);
  assert.ok(after > 0, '绝不归零（归零 = 刷新后凭空白挨一下）');
});

test('resume() 不重排 lifecycle 已冻结的同页队列、不新增任务', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + 1200);
  h.pause();
  const frozenCount = h.lifecycle.frozenCount();
  assert.ok(frozenCount > 0, '暂停确实冻结了在途队列');
  h.lifecycle.resume();
  const jobsAfterLifecycle = h.jobs.length;
  h.foeAttack.resume();
  assert.equal(h.jobs.length, jobsAfterLifecycle, 'ctl.resume() 不新增任何排期');
  assert.equal(h.lifecycle.frozenCount(), 0, '冻结队列已被 lifecycle 挂回');
  assert.ok(frozenCount <= 2, '自有任务不超过相位 + UI tick 两个');
});

test('继续后等同样的剩余时间，只打一次；多等也不补打', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + 1200);
  h.pause();
  await h.advance(30000);
  h.resume();
  await h.advance(NORMAL.telegraphMs - 1200 - 60);
  assert.equal(h.hits.length, 0, '还没到原本的时刻');
  await h.advance(100);
  assert.deepEqual(h.hits, [NORMAL.damage], '恰好一次');
  await h.advance(NORMAL.recoverMs + NORMAL.idleMs + 4000);
  assert.deepEqual(h.hits, [NORMAL.damage], '暂停过也不多打');
});

test('暂停 → 继续 → 再暂停反复多次，剩余时间仍按真实流逝重定位', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);
  for (let i = 0; i < 3; i++) {
    await h.advance(700);
    h.pause();
    const f1 = h.foeAttack.captureFact().remainingMs;
    await h.advance(9000);
    h.resume();
    const f2 = h.foeAttack.captureFact().remainingMs;
    assert.ok(Math.abs(f2 - f1) <= 50, `第 ${i + 1} 轮：继续后 ${f2} ≈ 暂停时 ${f1}`);
    assert.ok(f2 > 0);
  }
  await h.advance(NORMAL.telegraphMs);
  assert.equal(h.hits.length, 1);
});

test('暂停期间继续刷新：按冻结的剩余时间重建，等它走完只挨一下', async () => {
  const src = harness();
  src.foeAttack.start();
  await src.advance(NORMAL.idleMs + 1200);
  src.pause();
  const saved = src.foeAttack.captureFact();
  await src.advance(30000);

  // 跨刷新：restore 只排相位那一个任务（+ UI tick），不重放暂停历史。
  const h = harness();
  assert.equal(h.foeAttack.restore(saved), true);
  assert.ok(h.B.foeAttack.remainingMs > 0);
  const restored = h.foeAttack.captureFact().remainingMs;
  assert.ok(Math.abs(restored - saved.remainingMs) <= 50, '恢复后的剩余 ≈ 暂停时保存的剩余');
  await h.advance(restored + 200);
  assert.equal(h.hits.length, 1, '只挨一下');
  await h.advance(4000);
  assert.equal(h.hits.length, 1, '不补打');
});

test('暂停后 stop()（战斗结束）不会留下还在跑的 UI 刷新或相位回调', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);
  h.pause();
  h.foeAttack.stop();
  h.resume();
  const paintsAt = h.paints.length;
  await h.advance(10000);
  assert.equal(h.paints.length, paintsAt, '结束后不再有 UI 刷新');
  assert.equal(h.hits.length, 0);
});

/* ---------------- ③ 蓄力可视倒计时真实流动 ---------------- */

test('蓄力期间每 250ms 刷新一次可视倒计时，秒数真的在走', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);                        // 进入 telegraph
  const atTele = h.paints.length;
  await h.advance(1000);
  const during = h.paints.slice(atTele);
  assert.ok(during.length >= 3, '一秒内至少刷新 3 次（250ms 节拍）');
  const rems = during.map(p => p.remainingMs);
  assert.ok(rems[rems.length - 1] < rems[0], '传给 UI 的剩余时间在真实减少');
  assert.ok(rems.every(r => r > 0 && r <= NORMAL.telegraphMs), '每一帧都在合法窗口内');
  const secs = new Set(during.map(p => Math.ceil(p.remainingMs / 1000)));
  assert.ok(secs.size >= 2, '秒数跨过了至少一条整秒界线（不再是固定 5s）');
});

test('UI 刷新节拍只 paint 蓄力条：不落盘、不推进相位、不整屏重渲染', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs);
  const commitsAt = h.commits.length;
  const renderedAt = h.rendered;
  await h.advance(1000);
  assert.equal(h.commits.length, commitsAt, '250ms 刷新绝不写盘');
  assert.equal(h.rendered, renderedAt, '绝不整屏 renderFight（会重建字母盘、丢焦点）');
  assert.equal(h.B.foeAttack.phase, FOE_PHASE.TELEGRAPH, '刷新绝不推进相位');
});

test('冻结时 UI 刷新停走；继续后按真实剩余继续刷新', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + 1200);
  h.pause();
  const at = h.paints.length;
  await h.advance(30000);
  assert.equal(h.paints.length, at, '暂停期间蓄力条不刷新（也不继续倒数）');
  h.resume();
  await h.advance(1000);
  assert.ok(h.paints.length > at, '继续后刷新恢复');
  const last = h.paints[h.paints.length - 1];
  assert.ok(last.remainingMs > 0 && last.remainingMs <= NORMAL.telegraphMs - 1200 + 50,
    '继续后的剩余仍以真实剩余为基准');
});

test('自有排期恒定 ≤ 2（相位 + UI tick），停止后归零', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + 1000);
  assert.ok(h.pending <= 2, `战斗中自有任务 ${h.pending} 个，不超过 2`);
  await h.advance(NORMAL.telegraphMs + NORMAL.recoverMs + 1000);
  assert.ok(h.pending <= 2, '跨相位后仍然不超过 2（不是每相位多挂一个刷新）');
  h.foeAttack.stop();
  // 在途回调还在浏览器队列里（clearTimeout 管不到已入队的），等它们各自到点作废。
  await h.advance(NORMAL.recoverMs + 2000);
  assert.equal(h.pending, 0, 'stop() 之后队列彻底排空（不泄漏）');
  const paintsAt = h.paints.length;
  await h.advance(10000);
  assert.equal(h.paints.length, paintsAt, 'stop() 之后不再有任何刷新');
});

test('UI 刷新链路不依赖 setInterval：战斗全程没有一个非 lifecycle 定时器', async () => {
  const h = harness();
  h.foeAttack.start();
  await h.advance(NORMAL.idleMs + NORMAL.telegraphMs + NORMAL.recoverMs + 2000);
  // harness 里根本没有 setInterval，节拍全部由 lifecycle 的 scheduleBattle 承载。
  assert.ok(h.paints.length > 10, '确实在持续刷新');
  assert.equal(h.hits.length, 1);
});

/* ---------------- 蓄力条组件：只更新已有 DOM ---------------- */

/* 极简 DOM 桩：只实现组件真正用到的那几个能力（无第三方依赖）。 */
function stubDom() {
  const mk = (tag) => {
    const el = {
      tagName: tag, className: '', id: '', hidden: false, style: {}, children: [],
      _text: '', _html: '',
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); this.children = []; },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; },
      appendChild(c) { this.children.push(c); return c; },
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
    };
    return el;
  };
  const box = mk('div');
  return { box, mk, doc: { createElement: mk }, $: id => (id === 'fFoeAtk' ? box : null) };
}

test('蓄力条刷新只改已有元素的进度与文案，不重建 DOM（字母盘/焦点不受影响）', () => {
  const dom = stubDom();
  const meter = createFoeAttackMeter({ $: dom.$, doc: dom.doc });
  const fact = { schemaVersion: 1, phase: FOE_PHASE.TELEGRAPH, remainingMs: 5000, cycle: 0, interrupted: false };
  const win = { telegraphMs: 5000, damage: 4 };
  meter.paint(fact, win);
  const kids = dom.box.children;
  assert.equal(kids.length, 2, '条 + 文案');
  const fillEl = kids[0].children[0];
  // 进度由 transform:scaleX 承载，width 恒为满宽（foe-attacks.css）。
  const scale = el => parseFloat(/scaleX\(([-0-9.eE]+)\)/.exec(el.style.transform)[1]);
  assert.equal(scale(fillEl), 1);
  assert.equal(fillEl.style.width, undefined, '组件绝不写 width');

  // 模拟 250ms 刷新：同一批元素，只换进度与秒数。
  const out = meter.paintLive(Object.assign({}, fact, { remainingMs: 3000 }), win);
  assert.equal(dom.box.children.length, 2, 'DOM 结构没有重建');
  assert.equal(dom.box.children[0].children[0], fillEl, '进度条元素是同一个对象');
  assert.equal(scale(fillEl), 0.6);
  assert.match(dom.box.children[1].textContent, /3s/);
  assert.equal(out.secs, 3);
});

test('蓄力条刷新到 0 时如实显示，比例夹在 0..1', () => {
  const dom = stubDom();
  const meter = createFoeAttackMeter({ $: dom.$, doc: dom.doc });
  const fact = { schemaVersion: 1, phase: FOE_PHASE.TELEGRAPH, remainingMs: 5000, cycle: 1, interrupted: false };
  const win = { telegraphMs: 5000, damage: 4 };
  meter.paint(fact, win);
  const out = meter.paintLive(Object.assign({}, fact, { remainingMs: -50 }), win);
  assert.equal(out.ratio, 0, '脏值不许画出负宽度');
  assert.equal(out.secs, 0);
  assert.match(dom.box.children[1].textContent, /0s/);
});

test('蓄力条在还没有 DOM（首次刷新早于 renderFight）时安全降级', () => {
  const meter = createFoeAttackMeter({ $: () => null, doc: { createElement: () => { throw new Error('不该建元素'); } } });
  assert.doesNotThrow(() => meter.paintLive(
    { schemaVersion: 1, phase: FOE_PHASE.TELEGRAPH, remainingMs: 1000, cycle: 0, interrupted: false },
    { telegraphMs: 5000, damage: 4 }));
});
