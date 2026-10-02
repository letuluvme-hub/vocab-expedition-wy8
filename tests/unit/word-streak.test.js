/* 完整词连胜：domain 规则 + 反馈 controller 的单元回归（docs/feature-word-streak.md）。
 *
 * 契约：
 *  1) 只有**完整词**才增长：字母级事件（complete:false）不增长、不消耗 eventId，
 *     后面真正的整词事件仍能用同一个 id 记上。
 *  2) 身份是**显式注入的 eventId**，不是词本身：两个不同 occurrence 的同一 payload
 *     （同一个 word、payload 完全一样）只要 id 不同就各记一次；只按 word 去重会把
 *     「同一个词在本轮出现第二次」误判成重复。
 *  3) 同一个 eventId 重复投递是幂等的：count 不变、不重复播报。
 *  4) 实际打错（correct:false）把 count 清 0；新轮也清 0（controller.newRun）。
 *  5) 台阶 1..8：First Blood / Double Kill / Triple Kill / Quadra Kill /
 *     Penta Kill / Rampage / Unstoppable / Godlike，**首次**到达才播报；
 *     第 8 级之后 state 停在 8（封顶饱和），再完成词不再有新播报。
 *  6) 语音是**低优先级**，绝不抢占、绝不取消完整词朗读：词正忙时只排**一条**
 *     「最新」待播（旧的取消），有上限地等，等不到就安静丢弃（文字照旧）。
 *  7) 暂停冻结：pause 取消待播并作废它的回调，迟到的回调不许播报旧阶段；
 *     暂停期间 complete/mistake 不改状态。
 *  8) 出声失败/没声：speakAnnouncement 返回 false 或抛错时只当「这次没播」，
 *     不假装播了、不回退到任何会抢话的老接口、不改玩家静音/朗读偏好。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWordStreakState, normalizeWordStreakState, recordWordCompletion,
  streakStageFor, STREAK_STAGES, STREAK_STAGE_LIMIT,
} from '../../src/domain/word-streak.js';
import { createWordStreakFeedback, FEEDBACK_DEFER_MS } from '../../src/app/word-streak-feedback.js';

/* ---------------- 可控时钟与调度器（不依赖真实计时器） ---------------- */
function harness(opts = {}) {
  const scheduled = [];
  let t = 1000;
  const timers = new Map();
  let seq = 0;
  const spoken = [];
  const announced = [];
  let state = createWordStreakState();
  let paused = false;
  let live = true;
  let busy = false;

  const api = {
    get spoken() { return spoken; },
    /* 抓最近一次排出去的回调（模拟「已 dispatch、未必能取消」的迟到竞态）。 */
    lastFn: () => { const v = scheduled[scheduled.length - 1]; return () => v.fn(); },
    get announced() { return announced; },
    get state() { return state; },
    set state(v) { state = v; },
    set busy(v) { busy = !!v; },
    get busy() { return busy; },
    get live() { return live; },
    set live(v) { live = !!v; },
    tick(ms) { t += ms; },
    now: () => t,
    schedule(fn, ms) {
      const id = ++seq;
      const entry = { fn, at: t + (ms || 0) };
      timers.set(id, entry);
      scheduled.push(entry);
      return id;
    },
    cancelSchedule(id) { timers.delete(id); },
    /* 推进时钟并触发到期的定时器（返回触发数量）。 */
    flush() {
      let n = 0;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= t);
        if (!due.length) return n;
        due.sort((a, b) => a[1].at - b[1].at);
        const [id, v] = due[0];
        timers.delete(id);
        v.fn();
        n++;
      }
    },
    pending: () => timers.size,
  };
  const fb = createWordStreakFeedback({
    getState: () => state,
    setState: s => { state = s; },
    speakAnnouncement: req => { spoken.push(req); return opts.speakResult !== false; },
    onAnnounce: a => { announced.push(a); },
    cancelSchedule: api.cancelSchedule,
    schedule: api.schedule,
    now: api.now,
    isPaused: () => paused,
    isBattleLive: () => live,
    getWordPriorityBusy: () => busy,
    ...(opts.overrides || {}),
  });
  api.fb = fb;
  api.pause = () => { paused = true; return fb.pause(); };
  api.resume = () => { paused = false; return fb.resume(); };
  return api;
}
const ev = (id, extra = {}) => ({ eventId: id, complete: true, correct: true, ...extra });

