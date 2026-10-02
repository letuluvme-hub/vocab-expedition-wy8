/* 完整词连胜**回归**测试（docs/feature-word-streak.md）。
 *
 * 与 tests/unit/word-streak-wiring.test.js 的分工：那份证明「接线存在」，
 * 这一份只钉住三条曾经真的坏过的行为，任何一次重构都不许把它们弄回去：
 *
 *  1) **最后击杀的里程碑必须能出声**：整词完成的瞬间词正在念 → 排一条待播；
 *     紧接着 applyDamage 打空敌人 → winFight 把 B.over 置真。旧判据
 *     `isBattleLive = B && !B.over` 于是把这条待播判成「战斗没了」而丢掉 ——
 *     玩家刚打出 Godlike 却在结算屏上**一个字都听不到**。
 *     修正后的契约：同一场战斗（B 对象身份不变）打赢了、且仍处在它的待领奖
 *     相位里，就**允许**这条里程碑等词念完之后播。
 *  2) **早退必须清掉当前 pending，pendingCount 反映真实队列**：丢弃的那条
 *     待播不许留在队列里假装还在等（父已复现：pendingCount=1 而 jobs 已空）。
 *     但**过期的 token 绝不许清掉新的 pending** —— 上一条迟到的回调回来时，
 *     正在等的是另一条，它必须原样留着。
 *  3) **scope token**：延迟播报回来时，战斗对象必须还是当初那一个。
 *     快速推进到新战斗（B 被整个换掉）之后，旧战斗的里程碑**绝不**补播到
 *     新战斗的语音通道里。
 *
 * 全部是假定时器 + 假 TTS：不碰真机、不发声、不依赖浏览器。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordStreakFeedback } from '../../src/app/word-streak-feedback.js';

/* 一个「战斗对象 + 相位」的替身，与 runtime 的真实判据同形。 */
const arena = (over = {}) => {
  const a = { over: false, won: false, finished: false, phase: 'battle', ...over };
  return a;
};
/* runtime 里 isBattleLive 的契约（见 src/app/runtime.js 接线处）：
   战斗中没结束 → 活着；打赢了、仍在**同一场**战斗的待领奖相位 → 也活着；
   地图 / 标题 / 词汇完成检查点 / 败局 / 结算 / 领完奖 → 一律不活。 */
const liveOf = a => () => {
  if (a.phase === 'battle') return !a.over;
  if (a.phase === 'reward') return !!a.over && !!a.won && !a.finished;
  return false;
};

function fb(over = {}) {
  let state = { count: 0, lastEventId: null };
  const calls = [];
  const jobs = [];
  const f = createWordStreakFeedback(Object.assign({
    getState: () => state, setState: s => { state = s; },
    speakAnnouncement: req => { calls.push(req.text); return true; },
    onAnnounce: () => {},
    cancelSchedule: h => { const i = jobs.indexOf(h); if (i >= 0) jobs.splice(i, 1); },
    schedule: fn => { jobs.push(fn); return fn; },
    isBattleLive: () => true, getWordPriorityBusy: () => false,
  }, over));
  return { f, calls, jobs, state: () => state };
}
const tick = (h, n = 1) => { for (let i = 0; i < n; i++) { const j = h.jobs.shift(); if (j) j(); } };

/* ---------------- 1. 最后击杀的里程碑 ---------------- */

/* 「最后一击赢下战斗」这条契约横跨两个文件：runtime 的 isBattleLive 判据
   （B.over 之后仍要放行**同一场**战斗的待领奖相位）与本模块的早退清理。
   前者只能在真实应用里证明 —— 见 tests/e2e/word-streak-game.spec.js 的
   「the final kill still speaks the milestone」。这里只钉住本模块那一半。 */

test('回归：词还没念完时战斗就结束了 —— 待播安静丢弃，pendingCount 归零', () => {
  const a = arena();
  const h = fb({ getWordPriorityBusy: () => true, isBattleLive: liveOf(a) });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  assert.equal(h.f.pendingCount(), 1);

  a.over = true; a.won = true; a.phase = 'reward';
  a.finished = true; a.phase = 'ending';              // 领奖/结算已经过去
  tick(h);
  assert.deepEqual(h.calls, [], '过期的那一条必须安静丢弃');
  assert.equal(h.f.pendingCount(), 0, '★ 早退必须清掉当前 pending（旧行为残留 1）');
  assert.equal(h.jobs.length, 0);
});

test('回归：败局不补播 —— 打输了（B.over && !B.won）任何相位都不出声', () => {
  const a = arena();
  const h = fb({ getWordPriorityBusy: () => true, isBattleLive: liveOf(a) });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  a.over = true; a.won = false; a.phase = 'ending';   // loseFight
  tick(h, 40);
  assert.deepEqual(h.calls, [], '败局绝不补播里程碑');
  assert.equal(h.f.pendingCount(), 0);
});

