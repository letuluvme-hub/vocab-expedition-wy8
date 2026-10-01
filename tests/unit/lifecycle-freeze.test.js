/* lifecycle 的三条不变量（与 lifecycle.test.js 的「基本冻结语义」互补）。
 *
 *  1) **迟到回调不得重复入队**：clearTimer 只保证「还没跑就别跑」。已经排进
 *     浏览器事件队列的回调照样会来，pause() 也照样会收到它。以前 fire() 不看
 *     自己还在不在 pending 里，于是「暂停 900ms、剩余 0」的那类待办会在 frozen
 *     里出现两次 —— resume 后回调跑两遍，结算/发奖/推进全部翻倍。
 *  2) **resetBattle 只取消战斗级**：run 级待办（BOSS 收尾 700ms、战败 800ms 结算）
 *     必须活着。以前 frozen.length = 0 把它们一起吞了，换一场战斗后那一局
 *     再也不会结算。
 *  3) **resetRun 清掉暂停**：玩家从主页开新局时，上一次暂停留下的冻结标记会让
 *     这一局新排期的任务直接掉进 frozen，再也跑不起来（新局变成死局）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycle } from '../../src/app/lifecycle.js';

/* 一个**真的**会「已排队仍触发」的定时器台：clearTimer 只标记，真正的 fire
   仍可被手动调用 —— 这正是浏览器事件队列的行为，也正是这个 bug 的成因。 */
function timerRig() {
  const jobs = [];
  let now = 1000;
  let seq = 0;
  const lc = createLifecycle({
    setTimer(fn, ms) { const j = { id: ++seq, fn, at: now + ms, cleared: false }; jobs.push(j); return j.id },
    clearTimer(id) { const j = jobs.filter(x => x.id === id)[0]; if (j) j.cleared = true },
    now: () => now,
  });
  return {
    lc, jobs, now: () => now,
    // 让所有「已经排进队列」的回调真的到点触发（哪怕 clearTimer 标记过）
    tick(ms) {
      now += ms;
      for (const j of jobs) if (j.at <= now && !j.fired) { j.fired = true; j.fn() }
    },
    // 模拟浏览器：clear 之后仍有一个已排队的回调被派发
    flushQueued() { for (const j of jobs) if (j.cleared && !j.queuedFired) { j.queuedFired = true; j.fn() } },
  };
}

/* ---------------- 1. 迟到回调不重复入队 ---------------- */

test('暂停后再收到已排队的迟到回调：frozen 里仍然只有一份', () => {
  const r = timerRig();
  let calls = 0;
  r.lc.scheduleRun(() => { calls++ }, 900);

  r.lc.pause();
  // 浏览器把那个已经 clear 掉的回调照样派发了一次
  r.flushQueued();
  assert.equal(r.lc.frozenCount(), 1, '迟到的回调不得再入队一次');

  r.lc.resume();
  r.tick(5000);
  assert.equal(calls, 1, '同一个待办只跑一次（以前会跑两遍）');
});

test('重复 pause 不会让同一个待办在 frozen 里叠多份', () => {
  const r = timerRig();
  let calls = 0;
  r.lc.scheduleBattle(() => { calls++ }, 300);
  r.lc.pause();
  r.lc.pause();
  r.lc.pause();
  r.flushQueued();
  assert.equal(r.lc.frozenCount(), 1);
  r.lc.resume();
  r.tick(1000);
  assert.equal(calls, 1);
});

test('多个待办各自冻结一次，不多不少', () => {
  const r = timerRig();
  const seen = [];
  r.lc.scheduleRun(() => seen.push('a'), 100);
  r.lc.scheduleBattle(() => seen.push('b'), 200);
  r.lc.scheduleRun(() => seen.push('c'), 300);
  r.lc.pause();
  r.flushQueued();
  assert.equal(r.lc.frozenCount(), 3);
  r.lc.resume();
  r.tick(1000);
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
});

/* ---------------- 2. resetBattle 只取消战斗级 ---------------- */

test('resetBattle 不吞掉 run 级冻结待办（结算与 BOSS 收尾必须活着）', () => {
  const r = timerRig();
  const seen = [];
  r.lc.scheduleBattle(() => seen.push('battle'), 900);      // 该被取消
  r.lc.scheduleRun(() => seen.push('ending'), 800);         // 必须活着（战败结算）
  r.lc.scheduleRun(() => seen.push('boss'), 700);           // 必须活着（BOSS 收尾）
  r.lc.pause();
  assert.equal(r.lc.frozenCount(), 3);

  r.lc.resetBattle();              // 换一场战斗
  assert.equal(r.lc.frozenCount(), 2, '只有战斗级待办被清掉');
  r.lc.resume();
  r.tick(5000);
  assert.deepEqual(seen.sort(), ['boss', 'ending'], 'run 级待办照常执行');
});

test('resetBattle 之后新的战斗待办照常执行（不会被旧 epoch 卡住）', () => {
  const r = timerRig();
  const seen = [];
  r.lc.scheduleBattle(() => seen.push('old'), 900);
  r.lc.pause();
  r.lc.resetBattle();
  r.lc.resume();
  r.lc.scheduleBattle(() => seen.push('new'), 100);
  r.tick(1000);
  assert.deepEqual(seen, ['new'], '旧战斗的待办作废，新战斗的正常跑');
});

/* ---------------- 3. resetRun 清掉暂停 ---------------- */

test('resetRun 清掉暂停态：上一局留下的冻结不得让新局变成死局', () => {
  const r = timerRig();
  let old = 0, fresh = 0;
  r.lc.scheduleRun(() => { old++ }, 900);
  r.lc.pause();
  assert.equal(r.lc.isPaused(), true);

  r.lc.resetRun();                 // 新开一轮
  assert.equal(r.lc.isPaused(), false, '新局必须回到可执行状态');
  r.lc.scheduleRun(() => { fresh++ }, 100);
  r.tick(1000);
  assert.equal(fresh, 1, '新局的待办必须真的跑得起来');
  assert.equal(old, 0, '上一局的待办作废');
  assert.equal(r.lc.pendingCount(), 0, '不留残骸');
});

test('resetRun 之后 resume 是安全的空操作（不会把旧待办复活）', () => {
  const r = timerRig();
  let calls = 0;
  r.lc.scheduleRun(() => { calls++ }, 500);
  r.lc.pause();
  r.lc.resetRun();
  r.lc.resume();
  r.tick(5000);
  assert.equal(calls, 0);
});

test('pendingCount 在暂停时把 frozen 也算进去（诊断口径一致）', () => {
  const r = timerRig();
  r.lc.scheduleRun(() => {}, 100);
  r.lc.scheduleRun(() => {}, 200);
  assert.equal(r.lc.pendingCount(), 2);
  r.lc.pause();
  assert.equal(r.lc.pendingCount(), 2, '冻结的待办仍在队列里，只是没跑');
  assert.equal(r.lc.frozenCount(), 2);
  r.lc.resume();
  assert.equal(r.lc.frozenCount(), 0);
  assert.equal(r.lc.pendingCount(), 2);
});