/* ---------------- domain：形状与台阶 ---------------- */

test('createWordStreakState 的初始形状固定为 {count:0,lastEventId:null}', () => {
  assert.deepEqual(createWordStreakState(), { count: 0, lastEventId: null });
});

test('八级台阶文案与规范逐字一致，第 8 级封顶', () => {
  assert.deepEqual(STREAK_STAGES.map(s => s.label), [
    'First Blood', 'Double Kill', 'Triple Kill', 'Quadra Kill',
    'Penta Kill', 'Rampage', 'Unstoppable', 'Godlike',
  ]);
  assert.equal(STREAK_STAGE_LIMIT, 8);
  STREAK_STAGES.forEach((s, i) => {
    assert.equal(s.stage, i + 1);
    assert.equal(s.count, i + 1);
    assert.equal(streakStageFor(i + 1).label, s.label);
  });
  assert.equal(streakStageFor(0), null);
  assert.equal(streakStageFor(9), null);
  assert.equal(streakStageFor(-1), null);
  assert.equal(streakStageFor(1.5), null);
  assert.equal(streakStageFor('3'), null);
});

/* ---------------- domain：字母不增长 / 整词才增长 ---------------- */

test('字母级完成（complete:false）不增长，也不占用 eventId', () => {
  let s = createWordStreakState();
  const letter = recordWordCompletion(s, { eventId: 'e1', complete: false, correct: true });
  assert.equal(letter.state.count, 0, '半词不算连胜');
  assert.equal(letter.announcement, null);
  assert.equal(letter.state.lastEventId, null, '字母事件不消耗身份');
  const whole = recordWordCompletion(letter.state, ev('e1'));
  assert.equal(whole.state.count, 1, '整词事件仍能用同一个 id 记上');
  assert.equal(whole.announcement.label, 'First Blood');
});

test('打错的字母清零，但没打完的词不算一次完整词', () => {
  let s = { count: 3, lastEventId: 'e3' };
  const miss = recordWordCompletion(s, { eventId: 'e4', complete: false, correct: false });
  assert.equal(miss.state.count, 0, '实际打错立刻清零');
  assert.equal(miss.state.lastEventId, 'e4');
  assert.equal(miss.announcement, null);
});

test('两个不同 eventId 的完整词各增长一次', () => {
  let s = createWordStreakState();
  s = recordWordCompletion(s, ev('a1')).state;
  s = recordWordCompletion(s, ev('a2')).state;
  assert.equal(s.count, 2);
});

test('同一个 eventId 重复投递是幂等的：不增长也不重复播报', () => {
  let s = createWordStreakState();
  const first = recordWordCompletion(s, ev('dup'));
  const again = recordWordCompletion(first.state, ev('dup'));
  assert.equal(again.state.count, first.state.count);
  assert.equal(again.announcement, null, '同一 id 不重复播报');
  assert.equal(again.reason, 'duplicate');
  assert.equal(recordWordCompletion(again.state, ev('dup')).state.count, 1);
});

test('只按 word 去重是错的：同一 payload 的两次出现（id 不同）要各记一次', () => {
  const payload = { eventId: 'r1-7', complete: true, correct: true, word: 'apple' };
  let s = createWordStreakState();
  s = recordWordCompletion(s, payload).state;
  const second = recordWordCompletion(s, { ...payload, eventId: 'r1-7-b' });
  assert.equal(second.state.count, 2, '同词不同 occurrence 各算一次');
  assert.equal(second.announcement.label, 'Double Kill');
});

test('缺 eventId 时不增长（无法去重就不记），不猜身份', () => {
  const r = recordWordCompletion(createWordStreakState(), { complete: true, correct: true });
  assert.equal(r.state.count, 0);
  assert.equal(r.announcement, null);
  assert.equal(r.reason, 'no-event-id');
});

/* ---------------- domain：正确完成标志必须严格为 true ---------------- */