test('回归：地图 / 标题 / 词汇完成检查点都不补播', () => {
  for (const phase of ['map', 'title', 'learning-complete', 'encounter']) {
    const a = arena();
    const h = fb({ getWordPriorityBusy: () => true, isBattleLive: liveOf(a) });
    h.f.complete({ eventId: 'R:1', complete: true, correct: true });
    a.phase = phase;
    tick(h, 40);
    assert.deepEqual(h.calls, [], phase + ' 相位绝不补播');
    assert.equal(h.f.pendingCount(), 0, phase + ' 相位早退必须清 pending');
  }
});

test('回归：跨战斗 count 不变 —— 里程碑在战斗结束时播出，下一场接着往上数', () => {
  const a = arena();
  let busy = true;
  const h = fb({ getWordPriorityBusy: () => busy, isBattleLive: liveOf(a) });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });   // count 1
  a.over = true; a.won = true; a.phase = 'reward';
  busy = false; tick(h);
  assert.deepEqual(h.calls, ['First Blood']);
  assert.equal(h.state().count, 1);

  // 下一场战斗：进度换回战斗相位（runtime 里 B 整个被重建）。
  a.phase = 'battle'; a.over = false; a.won = false;
  h.f.complete({ eventId: 'R:2', complete: true, correct: true });
  assert.deepEqual(h.calls, ['First Blood', 'Double Kill'], '跨战斗接着数，不清零');
  assert.equal(h.state().count, 2);
});

/* ---------------- 2. pending 残留 / 过期 token ---------------- */

test('回归：过期 token 的迟到回调绝不清掉新的 pending', () => {
  const a = arena();
  let busy = true;
  const h = fb({ getWordPriorityBusy: () => busy, isBattleLive: liveOf(a) });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  const stale = h.jobs[0];                             // 第一条待播的回调句柄

  // 第二个真实完成把在途待播作废，并排出**新**的一条。
  h.f.complete({ eventId: 'R:2', complete: true, correct: true });
  assert.equal(h.f.pendingCount(), 1, '新事实只留最新的一条待播');

  stale();                                             // 迟到的旧回调
  assert.equal(h.f.pendingCount(), 1, '★ 过期 token 绝不许把新的 pending 清掉');

  busy = false;
  tick(h);
  assert.deepEqual(h.calls, ['Double Kill'], '新的那条照常播出');
  assert.equal(h.f.pendingCount(), 0);
});

test('回归：pendingCount 反映真实队列 —— 播出、丢弃、暂停、新局之后都是 0', () => {
  const a = arena();
  let busy = true;
  const h = fb({ getWordPriorityBusy: () => busy, isBattleLive: liveOf(a) });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  assert.equal(h.f.pendingCount(), 1);
  h.f.pause();
  assert.equal(h.f.pendingCount(), 0, '暂停清干净');
  h.f.resume();
  assert.equal(h.f.pendingCount(), 0, '继续不补播，也不重建待播');
  h.f.complete({ eventId: 'R:2', complete: true, correct: true });
  h.f.newRun();
  assert.equal(h.f.pendingCount(), 0, '新局清干净');
});

test('回归：暂停后 resume 不补播，跨段 count 一个字节都不动', () => {
  const a = arena();
  const h = fb({ getWordPriorityBusy: () => true, isBattleLive: liveOf(a) });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  h.f.complete({ eventId: 'R:2', complete: true, correct: true });
  assert.equal(h.state().count, 2);
  h.f.pause();
  h.f.resume();
  tick(h, 40);
  assert.deepEqual(h.calls, [], '暂停期间丢掉的阶段绝不补播');
  assert.equal(h.state().count, 2, '跨段 count 不变');
});

/* ---------------- 3. scope token：绝不跨战斗补播 ---------------- */

test('回归：延迟播报回来时战斗对象已经换了 —— 旧战斗的里程碑绝不补播', () => {
  let battle = { id: 'battle-1' };
  const h = fb({
    getWordPriorityBusy: () => true, isBattleLive: () => true,
    getScopeToken: () => battle,
  });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  assert.equal(h.f.pendingCount(), 1);

  // 快速推进到新战斗：进度换了新对象（runtime 里 B 被整个重建）。
  battle = { id: 'battle-2' };
  const j = h.jobs.shift(); if (j) j();
  assert.deepEqual(h.calls, [], '★ 旧战斗的里程碑绝不播到新战斗的通道里');
  assert.equal(h.f.pendingCount(), 0, 'scope 变了就清干净，不留残留');
});

test('回归：同一个战斗对象 —— scope 校验放行，里程碑照常播出', () => {
  const battle = { id: 'battle-1' };
  let busy = true;
  const h = fb({
    getWordPriorityBusy: () => busy, isBattleLive: () => true,
    getScopeToken: () => battle,
  });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  busy = false;
  tick(h);
  assert.deepEqual(h.calls, ['First Blood'], '战斗没换，播报必须真的出去');
  assert.equal(h.f.pendingCount(), 0);
});

test('回归：没注入 getScopeToken 时行为不变（缺省成不校验）', () => {
  const h = fb({ getWordPriorityBusy: () => true, isBattleLive: () => true });
  h.f.complete({ eventId: 'R:1', complete: true, correct: true });
  tick(h, 40);
  assert.equal(h.f.pendingCount(), 0, '仍然按窗口丢弃，不悬挂');
});