test('「完成」必须同时是 complete:true 且 correct:true；correct:false 清零、undefined 不增长', () => {
  let s = createWordStreakState();
  s = recordWordCompletion(s, ev('g1')).state;
  assert.equal(s.count, 1);
  /* 打错：真的打断连胜。 */
  const miss = recordWordCompletion(s, { eventId: 'g2', complete: true, correct: false });
  assert.equal(miss.state.count, 0, 'correct:false 清零');
  assert.equal(miss.reason, 'mistake');
  /* 没写 correct（或写成非 true 的值）：不算学会，也**不**谎称打错。 */
  const vague = recordWordCompletion(s, { eventId: 'g4', complete: true });
  assert.equal(vague.state.count, 1, 'correct 缺失不增长');
  assert.equal(vague.announcement, null);
  assert.equal(vague.reason, 'not-correct');
  assert.equal(vague.state.lastEventId, 'g1', '没被算成事实就不落身份');
  for (const bad of [undefined, null, 0, 1, 'true', 'yes', {}]) {
    const r = recordWordCompletion(s, { eventId: 'gx' + String(bad), complete: true, correct: bad });
    assert.equal(r.state.count, 1, 'correct=' + JSON.stringify(bad) + ' 不算成功');
    assert.equal(r.announcement, null);
  }
});

test('letter 级事件不因 correct 缺失而清零：没打错就是没打错', () => {
  const s = recordWordCompletion(createWordStreakState(), ev('l1')).state;
  const letter = recordWordCompletion(s, { eventId: 'l2', complete: false });
  assert.equal(letter.state.count, 1, '字母事件不增长也不清零');
  assert.equal(letter.reason, 'incomplete');
  assert.equal(letter.state.lastEventId, 'l1', '字母事件不消耗身份');
});

test('身份按字面比较，不做 trim 改写（只拿 trim 判空）', () => {
  let s = createWordStreakState();
  s = recordWordCompletion(s, ev(' e1 ')).state;
  assert.equal(s.lastEventId, ' e1 ', '存储保留原 token');
  assert.equal(recordWordCompletion(s, ev(' e1 ')).reason, 'duplicate', '同字面 id 幂等');
  const other = recordWordCompletion(s, ev('e1'));
  assert.equal(other.state.count, 2, '" e1 " 与 "e1" 是两个身份，不许被悄悄合并');
  assert.equal(other.state.lastEventId, 'e1');
});

test('只对**最近一次**身份去重；老的重复 id 会被重新计一次（契约如实说明这个边界）', () => {
  let s = createWordStreakState();
  s = recordWordCompletion(s, ev('d1')).state;   // 1
  s = recordWordCompletion(s, ev('d2')).state;   // 2
  const again = recordWordCompletion(s, ev('d1'));
  assert.equal(again.state.count, 3, '最近一次不是 d1，就当它是新的事实');
  assert.equal(again.reason, 'grown');
  const idem = recordWordCompletion(again.state, ev('d1'));
  assert.equal(idem.reason, 'duplicate', '紧挨着的重复才幂等');
});

/* ---------------- domain：封顶饱和 ---------------- */

test('第 8 级之后 count 停在 8，不再有新播报（不每词狂喊）', () => {
  let s = createWordStreakState();
  const seen = [];
  for (let i = 1; i <= 12; i++) {
    const r = recordWordCompletion(s, ev('w' + i));
    s = r.state;
    if (r.announcement) seen.push(r.announcement.label);
  }
  assert.deepEqual(seen, [
    'First Blood', 'Double Kill', 'Triple Kill', 'Quadra Kill',
    'Penta Kill', 'Rampage', 'Unstoppable', 'Godlike',
  ]);
  assert.equal(s.count, 8, 'state 饱和在 8');
  assert.equal(recordWordCompletion(s, ev('w13')).announcement, null);
});

test('打错后从 First Blood 重新开始', () => {
  let s = { count: 8, lastEventId: 'x8' };
  s = recordWordCompletion(s, { eventId: 'x9', complete: false, correct: false }).state;
  assert.equal(s.count, 0);
  assert.equal(recordWordCompletion(s, ev('y1')).announcement.label, 'First Blood');
});

/* ---------------- domain：旧存档显式降级 ---------------- */

test('normalizeWordStreakState 对坏存档显式降级成 count 0 / lastEventId null', () => {
  assert.deepEqual(normalizeWordStreakState(null), { count: 0, lastEventId: null });
  assert.deepEqual(normalizeWordStreakState(undefined), { count: 0, lastEventId: null });
  assert.deepEqual(normalizeWordStreakState({ count: 'x', lastEventId: 7 }), { count: 0, lastEventId: null });
  assert.deepEqual(normalizeWordStreakState({ count: 99, lastEventId: 'a' }), { count: 8, lastEventId: 'a' });
  /* 身份按字面保留：' a ' 与 'a' 是两个不同的 id，规范化不替父层改写它。 */
  assert.deepEqual(normalizeWordStreakState({ count: 3.9, lastEventId: ' a ' }), { count: 3, lastEventId: ' a ' });
  assert.deepEqual(normalizeWordStreakState({ count: 1, lastEventId: '   ' }), { count: 1, lastEventId: null },
    '只含空白的身份算没有身份');
});

test('recordWordCompletion 是纯函数：不改传入的 state 对象', () => {
  const s = { count: 1, lastEventId: 'a' };
  const before = JSON.stringify(s);
  recordWordCompletion(s, ev('b'));
  recordWordCompletion(s, { eventId: 'b', complete: false, correct: false });
  assert.equal(JSON.stringify(s), before);
});

/* ---------------- controller：基本接线 ---------------- */

test('complete → 文字播报 + 低优先级语音，状态写回 getState/setState', () => {
  const h = harness();
  const r = h.fb.complete(ev('c1'));
  assert.equal(r.state.count, 1);
  assert.deepEqual(h.announced.map(a => a.label), ['First Blood']);
  assert.equal(h.spoken.length, 1);
  assert.deepEqual(h.spoken[0], { text: 'First Blood', priority: 'feedback', count: 1, stage: 1 });
  assert.equal(h.state.count, 1, 'setState 写回');
});

test('语音请求只带 text/priority/count/stage，绝不带当前英文词', () => {
  const h = harness();
  h.fb.complete(ev('c1', { word: 'apple' }));
  assert.equal(JSON.stringify(h.spoken[0]).includes('apple'), false, '不把学习答案喂给语音通道');
});

test('controller 逐级播报到 Godlike，之后只有文字没有语音', () => {
  const h = harness();
  for (let i = 1; i <= 10; i++) h.fb.complete(ev('k' + i));
  assert.deepEqual(h.announced.map(a => a.label), [
    'First Blood', 'Double Kill', 'Triple Kill', 'Quadra Kill',
    'Penta Kill', 'Rampage', 'Unstoppable', 'Godlike',
  ]);
  assert.equal(h.spoken.length, 8, '封顶后不再出声');
  assert.equal(h.state.count, 8);
});

test('mistake 清零并作废在途的待播（那条阶段已经过期）', () => {
  const h = harness();
  h.busy = true;                       // 让待播停在队列里
  h.fb.complete(ev('m1'));
  assert.ok(h.pending() > 0, '词忙时应留一条待播');
  h.busy = false;
  h.fb.mistake({ eventId: 'm2' });
  assert.equal(h.state.count, 0);
  assert.equal(h.pending(), 0, '旧阶段的待播被取消');
  h.flush();
  assert.equal(h.spoken.length, 0, '迟到的回调不播报过期阶段');
});

test('newRun 把 state 重置为 {count:0,lastEventId:null} 并取消待播', () => {
  const h = harness();
  h.fb.complete(ev('n1'));
  assert.equal(h.spoken.length, 1, '第一条当时词不忙，正常播出');
  h.busy = true;
  h.fb.complete(ev('n2'));            // Double Kill 停在待播里
  assert.ok(h.pending() > 0);
  const spokenBefore = h.spoken.length;
  h.busy = false;
  h.fb.newRun();
  assert.deepEqual(h.state, { count: 0, lastEventId: null });
  assert.equal(h.pending(), 0);
  h.flush();
  assert.equal(h.spoken.length, spokenBefore, '新轮之后不播旧阶段');
  const after = h.fb.complete(ev('n3'));
  assert.equal(after.state.count, 1);
  assert.equal(after.announcement.label, 'First Blood');
});

/* ---------------- controller：语音优先级 ---------------- */

test('词正忙时不发声也不取消词，只排一条待播；等空档后播最新那条', () => {
  const spoken = [];
  const cancelled = [];
  const timers = [];
  let busy = true;
  let cell = createWordStreakState();       // 真实持久 state（getState 必须真的记住）
  const fb = createWordStreakFeedback({
    getState: () => cell,
    setState: s => { cell = s; },
    speakAnnouncement: r => { spoken.push(r); return true; },
    onAnnounce: () => {},
    schedule: fn => { timers.push(fn); return timers.length; },
    cancelSchedule: id => { cancelled.push(id); },
    isPaused: () => false,
    isBattleLive: () => true,
    getWordPriorityBusy: () => busy,
  });
  const r1 = fb.complete(ev('p1'));
  assert.equal(spoken.length, 0, '词正忙时绝不出声');
  assert.equal(r1.announcement.label, 'First Blood');
  assert.equal(timers.length, 1, '排了一条待播');
  assert.deepEqual(cancelled, [], '绝不取消/抢占词朗读');

  const r2 = fb.complete(ev('p2'));          // 更新为 Double Kill：旧的待播被取消
  assert.equal(r2.announcement.label, 'Double Kill');
  assert.deepEqual(cancelled, [1], '取消的是上一条待播句柄，不是任何词朗读句柄');
  assert.equal(cell.count, 2, '文字反馈照记');

  busy = false;
  timers.pop()();                            // 词念完了，触发「下一拍」
  assert.equal(spoken.length, 1, '只播一条，且是最新那条');
  assert.equal(spoken[0].text, 'Double Kill');
  assert.equal(spoken[0].priority, 'feedback');
  assert.equal(spoken[0].stage, 2);
});

test('词一直忙：待播被取消而不是无限排队，也不会盖住下一个词', () => {
  const h = harness();
  h.busy = true;
  h.fb.complete(ev('q1'));
  for (let i = 0; i < 30; i++) { h.tick(500); h.flush(); }
  assert.equal(h.spoken.length, 0, '一个音都没抢');
  assert.equal(h.pending(), 0, '等不到就丢弃，不堆成队列');
  assert.equal(h.announced.length, 1, '文字反馈不受影响');
});

test('没有语音能力时（返回 false）只当这次没播，不假装出声、不改偏好', () => {
  const h = harness({ speakResult: false });
  const r = h.fb.complete(ev('s1'));
  assert.equal(r.spoken, false);
  assert.equal(h.announced.length, 1, '文字照旧');
  assert.equal(h.spoken.length, 1, '确实调用过通道（返回值即「没播出来」）');
});

test('语音通道抛错也不影响玩法与文字反馈', () => {
  const announced = [];
  const fb = createWordStreakFeedback({
    getState: () => ({ count: 0, lastEventId: null }),
    setState: () => {},
    speakAnnouncement: () => { throw new Error('no speechSynthesis'); },
    onAnnounce: a => announced.push(a),
    isPaused: () => false, isBattleLive: () => true, getWordPriorityBusy: () => false,
  });
  const r = fb.complete(ev('x1'));
  assert.equal(r.spoken, false);
  assert.deepEqual(announced.map(a => a.label), ['First Blood']);
});

test('战斗不在进行中（isBattleLive=false）不打扰：状态照记、不出声', () => {
  const h = harness();
  h.live = false;
  const r = h.fb.complete(ev('bl1'));
  assert.equal(r.state.count, 1, '事实照记');
  assert.equal(r.spoken, false);
  assert.equal(h.spoken.length, 0);
  assert.equal(h.announced.length, 1, '文字仍然给（不依赖语音能力）');
});

/* ---------------- controller：暂停冻结与迟到回调 ---------------- */

test('pause 取消待播并作废它的回调：迟到回调不播旧阶段', () => {
  const h = harness();
  h.busy = true;
  h.fb.complete(ev('p1'));
  assert.ok(h.pending() > 0);
  const kept = [];
  h.fb.pause();
  assert.equal(h.pending(), 0, '待播已取消');
  h.busy = false;
  h.flush();
  assert.equal(h.spoken.length, 0, '暂停中不出声');
  assert.equal(h.state.count, 1, '暂停冻结但保留同一段连胜');
  /* 模拟一个已经排出去、无法取消的迟到回调（真实计时器竞态的替身） */
  kept.push(() => h.fb.complete(ev('p2')));
  h.resume();
  kept[0]();
  assert.equal(h.state.count, 2, '恢复后可以继续计');
  assert.deepEqual(h.announced.map(a => a.label), ['First Blood', 'Double Kill']);
});

test('暂停期间 complete/mistake 都不改状态（冻结）', () => {
  const h = harness();
  h.fb.complete(ev('f1'));
  const before = JSON.stringify(h.state);
  h.pause();
  const r1 = h.fb.complete(ev('f2'));
  const r2 = h.fb.mistake({ eventId: 'f3' });
  assert.equal(JSON.stringify(h.state), before, '暂停中状态一个字节都不动');
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'paused');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'paused');
  h.resume();
  assert.equal(h.fb.complete(ev('f4')).state.count, 2);
});

test('resume 不补播暂停期间丢掉的阶段（不打扰、不补话）', () => {
  const h = harness();
  h.busy = true;
  h.pause();
  h.fb.complete(ev('r1'));
  h.busy = false;
  h.resume();
  h.flush();
  assert.equal(h.spoken.length, 0);
  assert.equal(h.announced.length, 0);
});

test('dispose 幂等：之后所有入口都是 no-op，不再出声', () => {
  const h = harness();
  h.fb.complete(ev('d1'));
  h.fb.dispose();
  h.fb.dispose();
  const before = JSON.stringify(h.state);
  const c = h.fb.complete(ev('d2'));
  h.fb.mistake({ eventId: 'd3' });
  h.fb.newRun();
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'disposed');
  assert.equal(JSON.stringify(h.state), before, 'dispose 之后不再改状态');
});

test('dispose 会取消在途待播', () => {
  const h = harness();
  h.busy = true;
  h.fb.complete(ev('d1'));
  assert.ok(h.pending() > 0);
  h.fb.dispose();
  assert.equal(h.pending(), 0);
  h.busy = false;
  h.flush();
  assert.equal(h.spoken.length, 0);
});

/* ---------------- controller：待播窗口真的有时间上界 ---------------- */

test('deferWindowMs 小于 deferMs 时，第一次重排前就已过期：安静丢弃、不重排', () => {
  const h = harness({ overrides: { deferMs: 120, deferWindowMs: 100, maxDeferrals: 5 } });
  h.busy = true;
  h.fb.complete(ev('w1'));
  assert.equal(h.pending(), 1, '先排一条待播');
  h.tick(120);
  h.flush();
  assert.equal(h.spoken.length, 0, '一个音都没抢');
  assert.equal(h.pending(), 0, '过了窗口上限就丢弃，不再重排');
  h.busy = false;
  h.flush();
  assert.equal(h.spoken.length, 0, '迟到的回调也不补播');
  assert.equal(h.announced.length, 1, '文字反馈照旧');
});

test('每次重排不会把待播的诞生时间往后推（同一条待播只有一个 bornAt）', () => {
  const h = harness({ overrides: { deferMs: 100, deferWindowMs: 250, maxDeferrals: 99 } });
  h.busy = true;
  h.fb.complete(ev('b1'));
  assert.equal(h.fb.pendingCount(), 1);
  h.tick(100); h.flush();
  assert.equal(h.fb.pendingCount(), 2, '累计 100ms ≤ 250ms：继续等');
  h.tick(100); h.flush();
  assert.equal(h.fb.pendingCount(), 3, '累计 200ms ≤ 250ms');
  /* 这一拍累计 300ms > 250ms：窗口从第一次想播起算，不被重排往后推。 */
  h.tick(100); h.flush();
  assert.equal(h.pending(), 0, '越过 250ms 窗口，丢弃');
  assert.equal(h.fb.pendingCount(), 0);
  h.busy = false;
  h.flush();
  assert.equal(h.spoken.length, 0);
});

test('排出去的回调迟到于窗口时不再出声（真实计时器卡顿的替身）', () => {
  const h = harness({ overrides: { deferMs: 10, deferWindowMs: 50, maxDeferrals: 99 } });
  h.busy = true;
  h.fb.complete(ev('l1'));
  const late = h.lastFn();               // 抓一个「已排出去、未必能取消」的回调
  h.tick(500);                            // 事件循环卡了很久，回调迟到
  h.busy = false;
  late();
  assert.equal(h.spoken.length, 0, '迟到且越过窗口：不播');
  assert.equal(h.pending(), 0);
});

/* ---------------- controller：新事实一律作废旧待播 ---------------- */

test('封顶饱和的新 complete（无播报）也作废在途待播，不会晚播旧阶段', () => {
  const h = harness();
  h.busy = true;
  h.fb.complete(ev('s1'));
  assert.ok(h.pending() > 0);
  h.busy = false;
  h.flush();
  /* 直接把 count 推到饱和：第 8 级之后的 complete 没有播报，但仍是新事实。 */
  h.state = { count: 8, lastEventId: 's8' };
  h.busy = true;
  const r = h.fb.complete(ev('s9'));
  assert.equal(r.reason, 'saturated');
  assert.equal(r.announcement, null);
  assert.equal(h.pending(), 0, '饱和事件也要作废旧的待播');
  h.busy = false;
  h.flush();
  assert.equal(h.spoken.length, 0, '不会晚播第 1 级');
});

test('重复 id / 半词事件不干扰在途待播（没有新事实）', () => {
  const h = harness();
  h.busy = true;
  h.fb.complete(ev('d1'));
  assert.equal(h.fb.pendingCount(), 1);
  h.fb.complete(ev('d1'));                // duplicate
  h.fb.complete({ eventId: 'd2', complete: false, correct: true });  // incomplete
  assert.equal(h.fb.pendingCount(), 1, '待播仍在，等空档');
  h.busy = false;
  h.tick(FEEDBACK_DEFER_MS);   // 词念完了，走完这一拍的重试
  h.flush();
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, 'First Blood');
});

/* ---------------- controller：pause()/resume() 自带冻结 ---------------- */

test('不注入 isPaused 时，pause() 自己就拦住 complete/mistake，resume() 正确解冻', () => {
  let cell = createWordStreakState();
  const fb = createWordStreakFeedback({
    getState: () => cell,
    setState: s => { cell = s; },
    speakAnnouncement: () => true,
    isBattleLive: () => true,
    getWordPriorityBusy: () => false,
  });
  assert.equal(fb.complete(ev('i1')).state.count, 1);
  fb.pause();
  assert.equal(fb.isPaused(), true);
  assert.equal(fb.complete(ev('i2')).reason, 'paused');
  assert.equal(cell.count, 1, '暂停后 complete 不再增长');
  assert.equal(fb.mistake({ eventId: 'i3' }).reason, 'paused');
  assert.equal(cell.count, 1, '暂停后 mistake 也不清零');
  fb.resume();
  assert.equal(fb.isPaused(), false);
  assert.equal(fb.complete(ev('i4')).state.count, 2, '恢复后继续计');
});

/* ---------------- controller：默认 setTimeout 也被真正清掉 ---------------- */

test('未注入 schedule/cancelSchedule 时，newRun / dispose 会清掉真实定时器（不泄漏）', async () => {
  let busy = true;
  const spoken = [];
  let cell = createWordStreakState();
  const fb = createWordStreakFeedback({
    getState: () => cell,
    setState: s => { cell = s; },
    speakAnnouncement: r => { spoken.push(r); return true; },
    isBattleLive: () => true,
    getWordPriorityBusy: () => busy,
    deferMs: 15,
  });
  fb.complete(ev('t1'));
  assert.equal(fb.pendingCount(), 1, '用真实 setTimeout 排了一条');
  fb.newRun();
  assert.equal(fb.pendingCount(), 0);
  busy = false;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(spoken.length, 0, '真实定时器已被 clearTimeout，迟到的回调也不播');

  /* 同样走 dispose：默认路径下不留悬挂的 setTimeout。 */
  busy = true;
  fb.complete(ev('t2'));
  assert.equal(fb.pendingCount(), 1);
  fb.dispose();
  busy = false;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(spoken.length, 0, 'dispose 也清了真实定时器');
});
